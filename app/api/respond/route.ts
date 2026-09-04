/**
 * A director's link into one finished questionnaire.
 *
 * WHY A TOKEN AND NOT THE APPRAISAL ID ITSELF. The appraisal id is the cache key, and a
 * consultant is expected to be able to say it out loud, paste it in an email, put it in
 * a URL they screenshot — none of that is safe for something that also has to work as an
 * access credential. The token is a second, unguessable value that maps to one appraisal
 * and nothing else: knowing the appraisal id does not get you a working link, and having
 * a working link tells you nothing about how to construct another one.
 *
 * POST /api/respond                          { appraisalId, showAbsence? } -> { token }
 *   (consultant mints a link)
 * GET  /api/respond?token=...&response=...   -> { appraisal, answers, showAbsence, submitted }
 *   (a director opens it)
 * PUT  /api/respond                           { token, response, answers } -> { ok }
 *   (a director submits)
 *
 * ONE LINK, MANY RESPONDENTS. A consultant realistically shares one link with a whole
 * board, the way a Google Form link works — not one freshly-minted link per director. The
 * token alone used to BE the answer record, which meant a second person opening the same
 * link silently overwrote the first person's submission. `response` is a second,
 * independent id the browser generates for itself (see `app/respond/[token]/page.tsx`) and
 * keeps in its own `localStorage`, scoped to this token — not sent by the consultant, not
 * known in advance, never shared between two different browsers. Two people on the same
 * link get two different `response` ids without coordinating, exactly the way two people
 * filling in the same Google Form both get their own row. Answers are stored at
 * `answers:<token>:<response>`, not `answers:<token>` — the token alone now only
 * identifies the LINK (which appraisal, whether to show absence), never one person's
 * answers.
 *
 * No aggregation lives here. This stores what one respondent submitted, keyed by their own
 * token *and* response id; a consultant-facing summary across every response under an
 * appraisal's tokens is a further step (`lib/aggregate.ts`) that reads what this writes,
 * not something this route needs to know about.
 *
 * WHY `showAbsence` LIVES ON THE TOKEN, NOT THE APPRAISAL. The default a director sees for
 * an unanswered question is nothing at all — no question is skipped, but nothing is said
 * about why, because a director being told "we found no documentation covering this"
 * before they have answered reads as the tool arguing a case rather than asking one. The
 * plain statement is a genuine option, not a worse one, so it is a per-link choice the
 * consultant makes when they mint the link — never a global switch, so two different
 * director groups for the same appraisal could be shown differently on purpose.
 */
import { randomBytes } from "node:crypto";
import { kvGet, kvPut } from "@/lib/cf";
import type { Appraisal } from "@/lib/appraisal";

export const runtime = "nodejs";

const tokenKey = (token: string) => `respond:${token}`;
const answersKey = (token: string, response: string) => `answers:${token}:${response}`;

/**
 * `response` ids come from the browser, not from anything this server controls — so they
 * are constrained to a safe, boring shape rather than trusted as-is. They only ever need
 * to be unguessable-enough and URL/KV-key-safe, never cryptographically strong the way the
 * token itself is: a response id only ever matters within the browser that generated it.
 */
const RESPONSE_ID = /^[A-Za-z0-9_-]{8,64}$/;

interface TokenRecord {
  appraisalId: string;
  createdAt: number;
  /** Whether THIS link tells a director when a question has no evidence. Defaults false. */
  showAbsence: boolean;
}

export async function POST(request: Request): Promise<Response> {
  let body: { appraisalId?: string; showAbsence?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON with an appraisalId." }, { status: 400 });
  }

  const appraisalId = body.appraisalId;
  if (!appraisalId) return Response.json({ error: "Missing appraisalId." }, { status: 400 });

  // The appraisal must actually exist and be finished — a link is only ever minted for a
  // questionnaire a consultant has already looked at, never for one still running.
  const stored = await kvGet(appraisalId);
  if (!stored) return Response.json({ error: "No finished appraisal with that id." }, { status: 404 });

  const token = randomBytes(24).toString("base64url");
  await kvPut(
    tokenKey(token),
    JSON.stringify({
      appraisalId,
      createdAt: Date.now(),
      showAbsence: body.showAbsence === true,
    } satisfies TokenRecord),
  );

  return Response.json({ token });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const token = params.get("token");
  const response = params.get("response");
  if (!token) return Response.json({ error: "Missing token." }, { status: 400 });

  const raw = await kvGet(tokenKey(token));
  if (!raw) return Response.json({ error: "This link is not recognised." }, { status: 404 });
  const record = JSON.parse(raw) as TokenRecord;

  const appraisalRaw = await kvGet(record.appraisalId);
  if (!appraisalRaw) {
    return Response.json({ error: "The questionnaire behind this link no longer exists." }, { status: 404 });
  }

  // No `response` id yet means this browser has never opened this link before — a blank
  // form, nothing to read back. `page.tsx` generates one and stores it in `localStorage`
  // before it ever calls this with a `response` id attached.
  const existingAnswers =
    response && RESPONSE_ID.test(response) ? await kvGet(answersKey(token, response)) : null;

  return Response.json({
    appraisal: JSON.parse(appraisalRaw) as Appraisal,
    answers: existingAnswers ? (JSON.parse(existingAnswers) as Record<string, number>) : {},
    showAbsence: record.showAbsence,
    submitted: existingAnswers !== null,
  });
}

export async function PUT(request: Request): Promise<Response> {
  let body: { token?: string; response?: string; answers?: Record<string, number> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON with a token, a response id, and answers." }, { status: 400 });
  }

  const { token, response, answers } = body;
  if (!token || !answers) return Response.json({ error: "Missing token or answers." }, { status: 400 });
  if (!response || !RESPONSE_ID.test(response)) {
    return Response.json({ error: "Missing or malformed response id." }, { status: 400 });
  }

  const raw = await kvGet(tokenKey(token));
  if (!raw) return Response.json({ error: "This link is not recognised." }, { status: 404 });
  const record = JSON.parse(raw) as TokenRecord;

  // Every value must be a whole number 1-5 — the five points on the questionnaire's own
  // scale — so a malformed submission cannot corrupt whatever reads this back later.
  for (const [id, value] of Object.entries(answers)) {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return Response.json({ error: `Invalid score for ${id}: must be 1-5.` }, { status: 400 });
    }
  }

  // Partial submission is no longer allowed — a respondent answers every question in one
  // sitting, not some now and the rest on a later visit. Enforced here, not only by
  // disabling the button client-side, since a direct call to this route could otherwise
  // still save an incomplete set of answers.
  const appraisalRaw = await kvGet(record.appraisalId);
  if (!appraisalRaw) {
    return Response.json({ error: "The questionnaire behind this link no longer exists." }, { status: 404 });
  }
  const appraisal = JSON.parse(appraisalRaw) as Appraisal;
  if (Object.keys(answers).length !== appraisal.questionCount) {
    return Response.json(
      { error: `All ${appraisal.questionCount} questions must be answered before submitting.` },
      { status: 400 },
    );
  }

  await kvPut(answersKey(token, response), JSON.stringify(answers));
  return Response.json({ ok: true });
}
