import { notFound } from "next/navigation";
import { AppraisalView } from "../appraisal-view";
import { fixture } from "../fixture";

/**
 * Development only: renders the results view from the fixture so the layout can be
 * checked without a two minute pipeline run. Returns a 404 in production.
 */
export default function DevPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main>
      <p className="mx-auto max-w-3xl px-6 pt-8 text-xs text-neutral-500 dark:text-neutral-500">
        Fixture preview. Not a real appraisal.
      </p>
      {/* A fake id so the export link and "copy a director link" section are previewable
          too — /api/export and /api/respond will 404 on it, which is fine here. */}
      <AppraisalView appraisal={fixture} exportId="fixture-preview" />
    </main>
  );
}
