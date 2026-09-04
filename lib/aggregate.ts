/**
 * Turning several directors' scores into the shape a consultant reads.
 *
 * NO SEPARATE INDEX OF WHO ANSWERED. Every token minted for an appraisal is a `respond:*`
 * KV entry carrying that appraisal's id, the same pattern `/api/history` already uses to
 * list finished runs without a second index to keep in sync. Finding an appraisal's
 * respondents means listing every `respond:*` key and keeping the ones that point at it —
 * fine at the scale this tool operates at, and one less thing that can drift out of sync
 * with the record it is supposed to summarise.
 *
 * ONE TOKEN, MANY RESPONDENTS. A token is a link, not a person — see `app/api/respond/
 * route.ts` for why. A single director link opened by a whole board produces one
 * `answers:<token>:<response>` entry per person who submitted through it, so a
 * respondent here is one `(token, response)` pair, not one token.
 *
 * EVERYTHING HERE IS ARITHMETIC. An average, a count, a spread — never a model deciding
 * what a number means. Where prose is needed (a theme's one-line commentary), it is
 * assembled from a fixed vocabulary keyed to the computed band, and from evidence the
 * pipeline already produced and already checked — never a new sentence composed for this
 * report specifically. The lesson this whole project relearned twice today: a model
 * given something narrow to restate is safe, and a model given room to describe what a
 * number "shows" reproduces the exact conclusion-drawing this tool was built to avoid.
 */
import { kvListKeys, kvGet } from "./cf.ts";
import type { Appraisal, AppraisalQuestion, AppraisalTheme } from "./appraisal.ts";

export interface Respondent {
  token: string;
  response: string;
  answeredCount: number;
}

export interface QuestionScore {
  id: string;
  text: string;
  mean: number;
  /** Every score given, in the order respondents were found — for a spread check. */
  scores: number[];
}

export interface ThemeSummary {
  name: string;
  mean: number;
  band: "strong" | "adequate" | "attention";
  questions: QuestionScore[];
}

export interface Report {
  appraisal: Appraisal;
  respondentCount: number;
  themes: ThemeSummary[];
  /** Highest-scoring questions with real evidence behind them, across all themes. */
  strengths: (QuestionScore & { question: AppraisalQuestion })[];
  /** Lowest-scoring questions, evidence and severity — only where evidence exists. */
  concerns: (QuestionScore & { question: AppraisalQuestion; severity: "high" | "medium" })[];
  /** Evidenced questions whose source is a previous review's recommendation. */
  progressSincePreviousReview: AppraisalQuestion[];
}

/**
 * Every respondent for this appraisal, from the same records `/api/history` reads.
 *
 * Two-level scan: first every `respond:*` token that points at this appraisal, then
 * every `answers:<token>:*` entry under each of those tokens — because one link can hold
 * more than one respondent now (see the module docstring above).
 */
export async function respondentsFor(appraisalId: string): Promise<Respondent[]> {
  const tokenKeys = await kvListKeys("respond:");
  const out: Respondent[] = [];

  for (const key of tokenKeys) {
    const raw = await kvGet(key);
    if (!raw) continue;
    const record = JSON.parse(raw) as { appraisalId: string };
    if (record.appraisalId !== appraisalId) continue;

    const token = key.slice("respond:".length);
    const prefix = `answers:${token}:`;
    const responseKeys = await kvListKeys(prefix);

    for (const responseKey of responseKeys) {
      const answersRaw = await kvGet(responseKey);
      const answers = answersRaw ? (JSON.parse(answersRaw) as Record<string, number>) : {};
      out.push({ token, response: responseKey.slice(prefix.length), answeredCount: Object.keys(answers).length });
    }
  }
  return out;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

const bandOf = (m: number): ThemeSummary["band"] => (m >= 4 ? "strong" : m >= 3 ? "adequate" : "attention");

/**
 * "Why it scored this way", the one form of that question arithmetic can actually answer:
 * whether respondents agreed. A mean of 2.8 from five directors who each said "3" is a
 * different fact than the same mean from a mix of 1s and 5s, and unlike anything about
 * causes, this is just the min and max of numbers already in hand — no model call, no
 * interpretation, nothing this report doesn't already know.
 */
export function agreementNote(scores: number[]): string | null {
  if (scores.length < 2) return null;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min === max) return `All ${scores.length} respondents scored this ${min}.`;
  return `Scores ranged from ${min} to ${max} across ${scores.length} respondents.`;
}

export async function buildReport(appraisal: Appraisal, appraisalId: string): Promise<Report> {
  const respondents = await respondentsFor(appraisalId);

  const answersByToken = await Promise.all(
    respondents.map(async (r) => {
      const raw = await kvGet(`answers:${r.token}:${r.response}`);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    }),
  );

  const scoresFor = (id: string): number[] =>
    answersByToken.map((a) => a[id]).filter((v): v is number => typeof v === "number");

  const themes: ThemeSummary[] = appraisal.themes.map((theme: AppraisalTheme) => {
    const questions: QuestionScore[] = theme.questions
      .map((q) => ({ id: q.id, text: q.text, scores: scoresFor(q.id) }))
      .filter((q) => q.scores.length > 0)
      .map((q) => ({ ...q, mean: mean(q.scores) }));

    const themeMean = questions.length ? mean(questions.map((q) => q.mean)) : 0;
    return { name: theme.name, mean: themeMean, band: bandOf(themeMean), questions };
  });

  const allQuestions = appraisal.themes.flatMap((t) => t.questions);
  const byId = new Map(allQuestions.map((q) => [q.id, q]));
  const allScored = themes.flatMap((t) => t.questions);

  const withEvidence = (id: string) => (byId.get(id)?.sources?.length ?? 0) > 0;

  const strengths = allScored
    .filter((q) => q.mean >= 4 && withEvidence(q.id))
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 6)
    .map((q) => ({ ...q, question: byId.get(q.id)! }));

  const concerns = allScored
    .filter((q) => q.mean < 3.5 && withEvidence(q.id))
    .sort((a, b) => a.mean - b.mean)
    .slice(0, 8)
    .map((q) => ({ ...q, question: byId.get(q.id)!, severity: (q.mean < 2.5 ? "high" : "medium") as "high" | "medium" }));

  const progressSincePreviousReview = allQuestions.filter((q) =>
    q.sources?.some((s) => /^Recommendation \d+ of the board's/.test(s.quote)),
  );

  return {
    appraisal,
    respondentCount: respondents.length,
    themes,
    strengths,
    concerns,
    progressSincePreviousReview,
  };
}
