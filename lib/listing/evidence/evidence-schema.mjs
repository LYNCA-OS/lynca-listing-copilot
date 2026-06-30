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
  "VECTOR_APPROVED_REFERENCE",
  "MARKETPLACE",
  "OPEN_WEB",
  "VISUAL_GUESS",
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

const observableComponentNames = Object.freeze([
  "auto",
  "patch",
  "relic",
  "jersey",
  "rc",
  "sketch",
  "redemption"
]);

export const resolvedFieldNames = Object.freeze([
  "category",
  "standardness",
  "route",
  "multi_card",
  "card_count",
  "lot_type",
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "language",
  "players",
  "character",
  "card_name",
  "team",
  "artist",
  "card_type",
  "official_card_type",
  "observable_components",
  "insert",
  "surface_color",
  "parallel_family",
  "parallel_exact",
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
  "jersey",
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
  multi_card: false,
  card_count: null,
  lot_type: null,
  year: null,
  manufacturer: null,
  brand: null,
  product: null,
  set: null,
  subset: null,
  language: null,
  players: [],
  character: null,
  card_name: null,
  team: null,
  artist: null,
  card_type: null,
  official_card_type: null,
  observable_components: [],
  insert: null,
  surface_color: null,
  parallel_family: null,
  parallel_exact: null,
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
  jersey: false,
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

function normalizeGradeCompany(value) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  if (/\bpsa\s*\/?\s*dna\b/i.test(normalized)) return "PSA/DNA";
  if (/\bpsa\b/i.test(normalized)) return "PSA";
  if (/\b(?:beckett|bgs)\b/i.test(normalized)) return "BGS";
  if (/\bsgc\b/i.test(normalized)) return "SGC";
  if (/\b(?:cgc|csg)\b/i.test(normalized)) return "CGC";
  if (/\btag\b/i.test(normalized)) return "TAG";
  if (/\b(?:hga|isa|gma|ksa|ace)\b/i.test(normalized)) return normalized.toUpperCase();
  if (/\b(?:gem|mint|mt|pristine|auth|auto|sig|grade)\b|\d/.test(normalized.toLowerCase())) return null;
  return normalized;
}

function normalizeCardType(value) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  return /^base$/i.test(normalized) ? null : normalized;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeStringOrNull).filter(Boolean);
  }

  const normalized = normalizeStringOrNull(value);
  return normalized ? [normalized] : [];
}

function normalizeObservableComponents(value) {
  const values = normalizeStringArray(value)
    .map((item) => item.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .map((item) => ({
      autograph: "auto",
      autographs: "auto",
      signature: "auto",
      signatures: "auto",
      signed: "auto",
      memorabilia: "relic",
      swatch: "relic",
      logoman: "relic",
      rookie: "rc",
      rookie_card: "rc",
      rookie_ticket: "rc",
      rated_rookie: "rc"
    }[item] || item))
    .filter((item) => observableComponentNames.includes(item));
  return [...new Set(values)];
}

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined || value === "") return false;
  return /^(true|yes|y|1|rc|rc logo|rookie|rookie card|rookie logo|rookie ticket|rated rookie|1st bowman|first bowman|auto|autograph|ssp|case hit|patch|relic|jersey|sketch|redemption|1\/1)$/i.test(normalizeStringOrNull(value) || "");
}

function normalizePositiveIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return null;
  return number;
}

function validationError(path, message) {
  return { path, message };
}

export function createVisionSource({
  sourceType = "VISION_MODEL",
  imageId = null,
  sourceCropId = null,
  side = null,
  captureRole = null,
  region = null,
  observedText = null,
  rawText = null,
  sourceInferenceMethod = null,
  sourceObjectPath = null,
  derivedObjectPath = null,
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
    source_crop_id: sourceCropId,
    source_inference_method: sourceInferenceMethod,
    source_object_path: sourceObjectPath,
    derived_object_path: derivedObjectPath,
    observed_text: observedText,
    raw_text: rawText,
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
        confidence: clampConfidence(candidate?.confidence, normalizedConfidence),
        ...(Array.isArray(candidate?.sources) && candidate.sources.length ? { sources: candidate.sources } : {})
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
  const observableComponents = normalizeObservableComponents(raw.observable_components ?? raw.observableComponents);
  const gradeType = gradeTypes.includes(raw.grade_type) ? raw.grade_type : "UNKNOWN";
  const cardCount = normalizePositiveIntegerOrNull(raw.card_count ?? raw.cardCount);
  const officialCardType = normalizeStringOrNull(raw.official_card_type || raw.officialCardType);

  return {
    ...defaultResolvedFields,
    category: normalizeStringOrNull(raw.category),
    standardness: normalizeStringOrNull(raw.standardness),
    route: normalizeStringOrNull(raw.route),
    multi_card: normalizeBoolean(raw.multi_card ?? raw.multiCard) || Number(cardCount || 0) > 1,
    card_count: cardCount,
    lot_type: normalizeStringOrNull(raw.lot_type ?? raw.lotType),
    year: normalizeStringOrNull(raw.year),
    manufacturer: normalizeStringOrNull(raw.manufacturer || raw.brand),
    brand: normalizeStringOrNull(raw.brand || raw.manufacturer),
    product: normalizeStringOrNull(raw.product),
    set: normalizeStringOrNull(raw.set),
    subset: normalizeStringOrNull(raw.subset),
    language: normalizeStringOrNull(raw.language),
    players,
    character: normalizeStringOrNull(raw.character),
    card_name: normalizeStringOrNull(raw.card_name || raw.cardName || raw.name),
    team: normalizeStringOrNull(raw.team),
    artist: normalizeStringOrNull(raw.artist),
    card_type: normalizeCardType(raw.card_type || raw.cardType),
    official_card_type: officialCardType,
    observable_components: observableComponents,
    insert: normalizeStringOrNull(raw.insert),
    surface_color: normalizeStringOrNull(raw.surface_color || raw.surfaceColor),
    parallel_family: normalizeStringOrNull(raw.parallel_family || raw.parallelFamily),
    parallel_exact: normalizeStringOrNull(raw.parallel_exact || raw.parallelExact),
    parallel: normalizeStringOrNull(raw.parallel),
    variation: normalizeStringOrNull(raw.variation),
    serial_number: normalizeStringOrNull(raw.serial_number),
    collector_number: normalizeStringOrNull(raw.collector_number),
    checklist_code: normalizeStringOrNull(raw.checklist_code),
    attributes,
    rc: normalizeBoolean(raw.rc) || observableComponents.includes("rc"),
    first_bowman: normalizeBoolean(raw.first_bowman),
    ssp: normalizeBoolean(raw.ssp),
    case_hit: normalizeBoolean(raw.case_hit),
    auto: normalizeBoolean(raw.auto) || observableComponents.includes("auto"),
    patch: normalizeBoolean(raw.patch) || observableComponents.includes("patch"),
    relic: normalizeBoolean(raw.relic) || observableComponents.includes("relic"),
    jersey: normalizeBoolean(raw.jersey) || observableComponents.includes("jersey"),
    sketch: normalizeBoolean(raw.sketch) || observableComponents.includes("sketch"),
    redemption: normalizeBoolean(raw.redemption) || observableComponents.includes("redemption"),
    one_of_one: normalizeBoolean(raw.one_of_one),
    grade_company: normalizeGradeCompany(raw.grade_company),
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

  ["players", "attributes", "observable_components"].forEach((key) => {
    if (!Array.isArray(fields[key])) {
      errors.push(validationError(`${path}.${key}`, "Field must be an array."));
    }
  });

  [
    "multi_card",
    "rc",
    "first_bowman",
    "ssp",
    "case_hit",
    "auto",
    "patch",
    "relic",
    "jersey",
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

  if (fields.card_count !== null && (!Number.isInteger(fields.card_count) || fields.card_count < 1)) {
    errors.push(validationError(`${path}.card_count`, "Field must be a positive integer or null."));
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
