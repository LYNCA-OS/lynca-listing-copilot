export const evidenceFieldStatuses = Object.freeze([
  "CONFIRMED",
  "REVIEW",
  "MISSING",
  "CONFLICT",
  "MANUAL_CONFIRMED",
  "NOT_APPLICABLE"
]);

export const evidenceSourceTypes = Object.freeze([
  "CARD_FRONT",
  "CARD_BACK",
  "SLAB_LABEL",
  "OCR",
  "VISION_MODEL",
  "INTERNAL_APPROVED_HISTORY",
  "INTERNAL_REGISTRY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA",
  "STRUCTURED_DATABASE",
  "MARKETPLACE",
  "OPEN_WEB",
  "OPERATOR"
]);

export const gradeTypes = Object.freeze([
  "CARD_ONLY",
  "AUTO_ONLY",
  "CARD_AND_AUTO",
  "AUTHENTIC",
  "ALTERED",
  "UNKNOWN"
]);

export const resolvedFieldNames = Object.freeze([
  "category",
  "standardness",
  "route",
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "players",
  "character",
  "team",
  "artist",
  "card_type",
  "insert",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "attributes",
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

export const defaultResolvedFields = Object.freeze({
  category: null,
  standardness: null,
  route: null,
  year: null,
  manufacturer: null,
  brand: null,
  product: null,
  set: null,
  subset: null,
  players: [],
  character: null,
  team: null,
  artist: null,
  card_type: null,
  insert: null,
  parallel: null,
  variation: null,
  serial_number: null,
  collector_number: null,
  checklist_code: null,
  attributes: [],
  rc: false,
  first_bowman: false,
  ssp: false,
  case_hit: false,
  auto: false,
  patch: false,
  relic: false,
  sketch: false,
  redemption: false,
  one_of_one: false,
  grade_company: null,
  card_grade: null,
  auto_grade: null,
  grade_type: "UNKNOWN"
});

function clampConfidence(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeStringOrNull(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeStringOrNull).filter(Boolean);
  }

  const normalized = normalizeStringOrNull(value);
  return normalized ? [normalized] : [];
}

function normalizeBoolean(value) {
  return value === true;
}

function validationError(path, message) {
  return { path, message };
}

export function createVisionSource({
  sourceType = "VISION_MODEL",
  imageId = null,
  side = null,
  captureRole = null,
  region = null,
  observedText = null,
  glareOcclusion = null,
  blurScore = null,
  trustTier = 10
} = {}) {
  return {
    source_type: evidenceSourceTypes.includes(sourceType) ? sourceType : "VISION_MODEL",
    image_id: imageId,
    side,
    capture_role: captureRole,
    region,
    observed_text: observedText,
    glare_occlusion: glareOcclusion,
    blur_score: blurScore,
    trust_tier: trustTier
  };
}

export function createEvidenceField({
  value = null,
  normalizedValue = undefined,
  status = null,
  confidence = 0,
  candidates = null,
  sources = null,
  conflicts = null,
  unresolvedReason = null
} = {}) {
  const normalized = normalizedValue === undefined ? value : normalizedValue;
  const normalizedStatus = evidenceFieldStatuses.includes(status)
    ? status
    : value === null || value === undefined || value === ""
      ? "MISSING"
      : confidence >= 0.86
        ? "CONFIRMED"
        : "REVIEW";
  const normalizedConfidence = clampConfidence(confidence);

  return {
    value,
    normalized_value: normalized,
    status: normalizedStatus,
    confidence: normalizedConfidence,
    candidates: Array.isArray(candidates) && candidates.length
      ? candidates.map((candidate) => ({
        value: candidate?.value ?? null,
        confidence: clampConfidence(candidate?.confidence, normalizedConfidence)
      }))
      : value === null || value === undefined || value === ""
        ? []
        : [{ value, confidence: normalizedConfidence }],
    sources: Array.isArray(sources) ? sources : [createVisionSource({ observedText: String(value ?? "") })],
    conflicts: Array.isArray(conflicts) ? conflicts : [],
    unresolved_reason: unresolvedReason || null
  };
}

export function validateEvidenceField(field, path = "evidence_field") {
  const errors = [];

  if (!field || typeof field !== "object" || Array.isArray(field)) {
    return [validationError(path, "EvidenceField must be an object.")];
  }

  if (!evidenceFieldStatuses.includes(field.status)) {
    errors.push(validationError(`${path}.status`, "Invalid evidence field status."));
  }

  if (!Number.isFinite(field.confidence) || field.confidence < 0 || field.confidence > 1) {
    errors.push(validationError(`${path}.confidence`, "Confidence must be between 0 and 1."));
  }

  if (!Array.isArray(field.candidates)) {
    errors.push(validationError(`${path}.candidates`, "Candidates must be an array."));
  } else {
    field.candidates.forEach((candidate, index) => {
      if (!candidate || typeof candidate !== "object") {
        errors.push(validationError(`${path}.candidates[${index}]`, "Candidate must be an object."));
        return;
      }
      if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
        errors.push(validationError(`${path}.candidates[${index}].confidence`, "Candidate confidence must be between 0 and 1."));
      }
    });
  }

  if (!Array.isArray(field.sources)) {
    errors.push(validationError(`${path}.sources`, "Sources must be an array."));
  } else {
    field.sources.forEach((source, index) => {
      if (!source || typeof source !== "object") {
        errors.push(validationError(`${path}.sources[${index}]`, "Source must be an object."));
        return;
      }
      if (!evidenceSourceTypes.includes(source.source_type)) {
        errors.push(validationError(`${path}.sources[${index}].source_type`, "Invalid source type."));
      }
      if (!Number.isInteger(source.trust_tier) || source.trust_tier < 1 || source.trust_tier > 10) {
        errors.push(validationError(`${path}.sources[${index}].trust_tier`, "Trust tier must be an integer from 1 to 10."));
      }
    });
  }

  if (!Array.isArray(field.conflicts)) {
    errors.push(validationError(`${path}.conflicts`, "Conflicts must be an array."));
  }

  return errors;
}

export function normalizeResolvedFields(input = {}) {
  const raw = input || {};
  const players = normalizeStringArray(raw.players ?? raw.player);
  const attributes = normalizeStringArray(raw.attributes);
  const gradeType = gradeTypes.includes(raw.grade_type) ? raw.grade_type : "UNKNOWN";

  return {
    ...defaultResolvedFields,
    category: normalizeStringOrNull(raw.category),
    standardness: normalizeStringOrNull(raw.standardness),
    route: normalizeStringOrNull(raw.route),
    year: normalizeStringOrNull(raw.year),
    manufacturer: normalizeStringOrNull(raw.manufacturer || raw.brand),
    brand: normalizeStringOrNull(raw.brand || raw.manufacturer),
    product: normalizeStringOrNull(raw.product),
    set: normalizeStringOrNull(raw.set),
    subset: normalizeStringOrNull(raw.subset),
    players,
    character: normalizeStringOrNull(raw.character),
    team: normalizeStringOrNull(raw.team),
    artist: normalizeStringOrNull(raw.artist),
    card_type: normalizeStringOrNull(raw.card_type || raw.cardType),
    insert: normalizeStringOrNull(raw.insert),
    parallel: normalizeStringOrNull(raw.parallel),
    variation: normalizeStringOrNull(raw.variation),
    serial_number: normalizeStringOrNull(raw.serial_number),
    collector_number: normalizeStringOrNull(raw.collector_number),
    checklist_code: normalizeStringOrNull(raw.checklist_code),
    attributes,
    rc: normalizeBoolean(raw.rc),
    first_bowman: normalizeBoolean(raw.first_bowman),
    ssp: normalizeBoolean(raw.ssp),
    case_hit: normalizeBoolean(raw.case_hit),
    auto: normalizeBoolean(raw.auto),
    patch: normalizeBoolean(raw.patch),
    relic: normalizeBoolean(raw.relic),
    sketch: normalizeBoolean(raw.sketch),
    redemption: normalizeBoolean(raw.redemption),
    one_of_one: normalizeBoolean(raw.one_of_one),
    grade_company: normalizeStringOrNull(raw.grade_company),
    card_grade: normalizeStringOrNull(raw.card_grade || raw.grade),
    auto_grade: normalizeStringOrNull(raw.auto_grade),
    grade_type: gradeType
  };
}

export function validateResolvedFields(fields, path = "resolved") {
  const errors = [];

  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return [validationError(path, "Resolved fields must be an object.")];
  }

  Object.keys(fields).forEach((key) => {
    if (!resolvedFieldNames.includes(key)) {
      errors.push(validationError(`${path}.${key}`, "Unknown resolved field."));
    }
  });

  ["players", "attributes"].forEach((key) => {
    if (!Array.isArray(fields[key])) {
      errors.push(validationError(`${path}.${key}`, "Field must be an array."));
    }
  });

  [
    "rc",
    "first_bowman",
    "ssp",
    "case_hit",
    "auto",
    "patch",
    "relic",
    "sketch",
    "redemption",
    "one_of_one"
  ].forEach((key) => {
    if (typeof fields[key] !== "boolean") {
      errors.push(validationError(`${path}.${key}`, "Field must be boolean."));
    }
  });

  if (!gradeTypes.includes(fields.grade_type)) {
    errors.push(validationError(`${path}.grade_type`, "Invalid grade type."));
  }

  return errors;
}

export function validateEvidenceMap(evidence = {}, path = "evidence") {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return [validationError(path, "Evidence must be an object keyed by field name.")];
  }

  return Object.entries(evidence).flatMap(([fieldName, field]) => validateEvidenceField(field, `${path}.${fieldName}`));
}

export function assertValidEvidenceDocument(document = {}) {
  const errors = [
    ...validateEvidenceMap(document.evidence || {}),
    ...validateResolvedFields(document.resolved || {})
  ];

  if (errors.length) {
    const error = new Error(`Evidence document validation failed: ${errors[0].path} ${errors[0].message}`);
    error.validation_errors = errors;
    throw error;
  }

  return document;
}
