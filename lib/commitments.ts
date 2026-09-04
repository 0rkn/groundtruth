/**
 * What the board promised itself: recommendations from the previous review.
 *
 * WHY THIS IS ALLOWED WHEN THE REVIEW IS OTHERWISE EXCLUDED. `eligibleDocuments` keeps
 * the previous review out of retrieval because its FINDINGS are the prior consultant's
 * work, and putting them in our report would pass off someone else's analysis as ours.
 * Its RECOMMENDATIONS are a different thing: the board accepted them, so they are facts
 * about the client — commitments it made — in the same way its own corporate plan is.
 *
 * The rule that keeps that distinction from widening: a recommendation is offered to
 * `pick.ts` as one candidate line among the question's passages and figures, never
 * composed into a sentence on its own. The review supplies the yardstick; the figure
 * beside it, when one is chosen too, supplies the measurement.
 *
 * Extraction is deliberately narrow. Only text the document itself marks as a numbered
 * recommendation is taken; nothing is inferred from surrounding prose, because a
 * paraphrase of a finding dressed as a commitment is exactly the leak this guards
 * against.
 *
 * Deterministic, no model, no network.
 */
import { flatten, type Document } from "./extract.ts";
import type { TypedDocument } from "./figures.ts";

export interface Commitment {
  /** Its number in the review, so a consultant can find it. */
  number: number;
  /** The recommendation text, verbatim. */
  text: string;
  page: number;
  /** The real filename it was read from, so a citation can be checked against a file. */
  document: string;
  /** The review's own date, for "your 2023 review recommended...". */
  reviewYear: number | null;
  /**
   * What the CURRENT documents say about this recommendation, best match first.
   *
   * The second half of the client's shape (c) — a commitment set against its absence —
   * which until now was never supplied at all. The prompt showed fourteen recommendations
   * and nothing about whether anything answered them, then we recorded that the model
   * never wrote the shape. It had one half of it.
   *
   * Deliberately NOT a verdict. No threshold decides "unaddressed" here, because any
   * threshold would be tuned on the client we happened to test with, and the same mistake
   * already sits in config/thresholds.ts. The passages are handed over as they come back
   * and the model reads them: material, not judgement. An empty list means retrieval found
   * nothing at all, which is itself the plainest form of the answer.
   */
  nowShows?: { document: string; page: number; text: string }[];
}

/**
 * "**Recommendation 3.** Set a pack limit of 120 pages and require..."
 *
 * Bold markers are optional because extraction is inconsistent about them, but the word
 * and the number are required: a sentence merely containing "we recommend" is the
 * consultant's opinion in prose, not a numbered undertaking the board signed up to.
 *
 * The markers may also fall BETWEEN the word and its number: Northgate's review extracts
 * recommendation 11 with a bold break and a blank line separating "Recommendation" from
 * "11.", which silently swallowed it into recommendation 10's text until the separator
 * was made tolerant. A commitment merged into its neighbour is worse than one missed,
 * because the merged text would then be quoted as though the board had undertaken both
 * together.
 */
const RECOMMENDATION =
  /\*{0,2}Recommendation\*{0,2}\s*\*{0,2}\s*(\d{1,2})\.?\*{0,2}\s*([^]*?)(?=\*{0,2}Recommendation\*{0,2}\s*\*{0,2}\s*\d|\n\s*##|$)/gi;

/** The year on the cover, for phrasing a line as "your 2023 review". */
function reviewYear(doc: Document): number | null {
  const m = flatten(doc.text).match(/Board Effectiveness Review\s+(20\d{2})/i);
  return m ? Number(m[1]) : null;
}

/**
 * Which document is the previous review, by document TYPE first.
 *
 * A filename pattern was the only signal here until `classify.ts` existed, and it shares
 * that file's limitation: a real upload is under no obligation to be named
 * "05-previous-board-review.pdf". Typed documents are checked first; the filename
 * pattern remains as a fallback for a caller that has not classified its documents.
 */
function findReview(docs: (Document | TypedDocument)[]): Document | undefined {
  const typed = docs.find((d): d is TypedDocument => "docType" in d && d.docType === "previous_review");
  return typed ?? docs.find((d) => /previous[-_ ]?(board[-_ ]?)?review/i.test(d.filename));
}

export function extractCommitments(docs: (Document | TypedDocument)[]): Commitment[] {
  const review = findReview(docs);
  if (!review) return [];

  const year = reviewYear(review);
  const out: Commitment[] = [];

  for (const page of review.pages) {
    for (const m of page.text.matchAll(RECOMMENDATION)) {
      const text = m[2]
        .replace(/\s+/g, " ")
        .replace(/\*\*/g, "")
        .trim()
        // A recommendation runs to the end of its sentence or the next heading; trailing
        // section text is dropped rather than carried into a quotation.
        .replace(/\s*(?:##|Finding \w+:).*$/i, "")
        .trim();
      if (text.length < 15) continue;
      out.push({ number: Number(m[1]), text, page: page.number, reviewYear: year, document: review.filename });
    }
  }

  // The same recommendation can appear twice when a page break splits it. Keep the
  // longest capture per number, since the truncated one is the accident.
  const byNumber = new Map<number, Commitment>();
  for (const c of out) {
    const seen = byNumber.get(c.number);
    if (!seen || c.text.length > seen.text.length) byNumber.set(c.number, c);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * Whether the board said it accepted them, which is what makes them commitments rather
 * than suggestions. Reported separately so a review whose response is absent cannot be
 * quoted as though the board had signed up to anything.
 */
export function wereAccepted(docs: (Document | TypedDocument)[]): boolean {
  const review = findReview(docs);
  if (!review) return false;
  return /accepted all\s+\w+\s+recommendations|accepted the recommendations|accepted all of the recommendations/i.test(
    flatten(review.text),
  );
}
