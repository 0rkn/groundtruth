/**
 * The shape of a finished appraisal.
 *
 * This is the contract between the pipeline and the interface. It is defined in one
 * place, before either is built, so the two cannot drift — and so the UI can be written
 * against it without waiting for the pipeline underneath.
 *
 * Everything a client would read is here, and nothing that would let the interface
 * invent something: a page never has to compute a figure, guess a citation or decide
 * whether a question counts as answered.
 */
import type { Scale, Theme } from "../data/questions.ts";

/**
 * evidenced — one or more quotations from the documents, each lifted verbatim by code
 * standard  — nothing was found, after genuinely searching everything supplied
 */
export type QuestionState = "evidenced" | "standard";

export interface EvidenceQuote {
  document: string;
  page: number;
  /** The verbatim span, lifted by code — never typed by the model. */
  quote: string;
  /**
   * True when this is a figure computed from the whole corpus rather than a span of one
   * document. It has no page it "appears on" in the way a quotation does, so the
   * interface must show it as a computed fact, never as though `page` cited a PDF.
   */
  computed?: boolean;
  /**
   * True when a consultant added this quotation by hand, after the run finished, rather
   * than the model selecting it during generation. Still never taken on trust: the
   * server checks the pasted text against the real page before accepting it, the same
   * verbatim standard every other quote on this page holds to. Shown distinctly in the
   * interface so it is never mistaken for something the pipeline itself found.
   */
  manual?: boolean;
}

export interface AppraisalQuestion {
  id: string;
  theme: Theme;
  text: string;
  scale: Scale;
  /** The five labels for this question's scale, in order. Never numbers alone. */
  scaleLabels: readonly [string, string, string, string, string];
  state: QuestionState;
  /**
   * "What we drew from it" — one plain sentence restating the evidence below, never a
   * conclusion. Present only when `summarise()` produced one; a question can be
   * evidenced with only `sources` and no summary when the paraphrase failed its own
   * number check, since the quotes are the fact of record regardless.
   */
  summary?: string;
  /** Present only when state is "evidenced". One to three, in document order. */
  sources?: EvidenceQuote[];
  /**
   * Present only on a question that already came back with no evidence, and only when a
   * document type this question's own material usually rests on was not among the
   * uploads. A NOTE, not a reason: it is attached after the search failed, never used
   * to decide not to search. Using this to skip a question before trying it was a real
   * defect — it was wrong about which document would have answered a question more
   * often than it was right, because the other supplied documents frequently covered it
   * anyway. Captioning a genuine blank is a much smaller claim than that.
   */
  missingDocument?: string;
}

export interface AppraisalTheme {
  name: Theme;
  questions: AppraisalQuestion[];
  counts: Record<QuestionState, number>;
}

export interface Appraisal {
  /** The meeting the documents were prepared for, not the wall clock. */
  asOf: string | null;
  documents: { filename: string; pages: number; type: string }[];
  /** What the documents show the organisation to be, and which questions that selected. */
  signals: string[];
  themes: AppraisalTheme[];
  counts: Record<QuestionState, number>;
  questionCount: number;
  /**
   * Figures computed in code, with their method and source, shown to the consultant
   * rather than the board. Every one is checkable against the documents.
   */
  figures: {
    key: string;
    name: string;
    value: number | null;
    unit: string;
    page: number | null;
    method: string;
    notable: boolean;
    source: string;
  }[];
  /** True when this result came from the cache rather than a fresh run. */
  cached: boolean;
}

/** Progress for the interface while an appraisal runs. Generation takes ~2 minutes. */
export type AppraisalStatus =
  | { state: "queued" }
  | { state: "running"; step: string; done: number; total: number }
  | { state: "ready"; appraisal: Appraisal }
  | { state: "failed"; error: string };
