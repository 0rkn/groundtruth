/**
 * Every question, with the lines from the client's own documents that answer it — or an
 * honest blank.
 *
 * The whole product in one script: retrieve, choose by number, print. There is no
 * verification stage because there is nothing to verify — `pick.ts` never lets the model
 * type document text, so every quotation below is a slice of the source lifted by code.
 */
import { readFile, readdir } from "node:fs/promises";
import { extractDocument, type Document } from "../lib/extract.ts";
import { computeFigures, type DocType, type TypedDocument } from "../lib/figures.ts";
import { select } from "../lib/select.ts";
import { fixedSize } from "../lib/chunkers.ts";
import { eligibleDocuments } from "../lib/passages.ts";
import { indexPassages } from "../lib/retrieve.ts";
import { embeddableText } from "../lib/embeddable.ts";
import { embed, query } from "../lib/cf.ts";
import { pickQuote, extractCommentary } from "../lib/pick.ts";
import { summarise } from "../lib/summarise.ts";
import { extractCommitments } from "../lib/commitments.ts";

const SET = process.argv.includes("--client-b") ? "client-set-b" : "client-set-a";
const TOPK = 8;

/**
 * "The board..." opens every question and dominated the embedding: one passage about how
 * many seats the board has topped three unrelated questions. Measured at +3 questions
 * across every index variant.
 */
const stripBoard = (t: string) =>
  t
    .replace(/\bthe board's\b/gi, "the organisation's")
    .replace(/\bthe board\b/gi, "")
    .replace(/\bboard members?\b/gi, "")
    .replace(/\bboard\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*,?\s*/, "")
    .trim();

const TYPE_BY_PREFIX: Record<string, DocType> = {
  "01": "corporate_plan", "02": "risk_register", "03": "board_pack",
  "04": "board_calendar", "05": "previous_review",
};

const docs: Document[] = [];
const typed: TypedDocument[] = [];
for (const f of (await readdir(`../${SET}`)).filter((x) => x.endsWith(".pdf")).sort()) {
  const doc = await extractDocument(Buffer.from(await readFile(`../${SET}/${f}`)), f);
  docs.push(doc);
  typed.push({ ...doc, docType: TYPE_BY_PREFIX[f.slice(0, 2)] ?? "board_pack" });
}

/** Computed once, offered to every question — the nine facts a report is meant to rest on. */
const figures = computeFigures(typed);
const commentary = extractCommentary(docs);

console.log(`${"=".repeat(78)}\n${SET}\n${"=".repeat(78)}`);

const chosen = select(docs);
const commitments = extractCommitments(docs);
const passages = (await Promise.all(eligibleDocuments(docs).map((d) => fixedSize.chunk(d)))).flat();
const byId = new Map(passages.map((p) => [p.id, p]));
const namespace = `${SET === "client-set-a" ? "a" : "b"}-pick`;

process.stdout.write(`indexing ${passages.length} passages ... `);
await indexPassages(passages, namespace, embeddableText);
console.log("done\n");

const bare = (id: string) => id.slice(id.indexOf("--") + 2);

let answered = 0;
const started = Date.now();

for (const q of chosen.questions) {
  const [vector] = await embed([stripBoard(q.text)]);
  const matches = await query(vector, TOPK, namespace);
  const retrieved = matches
    .map((m) => byId.get(bare(m.id)))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ document: p.document, page: p.page, text: p.text }));

  const picked = await pickQuote(q.id, q.text, retrieved, figures, commitments, commentary);

  console.log(`[${q.id}] ${q.text}`);
  if (picked) {
    answered += 1;
    const summary = await summarise(q.text, picked.quotes);
    if (summary) console.log(`    drew: ${summary}`);
    // Each quotation with its OWN source: two of them side by side is the client's
    // contradiction shape, and one document's words must never sit under another's citation.
    for (const quote of picked.quotes) {
      console.log(`    "${quote.text}"`);
      console.log(`        — ${quote.computed ? "computed" : `${quote.document}, p${quote.page}`}`);
    }
  } else {
    console.log(`    No evidence found in the documents provided.`);
  }
  console.log();
}

console.log("=".repeat(78));
console.log(
  `${answered} of ${chosen.questions.length} questions answered from the documents; ` +
    `${chosen.questions.length - answered} recorded as nothing found. ` +
    `${Math.round((Date.now() - started) / 1000)}s`,
);
console.log("=".repeat(78));
