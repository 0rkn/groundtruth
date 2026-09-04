/**
 * Progress and result for a running appraisal.
 *
 * Polled by the interface every couple of seconds. Returns `AppraisalStatus` verbatim,
 * so the page never has to infer what stage a run is at.
 */
import { kvGet } from "@/lib/cf";
import type { AppraisalStatus } from "@/lib/appraisal";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });

  const stored = await kvGet(`job:${id}`);
  if (!stored) {
    // An unknown id is not an error state for the run — it means nothing was ever
    // started under it, or KV is not configured. Either way the honest answer is that
    // there is no such job, not that the appraisal failed.
    return Response.json({ error: "No appraisal found for that id." }, { status: 404 });
  }

  return Response.json(JSON.parse(stored) as AppraisalStatus);
}
