/**
 * The consultant-facing summary: scores aggregated across every director who has
 * responded so far, built fresh on each request rather than cached — a report requested
 * while directors are still answering should reflect whoever has answered by then, not
 * a stale count from the first respondent.
 */
import { kvGet } from "@/lib/cf";
import { buildReport } from "@/lib/aggregate";
import type { Appraisal } from "@/lib/appraisal";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });

  const stored = await kvGet(id);
  if (!stored) return Response.json({ error: "No finished appraisal with that id." }, { status: 404 });

  // Stored under the raw appraisal key by `cached()`, so this is the finished questionnaire
  // itself rather than the job-status wrapper `/api/status` reads.
  const appraisal = JSON.parse(stored) as Appraisal;
  const report = await buildReport(appraisal, id);

  return Response.json({ report });
}
