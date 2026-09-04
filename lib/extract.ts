export interface Page {
  /** 1-indexed, as a person would count it. */
  number: number;
  text: string;
}

export interface Document {
  filename: string;
  pages: Page[];
  /** All pages joined, for patterns that need to look across the whole document. */
  text: string;
  /** How many planted reviewer annotations were removed. */
  notesStripped: number;
}

/**
 * Annotations planted in the exercise documents and addressed to whoever is
 * building this — "Note for the reviewer: seven of the fifteen measures are
 * worsening". They are scaffolding, not client content, and quoting one would put
 * the answer key into a client deliverable.
 */
const REVIEWER_NOTE =
  /\*{0,2}\s*(?:Note (?:for|to) the reviewer|Reviewer note)\s*:?[\s\S]*?(?:\*{1,2}\s*$|\n\s*\n|$)/gim;

export function stripReviewerNotes(text: string): { text: string; removed: number } {
  let removed = 0;
  const cleaned = text.replace(REVIEWER_NOTE, () => {
    removed += 1;
    return "\n\n";
  });
  return { text: cleaned, removed };
}

export function containsReviewerNote(text: string): boolean {
  return /note (?:for|to) the reviewer|reviewer note/i.test(text);
}

/**
 * PDF -> pages of text, annotations removed.
 *
 * Page numbers come from the extractor, never inferred from a character offset:
 * every citation in this product traces through them, so an approximate page
 * presented as fact is the one thing it must never do.
 */
export async function extractDocument(
  buffer: Buffer,
  filename: string,
): Promise<Document> {
  // Loaded here, not at module scope: `pdf-inspector` ships a native binary, and a
  // top-level import forces Next.js to resolve it during the BUILD's own page-data
  // collection step — a different environment from where the deployed function actually
  // runs, and the one where this native binding was failing to load on Vercel. Deferred
  // to first use, it only ever loads inside the real runtime.
  const { extractPagesMarkdownAsync } = await import("@firecrawl/pdf-inspector");
  const result = await extractPagesMarkdownAsync(buffer, null);

  if (!result.pages?.length) {
    throw new Error(
      `No text could be read from ${filename}. If it is a scan rather than a text PDF it needs converting first.`,
    );
  }

  let notesStripped = 0;
  const pages: Page[] = result.pages.map((p) => {
    const { text, removed } = stripReviewerNotes(p.markdown ?? "");
    notesStripped += removed;
    return { number: p.page + 1, text }; // the extractor is 0-indexed
  });

  return {
    filename,
    pages,
    text: pages.map((p) => p.text).join("\n\n"),
    notesStripped,
  };
}

/**
 * Strip the artefacts PDF extraction leaves in prose so a pattern can match
 * across them: bold markers landing mid-phrase, table pipes scattered through a
 * sentence. Only markup is removed — no letters, digits or word order change.
 */
export function flatten(text: string): string {
  return text
    .replace(/[*_#]+/g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
