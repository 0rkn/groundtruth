/**
 * Scoring a ranked retrieval against the page-level relevance labels.
 *
 * WHY PAGES AND NOT PHRASES. The previous label set was verbatim answer phrases, scored
 * by substring. That has a defect that is invisible in the output: the unit being judged
 * changes with the configuration being judged. A phrase that a 140-word chunk holds
 * whole can be cut in half by a semantic boundary, and the configuration is then marked
 * wrong for a labelling artefact rather than for a retrieval failure. A page is the same
 * page under every strategy, so one label set scores all of them on equal terms — and a
 * page is the unit the questionnaire cites, so a hit here means the same thing the
 * product means.
 *
 * THREE METRICS, chosen against what the product does with the result:
 *
 *   hit@1  — the questionnaire shows ONE quote per question, so this is the number that
 *            corresponds to the user-visible outcome. It is the strictest and the most
 *            important.
 *   hit@5  — whether the evidence is anywhere a human would still see it.
 *   MRR    — the most sensitive of the three to a change in ranking, and therefore the
 *            one worth comparing configurations on. Misses score 0.
 *
 *   recall@5 — of the pages labelled relevant for a question, what SHARE appear in the
 *            top 5. hit@5 asks whether any relevant page landed; this asks how many.
 *
 * WHY recall@5 IS HERE, having been left out of the first version. It was omitted on the
 * argument that the questionnaire shows one quote, so finding three relevant pages is
 * not three times better than finding one. That argument was wrong about the product.
 * The evidence lines worth writing are LAYERED — "247 pages across 14 papers, nine of
 * the fourteen for noting, against 300 minutes of agenda time" is three figures from
 * three places, and a question is allowed to carry several sources for exactly this.
 * A metric that scores only the first relevant page cannot tell a configuration that
 * supplies the material for that sentence from one that supplies a third of it.
 *
 * It is not a free addition: it changes which configuration wins. Larger chunks cover
 * more ground per slot, so a row can have the worst hit@1 and the best coverage at the
 * same time — which is exactly what the size ladder did.
 */

/** A retrieved item, reduced to what scoring needs. */
export interface Retrieved {
  document: string;
  page: number;
  score: number;
}

export interface RelevanceLabels {
  documents: Record<string, string>;
  labels: Record<string, { pages: string[]; why: string } | null>;
}

/** "03:2" -> the token this file uses internally, from a passage's own fields. */
export const token = (documents: Record<string, string>, r: Retrieved): string => {
  const key = Object.keys(documents).find((k) => documents[k] === r.document);
  return `${key ?? r.document}:${r.page}`;
};

export interface QuestionScore {
  id: string;
  /** 1-based rank of the first relevant page; 0 if none was retrieved at all. */
  rank: number;
  hit1: boolean;
  hit5: boolean;
  /** 1/rank, or 0. Kept per-question because the paired tests need the vector. */
  rr: number;
  /** Share of this question's labelled pages present in the top 5. Layering needs this. */
  recall5: number;
  /** How many pages this question was labelled with, so recall is interpretable. */
  labelled: number;
  /** Top-1 similarity, which is what the abstention cutoff is decided on. */
  topScore: number;
}

/**
 * Score one question's ranking.
 *
 * `ranked` must be in the order the configuration produced, best first — after any
 * reranking, since the reranker's whole purpose is to change this order.
 */
export function scoreRanking(
  id: string,
  relevantPages: string[],
  ranked: Retrieved[],
  documents: Record<string, string>,
): QuestionScore {
  const wanted = new Set(relevantPages);
  const rank = ranked.findIndex((r) => wanted.has(token(documents, r))) + 1;

  // Distinct labelled pages covered by the top 5. Distinct matters: two chunks off the
  // same page are one page of evidence, and counting them twice would let a chunking
  // that fragments a page score as though it had found more.
  const coveredInTop5 = new Set(
    ranked.slice(0, 5).map((r) => token(documents, r)).filter((t) => wanted.has(t)),
  );

  return {
    id,
    rank,
    hit1: rank === 1,
    hit5: rank > 0 && rank <= 5,
    rr: rank > 0 ? 1 / rank : 0,
    recall5: relevantPages.length ? coveredInTop5.size / relevantPages.length : Number.NaN,
    labelled: relevantPages.length,
    topScore: ranked[0]?.score ?? 0,
  };
}

export interface Summary {
  n: number;
  hit1: number;
  hit5: number;
  mrr: number;
  recall5: number;
  /** Questions labelled with 2+ pages — the ones where layering is even possible. */
  layerable: number;
  /** recall@5 over just those, since it is the only place the metric can move. */
  recall5Layerable: number;
  /** Questions where no relevant page appeared anywhere in the candidate list. */
  missed: number;
}

export function summarise(scores: QuestionScore[]): Summary {
  const n = scores.length;
  const mean = (f: (s: QuestionScore) => number) =>
    n ? scores.reduce((a, s) => a + f(s), 0) / n : Number.NaN;
  const layerable = scores.filter((s) => s.labelled >= 2);
  return {
    n,
    hit1: mean((s) => (s.hit1 ? 1 : 0)),
    hit5: mean((s) => (s.hit5 ? 1 : 0)),
    mrr: mean((s) => s.rr),
    recall5: mean((s) => s.recall5),
    layerable: layerable.length,
    recall5Layerable: layerable.length
      ? layerable.reduce((a, s) => a + s.recall5, 0) / layerable.length
      : Number.NaN,
    missed: scores.filter((s) => s.rank === 0).length,
  };
}
