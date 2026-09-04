/**
 * Retrieval: put passages in the index, ask it questions.
 *
 * The eligible-document rule lives here rather than in the caller, because forgetting
 * it is a correctness failure rather than an inconvenience: the previous review's
 * passages are a prior consultant's findings, and retrieving one would put their
 * conclusions in our report as though we had found them.
 */
import { embed, upsert, query, type Match } from "./cf.ts";
import type { Passage } from "./passages.ts";

/**
 * Index a set of passages under a namespace, and wait until they are queryable.
 *
 * The wait is not optional. Vectorize becomes consistent a few vectors at a time, so a
 * query issued early returns a complete, plausible, wrong ranking with nothing in the
 * response to indicate it. Every measurement taken before the index has caught up is
 * silently invalid, so this throws rather than returning a warning.
 */
export async function indexPassages(
  passages: Passage[],
  namespace: string,
  /** What text to embed for a passage. Defaults to its heading and text. */
  textOf: (p: Passage) => string = (p) => `${p.heading ? p.heading + ". " : ""}${p.text}`,
): Promise<void> {
  const vectors = await embed(passages.map(textOf));

  await upsert(
    passages.map((p, i) => ({
      // Namespaced id. Vectorize ids are unique per INDEX, not per namespace, and every
      // chunk configuration produces the same passage ids — so without this prefix each
      // configuration's upsert silently overwrites the last, and a namespace queried
      // later returns another configuration's vectors, or none at all.
      id: `${namespace}--${p.id}`,
      values: vectors[i],
      // Kept small deliberately: metadata is capped at 10KiB per vector, and the
      // passage text is already held locally by id. Storing it twice invites the two
      // copies to disagree.
      metadata: { document: p.document, page: p.page },
      namespace,
    })),
  );

  // Wait until the namespace stops growing.
  //
  // Two earlier versions of this were wrong in instructive ways. Polling for
  // `processedUpToMutation` to equal a given id is an equality test against a moving
  // value, so a healthy index that races past the mutation never matches. Demanding the
  // full expected count hangs forever on a single straggler.
  //
  // What matters is that ingestion has FINISHED, and the signal for that is the count
  // holding steady across two polls. Querying early is not merely premature: Vectorize
  // becomes consistent a few vectors at a time, so an early query returns a complete,
  // plausible, WRONG ranking with nothing in the response to say so.
  const expected = Math.min(passages.length, 50); // 50 is Vectorize's topK ceiling with metadata
  const start = Date.now();
  let previous = -1;

  while (Date.now() - start < 300_000) {
    const count = (await query(vectors[0], expected, namespace)).length;
    if (count === expected) return;
    if (count === previous && count > 0) return; // settled below the ceiling
    previous = count;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(
    `namespace "${namespace}" never settled; querying now would give a plausible but wrong ranking`,
  );
}

export interface Ranked {
  probe: string;
  matches: Match[];
}

/** Run one probe. `topK` is deliberately deep — every cutoff is derived from it offline. */
export async function retrieve(probe: string, topK = 32, namespace?: string): Promise<Ranked> {
  const [vector] = await embed([probe]);
  return { probe, matches: await query(vector, topK, namespace) };
}

/** Cosine similarity, for cross-checking the index against arithmetic done locally. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || Number.EPSILON);
}

/**
 * What the CURRENT documents say about each recommendation.
 *
 * Supplies the second half of the client's shape (c). A commitment set against its absence
 * needs both the commitment and the absence, and the prompt has only ever carried the
 * commitment — fourteen recommendations listed with no indication of whether anything in
 * the board's own documents answers them. The shape was then recorded as one the model
 * would not write.
 *
 * The recommendation itself is the probe, not the question, because the two share almost no
 * vocabulary: an earlier word-overlap matcher paired 1 recommendation of 14 to a question
 * for exactly that reason. Searching with the recommendation's own words finds what the
 * documents say about its SUBJECT, which is what "was this acted on" actually asks.
 *
 * No threshold and no verdict. Whatever comes back is handed over and the model reads it;
 * an empty list means retrieval found nothing, which is the plainest form of the answer.
 * Deciding "unaddressed" in code would need a similarity cutoff, and the one cutoff study
 * we ran returned an AUC of 0.62 — no usable threshold existed then and none is invented
 * here.
 */
export async function attachCurrentEvidence<
  T extends { text: string; nowShows?: { document: string; page: number; text: string }[] },
>(
  commitments: T[],
  namespace: string,
  resolve: (id: string) => { document: string; page: number; text: string } | undefined,
  perCommitment = 2,
): Promise<T[]> {
  if (commitments.length === 0) return commitments;

  const vectors = await embed(commitments.map((c) => c.text));
  const out: T[] = [];

  // SEQUENTIALLY, and never fatally. A first version issued all fourteen queries at once
  // with Promise.all and took a 504 from Vectorize, which killed a whole generation run
  // over a search that is only ever supplementary. Every other retrieval path in this
  // codebase queries one at a time; this one had no reason to be the exception.
  for (let i = 0; i < commitments.length; i += 1) {
    let nowShows: { document: string; page: number; text: string }[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const matches = await query(vectors[i], perCommitment, namespace);
        nowShows = matches
          .map((m) => resolve(m.id))
          .filter((x): x is { document: string; page: number; text: string } => Boolean(x));
        break;
      } catch {
        // An empty list is indistinguishable from "the documents say nothing about this",
        // which is a claim we must not make by accident. So a search that never succeeded
        // leaves the list empty and the prompt says nothing was retrieved — the model can
        // still write about the recommendation, it just cannot rest a line on the silence.
        if (attempt === 2) nowShows = [];
      }
    }
    out.push({ ...commitments[i], nowShows });
  }

  return out;
}
