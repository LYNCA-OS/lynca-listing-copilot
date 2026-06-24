import { normalizeResolvedFields } from "../listing/evidence/evidence-schema.mjs";
import { resolvedFieldsToLegacyFields } from "../listing/evidence/provider-evidence-normalizer.mjs";
import { renderListingPresentation } from "../listing/renderer/listing-renderer.mjs";
import { containsNonEnglishTitleScript } from "../listing/renderer/title-cleanup.mjs";
import { resolveIdentity, resolveIdentityWithConvergence } from "./solver.mjs";
import { identityStatuses } from "./types.mjs";

const criticalOptionalFields = Object.freeze([
  "serial_number",
  "collector_number",
  "checklist_code",
  "multi_card",
  "card_count",
  "lot_type",
  "card_type",
  "parallel",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

const colorDescriptorFields = Object.freeze([
  "set",
  "subset",
  "insert"
]);

const colorTokens = Object.freeze([
  "black",
  "blue",
  "bronze",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow"
]);

const publicationStatuses = Object.freeze({
  AUTO_PUBLISH_READY: "AUTO_PUBLISH_READY",
  WRITER_QUICK_APPROVAL_READY: "WRITER_QUICK_APPROVAL_READY",
  WRITER_REVIEW_READY: "WRITER_REVIEW_READY",
  MANUAL_REQUIRED: "MANUAL_REQUIRED"
});

function hasValue(value, fieldName = "") {
  if (fieldName === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalText(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptorColorTokens(value) {
  const tokens = new Set(canonicalText(Array.isArray(value) ? value.join(" ") : value).split(" ").filter(Boolean));
  return colorTokens.filter((token) => tokens.has(token));
}

function sourceTypeForIdentity(source = {}, providerId = "") {
  const type = source.source_type || source.source || "";
  if (type === "VISION_MODEL") {
    if (providerId === "primary_fast_vision") return "PRIMARY_FAST_VISION";
    return providerId === "openai_legacy" ? "VISUAL_GUESS" : "AGNES_INFERENCE";
  }
  return type || "VISUAL_GUESS";
}

function evidenceCandidates(field = {}) {
  if (Array.isArray(field.candidates) && field.candidates.length) {
    return field.candidates.filter((candidate) => hasValue(candidate?.value));
  }
  return hasValue(field.value) ? [{ value: field.value, confidence: field.confidence }] : [];
}

function evidenceSources(field = {}, candidate = {}) {
  if (Array.isArray(candidate.sources) && candidate.sources.length) return candidate.sources;
  return Array.isArray(field.sources) && field.sources.length ? field.sources : [{}];
}

function sourceMetadata(source = {}) {
  return {
    original_source: source.source_type || source.source || null,
    side: source.side || null,
    capture_role: source.capture_role || null,
    region: source.region || null,
    observed_text: source.observed_text || null,
    glare_occlusion: source.glare_occlusion ?? null,
    glare_score: source.glare_occlusion ?? null,
    blur_score: source.blur_score ?? null,
    trust_tier: source.trust_tier ?? null
  };
}

export function evidenceDocumentToIdentityEvidenceItems(evidenceDocument = {}, {
  providerId = ""
} = {}) {
  const evidence = evidenceDocument?.evidence && typeof evidenceDocument.evidence === "object"
    ? evidenceDocument.evidence
    : {};
  const items = [];

  Object.entries(evidence).forEach(([fieldName, field]) => {
    if (!field || typeof field !== "object") return;
    const candidates = evidenceCandidates(field);

    candidates.forEach((candidate) => {
      evidenceSources(field, candidate).forEach((source) => {
        items.push({
          field: fieldName,
          value: candidate.value,
          source: sourceTypeForIdentity(source, providerId),
          confidence: Number(candidate.confidence ?? field.confidence ?? 0.5),
          image_id: source.image_id || source.imageId || null,
          region: source.region || null,
          metadata: {
            ...sourceMetadata(source),
            field_status: field.status || null,
            field_unresolved_reason: field.unresolved_reason || null
          }
        });
      });
    });
  });

  return items;
}

export function criticalFieldsForIdentityResolution(resolved = {}, evidenceItems = []) {
  const normalized = normalizeResolvedFields(resolved);
  const evidenceFields = new Set(evidenceItems.map((item) => item.field).filter(Boolean));
  const subjectField = hasValue(normalized.players, "players")
    ? "players"
    : hasValue(normalized.character, "character")
      ? "character"
      : "players";

  return unique([
    "year",
    "product",
    subjectField,
    ...criticalOptionalFields.filter((field) => evidenceFields.has(field) || hasValue(normalized[field], field))
  ]);
}

function unresolvedFromIdentityResolution(identityResolution = {}, criticalFields = []) {
  const critical = new Set(criticalFields);
  return (identityResolution.field_states || [])
    .filter((fieldState) => {
      return critical.has(fieldState.field)
        && fieldState.decision_route !== "DROP"
        && (fieldState.decision_route === "ABSTAIN" || fieldState.ambiguity || !hasValue(fieldState.resolved_value, fieldState.field));
    })
    .map((fieldState) => `identity ${fieldState.field}: ${fieldState.resolution_reason || "unresolved"}`);
}

function publicLegacyFields(identity = {}, existingFields = {}) {
  const legacy = resolvedFieldsToLegacyFields(identity);
  return {
    ...existingFields,
    ...Object.fromEntries(Object.entries(legacy).filter(([, value]) => value !== null && value !== undefined))
  };
}

function fieldStateHasUnresolvedConflict(fieldState = {}) {
  return (fieldState.conflict_items || []).some((conflict) => conflict?.resolved !== true);
}

function fieldSources(fieldState = {}) {
  return (Array.isArray(fieldState.source_summary) ? fieldState.source_summary : [])
    .map((summary) => summary.source)
    .filter(Boolean);
}

function fieldHasAnySource(fieldState = {}, sources = []) {
  const sourceSet = new Set(fieldSources(fieldState));
  return sources.some((source) => sourceSet.has(source));
}

const directEvidenceSources = Object.freeze([
  "SLAB_LABEL",
  "CARD_BACK_PRINTED_TEXT",
  "CARD_FRONT_PRINTED_TEXT",
  "PRIMARY_FAST_VISION"
]);

const catalogCorroborationSources = Object.freeze([
  "INTERNAL_APPROVED_HISTORY",
  "OFFICIAL_CHECKLIST",
  "STRUCTURED_DATABASE"
]);

function fieldHasDirectEvidence(fieldState = {}) {
  return fieldHasAnySource(fieldState, directEvidenceSources);
}

function fieldHasHighConfidenceDirectEvidence(fieldState = {}, {
  minConfidence = 0.86
} = {}) {
  const supporting = Array.isArray(fieldState.supporting_sources) ? fieldState.supporting_sources : [];
  if (supporting.some((source) => {
    return directEvidenceSources.includes(source.source) && Number(source.confidence || 0) >= minConfidence;
  })) {
    return true;
  }

  const candidateItems = (Array.isArray(fieldState.candidates) ? fieldState.candidates : [])
    .flatMap((candidate) => Array.isArray(candidate.evidence_items) ? candidate.evidence_items : []);
  return candidateItems.some((item) => {
    return directEvidenceSources.includes(item.source) && Number(item.confidence || 0) >= minConfidence;
  });
}

function fieldHasCatalogCorroboration(fieldState = {}) {
  return fieldHasAnySource(fieldState, catalogCorroborationSources);
}

const yearAutoPublishEvidenceSources = Object.freeze([
  "SLAB_LABEL",
  "CARD_BACK_PRINTED_TEXT",
  ...catalogCorroborationSources
]);

function yearHasAutoPublishSupport(fieldState = {}) {
  const sources = new Set(candidateSources(fieldState));
  return yearAutoPublishEvidenceSources.some((source) => sources.has(source));
}

function taxonomyDependentExactField(field) {
  return [
    "parallel_exact",
    "parallel_family",
    "parallel",
    "variation",
    "ssp",
    "case_hit",
    "card_type",
    "insert"
  ].includes(field);
}

function catalogOrStrongTextExactField(field) {
  return [
    "parallel_exact",
    "parallel_family",
    "parallel",
    "variation",
    "ssp",
    "case_hit"
  ].includes(field);
}

const strongExactEvidenceSources = Object.freeze([
  "SLAB_LABEL",
  "CARD_BACK_PRINTED_TEXT",
  "CARD_FRONT_PRINTED_TEXT",
  "INTERNAL_APPROVED_HISTORY",
  "OFFICIAL_CHECKLIST",
  "STRUCTURED_DATABASE"
]);

function candidateSources(fieldState = {}) {
  const candidateSourceLists = (Array.isArray(fieldState.candidates) ? fieldState.candidates : [])
    .flatMap((candidate) => Array.isArray(candidate.sources) ? candidate.sources : []);
  return unique([...fieldSources(fieldState), ...candidateSourceLists]);
}

function fieldHasStrongExactEvidence(fieldState = {}) {
  const sources = new Set(candidateSources(fieldState));
  return strongExactEvidenceSources.some((source) => sources.has(source));
}

function reviewableFieldValue(fieldState = {}) {
  if (hasValue(fieldState.resolved_value, fieldState.field)) return fieldState.resolved_value;
  const candidate = (Array.isArray(fieldState.candidates) ? fieldState.candidates : [])
    .find((item) => hasValue(item?.value, fieldState.field));
  return candidate?.value ?? null;
}

function directlySupportedPublishState(fieldState = {}) {
  if (!hasValue(fieldState.resolved_value, fieldState.field)) return "OBSERVED";
  const direct = fieldHasDirectEvidence(fieldState);
  const constraintOk = !(fieldState.conflict_items || []).some((conflict) => conflict.resolved !== true);
  const catalog = fieldHasCatalogCorroboration(fieldState);

  if (catalog) return "PUBLISHABLE_EXACT";
  if (direct && constraintOk && !taxonomyDependentExactField(fieldState.field)) return "PUBLISHABLE_NARROW";
  if (direct && constraintOk) return "CONSTRAINT_COMPATIBLE";
  if (direct) return "DIRECTLY_SUPPORTED";
  return "OBSERVED";
}

function fieldStateBlocksPublication(fieldState = {}, criticalFields = []) {
  const critical = new Set(criticalFields);
  return critical.has(fieldState.field)
    && fieldState.decision_route !== "DROP"
    && (
      fieldState.decision_route === "ABSTAIN"
      || fieldState.ambiguity === true
      || !hasValue(fieldState.resolved_value, fieldState.field)
      || fieldStateHasUnresolvedConflict(fieldState)
    );
}

const verificationFieldGroups = Object.freeze({
  serial_number: ["serial_number"],
  parallel: ["surface_color", "parallel_family", "parallel_exact", "parallel", "variation"],
  year_product: ["year", "brand", "product", "set", "subset"],
  grade_label: ["grade_company", "card_grade", "auto_grade", "grade_type"],
  card_code: ["collector_number", "checklist_code"]
});

function policyRequiredReviewItems({
  result = {},
  identity = {}
} = {}) {
  const policy = result.fast_vision_policy || {};
  const requiredGroups = Array.isArray(policy.secondary_verification_required_fields)
    ? policy.secondary_verification_required_fields
    : [];
  if (!requiredGroups.length) return [];

  return requiredGroups.flatMap((fieldGroup) => {
    if (verificationFieldSatisfied(fieldGroup, identity, result.resolution_trace || [])) return [];
    const fields = verificationFieldGroups[fieldGroup] || [fieldGroup];
    return fields
      .filter((field) => hasValue(identity[field], field))
      .map((field) => ({
        field,
        current_value: identity[field],
        resolution_confidence: 0,
        resolution_reason: `secondary_verification_required:${fieldGroup}`,
        decision_route: "ABSTAIN",
        candidates: [],
        conflicts: []
      }));
  });
}

function exactTaxonomyReviewItems(identityResolution = {}) {
  return (identityResolution.field_states || [])
    .filter((fieldState) => {
      return catalogOrStrongTextExactField(fieldState.field)
        && hasValue(reviewableFieldValue(fieldState), fieldState.field)
        && !fieldHasStrongExactEvidence(fieldState);
    })
    .map((fieldState) => ({
      field: fieldState.field,
      current_value: reviewableFieldValue(fieldState),
      resolution_confidence: Number(fieldState.resolution_confidence || 0),
      resolution_reason: "catalog_required_for_exact_taxonomy",
      decision_route: "ABSTAIN",
      candidates: Array.isArray(fieldState.candidates) ? fieldState.candidates.slice(0, 3) : [],
      conflicts: Array.isArray(fieldState.conflict_items)
        ? fieldState.conflict_items.filter((conflict) => conflict?.resolved !== true)
        : [],
      publication_state: directlySupportedPublishState(fieldState)
    }));
}

function yearAutoPublishReviewItems(identityResolution = {}) {
  const yearState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "year");
  if (!yearState || !hasValue(reviewableFieldValue(yearState), "year")) return [];
  if (yearHasAutoPublishSupport(yearState)) return [];

  return [{
    field: "year",
    current_value: reviewableFieldValue(yearState),
    resolution_confidence: Number(yearState.resolution_confidence || 0),
    resolution_reason: "year_requires_catalog_or_authoritative_support_for_auto_publish",
    decision_route: "ABSTAIN",
    candidates: Array.isArray(yearState.candidates) ? yearState.candidates.slice(0, 3) : [],
    conflicts: Array.isArray(yearState.conflict_items)
      ? yearState.conflict_items.filter((conflict) => conflict?.resolved !== true)
      : [],
    publication_state: directlySupportedPublishState(yearState)
  }];
}

function writerReviewItems(identityResolution = {}, criticalFields = [], extraItems = []) {
  const byField = new Map();
  (identityResolution.field_states || [])
    .filter((fieldState) => fieldStateBlocksPublication(fieldState, criticalFields))
    .map((fieldState) => ({
      field: fieldState.field,
      current_value: hasValue(fieldState.resolved_value, fieldState.field) ? fieldState.resolved_value : null,
      resolution_confidence: Number(fieldState.resolution_confidence || 0),
      resolution_reason: fieldState.resolution_reason || "writer_review_required",
      decision_route: fieldState.decision_route || "ABSTAIN",
      candidates: Array.isArray(fieldState.candidates) ? fieldState.candidates.slice(0, 3) : [],
      conflicts: Array.isArray(fieldState.conflict_items)
        ? fieldState.conflict_items.filter((conflict) => conflict?.resolved !== true)
        : []
    }))
    .forEach((item) => byField.set(item.field, item));
  (extraItems || []).forEach((item) => {
    if (!item?.field) return;
    byField.set(item.field, {
      ...(byField.get(item.field) || {}),
      ...item
    });
  });
  return [...byField.values()];
}

function buildFieldLevelPublication({
  autoPublishAllowed = false,
  modelPublishRecommended = false,
  writerDraft = {},
  reviewItems = [],
  identityResolution = {},
  activeIdentity = {}
} = {}) {
  const fieldStates = identityResolution.field_states || [];
  const stateByField = Object.fromEntries(fieldStates.map((fieldState) => [
    fieldState.field,
    directlySupportedPublishState(fieldState)
  ]));
  const reviewByField = new Map(reviewItems.map((item) => [item.field, item]));
  const publishableFields = {};

  Object.entries(activeIdentity || {}).forEach(([field, value]) => {
    if (!hasValue(value, field) || reviewByField.has(field)) return;
    publishableFields[field] = {
      value,
      publication_state: stateByField[field] || "PUBLISHABLE_NARROW",
      source: modelPublishRecommended ? "model_quick_approval_identity" : "partial_writer_draft"
    };
  });

  const reviewRequiredFields = reviewItems.map((item) => ({
    field: item.field,
    current_value: item.current_value ?? null,
    publication_state: item.publication_state || stateByField[item.field] || "REVIEW",
    resolution_confidence: Number(item.resolution_confidence || 0),
    resolution_reason: item.resolution_reason || "writer_review_required",
    decision_route: item.decision_route || "ABSTAIN"
  }));

  const usableFieldCount = Object.keys(publishableFields).length;
  const reviewFieldCount = reviewRequiredFields.length;
  const mode = modelPublishRecommended
    ? "WRITER_QUICK_APPROVAL"
    : writerDraft.can_render === true
      ? "PARTIAL_WRITER_DRAFT"
      : "MANUAL_ONLY";

  return {
    mode,
    output_strategy: modelPublishRecommended
      ? "writer_can_one_click_approve_or_edit"
      : writerDraft.can_render === true
        ? "publish_known_fields_writer_completes_remainder"
        : "manual_review_before_title",
    publishable_fields: publishableFields,
    review_required_fields: reviewRequiredFields,
    usable_field_count: usableFieldCount,
    review_field_count: reviewFieldCount,
    has_partial_output: usableFieldCount > 0,
    writer_can_start: autoPublishAllowed || writerDraft.can_render === true
  };
}

function identityForWriterDraft(identityResolution = {}, {
  blockedFields = []
} = {}) {
  const selected = {};
  const blocked = new Set(blockedFields);

  (identityResolution.field_states || []).forEach((fieldState) => {
    if (blocked.has(fieldState.field)) return;
    if (fieldState.decision_route !== "USE") return;
    if (fieldState.ambiguity === true || fieldStateHasUnresolvedConflict(fieldState)) return;
    if (!hasValue(fieldState.resolved_value, fieldState.field)) return;
    selected[fieldState.field] = fieldState.resolved_value;
  });

  return normalizeResolvedFields(selected);
}

function hasWriterDraftSubstance(identity = {}) {
  return hasValue(identity.players, "players")
    || hasValue(identity.character, "character")
    || hasValue(identity.product, "product")
    || hasValue(identity.set, "set")
    || hasValue(identity.brand, "brand")
    || hasValue(identity.manufacturer, "manufacturer");
}

function fieldStatusForWriterDraft(fieldName, fieldStates = []) {
  const state = fieldStates.find((fieldState) => fieldState.field === fieldName);
  if (!state) return null;
  if (state.decision_route === "USE" && state.ambiguity !== true && !fieldStateHasUnresolvedConflict(state)) {
    return "CONFIRMED";
  }
  if (state.decision_route === "DROP") return "NOT_APPLICABLE";
  return "REVIEW";
}

function evidenceForWriterDraft(evidence = {}, fieldStates = []) {
  const next = { ...(evidence || {}) };
  fieldStates.forEach((fieldState) => {
    const status = fieldStatusForWriterDraft(fieldState.field, fieldStates);
    if (!status) return;
    next[fieldState.field] = {
      ...(next[fieldState.field] || {}),
      status,
      confidence: Number(fieldState.resolution_confidence || next[fieldState.field]?.confidence || 0),
      sources: next[fieldState.field]?.sources || fieldState.supporting_sources || []
    };
  });
  return next;
}

function writerDraftPresentation({
  identityResolution = {},
  evidence = {},
  maxLength = 80,
  titleLanguageBlocked = false,
  lotDetected = false,
  blockedFields = []
} = {}) {
  if (titleLanguageBlocked || lotDetected) {
    return {
      identity: normalizeResolvedFields({}),
      presentation: null,
      can_render: false
    };
  }

  const identity = identityForWriterDraft(identityResolution, { blockedFields });
  if (!hasWriterDraftSubstance(identity)) {
    return {
      identity,
      presentation: null,
      can_render: false
    };
  }

  const draftEvidence = evidenceForWriterDraft(evidence, identityResolution.field_states || []);
  const presentation = renderListingPresentation({
    resolved: identity,
    evidence: draftEvidence,
    maxLength
  });
  const policy = presentation.title_length_policy || {};
  const blockedRequiredTitleTerms = Array.isArray(policy.blocked_required_terms)
    ? policy.blocked_required_terms
    : [];
  const blocked = blockedRequiredTitleTerms.length > 0
    || containsNonEnglishTitleScript(presentation.final_title);

  return {
    identity,
    evidence: draftEvidence,
    presentation,
    can_render: Boolean(presentation.final_title) && !blocked,
    blocked_required_terms: blockedRequiredTitleTerms
  };
}

function buildPublicationGate({
  autoPublishAllowed = false,
  modelPublishRecommended = false,
  writerDraft = {},
  reviewItems = [],
  identityResolution = {},
  activeIdentity = {},
  titleLanguageBlocked = false,
  lotDetected = false
} = {}) {
  const writerReviewReady = modelPublishRecommended || writerDraft.can_render === true;
  const status = modelPublishRecommended
    ? publicationStatuses.WRITER_QUICK_APPROVAL_READY
    : writerReviewReady
      ? publicationStatuses.WRITER_REVIEW_READY
      : publicationStatuses.MANUAL_REQUIRED;

  return {
    status,
    auto_publish_allowed: false,
    model_auto_publish_recommended: modelPublishRecommended,
    writer_quick_approval_ready: modelPublishRecommended,
    human_approval_required: true,
    writer_review_ready: writerReviewReady,
    partial_writer_draft: !modelPublishRecommended && writerDraft.can_render === true,
    upload_blocked_until_writer_approval: true,
    writer_required_fields: reviewItems.map((item) => item.field),
    writer_review_items: reviewItems,
    draft_fields: Object.keys(writerDraft.identity || {}).filter((field) => hasValue(writerDraft.identity[field], field)),
    field_publication_states: Object.fromEntries((identityResolution.field_states || []).map((fieldState) => [
      fieldState.field,
      directlySupportedPublishState(fieldState)
    ])),
    field_level_publication: buildFieldLevelPublication({
      autoPublishAllowed,
      modelPublishRecommended,
      writerDraft,
      reviewItems,
      identityResolution,
      activeIdentity
    }),
    blocked_reasons: unique([
      lotDetected ? "MULTI_CARD_LOT_REQUIRES_MANUAL_SPLIT" : null,
      titleLanguageBlocked ? "TITLE_LANGUAGE_REQUIRES_MANUAL_ENGLISH_REVIEW" : null,
      ...reviewItems.map((item) => `${item.field}:${item.resolution_reason}`)
    ])
  };
}

function normalizedPublicationConfidence(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["HIGH", "MEDIUM", "LOW", "FAILED"].includes(normalized)) return normalized;
  return "";
}

function hasPublicationReviewSignal({ reason = "", unresolved = [] } = {}) {
  const text = canonicalText([
    reason,
    ...(Array.isArray(unresolved) ? unresolved : [])
  ].join(" "));
  return [
    "operator review",
    "requires review",
    "manual review",
    "needs review",
    "uncertain",
    "ambiguous",
    "unreadable",
    "not confirmed"
  ].some((term) => text.includes(term));
}

function confidenceForIdentityStatus(status, {
  existingConfidence = "",
  reason = "",
  unresolved = []
} = {}) {
  if (status === identityStatuses.CONFIRMED) {
    const existing = normalizedPublicationConfidence(existingConfidence);
    if (existing === "LOW" || existing === "FAILED") return "LOW";
    if (existing === "MEDIUM" || hasPublicationReviewSignal({ reason, unresolved })) return "MEDIUM";
    return "HIGH";
  }
  if (status === identityStatuses.RESOLVED) return "MEDIUM";
  return "LOW";
}

function resolutionReason(identityResolution = {}) {
  if (identityResolution.status === identityStatuses.CONFIRMED) {
    return "Identity resolution confirmed critical fields from grounded evidence.";
  }
  if (identityResolution.status === identityStatuses.RESOLVED) {
    return "Identity resolution resolved conflicts with traceable evidence.";
  }
  return "Identity resolution abstained because grounded evidence is missing, conflicting, or too uncertain.";
}

function mergeReason(identityReason, existingReason) {
  const base = String(identityReason || "").trim();
  const existing = String(existingReason || "").trim();
  if (!existing) return base;
  if (!base) return existing;
  if (existing.toLowerCase().includes(base.toLowerCase())) return existing;
  return `${base} ${existing}`.trim();
}

function parseCardCount(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function multiCardLotGuardInfo({
  identity = {},
  resolved = {},
  fields = {},
  unresolved = [],
  reason = ""
} = {}) {
  const cardCount = parseCardCount(identity.card_count ?? resolved.card_count ?? fields.card_count ?? fields.cardCount);
  const lotText = [
    identity.lot_type,
    resolved.lot_type,
    fields.lot_type,
    fields.lotType,
    reason,
    ...unresolved
  ].filter(Boolean).join(" ");
  const textIndicatesLot = /\b(?:multi[-\s]?card|multiple cards|card lot|lot of cards|bundle of cards)\b/i.test(lotText)
    || /套卡|多张卡|多卡/.test(lotText);
  const detected = identity.multi_card === true
    || resolved.multi_card === true
    || fields.multi_card === true
    || fields.multiCard === true
    || Number(cardCount || 0) > 1
    || textIndicatesLot;

  return {
    detected,
    card_count: cardCount,
    lot_type: identity.lot_type || resolved.lot_type || fields.lot_type || fields.lotType || (textIndicatesLot ? "multi_card_lot" : null)
  };
}

function applyMultiCardLotGuard(identityResolution = {}, lotGuard = {}) {
  if (!lotGuard.detected) return identityResolution;

  const conflict = {
    field: "multi_card",
    conflict_type: "MULTI_CARD_LOT_REQUIRES_SINGLE_CARD_SPLIT",
    conflicting_values: [lotGuard.card_count ? `${lotGuard.card_count} cards` : "multiple cards"],
    severity: "HIGH",
    reason: "multiple-card or lot image cannot be resolved as one card identity",
    resolved: false
  };
  const trace = {
    field: "multi_card",
    step: "lot_guard",
    input: {
      multi_card: true,
      card_count: lotGuard.card_count,
      lot_type: lotGuard.lot_type
    },
    output: {
      status: identityStatuses.ABSTAIN,
      route: "NON_STANDARD_MANUAL"
    },
    decision: "multi_card_lot_requires_operator_review",
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    status: identityStatuses.ABSTAIN,
    ambiguity_status: "AMBIGUOUS",
    conflict_map: [...(identityResolution.conflict_map || []), conflict],
    global_conflicts: [...(identityResolution.global_conflicts || []), conflict],
    resolution_trace: [...(identityResolution.resolution_trace || []), trace],
    identity_state: identityResolution.identity_state
      ? {
          ...identityResolution.identity_state,
          status: identityStatuses.ABSTAIN,
          conflict_graph: identityResolution.identity_state.conflict_graph || []
        }
      : identityResolution.identity_state
  };
}

function updateIdentityState(identityResolution = {}, patch = {}) {
  return identityResolution.identity_state
    ? {
        ...identityResolution.identity_state,
        ...patch,
        status: patch.status || identityResolution.identity_state.status,
        fields: patch.fields || identityResolution.identity_state.fields
      }
    : identityResolution.identity_state;
}

function appendAbstainConflict(identityResolution = {}, {
  field,
  conflictType,
  value,
  reason,
  decision
} = {}) {
  const conflict = {
    field,
    conflict_type: conflictType,
    conflicting_values: [value].filter((item) => hasValue(item, field)),
    severity: "HIGH",
    reason,
    resolved: false
  };
  const guardTrace = {
    field,
    step: "commercial_publish_guard",
    input: { value },
    output: {
      status: identityStatuses.ABSTAIN,
      route: "MANUAL_REQUIRED"
    },
    decision,
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    status: identityStatuses.ABSTAIN,
    ambiguity_status: "AMBIGUOUS",
    conflict_map: [...(identityResolution.conflict_map || []), conflict],
    global_conflicts: [...(identityResolution.global_conflicts || []), conflict],
    resolution_trace: [...(identityResolution.resolution_trace || []), guardTrace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (fieldState.field !== field) return fieldState;
      return {
        ...fieldState,
        decision_route: "ABSTAIN",
        ambiguity: true,
        conflicts: true,
        resolution_reason: decision,
        conflict_items: [...(fieldState.conflict_items || []), conflict]
      };
    }),
    identity_state: updateIdentityState(identityResolution, { status: identityStatuses.ABSTAIN })
  };
}

function applyCriticalFieldConfidenceGuard(identityResolution = {}, criticalFields = [], {
  minConfidence = 0.74
} = {}) {
  const critical = new Set(criticalFields);
  const fieldStates = identityResolution.field_states || [];
  const counterpartHasSameHighConfidenceValue = (fieldState = {}) => {
    const counterpartField = fieldState.field === "parallel"
      ? "variation"
      : fieldState.field === "variation"
        ? "parallel"
        : null;
    if (!counterpartField) return false;
    const counterpart = fieldStates.find((candidate) => candidate.field === counterpartField);
    return hasValue(counterpart?.resolved_value, counterpartField)
      && canonicalText(counterpart.resolved_value) === canonicalText(fieldState.resolved_value)
      && Number(counterpart.resolution_confidence || 0) >= minConfidence;
  };
  const risky = fieldStates.find((fieldState) => {
    return critical.has(fieldState.field)
      && hasValue(fieldState.resolved_value, fieldState.field)
      && !counterpartHasSameHighConfidenceValue(fieldState)
      && Number(fieldState.resolution_confidence || 0) < minConfidence;
  });
  if (!risky) return identityResolution;

  return appendAbstainConflict(identityResolution, {
    field: risky.field,
    conflictType: "CRITICAL_FIELD_BELOW_PUBLISH_CONFIDENCE",
    value: risky.resolved_value,
    reason: `${risky.field} confidence is below the commercial auto-publish threshold`,
    decision: "critical_field_requires_operator_review_below_publish_confidence"
  });
}

function unresolvedConflict(conflict = {}) {
  return conflict.resolved !== true;
}

function lowConfidencePublishConflict(conflict = {}) {
  return conflict.conflict_type === "CRITICAL_FIELD_BELOW_PUBLISH_CONFIDENCE";
}

function focusedVisionSummaries(trace = []) {
  return (Array.isArray(trace) ? trace : [])
    .map((entry) => entry?.output?.focused_vision)
    .filter((summary) => summary && typeof summary === "object");
}

function focusedUpdatedFields(trace = []) {
  return new Set(focusedVisionSummaries(trace).flatMap((summary) => {
    return Array.isArray(summary.updated_fields) ? summary.updated_fields : [];
  }));
}

function focusedConflictingFields(trace = []) {
  return new Set(focusedVisionSummaries(trace).flatMap((summary) => {
    return Array.isArray(summary.conflicting_fields) ? summary.conflicting_fields : [];
  }));
}

function verificationFieldSatisfied(fieldGroup, identity = {}, trace = []) {
  const updated = focusedUpdatedFields(trace);
  const conflicting = focusedConflictingFields(trace);

  if (fieldGroup === "serial_number") {
    if (!hasValue(identity.serial_number, "serial_number")) return true;
    return updated.has("serial_number") && !conflicting.has("serial_number");
  }

  if (fieldGroup === "parallel") {
    const fields = ["surface_color", "parallel_family", "parallel_exact", "parallel", "variation"];
    const present = fields.filter((field) => hasValue(identity[field], field));
    if (!present.length) return true;
    return present.some((field) => updated.has(field)) && present.every((field) => !conflicting.has(field));
  }

  if (fieldGroup === "year_product") {
    const fields = ["year", "brand", "product", "set", "subset"];
    const present = fields.filter((field) => hasValue(identity[field], field));
    if (!present.length) return false;
    return fields.some((field) => updated.has(field)) && fields.every((field) => !conflicting.has(field));
  }

  if (fieldGroup === "grade_label") {
    const fields = ["grade_company", "card_grade", "auto_grade", "grade_type"];
    const present = fields.filter((field) => hasValue(identity[field], field));
    if (!present.length) return true;
    return present.some((field) => updated.has(field)) && present.every((field) => !conflicting.has(field));
  }

  if (fieldGroup === "card_code") {
    const fields = ["collector_number", "checklist_code"];
    const present = fields.filter((field) => hasValue(identity[field], field));
    if (!present.length) return true;
    return present.some((field) => updated.has(field)) && present.every((field) => !conflicting.has(field));
  }

  return true;
}

function releasePrimaryFastVisionAbstain(identityResolution = {}, {
  result = {},
  criticalFields = []
} = {}) {
  const policy = result.fast_vision_policy || {};
  if (policy.role !== "PRIMARY_FAST_VISION" || policy.allow_single_source_publish !== true) return identityResolution;
  if (identityResolution.status !== identityStatuses.ABSTAIN) return identityResolution;

  const identity = identityResolution.identity || {};
  if (identity.multi_card || Number(identity.card_count || 0) > 1) return identityResolution;

  const unresolvedConflicts = (identityResolution.conflict_map || []).filter(unresolvedConflict);
  const blockingConflicts = unresolvedConflicts.filter((conflict) => !lowConfidencePublishConflict(conflict));
  if (blockingConflicts.length) return identityResolution;

  const fieldStates = identityResolution.field_states || [];
  const missingCritical = criticalFields.some((field) => {
    const fieldState = fieldStates.find((candidate) => candidate.field === field);
    return !fieldState || !hasValue(fieldState.resolved_value, field) || fieldState.resolution_reason === "missing_evidence";
  });
  if (missingCritical) return identityResolution;

  const requiredFields = Array.isArray(policy.secondary_verification_required_fields)
    ? policy.secondary_verification_required_fields
    : [];
  const secondarySatisfied = requiredFields.every((fieldGroup) => verificationFieldSatisfied(fieldGroup, identity, result.resolution_trace || []));
  if (!secondarySatisfied) return identityResolution;

  const releaseTrace = {
    field: "*",
    stage: "fast_vision_publish_policy",
    input: {
      role: policy.role,
      secondary_verification_required_fields: requiredFields
    },
    output: {
      status: identityStatuses.RESOLVED,
      reason: "primary_fast_vision_evidence_complete_constraints_passed"
    }
  };

  return {
    ...identityResolution,
    status: identityStatuses.RESOLVED,
    ambiguity_status: "RESOLVED",
    conflict_map: (identityResolution.conflict_map || []).map((conflict) => lowConfidencePublishConflict(conflict)
      ? {
          ...conflict,
          resolved: true,
          resolution: "released_by_primary_fast_vision_policy"
        }
      : conflict),
    global_conflicts: (identityResolution.global_conflicts || []).map((conflict) => lowConfidencePublishConflict(conflict)
      ? {
          ...conflict,
          resolved: true,
          resolution: "released_by_primary_fast_vision_policy"
        }
      : conflict),
    field_states: fieldStates.map((fieldState) => {
      if (!lowConfidencePublishConflict((fieldState.conflict_items || [])[0]) && fieldState.decision_route !== "ABSTAIN") return fieldState;
      const lowConfidenceConflicts = (fieldState.conflict_items || []).filter(lowConfidencePublishConflict);
      if (!lowConfidenceConflicts.length) return fieldState;
      return {
        ...fieldState,
        decision_route: "USE",
        ambiguity: false,
        conflicts: (fieldState.conflict_items || []).some((conflict) => !lowConfidencePublishConflict(conflict)),
        resolution_reason: "primary_fast_vision_evidence_complete_constraints_passed",
        conflict_items: (fieldState.conflict_items || []).map((conflict) => lowConfidencePublishConflict(conflict)
          ? {
              ...conflict,
              resolved: true,
              resolution: "released_by_primary_fast_vision_policy"
            }
          : conflict)
      };
    }),
    resolution_trace: [...(identityResolution.resolution_trace || []), releaseTrace],
    identity_state: updateIdentityState(identityResolution, { status: identityStatuses.RESOLVED })
  };
}

function subjectCriticalField(criticalFields = []) {
  if (criticalFields.includes("character")) return "character";
  return "players";
}

function highBlockingConflict(conflict = {}) {
  if (conflict.resolved === true) return false;
  if (lowConfidencePublishConflict(conflict)) return false;
  return String(conflict.severity || "").toUpperCase() === "HIGH";
}

function fieldStateFor(identityResolution = {}, field) {
  return (identityResolution.field_states || []).find((fieldState) => fieldState.field === field) || null;
}

function fieldDirectlyResolved(identityResolution = {}, field) {
  const fieldState = fieldStateFor(identityResolution, field);
  const blockingConflicts = (fieldState?.conflict_items || []).filter((conflict) => {
    return conflict?.resolved !== true && !lowConfidencePublishConflict(conflict);
  });
  return hasValue(fieldState?.resolved_value, field)
    && fieldHasHighConfidenceDirectEvidence(fieldState)
    && blockingConflicts.length === 0;
}

function releaseEvidenceBackedAbstain(identityResolution = {}, {
  result = {},
  criticalFields = []
} = {}) {
  if (identityResolution.status !== identityStatuses.ABSTAIN) return identityResolution;
  if ((identityResolution.conflict_map || []).some(highBlockingConflict)) return identityResolution;
  if (policyRequiredReviewItems({ result, identity: identityResolution.identity || {} }).length) return identityResolution;

  const subjectField = subjectCriticalField(criticalFields);
  const requiredFields = unique(["year", "product", subjectField]);
  const directRequired = requiredFields.every((field) => fieldDirectlyResolved(identityResolution, field));
  if (!directRequired) return identityResolution;

  const releaseTrace = {
    field: "*",
    stage: "evidence_backed_publish_policy",
    input: {
      required_fields: requiredFields,
      catalog_candidate_present: Boolean(identityResolution.candidate_identity_report?.selected_candidate_id)
    },
    output: {
      status: identityStatuses.RESOLVED,
      reason: "direct_evidence_complete_without_catalog_candidate"
    },
    decision: "released_by_evidence_backed_identity_policy",
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    status: identityStatuses.RESOLVED,
    ambiguity_status: "RESOLVED",
    conflict_map: (identityResolution.conflict_map || []).map((conflict) => lowConfidencePublishConflict(conflict)
      ? {
          ...conflict,
          resolved: true,
          resolution: "released_by_evidence_backed_identity_policy"
        }
      : conflict),
    global_conflicts: (identityResolution.global_conflicts || []).map((conflict) => lowConfidencePublishConflict(conflict)
      ? {
          ...conflict,
          resolved: true,
          resolution: "released_by_evidence_backed_identity_policy"
        }
      : conflict),
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      const lowConfidenceConflicts = (fieldState.conflict_items || []).filter(lowConfidencePublishConflict);
      if (!lowConfidenceConflicts.length) return fieldState;
      return {
        ...fieldState,
        decision_route: "USE",
        ambiguity: false,
        conflicts: (fieldState.conflict_items || []).some((conflict) => !lowConfidencePublishConflict(conflict)),
        resolution_reason: "direct_evidence_complete_without_catalog_candidate",
        conflict_items: (fieldState.conflict_items || []).map((conflict) => lowConfidencePublishConflict(conflict)
          ? {
              ...conflict,
              resolved: true,
              resolution: "released_by_evidence_backed_identity_policy"
            }
          : conflict)
      };
    }),
    resolution_trace: [...(identityResolution.resolution_trace || []), releaseTrace],
    identity_state: updateIdentityState(identityResolution, { status: identityStatuses.RESOLVED })
  };
}

function sourceSummaryOnly(fieldState = {}, allowedSources = []) {
  const summaries = Array.isArray(fieldState.source_summary) ? fieldState.source_summary : [];
  return summaries.length > 0 && summaries.every((summary) => allowedSources.includes(summary.source));
}

function maxResolvedEvidenceConfidence(fieldState = {}) {
  const support = Array.isArray(fieldState.supporting_sources) ? fieldState.supporting_sources : [];
  const supportScores = support
    .map((source) => Number(source.confidence))
    .filter((score) => Number.isFinite(score));
  if (supportScores.length) return Math.max(...supportScores);

  const candidateScores = (Array.isArray(fieldState.candidates) ? fieldState.candidates : [])
    .flatMap((candidate) => Array.isArray(candidate.evidence_items) ? candidate.evidence_items : [])
    .map((item) => Number(item.confidence))
    .filter((score) => Number.isFinite(score));
  return candidateScores.length ? Math.max(...candidateScores) : 0;
}

function applyWeakOcrOnlyOptionalCodeDrop(identityResolution = {}, {
  minConfidence = 0.74
} = {}) {
  const drops = (identityResolution.field_states || []).filter((fieldState) => {
    return fieldState.field === "checklist_code"
      && hasValue(fieldState.resolved_value, fieldState.field)
      && maxResolvedEvidenceConfidence(fieldState) < minConfidence
      && sourceSummaryOnly(fieldState, ["OCR_ONLY"]);
  });
  if (!drops.length) return identityResolution;

  const nextIdentity = { ...(identityResolution.identity || {}) };
  const conflicts = drops.map((fieldState) => {
    nextIdentity[fieldState.field] = null;
    return {
      field: fieldState.field,
      conflict_type: "WEAK_OCR_ONLY_OPTIONAL_CODE_DROPPED",
      conflicting_values: [fieldState.resolved_value],
      severity: "MEDIUM",
      reason: `${fieldState.field} came only from low-confidence OCR text and is not safe to publish as identity`,
      resolved: true,
      resolution: "dropped_weak_ocr_only_optional_code_before_publish",
      selected_value: null
    };
  });
  const droppedFields = new Set(drops.map((fieldState) => fieldState.field));
  const trace = drops.map((fieldState) => ({
    field: fieldState.field,
    step: "commercial_publish_guard",
    input: {
      value: fieldState.resolved_value,
      resolution_confidence: fieldState.resolution_confidence,
      source_summary: fieldState.source_summary || []
    },
    output: {
      resolved_value: null,
      status: identityStatuses.RESOLVED
    },
    decision: "dropped_weak_ocr_only_optional_code_before_publish",
    created_at: new Date().toISOString()
  }));
  const status = identityResolution.status === identityStatuses.CONFIRMED
    ? identityStatuses.RESOLVED
    : identityResolution.status;

  return {
    ...identityResolution,
    identity: nextIdentity,
    resolved_identity: nextIdentity,
    fields: nextIdentity,
    status,
    ambiguity_status: identityResolution.ambiguity_status === "CONFIRMED" ? "RESOLVED" : identityResolution.ambiguity_status,
    conflict_map: [...(identityResolution.conflict_map || []), ...conflicts],
    global_conflicts: [...(identityResolution.global_conflicts || []), ...conflicts],
    resolution_trace: [...(identityResolution.resolution_trace || []), ...trace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (!droppedFields.has(fieldState.field)) return fieldState;
      const conflict = conflicts.find((item) => item.field === fieldState.field);
      return {
        ...fieldState,
        resolved_value: null,
        decision_route: "DROP",
        ambiguity: false,
        conflicts: true,
        resolution_confidence: 0,
        resolution_reason: "dropped_weak_ocr_only_optional_code_before_publish",
        conflict_items: [...(fieldState.conflict_items || []), conflict].filter(Boolean)
      };
    }),
    identity_state: updateIdentityState(identityResolution, {
      status,
      fields: nextIdentity
    })
  };
}

function applyWeakVisualParallelDrop(identityResolution = {}, {
  minConfidence = 0.74
} = {}) {
  const drops = (identityResolution.field_states || []).filter((fieldState) => {
    return ["parallel", "variation"].includes(fieldState.field)
      && hasValue(fieldState.resolved_value, fieldState.field)
      && Number(fieldState.resolution_confidence || 0) < minConfidence
      && sourceSummaryOnly(fieldState, ["AGNES_INFERENCE", "VISUAL_GUESS"]);
  });
  if (!drops.length) return identityResolution;

  const nextIdentity = { ...(identityResolution.identity || {}) };
  const conflicts = drops.map((fieldState) => {
    nextIdentity[fieldState.field] = null;
    return {
      field: fieldState.field,
      conflict_type: "WEAK_VISUAL_PARALLEL_DROPPED",
      conflicting_values: [fieldState.resolved_value],
      severity: "MEDIUM",
      reason: `${fieldState.field} came only from low-confidence visual inference and is not safe to publish`,
      resolved: true,
      resolution: "dropped_weak_visual_parallel_before_publish",
      selected_value: null
    };
  });
  const droppedFields = new Set(drops.map((fieldState) => fieldState.field));
  const trace = drops.map((fieldState) => ({
    field: fieldState.field,
    step: "commercial_publish_guard",
    input: {
      value: fieldState.resolved_value,
      resolution_confidence: fieldState.resolution_confidence,
      source_summary: fieldState.source_summary || []
    },
    output: {
      resolved_value: null,
      status: identityStatuses.RESOLVED
    },
    decision: "dropped_weak_visual_parallel_before_publish",
    created_at: new Date().toISOString()
  }));
  const status = identityResolution.status === identityStatuses.CONFIRMED
    ? identityStatuses.RESOLVED
    : identityResolution.status;

  return {
    ...identityResolution,
    identity: nextIdentity,
    resolved_identity: nextIdentity,
    fields: nextIdentity,
    status,
    ambiguity_status: identityResolution.ambiguity_status === "CONFIRMED" ? "RESOLVED" : identityResolution.ambiguity_status,
    conflict_map: [...(identityResolution.conflict_map || []), ...conflicts],
    global_conflicts: [...(identityResolution.global_conflicts || []), ...conflicts],
    resolution_trace: [...(identityResolution.resolution_trace || []), ...trace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (!droppedFields.has(fieldState.field)) return fieldState;
      const conflict = conflicts.find((item) => item.field === fieldState.field);
      return {
        ...fieldState,
        resolved_value: null,
        decision_route: "DROP",
        ambiguity: false,
        conflicts: true,
        resolution_confidence: 0,
        resolution_reason: "dropped_weak_visual_parallel_before_publish",
        conflict_items: [...(fieldState.conflict_items || []), conflict].filter(Boolean)
      };
    }),
    identity_state: updateIdentityState(identityResolution, {
      status,
      fields: nextIdentity
    })
  };
}

function descriptorHasStrongConfirmation(fieldState = {}) {
  const summaries = Array.isArray(fieldState.source_summary) ? fieldState.source_summary : [];
  const sourceSet = new Set(summaries.map((summary) => summary.source).filter(Boolean));
  const authoritativeSources = new Set([
    "SLAB_LABEL",
    "CARD_BACK_PRINTED_TEXT",
    "INTERNAL_APPROVED_HISTORY",
    "OFFICIAL_CHECKLIST",
    "STRUCTURED_DATABASE"
  ]);
  if ([...sourceSet].some((source) => authoritativeSources.has(source))) return true;

  const groundedSourceCount = [...sourceSet].filter((source) => {
    return !["AGNES_INFERENCE", "VISUAL_GUESS", "MARKETPLACE"].includes(source);
  }).length;
  return groundedSourceCount >= 2;
}

function applyOptionalColorDescriptorDrop(identityResolution = {}) {
  const drops = (identityResolution.field_states || []).filter((fieldState) => {
    return colorDescriptorFields.includes(fieldState.field)
      && hasValue(fieldState.resolved_value, fieldState.field)
      && descriptorColorTokens(fieldState.resolved_value).length > 0
      && !descriptorHasStrongConfirmation(fieldState);
  });
  if (!drops.length) return identityResolution;

  const nextIdentity = { ...(identityResolution.identity || {}) };
  const conflicts = drops.map((fieldState) => {
    nextIdentity[fieldState.field] = null;
    return {
      field: fieldState.field,
      conflict_type: "OPTIONAL_COLOR_DESCRIPTOR_REQUIRES_STRONG_CONFIRMATION",
      conflicting_values: [fieldState.resolved_value],
      severity: "MEDIUM",
      reason: `${fieldState.field} contains color wording but lacks independent printed back, registry, slab, or multi-source confirmation`,
      resolved: true,
      resolution: "dropped_optional_color_descriptor_before_render",
      selected_value: null
    };
  });
  const droppedFields = new Set(drops.map((fieldState) => fieldState.field));
  const trace = drops.map((fieldState) => ({
    field: fieldState.field,
    step: "commercial_publish_guard",
    input: {
      value: fieldState.resolved_value,
      color_tokens: descriptorColorTokens(fieldState.resolved_value)
    },
    output: {
      resolved_value: null,
      status: identityStatuses.RESOLVED
    },
    decision: "dropped_optional_color_descriptor_without_strong_confirmation",
    created_at: new Date().toISOString()
  }));
  const status = identityResolution.status === identityStatuses.CONFIRMED
    ? identityStatuses.RESOLVED
    : identityResolution.status;

  return {
    ...identityResolution,
    identity: nextIdentity,
    resolved_identity: nextIdentity,
    fields: nextIdentity,
    status,
    ambiguity_status: identityResolution.ambiguity_status === "CONFIRMED" ? "RESOLVED" : identityResolution.ambiguity_status,
    conflict_map: [...(identityResolution.conflict_map || []), ...conflicts],
    global_conflicts: [...(identityResolution.global_conflicts || []), ...conflicts],
    resolution_trace: [...(identityResolution.resolution_trace || []), ...trace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (!droppedFields.has(fieldState.field)) return fieldState;
      const conflict = conflicts.find((item) => item.field === fieldState.field);
      return {
        ...fieldState,
        resolved_value: null,
        decision_route: "DROP",
        ambiguity: false,
        conflicts: true,
        resolution_confidence: 0,
        resolution_reason: "dropped_optional_color_descriptor_without_strong_confirmation",
        conflict_items: [...(fieldState.conflict_items || []), conflict].filter(Boolean)
      };
    }),
    identity_state: updateIdentityState(identityResolution, {
      status,
      fields: nextIdentity
    })
  };
}

function resolvedOptionalDropField(fieldState = {}) {
  if (!["parallel", "variation", "insert"].includes(fieldState.field)) return false;
  if (fieldState.decision_route !== "DROP") return false;
  const conflicts = Array.isArray(fieldState.conflict_items) ? fieldState.conflict_items : [];
  return conflicts.length > 0 && conflicts.every((conflict) => conflict.resolved === true);
}

function applySetAsProductFallback(identityResolution = {}) {
  const productState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "product");
  const setState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "set");
  if (!productState || hasValue(productState.resolved_value, "product")) return identityResolution;
  if (!["ABSTAIN", "DROP"].includes(productState.decision_route)) return identityResolution;
  if (!hasValue(setState?.resolved_value, "set")) return identityResolution;

  const fallbackValue = setState.resolved_value;
  const conflict = {
    field: "product",
    conflict_type: "PRODUCT_IDENTITY_SATISFIED_BY_SET",
    conflicting_values: [fallbackValue],
    severity: "MEDIUM",
    reason: "product was ambiguous, but set carries a stable product identity value",
    resolved: true,
    resolution: "used_set_as_product_identity_fallback",
    selected_value: fallbackValue
  };
  const nextIdentity = {
    ...(identityResolution.identity || {}),
    product: fallbackValue
  };
  const trace = {
    field: "product",
    step: "commercial_publish_guard",
    input: {
      product_resolution_reason: productState.resolution_reason,
      set_value: fallbackValue
    },
    output: {
      resolved_value: fallbackValue,
      status: identityStatuses.RESOLVED
    },
    decision: "used_set_as_product_identity_fallback",
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    identity: nextIdentity,
    resolved_identity: nextIdentity,
    fields: nextIdentity,
    conflict_map: [...(identityResolution.conflict_map || []).map((item) => item.field === "product" ? { ...item, resolved: true, resolution: "used_set_as_product_identity_fallback", selected_value: fallbackValue } : item), conflict],
    global_conflicts: [...(identityResolution.global_conflicts || []).map((item) => item.field === "product" ? { ...item, resolved: true, resolution: "used_set_as_product_identity_fallback", selected_value: fallbackValue } : item), conflict],
    resolution_trace: [...(identityResolution.resolution_trace || []), trace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (fieldState.field !== "product") return fieldState;
      return {
        ...fieldState,
        resolved_value: fallbackValue,
        decision_route: "USE",
        ambiguity: false,
        conflicts: true,
        resolution_confidence: Number(setState.resolution_confidence || 0),
        resolution_reason: "used_set_as_product_identity_fallback",
        conflict_items: [...(fieldState.conflict_items || []).map((item) => ({ ...item, resolved: true, resolution: "used_set_as_product_identity_fallback", selected_value: fallbackValue })), conflict]
      };
    }),
    identity_state: updateIdentityState(identityResolution, {
      fields: nextIdentity
    })
  };
}

function releaseResolvedOptionalDropAbstain(identityResolution = {}, criticalFields = []) {
  if (identityResolution.status !== identityStatuses.ABSTAIN) return identityResolution;
  const critical = new Set(criticalFields);
  const fieldStates = identityResolution.field_states || [];
  const hasBlockingField = fieldStates.some((fieldState) => {
    if (resolvedOptionalDropField(fieldState)) return false;
    if (!critical.has(fieldState.field)) return false;
    return fieldState.decision_route === "ABSTAIN" || fieldState.ambiguity === true;
  });
  const hasUnresolvedHighConflict = (identityResolution.conflict_map || []).some((conflict) => {
    return conflict.resolved !== true && String(conflict.severity || "").toUpperCase() === "HIGH";
  });
  if (hasBlockingField || hasUnresolvedHighConflict) return identityResolution;

  const nextStatus = identityStatuses.RESOLVED;
  return {
    ...identityResolution,
    status: nextStatus,
    ambiguity_status: "RESOLVED",
    identity_state: updateIdentityState(identityResolution, { status: nextStatus })
  };
}

function focusedSerialVerificationFailed(trace = []) {
  return (Array.isArray(trace) ? trace : []).some((entry) => {
    return entry?.action === "CROP_AND_READ_SERIAL"
      && ["no_information", "error", "unavailable"].includes(entry?.status);
  });
}

function focusedSerialVerificationAttempted(trace = []) {
  return (Array.isArray(trace) ? trace : []).some((entry) => entry?.action === "CROP_AND_READ_SERIAL");
}

function focusedSerialVerificationConfirmed(trace = []) {
  return (Array.isArray(trace) ? trace : []).some((entry) => {
    const focused = entry?.output?.focused_vision || {};
    return entry?.action === "CROP_AND_READ_SERIAL"
      && entry?.status === "executed"
      && Array.isArray(focused.updated_fields)
      && focused.updated_fields.includes("serial_number")
      && !(Array.isArray(focused.conflicting_fields) && focused.conflicting_fields.includes("serial_number"));
  });
}

function serialHasStrongConfirmation(identityResolution = {}) {
  const serialState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "serial_number");
  const summaries = Array.isArray(serialState?.source_summary) ? serialState.source_summary : [];
  return summaries.some((summary) => {
    return [
      "SLAB_LABEL",
      "CARD_BACK_PRINTED_TEXT",
      "INTERNAL_APPROVED_HISTORY",
      "OFFICIAL_CHECKLIST",
      "STRUCTURED_DATABASE"
    ].includes(summary.source);
  });
}

function applyHighRiskVerificationGuard(identityResolution = {}, {
  identity = {},
  trace = []
} = {}) {
  if (!hasValue(identity.serial_number, "serial_number")) return identityResolution;
  const failedFocusedSerial = focusedSerialVerificationFailed(trace);
  const attemptedFocusedSerial = focusedSerialVerificationAttempted(trace);
  const confirmedFocusedSerial = focusedSerialVerificationConfirmed(trace);
  const lacksStrongSerialConfirmation = attemptedFocusedSerial
    && !confirmedFocusedSerial
    && !serialHasStrongConfirmation(identityResolution);
  if (!failedFocusedSerial && !lacksStrongSerialConfirmation) return identityResolution;

  const conflict = {
    field: "serial_number",
    conflict_type: failedFocusedSerial
      ? "SERIAL_FOCUSED_VERIFICATION_FAILED"
      : "SERIAL_REQUIRES_STRONG_CONFIRMATION",
    conflicting_values: [identity.serial_number],
    severity: "HIGH",
    reason: failedFocusedSerial
      ? "serial_number was present, but focused serial reread could not verify it"
      : "serial_number has only single front-image confirmation after focused reread",
    resolved: false
  };
  const guardTrace = {
    field: "serial_number",
    step: "high_risk_verification_guard",
    input: {
      serial_number: identity.serial_number,
      focused_action: "CROP_AND_READ_SERIAL"
    },
    output: {
      status: identityStatuses.ABSTAIN,
      route: "MANUAL_REQUIRED"
    },
    decision: failedFocusedSerial
      ? "serial_number_requires_operator_review_after_failed_focused_reread"
      : "serial_number_requires_operator_review_without_strong_confirmation",
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    status: identityStatuses.ABSTAIN,
    ambiguity_status: "AMBIGUOUS",
    conflict_map: [...(identityResolution.conflict_map || []), conflict],
    global_conflicts: [...(identityResolution.global_conflicts || []), conflict],
    resolution_trace: [...(identityResolution.resolution_trace || []), guardTrace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (fieldState.field !== "serial_number") return fieldState;
      return {
        ...fieldState,
        decision_route: "ABSTAIN",
        ambiguity: true,
        conflicts: true,
        resolution_reason: guardTrace.decision,
        conflict_items: [...(fieldState.conflict_items || []), conflict]
      };
    }),
    identity_state: identityResolution.identity_state
      ? {
          ...identityResolution.identity_state,
          status: identityStatuses.ABSTAIN,
          conflict_graph: identityResolution.identity_state.conflict_graph || []
        }
      : identityResolution.identity_state
  };
}

function identityResolutionGateInput(result = {}, {
  providerId = result.provider || result.source || "",
  retrievalCandidates = [],
  registryRecords = [],
  productSchemas = []
} = {}) {
  const evidenceDocument = {
    evidence: result.evidence || {},
    resolved: result.resolved || {},
    unresolved: result.unresolved || []
  };
  const evidenceItems = evidenceDocumentToIdentityEvidenceItems(evidenceDocument, { providerId });
  const criticalFields = criticalFieldsForIdentityResolution(evidenceDocument.resolved, evidenceItems);

  return {
    evidenceDocument,
    evidenceItems,
    criticalFields,
    resolvedHint: evidenceDocument.resolved,
    retrievalCandidates,
    registryRecords,
    productSchemas,
    options: {
      includeResolvedHint: evidenceItems.length === 0,
      criticalFields
    }
  };
}

function finishIdentityResolutionGate(result = {}, {
  maxLength = 80,
  evidenceDocument = {},
  criticalFields = [],
  identityResolution = {}
} = {}) {
  const optionalCodeGuardedIdentityResolution = applyWeakOcrOnlyOptionalCodeDrop(identityResolution);
  const weakVisualGuardedIdentityResolution = applyWeakVisualParallelDrop(optionalCodeGuardedIdentityResolution);
  const confidenceGuardedIdentityResolution = applyCriticalFieldConfidenceGuard(weakVisualGuardedIdentityResolution, criticalFields);
  const descriptorGuardedIdentityResolution = applyOptionalColorDescriptorDrop(confidenceGuardedIdentityResolution);
  const productFallbackIdentityResolution = applySetAsProductFallback(descriptorGuardedIdentityResolution);
  const optionalDropReleasedIdentityResolution = releaseResolvedOptionalDropAbstain(productFallbackIdentityResolution, criticalFields);
  const identity = optionalDropReleasedIdentityResolution.identity;
  const highRiskGuardedIdentityResolution = applyHighRiskVerificationGuard(optionalDropReleasedIdentityResolution, {
    identity,
    trace: result.resolution_trace || []
  });
  const lotGuard = multiCardLotGuardInfo({
    identity,
    resolved: evidenceDocument.resolved,
    fields: result.fields || {},
    unresolved: evidenceDocument.unresolved || [],
    reason: result.reason
  });
  const lotGuardedIdentityResolution = applyMultiCardLotGuard(highRiskGuardedIdentityResolution, lotGuard);
  const primaryFastReleasedIdentityResolution = releasePrimaryFastVisionAbstain(lotGuardedIdentityResolution, {
    result,
    criticalFields
  });
  const gatedIdentityResolution = releaseEvidenceBackedAbstain(primaryFastReleasedIdentityResolution, {
    result,
    criticalFields
  });
  const convergenceReport = gatedIdentityResolution.convergence_report || result.convergence_report || null;
  const finalIdentity = gatedIdentityResolution.identity || identity;
  const presentation = renderListingPresentation({
    resolved: finalIdentity,
    evidence: result.evidence || {},
    maxLength
  });
  const titlePolicy = presentation.title_length_policy || {};
  const blockedRequiredTitleTerms = Array.isArray(titlePolicy.blocked_required_terms)
    ? titlePolicy.blocked_required_terms
    : [];
  const titleLanguageBlocked = blockedRequiredTitleTerms.length > 0
    || containsNonEnglishTitleScript(presentation.final_title);
  const secondaryReviewItems = policyRequiredReviewItems({
    result,
    identity: finalIdentity
  });
  const reviewItems = writerReviewItems(gatedIdentityResolution, criticalFields, [
    ...secondaryReviewItems,
    ...exactTaxonomyReviewItems(gatedIdentityResolution),
    ...yearAutoPublishReviewItems(gatedIdentityResolution)
  ]);
  const canRenderFinalTitle = gatedIdentityResolution.status !== identityStatuses.ABSTAIN
    && Boolean(presentation.final_title)
    && !titleLanguageBlocked
    && reviewItems.length === 0;
  const blockedWriterFields = reviewItems.map((item) => item.field);
  const writerDraft = writerDraftPresentation({
    identityResolution: gatedIdentityResolution,
    evidence: result.evidence || {},
    maxLength,
    titleLanguageBlocked,
    lotDetected: lotGuard.detected,
    blockedFields: blockedWriterFields
  });
  const canRenderWriterDraft = !canRenderFinalTitle && writerDraft.can_render === true;
  const activePresentation = canRenderFinalTitle
    ? presentation
    : canRenderWriterDraft
      ? writerDraft.presentation
      : null;
  const activeIdentity = canRenderFinalTitle ? finalIdentity : writerDraft.identity || {};
  const publicationGate = buildPublicationGate({
    autoPublishAllowed: false,
    modelPublishRecommended: canRenderFinalTitle,
    writerDraft,
    reviewItems,
    identityResolution: gatedIdentityResolution,
    activeIdentity,
    titleLanguageBlocked,
    lotDetected: lotGuard.detected
  });
  const unresolved = unique([
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    ...unresolvedFromIdentityResolution(gatedIdentityResolution, criticalFields),
    ...(titleLanguageBlocked ? ["title blocked: required identity text is not English"] : []),
    ...(lotGuard.detected ? ["multi-card lot requires single-card split or manual lot workflow"] : []),
    ...(!canRenderFinalTitle
      ? [canRenderWriterDraft ? "identity resolution requires writer review before upload" : "identity resolution abstain"]
      : [])
  ]).slice(0, 16);
  const finalTitle = activePresentation?.final_title || "";
  const titleRenderSource = canRenderFinalTitle
    ? "identity_resolution_deterministic_renderer"
    : canRenderWriterDraft
      ? "identity_resolution_partial_writer_draft"
      : "identity_resolution_abstain";

  return {
    ...result,
    title: finalTitle,
    final_title: finalTitle,
    rendered_title: activePresentation?.rendered_title || presentation.rendered_title || "",
    title_render_source: titleRenderSource,
    publication_gate: publicationGate,
    field_level_publication: publicationGate.field_level_publication,
    writer_review_ready: publicationGate.writer_review_ready,
    partial_writer_draft: publicationGate.partial_writer_draft,
    writer_required_fields: publicationGate.writer_required_fields,
    confidence: canRenderFinalTitle ? confidenceForIdentityStatus(gatedIdentityResolution.status, {
      existingConfidence: result.confidence,
      reason: result.reason,
      unresolved
    }) : "LOW",
    reason: mergeReason(resolutionReason(gatedIdentityResolution), result.reason),
    fields: publicLegacyFields(activeIdentity, canRenderFinalTitle ? result.fields || {} : {}),
    resolved: activeIdentity,
    route: lotGuard.detected ? "NON_STANDARD_MANUAL" : canRenderWriterDraft ? "WRITER_REVIEW_REQUIRED" : result.route,
    route_reason: lotGuard.detected
      ? "Multiple cards or lot image cannot be published as one resolved card identity."
      : canRenderWriterDraft
        ? "Partial identity draft is ready; unresolved fields require writer review before upload."
        : result.route_reason,
    identity_resolution_status: gatedIdentityResolution.status,
    ambiguity_status: gatedIdentityResolution.ambiguity_status,
    abstain_reason_codes: gatedIdentityResolution.abstain_reason_codes || [],
    catalog_card_identity: gatedIdentityResolution.catalog_card_identity || {},
    physical_asset_identity: gatedIdentityResolution.physical_asset_identity || {},
    open_world_identity: gatedIdentityResolution.open_world_identity || {},
    identity_resolution: {
      ...gatedIdentityResolution,
      convergence_report: convergenceReport
    },
    convergence_report: convergenceReport,
    field_states: gatedIdentityResolution.field_states,
    conflict_graph: gatedIdentityResolution.conflict_graph,
    conflict_map: gatedIdentityResolution.conflict_map,
    confidence_report: gatedIdentityResolution.confidence_report,
    canonical_evidence: gatedIdentityResolution.canonical_evidence,
    constraint_score_report: gatedIdentityResolution.constraint_score_report,
    unresolved,
    modules: activePresentation?.modules || result.modules,
    module_order: activePresentation?.module_order || result.module_order,
    renderer: activePresentation?.renderer || result.renderer,
    renderer_version: activePresentation?.renderer_version || result.renderer_version,
    title_length_policy: activePresentation?.title_length_policy || presentation.title_length_policy || result.title_length_policy,
    resolution_trace: [
      ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : []),
      ...(Array.isArray(gatedIdentityResolution.resolution_trace) ? gatedIdentityResolution.resolution_trace : [])
    ]
  };
}

export function applyIdentityResolutionGate(result = {}, {
  maxLength = 80,
  providerId = result.provider || result.source || "",
  retrievalCandidates = [],
  registryRecords = [],
  productSchemas = []
} = {}) {
  const input = identityResolutionGateInput(result, {
    providerId,
    retrievalCandidates,
    registryRecords,
    productSchemas
  });
  const identityResolution = resolveIdentity({
    evidenceItems: input.evidenceItems,
    resolvedHint: input.resolvedHint,
    retrievalCandidates: input.retrievalCandidates,
    registryRecords: input.registryRecords,
    productSchemas: input.productSchemas,
    options: input.options
  });

  return finishIdentityResolutionGate(result, {
    maxLength,
    evidenceDocument: input.evidenceDocument,
    criticalFields: input.criticalFields,
    identityResolution
  });
}

export async function applyIdentityResolutionGateWithConvergence(result = {}, {
  maxLength = 80,
  providerId = result.provider || result.source || "",
  retrievalCandidates = [],
  registryRecords = [],
  productSchemas = [],
  retrieveEvidence = null,
  convergenceOptions = {}
} = {}) {
  const input = identityResolutionGateInput(result, {
    providerId,
    retrievalCandidates,
    registryRecords,
    productSchemas
  });
  const identityResolution = await resolveIdentityWithConvergence({
    evidenceItems: input.evidenceItems,
    resolvedHint: input.resolvedHint,
    retrievalCandidates: input.retrievalCandidates,
    registryRecords: input.registryRecords,
    productSchemas: input.productSchemas,
    retrieveEvidence,
    options: {
      ...input.options,
      convergence: convergenceOptions
    }
  });

  return finishIdentityResolutionGate(result, {
    maxLength,
    evidenceDocument: input.evidenceDocument,
    criticalFields: input.criticalFields,
    identityResolution
  });
}
