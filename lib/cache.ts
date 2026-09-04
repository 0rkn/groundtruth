/**
 * Caching, and the reason the product can promise the same answer twice.
 *
 * The model is not deterministic and does not need to be. Consistency comes from here:
 * the same documents and the same configuration return the same stored questionnaire,
 * so a consultant who reloads the page does not find the evidence has changed under
 * them. Determinism is a property of the cache, not of the model.
 *
 * WHAT THE KEY MUST CONTAIN, and this is the whole design. Anything that could change
 * the output has to be in the key, or a stale entry gets served for inputs it was never
 * computed from. That failure is silent and indistinguishable from a correct answer,
 * which makes it the worst kind:
 *
 *   - the documents' TEXT, not their filenames. The same pack renamed should hit; a
 *     different pack with the same name must miss.
 *   - the prompt version. Changing how the model is instructed changes what it writes,
 *     so an unversioned prompt edit would keep serving the old wording for ever.
 *   - the retrieval configuration. Chunk size, probe wording and topK all change which
 *     passages the model sees.
 *
 * Bump the relevant version below when any of those change. Forgetting is the one
 * mistake this file cannot protect against, which is why each constant sits next to a
 * note saying what it covers.
 */
import { createHash } from "node:crypto";
import { kvGet, kvPut } from "./cf.ts";

/**
 * Bump when the generation prompt changes in any way that could alter its output —
 * wording, rules, or what material a call is given.
 *
 * "obs-*" names the batched, multi-question prompt this replaced; "pick-1" is the
 * per-question numbered-selection design — one small call per question, choosing which
 * numbered line answers it rather than composing a sentence about several at once.
 * "pick-2" adds `summarise()` — a second, narrower call that paraphrases the quotes
 * `pick.ts` already chose ("what we drew from it"), plus two fixes to the check that
 * guards it: the number-match regex was swallowing a sentence's trailing full stop into
 * the number itself (so "...in 2027." never matched a source's "2027"), and comparing
 * "78%" against a paraphrase's "78 percent" as literally different strings.
 * "pick-3" fixes a third bug in the same function: a FIXED 400-character cap dropped
 * every correct paraphrase of a genuinely multi-fact question — three real quotes
 * restated honestly ran to 564 characters and the summary silently vanished, not
 * because it was wrong but because it was thorough. The cap now scales with how much
 * evidence there is to restate. Each of these bugs silently dropped a correct
 * paraphrase and showed evidence with no summary above it.
 * "pick-4" adds the shape (d) post-pass: each accepted recommendation is paired to the
 * one figure that genuinely tests it (`lib/compare.ts`), and where a question already
 * cites that recommendation, the matched figure is appended and the paraphrase
 * refreshed to state the comparison.
 * "pick-5" fixes a fourth silent-drop bug in `summarise`'s number check (a time written
 * "10.45" restated as "10:45" split into two numbers that matched nothing) and adds a
 * 3-attempt retry — a single flaky model call, unrelated to any of these bugs, used to
 * cost the paraphrase for the rest of the run with no second try.
 * "pick-6" raises the length cap again. Re-auditing after pick-5 found one further
 * evidenced question still silently missing a summary, on a genuinely dense 3-quote
 * question (one quote alone ~400 characters): three separate honest, zero-invented-
 * number restatements all landed 706-780 characters against a 700-character cap. The
 * cap is now generous — the real risk it guards against is the model losing the "one
 * sentence" structure entirely, not landing a hundred characters over an arbitrary
 * line. Bumped each time so a run cached under the previous behaviour is never served
 * again.
 * "pick-7" adds one sentence to `pick.ts`'s own selection prompt inviting it to choose
 * two lines when they genuinely disagree — the client's shape (a). Two sources shown
 * side by side already happened without being asked for; this only names disagreement
 * as a reason to keep a second line rather than dropping it as a loose match. Tested
 * against the full Brambleside set: no regression (same 34/48 answered, no spurious
 * pairs), but no genuine two-sided contradiction existed in this document set's
 * top-8 retrieval to confirm the positive case either.
 * "pick-8" closes a gap in `summarise`'s number check: it only ever recognised digit-form
 * numbers, so a paraphrase inventing a quantity in WORDS ("roughly a dozen items") was
 * invisible to the one check that exists to catch exactly that. Common spelled-out
 * cardinals (one through twenty, hundred, thousand) are now normalised to digits before
 * the check runs, on both the source and the reply.
 * "pick-9" adds `extractCommentary` — a board pack's own narrative commentary on its
 * performance table, offered to every question as a universal candidate the same way a
 * figure already is, rather than depending on per-question retrieval to surface it (see
 * its docstring in `pick.ts` for the two real regex bugs found and fixed getting there).
 * Tested against both real client sets: the candidate now exists correctly on Brambleside,
 * and is correctly absent on Northgate, where the same text is mangled into a table by
 * extraction rather than recoverable cleanly. Selection was also tested with the pick cap
 * raised to 4 lines, on the theory that shape (a)'s contradiction was being crowded out by
 * three other genuinely relevant facts — it was not: a repeat run at 4 lines didn't even
 * reselect the figure it had picked at 3, confirming this is the model's own inconsistent
 * judgement about what best answers a given question, not a capacity problem. Reverted to
 * 3. Net change this version: the candidate is strictly more correct to offer than not,
 * even though it does not make shape (a) fire reliably — left in for that reason, not
 * because the shape is considered solved.
 * "pick-10" fixes a real gap, not a hypothetical one: a previous review's numbered
 * recommendation was selected as evidence in only 2 of 288 question-instances across six
 * full real runs — shapes (c) and (d), and the report's "progress since previous review"
 * section, all depend on this firing at all and were each essentially dormant in
 * practice, despite `compare.ts`'s pairing logic testing correctly in isolation. Root
 * cause: nothing told the model a past recommendation IS evidence for a present-tense
 * question about whether that practice happens now, and "text on a related subject is
 * NOT evidence" may have been actively read as excluding it — a different time period
 * looking, on its face, like a different subject. One added sentence names this
 * explicitly. Measured, not assumed: 8 citations across three post-fix runs (144
 * question-instances) against the 2-in-288 baseline — roughly an eightfold increase, and
 * still not guaranteed every run (one of the three post-fix runs had zero), but a real
 * shift from "almost never" to "often," not a reframing of the same failure.
 * "pick-11" adds two worked examples to `pick.ts`'s prompt: one showing a recommendation
 * correctly selected as the answer to a present-tense question, one showing a correct
 * NONE, so the addition does not bias toward always picking something. Measured across
 * three runs (144 question-instances): 16 citations against pick-10's 8 — roughly double.
 * Checked for regression, not assumed: answered-question counts across the three runs
 * (39, 35, 34 of 48) stayed within or above the normal range, and every citation was read
 * by hand and found to be a genuine, on-topic match rather than one forced to resemble the
 * example.
 * Two further configurations were tested afterward and both reverted, leaving this
 * version's behaviour unchanged: inline `[Recommendation]` tagging on each candidate line
 * alone (1 of 144 — no better than the original pre-fix baseline), and tagging combined
 * with these same few-shot examples (11 of 144 — worse than few-shot alone). See
 * README.md's "Commitment citation" section for the full comparison.
 */
export const PROMPT_VERSION = "pick-11";

/**
 * Bump when retrieval changes: chunker, chunk size, probe wording, or topK. Current
 * configuration is fixed 140-word chunks, board words removed from the probe, topK 8 per
 * question. Indexing generated questions alongside each passage was tried and removed —
 * see `embeddable.ts` — because it closed the gap between an abstract question and a
 * concrete passage from the document side only; the untested half was the query side,
 * which this version's stripBoard-and-search-with-the-question-alone approach still
 * leaves undone.
 */
export const RETRIEVAL_VERSION = "ret-2";

/** Bump when the question pool, selection rules or computed figures change. */
export const METHOD_VERSION = "method-2";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * A key for one appraisal.
 *
 * Document texts are hashed individually and then sorted, so upload order cannot change
 * the key — the same five documents in a different order are the same appraisal.
 */
export function appraisalKey(documentTexts: string[]): string {
  const documents = documentTexts.map((t) => sha(t)).sort().join(":");
  return `appraisal:${METHOD_VERSION}:${RETRIEVAL_VERSION}:${PROMPT_VERSION}:${sha(documents).slice(0, 32)}`;
}

/**
 * Return the cached value, or compute and store it.
 *
 * A cache read that throws must not fail the request: the fallback is a slow correct
 * answer. A write that throws is likewise swallowed after the value is in hand — losing
 * a cache entry costs time on the next run and nothing else.
 */
export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  try {
    const stored = await kvGet(key);
    if (stored) return { value: JSON.parse(stored) as T, hit: true };
  } catch {
    // fall through to computing it
  }

  const value = await compute();

  try {
    await kvPut(key, JSON.stringify(value));
  } catch {
    // the answer is correct either way
  }
  return { value, hit: false };
}
