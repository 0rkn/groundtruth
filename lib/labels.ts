/**
 * The labelled answer set, and how a retrieval result is scored against it.
 *
 * A question is answered if the retrieved text CONTAINS one of its answer phrases.
 * That is the whole test.
 *
 * Labels are phrases rather than chunk ids on purpose. A sentence is the same sentence
 * at 80 words or whole-page, so one label set scores every configuration with nothing
 * to re-resolve, and a chunk that carries the answer counts whether or not it is the
 * chunk anyone would have picked.
 */

export interface AnswerSet {
  client: string;
  note: string;
  /** null means nothing in these documents answers the question — an abstention case. */
  answers: Record<string, string[] | null>;
}

/** Whitespace-insensitive, because extraction re-wraps lines unpredictably. */
export const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

export function contains(haystack: string, phrase: string): boolean {
  return normalise(haystack).includes(normalise(phrase));
}

/**
 * A chunk that is mostly table pipes.
 *
 * Tracked because it separates two different failures that look identical in a score:
 * retrieval ranking the right passage too low, and the answer living only inside a
 * table that extraction has flattened into something unsearchable. The second is
 * Stage 2's territory — figures are computed from tables in code precisely because
 * they cannot be read as prose — and no amount of retrieval tuning fixes it.
 */
export function isTableText(text: string): boolean {
  const pipes = (text.match(/\|/g) ?? []).length;
  return pipes / Math.max(1, text.length) > 0.01;
}

export interface QuestionResult {
  id: string;
  /** An answer phrase appeared in the text delivered within the budget. */
  found: boolean;
  /** Share of this question's phrases present in the delivered text. */
  recall: number;
  /** 1-based rank of the first delivered chunk carrying a phrase; 0 if none. */
  rank: number;
  /** Why it failed, when it did. */
  reason?: "below the budget cutoff" | "never retrieved" | "answer only exists in a table";
}

/**
 * Score one question.
 *
 * `delivered` is what fits the word budget; `retrieved` is the full deep result. The
 * difference between them is what separates a ranking failure from a retrieval failure,
 * and those need opposite fixes.
 */
export function scoreQuestion(
  id: string,
  phrases: string[],
  delivered: { id: string; text: string }[],
  retrieved: { id: string; text: string }[],
): QuestionResult {
  const hit = (chunks: { text: string }[]) =>
    phrases.filter((p) => chunks.some((c) => contains(c.text, p)));

  const inBudget = hit(delivered);
  const rank = delivered.findIndex((c) => phrases.some((p) => contains(c.text, p))) + 1;

  if (inBudget.length > 0) {
    return { id, found: true, recall: inBudget.length / phrases.length, rank };
  }

  const deeper = hit(retrieved);
  const onlyInTables = retrieved
    .filter((c) => phrases.some((p) => contains(c.text, p)))
    .every((c) => isTableText(c.text));

  return {
    id,
    found: false,
    recall: 0,
    rank: 0,
    reason: deeper.length > 0
      ? (onlyInTables ? "answer only exists in a table" : "below the budget cutoff")
      : "never retrieved",
  };
}
