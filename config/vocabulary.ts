/**
 * What the same thing is called in different clients' documents.
 *
 * Settings rather than regexes buried in `figures.ts`, for the same reason thresholds
 * are: they move by client, and a value that moves by client belongs where someone
 * onboarding a client can see and change it.
 *
 * WHY THIS FILE EXISTS AT ALL. Three detectors have now silently failed on the second
 * client because they were keyed to the first one's house style — a performance table's
 * Trend column reading `worse` rather than `Worsening`, a recommendation's number split
 * from its word by bold markers, and a paper's front matter headed `Item 5:` rather than
 * `Item 4 cover sheet:`. Each failure looked like a document lacking something it
 * actually had.
 *
 * The honest position, with two clients: these lists handle the two document sets we
 * have. They are not a general grammar of board papers, and a third client will very
 * likely need another entry. Making that a config change rather than a code change is
 * the point.
 *
 * DETECT STRUCTURE, NOT TITLES, wherever possible. A paper is identifiable by the roles
 * its front matter names — author, purpose, recommendation — because those are what a
 * board paper needs in order to function, whereas what the section is *called* is house
 * style. Titles vary; roles do not.
 */

export const VOCABULARY = {
  /**
   * The start of a paper's block within a pack.
   *
   * Both clients number their items and follow with a colon, but Brambleside puts words
   * between: "Item 4 cover sheet: Q1 Performance Report" against Northgate's "Item 5:
   * Direct scheme membership". The tolerant span is what makes one pattern serve both.
   */
  paperHeading: /\bItem\s+(\d{1,2})\b[^:\n]{0,40}:/gi,

  /** Role labels inside a paper's front matter. A paper needs these to be actionable. */
  paperRoles: {
    author: /\bAuthor\s*:?\*{0,2}/i,
    purpose: /\bPurpose\s*:?\*{0,2}/i,
    recommendation: /\bRecommendation(?:\s+as\s+drafted)?\s*:?\*{0,2}/i,
    summary: /(?:^|\n)#{0,3}\s*\**Summary\b/i,
  },

  /**
   * A performance table's verdict on direction of travel.
   *
   * Kept as the board's own word rather than inferred by comparing numbers, so the
   * judgement stays the client's. Brambleside says Improving/Worsening; Northgate's
   * variance column says ahead/worse.
   */
  trendWorsening: /^(worsening|worse|behind)$/i,
  trendImproving: /^(improving|ahead|better)$/i,
  trendNeutral: /^(flat|stable|on plan|under)$/i,
} as const;
