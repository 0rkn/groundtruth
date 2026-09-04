/**
 * The `/report/[id]` URL segment, obfuscated to plain characters — never the raw cache key.
 *
 * WHY THIS EXISTS. The appraisal cache key is `appraisal:method-2:ret-2:pick-6:<hash>` —
 * colons, by design, so a version bump is visible in the key itself (see `cache.ts`). Put
 * directly into a Next.js dynamic route segment, those colons caused two separate bugs
 * this project hit: an id that gets percent-encoded once by the link and then again by
 * code that didn't know it was already encoded (`%253A` instead of `%3A`, a 404 that
 * looked like a missing appraisal), and outright navigation failures in at least one
 * browser context that a query-string colon never triggered. Both are symptoms of the
 * same root cause — a raw cache key was never meant to travel as a URL path segment.
 *
 * The fix is not to change what `cache.ts` stores keys as; every `respond:` token and
 * every `job:` wrapper already points at that exact string, and changing it would break
 * every link a director has ever been sent. Instead, only the OUTER url is different: this
 * base64url-encodes the key for display in the path, and decodes it back to the exact
 * original string before it is ever used to look anything up. `/api/report` still takes
 * and stores the real key — nothing downstream of the URL itself changes.
 */
// `btoa`/`atob`, not `Buffer` — this is imported into a client component, and `Buffer` is
// a Node global with no browser equivalent. Both functions are plain ASCII-safe base64,
// available in both environments; the only work here is making that URL-safe.
export function toReportId(key: string): string {
  return btoa(key).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromReportId(id: string): string {
  const padded = id.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(id.length / 4) * 4, "=");
  return atob(padded);
}
