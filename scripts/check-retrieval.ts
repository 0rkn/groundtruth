/**
 * Retrieval configuration sweep: chunking x reranker.
 *
 *   npm run check:retrieval                  set A, print the tables
 *   npm run check:retrieval -- --client=b     the held-out confirmation
 *   npm run check:retrieval -- --assert       also assert
 *
 * THE TEST, in one sentence: for each appraisal question, how high does the first page
 * that genuinely carries its evidence rank?
 *
 * WHY THIS REPLACED THE PREVIOUS SWEEP. The old test scored verbatim answer phrases by
 * substring, under a 1,000-word budget, over a 4,399-word corpus. Three things were
 * wrong with that and each of them alone is enough to invalidate a comparison:
 *
 *   1. THE BUDGET LEFT NOTHING TO MEASURE. 1,000 words of a 4,399-word corpus is 23% of
 *      everything that exists, and a top-32 of 51 chunks is 63% of them. Under those
 *      conditions every configuration retrieves nearly everything and near-total recall
 *      is available to all of them, so chunking and a reranker have almost
 *      nothing left to influence. Differences of one or two questions were noise.
 *
 *   2. THE UNIT OF JUDGEMENT MOVED WITH THE THING BEING JUDGED. A phrase that a
 *      140-word chunk holds whole can be cut in half by a semantic boundary, and the
 *      configuration is then marked wrong for a labelling artefact. Labels here are
 *      PAGES, which are the same under every strategy and are what the questionnaire
 *      cites.
 *
 *   3. THE WINNER WAS PICKED BY ARGMAX. Ten rows, ~37 items, no intervals. At this n a
 *      single rate carries about +/-15 points, so reading the table and taking the
 *      largest number is how a configuration gets fitted to a test set.
 *
 * WHAT IS MEASURED INSTEAD, and where the numbers are taken:
 *
 * hit@1 and hit@5 at the RANK POSITIONS THE PRODUCT USES. The questionnaire shows one
 * quote per question, so hit@1 is the user-visible outcome and the number that decides
 * this. MRR is reported alongside because it is the most sensitive of the three to a
 * change in ranking and therefore the fairest basis for comparing configurations.
 *
 * Every cell answers the SAME questions, so every comparison is PAIRED and reported as
 * a difference with a bootstrap interval. Where the interval spans zero the report says
 * "no measurable difference" — which is a result, not a failure to find one. That rule
 * is set here, before the numbers exist, rather than chosen after seeing them.
 *
 * Runtime is dominated by index settling: 14 namespaces per client, so allow 20-30
 * minutes cold.
 */
import { readFile, readdir, appendFile, writeFile } from "node:fs/promises";
import { extractDocument, type Document } from "../lib/extract.ts";
import { indexPassages } from "../lib/retrieve.ts";
import { eligibleDocuments } from "../lib/passages.ts";
import { CHUNKERS, fixedSize, type Chunker } from "../lib/chunkers.ts";
import { embeddableText } from "../lib/embeddable.ts";
import { embed, query, rerank } from "../lib/cf.ts";
import { select } from "../lib/select.ts";
import {
  scoreRanking,
  summarise,
  type QuestionScore,
  type RelevanceLabels,
} from "../lib/eval/relevance.ts";
import { pairedDifference, mcnemar, proportionInterval } from "../lib/eval/stats.ts";

const ASSERT = process.argv.includes("--assert");
const CLIENT = (process.argv.find((a) => a.startsWith("--client="))?.slice(9) ?? "a").toLowerCase();

/**
 * The reranker is opt-in for the same reason, and the ORDER is the point.
 *
 * The reranker only reorders what dense retrieval produced. Chunking is measured on its
 * own first, with nothing downstream able to mask or flatter it, and the reranker is
 * measured second, against each chunking's own dense ranking.
 */
const RERANK = process.argv.includes("--rerank");


/**
 * Index the OTHER client's documents alongside this one, as decoys.
 *
 * WHY. On one client the corpus is 51 chunks and 20 candidates are requested, so dense
 * retrieval returns roughly 40% of everything that exists and hit@5 sits between 74% and
 * 90%. Near a ceiling like that most configurations converge, and real differences are
 * small against the +/-15 point noise of 39 questions. Doubling the haystack with a
 * plausible but wrong organisation gives the ranking problem room to separate them.
 *
 * WHAT IT IS AND IS NOT. This is a stress test, not the production task: the product
 * indexes one client at a time, so a configuration that wins here is the more ROBUST
 * one, not necessarily the better one for the real job. Both numbers are reported and
 * the single-client one stays the headline.
 *
 * The decoys are a good test because the two clients are nothing alike — a housing
 * association and a payments company — so retrieving a decoy page is unambiguously
 * wrong rather than arguably relevant.
 */
const POOL = process.argv.includes("--pool");

/**
 * Restrict the sweep to some chunkings, by substring of their label.
 *
 * Building indexes is the slow and failure-prone part, and this script only prints at
 * the end — so a crash in the fourteenth index loses the thirteen before it, which is
 * exactly what happened. Running in batches of three or four bounds that loss.
 *
 * Indexes persist, and a namespace already built settles in about three seconds, so the
 * batches are for building and the final unrestricted run is for scoring. That run
 * produces one coherent table with every cell compared to the same baseline, which
 * separate per-batch tables could not.
 */
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? [];
const wanted = (c: Chunker) => ONLY.length === 0 || ONLY.some((o) => c.label.includes(o));

/** Where each cell is appended as it finishes, so a crash keeps what it had measured. */
const PROGRESS = `.scratch/cells-${(process.argv.find((a) => a.startsWith("--client="))?.slice(9) ?? "a")}${process.argv.includes("--pool") ? "-pool" : ""}.jsonl`;

/** Dense candidates handed to the reranker, and the depth every metric is taken within. */
const CANDIDATES = 20;

let failures = 0;
const fail = (m: string) => { failures += 1; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);
const words = (s: string) => (s.match(/\S+/g) ?? []).length;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

// --------------------------------------------------------------------------- inputs

const dir = `../client-set-${CLIENT}`;
const set: RelevanceLabels & { organisation: string } = JSON.parse(
  await readFile(`fixtures/relevance-${CLIENT}.json`, "utf8"),
);

const docs: Document[] = [];
for (const f of (await readdir(dir)).filter((x) => x.endsWith(".pdf")).sort()) {
  docs.push(await extractDocument(Buffer.from(await readFile(`${dir}/${f}`)), f));
}
const own = eligibleDocuments(docs);
const chosen = select(docs);

/**
 * Decoy documents, with their filenames PREFIXED.
 *
 * The prefix is load-bearing, not cosmetic. Both clients name their files identically —
 * `01-corporate-plan.pdf`, `02-risk-register.pdf` — and relevance is scored on a
 * `document:page` token resolved through `set.documents`. Without a prefix a decoy page
 * would resolve to the same token as the labelled page it is standing in for, and every
 * decoy hit would be counted as a correct answer. The whole stress test would then
 * report near-perfect retrieval, and the harder the task got the better it would look.
 *
 * With the prefix a decoy's filename is absent from `set.documents`, so `token()` falls
 * back to the raw filename and can never match a label.
 */
const decoys: Document[] = [];
if (POOL) {
  const other = CLIENT === "a" ? "b" : "a";
  for (const f of (await readdir(`../client-set-${other}`)).filter((x) => x.endsWith(".pdf")).sort()) {
    const d = await extractDocument(Buffer.from(await readFile(`../client-set-${other}/${f}`)), f);
    decoys.push({ ...d, filename: `decoy-${other}--${f}` });
  }
}
const eligible = [...own, ...eligibleDocuments(decoys)];

/** Only questions with labelled evidence. Abstention cases are check-cutoff's business. */
const questions = chosen.questions
  .map((q) => ({ id: q.id, text: q.text, pages: set.labels[q.id]?.pages }))
  .filter((q): q is { id: string; text: string; pages: string[] } => Boolean(q.pages));

console.log("=".repeat(78));
console.log(`Retrieval sweep — ${set.organisation} (client set ${CLIENT.toUpperCase()})`);
console.log("=".repeat(78));
console.log(
  `${own.length} eligible documents, ${own.reduce((a, d) => a + d.pages.length, 0)} pages, ` +
    `${own.reduce((a, d) => a + words(d.text), 0)} words`,
);
if (POOL) {
  console.log(
    `POOLED: plus ${eligibleDocuments(decoys).length} decoy documents from the other client ` +
      `(${eligibleDocuments(decoys).reduce((a, d) => a + words(d.text), 0)} words). ` +
      `Every decoy page is a wrong answer by construction.`,
  );
}
console.log(
  `${questions.length} of ${chosen.questions.length} selected questions have labelled evidence; ` +
    `metrics are taken over those ${questions.length}\n`,
);

await writeFile(PROGRESS, "");
console.log(`per-cell results are appended to ${PROGRESS} as each one finishes
`);

// Probe vectors are embedded ONCE and reused across every cell, so a difference between
// two rows is the index, never a re-embedding of the question.
const probeVectors = await embed(questions.map((q) => q.text));
const vectorOf = new Map(questions.map((q, i) => [q.id, probeVectors[i]]));


// ----------------------------------------------------------------------------- cells

interface Cell {
  chunking: string;
  rerank: boolean;
  scores: QuestionScore[];
}

const cells: Cell[] = [];
const label = (c: Pick<Cell, "chunking" | "rerank">) => `${c.chunking}${c.rerank ? " +rr" : ""}`;

const slug = (s: string) => s.replace(/\W+/g, "-").replace(/^-|-$/g, "").toLowerCase();

for (const chunker of CHUNKERS.filter(wanted)) {
  const passages = (await Promise.all(eligible.map((d) => chunker.chunk(d)))).flat();
  const byId = new Map(passages.map((p) => [p.id, p]));
  const truncated = passages.filter((p) => words(p.text) > 350).length;

  {
    const namespace = `${CLIENT}-${slug(chunker.label)}-d${POOL ? "-pool" : ""}`;

    process.stdout.write(
      `indexing ${String(passages.length).padStart(3)} passages  ${label({ chunking: chunker.label, rerank: false }).padEnd(28)} `,
    );
    const t0 = Date.now();
    await indexPassages(passages, namespace, embeddableText);
    console.log(
      `${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s` +
        (truncated ? `   ${truncated} passage(s) over 350 words, silently truncated by bge-base` : ""),
    );

    // Ids come back namespace-prefixed; strip it to find the passage locally.
    const bare = (id: string) => id.slice(id.indexOf("--") + 2);

    // One dense ranking per question, reused by both the reranked and un-reranked cell
    // so the reranker is measured on exactly the candidates dense retrieval gave it.
    const dense = new Map<string, { document: string; page: number; score: number; text: string }[]>();
    for (const q of questions) {
      dense.set(
        q.id,
        (await query(vectorOf.get(q.id)!, CANDIDATES, namespace)).map((m) => {
          const p = byId.get(bare(m.id));
          return { document: p?.document ?? "", page: p?.page ?? 0, score: m.score, text: p?.text ?? "" };
        }),
      );
    }

    for (const useRerank of RERANK ? [false, true] : [false]) {
      const scores: QuestionScore[] = [];
      for (const q of questions) {
        let ranked = dense.get(q.id)!;
        if (useRerank && ranked.length) {
          const order = await rerank(q.text, ranked.map((c) => c.text));
          ranked = order.map((o) => ranked[o.index]);
        }
        scores.push(scoreRanking(q.id, q.pages, ranked, set.documents));
      }
      const cell = { chunking: chunker.label, rerank: useRerank, scores };
      cells.push(cell);

      // Report each cell AS IT COMPLETES, and append it to a resumable log.
      //
      // This script used to print only its final tables, so a crash in the last index
      // discarded every cell before it — which happened twice, once losing 25 minutes of
      // work three indexes from the end. A live line costs nothing and means a failed run
      // still leaves behind everything it had measured.
      const live = summarise(scores);
      console.log(
        `    -> ${label(cell).padEnd(28)} hit@1 ${pct(live.hit1).padStart(4)}  ` +
          `hit@5 ${pct(live.hit5).padStart(4)}  MRR ${live.mrr.toFixed(3)}  rec@5 ${pct(live.recall5Layerable).padStart(4)}`,
      );
      await appendFile(
        PROGRESS,
        JSON.stringify({ cell: label(cell), ...live, at: new Date().toISOString() }) + "\n",
      );
    }
  }
}

// --------------------------------------------------------------------------- results

const baseline = cells.find((c) => c.chunking === fixedSize.label && !c.rerank);
if (!baseline) {
  // Every difference is measured against the production configuration, so a batch that
  // excludes it can build indexes but cannot produce a comparison table.
  console.log(
    `
${"=".repeat(78)}
Indexes built. No table: this run excluded the baseline ` +
      `(${fixedSize.label}), and every difference is measured against it.
` +
      `Re-run without --only to score every cell against one baseline.
${"=".repeat(78)}`,
  );
  process.exit(0);
}
const rrOf = (c: Cell) => c.scores.map((s) => s.rr);
const h1Of = (c: Cell) => c.scores.map((s) => (s.hit1 ? 1 : 0));

console.log(`\n${"=".repeat(78)}`);
console.log(`all ${cells.length} configurations, ${questions.length} questions each`);
console.log(`baseline for every comparison: ${label(baseline)} (the production configuration)`);
console.log("=".repeat(78));
console.log(
  `${"configuration".padEnd(30)}${"hit@1".padStart(7)}${"hit@5".padStart(7)}${"MRR".padStart(7)}` +
    `${"rec@5".padStart(7)}${"d MRR vs baseline".padStart(20)}${"".padStart(4)}verdict`,
);

const sorted = [...cells].sort((a, b) => summarise(b.scores).mrr - summarise(a.scores).mrr);
for (const c of sorted) {
  const s = summarise(c.scores);
  const d = pairedDifference(rrOf(c), rrOf(baseline));
  const isBase = c === baseline;
  console.log(
    label(c).padEnd(30) +
      pct(s.hit1).padStart(7) +
      pct(s.hit5).padStart(7) +
      s.mrr.toFixed(3).padStart(7) +
      pct(s.recall5).padStart(7) +
      (isBase
        ? "baseline".padStart(20)
        : `${d.mean >= 0 ? "+" : ""}${d.mean.toFixed(3)} [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]`.padStart(20)) +
      "    " +
      (isBase ? "" : d.measurable ? (d.mean > 0 ? "BETTER" : "WORSE") : "no measurable difference"),
  );
}

/**
 * The same table ranked by COVERAGE instead of by first hit.
 *
 * These two metrics answer different product questions and can disagree, so both are
 * printed rather than one being folded into the other. MRR asks how fast the first
 * usable page arrives, which is what a single-quote evidence line needs. recall@5 asks
 * how much of a question's evidence is on the table at all, which is what a LAYERED
 * evidence line needs — and a layered line is the one worth writing.
 *
 * Restricted to the questions labelled with two or more pages, because a question with
 * one labelled page has recall of 1 or 0 and can only add noise to the average.
 */
const rec5Of = (c: Cell) => c.scores.filter((s) => s.labelled >= 2).map((s) => s.recall5);
const layerable = summarise(baseline.scores).layerable;

console.log(`\n${"=".repeat(78)}`);
console.log(`ranked by COVERAGE — recall@5 over the ${layerable} questions with 2+ labelled pages`);
console.log(`this is the metric a layered evidence line depends on, and it can disagree with MRR`);
console.log("=".repeat(78));
console.log(
  `${"configuration".padEnd(30)}${"rec@5 (2+)".padStart(12)}${"d vs baseline".padStart(24)}${"".padStart(4)}verdict`,
);

for (const c of [...cells].sort(
  (a, b) => summarise(b.scores).recall5Layerable - summarise(a.scores).recall5Layerable,
)) {
  const s = summarise(c.scores);
  const d = pairedDifference(rec5Of(c), rec5Of(baseline));
  const isBase = c === baseline;
  console.log(
    label(c).padEnd(30) +
      pct(s.recall5Layerable).padStart(12) +
      (isBase
        ? "baseline".padStart(24)
        : `${d.mean >= 0 ? "+" : ""}${d.mean.toFixed(3)} [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]`.padStart(24)) +
      "    " +
      (isBase ? "" : d.measurable ? (d.mean > 0 ? "BETTER" : "WORSE") : "no measurable difference"),
  );
}

// -------------------------------------------------------- the three factor questions

/** Isolate one factor by pairing cells that differ ONLY in it. */
function factor(
  title: string,
  note: string,
  pairs: { name: string; on: Cell | undefined; off: Cell | undefined }[],
) {
  const usable = pairs.filter((p) => p.on && p.off);
  if (usable.length === 0) return; // this factor was not run — see the flags at the top

  console.log(`\n${"=".repeat(78)}\n${title}\n${note}\n${"=".repeat(78)}`);
  console.log(
    `${"holding this fixed".padEnd(30)}${"MRR off".padStart(9)}${"MRR on".padStart(9)}` +
      `${"difference (95%)".padStart(24)}${"".padStart(4)}verdict`,
  );
  for (const p of usable) {
    if (!p.on || !p.off) continue;
    const d = pairedDifference(rrOf(p.on), rrOf(p.off));
    console.log(
      p.name.padEnd(30) +
        summarise(p.off.scores).mrr.toFixed(3).padStart(9) +
        summarise(p.on.scores).mrr.toFixed(3).padStart(9) +
        `${d.mean >= 0 ? "+" : ""}${d.mean.toFixed(3)} [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]`.padStart(24) +
        "    " +
        (d.measurable ? (d.mean > 0 ? "HELPS" : "HURTS") : "no measurable difference"),
    );
  }
}

const cell = (chunking: string, useRerank: boolean) =>
  cells.find((c) => c.chunking === chunking && c.rerank === useRerank);

factor(
  "1. CHUNKING — does the boundary rule matter?",
  "Every row is dense retrieval with no reranker, so the only thing\n" +
    "varying is where the chunk boundaries fall. Note that the three 'packed' rows are\n" +
    "the genuine size ladder: with heading splitting ON (the baseline row) a word target\n" +
    "barely bites, which is why an earlier sweep of 80/140/250 found nothing to find.",
  CHUNKERS.filter((c) => c !== fixedSize).map((c: Chunker) => ({
    name: `${c.label} vs baseline`,
    on: cell(c.label, false),
    off: baseline,
  })),
);

factor(
  "2. RERANKER — does the cross-encoder earn its call?",
  "Each row reorders exactly the candidates dense retrieval produced for that chunking,\n" +
    "so this measures better SELECTION and not more text.",
  CHUNKERS.map((c) => ({
    name: c.label,
    on: cell(c.label, true),
    off: cell(c.label, false),
  })),
);

// ----------------------------------------------------------------- the recommendation

console.log(`\n${"=".repeat(78)}\nwhat this supports\n${"=".repeat(78)}`);

const best = sorted[0];
const bestDiff = pairedDifference(rrOf(best), rrOf(baseline));
const bestH1 = summarise(best.scores);
const baseH1 = summarise(baseline.scores);
const interval = proportionInterval(Math.round(bestH1.hit1 * questions.length), questions.length);

console.log(`highest MRR:            ${label(best)}  (MRR ${bestH1.mrr.toFixed(3)}, hit@1 ${pct(bestH1.hit1)})`);
console.log(`its hit@1 95% interval: [${pct(interval.lo)}, ${pct(interval.hi)}]  — on ${questions.length} questions`);

// McNemar on the user-visible outcome, which is the one that decides whether to ship.
const bothScores = best.scores.map((s, i) => [s.hit1, baseline.scores[i].hit1] as const);
const bestOnly = bothScores.filter(([a, b]) => a && !b).length;
const baseOnly = bothScores.filter(([a, b]) => !a && b).length;
const m = mcnemar(bestOnly, baseOnly);
console.log(
  `\nagainst the production baseline (${label(baseline)}, MRR ${baseH1.mrr.toFixed(3)}, hit@1 ${pct(baseH1.hit1)}):`,
);
console.log(`  paired d MRR   ${bestDiff.mean >= 0 ? "+" : ""}${bestDiff.mean.toFixed(3)} [${bestDiff.lo.toFixed(3)}, ${bestDiff.hi.toFixed(3)}]`);
console.log(`  hit@1 changed  ${bestOnly} question(s) won, ${baseOnly} lost, ${m.discordant} discordant, McNemar p=${m.p.toFixed(3)}`);

if (!bestDiff.measurable && m.p >= 0.05) {
  console.log(
    `\n  READ THIS AS: the best row is not measurably better than the baseline. On ${questions.length}\n` +
      `  questions this corpus cannot separate them, so the honest recommendation is to keep\n` +
      `  the simplest configuration and not to pay for a reranker on the strength\n` +
      `  of a rank ordering that is within noise.`,
  );
} else {
  console.log(
    `\n  READ THIS AS: the difference survives a paired test, so it is worth acting on.\n` +
      `  Confirm it on the held-out client before shipping: npm run check:retrieval -- --client=b`,
  );
}

if (!ASSERT) {
  console.log(`\n${"=".repeat(78)}\nPrinted only. Read these, then run with --assert.`);
  process.exit(failures === 0 ? 0 : 1);
}

// ------------------------------------------------------------------------ assertions

console.log("");

// Determinism. The only thing asserted about the numbers themselves, because what
// counts as a good enough hit rate is a product judgement, and inventing a pass mark
// after seeing the table is how a gate stops meaning anything.
const ns = `${CLIENT}-${slug(fixedSize.label)}-d${POOL ? "-pool" : ""}`;
const r1 = (await query(probeVectors[0], 8, ns)).map((x) => x.id).join(",");
const r2 = (await query(probeVectors[0], 8, ns)).map((x) => x.id).join(",");
if (r1 !== r2) fail("the same probe gave two different rankings");
else pass("identical ranking across repeated queries");

// The bootstrap must be reproducible, or its intervals cannot be quoted.
const a = pairedDifference(rrOf(best), rrOf(baseline));
const b = pairedDifference(rrOf(best), rrOf(baseline));
if (a.lo !== b.lo || a.hi !== b.hi) fail("the bootstrap interval moved between two identical calls");
else pass("bootstrap intervals are reproducible");

// Every labelled page must be reachable, or a question is being scored against evidence
// no configuration could ever retrieve — which would look like a retrieval failure.
const allPages = new Set(
  eligible.flatMap((d) => {
    const key = Object.keys(set.documents).find((k) => set.documents[k] === d.filename);
    return d.pages.map((p) => `${key}:${p.number}`);
  }),
);
const unreachable = questions.flatMap((q) => q.pages.filter((p) => !allPages.has(p)));
if (unreachable.length) fail(`labelled pages that do not exist: ${[...new Set(unreachable)].join(", ")}`);
else pass("every labelled page exists in the eligible corpus");

console.log(`\n${"=".repeat(78)}`);
console.log(failures === 0 ? "RETRIEVAL SWEEP: PASSED" : `RETRIEVAL SWEEP: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
