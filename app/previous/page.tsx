"use client";

/**
 * Previous questionnaires: reopen one, or delete it to force a fresh run.
 *
 * Exists because testing a change means uploading the same documents repeatedly and
 * wanting to see a run disappear from the cache — before this, that meant asking someone
 * to run a script by hand. See `/api/history` for why this list needs no index of its
 * own: it reads the same job records the running page already writes.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "../site-header";
import { toReportId } from "@/lib/report-id";

interface HistoryEntry {
  id: string;
  startedAt: number;
  asOf: string | null;
  documents: string[];
  questionCount: number;
  evidenced: number;
  respondentCount: number;
}

export default function PreviousQuestionnaires() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/history");
        if (!response.ok) throw new Error("Could not reach the server.");
        const body = (await response.json()) as { entries: HistoryEntry[] };
        setEntries(body.entries);
      } catch {
        setError("Could not load previous questionnaires.");
      }
    })();
  }, []);

  async function remove(id: string) {
    setDeleting(id);
    try {
      await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setEntries((prev) => prev?.filter((e) => e.id !== id) ?? null);
    } catch {
      setError("Could not delete that run.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
      <SiteHeader current="previous" />
      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-semibold text-[var(--gt-ink)]">Previous questionnaires</h1>
          <Link
            href="/"
            className="text-sm font-medium text-[var(--gt-green)] hover:underline"
          >
            Start a new appraisal
          </Link>
        </div>
        <p className="mt-2 text-sm text-[var(--gt-muted)]">
          Every finished run, from cache. Delete one to force a fresh run next time you
          upload the same documents.
        </p>

        {error ? <p className="mt-6 text-sm text-red-700">{error}</p> : null}

        {entries === null && !error ? (
          <p className="mt-8 text-sm text-[var(--gt-muted)]">Loading&hellip;</p>
        ) : null}

        {entries?.length === 0 ? (
          <p className="mt-8 text-sm text-[var(--gt-muted)]">Nothing cached yet.</p>
        ) : null}

        {entries?.length ? (
          <ul className="mt-8 flex flex-col gap-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col items-start justify-between gap-4 rounded-xl border border-[var(--gt-border)] bg-white/50 p-5 sm:flex-row sm:items-center"
              >
                <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <Link
                    href={`/?id=${encodeURIComponent(entry.id)}`}
                    className="text-sm font-medium text-[var(--gt-green)] hover:underline"
                  >
                    {entry.asOf ?? "Undated appraisal"}
                  </Link>
                  <p className="mt-1.5 truncate font-mono text-xs text-[var(--gt-muted)]">
                    {entry.documents.join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-[var(--gt-muted)]">
                    {entry.evidenced} of {entry.questionCount} questions evidenced
                    {entry.startedAt ? ` — run ${new Date(entry.startedAt).toLocaleString()}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-[var(--gt-muted)]">
                    {entry.respondentCount === 0
                      ? "No director responses yet"
                      : `${entry.respondentCount} director response${entry.respondentCount === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {entry.respondentCount > 0 ? (
                    <Link
                      href={`/report/${toReportId(entry.id)}`}
                      className="cursor-pointer rounded-full border border-[var(--gt-green)] px-4 py-2 text-xs font-medium text-[var(--gt-green)] transition-colors hover:bg-[var(--gt-nav-active)]"
                    >
                      View summary
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void remove(entry.id)}
                    disabled={deleting === entry.id}
                    className="cursor-pointer rounded-full border border-[var(--gt-border)] px-4 py-2 text-xs text-[var(--gt-muted)] transition-colors hover:border-[var(--gt-ink)] hover:text-[var(--gt-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deleting === entry.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </div>
  );
}
