import crypto from "node:crypto";
import { v4SchemaVersion } from "../v4/schema/version.mjs";
import { SEM_STANDARD_VERSION } from "../csm/sem-definition.mjs";
import { sessionDataIdentitySnapshot } from "./data-identity.mjs";

export const FEEDBACK_CAPTURE_SCHEMA_VERSION = "v4-writer-feedback-capture-v1";
export const FEEDBACK_DATASET_DISPOSITION = "OBSERVE_ONLY";
export const ADMIN_TEST_DATASET_DISPOSITION = "ADMIN_TEST_ONLY";
export const FEEDBACK_DATASET_DISPOSITIONS = Object.freeze([
  FEEDBACK_DATASET_DISPOSITION,
  ADMIN_TEST_DATASET_DISPOSITION
]);

export function normalizeFeedbackDatasetDisposition(value) {
  const normalized = cleanText(value).toUpperCase();
  return FEEDBACK_DATASET_DISPOSITIONS.includes(normalized)
    ? normalized
    : FEEDBACK_DATASET_DISPOSITION;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
      .filter(([, child]) => child !== undefined));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function createFeedbackSubmissionId() {
  return crypto.randomUUID();
}

export function normalizeFeedbackSubmissionId(value, { required = false } = {}) {
  const normalized = cleanText(value);
  if (!normalized) {
    if (required) throw new Error("feedback_submission_id_required");
    return "";
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(normalized)) {
    throw new Error("invalid_feedback_submission_id");
  }
  return normalized;
}

export function feedbackEventIdentity({ sessionId = "", submissionId = "" } = {}) {
  const normalizedSessionId = cleanText(sessionId);
  const normalizedSubmissionId = normalizeFeedbackSubmissionId(submissionId, { required: true });
  const digest = sha256Hex(`${normalizedSessionId}:${normalizedSubmissionId}`).slice(0, 40);
  return {
    submission_id: normalizedSubmissionId,
    feedback_event_id: `v4feedback_${digest}`,
    learning_event_id: `v4learn_${digest}`
  };
}

export function feedbackPayloadSha256(value = {}) {
  return sha256Hex(stableJson(value));
}

export function normalizeClientOccurredAt(value) {
  const normalized = cleanText(value);
  if (!normalized) return null;
  const timestamp = new Date(normalized);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("invalid_feedback_client_occurred_at");
  return timestamp.toISOString();
}

export function buildAuthoritativeRecognitionResult(session = {}) {
  const providerSummary = plainObject(session.provider_result_summary);
  const aiSem = plainObject(session.resolved_fields);
  const dataIdentity = sessionDataIdentitySnapshot(session);
  const result = {
    schema_version: FEEDBACK_CAPTURE_SCHEMA_VERSION,
    result_id: cleanText(session.id) || null,
    recognition_session_id: cleanText(session.id) || null,
    tenant_id: dataIdentity.tenant_id,
    user_id: dataIdentity.user_id,
    asset_id: dataIdentity.asset_id,
    client_asset_ref: dataIdentity.client_asset_ref,
    asset_fingerprint: dataIdentity.asset_fingerprint,
    data_identity: dataIdentity,
    recognition_schema_version: cleanText(session.schema_version) || v4SchemaVersion,
    sem_standard_version: SEM_STANDARD_VERSION,
    ai_title: cleanText(session.final_title || session.l2_title) || null,
    ai_sem: aiSem,
    model_version: cleanText(session.model_version || providerSummary.model) || null,
    prompt_version: cleanText(session.prompt_version || providerSummary.prompt_version) || null,
    generation_manifest: {
      provider: cleanText(providerSummary.provider) || null,
      model: cleanText(providerSummary.model) || null,
      route: cleanText(session.route) || null,
      title_stage: cleanText(providerSummary.title_stage) || null,
      provider_prompt_mode: cleanText(providerSummary.provider_prompt_mode) || null,
      prompt_version: cleanText(session.prompt_version || providerSummary.prompt_version) || null,
      provider_response_profile: cleanText(providerSummary.provider_response_profile) || null,
      pipeline_contract: plainObject(providerSummary.v4_pipeline_contract),
      sem_standard_version: SEM_STANDARD_VERSION,
      recognition_schema_version: cleanText(session.schema_version) || v4SchemaVersion
    }
  };
  return {
    ...result,
    result_sha256: feedbackPayloadSha256(result)
  };
}
