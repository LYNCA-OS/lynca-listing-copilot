// CsmResolutionReview -- the one append-only write contract for structured
// approvals and corrections. COS-42, stage 2.
//
// The rule this exists to enforce: NEVER parse a corrected title back into
// truth. Today a writer edits a title and the API stores it with
// `reviewedSemanticFields: false` and `training_eligible: false`, which is
// correct and also means a corrected title proves nothing about whether CSM can
// place the corrected facts in the right brackets. Reversing that -- reading a
// human's title and inferring fields from it -- would manufacture ground truth
// out of a string, and every downstream measurement would inherit the guess.
//
// So a review carries CORRECTED FIELDS, and the corrected title is recomposed
// from them deterministically. If a reviewer wants a different title they
// change a field, and the composer's pinned version does the rest.
//
// Everything here is append-only. The original resolution and the original
// output stay exactly as the run produced them: a review is a new revision that
// points at them, never a mutation of them. That is what keeps the accuracy
// history replayable -- a corrected record that overwrote its own past cannot
// answer "what did the model actually do".

import { createHash } from "node:crypto";

export const CSM_RESOLUTION_REVIEW_VERSION = "csm-resolution-review-v1";

export const REVIEW_VERDICT = Object.freeze({
  /** Every bracket as resolved is correct. */
  APPROVED: "APPROVED",
  /** At least one bracket was corrected. */
  CORRECTED: "CORRECTED",
  /** The reviewer could not decide; excluded from accuracy projections. */
  UNDECIDED: "UNDECIDED"
});

/** Why a bracket was changed. Kept small and closed so it can be counted. */
export const CORRECTION_REASON = Object.freeze({
  WRONG_VALUE: "WRONG_VALUE",
  /** The resolver said ABSENT and the card carries it. */
  MISSED_VALUE: "MISSED_VALUE",
  /** The resolver reported a value the card does not carry. */
  INVENTED_VALUE: "INVENTED_VALUE",
  /** Right fact, wrong bracket. */
  WRONG_BRACKET: "WRONG_BRACKET",
  /** True, but should not appear in a marketplace title. */
  TRUE_BUT_NOT_PUBLISHABLE: "TRUE_BUT_NOT_PUBLISHABLE"
});

const REQUIRED_PROVENANCE = Object.freeze([
  "asset_id", "recognition_session_id", "resolution_id", "output_id",
  "resolver_version", "composer_version", "view_version",
  "reviewer_id", "tenant_id"
]);

/**
 * Validate and normalise one review before it is persisted.
 *
 * Throws rather than returning a partial record. A review that reached storage
 * missing its run identifiers would be an assertion about a card nobody can
 * trace back to a run, which is worse than no review at all.
 */
export function buildCsmResolutionReview({
  provenance = {},
  verdict,
  corrections = [],
  originalFields = {},
  originalTitle = "",
  recomposeTitle,
  reviewedAt = null,
  excludedFromMetrics = false,
  note = ""
} = {}) {
  if (!Object.values(REVIEW_VERDICT).includes(verdict)) {
    throw new Error(`csm_review_unknown_verdict:${verdict}`);
  }
  const missing = REQUIRED_PROVENANCE.filter((key) => !String(provenance[key] ?? "").trim());
  if (missing.length) throw new Error(`csm_review_missing_provenance:${missing.join(",")}`);

  for (const correction of corrections) {
    if (!String(correction?.bracket ?? "").trim()) throw new Error("csm_review_correction_needs_bracket");
    if (!Object.values(CORRECTION_REASON).includes(correction.reason)) {
      throw new Error(`csm_review_unknown_reason:${correction.reason}`);
    }
    // `corrected_value` may legitimately be empty -- that is how a reviewer
    // says the resolver invented something -- but the key must be present, so
    // an omission cannot masquerade as a deliberate blank.
    if (!Object.prototype.hasOwnProperty.call(correction, "corrected_value")) {
      throw new Error(`csm_review_correction_needs_value:${correction.bracket}`);
    }
  }
  if (verdict === REVIEW_VERDICT.CORRECTED && !corrections.length) {
    throw new Error("csm_review_corrected_without_corrections");
  }
  if (verdict === REVIEW_VERDICT.APPROVED && corrections.length) {
    throw new Error("csm_review_approved_with_corrections");
  }

  // Corrected fields are the ONLY input to the corrected title. A reviewer's
  // own wording never becomes canonical.
  const correctedFields = { ...originalFields };
  for (const c of corrections) correctedFields[c.canonical_field || c.bracket] = c.corrected_value;

  let correctedTitle = originalTitle;
  if (corrections.length) {
    if (typeof recomposeTitle !== "function") throw new Error("csm_review_needs_recomposer");
    correctedTitle = String(recomposeTitle(correctedFields) ?? "");
  }

  const record = {
    schema_version: CSM_RESOLUTION_REVIEW_VERSION,
    ...Object.fromEntries(REQUIRED_PROVENANCE.map((k) => [k, String(provenance[k]).trim()])),
    verdict,
    corrections: corrections.map((c) => Object.freeze({
      bracket: c.bracket,
      canonical_field: c.canonical_field || c.bracket,
      reason: c.reason,
      original_value: c.original_value ?? "",
      corrected_value: c.corrected_value,
      note: c.note || ""
    })),
    // Both sides preserved. The original is never rewritten by the correction.
    original_fields: originalFields,
    original_title: originalTitle,
    corrected_fields: correctedFields,
    corrected_title: correctedTitle,
    excluded_from_metrics: Boolean(excludedFromMetrics) || verdict === REVIEW_VERDICT.UNDECIDED,
    note,
    reviewed_at: reviewedAt
  };
  // Content hash over the decision, so an append-only log can detect a replayed
  // or altered revision without trusting row order.
  record.revision_sha256 = createHash("sha256")
    .update(JSON.stringify([record.asset_id, record.resolution_id, record.verdict,
      record.corrections, record.corrected_title]))
    .digest("hex");
  return Object.freeze(record);
}

/**
 * Accuracy projection over a set of reviews, by grammar and bracket.
 *
 * This is the measurement COS-42 asks for: correction rate, EMPTY error and
 * Composer omission per bracket. UNDECIDED reviews are excluded rather than
 * counted as agreement -- a reviewer who could not tell is not evidence that
 * the resolver was right.
 */
/**
 * Which layer owns a repeated pattern. COS-42's approved learning flow.
 *
 * The rule the founder set is that no single edit changes anything: patterns
 * are accumulated, grouped, reviewed, and only then routed. So this maps a
 * correction reason to the layer that should own the fix, and the aggregation
 * below refuses to route anything seen once.
 *
 *   repeated wording / abbreviation      -> Marketplace Composer
 *   repeated observation failures        -> Recognition Worker
 *   repeated matching / normalisation    -> Registry or Identity Resolution
 *   only repeated cases showing the boundaries cannot represent the
 *   collectible                          -> a CSM boundary proposal
 *
 * The last one is deliberately the hardest to reach. A CSM proposal is a
 * contract change, and the decision says it needs repeated evidence that no
 * existing boundary can hold the fact -- not that one reviewer disagreed.
 */
export const OWNING_LAYER = Object.freeze({
  MARKETPLACE_COMPOSER: "MARKETPLACE_COMPOSER",
  RECOGNITION_WORKER: "RECOGNITION_WORKER",
  REGISTRY_OR_IDENTITY_RESOLUTION: "REGISTRY_OR_IDENTITY_RESOLUTION",
  CSM_BOUNDARY_PROPOSAL: "CSM_BOUNDARY_PROPOSAL"
});

const LAYER_FOR_REASON = Object.freeze({
  [CORRECTION_REASON.TRUE_BUT_NOT_PUBLISHABLE]: OWNING_LAYER.MARKETPLACE_COMPOSER,
  [CORRECTION_REASON.MISSED_VALUE]: OWNING_LAYER.RECOGNITION_WORKER,
  [CORRECTION_REASON.INVENTED_VALUE]: OWNING_LAYER.RECOGNITION_WORKER,
  [CORRECTION_REASON.WRONG_VALUE]: OWNING_LAYER.REGISTRY_OR_IDENTITY_RESOLUTION,
  // A fact that keeps landing in the wrong bracket is the one signal that can
  // mean the boundaries themselves do not fit -- and only when repeated.
  [CORRECTION_REASON.WRONG_BRACKET]: OWNING_LAYER.CSM_BOUNDARY_PROPOSAL
});

/**
 * Group corrections into routable patterns.
 *
 * `minimumOccurrences` is the whole point rather than a tuning knob: the
 * decision says periodic analysis looks for repeated patterns across multiple
 * records instead of reacting to one correction, so a pattern below the
 * threshold is reported as observed and explicitly NOT routed.
 */
export function routeReviewPatterns(reviews = [], {
  grammarOf = () => "standard",
  minimumOccurrences = 3
} = {}) {
  const patterns = new Map();
  for (const review of reviews) {
    if (review.excluded_from_metrics) continue;
    const grammar = grammarOf(review);
    for (const c of review.corrections) {
      const key = `${grammar}|${c.bracket}|${c.reason}`;
      const p = patterns.get(key) || {
        grammar, bracket: c.bracket, reason: c.reason,
        occurrences: 0, assets: new Set(),
        owning_layer: LAYER_FOR_REASON[c.reason] || OWNING_LAYER.RECOGNITION_WORKER
      };
      p.occurrences++; p.assets.add(review.asset_id);
      patterns.set(key, p);
    }
  }
  const rows = [...patterns.values()].map((p) => Object.freeze({
    grammar: p.grammar,
    bracket: p.bracket,
    reason: p.reason,
    occurrences: p.occurrences,
    distinct_assets: p.assets.size,
    owning_layer: p.owning_layer,
    // Distinct assets, not raw corrections: the same card reviewed twice is one
    // pattern seen once, and counting revisions would let a single card promote
    // itself by being looked at again.
    routable: p.assets.size >= minimumOccurrences,
    withheld_reason: p.assets.size >= minimumOccurrences ? null
      : `seen on ${p.assets.size} of the ${minimumOccurrences} distinct assets required before routing`
  })).sort((a, b) => b.distinct_assets - a.distinct_assets);
  return Object.freeze({
    minimum_occurrences: minimumOccurrences,
    routable: Object.freeze(rows.filter((r) => r.routable)),
    observed_not_routable: Object.freeze(rows.filter((r) => !r.routable))
  });
}

export function projectReviewAccuracy(reviews = [], { grammarOf = () => "standard" } = {}) {
  const cells = new Map();
  let counted = 0; let excluded = 0;
  for (const review of reviews) {
    if (review.excluded_from_metrics) { excluded++; continue; }
    counted++;
    const grammar = grammarOf(review);
    for (const c of review.corrections) {
      const key = `${grammar}|${c.bracket}`;
      const cell = cells.get(key) || { grammar, bracket: c.bracket, corrections: 0, by_reason: {} };
      cell.corrections++;
      cell.by_reason[c.reason] = (cell.by_reason[c.reason] || 0) + 1;
      cells.set(key, cell);
    }
  }
  return Object.freeze({
    reviews_counted: counted,
    reviews_excluded: excluded,
    cells: Object.freeze([...cells.values()].map((cell) => Object.freeze({
      ...cell,
      correction_rate: counted ? cell.corrections / counted : 0
    })).sort((a, b) => b.corrections - a.corrections))
  });
}
