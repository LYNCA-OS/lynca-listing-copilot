import { semCanonicalEditableFields, SEM_STANDARD_VERSION } from "../sem-definition.mjs";

export const CSM_STAGE_CONTRACT_VERSION = "csm-stage-contracts-v1";

export const csmGrammar = Object.freeze({
  TCG: "TCG",
  NON_TCG: "NON_TCG"
});

export const csmBracketValueKind = Object.freeze({
  VALUE: "VALUE",
  EMPTY: "EMPTY"
});

export const csmEmptyReason = Object.freeze({
  ABSENT: "ABSENT",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE"
});

export const csmEvidenceModality = Object.freeze({
  WHOLE_CARD_VISUAL: "WHOLE_CARD_VISUAL",
  CARD_TEXT_OCR: "CARD_TEXT_OCR",
  SLAB_LABEL: "SLAB_LABEL",
  REGISTRY: "REGISTRY"
});

export const csmNormalizationOutcome = Object.freeze({
  KEPT: "KEPT",
  DROPPED: "DROPPED"
});

const grammarValues = new Set(Object.values(csmGrammar));
const bracketNames = new Set(semCanonicalEditableFields);
const evidenceModalities = new Set(Object.values(csmEvidenceModality));
const normalizationOutcomes = new Set(Object.values(csmNormalizationOutcome));
const emptyReasons = new Set(Object.values(csmEmptyReason));

export class CsmStageContractError extends Error {
  constructor(code, path = "") {
    super(path ? `${code}:${path}` : code);
    this.name = "CsmStageContractError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path = "") {
  throw new CsmStageContractError(code, path);
}

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("OBJECT_REQUIRED", path);
  return value;
}

function assertText(value, path) {
  if (!String(value || "").trim()) fail("TEXT_REQUIRED", path);
  return String(value).trim();
}

function assertConfidence(value, path) {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail("CONFIDENCE_OUT_OF_RANGE", path);
  return value;
}

function assertGrammar(value, path = "grammar") {
  if (!grammarValues.has(value)) fail("INVALID_GRAMMAR", path);
  return value;
}

function assertBracket(value, path) {
  if (!bracketNames.has(value)) fail("INVALID_CSM_BRACKET", path);
  return value;
}

function assertStringArray(value, path, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail("STRING_ARRAY_REQUIRED", path);
  value.forEach((entry, index) => assertText(entry, `${path}[${index}]`));
  return value;
}

function assertContractEnvelope(packet, expectedType) {
  assertObject(packet, "$packet");
  if (packet.contract_version !== CSM_STAGE_CONTRACT_VERSION) fail("CONTRACT_VERSION_MISMATCH", "contract_version");
  if (packet.packet_type !== expectedType) fail("PACKET_TYPE_MISMATCH", "packet_type");
  assertText(packet.run_id, "run_id");
  assertText(packet.registry_version, "registry_version");
  assertText(packet.registry_content_sha256, "registry_content_sha256");
  if (!/^[0-9a-f]{64}$/i.test(packet.registry_content_sha256)) fail("REGISTRY_HASH_INVALID", "registry_content_sha256");
  assertText(packet.recognition_pipeline_fingerprint, "recognition_pipeline_fingerprint");
  if (!/^[0-9a-f]{64}$/i.test(packet.recognition_pipeline_fingerprint)) {
    fail("PIPELINE_FINGERPRINT_INVALID", "recognition_pipeline_fingerprint");
  }
  assertGrammar(packet.grammar);
  return packet;
}

export function csmValue(canonical) {
  if (canonical === undefined || canonical === null || canonical === "") fail("CANONICAL_VALUE_REQUIRED", "canonical");
  return Object.freeze({ kind: csmBracketValueKind.VALUE, canonical });
}

export function csmEmpty(reason = csmEmptyReason.INSUFFICIENT_EVIDENCE) {
  if (!emptyReasons.has(reason)) fail("INVALID_EMPTY_REASON", "reason");
  return Object.freeze({ kind: csmBracketValueKind.EMPTY, reason });
}

export function assertBracketValue(value, path = "value") {
  assertObject(value, path);
  if (value.kind === csmBracketValueKind.VALUE) {
    if (value.canonical === undefined || value.canonical === null || value.canonical === "") {
      fail("CANONICAL_VALUE_REQUIRED", `${path}.canonical`);
    }
    if ("reason" in value) fail("VALUE_CANNOT_HAVE_EMPTY_REASON", `${path}.reason`);
    return value;
  }
  if (value.kind === csmBracketValueKind.EMPTY) {
    if (!emptyReasons.has(value.reason)) fail("INVALID_EMPTY_REASON", `${path}.reason`);
    if ("canonical" in value) fail("EMPTY_CANNOT_HAVE_CANONICAL_VALUE", `${path}.canonical`);
    return value;
  }
  return fail("INVALID_BRACKET_VALUE_KIND", `${path}.kind`);
}

function assertEvidenceObservation(observation, index) {
  const path = `evidence[${index}]`;
  assertObject(observation, path);
  assertText(observation.id, `${path}.id`);
  assertBracket(observation.bracket, `${path}.bracket`);
  if (!evidenceModalities.has(observation.modality)) fail("INVALID_EVIDENCE_MODALITY", `${path}.modality`);
  assertConfidence(observation.confidence, `${path}.confidence`);
  assertObject(observation.source_ref, `${path}.source_ref`);
  assertObject(observation.normalization, `${path}.normalization`);
  assertText(observation.normalization.version, `${path}.normalization.version`);
  if (!normalizationOutcomes.has(observation.normalization.outcome)) {
    fail("INVALID_NORMALIZATION_OUTCOME", `${path}.normalization.outcome`);
  }
  assertText(observation.normalization.reason_code, `${path}.normalization.reason_code`);
  if (observation.normalization.outcome === csmNormalizationOutcome.KEPT
      && (observation.normalized_value === undefined || observation.normalized_value === null)) {
    fail("KEPT_EVIDENCE_REQUIRES_NORMALIZED_VALUE", `${path}.normalized_value`);
  }
  return observation;
}

function assertBracketCandidate(candidate, index, evidenceIds) {
  const path = `candidates[${index}]`;
  assertObject(candidate, path);
  assertText(candidate.id, `${path}.id`);
  assertBracket(candidate.bracket, `${path}.bracket`);
  assertBracketValue(candidate.value, `${path}.value`);
  assertStringArray(candidate.supporting_evidence_ids, `${path}.supporting_evidence_ids`);
  assertStringArray(candidate.contradicting_evidence_ids, `${path}.contradicting_evidence_ids`);
  for (const [field, ids] of [
    ["supporting_evidence_ids", candidate.supporting_evidence_ids],
    ["contradicting_evidence_ids", candidate.contradicting_evidence_ids]
  ]) {
    ids.forEach((id, evidenceIndex) => {
      if (!evidenceIds.has(id)) fail("UNKNOWN_EVIDENCE_REFERENCE", `${path}.${field}[${evidenceIndex}]`);
    });
  }
  assertText(candidate.source_trust, `${path}.source_trust`);
  assertConfidence(candidate.confidence, `${path}.confidence`);
  return candidate;
}

export function assertRecognitionPacket(packet) {
  assertContractEnvelope(packet, "RECOGNITION_PACKET");
  assertText(packet.recognition_version, "recognition_version");
  assertText(packet.provider_version, "provider_version");
  assertText(packet.prompt_version, "prompt_version");
  assertText(packet.ocr_provider_version, "ocr_provider_version");
  assertText(packet.ocr_model_version, "ocr_model_version");
  assertText(packet.image_preprocess_version, "image_preprocess_version");
  assertText(packet.crop_policy_version, "crop_policy_version");
  assertText(packet.evidence_schema_version, "evidence_schema_version");
  assertText(packet.normalization_version, "normalization_version");
  assertText(packet.candidate_schema_version, "candidate_schema_version");
  assertConfidence(packet.grammar_confidence, "grammar_confidence");
  if (!Array.isArray(packet.evidence) || !Array.isArray(packet.candidates)) fail("RECOGNITION_ARRAYS_REQUIRED");

  const evidenceIds = new Set();
  packet.evidence.forEach((observation, index) => {
    assertEvidenceObservation(observation, index);
    if (evidenceIds.has(observation.id)) fail("DUPLICATE_EVIDENCE_ID", `evidence[${index}].id`);
    evidenceIds.add(observation.id);
  });
  const candidateIds = new Set();
  packet.candidates.forEach((candidate, index) => {
    assertBracketCandidate(candidate, index, evidenceIds);
    if (candidateIds.has(candidate.id)) fail("DUPLICATE_CANDIDATE_ID", `candidates[${index}].id`);
    candidateIds.add(candidate.id);
  });
  return packet;
}

export function assertResolutionPacket(packet) {
  assertContractEnvelope(packet, "RESOLUTION_PACKET");
  assertText(packet.resolver_version, "resolver_version");
  assertText(packet.conflict_policy_version, "conflict_policy_version");
  assertText(packet.recognition_packet_sha256, "recognition_packet_sha256");
  if (!/^[0-9a-f]{64}$/i.test(packet.recognition_packet_sha256)) {
    fail("RECOGNITION_PACKET_HASH_INVALID", "recognition_packet_sha256");
  }
  assertObject(packet.fields, "fields");

  for (const bracket of bracketNames) {
    if (!(bracket in packet.fields)) fail("MISSING_RESOLVED_BRACKET", `fields.${bracket}`);
  }

  for (const [bracket, resolution] of Object.entries(packet.fields)) {
    assertBracket(bracket, `fields.${bracket}`);
    assertObject(resolution, `fields.${bracket}`);
    assertBracketValue(resolution.selected, `fields.${bracket}.selected`);
    if (resolution.selected.kind === csmBracketValueKind.VALUE) {
      assertText(resolution.selected_candidate_id, `fields.${bracket}.selected_candidate_id`);
    } else if (resolution.selected_candidate_id !== null) {
      fail("EMPTY_CANNOT_SELECT_CANDIDATE", `fields.${bracket}.selected_candidate_id`);
    }
    assertStringArray(resolution.alternate_candidate_ids, `fields.${bracket}.alternate_candidate_ids`);
    assertStringArray(resolution.rationale_codes, `fields.${bracket}.rationale_codes`, { allowEmpty: false });
    assertConfidence(resolution.confidence, `fields.${bracket}.confidence`);
  }

  for (const forbidden of ["evidence", "candidates", "title", "marketplace_output"]) {
    if (forbidden in packet) fail("RESOLUTION_LAYER_OWNS_CANONICAL_ONLY", forbidden);
  }
  return packet;
}

export function assertMarketplacePacket(packet) {
  assertContractEnvelope(packet, "MARKETPLACE_PACKET");
  assertText(packet.resolution_revision_id, "resolution_revision_id");
  assertText(packet.resolution_packet_sha256, "resolution_packet_sha256");
  if (!/^[0-9a-f]{64}$/i.test(packet.resolution_packet_sha256)) {
    fail("RESOLUTION_PACKET_HASH_INVALID", "resolution_packet_sha256");
  }
  assertText(packet.composer_version, "composer_version");
  assertText(packet.marketplace_profile_version, "marketplace_profile_version");
  if (packet.marketplace !== "EBAY") fail("UNSUPPORTED_MARKETPLACE", "marketplace");
  const title = assertText(packet.title, "title");
  if ([...title].length > 80) fail("MARKETPLACE_TITLE_TOO_LONG", "title");
  assertObject(packet.structured_output, "structured_output");
  assertStringArray(packet.included_brackets, "included_brackets");
  packet.included_brackets.forEach((bracket, index) => assertBracket(bracket, `included_brackets[${index}]`));
  if (!Array.isArray(packet.dropped)) fail("DROPPED_TRACE_REQUIRED", "dropped");
  packet.dropped.forEach((entry, index) => {
    assertObject(entry, `dropped[${index}]`);
    assertBracket(entry.bracket, `dropped[${index}].bracket`);
    assertText(entry.reason_code, `dropped[${index}].reason_code`);
  });
  for (const forbidden of ["evidence", "candidates", "provider_response", "raw_model_response"]) {
    if (forbidden in packet) fail("MARKETPLACE_LAYER_CANNOT_READ_UPSTREAM_RAW_DATA", forbidden);
  }
  return packet;
}

export function csmContractMetadata(overrides = {}) {
  return Object.freeze({
    contract_version: CSM_STAGE_CONTRACT_VERSION,
    sem_standard_version: SEM_STANDARD_VERSION,
    ...overrides
  });
}
