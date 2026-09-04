/**
 * Start an appraisal.
 *
 * TWO PHASE, because a first run takes about four minutes and no request should be held
 * open that long. This returns an id immediately; the interface then polls
 * `/api/status?id=...`. The id is the cache key, so re-uploading the same documents
 * returns the finished appraisal without recomputing anything.
 *
 * Progress lives in KV rather than in memory. In-memory job state works locally and
 * silently breaks the moment there is more than one instance, which is the kind of bug
 * that only appears after deployment.
 */
import { extractDocument } from "@/lib/extract";
import { appraisalKey } from "@/lib/cache";
import { runAppraisal, type Upload } from "@/lib/run-appraisal";
import { kvGet, kvPut } from "@/lib/cf";
import { rateLimit } from "@/lib/limit";
import type { AppraisalStatus } from "@/lib/appraisal";

export const runtime = "nodejs";

/** Room for the slow first run. Generation alone is around three minutes. */
export const maxDuration = 600;

const jobKey = (id: string) => `job:${id}`;

/**
 * A job record carries a timestamp alongside whatever `AppraisalStatus` it holds, purely
 * so `/api/history` can list previous runs newest first. `AppraisalStatus` itself stays
 * untouched — the interface that polls it does not need this field and never reads it.
 */
type JobRecord = AppraisalStatus & { startedAt: number };

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart form of PDF files." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files were uploaded." }, { status: 400 });
  }

  const notPdf = files.filter((f) => !f.name.toLowerCase().endsWith(".pdf"));
  if (notPdf.length) {
    return Response.json(
      { error: `Only PDFs can be read. Remove: ${notPdf.map((f) => f.name).join(", ")}` },
      { status: 400 },
    );
  }

  const uploads: Upload[] = [];
  for (const file of files) {
    uploads.push({ filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  }

  // The id has to be the cache key, which means extracting the text first. Extraction is
  // fast; it is generation that is slow, so this is a reasonable thing to do inline.
  let id: string;
  try {
    const texts = await Promise.all(uploads.map((u) => extractDocument(u.bytes, u.filename)));
    id = appraisalKey(texts.map((d) => d.text));
  } catch (e) {
    return Response.json(
      { error: `Could not read those PDFs: ${(e as Error).message}` },
      { status: 422 },
    );
  }

  // Already finished, or already running from an earlier request: say so rather than
  // starting a second identical run. Checked BEFORE the rate limit below, deliberately —
  // a cache hit costs nothing and used to be blocked by the same counter as a genuine
  // run, so re-uploading the same documents during a demo could exhaust the limit
  // without a single new model call ever happening.
  const existing = await kvGet(jobKey(id));
  if (existing) return Response.json({ id });

  // One appraisal is roughly a hundred model calls, so an unbounded route on a real
  // deployment is an unbounded bill. Locally, and in any environment short of an actual
  // Vercel deployment, there is no bill to bound — `VERCEL` is a variable Vercel sets on
  // its own runtime and nowhere else, so this is "unlimited until deployed" without a
  // flag anyone has to remember to flip later.
  if (process.env.VERCEL) {
    const limit = await rateLimit(request, { name: "analyse", max: 3, windowSeconds: 3600 });
    if (!limit.ok) {
      return Response.json(
        { error: `That is three appraisals this hour. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.` },
        { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
      );
    }
  }

  const startedAt = Date.now();
  const put = (status: AppraisalStatus) =>
    kvPut(jobKey(id), JSON.stringify({ ...status, startedAt } satisfies JobRecord));

  await put({ state: "queued" });

  // Deliberately not awaited: the response returns while this continues. The interface
  // polls for progress, and if the instance dies mid-run the status stays "running"
  // until a fresh POST restarts it — which is the honest behaviour for a job queue we
  // have not built, rather than pretending durability we do not have.
  void runAppraisal(uploads, (step, done, total) => void put({ state: "running", step, done, total }))
    .then((appraisal) => put({ state: "ready", appraisal }))
    .catch((e: Error) => put({ state: "failed", error: e.message }));

  return Response.json({ id });
}
