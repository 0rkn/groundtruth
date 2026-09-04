/**
 * Passcode gate.
 *
 * The app spends company credits on every AI call, so it must not be open to the
 * internet. This runs before every request and sends anyone without a valid cookie to
 * the passcode screen.
 *
 * NOT `middleware.ts`. Next 16 renamed Middleware to Proxy, and the old filename is
 * silently ignored — no error, no warning, and the gate simply never runs. A file called
 * `middleware.ts` here would look exactly like a working passcode gate while leaving the
 * app wide open.
 *
 * This is an optimistic check, not a session system. It answers "has this browser been
 * told the passcode", which is all the brief asks for. Anything that mattered more would
 * need real sessions.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const COOKIE = "bab_gate";

/**
 * Paths that must work before anyone is let in: the passcode screen itself, the route
 * that checks the passcode, and Next's own assets. Without the last of these the login
 * page renders unstyled and its own scripts are redirected to itself.
 */
/**
 * `/respond` and `/api/respond` are deliberately open. A director answering a
 * questionnaire never has the consultant's passcode and was never meant to — access
 * there is controlled by the unguessable token in the link itself (see
 * `app/api/respond/route.ts`), not by this gate. Nothing under either path can start a
 * new appraisal or spend a model call; it can only read one already-finished
 * questionnaire by its token and write that token's own answers.
 */
const OPEN = ["/gate", "/api/gate", "/respond", "/api/respond", "/_next", "/favicon.ico"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const expected = process.env.APP_PASSCODE;

  // No passcode configured is a misconfiguration, not a reason to allow everyone
  // through. Failing closed is the only safe default for a gate.
  if (!expected) {
    return new NextResponse(
      "APP_PASSCODE is not set, so this app is closed. Set it in the environment.",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  if (request.cookies.get(COOKIE)?.value === expected) return NextResponse.next();

  // An API call gets a status it can act on; a page gets the passcode screen. Redirecting
  // a fetch to an HTML page produces a confusing parse error rather than a clear 401.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not unlocked." }, { status: 401 });
  }

  const gate = new URL("/gate", request.url);
  gate.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(gate);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
