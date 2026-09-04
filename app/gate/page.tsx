"use client";

/**
 * The passcode screen — and, deliberately, the front page.
 *
 * Groundtruth's brand lives here now: unlocking the tool is the first thing a visitor
 * does, so it is also where the wordmark lives. This trades away the previous design's
 * silence about what the tool is (an earlier version showed nothing but a bare form,
 * on the theory that an unauthenticated page should teach a stranger as little as
 * possible) for a page that actually looks like something. The passcode is still the
 * only way past it. Below the fold, real product facts (who this is for, how it works,
 * the four themes) — nothing fabricated, no customers or claims not in PRODUCT.md.
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function Gate() {
  return (
    <Suspense fallback={null}>
      <GateForm />
    </Suspense>
  );
}

const STEPS = [
  {
    title: "Upload the documents",
    body: "The corporate plan, risk register, board pack, calendar, and previous review.",
  },
  {
    title: "It reads them",
    body: "Every figure is computed in code from what the documents say — never a model’s guess.",
  },
  {
    title: "A questionnaire is built",
    body: "44–48 questions across four fixed themes, each with the evidence behind it.",
  },
  {
    title: "Directors answer",
    body: "One link each. Five-point scales, labelled at every point, no account required.",
  },
  {
    title: "You get a summary",
    body: "Theme scores, strengths, areas for attention, and an action plan to work from.",
  },
];

const THEMES = [
  { name: "Resources", body: "Time, papers, and the financial and professional resource the board needs." },
  { name: "Competency", body: "The skills and experience around the table, and how the board renews them." },
  { name: "Execution", body: "Decisions followed through, tracked, and revisited when things change." },
  { name: "Behaviour", body: "Debate, dissent, conflicts of interest, and the board’s actual culture." },
];

function GateForm() {
  const next = useSearchParams().get("next") ?? "/";
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (response.ok) {
        // A full navigation rather than a router push: the cookie has to be sent with
        // the next request, and a client-side transition would not carry it.
        window.location.href = next.startsWith("/") ? next : "/";
        return;
      }
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "That did not work.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="gt-brand" style={{ background: "var(--gt-page)" }}>
      {/* ------------------------------------------------------------------- hero */}
      <section
        className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16 text-center"
        style={{
          background:
            "radial-gradient(ellipse 900px 500px at 50% 8%, rgba(244,234,208,0.07), transparent 65%)," +
            "radial-gradient(ellipse 1000px 700px at 50% 100%, var(--gt-green-deep), transparent 70%)," +
            "var(--gt-green)",
        }}
      >
        <h1
          className="gt-wordmark text-[color:var(--gt-cream)]"
          style={{ fontSize: "clamp(3.5rem, 9vw + 1rem, 12rem)", lineHeight: 0.92, letterSpacing: "-0.02em" }}
        >
          groundtruth
        </h1>
        <p className="mt-5 text-sm text-[color:var(--gt-cream-dim)] sm:text-base">
          board effectiveness, evidenced
        </p>

        <form onSubmit={submit} className="mt-10 w-full max-w-xs">
          <label htmlFor="passcode" className="sr-only">
            Passcode
          </label>
          <div className="flex items-center gap-2 border-b-2 border-[color:rgba(244,234,208,0.35)] pb-3">
            <input
              id="passcode"
              type="password"
              autoComplete="current-password"
              placeholder="passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full bg-transparent text-center text-base tracking-[0.12em] text-[color:var(--gt-cream)]
                         placeholder:text-[color:#7d8f80] focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || passcode.length === 0}
              aria-label={busy ? "Checking" : "Unlock"}
              className="shrink-0 text-xl leading-none text-[color:var(--gt-cream)] disabled:opacity-40"
            >
              {busy ? "…" : "→"}
            </button>
          </div>
        </form>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-[color:#e8b17a]">
            {error}
          </p>
        ) : null}

        <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => document.getElementById("about")?.scrollIntoView({ behavior: "smooth" })}
            aria-label="Learn more"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[color:rgba(244,234,208,0.35)] text-[color:var(--gt-cream)] transition-colors hover:bg-[color:rgba(244,234,208,0.1)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3 6L8 11L13 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <p className="px-6 text-xs tracking-wide text-[color:#5c6b5f]">
            this tool spends credits on every run, so it isn&rsquo;t open to the internet
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- who this is for */}
      <section id="about" className="scroll-mt-8 px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-[var(--gt-ink)]">Who this is for</h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            <div>
              <p className="font-mono text-xs tracking-wide text-[var(--gt-green)] uppercase">The consultant</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--gt-ink)]">
                Built for governance consultants and the consultancies they work in &mdash;
                the people who currently run board effectiveness reviews by hand: a
                questionnaire, one-to-one interviews with every director, observation of a
                board meeting, and a written report that takes weeks to produce.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs tracking-wide text-[var(--gt-green)] uppercase">The board</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--gt-muted)]">
                Directors and company secretaries meet groundtruth only as respondents
                &mdash; answering a questionnaire and seeing the evidence behind each
                question, on a link a consultant sends them. This page isn&rsquo;t written
                for them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- how it works */}
      <section className="border-t border-[var(--gt-hairline)] px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-[var(--gt-ink)]">How it works</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="font-mono text-xs text-[var(--gt-green)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="mt-2 font-medium text-[var(--gt-ink)]">{step.title}</p>
                <p className="mt-1 text-sm text-[var(--gt-muted)]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------------- the four themes */}
      <section className="border-t border-[var(--gt-hairline)] px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-[var(--gt-ink)]">Four themes, every time</h2>
          <p className="mt-2 max-w-[60ch] text-sm text-[var(--gt-muted)]">
            The same four themes structure every questionnaire, in this order. A theme
            with thin evidence still appears &mdash; it reports the gap instead of being
            dropped.
          </p>
          <dl className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {THEMES.map((theme) => (
              <div
                key={theme.name}
                className="cursor-default rounded-xl border border-[var(--gt-border)] bg-white/40 p-5 transition-colors hover:border-[var(--gt-green)] hover:bg-[var(--gt-nav-active)]"
              >
                <dt className="font-medium text-[var(--gt-ink)]">{theme.name}</dt>
                <dd className="mt-1.5 text-sm text-[var(--gt-muted)]">{theme.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
