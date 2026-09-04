import { flatten, type Document } from "./extract.ts";
import { VOCABULARY } from "../config/vocabulary.ts";
import { THRESHOLDS } from "../config/thresholds.ts";

/**
 * Figures counted out of the documents by code. No model anywhere in this file.
 *
 * Two rules hold throughout:
 *
 *   1. A figure the documents do not support returns NULL, never 0. A zero reads as
 *      a finding ("no items were for decision") when the truth is "we could not
 *      tell", and the two must never be confused.
 *
 *   2. Figures may read a document's own DATE or its stated facts, but never the
 *      CLAIMS inside a previous review. "Fourteen of nineteen items were for
 *      noting" in last year's review is that consultant's finding, and repeating it
 *      as ours is not analysis. So the primary documents are the source, and the
 *      previous review contributes only its date.
 */

export type DocType =
  | "corporate_plan"
  | "risk_register"
  | "board_pack"
  | "board_calendar"
  | "previous_review"
  | "minutes"
  | "skills_audit";

export interface TypedDocument extends Document {
  docType: DocType;
}

export interface Figure {
  key: string;
  name: string;
  /** null when the documents do not support it. Never 0 as a stand-in. */
  value: number | null;
  unit: string;
  /** The text it was read from, so a person can check it. */
  source: string;
  page: number | null;
  /** How it was arrived at. Shown to the consultant. */
  method: string;
  threshold: string;
  notable: boolean;
  /**
   * True when the value is arithmetic rather than something the document states —
   * a count, a percentage, a difference between two dates. The source then shows the
   * inputs rather than the answer, so a checker must not expect to find the value in
   * it. Stated figures must appear in their source verbatim.
   */
  derived: boolean;
  /**
   * True when the figure is never a finding on its own, only material to compose with
   * one. Agenda minutes is the case: "the Board has 300 minutes" is not a criticism,
   * but "nine of fourteen items for noting, against 300 minutes" is. A context figure
   * is attached to a question and never makes it evidenced by itself.
   */
  context?: boolean;
  /** Set when two sources disagree in a way worth surfacing rather than resolving silently. */
  note?: string;
}

const PRIMARY: DocType[] = [
  "corporate_plan",
  "risk_register",
  "board_pack",
  "board_calendar",
  "minutes",
  "skills_audit",
];

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, once: 1, twice: 2,
};

function readNumber(token: string): number | null {
  const digits = token.replace(/[^\d]/g, "");
  if (digits) return Number(digits);
  return WORD_NUMBERS[token.toLowerCase().trim()] ?? null;
}

/** Parse "Thursday 9 July 2026" or "9 July". Year optional, since extraction can strand it. */
function parseDate(s: string, fallbackYear?: number): Date | null {
  const withYear = s.match(
    new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join("|")})\\s+(\\d{4})\\b`, "i"),
  );
  const m = withYear ?? s.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join("|")})\\b`, "i"));
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  const year = withYear ? Number(m[3]) : fallbackYear;
  if (month < 0 || !year) return null;
  const d = new Date(Date.UTC(year, month, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Working days strictly after `from`, up to and including `to`. */
function workingDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const cursor = new Date(from.getTime());
  while (cursor < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  );
}

/**
 * A tight window around a match.
 *
 * Preferred over sentence boundaries in flattened table text, where a "sentence" can
 * run for hundreds of characters of collapsed cells and the source becomes unreadable.
 */
function snippet(text: string, needle: string, before = 45, after = 110): string {
  const at = text.indexOf(needle);
  if (at < 0) return needle;
  const start = Math.max(0, at - before);
  const end = Math.min(text.length, at + needle.length + after);
  return (start > 0 ? "… " : "") + text.slice(start, end).replace(/\s+/g, " ").trim() +
    (end < text.length ? " …" : "");
}

/** One sentence around a match, cleaned for display. */
function sentenceAround(text: string, needle: string, pad = 150): string {
  const at = text.indexOf(needle);
  if (at < 0) return needle;
  const start = Math.max(0, text.lastIndexOf(". ", at) + 1);
  const stop = text.indexOf(". ", at + needle.length);
  const end = stop < 0 ? Math.min(text.length, at + needle.length + pad) : stop + 1;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Which page a snippet sits on, so a figure can cite a location. */
function pageOf(doc: Document, needle: string): number | null {
  const probe = flatten(needle).slice(0, 40);
  for (const page of doc.pages) {
    if (flatten(page.text).includes(probe)) return page.number;
  }
  return null;
}

/** Rows of a markdown table. Needs RAW text — flatten strips the pipes. */
export function tableRows(raw: string): string[][] {
  return raw
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|?[\s|:-]+\|?$/.test(l.trim()))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
}

const find = (docs: TypedDocument[], type: DocType) => docs.find((d) => d.docType === type);

/**
 * The date the appraisal is "as of".
 *
 * Not today's date: a figure that depends on the wall clock cannot be asserted in a
 * test and drifts silently. The meeting the pack was prepared for is stable, and
 * more correct — staleness is judged as at the papers under review.
 */
export function asOf(docs: TypedDocument[]): Date | null {
  const pack = find(docs, "board_pack");
  if (pack) {
    const t = flatten(pack.text);
    const issued = t.match(/papers\s+(?:issued|circulated)\s*:?\s*([^(.]{0,40})/i);
    const issuedYear = issued ? parseDate(issued[1])?.getUTCFullYear() : undefined;
    const meeting = t.match(/board\s+meeting[,:]?\s*([^(.]{0,40})/i);
    const d = meeting ? parseDate(meeting[1], issuedYear) : null;
    if (d) return d;
  }
  let latest: Date | null = null;
  for (const doc of docs) {
    const re = new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS.join("|")})\\s+\\d{4}\\b`, "gi");
    for (const m of flatten(doc.text).matchAll(re)) {
      const d = parseDate(m[0]);
      if (d && (!latest || d > latest)) latest = d;
    }
  }
  return latest;
}

// ------------------------------------------------------------------- 1. pack pages

/**
 * How many pages the board pack runs to.
 *
 * The stated figure wins, with the PDF's own page count as fallback. The fixtures
 * are extracts — this pack states 247 pages but the file has 6 — so metadata is
 * confidently wrong here, while for a real 247-page upload it would be right and a
 * document that never states its total would otherwise yield nothing.
 *
 * When the two disagree sharply, that is itself worth saying: we were handed an
 * extract, not the pack.
 */
function packPages(docs: TypedDocument[]): Figure | null {
  const pack = find(docs, "board_pack");
  if (!pack) return null;

  const t = flatten(pack.text);
  const stated = t.match(/(?:total pack|pack)\s*:?\s*(\d+)\s*pages/i);
  const actual = pack.pages.length;

  const base = {
    key: "pack_pages",
    name: "Board pack length",
    unit: "pages",
    threshold: `over ${THRESHOLDS.packPages} pages`,
  };

  if (stated) {
    const value = Number(stated[1]);
    return {
      ...base,
      value,
      source: snippet(t, stated[0]),
      page: pageOf(pack, stated[0]),
      method: "Read from the figure the pack states for itself.",
      derived: false,
      notable: value > THRESHOLDS.packPages,
      note:
        value > actual * 2
          ? `The file itself is ${actual} pages, so this is an extract rather than the full pack.`
          : undefined,
    };
  }

  return {
    ...base,
    value: actual,
    source: `${pack.filename} contains ${actual} pages.`,
    page: 1,
    method: "Counted from the PDF, because the pack does not state its own total.",
    notable: actual > THRESHOLDS.packPages,
    derived: false,
  };
}

// --------------------------------------------------------------- 2. pages per paper

/**
 * The longest paper in the pack, and — when the pack says so — which paper it is.
 *
 * A first attempt tried to split the Item column and confidently reported the longest
 * paper as "Welcome, apologies and declarations of interest". Extraction collapses each
 * column into a single cell, and the item NAMES run together with no delimiter, so they
 * cannot be split back apart. That much of the old warning was right.
 *
 * What it missed is that the columns stay in row ORDER. The `#` column, `Purpose`, `Pages`
 * and `Time` all split cleanly on whitespace and all yield the same count, so item number
 * and page count line up by position without touching the names at all. The pack then
 * names its own items elsewhere — "Item 4 cover sheet: Q1 Performance Report 2026/27" —
 * which supplies the mapping the table lost.
 *
 * Attribution is only ever claimed when both halves agree: the `#` and `Pages` columns
 * must yield equal counts, and the winning item must have a cover sheet naming it.
 * Otherwise the maximum is reported unattributed, exactly as before.
 *
 * This matters beyond tidiness. An unlabelled "42 pages" cannot be set against a
 * recommendation to cap a named report, and the model, asked to do it, reached for the
 * only labelled page count it had — the 247-page pack — and produced a comparison between
 * two unrelated quantities.
 */
function pagesPerPaper(docs: TypedDocument[]): Figure | null {
  const pack = find(docs, "board_pack");
  if (!pack) return null;

  const rows = tableRows(pack.text);
  const header = rows.find((r) => r.some((c) => /^pages$/i.test(c)));
  if (!header) return null; // no Pages column — Northgate's agenda has none

  const pagesCol = header.findIndex((c) => /^pages$/i.test(c));
  const itemCol = header.findIndex((c) => c === "#");

  /** Item number -> page count, only where the two columns agree on how many rows there are. */
  const pagesByItem = new Map<number, number>();
  let longest = 0;

  for (const row of rows) {
    if (row === header || !row[pagesCol]) continue;

    const pages = row[pagesCol]
      .split(/\s+/)
      .map(readNumber)
      .filter((n): n is number => n !== null && n > 0 && n < 500);

    for (const n of pages) if (n > longest) longest = n;

    if (itemCol < 0 || !row[itemCol]) continue;
    const items = row[itemCol]
      .split(/\s+/)
      .map(readNumber)
      .filter((n): n is number => n !== null);

    // Equal counts is the whole guarantee. Unequal means a column wrapped or a row was
    // dropped, and a mapping built from it would be an off-by-one presented as fact.
    if (items.length !== pages.length) continue;
    items.forEach((item, i) => pagesByItem.set(item, pages[i]));
  }
  if (!longest) return null;

  /** The pack naming its own items, wherever its item headings survive extraction. */
  const titleByItem = new Map<number, string>();

  // "Item 4 cover sheet: Q1 Performance Report 2026/27" is how one pack words it, and that
  // phrase is that pack's rather than a convention. Keying on it would make this figure work
  // for the single document it was written against and no other, which is the same mistake
  // as a checker tuned to one client's vocabulary. What IS conventional is that an agenda
  // item is numbered and then titled, so the connector between the two is left open: "Item 4
  // cover sheet:", "Item 4 paper:" and "Item 4:" all read the same way here.
  for (const m of flatten(pack.text).matchAll(/Item\s+(\d+)\b[^\n:|#]{0,40}:\s*([^\n|#]{3,80})/gi)) {
    const title = m[2]
      .replace(/\s+(Recommendation|Purpose|Author|Lead|Decision)\s*:.*$/i, "")
      .trim();
    if (title) titleByItem.set(Number(m[1]), title);
  }

  const winner = [...pagesByItem.entries()].find(([, n]) => n === longest)?.[0];
  const named = winner === undefined ? undefined : titleByItem.get(winner);

  return {
    key: "pages_per_paper",
    name: named ? `Longest paper in the pack — ${named}` : "Longest paper in the pack",
    value: longest,
    unit: "pages",
    source: named
      ? `Agenda table: item ${winner} is ${longest} pages. The pack names item ${winner} as "${named}".`
      : `Agenda table, Pages column. Largest value: ${longest} pages.`,
    page: pageOf(pack, header.join(" ")) ?? 1,
    method: named
      ? `Largest value in the Pages column of the agenda table, matched to its item number by row position, and named from that item's cover sheet.`
      : "Largest value in the Pages column of the agenda table. The item names collapse on extraction and no cover sheet names this item, so which paper it belongs to is not claimed.",
    threshold: `a single paper over ${THRESHOLDS.performanceReportPages} pages`,
    notable: longest > THRESHOLDS.performanceReportPages,
    derived: false,
  };
}

// ------------------------------------------------------------------- 3. notice given

/**
 * Working days between papers being issued and the meeting, against the notice the
 * document itself says is required.
 *
 * The strongest figure available: it measures the board against its own stated rule
 * rather than one of ours.
 */
function noticeDays(docs: TypedDocument[]): Figure | null {
  const pack = find(docs, "board_pack");
  if (!pack) return null;

  const t = flatten(pack.text);
  const issued = t.match(/papers\s+(?:issued|circulated)\s*:?\s*([^(.]{0,40})/i);
  const meeting = t.match(/board\s+meeting[,:]?\s*([^(.]{0,40})/i);
  if (!issued || !meeting) return null;

  const issuedDate = parseDate(issued[1]);
  if (!issuedDate) return null;

  // Borrow the year when extraction has stranded it: papers and their meeting are
  // days apart, so the year is the same in every realistic case.
  const meetingHadYear = /\d{4}/.test(meeting[1]);
  const meetingDate = parseDate(meeting[1], issuedDate.getUTCFullYear());
  if (!meetingDate || meetingDate < issuedDate) return null;

  const given = workingDaysBetween(issuedDate, meetingDate);
  const required = t.match(/(?:standard is|requires?)\s+(\w+)(?:\s+(?:working|business)\s+days?)?/i);
  const bar = required ? readNumber(required[1]) : null;

  return {
    key: "notice_days",
    name: "Notice given for papers",
    value: given,
    unit: bar ? `working days (against ${bar} required)` : "working days",
    source: snippet(t, issued[0].trim()),
    page: pageOf(pack, issued[0].trim()),
    method: bar
      ? `Working days between papers being issued and the meeting, against the ${bar} this document states is required.`
      : "Working days between the date papers were issued and the meeting date.",
    threshold: `fewer than ${bar ?? THRESHOLDS.noticeWorkingDays} working days`,
    notable: given < (bar ?? THRESHOLDS.noticeWorkingDays),
    derived: true, // a difference between two dates, not a stated figure
    note: meetingHadYear
      ? undefined
      : "The meeting year was taken from the issue date, which extraction had separated from it.",
  };
}

// --------------------------------------------------------------- 4. items for noting

/** How much of the agenda is for noting rather than deciding. */
function itemsForNoting(docs: TypedDocument[]): Figure | null {
  const pack = find(docs, "board_pack");
  if (!pack) return null;

  const t = flatten(pack.text);
  const base = {
    key: "items_noting",
    name: "Agenda items for noting",
    threshold: `over ${Math.round(THRESHOLDS.notingShare * 100)}% for noting`,
  };

  const stated = t.match(/(\w+)\s+of\s+the\s+(\w+)\s+items?\s+are\s+for\s+noting/i);
  if (stated) {
    const noting = readNumber(stated[1]);
    const total = readNumber(stated[2]);
    if (noting !== null && total) {
      return {
        ...base,
        value: Math.round((100 * noting) / total),
        unit: `% of items (${noting} of ${total})`,
        source: snippet(t, stated[0], 10, 40),
        page: pageOf(pack, stated[0]),
        method: "Read from the split the pack states for itself.",
        notable: noting / total > THRESHOLDS.notingShare,
        derived: true, // the percentage is ours; the counts are the document's
      };
    }
  }

  // Tally the Purpose column. Raw text, because flatten removes the pipes.
  const rows = tableRows(pack.text);
  const header = rows.find((r) => r.some((c) => /^purpose$/i.test(c)));
  if (!header) return null;
  const col = header.findIndex((c) => /^purpose$/i.test(c));

  let noting = 0;
  let total = 0;
  for (const row of rows) {
    if (row === header || !row[col]) continue;
    for (const token of row[col].split(/\s+/)) {
      const word = token.replace(/[^a-z]/gi, "").toLowerCase();
      if (word === "note" || word === "noting") { noting += 1; total += 1; }
      else if (["approve", "decision", "decide", "discuss"].includes(word)) total += 1;
    }
  }
  if (!total) return null;

  return {
    ...base,
    value: Math.round((100 * noting) / total),
    unit: `% of items (${noting} of ${total})`,
    source: `Agenda table, Purpose column: ${noting} of ${total} items marked for noting.`,
    page: pageOf(pack, header.join(" ")) ?? 1,
    method: "Counted from the Purpose column of the agenda table.",
    notable: noting / total > THRESHOLDS.notingShare,
    derived: true,
  };
}

// ------------------------------------------------------------- 5. summaries on papers

/** How many substantive papers carry a summary a director could act on alone. */
function paperSummaries(docs: TypedDocument[]): Figure | null {
  const pack = find(docs, "board_pack");
  if (!pack) return null;

  const t = flatten(pack.text);

  // Papers are found by their HEADING and judged by their ROLES, not by a house-style
  // phrase. The previous version counted occurrences of "cover sheet" and, separately,
  // occurrences of the word "summary" anywhere in the pack, then took the smaller —
  // which is two loosely related tallies rather than a per-paper test, and which found
  // nothing at all in a pack that heads its papers "Item 5:" instead.
  const headings = [...t.matchAll(VOCABULARY.paperHeading)];
  if (headings.length === 0) return null;

  // Each paper's block runs to the next paper's heading, so a role label is attributed
  // to the paper it actually sits under rather than to the pack at large.
  const blocks = headings.map((m, i) => {
    const from = m.index ?? 0;
    const to = i + 1 < headings.length ? (headings[i + 1].index ?? t.length) : t.length;
    return { number: m[1], text: t.slice(from, to) };
  });

  const { author, purpose, recommendation, summary } = VOCABULARY.paperRoles;

  // A numbered agenda item is not necessarily a PAPER. "Item 14: Meeting evaluation" is a
  // standing item with no author, purpose or recommendation, and counting it as a paper
  // without one made the denominator wrong — the figure read "3 of 5" where the pack
  // contains four papers. A block earns the name by carrying at least one of the roles a
  // paper has.
  const papers = blocks.filter(
    (b) =>
      author.test(b.text) || purpose.test(b.text) ||
      recommendation.test(b.text) || summary.test(b.text),
  );
  if (papers.length === 0) return null;

  // If a paper's block carries agenda debris, the pack's table did not survive extraction
  // and the block boundaries cannot be trusted.
  //
  // Brambleside is the case: its item 4 cover sheet genuinely states an author, a purpose
  // and a recommendation, but extraction relocated the LABELS into a header cell and left
  // the values scattered among clock times and page counts. The block therefore tests as
  // lacking a purpose, and the figure would tell a client one of its papers has no stated
  // purpose when it plainly does. That is a false finding in a deliverable, which is worse
  // than no finding — the same judgement as the trend-count fallback rejected above.
  const AGENDA_DEBRIS = /\b\d{1,2}[.:]\d{2}\b/g;
  const mangled = papers.some((b) => (b.text.match(AGENDA_DEBRIS) ?? []).length >= 5);
  if (mangled) return null;

  const complete = papers.filter(
    (b) => (purpose.test(b.text) || summary.test(b.text)) && recommendation.test(b.text),
  );

  return {
    key: "paper_summaries",
    name: "Papers stating a purpose and a recommendation",
    value: complete.length,
    unit: `of ${papers.length} papers in the extract`,
    source: `Papers found: ${papers.map((b) => `item ${b.number}`).join(", ")}. Complete: ${
      complete.map((b) => `item ${b.number}`).join(", ") || "none"
    }.`,
    page: pageOf(pack, "Item"),
    method:
      "Split the pack at each paper heading, then tested each paper's own block for a " +
      "purpose or summary and a recommendation.",
    threshold: "any substantive paper without a stated purpose and recommendation",
    notable: complete.length < papers.length,
    derived: true,
  };
}

// --------------------------------------------------------- 6. months since last review

/**
 * Months since the last external effectiveness review.
 *
 * Read from the review document's own date, or a statement in the calendar — both
 * facts ABOUT documents rather than claims inside them.
 */
function monthsSinceReview(docs: TypedDocument[]): Figure | null {
  const when = asOf(docs);
  if (!when) return null;

  const review = find(docs, "previous_review");
  const calendar = find(docs, "board_calendar");

  let reviewed: Date | null = null;
  let source = "";
  let page: number | null = null;
  let method = "";

  if (review) {
    const t = flatten(review.text);
    const commissioned = t.match(
      /(?:commissioned|carried out|presented)[^.]{0,40}?\b([A-Z][a-z]+\s+(?:19|20)\d{2})/,
    );
    const titled = t.match(/(?:effectiveness review|health check|board review)\s*((?:19|20)\d{2})/i);
    if (commissioned) {
      reviewed = parseDate(`1 ${commissioned[1]}`);
      source = sentenceAround(t, commissioned[0]);
      page = pageOf(review, commissioned[0]);
      method = "Read from the date the review states for itself.";
    } else if (titled) {
      reviewed = new Date(Date.UTC(Number(titled[1]), 5, 30)); // month unknown, assume mid-year
      source = sentenceAround(t, titled[0]);
      page = pageOf(review, titled[0]);
      method = "Read from the year in the review's own title. The month is not stated, so mid-year is assumed.";
    }
  }

  if (!reviewed && calendar) {
    const t = flatten(calendar.text);
    const m = t.match(/last\s+was\s+in\s+((?:19|20)\d{2})/i);
    if (m) {
      reviewed = new Date(Date.UTC(Number(m[1]), 5, 30));
      source = sentenceAround(t, m[0]);
      page = pageOf(calendar, m[0]);
      method = "Read from the calendar's statement of when the last review was. The month is not stated, so mid-year is assumed.";
    }
  }

  if (!reviewed) return null;
  const months = Math.max(0, monthsBetween(reviewed, when));

  // Two defensible dates exist and they can straddle the threshold: Brambleside's
  // review was commissioned in 2023 but presented in January 2024 — 37 months
  // against 30. The presented date is used, because that is when the board received
  // it, but where the documents themselves say a review is due that is surfaced
  // rather than resolved silently, since it is the client's own view.
  const calendarSaysDue = calendar
    ? /review is due|expects one every/i.test(flatten(calendar.text))
    : false;

  return {
    key: "months_since_review",
    name: "Months since the last external review",
    value: months,
    unit: "months",
    source,
    page,
    method: `${method} Measured to the meeting the pack was prepared for.`,
    threshold: `more than ${THRESHOLDS.reviewStaleMonths} months`,
    notable: months > THRESHOLDS.reviewStaleMonths || calendarSaysDue,
    derived: true,
    note: calendarSaysDue
      ? "The board calendar states that an external review is due, which is the client's own view regardless of this count."
      : undefined,
  };
}

// ---------------------------------------------------- 7. months since last skills audit

/**
 * Months since the last skills audit.
 *
 * From a skills audit document or the calendar only. On both test sets the sole
 * statement about it sits inside the previous review, which is that consultant's
 * finding rather than a fact about a document — so this returns null there, and the
 * question becomes a gap the tool can ask the client to fill.
 */
function monthsSinceSkillsAudit(docs: TypedDocument[]): Figure | null {
  const when = asOf(docs);
  const source = find(docs, "skills_audit") ?? find(docs, "board_calendar");
  if (!when || !source) return null;

  const t = flatten(source.text);
  const m = t.match(/skills\s+(?:audit|matrix)[^.]{0,60}?\b((?:19|20)\d{2})\b/i);
  if (!m) return null;

  const audited = new Date(Date.UTC(Number(m[1]), 5, 30));
  const months = Math.max(0, monthsBetween(audited, when));

  return {
    key: "months_since_skills_audit",
    name: "Months since the last skills audit",
    value: months,
    unit: "months",
    source: sentenceAround(t, m[0]),
    page: pageOf(source, m[0]),
    method: `Read from the ${source.docType.replace(/_/g, " ")}. Measured to the meeting the pack was prepared for.`,
    threshold: `more than ${THRESHOLDS.reviewStaleMonths} months`,
    notable: months > THRESHOLDS.reviewStaleMonths,
    derived: true,
  };
}

// ----------------------------------------------------------------- 8. static risks

/** Risks the register itself records as not having moved. */
function staticRisks(docs: TypedDocument[]): Figure | null {
  const register = find(docs, "risk_register");
  if (!register) return null;

  const t = flatten(register.text);
  let count = 0;
  let mostQuarters = 0;
  let source = "";

  for (const m of t.matchAll(/unchanged[^.]{0,60}?for\s+(\w+)\s+(?:consecutive\s+)?quarters/gi)) {
    count += 1;
    const q = readNumber(m[1]) ?? 0;
    if (q > mostQuarters) mostQuarters = q;
    if (!source) source = sentenceAround(t, m[0]);
  }
  if (count === 0) return null;

  return {
    key: "static_risks",
    name: "Risks with an unmoved score",
    value: count,
    unit: `risk(s), longest ${mostQuarters} quarters`,
    source,
    page: pageOf(register, source.slice(0, 40)),
    method: "Counted statements in the register that a risk score has not moved.",
    threshold: `a score unmoved for ${THRESHOLDS.staticRiskQuarters} quarters or more`,
    notable: mostQuarters >= THRESHOLDS.staticRiskQuarters,
    derived: true,
  };
}

// --------------------------------------------------------------- 9. items deferred

/**
 * Items the documents record as deferred, and how often.
 *
 * The client's bar is "deferred MORE THAN once", so a single deferral is computed
 * and deliberately not notable — one deferral is ordinary business.
 */
function deferredItems(docs: TypedDocument[]): Figure | null {
  let count = 0;
  let most = 0;
  let source = "";
  let page: number | null = null;

  for (const doc of docs) {
    if (!PRIMARY.includes(doc.docType)) continue; // never the previous review's findings
    const t = flatten(doc.text);
    for (const m of t.matchAll(/deferr?ed\s+(once|twice|three times|more than once)/gi)) {
      count += 1;
      const key = m[1].toLowerCase();
      const times = key === "more than once" ? 2 : (readNumber(key) ?? 1);
      if (times > most) most = times;
      if (!source) {
        source = sentenceAround(t, m[0]);
        page = pageOf(doc, m[0]);
      }
    }
  }
  if (count === 0) return null;

  return {
    key: "deferred_items",
    name: "Items recorded as deferred",
    value: count,
    unit: most > 1 ? `item(s), one deferred ${most} times` : "item(s), none more than once",
    source,
    page,
    method: "Counted statements in the primary documents that an item was deferred.",
    threshold: `an item deferred more than ${THRESHOLDS.deferrals} time(s)`,
    notable: most > THRESHOLDS.deferrals,
    derived: true,
  };
}

// --------------------------------------------------------------- 9. agenda minutes

/**
 * How much meeting time the agenda allows.
 *
 * Context, not a finding: a board having 300 minutes is neither good nor bad. It earns
 * its place by composing with the noting split and the pack length — Karl's example
 * line is "nine of the fourteen items were for noting, against 300 minutes of agenda
 * time", where the minutes are what make the other two land.
 *
 * Stated first, then the span of the Time column. The two agree on Brambleside (stated
 * 300; 10.00 to 15.00 is 300), which is why the fallback is trusted at all. Where the
 * agenda has no closing entry the span understates the meeting, so `method` says so
 * rather than presenting it as the full length.
 */
function agendaMinutes(docs: TypedDocument[]): Figure | null {
  const pack = find(docs, "board_pack");
  if (!pack) return null;
  const t = flatten(pack.text);

  const base = {
    key: "agenda_minutes",
    name: "Agenda time",
    unit: "minutes",
    threshold: "context only — never a finding on its own",
    notable: false,
    context: true,
  };

  const stated = t.match(/(\d{2,3})\s+minutes\s+of\s+agenda\s+time/i);
  if (stated) {
    return {
      ...base,
      value: Number(stated[1]),
      source: snippet(t, stated[0]),
      page: pageOf(pack, stated[0]),
      method: "Read from the figure the agenda states for itself.",
      derived: false,
    };
  }

  // Fallback: first to last time in the agenda's Time column.
  const rows = tableRows(pack.text);
  const isHeader = (r: string[]) => r.some((c) => /^time$/i.test(c));
  const headers = rows.filter(isHeader);
  if (!headers.length) return null;

  // An agenda that continues over a page break is extracted as several tables, and
  // the Time column does not land at the same index in each — Northgate's second
  // agenda table puts it at 8 rather than 4, and reading only the first index stopped
  // the span at 15.50 when the agenda runs to 16.50. So every Time index is read.
  const cols = [...new Set(headers.map((h) => h.findIndex((c) => /^time$/i.test(c))))];

  const mins: number[] = [];
  for (const row of rows) {
    if (isHeader(row)) continue;
    for (const col of cols) {
      if (!row[col]) continue;
    for (const m of row[col].matchAll(/\b(\d{1,2})[.:](\d{2})\b(?!\s*%)/g)) {
      const h = Number(m[1]);
      const mi = Number(m[2]);
      // Must actually be a clock time. Northgate's agenda table collapses into the
      // KPI table on extraction, where "99.97%" availability reads as 99 hours 97
      // minutes and produced an 87-hour meeting. A decimal is not a time.
      if (h > 23 || mi > 59) continue;
      mins.push(h * 60 + mi);
      }
    }
  }
  if (mins.length < 2) return null;

  const span = Math.max(...mins) - Math.min(...mins);
  if (span <= 0) return null;

  return {
    ...base,
    value: span,
    source: `Agenda table, Time column: ${clock(Math.min(...mins))} to ${clock(Math.max(...mins))}.`,
    page: pageOf(pack, headers[0].join(" ")) ?? 1,
    method:
      "First to last entry in the Time column. The agenda states no closing time, so this is the span of scheduled items rather than the length of the meeting.",
    derived: true,
  };
}

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}.${String(m % 60).padStart(2, "0")}`;

const FIGURES = [
  packPages,
  pagesPerPaper,
  noticeDays,
  itemsForNoting,
  paperSummaries,
  monthsSinceReview,
  monthsSinceSkillsAudit,
  staticRisks,
  deferredItems,
  agendaMinutes,
  worseningMeasures,
];

// ------------------------------------------------- 11. measures worsening against target

/**
 * How many performance measures are moving the wrong way.
 *
 * WHY THIS ONE EXISTS. It is the missing half of the client's richest evidence shape:
 * "Your Q1 report describes the quarter as solid, while seven of the fifteen measures are
 * worsening, including all four financial measures." The commentary is a quotation; the
 * count is arithmetic. Without the count computed here the model could only produce it by
 * quoting, and no passage states it — so the claim would fail verification every time and
 * the shape would be unreachable. A contradiction inside one document is only available
 * to us if both halves are.
 *
 * Read from the Trend column the board's own report supplies, so the judgement of what
 * counts as worsening is the client's rather than ours. Nothing is inferred from the
 * numbers: a measure moving from 4.8% to 5.1% is worsening because the report says
 * Worsening, not because we compared two figures and decided.
 *
 * Notable whenever any measure is worsening, with no threshold: unlike a page count,
 * there is no level at which "some measures are getting worse" stops being worth putting
 * in front of a respondent. The count and the total are both carried in the unit so a
 * line can state the proportion the client's exemplar states.
 */
function worseningMeasures(docs: TypedDocument[]): Figure | null {
  const pack = find(docs, "board_pack");
  if (!pack) return null;

  let worsening = 0;
  let improving = 0;
  let total = 0;
  let source = "";

  for (const page of pack.pages) {
    for (const row of tableRows(page.text)) {
      // A measure row carries a trend verdict in one of its cells. Header and separator
      // rows do not, which is what distinguishes them without hard-coding a column index
      // — the tables differ between clients.
      // Two vocabularies, because the clients use different ones: Brambleside's report
      // says Improving/Worsening, Northgate's variance column says ahead/worse. Both are
      // the board's own verdict on direction, which is the point — the judgement stays
      // the client's and is never inferred by comparing numbers here.
      const trend = row.find((cell) =>
        /^(improving|worsening|on plan|stable|flat|worse|ahead|behind|better|under)$/i.test(cell.trim()),
      );
      if (!trend) continue;
      total += 1;
      if (/worsening|worse|behind/i.test(trend)) {
        worsening += 1;
        if (!source) source = row.filter(Boolean).join(" | ").slice(0, 200);
      } else if (/improving|ahead|better/i.test(trend)) {
        improving += 1;
      }
    }
  }
  // A table that did not survive extraction is left as null, deliberately.
  //
  // Northgate's scorecard comes out of the PDF as one cell holding all thirteen metric
  // names and another holding all their values, so nothing row-wise can read it. Counting
  // the trend words that DO survive was tried and rejected: it yields "6 of 9 measures"
  // against a real denominator of thirteen, because four verdicts are lost in the same
  // mangling. A plausible wrong figure in a client deliverable is worse than no figure,
  // and this file's rule is that a value is null when the documents do not support it.
  //
  // The fix belongs upstream in extraction, not here.
  if (total === 0) return null;

  return {
    key: "worsening_measures",
    name: "Performance measures worsening against target",
    value: worsening,
    unit: `of ${total} measures (${improving} improving)`,
    source,
    page: source ? pageOf(pack, source.slice(0, 40)) : null,
    method:
      "Counted rows in the performance table whose own Trend column reads Worsening, " +
      "against the total number of measures reported.",
    threshold: "any measure moving away from target",
    notable: worsening > 0,
    derived: true,
  };
}

/** Every figure the documents support. Deterministic: same documents, same output. */
export function computeFigures(docs: TypedDocument[]): Figure[] {
  const out: Figure[] = [];
  for (const fn of FIGURES) {
    const figure = fn(docs);
    if (figure) out.push(figure);
  }
  return out;
}
