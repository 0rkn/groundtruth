/**
 * Stage 4.0 gate: the labelled answer set.
 *
 *   npm run check:fixtures              print the set
 *   npm run check:fixtures -- --assert  also assert it is sound
 *
 * Every retrieval number is scored against this file, so a bad label here is invisible
 * downstream — it would simply look like a bad retriever. Hence the checks below: every
 * phrase must be a literal quotation, long enough not to match by chance, and rare
 * enough not to be trivially retrievable.
 *
 * No model, no network.
 */
import { readFile, readdir } from "node:fs/promises";
import { extractDocument, flatten, type Document } from "../lib/extract.ts";
import { isTableText, normalise, type AnswerSet } from "../lib/labels.ts";
import { QUESTIONS } from "../data/questions.ts";
import { eligiblePassages } from "../lib/passages.ts";

const ASSERT = process.argv.includes("--assert");

let failures = 0;
const fail = (m: string) => { failures += 1; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

const set: AnswerSet = JSON.parse(await readFile("fixtures/answers.json", "utf8"));

const docs: Document[] = [];
for (const f of (await readdir("../client-set-a")).filter((x) => x.endsWith(".pdf")).sort()) {
  docs.push(await extractDocument(Buffer.from(await readFile(`../client-set-a/${f}`)), f));
}

/** Only eligible documents: the previous review is not searchable evidence. */
const corpus = normalise(
  docs.filter((d) => !d.filename.startsWith("05")).map((d) => flatten(d.text)).join(" "),
);
const passages = eligiblePassages(docs);

const entries = Object.entries(set.answers);
const answerable = entries.filter(([, p]) => p !== null) as [string, string[]][];
const abstention = entries.filter(([, p]) => p === null);
const phrases = answerable.flatMap(([, p]) => p);

console.log(`${"=".repeat(70)}\nStage 4.0 — labelled answer set (${set.client})\n${"=".repeat(70)}`);
console.log(`questions in the pool:      ${QUESTIONS.length}`);
console.log(`with an answer:             ${answerable.length}`);
console.log(`abstention (no answer here): ${abstention.length}`);
console.log(`answer phrases:             ${phrases.length}`);

// How many answers live only inside flattened tables. Not a fault in the labels — it
// is a property of the documents, and it bounds what retrieval can ever achieve.
const tableOnly = answerable.filter(([, ps]) =>
  ps.every((p) => passages.filter((x) => normalise(x.text).includes(normalise(p)))
    .every((x) => isTableText(x.text))),
);
console.log(`answers reachable only through table text: ${tableOnly.length}`);
for (const [id] of tableOnly) console.log(`  ${id}`);

if (!ASSERT) {
  console.log(`\n${"=".repeat(70)}\nPrinted only. Read these against the documents, then run with --assert.`);
  process.exit(0);
}

console.log("");

if (set.client !== "client-set-a") {
  fail("labels must be Brambleside only — Northgate is held out, and labelling it would end that");
} else {
  pass("labelled on Brambleside only, Northgate untouched");
}

// Every phrase must be a literal quotation. A paraphrase would silently never match.
let missing = 0;
for (const [id, ps] of answerable) {
  for (const p of ps) {
    if (!corpus.includes(normalise(p))) { fail(`${id}: "${p.slice(0, 60)}…" is not in the documents`); missing += 1; }
  }
}
if (!missing) pass(`all ${phrases.length} answer phrases appear verbatim in the documents`);

// Coverage of the pool: an unjudged question would be silently excluded from every score.
const bank = QUESTIONS.map((q) => q.id).sort();
const judged = Object.keys(set.answers).sort();
if (JSON.stringify(bank) !== JSON.stringify(judged)) {
  fail(`answer set does not match the pool — missing ${bank.filter((x) => !judged.includes(x)).join(",") || "none"}`);
} else {
  pass(`all ${bank.length} pool questions judged`);
}

// The abstention set is what makes a similarity cutoff measurable. Too few and AUC is
// meaningless; none at all and there is nothing for a cutoff to reject.
if (abstention.length < 10) fail(`only ${abstention.length} abstention questions — too few to measure a cutoff`);
else pass(`${abstention.length} abstention questions, enough to measure a cutoff`);

// A phrase short enough to appear by accident would mark a wrong chunk as correct.
const tooShort = phrases.filter((p) => normalise(p).length < 25);
if (tooShort.length) fail(`${tooShort.length} phrase(s) under 25 characters could match by chance: "${tooShort[0]}"`);
else pass("every phrase is long enough to be unambiguous");

// A phrase appearing many times over would be trivially retrievable.
const common = phrases.filter((p) => corpus.split(normalise(p)).length - 1 > 2);
if (common.length) fail(`${common.length} phrase(s) appear more than twice: "${common[0]?.slice(0, 50)}…"`);
else pass("no phrase appears more than twice in the corpus");

console.log(`\n${"=".repeat(70)}`);
console.log(failures === 0 ? "STAGE 4.0 GATE: PASSED" : `STAGE 4.0 GATE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
