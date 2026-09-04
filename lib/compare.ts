/**
 * Pairing a recommendation to the figure that tests it — shape (d), rebuilt.
 *
 * WHY THIS EXISTS AGAIN. A version of this file existed earlier and was deleted in the
 * generation rewrite: it paired a recommendation to a figure by putting the whole
 * question list in the prompt and asking the model to route the pairing to a question,
 * which is a harder task than it needed to be and produced a wrong pairing — "cap the
 * performance report at twelve pages" matched against a bare "247 pages", the whole
 * pack rather than the performance report inside it.
 *
 * WHAT CHANGED THAT MAKES IT WORTH RETRYING. The figure that pairing needed did not
 * carry its own name at the time — `pages_per_paper` returned an anonymous "42 pages"
 * because the item names in the agenda table collapse on extraction. That has since
 * been fixed: `figures.ts` now attributes it by column position — "Longest paper in the
 * pack — Q1 Performance Report 2026/27: 42 pages" — so the figure that answers "cap the
 * performance report" now SAYS which report it is, rather than the model having to guess
 * from a bare number.
 *
 * WHAT IS DELIBERATELY NARROWER THIS TIME. No question routing. This only pairs a
 * recommendation to a figure, or decides none applies — it does not decide which of the
 * 48 questions the pairing belongs under. Routing was the least tested part of the
 * earlier version and not the part that failed; keeping it out until the pairing itself
 * is shown to work is not diluting the fix with an unrelated risk.
 */
import { generate } from "./cf.ts";
import type { Figure } from "./figures.ts";
import type { Commitment } from "./commitments.ts";

export interface Pairing {
  commitment: Commitment;
  figure: Figure | null;
}

function prompt(commitment: Commitment, figures: Figure[]): string {
  const lines = figures
    .filter((f) => f.value !== null)
    .map((f, i) => `${i + 1}. ${f.name}: ${f.value} ${f.unit}`)
    .join("\n");

  return `A board accepted this recommendation from its previous effectiveness review:

"${commitment.text}"

FIGURES COMPUTED FROM THE BOARD'S CURRENT DOCUMENTS:
${lines}

Does exactly one of these figures show whether this recommendation has been acted on? A
figure only counts if it measures the SAME thing the recommendation names — a page limit
on one specific paper is not tested by the total pack's page count, and a limit on
meeting length is not tested by a count of agenda items.

If one genuinely matches, reply with its number. If none does, reply with exactly: NONE

Reply with the number or NONE, and nothing else.`;
}

/** One recommendation, one call, at most one figure back. Never a sentence — a selection. */
export async function pairWithFigure(commitment: Commitment, figures: Figure[]): Promise<Figure | null> {
  const candidates = figures.filter((f) => f.value !== null);
  if (candidates.length === 0) return null;

  let reply: string;
  try {
    reply = (await generate(prompt(commitment, candidates), 20)).trim();
  } catch {
    return null;
  }

  if (/^\s*NONE\s*$/i.test(reply)) return null;

  const index = Number(reply.match(/\d+/)?.[0]) - 1;
  return candidates[index] ?? null;
}

/** Every commitment, paired where a figure genuinely tests it. Sequential — 14 small calls. */
export async function pairAll(commitments: Commitment[], figures: Figure[]): Promise<Pairing[]> {
  const out: Pairing[] = [];
  for (const commitment of commitments) {
    out.push({ commitment, figure: await pairWithFigure(commitment, figures) });
  }
  return out;
}
