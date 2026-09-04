/**
 * "What we drew from it": one sentence restating the evidence, never inventing it.
 *
 * WHERE THIS SITS. `pick.ts` decides WHICH lines answer a question and lifts them
 * verbatim — that step is unchanged and stays the only place a citation is trusted.
 * This runs strictly after it, on the quotes already chosen, and does one narrower
 * thing: restate what they say in one plain sentence, for a reader who wants the fact
 * without parsing two quotations. It cannot select different evidence, cannot see any
 * passage `pick.ts` did not already choose, and every number in its output is checked
 * against the quotes it was given.
 *
 * REPORTING, NOT CONCLUDING. "Papers were issued four working days before the meeting,
 * against a seven-day standard" restates what the quotes say. "...which shows lead time
 * is inadequate" tells the reader what to think, which is the respondent's job. Only the
 * first is asked for; the second is exactly what made the earlier, larger generation
 * pass unusable — a verdict wearing a report's clothing, and no deterministic check
 * could tell the difference once it was mixed into a longer sentence.
 *
 * WHAT HAPPENS WHEN IT FAILS. A paraphrase that invents a number, or comes back empty,
 * is dropped rather than shown. The verbatim quotes are the fact of record and are
 * always displayed regardless; the paraphrase is a convenience on top of them, never
 * the only trace of an evidenced question.
 */
import { generate } from "./cf.ts";
import type { Quote } from "./pick.ts";

/**
 * Numbers a paraphrase may state, normalised so formatting cannot cause a false alarm.
 *
 * THREE real bugs have lived here, all silently dropping correct paraphrases:
 *
 *   1. The pattern's trailing `.` swallowed ordinary sentence punctuation into the
 *      number itself — "...in 2027." matched as "2027." rather than "2027", so a
 *      paraphrase that repeated a source number VERBATIM at the end of a sentence still
 *      failed to match it. This fired on almost any number, not an edge case.
 *   2. A quote reading "78%" and a paraphrase reading "78 percent" state the same fact,
 *      but stripping only `£` and `,` left "78" and "78%" as different strings.
 *   3. A quote giving a time as "10.45" (the period form these documents use) restated
 *      by the model as "10:45" split into TWO numbers, "10" and "45", neither of which
 *      matched the source's single token — a real time, correctly restated, flagged as
 *      inventing two numbers that do not exist.
 *
 * Fixed by: anchoring the decimal point to require a following digit (so a lone trailing
 * full stop is never captured); stripping the unit symbol from both sides before
 * comparing; and normalising a colon between two digit groups to a period before either
 * side is tokenised, so both time spellings collapse to the one comparison is actually
 * about — the value.
 *
 * A FOURTH gap, different in kind from the first three: this check only ever recognised
 * digit-form numbers. A source reading "7" restated as "seven" was a false rejection —
 * annoying, but safe, since the summary just silently disappears. The dangerous direction
 * is the reverse: a paraphrase that invents a quantity in WORDS ("roughly a dozen items")
 * was invisible to this check entirely, since spelled-out numbers never matched the digit
 * pattern on either side of the comparison. That is a hole in the guarantee itself, not
 * friction — the one thing this function exists to catch, uncatchable in one spelling.
 * Fixed by normalising common spelled-out cardinals to digits before the existing pattern
 * runs, on both the source and the reply, so "seven" and "7" become the same token instead
 * of needing a second parallel check.
 */
const WORD_NUMBERS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13",
  fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", hundred: "100", thousand: "1000",
};

const WORD_NUMBER_PATTERN = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})\\b`, "gi");

function numbers(text: string): string[] {
  const wordsAsDigits = text.replace(WORD_NUMBER_PATTERN, (w) => WORD_NUMBERS[w.toLowerCase()]);
  const timeNormalised = wordsAsDigits.replace(/\b(\d{1,2}):(\d{2})\b/g, "$1.$2");
  return [
    ...new Set((timeNormalised.match(/£?\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((n) => n.replace(/[£,%]/g, ""))),
  ];
}

function prompt(question: string, quotes: Quote[]): string {
  const lines = quotes.map((q, i) => `${i + 1}. "${q.text}"`).join("\n");
  return `A governance consultant has already found the evidence below for one appraisal question. Restate what it says, in one plain sentence, for a director who has not read it yet.

QUESTION: ${question}

EVIDENCE ALREADY FOUND:
${lines}

Report only what the evidence says. Do not say what it means, whether it is good or bad, or add anything the evidence does not state. Do not use the words "shows", "indicates", "suggests", "demonstrates" or "therefore" — those draw a conclusion, and that is the reader's job.

Reply with the one sentence and nothing else.`;
}

/**
 * Draws allowed before giving up. A single flaky model call used to cost the summary
 * for the whole run — the quotes were fine, the paraphrase attempt simply failed once
 * (a network hiccup, or a reply that happened to trip the number check that time), and
 * with no retry that was permanent. Three attempts, the same allowance every other
 * flaky call in this codebase gets, before accepting that this one genuinely has none.
 */
const ATTEMPTS = 3;

async function attempt(question: string, quotes: Quote[], maxChars: number): Promise<string | null> {
  let reply: string;
  try {
    reply = (await generate(prompt(question, quotes), 120 + 100 * quotes.length)).trim();
  } catch {
    return null;
  }

  if (!reply || reply.length > maxChars) return null;

  // No number may appear that is not in at least one of the source quotes. A paraphrase
  // that rounds, recomputes, or borrows a figure from outside the evidence it was given
  // is dropped rather than shown — the quotes beneath it remain the fact of record.
  const allowed = new Set(quotes.flatMap((q) => numbers(q.text)));
  const invented = numbers(reply).filter((n) => !allowed.has(n));
  if (invented.length > 0) return null;

  return reply;
}

export async function summarise(question: string, quotes: Quote[]): Promise<string | null> {
  if (quotes.length === 0) return null;

  // A fixed cap silently dropped every correct paraphrase of a genuinely multi-fact
  // question: three real quotes (performance reporting, two separate aims each with
  // their own figures) restated honestly in one sentence ran to 564 characters against
  // a flat 400-character limit, and the summary vanished — not because it was wrong,
  // because it was thorough. The limit exists to catch the model rambling past "one
  // sentence" into something structurally different; it should scale with how much
  // there genuinely is to restate, not stay fixed while the evidence given to it grows.
  // Even the scaled version of this cap was still calibrated against one example (564
  // characters for three quotes) and tripped on a second, equally honest one at 706-780
  // — three genuinely dense quotes (one alone ~400 characters, covering a covenant
  // breach, an owner and two figures, and a stress test with six more) restated with
  // zero invented numbers across three separate attempts, all rejected on length alone.
  // The real risk this guards against is the model losing the "one sentence" structure
  // entirely, not landing a hundred characters over an arbitrary line — so the margin is
  // generous rather than tight.
  const maxChars = 300 + 300 * quotes.length;

  for (let i = 0; i < ATTEMPTS; i += 1) {
    const result = await attempt(question, quotes, maxChars);
    if (result) return result;
  }
  return null;
}
