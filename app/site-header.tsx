/**
 * The small header on every authenticated page: the wordmark on the left, the way to
 * previous runs on the right. Shared rather than duplicated so the nav can't drift
 * between the upload screen and the questionnaire.
 */
export function SiteHeader({ current }: { current?: "home" | "previous" }) {
  return (
    <header className="border-b border-[var(--gt-hairline)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-10">
        {/* A plain anchor, not next/link: pages under this header keep state in memory
            (which appraisal is showing, what's mid-upload), and a soft client-side nav
            wouldn't remount that — the old view would just sit there. Same reasoning as
            the gate's full navigation after unlock. */}
        <a
          href="/"
          aria-current={current === "home" ? "page" : undefined}
          className="text-lg text-[var(--gt-green)]"
          style={{ fontFamily: "var(--font-onest)", fontWeight: 500 }}
        >
          groundtruth
        </a>
        <a
          href="/previous"
          aria-current={current === "previous" ? "page" : undefined}
          className="text-sm font-medium text-[var(--gt-green)] hover:underline"
        >
          Previous questionnaires
        </a>
      </div>
    </header>
  );
}
