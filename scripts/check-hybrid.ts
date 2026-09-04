/**
 * Does adding BM25 to dense retrieval fix the absence-evidence failure?
 *
 *   npm run check:hybrid
 *
 * THE HYPOTHESIS, stated before the numbers exist. Questions whose evidence is a
 * recorded absence are retrieved worse than questions whose evidence is a positive
 * statement, because an embedding of "does the board assess its skills?" sits closer to
 * a passage describing a skills audit than to one saying there is no skills matrix. BM25
 * is blind to polarity, so it should recover those specifically.
 *
 * The prediction that makes this falsifiable: hybrid should improve ABSENCE questions
 * more than POSITIVE ones. A uniform improvement across both would mean BM25 is helping
 * for some unrelated reason and the diagnosis is wrong.
 *
 * Run on BOTH clients, because the whole point of the exercise is that the reranker
 * looked excellent on one client and failed on the other. A fix that only works on the
 * client it was designed against has not been tested, it has been fitted.
 *
 * No generation calls. BM25 is arithmetic; only the query embeddings and the Vectorize
 * lookups cost anything, and both are already paid for.
 */
import { readFile, readdir } from "node:fs/promises";
import { extractDocument, type Document } from "../lib/extract.ts";
import { eligibleDocuments } from "../lib/passages.ts";
import { fixedSize } from "../lib/chunkers.ts";
import { embed, query } from "../lib/cf.ts";
import { select } from "../lib/select.ts";
import { buildBm25, reciprocalRankFusion, order } from "../lib/bm25.ts";
import { scoreRanking, summarise, type QuestionScore } from "../lib/eval/relevance.ts";
import { pairedDifference } from "../lib/eval/stats.ts";

const CANDIDATES = 20;

/** An evidence line phrased as an absence. Matched on the label's own summary. */
const ABSENCE = /\b(no|not|never|none|without|lack|absent|nothing|nor)\b/i;

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const fmt = (d: { mean: number; lo: number; hi: number; measurable: boolean }) =>
  `${d.mean >= 0 ? "+" : ""}${d.mean.toFixed(3)} [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]` +
  (d.measurable ? "  MEASURABLE" : "");

interface Variant { label: string; scores: QuestionScore[] }

console.log("=".repeat(78));
console.log("Hybrid retrieval — does BM25 recover absence evidence?");
console.log("=".repeat(78));

for (const client of ["a", "b"]) {
  const set = JSON.parse(await readFile(`fixtures/relevance-${client}.json`, "utf8"));

  const docs: Document[] = [];
  for (const f of (await readdir(`../client-set-${client}`)).filter((x) => x.endsWith(".pdf")).sort()) {
    docs.push(await extractDocument(Buffer.from(await readFile(`../client-set-${client}/${f}`)), f));
  }
  const eligible = eligibleDocuments(docs);
  const passages = (await Promise.all(eligible.map((d) => fixedSize.chunk(d)))).flat();
  const byId = new Map(passages.map((p) => [p.id, p]));

  const questions = select(docs).questions
    .map((q) => ({
      id: q.id,
      text: q.text,
      pages: set.labels[q.id]?.pages as string[] | undefined,
      absence: ABSENCE.test(set.labels[q.id]?.why ?? ""),
    }))
    .filter((q): q is { id: string; text: string; pages: string[]; absence: boolean } => Boolean(q.pages));

  // BM25 runs over the SAME passages the dense index holds, so the two rankings are
  // fusable and any difference is the retrieval method rather than the corpus.
  const bm25 = buildBm25(passages.map((p) => `${p.heading ? p.heading + ". " : ""}${p.text}`));
  const vectors = await embed(questions.map((q) => q.text));
  const namespace = `${client}-fixed-140-words-d`;
  const bare = (id: string) => id.slice(id.indexOf("--") + 2);

  const dense: QuestionScore[] = [];
  const lexical: QuestionScore[] = [];
  const hybrid: QuestionScore[] = [];

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];

    // Dense candidates, in Vectorize's order.
    const matches = await query(vectors[i], CANDIDATES, namespace);
    const denseRanked = matches.map((m) => byId.get(bare(m.id))).filter(Boolean) as typeof passages;
    const asRetrieved = (ps: typeof passages, scores?: number[]) =>
      ps.map((p, n) => ({ document: p.document, page: p.page, score: scores?.[n] ?? 1 - n / 100 }));

    dense.push(scoreRanking(q.id, q.pages, asRetrieved(denseRanked), set.documents));

    // BM25 over the whole passage set, top CANDIDATES.
    const lexicalOrder = order(bm25.score(q.text)).slice(0, CANDIDATES);
    lexical.push(scoreRanking(q.id, q.pages, asRetrieved(lexicalOrder.map((n) => passages[n])), set.documents));

    // Fusion needs both rankings expressed as indices into the same array.
    const indexOf = new Map(passages.map((p, n) => [p.id, n]));
    const denseIdx = denseRanked.map((p) => indexOf.get(p.id)!);
    const fused = reciprocalRankFusion([denseIdx, lexicalOrder], passages.length);
    const hybridOrder = order(fused).slice(0, CANDIDATES);
    hybrid.push(scoreRanking(q.id, q.pages, asRetrieved(hybridOrder.map((n) => passages[n])), set.documents));
  }

  const variants: Variant[] = [
    { label: "dense only", scores: dense },
    { label: "BM25 only", scores: lexical },
    { label: "hybrid (RRF)", scores: hybrid },
  ];

  const nAbsence = questions.filter((q) => q.absence).length;
  console.log(`\n${"-".repeat(78)}`);
  console.log(
    `client set ${client.toUpperCase()} — ${questions.length} questions, ` +
      `${nAbsence} with absence evidence, ${questions.length - nAbsence} positive`,
  );
  console.log("-".repeat(78));
  console.log(`${"method".padEnd(16)}${"hit@1".padStart(7)}${"hit@5".padStart(7)}${"MRR".padStart(8)}${"vs dense".padStart(26)}`);
  for (const v of variants) {
    const s = summarise(v.scores);
    const d = pairedDifference(v.scores.map((x) => x.rr), dense.map((x) => x.rr));
    console.log(
      v.label.padEnd(16) + pct(s.hit1).padStart(7) + pct(s.hit5).padStart(7) +
        s.mrr.toFixed(3).padStart(8) +
        (v.label === "dense only" ? "baseline".padStart(26) : fmt(d).padStart(26)),
    );
  }

  // The falsifiable part: the gain must be concentrated in absence questions.
  console.log(`\n  the prediction — hybrid should help ABSENCE questions more than positive ones`);
  for (const group of [true, false] as const) {
    const pick = <T,>(xs: T[]) => xs.filter((_, i) => questions[i].absence === group);
    const d = pairedDifference(pick(hybrid).map((x) => x.rr), pick(dense).map((x) => x.rr));
    const label = group ? "absence evidence" : "positive evidence";
    console.log(
      `  ${label.padEnd(20)} n=${String(pick(dense).length).padStart(2)}  ` +
        `dense ${summarise(pick(dense)).mrr.toFixed(3)} -> hybrid ${summarise(pick(hybrid)).mrr.toFixed(3)}   ${fmt(d)}`,
    );
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log("Printed only. The diagnosis stands or falls on whether the gain is");
console.log("concentrated in absence questions, on BOTH clients.");
