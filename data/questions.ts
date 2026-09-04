/**
 * The appraisal itself: four fixed themes, and a POOL of sixteen questions each from
 * which each client's questionnaire is selected.
 *
 * WHY A POOL RATHER THAN A FIXED SET. The client described "45 to 50 questions" and
 * "12 per theme". Those only reconcile at 48, so an earlier version fixed the bank at
 * 48 for everyone. Two things say otherwise: a fixed instrument has a number, not a
 * range; and the client's "no N/A" rule only makes sense if questions are selected —
 * if every question went to every board, a director would need somewhere to say one
 * does not apply, which is exactly what is forbidden.
 *
 * This is an inference, not an instruction, and it is recorded as an assumption. It is
 * also the reversible direction: if the set turns out to be fixed, selection takes
 * everything and the old behaviour returns. The reverse would need this pool written
 * from scratch.
 *
 * WHAT DOES NOT MOVE: the four themes, their order, the two scales, and the five
 * questions given in the client's own words. Those are the instrument.
 *
 * WHAT SELECTION MUST NEVER DO: drop a question because no evidence was found for it.
 * That would make the tool ask only what it can already answer — flattering the client,
 * and deleting precisely the gaps worth reporting. Selection reads the documents for
 * what the organisation IS, never for what we managed to find. A test asserts the
 * selected set is identical with and without the computed figures.
 */
import type { DocType } from "../lib/figures.ts";

/**
 * Both scales are labelled at all five points. A number with hints at the ends invites
 * the respondent to invent the middle, and two boards then mean different things by 3.
 */
export type Scale = "agreement" | "quality";

export const SCALES: Record<Scale, readonly [string, string, string, string, string]> = {
  agreement: [
    "Strongly disagree",
    "Disagree",
    "Neither agree nor disagree",
    "Agree",
    "Strongly agree",
  ],
  // The client's own wording. "Very Poor" rather than "Poor" at point 1, because the
  // scale must be symmetrical about Adequate: "Poor, Weak" puts two negative words of
  // uncertain order at the bottom, and a respondent then has to guess which is worse.
  quality: ["Very poor", "Poor", "Adequate", "Good", "Excellent"],
};

export type Theme = "Resources" | "Competency" | "Execution" | "Behaviour";

/**
 * What kind of organisation this is, read from its documents.
 *
 * Deliberately about the ORGANISATION, not about the evidence: a housing association
 * has residents whether or not its pack mentions them well, and a venture-backed
 * company has investors whether or not its board oversees them properly. Detecting
 * "what we found" here instead would collapse selection into self-flattery.
 */
export type Signal =
  | "service_users"    // tenants, residents, or people the organisation directly serves
  | "equity_investors" // shareholders, funding rounds, an equity story
  | "subsidiary"       // a trading subsidiary or group structure
  | "development"      // a capital development or build programme
  | "debt_covenants"   // borrowing with covenants attached
  | "charity"          // charitable status or purpose
  | "regulated"        // a named regulator or regulatory framework
  | "committees";      // formal committees reporting to the board

/** Fixed order. The report is read theme by theme, so the order is part of the method. */
export const THEMES: readonly Theme[] = ["Resources", "Competency", "Execution", "Behaviour"];

export interface Question {
  id: string;
  theme: Theme;
  text: string;
  scale: Scale;
  /**
   * Computed figures that speak to this question, in the order they should be read.
   * The order is deliberate: it is the narrative order of the composed sentence —
   * length, then how many papers, then how few needed a decision, then against how
   * much time — not merely a list.
   *
   * A shorter list means a more specific question, and specificity decides which
   * question a figure is assigned to.
   */
  figures?: readonly string[];
  /**
   * The document type that would normally evidence this question. Used only to tell a
   * genuine gap from an ordinary question: if nothing was found AND this document was
   * never supplied, that is worth telling the client. If nothing was found and the
   * document was supplied, the question is simply one a director answers from
   * experience, which is most of any appraisal.
   */
  expects?: DocType;
  /**
   * Signals the organisation must show for this question to be asked. All must be
   * present. A question with none is universal and is always eligible.
   *
   * This is the whole of the bespokeness in the instrument: asking a fintech about
   * resident scrutiny, or a housing association about its next funding round, is how a
   * generic questionnaire announces itself.
   */
  appliesWhen?: readonly Signal[];
}

export const QUESTIONS: readonly Question[] = [
  // ------------------------------------------------------------------ Resources
  {
    id: "res-01",
    theme: "Resources",
    text: "Board and committee packs are concise, timely and decision ready.",
    scale: "quality",
    figures: ["pack_pages", "pages_per_paper"],
    expects: "board_pack",
  },
  {
    id: "res-02",
    theme: "Resources",
    text: "Information is received with enough lead time for proper consideration.",
    scale: "agreement",
    figures: ["notice_days"],
    expects: "board_pack",
  },
  {
    id: "res-03",
    theme: "Resources",
    text: "Papers open with a summary that states the decision required and the recommendation.",
    scale: "agreement",
    figures: ["paper_summaries"],
    expects: "board_pack",
  },
  {
    id: "res-04",
    theme: "Resources",
    text: "Reports distinguish what the board must decide from what it is merely being told.",
    scale: "agreement",
    // The noting split and the agenda time belong together: "nine of the fourteen
    // items were for noting, against 300 minutes of agenda time" is the client's own
    // exemplar, and the minutes are what make the split land. Declaring them on the
    // packs question instead split the pair, because the specific question takes the
    // split and the general one was left holding the minutes.
    figures: ["items_noting", "agenda_minutes"],
    expects: "board_pack",
  },
  {
    id: "res-05",
    theme: "Resources",
    text: "The board has the management information it needs to hold the executive to account.",    scale: "quality",
    figures: ["worsening_measures"],
    expects: "board_pack",
  },
  {
    id: "res-06",
    theme: "Resources",
    text: "Risk information reaching the board is current and shows movement over time.",
    scale: "quality",
    figures: ["static_risks"],
    expects: "risk_register",
  },
  {
    id: "res-07",
    theme: "Resources",
    text: "The board has sufficient access to independent advice and assurance.",
    scale: "agreement",
  },
  {
    id: "res-08",
    theme: "Resources",
    text: "Governance support to the board, including the company secretarial function, is effective.",
    scale: "quality",
  },
  {
    id: "res-09",
    theme: "Resources",
    text: "Board members have the time available to discharge their duties properly.",
    scale: "agreement",
  },
  {
    id: "res-10",
    theme: "Resources",
    text: "Induction and ongoing development for board members are adequate.",
    scale: "quality",
    expects: "skills_audit",
  },
  {
    id: "res-11",
    theme: "Resources",
    text: "The board's forward plan covers the business it needs to transact across the year.",
    scale: "quality",
    expects: "board_calendar",
  },
  {
    id: "res-12",
    theme: "Resources",
    text: "Committee structures and terms of reference are fit for purpose and not duplicative.",
    scale: "agreement",
  },

  // --- Resources, conditional on what the organisation is -------------------
  {
    id: "res-13",
    theme: "Resources",
    text: "Reports to the board carry what residents and service users are actually saying, not only what was done for them.",
    scale: "quality",
    appliesWhen: ["service_users"],
    expects: "board_pack",
  },
  {
    id: "res-14",
    theme: "Resources",
    text: "The board receives the information it needs on runway, burn and investor commitments.",
    scale: "quality",
    appliesWhen: ["equity_investors"],
    expects: "board_pack",
  },
  {
    id: "res-15",
    theme: "Resources",
    text: "Committee reports give the board what it needs without repeating the committee's own work.",
    scale: "quality",
    appliesWhen: ["committees"],
  },
  {
    id: "res-16",
    theme: "Resources",
    text: "The board receives adequate reporting on the subsidiary's activity and risk.",
    scale: "quality",
    appliesWhen: ["subsidiary"],
  },

  // ----------------------------------------------------------------- Competency
  {
    id: "com-01",
    theme: "Competency",
    text: "Annual board effectiveness reviews take place, with external input at least every three years, and actions are tracked.",
    scale: "agreement",
    figures: ["months_since_review"],
    expects: "previous_review",
  },
  {
    id: "com-02",
    theme: "Competency",
    text: "The board periodically assesses its collective skills against what the strategy requires.",
    scale: "agreement",
    figures: ["months_since_skills_audit"],
    expects: "skills_audit",
  },
  {
    id: "com-03",
    theme: "Competency",
    text: "The board has the mix of skills and experience its current strategy demands.",
    scale: "quality",
    expects: "skills_audit",
  },
  {
    id: "com-04",
    theme: "Competency",
    text: "Recruitment to the board is planned against identified gaps rather than reactive.",
    scale: "agreement",
    expects: "skills_audit",
  },
  {
    id: "com-05",
    theme: "Competency",
    text: "Succession planning is in place for the chair, committee chairs and the chief executive.",
    scale: "quality",
  },
  {
    id: "com-06",
    theme: "Competency",
    text: "Board members understand the regulatory and legal framework the organisation operates in.",
    scale: "agreement",
    expects: "corporate_plan",
  },
  {
    id: "com-07",
    theme: "Competency",
    text: "Board members are sufficiently financially literate for the decisions they take.",
    scale: "agreement",
  },
  {
    id: "com-08",
    theme: "Competency",
    text: "The board understands the organisation's principal risks well enough to challenge on them.",    scale: "quality",
    figures: ["static_risks"],
    expects: "risk_register",
  },
  {
    id: "com-09",
    theme: "Competency",
    text: "The chair leads the board effectively and manages the discussion well.",
    scale: "quality",
    expects: "minutes",
  },
  {
    id: "com-10",
    theme: "Competency",
    text: "Individual board member contributions are appraised and acted on.",
    scale: "agreement",
  },
  {
    id: "com-11",
    theme: "Competency",
    text: "The board draws on the experience of those the organisation serves.",
    scale: "agreement",
  },
  {
    id: "com-12",
    theme: "Competency",
    text: "The board learns from its mistakes and from external failures in the sector.",
    scale: "agreement",
    expects: "minutes",
  },

  // --- Competency, conditional on what the organisation is ------------------
  {
    id: "com-13",
    theme: "Competency",
    text: "The board can draw on lived experience of the communities the organisation serves.",
    scale: "agreement",
    appliesWhen: ["service_users"],
  },
  {
    id: "com-14",
    theme: "Competency",
    text: "The board has the commercial and financing experience its funding stage demands.",
    scale: "quality",
    appliesWhen: ["equity_investors"],
  },
  {
    id: "com-15",
    theme: "Competency",
    text: "The board understands what its regulator expects it to be able to evidence, not just what it does.",
    scale: "agreement",
    appliesWhen: ["regulated"],
  },
  {
    id: "com-16",
    theme: "Competency",
    text: "The board understands the covenants the organisation is bound by and what would breach them.",
    scale: "agreement",
    appliesWhen: ["debt_covenants"],
  },

  // ------------------------------------------------------------------ Execution
  {
    id: "exe-01",
    theme: "Execution",
    text: "The board sets strategic outcomes and monitors progress to outcomes, not just outputs.",
    figures: ["worsening_measures"],
    scale: "agreement",
    expects: "corporate_plan",
  },
  {
    id: "exe-02",
    theme: "Execution",
    text: "Performance reporting shows direction of travel against target, not a single point in time.",    scale: "quality",
    figures: ["worsening_measures"],
    expects: "board_pack",
  },
  {
    id: "exe-03",
    theme: "Execution",
    text: "The board takes decisions when they are due rather than deferring them.",
    scale: "agreement",
    figures: ["deferred_items"],
    expects: "board_calendar",
  },
  {
    id: "exe-04",
    theme: "Execution",
    text: "Agenda time is allocated in proportion to the significance of the business.",
    scale: "quality",
    expects: "board_calendar",
  },
  {
    id: "exe-05",
    theme: "Execution",
    text: "Actions arising from board meetings are tracked to completion.",
    scale: "agreement",
    expects: "minutes",
  },
  {
    id: "exe-06",
    theme: "Execution",
    text: "The board holds the executive to account for delivery against plan.",    scale: "quality",
    figures: ["worsening_measures"],
    expects: "corporate_plan",
  },
  {
    id: "exe-07",
    theme: "Execution",
    text: "Risk appetite is set by the board and used in decisions rather than recorded and left.",
    scale: "agreement",
    // Deliberately declares no figure. An unmoved risk score is evidence about whether
    // risk information shows movement (res-06), not about whether appetite is used in
    // decisions. Declaring it on both left an alphabetical tie-break to choose, and it
    // chose this one — arbitrary, and the worse home of the two.

    expects: "risk_register",
  },
  {
    id: "exe-08",
    theme: "Execution",
    text: "The board addresses poor performance promptly when reporting shows it.",    scale: "agreement",
    figures: ["worsening_measures"],
    expects: "board_pack",
  },
  {
    id: "exe-09",
    theme: "Execution",
    text: "Strategy is revisited when the operating environment changes materially.",
    scale: "agreement",
    expects: "corporate_plan",
  },
  {
    id: "exe-10",
    theme: "Execution",
    text: "The board distinguishes its role from that of the executive in practice, not only in principle.",
    scale: "agreement",
  },
  {
    id: "exe-11",
    theme: "Execution",
    text: "Committees do the detailed work and report to the board in a way that adds value.",
    scale: "quality",
  },
  {
    id: "exe-12",
    theme: "Execution",
    text: "The board is assured that controls and compliance obligations are being met.",
    scale: "quality",
    expects: "risk_register",
  },

  // --- Execution, conditional on what the organisation is -------------------
  {
    id: "exe-13",
    theme: "Execution",
    text: "The board oversees the development programme against cost, time and risk together.",
    scale: "quality",
    appliesWhen: ["development"],
  },
  {
    id: "exe-14",
    theme: "Execution",
    text: "The board treats preparation for the next funding round as a strategic project, not a finance task.",
    scale: "agreement",
    appliesWhen: ["equity_investors"],
  },
  {
    id: "exe-15",
    theme: "Execution",
    text: "The board tests its compliance assurance rather than accepting it from the executive.",
    scale: "agreement",
    appliesWhen: ["regulated"],
  },
  {
    id: "exe-16",
    theme: "Execution",
    text: "Service changes can be traced back to something the people served actually said.",
    scale: "agreement",
    appliesWhen: ["service_users"],
  },

  // ------------------------------------------------------------------ Behaviour
  {
    id: "beh-01",
    theme: "Behaviour",
    text: "The board periodically reflects on groupthink and dominant voices, and adjusts practice to improve debate.",
    scale: "agreement",
    expects: "minutes",
  },
  {
    id: "beh-02",
    theme: "Behaviour",
    text: "Debate is open, and dissent can be expressed without cost.",
    scale: "agreement",
    expects: "minutes",
  },
  {
    id: "beh-03",
    theme: "Behaviour",
    text: "Difficult subjects are put on the agenda rather than avoided.",
    scale: "agreement",
    expects: "minutes",
  },
  {
    id: "beh-04",
    theme: "Behaviour",
    text: "The board challenges the executive constructively rather than adversarially or not at all.",
    scale: "quality",
    expects: "minutes",
  },
  {
    id: "beh-05",
    theme: "Behaviour",
    text: "Once a decision is taken, the board supports it collectively.",
    scale: "agreement",
  },
  {
    id: "beh-06",
    theme: "Behaviour",
    text: "Relationships between the board and the executive are candid and trusting.",
    scale: "quality",
  },
  {
    id: "beh-07",
    theme: "Behaviour",
    text: "Conflicts of interest are declared and handled openly.",
    scale: "agreement",
    expects: "minutes",
  },
  {
    id: "beh-08",
    theme: "Behaviour",
    text: "All board members contribute, and no one is consistently silent.",
    scale: "agreement",
    expects: "minutes",
  },
  {
    id: "beh-09",
    theme: "Behaviour",
    text: "The board's culture reflects the values the organisation asks of its staff.",
    scale: "agreement",
    expects: "corporate_plan",
  },
  {
    id: "beh-10",
    theme: "Behaviour",
    text: "Bad news reaches the board early and unfiltered.",
    scale: "agreement",
    expects: "board_pack",
  },
  {
    id: "beh-11",
    theme: "Behaviour",
    text: "The board is willing to change its mind when the evidence changes.",
    scale: "agreement",
    expects: "minutes",
  },
  {
    id: "beh-12",
    theme: "Behaviour",
    text: "Meetings end with a shared understanding of what was decided and by whom.",
    scale: "quality",
    expects: "minutes",
  },

  // --- Behaviour, conditional on what the organisation is -------------------
  {
    id: "beh-13",
    theme: "Behaviour",
    text: "The board hears directly from residents and service users, not only about them.",
    scale: "agreement",
    appliesWhen: ["service_users"],
  },
  {
    id: "beh-14",
    theme: "Behaviour",
    text: "The board can challenge founders and major shareholders when it needs to.",
    scale: "agreement",
    appliesWhen: ["equity_investors"],
  },
  {
    id: "beh-15",
    theme: "Behaviour",
    text: "Committee chairs report candidly to the board, including what has gone badly.",
    scale: "agreement",
    appliesWhen: ["committees"],
  },
  {
    id: "beh-16",
    theme: "Behaviour",
    text: "The board keeps its charitable purpose in view when commercial pressure pushes against it.",
    scale: "agreement",
    appliesWhen: ["charity"],
  },
];

/**
 * The client's own wording, which must survive refactoring untouched.
 *
 * Held separately rather than as a flag on the question, so that rewording a question
 * fails the test instead of quietly moving the flag with it.
 */
export const VERBATIM: readonly string[] = [
  "Board and committee packs are concise, timely and decision ready.",
  "Information is received with enough lead time for proper consideration.",
  "Annual board effectiveness reviews take place, with external input at least every three years, and actions are tracked.",
  "The board sets strategic outcomes and monitors progress to outcomes, not just outputs.",
  "The board periodically reflects on groupthink and dominant voices, and adjusts practice to improve debate.",
];
