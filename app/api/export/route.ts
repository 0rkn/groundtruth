/**
 * The finished questionnaire as a .docx, for a director to open and mark up.
 *
 * Reads the same stored job the status route polls, so this can only export an
 * appraisal that has actually finished — there is no path that builds a document from
 * partial or unverified state.
 */
import { kvGet } from "@/lib/cf";
import { appraisalToDocx } from "@/lib/export-docx";
import type { AppraisalStatus } from "@/lib/appraisal";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });

  const stored = await kvGet(`job:${id}`);
  if (!stored) return Response.json({ error: "No appraisal found for that id." }, { status: 404 });

  const status = JSON.parse(stored) as AppraisalStatus;
  if (status.state !== "ready") {
    return Response.json({ error: "This appraisal has not finished running yet." }, { status: 409 });
  }

  const buffer = await appraisalToDocx(status.appraisal);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="board-appraisal-questionnaire.docx"',
    },
  });
}
