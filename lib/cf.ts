/**
 * Cloudflare REST helpers: Workers AI and Vectorize. No SDK, no Worker — just fetch.
 *
 * Adapted from the week-one skeleton, which had already paid for the two lessons that
 * cost the most time: Vectorize upserts are NDJSON rather than a JSON array, and the
 * index is eventually consistent in a way that returns confident wrong answers rather
 * than an error.
 *
 * Added here: the AI Gateway header on every model call, so usage is attributable.
 */

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN;
const INDEX = process.env.CF_VECTORIZE_INDEX ?? "groundtruth-index";

/**
 * How long a single request may take before it is treated as failed.
 *
 * Nothing here had one before, on any call — embed, Vectorize, or generation. A stalled
 * request had no way to become an error: it just sat there, and in a strictly
 * sequential per-question loop, one stalled call blocked every question after it
 * forever, indistinguishable from the pipeline being slow. A generation call over a 120B
 * model can legitimately take tens of seconds, so this is generous rather than tight —
 * the point is a stall eventually becomes a thrown error instead of an unbounded wait,
 * not to make a slow-but-working call fail.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * `fetch`, but a stall past the timeout throws instead of hanging forever.
 *
 * Every call in this file goes through this rather than the global `fetch` directly, so
 * the timeout is a property of talking to Cloudflare at all, not something each caller
 * has to remember to add.
 */
async function timedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${String(input)}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

if (!ACCOUNT_ID || !API_TOKEN) {
  throw new Error(
    "Set CF_ACCOUNT_ID and CF_API_TOKEN. Scripts load them with `node --env-file=.env`.",
  );
}

/** 768 dimensions, and a 512-token window above which text is silently truncated. */
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBED_DIMENSIONS = 768;
export const INDEX_NAME = INDEX;

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
const auth = { Authorization: `Bearer ${API_TOKEN}` };

/**
 * Routes every Workers AI call through the AI Gateway.
 *
 * Per the integration spec: same endpoint, same token, one header added to every AI
 * request. A previous version of this file assumed the public gateway.ai.cloudflare.com
 * URL scheme and rewrote every call to use it, which was wrong for this setup — the
 * brief is explicit that the endpoint does not change, only this header is added.
 */
const gateway = { "cf-aig-gateway-id": "default" };

/** A Workers AI model call, unchanged endpoint, gateway header attached. */
const aiRun = (model: string) => `${BASE}/ai/run/${model}`;

/**
 * Embed a batch of strings. One 768-float array per input, in order.
 *
 * Order matters and is relied on by every caller: the result is matched back to inputs
 * positionally, so a provider that reordered would corrupt every label silently. The
 * length check below is what makes that assumption fail loudly instead.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await timedFetch(aiRun(EMBED_MODEL), {
    method: "POST",
    headers: { ...auth, ...gateway, "Content-Type": "application/json" },
    body: JSON.stringify({ text: texts }),
  });
  const json = (await res.json()) as {
    success?: boolean;
    errors?: unknown;
    result?: { data?: number[][] };
  };
  if (!res.ok || !json.success) {
    throw new Error(`Workers AI ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }

  const data = json.result?.data ?? [];
  if (data.length !== texts.length) {
    throw new Error(`asked for ${texts.length} embeddings, got ${data.length}`);
  }
  if (data[0]?.length !== EMBED_DIMENSIONS) {
    throw new Error(`expected ${EMBED_DIMENSIONS} dimensions, got ${data[0]?.length}`);
  }
  return data;
}

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: Record<string, string | number>;
  namespace?: string;
}

/** Upsert vectors. The body is NDJSON — one object per line — not a JSON array. */
export async function upsert(records: VectorRecord[]): Promise<{ mutationId: string }> {
  const ndjson = records.map((r) => JSON.stringify(r)).join("\n");
  const res = await timedFetch(`${BASE}/vectorize/v2/indexes/${INDEX}/upsert`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/x-ndjson" },
    body: ndjson,
  });
  const json = (await res.json()) as { success?: boolean; errors?: unknown; result?: { mutationId: string } };
  if (!res.ok || !json.success) {
    throw new Error(`Vectorize upsert ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.result!;
}

export interface IndexInfo {
  dimensions: number;
  vectorCount: number;
  processedUpToMutation: string | null;
}

export async function info(): Promise<IndexInfo> {
  const res = await timedFetch(`${BASE}/vectorize/v2/indexes/${INDEX}/info`, { headers: auth });
  const json = (await res.json()) as { success?: boolean; errors?: unknown; result?: IndexInfo };
  if (!res.ok || !json.success) {
    throw new Error(`Vectorize info ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.result!;
}

/**
 * Wait until the index has processed a specific mutation.
 *
 * Vectorize is eventually consistent, and the failure mode is worse than a delay:
 * upserted vectors become queryable a few at a time, so a query run too early returns
 * a confident, well-formed, WRONG ranking. Nothing in the response says so. Observed
 * lag in the skeleton was 45-70 seconds.
 *
 * Returns false rather than throwing on timeout, so a caller can decide whether a
 * partially-caught-up index is worth querying — but no measurement should accept one.
 */
export async function waitForMutation(mutationId: string, timeoutMs = 180_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const i = await info();
    if (i.processedUpToMutation === mutationId) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

export interface Match {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Query with a single vector. `returnMetadata` is the string "all", not a boolean. */
export async function query(
  vector: number[],
  topK = 8,
  namespace?: string,
): Promise<Match[]> {
  const res = await timedFetch(`${BASE}/vectorize/v2/indexes/${INDEX}/query`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ vector, topK, returnMetadata: "all", ...(namespace ? { namespace } : {}) }),
  });
  const json = (await res.json()) as { success?: boolean; errors?: unknown; result?: { matches: Match[] } };
  if (!res.ok || !json.success) {
    throw new Error(`Vectorize query ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.result?.matches ?? [];
}

export const GENERATION_MODEL = "@cf/openai/gpt-oss-120b";

/**
 * A second model, from a different family, used ONLY to judge.
 *
 * WHY A DIFFERENT FAMILY AND NOT JUST A DIFFERENT PROMPT. A model asked to assess text
 * that a model like it produced tends to approve it — self-preference is a measured
 * property of LLM judges, not a hypothetical. A separate prompt does not remove it,
 * because the bias lives in the shared training distribution rather than in the
 * instructions: the writer and the judge find the same phrasings natural, so the judge
 * reads fluency as correctness.
 *
 * It is not assumed to be the better judge. `check-judge` runs both over the same
 * claims and reports the gap between them, which is the only evidence that could
 * justify paying for a second model — or show that it makes no difference.
 *
 * Llama takes the CHAT shape (`messages`) rather than the responses shape gpt-oss
 * takes, which is why `generateWith` exists below.
 */
export const JUDGE_MODEL_CROSS = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * One generation call.
 *
 * Three things about this model that are easy to get wrong:
 *
 *  - it takes the RESPONSES api shape (`input`), not chat `messages`
 *  - its reasoning arrives as a separate `reasoning` item in `output`, so the visible
 *    text is whichever item has type "message". Reading `output[0]` returns the model's
 *    private chain of thought instead of its answer
 *  - completion is reported by `status` and `incomplete_details`, not `finish_reason`.
 *    A truncated response still returns HTTP 200 with plausible-looking partial text,
 *    so it is checked here rather than left to the caller to remember
 */
export async function generate(prompt: string, maxTokens = 8000): Promise<string> {
  const res = await timedFetch(aiRun(GENERATION_MODEL), {
    method: "POST",
    headers: { ...auth, ...gateway, "Content-Type": "application/json" },
    body: JSON.stringify({ input: prompt, max_tokens: maxTokens }),
  });
  const json = (await res.json()) as {
    success?: boolean;
    errors?: unknown;
    result?: {
      status?: string;
      incomplete_details?: unknown;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
    };
  };
  if (!res.ok || !json.success) {
    throw new Error(`Workers AI generation ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }

  const result = json.result ?? {};
  if (result.status !== "completed" || result.incomplete_details) {
    throw new Error(
      `generation did not complete: status=${result.status}, ${JSON.stringify(result.incomplete_details)}`,
    );
  }

  const message = result.output?.find((o) => o.type === "message");
  const text = message?.content?.find((c) => c.type === "output_text")?.text;
  if (!text) throw new Error(`no output_text in response: ${JSON.stringify(result.output).slice(0, 300)}`);
  return text;
}

/**
 * Generate with a NAMED model, handling the two request shapes Workers AI uses.
 *
 * The shape is not a detail that can be papered over: sending `messages` to gpt-oss, or
 * `input` to Llama, returns HTTP 200 with an empty or nonsense result rather than an
 * error. So the shape is selected from the model id, and a model whose family is not
 * recognised fails loudly instead of being guessed at.
 *
 * Kept separate from `generate` above, which stays the single production path. Only the
 * judge comparison needs to vary the model, and letting the product's generator take a
 * model argument would invite the two to drift apart.
 */
export async function generateWith(
  model: string,
  prompt: string,
  maxTokens = 4000,
): Promise<string> {
  const isResponsesShape = model.startsWith("@cf/openai/gpt-oss");
  const body = isResponsesShape
    ? { input: prompt, max_tokens: maxTokens }
    : { messages: [{ role: "user", content: prompt }], max_tokens: maxTokens };

  const res = await timedFetch(aiRun(model), {
    method: "POST",
    headers: { ...auth, ...gateway, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    success?: boolean;
    errors?: unknown;
    result?: {
      status?: string;
      incomplete_details?: unknown;
      response?: string;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
    };
  };
  if (!res.ok || !json.success) {
    throw new Error(`Workers AI ${model} ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }
  const result = json.result ?? {};

  if (isResponsesShape) {
    if (result.status !== "completed" || result.incomplete_details) {
      throw new Error(
        `${model} did not complete: status=${result.status}, ${JSON.stringify(result.incomplete_details)}`,
      );
    }
    const message = result.output?.find((o) => o.type === "message");
    const text = message?.content?.find((c) => c.type === "output_text")?.text;
    if (!text) throw new Error(`${model}: no output_text in ${JSON.stringify(result.output).slice(0, 200)}`);
    return text;
  }

  // Chat shape returns the text directly. An empty string is the symptom of sending the
  // wrong shape, so it is rejected rather than passed on as an unreadable verdict.
  const text = result.response;
  if (!text) throw new Error(`${model}: empty response — ${JSON.stringify(result).slice(0, 200)}`);
  return text;
}

export const RERANK_MODEL = "@cf/baai/bge-reranker-base";

/**
 * Score query-passage pairs with a cross-encoder, returning the indices reordered.
 *
 * Different in kind from the embedding similarity used to retrieve: the bi-encoder
 * embeds query and passage independently and compares the results, so it can only see
 * topical proximity. A cross-encoder reads both together, which is why it can rank a
 * passage highly for a question it shares no vocabulary with — the case the whole
 * Stage 4 measurement kept failing on.
 *
 * Returns positions into `texts`, best first. Scores are tiny in absolute terms
 * (1e-4 and smaller) and only their order is meaningful, so they are not thresholds.
 */
export async function rerank(
  query: string,
  texts: string[],
): Promise<{ index: number; score: number }[]> {
  if (texts.length === 0) return [];

  const res = await timedFetch(aiRun(RERANK_MODEL), {
    method: "POST",
    headers: { ...auth, ...gateway, "Content-Type": "application/json" },
    body: JSON.stringify({ query, contexts: texts.map((text) => ({ text })) }),
  });
  const json = (await res.json()) as {
    success?: boolean;
    errors?: unknown;
    result?: { response?: { id: number; score: number }[] };
  };
  if (!res.ok || !json.success) {
    throw new Error(`Reranker ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
  }

  const scored = json.result?.response ?? [];
  if (scored.length !== texts.length) {
    throw new Error(`reranked ${scored.length} of ${texts.length} passages; the alignment cannot be trusted`);
  }
  return scored.map((s) => ({ index: s.id, score: s.score }));
}

// ------------------------------------------------------------------------- KV

const KV = process.env.CF_KV_NAMESPACE_ID;

/**
 * Read a cached value. Returns null when absent, and also when KV is not configured —
 * a missing cache must degrade to a slow correct answer, never to an error.
 */
export async function kvGet(key: string): Promise<string | null> {
  if (!KV) return null;
  const res = await timedFetch(
    `${BASE}/storage/kv/namespaces/${KV}/values/${encodeURIComponent(key)}`,
    { headers: auth },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV get ${res.status}: ${await res.text()}`);
  return res.text();
}

/**
 * Write a cached value.
 *
 * The body must be multipart form data with a `value` part; sending the string as a
 * plain body writes a literal empty value and reads back as such, which looks like a
 * cache that never warms rather than an error.
 */
export async function kvPut(key: string, value: string): Promise<void> {
  if (!KV) return;
  const form = new FormData();
  form.set("value", value);
  form.set("metadata", "{}");

  const res = await timedFetch(
    `${BASE}/storage/kv/namespaces/${KV}/values/${encodeURIComponent(key)}`,
    { method: "PUT", headers: auth, body: form },
  );
  if (!res.ok) throw new Error(`KV put ${res.status}: ${await res.text()}`);
}

/**
 * List every key under a prefix, and delete them.
 *
 * WHY THIS EXISTS. The cache is correct by design — a version bump invalidates stale
 * entries automatically — but testing a change means uploading the same documents
 * repeatedly and wanting a FRESH run each time, not the version-bump ceremony. Before
 * this, clearing a cached appraisal meant asking someone to do it by hand. This is that,
 * self-serve.
 *
 * Cloudflare's list endpoint pages at up to 1000 keys; looped here because an account
 * that has run many appraisals could exceed one page.
 */
export async function kvListKeys(prefix: string): Promise<string[]> {
  if (!KV) return [];
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${BASE}/storage/kv/namespaces/${KV}/keys`);
    url.searchParams.set("prefix", prefix);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await timedFetch(url, { headers: auth });
    if (!res.ok) throw new Error(`KV list ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      result: { name: string }[];
      result_info?: { cursor?: string };
    };
    keys.push(...json.result.map((k) => k.name));
    cursor = json.result_info?.cursor || undefined;
  } while (cursor);

  return keys;
}

/** Delete one key. Missing is not an error: the end state either way is "not cached". */
export async function kvDelete(key: string): Promise<void> {
  if (!KV) return;
  const res = await timedFetch(
    `${BASE}/storage/kv/namespaces/${KV}/values/${encodeURIComponent(key)}`,
    { method: "DELETE", headers: auth },
  );
  if (!res.ok && res.status !== 404) throw new Error(`KV delete ${res.status}: ${await res.text()}`);
}
