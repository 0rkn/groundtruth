"use client";

/**
 * What a director actually opens: the questionnaire, read-only text and evidence, with
 * the five-point scale to answer and a single submit action.
 *
 * Deliberately NOT `AppraisalView` reused wholesale — that page carries the consultant's
 * own working notes (computed figures, detected signals), a document-export link, and a
 * navigation rail, none of which belongs in front of a director. This is a narrower view
 * built for the one thing a director does here: read the evidence, answer, submit. The
 * narrower LAYOUT is deliberate; the visual design (tokens, spacing, component styling)
 * uses the same `gt-*` system as the consultant's view rather than an unmigrated one, so
 * the two pages read as one product rather than two.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Appraisal, AppraisalQuestion } from "@/lib/appraisal";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; appraisal: Appraisal; answers: Record<string, number>; showAbsence: boolean }
  | { kind: "submitted" }
  | { kind: "failed"; error: string };

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The five-point scale. A fixed 5-column grid from `sm:` up, not wrapping flex pills — see
 * `Scale` in `appraisal-view.tsx` for why: flex-wrap broke the row unevenly (four pills on
 * one line, the fifth alone underneath) whenever the widest label didn't fit, which was
 * the normal case at ordinary widths, not an edge one. Below `sm:` the grid stacks to one
 * column instead of squeezing five.
 */
function Scale({
  question,
  value,
  onChange,
}: {
  question: AppraisalQuestion;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <fieldset className="mt-4">
      <legend className="sr-only">Your answer to {question.id}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {question.scaleLabels.map((label, index) => (
          <label
            key={label}
            className="flex cursor-pointer items-center justify-center rounded-lg border border-[var(--gt-border)] px-2 py-2 text-center text-xs leading-tight text-[var(--gt-ink)] transition-colors has-[:checked]:border-[var(--gt-green)] has-[:checked]:bg-[var(--gt-green)] has-[:checked]:text-[var(--gt-cream)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--gt-green)] has-[:focus-visible]:ring-offset-2 sm:px-3 sm:text-sm"
          >
            <input
              type="radio"
              name={`answer-${question.id}`}
              checked={value === index + 1}
              onChange={() => onChange(index + 1)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Question({
  question,
  number,
  value,
  onChange,
  showAbsence,
}: {
  question: AppraisalQuestion;
  number: number;
  value: number | undefined;
  onChange: (value: number) => void;
  /**
   * Whether this LINK tells a director when a question has no evidence. The default is
   * false: a question with nothing found is still asked, still scored, but nothing is
   * said about why — saying "we found no documentation covering this" before a director
   * has answered reads as the tool building a case rather than asking one. Set per link
   * by the consultant who minted it, not a global switch.
   */
  showAbsence: boolean;
}) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3 border-t border-[var(--gt-hairline)] py-7">
      <span className="pt-0.5 text-right font-mono text-xs text-[var(--gt-muted)]">
        {String(number).padStart(2, "0")}
      </span>
      <div>
        <p className="text-base leading-relaxed text-[var(--gt-ink)]">{question.text}</p>

        {question.state === "evidenced" && question.sources?.length ? (
          <div className="mt-3">
            {question.summary ? (
              <p className="text-sm leading-relaxed text-[var(--gt-ink)]">{question.summary}</p>
            ) : null}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-[var(--gt-green)]">
                <span className="font-medium">
                  {question.summary ? "Show the evidence this rests on" : "Show the evidence"}
                </span>
              </summary>
              {question.sources.map((source, index) => (
                <div
                  key={`${source.document}-${source.page}-${index}`}
                  className="mt-3 rounded-lg bg-[var(--gt-nav-active)] px-4 py-3"
                >
                  <blockquote className="text-sm leading-relaxed text-[var(--gt-ink)] italic">
                    &ldquo;{source.quote}&rdquo;
                  </blockquote>
                  <p className="mt-2 font-mono text-xs text-[var(--gt-muted)] not-italic">
                    {source.computed ? "Computed from the documents" : `${source.document}, page ${source.page}`}
                  </p>
                </div>
              ))}
            </details>
          </div>
        ) : showAbsence ? (
          <p className="mt-3 text-sm text-[var(--gt-muted)]">
            No evidence found in the documents provided.
            {question.missingDocument ? ` ${sentenceCase(question.missingDocument)} would usually cover this.` : ""}
          </p>
        ) : null}

        <Scale question={question} value={value} onChange={onChange} />
      </div>
    </li>
  );
}

/**
 * The id that makes this browser's submission its own, distinct from anyone else who
 * opens the same link. A consultant shares one link with a whole board, the way a Google
 * Form link works — the token alone can no longer BE the answer record (see
 * `app/api/respond/route.ts`), or a second director opening it would overwrite the first.
 *
 * `localStorage`, not a cookie or the server: this only ever needs to survive reloads of
 * the SAME link on the SAME browser, never to be readable by the server on first request,
 * and never to follow a person across devices — that would need real sign-in, which this
 * product deliberately doesn't have for a director.
 */
function responseIdFor(token: string): string {
  const key = `gt-respond-id:${token}`;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const fresh = crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // Private browsing, storage disabled, or similar — fall back to a one-visit id. Submit
    // still works; only "come back later and see it's already in" stops working for them.
    return crypto.randomUUID().replace(/-/g, "");
  }
}

export default function Respond() {
  // Decoded defensively for the same reason as the report page's id — tokens are
  // base64url today (no characters that need encoding) so this is a no-op in practice,
  // but it costs nothing to not depend on that staying true.
  const token = decodeURIComponent(useParams().token as string);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const responseId = responseIdFor(token);
        const response = await fetch(
          `/api/respond?token=${encodeURIComponent(token)}&response=${encodeURIComponent(responseId)}`,
        );
        const body = (await response.json()) as {
          appraisal?: Appraisal;
          answers?: Record<string, number>;
          showAbsence?: boolean;
          submitted?: boolean;
          error?: string;
        };
        if (!response.ok || !body.appraisal) {
          setPhase({ kind: "failed", error: body.error ?? "This link did not work." });
          return;
        }
        if (body.submitted) {
          setPhase({ kind: "submitted" });
          return;
        }
        setPhase({ kind: "ready", appraisal: body.appraisal, answers: body.answers ?? {}, showAbsence: body.showAbsence ?? false });
      } catch {
        setPhase({ kind: "failed", error: "Could not reach the server." });
      }
    })();
  }, [token]);

  async function submit() {
    if (phase.kind !== "ready") return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/respond", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, response: responseIdFor(token), answers: phase.answers }),
      });
      if (!response.ok) throw new Error();
      setPhase({ kind: "submitted" });
    } catch {
      setPhase({ kind: "failed", error: "Could not submit your answers. Nothing was lost — try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === "loading") {
    return (
      <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
        <main className="mx-auto max-w-3xl px-6 py-16 text-sm text-[var(--gt-muted)] sm:px-10">Loading&hellip;</main>
      </div>
    );
  }

  if (phase.kind === "failed") {
    return (
      <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
        <main className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
          <p className="text-sm text-red-700">{phase.error}</p>
        </main>
      </div>
    );
  }

  if (phase.kind === "submitted") {
    return (
      <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
        <main className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
          <h1 className="text-3xl font-semibold text-[var(--gt-ink)]">Thank you</h1>
          <p className="mt-2 text-sm text-[var(--gt-muted)]">Your answers have been recorded.</p>
        </main>
      </div>
    );
  }

  const { appraisal, answers, showAbsence } = phase;
  const total = appraisal.questionCount;
  const answered = Object.keys(answers).length;

  const allQuestions = appraisal.themes.flatMap((t) => t.questions);
  const numberOf = new Map(allQuestions.map((q, i) => [q.id, i + 1]));

  return (
    <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
      <main className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
        <h1 className="text-3xl font-semibold text-[var(--gt-ink)]">Board appraisal questionnaire</h1>
        {appraisal.asOf ? <p className="mt-2 text-sm text-[var(--gt-muted)]">{appraisal.asOf}</p> : null}
        <p className="mt-4 text-sm text-[var(--gt-muted)]">
          {answered} of {total} answered
        </p>

        {appraisal.themes.map((theme) => (
          <section key={theme.name} className="mt-16">
            <h2 className="text-2xl font-semibold text-[var(--gt-ink)]">{theme.name}</h2>
            <ol className="mt-4">
              {theme.questions.map((question) => (
                <Question
                  key={question.id}
                  question={question}
                  number={numberOf.get(question.id) ?? 0}
                  value={answers[question.id]}
                  showAbsence={showAbsence}
                  onChange={(value) =>
                    setPhase({ kind: "ready", appraisal, answers: { ...answers, [question.id]: value }, showAbsence })
                  }
                />
              ))}
            </ol>
          </section>
        ))}

        <div className="mt-10 border-t border-[var(--gt-hairline)] pt-8">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || answered < total}
            className="cursor-pointer rounded-full bg-[var(--gt-green)] px-5 py-2.5 text-sm font-medium text-[var(--gt-cream)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit my answers"}
          </button>
          {answered < total ? (
            <p className="mt-2 text-xs text-[var(--gt-muted)]">
              Answer every question before submitting — {total - answered} left.
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
