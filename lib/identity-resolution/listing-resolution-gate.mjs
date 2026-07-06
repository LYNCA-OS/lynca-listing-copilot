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
  "card_name",
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
  LOW_TOUCH_REVIEW: "LOW_TOUCH_REVIEW",
  STANDARD_REVIEW: "STANDARD_REVIEW",
  DEEP_REVIEW: "DEEP_REVIEW",
  RESCAN_REQUIRED: "RESCAN_REQUIRED"
});

const legacyPublicationStatuses = Object.freeze({
  WRITER_QUICK_APPROVAL_READY: "WRITER_QUICK_APPROVAL_READY",
  WRITER_REVIEW_READY: "WRITER_REVIEW_READY",
  MANUAL_REQUIRED: "MANUAL_REQUIRED"
});

const fieldPublishabilityStatuses = Object.freeze({
  PUBLISHABLE_EXACT: "PUBLISHABLE_EXACT",
  PUBLISHABLE_NARROW: "PUBLISHABLE_NARROW",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  BLOCKING: "BLOCKING",
  NOT_APPLICABLE: "NOT_APPLICABLE"
});

const identityGateStatuses = Object.freeze({
  CORE_RESOLVED: "CORE_RESOLVED",
  PARTIALLY_RESOLVED: "PARTIALLY_RESOLVED",
  UNRESOLVED: "UNRESOLVED"
});

const draftSystemStatuses = Object.freeze({
  SYSTEM_CONFIRMED: "SYSTEM_CONFIRMED",
  SYSTEM_PLAUSIBLE: "SYSTEM_PLAUSIBLE",
  MULTIPLE_CANDIDATES: "MULTIPLE_CANDIDATES",
  MISSING: "MISSING",
  WRITER_CONFIRMED: "WRITER_CONFIRMED",
  WRITER_CORRECTED: "WRITER_CORRECTED"
});

const draftDisplayPolicies = Object.freeze({
  INCLUDE_NORMAL: "INCLUDE_NORMAL",
  INCLUDE_HIGHLIGHTED: "INCLUDE_HIGHLIGHTED",
  SUGGEST_ONLY: "SUGGEST_ONLY",
  OMIT: "OMIT"
});

const draftEvidenceLevels = Object.freeze({
  A_DIRECT: "A_DIRECT",
  B_CORROBORATED: "B_CORROBORATED",
  C_PLAUSIBLE: "C_PLAUSIBLE",
  D_CONFLICT_OR_GUESS: "D_CONFLICT_OR_GUESS"
});

const accuracyGovernorActions = Object.freeze({
  KEEP: "KEEP",
  OMIT_UNSAFE_EXACT_FIELD: "OMIT_UNSAFE_EXACT_FIELD",
  KEEP_NARROW_SAFE_VALUE: "KEEP_NARROW_SAFE_VALUE"
});

const reviewPriorities = Object.freeze({
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  NORMAL: "NORMAL"
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

function normalizedTextArray(value) {
  return Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [normalizeText(value)].filter(Boolean);
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

function subjectContainsAll(container = [], required = []) {
  const haystack = normalizedTextArray(container).map(canonicalText).filter(Boolean);
  const needles = normalizedTextArray(required).map(canonicalText).filter(Boolean);
  if (!haystack.length || !needles.length) return false;
  return needles.every((needle) => haystack.some((value) => value === needle || value.includes(needle) || needle.includes(value)));
}

function mergeSubjectValues(...groups) {
  const merged = [];
  groups.flatMap(normalizedTextArray).forEach((name) => {
    if (!name) return;
    if (merged.some((existing) => subjectContainsAll([existing], [name]) || subjectContainsAll([name], [existing]))) return;
    merged.push(name);
  });
  return merged;
}

function descriptorColorTokens(value) {
  const tokens = new Set(canonicalText(Array.isArray(value) ? value.join(" ") : value).split(" ").filter(Boolean));
  return colorTokens.filter((token) => tokens.has(token));
}

function sourceTypeForIdentity(source = {}, providerId = "") {
  const type = source.source_type || source.source || "";
  if (type === "VISION_MODEL") {
    return "PRIMARY_FAST_VISION";
  }
  if (type === "VISUAL_VECTOR") {
    const similarity = Number(source.visual_similarity);
    const margin = Number(source.visual_margin_to_next);
    return Number.isFinite(similarity)
      && Number.isFinite(margin)
      && similarity >= 0.985
      && margin >= 0.12
      ? "STRUCTURED_DATABASE"
      : "VISUAL_GUESS";
  }
  return type || "VISUAL_GUESS";
}

function evidenceCandidates(field = {}) {
  if (Array.isArray(field.candidates) && field.candidates.length) {
    return field.candidates.filter((candidate) => hasValue(candidate?.value));
  }
  return hasValue(field.value) ? [{ value: field.value, confidence: field.confidence }] : [];
}

function evidenceCandidateMatchesFieldValue(field = {}, candidate = {}) {
  if (!hasValue(field.value) || !hasValue(candidate?.value)) return false;
  const fieldValues = normalizedTextArray(field.value).map(canonicalText).filter(Boolean);
  const candidateValues = normalizedTextArray(candidate.value).map(canonicalText).filter(Boolean);
  if (!fieldValues.length || !candidateValues.length) return false;
  if (fieldValues.length !== candidateValues.length) return false;
  return candidateValues.every((value) => fieldValues.includes(value));
}

function sourceSupportsCandidateValue(source = {}, candidate = {}) {
  if (!hasValue(candidate?.value)) return false;
  const values = normalizedTextArray(candidate.value).map(canonicalText).filter(Boolean);
  if (!values.length) return false;
  const sourceText = canonicalText([
    source.observed_text,
    source.raw_text,
    source.title,
    source.evidence_excerpt
  ].filter(Boolean).join(" "));
  if (!sourceText) return false;
  return values.every((value) => sourceText.includes(value));
}

function evidenceSources(field = {}, candidate = {}) {
  if (Array.isArray(candidate.sources) && candidate.sources.length) return candidate.sources;
  if (!Array.isArray(field.sources) || !field.sources.length) return [{}];
  const candidates = Array.isArray(field.candidates)
    ? field.candidates.filter((item) => hasValue(item?.value))
    : [];
  if (candidates.length <= 1) return field.sources;
  const matchingSources = field.sources.filter((source) => sourceSupportsCandidateValue(source, candidate));
  if (matchingSources.length) return matchingSources;
  if (evidenceCandidateMatchesFieldValue(field, candidate)) {
    const claimedByOtherCandidate = field.sources.filter((source) => {
      return candidates.some((item) => item !== candidate && sourceSupportsCandidateValue(source, item));
    });
    return field.sources.filter((source) => !claimedByOtherCandidate.includes(source));
  }
  return [{}];
}

function sourceMetadata(source = {}) {
  return {
    original_source: source.original_source_type || source.source_type || source.source || null,
    side: source.side || null,
    capture_role: source.capture_role || null,
    region: source.region || null,
    observed_text: source.observed_text || null,
    evidence_kind: source.evidence_kind || null,
    direct_observation: source.direct_observation === true,
    visible_marker: source.visible_marker === true,
    signature_visible: source.signature_visible === true,
    text_visible: source.text_visible === true,
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
  "OCR_ONLY",
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
  if (yearAutoPublishEvidenceSources.some((source) => sources.has(source))) return true;
  const independentGroundedSources = [
    "CARD_BACK_PRINTED_TEXT",
    "CARD_FRONT_PRINTED_TEXT",
    "SLAB_LABEL",
    "OFFICIAL_CHECKLIST",
    "STRUCTURED_DATABASE",
    "INTERNAL_APPROVED_HISTORY",
    "OCR_ONLY"
  ];
  return independentGroundedSources.filter((source) => sources.has(source)).length >= 2;
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

function fieldEvidenceItems(fieldState = {}) {
  return (Array.isArray(fieldState.candidates) ? fieldState.candidates : [])
    .flatMap((candidate) => Array.isArray(candidate.evidence_items) ? candidate.evidence_items : []);
}

function directAttributeSupport(fieldState = {}, field = "") {
  const sources = new Set(candidateSources(fieldState));
  const groundedSources = [
    "SLAB_LABEL",
    "CARD_BACK_PRINTED_TEXT",
    "CARD_FRONT_PRINTED_TEXT",
    "OCR_ONLY",
    "INTERNAL_APPROVED_HISTORY",
    "OFFICIAL_CHECKLIST",
    "STRUCTURED_DATABASE"
  ];
  if (groundedSources.some((source) => sources.has(source))) return true;

  const items = fieldEvidenceItems(fieldState);
  return items.some((item) => {
    const metadata = item.metadata || {};
    const kind = canonicalText(metadata.evidence_kind || "");
    const text = canonicalText(metadata.observed_text || "");
    if (field === "rc") {
      return metadata.visible_marker === true
        || (metadata.direct_observation === true && /\b(?:rc|rookie|rookie ticket|rated rookie|rookie card)\b/i.test(`${kind} ${text}`));
    }
    if (field === "auto") {
      return metadata.signature_visible === true
        || metadata.text_visible === true
        || (metadata.direct_observation === true && /\b(?:auto|autograph|autographed|signature|signed)\b/i.test(`${kind} ${text}`));
    }
    return false;
  });
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

function fieldHasBlockingConflict(fieldState = {}) {
  return (fieldState.conflict_items || []).some((conflict) => {
    return conflict?.resolved !== true && String(conflict?.severity || "").toUpperCase() === "HIGH";
  });
}

function fieldPublishability(fieldState = {}, {
  criticalFields = []
} = {}) {
  const field = fieldState.field;
  const critical = new Set(criticalFields);
  const resolved = hasValue(fieldState.resolved_value, field);
  const hasReviewableValue = hasValue(reviewableFieldValue(fieldState), field);

  if (fieldState.decision_route === "DROP") return fieldPublishabilityStatuses.NOT_APPLICABLE;
  if (!resolved && !hasReviewableValue) {
    return critical.has(field)
      ? fieldPublishabilityStatuses.BLOCKING
      : fieldPublishabilityStatuses.NOT_APPLICABLE;
  }
  if (fieldHasBlockingConflict(fieldState)) return fieldPublishabilityStatuses.BLOCKING;
  if (fieldState.decision_route === "ABSTAIN" || fieldState.ambiguity === true || fieldStateHasUnresolvedConflict(fieldState)) {
    return critical.has(field)
      ? fieldPublishabilityStatuses.BLOCKING
      : fieldPublishabilityStatuses.REVIEW_REQUIRED;
  }
  if (field === "year" && !yearHasAutoPublishSupport(fieldState)) {
    return fieldPublishabilityStatuses.REVIEW_REQUIRED;
  }
  if (["grade_company", "card_grade", "auto_grade", "grade_type"].includes(field)
    && !fieldHasAnySource(fieldState, ["SLAB_LABEL"])) {
    return fieldPublishabilityStatuses.REVIEW_REQUIRED;
  }
  if ((field === "rc" || field === "auto") && !directAttributeSupport(fieldState, field)) {
    return fieldPublishabilityStatuses.REVIEW_REQUIRED;
  }
  if (catalogOrStrongTextExactField(field) && !fieldHasStrongExactEvidence(fieldState)) {
    return fieldPublishabilityStatuses.REVIEW_REQUIRED;
  }
  if (fieldHasCatalogCorroboration(fieldState) || fieldHasStrongExactEvidence(fieldState)) {
    return fieldPublishabilityStatuses.PUBLISHABLE_EXACT;
  }
  if (fieldHasDirectEvidence(fieldState)) return fieldPublishabilityStatuses.PUBLISHABLE_NARROW;
  return fieldPublishabilityStatuses.PUBLISHABLE_NARROW;
}

function fieldPublishabilityMap(identityResolution = {}, {
  criticalFields = [],
  reviewItems = []
} = {}) {
  const states = Object.fromEntries((identityResolution.field_states || []).map((fieldState) => [
    fieldState.field,
    fieldPublishability(fieldState, { criticalFields })
  ]));
  (reviewItems || []).forEach((item) => {
    if (!item?.field) return;
    states[item.field] = item.publishability || item.publication_state || states[item.field] || fieldPublishabilityStatuses.REVIEW_REQUIRED;
  });
  return states;
}

function titleCaseToken(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return "";
  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function candidateValues(fieldState = {}) {
  return unique((Array.isArray(fieldState.candidates) ? fieldState.candidates : [])
    .map((candidate) => candidate?.value)
    .filter((value) => hasValue(value, fieldState.field))
    .map((value) => String(value)));
}

function serialDenominator(value) {
  const match = normalizeText(value).match(/^(?:#?\d+|\?)\s*\/\s*(\d+)$/);
  return match?.[1] || null;
}

function ambiguousSerialPlaceholder(fieldState = {}) {
  const values = candidateValues(fieldState);
  if (!values.length && hasValue(fieldState.resolved_value, "serial_number")) values.push(String(fieldState.resolved_value));
  const denominators = unique(values.map(serialDenominator));
  if (denominators.length !== 1) return null;
  return `/${denominators[0]}`;
}

function narrowParallelValue(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/\b(?:Variation|Image\s+Variation|Photo\s+Variation|Horizontal|Vertical|International)\b/i.test(text)) {
    return text;
  }
  const color = descriptorColorTokens(text)[0];
  if (!color) return null;
  return titleCaseToken(color);
}

function fieldHasManualEvidence(fieldState = {}) {
  return fieldHasAnySource(fieldState, ["OPERATOR"]);
}

function independentNonWeakSourceCount(fieldState = {}) {
  const weak = new Set(["MARKETPLACE", "VISUAL_GUESS", "MODEL_INFERENCE", "PRIMARY_FAST_VISION"]);
  return new Set(candidateSources(fieldState).filter((source) => source && !weak.has(source))).size;
}

function fieldMarketplaceOnly(fieldState = {}) {
  const sources = candidateSources(fieldState);
  return sources.length > 0 && sources.every((source) => source === "MARKETPLACE");
}

function strictAccuracyGovernorEnabled() {
  const raw = process.env.ENABLE_STRICT_ACCURACY_GOVERNOR;
  if (raw === undefined || raw === null || raw === "") return true;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

function draftEvidenceLevel(fieldState = {}, publishability) {
  if (!hasValue(reviewableFieldValue(fieldState), fieldState.field)) return draftEvidenceLevels.D_CONFLICT_OR_GUESS;
  if (fieldMarketplaceOnly(fieldState)) return draftEvidenceLevels.D_CONFLICT_OR_GUESS;
  if (fieldHasBlockingConflict(fieldState) || fieldState.ambiguity === true || fieldStateHasUnresolvedConflict(fieldState)) {
    return draftEvidenceLevels.D_CONFLICT_OR_GUESS;
  }
  if (fieldHasManualEvidence(fieldState) || fieldHasStrongExactEvidence(fieldState)) return draftEvidenceLevels.A_DIRECT;
  if (fieldHasCatalogCorroboration(fieldState) || independentNonWeakSourceCount(fieldState) >= 2) return draftEvidenceLevels.B_CORROBORATED;
  if ([fieldPublishabilityStatuses.PUBLISHABLE_EXACT, fieldPublishabilityStatuses.PUBLISHABLE_NARROW].includes(publishability)) {
    return fieldHasDirectEvidence(fieldState) ? draftEvidenceLevels.B_CORROBORATED : draftEvidenceLevels.C_PLAUSIBLE;
  }
  return draftEvidenceLevels.C_PLAUSIBLE;
}

function highRiskExactField(field) {
  return [
    "year",
    "serial_number",
    "numerical_rarity",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type",
    "parallel_exact",
    "parallel",
    "variation",
    "rc",
    "auto",
    "ssp",
    "case_hit",
    "one_of_one"
  ].includes(field);
}

function safeSerialPlaceholder(value) {
  return /^#?\s*\/\s*\d{1,5}$/i.test(normalizeText(value));
}

function selectedValueIsNarrowColor(field, value) {
  if (!["parallel_exact", "parallel", "variation"].includes(field)) return false;
  const selected = normalizeText(value);
  if (!selected) return false;
  return canonicalText(narrowParallelValue(selected)) === canonicalText(selected);
}

function fieldHasAuthoritativeOrManualSupport(fieldState = {}) {
  return fieldHasManualEvidence(fieldState)
    || fieldHasStrongExactEvidence(fieldState)
    || fieldHasCatalogCorroboration(fieldState);
}

function accuracyGovernorDecision({
  fieldState = {},
  selectedValue = null,
  displayPolicy,
  publishability,
  systemStatus,
  evidenceLevel
} = {}) {
  if (!strictAccuracyGovernorEnabled()) {
    return {
      action: accuracyGovernorActions.KEEP,
      display_policy: displayPolicy,
      reason: "strict_accuracy_governor_disabled"
    };
  }
  const field = fieldState.field;
  if (!hasValue(selectedValue, field)) {
    return {
      action: accuracyGovernorActions.KEEP,
      display_policy: displayPolicy,
      reason: "no_selected_value"
    };
  }
  if (![draftDisplayPolicies.INCLUDE_NORMAL, draftDisplayPolicies.INCLUDE_HIGHLIGHTED].includes(displayPolicy)) {
    return {
      action: accuracyGovernorActions.KEEP,
      display_policy: displayPolicy,
      reason: "already_not_in_title"
    };
  }
  if (field === "serial_number" && safeSerialPlaceholder(selectedValue)) {
    return {
      action: accuracyGovernorActions.KEEP_NARROW_SAFE_VALUE,
      display_policy: displayPolicy,
      reason: "serial_denominator_placeholder_is_safe_narrow_value"
    };
  }
  if (selectedValueIsNarrowColor(field, selectedValue)) {
    return {
      action: accuracyGovernorActions.KEEP_NARROW_SAFE_VALUE,
      display_policy: displayPolicy,
      reason: "parallel_narrow_color_is_safe_when_exact_taxonomy_is_unproven"
    };
  }
  if (field === "year"
    && publishability === fieldPublishabilityStatuses.REVIEW_REQUIRED) {
    return {
      action: accuracyGovernorActions.KEEP,
      display_policy: displayPolicy,
      reason: "year_kept_in_writer_draft_but_requires_review"
    };
  }
  if (["grade_company", "card_grade", "auto_grade", "grade_type"].includes(field)
    && publishability === fieldPublishabilityStatuses.REVIEW_REQUIRED
    && fieldHasDirectEvidence(fieldState)
    && !fieldStateHasUnresolvedConflict(fieldState)) {
    return {
      action: accuracyGovernorActions.KEEP,
      display_policy: draftDisplayPolicies.INCLUDE_HIGHLIGHTED,
      reason: "grade_kept_in_writer_draft_but_requires_slab_or_writer_confirmation"
    };
  }
  if (!highRiskExactField(field)) {
    return {
      action: accuracyGovernorActions.KEEP,
      display_policy: displayPolicy,
      reason: "field_not_high_risk_exact"
    };
  }
  const unsafePublishability = [
    fieldPublishabilityStatuses.REVIEW_REQUIRED,
    fieldPublishabilityStatuses.BLOCKING
  ].includes(publishability);
  const unsafeEvidence = evidenceLevel === draftEvidenceLevels.C_PLAUSIBLE
    || evidenceLevel === draftEvidenceLevels.D_CONFLICT_OR_GUESS
    || systemStatus === draftSystemStatuses.MULTIPLE_CANDIDATES;
  if ((unsafePublishability || unsafeEvidence) && !fieldHasAuthoritativeOrManualSupport(fieldState)) {
    return {
      action: accuracyGovernorActions.OMIT_UNSAFE_EXACT_FIELD,
      display_policy: draftDisplayPolicies.SUGGEST_ONLY,
      reason: unsafePublishability
        ? "high_risk_exact_field_requires_authoritative_support"
        : "high_risk_exact_field_has_plausible_or_conflicting_evidence"
    };
  }
  return {
    action: accuracyGovernorActions.KEEP,
    display_policy: displayPolicy,
    reason: "field_evidence_satisfies_accuracy_governor"
  };
}

function reviewPriorityForField(field, criticalFields = []) {
  if (criticalFields.includes(field)) return reviewPriorities.CRITICAL;
  if ([
    "year",
    "players",
    "character",
    "product",
    "set",
    "card_name",
    "serial_number",
    "numerical_rarity",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type",
    "parallel_exact",
    "parallel",
    "variation",
    "rc",
    "auto",
    "multi_card",
    "card_count"
  ].includes(field)) return reviewPriorities.HIGH;
  return reviewPriorities.NORMAL;
}

function draftSelectedValue(fieldState = {}, publishability) {
  const field = fieldState.field;
  const value = reviewableFieldValue(fieldState);

  if (fieldState.decision_route === "DROP") {
    if (["parallel_exact", "parallel", "variation"].includes(field)) {
      return narrowParallelValue(value || candidateValues(fieldState)[0]) || null;
    }
    return null;
  }
  if (!hasValue(value, field)) return null;

  if (field === "serial_number"
    && [fieldPublishabilityStatuses.REVIEW_REQUIRED, fieldPublishabilityStatuses.BLOCKING].includes(publishability)) {
    return serialHasOnlyLowConfidenceReviewConflict(fieldState)
      ? lowConfidenceSerialDraftValue(fieldState) || value
      : ambiguousSerialPlaceholder(fieldState) || value;
  }

  if (["parallel_exact", "parallel", "variation"].includes(field)
    && !fieldHasStrongExactEvidence(fieldState)) {
    return narrowParallelValue(value) || value;
  }

  return value;
}

function tokenSet(value) {
  return new Set(canonicalText(value).split(" ").filter(Boolean));
}

function tokenSetSubset(left = new Set(), right = new Set()) {
  if (!left.size || !right.size) return false;
  return [...left].every((token) => right.has(token));
}

function productLikeConflictCanUseSelectedDraft(fieldState = {}, selectedValue = null) {
  if (!["brand", "product", "set"].includes(fieldState.field)) return false;
  if (!hasValue(selectedValue, fieldState.field)) return false;
  const selectedTokens = tokenSet(selectedValue);
  if (!selectedTokens.size) return false;
  const conflictValues = unique((fieldState.conflict_items || [])
    .filter((conflict) => conflict?.resolved !== true)
    .flatMap((conflict) => Array.isArray(conflict.conflicting_values) ? conflict.conflicting_values : [])
    .map(normalizeText)
    .filter(Boolean));
  if (conflictValues.length < 2) return false;
  return conflictValues.every((value) => tokenSetSubset(tokenSet(value), selectedTokens));
}

function directProductEvidenceCanUseSelectedDraft(fieldState = {}, selectedValue = null) {
  return fieldState.field === "product"
    && hasValue(selectedValue, "product")
    && fieldState.resolution_reason === "used_direct_product_evidence_for_writer_draft";
}

function serialHasOnlyLowConfidenceReviewConflict(fieldState = {}) {
  if (fieldState.field !== "serial_number") return false;
  const conflicts = (fieldState.conflict_items || []).filter((conflict) => conflict?.resolved !== true);
  if (!conflicts.length) return false;
  if (!conflicts.every((conflict) => conflict.conflict_type === "CRITICAL_FIELD_BELOW_PUBLISH_CONFIDENCE")) return false;
  return Boolean(lowConfidenceSerialDraftValue(fieldState));
}

function lowConfidenceSerialDraftValue(fieldState = {}) {
  const values = unique([
    reviewableFieldValue(fieldState),
    ...candidateValues(fieldState)
  ].map(normalizeText).filter(Boolean));
  const exactSerials = unique(values.filter((value) => {
    return !value.includes("#") && /^[A-Za-z0-9]+\s*\/\s*[A-Za-z0-9]+$/.test(value);
  }));
  if (exactSerials.length === 1) return exactSerials[0];
  if (values.length === 1 && !values[0].includes("#")) return values[0];
  return null;
}

function draftFieldPolicy(fieldState = {}, {
  criticalFields = [],
  reviewItemsByField = new Map(),
  publishabilityByField = {}
} = {}) {
  const field = fieldState.field;
  const publishability = publishabilityByField[field] || fieldPublishability(fieldState, { criticalFields });
  const reviewItem = reviewItemsByField.get(field);
  const candidates = Array.isArray(fieldState.candidates) ? fieldState.candidates.slice(0, 5) : [];
  const selectedValue = draftSelectedValue(fieldState, publishability);
  const hasSelected = hasValue(selectedValue, field);
  const evidenceLevel = draftEvidenceLevel(fieldState, publishability);
  const priority = reviewPriorityForField(field, criticalFields);
  const hasMultipleCandidates = candidates.filter((candidate) => hasValue(candidate?.value, field)).length > 1
    || fieldState.ambiguity === true
    || fieldStateHasUnresolvedConflict(fieldState);

  let systemStatus = draftSystemStatuses.SYSTEM_PLAUSIBLE;
  if (fieldHasManualEvidence(fieldState)) {
    systemStatus = draftSystemStatuses.WRITER_CONFIRMED;
  } else if (!hasSelected && !candidates.length) {
    systemStatus = draftSystemStatuses.MISSING;
  } else if (hasMultipleCandidates) {
    systemStatus = draftSystemStatuses.MULTIPLE_CANDIDATES;
  } else if ([draftEvidenceLevels.A_DIRECT, draftEvidenceLevels.B_CORROBORATED].includes(evidenceLevel)
    && ![fieldPublishabilityStatuses.REVIEW_REQUIRED, fieldPublishabilityStatuses.BLOCKING].includes(publishability)) {
    systemStatus = draftSystemStatuses.SYSTEM_CONFIRMED;
  }

  let displayPolicy = draftDisplayPolicies.INCLUDE_NORMAL;
  if (!hasSelected) {
    displayPolicy = candidates.length ? draftDisplayPolicies.SUGGEST_ONLY : draftDisplayPolicies.OMIT;
  } else if (fieldMarketplaceOnly(fieldState)) {
    displayPolicy = draftDisplayPolicies.SUGGEST_ONLY;
  } else if (field === "year"
    && publishability === fieldPublishabilityStatuses.REVIEW_REQUIRED
    && !fieldHasManualEvidence(fieldState)) {
    displayPolicy = draftDisplayPolicies.INCLUDE_HIGHLIGHTED;
  } else if (publishability === fieldPublishabilityStatuses.BLOCKING && field !== "serial_number") {
    displayPolicy = priority === reviewPriorities.CRITICAL
      && fieldHasBlockingConflict(fieldState)
      && !productLikeConflictCanUseSelectedDraft(fieldState, selectedValue)
      && !directProductEvidenceCanUseSelectedDraft(fieldState, selectedValue)
      ? draftDisplayPolicies.SUGGEST_ONLY
      : draftDisplayPolicies.INCLUDE_HIGHLIGHTED;
  } else if (publishability === fieldPublishabilityStatuses.REVIEW_REQUIRED
    || evidenceLevel === draftEvidenceLevels.C_PLAUSIBLE
    || systemStatus === draftSystemStatuses.MULTIPLE_CANDIDATES
    || reviewItem) {
    displayPolicy = draftDisplayPolicies.INCLUDE_HIGHLIGHTED;
  }

  const governor = accuracyGovernorDecision({
    fieldState,
    selectedValue,
    displayPolicy,
    publishability,
    systemStatus,
    evidenceLevel
  });
  displayPolicy = governor.display_policy;

  return {
    field,
    selected_value: hasSelected ? selectedValue : null,
    candidates,
    system_status: systemStatus,
    display_policy: displayPolicy,
    accuracy_governor_action: governor.action,
    accuracy_governor_reason: governor.reason,
    evidence_level: evidenceLevel,
    review_priority: priority,
    requires_writer_confirmation: displayPolicy !== draftDisplayPolicies.INCLUDE_NORMAL
      || [reviewPriorities.CRITICAL, reviewPriorities.HIGH].includes(priority)
        && systemStatus !== draftSystemStatuses.SYSTEM_CONFIRMED
        && systemStatus !== draftSystemStatuses.WRITER_CONFIRMED,
    publishability,
    publication_state: publishability,
    resolution_confidence: Number(fieldState.resolution_confidence || 0),
    resolution_reason: reviewItem?.resolution_reason || fieldState.resolution_reason || null,
    sources: fieldSources(fieldState),
    conflicts: Array.isArray(fieldState.conflict_items)
      ? fieldState.conflict_items.filter((conflict) => conflict?.resolved !== true)
      : []
  };
}

function buildDraftGate(identityResolution = {}, {
  criticalFields = [],
  reviewItems = [],
  publishabilityByField = {}
} = {}) {
  const reviewItemsByField = new Map((reviewItems || []).map((item) => [item.field, item]));
  const fields = (identityResolution.field_states || []).map((fieldState) => draftFieldPolicy(fieldState, {
    criticalFields,
    reviewItemsByField,
    publishabilityByField
  }));
  const byField = Object.fromEntries(fields.map((field) => [field.field, field]));
  const includedFields = fields.filter((field) => [
    draftDisplayPolicies.INCLUDE_NORMAL,
    draftDisplayPolicies.INCLUDE_HIGHLIGHTED
  ].includes(field.display_policy) && hasValue(field.selected_value, field.field));
  const highlightedFields = fields.filter((field) => field.display_policy === draftDisplayPolicies.INCLUDE_HIGHLIGHTED);
  const suggestedOnlyFields = fields.filter((field) => field.display_policy === draftDisplayPolicies.SUGGEST_ONLY);
  const missingFields = fields.filter((field) => field.system_status === draftSystemStatuses.MISSING);
  const criticalPendingFields = fields.filter((field) => {
    return field.requires_writer_confirmation === true
      && [reviewPriorities.CRITICAL, reviewPriorities.HIGH].includes(field.review_priority);
  });

  return {
    schema_version: "draft_gate_v1",
    fields,
    by_field: byField,
    included_fields: includedFields.map((field) => field.field),
    highlighted_fields: highlightedFields.map((field) => field.field),
    suggested_only_fields: suggestedOnlyFields.map((field) => field.field),
    missing_fields: missingFields.map((field) => field.field),
    critical_pending_fields: criticalPendingFields.map((field) => field.field),
    draft_field_coverage: fields.length ? includedFields.length / fields.length : 0,
    whole_card_blocked: includedFields.length === 0
  };
}

function governorRiskType(policy = {}) {
  if (policy.accuracy_governor_action === accuracyGovernorActions.OMIT_UNSAFE_EXACT_FIELD) {
    return "UNSAFE_EXACT_FIELD_OMITTED";
  }
  if (policy.publishability === fieldPublishabilityStatuses.BLOCKING) return "BLOCKING_FIELD";
  if (policy.system_status === draftSystemStatuses.MULTIPLE_CANDIDATES) return "MULTIPLE_CANDIDATES";
  if (policy.evidence_level === draftEvidenceLevels.D_CONFLICT_OR_GUESS) return "CONFLICT_OR_GUESS";
  if (policy.evidence_level === draftEvidenceLevels.C_PLAUSIBLE) return "PLAUSIBLE_ONLY";
  if (policy.publishability === fieldPublishabilityStatuses.REVIEW_REQUIRED) return "REVIEW_REQUIRED";
  return "";
}

function governorRootCause(policy = {}) {
  const reason = canonicalText(policy.resolution_reason || policy.accuracy_governor_reason || "");
  const sources = new Set(Array.isArray(policy.sources) ? policy.sources : []);
  if (policy.system_status === draftSystemStatuses.MISSING) return "EVIDENCE_MISSING";
  if (policy.system_status === draftSystemStatuses.MULTIPLE_CANDIDATES) return "SOLVER_LOW_MARGIN_OR_CONFLICT";
  if (sources.has("VISUAL_VECTOR") || sources.has("VECTOR_APPROVED_REFERENCE")) return "CANDIDATE_RETRIEVAL_NEEDS_VERIFICATION";
  if (sources.has("VISUAL_GUESS") || sources.has("PRIMARY_FAST_VISION") || sources.has("MODEL_INFERENCE")) return "SINGLE_MODEL_PERCEPTION_ONLY";
  if (/catalog|required|taxonomy|registry/.test(reason)) return "KNOWLEDGE_CORROBORATION_MISSING";
  if (/serial|focused|reread/.test(reason)) return "PERCEPTION_VERIFICATION_MISSING";
  if (/conflict|ambiguous|multiple/.test(reason)) return "EVIDENCE_CONFLICT";
  return "FIELD_REVIEW_REQUIRED";
}

function buildAccuracyGovernorReport(draftGate = {}, {
  criticalFields = []
} = {}) {
  const fields = Array.isArray(draftGate.fields) ? draftGate.fields : [];
  const critical = new Set(criticalFields);
  const riskFlags = fields
    .map((policy) => {
      const riskType = governorRiskType(policy);
      if (!riskType) return null;
      return {
        field: policy.field,
        risk_type: riskType,
        root_cause: governorRootCause(policy),
        selected_value: policy.selected_value ?? null,
        display_policy: policy.display_policy,
        publishability: policy.publishability || policy.publication_state,
        evidence_level: policy.evidence_level,
        review_priority: policy.review_priority,
        critical: critical.has(policy.field),
        reason: policy.accuracy_governor_reason || policy.resolution_reason || null
      };
    })
    .filter(Boolean);
  const omittedUnsafeFields = riskFlags
    .filter((flag) => flag.risk_type === "UNSAFE_EXACT_FIELD_OMITTED")
    .map((flag) => flag.field);
  const criticalRiskFlags = riskFlags.filter((flag) => flag.critical || flag.review_priority === reviewPriorities.CRITICAL);
  const includedCriticalFields = fields.filter((policy) => {
    return critical.has(policy.field)
      && [
        draftDisplayPolicies.INCLUDE_NORMAL,
        draftDisplayPolicies.INCLUDE_HIGHLIGHTED
      ].includes(policy.display_policy)
      && hasValue(policy.selected_value, policy.field);
  });
  const exactReady = criticalRiskFlags.length === 0
    && criticalFields.every((field) => includedCriticalFields.some((policy) => policy.field === field));

  return {
    schema_version: "accuracy_governor_v1",
    enabled: strictAccuracyGovernorEnabled(),
    target: "raise card-exact accuracy by preventing unproven high-risk exact facts from entering rendered titles",
    card_exact_ready: exactReady,
    high_risk_fields_omitted_from_title: omittedUnsafeFields,
    risk_flags: riskFlags,
    critical_risk_flags: criticalRiskFlags,
    root_cause_counts: riskFlags.reduce((counts, flag) => {
      counts[flag.root_cause] = (counts[flag.root_cause] || 0) + 1;
      return counts;
    }, {}),
    unflagged_critical_error_risk: criticalRiskFlags.length === 0
      ? "LOW_BY_POLICY_NOT_A_GROUND_TRUTH_CLAIM"
      : "MITIGATED_BY_REVIEW_FLAG"
  };
}

function containsYearLikeText(value) {
  const text = Array.isArray(value) ? value.join(" ") : String(value || "");
  return /\b(?:19|20)\d{2}(?:[-/]\d{2})?\b/.test(text)
    || /\b(?:19|20)\d{2}\s*\/\s*\d{2}\b/.test(text);
}

function publishabilityReviewItems(identityResolution = {}, criticalFields = []) {
  const critical = new Set(criticalFields);
  const yearState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "year");
  const yearPublishability = yearState ? fieldPublishability(yearState, { criticalFields }) : fieldPublishabilityStatuses.BLOCKING;
  const yearNeedsReview = [fieldPublishabilityStatuses.REVIEW_REQUIRED, fieldPublishabilityStatuses.BLOCKING].includes(yearPublishability);
  return (identityResolution.field_states || [])
    .map((fieldState) => {
      const value = reviewableFieldValue(fieldState);
      const yearLikeDescriptorRequiresReview = yearNeedsReview
        && ["product", "set", "subset", "insert"].includes(fieldState.field)
        && hasValue(value, fieldState.field)
        && containsYearLikeText(value);
      const publishability = yearLikeDescriptorRequiresReview
        ? fieldPublishabilityStatuses.REVIEW_REQUIRED
        : fieldPublishability(fieldState, { criticalFields });
      if (![fieldPublishabilityStatuses.REVIEW_REQUIRED, fieldPublishabilityStatuses.BLOCKING].includes(publishability)) return null;
      if (!critical.has(fieldState.field) && !hasValue(value, fieldState.field)) return null;
      return {
        field: fieldState.field,
        current_value: hasValue(value, fieldState.field) ? value : null,
        resolution_confidence: Number(fieldState.resolution_confidence || 0),
        resolution_reason: yearLikeDescriptorRequiresReview
          ? "year_like_descriptor_requires_year_review"
          : publishability === fieldPublishabilityStatuses.BLOCKING
            ? (fieldState.resolution_reason || "blocking_identity_field_requires_review")
            : (fieldState.resolution_reason || "field_requires_writer_review"),
        decision_route: publishability === fieldPublishabilityStatuses.BLOCKING ? "ABSTAIN" : (fieldState.decision_route || "USE"),
        candidates: Array.isArray(fieldState.candidates) ? fieldState.candidates.slice(0, 3) : [],
        conflicts: Array.isArray(fieldState.conflict_items)
          ? fieldState.conflict_items.filter((conflict) => conflict?.resolved !== true)
          : [],
        publishability,
        publication_state: publishability
      };
    })
    .filter(Boolean);
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
  const ocrConflictReviewItems = (Array.isArray(result.conflict_map) ? result.conflict_map : [])
    .filter((conflict) => {
      return conflict?.resolved !== true
        && String(conflict.conflict_type || "").toUpperCase() === "OCR_FIELD_CONFLICT"
        && hasValue(conflict.field, "field");
    })
    .map((conflict) => {
      const field = conflict.field;
      const currentValue = hasValue(identity[field], field)
        ? identity[field]
        : result.resolved?.[field] ?? result.resolved_fields?.[field] ?? null;
      return {
        field,
        current_value: hasValue(currentValue, field) ? currentValue : null,
        resolution_confidence: 0,
        resolution_reason: "ocr_conflict_requires_writer_review",
        decision_route: "ABSTAIN",
        candidates: [],
        conflicts: [conflict],
        publishability: fieldPublishabilityStatuses.REVIEW_REQUIRED,
        publication_state: fieldPublishabilityStatuses.REVIEW_REQUIRED
      };
    });
  const policy = result.fast_vision_policy || {};
  const requiredGroups = Array.isArray(policy.secondary_verification_required_fields)
    ? policy.secondary_verification_required_fields
    : [];
  if (!requiredGroups.length) return ocrConflictReviewItems;

  const policyReviewItems = requiredGroups.flatMap((fieldGroup) => {
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
        conflicts: [],
        publishability: fieldPublishabilityStatuses.REVIEW_REQUIRED,
        publication_state: fieldPublishabilityStatuses.REVIEW_REQUIRED
      }));
  });

  return [...ocrConflictReviewItems, ...policyReviewItems];
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
      publishability: fieldPublishabilityStatuses.REVIEW_REQUIRED,
      publication_state: fieldPublishabilityStatuses.REVIEW_REQUIRED
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
    publishability: fieldPublishabilityStatuses.REVIEW_REQUIRED,
    publication_state: fieldPublishabilityStatuses.REVIEW_REQUIRED
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
        : [],
      publishability: fieldPublishability(fieldState, { criticalFields }),
      publication_state: fieldPublishability(fieldState, { criticalFields })
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
  activeIdentity = {},
  criticalFields = []
} = {}) {
  const fieldStates = identityResolution.field_states || [];
  const publishabilityByField = fieldPublishabilityMap(identityResolution, {
    criticalFields,
    reviewItems
  });
  const reviewByField = new Map(reviewItems.map((item) => [item.field, item]));
  const publishableFields = {};

  Object.entries(activeIdentity || {}).forEach(([field, value]) => {
    if (!hasValue(value, field) || reviewByField.has(field)) return;
    const publishability = publishabilityByField[field] || fieldPublishabilityStatuses.PUBLISHABLE_NARROW;
    if (![fieldPublishabilityStatuses.PUBLISHABLE_EXACT, fieldPublishabilityStatuses.PUBLISHABLE_NARROW].includes(publishability)) return;
    publishableFields[field] = {
      value,
      publishability,
      publication_state: publishability,
      source: modelPublishRecommended ? "model_quick_approval_identity" : "partial_writer_draft"
    };
  });

  const reviewRequiredFields = reviewItems.map((item) => ({
    field: item.field,
    current_value: item.current_value ?? null,
    publishability: item.publishability || item.publication_state || publishabilityByField[item.field] || fieldPublishabilityStatuses.REVIEW_REQUIRED,
    publication_state: item.publication_state || item.publishability || publishabilityByField[item.field] || fieldPublishabilityStatuses.REVIEW_REQUIRED,
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
    field_publishability: publishabilityByField,
    publishable_fields: publishableFields,
    review_required_fields: reviewRequiredFields,
    usable_field_count: usableFieldCount,
    review_field_count: reviewFieldCount,
    has_partial_output: usableFieldCount > 0,
    writer_can_start: autoPublishAllowed || writerDraft.can_render === true
  };
}

function mergeDraftGateReviewItems(reviewItems = [], draftGate = null) {
  if (!draftGate?.by_field) return reviewItems;
  const byField = new Map((reviewItems || []).map((item) => [item.field, item]));
  Object.values(draftGate.by_field).forEach((policy) => {
    if (!policy?.field || byField.has(policy.field)) return;
    if (policy.requires_writer_confirmation !== true) return;
    if (![draftDisplayPolicies.INCLUDE_HIGHLIGHTED, draftDisplayPolicies.SUGGEST_ONLY].includes(policy.display_policy)) return;
    const publishabilityRequiresReview = [
      fieldPublishabilityStatuses.REVIEW_REQUIRED,
      fieldPublishabilityStatuses.BLOCKING
    ].includes(policy.publishability || policy.publication_state);
    const draftRequiresExplicitReview = publishabilityRequiresReview
      || policy.system_status === draftSystemStatuses.MULTIPLE_CANDIDATES
      || policy.display_policy === draftDisplayPolicies.SUGGEST_ONLY;
    if (!draftRequiresExplicitReview) return;
    if (!hasValue(policy.selected_value, policy.field) && !(Array.isArray(policy.candidates) && policy.candidates.length)) return;
    byField.set(policy.field, {
      field: policy.field,
      current_value: policy.selected_value ?? null,
      resolution_confidence: Number(policy.resolution_confidence || 0),
      resolution_reason: "draft_field_requires_writer_confirmation",
      decision_route: policy.system_status || "WRITER_REVIEW",
      candidates: Array.isArray(policy.candidates) ? policy.candidates.slice(0, 3) : [],
      conflicts: [],
      publishability: policy.publishability || policy.publication_state || fieldPublishabilityStatuses.REVIEW_REQUIRED,
      publication_state: policy.publication_state || policy.publishability || fieldPublishabilityStatuses.REVIEW_REQUIRED
    });
  });
  return [...byField.values()];
}

function identityForWriterDraft(identityResolution = {}, {
  draftGate = null
} = {}) {
  const selected = {};

  if (draftGate?.by_field) {
    Object.values(draftGate.by_field).forEach((policy) => {
      if (![
        draftDisplayPolicies.INCLUDE_NORMAL,
        draftDisplayPolicies.INCLUDE_HIGHLIGHTED
      ].includes(policy.display_policy)) return;
      if (!hasValue(policy.selected_value, policy.field)) return;
      selected[policy.field] = policy.selected_value;
    });

    return normalizeResolvedFields(selected);
  }

  (identityResolution.field_states || []).forEach((fieldState) => {
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

function fieldStatusForWriterDraft(fieldName, fieldStates = [], draftGate = null) {
  const policy = draftGate?.by_field?.[fieldName];
  if (policy) {
    if (policy.display_policy === draftDisplayPolicies.SUGGEST_ONLY) return "CONFLICT";
    if (policy.display_policy === draftDisplayPolicies.OMIT) return "MISSING";
    if (policy.requires_writer_confirmation) return "REVIEW";
    if (policy.system_status === draftSystemStatuses.WRITER_CONFIRMED) return "MANUAL_CONFIRMED";
    return "CONFIRMED";
  }

  const state = fieldStates.find((fieldState) => fieldState.field === fieldName);
  if (!state) return null;
  if (state.decision_route === "USE" && state.ambiguity !== true && !fieldStateHasUnresolvedConflict(state)) {
    return "CONFIRMED";
  }
  if (state.decision_route === "DROP") return "NOT_APPLICABLE";
  return "REVIEW";
}

function evidenceForWriterDraft(evidence = {}, fieldStates = [], draftGate = null) {
  const next = { ...(evidence || {}) };
  const fields = draftGate?.fields?.length
    ? draftGate.fields.map((policy) => ({ field: policy.field, policy }))
    : fieldStates.map((fieldState) => ({ field: fieldState.field, fieldState }));

  fields.forEach(({ field, policy }) => {
    const fieldState = fieldStates.find((item) => item.field === field);
    const status = fieldStatusForWriterDraft(field, fieldStates, draftGate);
    if (!status) return;
    next[field] = {
      ...(next[field] || {}),
      status,
      confidence: Number(policy?.resolution_confidence ?? fieldState?.resolution_confidence ?? next[field]?.confidence ?? 0),
      sources: next[field]?.sources || fieldState?.supporting_sources || []
    };
  });
  return next;
}

function presentationModulePolicies(module = {}, draftGate = null) {
  if (!draftGate?.by_field) return [];
  return (module.fields || [])
    .map((field) => draftGate.by_field[field])
    .filter(Boolean);
}

function strongestModuleDisplayPolicy(policies = []) {
  if (policies.some((policy) => policy.display_policy === draftDisplayPolicies.SUGGEST_ONLY)) return draftDisplayPolicies.SUGGEST_ONLY;
  if (policies.some((policy) => policy.display_policy === draftDisplayPolicies.INCLUDE_HIGHLIGHTED)) return draftDisplayPolicies.INCLUDE_HIGHLIGHTED;
  if (policies.some((policy) => policy.display_policy === draftDisplayPolicies.INCLUDE_NORMAL)) return draftDisplayPolicies.INCLUDE_NORMAL;
  return draftDisplayPolicies.OMIT;
}

function strongestReviewPriority(policies = []) {
  if (policies.some((policy) => policy.review_priority === reviewPriorities.CRITICAL)) return reviewPriorities.CRITICAL;
  if (policies.some((policy) => policy.review_priority === reviewPriorities.HIGH)) return reviewPriorities.HIGH;
  return reviewPriorities.NORMAL;
}

function decoratePresentationWithDraftGate(presentation = null, draftGate = null) {
  if (!presentation || !draftGate?.by_field || !presentation.modules) return presentation;
  const modules = Object.fromEntries(Object.entries(presentation.modules).map(([key, module]) => {
    const policies = presentationModulePolicies(module, draftGate);
    if (!policies.length) return [key, module];
    const displayPolicy = strongestModuleDisplayPolicy(policies);
    const reviewPriority = strongestReviewPriority(policies);
    const requiresReview = module.requires_review === true
      || policies.some((policy) => policy.requires_writer_confirmation === true);
    return [key, {
      ...module,
      requires_review: requiresReview,
      display_policy: displayPolicy,
      review_priority: reviewPriority,
      field_policies: policies.map((policy) => ({
        field: policy.field,
        selected_value: policy.selected_value,
        system_status: policy.system_status,
        display_policy: policy.display_policy,
        evidence_level: policy.evidence_level,
        review_priority: policy.review_priority,
        requires_writer_confirmation: policy.requires_writer_confirmation,
        resolution_reason: policy.resolution_reason
      }))
    }];
  }));

  return {
    ...presentation,
    modules
  };
}

function writerDraftPresentation({
  identityResolution = {},
  evidence = {},
  maxLength = 85,
  titleLanguageBlocked = false,
  lotDetected = false,
  draftGate = null,
  serialNumeratorVerified = null
} = {}) {
  if (titleLanguageBlocked || lotDetected) {
    return {
      identity: normalizeResolvedFields({}),
      presentation: null,
      can_render: false
    };
  }

  const identity = identityForWriterDraft(identityResolution, { draftGate });
  if (!hasWriterDraftSubstance(identity)) {
    return {
      identity,
      presentation: null,
      can_render: false
    };
  }

  const draftEvidence = evidenceForWriterDraft(evidence, identityResolution.field_states || [], draftGate);
  const serialDraftState = draftGate?.by_field?.serial_number || null;
  const serialVerifiedForPresentation = serialNumeratorVerified === true
    || (
      serialDraftState?.display_policy === "INCLUDE_NORMAL"
      && serialDraftState?.selected_value
      && serialDraftState.selected_value === identity.serial_number
    );
  const presentation = decoratePresentationWithDraftGate(renderListingPresentation({
    resolved: identity,
    evidence: draftEvidence,
    serialNumeratorVerified: serialVerifiedForPresentation,
    maxLength
  }), draftGate);
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

function fieldHasResolvedValue(identityResolution = {}, field) {
  const fieldState = fieldStateFor(identityResolution, field);
  return hasValue(fieldState?.resolved_value, field);
}

function identityGateStatus(identityResolution = {}, criticalFields = [], publishabilityByField = {}) {
  const subjectField = subjectCriticalField(criticalFields);
  const coreFields = unique(["year", "product", subjectField]);
  const hasProductLikeValue = fieldHasResolvedValue(identityResolution, "product")
    || fieldHasResolvedValue(identityResolution, "set")
    || fieldHasResolvedValue(identityResolution, "brand")
    || fieldHasResolvedValue(identityResolution, "manufacturer");
  const hasSubjectValue = fieldHasResolvedValue(identityResolution, "players")
    || fieldHasResolvedValue(identityResolution, "character");
  const hasYearValue = fieldHasResolvedValue(identityResolution, "year");
  const hasBlockingCore = coreFields.some((field) => publishabilityByField[field] === fieldPublishabilityStatuses.BLOCKING);

  if (!hasProductLikeValue && !hasSubjectValue) return identityGateStatuses.UNRESOLVED;
  if (!hasProductLikeValue || !hasSubjectValue || !hasYearValue || hasBlockingCore) return identityGateStatuses.PARTIALLY_RESOLVED;
  return identityGateStatuses.CORE_RESOLVED;
}

function buildPublicationGate({
  autoPublishAllowed = false,
  modelPublishRecommended = false,
  writerDraft = {},
  reviewItems = [],
  identityResolution = {},
  activeIdentity = {},
  criticalFields = [],
  titleLanguageBlocked = false,
  lotDetected = false,
  draftGate = null
} = {}) {
  const publishabilityByField = fieldPublishabilityMap(identityResolution, {
    criticalFields,
    reviewItems
  });
  const gateIdentityStatus = identityGateStatus(identityResolution, criticalFields, publishabilityByField);
  const subjectField = subjectCriticalField(criticalFields);
  const subjectBlocking = publishabilityByField[subjectField] === fieldPublishabilityStatuses.BLOCKING;
  const productBlocking = publishabilityByField.product === fieldPublishabilityStatuses.BLOCKING;
  const coreSubjectProductBlocking = subjectBlocking || productBlocking;
  const writerReviewReady = (modelPublishRecommended || writerDraft.can_render === true) && !titleLanguageBlocked && !lotDetected;
  const hasBlockingReview = reviewItems.some((item) => {
    return item.publishability === fieldPublishabilityStatuses.BLOCKING
      || item.publication_state === fieldPublishabilityStatuses.BLOCKING
      || (Array.isArray(item.conflicts) && item.conflicts.length > 0);
  });
  const workflowRoute = lotDetected || titleLanguageBlocked
    ? publicationStatuses.RESCAN_REQUIRED
    : !writerReviewReady
      ? publicationStatuses.DEEP_REVIEW
      : reviewItems.length === 0 && !coreSubjectProductBlocking
        ? publicationStatuses.LOW_TOUCH_REVIEW
        : hasBlockingReview || coreSubjectProductBlocking
          ? publicationStatuses.DEEP_REVIEW
          : publicationStatuses.STANDARD_REVIEW;
  const legacyStatus = workflowRoute === publicationStatuses.LOW_TOUCH_REVIEW
    ? legacyPublicationStatuses.WRITER_QUICK_APPROVAL_READY
    : writerReviewReady
      ? legacyPublicationStatuses.WRITER_REVIEW_READY
      : legacyPublicationStatuses.MANUAL_REQUIRED;
  const quickReviewRecommended = workflowRoute === publicationStatuses.LOW_TOUCH_REVIEW;
  const accuracyGovernor = buildAccuracyGovernorReport(draftGate, { criticalFields });

  return {
    status: workflowRoute,
    workflow_route: workflowRoute,
    legacy_status: legacyStatus,
    workflow_action: quickReviewRecommended
      ? "WRITER_ONE_CLICK_APPROVAL_REQUIRED"
      : workflowRoute === publicationStatuses.STANDARD_REVIEW
        ? "WRITER_HIGHLIGHTED_FIELD_REVIEW_REQUIRED"
        : workflowRoute === publicationStatuses.RESCAN_REQUIRED
          ? "TARGETED_RESCAN_OR_MANUAL_SPLIT_REQUIRED"
          : "MANUAL_IDENTITY_REVIEW_REQUIRED",
    identity_gate_status: gateIdentityStatus,
    auto_publish_allowed: false,
    model_auto_publish_recommended: false,
    model_quick_review_recommended: quickReviewRecommended,
    writer_quick_approval_ready: quickReviewRecommended,
    human_approval_required: true,
    writer_review_ready: writerReviewReady,
    partial_writer_draft: writerDraft.can_render === true && reviewItems.length > 0,
    manual_required_reason: coreSubjectProductBlocking
      ? "core_subject_or_product_blocking"
      : null,
    upload_blocked_until_writer_approval: true,
    writer_required_fields: reviewItems.map((item) => item.field),
    writer_review_items: reviewItems,
    draft_gate: draftGate,
    accuracy_governor: accuracyGovernor,
    draft_fields: Object.keys(writerDraft.identity || {}).filter((field) => hasValue(writerDraft.identity[field], field)),
    field_publication_states: publishabilityByField,
    field_publishability: publishabilityByField,
    legacy_field_publication_states: Object.fromEntries((identityResolution.field_states || []).map((fieldState) => [
      fieldState.field,
      directlySupportedPublishState(fieldState)
    ])),
    field_level_publication: buildFieldLevelPublication({
      autoPublishAllowed,
      modelPublishRecommended,
      writerDraft,
      reviewItems,
      identityResolution,
      activeIdentity,
      criticalFields
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

function confidenceForWriterDraft(existingConfidence = "", reviewItems = []) {
  const normalized = normalizedPublicationConfidence(existingConfidence);
  const reviewFields = new Set((reviewItems || []).map((item) => item.field).filter(Boolean));
  const yearOnlyReview = reviewFields.size === 1
    && reviewFields.has("year")
    && reviewItems.every((item) => item.field !== "year" || hasValue(item.current_value, "year"));
  if (yearOnlyReview && normalized) return normalized;
  return "MEDIUM";
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
      && sourceSummaryOnly(fieldState, ["MODEL_INFERENCE", "PRIMARY_FAST_VISION", "VISUAL_GUESS"]);
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
    return !["MODEL_INFERENCE", "PRIMARY_FAST_VISION", "VISUAL_GUESS", "MARKETPLACE"].includes(source);
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

function directProductCandidate(fieldState = {}) {
  if (fieldState.field !== "product") return null;
  const candidates = Array.isArray(fieldState.candidates) ? fieldState.candidates : [];
  const directSources = new Set([
    "SLAB_LABEL",
    "CARD_BACK",
    "CARD_FRONT",
    "CARD_BACK_PRINTED_TEXT",
    "CARD_FRONT_PRINTED_TEXT",
    "INTERNAL_APPROVED_HISTORY",
    "OFFICIAL_CHECKLIST",
    "STRUCTURED_DATABASE"
  ]);
  const eligible = candidates.filter((candidate) => {
    if (!hasValue(candidate?.value, "product")) return false;
    if (Number(candidate.score || 0) < 0.7) return false;
    return (candidate.evidence_items || []).some((item) => {
      return directSources.has(item.source)
        && (item.source === "STRUCTURED_DATABASE"
          || item.metadata?.evidence_kind !== "visual_vector_candidate_support");
    });
  });
  eligible.sort((a, b) => {
    const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
    if (Math.abs(scoreDelta) > 0.03) return scoreDelta;
    return String(b.value || "").length - String(a.value || "").length;
  });
  return eligible[0] || null;
}

function applyDirectProductEvidenceFallback(identityResolution = {}) {
  const productState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "product");
  if (!productState || hasValue(productState.resolved_value, "product")) return identityResolution;
  if (!["ABSTAIN", "DROP"].includes(productState.decision_route)) return identityResolution;
  const candidate = directProductCandidate(productState);
  if (!candidate) return identityResolution;

  const fallbackValue = candidate.value;
  const conflict = {
    field: "product",
    conflict_type: "DIRECT_PRODUCT_EVIDENCE_SELECTED_FOR_WRITER_DRAFT",
    conflicting_values: unique((productState.conflict_items || [])
      .flatMap((item) => Array.isArray(item.conflicting_values) ? item.conflicting_values : [])
      .concat((productState.candidates || []).map((item) => item.value))
      .map(normalizeText)
      .filter(Boolean)),
    severity: "MEDIUM",
    reason: "product was ambiguous, but direct printed product evidence is strong enough for writer-reviewed draft output",
    resolved: true,
    resolution: "used_direct_product_evidence_for_writer_draft",
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
      candidate_value: fallbackValue,
      candidate_sources: candidate.sources || []
    },
    output: {
      resolved_value: fallbackValue,
      status: identityStatuses.RESOLVED
    },
    decision: "used_direct_product_evidence_for_writer_draft",
    created_at: new Date().toISOString()
  };

  return {
    ...identityResolution,
    identity: nextIdentity,
    resolved_identity: nextIdentity,
    fields: nextIdentity,
    status: identityResolution.status === identityStatuses.CONFIRMED ? identityStatuses.RESOLVED : identityResolution.status,
    ambiguity_status: identityResolution.ambiguity_status === "CONFIRMED" ? "RESOLVED" : identityResolution.ambiguity_status,
    conflict_map: [...(identityResolution.conflict_map || []), conflict],
    global_conflicts: [...(identityResolution.global_conflicts || []), conflict],
    resolution_trace: [...(identityResolution.resolution_trace || []), trace],
    field_states: (identityResolution.field_states || []).map((fieldState) => {
      if (fieldState.field !== "product") return fieldState;
      return {
        ...fieldState,
        resolved_value: fallbackValue,
        decision_route: "USE",
        ambiguity: false,
        conflicts: true,
        resolution_confidence: Number(candidate.score || 0),
        resolution_reason: "used_direct_product_evidence_for_writer_draft",
        conflict_items: [...(fieldState.conflict_items || []), conflict]
      };
    }),
    identity_state: updateIdentityState(identityResolution, {
      fields: nextIdentity
    })
  };
}

function applySetAsProductFallback(identityResolution = {}) {
  const productState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "product");
  const setState = (identityResolution.field_states || []).find((fieldState) => fieldState.field === "set");
  if (!productState || hasValue(productState.resolved_value, "product")) return identityResolution;
  if (!["ABSTAIN", "DROP"].includes(productState.decision_route)) return identityResolution;
  if (directProductCandidate(productState)) return identityResolution;
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

function observedSubjectCandidates(result = {}, evidenceDocument = {}) {
  return [
    result.raw_provider_fields?.players,
    result.raw_provider_fields?.player,
    result.resolved_fields?.players,
    result.resolved?.players,
    evidenceDocument.resolved?.players,
    result.fields?.players,
    result.fields?.player
  ].flatMap(normalizedTextArray).filter(Boolean);
}

function preserveObservedMultiSubjectIdentity(identity = {}, result = {}, evidenceDocument = {}) {
  const observed = mergeSubjectValues(observedSubjectCandidates(result, evidenceDocument));
  const current = normalizedTextArray(identity.players);
  if (observed.length < 2) return identity;
  if (!current.length || current.length >= observed.length) return identity;
  if (!subjectContainsAll(observed, current)) return identity;
  return normalizeResolvedFields({
    ...identity,
    players: mergeSubjectValues(current, observed)
  });
}

function syncPreservedIdentityToFieldStates(identityResolution = {}, identity = {}) {
  if (!hasValue(identity.players, "players")) return identityResolution;
  const fieldStates = Array.isArray(identityResolution.field_states) ? identityResolution.field_states : [];
  let touched = false;
  const nextFieldStates = fieldStates.map((fieldState) => {
    if (fieldState.field !== "players") return fieldState;
    const current = normalizedTextArray(fieldState.resolved_value);
    if (current.length >= identity.players.length && subjectContainsAll(current, identity.players)) return fieldState;
    touched = true;
    return {
      ...fieldState,
      resolved_value: identity.players,
      resolution_reason: fieldState.resolution_reason === "observed_multi_subject_preserved"
        ? fieldState.resolution_reason
        : `${fieldState.resolution_reason || "resolved"}; observed_multi_subject_preserved`,
      candidates: [
        ...(Array.isArray(fieldState.candidates) ? fieldState.candidates : []),
        {
          value: identity.players,
          score: Number(fieldState.resolution_confidence || 0),
          source: "PRIMARY_FAST_VISION",
          reason: "observed_multi_subject_preserved"
        }
      ]
    };
  });

  if (!touched) return identityResolution;
  return {
    ...identityResolution,
    field_states: nextFieldStates
  };
}

function finishIdentityResolutionGate(result = {}, {
  maxLength = 85,
  evidenceDocument = {},
  criticalFields = [],
  identityResolution = {}
} = {}) {
  const optionalCodeGuardedIdentityResolution = applyWeakOcrOnlyOptionalCodeDrop(identityResolution);
  const weakVisualGuardedIdentityResolution = applyWeakVisualParallelDrop(optionalCodeGuardedIdentityResolution);
  const confidenceGuardedIdentityResolution = applyCriticalFieldConfidenceGuard(weakVisualGuardedIdentityResolution, criticalFields);
  const descriptorGuardedIdentityResolution = applyOptionalColorDescriptorDrop(confidenceGuardedIdentityResolution);
  const directProductFallbackIdentityResolution = applyDirectProductEvidenceFallback(descriptorGuardedIdentityResolution);
  const productFallbackIdentityResolution = applySetAsProductFallback(directProductFallbackIdentityResolution);
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
  const finalIdentity = preserveObservedMultiSubjectIdentity(
    gatedIdentityResolution.identity || identity,
    result,
    evidenceDocument
  );
  const finalGatedIdentityResolution = finalIdentity === gatedIdentityResolution.identity
    ? gatedIdentityResolution
    : syncPreservedIdentityToFieldStates({
        ...gatedIdentityResolution,
        identity: finalIdentity
      }, finalIdentity);
  // A focused-crop re-read of the serial counts as direct current-instance
  // provenance even when the original evidence was vision-model-only.
  const serialNumeratorVerified = focusedUpdatedFields([
    ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : []),
    ...(Array.isArray(result.completion_trace) ? result.completion_trace : [])
  ]).has("serial_number")
    ? true
    : null;
  const presentation = renderListingPresentation({
    resolved: finalIdentity,
    evidence: result.evidence || {},
    serialNumeratorVerified,
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
  const reviewItems = writerReviewItems(finalGatedIdentityResolution, criticalFields, [
    ...publishabilityReviewItems(finalGatedIdentityResolution, criticalFields),
    ...secondaryReviewItems,
    ...exactTaxonomyReviewItems(finalGatedIdentityResolution),
    ...yearAutoPublishReviewItems(finalGatedIdentityResolution)
  ]);
  const publishabilityByField = fieldPublishabilityMap(finalGatedIdentityResolution, {
    criticalFields,
    reviewItems
  });
  const draftGate = buildDraftGate(finalGatedIdentityResolution, {
    criticalFields,
    reviewItems,
    publishabilityByField
  });
  const effectiveReviewItems = mergeDraftGateReviewItems(reviewItems, draftGate);
  const canRenderFinalTitle = finalGatedIdentityResolution.status !== identityStatuses.ABSTAIN
    && Boolean(presentation.final_title)
    && !titleLanguageBlocked
    && effectiveReviewItems.length === 0;
  const writerDraft = writerDraftPresentation({
    identityResolution: finalGatedIdentityResolution,
    evidence: result.evidence || {},
    maxLength,
    titleLanguageBlocked,
    lotDetected: lotGuard.detected,
    draftGate,
    serialNumeratorVerified
  });
  const canRenderWriterDraft = !canRenderFinalTitle && writerDraft.can_render === true;
  const activePresentation = canRenderFinalTitle
    ? decoratePresentationWithDraftGate(presentation, draftGate)
    : canRenderWriterDraft
      ? writerDraft.presentation
      : null;
  const activeIdentity = canRenderFinalTitle ? finalIdentity : writerDraft.identity || {};
  const publicationGate = buildPublicationGate({
    autoPublishAllowed: false,
    modelPublishRecommended: canRenderFinalTitle,
    writerDraft,
    reviewItems: effectiveReviewItems,
    identityResolution: finalGatedIdentityResolution,
    activeIdentity,
    criticalFields,
    titleLanguageBlocked,
    lotDetected: lotGuard.detected,
    draftGate
  });
  const unresolved = unique([
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    ...unresolvedFromIdentityResolution(finalGatedIdentityResolution, criticalFields),
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
    accuracy_governor: publicationGate.accuracy_governor,
    draft_gate: draftGate,
    field_level_publication: publicationGate.field_level_publication,
    writer_review_ready: publicationGate.writer_review_ready,
    partial_writer_draft: publicationGate.partial_writer_draft,
    writer_required_fields: publicationGate.writer_required_fields,
    identity_gate_status: publicationGate.identity_gate_status,
    workflow_route: publicationGate.workflow_route,
    confidence: canRenderFinalTitle
      ? confidenceForIdentityStatus(finalGatedIdentityResolution.status, {
          existingConfidence: result.confidence,
          reason: result.reason,
          unresolved
        })
      : canRenderWriterDraft ? confidenceForWriterDraft(result.confidence, effectiveReviewItems) : "LOW",
    reason: mergeReason(resolutionReason(finalGatedIdentityResolution), result.reason),
    fields: publicLegacyFields(activeIdentity, canRenderFinalTitle ? result.fields || {} : {}),
    resolved: activeIdentity,
    resolved_fields: activeIdentity,
    route: lotGuard.detected ? "NON_STANDARD_MANUAL" : canRenderWriterDraft ? "WRITER_REVIEW_REQUIRED" : result.route,
    route_reason: lotGuard.detected
      ? "Multiple cards or lot image cannot be published as one resolved card identity."
      : canRenderWriterDraft
        ? "Partial identity draft is ready; unresolved fields require writer review before upload."
        : result.route_reason,
    identity_resolution_status: finalGatedIdentityResolution.status,
    ambiguity_status: finalGatedIdentityResolution.ambiguity_status,
    abstain_reason_codes: finalGatedIdentityResolution.abstain_reason_codes || [],
    catalog_card_identity: finalGatedIdentityResolution.catalog_card_identity || {},
    physical_asset_identity: finalGatedIdentityResolution.physical_asset_identity || {},
    open_world_identity: finalGatedIdentityResolution.open_world_identity || {},
    identity_resolution: {
      ...finalGatedIdentityResolution,
      convergence_report: convergenceReport
    },
    convergence_report: convergenceReport,
    field_states: finalGatedIdentityResolution.field_states,
    conflict_graph: finalGatedIdentityResolution.conflict_graph,
    conflict_map: finalGatedIdentityResolution.conflict_map,
    confidence_report: finalGatedIdentityResolution.confidence_report,
    canonical_evidence: finalGatedIdentityResolution.canonical_evidence,
    constraint_score_report: finalGatedIdentityResolution.constraint_score_report,
    unresolved,
    modules: activePresentation?.modules || result.modules,
    module_order: activePresentation?.module_order || result.module_order,
    renderer: activePresentation?.renderer || result.renderer,
    renderer_version: activePresentation?.renderer_version || result.renderer_version,
    title_length_policy: activePresentation?.title_length_policy || presentation.title_length_policy || result.title_length_policy,
    resolution_trace: [
      ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : []),
      ...(Array.isArray(finalGatedIdentityResolution.resolution_trace) ? finalGatedIdentityResolution.resolution_trace : [])
    ]
  };
}

export function applyIdentityResolutionGate(result = {}, {
  maxLength = 85,
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
  maxLength = 85,
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
