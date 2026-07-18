export const SEM_STANDARD_VERSION = "linear-cos-10-23-v25";

export const SEM_LINEAR_ISSUES = Object.freeze([
  "COS-10",
  "COS-11",
  "COS-12",
  "COS-13",
  "COS-14",
  "COS-20",
  "COS-21",
  "COS-22",
  "COS-23"
]);

export const SEM_CANDIDATE_PARTICIPATION_LEVELS = Object.freeze({
  SHADOW: "LEVEL_0_SHADOW",
  PROMPT_ASSIST: "LEVEL_1_PROMPT_ASSIST",
  EVIDENCE_SUPPORT: "LEVEL_2_EVIDENCE_SUPPORT",
  FIELD_APPLICATION: "LEVEL_3_FIELD_APPLICATION"
});

export const SEM_FIELD_PERMISSIONS = Object.freeze({
  CAN_APPLY: "can_apply",
  SUPPORT_ONLY: "support_only",
  SUGGEST_ONLY: "suggest_only",
  FORBIDDEN: "forbidden"
});

export const SEM_TERM_CLASSIFICATION = Object.freeze({
  IMPLEMENTATION_DETAIL: "IMPLEMENTATION_DETAIL",
  RECOGNITION_SCHEMA: "RECOGNITION_SCHEMA",
  EVIDENCE_ARTIFACT: "EVIDENCE_ARTIFACT",
  RENDERER_BEHAVIOR: "RENDERER_BEHAVIOR",
  WORKFLOW_QUEUE_BEHAVIOR: "WORKFLOW_QUEUE_BEHAVIOR",
  CSM_BOUNDARY_CLARIFICATION: "CSM_BOUNDARY_CLARIFICATION",
  CSM_DEFINITION_PROPOSAL: "CSM_DEFINITION_PROPOSAL",
  FOUNDER_DECISION: "FOUNDER_DECISION"
});

export const SEM_FEEDBACK_LAYER = Object.freeze({
  COMMERCIAL_FEEDBACK: "COMMERCIAL_FEEDBACK",
  SEMANTIC_LEARNING_CANDIDATE: "SEMANTIC_LEARNING_CANDIDATE",
  REVIEWED_SEMANTIC_TRUTH: "REVIEWED_SEMANTIC_TRUTH"
});

export const SEM_OBSERVATION_LAYER = Object.freeze({
  OBSERVED_FIELD_CANDIDATE: "OBSERVED_FIELD_CANDIDATE",
  BEST_OBSERVED_FIELD: "BEST_OBSERVED_FIELD",
  RESOLVED_SEMANTIC_FIELD: "RESOLVED_SEMANTIC_FIELD"
});

export const semStandardTitleOrder = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "release_variant",
  "print_finish",
  "numerical_rarity",
  "descriptive_rarity",
  "card_number",
  "search_optimization",
  "grading_info"
]);

export const semCanonicalEditableFields = Object.freeze([
  "year",
  "ip_sport",
  "language",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number",
  "descriptive_rarity",
  "numerical_rarity",
  "release_variant",
  "print_finish",
  "special_stamp",
  "grading_info",
  "description",
  "search_optimization"
]);

export const semImplementationTermMap = Object.freeze({
  serial_number: {
    classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
    canonical_field: "numerical_rarity",
    promotion_allowed: false,
    reason: "current-copy numbering evidence; not a canonical editable CSM field"
  },
  serial_numerator: {
    classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
    canonical_field: "numerical_rarity",
    promotion_allowed: false,
    reason: "current physical-copy numerator evidence; renderer may display it but CSM does not add a field"
  },
  serial_denominator: {
    classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
    canonical_field: "numerical_rarity",
    promotion_allowed: false,
    reason: "limited-numbering denominator evidence supporting Numerical Rarity"
  },
  print_run_number: {
    classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
    canonical_field: "numerical_rarity",
    promotion_allowed: false,
    reason: "implementation storage for visible limited numbering"
  },
  print_run_numerator: {
    classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
    canonical_field: "numerical_rarity",
    promotion_allowed: false,
    reason: "current-copy numerator evidence; never copied from reference candidates"
  },
  print_run_denominator: {
    classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
    canonical_field: "numerical_rarity",
    promotion_allowed: false,
    reason: "denominator or production quantity support for Numerical Rarity"
  },
  numbered_to: {
    classification: SEM_TERM_CLASSIFICATION.EVIDENCE_ARTIFACT,
    canonical_field: "numerical_rarity",
    promotion_allowed: false,
    reason: "catalog-supported production quantity support, not a separate CSM field"
  },
  fast_scout: {
    classification: SEM_TERM_CLASSIFICATION.IMPLEMENTATION_DETAIL,
    canonical_field: null,
    promotion_allowed: false,
    reason: "internal speed/scout mechanism"
  },
  candidate_control_plane: {
    classification: SEM_TERM_CLASSIFICATION.IMPLEMENTATION_DETAIL,
    canonical_field: null,
    promotion_allowed: false,
    reason: "candidate governance mechanism, not collectible semantics"
  },
  participation_level: {
    classification: SEM_TERM_CLASSIFICATION.WORKFLOW_QUEUE_BEHAVIOR,
    canonical_field: null,
    promotion_allowed: false,
    reason: "production trace level for candidate participation"
  },
  l1_shadow: {
    classification: SEM_TERM_CLASSIFICATION.WORKFLOW_QUEUE_BEHAVIOR,
    canonical_field: null,
    promotion_allowed: false,
    reason: "internal experiment lane hidden from writers"
  },
  provider_slot: {
    classification: SEM_TERM_CLASSIFICATION.WORKFLOW_QUEUE_BEHAVIOR,
    canonical_field: null,
    promotion_allowed: false,
    reason: "provider capacity control"
  }
});

export const semTcgTitleOrder = Object.freeze([
  "year",
  "ip",
  "language",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number",
  "descriptive_rarity",
  "numerical_rarity",
  "variant",
  "product_finish",
  "special_stamp",
  "grading_info",
  "description",
  "search_optimization"
]);

const semTcgIpMatchers = Object.freeze([
  ["Pokemon", /\b(?:pokemon(?:\s+tcg)?|pok[eé]mon)\b/i],
  ["One Piece", /\bone\s+piece\b/i],
  ["Yu-Gi-Oh!", /\b(?:yu[\s-]*gi[\s-]*oh|yugioh)\b/i],
  ["Dragon Ball", /\bdragon\s*ball\b/i],
  ["Digimon", /\bdigimon\b/i],
  ["Union Arena", /\bunion\s+arena\b/i],
  ["Battle Spirits", /\bbattle\s+spirits\b/i],
  ["Disney Lorcana", /\b(?:disney\s+)?lorcana\b/i],
  ["Star Wars Unlimited", /\bstar\s+wars\s+unlimited\b/i],
  ["Flesh and Blood", /\bflesh\s+and\s+blood\b/i],
  ["Weiss Schwarz", /\bwei(?:ss|\u00df)\s+schwarz\b/i],
  ["Cardfight!! Vanguard", /\b(?:cardfight\W*)?vanguard\b/i],
  ["Shadowverse: Evolve", /\bshadowverse(?:\s*:\s*|\s+)evolve\b/i],
  ["Grand Archive", /\bgrand\s+archive\b/i],
  ["Magic: The Gathering", /\b(?:magic\s*:\s*the\s+gathering|magic\s+the\s+gathering|mtg)\b/i],
  ["Final Fantasy TCG", /\bfinal\s+fantasy\s+tcg\b/i],
  ["Altered", /\baltered\s+(?:tcg|card\s+game)\b/i]
]);

function semResolvedClassificationText(resolved = {}) {
  return cleanText([
    resolved.category,
    resolved.ip,
    resolved.game,
    resolved.brand,
    resolved.manufacturer,
    resolved.product,
    resolved.set
  ].filter(Boolean).join(" "));
}

export function semTcgIpLabel(resolved = {}) {
  const text = semResolvedClassificationText(resolved);
  return semTcgIpMatchers.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

export function semGrammarForResolved(resolved = {}) {
  const text = semResolvedClassificationText(resolved);
  return /\bTCG\b/i.test(text) || semTcgIpLabel(resolved) ? "TCG" : "STANDARD";
}

const semReleaseVariantPattern = /\b(?:Photo\s+Variation|Image\s+Variation|Design\s+Variation|Horizontal|Vertical|International|Variation)\b/gi;

export function semReleaseVariantText(value = "") {
  const text = cleanText(value);
  if (!text) return "";

  const variants = [];
  for (const match of text.matchAll(semReleaseVariantPattern)) {
    const normalized = cleanText(match[0]).toLowerCase();
    if (variants.some((item) => item.toLowerCase() === normalized)) continue;
    variants.push(match[0].replace(/\b\w/g, (letter) => letter.toUpperCase()));
  }
  return variants.join(" ");
}

export const semLotTitleOrder = Object.freeze([
  "lot_quantity",
  "year",
  "manufacturer_product_set",
  "subjects_max_3",
  "shared_card_name_or_design",
  "shared_print_finish",
  "shared_numerical_rarity",
  "search_optimization"
]);

const trustedCatalogSourceTypes = new Set([
  "REVIEWED_INTERNAL",
  "INTERNAL_APPROVED_HISTORY",
  "APPROVED_REFERENCE",
  "OFFICIAL_CHECKLIST",
  "STRUCTURED_DATABASE",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA"
]);

const untrustedCatalogSourceTypes = new Set([
  "MARKETPLACE",
  "EXTERNAL_DIRECTORY_WEAK",
  "COMMUNITY_API",
  "VISUAL_ONLY",
  "REFERENCE_CANDIDATE"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanUpper(value) {
  return cleanText(value).toUpperCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizeFieldToken(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizedIssueSet(value = []) {
  return new Set(asArray(value).map((item) => cleanUpper(item)).filter(Boolean));
}

export function semIssueCoverage(value = []) {
  const present = normalizedIssueSet(value);
  return SEM_LINEAR_ISSUES.every((issue) => present.has(issue));
}

export function isSemNumericalRarityText(value = "") {
  const text = cleanText(value).replace(/\s+/g, "");
  return /^#\/\d{1,5}$/i.test(text)
    || /^\d{1,5}\/\d{1,5}$/i.test(text)
    || /^1\/1$/i.test(text);
}

export function isSemCardNumberText(value = "", {
  grammar = "",
  field = "",
  checklistContext = false
} = {}) {
  const text = cleanText(value);
  if (!text) return false;
  if (isSemNumericalRarityText(text)) {
    return cleanUpper(grammar) === "TCG"
      && (checklistContext === true || normalizeFieldToken(field).includes("card_number"));
  }
  return /^[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,8}){0,3}$/i.test(text);
}

export function classifySemNumberBoundary(value = "", context = {}) {
  const field = normalizeFieldToken(context.field || "");
  const grammar = cleanUpper(context.grammar || context.category || "");
  const text = cleanText(value);
  if (!text) {
    return {
      boundary: "EMPTY",
      csm_field: null,
      reason: "empty_value"
    };
  }
  if (isSemNumericalRarityText(text)) {
    const tcgCardNumberContext = grammar === "TCG"
      && (field.includes("card_number") || context.checklistContext === true);
    return {
      boundary: tcgCardNumberContext ? "CARD_NUMBER" : "NUMERICAL_RARITY",
      csm_field: tcgCardNumberContext ? "card_number" : "numerical_rarity",
      reason: tcgCardNumberContext ? "tcg_checklist_number_context" : "current_card_print_limit"
    };
  }
  if (isSemCardNumberText(text, context)) {
    return {
      boundary: "CARD_NUMBER",
      csm_field: "card_number",
      reason: "printed_design_or_checklist_identifier"
    };
  }
  return {
    boundary: "UNKNOWN",
    csm_field: null,
    reason: "not_a_sem_number_token"
  };
}

export function classifySemTerm(term = "") {
  const normalized = normalizeFieldToken(term);
  if (!normalized) {
    return {
      term: "",
      classification: SEM_TERM_CLASSIFICATION.IMPLEMENTATION_DETAIL,
      canonical_field: null,
      promotion_allowed: false,
      reason: "empty_term"
    };
  }
  if (semCanonicalEditableFields.includes(normalized)) {
    return {
      term: normalized,
      classification: SEM_TERM_CLASSIFICATION.CSM_BOUNDARY_CLARIFICATION,
      canonical_field: normalized,
      promotion_allowed: true,
      reason: "current_canonical_editable_csm_field"
    };
  }
  if (semImplementationTermMap[normalized]) {
    return {
      term: normalized,
      ...semImplementationTermMap[normalized]
    };
  }
  return {
    term: normalized,
    classification: SEM_TERM_CLASSIFICATION.CSM_DEFINITION_PROPOSAL,
    canonical_field: null,
    promotion_allowed: false,
    reason: "new_terms_require_repeated_real_collectible_outliers_and_founder_review"
  };
}

export function semCatalogTrustVerdict({
  sourceType = "",
  sourceTrust = "",
  anchorAgreement = {},
  directConflicts = [],
  materialConflicts = []
} = {}) {
  const normalizedSourceTrust = cleanUpper(sourceTrust);
  const normalizedSourceType = cleanUpper(sourceType);
  const type = normalizedSourceTrust && normalizedSourceTrust !== "REFERENCE_CANDIDATE"
    ? normalizedSourceTrust
    : normalizedSourceType || normalizedSourceTrust;
  const trustedSource = trustedCatalogSourceTypes.has(type) || /APPROVED|REVIEWED|OFFICIAL|STRUCTURED/.test(type);
  const untrustedSource = untrustedCatalogSourceTypes.has(type) || /MARKETPLACE|SELLER|WEAK|COMMUNITY|VISUAL_ONLY/.test(type);
  const agreed = Array.isArray(anchorAgreement.agreed) ? anchorAgreement.agreed : [];
  const contradicted = Array.isArray(anchorAgreement.contradicted) ? anchorAgreement.contradicted : [];
  const conflicts = [
    ...asArray(directConflicts),
    ...asArray(materialConflicts),
    ...contradicted
  ].map(normalizeFieldToken).filter(Boolean);
  const hasHardFilter = Object.prototype.hasOwnProperty.call(anchorAgreement, "prompt_hard_filter_pass");
  const anchorSupported = anchorAgreement.exact_code_match === true
    || agreed.length >= 2
    || anchorAgreement.prompt_hard_filter_pass === true;

  if (untrustedSource) {
    return {
      allowed: false,
      reason: "untrusted_catalog_source",
      trusted_source: false,
      anchor_supported: anchorSupported,
      conflicts
    };
  }
  if (!trustedSource) {
    return {
      allowed: false,
      reason: "missing_trusted_source",
      trusted_source: false,
      anchor_supported: anchorSupported,
      conflicts
    };
  }
  if (conflicts.length) {
    return {
      allowed: false,
      reason: "direct_or_anchor_conflict",
      trusted_source: trustedSource,
      anchor_supported: anchorSupported,
      conflicts: [...new Set(conflicts)]
    };
  }
  if (hasHardFilter && anchorAgreement.prompt_hard_filter_pass !== true) {
    return {
      allowed: false,
      reason: "anchor_hard_filter_failed",
      trusted_source: trustedSource,
      anchor_supported: false,
      conflicts: []
    };
  }
  if (!anchorSupported) {
    return {
      allowed: false,
      reason: "insufficient_observation_anchor_agreement",
      trusted_source: trustedSource,
      anchor_supported: false,
      conflicts: []
    };
  }
  return {
    allowed: true,
    reason: "trusted_catalog_with_observation_anchor_agreement",
    trusted_source: trustedSource,
    anchor_supported: true,
    conflicts: []
  };
}

export function classifyWriterFeedbackForSemanticLearning({
  action = "",
  stableTrainingSample = false,
  reviewedSemanticFields = false
} = {}) {
  const normalizedAction = cleanUpper(action);
  if (["REJECT", "REJECTED"].includes(normalizedAction)) {
    return {
      feedback_layer: SEM_FEEDBACK_LAYER.COMMERCIAL_FEEDBACK,
      semantic_learning_status: "REJECTED_COMMERCIAL_FEEDBACK",
      semantic_truth: false,
      training_eligible: false
    };
  }
  if (reviewedSemanticFields === true) {
    return {
      feedback_layer: SEM_FEEDBACK_LAYER.REVIEWED_SEMANTIC_TRUTH,
      semantic_learning_status: "FIELD_REVIEWED_TRUTH",
      semantic_truth: true,
      training_eligible: false
    };
  }
  return {
    feedback_layer: SEM_FEEDBACK_LAYER.COMMERCIAL_FEEDBACK,
    semantic_learning_status: stableTrainingSample ? "OBSERVE_ONLY_WRITER_TITLE_CANDIDATE" : "UNSTABLE_COMMERCIAL_SIGNAL",
    semantic_truth: false,
    training_eligible: false
  };
}

export const semDefinition = Object.freeze({
  version: SEM_STANDARD_VERSION,
  source: "LINEAR_COS_10_TO_COS_23",
  marketplace_title_limit: 80,
  issues: SEM_LINEAR_ISSUES,
  canonical_editable_fields: semCanonicalEditableFields,
  title_orders: {
    standard: semStandardTitleOrder,
    tcg: semTcgTitleOrder,
    lot: semLotTitleOrder
  },
  candidate_control_plane: {
    participation_levels: SEM_CANDIDATE_PARTICIPATION_LEVELS,
    field_permissions: SEM_FIELD_PERMISSIONS,
    policy: "Candidates are auditable evidence. Identity Resolution owns resolved semantic fields; Renderer consumes resolved fields only."
  },
  governance: {
    default_mode: "boundary_first_not_field_expansion_first",
    term_classifications: SEM_TERM_CLASSIFICATION,
    implementation_terms: semImplementationTermMap
  },
  boundaries: {
    card_number: "Printed design, checklist, or set identifier. Low-priority in non-TCG; identity anchor in TCG.",
    numerical_rarity: "CSM field for production quantity or limited-numbering semantics. Implementation may store supporting evidence as print_run_* or serial_* aliases.",
    catalog_assist: "Catalog or registry evidence becomes trusted only after current-image anchor agreement and zero material conflicts.",
    observation_fusion: "Recognition workers output observed candidates and evidence patches, not resolved semantic truth.",
    commercial_feedback: "Writer edits are commercial feedback first; semantic learning requires later extraction or field review.",
    lot_workflow: "Multiple separate cards route to Lot grammar instead of a failed single-card identity.",
    writer_visible_boundary: "Production writers see loading/progress and L2 complete title drafts only. L0, internal scout, L1 shadow, raw candidates, and learning artifacts remain internal.",
    release_gate: "V4 release requires both CSM field-level quality and production queue readiness, not title proxy recall alone."
  }
});
