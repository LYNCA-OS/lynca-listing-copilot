import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { stripReferencePrintRunNumerator } from "../print-run/print-run-fields.mjs";

export const participationLevels = Object.freeze({
  SHADOW: "LEVEL_0_SHADOW",
  PROMPT_ASSIST: "LEVEL_1_PROMPT_ASSIST",
  EVIDENCE_SUPPORT: "LEVEL_2_EVIDENCE_SUPPORT",
  FIELD_APPLICATION: "LEVEL_3_FIELD_APPLICATION"
});

export const fieldPermissions = Object.freeze({
  CAN_APPLY: "can_apply",
  SUPPORT_ONLY: "support_only",
  SUGGEST_ONLY: "suggest_only",
  FORBIDDEN: "forbidden"
});

const applyAllowedFields = new Set([
  "year",
  "manufacturer",
  "brand",
  "product",
  "release",
  "set",
  "insert",
  "subset",
  "language",
  "rarity",
  "players",
  "character",
  "card_name",
  "team",
  "collector_number",
  "checklist_code",
  "card_number",
  "tcg_card_number",
  "official_card_type",
  "observable_components",
  "surface_color",
  "parallel",
  "parallel_family",
  "parallel_exact",
  "variation",
  "numbered_to",
  "print_run_denominator",
  "serial_denominator",
  "expected_serial_denominator"
]);

const forbiddenFields = new Set([
  "print_run_numerator",
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "cert_number",
  "condition",
  "current_physical_defects",
  "physical_defects"
]);

const sourceTrustRank = Object.freeze({
  REVIEWED_INTERNAL: 6,
  INTERNAL_APPROVED_HISTORY: 6,
  APPROVED_REFERENCE: 6,
  OFFICIAL_CHECKLIST: 5,
  INTERNAL_VERIFIED_TITLE: 4,
  LICENSED_EXTERNAL_DIRECTORY: 3,
  COMMUNITY_API: 2,
  MARKETPLACE: 1,
  VISUAL_ONLY: 0,
  REFERENCE_CANDIDATE: 0
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanUpper(value) {
  return cleanText(value).toUpperCase();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function normalizeSourceTrust(value = "") {
  const trust = cleanUpper(value);
  if (trust === "APPROVED_REFERENCE") return "APPROVED_REFERENCE";
  if (trust === "REFERENCE_CANDIDATE") return "REFERENCE_CANDIDATE";
  if (trust.includes("REVIEWED_INTERNAL")) return "REVIEWED_INTERNAL";
  if (trust.includes("OFFICIAL")) return "OFFICIAL_CHECKLIST";
  if (trust.includes("LICENSED")) return "LICENSED_EXTERNAL_DIRECTORY";
  if (trust.includes("COMMUNITY")) return "COMMUNITY_API";
  if (trust.includes("MARKETPLACE") || trust.includes("EBAY")) return "MARKETPLACE";
  if (trust.includes("VISUAL")) return "VISUAL_ONLY";
  return trust || "REFERENCE_CANDIDATE";
}

export function sourceTrustScore(value = "") {
  return sourceTrustRank[normalizeSourceTrust(value)] ?? 0;
}

export function candidateId(candidate = {}) {
  return cleanText(candidate.candidate_id)
    || cleanText(candidate.candidate_identity_id)
    || cleanText(candidate.identity_id)
    || cleanText(candidate.source_url);
}

export function candidateSourceType(candidate = {}) {
  return cleanUpper(candidate.source_type
    || candidate.reference_metadata?.source_type
    || candidate.provider_id
    || candidate.retrieval_provider_id
    || candidate.source_provider);
}

export function candidateSourceTrust(candidate = {}) {
  return normalizeSourceTrust(candidate.source_trust
    || candidate.reference_metadata?.source_trust
    || candidate.reference_metadata?.retrieval_status
    || candidate.reference_metadata?.reference_status
    || candidate.status);
}

export function candidateIsVectorOnly(candidate = {}) {
  const sourceType = candidateSourceType(candidate);
  const provider = cleanUpper(candidate.provider_id || candidate.retrieval_provider_id || candidate.source_provider);
  return sourceType === "VISUAL_VECTOR" || provider === "VISUAL_VECTOR";
}

export function candidateIsMarketplace(candidate = {}) {
  const sourceType = candidateSourceType(candidate);
  const text = [
    sourceType,
    candidate.provider_id,
    candidate.source_provider,
    candidate.reference_metadata?.source_provider,
    candidate.source_url
  ].map(cleanUpper).join(" ");
  return text.includes("MARKETPLACE") || text.includes("EBAY") || text.includes("SELLER");
}

export function candidateFields(candidate = {}) {
  const raw = candidate.fields && typeof candidate.fields === "object" && !Array.isArray(candidate.fields)
    ? candidate.fields
    : {};
  const normalized = normalizeResolvedFields(stripReferencePrintRunNumerator(candidate.fields || {}));
  const fields = {
    year: normalized.year,
    manufacturer: normalized.manufacturer,
    brand: normalized.brand,
    product: normalized.product,
    release: normalized.release,
    set: normalized.set,
    insert: normalized.insert,
    subset: normalized.subset,
    language: normalized.language,
    rarity: normalized.rarity,
    players: normalized.players,
    character: normalized.character,
    card_name: normalized.card_name,
    team: normalized.team,
    collector_number: normalized.collector_number,
    checklist_code: normalized.checklist_code,
    card_number: normalized.card_number,
    tcg_card_number: normalized.tcg_card_number,
    official_card_type: normalized.official_card_type || normalized.card_type,
    observable_components: normalized.observable_components,
    surface_color: normalized.surface_color,
    parallel: normalized.parallel,
    parallel_family: normalized.parallel_family,
    parallel_exact: normalized.parallel_exact,
    variation: normalized.variation,
    numbered_to: normalized.numbered_to,
    print_run_denominator: normalized.print_run_denominator,
    serial_denominator: normalized.serial_denominator,
    expected_serial_denominator: normalized.expected_serial_denominator,
    print_run_numerator: normalized.print_run_numerator,
    grade: normalized.grade,
    grade_company: normalized.grade_company,
    card_grade: normalized.card_grade,
    auto_grade: normalized.auto_grade,
    cert_number: normalized.cert_number,
    condition: normalized.condition
  };
  for (const field of forbiddenFields) {
    if (hasValue(raw[field])) fields[field] = raw[field];
  }
  if (hasValue(raw.print_run_number) && /\d+\s*\/\s*\d+/.test(cleanText(raw.print_run_number))) {
    fields.print_run_number = raw.print_run_number;
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => hasValue(value)));
}

export function candidateDirectConflicts(candidate = {}) {
  return [...new Set([
    candidate.conflicting_fields,
    candidate.direct_evidence_conflicts,
    candidate.conflicts
  ].flatMap((value) => Array.isArray(value) ? value : [])
    .map((field) => cleanText(typeof field === "string" ? field : field?.field || field?.field_name || field?.name))
    .filter(Boolean))];
}

export function candidateFieldPermissions(candidate = {}) {
  const fields = candidateFields(candidate);
  const sourceTrust = candidateSourceTrust(candidate);
  const vectorOnly = candidateIsVectorOnly(candidate);
  const marketplace = candidateIsMarketplace(candidate);
  const lowTrust = marketplace || sourceTrustScore(sourceTrust) <= sourceTrustRank.REFERENCE_CANDIDATE;
  const permissions = {};

  for (const field of Object.keys(fields)) {
    if (forbiddenFields.has(field)) {
      permissions[field] = fieldPermissions.FORBIDDEN;
      continue;
    }
    if (field === "print_run_number") {
      permissions[field] = fieldPermissions.FORBIDDEN;
      continue;
    }
    if (!applyAllowedFields.has(field)) {
      permissions[field] = fieldPermissions.SUGGEST_ONLY;
      continue;
    }
    if (vectorOnly) {
      permissions[field] = sourceTrust === "APPROVED_REFERENCE"
        ? fieldPermissions.SUPPORT_ONLY
        : fieldPermissions.SUGGEST_ONLY;
      continue;
    }
    if (lowTrust) {
      permissions[field] = fieldPermissions.SUGGEST_ONLY;
      continue;
    }
    permissions[field] = fieldPermissions.CAN_APPLY;
  }

  return permissions;
}

export function splitFieldsByPermission(permissions = {}) {
  const groups = {
    can_apply_fields: [],
    support_only_fields: [],
    suggest_only_fields: [],
    forbidden_fields: []
  };
  for (const [field, permission] of Object.entries(permissions || {})) {
    if (permission === fieldPermissions.CAN_APPLY) groups.can_apply_fields.push(field);
    else if (permission === fieldPermissions.SUPPORT_ONLY) groups.support_only_fields.push(field);
    else if (permission === fieldPermissions.SUGGEST_ONLY) groups.suggest_only_fields.push(field);
    else if (permission === fieldPermissions.FORBIDDEN) groups.forbidden_fields.push(field);
  }
  return groups;
}

export function buildCandidateApplicationTrace(candidate = {}, {
  participationLevel = participationLevels.SHADOW,
  matchLevel = "NO_MATCH",
  appliedFields = [],
  blockedFields = [],
  reasonPerField = {}
} = {}) {
  const permissions = candidateFieldPermissions(candidate);
  const split = splitFieldsByPermission(permissions);
  const directConflicts = candidateDirectConflicts(candidate);
  const blocked = [...new Set([
    ...directConflicts,
    ...split.forbidden_fields,
    ...blockedFields
  ].filter(Boolean))];

  return {
    candidate_id: candidateId(candidate),
    candidate_identity_id: cleanText(candidate.candidate_identity_id || candidate.identity_id),
    source_type: candidateSourceType(candidate),
    source_trust: candidateSourceTrust(candidate),
    match_level: matchLevel,
    participation_level: participationLevel,
    anchor_agreement: candidate.anchor_agreement || null,
    direct_conflicts: directConflicts,
    field_permissions: permissions,
    ...split,
    applied_fields: [...new Set(appliedFields.filter(Boolean))],
    blocked_fields: blocked,
    reason_per_field: reasonPerField
  };
}

export function candidateFieldEvidenceRows(candidate = {}, trace = {}) {
  const fields = candidateFields(candidate);
  const permissions = trace.field_permissions || candidateFieldPermissions(candidate);
  const rows = [];
  for (const [fieldName, value] of Object.entries(fields)) {
    const permission = permissions[fieldName];
    if (![fieldPermissions.CAN_APPLY, fieldPermissions.SUPPORT_ONLY, fieldPermissions.SUGGEST_ONLY].includes(permission)) continue;
    rows.push({
      field_name: fieldName,
      value,
      source_type: candidateSourceType(candidate),
      source_trust: candidateSourceTrust(candidate),
      candidate_id: candidateId(candidate),
      candidate_identity_id: cleanText(candidate.candidate_identity_id || candidate.identity_id),
      permission,
      confidence: permission === fieldPermissions.CAN_APPLY ? 0.72 : permission === fieldPermissions.SUPPORT_ONLY ? 0.58 : 0.42,
      provenance: "candidate_control_plane",
      forbidden_copy_check: trace.forbidden_fields?.length ? "forbidden_fields_removed" : "passed"
    });
  }
  return rows;
}
