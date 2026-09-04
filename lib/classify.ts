/**
 * Which kind of document this is, from what it says rather than what it is called.
 *
 * WHY THIS EXISTS. `runAppraisal` used to type a document by its filename prefix —
 * "01-corporate-plan.pdf" is a corporate plan because it starts with "01". That is an
 * artefact of this exercise's own fixtures, not something a real upload can rely on: a
 * director attaching "Board Pack July.pdf" and "RiskRegister_v3.pdf" gets both typed as
 * whatever the fallback is, silently, because neither starts with a two-digit code.
 *
 * WHY THE TITLE, NOT THE WHOLE DOCUMENT. A first version scanned the flattened text for
 * keywords anywhere and scored by count. It failed on the calendar, which names "Risk
 * register" twice as an agenda item and was classified as a risk register — a keyword
 * used IN PASSING outscored the document's own heading. Every one of these documents
 * states what it is once, clearly, near the top: "Board and Committee Calendar 2026/27",
 * "Board Effectiveness Review 2023". Reading the title is both more accurate and cheaper
 * than reading everything.
 *
 * A document whose title matches nothing is not forced into a type. It is still
 * searched — nothing here excludes it from retrieval — it simply cannot be used for the
 * figures and gap reporting that depend on knowing what kind of document it is. That is
 * the graceful failure this file produces: an unrecognised document degrades to "we
 * could not tell", never to a wrong confident answer.
 */
import type { Document } from "./extract.ts";
import type { DocType } from "./figures.ts";
import { flatten } from "./extract.ts";

/** Order matters: checked top to bottom, first match wins. More specific titles first. */
const TITLE_PATTERNS: [DocType, RegExp][] = [
  [
    "previous_review",
    /\b(?:board\s+)?effectiveness\s+review\b|\bgovernance\s+(?:health\s+check|review)\b/i,
  ],
  ["skills_audit", /\bskills?\s+(?:audit|matrix)\b/i],
  ["board_calendar", /\b(?:board|committee)\s+(?:and\s+committee\s+)?calendar\b|\bforward\s+plan\b/i],
  ["risk_register", /\b(?:strategic\s+)?risk\s+register\b/i],
  ["board_pack", /\bboard\s+pack\b/i],
  [
    "corporate_plan",
    /\bcorporate\s+plan\b|\bstrategic\s+plan\b|\b(?:three|five)[\s-]year\s+(?:operating|business)\s+plan\b/i,
  ],
  ["minutes", /\bminutes\s+of\s+(?:the\s+)?(?:board\s+)?meeting\b/i],
];

// Two genuinely common alternate titles were added above — a governance health check as
// the review, a multi-year operating plan as the corporate plan — because both recur
// across organisations rather than belonging to one client. Deliberately NOT added:
// chasing every client's own wording further, which is the same mistake this project
// made once already with a checker tuned to a single document's vocabulary. A title
// this misses returns null, and the document is still searched — an honest gap, not a
// guess.

/** How far into the document a title is expected to appear. Past this it is body text. */
const TITLE_WINDOW = 500;

export function classifyDocument(doc: Document): DocType | null {
  const opening = flatten(doc.pages[0]?.text.slice(0, TITLE_WINDOW) ?? "");

  for (const [type, pattern] of TITLE_PATTERNS) {
    if (pattern.test(opening)) return type;
  }
  return null;
}
