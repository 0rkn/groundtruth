/**
 * The text a passage is indexed under.
 *
 * The heading is prepended because a passage that reads "Three gaps are recognised..."
 * is far easier to place when the section it sits under travels with it. That is the
 * passage's own text, not generated content.
 *
 * NOTHING GENERATED IS INDEXED. An earlier version appended model-written questions about
 * each passage at ingest, on the theory that an abstract query needs something abstract to
 * match. It measured well on retrieval metrics and it is the wrong side of the problem:
 * the mismatch is between an abstract QUESTION and a concrete passage, and closing it by
 * guessing at ingest what someone might later ask is a guess made in the wrong place, at
 * the wrong time, with no way to tell afterwards whether the guess or the passage did the
 * matching.
 *
 * Removed for a simpler base: what is indexed is what the document says.
 */
import type { Passage } from "./passages.ts";

export function embeddableText(passage: Passage): string {
  return passage.heading ? `${passage.heading}. ${passage.text}` : passage.text;
}
