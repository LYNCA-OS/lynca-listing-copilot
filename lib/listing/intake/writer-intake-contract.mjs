import crypto from "node:crypto";

export const writerIntakeContractVersion = "v4-writer-intake-ledger-v1";
export const writerIntakeMaxItems = 1000;

const tenantIdPattern = /^tenant_[a-z0-9][a-z0-9_-]{0,62}$/i;
const principalIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const batchIdPattern = /^intake_[0-9a-f]{32}$/;
const itemIdPattern = /^intake_item_[0-9a-f]{32}$/;
const controlChars = /[\u0000-\u001f\u007f]/;

export class WriterIntakeContractError extends Error {
  constructor(code, { statusCode = 400, retryable = false } = {}) {
    super(code);
    this.name = "WriterIntakeContractError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function cleanRequiredText(value, code, maxLength = 512) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength || controlChars.test(text)) {
    throw new WriterIntakeContractError(code);
  }
  return text;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeWriterIntakeTenantId(value) {
  const tenantId = cleanRequiredText(value, "invalid_writer_intake_tenant_id", 64);
  if (!tenantIdPattern.test(tenantId)) throw new WriterIntakeContractError("invalid_writer_intake_tenant_id");
  return tenantId;
}

export function normalizeWriterIntakeOperatorId(value) {
  const operatorId = cleanRequiredText(value, "invalid_writer_intake_operator_id", 160);
  if (!principalIdPattern.test(operatorId)) throw new WriterIntakeContractError("invalid_writer_intake_operator_id");
  return operatorId;
}

export function normalizeWriterIntakeBatchId(value) {
  const batchId = cleanRequiredText(value, "invalid_writer_intake_batch_id", 64);
  if (!batchIdPattern.test(batchId)) throw new WriterIntakeContractError("invalid_writer_intake_batch_id");
  return batchId;
}

export function normalizeWriterIntakeItemId(value) {
  const itemId = cleanRequiredText(value, "invalid_writer_intake_item_id", 64);
  if (!itemIdPattern.test(itemId)) throw new WriterIntakeContractError("invalid_writer_intake_item_id");
  return itemId;
}

export function normalizeWriterIntakeExpectedItemCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > writerIntakeMaxItems) {
    throw new WriterIntakeContractError("invalid_writer_intake_expected_item_count");
  }
  return count;
}

export function normalizeWriterIntakeItemPosition(value) {
  const position = Number(value);
  if (!Number.isInteger(position) || position < 1 || position > writerIntakeMaxItems) {
    throw new WriterIntakeContractError("invalid_writer_intake_item_position");
  }
  return position;
}

export function writerIntakeBatchIdentity({ tenantId, operatorId, idempotencyKey } = {}) {
  const normalizedTenantId = normalizeWriterIntakeTenantId(tenantId);
  const normalizedOperatorId = normalizeWriterIntakeOperatorId(operatorId);
  const normalizedKey = cleanRequiredText(idempotencyKey, "writer_intake_idempotency_key_required", 512);
  const digest = sha256(`${normalizedTenantId}\u001f${normalizedOperatorId}\u001f${normalizedKey}`);
  return Object.freeze({
    batch_id: `intake_${digest.slice(0, 32)}`,
    idempotency_key_sha256: sha256(normalizedKey)
  });
}

export function writerIntakeItemIdentity({ batchId, clientItemRef } = {}) {
  const normalizedBatchId = normalizeWriterIntakeBatchId(batchId);
  const normalizedRef = cleanRequiredText(clientItemRef, "writer_intake_client_item_ref_required", 512);
  const digest = sha256(`${normalizedBatchId}\u001f${normalizedRef}`);
  return Object.freeze({
    item_id: `intake_item_${digest.slice(0, 32)}`,
    client_item_ref_sha256: sha256(normalizedRef)
  });
}

export function writerIntakeResumeAction(item = {}) {
  const status = String(item?.status || "").toUpperCase();
  if (status === "DECLARED") return "ADMIT_CANONICAL_ASSET";
  if (status === "ASSET_ADMITTED") return "ENQUEUE_CANONICAL_ASSET";
  if (["QUEUE_ADMITTED", "WRITER_TITLE_READY"].includes(status)) return "POLL_EXISTING_JOB";
  if (status === "FAILED_RETRYABLE") return item?.queue_job_id ? "RETRY_EXISTING_JOB" : "RETRY_ASSET_ADMISSION";
  if (status === "FAILED_TERMINAL") {
    if (item?.queue_job_id) return "RETRY_SUCCESSOR_JOB";
    if (item?.asset_id) return "ENQUEUE_CANONICAL_ASSET";
    return "RETRY_ASSET_ADMISSION";
  }
  return "NONE";
}
