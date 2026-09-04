"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Appraisal, AppraisalStatus } from "@/lib/appraisal";
import { AppraisalView } from "./appraisal-view";
import { SiteHeader } from "./site-header";

type Phase =
  | { kind: "idle" }
  | { kind: "queued" }
  | { kind: "running"; step: string; done: number; total: number }
  | { kind: "ready"; appraisal: Appraisal }
  | { kind: "failed"; error: string };

const POLL_MS = 2000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What actually makes this tool different, one honest line at a time — not a game, but
 * something quiet to read during the four minutes a run takes. Every line is a real
 * product principle (see PRODUCT.md), not a joke or a fact made up to fill the space.
 */
const WAITING_NOTES = [
  "Every figure is arithmetic over your documents — never a guess.",
  "A missing document becomes an honest “not found,” never a zero.",
  "Every quotation is lifted verbatim from the page it came from.",
  "Questions are selected for what the organisation is, not what’s easy to answer.",
  "The same documents will always produce the same questionnaire.",
  "A previous review’s recommendations are quotable — its conclusions are not.",
];

function WaitingNotes() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % WAITING_NOTES.length), 4500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mt-8 border-t border-[var(--gt-hairline)] pt-5">
      <p className="text-xs font-medium tracking-wide text-[var(--gt-muted)] uppercase">While you wait</p>
      <p key={index} className="gt-fade mt-2 text-sm text-[var(--gt-ink)]">
        {WAITING_NOTES[index]}
      </p>
    </div>
  );
}

/**
 * Wrapped in Suspense because `useSearchParams` makes the tree below it client-rendered.
 * Without the boundary Next has to give up prerendering the whole route.
 */
export default function Home() {
  return (
    <Suspense fallback={null}>
      <Appraiser />
    </Suspense>
  );
}

function Appraiser() {
  /**
   * An appraisal can be revisited by id. The id is the cache key, so the same documents
   * always produce the same link — a consultant can send it on, or come back after the
   * four minute first run instead of holding the tab open.
   *
   * Read with `useSearchParams` rather than `window.location`. Reading `window` in the
   * initial state hydrates wrong — the server has no window and renders the idle screen
   * while the client renders the polling screen — and reading it in an effect triggers a
   * cascading render the React compiler rejects. This hook is the one that is correct in
   * both directions.
   */
  const idFromUrl = useSearchParams().get("id");

  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>(idFromUrl ? { kind: "queued" } : { kind: "idle" });
  const [id, setId] = useState<string | null>(idFromUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = phase.kind === "queued" || phase.kind === "running";

  useEffect(() => {
    if (!id || !busy) return;
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/status?id=${encodeURIComponent(id ?? "")}`);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const status = (await response.json()) as AppraisalStatus;
        if (cancelled) return;
        if (status.state === "queued") setPhase({ kind: "queued" });
        else if (status.state === "running")
          setPhase({
            kind: "running",
            step: status.step,
            done: status.done,
            total: status.total,
          });
        else if (status.state === "ready")
          setPhase({ kind: "ready", appraisal: status.appraisal });
        else setPhase({ kind: "failed", error: status.error });
      } catch {
        if (!cancelled) {
          setPhase({
            kind: "failed",
            error: "Lost contact with the server while the appraisal was running.",
          });
        }
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, busy]);

  const start = useCallback(async () => {
    if (files.length === 0 || busy) return;
    setPhase({ kind: "queued" });
    setId(null);
    try {
      const body = new FormData();
      for (const file of files) body.append("files", file);
      const response = await fetch("/api/analyse", { method: "POST", body });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "The upload was refused.";
        setPhase({ kind: "failed", error: message });
        return;
      }
      const runId =
        typeof data === "object" && data !== null && "id" in data
          ? String((data as { id: unknown }).id)
          : null;
      if (!runId) {
        setPhase({ kind: "failed", error: "The server did not return a run to follow." });
        return;
      }
      setId(runId);
      // Put it in the URL so the run survives a reload of a four minute job.
      window.history.replaceState(null, "", `?id=${encodeURIComponent(runId)}`);
    } catch {
      setPhase({ kind: "failed", error: "Could not reach the server." });
    }
  }, [files, busy]);

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function reset() {
    setFiles([]);
    setId(null);
    setPhase({ kind: "idle" });
    window.history.replaceState(null, "", window.location.pathname);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (phase.kind === "ready") {
    return (
      <main>
        <AppraisalView appraisal={phase.appraisal} exportId={id ?? undefined} />
        {/* Sits directly under AppraisalView's own full-bleed brand background, so it
            borrows those tokens rather than the app's default boilerplate. */}
        <div className="gt-brand pb-16" style={{ background: "var(--gt-page)" }}>
          <div className="mx-auto max-w-6xl px-6 sm:px-10">
            <button
              type="button"
              onClick={reset}
              className="cursor-pointer text-sm font-medium text-[var(--gt-green)] hover:underline"
            >
              Start again with different documents
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
      <SiteHeader current="home" />
      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <h1 className="text-3xl font-semibold text-[var(--gt-ink)]">Start a new appraisal</h1>
        <p className="mt-2 text-sm text-[var(--gt-muted)]">
          Upload the client&rsquo;s governance documents &mdash; board pack, risk register,
          calendar, and previous review &mdash; and groundtruth reads them for what they show,
          computes what can be counted, and builds a bespoke questionnaire with every fact
          traced back to its source.
        </p>

        <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-stretch">
          {/* Left: pick documents, see them as cards, run. */}
          <div className="flex flex-col">
            <div className="rounded-2xl border-2 border-dashed border-[var(--gt-border)] bg-white/40 p-5">
              <label
                htmlFor="documents"
                className={`inline-block rounded-full border border-[var(--gt-green)] px-5 py-2.5 text-sm font-medium text-[var(--gt-green)] transition-colors ${
                  busy ? "pointer-events-none opacity-40" : "cursor-pointer hover:bg-[var(--gt-nav-active)]"
                }`}
              >
                Choose PDF documents
              </label>
              <input
                id="documents"
                ref={inputRef}
                type="file"
                multiple
                accept="application/pdf,.pdf"
                disabled={busy}
                className="sr-only"
                onChange={(event) => {
                  setFiles(Array.from(event.target.files ?? []));
                  setPhase({ kind: "idle" });
                }}
              />

              {/* Fixed height regardless of how many files are picked (0 or 10): the page
                  itself never grows or shrinks with the document count, only this list
                  scrolls internally past a few files. */}
              <div className="mt-3 h-56 overflow-y-auto pr-1">
                {files.length === 0 ? (
                  <p className="text-sm text-[var(--gt-muted)]">No documents selected yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {files.map((file, index) => (
                      <li
                        key={`${file.name}-${file.size}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--gt-border)] bg-white/70 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <p
                            className="truncate font-mono text-xs text-[var(--gt-ink)]"
                            title={file.name}
                          >
                            {file.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[var(--gt-muted)]">{formatBytes(file.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(index)}
                          disabled={busy}
                          aria-label={`Remove ${file.name}`}
                          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--gt-muted)] transition-colors hover:bg-[var(--gt-hairline)] hover:text-[var(--gt-ink)] disabled:pointer-events-none disabled:opacity-0"
                        >
                          &times;
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={files.length === 0 || busy}
                  className="cursor-pointer rounded-full bg-[var(--gt-green)] px-5 py-2.5 text-sm font-medium text-[var(--gt-cream)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Run the appraisal
                </button>
              </div>
            </div>

            {phase.kind === "failed" ? (
              <div className="mt-6" role="alert">
                <p className="text-sm text-[var(--gt-ink)]">{phase.error}</p>
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={files.length === 0}
                  className="mt-2 cursor-pointer text-sm font-medium text-[var(--gt-green)] hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>

          {/* Right: progress while it runs — otherwise a quiet placeholder. */}
          <div className="rounded-2xl border border-[var(--gt-hairline)] bg-white/40 p-6 lg:h-full">
            {busy ? (
              <div aria-live="polite">
                <p className="text-sm font-medium text-[var(--gt-ink)]">
                  {phase.kind === "queued" ? "Queued." : phase.step}
                </p>
                {phase.kind === "running" ? (
                  <>
                    <p className="mt-2 text-sm text-[var(--gt-muted)]">
                      Step {phase.done} of {phase.total}
                    </p>
                    <div
                      className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--gt-hairline)]"
                      role="progressbar"
                      aria-valuenow={phase.done}
                      aria-valuemin={0}
                      aria-valuemax={phase.total}
                    >
                      <div
                        className="h-full rounded-full bg-[var(--gt-green)] transition-[width]"
                        style={{
                          width:
                            phase.total > 0
                              ? `${Math.round((phase.done / phase.total) * 100)}%`
                              : "0%",
                        }}
                      />
                    </div>
                  </>
                ) : null}
                <p className="mt-4 text-sm text-[var(--gt-muted)]">
                  A run takes about four minutes. You can leave this page open.
                </p>
                <WaitingNotes />
              </div>
            ) : (
              <p className="text-sm text-[var(--gt-muted)]">
                Once you run the appraisal, progress shows here.
              </p>
            )}
          </div>
        </div>
      </main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 sm:px-10">
        <a href="/present" className="text-xs text-[var(--gt-muted)] hover:text-[var(--gt-ink)]">
          Presentation
        </a>
      </footer>
    </div>
  );
}
