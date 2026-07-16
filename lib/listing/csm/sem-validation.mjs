import crypto from "node:crypto";

import { feedbackPayloadSha256 } from "../feedback/feedback-capture.mjs";
import {
  SEM_VALIDATION_SOURCE_TYPES,
  SEM_VALIDATION_STATUSES,
  WRITER_TITLE_SEM_PARSER_VERSION
} from "./title-derived-sem.mjs";
import { SEM_STANDARD_VERSION, semCanonicalEditableFields } from "./sem-definition.mjs";

export const SEM_VALIDATION_EVENT_SCHEMA_VERSION = "sem-validation-event-v1";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedSources(sources = {}) {
  const input = plainObject(sources);
  return Object.fromEntries(SEM_VALIDATION_SOURCE_TYPES.map((source) => {
    const record = plainObject(input[source]);
    const status = cleanText(record.status || "NOT_RUN").toUpperCase();
    if (!['NOT_RUN', 'SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(status)) {
      throw new Error(`invalid_sem_validation_source_status:${source}`);
    }
    return [source, {
      status,
      evidence_refs: Array.isArray(record.evidence_refs)
        ? record.evidence_refs.map(cleanText).filter(Boolean)
        : [],
      note: cleanText(record.note) || null
    }];
  }));
}

export function buildSemValidationEvent({
  validationId = crypto.randomUUID(),
  learningEventId = "",
  feedbackEventId = "",
  recognitionSessionId = "",
  tenantId = "",
  userId = "",
  assetId = "",
  identityGroupId = "",
  extraction = {},
  validatedSem = {},
  validationStatus = "PENDING",
  confidence = null,
  validationSources = {},
  reviewedBy = "",
  reviewedAt = null,
  createdAt = new Date().toISOString()
} = {}) {
  const status = cleanText(validationStatus).toUpperCase();
  if (!SEM_VALIDATION_STATUSES.includes(status)) throw new Error("invalid_sem_validation_status");
  const normalizedConfidence = confidence === null || confidence === undefined || confidence === ""
    ? null
    : Number(confidence);
  if (normalizedConfidence !== null
      && (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1)) {
    throw new Error("invalid_sem_validation_confidence");
  }
  const sources = normalizedSources(validationSources);
  const reviewer = cleanText(reviewedBy);
  const reviewTimestamp = reviewedAt ? new Date(reviewedAt) : null;
  if (reviewTimestamp && Number.isNaN(reviewTimestamp.getTime())) throw new Error("invalid_sem_validation_reviewed_at");
  const candidateSem = plainObject(extraction.candidate_sem || extraction.sem);
  const humanSem = plainObject(validatedSem);
  const parserVersion = cleanText(extraction.parser_version);
  const semStandardVersion = cleanText(extraction.sem_standard_version);
  if (!parserVersion || !semStandardVersion) throw new Error("sem_validation_candidate_provenance_required");
  const unknownHumanFields = Object.keys(humanSem)
    .filter((field) => !semCanonicalEditableFields.includes(field));
  if (unknownHumanFields.length) {
    throw new Error(`unknown_validated_sem_fields:${unknownHumanFields.sort().join(",")}`);
  }
  if (status !== "PENDING" && (!reviewer || !reviewTimestamp)) {
    throw new Error("reviewer_and_reviewed_at_required");
  }
  if (status === "VALIDATED") {
    if (!Object.keys(humanSem).length) throw new Error("validated_sem_required");
    if (!cleanText(identityGroupId)) throw new Error("validated_sem_identity_group_required");
    if (semStandardVersion !== SEM_STANDARD_VERSION) {
      throw new Error("validated_sem_standard_version_mismatch");
    }
    if (parserVersion !== WRITER_TITLE_SEM_PARSER_VERSION) {
      throw new Error("validated_sem_parser_version_mismatch");
    }
    if (!Object.values(sources).some((source) => (
      source.status === "SUPPORTED" && source.evidence_refs.length > 0
    ))) {
      throw new Error("supporting_validation_source_required");
    }
  }
  if (status === "REJECTED"
      && !Object.values(sources).some((source) => ["CONTRADICTED", "SUPPORTED"].includes(source.status))) {
    throw new Error("rejection_validation_source_required");
  }
  const base = {
    schema_version: SEM_VALIDATION_EVENT_SCHEMA_VERSION,
    id: cleanText(validationId),
    learning_event_id: cleanText(learningEventId) || null,
    feedback_event_id: cleanText(feedbackEventId) || null,
    recognition_session_id: cleanText(recognitionSessionId) || null,
    tenant_id: cleanText(tenantId) || null,
    user_id: cleanText(userId) || null,
    asset_id: cleanText(assetId) || null,
    identity_group_id: cleanText(identityGroupId) || null,
    parser_version: parserVersion,
    sem_standard_version: semStandardVersion,
    candidate_sem: candidateSem,
    validated_sem: status === "VALIDATED" ? humanSem : {},
    confidence: normalizedConfidence,
    validation_status: status,
    validation_sources: sources,
    reviewed_by: reviewer || null,
    reviewed_at: reviewTimestamp ? reviewTimestamp.toISOString() : null,
    semantic_truth: status === "VALIDATED",
    golden_sem_candidate: status === "VALIDATED",
    dataset_disposition: "OBSERVE_ONLY",
    training_eligible: false,
    created_at: new Date(createdAt).toISOString()
  };
  if (!base.id) throw new Error("sem_validation_id_required");
  if (!base.learning_event_id || !base.feedback_event_id || !base.recognition_session_id) {
    throw new Error("sem_validation_parent_provenance_required");
  }
  return { ...base, payload_sha256: feedbackPayloadSha256(base) };
}
