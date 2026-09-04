/**
 * Stage 1 gate: extraction and passages.
 *
 *   npm run check:extract
 *
 * Deterministic — no model, no network. So these are assertions that fail the run,
 * not statistics. Imports the shipped code rather than a copy of it, because a
 * harness that can disagree with production will eventually lie to you.
 */
import { readFile, readdir } from "node:fs/promises";
import { extractDocument, containsReviewerNote } from "../lib/extract.ts";
import { toPassages, type Passage } from "../lib/passages.ts";
import type { Document } from "../lib/extract.ts";

const SETS = ["client-set-a", "client-set-b"];

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg: string) => console.log(`  ok    ${msg}`);

/**
 * Every line of every passage must exist as a complete line in its source page.
 *
 * This is what proves no line was split. A truncated markdown table row would not
 * match any whole source line, so it fails here rather than surfacing later as a
 * quote that cannot be verified.
 */
function everyLineIsWhole(doc: Document, passages: Passage[]): string | null {
  const linesByPage = new Map<number, Set<string>>();
  for (const page of doc.pages) {
    linesByPage.set(
      page.number,
      new Set(page.text.split("\n").map((l) => l.trim()).filter(Boolean)),
    );
  }

  for (const p of passages) {
    const source = linesByPage.get(p.page);
    if (!source) return `passage ${p.id} claims page ${p.page}, which has no text`;
    for (const line of p.text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !source.has(trimmed)) {
        return `passage ${p.id} contains a line not present whole on page ${p.page}: ${JSON.stringify(trimmed.slice(0, 70))}`;
      }
    }
  }
  return null;
}

for (const set of SETS) {
  console.log(`\n${"=".repeat(74)}\n${set}\n${"=".repeat(74)}`);
  const dir = `../${set}`;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".pdf")).sort();

  let passageTotal = 0;
  let notesTotal = 0;

  for (const file of files) {
    const buffer = Buffer.from(await readFile(`${dir}/${file}`));
    const doc = await extractDocument(buffer, file);
    const passages = toPassages(doc);

    passageTotal += passages.length;
    notesTotal += doc.notesStripped;

    const pages = [...new Set(passages.map((p) => p.page))].sort((a, b) => a - b);
    console.log(
      `\n${file.padEnd(30)} ${String(doc.pages.length).padStart(2)}pp  ` +
        `${String(passages.length).padStart(2)} passages  ` +
        `pages ${pages[0]}-${pages[pages.length - 1]}  ` +
        `${doc.notesStripped} notes stripped`,
    );

    // 1. page numbers inside the document
    const outOfRange = passages.filter((p) => p.page < 1 || p.page > doc.pages.length);
    if (outOfRange.length) {
      fail(`${outOfRange.length} passage(s) carry a page number outside the document`);
    }

    // 2. no reviewer annotation survived
    const leaked = passages.filter((p) => containsReviewerNote(p.text));
    if (leaked.length) fail(`${leaked.length} passage(s) still contain a reviewer note`);

    // 3. no line was split
    const splitLine = everyLineIsWhole(doc, passages);
    if (splitLine) fail(splitLine);

    // 4. deterministic
    const again = toPassages(doc);
    if (JSON.stringify(again) !== JSON.stringify(passages)) {
      fail(`${file}: passages differ between two runs over the same document`);
    }

    // 5. nothing empty
    if (passages.some((p) => p.text.trim() === "")) fail(`${file}: an empty passage`);
  }

  console.log(`\n-- ${passageTotal} passages, ${notesTotal} reviewer notes stripped`);

  if (notesTotal === 0) {
    fail("no reviewer notes were stripped — the pattern may have stopped matching");
  } else {
    pass(`${notesTotal} planted reviewer notes removed before chunking`);
  }
  pass("every page number inside its document");
  pass("no passage contains a reviewer note");
  pass("no line split across passages");
  pass("passages identical across two runs");
}

console.log(`\n${"=".repeat(74)}`);
console.log(failures === 0 ? "STAGE 1 GATE: PASSED" : `STAGE 1 GATE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
