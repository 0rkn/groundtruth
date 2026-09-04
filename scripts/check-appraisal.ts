/**
 * Stage 7 gate: the whole pipeline, end to end, twice.
 *
 *   npm run check:appraisal
 *   npm run check:appraisal -- --assert
 *   npm run check:appraisal -- --client-b
 *
 * Every stage is tested on its own elsewhere. What this catches is the thing those tests
 * cannot: correct parts wired together wrongly, producing a result that still looks
 * plausible. It also proves the promise the product makes — the same documents give the
 * same questionnaire — which comes from the cache rather than from the model.
 *
 * The first run is slow (a couple of minutes; generation dominates). The second should be
 * near-instant and byte-identical. If the second run is slow, the cache key is wrong.
 */
import { readFile, readdir } from "node:fs/promises";
import { runAppraisal, type Upload } from "../lib/run-appraisal.ts";
import { appraisalKey } from "../lib/cache.ts";
import { extractDocument } from "../lib/extract.ts";

const ASSERT = process.argv.includes("--assert");
const SET = process.argv.includes("--client-b") ? "client-set-b" : "client-set-a";

let failures = 0;
const fail = (m: string) => { failures += 1; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

const uploads: Upload[] = [];
for (const f of (await readdir(`../${SET}`)).filter((x) => x.endsWith(".pdf")).sort()) {
  uploads.push({ filename: f, bytes: Buffer.from(await readFile(`../${SET}/${f}`)) });
}

console.log(`${"=".repeat(74)}\nStage 7 — full pipeline and caching (${SET})\n${"=".repeat(74)}`);

const t1 = Date.now();
const first = await runAppraisal(uploads, (step, done, total) =>
  console.log(`  [${done}/${total}] ${step}`),
);
const firstSeconds = Math.round((Date.now() - t1) / 1000);
console.log(`\nfirst run: ${firstSeconds}s, cached=${first.cached}`);

const t2 = Date.now();
const second = await runAppraisal(uploads);
const secondSeconds = Math.round((Date.now() - t2) / 1000);
console.log(`second run: ${secondSeconds}s, cached=${second.cached}`);

// -------------------------------------------------------------------- the result

console.log(`\n${"=".repeat(74)}`);
console.log(`as of: ${first.asOf ?? "unknown"}`);
console.log(`documents: ${first.documents.map((d) => `${d.filename} (${d.pages}p)`).join(", ")}`);
console.log(`signals: ${first.signals.join(", ")}`);
console.log(
  `\n${first.questionCount} questions: ${first.counts.evidenced} evidenced, ${first.counts.standard} standard`,
);
for (const t of first.themes) {
  console.log(
    `  ${t.name.padEnd(12)} ${t.questions.length} questions — ` +
      `${t.counts.evidenced} evidenced, ${t.counts.standard} standard`,
  );
}

console.log(`\nevidence lines:`);
for (const t of first.themes) {
  for (const q of t.questions.filter((x) => x.state === "evidenced")) {
    console.log(`\n  [${t.name}] ${q.text}`);
    for (const s of q.sources ?? []) {
      console.log(`    "${s.quote.slice(0, 80)}" — ${s.document} p${s.page}`);
    }
  }
}

console.log(`\nfigures computed in code: ${first.figures.filter((f) => f.value !== null).length} of ${first.figures.length}`);

if (!ASSERT) {
  console.log(`\n${"=".repeat(74)}\nPrinted only. Read these, then run with --assert.`);
  process.exit(0);
}

console.log("");

// The promise the product makes.
const a = JSON.stringify({ ...first, cached: null });
const b = JSON.stringify({ ...second, cached: null });
if (a !== b) fail("the two runs differ — the same documents did not give the same questionnaire");
else pass("byte-identical across two runs");

if (!second.cached) fail("the second run was not a cache hit, so the key does not match its own inputs");
else pass("second run served from cache");

if (second.cached && secondSeconds > 20) {
  fail(`second run took ${secondSeconds}s despite hitting the cache`);
} else {
  pass(`second run returned in ${secondSeconds}s`);
}

// A key that ignores the documents would serve one client's appraisal for another's.
const original = await Promise.all(uploads.map((u) => extractDocument(u.bytes, u.filename)));
const keyNow = appraisalKey(original.map((d) => d.text));
const keyChanged = appraisalKey(original.map((d, i) => (i === 0 ? d.text + " altered" : d.text)));
if (keyNow === keyChanged) fail("changing a document's text did not change the cache key");
else pass("changing any document changes the cache key");

const keyReordered = appraisalKey([...original.map((d) => d.text)].reverse());
if (keyNow !== keyReordered) fail("upload order changes the cache key, so the same documents miss");
else pass("upload order does not change the cache key");

// Structural guarantees the interface relies on and cannot check for itself.
for (const t of first.themes) {
  for (const q of t.questions) {
    if (q.scaleLabels.length !== 5) fail(`${q.id} does not carry five scale labels`);
    if (q.scaleLabels.some((l) => !l || /n\/?a/i.test(l))) fail(`${q.id} has an unlabelled or N/A scale point`);
    if (q.state === "evidenced" && !q.sources?.length) fail(`${q.id} is evidenced with no sources`);
    if (q.state !== "evidenced" && q.sources?.length) fail(`${q.id} is ${q.state} but carries sources`);
    for (const s of q.sources ?? []) {
      if (!s.quote) fail(`${q.id} has a source with no quote`);
    }
  }
}
pass("every question carries five labelled scale points and a state consistent with its content");

const total = first.themes.reduce((n, t) => n + t.questions.length, 0);
if (total !== first.questionCount) fail(`themes hold ${total} questions but the count says ${first.questionCount}`);
else if (first.questionCount < 45 || first.questionCount > 50) {
  fail(`${first.questionCount} questions, outside the client's stated 45-50`);
} else {
  pass(`${first.questionCount} questions, inside the stated 45-50`);
}

if (first.counts.standard === 0) fail("no standard questions — suspicious for a 45-50 question run");
else pass(`${first.counts.standard} questions correctly standard rather than gaps`);

console.log(`\n${"=".repeat(74)}`);
console.log(failures === 0 ? "STAGE 7 GATE: PASSED" : `STAGE 7 GATE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
