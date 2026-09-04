/**
 * Pick the parts of a document that answer a question — by number, never by typing them.
 *
 * WHY NOT ASK FOR THE QUOTE ITSELF. Two designs came before this and both put the model in
 * charge of the words. First it wrote a sentence about the passages and a checker had to
 * establish that the sentence was true; policing prose mechanically only taught it to write
 * prose that passes, so the verdict it wanted came back as a trailing clause. Then it was
 * asked to copy a span exactly, and exact matching is brittle for a reason unrelated to
 * honesty: a model that drops "the", fixes a comma or joins two clauses has chosen the
 * right evidence and still fails. Rejecting correct selections over transcription slips was
 * the largest discard class we had.
 *
 * So the model never types document text. Lines are numbered and it returns NUMBERS. The
 * words are lifted out by code, which removes verification rather than passing it: there is
 * no quote to check, because the quote is a slice of the source.
 *
 * EACH PICK KEEPS ITS OWN SOURCE. An earlier version joined the chosen lines with a space
 * and stamped the first one's document and page on the result, which printed one document's
 * words under another document's citation — the single thing this tool must never do. Picks
 * are a list now, each carrying where it came from, and two sources side by side is the
 * client's contradiction shape arriving without anyone having to assert it.
 *
 * WHAT THE CONSTANTS BELOW ARE FOR, since each was written against an observed failure:
 *
 *   RULE              a markdown table's rule-row separator, which carries nothing
 *   COLLAPSED_COLUMN  four or more bare integers in a row, the signature of extraction
 *                     transposing a table into one cell.
 *   isTableDebris     the same collapse when the column holds NAMES or ROLES instead of
 *                     numbers: real prose is roughly a third function words, a jammed
 *                     column of nouns is not.
 *   DANGLING          a line whose subject is in the sentence before it, repaired from its
 *                     neighbour in the same passage.
 *   PROMISES_MORE     a line ending on a colon promises content it does not carry, and is
 *                     dropped rather than shipped.
 *
 * Tables themselves are KEPT, rendered with cells comma-separated rather than discarded —
 * they hold the performance measures, the agenda's page counts and the financial forecasts,
 * the best evidence in the pack. Nothing is reordered or relabelled: we cannot always tell
 * which column is which, and inventing a header would be worse than showing the row plainly.
 *
 * TWO KINDS OF UNIT ARE SYNTHESISED RATHER THAN SPLIT FROM A SENTENCE, both still lifted by
 * code and never typed by the model:
 *
 *   agendaRowUnits  one clean line per agenda item, built positionally from the table's
 *                   item, pages and time columns — the same technique that recovered which
 *                   paper the pack's longest item was in figures.ts. Needed because the
 *                   item NAMES collapse into one unreadable cell and cannot be recovered;
 *                   without a synthetic row, a question about agenda time or page
 *                   allocation had nothing specific to select and fell back to the
 *                   document's cover page.
 *   figureUnits     the values figures.ts computes from the whole corpus, offered to every
 *                   question exactly as the old pipeline did. A figure is arithmetic over
 *                   every passage rather than a slice of one, so it carries the page the
 *                   underlying fact was read from rather than being attached to a single
 *                   passage.
 */
import { generate } from "./cf.ts";
import { tableRows, type Figure } from "./figures.ts";
import type { Commitment } from "./commitments.ts";

/** A span of a document: what it is, and where it came from. */
export interface Source {
  document: string;
  page: number;
  text: string;
}

export interface Quote {
  text: string;
  document: string;
  page: number;
  /**
   * True when this is a figure computed from the whole corpus rather than a span of one
   * document. It has no single page it "appears on" — `page` is carried for the
   * consultant's own working notes only, and the interface must not print it as though
   * it were a citation into a PDF.
   */
  computed?: boolean;
}

export interface Pick {
  questionId: string;
  quotes: Quote[];
}

interface Unit extends Quote {
  n: number;
  previous?: Unit;
}

function clean(text: string): string {
  return text
    .replace(/\*{1,3}/g, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

const COLLAPSED_COLUMN = /\b\d{1,2}(?:\s+\d{1,2}){3,}\b/;

const FUNCTION_WORDS = new Set(
  "the a an is are was were be been being to of and or that this these those for with on in at by from as it its their our we will not no than then which who what when where how across against per each every within without also so if but do does".split(
    " ",
  ),
);

function isTableDebris(text: string): boolean {
  if (text.length < 120) return false;
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  const ratio = words.filter((w) => FUNCTION_WORDS.has(w)).length / words.length;
  return ratio < 0.15;
}

function readable(line: string): string {
  if (!line.includes("|")) return clean(line);
  return clean(
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
      .join(", "),
  );
}

const DANGLING = /^(this|that|these|those|it|they|such)\b/i;
const REFERS_BACK = /\bresponds to this\b|\bin response to this\b/i;
const PROMISES_MORE = /[:;]$/;

const SENTENCE_BREAK = /\n+|(?<=[.!?])\s+(?=[A-Z])/;

function units(
  passages: Source[],
  figures: Figure[] = [],
  commitments: Commitment[] = [],
  commentary: Source[] = [],
): Unit[] {
  const out: Unit[] = [];
  let n = 1;
  for (const p of passages) {
    let previous: Unit | undefined;
    for (const raw of p.text.split(SENTENCE_BREAK)) {
      if (RULE.test(raw.trim())) continue;
      const text = readable(raw);
      if (text.length < 25) continue;
      if (COLLAPSED_COLUMN.test(text)) continue;
      if (isTableDebris(text)) continue;
      const unit: Unit = { n: n++, text, document: p.document, page: p.page, previous };
      out.push(unit);
      previous = unit;
    }
  }
  out.push(...agendaRowUnits(passages, n));
  n = out.length + 1;
  out.push(...figureUnits(figures, n));
  n = out.length + 1;
  out.push(...commitmentUnits(commitments, n));
  n = out.length + 1;
  out.push(...commentaryUnits(commentary, n));
  return out;
}

/**
 * The previous review's numbered recommendations, as candidate units.
 *
 * The board accepted these, so they are quotable facts about the client in the same way
 * a corporate plan's own commitments are — never as the prior consultant's findings,
 * only as what the board undertook to do. Text is `extractCommitments`'s own verbatim
 * capture, not composed here.
 */
function commitmentUnits(commitments: Commitment[], startN: number): Unit[] {
  let n = startN;
  return commitments.map((c) => ({
    n: n++,
    text: `Recommendation ${c.number} of the board's ${c.reviewYear ?? "previous"} effectiveness review: ${c.text}`,
    document: c.document,
    page: c.page,
  }));
}

function agendaRowUnits(passages: Source[], startN: number): Unit[] {
  const out: Unit[] = [];
  let n = startN;
  for (const p of passages) {
    const rows = tableRows(p.text);
    const header = rows.find((r) => r.some((c) => /^#$/.test(c)));
    if (!header) continue;

    const itemCol = header.findIndex((c) => c === "#");
    const pagesCol = header.findIndex((c) => /^pages$/i.test(c));
    const timeCol = header.findIndex((c) => /^time$/i.test(c));
    if (itemCol < 0 || (pagesCol < 0 && timeCol < 0)) continue;

    for (const row of rows) {
      if (row === header || !row[itemCol]) continue;
      const items = row[itemCol].split(/\s+/).filter(Boolean);
      const pages = pagesCol >= 0 ? row[pagesCol].split(/\s+/).filter(Boolean) : [];
      const times = timeCol >= 0 ? row[timeCol].split(/\s+/).filter(Boolean) : [];
      if (pagesCol >= 0 && pages.length !== items.length) continue;
      if (timeCol >= 0 && times.length !== items.length) continue;

      items.forEach((item, i) => {
        const parts = ["Agenda item " + item];
        if (pages[i]) parts.push(pages[i] + " pages");
        if (times[i]) parts.push("scheduled at " + times[i]);
        if (parts.length < 2) return;
        out.push({
          n: n++,
          text: parts.join(", ") + ".",
          document: p.document,
          page: p.page,
        });
      });
    }
  }
  return out;
}

/**
 * A board pack's own narrative commentary on its performance table — extracted once from
 * the whole document set, the same way `extractCommitments`/`computeFigures` are, and
 * offered to every question rather than depending on per-question embedding retrieval to
 * surface it.
 *
 * WHY THIS EXISTS. `worseningMeasures` in `figures.ts` already computes, for every
 * question, how many measures a performance table's own Trend column marks worsening —
 * that half of the client's contradiction shape (a) was never the problem. The other
 * half is a real passage ("Overall the Trust has delivered a solid quarter...") that sits
 * on the same page, but a 140-word chunker and a per-question topK of 8 have no reason to
 * ever place it in the same candidate pool as the count it contradicts: the chunk
 * competes on its own embedding, for an abstract question whose wording resembles neither
 * the count nor the commentary especially closely. Confirmed empirically — across all 48
 * Brambleside questions in two full runs, this exact sentence never appeared in a single
 * candidate pick, not because pick.ts rejected it but because retrieval never offered it.
 *
 * So this reads the FULL page text of every document, not the per-question retrieved
 * subset — a figure is computed once and handed to every question; this is extracted
 * once and handed to every question the same way, never itself subject to topK. The text
 * is still lifted verbatim from the document, inside the label's own quotation marks —
 * nothing here composes a sentence, it only decides which document text is a candidate.
 *
 * TWO LABELS, because the clients word this differently — Brambleside's board pack says
 * "Commentary from the report body", Northgate's says "Narrative extract". Same
 * enumerated-vocabulary trade-off `worseningMeasures` in `figures.ts` already makes for
 * Improving/Worsening versus ahead/worse: the judgement of what counts as narrative stays
 * the client's own label, not something inferred here, at the cost of a third client's own
 * wording needing to be added to this list the same way. Northgate's own narrative text is
 * additionally mangled by table extraction on the page it sits on — this pattern recovers
 * what survives; a passage that does not survive extraction cleanly is not recoverable
 * here any more than a table `figures.ts` cannot read is.
 *
 * STATUS: this makes the candidate exist, but does not make `pickQuote` reliably select
 * it alongside `worseningMeasures`. Tested with the selection cap at both 3 and 4 lines —
 * raising it did not help; a second run at 4 didn't even reselect the figure it had picked
 * at 3, let alone pair it with this commentary. That is the model's own judgement about
 * what best answers a given question, not a capacity problem, and not something a bigger
 * cap or a dedicated confirmation pass built on this same enumerated-label foundation
 * should be trusted to force reliably — stacking this label list on top of
 * `worseningMeasures`'s own enumerated trend-word list compounds exactly the kind of
 * hardcoded-keyword fragility this project already learned to avoid once (see the
 * module docstring on why `pickQuote` never lets a model type or judge by keyword). Left
 * in because the candidate existing is still strictly more correct than it not existing,
 * not because shape (a) is considered solved.
 */
const QUOTE = `["“”]`;
// The gap between the label's colon and the quoted text is `[\s*]*`, not `\s*` — a
// markdown bold-closing `**` sits there in practice ("...paragraph 4.2:** "Overall..."),
// and without skipping it the capture starts on the asterisks themselves rather than the
// sentence, silently returning "** " instead of the quote. Found by testing this pattern
// against the real extracted text rather than a hand-typed approximation of it.
const COMMENTARY = new RegExp(
  `(?:Commentary from the report body|Narrative extract)[^:]*:[\\s*]*${QUOTE}?([^"“”\\n]+)${QUOTE}?`,
  "gi",
);

export function extractCommentary(docs: { filename: string; pages: { number: number; text: string }[] }[]): Source[] {
  const out: Source[] = [];
  for (const doc of docs) {
    for (const page of doc.pages) {
      for (const match of page.text.matchAll(COMMENTARY)) {
        const text = match[1].trim();
        // A label sitting inside a markdown table (Northgate's own layout mangles this
        // way) captures a run-on table row rather than a sentence — a `|` cell delimiter
        // or table debris here means the label survived extraction but the prose next to
        // it did not, and a garbled row is worse to show than nothing. Same rule
        // `isTableDebris` already applies to ordinary passage units, reused here rather
        // than duplicated.
        if (text.includes("|") || isTableDebris(text) || text.length < 15) continue;
        out.push({ text, document: doc.filename, page: page.number });
      }
    }
  }
  return out;
}

function commentaryUnits(commentary: Source[], startN: number): Unit[] {
  let n = startN;
  return commentary.map((c) => ({ n: n++, text: c.text, document: c.document, page: c.page }));
}

function figureUnits(figures: Figure[], startN: number): Unit[] {
  let n = startN;
  return figures
    .filter((f) => f.value !== null)
    .map((f) => ({
      n: n++,
      text: (f.name + ": " + f.value + " " + f.unit).trim(),
      document: "computed from the documents",
      page: f.page ?? 0,
      computed: true,
    }));
}

function whole(unit: Unit): Unit {
  const needsContext = DANGLING.test(unit.text) || REFERS_BACK.test(unit.text);
  if (!needsContext || !unit.previous) return unit;
  return { ...unit, text: unit.previous.text + " " + unit.text };
}

function prompt(question: string, list: Unit[]): string {
  const lines = list.map((u) => u.n + ". " + u.text).join("\n");
  return [
    "A governance consultant is appraising a housing association's board. For the question below, choose the numbered line or lines a director should read before scoring it.",
    "",
    "QUESTION: " + question,
    "",
    "LINES FROM THE BOARD'S DOCUMENTS:",
    lines,
    "",
    "Choose at most three numbers.",
    "",
    "Choose the most SPECIFIC line available. One carrying a date, a count, a name or a decision beats one describing a routine: \"There is no written succession plan\" is evidence, \"succession is reviewed annually\" is not.",
    "",
    "Text on a related subject is NOT evidence. A line about risk reporting does not answer a question about a subsidiary; a line about the performance report does not answer a question about the company secretary. Where the lines are merely nearby in subject, reply NONE. A blank row is correct and useful; a loose match is not.",
    "",
    "A line beginning \"Recommendation N of the board's ... review\" is a commitment the board made to itself in the past. It IS evidence for a question about whether that same practice happens now — not a different time period, the answer to whether it was followed.",
    "",
    "If two lines answer this question and state DIFFERENT things — one claims something the other contradicts, such as a report calling performance strong while a table beside it shows measures worsening — choose both. Do not pick a second line just because it is on the same topic; only because it disagrees with the first.",
    "",
    "If nothing here bears on the question, reply with exactly: NONE",
    "",
    "EXAMPLE 1",
    "QUESTION: Succession planning is in place for the chair, committee chairs and the chief executive.",
    "LINES FROM THE BOARD'S DOCUMENTS:",
    "1. The board meets six times a year, with an additional away day in the spring.",
    "2. Recommendation 5 of the board's 2022 effectiveness review: Appoint a permanent deputy chair within twelve months, to provide continuity if the chair is unexpectedly unavailable.",
    "3. The audit committee reviews internal controls twice yearly.",
    "Correct answer: {\"lines\": [2]}",
    "Line 2 is a past commitment, and this question asks whether that same practice (succession cover) is in place now — the recommendation IS the evidence, not a description of a different time period. Lines 1 and 3 are routine and on an unrelated subject.",
    "",
    "EXAMPLE 2",
    "QUESTION: The board has sufficient access to independent legal advice.",
    "LINES FROM THE BOARD'S DOCUMENTS:",
    "1. The finance committee reviews the annual budget in November.",
    "2. Board meetings are held in the boardroom at head office.",
    "Correct answer: NONE",
    "Neither line is on the subject of legal advice at all — not a loose match, no match. NONE is correct here, not a guess at the nearest available line.",
    "",
    "Do not write any of the text out. Reply with the numbers only, as JSON: {\"lines\": [7]}",
  ].join("\n");
}

export async function pickQuote(
  questionId: string,
  question: string,
  passages: Source[],
  figures: Figure[] = [],
  commitments: Commitment[] = [],
  commentary: Source[] = [],
): Promise<Pick | null> {
  const list = units(passages, figures, commitments, commentary);
  if (list.length === 0) return null;

  let reply: string;
  try {
    reply = await generate(prompt(question, list), 300);
  } catch {
    return null;
  }

  if (/^\s*NONE\s*$/im.test(reply)) return null;

  const match = reply.match(/\{[\s\S]*?\}/);
  if (!match) return null;

  let parsed: { lines?: unknown };
  try {
    parsed = JSON.parse(match[0]) as typeof parsed;
  } catch {
    return null;
  }

  const byNumber = new Map(list.map((u) => [u.n, u]));
  const quotes = (Array.isArray(parsed.lines) ? parsed.lines : [])
    .map((v) => byNumber.get(Number(v)))
    .filter((u): u is Unit => Boolean(u))
    .sort((a, b) => a.n - b.n)
    .slice(0, 3)
    .map(whole)
    .filter((u) => !PROMISES_MORE.test(u.text))
    .map(({ text, document, page, computed }) => ({ text, document, page, ...(computed ? { computed } : {}) }));

  return quotes.length ? { questionId, quotes } : null;
}
