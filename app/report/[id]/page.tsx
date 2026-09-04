"use client";

/**
 * Executive summary, position by theme, strengths, areas for attention, progress since
 * the previous review, an action plan, and an appendix on method — assembled from
 * director scores and the evidence the pipeline already produced.
 *
 * NOTHING HERE IS A NEW MODEL CALL. Every sentence a reader sees is either arithmetic
 * (a mean, a count) or an evidence line `pick.ts`/`summarise.ts` already produced and
 * already checked. Writing a fresh paragraph for this report specifically was
 * deliberately avoided: this project spent today re-learning, twice, that a model asked
 * to describe what a number "shows" reproduces exactly the conclusion-drawing it was
 * built to stop. What is templated below is templated because the alternative is a
 * sentence nobody checked.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Report } from "@/lib/aggregate";
import { fromReportId } from "@/lib/report-id";

/**
 * "Why it scored this way", the one form of that question arithmetic can answer: whether
 * respondents agreed. Kept local rather than imported from `lib/aggregate.ts` — that
 * module also imports `lib/cf.ts` for its KV helpers, which throws at import time without
 * server-only credentials. This is a client component, so pulling in that import chain
 * crashed every load with "Set CF_ACCOUNT_ID and CF_API_TOKEN" even though nothing here
 * ever touches KV. The function itself is pure arithmetic and small enough to duplicate.
 */
function agreementNote(scores: number[]): string | null {
  if (scores.length < 2) return null;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min === max) return `All ${scores.length} respondents scored this ${min}.`;
  return `Scores ranged from ${min} to ${max} across ${scores.length} respondents.`;
}
import { SiteHeader } from "../../site-header";

type Phase = { kind: "loading" } | { kind: "ready"; report: Report } | { kind: "failed"; error: string };

const BAND_LABEL: Record<Report["themes"][number]["band"], string> = {
  strong: "Strong",
  adequate: "Adequate",
  attention: "Needs attention",
};

const BAND_COLOR: Record<Report["themes"][number]["band"], string> = {
  strong: "var(--gt-green)",
  adequate: "var(--gt-muted)",
  attention: "var(--gt-amber)",
};

/**
 * The one piece of prose per theme, assembled rather than composed. Names the band, the
 * mean, and — where one exists — the single lowest-scoring question with real evidence,
 * quoting that evidence's own already-checked paraphrase rather than writing a new
 * sentence about it.
 */
function themeCommentary(theme: Report["themes"][number]): string {
  const weakest = [...theme.questions].sort((a, b) => a.mean - b.mean)[0];
  const base = `${theme.questions.length} question${theme.questions.length === 1 ? "" : "s"} scored, averaging ${theme.mean.toFixed(1)} of 5.`;
  if (!weakest || weakest.mean >= 4) return base;
  return `${base} The lowest-scoring was "${weakest.text}" (${weakest.mean.toFixed(1)}).`;
}

function EvidenceQuote({ quote, computed, document, page }: { quote: string; computed?: boolean; document: string; page: number }) {
  return (
    <div className="mt-2 rounded-lg bg-[var(--gt-nav-active)] px-4 py-3">
      <blockquote className="text-sm leading-relaxed text-[var(--gt-ink)] italic">&ldquo;{quote}&rdquo;</blockquote>
      <p className="mt-1.5 font-mono text-xs text-[var(--gt-muted)] not-italic">
        {computed ? "Computed" : `${document}, p. ${page}`}
      </p>
    </div>
  );
}

export default function ReportPage() {
  // The URL segment is never the raw cache key — see `lib/report-id.ts` for why a colon
  // in a URL path segment caused two separate bugs here (a double-encoding 404, then
  // outright navigation failures in at least one browser). `fromReportId` recovers the
  // exact original key, which is what `/api/report` still expects.
  const id = fromReportId(useParams().id as string);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`/api/report?id=${encodeURIComponent(id)}`);
        const body = (await response.json()) as { report?: Report; error?: string };
        if (!response.ok || !body.report) {
          setPhase({ kind: "failed", error: body.error ?? "Could not load the report." });
          return;
        }
        setPhase({ kind: "ready", report: body.report });
      } catch {
        setPhase({ kind: "failed", error: "Could not reach the server." });
      }
    })();
  }, [id]);

  if (phase.kind === "loading") {
    return (
      <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-16 text-sm text-[var(--gt-muted)] sm:px-10">Loading&hellip;</main>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
          <p className="text-sm text-red-700">{phase.error}</p>
        </main>
      </div>
    );
  }

  const { report } = phase;
  const { appraisal, respondentCount } = report;
  const overallMean = report.themes.length
    ? report.themes.reduce((s, t) => s + t.mean, 0) / report.themes.length
    : 0;

  return (
    <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
        <p className="font-mono text-xs tracking-wide text-[var(--gt-muted)] uppercase">
          Consultant summary &mdash; not for the board
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--gt-ink)]">Board effectiveness summary</h1>
        {appraisal.asOf ? <p className="mt-2 text-sm text-[var(--gt-muted)]">{appraisal.asOf}</p> : null}

        {respondentCount === 0 ? (
          <p className="mt-8 max-w-[60ch] text-sm text-[var(--gt-muted)]">
            No directors have responded yet. Mint a link from the questionnaire page and
            come back once at least one response has been submitted.
          </p>
        ) : (
          <>
            {/* ---------------------------------------------------- executive summary */}
            <section className="mt-10">
              <h2 className="text-xl font-semibold text-[var(--gt-ink)]">Executive summary</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--gt-ink)]">
                {respondentCount} director{respondentCount === 1 ? "" : "s"} responded across{" "}
                {appraisal.questionCount} questions in {report.themes.length} themes, scoring an
                overall average of {overallMean.toFixed(1)} of 5. {report.strengths.length} question
                {report.strengths.length === 1 ? "" : "s"} stood out as a strength with clear
                supporting evidence; {report.concerns.length} scored below the midpoint with
                evidence attached and are set out as areas for attention below.
                {report.progressSincePreviousReview.length > 0
                  ? ` ${report.progressSincePreviousReview.length} question${report.progressSincePreviousReview.length === 1 ? "" : "s"} carry direct evidence of progress against the board's previous effectiveness review.`
                  : ""}
              </p>
            </section>

            {/* ------------------------------------------------ position by theme */}
            <section className="mt-12">
              <h2 className="text-xl font-semibold text-[var(--gt-ink)]">Overall position by theme</h2>
              <dl className="mt-4 divide-y divide-[var(--gt-hairline)] border-y border-[var(--gt-hairline)]">
                {report.themes.map((theme) => (
                  <div key={theme.name} className="py-4">
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="font-medium text-[var(--gt-ink)]">{theme.name}</dt>
                      <dd className="font-mono text-sm" style={{ color: BAND_COLOR[theme.band] }}>
                        {theme.mean.toFixed(1)} / 5 &mdash; {BAND_LABEL[theme.band]}
                      </dd>
                    </div>
                    <p className="mt-1 text-sm text-[var(--gt-muted)]">{themeCommentary(theme)}</p>
                  </div>
                ))}
              </dl>
            </section>

            {/* -------------------------------------------------------- strengths */}
            <section className="mt-12">
              <h2 className="text-xl font-semibold text-[var(--gt-ink)]">Strengths</h2>
              {report.strengths.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--gt-muted)]">
                  No question both scored highly and carried documented evidence this run.
                </p>
              ) : (
                <ul className="mt-4 flex flex-col gap-6">
                  {report.strengths.map((s) => (
                    <li key={s.id} className="text-sm">
                      <p className="font-medium text-[var(--gt-ink)]">
                        {s.text}{" "}
                        <span className="font-mono text-xs text-[var(--gt-muted)]">&mdash; {s.mean.toFixed(1)}/5</span>
                      </p>
                      {s.question.summary ? (
                        <p className="mt-1 text-[var(--gt-muted)]">{s.question.summary}</p>
                      ) : null}
                      {agreementNote(s.scores) ? (
                        <p className="mt-1 text-xs text-[var(--gt-muted)]">{agreementNote(s.scores)}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ------------------------------------------------ areas for attention */}
            <section className="mt-12">
              <h2 className="text-xl font-semibold text-[var(--gt-ink)]">Areas for attention</h2>
              {report.concerns.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--gt-muted)]">
                  No question both scored below the midpoint and carried documented evidence
                  this run.
                </p>
              ) : (
                <ul className="mt-4 flex flex-col gap-6">
                  {report.concerns.map((c) => (
                    <li key={c.id} className="text-sm">
                      <p className="font-medium text-[var(--gt-ink)]">
                        {c.text}{" "}
                        <span className="font-mono text-xs text-[var(--gt-muted)]">
                          &mdash; {c.mean.toFixed(1)}/5,{" "}
                          <span style={{ color: c.severity === "high" ? "var(--gt-amber)" : "var(--gt-muted)" }}>
                            {c.severity} severity
                          </span>
                        </span>
                      </p>
                      {c.question.summary ? (
                        <p className="mt-1 text-[var(--gt-muted)]">{c.question.summary}</p>
                      ) : null}
                      {agreementNote(c.scores) ? (
                        <p className="mt-1 text-xs text-[var(--gt-muted)]">{agreementNote(c.scores)}</p>
                      ) : null}
                      {c.question.sources?.map((src, i) => (
                        <EvidenceQuote
                          key={i}
                          quote={src.quote}
                          computed={src.computed}
                          document={src.document}
                          page={src.page}
                        />
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --------------------------------------------- progress since review */}
            <section className="mt-12">
              <h2 className="text-xl font-semibold text-[var(--gt-ink)]">Progress since the previous review</h2>
              {report.progressSincePreviousReview.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--gt-muted)]">
                  No question this run carried evidence directly tied to a previous review
                  recommendation.
                </p>
              ) : (
                <ul className="mt-4 flex flex-col gap-6">
                  {report.progressSincePreviousReview.map((q) => (
                    <li key={q.id} className="text-sm">
                      <p className="font-medium text-[var(--gt-ink)]">{q.text}</p>
                      {q.summary ? <p className="mt-1 text-[var(--gt-muted)]">{q.summary}</p> : null}
                      {q.sources?.map((src, i) => (
                        <EvidenceQuote
                          key={i}
                          quote={src.quote}
                          computed={src.computed}
                          document={src.document}
                          page={src.page}
                        />
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---------------------------------------------------------- action plan */}
            <section className="mt-12">
              <h2 className="text-xl font-semibold text-[var(--gt-ink)]">Action plan</h2>
              <p className="mt-2 max-w-[60ch] text-sm text-[var(--gt-muted)]">
                One row per area for attention above. Owner and timeframe are for the
                consultant to complete &mdash; nothing in the documents or the directors&apos;
                scores names who is responsible or by when, so nothing is guessed here.
              </p>
              {report.concerns.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--gt-muted)]">Nothing to plan against this run.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[40rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[var(--gt-border)] text-left">
                        <th className="py-2 pr-4 font-medium text-[var(--gt-ink)]">Action</th>
                        <th className="py-2 pr-4 font-medium text-[var(--gt-ink)]">Severity</th>
                        <th className="py-2 pr-4 font-medium text-[var(--gt-ink)]">Owner</th>
                        <th className="py-2 font-medium text-[var(--gt-ink)]">Timeframe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.concerns.map((c) => (
                        <tr key={c.id} className="border-b border-[var(--gt-hairline)] align-top">
                          <td className="py-3 pr-4 text-[var(--gt-ink)]">{c.text}</td>
                          <td
                            className="py-3 pr-4 capitalize"
                            style={{ color: c.severity === "high" ? "var(--gt-amber)" : "var(--gt-muted)" }}
                          >
                            {c.severity}
                          </td>
                          <td className="py-3 pr-4 text-[var(--gt-muted)]">&mdash;</td>
                          <td className="py-3 text-[var(--gt-muted)]">&mdash;</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* --------------------------------------------------------- appendix */}
            <section className="mt-12 border-t-2 border-[var(--gt-green)] pt-8">
              <h2 className="text-xl font-semibold text-[var(--gt-ink)]">Appendix: method and limitations</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--gt-muted)]">
                <li>
                  Evidence quotations are lifted verbatim from the client&apos;s own documents by
                  code, never typed by a model; computed figures are arithmetic over the
                  documents, not a model&apos;s estimate.
                </li>
                <li>
                  A question with no evidence found is not evidence of a problem &mdash; it means
                  nothing in the supplied documents addressed it, which the questionnaire
                  states plainly rather than guessing at a document type that would have.
                </li>
                <li>
                  Scores are director self-assessment on a five-point scale, aggregated here
                  as an unweighted mean per question and per theme. A theme with few
                  respondents or a wide spread of scores carries more uncertainty than this
                  summary shows on its own.
                </li>
                <li>
                  Strengths and areas for attention are shown only where a question both
                  scored outside the midpoint and carried documented evidence &mdash; a low score
                  with no evidence, or evidence with a middling score, is visible in the full
                  questionnaire but not singled out here.
                </li>
                <li>
                  This summary reflects {respondentCount} response{respondentCount === 1 ? "" : "s"} at
                  the time it was generated. Reopening this page recomputes it from whoever has
                  responded by then.
                </li>
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
