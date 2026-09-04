"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "./site-header";
import { toReportId } from "@/lib/report-id";
import type {
  Appraisal,
  AppraisalQuestion,
  AppraisalTheme,
  EvidenceQuote,
} from "@/lib/appraisal";

const CONSULTANT_NOTES_ID = "consultant-notes";

/** A theme name is already a unique, url-safe word ("Resources", "Competency", …). */
function themeId(name: string): string {
  return name.toLowerCase();
}

/**
 * Which section is under the reading line right now, for the theme rail. Pure navigation
 * state — it never touches an answer or a figure, so losing it on reload costs nothing.
 */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids is a fixed list per appraisal
  }, [ids.join(",")]);

  return active;
}

/** The theme index: sticky, tracks scroll position, jumps to the consultant notes too. */
function Rail({ appraisal, active }: { appraisal: Appraisal; active: string }) {
  return (
    <nav aria-label="Sections" className="hidden shrink-0 basis-56 self-start lg:sticky lg:top-8 lg:block">
      <ul>
        {appraisal.themes.map((theme) => {
          const id = themeId(theme.name);
          const isActive = active === id;
          return (
            <li key={theme.name}>
              <a
                href={`#${id}`}
                className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-[var(--gt-nav-active)] font-medium text-[var(--gt-green)]"
                    : "text-[var(--gt-muted)] hover:bg-[var(--gt-nav-active)]/60"
                }`}
              >
                <span>{theme.name}</span>
                <span>{theme.questions.length}</span>
              </a>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 border-t border-[var(--gt-hairline)] px-3 pt-4">
        <a
          href={`#${CONSULTANT_NOTES_ID}`}
          className={`text-sm ${
            active === CONSULTANT_NOTES_ID ? "font-medium text-[var(--gt-green)]" : "text-[var(--gt-muted)]"
          }`}
        >
          Consultant notes
        </a>
      </div>
    </nav>
  );
}

/**
 * Mint a director's link and put it on the clipboard.
 *
 * One click, one link, no email sending here — the consultant pastes it themselves.
 * Minting again gives a NEW token every time rather than reusing one, deliberately: a
 * link is cheap to create and this keeps "who has a working link" simple to reason
 * about, at the cost of an old copied link and a freshly copied one both remaining
 * valid. Revoking a specific link is not built; deleting the appraisal itself (from
 * "Previous questionnaires") invalidates every link to it, since `/api/respond` refuses
 * a token whose appraisal no longer exists.
 */
function DirectorLink({ appraisalId }: { appraisalId: string }) {
  const [state, setState] = useState<"idle" | "minting" | "copied" | "failed">("idle");
  /**
   * Default false: a director's default view says nothing about why a question has no
   * evidence, because stating it plainly before they have answered reads as the tool
   * arguing a case rather than asking one. This is per link, not a global setting — a
   * consultant can choose the plain-statement wording for a specific audience without
   * changing what any other link shows.
   */
  const [showAbsence, setShowAbsence] = useState(false);

  async function mint() {
    setState("minting");
    try {
      const response = await fetch("/api/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appraisalId, showAbsence }),
      });
      const body = (await response.json()) as { token?: string };
      if (!response.ok || !body.token) throw new Error();
      const url = `${window.location.origin}/respond/${body.token}`;
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void mint()}
        disabled={state === "minting"}
        className="cursor-pointer rounded-full bg-[var(--gt-green)] px-5 py-2.5 text-sm font-medium text-[var(--gt-cream)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "copied"
          ? "Link copied"
          : state === "failed"
            ? "Could not create a link — try again"
            : state === "minting"
              ? "Creating link…"
              : "Copy a link for a director"}
      </button>
      {/* w-full forces this onto its own line in the flex-wrap row above, so it sits
          beneath both buttons rather than tucked under just this one. */}
      <label className="mt-1 flex w-full cursor-pointer items-center gap-2.5 text-sm text-[var(--gt-muted)]">
        <input
          type="checkbox"
          checked={showAbsence}
          onChange={(e) => setShowAbsence(e.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-[var(--gt-green)]"
        />
        <span>Tell directors when a question has no evidence, instead of asking it silently</span>
      </label>
    </>
  );
}

/**
 * "board calendar" becomes "Board calendar" for the start of a sentence.
 *
 * The pipeline sends a document type, not a sentence, because the interface should not
 * be inventing copy. Capitalising the first letter is the smallest thing that reads as
 * English without becoming a judgement about wording.
 */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "bramblewood-board-pack.pdf, p. 2" — or, for a figure computed across the whole corpus
 * rather than quoted from one document, "Computed from your documents". Shared between
 * the collapsed summary (the citation is legible without opening anything) and the quote
 * itself once opened.
 */
function citationLabel(source: EvidenceQuote): string {
  return source.computed ? "Computed from your documents" : `${source.document}, p. ${source.page}`;
}

/** One quotation, verbatim from the documents, with the page it came from. */
function Quote({ source }: { source: EvidenceQuote }) {
  return (
    <div className="mt-3 rounded-lg bg-[var(--gt-nav-active)] px-4 py-3">
      <blockquote className="text-sm leading-relaxed text-[var(--gt-ink)] italic">
        &ldquo;{source.quote}&rdquo;
      </blockquote>
      <p className="mt-2 font-mono text-xs text-[var(--gt-muted)] not-italic">
        {citationLabel(source)}
        {source.manual ? (
          <span className="ml-2 rounded-full bg-[var(--gt-green)] px-2 py-0.5 text-[10px] font-medium text-[var(--gt-cream)] not-italic">
            Added by consultant
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Add one quotation by hand, checked against the real document before it is accepted.
 *
 * Deliberately not a free-text "add a finding" box. It only ever accepts a document, a
 * page and a quotation, because the server checks that exact triple against the page
 * text stored when the run finished (`/api/manual-evidence`) — a quote that does not
 * genuinely appear there is refused, not saved with a caveat. This is consultant-only:
 * never rendered on `/respond`.
 */
function AddEvidence({
  appraisalId,
  questionId,
  documents,
  onAdded,
}: {
  appraisalId: string;
  questionId: string;
  documents: Appraisal["documents"];
  onAdded: (source: EvidenceQuote) => void;
}) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState(documents[0]?.filename ?? "");
  const [page, setPage] = useState("");
  const [quote, setQuote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      const response = await fetch("/api/manual-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appraisalId, questionId, document, page: Number(page), quote }),
      });
      const body = (await response.json()) as { question?: AppraisalQuestion; error?: string };
      if (!response.ok || !body.question) {
        setState("failed");
        setError(body.error ?? "Could not add that evidence.");
        return;
      }
      const added = body.question.sources?.at(-1);
      if (added) onAdded(added);
      setQuote("");
      setPage("");
      setState("idle");
      setOpen(false);
    } catch {
      setState("failed");
      setError("Could not reach the server.");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 cursor-pointer text-xs font-medium text-[var(--gt-green)] hover:underline"
      >
        + Add evidence by hand
      </button>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 rounded-lg border border-[var(--gt-border)] p-4">
      <p className="text-xs text-[var(--gt-muted)]">
        Checked against the document before it is added — it must appear on the page exactly as written.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <select
          value={document}
          onChange={(e) => setDocument(e.target.value)}
          className="rounded border border-[var(--gt-border)] px-2 py-1.5 text-sm text-[var(--gt-ink)]"
        >
          {documents.map((d) => (
            <option key={d.filename} value={d.filename}>
              {d.filename}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          placeholder="Page"
          value={page}
          onChange={(e) => setPage(e.target.value)}
          required
          className="w-20 rounded border border-[var(--gt-border)] px-2 py-1.5 text-sm text-[var(--gt-ink)]"
        />
      </div>
      <textarea
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
        placeholder="Paste the exact words from the document"
        required
        rows={3}
        className="mt-3 w-full rounded border border-[var(--gt-border)] px-3 py-2 text-sm text-[var(--gt-ink)]"
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 flex gap-3">
        <button
          type="submit"
          disabled={state === "saving" || !page || quote.trim().length < 20}
          className="cursor-pointer rounded-full bg-[var(--gt-green)] px-4 py-2 text-sm font-medium text-[var(--gt-cream)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "saving" ? "Checking…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="cursor-pointer text-sm text-[var(--gt-muted)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The five-point scale. A fixed 5-column grid from `sm:` up rather than wrapping flex
 * pills — flex-wrap let the row break unevenly (four pills on one line, the fifth alone on
 * the next) the moment the widest label didn't fit, which happened often enough at
 * ordinary widths to be the normal case rather than an edge one. A grid keeps all five on
 * one row; a long label wraps its own two lines inside its own cell instead of displacing
 * a sibling. Below `sm:`, five squeezed columns are worse than one column stacked — the
 * grid collapses to a single column instead.
 */
function Scale({ question }: { question: AppraisalQuestion }) {
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
              value={index + 1}
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
  appraisalId,
  documents,
  onEvidenceAdded,
}: {
  question: AppraisalQuestion;
  number: number;
  /** Present only when a real appraisal id is available — absent on the dev fixture. */
  appraisalId?: string;
  documents: Appraisal["documents"];
  onEvidenceAdded: (questionId: string, source: EvidenceQuote) => void;
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
            {/* Stays closed regardless of whether a paraphrase exists above it: the quote
                itself is subordinate until a director asks for it, with no exception. The
                citation is not the argument, only where to check it, so it stays legible
                on the toggle without opening anything. */}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-[var(--gt-green)]">
                <span className="font-medium">
                  {question.summary ? "Show the evidence this rests on" : "Show the evidence"}
                </span>{" "}
                <span className="font-mono text-xs text-[var(--gt-muted)]">
                  &mdash; {question.sources.map(citationLabel).join("; ")}
                </span>
              </summary>
              {question.sources.map((source, index) => (
                <Quote key={`${source.document}-${source.page}-${index}`} source={source} />
              ))}
            </details>
          </div>
        ) : (
          // Private to this consultant view. A director's default link says nothing about
          // why a question has no evidence — see DirectorLink's showAbsence toggle — so
          // this note only ever reaches the person deciding whether to send that link.
          <p className="mt-3 text-sm text-[var(--gt-muted)]">
            <span className="font-medium text-[var(--gt-ink)]">Consultant only —</span> no evidence found
            in the documents provided.
            {question.missingDocument
              ? ` ${sentenceCase(question.missingDocument)} would usually cover this.`
              : ""}
          </p>
        )}

        {appraisalId ? (
          <AddEvidence
            appraisalId={appraisalId}
            questionId={question.id}
            documents={documents}
            onAdded={(source) => onEvidenceAdded(question.id, source)}
          />
        ) : null}

        <Scale question={question} />
      </div>
    </li>
  );
}

function ThemeSection({
  theme,
  startNumber,
  appraisalId,
  documents,
  onEvidenceAdded,
}: {
  theme: AppraisalTheme;
  startNumber: number;
  appraisalId?: string;
  documents: Appraisal["documents"];
  onEvidenceAdded: (questionId: string, source: EvidenceQuote) => void;
}) {
  return (
    <section id={themeId(theme.name)} className="mt-14 scroll-mt-8">
      <h2 className="text-2xl font-semibold text-[var(--gt-ink)]">{theme.name}</h2>
      <p className="mt-1 text-sm text-[var(--gt-muted)]">{theme.questions.length} questions</p>
      <ol className="mt-2">
        {theme.questions.map((question, index) => (
          <Question
            key={question.id}
            question={question}
            number={startNumber + index}
            appraisalId={appraisalId}
            documents={documents}
            onEvidenceAdded={onEvidenceAdded}
          />
        ))}
      </ol>
    </section>
  );
}

function Basis({ appraisal }: { appraisal: Appraisal }) {
  const rows: [string, number][] = [
    ["Questions", appraisal.questionCount],
    ["With evidence", appraisal.counts.evidenced],
    ["Standard", appraisal.counts.standard],
  ];
  return (
    <dl className="mt-6 divide-y divide-[var(--gt-hairline)] border-y border-[var(--gt-hairline)] text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between py-2">
          <dt className="text-[var(--gt-muted)]">{label}</dt>
          <dd className="font-mono text-[var(--gt-ink)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Summary({ appraisal }: { appraisal: Appraisal }) {
  return (
    <header>
      <h1 className="text-3xl font-semibold text-[var(--gt-ink)]">Board appraisal questionnaire</h1>
      {appraisal.asOf ? <p className="mt-2 text-sm text-[var(--gt-muted)]">{appraisal.asOf}</p> : null}

      <Basis appraisal={appraisal} />

      <div className="mt-6 text-sm">
        <h2 className="text-xs font-medium tracking-wide text-[var(--gt-muted)] uppercase">
          Documents examined
        </h2>
        <ul className="mt-2 divide-y divide-[var(--gt-hairline)]">
          {appraisal.documents.map((document) => (
            <li key={document.filename} className="flex items-baseline justify-between gap-4 py-2">
              <span className="font-mono text-xs break-all text-[var(--gt-ink)]">{document.filename}</span>
              <span className="shrink-0 text-xs text-[var(--gt-muted)]">
                {document.pages} pp &middot; {document.type}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {appraisal.cached ? (
        <p className="mt-4 text-xs text-[var(--gt-muted)]">Returned from the cache rather than a fresh run.</p>
      ) : null}
    </header>
  );
}

function ConsultantSection({ appraisal }: { appraisal: Appraisal }) {
  return (
    <section id={CONSULTANT_NOTES_ID} className="mt-20 scroll-mt-8 border-t-2 border-[var(--gt-green)] pt-8">
      <h2 className="text-2xl font-semibold text-[var(--gt-ink)]">Consultant working notes</h2>
      <p className="mt-2 max-w-[60ch] text-sm text-[var(--gt-muted)]">
        Not part of the questionnaire and not for the board. Everything below is here so
        you can check the tool before you put your name to it.
      </p>

      <h3 className="mt-10 text-xs font-medium tracking-wide text-[var(--gt-muted)] uppercase">
        Computed figures
      </h3>
      <p className="mt-2 max-w-[60ch] text-sm text-[var(--gt-muted)]">
        Each figure was calculated in code from the documents, not written by a model.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--gt-border)] text-left">
              <th className="py-2 pr-4 font-medium text-[var(--gt-ink)]">Figure</th>
              <th className="py-2 pr-4 font-medium text-[var(--gt-ink)]">Value</th>
              <th className="py-2 pr-4 font-medium text-[var(--gt-ink)]">Page</th>
              <th className="py-2 pr-4 font-medium text-[var(--gt-ink)]">Method</th>
              <th className="py-2 font-medium text-[var(--gt-ink)]">Notable</th>
            </tr>
          </thead>
          <tbody>
            {appraisal.figures.map((figure) => (
              <tr key={figure.key} className="border-b border-[var(--gt-hairline)] align-top">
                <td className="py-3 pr-4 text-[var(--gt-ink)]">{figure.name}</td>
                <td className="py-3 pr-4 font-mono whitespace-nowrap text-[var(--gt-ink)]">
                  {figure.value === null ? "Not stated" : `${figure.value} ${figure.unit}`}
                </td>
                <td className="py-3 pr-4 font-mono text-[var(--gt-ink)]">
                  {figure.page === null ? "—" : figure.page}
                </td>
                <td className="py-3 pr-4 text-[var(--gt-muted)]">
                  {figure.method}
                  <span className="mt-1 block font-mono text-xs">{figure.source}</span>
                </td>
                <td className="py-3 text-[var(--gt-ink)]">{figure.notable ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AppraisalView({
  appraisal: initial,
  exportId,
}: {
  appraisal: Appraisal;
  /** The job id, so the questionnaire can be downloaded as a .docx a director marks up. */
  exportId?: string;
}) {
  // Lifted into state purely so a manually-added quotation appears the moment the server
  // confirms it, without a full reload — the prop is only ever the seed. `/api/manual-
  // evidence` is the actual source of truth; this mirrors what it already accepted.
  const [appraisal, setAppraisal] = useState(initial);

  function handleEvidenceAdded(questionId: string, source: EvidenceQuote) {
    setAppraisal((prev) => ({
      ...prev,
      themes: prev.themes.map((theme) => ({
        ...theme,
        questions: theme.questions.map((q) =>
          q.id === questionId ? { ...q, state: "evidenced", sources: [...(q.sources ?? []), source] } : q,
        ),
      })),
    }));
  }

  const startNumbers = appraisal.themes.reduce<number[]>(
    (acc, theme, index) => [...acc, (acc[index - 1] ?? 1) + (appraisal.themes[index - 1]?.questions.length ?? 0)],
    [],
  );

  const sectionIds = [...appraisal.themes.map((theme) => themeId(theme.name)), CONSULTANT_NOTES_ID];
  const active = useActiveSection(sectionIds);

  return (
    <div className="gt-brand min-h-full" style={{ background: "var(--gt-page)" }}>
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-6 py-12 sm:px-10 lg:flex lg:items-start lg:gap-12">
        <Rail appraisal={appraisal} active={active} />

        <div className="min-w-0 flex-1">
          <Summary appraisal={appraisal} />

          {exportId ? (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <a
                href={`/api/export?id=${encodeURIComponent(exportId)}`}
                className="cursor-pointer rounded-full border border-[var(--gt-green)] px-5 py-2.5 text-sm font-medium text-[var(--gt-green)] transition-colors hover:bg-[var(--gt-nav-active)]"
              >
                Download as a Word document
              </a>
              <a
                href={`/report/${toReportId(exportId)}`}
                className="cursor-pointer rounded-full border border-[var(--gt-green)] px-5 py-2.5 text-sm font-medium text-[var(--gt-green)] transition-colors hover:bg-[var(--gt-nav-active)]"
              >
                Go to summary
              </a>
              <DirectorLink appraisalId={exportId} />
            </div>
          ) : null}

          {appraisal.themes.map((theme, index) => (
            <ThemeSection
              key={theme.name}
              theme={theme}
              startNumber={startNumbers[index] ?? 1}
              appraisalId={exportId}
              documents={appraisal.documents}
              onEvidenceAdded={handleEvidenceAdded}
            />
          ))}

          <ConsultantSection appraisal={appraisal} />
        </div>
      </div>
    </div>
  );
}
