import {
  createEvidenceField,
  createVisionSource,
  normalizeResolvedFields,
  assertValidEvidenceDocument
} from "./evidence-schema.mjs";
import { expandPrintRunFields } from "../print-run/print-run-fields.mjs";
import { resolveCardFields } from "../resolver/resolve-card.mjs";
import { resolveGradeFields } from "../resolver/grade-resolver.mjs";
import { normalizeAutoGradeValue, normalizeGradeType, normalizeGradeValue } from "../grade/grade-value.mjs";
import { splitCardNumber } from "../resolver/number-resolver.mjs";
import { splitParallelDescriptor } from "../../identity-resolution/parallel-taxonomy.mjs";
import { normalizeProviderFieldEvidence } from "../providers/provider-response-normalizer.mjs";

const legacyToResolvedField = Object.freeze({
  year: "year",
  manufacturer: "manufacturer",
  brand: "brand",
  product: "product",
  product_or_set: "product",
  multi_card: "multi_card",
  card_count: "card_count",
  lot_type: "lot_type",
  set: "set",
  subset: "subset",
  card_name: "card_name",
  cardName: "card_name",
  name: "card_name",
  card_type: "card_type",
  official_card_type: "official_card_type",
  officialCardType: "official_card_type",
  observable_components: "observable_components",
  observableComponents: "observable_components",
  insert: "insert",
  surface_color: "surface_color",
  surfaceColor: "surface_color",
  parallel_family: "parallel_family",
  parallelFamily: "parallel_family",
  parallel_exact: "parallel_exact",
  parallelExact: "parallel_exact",
  variant_or_parallel: "parallel_exact",
  parallel: "parallel",
  variation: "variation",
  player: "players",
  players: "players",
  subject: "players",
  character: "character",
  artist: "artist",
  team: "team",
  collector_number: "collector_number",
  checklist_code: "checklist_code",
  print_run_number: "print_run_number",
  print_run_numerator: "print_run_numerator",
  print_run_denominator: "print_run_denominator",
  numbered_to: "numbered_to",
  serial_number: "serial_number",
  serial_denominator: "serial_denominator",
  numerical_rarity: "numerical_rarity",
  numericalRarity: "numerical_rarity",
  rc: "rc",
  first_bowman: "first_bowman",
  ssp: "ssp",
  case_hit: "case_hit",
  grade_company: "grade_company",
  grade: "card_grade",
  card_grade: "card_grade",
  auto_grade: "auto_grade",
  cert_number: "cert_number",
  certification_number: "cert_number",
  grade_type: "grade_type",
  auto: "auto",
  relic: "relic",
  patch: "patch",
  jersey: "jersey",
  sketch: "sketch",
  redemption: "redemption",
  one_of_one: "one_of_one"
});

const gradeTupleResolvedFields = Object.freeze([
  "grade_company",
  "card_grade",
  "auto_grade",
  "cert_number"
]);
const gradeTupleInputFields = new Set([
  "grade",
  ...gradeTupleResolvedFields,
  "grade_type"
]);
const fullSerialEvidenceFields = new Set([
  "numerical_rarity",
  "print_run_number",
  "print_run_numerator",
  "serial_number"
]);
const structuredReferenceSourceTypes = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "INTERNAL_REGISTRY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA",
  "STRUCTURED_DATABASE",
  "VECTOR_APPROVED_REFERENCE",
  "MARKETPLACE",
  "OPEN_WEB"
]);
const structuredCurrentInstanceSourceTypes = new Set([
  "CARD_FRONT",
  "CARD_BACK",
  "SLAB_LABEL",
  "OCR",
  "OPERATOR"
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function confidenceForPayload(payload = {}) {
  const normalized = String(payload.confidence || "").toUpperCase();
  return {
    HIGH: 0.9,
    MEDIUM: 0.65,
    UNSURE: 0.5,
    LOW: 0.35,
    FAILED: 0.05
  }[normalized] ?? 0.5;
}

function clampConfidence(value, fallback = 0.5) {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.max(0, Math.min(1, fallbackNumber))
    : 0.5;
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return safeFallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return safeFallback;
  return Math.max(0, Math.min(1, number));
}

function structuredSourceType(entry = {}) {
  const raw = normalizeText(entry.source_type || entry.support_type || entry.evidence_type || entry.source || "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (["SLAB", "SLAB_LABEL", "GRADED_SLAB"].includes(raw)) return "SLAB_LABEL";
  if (["CARD_BACK", "CARD_BACK_TEXT", "CARD_BACK_PRINTED_TEXT", "BACK_PRINTED_TEXT", "BACK_TEXT"].includes(raw)) return "CARD_BACK";
  if (["CARD_FRONT", "CARD_FRONT_TEXT", "CARD_FRONT_PRINTED_TEXT", "FRONT_PRINTED_TEXT", "FRONT_TEXT"].includes(raw)) return "CARD_FRONT";
  if (["OCR", "OCR_ONLY"].includes(raw)) return "OCR";
  if (["INTERNAL_APPROVED_HISTORY", "APPROVED_HISTORY"].includes(raw)) return "INTERNAL_APPROVED_HISTORY";
  if (["INTERNAL_REGISTRY"].includes(raw)) return "INTERNAL_REGISTRY";
  if (["OFFICIAL_CHECKLIST", "CHECKLIST"].includes(raw)) return "OFFICIAL_CHECKLIST";
  if (["OFFICIAL_PRODUCT_PAGE"].includes(raw)) return "OFFICIAL_PRODUCT_PAGE";
  if (["STRUCTURED_DATABASE", "REGISTRY", "CATALOG"].includes(raw)) return "STRUCTURED_DATABASE";
  if (["VECTOR_APPROVED_REFERENCE"].includes(raw)) return "VECTOR_APPROVED_REFERENCE";
  if (["MARKETPLACE"].includes(raw)) return "MARKETPLACE";
  if (["OPEN_WEB"].includes(raw)) return "OPEN_WEB";
  if (["OFFICIAL_GRADING_DATA"].includes(raw)) return "OFFICIAL_GRADING_DATA";
  if (["OPERATOR", "HUMAN_OPERATOR", "MANUAL_OPERATOR"].includes(raw)) return "OPERATOR";
  if (["VISIBLE_SIGNATURE", "SIGNATURE", "VISION_ONLY", "VISUAL", "VISUAL_GUESS", "MODEL_VISUAL"].includes(raw)) return "VISION_MODEL";
  return "VISION_MODEL";
}

function officialGradingCurrentInstanceAuthorized(entry = {}) {
  return structuredSourceType(entry) === "OFFICIAL_GRADING_DATA"
    && entry.physical_instance_match === true;
}

function officialGradingReferenceOnly(entry = {}) {
  return structuredSourceType(entry) === "OFFICIAL_GRADING_DATA"
    && !officialGradingCurrentInstanceAuthorized(entry);
}

function structuredEntryCurrentInstance(entry = {}) {
  const sourceType = structuredSourceType(entry);
  if (sourceType === "OPERATOR" || officialGradingCurrentInstanceAuthorized(entry)) return true;
  if (!structuredCurrentInstanceSourceTypes.has(sourceType)) return false;
  const visibleText = normalizeText(
    entry.visible_text
    || entry.raw_text
    || entry.rawText
    || entry.observed_text
    || entry.text
    || entry.evidence_text
    || ""
  );
  return entry.direct_observation === true
    || entry.directly_observed === true
    || entry.visible_marker === true
    || entry.signature_visible === true
    || entry.text_visible === true
    || Boolean(visibleText)
    || Boolean(normalizeText(entry.source_image_id || entry.image_id || entry.source_crop_id || ""));
}

function entryCarriesSerialNumerator(fieldName, entry = {}) {
  if (!fullSerialEvidenceFields.has(fieldName)) return false;
  if (fieldName === "print_run_numerator") {
    return nonEmptyEvidenceValue(entry.value ?? entry.print_run_numerator) !== undefined;
  }
  return nonEmptyEvidenceValue(inferredPrintRunFieldsFromEntry(entry).print_run_numerator) !== undefined;
}

function officialReferenceCannotResolveField(fieldName, entry = {}) {
  if (!officialGradingReferenceOnly(entry)) return false;
  if (gradeTupleInputFields.has(fieldName)) return true;
  return entryCarriesSerialNumerator(fieldName, entry);
}

function structuredEvidenceKind(entry = {}, fieldName = "") {
  const raw = normalizeText(entry.evidence_kind || entry.support_kind || entry.marker_type || entry.evidence_type || "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (raw) return raw;
  if (fieldName === "rc" && entry.visible_marker === true) return "VISIBLE_RC_MARKER";
  if (fieldName === "auto" && entry.signature_visible === true) return "VISIBLE_SIGNATURE";
  if (fieldName === "auto" && entry.text_visible === true) return "VISIBLE_AUTO_TEXT";
  return "";
}

function cropMetadataForImage(image = {}) {
  return image.cropMetadata || image.crop_metadata || image.cropPlan?.crop_metadata || image.crop_plan?.crop_metadata || null;
}

function imageRegion(image = {}) {
  const metadata = cropMetadataForImage(image);
  return image.sourceRegion || image.source_region || metadata?.source_region || "";
}

function cropRegionsForField(fieldName = "") {
  return {
    year: ["year_product"],
    manufacturer: ["year_product"],
    brand: ["year_product"],
    product: ["year_product"],
    set: ["year_product"],
    players: ["subject_name", "subject_slot_1", "subject_slot_2", "subject_slot_3"],
    character: ["subject_name", "subject_slot_1", "subject_slot_2", "subject_slot_3"],
    card_type: ["card_type"],
    official_card_type: ["card_type"],
    observable_components: ["card_type", "autograph", "patch_relic"],
    insert: ["card_type"],
    auto: ["autograph"],
    patch: ["patch_relic"],
    relic: ["patch_relic"],
    jersey: ["patch_relic"],
    print_run_number: ["serial_number"],
    print_run_numerator: ["serial_number"],
    print_run_denominator: ["serial_number"],
    numbered_to: ["serial_number"],
    serial_number: ["serial_number"],
    serial_denominator: ["serial_number"],
    collector_number: ["collector_number"],
    checklist_code: ["checklist_code"],
    grade_company: ["grade_label"],
    card_grade: ["grade_label"],
    auto_grade: ["grade_label"],
    cert_number: ["grade_label"],
    grade_type: ["grade_label"],
    surface_color: ["parallel_surface", "parallel"],
    parallel_family: ["parallel_surface", "parallel"],
    parallel_exact: ["parallel_surface", "parallel"],
    parallel: ["parallel_surface", "parallel"],
    variation: ["parallel_surface", "parallel"]
  }[fieldName] || [];
}

function imageMatchesRegion(image = {}, wantedRegion = "") {
  const metadata = cropMetadataForImage(image);
  const region = imageRegion(image);
  const role = image.storageRole || image.storage_role || metadata?.crop_role || "";
  return region === wantedRegion || role === wantedRegion || role.includes(wantedRegion);
}

function imageForStructuredSource(images = [], sourceType = "", entry = {}, fieldName = "") {
  const explicitRegion = normalizeText(entry.region || entry.source_region || entry.field_region || "");
  const wantedRegions = explicitRegion ? [explicitRegion] : cropRegionsForField(fieldName);
  for (const wantedRegion of wantedRegions) {
    const regionMatch = images.find((image) => {
      return imageMatchesRegion(image, wantedRegion);
    });
    if (regionMatch) return regionMatch;
  }

  const wantedSide = sourceType === "CARD_BACK"
    ? "back"
    : sourceType === "CARD_FRONT"
      ? "front"
      : "";
  if (!wantedSide) return images[0] || {};
  return images.find((image) => {
    const text = normalizeText([
      image.side,
      image.role,
      image.captureRole,
      image.capture_role,
      image.storageRole,
      image.storage_role,
      image.name
    ].filter(Boolean).join(" ")).toLowerCase();
    return text.includes(wantedSide);
  }) || images[0] || {};
}

function structuredSource(entry = {}, {
  fieldName = "",
  images = []
} = {}) {
  const sourceType = structuredSourceType(entry);
  const image = imageForStructuredSource(images, sourceType, entry, fieldName);
  const cropMetadata = cropMetadataForImage(image);
  const side = sourceType === "CARD_BACK"
    ? "back"
    : sourceType === "CARD_FRONT"
      ? "front"
      : sourceType === "SLAB_LABEL"
        ? cropMetadata?.source_side || "front"
        : image.side || null;
  const visibleText = normalizeText(entry.visible_text || entry.raw_text || entry.rawText || entry.observed_text || entry.text || entry.evidence_text || "");
  const referenceOnly = structuredReferenceSourceTypes.has(sourceType)
    && !officialGradingCurrentInstanceAuthorized(entry);
  const directObservation = sourceType === "OPERATOR"
    || officialGradingCurrentInstanceAuthorized(entry)
    || (!referenceOnly && (
      entry.direct_observation === true
      || entry.directly_observed === true
      || entry.visible_marker === true
      || entry.signature_visible === true
      || entry.text_visible === true
      || Boolean(visibleText && sourceType !== "VISION_MODEL")
    ));
  const sourceInferenceMethod = entry.source_inference_method
    || (sourceType === "OPERATOR"
      ? "operator_input"
      : sourceType === "OFFICIAL_GRADING_DATA"
        ? officialGradingCurrentInstanceAuthorized(entry)
          ? "official_grading_instance_binding"
          : "official_grading_reference"
        : referenceOnly
          ? "structured_reference"
          : image.derived
            ? "field_crop_vision"
            : "full_card_vision");
  return {
    ...createVisionSource({
      sourceType,
      imageId: entry.source_image_id || entry.image_id || image.id || null,
      sourceCropId: entry.source_crop_id || cropMetadata?.crop_id || null,
      side,
      captureRole: image.derived ? cropMetadata?.crop_role || image.storageRole || "derived_crop" : "primary",
      region: entry.source_region || entry.region || imageRegion(image) || null,
      observedText: visibleText || normalizeText(entry.value),
      rawText: normalizeText(entry.raw_text || entry.rawText || visibleText || entry.value),
      sourceInferenceMethod,
      sourceObjectPath: cropMetadata?.source_object_path || null,
      derivedObjectPath: cropMetadata?.derived_object_path || image.objectPath || image.object_path || null,
      glareOcclusion: image.imageQuality?.glare_score ?? null,
      blurScore: image.imageQuality?.blur_score ?? null,
      trustTier: sourceType === "SLAB_LABEL" || sourceType === "OPERATOR" || sourceType === "OFFICIAL_GRADING_DATA"
        ? 1
        : sourceType === "VISION_MODEL" || referenceOnly
          ? 3
          : 1
    }),
    evidence_kind: structuredEvidenceKind(entry, fieldName) || null,
    provenance_scope: referenceOnly
      ? "REFERENCE"
      : structuredEntryCurrentInstance(entry)
        ? "CURRENT_INSTANCE"
        : "UNBOUND",
    ...(sourceType === "OPERATOR"
      ? { operator_action_id: normalizeText(entry.operator_action_id) }
      : {}),
    physical_instance_match: officialGradingCurrentInstanceAuthorized(entry) || null,
    direct_observation: directObservation,
    visible_marker: entry.visible_marker === true || null,
    signature_visible: entry.signature_visible === true || null,
    text_visible: entry.text_visible === true || null
  };
}

function structuredStatusFor(fieldName, entry = {}, confidence = 0.5) {
  const explicit = normalizeText(entry.status).toUpperCase();
  if (explicit === "CONFLICT") return "CONFLICT";
  if (structuredSourceType(entry) === "OPERATOR") return "MANUAL_CONFIRMED";
  if (officialReferenceCannotResolveField(fieldName, entry)) return "REVIEW";
  if (explicit === "MANUAL_CONFIRMED") return "REVIEW";
  if (["CONFIRMED", "REVIEW", "MISSING", "CONFLICT", "NOT_APPLICABLE"].includes(explicit)) {
    return explicit;
  }
  if (entry.review_required === true) return "REVIEW";
  if (structuredSourceType(entry) === "VISION_MODEL") return "REVIEW";
  return confidence >= 0.86 ? "CONFIRMED" : "REVIEW";
}

function structuredEvidenceField(fieldName, value, entry = {}, {
  images = [],
  fallbackConfidence = 0.5,
  resolved = {}
} = {}) {
  const hasValue = Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
  if (!hasValue || value === false) return null;
  const source = structuredSource(entry, { fieldName, images });
  const sourceText = source.raw_text || source.observed_text || value;
  const contextOnlyYear = fieldName === "year"
    && yearEvidenceTextLooksContextOnly(sourceText, { value, resolved, evidenceKind: source.evidence_kind });
  const productContextOnlySet = fieldName === "set"
    && setEvidenceTextLooksProductContextOnly(sourceText, { value, resolved });
  const downgradedContextEvidence = contextOnlyYear || productContextOnlySet;
  const unboundOfficialInstanceField = officialReferenceCannotResolveField(fieldName, entry);
  const adjustedSource = downgradedContextEvidence
    ? {
        ...source,
        source_type: "VISUAL_GUESS",
        trust_tier: Math.max(Number(source.trust_tier || 1), 6),
        direct_observation: false,
        evidence_kind: contextOnlyYear ? "YEAR_CONTEXT_TEXT" : "PRODUCT_CONTEXT_TEXT"
      }
    : source;
  const confidence = downgradedContextEvidence
    ? Math.min(clampConfidence(entry.confidence, fallbackConfidence), 0.42)
    : clampConfidence(entry.confidence, fallbackConfidence);
  return createEvidenceField({
    value,
    normalizedValue: value,
    status: downgradedContextEvidence ? "REVIEW" : structuredStatusFor(fieldName, entry, confidence),
    confidence,
    candidates: [{
      value,
      confidence,
      sources: [adjustedSource]
    }],
    sources: [adjustedSource],
    conflicts: Array.isArray(entry.conflicts) ? entry.conflicts : [],
    unresolvedReason: contextOnlyYear
      ? "year_text_is_context_or_stat_not_product_year"
      : productContextOnlySet
        ? "set_text_is_product_or_sport_context_not_exact_set"
        : entry.unresolved_reason
          || (unboundOfficialInstanceField ? "official_grading_data_not_bound_to_current_instance" : null)
          || (entry.review_required === true && structuredSourceType(entry) !== "OPERATOR"
            ? "structured_field_requires_review"
            : null)
  });
}

function yearEvidenceTextLooksContextOnly(textValue, {
  value = "",
  resolved = {},
  evidenceKind = ""
} = {}) {
  const text = normalizeText(textValue);
  if (!text) return false;
  if (textMatchesNonYearDescriptor(text, resolved)) return true;
  const normalizedEvidenceKind = normalizeText(evidenceKind).toUpperCase();
  if (normalizedEvidenceKind === "DATE" && !text.includes("-")) return true;
  const year = normalizeText(value);
  if (year && /\b(?:19|20)\d{2}\b/.test(text) && !text.includes(year)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && !/[.,;:()]/.test(text)) return false;
  return /\b(?:home runs?|runs?|rbi|hits?|games?|season|career|postseason|including|born|drafted|debut|played|batted|pitched|copyright|©|stats?|record|of\s+[A-Z][a-z]+|in\s+(?:19|20)\d{2})\b/i.test(text);
}

function textMatchesNonYearDescriptor(text = "", resolved = {}) {
  const canonical = searchable(text);
  if (!canonical) return false;
  return ["set", "insert", "subset", "card_type"].some((field) => {
    const value = searchable(resolved[field]);
    return value && (canonical === value || canonical.includes(value) || value.includes(canonical));
  });
}

function setEvidenceTextLooksProductContextOnly(textValue, {
  value = "",
  resolved = {}
} = {}) {
  const setText = normalizeText(value);
  const contextText = normalizeText(textValue);
  if (!setText || !contextText) return false;
  if (!/\b(?:league|soccer|basketball|baseball|football|hockey|ufc|wwe|nba|nfl|mlb|nhl|fifa|premier\s+league|la\s+liga|bundesliga|serie\s+a)\b/i.test(setText)) return false;

  const context = searchable(contextText);
  const product = searchable(resolved.product);
  const manufacturer = searchable(resolved.manufacturer);
  const brand = searchable(resolved.brand);
  if (product && context.includes(product) && context.includes(searchable(setText))) return true;
  return Boolean(manufacturer && brand && context.includes(manufacturer) && context.includes(brand) && context.includes(searchable(setText)));
}

function structuredEntryValue(fieldName, entry = {}, {
  aggregateGrade = false
} = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const explicitValue = nonEmptyEvidenceValue(entry.value);
  if (["print_run_number", "print_run_numerator", "print_run_denominator", "numbered_to", "serial_number", "serial_denominator", "numerical_rarity"].includes(fieldName)) {
    const inferredPrintRun = inferredPrintRunFieldsFromEntry(entry);
    if (fieldName === "print_run_number") return explicitValue ?? inferredPrintRun.print_run_number;
    if (fieldName === "print_run_numerator") return nonEmptyEvidenceValue(entry.print_run_numerator) ?? inferredPrintRun.print_run_numerator;
    if (fieldName === "print_run_denominator") return nonEmptyEvidenceValue(entry.print_run_denominator) ?? inferredPrintRun.print_run_denominator;
    if (fieldName === "numbered_to") return nonEmptyEvidenceValue(entry.numbered_to) ?? inferredPrintRun.numbered_to;
    if (fieldName === "serial_number") return explicitValue ?? inferredPrintRun.serial_number ?? inferredPrintRun.print_run_number;
    if (fieldName === "serial_denominator") return nonEmptyEvidenceValue(entry.serial_denominator) ?? inferredPrintRun.serial_denominator;
    if (fieldName === "numerical_rarity") return explicitValue ?? inferredPrintRun.print_run_number;
  }
  if (["grade_company", "card_grade", "auto_grade", "grade_type"].includes(fieldName)) {
    const inferredGrade = inferredGradeFieldsFromEntry(entry);
    if (fieldName === "grade_company") return nonEmptyEvidenceValue(entry.grade_company) ?? nonEmptyEvidenceValue(entry.company) ?? inferredGrade.grade_company ?? explicitValue;
    if (fieldName === "card_grade") return normalizeGradeValue(nonEmptyEvidenceValue(entry.card_grade) ?? nonEmptyEvidenceValue(entry.grade) ?? inferredGrade.card_grade ?? explicitValue);
    if (fieldName === "auto_grade") {
      const inferredAutoGrade = normalizeAutoGradeValue(inferredGrade.auto_grade);
      if (inferredAutoGrade) return inferredAutoGrade;

      const declaredGradeType = normalizeGradeType(nonEmptyEvidenceValue(entry.grade_type) ?? nonEmptyEvidenceValue(entry.type));
      if (declaredGradeType === "CARD_ONLY") return null;
      if (aggregateGrade && !["CARD_AND_AUTO", "AUTO_ONLY"].includes(declaredGradeType)) return null;

      const explicitAutoGrade = nonEmptyEvidenceValue(entry.auto_grade) ?? nonEmptyEvidenceValue(entry.autograph_grade);
      return normalizeAutoGradeValue(explicitAutoGrade ?? (aggregateGrade ? undefined : explicitValue));
    }
    if (fieldName === "grade_type") {
      if (aggregateGrade && inferredGrade.auto_grade) return inferredGrade.grade_type;
      if (!aggregateGrade && explicitValue !== undefined) return normalizeGradeType(explicitValue);
      return normalizeGradeType(nonEmptyEvidenceValue(entry.grade_type) ?? nonEmptyEvidenceValue(entry.type) ?? inferredGrade.grade_type ?? explicitValue);
    }
  }
  if (fieldName === "cert_number") {
    return nonEmptyEvidenceValue(entry.cert_number)
      ?? nonEmptyEvidenceValue(entry.certification_number)
      ?? explicitValue;
  }
  if (["rc", "auto", "patch", "relic", "jersey", "sketch", "redemption"].includes(fieldName)) {
    return entry.value ?? entry.visible_marker ?? entry.signature_visible ?? entry.text_visible ?? entry.direct_observation;
  }
  return entry.value;
}

function nonEmptyEvidenceValue(value) {
  if (typeof value === "string") return normalizeText(value) || undefined;
  if (value === null || value === undefined) return undefined;
  return value;
}

function structuredEntryEvidenceText(entry = {}) {
  return [
    entry.value,
    entry.visible_text,
    entry.raw_text,
    entry.rawText,
    entry.observed_text,
    entry.text,
    entry.evidence_text
  ].map(normalizeText).filter(Boolean).join(" ");
}

function inferredPrintRunFieldsFromEntry(entry = {}) {
  const text = structuredEntryEvidenceText(entry);
  if (!text) return {};
  return expandPrintRunFields({
    print_run_number: text,
    serial_number: text,
    numerical_rarity: text
  });
}

function inferredGradeFieldsFromEntry(entry = {}) {
  const text = structuredEntryEvidenceText(entry);
  if (!text) return {};
  const parsed = resolveGradeFields({
    resolved: {},
    legacyFields: {
      title: text,
      model_title_suggestion: text,
      grade: text,
      grade_company: entry.grade_company || entry.company || text,
      card_grade: entry.card_grade || entry.grade || "",
      auto_grade: entry.auto_grade || entry.autograph_grade || "",
      grade_type: entry.grade_type || entry.type || ""
    }
  }).resolved || {};
  return parsed;
}

function expandStructuredFieldEvidence(fieldEvidence = {}) {
  const expanded = {};
  if (!fieldEvidence || typeof fieldEvidence !== "object" || Array.isArray(fieldEvidence)) return expanded;

  const aggregateGrade = fieldEvidence.grade;
  if (aggregateGrade && typeof aggregateGrade === "object" && !Array.isArray(aggregateGrade)) {
    ["grade_company", "card_grade", "auto_grade", "cert_number", "grade_type"].forEach((gradeField) => {
      const value = structuredEntryValue(gradeField, aggregateGrade, { aggregateGrade: true });
      if (value !== undefined && value !== null && value !== "") {
        expanded[gradeField] = { ...aggregateGrade, value };
      }
    });
  }

  Object.keys(fieldEvidence)
    .filter((fieldName) => fieldName !== "grade")
    .sort()
    .forEach((fieldName) => {
      const entry = fieldEvidence[fieldName];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      expanded[fieldName] = entry;
    });

  return expanded;
}

function structuredGradeTupleConflict(fieldEvidence = {}) {
  const expanded = expandStructuredFieldEvidence(fieldEvidence);
  return Object.entries(expanded).some(([fieldName, entry]) => gradeTupleInputFields.has(fieldName)
    && normalizeText(entry?.status).toUpperCase() === "CONFLICT");
}

function structuredEntryCanResolve(fieldName, entry = {}, {
  gradeTupleConflict = false
} = {}) {
  if (gradeTupleConflict && gradeTupleInputFields.has(fieldName)) return false;
  return !officialReferenceCannotResolveField(fieldName, entry);
}

function addReferenceDenominator(fields, fieldName, entry = {}) {
  if (!officialGradingReferenceOnly(entry) || !entryCarriesSerialNumerator(fieldName, entry)) return;
  const inferred = inferredPrintRunFieldsFromEntry(entry);
  const denominator = nonEmptyEvidenceValue(
    inferred.print_run_denominator
    ?? entry.print_run_denominator
    ?? entry.numbered_to
    ?? entry.serial_denominator
    ?? entry.expected_serial_denominator
  );
  if (denominator === undefined) return;
  if (fields.print_run_denominator === undefined) fields.print_run_denominator = denominator;
  if (fields.numbered_to === undefined) fields.numbered_to = denominator;
  if (fields.serial_denominator === undefined) fields.serial_denominator = denominator;
  if (fields.expected_serial_denominator === undefined) fields.expected_serial_denominator = denominator;
}

function legacyFieldsFromStructuredEvidence(fieldEvidence = {}) {
  const fields = {};
  const expanded = expandStructuredFieldEvidence(fieldEvidence);
  const gradeTupleConflict = structuredGradeTupleConflict(fieldEvidence);
  Object.entries(expanded).forEach(([fieldName, entry]) => {
    addReferenceDenominator(fields, fieldName, entry);
    if (!structuredEntryCanResolve(fieldName, entry, { gradeTupleConflict })) return;
    const value = structuredEntryValue(fieldName, entry);
    if (value === undefined || value === null || value === "" || value === false) return;
    if (!legacyToResolvedField[fieldName] && fieldName !== "grade_type") return;
    fields[fieldName === "card_grade" ? "card_grade" : fieldName] = value;
    if (fieldName === "card_grade" && !fields.grade) fields.grade = value;
  });
  const printRun = expandPrintRunFields(fields);
  [
    "print_run_number",
    "print_run_numerator",
    "print_run_denominator",
    "numbered_to",
    "serial_number",
    "serial_denominator",
    "expected_serial_denominator",
    "one_of_one",
    "suspicious_print_run",
    "print_run_review_required"
  ].forEach((fieldName) => {
    if (fields[fieldName] === undefined && printRun[fieldName] !== undefined) fields[fieldName] = printRun[fieldName];
  });
  if (!fields.numerical_rarity && printRun.print_run_number) fields.numerical_rarity = printRun.print_run_number;
  return fields;
}

function evidenceFromStructuredFieldEvidence(fieldEvidence = {}, {
  resolved = {},
  images = [],
  fallbackConfidence = 0.5
} = {}) {
  const expanded = expandStructuredFieldEvidence(fieldEvidence);
  const evidence = {};
  Object.entries(expanded).forEach(([fieldName, entry]) => {
    if (!legacyToResolvedField[fieldName] && fieldName !== "grade_type") return;
    const resolvedField = legacyToResolvedField[fieldName] || fieldName;
    const structuredValue = structuredEntryValue(fieldName, entry);
    const preferStructuredValue = officialReferenceCannotResolveField(fieldName, entry)
      || normalizeText(entry.status).toUpperCase() === "CONFLICT";
    const value = preferStructuredValue ? structuredValue : resolved[resolvedField] ?? structuredValue;
    const field = structuredEvidenceField(resolvedField, value, entry, {
      images,
      fallbackConfidence,
      resolved
    });
    if (field) evidence[resolvedField] = field;
  });
  return evidence;
}

export const splitLegacyCardNumber = splitCardNumber;

function searchable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reasonMentions(reasonText, terms = []) {
  return terms.some((term) => reasonText.includes(term));
}

function inferredEvidenceSourceType(fieldName, payload = {}, unresolved = []) {
  const reasonText = searchable([
    payload.reason,
    ...(Array.isArray(unresolved) ? unresolved : [])
  ].filter(Boolean).join(" "));
  const visualOnly = reasonMentions(reasonText, [
    "visual",
    "visual only",
    "visual-only",
    "visible foil",
    "foil alone",
    "foil color",
    "color only",
    "design color",
    "looks",
    "appears",
    "inferred",
    "likely",
    "guess",
    "guessed",
    "requires operator review"
  ]);
  const explicitFieldPrint = reasonMentions(reasonText, [
    "card text explicitly",
    "front card text explicitly",
    "back text explicitly",
    "visible label text",
    "label text",
    "slab label text",
    "psa label text",
    "bgs label text",
    "beckett label text",
    "cgc label text",
    "front printed text",
    "back printed text",
    "card text supports",
    "front card text supports",
    "back text supports",
    "slab label supports",
    "slab label identifies",
    "slab label clearly identifies",
    "slab label states",
    "slab label clearly states",
    "slab label says",
    "label identifies",
    "label clearly identifies",
    "label clearly states",
    "psa label supports",
    "printed parallel",
    "parallel printed",
    "printed rc",
    "rc logo printed",
    "printed rookie",
    "printed 1st bowman",
    "1st bowman printed",
    "card says",
    "label states",
    "explicitly states"
  ]);
  const registrySupport = reasonMentions(reasonText, [
    "registry supports",
    "checklist supports",
    "official checklist supports",
    "structured database supports"
  ]);
  const explicitPrinted = reasonMentions(reasonText, [
    "card text",
    "card front",
    "front card text",
    "front and back images confirm",
    "front and back image confirms",
    "front and back confirms",
    "front image confirms",
    "back image confirms",
    "front confirms",
    "back confirms",
    "product text",
    "printed",
    "explicit",
    "explicitly",
    "supports",
    "states",
    "shows",
    "visible",
    "serial visible"
  ]);
  const backPrinted = reasonMentions(reasonText, [
    "back text",
    "back side",
    "back side",
    "back side",
    "back-side",
    "reverse text",
    "printed on the back",
    "card code"
  ]);
  const slabLabel = reasonMentions(reasonText, [
    "slab",
    "label",
    "psa",
    "bgs",
    "beckett",
    "cgc"
  ]);
  const slabIdentitySupport = reasonMentions(reasonText, [
    "slab text supports",
    "label supports",
    "label explicitly supports",
    "label text",
    "label identifies",
    "label clearly identifies",
    "slab label text",
    "slab label identifies",
    "slab label clearly identifies",
    "psa label text",
    "psa label supports",
    "bgs label text",
    "bgs label supports",
    "beckett label text",
    "beckett label supports",
    "cgc label text",
    "cgc label supports"
  ]);
  const mixedPrintedAndSlab = slabLabel && reasonMentions(reasonText, [
    "card text supports",
    "front card text supports",
    "back text supports",
    "product text supports",
    "card-issued"
  ]);

  if (slabLabel && (fieldName.startsWith("grade_") || fieldName === "card_grade" || fieldName === "auto_grade" || fieldName === "cert_number" || fieldName === "grade_type" || (slabIdentitySupport && !mixedPrintedAndSlab))) {
    return "SLAB_LABEL";
  }

  if (["surface_color", "parallel_family", "parallel_exact", "parallel", "variation", "ssp", "case_hit"].includes(fieldName)) {
    if (registrySupport) return "STRUCTURED_DATABASE";
    if (visualOnly || !explicitFieldPrint) return "VISION_MODEL";
    if (slabLabel) return "SLAB_LABEL";
    if (backPrinted) return "CARD_BACK";
    return "CARD_FRONT";
  }

  if (["rc", "first_bowman", "auto", "patch", "relic", "jersey", "sketch", "redemption"].includes(fieldName)) {
    if (visualOnly) return "VISION_MODEL";
    if (backPrinted) return "CARD_BACK";
    return "CARD_FRONT";
  }

  if (backPrinted) return "CARD_BACK";
  if (explicitPrinted) return "CARD_FRONT";
  return "VISION_MODEL";
}

function fieldSourceForImages(images = [], observedText = "", {
  fieldName = "",
  payload = {},
  unresolved = []
} = {}) {
  const targetRegions = cropRegionsForField(fieldName);
  const image = targetRegions
    .map((region) => images.find((candidate) => imageMatchesRegion(candidate, region)))
    .find(Boolean) || images[0] || {};
  const cropMetadata = cropMetadataForImage(image);
  const sourceType = inferredEvidenceSourceType(fieldName, payload, unresolved);

  return createVisionSource({
    sourceType,
    imageId: image.id || null,
    sourceCropId: cropMetadata?.crop_id || null,
    side: sourceType === "CARD_BACK" ? "back" : cropMetadata?.source_side || (imageRegion(image) ? null : "front"),
    captureRole: image.derived ? cropMetadata?.crop_role || image.storageRole || "derived_crop" : "primary",
    region: imageRegion(image) || null,
    observedText,
    rawText: observedText,
    sourceInferenceMethod: image.derived ? "field_crop_vision" : "full_card_vision",
    sourceObjectPath: cropMetadata?.source_object_path || null,
    derivedObjectPath: cropMetadata?.derived_object_path || image.objectPath || image.object_path || null,
    glareOcclusion: image.imageQuality?.glare_score ?? null,
    blurScore: image.imageQuality?.blur_score ?? null,
    trustTier: image.derived ? 2 : 1
  });
}

function evidenceFromResolvedField(fieldName, value, {
  payload,
  images,
  unresolved
}) {
  const confidence = confidenceForPayload(payload);
  const textValue = Array.isArray(value) ? value : normalizeText(value);
  const hasValue = Array.isArray(textValue) ? textValue.length > 0 : Boolean(textValue);
  const unresolvedText = unresolved.join(" ").toLowerCase();
  const reviewRequested = hasValue && unresolvedText.includes(fieldName.replace(/_/g, " "));
  const status = !hasValue
    ? "MISSING"
    : reviewRequested
      ? "REVIEW"
      : confidence >= 0.86
        ? "CONFIRMED"
        : "REVIEW";

  return createEvidenceField({
    value: hasValue ? textValue : null,
    normalizedValue: hasValue ? textValue : null,
    status,
    confidence: hasValue ? confidence : 0,
    sources: hasValue ? [fieldSourceForImages(images, Array.isArray(textValue) ? textValue.join(" / ") : textValue, {
      fieldName,
      payload,
      unresolved
    })] : [],
    unresolvedReason: !hasValue
      ? "not_extracted"
      : reviewRequested
        ? "operator_review_requested"
        : null
  });
}

export function legacyFieldsToResolvedFields(fields = {}) {
  const resolvedInput = {};

  Object.entries(legacyToResolvedField).forEach(([legacyField, resolvedField]) => {
    const value = fields[legacyField];
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    if (resolvedField === "players") {
      resolvedInput.players = Array.isArray(value) ? value : [value];
    } else {
      resolvedInput[resolvedField] = value;
    }
  });

  const splitNumber = splitLegacyCardNumber(fields.card_number);
  ["serial_number", "collector_number", "checklist_code"].forEach((key) => {
    if (!resolvedInput[key] && splitNumber[key]) resolvedInput[key] = splitNumber[key];
  });

  if (fields.serial_number) resolvedInput.serial_number = fields.serial_number;
  if ((fields.parallel || fields.variation) && (!resolvedInput.surface_color || !resolvedInput.parallel_family)) {
    const descriptor = splitParallelDescriptor(fields.parallel || fields.variation);
    if (!resolvedInput.surface_color && descriptor.surface_color) resolvedInput.surface_color = descriptor.surface_color;
    if (!resolvedInput.parallel_family && descriptor.parallel_family) resolvedInput.parallel_family = descriptor.parallel_family;
  }

  return resolveCardFields({
    resolved: normalizeResolvedFields(resolvedInput),
    legacyFields: fields
  }).resolved;
}

export function resolvedFieldsToLegacyFields(resolved = {}) {
  return {
    year: resolved.year,
    brand: resolved.brand || resolved.manufacturer,
    product: resolved.product,
    multi_card: resolved.multi_card,
    card_count: resolved.card_count,
    lot_type: resolved.lot_type,
    set: resolved.set,
    subset: resolved.subset,
    official_card_type: resolved.official_card_type,
    observable_components: resolved.observable_components,
    insert: resolved.insert,
    surface_color: resolved.surface_color,
    parallel_family: resolved.parallel_family,
    parallel_exact: resolved.parallel_exact,
    parallel: resolved.parallel,
    variation: resolved.variation,
    player: Array.isArray(resolved.players) ? resolved.players.join(" / ") || null : null,
    players: resolved.players,
    character: resolved.character,
    artist: resolved.artist,
    team: resolved.team,
    card_number: resolved.checklist_code || resolved.collector_number,
    collector_number: resolved.collector_number,
    checklist_code: resolved.checklist_code,
    serial_number: resolved.serial_number,
    numerical_rarity: resolved.numerical_rarity,
    grade_company: resolved.grade_company,
    grade: resolved.card_grade,
    card_grade: resolved.card_grade,
    auto_grade: resolved.auto_grade,
    cert_number: resolved.cert_number,
    grade_type: resolved.grade_type,
    rc: resolved.rc,
    first_bowman: resolved.first_bowman,
    ssp: resolved.ssp,
    case_hit: resolved.case_hit,
    auto: resolved.auto,
    relic: resolved.relic,
    patch: resolved.patch,
    jersey: resolved.jersey,
    sketch: resolved.sketch,
    redemption: resolved.redemption,
    one_of_one: resolved.one_of_one
  };
}

function titleCasePhrase(value) {
  return normalizeText(value)
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferSlabLabelParallel(payload = {}) {
  const text = normalizeText([
    payload.reason,
    payload.title,
    payload.model_title_suggestion
  ].filter(Boolean).join(" "));
  if (!/\b(?:slab|label|psa|bgs|beckett|cgc|sgc)\b/i.test(text)) return "";

  const colors = "Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow";
  const suffixes = "Bordered|Cracked Ice|Geometric|Hyper|Mojo|Prizm|Refractor|Shimmer|Sparkle|Sparkles|Speckle|Vinyl|Wave";
  const variation = text.match(new RegExp(`\\bVariation[-\\s]+(${colors})(?:[-\\s]+(${suffixes}))?\\b`, "i"));
  if (variation) {
    const color = titleCasePhrase(variation[1]);
    const suffix = titleCasePhrase(variation[2] || "");
    return `Variation-${[color, suffix].filter(Boolean).join(" ")}`;
  }

  return "";
}

const gradePayloadFieldNames = Object.freeze([
  "grade_company",
  "grade",
  "card_grade",
  "auto_grade",
  "cert_number",
  "certification_number",
  "grade_type"
]);
const gradePayloadFieldsByEvidenceField = Object.freeze({
  grade_company: ["grade_company"],
  card_grade: ["grade", "card_grade"],
  auto_grade: ["auto_grade"],
  cert_number: ["cert_number", "certification_number"],
  grade_type: ["grade_type"]
});
const serialNumeratorPayloadFieldNames = Object.freeze([
  "print_run_number",
  "print_run_numerator",
  "serial_number",
  "numerical_rarity",
  "numericalRarity"
]);

function objectWithoutFields(value, fieldNames = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const output = { ...value };
  fieldNames.forEach((fieldName) => delete output[fieldName]);
  return output;
}

function structuredGradePayloadFieldsToSuppress(fieldEvidence = {}, {
  gradeTupleConflict = false
} = {}) {
  if (gradeTupleConflict) return [...gradePayloadFieldNames];
  const covered = new Set();
  Object.entries(expandStructuredFieldEvidence(fieldEvidence)).forEach(([fieldName, entry]) => {
    if (nonEmptyEvidenceValue(structuredEntryValue(fieldName, entry)) === undefined) return;
    const resolvedField = legacyToResolvedField[fieldName] || fieldName;
    (gradePayloadFieldsByEvidenceField[resolvedField] || []).forEach((payloadField) => covered.add(payloadField));
  });
  return gradePayloadFieldNames.filter((fieldName) => covered.has(fieldName));
}

function officialReferenceNumeratorIsOnlyInstanceEvidence(fieldEvidence = {}) {
  if (!fieldEvidence || typeof fieldEvidence !== "object" || Array.isArray(fieldEvidence)) return false;
  let hasOfficialReferenceNumerator = false;
  let hasCurrentInstanceNumerator = false;
  Object.entries(fieldEvidence).forEach(([fieldName, entry]) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !entryCarriesSerialNumerator(fieldName, entry)) return;
    if (officialGradingReferenceOnly(entry)) hasOfficialReferenceNumerator = true;
    if (structuredEntryCurrentInstance(entry)) hasCurrentInstanceNumerator = true;
  });
  return hasOfficialReferenceNumerator && !hasCurrentInstanceNumerator;
}

function withStructuredGradeAuthority(resolved = {}, gradeAuthorityFields = {}, {
  gradeTupleConflict = false
} = {}) {
  if (gradeTupleConflict) {
    return {
      ...resolved,
      grade_company: null,
      card_grade: null,
      auto_grade: null,
      cert_number: null,
      grade_type: "UNKNOWN"
    };
  }

  const structuredGrade = legacyFieldsToResolvedFields(gradeAuthorityFields);
  return {
    ...resolved,
    grade_company: structuredGrade.grade_company,
    card_grade: structuredGrade.card_grade,
    auto_grade: structuredGrade.auto_grade,
    cert_number: structuredGrade.cert_number,
    grade_type: structuredGrade.grade_type
  };
}

function withoutUnboundReferenceNumerator(resolved = {}, structuredLegacyFields = {}) {
  const denominator = normalizeText(
    structuredLegacyFields.print_run_denominator
    || structuredLegacyFields.numbered_to
    || structuredLegacyFields.serial_denominator
    || structuredLegacyFields.expected_serial_denominator
    || resolved.print_run_denominator
    || resolved.numbered_to
    || resolved.serial_denominator
    || resolved.expected_serial_denominator
    || ""
  );
  if (!denominator) {
    return {
      ...resolved,
      print_run_number: null,
      print_run_numerator: null,
      serial_number: null,
      numerical_rarity: null
    };
  }

  const denominatorOnly = expandPrintRunFields({ print_run_denominator: denominator });
  return {
    ...resolved,
    print_run_number: denominatorOnly.print_run_number || `#/${denominator}`,
    print_run_numerator: null,
    print_run_denominator: denominator,
    numbered_to: denominator,
    serial_number: denominatorOnly.serial_number || `#/${denominator}`,
    serial_denominator: denominator,
    numerical_rarity: denominatorOnly.print_run_number || `#/${denominator}`,
    expected_serial_denominator: denominator
  };
}

export function providerPayloadToEvidenceDocument(payload = {}, {
  images = []
} = {}) {
  const fieldEvidence = normalizeProviderFieldEvidence(payload.field_evidence, {
    trustedOperatorEnvelope: payload
  });
  const normalizedPayload = fieldEvidence === payload.field_evidence
    ? payload
    : { ...payload, field_evidence: fieldEvidence };
  const unresolved = Array.isArray(normalizedPayload.unresolved) ? normalizedPayload.unresolved.map(normalizeText).filter(Boolean) : [];
  const inferredParallel = normalizedPayload.fields?.parallel || normalizedPayload.fields?.variation
    ? ""
    : inferSlabLabelParallel(normalizedPayload);
  const gradeTupleConflict = structuredGradeTupleConflict(fieldEvidence);
  const structuredGradeFieldsToSuppress = structuredGradePayloadFieldsToSuppress(fieldEvidence, {
    gradeTupleConflict
  });
  const hasStructuredGradeEvidence = structuredGradeFieldsToSuppress.length > 0;
  const referenceNumeratorOnly = officialReferenceNumeratorIsOnlyInstanceEvidence(fieldEvidence);
  const providerFields = objectWithoutFields(
    normalizedPayload.fields || {},
    [
      ...structuredGradeFieldsToSuppress,
      ...(referenceNumeratorOnly ? serialNumeratorPayloadFieldNames : [])
    ]
  );
  const providerResolved = objectWithoutFields(
    normalizedPayload.resolved,
    [
      ...structuredGradeFieldsToSuppress,
      ...(referenceNumeratorOnly ? serialNumeratorPayloadFieldNames : [])
    ]
  );
  const structuredLegacyFields = legacyFieldsFromStructuredEvidence(fieldEvidence);
  const gradeAuthorityFields = {
    ...(providerResolved ? resolvedFieldsToLegacyFields(providerResolved) : {}),
    ...providerFields,
    ...structuredLegacyFields
  };
  const legacyFields = {
    ...providerFields,
    ...structuredLegacyFields,
    ...(inferredParallel ? { parallel: inferredParallel } : {}),
    title: normalizedPayload.title || normalizedPayload.model_title_suggestion || ""
  };
  const resolverResult = resolveCardFields({
    resolved: providerResolved || legacyFieldsToResolvedFields(legacyFields),
    legacyFields
  });
  let resolved = resolverResult.resolved;
  if (hasStructuredGradeEvidence) {
    resolved = withStructuredGradeAuthority(resolved, gradeAuthorityFields, {
      gradeTupleConflict
    });
  }
  if (referenceNumeratorOnly) {
    resolved = withoutUnboundReferenceNumerator(resolved, structuredLegacyFields);
  }
  const structuredEvidence = evidenceFromStructuredFieldEvidence(fieldEvidence, {
    resolved,
    images,
    fallbackConfidence: confidenceForPayload(normalizedPayload)
  });
  const evidence = {};

  Object.entries(resolved).forEach(([fieldName, value]) => {
    if (fieldName === "grade_type" && value === "UNKNOWN") return;
    if (Array.isArray(value) && value.length === 0) return;
    if (value === null || value === false) return;
    if (structuredEvidence[fieldName]) {
      evidence[fieldName] = structuredEvidence[fieldName];
      return;
    }
    evidence[fieldName] = evidenceFromResolvedField(fieldName, value, {
      payload: normalizedPayload,
      images,
      unresolved
    });
  });

  Object.entries(structuredEvidence).forEach(([fieldName, field]) => {
    if (!evidence[fieldName]) evidence[fieldName] = field;
  });

  const document = {
    evidence,
    resolved,
    unresolved,
    model_title_suggestion: normalizedPayload.model_title_suggestion || normalizedPayload.title || "",
    schema_version: "evidence-fields-v1",
    resolution_trace: resolverResult.resolution_trace
  };

  return assertValidEvidenceDocument(document);
}
