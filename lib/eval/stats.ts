/**
 * The statistics the sample size forces on us.
 *
 * There are 39 answerable questions. A single configuration's hit@1 therefore carries a
 * 95% interval of roughly ±15 percentage points, which is wider than any difference
 * between two sensible retrieval configurations is likely to be. Reading a table of
 * point estimates and picking the largest is, at this n, indistinguishable from picking
 * at random — and it is exactly how a config gets overfitted to a test set.
 *
 * Two things make the comparison tractable without more data:
 *
 * PAIRING. Every configuration answers the SAME 39 questions, so the comparison is
 * within-question, not between two independent samples. Most of the variance is the
 * questions themselves — some are easy for every configuration, some are hard for all
 * of them — and pairing removes it. A paired test on 39 items is far stronger than an
 * unpaired one, and it is free.
 *
 * INTERVALS, NOT RANKS. Every comparison below reports a difference and an interval on
 * that difference. If the interval spans zero, the honest report is "no measurable
 * difference", and that is a legitimate result rather than a failure to find one. The
 * rule is set here rather than after seeing the numbers.
 *
 * Deterministic: the bootstrap uses a seeded generator, so the same inputs give the same
 * interval on every run. A confidence interval that moves when nothing changed cannot
 * be quoted in a README.
 *
 * Pure arithmetic. No I/O, no model.
 */

/** mulberry32. Small, fast, and seeded, which is the only property that matters here. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Difference {
  /** Mean of (candidate - baseline), per question. */
  mean: number;
  lo: number;
  hi: number;
  /** True when the interval excludes zero, which is the only case worth reporting. */
  measurable: boolean;
}

/**
 * Paired bootstrap on the per-question difference.
 *
 * Resamples QUESTIONS, not scores — the pairing is the point, so a resample takes both
 * configurations' result for a question or neither. 10,000 resamples is enough that the
 * interval is stable to the two decimal places it is printed at.
 */
export function pairedDifference(
  candidate: number[],
  baseline: number[],
  { iterations = 10_000, seed = 20260902 } = {},
): Difference {
  if (candidate.length !== baseline.length) {
    throw new Error(
      `paired test needs equal-length vectors, got ${candidate.length} and ${baseline.length}`,
    );
  }
  const n = candidate.length;
  const deltas = candidate.map((c, i) => c - baseline[i]);
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

  const next = rng(seed);
  const means: number[] = [];
  for (let it = 0; it < iterations; it += 1) {
    let total = 0;
    for (let i = 0; i < n; i += 1) total += deltas[Math.floor(next() * n)];
    means.push(total / n);
  }
  means.sort((a, b) => a - b);

  const lo = means[Math.floor(iterations * 0.025)];
  const hi = means[Math.floor(iterations * 0.975)];
  return { mean: mean(deltas), lo, hi, measurable: lo > 0 || hi < 0 };
}

/**
 * McNemar's exact test, for the binary outcomes (hit@1, and the judge's verdicts).
 *
 * Only the DISCORDANT pairs carry information: questions both configurations got right,
 * or both got wrong, say nothing about which is better. Under the null hypothesis each
 * discordant pair is a coin flip, so the p-value is an exact two-sided binomial test —
 * not the chi-square approximation, which is unreliable below about 25 discordant pairs
 * and we will have fewer than that.
 */
export function mcnemar(candidateOnly: number, baselineOnly: number): { p: number; discordant: number } {
  const n = candidateOnly + baselineOnly;
  if (n === 0) return { p: 1, discordant: 0 };

  const logFactorial = (k: number) => {
    let s = 0;
    for (let i = 2; i <= k; i += 1) s += Math.log(i);
    return s;
  };
  const pmf = (k: number) =>
    Math.exp(logFactorial(n) - logFactorial(k) - logFactorial(n - k) - n * Math.LN2);

  const observed = Math.min(candidateOnly, baselineOnly);
  let tail = 0;
  for (let k = 0; k <= observed; k += 1) tail += pmf(k);
  return { p: Math.min(1, 2 * tail), discordant: n };
}

/**
 * Area under the ROC curve for the abstention decision.
 *
 * The probability that a question WITH evidence scores higher than one WITHOUT. 1.0 is
 * perfect separation, 0.5 a coin flip. 0.80 is the usual bar before a single global
 * threshold is worth acting on, which gives the cutoff a pass mark set in advance rather
 * than argued for after the fact.
 */
export function auc(withEvidence: number[], without: number[]): number {
  if (!withEvidence.length || !without.length) return Number.NaN;
  let wins = 0;
  for (const a of withEvidence) {
    for (const b of without) {
      if (a > b) wins += 1;
      else if (a === b) wins += 0.5;
    }
  }
  return wins / (withEvidence.length * without.length);
}

/** A 95% interval on a single proportion, so a lone number is never printed bare. */
export function proportionInterval(successes: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: Number.NaN, hi: Number.NaN };
  // Wilson, because the normal approximation misbehaves near 0 and 1 and several of
  // these rates will sit near both.
  const z = 1.96;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}
