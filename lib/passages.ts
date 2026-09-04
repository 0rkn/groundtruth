import type { Document } from "./extract.ts";

export interface Passage {
  /**
   * Unique across the whole client set, not just within one document.
   *
   * It was `p1-0` — unique per document, and every one of the five documents produced
   * a `p1-0`. Anywhere passages from different documents met in a Set or a map, four
   * of the five silently vanished; and these ids become Vectorize keys, where a
   * collision overwrites a vector rather than erroring.
   */
  id: string;
  /** The document this came from. Carried so a passage is self-locating. */
  document: string;
  /** Real page number, from the extractor. */
  page: number;
  /** Nearest heading above this passage. A locator for a human, and context for search. */
  heading: string;
  text: string;
}

/**
 * Target passage size. Not a hard cap — a single long line is never split to meet it.
 *
 * UNVALIDATED. 140 is a guess, not a measurement. Passage size only means anything
 * relative to what consumes it, so it cannot be judged here — it gets swept at
 * Stage 4 against the labelled relevance set (80 / 140 / 250 / whole-page).
 *
 * One hard bound that is not a matter of taste: bge-base-en-v1.5 has a 512-token
 * window, roughly 350-400 words. Above that a passage is silently truncated at
 * embedding time, so anything larger is wrong whatever the metrics say.
 */
export const TARGET_WORDS = 140;

/** Headings too generic to locate anything by. */
const WEAK_HEADING = /^(contents|introduction|agenda|annex\S*|appendix\S*|[\d.\s]*)$/i;

const words = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Filename to an id-safe stem: "03-board-pack-extract.pdf" becomes "03-board-pack-extract". */
const slug = (filename: string) =>
  filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

/** A markdown table rule — carries no content and would break a quote if kept. */
const isTableRule = (line: string) => /^\|?[\s|:-]+\|?$/.test(line.trim());

function cleanHeading(raw: string): string {
  return raw
    .replace(/<\/?u>/g, "")
    .replace(/[*_#]/g, "")
    .replace(/�/g, "-")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 90);
}

/**
 * Split a document into passages.
 *
 * The rule that matters: passages break on LINE boundaries and never inside a
 * line. A markdown table row is a single line, and half a row cannot be quoted or
 * checked against its source afterwards — so a line longer than the target becomes
 * its own passage rather than being cut. Retrieval granularity is worth less than a
 * passage you can quote.
 *
 * Pure and deterministic: same document in, same passages out.
 *
 * `targetWords` is a parameter rather than a constant because Stage 4.5 sweeps it, and
 * because the relevance fixtures are anchored by verbatim quote specifically so that a
 * different size does not invalidate them.
 *
 * A heading always ended a passage, which means `Infinity` alone gives HEADING-BOUNDED
 * passages, not whole-page ones — 45 passages rather than 19 on Brambleside. Those are
 * two different configurations and the sweep must not conflate them, so
 * `splitOnHeadings: false` with `targetWords: Infinity` is the genuine whole-page case.
 */
export function toPassages(
  doc: Document,
  targetWords: number = TARGET_WORDS,
  splitOnHeadings: boolean = true,
): Passage[] {
  const passages: Passage[] = [];
  let heading = "";
  let sequence = 0;

  for (const page of doc.pages) {
    let buffer: string[] = [];

    const flush = () => {
      if (buffer.length === 0) return;
      const text = buffer.join("\n").trim();
      buffer = [];
      if (words(text) < 4) return; // not enough to be evidence

      passages.push({
        id: `${slug(doc.filename)}-p${page.number}-${sequence++}`,
        document: doc.filename,
        page: page.number,
        heading: heading && !WEAK_HEADING.test(heading) ? heading : "",
        text,
      });
    };

    for (const line of page.text.split("\n")) {
      const asHeading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
      if (asHeading) {
        if (splitOnHeadings) flush();
        heading = cleanHeading(asHeading[1]);
        continue;
      }

      if (isTableRule(line)) continue;

      if (line.trim() === "") {
        if (words(buffer.join(" ")) >= targetWords) flush();
        continue;
      }

      buffer.push(line);
      if (words(buffer.join(" ")) >= targetWords) flush();
    }

    flush(); // a passage never spans a page boundary, so its page number is unambiguous
  }

  return passages;
}

/**
 * Documents whose passages may be quoted as evidence.
 *
 * The previous board review is excluded. Its date is fair game — that is a fact about
 * the client — but its claims belong to whoever wrote it.
 */
export function eligibleDocuments(docs: Document[]): Document[] {
  return docs.filter((d) => !/previous[-_ ]?(board[-_ ]?)?review/i.test(d.filename));
}

export function eligiblePassages(
  docs: Document[],
  targetWords?: number,
  splitOnHeadings?: boolean,
): Passage[] {
  return eligibleDocuments(docs).flatMap((d) => toPassages(d, targetWords, splitOnHeadings));
}
