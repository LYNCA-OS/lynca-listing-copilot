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

export const CSM_RESOLUTION_REVIEW_VERSION = "csm-resolution-review-v2";
export const CAPTURED_E1AE_RESOLUTION_REVIEW_VERSION = "csm-resolution-review-v1";
export const CSM_REVIEW_MEASUREMENT_SNAPSHOT_VERSION =
  "csm-review-measurement-snapshot-v1";

export const REVIEW_MEASUREMENT_BASIS = Object.freeze({
  FIELD_REVIEWED: "FIELD_REVIEWED",
  TITLE_DERIVED: "TITLE_DERIVED"
});

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

const sha256Json = (value) => createHash("sha256")
  .update(JSON.stringify(value))
  .digest("hex");

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalJson(value[key])]));
}

const plainRecord = (value) => Boolean(value && typeof value === "object"
  && !Array.isArray(value));
const sameCanonicalValue = (left, right) => JSON.stringify(canonicalJson(left))
  === JSON.stringify(canonicalJson(right));

function correctedValueHasCanonicalType(field, original, corrected) {
  if (Array.isArray(original)) {
    return Array.isArray(corrected)
      && corrected.every((entry) => typeof entry === "string");
  }
  if (field === "grading_info") {
    if (corrected === null) return true;
    if (!plainRecord(corrected)) return false;
    const allowed = new Set(["company", "card_grade", "auto_grade", "grade_type"]);
    return Object.keys(corrected).every((key) => allowed.has(key)
      && typeof corrected[key] === "string");
  }
  if (plainRecord(original)) return plainRecord(corrected);
  return typeof corrected === typeof original;
}

function canonicalValueIsEmpty(value) {
  if (Array.isArray(value)) return value.every(canonicalValueIsEmpty);
  if (plainRecord(value)) return Object.values(value).every(canonicalValueIsEmpty);
  return value == null || String(value).trim() === "";
}

function validateCorrectionSemantics(reason, original, corrected, canonicalField) {
  const originalEmpty = canonicalValueIsEmpty(original);
  const correctedEmpty = canonicalValueIsEmpty(corrected);
  if (reason === CORRECTION_REASON.MISSED_VALUE
      && (!originalEmpty || correctedEmpty)) {
    throw new Error(`csm_review_missed_value_semantics_invalid:${canonicalField}`);
  }
  if (reason === CORRECTION_REASON.INVENTED_VALUE
      && (originalEmpty || !correctedEmpty)) {
    throw new Error(`csm_review_invented_value_semantics_invalid:${canonicalField}`);
  }
}

function normalizeReviewCorrections(corrections, { measurementSnapshot, originalFields }) {
  const measured = new Map(measurementSnapshot.brackets.map((row) => [row.bracket, row]));
  const seen = new Set();
  return corrections.map((correction) => {
    const bracket = String(correction.bracket || "").trim();
    if (!Object.values(CORRECTION_REASON).includes(correction.reason)) {
      throw new Error(`csm_review_unknown_reason:${correction.reason}`);
    }
    const measurement = measured.get(bracket);
    if (!measurement) throw new Error(`csm_review_correction_outside_snapshot:${bracket}`);
    const allowedFields = Array.isArray(measurement.canonical_fields)
      ? measurement.canonical_fields : [];
    const requestedField = String(correction.canonical_field || "").trim();
    const canonicalField = requestedField || (allowedFields.length === 1 ? allowedFields[0] : "");
    if (!canonicalField) {
      throw new Error(`csm_review_correction_canonical_field_required:${bracket}`);
    }
    if (!allowedFields.includes(canonicalField)) {
      throw new Error(`csm_review_correction_field_outside_bracket:${bracket}:${canonicalField}`);
    }
    const correctionKey = `${bracket}\u0000${canonicalField}`;
    if (seen.has(correctionKey)) {
      throw new Error(`csm_review_duplicate_bracket_field_correction:${bracket}:${canonicalField}`);
    }
    seen.add(correctionKey);
    if (!Object.prototype.hasOwnProperty.call(originalFields, canonicalField)
        || originalFields[canonicalField] === undefined) {
      throw new Error(`csm_review_correction_original_field_missing:${canonicalField}`);
    }
    const actualOriginal = canonicalJson(originalFields[canonicalField]);
    if (Object.prototype.hasOwnProperty.call(correction, "original_value")
        && !sameCanonicalValue(correction.original_value, actualOriginal)) {
      throw new Error(`csm_review_correction_original_value_mismatch:${canonicalField}`);
    }
    if (!correctedValueHasCanonicalType(
      canonicalField, actualOriginal, correction.corrected_value
    )) {
      throw new Error(`csm_review_correction_value_type_invalid:${canonicalField}`);
    }
    if (sameCanonicalValue(actualOriginal, correction.corrected_value)) {
      throw new Error(`csm_review_correction_noop:${canonicalField}`);
    }
    validateCorrectionSemantics(
      correction.reason, actualOriginal, correction.corrected_value, canonicalField
    );
    return canonicalJson({
      bracket,
      canonical_field: canonicalField,
      reason: correction.reason,
      original_value: actualOriginal,
      corrected_value: correction.corrected_value,
      note: correction.note || ""
    });
  });
}

/**
 * Freeze the complete field-review denominator at the server boundary.
 *
 * The client is intentionally not an input. The snapshot is projected from
 * the same CsmResolutionView and Composer receipt that the API just replayed,
 * so later aggregation can count every bracket -- including brackets with no
 * correction -- without reconstructing historical UI state.
 */
export function buildReviewMeasurementSnapshot({
  view,
  composerVersion,
  marketplaceProfileVersion = null
} = {}) {
  if (!view || typeof view !== "object" || !Array.isArray(view.brackets)
      || !view.brackets.length) {
    throw new Error("csm_review_measurement_view_required");
  }
  const assetId = String(view.asset_id || "").trim();
  const recognitionSessionId = String(view.recognition_session_id || "").trim();
  const grammar = String(view.grammar?.raw || "").trim();
  const version = String(composerVersion || "").trim();
  if (!assetId || !recognitionSessionId || !grammar || !version) {
    throw new Error("csm_review_measurement_provenance_incomplete");
  }
  const seen = new Set();
  const brackets = view.brackets.map((row) => {
    const bracket = String(row?.bracket || "").trim();
    if (!bracket || seen.has(bracket)) {
      throw new Error(`csm_review_measurement_bracket_invalid:${bracket || "missing"}`);
    }
    seen.add(bracket);
    if (!["VALUE", "ABSENT", "INSUFFICIENT_EVIDENCE"].includes(row.state)) {
      throw new Error(`csm_review_measurement_bracket_state_invalid:${bracket}`);
    }
    if (!["INCLUDED", "SUPPRESSED_BY_PROFILE", "DROPPED_FOR_BUDGET", "RESTORED",
      "NORMALIZED", "DEDUPED_COVERED", "WITHHELD_BY_CONTRACT",
      "NOT_APPLICABLE"].includes(row.composer_disposition)) {
      throw new Error(`csm_review_measurement_disposition_invalid:${bracket}`);
    }
    const canonicalFields = [
      ...(Array.isArray(row.canonical_fields) && row.canonical_fields.length
        ? row.canonical_fields
        : (row.bracket === "manufacturer_product_set"
          ? ["manufacturer", "product", "set"] : [row.canonical_field]))
    ].map((field) => String(field || "").trim()).filter(Boolean);
    if (!canonicalFields.length) {
      throw new Error(`csm_review_measurement_canonical_fields_missing:${bracket}`);
    }
    const coverageAtoms = Array.isArray(row.publication_coverage)
      ? row.publication_coverage : [];
    const coverageCounts = Object.fromEntries(Object.values({
      PUBLISHED: "PUBLISHED",
      SUPPRESSED_BY_PROFILE: "SUPPRESSED_BY_PROFILE",
      DROPPED_FOR_BUDGET: "DROPPED_FOR_BUDGET",
      DEDUPED_COVERED: "DEDUPED_COVERED",
      TRUNCATED_LOSS: "TRUNCATED_LOSS",
      WITHHELD_BY_CONTRACT: "WITHHELD_BY_CONTRACT"
    }).map((disposition) => [disposition.toLowerCase(), coverageAtoms
      .filter((atom) => atom.disposition === disposition).length]));
    const coverageSummary = {
      schema_version: "csm-publication-coverage-summary-v1",
      atoms_sha256: sha256Json(canonicalJson(coverageAtoms)),
      ...coverageCounts
    };
    if (row.state === "VALUE" && !coverageAtoms.length) {
      throw new Error(`csm_review_measurement_publication_coverage_missing:${bracket}`);
    }
    if (row.state !== "VALUE" && coverageAtoms.length) {
      throw new Error(`csm_review_measurement_publication_coverage_unexpected:${bracket}`);
    }
    return {
      bracket,
      state: row.state,
      canonical_fields: [...new Set(canonicalFields)],
      composer_disposition: row.composer_disposition,
      rendered_text_present: row.rendered_text != null && String(row.rendered_text).length > 0,
      // Historical rows have no authoritative atom receipt. Preserve their
      // public View bytes, but do not manufacture a partial-publication metric
      // in a new field-review denominator.
      partially_published: coverageAtoms.length > 0
        ? Boolean(row.partially_published) : false,
      publication_coverage: coverageSummary,
      outside_contract_order: Boolean(row.outside_contract_order)
    };
  });
  const snapshot = canonicalJson({
    schema_version: CSM_REVIEW_MEASUREMENT_SNAPSHOT_VERSION,
    measurement_basis: REVIEW_MEASUREMENT_BASIS.FIELD_REVIEWED,
    view_version: String(view.schema_version || "").trim(),
    asset_id: assetId,
    recognition_session_id: recognitionSessionId,
    grammar,
    composer: {
      composer_version: version,
      marketplace_profile_version: String(marketplaceProfileVersion || "").trim() || null,
      title_sha256: sha256Json(String(view.composer?.title || "")),
      character_budget: view.composer?.character_budget ?? null,
      rendered_length: view.composer?.length ?? null,
      truncated: Boolean(view.composer?.truncated)
    },
    brackets
  });
  return deepFreeze(snapshot);
}

export function reviewMeasurementSnapshotSha256(snapshot) {
  if (snapshot?.schema_version !== CSM_REVIEW_MEASUREMENT_SNAPSHOT_VERSION
      || snapshot?.measurement_basis !== REVIEW_MEASUREMENT_BASIS.FIELD_REVIEWED
      || !Array.isArray(snapshot?.brackets) || !snapshot.brackets.length) {
    throw new Error("csm_review_measurement_snapshot_invalid");
  }
  return sha256Json(canonicalJson(snapshot));
}

export function reviewRevisionSha256(record = {}) {
  return sha256Json(canonicalJson({
    schema_version: record.schema_version,
    provenance: Object.fromEntries(REQUIRED_PROVENANCE.map((key) => [key, record[key]])),
    verdict: record.verdict,
    corrections: record.corrections,
    original_fields: record.original_fields,
    original_title: record.original_title,
    corrected_fields: record.corrected_fields,
    corrected_title: record.corrected_title,
    measurement_basis: record.measurement_basis,
    measurement_snapshot_sha256: record.measurement_snapshot_sha256,
    excluded_from_metrics: record.excluded_from_metrics,
    note: record.note,
    reviewed_at: record.reviewed_at
  }));
}

export function validateCsmResolutionReviewIntegrity(review = {}) {
  if (review?.schema_version !== CSM_RESOLUTION_REVIEW_VERSION
      || review?.measurement_basis !== REVIEW_MEASUREMENT_BASIS.FIELD_REVIEWED) {
    throw new Error("csm_review_integrity_contract_invalid");
  }
  const snapshotSha256 = reviewMeasurementSnapshotSha256(review.measurement_snapshot);
  if (snapshotSha256 !== review.measurement_snapshot_sha256) {
    throw new Error("csm_review_integrity_snapshot_hash_mismatch");
  }
  if (review.measurement_snapshot.asset_id !== review.asset_id
      || review.measurement_snapshot.recognition_session_id !== review.recognition_session_id
      || review.measurement_snapshot.view_version !== review.view_version
      || review.measurement_snapshot.composer?.composer_version !== review.composer_version) {
    throw new Error("csm_review_integrity_snapshot_provenance_mismatch");
  }
  const normalizedCorrections = normalizeReviewCorrections(review.corrections || [], {
    measurementSnapshot: review.measurement_snapshot,
    originalFields: review.original_fields || {}
  });
  if (!sameCanonicalValue(normalizedCorrections, review.corrections)) {
    throw new Error("csm_review_integrity_correction_binding_mismatch");
  }
  const expectedCorrectedFields = canonicalJson(review.original_fields || {});
  for (const correction of normalizedCorrections) {
    expectedCorrectedFields[correction.canonical_field] = correction.corrected_value;
  }
  if (!sameCanonicalValue(expectedCorrectedFields, review.corrected_fields)) {
    throw new Error("csm_review_integrity_corrected_fields_mismatch");
  }
  if (reviewRevisionSha256(review) !== review.revision_sha256) {
    throw new Error("csm_review_integrity_revision_hash_mismatch");
  }
  return true;
}

/** Frozen Production-e1ae review contract for exact stage-v2 read/write compatibility. */
export function buildCapturedE1aeResolutionReview({
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
    if (!String(correction?.bracket ?? "").trim()) {
      throw new Error("csm_review_correction_needs_bracket");
    }
    if (!Object.values(CORRECTION_REASON).includes(correction.reason)) {
      throw new Error(`csm_review_unknown_reason:${correction.reason}`);
    }
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

  const correctedFields = { ...originalFields };
  for (const correction of corrections) {
    correctedFields[correction.canonical_field || correction.bracket]
      = correction.corrected_value;
  }
  let correctedTitle = originalTitle;
  if (corrections.length) {
    if (typeof recomposeTitle !== "function") throw new Error("csm_review_needs_recomposer");
    correctedTitle = String(recomposeTitle(correctedFields) ?? "");
  }
  const record = {
    schema_version: CAPTURED_E1AE_RESOLUTION_REVIEW_VERSION,
    ...Object.fromEntries(REQUIRED_PROVENANCE.map((key) => [
      key, String(provenance[key]).trim()
    ])),
    verdict,
    corrections: corrections.map((correction) => Object.freeze({
      bracket: correction.bracket,
      canonical_field: correction.canonical_field || correction.bracket,
      reason: correction.reason,
      original_value: correction.original_value ?? "",
      corrected_value: correction.corrected_value,
      note: correction.note || ""
    })),
    original_fields: originalFields,
    original_title: originalTitle,
    corrected_fields: correctedFields,
    corrected_title: correctedTitle,
    excluded_from_metrics: Boolean(excludedFromMetrics) || verdict === REVIEW_VERDICT.UNDECIDED,
    note,
    reviewed_at: reviewedAt
  };
  record.revision_sha256 = createHash("sha256")
    .update(JSON.stringify([
      record.asset_id,
      record.resolution_id,
      record.verdict,
      record.corrections,
      record.corrected_title
    ]))
    .digest("hex");
  return Object.freeze(record);
}

export function validateCapturedE1aeResolutionReviewIntegrity(review = {}) {
  if (review?.schema_version !== CAPTURED_E1AE_RESOLUTION_REVIEW_VERSION) {
    throw new Error("csm_review_integrity_contract_invalid");
  }
  let rebuilt;
  try {
    rebuilt = buildCapturedE1aeResolutionReview({
      provenance: Object.fromEntries(REQUIRED_PROVENANCE.map((key) => [key, review[key]])),
      verdict: review.verdict,
      corrections: review.corrections,
      originalFields: review.original_fields,
      originalTitle: review.original_title,
      recomposeTitle: () => review.corrected_title,
      reviewedAt: review.reviewed_at,
      excludedFromMetrics: review.excluded_from_metrics,
      note: review.note
    });
  } catch (error) {
    throw new Error(`csm_review_integrity_contract_invalid:${error.message}`);
  }
  if (!sameCanonicalValue(rebuilt, review)) {
    throw new Error("csm_review_integrity_revision_mismatch");
  }
  return true;
}

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
  measurementSnapshot,
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

  const snapshotSha256 = reviewMeasurementSnapshotSha256(measurementSnapshot);
  if (measurementSnapshot.asset_id !== String(provenance.asset_id).trim()
      || measurementSnapshot.recognition_session_id
        !== String(provenance.recognition_session_id).trim()
      || measurementSnapshot.composer?.composer_version
        !== String(provenance.composer_version).trim()
      || measurementSnapshot.view_version !== String(provenance.view_version).trim()) {
    throw new Error("csm_review_measurement_snapshot_provenance_mismatch");
  }
  const normalizedCorrections = normalizeReviewCorrections(corrections, {
    measurementSnapshot,
    originalFields
  });

  // Corrected fields are the ONLY input to the corrected title. A reviewer's
  // own wording never becomes canonical.
  const correctedFields = canonicalJson(originalFields);
  for (const correction of normalizedCorrections) {
    correctedFields[correction.canonical_field] = correction.corrected_value;
  }

  let correctedTitle = originalTitle;
  if (corrections.length) {
    if (typeof recomposeTitle !== "function") throw new Error("csm_review_needs_recomposer");
    correctedTitle = String(recomposeTitle(correctedFields) ?? "");
  }

  const record = {
    schema_version: CSM_RESOLUTION_REVIEW_VERSION,
    ...Object.fromEntries(REQUIRED_PROVENANCE.map((k) => [k, String(provenance[k]).trim()])),
    verdict,
    corrections: canonicalJson(normalizedCorrections),
    // Both sides preserved. The original is never rewritten by the correction.
    original_fields: canonicalJson(originalFields),
    original_title: originalTitle,
    corrected_fields: canonicalJson(correctedFields),
    corrected_title: correctedTitle,
    measurement_basis: REVIEW_MEASUREMENT_BASIS.FIELD_REVIEWED,
    measurement_snapshot: canonicalJson(measurementSnapshot),
    measurement_snapshot_sha256: snapshotSha256,
    excluded_from_metrics: Boolean(excludedFromMetrics) || verdict === REVIEW_VERDICT.UNDECIDED,
    note,
    reviewed_at: reviewedAt
  };
  // Content hash over the decision, so an append-only log can detect a replayed
  // or altered revision without trusting row order.
  record.revision_sha256 = reviewRevisionSha256(record);
  return deepFreeze(record);
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
    if (review.excluded_from_metrics
        || review.measurement_basis === REVIEW_MEASUREMENT_BASIS.TITLE_DERIVED) continue;
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

export function projectReviewAccuracy(reviews = [], { cohortId } = {}) {
  const cohort = String(cohortId || "").trim();
  if (!cohort) throw new Error("csm_review_accuracy_cohort_id_required");
  const cells = new Map();
  const reviewerCounts = new Map();
  const revisions = [];
  const assets = new Set();
  let counted = 0; let excluded = 0; let titleDerivedExcluded = 0;
  for (const review of reviews) {
    if (review.measurement_basis === REVIEW_MEASUREMENT_BASIS.TITLE_DERIVED) {
      titleDerivedExcluded++; continue;
    }
    if (review.excluded_from_metrics) { excluded++; continue; }
    if (review.schema_version !== CSM_RESOLUTION_REVIEW_VERSION
        || review.measurement_basis !== REVIEW_MEASUREMENT_BASIS.FIELD_REVIEWED) {
      excluded++; continue;
    }
    try {
      validateCsmResolutionReviewIntegrity(review);
    } catch (error) {
      throw new Error(`csm_review_accuracy_integrity:${review.asset_id}:${error.message}`);
    }
    if (assets.has(review.asset_id)) {
      throw new Error(`csm_review_accuracy_duplicate_asset:${review.asset_id}`);
    }
    assets.add(review.asset_id);
    revisions.push(review.revision_sha256);
    reviewerCounts.set(review.reviewer_id, (reviewerCounts.get(review.reviewer_id) || 0) + 1);
    counted++;
    const grammar = review.measurement_snapshot.grammar;
    const correctionsByBracket = new Map();
    for (const correction of review.corrections) {
      const bracketCorrections = correctionsByBracket.get(correction.bracket) || [];
      bracketCorrections.push(correction);
      correctionsByBracket.set(correction.bracket, bracketCorrections);
    }
    for (const bracket of review.measurement_snapshot.brackets) {
      const key = `${grammar}|${bracket.bracket}`;
      const cell = cells.get(key) || {
        grammar,
        bracket: bracket.bracket,
        reviewed: 0,
        corrections: 0,
        empty_reviewed: 0,
        empty_errors: 0,
        absent_reviewed: 0,
        absent_errors: 0,
        insufficient_evidence_reviewed: 0,
        insufficient_evidence_errors: 0,
        composer_eligible: 0,
        composer_omissions: 0,
        profile_suppressed: 0,
        partial_publications: 0,
        by_reason: {}
      };
      cell.reviewed++;
      const bracketCorrections = correctionsByBracket.get(bracket.bracket) || [];
      if (bracketCorrections.length) {
        cell.corrections++;
        for (const reason of new Set(bracketCorrections.map((entry) => entry.reason))) {
          cell.by_reason[reason] = (cell.by_reason[reason] || 0) + 1;
        }
      }
      const empty = bracket.state !== "VALUE";
      const correctionAddsValue = bracketCorrections.some((correction) => {
        const value = correction.corrected_value;
        if (Array.isArray(value)) return value.some((entry) => String(entry ?? "").trim());
        if (value && typeof value === "object") {
          return Object.values(value).some((entry) => String(entry ?? "").trim());
        }
        return String(value ?? "").trim().length > 0;
      });
      if (empty) cell.empty_reviewed++;
      if (empty && correctionAddsValue) cell.empty_errors++;
      if (bracket.state === "ABSENT") cell.absent_reviewed++;
      if (bracket.state === "ABSENT" && correctionAddsValue) cell.absent_errors++;
      if (bracket.state === "INSUFFICIENT_EVIDENCE") cell.insufficient_evidence_reviewed++;
      if (bracket.state === "INSUFFICIENT_EVIDENCE" && correctionAddsValue) {
        cell.insufficient_evidence_errors++;
      }
      const coverage = bracket.publication_coverage || {};
      const suppressed = Number(coverage.suppressed_by_profile || 0) > 0;
      if (suppressed) cell.profile_suppressed++;
      const renderedDisposition = ["INCLUDED", "NORMALIZED", "RESTORED"]
        .includes(bracket.composer_disposition) && bracket.rendered_text_present;
      const budgetLoss = Number(coverage.dropped_for_budget || 0)
        + Number(coverage.truncated_loss || 0) > 0;
      const coveredAtom = Number(coverage.published || 0)
        + Number(coverage.deduped_covered || 0) > 0;
      const eligible = bracket.state === "VALUE" && (budgetLoss || coveredAtom);
      if (eligible) cell.composer_eligible++;
      if (bracket.state === "VALUE" && budgetLoss) {
        cell.composer_omissions++;
      }
      if (bracket.partially_published) cell.partial_publications++;
      cells.set(key, cell);
    }
  }
  const cohortSha256 = sha256Json(canonicalJson({
    cohort_id: cohort,
    review_revision_sha256: [...revisions].sort()
  }));
  return deepFreeze({
    schema_version: "csm-review-accuracy-projection-v2",
    measurement_basis: REVIEW_MEASUREMENT_BASIS.FIELD_REVIEWED,
    cohort_id: cohort,
    cohort_sha256: cohortSha256,
    reviews_counted: counted,
    reviews_excluded: excluded,
    title_derived_reviews_excluded: titleDerivedExcluded,
    distinct_reviewers: reviewerCounts.size,
    reviewer_counts: Object.fromEntries([...reviewerCounts.entries()].sort()),
    cells: [...cells.values()].map((cell) => ({
      ...cell,
      correction_rate: cell.reviewed ? cell.corrections / cell.reviewed : 0,
      empty_error_rate: cell.empty_reviewed ? cell.empty_errors / cell.empty_reviewed : null,
      absent_error_rate: cell.absent_reviewed ? cell.absent_errors / cell.absent_reviewed : null,
      insufficient_evidence_error_rate: cell.insufficient_evidence_reviewed
        ? cell.insufficient_evidence_errors / cell.insufficient_evidence_reviewed
        : null,
      composer_omission_rate: cell.composer_eligible
        ? cell.composer_omissions / cell.composer_eligible
        : null
    })).sort((a, b) => a.grammar.localeCompare(b.grammar)
      || a.bracket.localeCompare(b.bracket))
  });
}
