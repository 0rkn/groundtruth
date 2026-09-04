/**
 * Retrieval metrics. Three numbers, and no more.
 *
 *   answer found — for how many questions did the retrieved text contain the answer?
 *   recall       — what share of each question's answer phrases came back?
 *   MRR          — how high up was the first chunk carrying an answer?
 *
 * All three are standard, and all three read without explanation, which is the point.
 * With 48 questions, every extra metric is another chance to find a difference that is
 * not real, so the set is deliberately small and fixed.
 *
 * Precision is deliberately absent. The word budget already caps how much noise reaches
 * the model, so precision has nothing to decide here. It earns its place at Stage 6,
 * when noise starts costing generation quality.
 *
 * Pure arithmetic. No I/O, no model.
 */
import type { QuestionResult } from "./labels.ts";

export interface Summary {
  /** Questions whose answer was retrieved, out of those that have one. */
  found: number;
  answerable: number;
  /** Mean share of answer phrases retrieved, over answerable questions. */
  recall: number;
  /** Mean reciprocal rank of the first answering chunk. Misses count as 0. */
  mrr: number;
  /** Why the misses missed. These need different fixes, so they are counted apart. */
  belowCutoff: number;
  neverRetrieved: number;
  tableOnly: number;
}

export function summarise(results: QuestionResult[]): Summary {
  const answerable = results.length;
  const found = results.filter((r) => r.found).length;
  const recall = answerable ? results.reduce((a, r) => a + r.recall, 0) / answerable : Number.NaN;
  const mrr = answerable
    ? results.reduce((a, r) => a + (r.rank > 0 ? 1 / r.rank : 0), 0) / answerable
    : Number.NaN;

  return {
    found,
    answerable,
    recall,
    mrr,
    belowCutoff: results.filter((r) => r.reason === "below the budget cutoff").length,
    neverRetrieved: results.filter((r) => r.reason === "never retrieved").length,
    tableOnly: results.filter((r) => r.reason === "answer only exists in a table").length,
  };
}

/**
 * How many of the top results fit in a word budget.
 *
 * This is how the cutoff is chosen, rather than a round number for k. Comparing chunk
 * sizes at a fixed k would compare different amounts of text — eight 80-word passages
 * is ~640 words, eight whole pages ~1,730 — letting a configuration win by being handed
 * more of the model's attention. Evaluating under a fixed budget is the standard way
 * round it.
 */
export function withinBudget<T>(
  ranked: T[],
  wordsOf: (item: T) => number,
  budget: number,
): T[] {
  const out: T[] = [];
  let used = 0;
  for (const item of ranked) {
    const w = wordsOf(item);
    if (used + w > budget && out.length > 0) break;
    out.push(item);
    used += w;
  }
  return out;
}

/**
 * Area under the ROC curve for the abstention decision.
 *
 * The probability that a question WITH an answer scores higher than one WITHOUT. 1.0 is
 * perfect separation, 0.5 is a coin flip. The standard rule of thumb is that a single
 * global cutoff needs roughly 0.80 before it is safe to act on — which gives Stage 4.4 a
 * pass mark rather than a threshold argued for after the fact.
 *
 * The 16 questions with no answer in these documents are what make this measurable at
 * all: without them there is nothing for a cutoff to reject.
 */
export function auc(withAnswer: number[], withoutAnswer: number[]): number {
  if (!withAnswer.length || !withoutAnswer.length) return Number.NaN;
  let wins = 0;
  for (const a of withAnswer) {
    for (const b of withoutAnswer) {
      if (a > b) wins += 1;
      else if (a === b) wins += 0.5;
    }
  }
  return wins / (withAnswer.length * withoutAnswer.length);
}
