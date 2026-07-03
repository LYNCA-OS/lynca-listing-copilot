import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { renderListingPresentation } from "../renderer/listing-renderer.mjs";
import { safeSurfaceColor } from "../parallel-policy.mjs";
import {
  allowedUsageForTrust,
  forbiddenUsageForTrust,
  isExternalDirectoryTrust,
  isMarketplaceTrust,
  normalizeSourceTrust,
  sourceTrustValues
} from "../external/external-candidate-contract.mjs";

export const coldStartStatuses = Object.freeze({
  SAFE_DRAFT_READY: "SAFE_DRAFT_READY",
  WRITER_REVIEW_REQUIRED: "WRITER_REVIEW_REQUIRED",
  DEEP_RESEARCH_REQUIRED: "DEEP_RESEARCH_REQUIRED",
  CATALOG_GAP_REQUIRED: "CATALOG_GAP_REQUIRED",
  MARKETPLACE_HINTS_ONLY: "MARKETPLACE_HINTS_ONLY",
  NO_APPROVED_CATALOG_MATCH: "NO_APPROVED_CATALOG_MATCH"
});

export const externalAllowedUsage = Object.freeze([
  ...allowedUsageForTrust(sourceTrustValues.EXTERNAL_DIRECTORY_WEAK)
]);

export const externalForbiddenUsage = Object.freeze([
  ...forbiddenUsageForTrust(sourceTrustValues.EXTERNAL_DIRECTORY_WEAK)
]);

const exactParallelFields = Object.freeze([
  "parallel_exact",
  "parallel_family",
  "parallel",
  "variation"
]);

const highRiskUnsupportedFields = Object.freeze([
  "ssp",
  "case_hit",
  "descriptive_rarity",
  "rare"
]);

const physicalInstanceFields = Object.freeze([
  "serial_number",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "cert_number"
]);

const currentImageSourceTypes = new Set([
  "CARD_FRONT",
  "CARD_BACK",
  "CARD_FRONT_PRINTED_TEXT",
  "CARD_BACK_PRINTED_TEXT",
  "SLAB_LABEL",
  "OCR",
  "OCR_ONLY",
  "VISION_MODEL",
  "PRIMARY_FAST_VISION",
  "MODEL_INFERENCE",
  "VISIBLE_SIGNATURE",
  "FOCUSED_VISUAL"
]);

const trustedCatalogSourceTypes = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "INTERNAL_REGISTRY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA",
  "STRUCTURED_DATABASE",
  "STRUCTURED_REGISTRY"
]);

const printedOrSlabSourceTypes = new Set([
  "SLAB_LABEL",
  "CARD_BACK_PRINTED_TEXT",
  "CARD_FRONT_PRINTED_TEXT",
  "OCR",
  "OCR_ONLY"
]);

const externalSourceTypes = new Set([
  "MARKETPLACE",
  "OPEN_WEB"
]);

const externalProviderIds = new Set([
  "ebay_browse",
  "brave",
  "openai_web_search"
]);

const cropActionGroups = Object.freeze({
  serial_crop_reread_count: /CROP_AND_READ_SERIAL|serial/i,
  card_number_crop_reread_count: /CROP_AND_READ_CARD_CODE|collector|checklist|card_code/i,
  slab_label_crop_reread_count: /CROP_AND_READ_GRADE_LABEL|grade_label|slab/i,
  product_text_crop_reread_count: /CROP_AND_READ_YEAR_PRODUCT|year_product|product_text/i
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function upper(value) {
  return cleanText(value).toUpperCase();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "" && value !== "UNKNOWN";
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function evidenceForField(result = {}, fieldName = "") {
  const evidence = result.normalized_evidence || result.evidence || {};
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  return evidence[fieldName] || null;
}

function fieldEvidenceObject(result = {}, fieldName = "") {
  const fieldEvidence = result.field_evidence || result.fieldEvidence || {};
  if (!fieldEvidence || typeof fieldEvidence !== "object" || Array.isArray(fieldEvidence)) return null;
  return fieldEvidence[fieldName] || null;
}

function evidenceSources(result = {}, fieldName = "") {
  const evidence = evidenceForField(result, fieldName);
  const sources = Array.isArray(evidence?.sources) ? evidence.sources : [];
  const fieldEvidence = fieldEvidenceObject(result, fieldName);
  if (fieldEvidence && typeof fieldEvidence === "object" && !Array.isArray(fieldEvidence)) {
    sources.push({
      source_type: fieldEvidence.support_type || fieldEvidence.source_type || "",
      direct_observation: fieldEvidence.direct_observation === true || fieldEvidence.directly_observed === true,
      visible_text: fieldEvidence.visible_text || fieldEvidence.raw_text || ""
    });
  }
  return sources;
}

function sourceType(source = {}) {
  return upper(source.source_type || source.source || source.provider_id || source.support_type);
}

function sourceLooksCurrentImage(source = {}) {
  if (source.direct_observation === true || source.directly_observed === true) return true;
  return currentImageSourceTypes.has(sourceType(source));
}

function sourceLooksSlabLabel(source = {}) {
  return sourceType(source) === "SLAB_LABEL";
}

function sourceLooksPrintedOrTrusted(source = {}) {
  const type = sourceType(source);
  return printedOrSlabSourceTypes.has(type)
    || trustedCatalogSourceTypes.has(type)
    || source.source_url?.startsWith?.("supabase://catalog-cards/")
    || source.source_url?.startsWith?.("supabase://card-identities/");
}

function fieldHasCurrentImageEvidence(result = {}, fieldName = "") {
  return evidenceSources(result, fieldName).some(sourceLooksCurrentImage);
}

function fieldHasSlabEvidence(result = {}, fieldName = "") {
  return evidenceSources(result, fieldName).some(sourceLooksSlabLabel);
}

function fieldHasPrintedOrTrustedEvidence(result = {}, fieldName = "") {
  return evidenceSources(result, fieldName).some(sourceLooksPrintedOrTrusted);
}

function noApprovedCatalogMatch(openSetReadiness = {}) {
  return openSetReadiness.known_catalog_candidate_available !== true
    && Number(openSetReadiness.prompt_safe_candidate_count || 0) === 0;
}

function coldStartExplicit(providerOptions = {}, mode = "") {
  const text = cleanText(mode).toLowerCase();
  const raw = providerOptions.cold_start_blind ?? providerOptions.enable_cold_start_blind;
  return raw === true
    || ["1", "true", "yes", "on"].includes(String(raw || "").trim().toLowerCase())
    || text === "cold_start_blind"
    || text === "ebay_cold_start_blind";
}

export function coldStartModeActive({
  providerOptions = {},
  mode = "",
  openSetReadiness = {}
} = {}) {
  if (coldStartExplicit(providerOptions, mode)) return true;
  const status = upper(openSetReadiness.status);
  return [
    "REFERENCE_CANDIDATES_ONLY",
    "EVIDENCE_BACKED_NO_CATALOG",
    "OPEN_SET_NO_EXACT_MATCH",
    "LOW_MARGIN_SIMILAR_ONLY"
  ].includes(status);
}

function addReview(reviewFields, field, reason) {
  reviewFields.push({ field, reason });
}

function clearField(fields, field) {
  if (Object.prototype.hasOwnProperty.call(fields, field)) fields[field] = null;
}

function clearBoolean(fields, field) {
  if (Object.prototype.hasOwnProperty.call(fields, field)) fields[field] = false;
}

function removeFromTitle(title = "", values = []) {
  let output = cleanText(title);
  unique(values).forEach((value) => {
    if (!value) return;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
  });
  return output.replace(/\s+/g, " ").trim();
}

function safeDraftReady(fields = {}, removed = [], reviewFields = []) {
  const hasSubject = hasValue(fields.players) || hasValue(fields.player) || hasValue(fields.character);
  const hasProduct = hasValue(fields.product) || hasValue(fields.set) || hasValue(fields.brand) || hasValue(fields.manufacturer);
  if (!hasSubject || !hasProduct) return false;
  const blocking = new Set(["serial_number", "grade", "official_card_type"]);
  return removed.length === 0 || reviewFields.every((entry) => !blocking.has(entry.field));
}

function statusFor({
  fields,
  openSetReadiness,
  externalTrace,
  removed,
  reviewFields
}) {
  if (!noApprovedCatalogMatch(openSetReadiness)) return coldStartStatuses.SAFE_DRAFT_READY;
  const hasSubject = hasValue(fields.players) || hasValue(fields.player) || hasValue(fields.character);
  const hasProduct = hasValue(fields.product) || hasValue(fields.set) || hasValue(fields.brand) || hasValue(fields.manufacturer);
  if (!hasSubject || !hasProduct) return coldStartStatuses.CATALOG_GAP_REQUIRED;
  if (externalTrace.length && reviewFields.length) return coldStartStatuses.MARKETPLACE_HINTS_ONLY;
  if (removed.length || reviewFields.length) return coldStartStatuses.WRITER_REVIEW_REQUIRED;
  return coldStartStatuses.SAFE_DRAFT_READY;
}

function traceSummaries(result = {}) {
  return [
    result.catalog_retrieval,
    result.retrieval,
    result.vector_retrieval,
    result.catalog_candidate_packet?.vector_retrieval,
    result.vector_candidate_packet?.vector_retrieval
  ].filter((summary) => summary && typeof summary === "object" && !Array.isArray(summary));
}

function sourceIsExternal(source = {}) {
  const type = sourceType(source);
  const provider = cleanText(source.provider_id || source.source_provider).toLowerCase();
  const trust = normalizeSourceTrust(source.source_trust || source.trust_tier || source.source_type, "");
  return externalSourceTypes.has(type)
    || externalProviderIds.has(provider)
    || isExternalDirectoryTrust(trust)
    || isMarketplaceTrust(trust);
}

function weakParsedFields(source = {}) {
  const fields = normalizeResolvedFields(source.fields || {});
  const denied = new Set(physicalInstanceFields);
  const output = {};
  [
    "year",
    "manufacturer",
    "brand",
    "product",
    "set",
    "players",
    "character",
    "card_name",
    "surface_color",
    "collector_number",
    "checklist_code",
    "observable_components",
    "auto",
    "rc",
    "patch",
    "relic",
    "jersey"
  ].forEach((field) => {
    if (denied.has(field)) return;
    if (hasValue(fields[field])) output[field] = fields[field];
  });
  return output;
}

function conflictFields(source = {}) {
  return unique([
    ...(Array.isArray(source.conflicting_fields) ? source.conflicting_fields : []),
    ...(Array.isArray(source.direct_evidence_conflicts) ? source.direct_evidence_conflicts : []),
    ...(Array.isArray(source.conflicts) ? source.conflicts.map((item) => typeof item === "string" ? item : item?.field || item?.field_name) : [])
  ]);
}

export function externalRetrievalTraceFromResult(result = {}) {
  const titleAssistUrl = cleanText(result.retrieval_title_assist?.source_url);
  return traceSummaries(result).flatMap((summary) => {
    const queryByProvider = Array.isArray(summary.queries) ? summary.queries : [];
    return (Array.isArray(summary.sources) ? summary.sources : [])
      .filter(sourceIsExternal)
      .map((source, index) => ({
        query: cleanText(source.query || source.query_text || queryByProvider[index]?.query || queryByProvider[0]?.query || ""),
        source_url: cleanText(source.source_url || source.url),
        source_title: cleanText(source.title || source.reference_title),
        snippet: cleanText(source.evidence_excerpt || source.snippet).slice(0, 600),
        parsed_weak_fields: weakParsedFields(source),
        source_type: sourceType(source) || "OPEN_WEB",
        source_trust: normalizeSourceTrust(source.source_trust || source.trust_tier || "MARKETPLACE_RAW", sourceTrustValues.MARKETPLACE_RAW),
        allowed_usage: allowedUsageForTrust(source.source_trust || source.trust_tier || sourceTrustValues.MARKETPLACE_RAW),
        forbidden_usage: forbiddenUsageForTrust(source.source_trust || source.trust_tier || sourceTrustValues.MARKETPLACE_RAW),
        conflict_fields: conflictFields(source),
        used_in_draft: Boolean(titleAssistUrl && titleAssistUrl === cleanText(source.source_url || source.url)),
        used_as_truth: false
      }));
  });
}

function traceEntries(result = {}) {
  return [
    ...(Array.isArray(result.field_task_status) ? result.field_task_status : []),
    ...(Array.isArray(result.completion_trace) ? result.completion_trace : []),
    ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : [])
  ];
}

export function focusedCropMetricsFromResult(result = {}) {
  const entries = traceEntries(result);
  const textEntries = entries.map((entry) => JSON.stringify(entry || {}));
  const metrics = {
    focused_crop_used_count: 0,
    serial_crop_reread_count: 0,
    card_number_crop_reread_count: 0,
    slab_label_crop_reread_count: 0,
    product_text_crop_reread_count: 0,
    crop_recovery_count: 0,
    crop_regression_count: 0
  };
  Object.entries(cropActionGroups).forEach(([key, pattern]) => {
    metrics[key] = textEntries.filter((text) => pattern.test(text)).length;
  });
  metrics.focused_crop_used_count = Object.entries(cropActionGroups)
    .reduce((sum, [key]) => sum + metrics[key], 0);
  metrics.crop_recovery_count = textEntries.filter((text) => /recovered|field_recovered|accepted/i.test(text)).length;
  metrics.crop_regression_count = textEntries.filter((text) => /regression|conflict|rejected/i.test(text)).length;
  return metrics;
}

export function analyzeColdStartDraft(result = {}, {
  openSetReadiness = result.open_set_readiness || {},
  externalRetrievalTrace = result.external_retrieval_trace || externalRetrievalTraceFromResult(result)
} = {}) {
  const fields = normalizeResolvedFields(result.resolved_fields || result.resolved || result.fields || {});
  const exactParallelValues = exactParallelFields.map((field) => fields[field]).filter(hasValue);
  const unsupportedExactParallel = exactParallelValues.length > 0
    && noApprovedCatalogMatch(openSetReadiness)
    && !exactParallelFields.some((field) => fieldHasPrintedOrTrustedEvidence(result, field));
  const unsupportedOfficialCardType = hasValue(fields.official_card_type)
    && noApprovedCatalogMatch(openSetReadiness)
    && !fieldHasPrintedOrTrustedEvidence(result, "official_card_type");
  const serialPresent = hasValue(fields.serial_number);
  const gradePresent = hasValue(fields.grade_company) || hasValue(fields.card_grade) || hasValue(fields.auto_grade);
  const serialCurrentImageOnly = serialPresent && fieldHasCurrentImageEvidence(result, "serial_number");
  const gradeCurrentImageOnly = gradePresent && (
    fieldHasSlabEvidence(result, "grade")
    || fieldHasSlabEvidence(result, "grade_company")
    || fieldHasSlabEvidence(result, "card_grade")
  );
  const copiedReferenceInstanceFields = [
    serialPresent && !serialCurrentImageOnly ? "serial_number" : "",
    gradePresent && !gradeCurrentImageOnly ? "grade" : "",
    hasValue(fields.cert_number) && !fieldHasSlabEvidence(result, "cert_number") ? "cert_number" : ""
  ].filter(Boolean);
  const highRiskGuessFields = unique([
    unsupportedExactParallel ? "parallel_exact" : "",
    unsupportedOfficialCardType ? "official_card_type" : "",
    ...copiedReferenceInstanceFields
  ]);
  return {
    no_approved_catalog_match: noApprovedCatalogMatch(openSetReadiness),
    unsupported_exact_parallel: unsupportedExactParallel,
    unsupported_official_card_type: unsupportedOfficialCardType,
    high_risk_guess_fields: highRiskGuessFields,
    copied_reference_instance_fields: copiedReferenceInstanceFields,
    serial_current_image_only: serialPresent ? serialCurrentImageOnly : null,
    grade_current_image_only: gradePresent ? gradeCurrentImageOnly : null,
    external_retrieval_used: externalRetrievalTrace.length > 0,
    focused_crop_metrics: focusedCropMetricsFromResult(result)
  };
}

export function applyColdStartSafeDraftPolicy(result = {}, {
  providerOptions = {},
  mode = "",
  openSetReadiness = result.open_set_readiness || {},
  maxLength = 80
} = {}) {
  const active = coldStartModeActive({ providerOptions, mode, openSetReadiness });
  const externalTrace = externalRetrievalTraceFromResult(result);
  if (!active) {
    return {
      ...result,
      external_retrieval_trace: result.external_retrieval_trace || externalTrace,
      cold_start_safe_draft: {
        active: false,
        reason: "cold_start_blind_not_active"
      }
    };
  }

  const rawOriginalFields = result.resolved_fields || result.resolved || result.fields || {};
  const originalFields = normalizeResolvedFields(rawOriginalFields);
  const fields = { ...originalFields };
  const removed = [];
  const reviewFields = [];
  const knownCatalog = !noApprovedCatalogMatch(openSetReadiness);

  if (!knownCatalog) {
    const exactValues = exactParallelFields.map((field) => fields[field]).filter(hasValue);
    const exactSupported = exactParallelFields.some((field) => fieldHasPrintedOrTrustedEvidence(result, field));
    if (exactValues.length && !exactSupported) {
      const surfaceColor = safeSurfaceColor(fields.surface_color || exactValues.join(" "));
      exactParallelFields.forEach((field) => clearField(fields, field));
      if (surfaceColor) fields.surface_color = surfaceColor;
      removed.push({
        field: "parallel_exact",
        values: exactValues,
        reason: "exact_parallel_requires_catalog_printed_or_writer_confirmation",
        preserved_surface_color: surfaceColor || null
      });
      addReview(reviewFields, "parallel_exact", "exact parallel unsupported in cold start");
    }

    if (hasValue(fields.official_card_type) && !fieldHasPrintedOrTrustedEvidence(result, "official_card_type")) {
      removed.push({
        field: "official_card_type",
        values: [fields.official_card_type],
        reason: "official_card_type_requires_printed_catalog_or_writer_confirmation"
      });
      clearField(fields, "official_card_type");
      addReview(reviewFields, "official_card_type", "official card type unsupported in cold start");
    }

    const rawBaseValues = [rawOriginalFields.card_type, rawOriginalFields.insert, fields.card_type, fields.insert]
      .filter((value) => /^base$/i.test(cleanText(value)));
    if (rawBaseValues.length) {
      removed.push({
        field: "base",
        values: rawBaseValues,
        reason: "base_must_not_be_defaulted_without_catalog_support"
      });
      if (/^base$/i.test(cleanText(fields.card_type))) clearField(fields, "card_type");
      if (/^base$/i.test(cleanText(fields.insert))) clearField(fields, "insert");
      addReview(reviewFields, "card_type", "Base removed because it lacks catalog support");
    }

    highRiskUnsupportedFields.forEach((field) => {
      if (hasValue(fields[field]) && !fieldHasPrintedOrTrustedEvidence(result, field)) {
        removed.push({
          field,
          values: [fields[field]],
          reason: "descriptive_rarity_requires_strong_external_or_writer_confirmation"
        });
        clearField(fields, field);
        addReview(reviewFields, field, "descriptive rarity unsupported in cold start");
      }
    });
  }

  if (hasValue(fields.serial_number) && !fieldHasCurrentImageEvidence(result, "serial_number")) {
    removed.push({
      field: "serial_number",
      values: [fields.serial_number],
      reason: "serial_number_must_come_from_current_image"
    });
    clearField(fields, "serial_number");
    addReview(reviewFields, "serial_number", "serial requires current-image evidence");
  }

  const gradePresent = hasValue(fields.grade_company) || hasValue(fields.card_grade) || hasValue(fields.auto_grade);
  if (gradePresent && !fieldHasSlabEvidence(result, "grade") && !fieldHasSlabEvidence(result, "grade_company") && !fieldHasSlabEvidence(result, "card_grade")) {
    const gradeValues = [fields.grade_company, fields.card_grade, fields.auto_grade, fields.grade_type].filter(hasValue);
    removed.push({
      field: "grade",
      values: gradeValues,
      reason: "grade_must_come_from_current_slab_label"
    });
    ["grade_company", "card_grade", "auto_grade", "grade_type", "cert_number"].forEach((field) => clearField(fields, field));
    addReview(reviewFields, "grade", "grade requires current slab label evidence");
  }

  ["rc", "auto", "patch", "relic", "jersey"].forEach((field) => {
    if (fields[field] === true && !fieldHasCurrentImageEvidence(result, field)) {
      removed.push({
        field,
        values: [true],
        reason: `${field}_must_be_directly_visible_or_printed`
      });
      clearBoolean(fields, field);
      addReview(reviewFields, field, `${field} requires current-image evidence`);
    }
  });

  const status = statusFor({
    fields,
    openSetReadiness,
    externalTrace,
    removed,
    reviewFields
  });
  const safeDraft = safeDraftReady(fields, removed, reviewFields);
  const evidence = result.evidence || result.normalized_evidence || {};
  const presentation = renderListingPresentation({ resolved: fields, evidence, maxLength });
  const renderedTitle = removeFromTitle(
    presentation.rendered_title || result.rendered_title || result.final_title || result.title || "",
    removed.flatMap((entry) => entry.values || [])
  );

  const analysis = analyzeColdStartDraft({
    ...result,
    resolved: fields,
    resolved_fields: fields
  }, { openSetReadiness, externalRetrievalTrace: externalTrace });

  return {
    ...result,
    title: renderedTitle,
    final_title: renderedTitle,
    rendered_title: renderedTitle,
    model_title_suggestion: renderedTitle,
    title_render_source: removed.length ? "cold_start_safe_draft_policy" : result.title_render_source,
    fields: {
      ...(result.fields || {}),
      ...fields
    },
    resolved: fields,
    resolved_fields: fields,
    rendered_fields: {
      ...(result.rendered_fields || {}),
      ...fields,
      title: renderedTitle,
      rendered_title: renderedTitle,
      modules: presentation.modules,
      module_order: presentation.module_order,
      title_render_source: removed.length ? "cold_start_safe_draft_policy" : result.title_render_source,
      fields
    },
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer || result.renderer,
    renderer_version: presentation.renderer_version || result.renderer_version,
    title_length_policy: presentation.title_length_policy || result.title_length_policy,
    unresolved: unique([
      ...(Array.isArray(result.unresolved) ? result.unresolved : []),
      ...reviewFields.map((entry) => `${entry.field} requires writer review`)
    ]).slice(0, 20),
    review_fields: reviewFields,
    external_retrieval_trace: externalTrace,
    cold_start_status: status,
    writer_action_required: status !== coldStartStatuses.SAFE_DRAFT_READY || noApprovedCatalogMatch(openSetReadiness),
    high_risk_guess_removed: removed,
    cold_start_safe_draft: {
      active: true,
      status,
      safe_draft_ready: safeDraft,
      known_approved_catalog_match: !noApprovedCatalogMatch(openSetReadiness),
      no_approved_catalog_match: noApprovedCatalogMatch(openSetReadiness),
      high_risk_guess_removed_count: removed.length,
      review_field_count: reviewFields.length,
      external_retrieval_used: externalTrace.length > 0,
      analysis
    }
  };
}
