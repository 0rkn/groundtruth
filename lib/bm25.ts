/**
 * BM25, and fusing it with dense retrieval.
 *
 * WHY THIS EXISTS, and it is a specific diagnosis rather than a hunch. Retrieval's worst
 * cases here are questions whose evidence is a recorded ABSENCE — "there is no board
 * skills matrix", "no evaluation has ever been carried out", "there is no conflicts
 * register". Those are 44% of Brambleside's labelled questions and 61% of Northgate's,
 * and they are the most valuable sentences in a board appraisal.
 *
 * A cross-encoder reranker was measured demoting exactly those: -0.100 MRR on absence
 * evidence against -0.009 on positive evidence, an eleven-fold difference. The reason is
 * that it is trained to judge whether a passage ANSWERS a question, and "there is no X"
 * reads as a non-answer to "does the board do X?". Correct for web search, wrong for an
 * appraisal.
 *
 * BM25 has the opposite property, and it is the property that matters: it is BLIND TO
 * POLARITY. "There is no board skills matrix" still contains `board`, `skills` and
 * `matrix`, so it scores on topic whatever the sentence goes on to say. What is normally
 * BM25's weakness against a semantic model is, for this corpus, the whole point.
 *
 * It is also deterministic and needs no model call, so it cannot threaten the
 * byte-identical questionnaire the cache depends on.
 *
 * Pure arithmetic. No I/O, no network.
 */

/** Standard defaults from the literature, deliberately NOT tuned. With 39 and 46
 *  questions, fitting k1 and b would be fitting noise, and a tuned constant that cannot
 *  be justified is worse than a conventional one that can. */
const K1 = 1.2;
const B = 0.75;

/**
 * Words that carry no topic.
 *
 * Kept deliberately short. Every appraisal question opens "The board...", so those stems
 * appear in all 48 queries and in most passages, contributing nothing but noise to the
 * lexical match — the same observation that motivated the probe-wording experiment.
 * Negation words are NOT here: `no`, `not` and `never` are content in this corpus, since
 * an absence is the evidence.
 */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "were",
  "be", "been", "it", "its", "that", "this", "these", "those", "with", "as", "at", "by",
  "from", "has", "have", "had", "board", "boards",
]);

export const tokenise = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t));

export interface Bm25Index {
  score(queryText: string): number[];
  size: number;
}

/** Build an index over a fixed set of documents. Order of the returned scores matches. */
export function buildBm25(documents: string[]): Bm25Index {
  const docs = documents.map(tokenise);
  const lengths = docs.map((d) => d.length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / Math.max(1, docs.length);

  // Term frequency per document, and document frequency across the collection.
  const termFrequency = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of d) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const documentFrequency = new Map<string, number>();
  for (const tf of termFrequency) {
    for (const t of tf.keys()) documentFrequency.set(t, (documentFrequency.get(t) ?? 0) + 1);
  }

  const N = docs.length;
  return {
    size: N,
    score(queryText) {
      const terms = tokenise(queryText);
      return termFrequency.map((tf, i) => {
        let s = 0;
        for (const t of terms) {
          const f = tf.get(t);
          if (!f) continue;
          const df = documentFrequency.get(t) ?? 0;
          // Robertson/Sparck Jones idf with the +0.5 smoothing, so a term in every
          // document contributes ~0 rather than a negative score.
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * lengths[i]) / avgLength)));
        }
        return s;
      });
    },
  };
}

/**
 * Reciprocal rank fusion.
 *
 * Ranks are combined rather than scores, because dense cosine and BM25 are on
 * incomparable scales and any normalisation between them would be a free parameter to
 * tune — which, at this sample size, means a parameter to overfit. RRF needs only the
 * orderings.
 *
 * `k` is the conventional 60 from Cormack et al., left at its published default for the
 * same reason K1 and B are.
 */
export function reciprocalRankFusion(
  rankings: number[][],
  count: number,
  k = 60,
): number[] {
  const fused = new Array<number>(count).fill(0);
  for (const ranking of rankings) {
    ranking.forEach((itemIndex, position) => {
      fused[itemIndex] += 1 / (k + position + 1);
    });
  }
  return fused;
}

/** Indices of `scores`, best first. */
export const order = (scores: number[]): number[] =>
  scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
