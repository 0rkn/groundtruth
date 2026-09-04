/**
 * Choosing which questions this client is asked.
 *
 * The instrument is the four themes and the two scales. The questionnaire is a
 * selection from the pool, and that selection is where bespokeness lives at the
 * question level: a fintech is not asked about resident scrutiny, and a housing
 * association is not asked about its next funding round.
 *
 * THE RULE THAT MATTERS MOST: selection reads the documents for what the organisation
 * IS, never for what we managed to find in them. A question is not dropped because no
 * evidence turned up — that would make the tool ask only what it can already answer,
 * which flatters the client and deletes exactly the gaps worth reporting. `select`
 * therefore takes documents and nothing else; it cannot see the figures even by
 * accident, and a test asserts the result is identical with and without them.
 *
 * Deterministic: same documents, same questionnaire.
 */
import { flatten, type Document } from "./extract.ts";
import { QUESTIONS, THEMES, VERBATIM, type Question, type Signal } from "../data/questions.ts";

/**
 * Per-theme cap.
 *
 * Four themes at 12 gives 48, inside the client's stated 45-50. A cap of 13 would give
 * 52 and leave the range, so 12 is the largest that fits — and the floor exists so a
 * client matching no signals at all still receives a usable appraisal rather than a
 * truncated one.
 */
export const PER_THEME_CAP = 12;
export const PER_THEME_FLOOR = 11;

/**
 * What each signal looks like in a document.
 *
 * Deliberately plural and specific. "member" would match board members in both clients
 * and detect nothing; "resident"/"tenant" separates a housing association from a
 * payments company cleanly, which is the point.
 */
const PATTERNS: Record<Signal, RegExp> = {
  service_users: /\b(residents?|tenants?|service users?|scrutiny panel)\b/i,
  equity_investors: /\b(shareholders?|investors?|series [a-e]\b|funding round|option pool)\b/i,
  subsidiary: /\bsubsidiar(y|ies)\b/i,
  development: /\bdevelopment (programme|program|scheme|pipeline)\b/i,
  debt_covenants: /\bcovenants?\b/i,
  charity: /\b(charity|charitable|registered charity)\b/i,
  regulated: /\b(regulator|regulatory|the regulator's code|constitution requires)\b/i,
  committees: /\b(audit and risk committee|remuneration|committee reports? to)\b/i,
};

/**
 * How many times a signal must appear before it counts.
 *
 * A single passing mention is not a property of the organisation — Northgate says
 * "volunteer" once and is not a volunteer-led charity. Two occurrences across the whole
 * document set is a low bar that still excludes the incidental.
 */
const MIN_OCCURRENCES = 2;

/**
 * Phrases that settle a signal on their own.
 *
 * The two-occurrence rule produced a false negative: Brambleside is a registered
 * charity and says so once, so charity went undetected and its charitable-purpose
 * question was dropped from a charity's appraisal. "Registered charity" is a legal
 * status, not a passing mention, and one is enough. Kept as a short explicit list
 * rather than a per-signal threshold, so the general rule stays uniform.
 */
const DEFINITIVE: Partial<Record<Signal, RegExp>> = {
  charity: /\bregistered charity\b|\bcharitable objects?\b/i,
  equity_investors: /\bseries [a-e]\b/i,
  regulated: /\bregistered provider\b|\bthe regulator\b/i,
};

export function detectSignals(docs: Document[]): Signal[] {
  const text = docs.map((d) => flatten(d.text)).join(" \n ");
  const found: Signal[] = [];
  for (const [signal, pattern] of Object.entries(PATTERNS) as [Signal, RegExp][]) {
    const hits = text.match(new RegExp(pattern.source, "gi"))?.length ?? 0;
    const definitive = DEFINITIVE[signal]?.test(text) ?? false;
    if (hits >= MIN_OCCURRENCES || definitive) found.push(signal);
  }
  return found;
}

const isCore = (q: Question) => VERBATIM.includes(q.text);
const applies = (q: Question, signals: Set<Signal>) =>
  (q.appliesWhen ?? []).every((s) => signals.has(s));

export interface Selection {
  questions: Question[];
  signals: Signal[];
  /** Why each pool question was kept or dropped. A consultant has to be able to ask. */
  reasons: { id: string; kept: boolean; why: string }[];
}

export function select(docs: Document[]): Selection {
  const signals = detectSignals(docs);
  const present = new Set(signals);
  const questions: Question[] = [];
  const reasons: Selection["reasons"] = [];

  for (const theme of THEMES) {
    const pool = QUESTIONS.filter((q) => q.theme === theme);

    // Order of precedence, and the order matters more than it looks:
    //   1. the client's own five questions, always
    //   2. conditional questions the organisation matches — these are the tailored
    //      ones, so they must displace generic questions rather than be squeezed out
    //      by them. Filling with universals first would leave no room for exactly the
    //      questions that make the questionnaire this client's.
    //   3. universal questions, in declared order, to reach the cap
    const core = pool.filter((q) => isCore(q) && applies(q, present));
    const conditional = pool.filter(
      (q) => !isCore(q) && q.appliesWhen?.length && applies(q, present),
    );
    const universal = pool.filter((q) => !isCore(q) && !q.appliesWhen?.length);

    const chosen: Question[] = [];
    const take = (list: Question[], why: (q: Question) => string) => {
      for (const q of list) {
        if (chosen.length >= PER_THEME_CAP) break;
        chosen.push(q);
        reasons.push({ id: q.id, kept: true, why: why(q) });
      }
    };

    take(core, () => "the client's own wording, always asked");
    take(conditional, (q) => `the documents show ${(q.appliesWhen ?? []).join(", ")}`);
    take(universal, () => "universal question, filling the theme");

    // Anything left over is dropped, and why is recorded rather than inferred later.
    for (const q of pool) {
      if (chosen.includes(q)) continue;
      const unmatched = (q.appliesWhen ?? []).filter((s) => !present.has(s));
      reasons.push({
        id: q.id,
        kept: false,
        why: unmatched.length
          ? `the documents do not show ${unmatched.join(", ")}`
          : `the theme reached its cap of ${PER_THEME_CAP}`,
      });
    }

    questions.push(...chosen);
  }

  return { questions, signals, reasons };
}
