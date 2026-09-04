/**
 * Where a counted figure stops being a fact and becomes a finding.
 *
 * Settings, not constants in code, because they move by client size: a 120-page
 * pack is a problem for a small housing association and unremarkable for a bank.
 *
 * A figure only becomes evidence once it crosses its threshold. "Your pack runs to
 * 6 pages" is true and worthless; 247 is a finding.
 *
 * Where a document states its own rule — "the constitution requires five business
 * days" — that wins over the value here. Measuring a board against its own standard
 * is always stronger than measuring it against ours.
 */
export const THRESHOLDS = {
  /** Pages in a board pack, above which length is worth remarking on. */
  packPages: 120,
  /** Working days of notice, below which lead time is worth remarking on. */
  noticeWorkingDays: 7,
  /** Pages in a performance report, above which it is worth remarking on. */
  performanceReportPages: 12,
  /** Share of agenda items merely for noting, above which the balance is notable. */
  notingShare: 0.5,
  /** Months since the last external review, above which it is stale. */
  reviewStaleMonths: 36,
  /** Quarters a risk score may sit unmoved before it is worth remarking on. */
  staticRiskQuarters: 4,
  /** Times an item may be deferred before it is worth remarking on. */
  deferrals: 1,
} as const;
