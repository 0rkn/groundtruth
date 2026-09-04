/**
 * Stage 2 gate: computed figures.
 *
 *   npm run check:figures            print what each figure produced
 *   npm run check:figures -- --assert   also assert against hand-checked values
 *
 * No model, no network. Run without --assert first, read the output against the
 * documents by hand, and only then write the expected values in. Asserting first
 * and reading afterwards is how a parser gets blessed for producing the wrong thing.
 */
import { readFile, readdir } from "node:fs/promises";
import { extractDocument } from "../lib/extract.ts";
import { computeFigures, asOf, type DocType, type TypedDocument } from "../lib/figures.ts";

const ASSERT = process.argv.includes("--assert");

const TYPE_BY_PREFIX: Record<string, DocType> = {
  "01": "corporate_plan",
  "02": "risk_register",
  "03": "board_pack",
  "04": "board_calendar",
  "05": "previous_review",
};

/**
 * Hand-checked against the documents. `null` means the figure must NOT be produced,
 * which is as much a requirement as any number: Northgate's agenda table has no
 * Pages column, and neither client states a dated skills audit outside its previous
 * review, so both must come back absent rather than zero.
 */
const EXPECTED: Record<string, Record<string, { value: number | null; notable?: boolean }>> = {
  "client-set-a": {
    // "Total pack: 247 pages across 14 papers", against a 120-page threshold.
    pack_pages: { value: 247, notable: true },
    // Pages column: 2 14 18 42 31 26 19 / 22 17 16 9 11 18 2 — largest is 42.
    pages_per_paper: { value: 42, notable: true },
    // Issued Thu 9 July, meeting Wed 15 July = 4 working days. The document itself
    // says "four working days before the meeting; our standard is seven", so the
    // parser's arithmetic is confirmed independently by the prose.
    notice_days: { value: 4, notable: true },
    // "Nine of the fourteen items are for noting" = 64%.
    items_noting: { value: 64, notable: true },
    paper_summaries: { value: 4, notable: false },
    // Presented to the Board 24 January 2024, measured to 15 July 2026 = 30 months.
    // Under the 36-month threshold, but the calendar says a review is DUE, and the
    // client's own view wins — hence notable despite the count.
    months_since_review: { value: 30, notable: true },
    // Only stated inside the previous review, which is that consultant's finding.
    months_since_skills_audit: { value: null },
    // "Net score unchanged at 16 for four consecutive quarters."
    static_risks: { value: 1, notable: true },
    // "deferred once" — one deferral is ordinary business, so not notable.
    deferred_items: { value: 1, notable: false },
    // 10.00 to 15.00 in the Time column. The pack independently says "300 minutes of
    // agenda time", so the span is confirmed by the prose. Context only, never notable.
    agenda_minutes: { value: 300, notable: false },
  },
  "client-set-b": {
    // "Pack: 61 pages plus a 38 slide deck", under the threshold.
    pack_pages: { value: 61, notable: false },
    // This agenda table has no Pages column at all.
    pages_per_paper: { value: null },
    // Circulated Mon 15 June 22.40 for a Tue 16 June meeting = 1 working day,
    // against the five business days its constitution requires.
    notice_days: { value: 1, notable: true },
    items_noting: { value: 17, notable: false },
    // "Governance Health Check 2025", month unstated so mid-year, to 16 June 2026.
    months_since_review: { value: 12, notable: false },
    months_since_skills_audit: { value: null },
    // No cover sheets in this pack, and the register states no unmoved scores.
    paper_summaries: { value: null },
    static_risks: { value: null },
    deferred_items: { value: 1, notable: false },
    // 14.00 to 16.50, read across both agenda tables — the Time column sits at a
    // different index in the second, and reading only the first stopped it at 15.50.
    agenda_minutes: { value: 170, notable: false },
  },
};

let failures = 0;
const fail = (m: string) => { failures += 1; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

for (const set of ["client-set-a", "client-set-b"]) {
  console.log(`\n${"=".repeat(76)}\n${set}\n${"=".repeat(76)}`);

  const docs: TypedDocument[] = [];
  for (const file of (await readdir(`../${set}`)).filter((f) => f.endsWith(".pdf")).sort()) {
    const buffer = Buffer.from(await readFile(`../${set}/${file}`));
    const doc = await extractDocument(buffer, file);
    docs.push({ ...doc, docType: TYPE_BY_PREFIX[file.slice(0, 2)] ?? "board_pack" });
  }

  const when = asOf(docs);
  console.log(`as of: ${when ? when.toISOString().slice(0, 10) : "UNKNOWN"} (the meeting the pack was prepared for)`);
  if (!when) fail("no as-of date could be established, so every date figure is unanchored");

  const figures = computeFigures(docs);

  for (const f of figures) {
    console.log(
      `\n  ${f.name}: ${f.value === null ? "not available" : `${f.value} ${f.unit}`}` +
        `   ${f.notable ? "[NOTABLE]" : "[not notable]"}`,
    );
    console.log(`    key      ${f.key}`);
    console.log(`    page     ${f.page ?? "unknown"}`);
    console.log(`    method   ${f.method}`);
    console.log(`    source   "${f.source.slice(0, 130)}"`);
    if (f.note) console.log(`    note     ${f.note}`);

    // A STATED figure must appear in its source verbatim — otherwise it came from
    // nowhere. A DERIVED figure is arithmetic (a count, a percentage, a difference
    // between dates), so its source shows the inputs instead, and requiring the
    // answer to appear would be wrong.
    if (f.value !== null && !f.derived) {
      if (!`${f.source} ${f.unit}`.includes(String(f.value))) {
        fail(`${f.key}: stated figure ${f.value} does not appear in its source`);
      }
    }
    if (f.derived && f.method.length < 30) {
      fail(`${f.key}: derived figures must explain their arithmetic in \`method\``);
    }
    if (f.value === 0) fail(`${f.key}: returned 0 — a figure that cannot be found must be absent, not zero`);
  }

  // Determinism, same process.
  if (JSON.stringify(computeFigures(docs)) !== JSON.stringify(figures)) {
    fail("figures differ between two runs over the same documents");
  } else {
    pass("figures identical across two runs");
  }

  if (ASSERT) {
    for (const [key, expected] of Object.entries(EXPECTED[set] ?? {})) {
      const got = figures.find((f) => f.key === key);

      if (expected.value === null) {
        if (got) fail(`${key}: expected to be absent, got ${got.value}`);
        else pass(`${key} correctly absent`);
        continue;
      }
      if (!got) { fail(`${key}: expected ${expected.value}, not produced at all`); continue; }
      if (got.value !== expected.value) {
        fail(`${key}: expected ${expected.value}, got ${got.value}`);
        continue;
      }
      // Notability decides whether a figure becomes evidence, so it is asserted too.
      if (expected.notable !== undefined && got.notable !== expected.notable) {
        fail(`${key} = ${got.value} but notable should be ${expected.notable}, got ${got.notable}`);
        continue;
      }
      pass(`${key} = ${expected.value}${expected.notable === undefined ? "" : expected.notable ? " (notable)" : " (not notable)"}`);
    }
  }
}

console.log(`\n${"=".repeat(76)}`);
if (!ASSERT) {
  console.log("Printed only. Read these against the documents, then run with --assert.");
  process.exit(failures === 0 ? 0 : 1);
}
console.log(failures === 0 ? "STAGE 2 GATE: PASSED" : `STAGE 2 GATE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
