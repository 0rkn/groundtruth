/**
 * The whole pipeline, in one place.
 *
 * Every stage meets here, so this file is where a mistake would be invisible: each part
 * is tested on its own, and the risk is that they are wired together wrongly and the
 * result still looks plausible.
 *
 * Deterministic parts first, model parts last:
 *
 *   extract -> type documents -> compute figures -> select questions -> retrieve -> pick
 *
 * Only the last step involves a model, and it is one small call per question rather than
 * the batched, multi-stage generation this file used to run. That replacement is the
 * biggest change in this file's history, and the reason is worth recording: the batched
 * design put a model in charge of composing a sentence about eight passages, nine
 * figures and fourteen recommendations at once, and asked a checker to prove the
 * sentence true afterwards. It produced borrowed quotes, restated the same fact under
 * three questions, and — when a question had nothing to answer it — invented a plausible
 * one anyway, because omitting was one option among many in a large ask rather than the
 * whole task. Reading twenty of its lines end to end, rather than trusting the pass
 * counts, is what surfaced this.
 *
 * The model now does one thing per call: given a question and the numbered lines drawn
 * from its retrieved passages, its computed figures and its agenda rows, return which
 * numbers answer it, or none. Code lifts the chosen text verbatim. There is no
 * verification stage because there is nothing left to verify — a model that only ever
 * returns numbers cannot misquote, invent a figure, or draw a conclusion, and a question
 * with nothing to answer it produces an honest blank rather than a plausible-sounding
 * guess.
 */
import { extractDocument, type Document } from "./extract.ts";
import { eligibleDocuments } from "./passages.ts";
import { fixedSize } from "./chunkers.ts";
import { embeddableText } from "./embeddable.ts";
import { indexPassages } from "./retrieve.ts";
import { embed, query, kvPut } from "./cf.ts";
import { computeFigures, asOf, type DocType, type TypedDocument } from "./figures.ts";
import { classifyDocument } from "./classify.ts";
import { select } from "./select.ts";
import { pickQuote, extractCommentary } from "./pick.ts";
import { summarise } from "./summarise.ts";
import { pairAll } from "./compare.ts";
import { extractCommitments } from "./commitments.ts";
import { SCALES, THEMES, type Question } from "../data/questions.ts";
import { appraisalKey, cached } from "./cache.ts";
import type { Appraisal, AppraisalQuestion, QuestionState } from "./appraisal.ts";

/** Passages considered per question. Measured retrieval configuration; see check:retrieval. */
const TOPK_PER_QUESTION = 8;

/**
 * Board words removed from the probe.
 *
 * Every question opens "The board...", and that stem dominated the embedding: one
 * passage about how many seats the board has topped three unrelated questions. Removing
 * it moved the covenants question from outside the top 32 to rank 2. Measured at +3
 * questions across every index variant, the only robustly evidenced retrieval finding.
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

/**
 * Document type from the filename prefix, where the upload follows this exercise's own
 * numbering — falling back to the document's own title otherwise.
 *
 * The prefix map exists because this exercise's fixtures are named "01-corporate-plan.pdf"
 * and so on, and there is no reason to discard a signal that exact. A real upload will
 * rarely follow it, which is exactly what `classifyDocument` is for.
 */
const TYPE_BY_PREFIX: Record<string, DocType> = {
  "01": "corporate_plan",
  "02": "risk_register",
  "03": "board_pack",
  "04": "board_calendar",
  "05": "previous_review",
};

function typeOf(doc: Document): DocType | null {
  return TYPE_BY_PREFIX[doc.filename.slice(0, 2)] ?? classifyDocument(doc);
}

export interface Upload {
  filename: string;
  bytes: Buffer;
}

export type Progress = (step: string, done: number, total: number) => void;

/**
 * What a question's own material usually rests on, named ONLY for a question that has
 * already come back with no evidence — see the note on `AppraisalQuestion.missingDocument`
 * for why this must never gate whether a question is searched.
 */
const DOCUMENT_NAMES: Record<DocType, string> = {
  corporate_plan: "a corporate plan",
  risk_register: "a strategic risk register",
  board_pack: "a board pack",
  board_calendar: "a board and committee calendar",
  previous_review: "a previous effectiveness review",
  minutes: "board minutes",
  skills_audit: "a skills audit",
};

export async function runAppraisal(
  uploads: Upload[],
  onProgress: Progress = () => {},
): Promise<Appraisal> {
  // ---------------------------------------------------------- 1. extract and type
  const docs: Document[] = [];
  const typed: TypedDocument[] = [];
  const untypedFilenames = new Set<string>();
  for (const u of uploads) {
    const doc = await extractDocument(u.bytes, u.filename);
    docs.push(doc);
    const docType = typeOf(doc);
    if (docType) typed.push({ ...doc, docType });
    else untypedFilenames.add(doc.filename);
  }

  // Named after the ACTION under way, not a fixed count of arbitrary stages. There used
  // to be four, and the one that actually takes two minutes — reading every question
  // against the documents — sat behind a single unmoving line the whole time, which is
  // why a run that took its ordinary two minutes could look like it had frozen, or like
  // it had finished "straight away" once it suddenly jumped to done.
  const STAGES = [
    "Reading the documents",
    "Choosing the questions this board is asked",
    "Indexing the documents",
    "Assigning evidence to questions",
  ] as const;
  const TOTAL = STAGES.length;

  onProgress(STAGES[0], 0, TOTAL);
  const chosen = select(docs);
  onProgress(STAGES[1], 1, TOTAL);

  // The cache key is computed from the extracted TEXT, so it is stable across re-uploads
  // of the same documents under different filenames, and changes if the content does.
  const key = appraisalKey(docs.map((d) => d.text));

  // Every page's raw text, kept alongside the appraisal under its own key. Nothing reads
  // this during ordinary generation — `pick.ts` works from in-memory passages that never
  // survive the request. It exists solely so a consultant can later ADD a quotation by
  // hand and have it checked against the real document rather than taken on trust; see
  // `app/api/manual-evidence/route.ts`. Written unconditionally, cache hit or not: cheap,
  // and the alternative is asking someone to re-upload a PDF just to verify one sentence
  // against it.
  await kvPut(
    `documents:${key}`,
    JSON.stringify(docs.map((d) => ({ filename: d.filename, pages: d.pages }))),
  );

  const { value, hit } = await cached<Appraisal>(key, async () => {
    const figures = computeFigures(typed);
    const suppliedTypes = new Set(typed.map((d) => d.docType));
    // The board's own accepted commitments, quotable material for every question.
    const commitments = extractCommitments(docs);
    // A pack's own narrative commentary on its performance table, offered to every
    // question the same way a figure is — see the docstring on `extractCommentary`.
    const commentary = extractCommentary(docs);

    onProgress(STAGES[2], 2, TOTAL);

    // Every document is searched regardless of whether it was typed. Typing gates
    // figures and the missing-document note, never retrieval — an unrecognised document
    // can still be the one that answers a question.
    const passages = (await Promise.all(eligibleDocuments(docs).map((d) => fixedSize.chunk(d)))).flat();
    const byId = new Map(passages.map((p) => [p.id, p]));

    // Namespaced by the cache key, so two runs' passages can never be returned for each
    // other's questions.
    const namespace = `run-${key.slice(-16)}`;
    await indexPassages(passages, namespace, embeddableText);

    onProgress(STAGES[3], 3, TOTAL);

    const bare = (id: string) => id.slice(id.indexOf("--") + 2);

    const questions: AppraisalQuestion[] = [];
    const countOf: Record<QuestionState, number> = { evidenced: 0, standard: 0 };

    const answer = async (question: Question) => {
      const [vector] = await embed([stripBoard(question.text)]);
      const matches = await query(vector, TOPK_PER_QUESTION, namespace);
      const retrieved = matches
        .map((m) => byId.get(bare(m.id)))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({ document: p.document, page: p.page, text: p.text }));

      const picked = await pickQuote(question.id, question.text, retrieved, figures, commitments, commentary);

      const base = {
        id: question.id,
        theme: question.theme,
        text: question.text,
        scale: question.scale,
        scaleLabels: SCALES[question.scale],
      };

      if (picked) {
        countOf.evidenced += 1;
        // Never lets a bad paraphrase hide the evidence: on failure `summary` is simply
        // absent and `sources` — the fact of record — is shown regardless.
        const summary = await summarise(question.text, picked.quotes);
        questions.push({
          ...base,
          state: "evidenced",
          ...(summary ? { summary } : {}),
          sources: picked.quotes.map((q) => ({
            document: q.document,
            page: q.page,
            quote: q.text,
            ...(q.computed ? { computed: true } : {}),
          })),
        });
        return;
      }

      countOf.standard += 1;
      const missing =
        question.expects && !suppliedTypes.has(question.expects)
          ? DOCUMENT_NAMES[question.expects]
          : undefined;
      questions.push({ ...base, state: "standard", ...(missing ? { missingDocument: missing } : {}) });
    };

    // BOUNDED concurrency, not sequential and not all-at-once. All 48 at once is the
    // exact burst that took a 504 down with it once already (14 concurrent commitment
    // queries). Fully sequential was the safe fallback from that, at the cost of ~177
    // round trips run one at a time — a demo-breaking amount of wall-clock time. A small
    // batch is the middle ground: enough concurrency to matter, small enough that it
    // looks nothing like the burst that failed before.
    const CONCURRENCY = 5;
    const queue = [...chosen.questions];
    async function worker() {
      let question: Question | undefined;
      while ((question = queue.shift())) await answer(question);
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // ---------------------------------------------- shape (d): commitment vs figure
    //
    // Pairs each of the board's accepted recommendations to the ONE figure that
    // genuinely tests it — "cap the performance report at twelve pages" against the
    // pack's page count would be a category error, and this is why the pairing is its
    // own narrow model call rather than left to whichever question happened to retrieve
    // the recommendation. Tested in isolation before being wired in here: both real
    // pairs in the fixture data matched correctly (previously one had mismatched a
    // page-limit recommendation to the whole pack's page count rather than the specific
    // paper it named, before `pages_per_paper` carried its own attribution).
    //
    // DELIBERATELY NO ROUTING. This only ENHANCES a question `pick.ts` already decided
    // cites that recommendation — it does not decide which of the 48 questions a
    // recommendation belongs under. Routing was the riskier, less-tested half of the
    // original attempt at this; enhancing an existing citation needed only the pairing
    // itself to be right, which is now checked in isolation before ever reaching here.
    // Pairing costs one model call per commitment, and the loop below only ever attaches
    // a result to a question that already cites that exact recommendation — so a
    // commitment nothing cites can never be attached to anything no matter what
    // `pairAll` returns for it. Filtering to only the cited ones first is pure code, and
    // on a run where selection happened not to cite any recommendation at all (real,
    // observed: not hypothetical), it skips the entire pass rather than spending
    // fourteen sequential calls computing pairings with nowhere to go.
    const citedRecommendationNumbers = new Set(
      questions
        .flatMap((q) => q.sources ?? [])
        .map((s) => /^Recommendation (\d+) of the board's/.exec(s.quote)?.[1])
        .filter((n): n is string => Boolean(n))
        .map(Number),
    );
    const citedCommitments = commitments.filter((c) => citedRecommendationNumbers.has(c.number));
    const pairings = citedCommitments.length > 0 ? await pairAll(citedCommitments, figures) : [];
    for (const pairing of pairings) {
      if (!pairing.figure) continue;
      const recommendationPattern = new RegExp(`^Recommendation ${pairing.commitment.number} of the board's`);

      for (const question of questions) {
        if (question.state !== "evidenced" || !question.sources) continue;
        const citesThisRecommendation = question.sources.some((s) => recommendationPattern.test(s.quote));
        if (!citesThisRecommendation) continue;

        const alreadyHasFigure = question.sources.some(
          (s) => s.computed && s.quote.startsWith(pairing.figure!.name),
        );
        if (alreadyHasFigure) continue;

        question.sources.push({
          document: "computed from the documents",
          page: pairing.figure.page ?? 0,
          quote: `${pairing.figure.name}: ${pairing.figure.value} ${pairing.figure.unit}`.trim(),
          computed: true,
        });

        // Re-paraphrased with the figure now included, so the paraphrase states the
        // comparison rather than only the recommendation it was matched against.
        const refreshed = await summarise(
          question.text,
          question.sources.map((s) => ({ text: s.quote, document: s.document, page: s.page, computed: s.computed })),
        );
        if (refreshed) question.summary = refreshed;
      }
    }

    const when = asOf(typed);

    return {
      asOf: when ? when.toISOString().slice(0, 10) : null,
      documents: docs.map((d) => ({
        filename: d.filename,
        pages: d.pages.length,
        type: untypedFilenames.has(d.filename)
          ? "not recognised"
          : (typed.find((t) => t.filename === d.filename)?.docType ?? "not recognised"),
      })),
      signals: chosen.signals,
      themes: THEMES.map((name) => {
        const inTheme = questions.filter((q) => q.theme === name);
        return {
          name,
          questions: inTheme,
          counts: inTheme.reduce(
            (acc, q) => ({ ...acc, [q.state]: acc[q.state] + 1 }),
            { evidenced: 0, standard: 0 } as Record<QuestionState, number>,
          ),
        };
      }),
      counts: countOf,
      questionCount: questions.length,
      figures: figures.map((f) => ({
        key: f.key,
        name: f.name,
        value: f.value,
        unit: f.unit,
        page: f.page,
        method: f.method,
        notable: f.notable,
        source: f.source,
      })),
      cached: false,
    } satisfies Appraisal;
  });

  onProgress("Done", TOTAL, TOTAL);
  return { ...value, cached: hit };
}
