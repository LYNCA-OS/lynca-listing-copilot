import { expandPrintRunFields } from "../print-run/print-run-fields.mjs";
import { normalizeGradeCompanyValue } from "../grade/grade-company.mjs";
import { gradeTypeForValues, normalizeAutoGradeValue, normalizeGradeValue } from "../grade/grade-value.mjs";
import { normalizeCardYearValue } from "../year/year-value.mjs";

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
  "MULTI_CARD_DETECTOR",
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
  "rarity",
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
  "print_run_number",
  "print_run_numerator",
  "print_run_denominator",
  "numbered_to",
  "serial_number",
  "serial_denominator",
  "numerical_rarity",
  "expected_serial_denominator",
  "card_number",
  "tcg_card_number",
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
  "suspicious_print_run",
  "print_run_review_required",
  "grade_company",
  "card_grade",
  "auto_grade",
  "cert_number",
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
  rarity: null,
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
  print_run_number: null,
  print_run_numerator: null,
  print_run_denominator: null,
  numbered_to: null,
  serial_number: null,
  serial_denominator: null,
  numerical_rarity: null,
  expected_serial_denominator: null,
  card_number: null,
  tcg_card_number: null,
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
  suspicious_print_run: false,
  print_run_review_required: false,
  grade_company: null,
  card_grade: null,
  auto_grade: null,
  cert_number: null,
  grade_type: "UNKNOWN"
});

function clampConfidence(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeJsonLikeScalarText(value) {
  const raw = String(value ?? "").trim();
  const jsonLike = raw.startsWith("[") && raw.endsWith("]") || raw.startsWith("\"") && raw.endsWith("\"");
  if (!jsonLike) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => ["string", "number"].includes(typeof item))) {
      return parsed.map((item) => String(item).trim()).filter(Boolean).join(" / ");
    }
    if (["string", "number"].includes(typeof parsed)) return String(parsed);
  } catch {
    // Bracketed card names are valid raw text; only normalize valid JSON strings.
  }
  return raw;
}

function normalizeStringOrNull(value) {
  const normalized = normalizeJsonLikeScalarText(value).replace(/\s+/g, " ").trim();
  return normalized || null;
}

const paniniProductAliases = Object.freeze(new Map([
  ["absolute", "Panini Absolute"],
  ["black", "Panini Black"],
  ["chronicles", "Panini Chronicles"],
  ["contenders", "Panini Contenders"],
  ["contenders optic", "Panini Contenders Optic"],
  ["cornerstones", "Panini Cornerstones"],
  ["court kings", "Panini Court Kings"],
  ["crown royale", "Panini Crown Royale"],
  ["donruss", "Panini Donruss"],
  ["donruss elite", "Panini Donruss Elite"],
  ["donruss optic", "Panini Donruss Optic"],
  ["elite", "Panini Elite"],
  ["eminence", "Panini Eminence"],
  ["encased", "Panini Encased"],
  ["flawless", "Panini Flawless"],
  ["gold standard", "Panini Gold Standard"],
  ["hoops", "Panini Hoops"],
  ["immaculate", "Panini Immaculate"],
  ["impeccable", "Panini Impeccable"],
  ["mosaic", "Panini Mosaic"],
  ["national treasures", "Panini National Treasures"],
  ["noir", "Panini Noir"],
  ["obsidian", "Panini Obsidian"],
  ["origins", "Panini Origins"],
  ["photogenic", "Panini Photogenic"],
  ["phoenix", "Panini Phoenix"],
  ["prizm", "Panini Prizm"],
  ["revolution", "Panini Revolution"],
  ["select", "Panini Select"],
  ["spectra", "Panini Spectra"],
  ["status", "Panini Status"],
  ["studio", "Panini Studio"],
  ["zenith", "Panini Zenith"]
]));

function productAliasKey(value = "") {
  return String(value || "")
    .replace(/\b(?:basketball|football|baseball|soccer|hockey|fifa soccer|trading cards?|cards?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeProductName(product, manufacturer, brand) {
  const normalized = normalizeStringOrNull(product);
  if (!normalized) return null;
  const publisher = normalizeStringOrNull(manufacturer || brand);
  const key = productAliasKey(normalized);
  if (/^Panini$/i.test(publisher || "") && paniniProductAliases.has(key)) {
    const alias = paniniProductAliases.get(key);
    const suffix = normalized.match(/\b(FIFA\s+Soccer)\b/i)?.[1] || "";
    if (suffix && !new RegExp(`\\b${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(alias)) {
      return `${alias} ${suffix.replace(/\s+/g, " ")}`.replace(/\s+/g, " ").trim();
    }
    return alias;
  }
  return normalized;
}

function normalizeCardType(value) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  return /^base$/i.test(normalized) ? null : normalized;
}

function normalizeStringArray(value) {
  const values = Array.isArray(value)
    ? value.map(normalizeStringOrNull).filter(Boolean)
    : [normalizeStringOrNull(value)].filter(Boolean);
  const seen = new Set();
  return values.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function personNameTokens(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function samePersonWithOptionalMiddleName(left, right) {
  const leftTokens = personNameTokens(left);
  const rightTokens = personNameTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  if (leftTokens.join(" ") === rightTokens.join(" ")) return true;
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = shorter === leftTokens ? rightTokens : leftTokens;
  return shorter.length === 2
    && longer.length > 2
    && shorter[0] === longer[0]
    && shorter[1] === longer.at(-1);
}

function normalizePlayerArray(value) {
  const players = normalizeStringArray(value);
  const normalized = [];
  for (const player of players) {
    const existingIndex = normalized.findIndex((existing) => samePersonWithOptionalMiddleName(existing, player));
    if (existingIndex < 0) {
      normalized.push(player);
      continue;
    }
    if (personNameTokens(player).length < personNameTokens(normalized[existingIndex]).length) {
      normalized[existingIndex] = player;
    }
  }
  return normalized;
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

// Serial numerators may only be displayed when they were read from the
// current card instance (printed text, slab label, focused OCR, operator
// input, or approved history of the same asset). Reference-derived sources
// (vector references, marketplace, checklists) never justify a numerator:
// the numerator identifies the physical copy, not the card identity.
const serialNumeratorDirectSourceTypes = Object.freeze(new Set([
  "CARD_FRONT",
  "CARD_BACK",
  "SLAB_LABEL",
  "OCR",
  "OPERATOR",
  "INTERNAL_APPROVED_HISTORY",
  "OFFICIAL_GRADING_DATA"
]));

export function serialNumeratorDirectProvenance(field) {
  if (!field || typeof field !== "object") return false;
  const status = String(field.status || "").toUpperCase();
  if (status === "MANUAL_CONFIRMED") return true;
  if (status !== "CONFIRMED") return false;
  const sources = Array.isArray(field.sources) ? field.sources : [];
  return sources.some((source) => serialNumeratorDirectSourceTypes.has(String(source?.source_type || "").toUpperCase()));
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
  const printRun = expandPrintRunFields(raw);
  const players = normalizePlayerArray(raw.players ?? raw.player);
  const attributes = normalizeStringArray(raw.attributes);
  const observableComponents = normalizeObservableComponents(raw.observable_components ?? raw.observableComponents);
  const cardCount = normalizePositiveIntegerOrNull(raw.card_count ?? raw.cardCount);
  const officialCardType = normalizeStringOrNull(raw.official_card_type || raw.officialCardType);

  return {
    ...defaultResolvedFields,
    category: normalizeStringOrNull(raw.category || raw.sport),
    standardness: normalizeStringOrNull(raw.standardness),
    route: normalizeStringOrNull(raw.route),
    multi_card: normalizeBoolean(raw.multi_card ?? raw.multiCard) || Number(cardCount || 0) > 1,
    card_count: cardCount,
    lot_type: normalizeStringOrNull(raw.lot_type ?? raw.lotType),
    year: normalizeCardYearValue(raw.year || raw.season_year || raw.product_year),
    manufacturer: normalizeStringOrNull(raw.manufacturer || raw.brand),
    brand: normalizeStringOrNull(raw.brand || raw.manufacturer),
    product: normalizeProductName(raw.product, raw.manufacturer || raw.brand, raw.brand),
    set: normalizeStringOrNull(raw.set || raw.set_or_insert),
    subset: normalizeStringOrNull(raw.subset),
    language: normalizeStringOrNull(raw.language),
    rarity: normalizeStringOrNull(raw.rarity),
    players,
    character: normalizeStringOrNull(raw.character),
    card_name: normalizeStringOrNull(raw.card_name || raw.cardName || raw.name),
    team: normalizeStringOrNull(raw.team),
    artist: normalizeStringOrNull(raw.artist),
    card_type: normalizeCardType(raw.card_type || raw.cardType),
    official_card_type: officialCardType,
    observable_components: observableComponents,
    insert: normalizeStringOrNull(raw.insert || raw.set_or_insert),
    surface_color: normalizeStringOrNull(raw.surface_color || raw.surfaceColor),
    parallel_family: normalizeStringOrNull(raw.parallel_family || raw.parallelFamily),
    parallel_exact: normalizeStringOrNull(raw.parallel_exact || raw.parallelExact),
    parallel: normalizeStringOrNull(raw.parallel),
    variation: normalizeStringOrNull(raw.variation),
    print_run_number: normalizeStringOrNull(raw.print_run_number || printRun.print_run_number),
    print_run_numerator: normalizeStringOrNull(raw.print_run_numerator || printRun.print_run_numerator),
    print_run_denominator: normalizeStringOrNull(raw.print_run_denominator || printRun.print_run_denominator),
    numbered_to: normalizeStringOrNull(raw.numbered_to || printRun.numbered_to),
    serial_number: normalizeStringOrNull(raw.serial_number || printRun.serial_number),
    serial_denominator: normalizeStringOrNull(raw.serial_denominator || printRun.serial_denominator),
    numerical_rarity: normalizeStringOrNull(raw.numerical_rarity || raw.numericalRarity),
    expected_serial_denominator: normalizeStringOrNull(
      raw.expected_serial_denominator
      || printRun.expected_serial_denominator
      || raw.serial_denominator
      || raw.numbered_to
      || raw.print_run_denominator
      || normalizeStringOrNull(raw.numerical_rarity || raw.numericalRarity)?.match(/\/\s*(\d{1,4})\b/)?.[1]
      || normalizeStringOrNull(raw.serial_number)?.match(/\/\s*(\d{1,4})\b/)?.[1]
    ),
    card_number: normalizeStringOrNull(raw.card_number),
    tcg_card_number: normalizeStringOrNull(raw.tcg_card_number),
    collector_number: normalizeStringOrNull(raw.collector_number || raw.card_number),
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
    one_of_one: normalizeBoolean(raw.one_of_one) || printRun.one_of_one === true,
    suspicious_print_run: normalizeBoolean(raw.suspicious_print_run) || printRun.suspicious_print_run === true,
    print_run_review_required: normalizeBoolean(raw.print_run_review_required) || printRun.print_run_review_required === true,
    grade_company: normalizeGradeCompanyValue(raw.grade_company),
    card_grade: normalizeGradeValue(raw.card_grade || raw.grade),
    auto_grade: normalizeAutoGradeValue(raw.auto_grade),
    cert_number: normalizeStringOrNull(raw.cert_number || raw.certification_number),
    grade_type: gradeTypeForValues(raw.card_grade || raw.grade, raw.auto_grade, raw.grade_type)
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
    "one_of_one",
    "suspicious_print_run",
    "print_run_review_required"
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
