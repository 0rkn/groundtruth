/**
 * A realistic finished appraisal, used to develop and check the interface before the
 * pipeline behind it exists. Nothing here is imported by the upload page: it is read
 * only by the development-only route at /dev.
 *
 * Kept small and hand-written rather than generated from a real run, so a change to
 * Appraisal's shape is caught here by the typechecker rather than by a stale sample
 * silently drifting out of sync with it.
 */
import type { Appraisal } from "@/lib/appraisal";

const AGREEMENT = [
  "Strongly disagree",
  "Disagree",
  "Neither agree nor disagree",
  "Agree",
  "Strongly agree",
] as const;

const QUALITY = ["Poor", "Weak", "Adequate", "Good", "Excellent"] as const;

const PACK = "brambleside-board-pack-sept-2026.pdf";
const RISK = "brambleside-risk-register-q2.pdf";

export const fixture: Appraisal = {
  asOf: "Board meeting of 18 September 2026",
  documents: [
    { filename: PACK, pages: 247, type: "board_pack" },
    { filename: RISK, pages: 18, type: "risk_register" },
    { filename: "brambleside-annual-accounts-2025-26.pdf", pages: 64, type: "not recognised" },
  ],
  signals: ["service_users", "development", "debt_covenants"],
  themes: [
    {
      name: "Resources",
      counts: { evidenced: 3, standard: 3 },
      questions: [
        {
          id: "R-01",
          theme: "Resources",
          text: "The board pack gives me the information I need to take decisions, without giving me more than I can read.",
          scale: "quality",
          scaleLabels: QUALITY,
          state: "evidenced",
          sources: [
            {
              document: PACK,
              page: 2,
              quote:
                "Contents: Part A, matters for decision (pages 4 to 79). Part B, appendices for noting (pages 80 to 247).",
            },
          ],
        },
        {
          id: "R-02",
          theme: "Resources",
          text: "I receive board papers with enough time to read and consider them before the meeting.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "evidenced",
          sources: [
            {
              document: PACK,
              page: 1,
              quote:
                "Circulated to members on Friday 11 September 2026 for the meeting of Thursday 18 September 2026.",
            },
          ],
        },
        {
          id: "R-03",
          theme: "Resources",
          text: "The board has the financial resources it needs to deliver the plan it has agreed.",
          scale: "quality",
          scaleLabels: QUALITY,
          state: "standard",
        },
        {
          id: "R-04",
          theme: "Resources",
          text: "Board and committee papers are produced to a consistent standard.",
          scale: "quality",
          scaleLabels: QUALITY,
          state: "standard",
        },
        {
          id: "R-05",
          theme: "Resources",
          text: "Board members have adequate access to independent professional advice when they need it.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "standard",
          missingDocument: "a board member induction pack",
        },
        {
          id: "R-06",
          theme: "Resources",
          text: "Time in board meetings is allocated to the matters that matter most.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "evidenced",
          sources: [
            {
              document: PACK,
              page: 1,
              quote:
                "Agenda: item 4, corporate strategy refresh, 25 minutes. Item 7, operational performance, 80 minutes.",
            },
          ],
        },
      ],
    },
    {
      name: "Competency",
      counts: { evidenced: 1, standard: 3 },
      questions: [
        {
          id: "C-01",
          theme: "Competency",
          text: "The range of skills and experience around the board table.",
          scale: "quality",
          scaleLabels: QUALITY,
          state: "evidenced",
          sources: [
            {
              document: PACK,
              page: 96,
              quote:
                "Development and construction: no member self-assessed at level 3 or above. Committee cover provided by external adviser.",
            },
          ],
        },
        {
          id: "C-02",
          theme: "Competency",
          text: "Board recruitment is based on an objective assessment of the skills the board is missing.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "standard",
          missingDocument: "a recruitment and succession policy",
        },
        {
          id: "C-03",
          theme: "Competency",
          text: "Board members are sufficiently financially literate for the decisions they take.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "standard",
        },
        {
          id: "C-04",
          theme: "Competency",
          text: "New board members receive an effective induction.",
          scale: "quality",
          scaleLabels: QUALITY,
          state: "standard",
        },
      ],
    },
    {
      name: "Execution",
      counts: { evidenced: 1, standard: 2 },
      questions: [
        {
          id: "E-01",
          theme: "Execution",
          text: "The board oversees the development programme against cost, time and risk together.",
          scale: "quality",
          scaleLabels: QUALITY,
          state: "evidenced",
          sources: [
            {
              document: RISK,
              page: 4,
              quote: "Development scheme cost overrun. Gross 16, net 12, target 8.",
            },
          ],
        },
        {
          id: "E-02",
          theme: "Execution",
          text: "Actions arising from board meetings are tracked to completion.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "standard",
        },
        {
          id: "E-03",
          theme: "Execution",
          text: "Strategy is revisited when the operating environment changes materially.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "standard",
        },
      ],
    },
    {
      name: "Behaviour",
      counts: { evidenced: 1, standard: 2 },
      questions: [
        {
          id: "B-01",
          theme: "Behaviour",
          text: "Debate is open, and dissent can be expressed without cost.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "evidenced",
          sources: [
            {
              document: PACK,
              page: 41,
              quote:
                "A member asked that her concern about the deliverability of the retrofit target be recorded, and it is recorded in these minutes.",
            },
          ],
        },
        {
          id: "B-02",
          theme: "Behaviour",
          text: "Conflicts of interest are declared and handled openly.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "standard",
        },
        {
          id: "B-03",
          theme: "Behaviour",
          text: "The board's culture reflects the values the organisation asks of its staff.",
          scale: "agreement",
          scaleLabels: AGREEMENT,
          state: "standard",
        },
      ],
    },
  ],
  counts: { evidenced: 6, standard: 10 },
  questionCount: 16,
  figures: [
    {
      key: "pack_pages",
      name: "Board pack length",
      value: 247,
      unit: "pages",
      page: 1,
      method: "Read from the figure the pack states for itself.",
      notable: true,
      source: "Total pack: 247 pages.",
    },
    {
      key: "notice_days",
      name: "Notice given for papers",
      value: 4,
      unit: "working days",
      page: 1,
      method:
        "Working days between issue and the meeting, against the seven the document states is required.",
      notable: true,
      source: "Circulated Friday 11 September for the meeting of Thursday 18 September.",
    },
    {
      key: "static_risks",
      name: "Quarters the top risk score has not moved",
      value: 4,
      unit: "quarters",
      page: 3,
      method: "Counted statements in the register that a risk score has not moved.",
      notable: true,
      source: "Net score unchanged at 16 for four consecutive quarters.",
    },
    {
      key: "interest_cover",
      name: "Interest cover",
      value: 128,
      unit: "%",
      page: 3,
      method: "Read from the figure the register states for itself.",
      notable: false,
      source: "Forecast 128% for 2026/27.",
    },
  ],
  cached: false,
};
