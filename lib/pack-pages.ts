import { flatten, type Document } from "./extract.ts";

export interface Finding {
  /** The figure itself. */
  value: number;
  /** The sentence it was read from, shown to the consultant as the source. */
  source: string;
  /** Which page that sentence is on. */
  page: number;
  /** How the figure was arrived at, so it can be checked. */
  method: string;
}

/** One sentence of context around a match, cleaned up for display. */
function sentenceAround(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at < 0) return needle;
  const start = Math.max(0, text.lastIndexOf(". ", at) + 1);
  const nextStop = text.indexOf(". ", at + needle.length);
  const end = nextStop < 0 ? Math.min(text.length, at + needle.length + 140) : nextStop + 1;
  return text.slice(start, end).trim();
}

/**
 * How many pages the board pack runs to.
 *
 * No model involved. Returns null rather than 0 when the document does not say —
 * a zero would read as a finding when the truth is that we could not tell.
 */
export function packPages(doc: Document): Finding | null {
  for (const page of doc.pages) {
    const text = flatten(page.text);
    const match = text.match(/(?:total pack|pack)\s*:?\s*(\d+)\s*pages/i);
    if (!match) continue;

    return {
      value: Number(match[1]),
      source: sentenceAround(text, match[0]),
      page: page.number,
      method: "Read from the figure the pack states for itself.",
    };
  }
  return null;
}
