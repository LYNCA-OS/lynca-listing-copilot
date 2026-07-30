// Confidence from agreement between independent sources, never from the model's
// own report.
//
// This is the one part of the CSM proposal that had to be inverted rather than
// absorbed. The proposal assigns confidence judgement to the model -- "identity
// resolution relies on GPT-5's information processing to judge the confidence
// level of extracted clues". Three measurements say that institutionalises the
// worst failure we have:
//
//   * the same asset, re-recognised within one hour by identical code, agrees on
//     identity 50.3% of the time. A model that disagrees with itself half the
//     time cannot calibrate its own certainty; asking it to produces an unstable
//     confidence sitting on top of an unstable identity.
//   * asking the model for more structured judgement (Task A) cost 6.91pp on
//     familiar products and 7.74pp on unseen.
//   * "2021 Panini Contours JALYN DANIELS" -- invented year, invented product,
//     invented player -- was emitted without hesitation. Self-reported
//     confidence would have been high on a card that does not exist.
//
// So the model reads, and something else adjudicates. Confidence here is a
// count of *independent* corroborations, which is also the evidence /
// interpretation separation the OCS contract requires: a value's standing comes
// from where it came from, not from how sure the producer sounded.
//
// What counts as independent is the whole design. Two sources that derive from
// the same reading are one source. The provider's field and the provider's own
// restatement of it corroborate nothing.

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => cleanText(value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Ordered by how much a source can be trusted to be independent of the model's
// reading. A card's own printed text is the ground the model is looking at, so
// OCR of a targeted crop corroborates the provider only because it is a separate
// read of the same pixels -- weaker than a catalog that never saw this image.
export const sourceWeights = Object.freeze({
  OFFICIAL_CATALOG: 3,      // published by the manufacturer, never saw this card
  REVIEWED_TITLE: 3,        // a human accepted it
  CONSTRAINT_ENGINE: 2,     // derived from harvested structure, image-independent
  TARGETED_OCR: 2,          // a separate read of the same pixels
  PROVIDER_FIELD: 1,        // the model's own reading
  PROVIDER_RESTATEMENT: 0   // the model repeating itself corroborates nothing
});

export const confidenceLevels = Object.freeze({
  CONFIRMED: "CONFIRMED",       // independent corroboration
  SUPPORTED: "SUPPORTED",       // one strong source, or agreeing weak ones
  OBSERVED_ONLY: "OBSERVED_ONLY", // the model said so and nothing else did
  CONFLICTED: "CONFLICTED",     // sources disagree; never silently resolved
  ABSENT: "ABSENT"
});

/**
 * @param {Array<{source: string, value: any}>} claims  what each source says
 * @returns {{level: string, value: any, score: number, agreeing: string[], disagreeing: string[], reason: string}}
 */
export function assessField(claims = []) {
  const present = claims
    .map((claim) => ({ source: String(claim.source ?? ""), value: claim.value, key: fold(claim.value) }))
    .filter((claim) => claim.key);

  if (!present.length) {
    return { level: confidenceLevels.ABSENT, value: null, score: 0, agreeing: [], disagreeing: [], reason: "no_source_supplied_a_value" };
  }

  // Group by value, scoring each group by its sources' independence.
  const groups = new Map();
  for (const claim of present) {
    if (!groups.has(claim.key)) groups.set(claim.key, { value: claim.value, sources: [], score: 0 });
    const group = groups.get(claim.key);
    // A source appearing twice for one value is still one source. Duplicate
    // rows are how a single reading inflates into apparent agreement.
    if (group.sources.includes(claim.source)) continue;
    group.sources.push(claim.source);
    group.score += sourceWeights[claim.source] ?? 1;
  }

  const ranked = [...groups.values()].sort((a, b) => b.score - a.score);
  const [best, runnerUp] = ranked;

  // Disagreement between sources that can each stand alone is never resolved by
  // score. Emitting the higher-scoring value would make a wrong catalog row
  // canonical, which is exactly how a fabrication becomes durable.
  if (runnerUp && runnerUp.score >= 2 && best.score >= 2) {
    return {
      level: confidenceLevels.CONFLICTED,
      value: null,
      score: best.score,
      agreeing: best.sources,
      disagreeing: runnerUp.sources,
      reason: "independent_sources_disagree"
    };
  }

  const independentSources = best.sources.filter((source) => (sourceWeights[source] ?? 1) >= 2);
  if (independentSources.length >= 2) {
    return { level: confidenceLevels.CONFIRMED, value: best.value, score: best.score, agreeing: best.sources, disagreeing: runnerUp?.sources ?? [], reason: "corroborated_by_independent_sources" };
  }
  if (best.score >= 2) {
    return { level: confidenceLevels.SUPPORTED, value: best.value, score: best.score, agreeing: best.sources, disagreeing: runnerUp?.sources ?? [], reason: "one_strong_source" };
  }
  // Only the model said it. That is publishable for a descriptive field and not
  // for an identity claim -- the caller decides, but it must be told.
  return { level: confidenceLevels.OBSERVED_ONLY, value: best.value, score: best.score, agreeing: best.sources, disagreeing: runnerUp?.sources ?? [], reason: "model_reading_uncorroborated" };
}

/**
 * Which fields are safe to put in a title, given the SEM module's tolerance.
 *
 * Identity fields -- what card this is -- require corroboration, because a wrong
 * one is a fabricated card. Descriptive fields tolerate an uncorroborated
 * reading, because "Silver /75" read only by the model is still an honest
 * description of what was seen.
 */
export const identityFields = Object.freeze(["year", "product", "set", "card_number", "player", "players"]);

export function titleAdmission(field, assessment) {
  const level = assessment?.level;
  if (level === confidenceLevels.CONFLICTED || level === confidenceLevels.ABSENT) return "OMIT";
  if (!identityFields.includes(field)) return "INCLUDE";
  return level === confidenceLevels.OBSERVED_ONLY ? "REVIEW" : "INCLUDE";
}
