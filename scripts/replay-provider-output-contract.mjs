#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { attachForwardEnumerationCandidates } from "../lib/listing/catalog/forward-enumeration-adapter.mjs";
import { constraintEnumerationVersion } from "../lib/listing/catalog/constraint-enumerator.mjs";
import { loadConstraintModelSnapshot } from "../lib/listing/catalog/constraint-model-store.mjs";
import { providerPayloadToEvidenceDocument } from "../lib/listing/evidence/provider-evidence-normalizer.mjs";
import {
  providerFieldsByClass,
  providerOutputFieldClass
} from "../lib/listing/providers/provider-output-field-contract.mjs";
import { scoreReviewedTitleSemProjection } from "../lib/listing/evaluation/reviewed-title-sem-projection.mjs";
import {
  applyIdentityResolutionGate
} from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { normalizeFieldValue } from "../lib/identity-resolution/normalizer.mjs";
import { parsePrintRunValue } from "../lib/listing/print-run/print-run-fields.mjs";
import {
  evaluationReplaySnapshotSchemaVersion,
  normalizationProjectionComplete
} from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";
import { renderListingPresentation } from "../lib/listing/renderer/listing-renderer.mjs";
import { policyFairTokenRecall } from "./evaluate-cloud-listing-api.mjs";

const readFields = new Set(providerFieldsByClass(providerOutputFieldClass.READ));
const replayableEvidenceStatuses = new Set(["CONFIRMED", "MANUAL_CONFIRMED", "REVIEW"]);
const canonicalReplayFieldGroups = Object.freeze([
  ["print_run_number", "serial_number", "numerical_rarity"],
  ["print_run_numerator"],
  ["print_run_denominator", "numbered_to", "serial_denominator", "expected_serial_denominator"],
  ["players", "player", "subjects", "subject", "character"],
  ["collector_number", "card_number", "checklist_code"],
  ["card_grade", "grade"],
  ["cert_number", "certification_number"]
]);
const canonicalReplayFieldByAlias = new Map(canonicalReplayFieldGroups.flatMap((group) => (
  group.map((field) => [field, group[0]])
)));
const independentReplayEvidenceSources = new Set([
  "CARD_FRONT",
  "CARD_BACK",
  "CARD_FRONT_PRINTED_TEXT",
  "CARD_BACK_PRINTED_TEXT",
  "SLAB_LABEL",
  "VISION_MODEL",
  "OCR",
  "OCR_ONLY",
  "OPERATOR"
]);
const precisionSensitiveNormalizationDrops = new Set([
  "print_run_number",
  "print_run_numerator"
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function referenceTitle(result = {}) {
  return clean(
    result.corrected_title_reference
    || result.corrected_title
    || result.reference_title
    || result.seller_title
  );
}

function acceptanceFailureKey(value) {
  if (value && typeof value === "object") return clean(value.field || JSON.stringify(value));
  return clean(value);
}

export function requiredAcceptanceFailureRegression(baseline = [], candidate = []) {
  const baselineKeys = new Set((Array.isArray(baseline) ? baseline : [])
    .map(acceptanceFailureKey)
    .filter(Boolean));
  return (Array.isArray(candidate) ? candidate : [])
    .map(acceptanceFailureKey)
    .filter(Boolean)
    .some((failure) => !baselineKeys.has(failure));
}

export function replayRowsPassGate(rows = [], resultCount = rows.length) {
  const replayable = rows.filter((row) => row.replayable);
  const scored = replayable.filter((row) => Number.isFinite(row.baseline_policy_fair_token_recall));
  return resultCount > 0
    && replayable.length === resultCount
    && scored.length === replayable.length
    && replayable.every((row) => row.replay_snapshot_terminal_title_match === true)
    && replayable.every((row) => row.protected_read_parity === true)
    && replayable.every((row) => row.effective_renderer_parity === true)
    && replayable.every((row) => row.title_changed === false)
    && replayable.every((row) => row.contract_regression === false);
}

function evidenceFieldName(item = {}) {
  return clean(item.field || item.f);
}

function canonicalReplayField(field = "") {
  const normalized = clean(field);
  return canonicalReplayFieldByAlias.get(normalized) || normalized;
}

function closePrintRunBlockedFields(fields = []) {
  const blocked = new Set(fields);
  if (blocked.has("print_run_number")) {
    blocked.add("print_run_numerator");
    blocked.add("one_of_one");
  }
  if (blocked.has("print_run_numerator")) {
    blocked.add("print_run_number");
    blocked.add("one_of_one");
  }
  if (blocked.has("print_run_denominator")) {
    blocked.add("print_run_number");
    blocked.add("one_of_one");
  }
  if (blocked.has("one_of_one")) {
    blocked.add("print_run_number");
    blocked.add("print_run_numerator");
  }
  return blocked;
}

function normalizationDroppedCanonicalFields(snapshot = {}) {
  const normalization = object(snapshot.normalization);
  const input = object(normalization.input);
  const output = object(normalization.output);
  const outputCanonicalFields = new Set(Object.keys(output).map(canonicalReplayField));
  const dropped = new Set();
  for (const decision of Array.isArray(normalization.decisions) ? normalization.decisions : []) {
    if (clean(decision?.decision).toUpperCase() !== "DROP") continue;
    const canonical = canonicalReplayField(decision?.field);
    if (canonical && !outputCanonicalFields.has(canonical)) dropped.add(canonical);
  }
  for (const field of Object.keys(input)) {
    const canonical = canonicalReplayField(field);
    if (!outputCanonicalFields.has(canonical)) dropped.add(canonical);
  }
  return closePrintRunBlockedFields(dropped);
}

function sameReplayProjection(left = {}, right = {}) {
  const leftObject = object(left);
  const rightObject = object(right);
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((field, index) => (
      field === rightKeys[index]
      && JSON.stringify(leftObject[field]) === JSON.stringify(rightObject[field])
    ));
}

function replayScalarValues(values = []) {
  return [...new Set(values
    .map((value) => sanitizePresentValue(value))
    .filter(present)
    .map((value) => clean(value))
    .filter(Boolean))].sort();
}

function serialReadProjection(fields = {}) {
  const source = object(fields);
  const parsedValues = [
    source.print_run_number,
    source.serial_number,
    source.numerical_rarity
  ].filter(present).map((value) => parsePrintRunValue(value));
  const numerators = replayScalarValues([
    source.print_run_numerator,
    ...parsedValues.map((value) => value.print_run_numerator)
  ]);
  const denominators = replayScalarValues([
    source.print_run_denominator,
    source.numbered_to,
    source.serial_denominator,
    source.expected_serial_denominator,
    ...parsedValues.map((value) => value.print_run_denominator)
  ]);
  return {
    numerator: numerators.length ? numerators : null,
    denominator: denominators.length ? denominators : null,
    one_of_one: source.one_of_one === true || parsedValues.some((value) => value.one_of_one === true)
  };
}

const protectedReadAliases = Object.freeze({
  manufacturer: ["brand"],
  players: ["player", "subjects", "subject", "character"],
  card_grade: ["grade"],
  cert_number: ["certification_number"]
});

export function protectedReadProjection(fields = {}) {
  const source = object(fields);
  const projection = {};
  for (const field of readFields) {
    if (["print_run_number", "print_run_numerator", "print_run_denominator", "one_of_one"].includes(field)) continue;
    const aliases = protectedReadAliases[field] || [];
    const rawValue = [field, ...aliases].map((name) => source[name]).find(present);
    const normalized = normalizeReplayFieldValue(field, rawValue);
    if (present(normalized)) projection[field] = normalized;
  }
  const serial = serialReadProjection(source);
  if (serial.numerator) projection.print_run_numerator = serial.numerator;
  if (serial.denominator) projection.print_run_denominator = serial.denominator;
  if (serial.one_of_one) projection.one_of_one = true;
  return projection;
}

export function protectedReadParity(baseline = {}, candidate = {}) {
  const baselineProjection = protectedReadProjection(baseline);
  const candidateProjection = protectedReadProjection(candidate);
  return {
    matches: sameReplayProjection(baselineProjection, candidateProjection),
    baseline: baselineProjection,
    candidate: candidateProjection
  };
}

function replayComparableValue(value) {
  if (Array.isArray(value)) return [...value].map(replayComparableValue).sort();
  if (typeof value === "string") return clean(value).toLowerCase();
  return value;
}

function protectedReadPreservation(baseline = {}, candidate = {}) {
  const baselineProjection = protectedReadProjection(baseline);
  const candidateProjection = protectedReadProjection(candidate);
  const replayEquivalentFields = Object.freeze({
    card_number: ["collector_number", "checklist_code"],
    collector_number: ["card_number", "checklist_code"],
    checklist_code: ["collector_number", "card_number"]
  });
  const candidateValueFor = (field) => [field, ...(replayEquivalentFields[field] || [])]
    .map((name) => candidateProjection[name])
    .find((value) => present(value));
  return {
    matches: Object.entries(baselineProjection).every(([field, value]) => (
      present(candidateValueFor(field))
      && JSON.stringify(replayComparableValue(value))
        === JSON.stringify(replayComparableValue(candidateValueFor(field)))
    )),
    baseline: baselineProjection,
    candidate: candidateProjection
  };
}

function effectiveTerminalReadFields(fields = {}, serialNumeratorVerified = null) {
  const source = object(fields);
  return {
    ...Object.fromEntries(Object.entries(source)
      .filter(([field]) => ![
        "print_run_number",
        "print_run_numerator",
        "print_run_denominator",
        "one_of_one",
        "serial_number",
        "numbered_to",
        "numerical_rarity",
        "serial_denominator",
        "expected_serial_denominator"
      ].includes(field))),
    ...validPrintRunProjection(source, { serialNumeratorVerified })
  };
}

function rendererParityProjection(inputs = {}) {
  const source = object(inputs);
  return {
    renderer_version: clean(source.renderer_version) || null,
    max_title_length: Math.max(1, Number(source.max_title_length || 80) || 80),
    serial_numerator_verified: [true, false, null].includes(source.serial_numerator_verified)
      ? source.serial_numerator_verified
      : null,
    trust_resolved_print_run_without_evidence: source.trust_resolved_print_run_without_evidence === true
  };
}

export function effectiveRendererParity(baseline = {}, candidate = {}) {
  const baselineProjection = rendererParityProjection(baseline);
  const candidateProjection = rendererParityProjection(candidate);
  return {
    matches: sameReplayProjection(baselineProjection, candidateProjection),
    baseline: baselineProjection,
    candidate: candidateProjection
  };
}

function missingRequiredReplaySnapshotComponents(snapshot = {}) {
  const versions = object(snapshot.versions);
  const rendererInputs = object(snapshot.effective_terminal_renderer_inputs);
  const semanticApplication = object(snapshot.semantic_retrieval_application);
  const required = {
    provider_fields: Object.keys(object(snapshot.provider_fields)).length > 0,
    provider_field_evidence: Array.isArray(snapshot.provider_field_evidence),
    observed_fields: Object.keys(object(snapshot.observed_fields)).length > 0,
    normalized_evidence: Object.keys(object(snapshot.normalized_evidence)).length > 0,
    resolved_fields: Object.keys(object(snapshot.resolved_fields)).length > 0,
    rendered_fields: Object.keys(object(snapshot.rendered_fields)).length > 0,
    final_title: Boolean(clean(snapshot.final_title)),
    renderer_version: Boolean(clean(versions.renderer)),
    normalization_version: Boolean(clean(versions.normalization)),
    resolver_version: Boolean(clean(versions.resolver)),
    pipeline_fingerprint: Boolean(clean(versions.recognition_pipeline_fingerprint)),
    constraint_snapshot_version: Boolean(clean(versions.constraint_snapshot)),
    constraint_snapshot_source_sha256: Boolean(clean(versions.constraint_snapshot_sha256)),
    constraint_enumerator_version: Boolean(clean(versions.constraint_enumerator)),
    effective_terminal_renderer_inputs:
      Object.hasOwn(rendererInputs, "serial_numerator_verified")
      && [true, false, null].includes(rendererInputs.serial_numerator_verified)
      && typeof rendererInputs.trust_resolved_print_run_without_evidence === "boolean",
    normalization_projection: normalizationProjectionComplete(
      snapshot.normalization,
      snapshot.provider_fields,
      snapshot.observed_fields
    ),
    semantic_retrieval_application:
      typeof semanticApplication.enabled === "boolean"
      && Array.isArray(semanticApplication.decisions),
    derivation_provenance: Array.isArray(snapshot.derivation_provenance)
  };
  return Object.entries(required).filter(([, value]) => !value).map(([component]) => component);
}

function present(value) {
  if (Array.isArray(value)) return value.some(present);
  if (value && typeof value === "object") return false;
  // The provider sparse contract is positive-only for visible boolean marks:
  // false is an omitted/default transport value, not evidence of absence.
  // The serial numerator uses its separate true/false/null renderer contract.
  if (typeof value === "boolean") return value === true;
  const text = clean(value);
  return value !== null && value !== undefined && text !== "" && text.toUpperCase() !== "UNKNOWN";
}

function sanitizePresentValue(value) {
  if (Array.isArray(value)) {
    const sanitized = value.map(sanitizePresentValue).filter(present);
    return sanitized.length ? sanitized : null;
  }
  return present(value) ? value : null;
}

function normalizedReplayEvidenceStatus(state = {}) {
  return clean(object(state).status).toUpperCase();
}

function replayableRecordedEvidence(state = {}) {
  return replayableEvidenceStatuses.has(normalizedReplayEvidenceStatus(state));
}

function independentReplayEvidenceSource(source = {}) {
  return independentReplayEvidenceSources.has(
    clean(source?.source_type || source?.source).toUpperCase()
  );
}

function replayValueKey(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(replayValueKey).sort());
  return JSON.stringify(value);
}

function canonicalObservedValueKeys(fields = {}) {
  const values = new Map();
  for (const [field, value] of Object.entries(object(fields))) {
    const canonicalField = canonicalReplayField(field);
    const normalizedValue = normalizeReplayFieldValue(canonicalField, value);
    if (!present(normalizedValue)) continue;
    if (!values.has(canonicalField)) values.set(canonicalField, new Set());
    values.get(canonicalField).add(replayValueKey(normalizedValue));
  }
  return values;
}

function recordedReadValueCrossedTerminal(field = "", value = null, snapshot = {}, terminalValueKeys = new Map()) {
  if (terminalValueKeys.size === 0) return true;
  const canonicalField = canonicalReplayField(field);
  const normalized = normalizeReplayFieldValue(canonicalField, value);
  if (terminalValueKeys.get(canonicalField)?.has(replayValueKey(normalized)) === true) return true;
  if (canonicalField !== "print_run_number") return false;
  const observedPrintRun = parsePrintRunValue(normalized);
  const terminalPrintRun = serialReadProjection(snapshot.resolved_fields);
  return present(observedPrintRun.print_run_denominator)
    && Array.isArray(terminalPrintRun.denominator)
    && terminalPrintRun.denominator.includes(clean(observedPrintRun.print_run_denominator));
}

function recordedNormalizationDisagrees(field = "", value = null, recordedEvidence = {}) {
  const state = object(recordedEvidence[field]);
  const recordedValue = state.normalized_value ?? state.value;
  if (!present(recordedValue)) return false;
  return replayValueKey(normalizeReplayFieldValue(canonicalReplayField(field), recordedValue))
    !== replayValueKey(normalizeReplayFieldValue(canonicalReplayField(field), value));
}

function terminalResolvedContainsValue(value = null, snapshot = {}) {
  const needle = replayValueKey(replayComparableValue(sanitizePresentValue(value)));
  return Object.values(object(snapshot.resolved_fields)).some((candidate) => (
    present(candidate)
    && replayValueKey(replayComparableValue(sanitizePresentValue(candidate))) === needle
  ));
}

function recordedEvidenceMatchesObservedValue(item = {}, observedValueKeys = new Map()) {
  const state = object(item.state);
  const normalizedValue = normalizeReplayFieldValue(
    item.canonical_field,
    state.normalized_value ?? state.value
  );
  return present(normalizedValue)
    && observedValueKeys.get(item.canonical_field)?.has(replayValueKey(normalizedValue)) === true;
}

function independentSourceSupportsValue(source = {}, value = null, field = "") {
  if (!independentReplayEvidenceSource(source)) return false;
  const rawSourceValue = source.normalized_value
    ?? source.value
    ?? source.observed_text
    ?? source.visible_text
    ?? source.raw_text;
  if (!present(rawSourceValue)) return false;
  const canonicalField = canonicalReplayField(field);
  const normalizedExpected = normalizeReplayFieldValue(canonicalField, value);
  const normalizedSource = normalizeReplayFieldValue(canonicalField, rawSourceValue);
  if (present(normalizedExpected)
    && present(normalizedSource)
    && replayValueKey(normalizedExpected) === replayValueKey(normalizedSource)) {
    return true;
  }
  const sourceText = clean(rawSourceValue).toLowerCase();
  const expectedValues = (Array.isArray(normalizedExpected) ? normalizedExpected : [normalizedExpected])
    .map((item) => clean(item).toLowerCase())
    .filter(Boolean);
  const hasBoundedValue = (item) => {
    const escaped = item
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(sourceText);
  };
  return expectedValues.length > 0 && expectedValues.every(hasBoundedValue);
}

function hasIndependentReplayEvidence(state = {}, field = "") {
  const evidenceState = object(state);
  const resolvedValue = evidenceState.normalized_value ?? evidenceState.value;
  const candidates = Array.isArray(evidenceState.candidates) ? evidenceState.candidates : [];
  const attributedCandidates = candidates.filter((candidate) => (
    Array.isArray(candidate?.sources) && candidate.sources.length
  ));
  if (attributedCandidates.length) return attributedCandidates.some((candidate) => (
    replayValueKey(candidate?.normalized_value ?? candidate?.value) === replayValueKey(resolvedValue)
    && candidate.sources.some((source) => independentSourceSupportsValue(
      source,
      candidate?.normalized_value ?? candidate?.value,
      field
    ))
  ));
  const unattributedCandidateKeys = new Set(candidates.map((candidate) => (
    replayValueKey(candidate?.normalized_value ?? candidate?.value)
  )));
  if (unattributedCandidateKeys.size > 1
    || (unattributedCandidateKeys.size === 1 && !unattributedCandidateKeys.has(replayValueKey(resolvedValue)))) {
    return false;
  }
  return (Array.isArray(evidenceState.sources) ? evidenceState.sources : [])
    .some((source) => independentSourceSupportsValue(source, resolvedValue, field));
}

function normalizeReplayFieldValue(field, value) {
  const sanitized = sanitizePresentValue(value);
  if (!present(sanitized)) return null;
  return sanitizePresentValue(normalizeFieldValue(field, sanitized));
}

function sanitizeRecordedEvidenceState(field, state = {}) {
  const evidenceState = object(state);
  const value = normalizeReplayFieldValue(
    field,
    evidenceState.normalized_value ?? evidenceState.value
  );
  if (!present(value)) return null;
  const candidates = (Array.isArray(evidenceState.candidates) ? evidenceState.candidates : [])
    .map((candidate) => {
      const candidateValue = normalizeReplayFieldValue(field, candidate?.value);
      return present(candidateValue) ? { ...candidate, value: candidateValue } : null;
    })
    .filter(Boolean);
  return {
    ...evidenceState,
    value,
    normalized_value: value,
    candidates: candidates.length ? candidates : [{ value, confidence: evidenceState.confidence ?? 0.65 }]
  };
}

function sourceForCandidate(candidate = {}) {
  const source = clean(candidate.source).toUpperCase();
  const trust = clean(candidate.source_trust).toUpperCase();
  if (source.includes("VECTOR")) return "VECTOR_APPROVED_REFERENCE";
  if (source.includes("OFFICIAL") || trust.includes("OFFICIAL")) return "OFFICIAL_CHECKLIST";
  if (source.includes("INTERNAL") || trust.includes("APPROVED_REFERENCE")) return "INTERNAL_APPROVED_HISTORY";
  if (source.includes("MARKETPLACE") || source.includes("EBAY")) return "MARKETPLACE";
  return "STRUCTURED_DATABASE";
}

function recordedCandidateApplication(result = {}, packet = {}) {
  const recorded = object(
    result.l2_candidate_debug?.retrieval_application
    || result.retrieval_application
    || packet?.replay_snapshot?.semantic_retrieval_application
  );
  const decisions = Array.isArray(recorded.decisions) ? recorded.decisions : [];
  const recordedContractPresent = typeof recorded.enabled === "boolean"
    && Array.isArray(recorded.decisions);
  const identityEvidenceItems = [];
  const seen = new Set();
  for (const action of decisions) {
    const applicationDecision = clean(action.decision || action.action).toUpperCase();
    const field = clean(action.resolver_field || action.field);
    const value = action.final_value ?? action.resolver_value ?? action.candidate_value ?? action.value;
    if (!["APPLY", "SUPPORT"].includes(applicationDecision) || !field || !present(value)) continue;
    const key = `${action.candidate_id || ""}:${field}:${JSON.stringify(value)}:${applicationDecision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    identityEvidenceItems.push({
      field,
      value,
      source: sourceForCandidate({
        source: action.source || action.source_type || action.candidate_lane,
        source_trust: action.source_trust
      }),
      confidence: Number.isFinite(Number(action.confidence))
        ? Number(action.confidence)
        : applicationDecision === "APPLY" ? 0.72 : 0.58,
      metadata: {
        candidate_id: action.candidate_id || null,
        candidate_identity_id: action.candidate_identity_id || null,
        candidate_lane: action.candidate_lane || null,
        permission: action.permission || null,
        retrieval_application_decision: applicationDecision,
        retrieval_application_reason: action.reason || null,
        candidate_is_evidence_not_truth: true,
        replayed_from_evaluation_trace: true
      }
    });
  }
  return {
    enabled: recorded.enabled === true || identityEvidenceItems.length > 0,
    // An explicitly disabled semantic application stage still owns the
    // candidate boundary: it means no legacy candidate path may bypass that
    // decision in replay.
    owns_candidate_application: recordedContractPresent || identityEvidenceItems.length > 0,
    selected_candidate_id: recorded.selected_candidate_id || null,
    identity_evidence_items: identityEvidenceItems
  };
}

function validPrintRunProjection(fields = {}, {
  serialNumeratorVerified = null,
  blockedFields = new Set()
} = {}) {
  const direct = fields.print_run_number;
  const denominatorOnly = !present(direct)
    && !present(fields.print_run_numerator)
    && present(fields.print_run_denominator);
  const oneOfOneInferenceBlocked = blockedFields.has("print_run_number")
    || blockedFields.has("one_of_one");
  if (denominatorOnly
    && clean(fields.print_run_denominator) === "1"
    && (serialNumeratorVerified === false || oneOfOneInferenceBlocked)) {
    return {};
  }
  const composite = !present(direct)
    && present(fields.print_run_numerator)
    && present(fields.print_run_denominator)
    ? `${fields.print_run_numerator}/${fields.print_run_denominator}`
    : direct
      || (present(fields.print_run_denominator) ? `#/${fields.print_run_denominator}` : null)
      || (fields.one_of_one === true ? "1/1" : null);
  const parsed = parsePrintRunValue(composite);
  if (!parsed.print_run_number) return {};
  if (serialNumeratorVerified === false) {
    if (parsed.print_run_denominator === "1") return {};
    const denominatorOnlyProjection = parsePrintRunValue(`#/${parsed.print_run_denominator}`);
    return Object.fromEntries([
      "print_run_number",
      "print_run_denominator"
    ].filter((field) => present(denominatorOnlyProjection[field]))
      .map((field) => [field, denominatorOnlyProjection[field]]));
  }
  return Object.fromEntries([
    "print_run_number",
    "print_run_numerator",
    "print_run_denominator",
    "one_of_one"
  ].filter((field) => present(parsed[field])).map((field) => [field, parsed[field]]));
}

export function projectReadOnlyProviderSnapshot(snapshot = {}) {
  // The output-contract experiment changes only the GPT transport. OCR,
  // focused rereads and other current-image observations remain available, so
  // replay must begin from the terminal observed snapshot rather than silently
  // deleting those independent sensor values.
  const observed = {
    ...object(snapshot.provider_fields),
    ...object(snapshot.observed_fields)
  };
  const recordedEvidence = object(snapshot.normalized_evidence);
  const observedValueKeys = canonicalObservedValueKeys(observed);
  const terminalResolvedValueKeys = canonicalObservedValueKeys(snapshot.resolved_fields);
  const recordedEvidenceProjection = Object.entries(recordedEvidence).map(([field, state]) => ({
    field,
    canonical_field: canonicalReplayField(field),
    state: replayableRecordedEvidence(state) ? sanitizeRecordedEvidenceState(field, state) : null
  }));
  // A terminal normalization decision owns its canonical field family. Raw
  // provider/observed values cannot downgrade CONFLICT, MISSING,
  // NOT_APPLICABLE, or an invalid UNKNOWN projection back into synthetic
  // REVIEW evidence.
  const normalizedBlockedCanonicalFields = closePrintRunBlockedFields(recordedEvidenceProjection
    .filter((item) => item.state === null)
    .map((item) => item.canonical_field));
  const normalizationDroppedFields = normalizationDroppedCanonicalFields(snapshot);
  const rawBlockedCanonicalFields = new Set([
    ...normalizedBlockedCanonicalFields,
    ...normalizationDroppedFields
  ]);
  const admittedRecordedEvidence = Object.fromEntries(recordedEvidenceProjection
    .filter((item) => (
      item.state !== null
      && !normalizedBlockedCanonicalFields.has(item.canonical_field)
      && (
        recordedEvidenceMatchesObservedValue(item, observedValueKeys)
        || hasIndependentReplayEvidence(item.state, item.canonical_field)
      )
      && (
        !normalizationDroppedFields.has(item.canonical_field)
        || (
          !precisionSensitiveNormalizationDrops.has(item.canonical_field)
          && hasIndependentReplayEvidence(item.state, item.canonical_field)
        )
      )
    ))
    .map((item) => [item.field, item.state]));
  const observedReadFields = Object.fromEntries(Object.entries(observed)
    .map(([field, value]) => [field, normalizeReplayFieldValue(field, value)])
    .filter(([field, value]) => (
      readFields.has(field)
      && !rawBlockedCanonicalFields.has(canonicalReplayField(field))
      && (
        recordedReadValueCrossedTerminal(field, value, snapshot, terminalResolvedValueKeys)
        || terminalResolvedContainsValue(value, snapshot)
        || recordedNormalizationDisagrees(field, value, recordedEvidence)
      )
      && present(value)
    )));
  const recordedProviderFieldEvidence = (Array.isArray(snapshot.provider_field_evidence)
    ? snapshot.provider_field_evidence
    : []).filter((item) => {
      const field = evidenceFieldName(item);
      const value = item.value ?? item.v;
      return readFields.has(field)
        && !rawBlockedCanonicalFields.has(canonicalReplayField(field))
        && recordedReadValueCrossedTerminal(field, value, snapshot, terminalResolvedValueKeys);
    });
  // Terminal normalized evidence also contains independent OCR/focused-reread
  // values that are intentionally absent from `observed_fields`.  Dropping
  // them makes replay incomparable with the deployed baseline (notably slab
  // grade and current-instance print run).  Only READ-owned, present values
  // may re-enter the replay input; DERIVED/DROP fields remain excluded.
  const recordedReadFields = Object.fromEntries(Object.entries(admittedRecordedEvidence)
    .map(([field, state]) => {
      const evidenceState = object(state);
      const rawValue = evidenceState.normalized_value ?? evidenceState.value;
      return [field, normalizeReplayFieldValue(field, rawValue)];
    })
    .filter(([field, value]) => (
      readFields.has(field)
      && present(value)
      // Normalized evidence includes rejected alternatives. Replay only the
      // current-image values that actually crossed the recorded Resolver
      // boundary; otherwise a rejected slab/finish observation can be
      // resurrected as a synthetic title change.
      && (
        recordedReadValueCrossedTerminal(field, value, snapshot, terminalResolvedValueKeys)
      )
    )));
  const recordedEvidenceFields = new Set(recordedProviderFieldEvidence.map(evidenceFieldName));
  const replaySynthesizedFieldEvidence = Object.entries(recordedReadFields)
    .filter(([field]) => !recordedEvidenceFields.has(field))
    .flatMap(([field, value]) => {
      const state = object(admittedRecordedEvidence[field]);
      const source = (Array.isArray(state.sources) ? state.sources : [])
        .find((item) => independentReplayEvidenceSource(item));
      if (!source) return [];
      return [{
        field,
        value,
        source_type: source.source_type || source.source,
        source_image_id: source.image_id || null,
        source_region: source.region || field,
        visible_text: source.observed_text || source.visible_text || source.raw_text || String(value),
        raw_text: source.raw_text || source.observed_text || source.visible_text || String(value),
        directly_observed: source.direct_observation !== false,
        direct_observation: source.direct_observation !== false,
        review_required: true
      }];
    });
  const providerFieldEvidence = [
    ...recordedProviderFieldEvidence,
    ...replaySynthesizedFieldEvidence
  ];
  const unguardedProviderFields = {
    ...observedReadFields,
    ...recordedReadFields
  };
  const providerFields = {
    ...Object.fromEntries(Object.entries(unguardedProviderFields)
      .filter(([field]) => !["print_run_number", "print_run_numerator", "print_run_denominator", "one_of_one"].includes(field))),
    ...validPrintRunProjection(unguardedProviderFields, {
      serialNumeratorVerified: object(snapshot.effective_terminal_renderer_inputs).serial_numerator_verified ?? null,
      blockedFields: rawBlockedCanonicalFields
    })
  };
  const normalizedEvidence = Object.fromEntries(Object.entries(providerFields).map(([field, value]) => [
    field,
    admittedRecordedEvidence[field] || {
      value,
      status: "REVIEW",
      sources: [{
        source_type: "VISION_MODEL",
        observed_text: Array.isArray(value) ? value.join(" / ") : String(value),
        source_inference_method: "evaluation_replay_observed_snapshot"
      }],
      candidates: [{ value, confidence: 0.65 }],
      confidence: 0.65,
      normalized_value: value
    }
  ]));
  return {
    fields: providerFields,
    field_evidence: providerFieldEvidence,
    normalized_evidence: normalizedEvidence,
    unresolved: []
  };
}

function replaySerialVerificationTrace(serialNumeratorVerified) {
  if (serialNumeratorVerified === null) return [];
  if (serialNumeratorVerified === true) {
    return [{
      action: "CROP_AND_READ_SERIAL",
      status: "executed",
      output: {
        focused_vision: {
          updated_fields: ["serial_number"],
          conflicting_fields: []
        }
      },
      replayed_from_effective_terminal_renderer_inputs: true
    }];
  }
  return [{
    action: "CROP_AND_READ_SERIAL",
    status: "no_information",
    output: { focused_vision: { updated_fields: [], conflicting_fields: [] } },
    replayed_from_effective_terminal_renderer_inputs: true
  }];
}

export async function replayProviderOutputContract(report = {}, {
  model = null,
  maxLength = 80,
  allowConstraintModelChange = false
} = {}) {
  const constraintModel = model || await loadConstraintModelSnapshot();
  const candidateConstraintVersions = Object.freeze({
    constraint_snapshot: clean(
      constraintModel.snapshot_version
      || constraintModel.schema_version
      || constraintModel.version
    ) || null,
    constraint_snapshot_sha256: clean(constraintModel.snapshot_source_sha256) || null,
    constraint_enumerator: constraintEnumerationVersion
  });
  const results = Array.isArray(report.results) ? report.results : [];
  const rows = [];

  for (const result of results) {
    const packet = result.evaluation_decision_trace_packet;
    const snapshot = packet?.replay_snapshot;
    const terminalTitle = clean(result.final_title || result.title);
    if (snapshot && snapshot.schema_version !== evaluationReplaySnapshotSchemaVersion) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "SNAPSHOT_SCHEMA_UNSUPPORTED",
        expected_schema_version: evaluationReplaySnapshotSchemaVersion,
        actual_schema_version: snapshot.schema_version || null
      });
      continue;
    }
    if (!snapshot || snapshot.status !== "COMPLETE") {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: snapshot ? `SNAPSHOT_${snapshot.status || "PARTIAL"}` : "SNAPSHOT_ABSENT"
      });
      continue;
    }
    if (!normalizationProjectionComplete(
      snapshot.normalization,
      snapshot.provider_fields,
      snapshot.observed_fields
    )) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "TRACE_MISSING_NORMALIZATION_PROJECTION"
      });
      continue;
    }
    if (!Object.keys(object(snapshot.resolved_fields)).length
      || !Object.keys(object(snapshot.rendered_fields)).length) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "TRACE_MISSING_TERMINAL_FIELD_PROJECTION"
      });
      continue;
    }
    if (!terminalTitle) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "TRACE_MISSING_TERMINAL_TITLE"
      });
      continue;
    }

    const effectiveRendererInputs = object(snapshot.effective_terminal_renderer_inputs);
    const serialNumeratorVerified = effectiveRendererInputs.serial_numerator_verified;
    if (!Object.hasOwn(effectiveRendererInputs, "serial_numerator_verified")
      || ![true, false, null].includes(serialNumeratorVerified)) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "TRACE_MISSING_EFFECTIVE_SERIAL_PRESENTATION_STATE"
      });
      continue;
    }
    if (effectiveRendererInputs.trust_resolved_print_run_without_evidence !== true
      && effectiveRendererInputs.trust_resolved_print_run_without_evidence !== false) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "TRACE_MISSING_EFFECTIVE_PRINT_RUN_TRUST_STATE"
      });
      continue;
    }
    const missingRequiredComponents = missingRequiredReplaySnapshotComponents(snapshot);
    if (missingRequiredComponents.length) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "SNAPSHOT_REQUIRED_COMPONENTS_MISSING",
        missing_components: missingRequiredComponents
      });
      continue;
    }
    const recordedConstraintVersions = {
      constraint_snapshot: clean(snapshot.versions?.constraint_snapshot) || null,
      constraint_snapshot_sha256: clean(snapshot.versions?.constraint_snapshot_sha256) || null,
      constraint_enumerator: clean(snapshot.versions?.constraint_enumerator) || null
    };
    const candidateConstraintVersionsMissing = Object.entries(candidateConstraintVersions)
      .filter(([, value]) => !value)
      .map(([field]) => field);
    if (candidateConstraintVersionsMissing.length) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "CONSTRAINT_CANDIDATE_VERSION_MISSING",
        missing_components: candidateConstraintVersionsMissing,
        candidate_constraint_versions: candidateConstraintVersions
      });
      continue;
    }
    const constraintVersionMismatches = Object.keys(recordedConstraintVersions).filter((field) => (
      recordedConstraintVersions[field] !== candidateConstraintVersions[field]
    ));
    if (constraintVersionMismatches.length && !allowConstraintModelChange) {
      rows.push({
        asset_id: result.asset_id || null,
        replayable: false,
        reason: "CONSTRAINT_REPLAY_VERSION_MISMATCH",
        mismatch_fields: constraintVersionMismatches,
        recorded_constraint_versions: recordedConstraintVersions,
        candidate_constraint_versions: candidateConstraintVersions
      });
      continue;
    }
    const projected = projectReadOnlyProviderSnapshot(snapshot);
    const snapshotMaxLength = Math.max(1, Number(effectiveRendererInputs.max_title_length || maxLength) || maxLength);
    // Replay the real normalization boundary so canonical aliases such as
    // serial_number/numbered_to are deterministically rebuilt from the READ
    // print-run fields.  Keep the recorded current-image evidence on top so
    // direct OCR/slab provenance is not weakened by replay synthesis.
    const evidenceDocument = providerPayloadToEvidenceDocument({
      fields: projected.fields,
      field_evidence: projected.field_evidence,
      unresolved: projected.unresolved
    });
    const replayEvidence = {
      ...evidenceDocument.evidence,
      ...projected.normalized_evidence
    };
    const replayApplication = recordedCandidateApplication(result, packet);
    const base = {
      provider: "openai_legacy",
      source: "openai_legacy",
      fields: evidenceDocument.resolved,
      raw_provider_fields: projected.fields,
      raw_provider_field_evidence: projected.field_evidence,
      raw_observed_fields: evidenceDocument.resolved,
      evidence: replayEvidence,
      normalized_evidence: replayEvidence,
      resolved: evidenceDocument.resolved,
      resolved_fields: evidenceDocument.resolved,
      unresolved: evidenceDocument.unresolved,
      retrieval_application: replayApplication,
      serial_numerator_verified: serialNumeratorVerified,
      resolution_trace: replaySerialVerificationTrace(serialNumeratorVerified),
      recognition_status: "RESOLVED"
    };
    const candidateInput = attachForwardEnumerationCandidates(base, constraintModel, { shadow: false });
    const resolvedCandidate = applyIdentityResolutionGate(candidateInput, {
      maxLength: snapshotMaxLength,
      providerId: "openai_legacy"
    });
    // `applyIdentityResolutionGate` has already produced canonical terminal
    // fields. Running the V4 result adapter here would resolve them a second
    // time and can promote a REVIEW-only value. Production's final boundary is
    // the deterministic renderer over the resolved fields and terminal
    // evidence, so replay that exact boundary once.
    const candidatePresentation = renderListingPresentation({
      resolved: resolvedCandidate.resolved_fields,
      evidence: snapshot.normalized_evidence,
      maxLength: snapshotMaxLength,
      serialNumeratorVerified
    });
    const candidate = {
      ...resolvedCandidate,
      title: candidatePresentation.final_title,
      final_title: candidatePresentation.final_title,
      rendered_title: candidatePresentation.rendered_title,
      renderer_version: candidatePresentation.renderer_version,
      title_length_policy: candidatePresentation.title_length_policy,
      rendered_fields: {
        fields: resolvedCandidate.resolved_fields,
        title: candidatePresentation.final_title,
        rendered_title: candidatePresentation.rendered_title,
        modules: candidatePresentation.modules,
        module_order: candidatePresentation.module_order
      }
    };
    const snapshotTitle = clean(snapshot.final_title);
    const baselineTitle = terminalTitle;
    const candidateTitle = clean(candidate.final_title || candidate.title);
    const reference = referenceTitle(result);
    const baselineRecall = reference ? policyFairTokenRecall(reference, baselineTitle) : null;
    const candidateRecall = reference ? policyFairTokenRecall(reference, candidateTitle) : null;
    const baselineSem = reference
      ? scoreReviewedTitleSemProjection({ referenceTitle: reference, finalTitle: baselineTitle })
      : null;
    const candidateSem = reference
      ? scoreReviewedTitleSemProjection({ referenceTitle: reference, finalTitle: candidateTitle })
      : null;
    // The deployed terminal snapshot may retain a hidden, rejected numerator
    // internally even when the effective renderer correctly emits only #/N.
    // Use the sanitized READ transport as the baseline so safe information
    // reduction is not misclassified as a regression.
    // Compare terminal-to-terminal. `projected.fields` is intentionally only
    // the Provider transport and therefore excludes later current-image OCR,
    // focused rereads, and safely applied catalog fields.
    const resolverReadParity = protectedReadPreservation(
      effectiveTerminalReadFields(snapshot.resolved_fields, serialNumeratorVerified),
      effectiveTerminalReadFields(candidate.resolved_fields, serialNumeratorVerified)
    );
    const rendererReadParity = protectedReadPreservation(
      effectiveTerminalReadFields(snapshot.rendered_fields, serialNumeratorVerified),
      effectiveTerminalReadFields(
        candidate.rendered_fields?.fields || candidate.rendered_fields,
        serialNumeratorVerified
      )
    );
    const rendererParity = effectiveRendererParity({
      renderer_version: snapshot.versions?.renderer,
      ...effectiveRendererInputs
    }, {
      renderer_version: candidate.renderer_version,
      max_title_length: candidate.title_length_policy?.max_length || snapshotMaxLength,
      serial_numerator_verified: candidate.serial_numerator_verified ?? null,
      trust_resolved_print_run_without_evidence: true
    });
    const protectedReadStateMatch = resolverReadParity.matches && rendererReadParity.matches;
    const derived = candidate.forward_enumeration_trace || [];
    const scoreRegression = Number.isFinite(baselineRecall) && Number.isFinite(candidateRecall)
      ? candidateRecall + 1e-9 < baselineRecall
      : false;
    const semRegression = baselineSem && candidateSem
      ? candidateSem.weighted_accuracy + 1e-9 < baselineSem.weighted_accuracy
        || requiredAcceptanceFailureRegression(
          baselineSem.required_acceptance_failures,
          candidateSem.required_acceptance_failures
        )
      : false;
    rows.push({
      asset_id: result.asset_id || null,
      replayable: true,
      constraint_model_change_allowed: allowConstraintModelChange === true,
      constraint_model_changed: constraintVersionMismatches.length > 0,
      recorded_constraint_versions: recordedConstraintVersions,
      candidate_constraint_versions: candidateConstraintVersions,
      replay_snapshot_status: "COMPLETE",
      replay_snapshot_repaired_components: [],
      baseline_title: baselineTitle,
      replay_snapshot_title: snapshotTitle || null,
      replay_snapshot_terminal_title_match: Boolean(snapshotTitle && baselineTitle === snapshotTitle),
      protected_read_parity: protectedReadStateMatch,
      protected_read_resolver: resolverReadParity,
      protected_read_renderer: rendererReadParity,
      effective_renderer_parity: rendererParity.matches,
      effective_renderer_inputs: rendererParity,
      candidate_title: candidateTitle,
      title_changed: baselineTitle !== candidateTitle,
      reference_title: reference || null,
      baseline_policy_fair_token_recall: baselineRecall,
      candidate_policy_fair_token_recall: candidateRecall,
      baseline_sem_weighted_accuracy: baselineSem?.weighted_accuracy ?? null,
      candidate_sem_weighted_accuracy: candidateSem?.weighted_accuracy ?? null,
      baseline_sem_required_acceptance_failures: baselineSem?.required_acceptance_failures ?? null,
      candidate_sem_required_acceptance_failures: candidateSem?.required_acceptance_failures ?? null,
      contract_regression: scoreRegression || semRegression,
      forward_value_fields: derived.filter((item) => item.status === "VALUE").map((item) => item.field),
      forward_unknown_fields: derived.filter((item) => item.status === "UNKNOWN").map((item) => item.field),
      derived_values_applied: (candidate.retrieval_application?.actual_applied_fields || []).slice()
    });
  }

  const replayable = rows.filter((row) => row.replayable);
  const scored = replayable.filter((row) => Number.isFinite(row.baseline_policy_fair_token_recall));
  const average = (values) => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
    : null;
  return {
    schema_version: "provider-output-contract-replay-v3",
    constraint_model_change_allowed: allowConstraintModelChange === true,
    candidate_constraint_versions: candidateConstraintVersions,
    result_count: results.length,
    replayable_count: replayable.length,
    incomplete_snapshot_count: results.length - replayable.length,
    scored_count: scored.length,
    unscored_count: replayable.length - scored.length,
    snapshot_terminal_title_mismatch_count: replayable.filter((row) => !row.replay_snapshot_terminal_title_match).length,
    title_changed_count: replayable.filter((row) => row.title_changed).length,
    contract_regression_count: replayable.filter((row) => row.contract_regression).length,
    protected_read_parity_failure_count: replayable.filter((row) => !row.protected_read_parity).length,
    effective_renderer_parity_failure_count: replayable.filter((row) => !row.effective_renderer_parity).length,
    forward_value_count: replayable.reduce((sum, row) => sum + row.forward_value_fields.length, 0),
    derived_application_count: replayable.reduce((sum, row) => sum + row.derived_values_applied.length, 0),
    baseline_policy_fair_token_recall: average(scored.map((row) => row.baseline_policy_fair_token_recall)),
    candidate_policy_fair_token_recall: average(scored.map((row) => row.candidate_policy_fair_token_recall)),
    gate_passed: replayRowsPassGate(rows, results.length),
    rows
  };
}

export async function main(argv = process.argv) {
  const inputPath = argValue(argv, "--input");
  if (!inputPath) throw new Error("--input is required");
  const outputPath = argValue(argv, "--out");
  const maxLength = Math.max(1, Number(argValue(argv, "--max-length", "80")) || 80);
  const allowConstraintModelChange = argv.includes("--allow-constraint-model-change");
  const report = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const replay = await replayProviderOutputContract(report, { maxLength, allowConstraintModelChange });
  if (outputPath) {
    const resolved = resolve(outputPath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(replay, null, 2)}\n`, "utf8");
  }
  process.stdout.write([
    `provider contract replay: ${replay.replayable_count}/${replay.result_count} replayable`,
    `policy recall: ${replay.baseline_policy_fair_token_recall} -> ${replay.candidate_policy_fair_token_recall}`,
    `title changed=${replay.title_changed_count} regressions=${replay.contract_regression_count}`,
    `forward values=${replay.forward_value_count} applied=${replay.derived_application_count}`,
    `gate=${replay.gate_passed}`
  ].join("\n") + "\n");
  return replay.gate_passed ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
