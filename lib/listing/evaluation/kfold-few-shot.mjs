// Few-shot examples drawn from the REAL reviewed corpus, without leaking it.
//
// The first attempt at few-shot used constructed examples, because the 45
// writer titles in production overlap the 255 sealed eval cards almost
// entirely. That was the wrong fix for the right worry: the answer to "these
// examples leak the test set" is k-fold, not invention.
//
// Each card is scored with examples drawn ONLY from other folds, so no card can
// ever see its own reviewed title, and the examples are what the writers
// actually publish rather than what I imagined they publish.
//
// Stratified, because the corpus is not uniform: 168 raw, 78 graded, 7 lot,
// 2 TCG. Sampling at random would give a fold of examples that are all raw
// singles and teach exactly the bias the constructed set had. Every fold's
// example block carries a lot and a TCG card when the corpus has one to give.

import { createHash } from "node:crypto";

export const FOLD_COUNT = 5;

/** Shape of a reviewed title, from the title itself. */
export function titleShape(title) {
  const s = String(title).toLowerCase();
  if (/lot[x*]\d|\b\d+\s*card lot\b/.test(s)) return "lot";
  if (/pokemon|one piece|yu-?gi|vmax|\bsar\b|swsh|\bholo\b.*#/.test(s)) return "tcg";
  if (/\b(psa|bgs|cgc|sgc|scd)\s*[\d.]+/.test(s)) return "graded";
  return "raw";
}

/**
 * Which fold a card belongs to.
 *
 * Hashed from the card's own key, not from its position, so the assignment is
 * stable across runs and across reorderings of the corpus. A fold that moved
 * between runs would make two evaluations incomparable in a way the paired
 * design could not detect.
 */
export function foldFor(key, folds = FOLD_COUNT) {
  const digest = createHash("sha256").update(String(key)).digest();
  return digest.readUInt32BE(0) % folds;
}

/** Leak check: no example may be the card's own title, or a near-duplicate. */
export function leakCheck({ key, reviewedTitle, examples }) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const mine = new Set(norm(reviewedTitle).split(" "));
  const problems = [];
  for (const row of examples) {
    if (row.key === key) problems.push(`example is the card's own row: ${row.key}`);
    const theirs = new Set(norm(row.reviewed_title).split(" "));
    const inter = [...mine].filter((t) => theirs.has(t)).length;
    const jaccard = inter / new Set([...mine, ...theirs]).size;
    if (jaccard >= 0.5) {
      problems.push(`example is a near-duplicate (J=${jaccard.toFixed(2)}): ${row.reviewed_title}`);
    }
  }
  return problems;
}

/**
 * Build the example block for a card, from other folds only.
 *
 * `perShape` is deliberately small. The block competes with the card's own
 * images for the model's attention, and the measured failure of the three
 * rejected prompt arms was that extra licence gets spent globally -- a long
 * example block is another way to spend attention away from the card.
 */
export function examplesFor({ key, corpus, folds = FOLD_COUNT, perShape = 2, shapes = ["raw", "graded", "lot", "tcg"] }) {
  const own = foldFor(key, folds);
  const mine = corpus.find((row) => row.key === key);
  // A different fold is not enough. The corpus contains near-duplicates of each
  // other -- the same player in the same product with a different parallel --
  // and one of those as an example hands over most of the answer. Similarity to
  // the card being scored is the thing that matters, so it is filtered on
  // directly rather than approximated by the fold split.
  const eligible = corpus.filter((row) => (
    foldFor(row.key, folds) !== own
    && row.key !== key
    && (!mine || !leakCheck({ key, reviewedTitle: mine.reviewed_title, examples: [row] }).length)
  ));
  const chosen = [];
  for (const shape of shapes) {
    const ofShape = eligible.filter((row) => titleShape(row.reviewed_title) === shape);
    // Deterministic pick, seeded by the card being scored, so two cards in the
    // same fold do not all receive an identical block -- and so a rerun of the
    // same card receives the same one.
    const seed = createHash("sha256").update(`${key}:${shape}`).digest().readUInt32BE(0);
    for (let i = 0; i < Math.min(perShape, ofShape.length); i += 1) {
      chosen.push(ofShape[(seed + i * 7919) % ofShape.length]);
    }
  }
  return chosen;
}

/**
 * The prompt suffix. Titles only -- no fields.
 *
 * Showing a filled field object would teach the schema, which the model already
 * follows; what it has never seen is the OUTPUT a writer considers finished.
 * These are the granularity of a product phrase, which components get named,
 * and -- the part no rule in the prompt states -- what writers leave out.
 */
export function fewShotBlock(examples) {
  if (!examples.length) return "";
  return [
    "",
    "Titles the reviewers published for other cards, for calibration only.",
    "These are NOT this card and none of their values may be copied. Read them",
    "for how much detail a finished title carries, and for what is left out.",
    ...examples.map((row) => `  ${row.reviewed_title}`),
    "",
    "Now report the fields for the images actually supplied."
  ].join("\n");
}

