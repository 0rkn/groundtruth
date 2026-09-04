/**
 * A consultant adding one quotation by hand — checked against the real document, never
 * taken on trust.
 *
 * WHY THIS EXISTS. Every quote a director sees is there because code lifted it verbatim
 * from a document the model was shown, which is the one guarantee this whole tool rests
 * on: if it is shown as a quote, it is provably real. A free-text box that let a
 * consultant type "I found on page 6 that..." would break that guarantee silently — the
 * typed line would render identically to a verified one, and nothing would tell a later
 * reader which is which.
 *
 * So this does not accept prose. It accepts a document, a page, and a quotation, and
 * checks that the quotation genuinely appears on that page of that document — the exact
 * page text `run-appraisal.ts` stored under `documents:<appraisalId>` when the run
 * finished — before it is added anywhere. A quote that fails the check is refused, not
 * saved with a warning label; the one thing worse than no manual evidence is manual
 * evidence a reader cannot tell from the checked kind.
 */
import { kvGet, kvPut } from "@/lib/cf";
import type { Appraisal, AppraisalQuestion } from "@/lib/appraisal";

export const runtime = "nodejs";

interface StoredDocument {
  filename: string;
  pages: { number: number; text: string }[];
}

/** Markdown emphasis, table pipes and whitespace collapsed — the same tolerance every
 * other verbatim check in this codebase (`pick.ts`, the truthfulness check) allows,
 * since it is extraction noise a reader never sees, not a change to the words. */
function normalise(text: string): string {
  return text
    .replace(/\*{1,3}/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export async function POST(request: Request): Promise<Response> {
  let body: { appraisalId?: string; questionId?: string; document?: string; page?: number; quote?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const { appraisalId, questionId, document, page, quote } = body;
  if (!appraisalId || !questionId || !document || !page || !quote?.trim()) {
    return Response.json({ error: "Missing appraisalId, questionId, document, page or quote." }, { status: 400 });
  }

  if (quote.trim().length < 20) {
    return Response.json({ error: "Too short to be evidence — at least 20 characters." }, { status: 400 });
  }

  const storedDocsRaw = await kvGet(`documents:${appraisalId}`);
  if (!storedDocsRaw) {
    return Response.json(
      { error: "The original documents for this appraisal are no longer available to check against." },
      { status: 404 },
    );
  }

  const storedDocs = JSON.parse(storedDocsRaw) as StoredDocument[];
  const doc = storedDocs.find((d) => d.filename === document);
  if (!doc) return Response.json({ error: `"${document}" is not one of this appraisal's documents.` }, { status: 400 });

  const pageEntry = doc.pages.find((p) => p.number === page);
  if (!pageEntry) return Response.json({ error: `${document} has no page ${page}.` }, { status: 400 });

  if (!normalise(pageEntry.text).includes(normalise(quote))) {
    return Response.json(
      { error: `That text does not appear on page ${page} of ${document}. Check it is copied exactly.` },
      { status: 422 },
    );
  }

  // Verified. Now attach it to the question, in both places a finished appraisal is
  // stored — the raw cache entry `cached()` reads, and the job-status wrapper
  // `/api/status` and `/api/history` read. They must agree, or which one a page happens
  // to read decides whether the addition is visible.
  const appraisalRaw = await kvGet(appraisalId);
  if (!appraisalRaw) return Response.json({ error: "This appraisal no longer exists." }, { status: 404 });
  const appraisal = JSON.parse(appraisalRaw) as Appraisal;

  let found: AppraisalQuestion | undefined;
  for (const theme of appraisal.themes) {
    const q = theme.questions.find((q) => q.id === questionId);
    if (q) {
      found = q;
      q.state = "evidenced";
      q.sources = [...(q.sources ?? []), { document, page, quote: quote.trim(), manual: true }];
      break;
    }
  }
  if (!found) return Response.json({ error: `No question with id ${questionId}.` }, { status: 400 });

  await kvPut(appraisalId, JSON.stringify(appraisal));

  const jobRaw = await kvGet(`job:${appraisalId}`);
  if (jobRaw) {
    const job = JSON.parse(jobRaw) as { state: string; appraisal?: Appraisal; [key: string]: unknown };
    if (job.state === "ready" && job.appraisal) {
      job.appraisal = appraisal;
      await kvPut(`job:${appraisalId}`, JSON.stringify(job));
    }
  }

  return Response.json({ question: found });
}
