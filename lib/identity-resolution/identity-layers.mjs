import { identityStatuses } from "./types.mjs";

export const catalogCardIdentityFields = Object.freeze([
  "sport",
  "season",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "insert",
  "card_number",
  "subjects",
  "team",
  "parallel",
  "variation",
  "autograph_type",
  "relic_type",
  "print_run",
  "language",
  "release_region"
]);

export const physicalAssetIdentityFields = Object.freeze([
  "catalog_card_id",
  "serial_number",
  "grader",
  "grade",
  "cert_number",
  "condition",
  "provenance",
  "owner",
  "consignment_id",
  "front_image",
  "back_image",
  "slab_image",
  "custody_history"
]);

export const abstainReasonCodes = Object.freeze({
  NO_CATALOG_CANDIDATE: "NO_CATALOG_CANDIDATE",
  MISSING_BACK_IMAGE: "MISSING_BACK_IMAGE",
  LOW_IMAGE_QUALITY: "LOW_IMAGE_QUALITY",
  TOP2_NEAR_TIE: "TOP2_NEAR_TIE",
  PARALLEL_AMBIGUOUS: "PARALLEL_AMBIGUOUS",
  OCR_CATALOG_CONFLICT: "OCR_CATALOG_CONFLICT",
  UNKNOWN_LANGUAGE_OR_REGION: "UNKNOWN_LANGUAGE_OR_REGION",
  SERIAL_PRINT_RUN_CONFLICT: "SERIAL_PRINT_RUN_CONFLICT",
  CERT_MISMATCH: "CERT_MISMATCH",
  MULTI_CARD_ASSET: "MULTI_CARD_ASSET",
  MISSING_CRITICAL_FIELD: "MISSING_CRITICAL_FIELD",
  SECONDARY_VERIFICATION_REQUIRED: "SECONDARY_VERIFICATION_REQUIRED",
  HIGH_CONFLICT_UNCERTAINTY: "HIGH_CONFLICT_UNCERTAINTY"
});

export const openWorldEvaluationMetrics = Object.freeze([
  {
    id: "accepted_exact_identity_accuracy",
    name: "Accepted Exact Identity Accuracy",
    denominator: "non_abstain_accepted_assets",
    definition: "Only accepted non-ABSTAIN assets count; every critical catalog and physical asset field must be correct."
  },
  {
    id: "dangerous_error_rate",
    name: "Dangerous Error Rate",
    denominator: "auto_accepted_assets",
    definition: "Accepted assets with wrong card identity, parallel, card number, serial, grade, or other critical factual errors."
  },
  {
    id: "coverage_abstain_rate",
    name: "Coverage / Abstain Rate",
    denominator: "attempted_assets",
    definition: "How much of the batch the automated path actually completed versus routed to review."
  },
  {
    id: "risk_coverage_curve",
    name: "Risk-Coverage Curve",
    denominator: "threshold_sweep",
    definition: "Coverage and dangerous error rate as Identity Gate thresholds change."
  },
  {
    id: "top_k_catalog_recall",
    name: "Top-K Catalog Recall",
    denominator: "assets_with_reviewed_catalog_truth",
    definition: "Whether the correct CatalogCardID entered retrieval candidates before solver decisions."
  },
  {
    id: "review_seconds_per_card",
    name: "Review Seconds per Card",
    denominator: "reviewed_assets",
    definition: "Human time required after the system has produced candidates and reasons."
  },
  {
    id: "post_list_correction_rate",
    name: "Post-list Correction Rate",
    denominator: "published_assets",
    definition: "Published listings later corrected by operators, customers, or marketplace feedback."
  },
  {
    id: "non_catalog_closure_rate",
    name: "Non-Catalog Closure Rate",
    denominator: "non_catalog_research_queue_items",
    definition: "Unknown cards that are converted into reusable catalog records."
  }
]);

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function firstValue(...values) {
  return values.find(hasValue) ?? null;
}

function printRunFromSerial(serialNumber) {
  const match = String(serialNumber || "").match(/^\d{1,5}\s*\/\s*(\d{1,5})$/);
  return match ? match[1] : null;
}

function compactObject(object = {}) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== "";
  }));
}

export function splitIdentityLayers(identity = {}) {
  const subjects = [
    ...(Array.isArray(identity.players) ? identity.players : []),
    identity.character,
    identity.artist
  ].filter(hasValue);

  const catalogCardIdentity = compactObject({
    sport: identity.sport || null,
    season: identity.season || identity.year || null,
    manufacturer: identity.manufacturer || null,
    brand: identity.brand || null,
    product: identity.product || null,
    set: identity.set || null,
    subset: identity.subset || null,
    insert: identity.insert || null,
    card_number: firstValue(identity.collector_number, identity.checklist_code, identity.card_number),
    subjects,
    team: identity.team || null,
    parallel: firstValue(identity.parallel_exact, identity.parallel, identity.parallel_family, identity.surface_color),
    variation: identity.variation || null,
    autograph_type: identity.auto ? firstValue(identity.card_type, "Auto") : null,
    relic_type: identity.relic ? firstValue(identity.card_type, "Relic") : null,
    print_run: identity.print_run || printRunFromSerial(identity.serial_number),
    language: identity.language || null,
    release_region: identity.release_region || null
  });

  const physicalAssetIdentity = compactObject({
    catalog_card_id: identity.catalog_card_id || null,
    serial_number: identity.serial_number || null,
    grader: identity.grade_company || null,
    grade: firstValue(identity.card_grade, identity.grade),
    cert_number: identity.cert_number || identity.certificate_number || null,
    condition: identity.condition || null,
    provenance: identity.provenance || null,
    owner: identity.owner || null,
    consignment_id: identity.consignment_id || null,
    front_image: identity.front_image || null,
    back_image: identity.back_image || null,
    slab_image: identity.slab_image || null,
    custody_history: identity.custody_history || null
  });

  return {
    catalog_card_identity: catalogCardIdentity,
    physical_asset_identity: physicalAssetIdentity
  };
}

function conflictType(conflict = {}) {
  return String(conflict.conflict_type || "").trim().toUpperCase();
}

function fieldStateByName(fieldStates = []) {
  return new Map(fieldStates.map((fieldState) => [fieldState.field, fieldState]));
}

function missingCriticalFields(identity = {}, criticalFields = []) {
  return criticalFields.filter((field) => !hasValue(identity[field]));
}

function hasNearTie(fieldState = {}, gap = 0.12) {
  const candidates = Array.isArray(fieldState.candidates) ? fieldState.candidates : [];
  if (candidates.length < 2) return false;
  const [top, second] = candidates;
  const margin = Number(top.score || 0) - Number(second.score || 0);
  return Number.isFinite(margin) && margin >= 0 && margin < gap;
}

export function deriveAbstainReasonCodes({
  identity = {},
  fieldStates = [],
  conflictMap = [],
  status = identityStatuses.ABSTAIN,
  criticalFields = ["year", "product", "players"],
  fieldAmbiguityGap = 0.12
} = {}) {
  if (status !== identityStatuses.ABSTAIN) return [];

  const reasons = new Set();
  const fields = fieldStateByName(fieldStates);
  const missing = missingCriticalFields(identity, criticalFields);
  const hasSubjectAnchor = hasValue(identity.players) || hasValue(identity.character) || hasValue(identity.artist);
  const hasCardNumberAnchor = hasValue(identity.collector_number) || hasValue(identity.checklist_code) || hasValue(identity.card_number);
  const hasCatalogAnchor = (hasValue(identity.product) || hasValue(identity.set)) && (hasSubjectAnchor || hasCardNumberAnchor);
  if (missing.length) reasons.add(abstainReasonCodes.MISSING_CRITICAL_FIELD);
  if (!hasCatalogAnchor) {
    reasons.add(abstainReasonCodes.NO_CATALOG_CANDIDATE);
  }
  if (identity.multi_card || Number(identity.card_count || 0) > 1) {
    reasons.add(abstainReasonCodes.MULTI_CARD_ASSET);
  }

  fieldStates.forEach((fieldState) => {
    const field = fieldState.field;
    const uncertainty = fieldState.field_uncertainty || {};
    if (hasNearTie(fieldState, fieldAmbiguityGap)) reasons.add(abstainReasonCodes.TOP2_NEAR_TIE);
    if (fieldState.ambiguity && ["parallel", "parallel_exact", "parallel_family", "surface_color", "variation"].includes(field)) {
      reasons.add(abstainReasonCodes.PARALLEL_AMBIGUOUS);
    }
    if (uncertainty.high_conflict_high_uncertainty === true) {
      reasons.add(abstainReasonCodes.HIGH_CONFLICT_UNCERTAINTY);
    }
  });

  conflictMap.forEach((conflict) => {
    if (conflict.resolved === true) return;
    const type = conflictType(conflict);
    const field = String(conflict.field || "");
    if (/REGISTRY|CHECKLIST|CATALOG|OCR/.test(type) && /OCR|REGISTRY|CHECKLIST|CATALOG/.test(type)) {
      reasons.add(abstainReasonCodes.OCR_CATALOG_CONFLICT);
    }
    if (field === "serial_number" || /SERIAL|DENOMINATOR|PRINT_RUN/.test(type)) {
      reasons.add(abstainReasonCodes.SERIAL_PRINT_RUN_CONFLICT);
    }
    if (/CERT/.test(type)) reasons.add(abstainReasonCodes.CERT_MISMATCH);
    if (/LANGUAGE|REGION/.test(type)) reasons.add(abstainReasonCodes.UNKNOWN_LANGUAGE_OR_REGION);
  });

  ["serial_number", "parallel", "year_product", "grade_label", "card_code"].forEach((fieldGroup) => {
    const state = fields.get(fieldGroup);
    if (state?.resolution_reason === "secondary_verification_required") {
      reasons.add(abstainReasonCodes.SECONDARY_VERIFICATION_REQUIRED);
    }
  });

  if (!reasons.size) reasons.add(abstainReasonCodes.NO_CATALOG_CANDIDATE);
  return [...reasons];
}

export function buildOpenWorldIdentity({
  identity = {},
  fieldStates = [],
  conflictMap = [],
  status = identityStatuses.ABSTAIN,
  criticalFields = ["year", "product", "players"],
  fieldAmbiguityGap = 0.12
} = {}) {
  const layers = splitIdentityLayers(identity);
  const abstainReasons = deriveAbstainReasonCodes({
    identity,
    fieldStates,
    conflictMap,
    status,
    criticalFields,
    fieldAmbiguityGap
  });
  const catalogKnown = hasValue(layers.catalog_card_identity.product)
    && (hasValue(layers.catalog_card_identity.card_number) || hasValue(layers.catalog_card_identity.subjects));

  return {
    model_version: "open-world-card-identity-v1",
    ...layers,
    catalog_match_status: status === identityStatuses.ABSTAIN
      ? abstainReasons.includes(abstainReasonCodes.NO_CATALOG_CANDIDATE)
        ? "NON_CATALOG_RESEARCH_QUEUE"
        : "NEEDS_REVIEW"
      : catalogKnown
        ? "CATALOG_MATCHED"
        : "CATALOG_PARTIAL",
    abstain_reason_codes: abstainReasons,
    evaluation_metrics_contract: openWorldEvaluationMetrics
  };
}
