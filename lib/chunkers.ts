/**
 * Chunking strategies, behind one interface so they can be compared.
 *
 * WHY THIS EXISTS. The first Stage 4.2 sweep compared 80, 140 and 250 words and got
 * 24, 24 and 23 answers out of 37 — three settings of ONE strategy, all failing the
 * same way. Inspecting the misses showed why: a 140-word chunk of the corporate plan
 * held building safety, decarbonisation AND rent arrears, so its single vector
 * represented the average and a query about what the regulator expects matched one
 * buried clause. It ranked 24th of 51 despite being near word-for-word.
 *
 * That is dilution, and shrinking the target does not fix it — it puts more boundaries
 * in arbitrary places rather than putting boundaries in the right places. So the
 * variable is the strategy, not the size.
 *
 * Two rules every strategy keeps, because they are correctness rather than tuning:
 * a chunk never spans a page boundary (so its page number is unambiguous and citable),
 * and a chunk's text is always a contiguous verbatim span of its page (so it can be
 * quoted and verified).
 */
import type { Document } from "./extract.ts";
import { toPassages, TARGET_WORDS, type Passage } from "./passages.ts";
import { embed } from "./cf.ts";
import { cosine } from "./retrieve.ts";

export interface Chunker {
  label: string;
  /** Async because semantic chunking needs sentence embeddings. */
  chunk(doc: Document): Promise<Passage[]>;
}

/** Hard bound for every strategy: bge-base truncates silently past 512 tokens. */
const MAX_WORDS = 350;

const words = (s: string) => (s.match(/\S+/g) ?? []).length;
const slug = (filename: string) =>
  filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

/** Shared assembly, so all three strategies produce identically-shaped passages. */
function build(doc: Document, page: number, parts: string[], from: number): Passage[] {
  return parts
    .map((text) => text.trim())
    .filter((text) => words(text) >= 4)
    .map((text, i) => ({
      id: `${slug(doc.filename)}-p${page}-${from + i}`,
      document: doc.filename,
      page,
      heading: "",
      text,
    }));
}

// ------------------------------------------------------------------- 1. fixed size

/**
 * Line boundaries at a word target.
 *
 * SIZE IS SWEPT HERE, and the reason it is worth sweeping despite an earlier sweep
 * having reported that it did not matter is that the earlier sweep could not have shown
 * anything either way. It compared configurations under a 1,000-word budget over a
 * 4,399-word corpus, so every configuration delivered roughly a quarter of everything
 * that existed and near-total recall was available to all of them. A variable cannot be
 * ruled out by a measurement that had no room to move, so size is back in the grid and
 * is measured at the rank positions the questionnaire actually shows.
 */
export const fixedAt = (target: number): Chunker => ({
  label: `fixed ${target} words`,
  async chunk(doc) {
    return toPassages(doc, target, true);
  },
});

/** The production chunker. Named, because reordering CHUNKERS must not change it. */
export const fixedSize: Chunker = fixedAt(TARGET_WORDS);

/**
 * The genuine size ladder: a word target with heading splitting turned OFF.
 *
 * THIS IS THE CORRECTION THAT MATTERS. `fixedAt` splits on headings as well as on the
 * word target, and on these documents the headings dominate so completely that the
 * target barely bites — 80, 140 and 250 words give median passages of 62, 75 and 75,
 * and a target of 250 is byte-for-byte identical to a target of infinity. An earlier
 * sweep of 80/140/250 therefore reported that size did not matter, when what it had
 * actually done was vary a parameter that never moved. That is not a null result, it is
 * an absent experiment.
 *
 * With heading splitting off the target controls the size as its name implies: 80, 140,
 * 250 and infinity give medians of 95, 143, 189 and 210. So this is the ladder the
 * sweep climbs, and `fixed 140 + headings` stays in the grid beside it so that the
 * heading rule itself is measured rather than assumed.
 */
export const packedAt = (target: number): Chunker => ({
  label: target === Infinity ? "whole page" : `packed ${target} words`,
  async chunk(doc) {
    return toPassages(doc, target, false);
  },
});

/**
 * One passage per page — the top of the ladder.
 *
 * Expected to lose, and included so that it is MEASURED losing rather than assumed to:
 * pages here run to 400 words, above the 350-word bound past which bge-base silently
 * truncates, so this row also prices what truncation costs. `check-retrieval` reports
 * how many passages each row loses text from.
 */
export const wholePage: Chunker = packedAt(Infinity);

// -------------------------------------------------------------- 2. structure-aware

/**
 * Split where the document says a topic starts.
 *
 * These documents mark topics with bold run-in headings — `**Decarbonisation.**`,
 * `**Resident voice.**`, `**Strategy.**` — written by the author, and the fixed-size
 * chunker ignores them completely. Nothing here is inferred: the boundary is where the
 * document puts it.
 *
 * A run-in heading is a short bold span ending in a full stop or colon. The length
 * bound matters: `**regulatory action**` and bolded figures are emphasis, not headings,
 * and splitting on those would fragment sentences.
 */
const RUN_IN = /\*\*\s*([A-Z][^*\n]{2,60}?[.:])\s*\*\*/g;

export const structureAware: Chunker = {
  label: "structure-aware",
  async chunk(doc) {
    const out: Passage[] = [];
    for (const page of doc.pages) {
      const text = page.text;
      const cuts: number[] = [0];
      for (const m of text.matchAll(RUN_IN)) {
        if (m.index !== undefined && m.index > 0) cuts.push(m.index);
      }
      cuts.push(text.length);

      const parts: string[] = [];
      for (let i = 0; i < cuts.length - 1; i += 1) {
        const span = text.slice(cuts[i], cuts[i + 1]);
        // A span longer than the model's window still has to be broken up, so fall
        // back to the fixed-size rule inside it rather than letting it truncate.
        if (words(span) > MAX_WORDS) {
          parts.push(...splitByWords(span, TARGET_WORDS));
        } else if (span.trim()) {
          parts.push(span);
        }
      }
      out.push(...build(doc, page.number, parts, out.length));
    }
    return out;
  },
};

/** Line-boundary fallback, used when a structural span exceeds the model's window. */
function splitByWords(text: string, target: number): string[] {
  const parts: string[] = [];
  let buffer: string[] = [];
  for (const line of text.split("\n")) {
    buffer.push(line);
    if (words(buffer.join(" ")) >= target) {
      parts.push(buffer.join("\n"));
      buffer = [];
    }
  }
  if (buffer.length) parts.push(buffer.join("\n"));
  return parts;
}

// -------------------------------------------------------------------- 3. semantic

/**
 * Split where consecutive sentences stop being about the same thing.
 *
 * Each sentence is embedded, the cosine between neighbours is measured, and a boundary
 * goes where similarity drops into the lowest PERCENTILE of drops on that page. In the
 * "Four pressures" passage the similarity between "...what the regulator expects us to
 * be able to evidence" and "Decarbonisation. 61% of our homes are at EPC C" should fall
 * sharply, which is exactly where a boundary belongs.
 *
 * PERCENTILE is a stated default, not a tuned value: 25 means the quarter of boundaries
 * with the largest topic shift become cuts. It is deliberately not swept — with 37
 * questions, tuning a threshold would fit noise.
 *
 * Costs one batched embedding call per document at ingest, and is deterministic:
 * the same text gives the same vectors and therefore the same boundaries.
 */
const PERCENTILE = 25;

export const semantic: Chunker = {
  label: "semantic",
  async chunk(doc) {
    const out: Passage[] = [];

    for (const page of doc.pages) {
      const sentences = splitSentences(page.text);
      if (sentences.length < 3) {
        out.push(...build(doc, page.number, [page.text], out.length));
        continue;
      }

      const vectors = await embed(sentences);
      const gaps: number[] = [];
      for (let i = 0; i < vectors.length - 1; i += 1) {
        gaps.push(cosine(vectors[i], vectors[i + 1]));
      }

      // Cut at the lowest-similarity boundaries. Using a percentile of this page's own
      // gaps rather than an absolute cosine value means the rule travels between
      // documents of different styles without retuning.
      const sorted = [...gaps].sort((a, b) => a - b);
      const threshold = sorted[Math.max(0, Math.floor((sorted.length * PERCENTILE) / 100) - 1)];

      const parts: string[] = [];
      let buffer: string[] = [sentences[0]];
      for (let i = 0; i < gaps.length; i += 1) {
        const tooLong = words(buffer.join(" ")) > MAX_WORDS;
        if (gaps[i] <= threshold || tooLong) {
          parts.push(buffer.join(" "));
          buffer = [];
        }
        buffer.push(sentences[i + 1]);
      }
      if (buffer.length) parts.push(buffer.join(" "));

      out.push(...build(doc, page.number, parts, out.length));
    }
    return out;
  },
};

/**
 * Sentence boundaries.
 *
 * Table rows are kept whole rather than split on their internal full stops: a fragment
 * of a row cannot be quoted or verified, which is the same reason the fixed-size
 * chunker never splits a line.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("|")) { out.push(trimmed); continue; }
    const parts = trimmed.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [trimmed];
    for (const p of parts) if (p.trim()) out.push(p.trim());
  }
  return out;
}

/**
 * Everything the sweep compares: four sizes of the one strategy, then the two
 * strategies that put boundaries somewhere other than a word count.
 *
 * Order is presentation only. Nothing may index into this array to mean "the production
 * chunker" — import `fixedSize` for that, or adding a row here silently reconfigures the
 * product.
 */
export const CHUNKERS: Chunker[] = [
  fixedSize, // 140 with heading splitting: the production baseline every row is compared to
  packedAt(80),
  packedAt(140), // the same target as the baseline, without the heading rule
  packedAt(250),
  wholePage,
  structureAware,
  semantic,
];
