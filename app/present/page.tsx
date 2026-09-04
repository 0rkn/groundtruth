"use client";

/**
 * A keyboard-navigable slideshow for the Friday demo: what this is and who it's for, the
 * problem, the hardest decision made and why, and where it stands. Four slides,
 * deliberately — the live demo itself is the product, not a fifth slide describing it.
 * Not linked from anywhere in the main navigation, only a small footer link on the home
 * page, since this is presentation material for one audience rather than part of the
 * product.
 *
 * Minimal text, large type, no feature bullet lists — written for a governance expert
 * seeing this for the first time, not a changelog. Every number here is a real, already
 * measured fact from this week's work, not recomputed live.
 */
import { useEffect, useState } from "react";

interface Slide {
  title: string;
  body: React.ReactNode;
}

const SLIDES: Slide[] = [
  {
    title: "Groundtruth",
    body: (
      <p className="text-2xl leading-snug text-[var(--gt-muted)] sm:text-3xl">
        A bespoke board-effectiveness questionnaire, built from a board&rsquo;s own
        documents &mdash; for the consultants who run the review.
      </p>
    ),
  },
  {
    title: "Bad evidence",
    body: (
      <div className="flex flex-col gap-6">
        <p className="text-5xl font-semibold text-[var(--gt-ink)] sm:text-6xl">9 of 34</p>
        <p className="text-2xl leading-snug text-[var(--gt-muted)] sm:text-3xl">
          evidence lines in an early version were quietly borrowed from the wrong passage.
        </p>
        <p className="text-xl leading-snug text-[var(--gt-muted)]">
          A wrong citation in front of a client is not a bug. It is the firm&rsquo;s
          credibility.
        </p>
      </div>
    ),
  },
  {
    title: "The hardest decision",
    body: (
      <div className="flex flex-col gap-6">
        <p className="text-2xl leading-snug text-[var(--gt-ink)] sm:text-3xl">
          Seven ways to split the documents. Every difference measured as noise.
        </p>
        <p className="text-5xl font-semibold text-[var(--gt-ink)] sm:text-6xl">7 tested, 0 winners</p>
        <p className="text-2xl leading-snug text-[var(--gt-muted)] sm:text-3xl">
          I could have kept testing for a real signal. I didn&rsquo;t have the week for it.
        </p>
        <p className="text-xl leading-snug text-[var(--gt-muted)]">
          Shipped the simplest one that measured no worse than the rest.
        </p>
      </div>
    ),
  },
  {
    title: "Where it stands",
    body: (
      <div className="flex flex-col gap-5 text-2xl leading-snug text-[var(--gt-ink)] sm:text-3xl">
        <p>Every quote is real &mdash; 10 of 10, verified against source.</p>
        <p className="text-[var(--gt-muted)]">
          It cannot yet catch a contradiction inside one document.
        </p>
        <p className="text-[var(--gt-muted)]">Next: fine-tune the reranker. Solve that, properly.</p>
        <p className="mt-4 text-sm text-[var(--gt-muted)]">
          Bespokeness, and everything else, is in the README.
        </p>
      </div>
    ),
  },
];

export default function Present() {
  const [i, setI] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") setI((n) => Math.min(n + 1, SLIDES.length - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slide = SLIDES[i]!;

  return (
    <div className="gt-brand min-h-dvh" style={{ background: "var(--gt-page)" }}>
      {/* A plain anchor, not next/link, same reasoning as SiteHeader: a full navigation
          back to "/" rather than a client-side transition that would leave slide state
          from a soft nav lingering. */}
      <a
        href="/"
        className="fixed top-6 left-6 text-lg text-[var(--gt-green)] sm:top-8 sm:left-10"
        style={{ fontFamily: "var(--font-onest)", fontWeight: 500 }}
      >
        groundtruth
      </a>
      <div className="flex min-h-dvh flex-col items-center justify-center px-8 pt-12 pb-32 sm:px-16">
        <div className="w-full max-w-3xl">
          <h1 className="text-3xl font-semibold text-[var(--gt-ink)] sm:text-4xl">{slide.title}</h1>
          <div className="mt-8 text-[var(--gt-ink)]">{slide.body}</div>
        </div>
      </div>

      {/* Fixed to the viewport bottom rather than sitting after the slide content, so it
          stays in the same place regardless of how tall a given slide's body is. */}
      <div
        className="fixed inset-x-0 bottom-20 flex flex-col items-center gap-2 sm:bottom-0 sm:pb-8"
        style={{ background: "var(--gt-page)" }}
      >
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setI((n) => Math.max(n - 1, 0))}
            disabled={i === 0}
            className="cursor-pointer rounded-full border border-[var(--gt-hairline)] px-4 py-2 text-sm text-[var(--gt-muted)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            &larr; Back
          </button>
          <div className="flex gap-1.5">
            {SLIDES.map((_, idx) => (
              <div
                key={idx}
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: idx === i ? "var(--gt-green)" : "var(--gt-hairline)" }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setI((n) => Math.min(n + 1, SLIDES.length - 1))}
            disabled={i === SLIDES.length - 1}
            className="cursor-pointer rounded-full border border-[var(--gt-hairline)] px-4 py-2 text-sm text-[var(--gt-muted)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Next &rarr;
          </button>
        </div>
        <p className="text-xs text-[var(--gt-muted)]">
          {i + 1} / {SLIDES.length} &mdash; arrow keys or space to navigate
        </p>
      </div>
    </div>
  );
}
