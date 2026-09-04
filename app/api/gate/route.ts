/**
 * Check the passcode and set the cookie.
 *
 * Kept in a route rather than done in the proxy so the comparison happens once, on the
 * server, against a value the browser never sees.
 */
import { COOKIE } from "@/proxy";
import { rateLimit } from "@/lib/limit";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Rate limited harder than anything else: a passcode with no limit is a passcode
  // anyone can guess given an afternoon.
  const limit = await rateLimit(request, { name: "gate", max: 10, windowSeconds: 300 });
  if (!limit.ok) {
    return Response.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter} seconds.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const expected = process.env.APP_PASSCODE;
  if (!expected) return Response.json({ error: "This app is closed." }, { status: 503 });

  let passcode = "";
  try {
    passcode = ((await request.json()) as { passcode?: string }).passcode ?? "";
  } catch {
    return Response.json({ error: "Expected a passcode." }, { status: 400 });
  }

  if (passcode !== expected) {
    return Response.json({ error: "That passcode is not right." }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  response.headers.append(
    "set-cookie",
    // httpOnly so page scripts cannot read it; sameSite=lax so the redirect back from
    // the gate still carries it; secure in production only, or local http would drop it.
    [
      `${COOKIE}=${encodeURIComponent(expected)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=43200",
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  return response;
}
