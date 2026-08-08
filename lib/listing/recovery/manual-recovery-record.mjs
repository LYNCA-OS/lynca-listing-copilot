import crypto from "node:crypto";

// The record an operator produces when recognition failed and they wrote the
// title themselves. COS-51.
//
// This exists because the writer wheel had exactly one persistence path and it
// required a `recognition_session_id`. A failed recognition never creates one,
// so a card that failed could not be saved, could not be rejected, and could
// not be left -- and neither could any card behind it.
//
// The contract is deliberately the INVERSE of the AI feedback contract:
//
//   AI feedback          this record
//   ------------------   ---------------------------------------------
//   needs a session      needs a durable asset, and refuses a session
//   compares to a        has nothing to compare against -- the model
//   generated title      never answered
//   feeds the flywheel   never trains, never semantic truth
//
// The refusal is the important half. If this accepted a session id it would
// become a second, weaker door into the same ledger the AI path guards, and
// the guard would be one careless caller away from meaningless.

export const MANUAL_RECOVERY_SCHEMA_VERSION = "listing-manual-recovery-v2";

export const MANUAL_RECOVERY_SOURCES = Object.freeze({
  SAVED: "MANUAL_AFTER_RECOGNITION_FAILURE",
  REJECTED: "REJECTED_AFTER_RECOGNITION_FAILURE"
});

const clean = (value, limit = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

export function normalizeManualRecoverySubmissionId(value) {
  const normalized = clean(value, 64).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw Object.assign(new Error("invalid_manual_recovery_submission_id"), { statusCode: 400 });
  }
  return normalized;
}

const immutableManualRecoveryFields = Object.freeze([
  "id", "schema_version", "tenant_id", "asset_id", "client_asset_ref",
  "failure_code", "failure_stage", "source", "manual_title", "operator_id",
  "recorded_at", "training_eligible", "semantic_truth", "canonical_fields_approved"
]);

function immutableManualRecoveryPayload(record = {}) {
  return Object.fromEntries(immutableManualRecoveryFields.map((field) => {
    const value = record?.[field] ?? null;
    if (field !== "recorded_at" || value === null) return [field, value];
    const timestamp = new Date(value);
    return [field, Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : String(value)];
  }));
}

export function manualRecoveryPayloadSha256(record = {}) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(immutableManualRecoveryPayload(record)))
    .digest("hex");
}

export function manualRecoveryRecordMatches(actual = {}, expected = {}) {
  return manualRecoveryPayloadSha256(actual) === manualRecoveryPayloadSha256(expected);
}

/**
 * Build one manual-recovery record.
 *
 * @throws when a caller supplies a recognition session -- that submission
 *         belongs to the AI feedback path, which validates things this one
 *         cannot, and silently accepting it here would route a reviewable
 *         result into a ledger marked "never training".
 */
export function buildManualRecoveryRecord({
  submissionId,
  tenantId,
  assetId,
  clientAssetRef = "",
  operatorId,
  manualTitle = "",
  source = MANUAL_RECOVERY_SOURCES.SAVED,
  failureCode = "",
  failureStage = "",
  recognitionSessionId = "",
  recordedAt = new Date().toISOString()
} = {}) {
  const submission = normalizeManualRecoverySubmissionId(submissionId);
  const tenant = clean(tenantId, 120);
  const asset = clean(assetId, 160);
  const operator = clean(operatorId, 160);
  if (!tenant) throw Object.assign(new Error("tenant_id_required"), { statusCode: 400 });
  if (!asset) throw Object.assign(new Error("asset_id_required"), { statusCode: 400 });
  if (!operator) throw Object.assign(new Error("operator_id_required"), { statusCode: 400 });

  if (clean(recognitionSessionId, 160)) {
    throw Object.assign(new Error("manual_recovery_rejects_recognition_session"), { statusCode: 400 });
  }

  const normalizedSource = clean(source, 64).toUpperCase();
  if (!Object.values(MANUAL_RECOVERY_SOURCES).includes(normalizedSource)) {
    throw Object.assign(new Error("invalid_manual_recovery_source"), { statusCode: 400 });
  }

  // A rejection records that the operator declined the card; storing a title
  // alongside it would later read as an accepted title with a rejection flag,
  // which is the ambiguity this whole issue is made of.
  const title = normalizedSource === MANUAL_RECOVERY_SOURCES.SAVED ? clean(manualTitle, 500) : "";
  if (normalizedSource === MANUAL_RECOVERY_SOURCES.SAVED && !title) {
    throw Object.assign(new Error("manual_title_required"), { statusCode: 400 });
  }

  const timestamp = new Date(recordedAt);
  if (Number.isNaN(timestamp.getTime())) {
    throw Object.assign(new Error("invalid_recorded_at"), { statusCode: 400 });
  }

  return {
    // The existing UUID primary key is the idempotency constraint. One writer
    // action reuses this id across transport retries; it is never overwritten.
    id: submission,
    schema_version: MANUAL_RECOVERY_SCHEMA_VERSION,
    tenant_id: tenant,
    asset_id: asset,
    client_asset_ref: clean(clientAssetRef, 160),
    failure_code: clean(failureCode, 120),
    failure_stage: clean(failureStage, 120),
    source: normalizedSource,
    manual_title: title,
    operator_id: operator,
    recorded_at: timestamp.toISOString(),
    // Not defaults a caller may override. These are the properties that make
    // the record safe to write at all, so they are set here, unconditionally,
    // and the database repeats them as check constraints.
    training_eligible: false,
    semantic_truth: false,
    canonical_fields_approved: false
  };
}

/** Did this recovery leave a title the writer queue may treat as delivered? */
export function manualRecoveryDelivers(record = {}) {
  return record.source === MANUAL_RECOVERY_SOURCES.SAVED && Boolean(clean(record.manual_title, 500));
}
