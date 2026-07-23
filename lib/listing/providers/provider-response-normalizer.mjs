import { providerResponseFormatError, providerSchemaError } from "./provider-errors.mjs";
import {
  evidenceFieldStatuses,
  gradeTypes,
  resolvedFieldNames,
  validateEvidenceMap
} from "../evidence/evidence-schema.mjs";

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizedProviderFieldEvidence(fieldEvidence) {
  if (isPlainObject(fieldEvidence)) {
    const normalized = {};
    const entries = Object.entries(fieldEvidence);
    // Preserve an explicit canonical key when the provider also emits one of
    // its known aliases. Aliases repair schema drift; they must never replace
    // the stronger canonical evidence merely because they appeared later.
    entries
      .filter(([fieldName]) => canonicalProviderFieldEvidenceName(fieldName) === fieldName)
      .forEach(([fieldName, evidence]) => {
        normalized[fieldName] = evidence;
      });
    entries
      .filter(([fieldName]) => canonicalProviderFieldEvidenceName(fieldName) !== fieldName)
      .forEach(([fieldName, evidence]) => {
        const canonicalName = canonicalProviderFieldEvidenceName(fieldName);
        if (!(canonicalName in normalized)) normalized[canonicalName] = evidence;
      });
    return normalized;
  }
  if (!Array.isArray(fieldEvidence)) return fieldEvidence;
  const normalized = {};
  fieldEvidence.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      normalized[`__invalid_${index}`] = entry;
      return;
    }
    const fieldName = canonicalProviderFieldEvidenceName(entry.field || entry.field_name);
    const { field, field_name: fieldNameAlias, ...rest } = entry;
    normalized[fieldName || `__invalid_${index}`] = rest;
  });
  return normalized;
}

function validateProviderFieldEvidence(fieldEvidence, path = "field_evidence") {
  const normalizedFieldEvidence = normalizedProviderFieldEvidence(fieldEvidence);
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
    ["grade_company", "card_grade", "auto_grade", "grade_type", "support_type", "evidence_type", "evidence_kind", "visible_text", "source_type", "source_image_id", "source_region", "region", "raw_text", "status", "unresolved_reason"].forEach((key) => {
      if (key in evidence && evidence[key] !== null && evidence[key] !== undefined && typeof evidence[key] !== "string") {
        errors.push(schemaValidationError(`${fieldPath}.${key}`, "Structured evidence field must be a string."));
      }
    });
    ["confidence"].forEach((key) => {
      if (key in evidence && evidence[key] !== null && evidence[key] !== undefined && (!Number.isFinite(Number(evidence[key])) || Number(evidence[key]) < 0 || Number(evidence[key]) > 1)) {
        errors.push(schemaValidationError(`${fieldPath}.${key}`, "Structured evidence confidence must be between 0 and 1."));
      }
    });
    ["review_required", "visible_marker", "signature_visible", "text_visible", "direct_observation", "directly_observed"].forEach((key) => {
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

function withUnsupportedMultiCardRoutedToReview(payload = {}) {
  const fields = isPlainObject(payload.fields) ? { ...payload.fields } : {};
  const resolved = isPlainObject(payload.resolved) ? { ...payload.resolved } : null;
  const evidence = isPlainObject(payload.field_evidence) ? { ...payload.field_evidence } : {};
  const multiCard = fields.multi_card === true || resolved?.multi_card === true;
  const cardCount = Number(fields.card_count ?? resolved?.card_count ?? 0);
  if (!multiCard && !(Number.isFinite(cardCount) && cardCount > 1)) return payload;

  // `multi_card=true` plus an exact count of one is internally contradictory,
  // even if the provider attached a plural-looking evidence snippet. Never let
  // that state reach evidence resolution or the lot renderer.
  const impossibleSingleCardLot = multiCard && cardCount === 1;
  // Everything in this payload was authored by the vision provider. Its
  // source_type is therefore a claim, not a trust boundary: accepting a
  // self-labelled OPERATOR or MULTI_CARD_DETECTOR source lets the model grant
  // itself independent authority. Always quarantine the lot claim here.
  // A separately executed recognition detector can corroborate and restore a
  // real lot later via providerLotCountAfterIndependentDetection().

  const rejectedLotType = fields.lot_type || resolved?.lot_type || null;
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
  const rejectedEvidence = Object.fromEntries(
    rejectedEvidenceFields.map((field) => [field, { ...evidence[field] }])
  );
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
    value: {
      multi_card: multiCard,
      card_count: Number.isFinite(cardCount) ? cardCount : null,
      lot_type: rejectedLotType
    },
    reason: impossibleSingleCardLot
      ? "multi_card_count_one_invariant_violation"
      : "separate_physical_cards_not_directly_observed",
    rejected_evidence_fields: rejectedEvidenceFields,
    rejected_evidence: rejectedEvidence
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
    "CERTIFIED_AUTOGRAPH"
  ]);
  const preciseSignatureSource = preciseSignatureKinds.has(sourceType) || preciseSignatureKinds.has(evidenceKind);
  const signatureMarkerVisible = entry.signature_visible === true || entry.visible_marker === true;
  return preciseSignatureSource && signatureMarkerVisible;
}

function genericUnsupportedSignatureCardName(value) {
  const normalized = String(value || "").replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:signed(?:\s+image)?|signature|autograph(?:ed)?|on[-\s]?card\s+autograph)$/i.test(normalized);
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
  if (genericUnsupportedSignatureCardName(fields.card_name)) fields.card_name = null;
  if (Array.isArray(fields.observable_components)) {
    fields.observable_components = withoutAutoTokens(fields.observable_components);
  }
  if (Array.isArray(fields.tags)) fields.tags = withoutAutoTokens(fields.tags);
  if (resolved) {
    resolved.auto = false;
    if (genericUnsupportedSignatureCardName(resolved.card_name)) resolved.card_name = null;
    if (Array.isArray(resolved.observable_components)) {
      resolved.observable_components = withoutAutoTokens(resolved.observable_components);
    }
    if (Array.isArray(resolved.attributes)) resolved.attributes = withoutAutoTokens(resolved.attributes);
  }
  if (isPlainObject(evidence.auto)) {
    evidence.auto = {
      ...evidence.auto,
      value: false,
      normalized_value: false,
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

function directlySupportedParallelEvidence(entry = {}, value = "") {
  if (!isPlainObject(entry)) return false;
  if (entry.review_required === true) return false;
  const directlyObserved = entry.directly_observed === true || entry.direct_observation === true;
  if (!directlyObserved) return false;
  const sourceType = String(entry.source_type || entry.support_type || "").trim().toUpperCase();
  if (!["SLAB_LABEL", "CARD_BACK_PRINTED_TEXT", "CARD_FRONT_PRINTED_TEXT"].includes(sourceType)) return false;
  const visibleText = [entry.visible_text, entry.raw_text]
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .join(" ");
  const normalizedValue = String(value || "").trim();
  if (!visibleText || !normalizedValue) return false;
  const significantTokens = normalizedValue.toLowerCase().match(/[a-z0-9]+/g) || [];
  const visibleTokens = new Set(visibleText.toLowerCase().match(/[a-z0-9]+/g) || []);
  return significantTokens.some((token) => token.length >= 4 && visibleTokens.has(token));
}

function withUnsupportedParallelRoutedToReview(payload = {}) {
  const fields = isPlainObject(payload.fields) ? { ...payload.fields } : {};
  const resolved = isPlainObject(payload.resolved) ? { ...payload.resolved } : null;
  const evidence = isPlainObject(payload.field_evidence) ? { ...payload.field_evidence } : {};
  const claimed = ["parallel_family", "parallel_exact", "parallel"].filter((field) => (
    fields[field] !== null && fields[field] !== undefined && String(fields[field]).trim() !== ""
  ));
  const unsupported = claimed.filter((field) => !directlySupportedParallelEvidence(evidence[field], fields[field]));
  if (!unsupported.length) return payload;

  const unresolved = Array.isArray(payload.unresolved) ? [...payload.unresolved] : [];
  const rejections = Array.isArray(payload.provider_field_rejections)
    ? [...payload.provider_field_rejections]
    : [];
  for (const field of unsupported) {
    const value = fields[field];
    fields[field] = null;
    if (resolved) resolved[field] = null;
    if (isPlainObject(evidence[field])) {
      evidence[field] = {
        ...evidence[field],
        value: null,
        normalized_value: null,
        review_required: true,
        unresolved_reason: "parallel_not_literally_supported_by_current_image"
      };
    }
    if (!unresolved.includes(field)) unresolved.push(field);
    rejections.push({
      field,
      value,
      reason: "parallel_not_literally_supported_by_current_image"
    });
  }
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
    withUnsupportedParallelRoutedToReview(
      withUnsupportedAutoRoutedToReview(withUnsupportedCodesRoutedToReview(payload))
    )
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
  const normalizedPayload = withProviderFieldSafetyGuards(payload.field_evidence !== undefined
    ? {
      ...payload,
      field_evidence: normalizedProviderFieldEvidence(payload.field_evidence)
    }
    : payload);

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
