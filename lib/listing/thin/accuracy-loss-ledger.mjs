import { createHash } from "node:crypto";

import { semCanonicalEditableFields } from "../csm/sem-definition.mjs";
import { resolvedFieldsToSemSuggestion } from "../csm/title-derived-sem.mjs";
import { toResolvedFields } from "./csm-emit.mjs";
import { MARKETPLACE_PROFILES } from "./marketplace-composer-rules.mjs";
import { sanitizeListingTitle } from "./sanitize-listing-title.mjs";

export const ACCURACY_LOSS_LEDGER_V1 = "same-call-accuracy-loss-ledger-v1";
export const ACCURACY_LOSS_LEDGER_VERSION = ACCURACY_LOSS_LEDGER_V1;
export const ACCURACY_LOSS_LEDGER_SUPPORTED_VERSIONS = Object.freeze([
  ACCURACY_LOSS_LEDGER_V1
]);
export const ACCURACY_LOSS_SOURCE_MAP_VERSION = "csm-sem-provider-source-map-v1";
export const ACCURACY_LOSS_LEDGER_MAX_BYTES = 16_384;
const ACCURACY_FIELD_STATUSES = new Set(["unchanged", "normalized", "derived", "dropped", "empty"]);

const sha256Text = (value) => createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalValue(value[key])]));
}

export const accuracyLedgerSha256 = (value) => sha256Text(JSON.stringify(canonicalValue(value)));

function canonicalSemValue(value) {
  // Arrays preserve semantic order: subject priority and Composer rendering
  // can change when the provider reorders values. Only object keys are sorted.
  if (Array.isArray(value)) return value.map(canonicalSemValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalSemValue(value[key])]));
}

export const accuracySemValueSha256 = (value) =>
  sha256Text(JSON.stringify(canonicalSemValue(value)));

function parsedProviderValue(raw) {
  try {
    const value = JSON.parse(String(raw ?? ""));
    return value && typeof value === "object" && !Array.isArray(value)
      ? { value, reason: "PROVIDER_JSON_OBJECT_PARSED" }
      : { value, reason: "PROVIDER_JSON_NON_OBJECT_PARSED" };
  } catch {
    return { value: null, reason: "PROVIDER_JSON_UNPARSEABLE" };
  }
}

const unique = (values) => [...new Set(values.filter(Boolean))];
const reasonToken = (value) => String(value || "").trim().toUpperCase()
  .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
function valuePresent(value, { strict = false } = {}) {
  if (Array.isArray(value)) return value.some((entry) => valuePresent(entry, { strict }));
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => valuePresent(entry, { strict }));
  }
  if (typeof value === "string") return strict ? value.length > 0 : value.trim().length > 0;
  return value !== undefined && value !== null && value !== false;
}

function directSource(parsed, field) {
  return { value: parsed?.[field], supported: !hasOwn(parsed, field) || typeof parsed[field] === "string" };
}

// This is the only provider -> CSM source map used by the ledger. Its version
// is persisted above; changing a source key requires a new version.
function providerSourceFor(field, parsed = {}) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { value: undefined, supported: false };
  }
  if (["year", "language", "manufacturer", "product", "set", "card_name",
    "descriptive_rarity", "release_variant", "description"].includes(field)) {
    return directSource(parsed, field);
  }
  if (field === "ip_sport") {
    const key = ["ip", "sport", "category"].find((name) => hasOwn(parsed, name));
    return key ? directSource(parsed, key) : { value: undefined, supported: true };
  }
  if (field === "subject") {
    const value = hasOwn(parsed, "subjects") ? parsed.subjects : parsed.subject;
    return { value, supported: value === undefined || Array.isArray(value) || typeof value === "string" };
  }
  if (field === "card_number") return directSource(parsed, "card_number");
  if (field === "numerical_rarity") return directSource(parsed, "serial");
  if (field === "print_finish") {
    const value = Object.fromEntries(["parallel_exact", "surface_color", "parallel_family"]
      .filter((key) => hasOwn(parsed, key)).map((key) => [key, parsed[key]]));
    return {
      value,
      supported: Object.values(value).every((entry) => typeof entry === "string")
    };
  }
  if (field === "special_stamp") return directSource(parsed, "special_stamp");
  if (field === "grading_info") {
    if (hasOwn(parsed, "grading_info")) {
      return { value: parsed.grading_info, supported: parsed.grading_info === null
        || (typeof parsed.grading_info === "object" && !Array.isArray(parsed.grading_info)) };
    }
    const value = Object.fromEntries(["company", "card_grade", "auto_grade", "grade"]
      .filter((key) => hasOwn(parsed, key)).map((key) => [key, parsed[key]]));
    return { value, supported: Object.values(value).every((entry) => typeof entry === "string") };
  }
  if (field === "search_optimization") {
    const value = Object.fromEntries(["attributes", "team"]
      .filter((key) => hasOwn(parsed, key)).map((key) => [key, parsed[key]]));
    return {
      value,
      supported: (!hasOwn(value, "attributes") || Array.isArray(value.attributes))
        && (!hasOwn(value, "team") || typeof value.team === "string")
    };
  }
  return { value: undefined, supported: false };
}

const DEFECT_FIELDS = Object.freeze({
  serial_not_a_print_run: ["numerical_rarity"],
  card_number_is_a_print_run: ["card_number"],
  card_number_holds_multiple_codes: ["card_number"],
  multiple_card_numbers_but_not_lot: ["card_number"]
});

function sanitizesToEmpty(value) {
  const leaves = Array.isArray(value) ? value.flat(Infinity)
    : value && typeof value === "object" ? Object.values(value).flat(Infinity) : [value];
  const present = leaves.filter((entry) => typeof entry === "string" && entry.length > 0);
  return present.length > 0 && present.every((entry) => !sanitizeListingTitle(entry).title);
}

function fieldReasonCodes({ field, source, inputPresent, admittedPresent, inputHash, admittedHash, result }) {
  if (!source.supported) return ["UNSUPPORTED_SOURCE_SHAPE"];
  if (!inputPresent && !admittedPresent) return ["EMPTY_AT_INPUT"];
  if (inputPresent && admittedPresent && inputHash === admittedHash) return ["VALUE_UNCHANGED"];
  if (!inputPresent && admittedPresent) return ["CSM_SEM_DERIVED"];
  if (inputPresent && admittedPresent) return ["CSM_SEM_NORMALIZED"];
  if (typeof source.value === "string" && source.value.length > 0 && !source.value.trim()) {
    return ["NORMALIZED_TO_EMPTY"];
  }
  if (sanitizesToEmpty(source.value)) return ["SANITIZED_TO_EMPTY"];
  const defects = (result?.field_defects || []).filter((defect) => DEFECT_FIELDS[defect]?.includes(field));
  if (defects.length) return unique(["PARSER_REJECTED", ...defects.map((value) => `PARSER_DEFECT_${reasonToken(value)}`)]).sort();
  if (field === "print_finish" && (result?.fields?.withheld_finish_terms || []).length) {
    return unique(["CSM_ADMISSION_REJECTED", ...(result.fields.withheld_finish_terms || [])
      .map(({ reason }) => reasonToken(reason))]).sort();
  }
  if (field === "search_optimization" && Array.isArray(source.value?.attributes)) {
    return ["PARSER_REJECTED"];
  }
  return ["UNKNOWN_TRANSFORM"];
}

function buildFieldLedger(parsedValue, result) {
  const admittedSem = resolvedFieldsToSemSuggestion(toResolvedFields(result?.fields || {}));
  const fields = semCanonicalEditableFields.map((field) => {
    const source = providerSourceFor(field, parsedValue);
    const admittedValue = admittedSem[field];
    const inputPresent = valuePresent(source.value, { strict: true });
    const admittedPresent = valuePresent(admittedValue);
    const inputHash = inputPresent ? accuracySemValueSha256(source.value) : null;
    const admittedHash = admittedPresent ? accuracySemValueSha256(admittedValue) : null;
    const status = !inputPresent && !admittedPresent ? "empty"
      : !inputPresent && admittedPresent ? "derived"
        : inputPresent && !admittedPresent ? "dropped"
          : inputHash === admittedHash ? "unchanged" : "normalized";
    return {
      field,
      input_present: inputPresent,
      input_value_sha256: inputHash,
      admitted_present: admittedPresent,
      admitted_value_sha256: admittedHash,
      status,
      reason_codes: fieldReasonCodes({
        field, source, inputPresent, admittedPresent, inputHash, admittedHash, result
      })
    };
  });
  return { admittedSem, fields };
}

function actuallySuppressedBrackets(result, admittedSem) {
  const retainedSearchTerms = new Set(
    (MARKETPLACE_PROFILES.ebay.retainWithinSuppressed?.search_optimization || [])
      .map((value) => String(value).trim().toLowerCase())
  );
  return [...(result?.suppressed_brackets || [])].filter((bracket) => {
    if (bracket === "card_number") return valuePresent(result?.fields?.card_number);
    if (bracket === "search_optimization") {
      const suppressedComponent = (result?.fields?.components || []).some((value) => (
        !retainedSearchTerms.has(String(value).trim().toLowerCase())
      ));
      return valuePresent(result?.fields?.team) || suppressedComponent;
    }
    const semField = bracket === "ip" ? "ip_sport" : bracket;
    return valuePresent(admittedSem?.[semField]);
  });
}

function bracketLedgerFor(result, admittedSem) {
  return {
    included: [...(result?.brackets || [])],
    dropped_for_budget: [...(result?.dropped_brackets || [])],
    profile_suppression_policy: [...(result?.suppressed_brackets || [])],
    suppressed_by_profile: actuallySuppressedBrackets(result, admittedSem),
    restored: [...(result?.restored_brackets || [])],
    truncated: result?.truncated === true,
    empty_at_input: [...(result?.input_empty_fields || [])],
    normalization_reason_codes: [...(result?.normalization_reasons || [])],
    character_budget: result?.character_budget ?? null,
    rendered_length: result?.length ?? null
  };
}

export function buildAccuracyLossLedger({ rawProviderOutput, result } = {}) {
  const raw = String(rawProviderOutput ?? "");
  const parsed = parsedProviderValue(raw);
  const rawSha256 = sha256Text(raw);
  const parsedSha256 = accuracyLedgerSha256(parsed.value);
  const fieldLedger = buildFieldLedger(parsed.value, result);
  const canonicalSha256 = accuracySemValueSha256(fieldLedger.admittedSem);
  const bracketLedger = bracketLedgerFor(result, fieldLedger.admittedSem);
  const actualSuppressed = bracketLedger.suppressed_by_profile;
  const composedSha256 = accuracyLedgerSha256(bracketLedger);
  const titleSha256 = sha256Text(result?.title || "");
  const withheldReasons = (result?.fields?.withheld_finish_terms || [])
    .map(({ reason }) => reasonToken(reason));
  const fieldStatuses = new Set(fieldLedger.fields.map(({ status }) => status));
  const canonicalLossRecorded = fieldStatuses.has("dropped")
    || (result?.field_defects || []).length > 0
    || result?.sanitised === true
    || withheldReasons.length > 0;
  const canonicalReasons = unique([
    ...(result?.field_defects || []).map((reason) => `PARSER_DEFECT_${reasonToken(reason)}`),
    ...(result?.sanitised ? ["FIELD_SANITIZATION_APPLIED"] : []),
    ...withheldReasons,
    ...(fieldStatuses.has("dropped") ? ["CANONICAL_FIELD_DROPPED"] : []),
    ...(fieldStatuses.has("normalized") ? ["CANONICAL_FIELD_NORMALIZED"] : []),
    ...(fieldStatuses.has("derived") ? ["CSM_SEM_FIELD_DERIVED"] : []),
    ...(!canonicalLossRecorded
      ? ["NO_CANONICAL_LOSS_RECORDED"] : [])
  ]).sort();
  const composedReasons = unique([
    ...(result?.normalization_reasons || []).map(reasonToken),
    ...(actualSuppressed.length ? ["MARKETPLACE_PROFILE_SUPPRESSED"] : []),
    ...((result?.dropped_brackets || []).length ? ["CHARACTER_BUDGET_DROPPED"] : []),
    ...((result?.restored_brackets || []).length ? ["COMPOSER_RESTORED"] : []),
    ...(result?.truncated ? ["FINAL_FALLBACK_TRUNCATION"] : []),
    ...(!(result?.normalization_reasons || []).length
      && !actualSuppressed.length
      && !(result?.dropped_brackets || []).length
      && !(result?.restored_brackets || []).length
      && !result?.truncated ? ["NO_COMPOSER_LOSS_RECORDED"] : [])
  ]).sort();

  const stages = {
    raw_provider_output: {
      sha256: rawSha256,
      byte_length: Buffer.byteLength(raw, "utf8"),
      reason_codes: ["PROVIDER_OUTPUT_TEXT_CAPTURED"]
    },
    parsed_fields: {
      source_sha256: rawSha256,
      sha256: parsedSha256,
      reason_codes: [parsed.reason]
    },
    admitted_canonical_fields: {
      source_sha256: parsedSha256,
      sha256: canonicalSha256,
      source_map_version: ACCURACY_LOSS_SOURCE_MAP_VERSION,
      reason_codes: canonicalReasons,
      fields: fieldLedger.fields
    },
    composed_bracket_ledger: {
      source_sha256: canonicalSha256,
      sha256: composedSha256,
      ...bracketLedger,
      reason_codes: composedReasons
    },
    final_title: {
      source_sha256: composedSha256,
      sha256: titleSha256,
      byte_length: Buffer.byteLength(String(result?.title || ""), "utf8"),
      reason_codes: ["FINAL_TITLE_COMPOSED"]
    }
  };
  return Object.freeze({
    version: ACCURACY_LOSS_LEDGER_VERSION,
    stages,
    ledger_sha256: accuracyLedgerSha256({ version: ACCURACY_LOSS_LEDGER_VERSION, stages })
  });
}

const ACCURACY_STAGE_NAMES = Object.freeze([
  "raw_provider_output",
  "parsed_fields",
  "admitted_canonical_fields",
  "composed_bracket_ledger",
  "final_title"
]);
const hashValid = (value) => /^[0-9a-f]{64}$/.test(String(value || ""));
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const reasonCodesValid = (value) => Array.isArray(value) && value.length > 0
  && value.every((reason) => /^[A-Z0-9_]+$/.test(String(reason || "")));
const stringArray = (value) => Array.isArray(value)
  && value.every((entry) => typeof entry === "string");

function validateAccuracyLossLedgerV1(value, { result = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("accuracy_loss_ledger_invalid:object_required");
  }
  if (!exactKeys(value, ["version", "stages", "ledger_sha256"])
      || value.version !== ACCURACY_LOSS_LEDGER_V1) {
    throw new TypeError("accuracy_loss_ledger_invalid:version");
  }
  if (!exactKeys(value.stages, ACCURACY_STAGE_NAMES)) {
    throw new TypeError("accuracy_loss_ledger_invalid:stages");
  }
  const raw = value.stages.raw_provider_output;
  const parsed = value.stages.parsed_fields;
  const admitted = value.stages.admitted_canonical_fields;
  const composed = value.stages.composed_bracket_ledger;
  const final = value.stages.final_title;
  if (!exactKeys(raw, ["sha256", "byte_length", "reason_codes"])
      || !hashValid(raw.sha256)
      || !Number.isInteger(raw.byte_length) || raw.byte_length < 0
      || !reasonCodesValid(raw.reason_codes)
      || !exactKeys(parsed, ["source_sha256", "sha256", "reason_codes"])
      || !hashValid(parsed.source_sha256) || !hashValid(parsed.sha256)
      || parsed.source_sha256 !== raw.sha256
      || !reasonCodesValid(parsed.reason_codes)
      || !exactKeys(admitted, [
        "source_sha256", "sha256", "source_map_version", "reason_codes", "fields"
      ])
      || !hashValid(admitted.source_sha256) || !hashValid(admitted.sha256)
      || admitted.source_sha256 !== parsed.sha256
      || admitted.source_map_version !== ACCURACY_LOSS_SOURCE_MAP_VERSION
      || !reasonCodesValid(admitted.reason_codes)) {
    throw new TypeError("accuracy_loss_ledger_invalid:stage_contract");
  }
  const fields = admitted.fields;
  if (!Array.isArray(fields)
      || fields.length !== semCanonicalEditableFields.length
      || fields.some((entry, index) => (
        !exactKeys(entry, [
          "field", "input_present", "input_value_sha256", "admitted_present",
          "admitted_value_sha256", "status", "reason_codes"
        ])
        || entry?.field !== semCanonicalEditableFields[index]
        || typeof entry.input_present !== "boolean"
        || typeof entry.admitted_present !== "boolean"
        || !ACCURACY_FIELD_STATUSES.has(entry.status)
        || !reasonCodesValid(entry.reason_codes)
        || entry.input_present !== hashValid(entry.input_value_sha256)
        || entry.admitted_present !== hashValid(entry.admitted_value_sha256)
        || (entry.status === "empty" && (entry.input_present || entry.admitted_present))
        || (entry.status === "derived" && (entry.input_present || !entry.admitted_present))
        || (entry.status === "dropped" && (!entry.input_present || entry.admitted_present))
        || (entry.status === "unchanged" && (!entry.input_present || !entry.admitted_present
          || entry.input_value_sha256 !== entry.admitted_value_sha256))
        || (entry.status === "normalized" && (!entry.input_present || !entry.admitted_present
          || entry.input_value_sha256 === entry.admitted_value_sha256))
      ))) {
    throw new TypeError("accuracy_loss_ledger_invalid:field_contract");
  }
  const bracketKeys = [
    "included", "dropped_for_budget", "profile_suppression_policy",
    "suppressed_by_profile", "restored", "truncated", "empty_at_input",
    "normalization_reason_codes", "character_budget", "rendered_length"
  ];
  if (!exactKeys(composed, ["source_sha256", "sha256", ...bracketKeys, "reason_codes"])
      || !hashValid(composed.source_sha256) || !hashValid(composed.sha256)
      || composed.source_sha256 !== admitted.sha256
      || !bracketKeys.filter((key) => !["truncated", "character_budget", "rendered_length"].includes(key))
        .every((key) => stringArray(composed[key]))
      || typeof composed.truncated !== "boolean"
      || !Number.isInteger(composed.character_budget) || composed.character_budget < 1
      || !Number.isInteger(composed.rendered_length) || composed.rendered_length < 0
      || composed.rendered_length > composed.character_budget
      || !reasonCodesValid(composed.reason_codes)) {
    throw new TypeError("accuracy_loss_ledger_invalid:composer_contract");
  }
  const bracketLedger = Object.fromEntries(bracketKeys.map((key) => [key, composed[key]]));
  if (composed.sha256 !== accuracyLedgerSha256(bracketLedger)
      || !exactKeys(final, ["source_sha256", "sha256", "byte_length", "reason_codes"])
      || !hashValid(final.source_sha256) || !hashValid(final.sha256)
      || final.source_sha256 !== composed.sha256
      || !Number.isInteger(final.byte_length) || final.byte_length < 0
      || !reasonCodesValid(final.reason_codes)) {
    throw new TypeError("accuracy_loss_ledger_invalid:lineage");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > ACCURACY_LOSS_LEDGER_MAX_BYTES) {
    throw new TypeError("accuracy_loss_ledger_invalid:size");
  }
  const expected = accuracyLedgerSha256({ version: value.version, stages: value.stages });
  if (!/^[0-9a-f]{64}$/.test(String(value.ledger_sha256 || ""))
      || value.ledger_sha256 !== expected) {
    throw new TypeError("accuracy_loss_ledger_invalid:sha256");
  }
  if (result) {
    const title = String(result.title || "");
    const admittedSem = resolvedFieldsToSemSuggestion(toResolvedFields(result.fields || {}));
    const expectedBrackets = bracketLedgerFor(result, admittedSem);
    const fieldBindingValid = fields.every((entry) => {
      const admittedValue = admittedSem[entry.field];
      const admittedPresent = valuePresent(admittedValue);
      return entry.admitted_present === admittedPresent
        && entry.admitted_value_sha256 === (
          admittedPresent ? accuracySemValueSha256(admittedValue) : null
        );
    });
    if (admitted.sha256 !== accuracySemValueSha256(admittedSem)
        || !fieldBindingValid
        || composed.sha256 !== accuracyLedgerSha256(expectedBrackets)
        || final.sha256 !== sha256Text(title)
        || final.byte_length !== Buffer.byteLength(title, "utf8")) {
      throw new TypeError("accuracy_loss_ledger_invalid:result_binding");
    }
  }
  return value;
}

// Durable authority checkpoints can outlive a deployment. Never replace an
// already-published validator: add the next version here so paid work created
// by older runtimes remains resumable without another provider call.
const ACCURACY_LOSS_LEDGER_VALIDATORS = new Map([
  [ACCURACY_LOSS_LEDGER_V1, validateAccuracyLossLedgerV1]
]);

export function validateAccuracyLossLedger(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("accuracy_loss_ledger_invalid:object_required");
  }
  const validator = ACCURACY_LOSS_LEDGER_VALIDATORS.get(value.version);
  if (!validator) throw new TypeError("accuracy_loss_ledger_invalid:version");
  return validator(value, options);
}
