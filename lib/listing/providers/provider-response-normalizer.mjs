import { providerResponseFormatError, providerSchemaError } from "./provider-errors.mjs";
import {
  evidenceFieldStatuses,
  gradeTypes,
  resolvedFieldNames,
  validateEvidenceMap
} from "../evidence/evidence-schema.mjs";
import { expandPrintRunFields } from "../print-run/print-run-fields.mjs";
import { normalizeAutoGradeValue, normalizeGradeValue } from "../grade/grade-value.mjs";

const scalarTypes = new Set(["string", "number", "boolean"]);
const arrayResolvedFields = new Set(["players", "attributes", "observable_components"]);
const booleanResolvedFields = new Set([
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
]);
const providerPayloadStringFields = ["title", "model_title_suggestion", "reason"];
const providerFieldEvidenceFields = new Set([
  ...resolvedFieldNames,
  "player",
  "subject",
  "card_number",
  "grade"
]);
const providerFieldEvidenceAliases = Object.freeze({
  player_name_on_card: "players",
  players_name_on_card: "players",
  subject_name_on_card: "players",
  subject_names_on_card: "players"
});
const fullSerialEvidenceFields = new Set([
  "numerical_rarity",
  "print_run_number",
  "print_run_numerator",
  "serial_number"
]);
const gradeTupleValueFields = Object.freeze([
  "grade_company",
  "card_grade",
  "auto_grade",
  "cert_number"
]);
const gradeTupleInputFields = new Set([
  "grade",
  ...gradeTupleValueFields,
  "grade_type"
]);
const currentInstanceEvidenceSourceTypes = new Set([
  "CARD_FRONT",
  "CARD_FRONT_TEXT",
  "CARD_FRONT_PRINTED_TEXT",
  "FRONT_PRINTED_TEXT",
  "FRONT_TEXT",
  "CARD_BACK",
  "CARD_BACK_TEXT",
  "CARD_BACK_PRINTED_TEXT",
  "BACK_PRINTED_TEXT",
  "BACK_TEXT",
  "SLAB",
  "SLAB_LABEL",
  "GRADED_SLAB",
  "OCR",
  "OCR_ONLY",
  "OPERATOR",
  "RECOGNITION_WORKER"
]);
const referenceEvidenceSourceTypes = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "APPROVED_HISTORY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "STRUCTURED_DATABASE",
  "INTERNAL_REGISTRY",
  "VECTOR_APPROVED_REFERENCE",
  "MARKETPLACE",
  "OPEN_WEB",
  "OFFICIAL_GRADING_DATA"
]);
const operatorEvidenceSourceTypes = new Set(["OPERATOR", "HUMAN_OPERATOR", "MANUAL_OPERATOR"]);
const trustedOperatorEnvelopeMarker = Symbol("trustedOperatorEvidenceEnvelope");
const trustedOperatorEntryMarker = Symbol("trustedOperatorEvidenceEntry");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedOperatorActionId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function defineTrustedOperatorMarker(target, marker, operatorActionId) {
  Object.defineProperty(target, marker, {
    value: Object.freeze({ operator_action_id: operatorActionId }),
    enumerable: true,
    configurable: false,
    writable: false
  });
  return target;
}

function signedOperatorEvidenceEntry(entry, operatorActionId) {
  if (!isPlainObject(entry)) return entry;
  const signedEntry = { ...entry };
  const sourceType = String(entry.source_type || entry.support_type || entry.evidence_type || entry.source || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!operatorEvidenceSourceTypes.has(sourceType)
    || normalizedOperatorActionId(entry.operator_action_id) !== operatorActionId) {
    return signedEntry;
  }
  return defineTrustedOperatorMarker(signedEntry, trustedOperatorEntryMarker, operatorActionId);
}

function signedOperatorFieldEvidence(fieldEvidence, operatorActionId) {
  if (Array.isArray(fieldEvidence)) {
    return fieldEvidence.map((entry) => signedOperatorEvidenceEntry(entry, operatorActionId));
  }
  if (!isPlainObject(fieldEvidence)) return fieldEvidence;
  return Object.fromEntries(Object.entries(fieldEvidence).map(([fieldName, entry]) => [
    fieldName,
    signedOperatorEvidenceEntry(entry, operatorActionId)
  ]));
}

function signedCanonicalEvidenceField(field, operatorActionId) {
  if (!isPlainObject(field)) return field;
  const signedField = signedOperatorEvidenceEntry(field, operatorActionId);
  return {
    ...signedField,
    ...(Array.isArray(field.sources)
      ? { sources: field.sources.map((source) => signedOperatorEvidenceEntry(source, operatorActionId)) }
      : {}),
    ...(Array.isArray(field.candidates)
      ? {
          candidates: field.candidates.map((candidate) => isPlainObject(candidate)
            ? {
                ...candidate,
                ...(Array.isArray(candidate.sources)
                  ? { sources: candidate.sources.map((source) => signedOperatorEvidenceEntry(source, operatorActionId)) }
                  : {})
              }
            : candidate)
        }
      : {})
  };
}

function signedProviderEvidenceMap(evidence, operatorActionId) {
  if (!isPlainObject(evidence)) return evidence;
  return Object.fromEntries(Object.entries(evidence).map(([fieldName, field]) => [
    fieldName,
    signedCanonicalEvidenceField(field, operatorActionId)
  ]));
}

// Only trusted server code should call this after authenticating and authorizing
// the operator action. The private markers cannot be produced by model JSON.
export function issueTrustedOperatorEvidenceEnvelope(payload, options = {}) {
  if (!isPlainObject(payload)) {
    throw new TypeError("Trusted operator evidence payload must be an object.");
  }
  const operatorActionId = normalizedOperatorActionId(
    options.operatorActionId ?? options.operator_action_id
  );
  if (!operatorActionId) {
    throw new TypeError("Trusted operator evidence requires operator_action_id.");
  }
  const envelope = {
    ...payload,
    ...(payload.evidence !== undefined
      ? { evidence: signedProviderEvidenceMap(payload.evidence, operatorActionId) }
      : {}),
    ...(payload.field_evidence !== undefined
      ? { field_evidence: signedOperatorFieldEvidence(payload.field_evidence, operatorActionId) }
      : {})
  };
  return defineTrustedOperatorMarker(envelope, trustedOperatorEnvelopeMarker, operatorActionId);
}

function schemaValidationError(path, message) {
  return { path, message };
}

function isScalarOrNull(value) {
  return value === null || scalarTypes.has(typeof value);
}

function validateScalarArray(value, path) {
  if (!Array.isArray(value)) return [schemaValidationError(path, "Field must be an array.")];
  return value.flatMap((item, index) => isScalarOrNull(item)
    ? []
    : [schemaValidationError(`${path}[${index}]`, "Array item must be a string, number, boolean, or null.")]);
}

function validateLegacyFields(fields, path = "fields") {
  if (!isPlainObject(fields)) {
    return [schemaValidationError(path, "Provider fields must be an object.")];
  }

  return Object.entries(fields).flatMap(([fieldName, value]) => {
    const fieldPath = `${path}.${fieldName}`;
    if (isScalarOrNull(value)) return [];
    if (Array.isArray(value)) return validateScalarArray(value, fieldPath);
    return [schemaValidationError(fieldPath, "Provider field value must be scalar, null, or an array of scalar values.")];
  });
}

function validatePartialResolvedFields(fields, path = "resolved") {
  if (!isPlainObject(fields)) {
    return [schemaValidationError(path, "Resolved fields must be an object.")];
  }

  return Object.entries(fields).flatMap(([fieldName, value]) => {
    const fieldPath = `${path}.${fieldName}`;
    if (!resolvedFieldNames.includes(fieldName)) {
      return [schemaValidationError(fieldPath, "Unknown resolved field.")];
    }
    if (arrayResolvedFields.has(fieldName)) return validateScalarArray(value, fieldPath);
    if (booleanResolvedFields.has(fieldName) && typeof value !== "boolean") {
      return [schemaValidationError(fieldPath, "Field must be boolean.")];
    }
    if (fieldName === "grade_type" && !gradeTypes.includes(value)) {
      return [schemaValidationError(fieldPath, "Invalid grade type.")];
    }
    if (fieldName === "card_count" && value !== null && (!Number.isInteger(value) || value < 1)) {
      return [schemaValidationError(fieldPath, "Field must be a positive integer or null.")];
    }
    if (!arrayResolvedFields.has(fieldName) && !booleanResolvedFields.has(fieldName) && !isScalarOrNull(value)) {
      return [schemaValidationError(fieldPath, "Resolved field must be scalar or null.")];
    }
    return [];
  });
}

function looksLikeFullEvidenceField(field) {
  return isPlainObject(field)
    && "status" in field
    && "candidates" in field
    && "sources" in field
    && "conflicts" in field;
}

function validateProviderEvidenceShorthand(field, path) {
  const errors = [];
  if (!isPlainObject(field)) {
    return [schemaValidationError(path, "Provider evidence field must be an object.")];
  }

  if (!("value" in field) && !("normalized_value" in field) && !("candidates" in field)) {
    errors.push(schemaValidationError(path, "Provider evidence shorthand must include value, normalized_value, or candidates."));
  }

  if ("value" in field && !isScalarOrNull(field.value) && !Array.isArray(field.value)) {
    errors.push(schemaValidationError(`${path}.value`, "Evidence value must be scalar, array, or null."));
  }
  if ("normalized_value" in field && !isScalarOrNull(field.normalized_value) && !Array.isArray(field.normalized_value)) {
    errors.push(schemaValidationError(`${path}.normalized_value`, "Evidence normalized_value must be scalar, array, or null."));
  }
  if ("status" in field && !evidenceFieldStatuses.includes(field.status)) {
    errors.push(schemaValidationError(`${path}.status`, "Invalid evidence field status."));
  }
  if ("confidence" in field && (!Number.isFinite(field.confidence) || field.confidence < 0 || field.confidence > 1)) {
    errors.push(schemaValidationError(`${path}.confidence`, "Confidence must be between 0 and 1."));
  }
  if ("candidates" in field && !Array.isArray(field.candidates)) {
    errors.push(schemaValidationError(`${path}.candidates`, "Candidates must be an array."));
  }
  if ("sources" in field && !Array.isArray(field.sources)) {
    errors.push(schemaValidationError(`${path}.sources`, "Sources must be an array."));
  }
  if ("conflicts" in field && !Array.isArray(field.conflicts)) {
    errors.push(schemaValidationError(`${path}.conflicts`, "Conflicts must be an array."));
  }

  return errors;
}

function validateProviderEvidenceMap(evidence, path = "evidence") {
  if (!isPlainObject(evidence)) {
    return [schemaValidationError(path, "Provider evidence must be an object keyed by field name.")];
  }

  const entries = Object.entries(evidence);
  if (!entries.length) return [];
  if (entries.every(([, field]) => looksLikeFullEvidenceField(field))) {
    return validateEvidenceMap(evidence, path);
  }

  return entries.flatMap(([fieldName, field]) => validateProviderEvidenceShorthand(field, `${path}.${fieldName}`));
}

function canonicalProviderFieldEvidenceName(value = "") {
  const fieldName = String(value || "").trim();
  return providerFieldEvidenceAliases[fieldName] || fieldName;
}

function normalizedEvidenceSourceType(evidence = {}) {
  return String(evidence.source_type || evidence.support_type || evidence.evidence_type || evidence.source || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function trustedOperatorActionId(envelope = {}) {
  return normalizedOperatorActionId(envelope?.[trustedOperatorEnvelopeMarker]?.operator_action_id);
}

function normalizedOperatorSourceClaim(evidence, trustedOperatorEnvelope) {
  if (!isPlainObject(evidence)) return evidence;
  const sourceType = normalizedEvidenceSourceType(evidence);
  if (!operatorEvidenceSourceTypes.has(sourceType)) return evidence;

  const operatorActionId = normalizedOperatorActionId(evidence.operator_action_id);
  const envelopeActionId = trustedOperatorActionId(trustedOperatorEnvelope);
  const signedEntryActionId = normalizedOperatorActionId(
    evidence?.[trustedOperatorEntryMarker]?.operator_action_id
  );
  if (operatorActionId
    && operatorActionId === envelopeActionId
    && operatorActionId === signedEntryActionId) {
    return {
      ...evidence,
      source_type: "OPERATOR",
      operator_action_id: operatorActionId
    };
  }

  const explicitStatus = String(evidence.status || "").trim().toUpperCase();
  return {
    ...evidence,
    source_type: "VISION_MODEL",
    reported_source_type: sourceType,
    status: explicitStatus === "CONFLICT" ? "CONFLICT" : "REVIEW",
    review_required: true,
    directly_observed: false,
    direct_observation: false,
    ...(Number.isInteger(evidence.trust_tier)
      ? { trust_tier: Math.max(evidence.trust_tier, 3) }
      : {}),
    provenance_scope: "UNBOUND",
    source_inference_method: "provider_model_untrusted_operator_claim",
    unresolved_reason: "operator_source_not_server_trusted"
  };
}

function evidenceEntryClaimsOperator(entry) {
  return isPlainObject(entry) && operatorEvidenceSourceTypes.has(normalizedEvidenceSourceType(entry));
}

function normalizedCanonicalEvidenceField(field, trustedOperatorEnvelope) {
  if (!isPlainObject(field)) return field;
  const originalSources = Array.isArray(field.sources) ? field.sources : [];
  const originalCandidateSources = Array.isArray(field.candidates)
    ? field.candidates.flatMap((candidate) => Array.isArray(candidate?.sources) ? candidate.sources : [])
    : [];
  const operatorClaimed = [field, ...originalSources, ...originalCandidateSources]
    .some(evidenceEntryClaimsOperator);
  const normalizedField = normalizedOperatorSourceClaim(field, trustedOperatorEnvelope);
  const sources = originalSources.map((source) => normalizedOperatorSourceClaim(source, trustedOperatorEnvelope));
  const candidates = Array.isArray(field.candidates)
    ? field.candidates.map((candidate) => isPlainObject(candidate)
      ? {
          ...candidate,
          ...(Array.isArray(candidate.sources)
            ? {
                sources: candidate.sources.map((source) => (
                  normalizedOperatorSourceClaim(source, trustedOperatorEnvelope)
                ))
              }
            : {})
        }
      : candidate)
    : field.candidates;
  const trustedOperatorPresent = normalizedEvidenceSourceType(normalizedField) === "OPERATOR"
    || sources.some((source) => normalizedEvidenceSourceType(source) === "OPERATOR");

  return {
    ...normalizedField,
    ...(Array.isArray(field.sources) ? { sources } : {}),
    ...(Array.isArray(field.candidates) ? { candidates } : {}),
    ...(operatorClaimed && !trustedOperatorPresent
      ? {
          status: String(field.status || "").trim().toUpperCase() === "CONFLICT" ? "CONFLICT" : "REVIEW",
          unresolved_reason: "operator_source_not_server_trusted"
        }
      : {})
  };
}

function normalizedProviderEvidenceMap(evidence, trustedOperatorEnvelope) {
  if (!isPlainObject(evidence)) return evidence;
  return Object.fromEntries(Object.entries(evidence).map(([fieldName, field]) => [
    fieldName,
    normalizedCanonicalEvidenceField(field, trustedOperatorEnvelope)
  ]));
}

function confidenceOrFallback(value, fallback = 0.5) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function evidenceHasVisibleSupport(evidence = {}) {
  if (evidence.visible_marker === true || evidence.signature_visible === true || evidence.text_visible === true) {
    return true;
  }
  return [
    evidence.visible_text,
    evidence.raw_text,
    evidence.rawText,
    evidence.observed_text,
    evidence.text
  ].some((value) => String(value ?? "").trim() !== "");
}

function officialGradingCurrentInstanceAuthorized(evidence = {}) {
  return normalizedEvidenceSourceType(evidence) === "OFFICIAL_GRADING_DATA"
    && evidence.physical_instance_match === true;
}

function evidenceHasCurrentImageBinding(evidence = {}) {
  return [
    evidence.source_image_id,
    evidence.image_id,
    evidence.source_crop_id
  ].some((value) => String(value ?? "").trim() !== "");
}

function evidenceIsExplicitlyDirect(evidence = {}) {
  const sourceType = normalizedEvidenceSourceType(evidence);
  return sourceType === "OPERATOR"
    || officialGradingCurrentInstanceAuthorized(evidence)
    || evidence.direct_observation === true
    || evidence.directly_observed === true;
}

function evidenceProvenanceScope(evidence = {}) {
  const sourceType = normalizedEvidenceSourceType(evidence);
  if (sourceType === "OFFICIAL_GRADING_DATA") {
    return officialGradingCurrentInstanceAuthorized(evidence) ? "CURRENT_INSTANCE" : "REFERENCE";
  }
  if (referenceEvidenceSourceTypes.has(sourceType)) return "REFERENCE";
  if (sourceType === "OPERATOR") return "CURRENT_INSTANCE";
  if (currentInstanceEvidenceSourceTypes.has(sourceType)
    && (evidenceIsExplicitlyDirect(evidence)
      || evidenceHasVisibleSupport(evidence)
      || evidenceHasCurrentImageBinding(evidence))) {
    return "CURRENT_INSTANCE";
  }
  return "UNBOUND";
}

function fullPrintRunObservation(fieldName, evidence = {}) {
  if (!fullSerialEvidenceFields.has(fieldName) || !isPlainObject(evidence)) return null;
  const textCandidates = [
    fieldName === "print_run_numerator" ? null : evidence.value,
    evidence.visible_text,
    evidence.raw_text,
    evidence.rawText,
    evidence.observed_text,
    evidence.text
  ];

  let expanded = {};
  for (const value of textCandidates) {
    expanded = expandPrintRunFields(value);
    if (expanded.print_run_numerator && expanded.print_run_denominator && !expanded.suspicious_print_run) break;
  }
  if ((!expanded.print_run_numerator || !expanded.print_run_denominator) && fieldName === "print_run_numerator") {
    expanded = expandPrintRunFields({
      print_run_numerator: evidence.value ?? evidence.print_run_numerator,
      print_run_denominator: evidence.print_run_denominator
        ?? evidence.numbered_to
        ?? evidence.serial_denominator
        ?? evidence.expected_serial_denominator
    });
  }

  const numerator = Number(expanded.print_run_numerator);
  const denominator = Number(expanded.print_run_denominator);
  if (!Number.isInteger(numerator) || numerator < 1
    || !Number.isInteger(denominator) || denominator < 1
    || numerator > denominator
    || expanded.suspicious_print_run) {
    return null;
  }
  return {
    key: `${numerator}/${denominator}`,
    value: expanded.print_run_number && !expanded.print_run_number.startsWith("#/")
      ? expanded.print_run_number
      : `${expanded.print_run_numerator}/${expanded.print_run_denominator}`
  };
}

function currentInstanceFullPrintRunObservation(fieldName, evidence = {}) {
  if (evidenceProvenanceScope(evidence) !== "CURRENT_INSTANCE") {
    return null;
  }
  return fullPrintRunObservation(fieldName, evidence);
}

function stableJson(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function compareStableText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function evidenceCandidateStrength(fieldName, candidate = {}) {
  const evidence = isPlainObject(candidate.evidence) ? candidate.evidence : {};
  const scope = evidenceProvenanceScope(evidence);
  const currentInstanceSource = scope === "CURRENT_INSTANCE";
  const referenceSource = scope === "REFERENCE";
  const explicitlyDirect = evidenceIsExplicitlyDirect(evidence);
  const visibleSupport = evidenceHasVisibleSupport(evidence);
  // Completeness only breaks ties after provenance; reference numerators must
  // never outrank evidence tied to the current physical card.
  return [
    currentInstanceSource && (explicitlyDirect || visibleSupport) ? 1 : 0,
    currentInstanceSource ? 1 : 0,
    referenceSource ? 0 : 1,
    fullPrintRunObservation(fieldName, evidence) ? 1 : 0,
    explicitlyDirect ? 1 : 0,
    visibleSupport ? 1 : 0,
    evidence.review_required === false ? 1 : 0,
    confidenceOrFallback(evidence.confidence),
    candidate.canonical === true ? 1 : 0
  ];
}

function compareEvidenceCandidates(fieldName, left, right) {
  const leftStrength = evidenceCandidateStrength(fieldName, left);
  const rightStrength = evidenceCandidateStrength(fieldName, right);
  for (let index = 0; index < leftStrength.length; index += 1) {
    if (leftStrength[index] !== rightStrength[index]) return rightStrength[index] - leftStrength[index];
  }
  return compareStableText(stableJson(left.evidence), stableJson(right.evidence));
}

function uniqueSortedConflicts(conflicts = []) {
  const byKey = new Map();
  conflicts.forEach((conflict) => {
    const key = stableJson(conflict);
    if (!byKey.has(key)) byKey.set(key, conflict);
  });
  return [...byKey.entries()]
    .sort(([left], [right]) => compareStableText(left, right))
    .map(([, conflict]) => conflict);
}

function normalizedObservationText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstObservationValue(values = []) {
  return values.find((value) => value !== null
    && value !== undefined
    && (typeof value !== "string" || value.trim() !== ""));
}

function normalizedGradeCompanyObservation(value) {
  const text = normalizedObservationText(value);
  if (!text) return null;
  if (/\bPSA\s*\/?\s*DNA\b/i.test(text)) return "PSA/DNA";
  if (/\b(?:BECKETT|BGS)\b/i.test(text)) return "BGS";
  if (/\b(?:CGC|CSG)\b/i.test(text)) return "CGC";
  const known = text.match(/\b(PSA|SGC|TAG|CCIC|GTBC|BGN|HGA|ISA|GMA|KSA|ACE)\b/i)?.[1];
  if (known) return known.toUpperCase();
  if (/\b(?:GEM|MINT|MT|PRISTINE|AUTH|AUTO|SIG|GRADE)\b|\d/i.test(text)) return null;
  return text.toUpperCase();
}

function gradeObservationTextCandidates(evidence = {}) {
  return [
    evidence.value,
    evidence.visible_text,
    evidence.raw_text,
    evidence.rawText,
    evidence.observed_text,
    evidence.text
  ].map(normalizedObservationText).filter(Boolean);
}

function gradeTupleComponents(fieldName, evidence = {}) {
  if (!gradeTupleInputFields.has(fieldName) || !isPlainObject(evidence)) return {};
  const textCandidates = gradeObservationTextCandidates(evidence);
  const aggregateText = textCandidates.join(" ");
  const result = {};

  const companyInput = firstObservationValue([
    evidence.grade_company,
    evidence.company,
    fieldName === "grade_company" ? evidence.value ?? evidence.normalized_value : undefined,
    fieldName === "grade" ? aggregateText : undefined
  ]);
  const gradeCompany = normalizedGradeCompanyObservation(companyInput);
  if (gradeCompany) result.grade_company = { key: gradeCompany, value: gradeCompany };

  const cardGradeInput = firstObservationValue([
    evidence.card_grade,
    evidence.grade,
    fieldName === "card_grade" ? evidence.value ?? evidence.normalized_value : undefined,
    fieldName === "grade" ? aggregateText : undefined
  ]);
  let cardGrade = normalizeGradeValue(cardGradeInput);

  const autoGradeInput = firstObservationValue([
    evidence.auto_grade,
    evidence.autograph_grade,
    fieldName === "auto_grade" ? evidence.value ?? evidence.normalized_value : undefined,
    fieldName === "grade" ? aggregateText : undefined
  ]);
  let autoGrade = normalizeAutoGradeValue(autoGradeInput);
  if (fieldName === "grade" && (!cardGrade || !autoGrade)) {
    const slashGrade = aggregateText.match(/\b(10(?:\.0)?|[1-9](?:\.\d)?)\s*\/\s*(10(?:\.0)?|[1-9](?:\.\d)?)\b/);
    if (slashGrade) {
      cardGrade ||= normalizeGradeValue(slashGrade[1]);
      autoGrade ||= normalizeAutoGradeValue(slashGrade[2]);
    }
  }
  if (cardGrade) result.card_grade = { key: cardGrade, value: cardGrade };
  if (autoGrade) result.auto_grade = { key: autoGrade, value: autoGrade };

  const certInput = firstObservationValue([
    evidence.cert_number,
    evidence.certification_number,
    fieldName === "cert_number" ? evidence.value ?? evidence.normalized_value : undefined
  ]);
  const certNumber = normalizedObservationText(certInput);
  if (certNumber) {
    result.cert_number = { key: certNumber.toUpperCase(), value: certNumber };
  }
  return result;
}

function gradeObservationKey(fieldName, evidence = {}) {
  const explicitObservation = firstObservationValue([
    evidence.grade_tuple_id,
    evidence.observation_id,
    evidence.source_observation_id,
    evidence.evidence_group_id
  ]);
  if (explicitObservation !== undefined) {
    return `observation:${normalizedObservationText(explicitObservation)}`;
  }

  const sourceImageId = firstObservationValue([evidence.source_image_id, evidence.image_id]);
  if (sourceImageId !== undefined) return `image:${normalizedObservationText(sourceImageId)}`;
  if (evidence.source_crop_id !== undefined && evidence.source_crop_id !== null) {
    return `crop:${normalizedObservationText(evidence.source_crop_id)}`;
  }

  const sourceType = normalizedEvidenceSourceType(evidence);
  if (sourceType === "OPERATOR") {
    const operatorBinding = firstObservationValue([
      evidence.operator_action_id,
      evidence.operator_id,
      evidence.review_id,
      evidence.session_id
    ]);
    return `operator:${normalizedObservationText(operatorBinding ?? "payload")}`;
  }
  if (officialGradingCurrentInstanceAuthorized(evidence)) {
    const officialBinding = firstObservationValue([
      evidence.source_record_id,
      evidence.physical_instance_id,
      evidence.source_asset_id,
      evidence.asset_id
    ]);
    return `official-bound:${normalizedObservationText(officialBinding ?? "payload")}`;
  }
  if (currentInstanceEvidenceSourceTypes.has(sourceType)) {
    return `implicit-current-source:${sourceType}`;
  }

  const visibleText = gradeObservationTextCandidates(evidence).join(" ").toUpperCase();
  if (visibleText) return `text:${visibleText}`;
  return `entry:${sourceType}:${fieldName}:${stableJson(evidence)}`;
}

function compareConflictValues(fieldName, left, right) {
  if (["card_grade", "auto_grade"].includes(fieldName)) {
    const leftNumber = Number(left.key);
    const rightNumber = Number(right.key);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
  }
  return compareStableText(left.key, right.key);
}

function gradeObservationPlan(entries = []) {
  const currentEntries = entries.filter((entry) => gradeTupleInputFields.has(entry.fieldName)
    && evidenceProvenanceScope(entry.evidence) === "CURRENT_INSTANCE");
  if (!currentEntries.length) {
    return { current: false, selectedKey: null, conflicts: [], conflictFields: new Set() };
  }

  const groups = new Map();
  const valuesByField = new Map(gradeTupleValueFields.map((fieldName) => [fieldName, new Map()]));
  currentEntries.forEach((entry) => {
    const key = entry.gradeObservationKey;
    if (!groups.has(key)) groups.set(key, { key, entries: [], valuesByField: new Map() });
    const group = groups.get(key);
    group.entries.push(entry);
    Object.entries(gradeTupleComponents(entry.fieldName, entry.evidence)).forEach(([fieldName, component]) => {
      if (!group.valuesByField.has(fieldName)) group.valuesByField.set(fieldName, new Map());
      group.valuesByField.get(fieldName).set(component.key, component);
      valuesByField.get(fieldName).set(component.key, component);
    });
  });

  const conflicts = gradeTupleValueFields.flatMap((fieldName) => {
    const values = [...valuesByField.get(fieldName).values()].sort((left, right) => compareConflictValues(fieldName, left, right));
    if (values.length <= 1) return [];
    return [{
      field: fieldName,
      reason: "provider_current_instance_grade_tuple_conflict",
      values: values.map((value) => value.value)
    }];
  });
  const conflictFields = new Set(conflicts.map((conflict) => conflict.field));

  function groupStrength(group) {
    const fields = new Set(group.valuesByField.keys());
    const confidences = group.entries.map((entry) => confidenceOrFallback(entry.evidence?.confidence));
    const averageConfidence = confidences.reduce((sum, value) => sum + value, 0) / Math.max(confidences.length, 1);
    return [
      [...conflictFields].filter((fieldName) => fields.has(fieldName)).length,
      group.entries.some((entry) => normalizedEvidenceSourceType(entry.evidence) === "OPERATOR") ? 1 : 0,
      fields.has("grade_company") && (fields.has("card_grade") || fields.has("auto_grade")) ? 1 : 0,
      fields.size,
      group.entries.some((entry) => evidenceIsExplicitlyDirect(entry.evidence)) ? 1 : 0,
      averageConfidence
    ];
  }

  const selected = [...groups.values()].sort((left, right) => {
    const leftStrength = groupStrength(left);
    const rightStrength = groupStrength(right);
    for (let index = 0; index < leftStrength.length; index += 1) {
      if (leftStrength[index] !== rightStrength[index]) return rightStrength[index] - leftStrength[index];
    }
    return compareStableText(
      stableJson(left.entries.map((entry) => ({ fieldName: entry.fieldName, evidence: entry.evidence })).sort((a, b) => compareStableText(stableJson(a), stableJson(b)))),
      stableJson(right.entries.map((entry) => ({ fieldName: entry.fieldName, evidence: entry.evidence })).sort((a, b) => compareStableText(stableJson(a), stableJson(b))))
    );
  })[0];

  return {
    current: true,
    selectedKey: selected?.key || null,
    conflicts,
    conflictFields
  };
}

function candidatesForGradeObservation(fieldName, candidates = [], plan = {}) {
  if (!gradeTupleInputFields.has(fieldName) || !plan.current || !plan.selectedKey) return candidates;
  return candidates.filter((candidate) => evidenceProvenanceScope(candidate.evidence) === "CURRENT_INSTANCE"
    && candidate.gradeObservationKey === plan.selectedKey);
}

function withGradeTupleConflict(fieldName, evidence, plan = {}) {
  if (!isPlainObject(evidence) || !gradeTupleInputFields.has(fieldName) || !plan.conflicts?.length) return evidence;
  return {
    ...evidence,
    status: "CONFLICT",
    review_required: true,
    unresolved_reason: "conflicting_current_instance_grade_tuple",
    conflicts: uniqueSortedConflicts([
      ...(Array.isArray(evidence.conflicts) ? evidence.conflicts : []),
      ...plan.conflicts
    ])
  };
}

function mergedProviderFieldEvidence(fieldName, candidates = []) {
  if (candidates.length <= 1) return candidates[0]?.evidence;
  const sorted = [...candidates].sort((left, right) => compareEvidenceCandidates(fieldName, left, right));
  const winner = sorted[0]?.evidence;
  if (!isPlainObject(winner)) return winner;

  const conflicts = sorted.flatMap(({ evidence }) => Array.isArray(evidence?.conflicts) ? evidence.conflicts : []);
  const fullObservations = new Map();
  sorted.forEach(({ evidence }) => {
    // A historical/reference copy may support a denominator, but its numerator
    // belongs to another physical card and must neither win nor create a false
    // conflict with the current image.
    const observation = currentInstanceFullPrintRunObservation(fieldName, evidence);
    if (!observation || fullObservations.has(observation.key)) return;
    fullObservations.set(observation.key, observation.value);
  });
  const conflictingFullValues = [...fullObservations.entries()]
    .sort(([left], [right]) => compareStableText(left, right));
  if (conflictingFullValues.length > 1) {
    conflicts.push({
      field: fieldName,
      reason: "provider_full_serial_numerator_conflict",
      values: conflictingFullValues.map(([, value]) => value)
    });
  }

  const mergedConflicts = uniqueSortedConflicts(conflicts);
  const hasFullSerialConflict = conflictingFullValues.length > 1
    || mergedConflicts.some((conflict) => conflict?.reason === "provider_full_serial_numerator_conflict");
  return {
    ...winner,
    ...(mergedConflicts.length ? { conflicts: mergedConflicts } : {}),
    ...(hasFullSerialConflict
      ? {
          status: "CONFLICT",
          review_required: true,
          unresolved_reason: "conflicting_full_serial_numerator"
        }
      : {})
  };
}

export function normalizeProviderFieldEvidence(fieldEvidence, {
  trustedOperatorEnvelope = null
} = {}) {
  if (!isPlainObject(fieldEvidence) && !Array.isArray(fieldEvidence)) return fieldEvidence;
  const normalized = {};
  const grouped = new Map();
  const gradeEntries = [];
  const entries = isPlainObject(fieldEvidence)
    ? Object.entries(fieldEvidence).map(([fieldName, evidence]) => ({
        fieldName,
        evidence: normalizedOperatorSourceClaim(evidence, trustedOperatorEnvelope),
        canonical: canonicalProviderFieldEvidenceName(fieldName) === fieldName
      }))
    : fieldEvidence.map((entry, index) => {
        if (!isPlainObject(entry)) return { invalidKey: `__invalid_${index}`, evidence: entry };
        const { field, field_name: fieldNameAlias, ...evidence } = entry;
        const fieldName = field || fieldNameAlias;
        return {
          fieldName,
          evidence: normalizedOperatorSourceClaim(evidence, trustedOperatorEnvelope),
          canonical: canonicalProviderFieldEvidenceName(fieldName) === fieldName
        };
      });

  entries.forEach((entry, index) => {
    if (entry.invalidKey) {
      normalized[entry.invalidKey] = entry.evidence;
      return;
    }
    const fieldName = canonicalProviderFieldEvidenceName(entry.fieldName);
    if (!fieldName) {
      normalized[`__invalid_${index}`] = entry.evidence;
      return;
    }
    if (!grouped.has(fieldName)) grouped.set(fieldName, []);
    const candidate = {
      evidence: entry.evidence,
      canonical: entry.canonical,
      gradeObservationKey: gradeObservationKey(fieldName, entry.evidence)
    };
    grouped.get(fieldName).push(candidate);
    gradeEntries.push({ fieldName, ...candidate });
  });

  const gradePlan = gradeObservationPlan(gradeEntries);
  grouped.forEach((candidates, fieldName) => {
    const selectedCandidates = candidatesForGradeObservation(fieldName, candidates, gradePlan);
    if (!selectedCandidates.length) return;
    const merged = mergedProviderFieldEvidence(fieldName, selectedCandidates);
    normalized[fieldName] = withGradeTupleConflict(fieldName, merged, gradePlan);
  });
  return normalized;
}

function withoutUnknownProviderFieldEvidence(payload = {}) {
  const fieldEvidence = payload.field_evidence;
  if (!isPlainObject(fieldEvidence)) return payload;

  const acceptedEvidence = {};
  const rejections = Array.isArray(payload.provider_field_rejections)
    ? [...payload.provider_field_rejections]
    : [];
  let rejectedCount = 0;

  for (const [fieldName, evidence] of Object.entries(fieldEvidence)) {
    if (providerFieldEvidenceFields.has(fieldName)) {
      acceptedEvidence[fieldName] = evidence;
      continue;
    }

    rejectedCount += 1;
    rejections.push({
      field: fieldName,
      value: isPlainObject(evidence) && "value" in evidence ? evidence.value : null,
      reason: "unknown_provider_field_evidence_key"
    });
  }

  if (!rejectedCount) return payload;
  return {
    ...payload,
    field_evidence: acceptedEvidence,
    provider_field_rejections: rejections
  };
}

function validateProviderFieldEvidence(fieldEvidence, path = "field_evidence") {
  const normalizedFieldEvidence = normalizeProviderFieldEvidence(fieldEvidence);
  if (!isPlainObject(normalizedFieldEvidence)) {
    return [schemaValidationError(path, "Provider field_evidence must be an object keyed by field name.")];
  }

  return Object.entries(normalizedFieldEvidence).flatMap(([fieldName, evidence]) => {
    const fieldPath = `${path}.${fieldName}`;
    const errors = [];
    if (!providerFieldEvidenceFields.has(fieldName)) {
      errors.push(schemaValidationError(fieldPath, "Unknown structured field evidence key."));
    }
    if (!isPlainObject(evidence)) {
      errors.push(schemaValidationError(fieldPath, "Structured field evidence must be an object."));
      return errors;
    }
    if ("value" in evidence && !isScalarOrNull(evidence.value) && !Array.isArray(evidence.value)) {
      errors.push(schemaValidationError(`${fieldPath}.value`, "Structured evidence value must be scalar, array, or null."));
    }
    ["grade_company", "card_grade", "auto_grade", "cert_number", "certification_number", "grade_type", "support_type", "evidence_type", "evidence_kind", "visible_text", "source_type", "source_image_id", "source_region", "region", "raw_text", "status", "unresolved_reason"].forEach((key) => {
      if (key in evidence && evidence[key] !== null && evidence[key] !== undefined && typeof evidence[key] !== "string") {
        errors.push(schemaValidationError(`${fieldPath}.${key}`, "Structured evidence field must be a string."));
      }
    });
    ["confidence"].forEach((key) => {
      if (key in evidence && evidence[key] !== null && evidence[key] !== undefined && (!Number.isFinite(Number(evidence[key])) || Number(evidence[key]) < 0 || Number(evidence[key]) > 1)) {
        errors.push(schemaValidationError(`${fieldPath}.${key}`, "Structured evidence confidence must be between 0 and 1."));
      }
    });
    ["review_required", "visible_marker", "signature_visible", "text_visible", "direct_observation", "directly_observed", "physical_instance_match"].forEach((key) => {
      if (key in evidence && evidence[key] !== null && evidence[key] !== undefined && typeof evidence[key] !== "boolean") {
        errors.push(schemaValidationError(`${fieldPath}.${key}`, "Structured evidence flag must be boolean."));
      }
    });
    return errors;
  });
}

function validateVectorCandidateDecision(decision, path = "vector_candidate_decision") {
  if (!isPlainObject(decision)) {
    return [schemaValidationError(path, "Vector candidate decision must be an object.")];
  }
  const errors = [];
  const allowedDecisionValues = new Set(["SELECTED", "PARTIAL_SUPPORT", "REJECTED_ALL", "NOT_AVAILABLE"]);
  if (!allowedDecisionValues.has(decision.decision)) {
    errors.push(schemaValidationError(`${path}.decision`, "Invalid vector candidate decision."));
  }
  if (decision.selected_candidate_id !== null
    && decision.selected_candidate_id !== undefined
    && typeof decision.selected_candidate_id !== "string") {
    errors.push(schemaValidationError(`${path}.selected_candidate_id`, "Selected candidate id must be a string or null."));
  }
  ["supported_fields", "rejected_fields", "conflicts"].forEach((key) => {
    if (!Array.isArray(decision[key])) {
      errors.push(schemaValidationError(`${path}.${key}`, "Field must be an array."));
      return;
    }
    decision[key].forEach((item, index) => {
      if (typeof item !== "string") {
        errors.push(schemaValidationError(`${path}.${key}[${index}]`, "Array item must be a string."));
      }
    });
  });
  return errors;
}

const directCodeEvidenceFields = Object.freeze([
  "collector_number",
  "checklist_code",
  "card_number",
  "tcg_card_number"
]);

function providerValuePresent(value) {
  if (Array.isArray(value)) return value.some(providerValuePresent);
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  return String(value).trim() !== "";
}

function escapedLiteralPattern(value) {
  const parts = String(value || "").toUpperCase().match(/[A-Z0-9]+/g) || [];
  if (!parts.length) return null;
  return new RegExp(
    `(?:^|[^A-Z0-9])${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^A-Z0-9]*")}(?:$|[^A-Z0-9])`,
    "i"
  );
}

function directlyObservedCodeEvidence(entry = {}, expectedValue = "") {
  if (!isPlainObject(entry)) return false;
  const directlyObserved = entry.directly_observed === true || entry.direct_observation === true;
  const visibleText = [entry.visible_text, entry.raw_text].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  const sourceType = String(entry.source_type || entry.support_type || "").trim().toUpperCase();
  const literalPattern = escapedLiteralPattern(expectedValue);
  return directlyObserved
    && Boolean(visibleText)
    && Boolean(literalPattern?.test(visibleText.toUpperCase()))
    && !["", "NONE", "VISION_ONLY", "MODEL_INFERENCE", "VISUAL_GUESS"].includes(sourceType);
}

function withUnsupportedCodesRoutedToReview(payload = {}) {
  const fields = isPlainObject(payload.fields) ? { ...payload.fields } : {};
  const resolved = isPlainObject(payload.resolved) ? { ...payload.resolved } : null;
  const evidence = isPlainObject(payload.field_evidence) ? { ...payload.field_evidence } : {};
  const unresolved = Array.isArray(payload.unresolved) ? [...payload.unresolved] : [];
  const unresolvedSet = new Set(unresolved.map((field) => String(field || "").trim()));
  const rejections = Array.isArray(payload.provider_field_rejections)
    ? [...payload.provider_field_rejections]
    : [];
  let changed = false;

  for (const field of directCodeEvidenceFields) {
    const value = providerValuePresent(fields[field]) ? fields[field] : resolved?.[field];
    if (!providerValuePresent(value)) continue;
    if (directlyObservedCodeEvidence(evidence[field], value)) continue;
    if (Object.hasOwn(fields, field)) fields[field] = null;
    if (resolved && Object.hasOwn(resolved, field)) resolved[field] = null;
    if (isPlainObject(evidence[field])) {
      evidence[field] = {
        ...evidence[field],
        review_required: true,
        unresolved_reason: "printed_code_not_literally_supported_by_visible_text"
      };
    }
    rejections.push({
      field,
      value,
      reason: "printed_code_not_literally_supported_by_visible_text"
    });
    if (!unresolvedSet.has(field)) {
      unresolved.push(field);
      unresolvedSet.add(field);
    }
    changed = true;
  }

  return changed ? {
    ...payload,
    fields,
    ...(resolved ? { resolved } : {}),
    field_evidence: evidence,
    unresolved,
    provider_field_rejections: rejections
  } : payload;
}

function directlyObservedMultiCardEvidence(entry = {}) {
  if (!isPlainObject(entry)) return false;
  const directlyObserved = entry.directly_observed === true || entry.direct_observation === true;
  if (!directlyObserved) return false;
  const sourceType = String(entry.source_type || entry.source || "").trim().toUpperCase();
  if (!["OPERATOR", "RECOGNITION_WORKER", "MULTI_CARD_DETECTOR"].includes(sourceType)) {
    // A vision provider describing its own guess as "directly observed" is
    // still one model assertion. Two views of one physical card must not turn
    // into a lot unless an independent detector or the operator confirms it.
    return false;
  }
  const sourceImageId = String(entry.source_image_id || "").trim();
  if (!sourceImageId) return false;

  const structuralSignal = [
    entry.evidence_kind,
    entry.evidence_type,
    entry.source_region,
    entry.region
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  const visibleSignal = [
    entry.visible_text,
    entry.raw_text
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");

  const explicitlyMultiCardRegion = /(?:MULTI[_ -]?CARD|MULTI[_ -]?SLAB|PHYSICAL[_ -]?CARD[_ -]?COUNT|LOT[_ -]?(?:LAYOUT|GROUP)|SEPARATE[_ -]?(?:CARDS?|SLABS?))/i
    .test(structuralSignal);
  const explicitPluralObservation = /(?:\b(?:[2-9]|[1-9]\d+)\s+(?:SEPARATE\s+)?(?:CARDS?|SLABS?)\b|\b(?:CARDS?|SLABS?)\s*[Xx]\s*(?:[2-9]|[1-9]\d+)\b|\bLOT\s*(?:OF|[Xx])?\s*(?:[2-9]|[1-9]\d+)\b|\bMULTIPLE\s+(?:SEPARATE\s+)?(?:CARDS?|SLABS?)\b)/i
    .test(visibleSignal);

  // PHYSICAL_CARD_COUNT or CARD_LAYOUT alone only names a detector/task. It
  // does not prove that two uploaded views are two separate physical cards.
  return explicitlyMultiCardRegion && explicitPluralObservation;
}

function withUnsupportedMultiCardRoutedToReview(payload = {}) {
  const fields = isPlainObject(payload.fields) ? { ...payload.fields } : {};
  const resolved = isPlainObject(payload.resolved) ? { ...payload.resolved } : null;
  const evidence = isPlainObject(payload.field_evidence) ? { ...payload.field_evidence } : {};
  const multiCard = fields.multi_card === true || resolved?.multi_card === true;
  const cardCount = Number(fields.card_count ?? resolved?.card_count ?? 0);
  if (!multiCard && !(Number.isFinite(cardCount) && cardCount > 1)) return payload;

  const supported = [evidence.multi_card, evidence.card_count, evidence.lot_type]
    .some(directlyObservedMultiCardEvidence);
  if (supported) return payload;

  fields.multi_card = false;
  fields.card_count = null;
  fields.lot_type = null;
  if (resolved) {
    resolved.multi_card = false;
    resolved.card_count = null;
    resolved.lot_type = null;
  }
  // Rejected provider assertions must not survive as structured evidence.
  // Otherwise providerPayloadToEvidenceDocument can reconstruct the lot after
  // this normalizer has explicitly cleared it from fields/resolved.
  const rejectedEvidenceFields = ["multi_card", "card_count", "lot_type"]
    .filter((field) => isPlainObject(evidence[field]));
  rejectedEvidenceFields.forEach((field) => {
    delete evidence[field];
  });
  const unresolved = Array.isArray(payload.unresolved) ? [...payload.unresolved] : [];
  if (!unresolved.includes("multi_card")) unresolved.push("multi_card");
  const rejections = Array.isArray(payload.provider_field_rejections)
    ? [...payload.provider_field_rejections]
    : [];
  rejections.push({
    field: "multi_card",
    value: { multi_card: multiCard, card_count: Number.isFinite(cardCount) ? cardCount : null },
    reason: "separate_physical_cards_not_directly_observed",
    rejected_evidence_fields: rejectedEvidenceFields
  });
  return {
    ...payload,
    fields,
    ...(resolved ? { resolved } : {}),
    field_evidence: evidence,
    unresolved,
    provider_field_rejections: rejections
  };
}

function directlyObservedAutoEvidence(entry = {}) {
  if (!isPlainObject(entry)) return false;
  const directlyObserved = entry.directly_observed === true || entry.direct_observation === true;
  if (!directlyObserved) return false;
  const sourceType = String(entry.source_type || entry.support_type || "").trim().toUpperCase();
  const evidenceKind = String(entry.evidence_kind || entry.evidence_type || "").trim().toUpperCase();
  const visibleText = [entry.visible_text, entry.raw_text]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  if (/\b(?:AUTO(?:GRAPH(?:ED)?)?|CERTIFIED\s+(?:AUTO(?:GRAPH)?|SIGNATURE)|SIGNED\s+BY)\b/i.test(visibleText)) {
    return true;
  }

  const preciseSignatureKinds = new Set([
    "AUTOGRAPH_STICKER",
    "CERTIFIED_AUTOGRAPH",
    "HANDWRITTEN_INK_SIGNATURE",
    "INK_SIGNATURE",
    "ON_CARD_AUTOGRAPH"
  ]);
  const preciseSignatureSource = preciseSignatureKinds.has(sourceType) || preciseSignatureKinds.has(evidenceKind);
  const signatureMarkerVisible = entry.signature_visible === true || entry.visible_marker === true;
  return preciseSignatureSource && signatureMarkerVisible;
}

function withoutAutoTokens(values) {
  if (!Array.isArray(values)) return values;
  return values.filter((value) => !/^(?:AUTO(?:GRAPH)?|AUTOGRAPHED|SIGNATURE|SIGNED)$/i.test(String(value || "").trim()));
}

function withUnsupportedAutoRoutedToReview(payload = {}) {
  const fields = isPlainObject(payload.fields) ? { ...payload.fields } : {};
  const resolved = isPlainObject(payload.resolved) ? { ...payload.resolved } : null;
  const autoClaimed = fields.auto === true
    || resolved?.auto === true
    || (Array.isArray(fields.observable_components) && fields.observable_components.some((value) => /^AUTO$/i.test(String(value || "").trim())))
    || (Array.isArray(resolved?.observable_components) && resolved.observable_components.some((value) => /^AUTO$/i.test(String(value || "").trim())));
  if (!autoClaimed) return payload;
  const evidence = isPlainObject(payload.field_evidence) ? { ...payload.field_evidence } : {};
  if (directlyObservedAutoEvidence(evidence.auto)) return payload;

  fields.auto = false;
  if (Array.isArray(fields.observable_components)) {
    fields.observable_components = withoutAutoTokens(fields.observable_components);
  }
  if (Array.isArray(fields.tags)) fields.tags = withoutAutoTokens(fields.tags);
  if (resolved) {
    resolved.auto = false;
    if (Array.isArray(resolved.observable_components)) {
      resolved.observable_components = withoutAutoTokens(resolved.observable_components);
    }
    if (Array.isArray(resolved.attributes)) resolved.attributes = withoutAutoTokens(resolved.attributes);
  }
  if (isPlainObject(evidence.auto)) {
    evidence.auto = {
      ...evidence.auto,
      review_required: true,
      unresolved_reason: "auto_not_directly_supported_by_current_image"
    };
  }
  const unresolved = Array.isArray(payload.unresolved) ? [...payload.unresolved] : [];
  if (!unresolved.includes("auto")) unresolved.push("auto");
  const rejections = Array.isArray(payload.provider_field_rejections)
    ? [...payload.provider_field_rejections]
    : [];
  rejections.push({
    field: "auto",
    value: true,
    reason: "auto_not_directly_supported_by_current_image"
  });
  return {
    ...payload,
    fields,
    ...(resolved ? { resolved } : {}),
    field_evidence: evidence,
    unresolved,
    provider_field_rejections: rejections
  };
}

function withProviderFieldSafetyGuards(payload = {}) {
  return withUnsupportedMultiCardRoutedToReview(
    withUnsupportedAutoRoutedToReview(withUnsupportedCodesRoutedToReview(payload))
  );
}

function contentText(content) {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part.text || part.content || "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function jsonFromText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new SyntaxError("Empty provider content.");
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]);

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw error;
  }
}

function parseToolCallArguments(toolCall) {
  const functionCall = toolCall?.function || {};
  const rawArguments = functionCall.arguments || toolCall.arguments || "{}";
  return {
    name: functionCall.name || toolCall.name || "",
    arguments: typeof rawArguments === "string" ? JSON.parse(rawArguments) : rawArguments
  };
}

export function parseProviderMessagePayload(message = {}) {
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  let parsedToolCall = null;
  try {
    parsedToolCall = toolCalls
      .map(parseToolCallArguments)
      .find((toolCall) => toolCall.name === "submit_card_evidence");
  } catch (error) {
    throw providerResponseFormatError(null, "Provider tool_call arguments were not valid JSON.", {
      parse_source: "tool_call",
      message: error.message
    });
  }

  if (parsedToolCall) {
    return {
      parsed: parsedToolCall.arguments,
      parse_source: "tool_call",
      tool_calls: toolCalls
    };
  }

  const text = contentText(message.content);
  try {
    return {
      parsed: jsonFromText(text),
      parse_source: "content",
      tool_calls: toolCalls,
      content: text
    };
  } catch (error) {
    throw providerResponseFormatError(null, "Provider content was not valid JSON.", {
      parse_source: "content",
      message: error.message
    });
  }
}

export function validateProviderEvidencePayload(provider, payload) {
  if (!isPlainObject(payload)) {
    throw providerSchemaError(provider, "Provider response must be a JSON object.");
  }
  const payloadWithNormalizedEvidence = payload.evidence !== undefined
    ? {
        ...payload,
        evidence: normalizedProviderEvidenceMap(payload.evidence, payload)
      }
    : payload;
  const normalizedPayload = withProviderFieldSafetyGuards(
    withoutUnknownProviderFieldEvidence(payloadWithNormalizedEvidence.field_evidence !== undefined
      ? {
        ...payloadWithNormalizedEvidence,
        field_evidence: normalizeProviderFieldEvidence(payloadWithNormalizedEvidence.field_evidence, {
          trustedOperatorEnvelope: payload
        })
      }
      : payloadWithNormalizedEvidence)
  );

  const errors = [];
  const hasEvidenceShape = normalizedPayload.evidence
    || normalizedPayload.field_evidence
    || normalizedPayload.fields
    || normalizedPayload.title
    || normalizedPayload.model_title_suggestion
    || normalizedPayload.unresolved;
  if (!hasEvidenceShape) {
    errors.push(schemaValidationError("payload", "Provider response is missing evidence, fields, title, model_title_suggestion, or unresolved."));
  }

  for (const fieldName of providerPayloadStringFields) {
    if (normalizedPayload[fieldName] !== undefined && typeof normalizedPayload[fieldName] !== "string") {
      errors.push(schemaValidationError(fieldName, "Field must be a string."));
    }
  }

  if (normalizedPayload.unresolved !== undefined) {
    if (!Array.isArray(normalizedPayload.unresolved)) {
      errors.push(schemaValidationError("unresolved", "Provider unresolved field must be an array when present."));
    } else {
      normalizedPayload.unresolved.forEach((item, index) => {
        if (typeof item !== "string") {
          errors.push(schemaValidationError(`unresolved[${index}]`, "Unresolved item must be a string."));
        }
      });
    }
  }

  if (normalizedPayload.fields !== undefined) {
    errors.push(...validateLegacyFields(normalizedPayload.fields));
  }

  if (normalizedPayload.resolved !== undefined) {
    errors.push(...validatePartialResolvedFields(normalizedPayload.resolved));
  }

  if (normalizedPayload.evidence !== undefined) {
    errors.push(...validateProviderEvidenceMap(normalizedPayload.evidence));
  }

  if (normalizedPayload.field_evidence !== undefined) {
    errors.push(...validateProviderFieldEvidence(normalizedPayload.field_evidence));
  }

  if (normalizedPayload.image_quality !== undefined && !isPlainObject(normalizedPayload.image_quality)) {
    errors.push(schemaValidationError("image_quality", "Image quality must be an object when present."));
  }

  if (normalizedPayload.vector_candidate_decision !== undefined) {
    errors.push(...validateVectorCandidateDecision(normalizedPayload.vector_candidate_decision));
  }

  if (errors.length) {
    throw providerSchemaError(provider, `Provider response schema validation failed: ${errors[0].path} ${errors[0].message}`, {
      validation_errors: errors.slice(0, 20)
    });
  }

  return normalizedPayload;
}

export function normalizeChatCompletionResponse(data, {
  provider,
  requestedModel,
  latencyMs
}) {
  if (!data || typeof data !== "object") {
    throw providerSchemaError(provider, "Provider returned an empty or non-object response.");
  }

  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const message = choice?.message;
  if (!message || typeof message !== "object") {
    throw providerSchemaError(provider, "Provider response is missing choices[0].message.");
  }

  let parsedMessage;
  try {
    parsedMessage = parseProviderMessagePayload(message);
  } catch (error) {
    if (error?.code === "response_format_invalid" && !error.provider) {
      error.provider = provider;
    }
    throw error;
  }
  const parsed = validateProviderEvidencePayload(provider, parsedMessage.parsed);

  return {
    provider,
    model_id: data.model || requestedModel || null,
    response_id: data.id || null,
    finish_reason: choice.finish_reason || null,
    usage: data.usage || null,
    latency_ms: latencyMs,
    parse_source: parsedMessage.parse_source,
    content: parsedMessage.content || "",
    tool_calls: parsedMessage.tool_calls || [],
    parsed
  };
}
