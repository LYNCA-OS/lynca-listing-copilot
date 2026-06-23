import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";

export const completionResolutionStates = Object.freeze({
  EVIDENCE_CLOSED: "EVIDENCE_CLOSED",
  NEEDS_EVIDENCE: "NEEDS_EVIDENCE",
  TARGETED_RESCAN_REQUIRED: "TARGETED_RESCAN_REQUIRED",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  MANUAL_REQUIRED: "MANUAL_REQUIRED"
});

const baseCriticalFields = Object.freeze([
  "year",
  "brand",
  "product",
  "players"
]);

const optionalCriticalFields = Object.freeze([
  "manufacturer",
  "set",
  "subset",
  "character",
  "card_type",
  "insert",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "sketch",
  "redemption",
  "one_of_one",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

const unresolvedFieldAliases = Object.freeze({
  player: "players",
  subject: "players",
  character: "character",
  year: "year",
  season: "year",
  manufacturer: "manufacturer",
  brand: "brand",
  product: "product",
  set: "set",
  subset: "subset",
  card_type: "card_type",
  "card type": "card_type",
  insert: "insert",
  parallel: "parallel",
  variation: "variation",
  serial: "serial_number",
  "serial number": "serial_number",
  collector: "collector_number",
  "collector number": "collector_number",
  "card number": "collector_number",
  checklist: "checklist_code",
  "checklist code": "checklist_code",
  rc: "rc",
  rookie: "rc",
  "1st bowman": "first_bowman",
  auto: "auto",
  autograph: "auto",
  patch: "patch",
  relic: "relic",
  grade: "card_grade",
  "card grade": "card_grade",
  "auto grade": "auto_grade",
  "grade label": "grade_company"
});

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hasResolvedValue(fields, fieldName) {
  if (fieldName === "players") return Array.isArray(fields.players) && fields.players.length > 0;
  if (fieldName === "grade_type") return fields.grade_type && fields.grade_type !== "UNKNOWN";

  const value = fields[fieldName];
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function unresolvedMentions(unresolved = []) {
  const text = unresolved.map(normalizeText).join(" ").toLowerCase();
  return Object.entries(unresolvedFieldAliases)
    .filter(([alias]) => text.includes(alias))
    .map(([, fieldName]) => fieldName);
}

function evidenceForField(evidence = {}, fieldName) {
  if (fieldName === "players") return evidence.players || evidence.player || null;
  return evidence[fieldName] || null;
}

function statusIsVerified(field) {
  return ["CONFIRMED", "MANUAL_CONFIRMED", "NOT_APPLICABLE"].includes(field?.status);
}

function statusIsWeak(field) {
  return !field
    || field.status === "REVIEW"
    || field.status === "MISSING"
    || Number(field.confidence || 0) < 0.74;
}

function statusIsConflict(field) {
  return field?.status === "CONFLICT" || (Array.isArray(field?.conflicts) && field.conflicts.length > 0);
}

function applicableCriticalFields(fields, unresolved) {
  const fromResolved = optionalCriticalFields.filter((fieldName) => hasResolvedValue(fields, fieldName));
  const fromUnresolved = unresolvedMentions(unresolved);
  const subjectSatisfied = hasResolvedValue(fields, "players") || hasResolvedValue(fields, "character");
  const base = subjectSatisfied
    ? baseCriticalFields.filter((fieldName) => fieldName !== "players")
    : baseCriticalFields;

  return unique([...base, ...fromResolved, ...fromUnresolved]);
}

function collectQualityObjects(captureQuality = {}) {
  const qualities = [];
  if (captureQuality && typeof captureQuality === "object") {
    qualities.push(captureQuality);
    if (Array.isArray(captureQuality.images) && !Array.isArray(captureQuality.recovered_regions)) qualities.push(...captureQuality.images);
  }
  return qualities;
}

export function criticalOccludedRegions(captureQuality = {}) {
  const regions = [];

  if (Array.isArray(captureQuality?.unresolved_regions)) {
    const topLevelOcclusion = captureQuality.critical_region_occlusion || {};
    return captureQuality.unresolved_regions.map((regionName) => {
      const detail = topLevelOcclusion[regionName] || {};
      return {
        region: regionName,
        image_index: null,
        status: detail.status || "OCCLUDED",
        glare_score: detail.glare_score ?? null,
        readability_score: detail.readability_score ?? null
      };
    });
  }

  collectQualityObjects(captureQuality).forEach((quality, qualityIndex) => {
    Object.entries(quality?.critical_region_occlusion || {}).forEach(([region, detail]) => {
      if (detail?.status === "OCCLUDED") {
        regions.push({
          region,
          image_index: qualityIndex === 0 ? null : qualityIndex - 1,
          status: detail.status,
          glare_score: detail.glare_score ?? null,
          readability_score: detail.readability_score ?? null
        });
      }
    });
  });

  return regions.filter((item, index, all) => {
    return all.findIndex((candidate) => candidate.region === item.region && candidate.image_index === item.image_index) === index;
  });
}

export function createCompletionState({
  resolved = {},
  evidence = {},
  captureQuality = {},
  unresolved = [],
  attemptedActions = [],
  candidateCards = []
} = {}) {
  const fields = normalizeResolvedFields(resolved);
  const criticalFields = applicableCriticalFields(fields, unresolved);
  const verifiedFields = [];
  const missingFields = [];
  const weakFields = [];
  const conflictingFields = [];

  criticalFields.forEach((fieldName) => {
    const fieldEvidence = evidenceForField(evidence, fieldName);
    const hasValue = hasResolvedValue(fields, fieldName);

    if (statusIsConflict(fieldEvidence)) {
      conflictingFields.push(fieldName);
      return;
    }

    if (!hasValue) {
      missingFields.push(fieldName);
      return;
    }

    if (statusIsVerified(fieldEvidence)) {
      verifiedFields.push(fieldName);
      return;
    }

    if (statusIsWeak(fieldEvidence)) {
      weakFields.push(fieldName);
      return;
    }

    verifiedFields.push(fieldName);
  });

  const occludedRegions = criticalOccludedRegions(captureQuality);
  const resolutionState = missingFields.length || weakFields.length || conflictingFields.length
    ? completionResolutionStates.NEEDS_EVIDENCE
    : completionResolutionStates.EVIDENCE_CLOSED;

  return {
    verified_fields: unique(verifiedFields),
    missing_fields: unique(missingFields),
    weak_fields: unique(weakFields),
    conflicting_fields: unique(conflictingFields),
    critical_region_occlusion: occludedRegions,
    candidate_cards: Array.isArray(candidateCards) ? candidateCards : [],
    attempted_actions: Array.isArray(attemptedActions) ? attemptedActions : [],
    next_best_action: null,
    estimated_information_gain: 0,
    resolution_state: resolutionState
  };
}
