/**
 * Per-IP rate limiting, backed by KV.
 *
 * The point is not abuse in the abstract: one appraisal costs roughly a hundred model
 * calls, and a loop hitting the analyse route would spend company credits until someone
 * noticed. This is the cheapest thing that stops that.
 *
 * A fixed window rather than a sliding one, deliberately. A sliding window needs a
 * stored list of timestamps per caller and a read-modify-write on every request; a fixed
 * window is one counter and one write. The known cost is that a caller can use their
 * whole allowance at the end of one window and again at the start of the next — for a
 * passcode-gated internal tool, that is an acceptable trade rather than a bug.
 *
 * KV is eventually consistent, so two simultaneous requests can both read the same count
 * and both be allowed. This is a cost control, not a security boundary, and it fails
 * open on any KV error for the same reason: a broken cache must not take the app down.
 */
import { kvGet, kvPut } from "./cf.ts";

export interface Limit {
  /** A name for the thing being limited, so separate routes get separate budgets. */
  name: string;
  max: number;
  windowSeconds: number;
}

export interface LimitResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

/**
 * The caller's address.
 *
 * Behind a proxy, `x-forwarded-for` is a list and the client is the first entry; taking
 * the last would give the proxy's own address and rate-limit every user as one. Falls
 * back to a shared bucket rather than to "unlimited" when no header is present.
 */
function callerFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "unknown";
}

export async function rateLimit(request: Request, limit: Limit): Promise<LimitResult> {
  const caller = callerFrom(request);
  const window = Math.floor(Date.now() / 1000 / limit.windowSeconds);
  const key = `limit:${limit.name}:${caller}:${window}`;

  try {
    const used = Number((await kvGet(key)) ?? "0");

    if (used >= limit.max) {
      const elapsed = Math.floor(Date.now() / 1000) % limit.windowSeconds;
      return { ok: false, remaining: 0, retryAfter: limit.windowSeconds - elapsed };
    }

    await kvPut(key, String(used + 1));
    return { ok: true, remaining: limit.max - used - 1, retryAfter: 0 };
  } catch {
    // Fail open: a cost control that takes the app down when KV hiccups is worse than
    // one that occasionally lets a request through.
    return { ok: true, remaining: limit.max, retryAfter: 0 };
  }
}
