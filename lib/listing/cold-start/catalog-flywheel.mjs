import { correctedTitleRecordToCatalogStaging } from "../catalog/internal-corrected-title-catalog.mjs";
import {
  forbiddenUsageViolations,
  isExternalDirectoryTrust,
  isMarketplaceTrust,
  normalizeExternalCandidate,
  normalizeSourceTrust,
  sourceTrustValues
} from "../external/external-candidate-contract.mjs";

export const catalogColdStartStatuses = Object.freeze({
  EXACT_INTERNAL_MATCH: "EXACT_INTERNAL_MATCH",
  OFFICIAL_CHECKLIST_MATCH: "OFFICIAL_CHECKLIST_MATCH",
  EXTERNAL_DIRECTORY_CANDIDATES_ONLY: "EXTERNAL_DIRECTORY_CANDIDATES_ONLY",
  MARKETPLACE_HINTS_ONLY: "MARKETPLACE_HINTS_ONLY",
  SAFE_DRAFT_READY: "SAFE_DRAFT_READY",
  CATALOG_GAP_REQUIRED: "CATALOG_GAP_REQUIRED"
});

export const writerConfirmationActions = Object.freeze({
  CONFIRM_DRAFT: "confirm_draft",
  EDIT_AND_CONFIRM: "edit_and_confirm",
  SELECT_EXTERNAL_CANDIDATE: "select_external_candidate",
  CREATE_NEW_IDENTITY: "create_new_identity",
  REJECT_CANDIDATE: "reject_candidate"
});

const confirmedActions = new Set([
  writerConfirmationActions.CONFIRM_DRAFT,
  writerConfirmationActions.EDIT_AND_CONFIRM,
  writerConfirmationActions.SELECT_EXTERNAL_CANDIDATE,
  writerConfirmationActions.CREATE_NEW_IDENTITY
]);

const identityFieldNames = Object.freeze([
  "year",
  "manufacturer",
  "brand",
  "product",
  "release",
  "set",
  "insert",
  "set_or_insert",
  "players",
  "team",
  "card_name",
  "card_number",
  "collector_number",
  "checklist_code",
  "surface_color",
  "serial_denominator",
  "observable_components",
  "official_card_type"
]);

const physicalInstanceFieldNames = Object.freeze([
  "serial_number",
  "serial_numerator",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "cert_number"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCandidateList(candidates = [], sourceTrust = sourceTrustValues.EXTERNAL_DIRECTORY_WEAK) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => normalizeExternalCandidate(candidate, {
      providerId: candidate.provider_id || "external",
      sourceTrust: candidate.source_trust || sourceTrust,
      rank: index + 1,
      mode: candidate.mode || "catalog_flywheel"
    }));
}

function candidateId(candidate = {}) {
  return cleanText(candidate.candidate_id || candidate.external_card_id || candidate.external_set_id || candidate.title);
}

function candidateHasTrust(candidates = [], trusts = []) {
  const allowed = new Set(trusts.map((trust) => normalizeSourceTrust(trust)));
  return candidates.some((candidate) => allowed.has(normalizeSourceTrust(candidate.source_trust)));
}

function sourceTrustBreakdown(candidates = []) {
  return candidates.reduce((counts, candidate) => {
    const trust = normalizeSourceTrust(candidate.source_trust, sourceTrustValues.EXTERNAL_DIRECTORY_WEAK);
    counts[trust] = (counts[trust] || 0) + 1;
    return counts;
  }, {});
}

function queryImageIdsFromItem(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .map((image) => image.image_id || image.object_path || image.local_path || "")
    .filter(Boolean);
}

function observedFieldsFromResult(result = {}) {
  return result.resolved_fields || result.resolved || result.fields || result.rendered_fields || {};
}

function titleFromResult(result = {}) {
  return cleanText(
    result.final_evaluated_title
    || result.final_title
    || result.rendered_title
    || result.title
    || result.model_title_suggestion
  );
}

function highRiskFieldsFromResult(result = {}) {
  return unique([
    ...(Array.isArray(result.cold_start_analysis?.high_risk_guess_fields) ? result.cold_start_analysis.high_risk_guess_fields : []),
    ...(Array.isArray(result.high_risk_guess_fields) ? result.high_risk_guess_fields : []),
    ...(Array.isArray(result.high_risk_fields) ? result.high_risk_fields : [])
  ]);
}

function unresolvedFieldsFromResult(result = {}) {
  return unique([
    ...(Array.isArray(result.unresolved_fields) ? result.unresolved_fields : []),
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    ...(Array.isArray(result.review_fields) ? result.review_fields.map((entry) => entry.field || entry.reason || entry) : [])
  ]);
}

function actionName(value) {
  const normalized = cleanText(value).toLowerCase();
  return Object.values(writerConfirmationActions).includes(normalized)
    ? normalized
    : writerConfirmationActions.EDIT_AND_CONFIRM;
}

function splitConfirmedFields(fields = {}) {
  const input = isPlainObject(fields) ? fields : {};
  const identityFields = {};
  const physicalInstanceFields = {};
  Object.entries(input).forEach(([field, value]) => {
    if (!hasValue(value)) return;
    if (physicalInstanceFieldNames.includes(field)) {
      physicalInstanceFields[field] = value;
      return;
    }
    if (identityFieldNames.includes(field)) identityFields[field] = value;
  });
  return { identityFields, physicalInstanceFields };
}

function valuesEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function fieldDiff(before = {}, after = {}) {
  const keys = unique([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return keys
    .filter((key) => !valuesEqual(before[key], after[key]))
    .map((key) => ({
      field: key,
      from: before[key] ?? null,
      to: after[key] ?? null
    }));
}

export function levenshteinDistance(a = "", b = "") {
  const left = cleanText(a);
  const right = cleanText(b);
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length] || 0;
}

export function normalizedEditDistance(before = "", after = "") {
  const denominator = Math.max(cleanText(before).length, cleanText(after).length, 1);
  return Number((levenshteinDistance(before, after) / denominator).toFixed(6));
}

export function coldStartStatusForCandidateState({
  internalCandidates = [],
  officialCandidates = [],
  externalCandidates = [],
  marketplaceHints = [],
  safeDraftReady = false
} = {}) {
  if (candidateHasTrust(internalCandidates, [
    sourceTrustValues.REVIEWED_INTERNAL,
    sourceTrustValues.INTERNAL_VERIFIED_TITLE
  ])) return catalogColdStartStatuses.EXACT_INTERNAL_MATCH;
  if (candidateHasTrust(officialCandidates, [sourceTrustValues.OFFICIAL_CHECKLIST])) {
    return catalogColdStartStatuses.OFFICIAL_CHECKLIST_MATCH;
  }
  if (externalCandidates.length > 0) return catalogColdStartStatuses.EXTERNAL_DIRECTORY_CANDIDATES_ONLY;
  if (marketplaceHints.length > 0) return catalogColdStartStatuses.MARKETPLACE_HINTS_ONLY;
  if (safeDraftReady) return catalogColdStartStatuses.SAFE_DRAFT_READY;
  return catalogColdStartStatuses.CATALOG_GAP_REQUIRED;
}

export function buildCatalogFlywheelGapRow({
  item = {},
  result = {},
  sourceBatch = "",
  internalCandidates = [],
  officialCandidates = [],
  externalCandidates = [],
  marketplaceHints = [],
  now = new Date()
} = {}) {
  const normalizedInternal = normalizeCandidateList(internalCandidates, sourceTrustValues.REVIEWED_INTERNAL);
  const normalizedOfficial = normalizeCandidateList(officialCandidates, sourceTrustValues.OFFICIAL_CHECKLIST);
  const normalizedExternal = normalizeCandidateList(externalCandidates, sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY);
  const normalizedMarketplace = normalizeCandidateList(marketplaceHints, sourceTrustValues.MARKETPLACE_RAW);
  const observedFields = observedFieldsFromResult(result);
  const safeDraftReady = result.cold_start_safe_draft?.safe_draft_ready === true
    || result.cold_start_status === "SAFE_DRAFT_READY";
  const coldStartStatus = coldStartStatusForCandidateState({
    internalCandidates: normalizedInternal,
    officialCandidates: normalizedOfficial,
    externalCandidates: normalizedExternal,
    marketplaceHints: normalizedMarketplace,
    safeDraftReady
  });

  return {
    client_gap_key: `catalog_flywheel_${cleanText(item.asset_id || result.candidate_id || result.asset_id || Date.parse(now))}`,
    source_feedback_id: result.source_feedback_id || null,
    asset_id: item.asset_id || result.asset_id || result.candidate_id || "",
    physical_card_id: item.physical_card_id || result.physical_card_id || "",
    source_batch: sourceBatch || item.source_manifest || result.source_batch || "",
    image_ids: queryImageIdsFromItem(item),
    query_image_ids: queryImageIdsFromItem(item),
    ai_draft_title: titleFromResult(result),
    observed_fields: observedFields,
    internal_candidates: normalizedInternal,
    official_candidates: normalizedOfficial,
    external_candidates: normalizedExternal,
    marketplace_hints: normalizedMarketplace,
    unresolved_fields: unresolvedFieldsFromResult(result),
    high_risk_fields: highRiskFieldsFromResult(result),
    cold_start_status: coldStartStatus,
    writer_action_required: coldStartStatus !== catalogColdStartStatuses.EXACT_INTERNAL_MATCH,
    writer_final_title: null,
    writer_confirmed_fields: null,
    selected_candidate_id: null,
    rejected_candidate_ids: [],
    field_diff: [],
    review_time_ms: null,
    promoted_catalog_identity_id: null,
    promotion_status: "pending",
    training_eligible: false,
    metadata: {
      generated_at: now.toISOString(),
      source_trust_breakdown: sourceTrustBreakdown([
        ...normalizedInternal,
        ...normalizedOfficial,
        ...normalizedExternal,
        ...normalizedMarketplace
      ]),
      ebay_title_used_as_ground_truth: false,
      ebay_title_sent_to_model: false,
      external_candidates_used_as_truth: false,
      serial_grade_cert_copy_allowed: false
    }
  };
}

function candidateById(row = {}, id = "") {
  const target = cleanText(id);
  return [
    ...(row.internal_candidates || []),
    ...(row.official_candidates || []),
    ...(row.external_candidates || []),
    ...(row.marketplace_hints || [])
  ].find((candidate) => candidateId(candidate) === target) || null;
}

function promotionActionFor(action, selectedCandidate = null) {
  if (action === writerConfirmationActions.REJECT_CANDIDATE) return "reject_candidate";
  if (action === writerConfirmationActions.CREATE_NEW_IDENTITY) return "promote_new_identity";
  if (selectedCandidate && isExternalDirectoryTrust(selectedCandidate.source_trust)) return "promote_external_candidate_after_review";
  return "promote_reviewed_writer_title";
}

function reviewedCatalogStaging({ gapRow = {}, writerFinalTitle = "", writerConfirmedFields = {}, action = "" } = {}) {
  if (!writerFinalTitle) return null;
  const staging = correctedTitleRecordToCatalogStaging({
    id: gapRow.client_gap_key || gapRow.gap_id || gapRow.asset_id,
    asset_id: gapRow.asset_id,
    corrected_title: writerFinalTitle
  });
  if (!staging) return null;
  const { identityFields, physicalInstanceFields } = splitConfirmedFields(writerConfirmedFields);
  staging.source.source_type = "INTERNAL_VERIFIED_TITLE";
  staging.source.source_status = "VERIFIED_CANONICAL_TITLE";
  staging.source.source_name = "writer confirmed catalog cold-start flywheel";
  staging.source.source_metadata = {
    ...(staging.source.source_metadata || {}),
    selected_candidate_id: gapRow.selected_candidate_id || null,
    writer_action: action,
    eBay_title_used_as_ground_truth: false,
    external_candidate_used_as_truth: false,
    promotion_requires_writer_review: true
  };
  staging.staging.identity_fields = {
    ...staging.staging.identity_fields,
    ...identityFields
  };
  staging.staging.physical_instance_fields = {
    ...staging.staging.physical_instance_fields,
    ...physicalInstanceFields
  };
  Object.keys(identityFields).forEach((field) => {
    staging.staging.field_statuses[field] = "REVIEWED_INTERNAL";
  });
  Object.keys(physicalInstanceFields).forEach((field) => {
    staging.staging.field_statuses[field] = "REVIEWED_INTERNAL";
  });
  staging.staging.import_status = "REVIEWED_INTERNAL";
  staging.staging.review_notes = null;
  staging.staging.parse_confidence = 1;
  return staging;
}

function hardNegativesForReview({
  gapRow = {},
  selectedCandidate = null,
  rejectedCandidateIds = [],
  actor = "",
  allowTrainingEligible = false
} = {}) {
  return unique(rejectedCandidateIds).map((id) => {
    const candidate = candidateById(gapRow, id);
    return {
      query_card_id: gapRow.asset_id || gapRow.client_gap_key || "",
      correct_identity_id: selectedCandidate?.external_card_id || selectedCandidate?.candidate_id || null,
      wrong_candidate_id: id,
      wrong_candidate_source_trust: candidate?.source_trust || null,
      error_type: "writer_rejected_candidate",
      similarity_features: {
        match_level: candidate?.match_level || null,
        confidence: candidate?.confidence || null,
        rank: candidate?.rank || null
      },
      matched_fields: candidate?.fields || {},
      conflicting_fields: candidate?.conflicting_fields || candidate?.conflict_fields || [],
      writer_resolution: selectedCandidate ? "selected_other_candidate" : "manual_identity",
      reviewed_by: actor || null,
      training_eligible: allowTrainingEligible === true
    };
  });
}

export function applyWriterConfirmationToFlywheel({
  gapRow = {},
  action = writerConfirmationActions.EDIT_AND_CONFIRM,
  writerFinalTitle = "",
  writerConfirmedFields = {},
  selectedCandidateId = "",
  rejectedCandidateIds = [],
  reviewTimeMs = null,
  actor = "",
  promotedCatalogIdentityId = null,
  allowTrainingEligible = false,
  now = new Date()
} = {}) {
  const normalizedAction = actionName(action);
  const selectedCandidate = selectedCandidateId ? candidateById(gapRow, selectedCandidateId) : null;
  const finalTitle = cleanText(writerFinalTitle || gapRow.ai_draft_title);
  const confirmed = isPlainObject(writerConfirmedFields) ? writerConfirmedFields : {};
  const diff = fieldDiff(gapRow.observed_fields || {}, confirmed);
  const promoted = confirmedActions.has(normalizedAction);
  const updatedGapRow = {
    ...gapRow,
    status: promoted ? "approved" : "rejected",
    writer_action_required: false,
    writer_final_title: finalTitle || null,
    writer_confirmed_fields: confirmed,
    selected_candidate_id: selectedCandidateId || null,
    rejected_candidate_ids: unique(rejectedCandidateIds),
    field_diff: diff,
    review_time_ms: Number.isFinite(Number(reviewTimeMs)) ? Number(reviewTimeMs) : null,
    promoted_catalog_identity_id: promotedCatalogIdentityId,
    promotion_status: promoted ? "promoted" : "rejected",
    training_eligible: allowTrainingEligible === true,
    updated_at: now.toISOString(),
    metadata: {
      ...(gapRow.metadata || {}),
      writer_action: normalizedAction,
      writer_reviewed_at: now.toISOString(),
      writer_reviewed_by: actor || null,
      selected_candidate_source_trust: selectedCandidate?.source_trust || null,
      external_candidate_used_as_truth: false,
      promotion_requires_writer_review: true
    }
  };

  const catalogStaging = promoted
    ? reviewedCatalogStaging({
      gapRow: updatedGapRow,
      writerFinalTitle: finalTitle,
      writerConfirmedFields: confirmed,
      action: normalizedAction
    })
    : null;

  return {
    action: normalizedAction,
    promoted,
    gap_row: updatedGapRow,
    selected_candidate: selectedCandidate,
    catalog_staging: catalogStaging,
    promotion_event: {
      action: promotionActionFor(normalizedAction, selectedCandidate),
      actor: actor || null,
      source_gap_key: gapRow.client_gap_key || gapRow.gap_id || null,
      selected_candidate_id: selectedCandidateId || null,
      promoted_catalog_identity_id: promotedCatalogIdentityId,
      created_at: now.toISOString(),
      metadata: {
        review_time_ms: updatedGapRow.review_time_ms,
        field_diff_count: diff.length,
        external_candidate_source_trust: selectedCandidate?.source_trust || null
      }
    },
    hard_negatives: hardNegativesForReview({
      gapRow: updatedGapRow,
      selectedCandidate,
      rejectedCandidateIds,
      actor,
      allowTrainingEligible
    })
  };
}

export function catalogFlywheelTrustMetrics(rows = []) {
  const allCandidates = (Array.isArray(rows) ? rows : []).flatMap((row) => [
    ...(row.internal_candidates || []),
    ...(row.official_candidates || []),
    ...(row.external_candidates || []),
    ...(row.marketplace_hints || [])
  ]);
  const violations = allCandidates.flatMap(forbiddenUsageViolations);
  return {
    source_trust_breakdown: sourceTrustBreakdown(allCandidates),
    forbidden_usage_violation_count: violations.length,
    serial_grade_cert_copy_violation_count: violations.filter((violation) => /physical_instance|serial|grade|cert/.test(violation)).length,
    marketplace_pollution_count: allCandidates.filter((candidate) => isMarketplaceTrust(candidate.source_trust) && candidate.used_as_truth === true).length
  };
}
