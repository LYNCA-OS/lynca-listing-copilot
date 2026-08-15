import { stableJsonSha256 } from "../../json-digest.mjs";

export const CSM_OWNER_EXECUTION_RECEIPT_VERSION = "csm-owner-execution-receipt-v1";

// This is deliberately an allow-list, not `...ownerVersions`. The durable
// digest may bind opaque provider identifiers, but a future field cannot enter
// the receipt accidentally (and potentially bind a secret) without an explicit
// contract review and version bump.
export const CSM_OWNER_EXECUTION_RECEIPT_KEYS = Object.freeze([
  "provider",
  "model",
  "requested_model",
  "served_model",
  "served_model_attested",
  "effort",
  "reasoning_effort",
  "reasoning_effort_attested",
  "provider_response_status",
  "provider_response_status_attested",
  "provider_response_incomplete",
  "served_effort_conflict",
  "provider_http_status",
  "model_profile_id",
  "optimization_pack_id",
  "optimization_pack_sha256",
  "account_scope",
  "provider_adapter_version",
  "request_builder_version",
  "response_parser_version",
  "execution_contract_sha256",
  "execution_contract",
  "image_detail",
  "prompt_version",
  "max_output_tokens",
  "provider_response_id",
  "provider_request_id",
  "provider_client_request_id",
  "provider_attempt_number",
  "provider_retry_count",
  "latency_ms",
  "latency_stages_ms",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
  "total_tokens_source",
  "resolver",
  "composer",
  "marketplace_profile",
  "accuracy_loss_ledger_version",
  "accuracy_loss_ledger_sha256"
]);
// Additive v1 fields: historical v1 receipts omit them and remain replayable.
// A present field is explicitly hashed; the owning stage contract decides
// whether it is optional (transport retry) or mandatory (v4 payload identity).
export const CSM_OWNER_EXECUTION_RECEIPT_OPTIONAL_KEYS = Object.freeze([
  "provider_transport_retry_receipt",
  "operation_payload_sha256"
]);

const RECEIPT_METADATA_KEYS = Object.freeze([
  "owner_execution_receipt_version",
  "owner_execution_receipt_sha256"
]);
const SHA256 = /^[0-9a-f]{64}$/;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return Object.keys(value).length === value.length && value.every(validJsonValue);
  }
  return plainObject(value)
    && Object.values(value).every((child) => child !== undefined && validJsonValue(child));
}

function invalidReceipt() {
  return Object.assign(new Error("csm_owner_execution_receipt_invalid"), {
    code: "csm_owner_execution_receipt_invalid",
    statusCode: 409
  });
}

export function canonicalCsmOwnerExecutionReceiptPayload(ownerVersions) {
  if (!plainObject(ownerVersions)) throw invalidReceipt();
  const allowed = new Set([
    ...CSM_OWNER_EXECUTION_RECEIPT_KEYS,
    ...CSM_OWNER_EXECUTION_RECEIPT_OPTIONAL_KEYS,
    ...RECEIPT_METADATA_KEYS
  ]);
  if (Object.keys(ownerVersions).some((key) => !allowed.has(key))) throw invalidReceipt();
  const ownerReceipt = {};
  for (const key of CSM_OWNER_EXECUTION_RECEIPT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(ownerVersions, key)
        || !validJsonValue(ownerVersions[key])) {
      throw invalidReceipt();
    }
    ownerReceipt[key] = ownerVersions[key];
  }
  for (const key of CSM_OWNER_EXECUTION_RECEIPT_OPTIONAL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(ownerVersions, key)) continue;
    if (!validJsonValue(ownerVersions[key])) throw invalidReceipt();
    ownerReceipt[key] = ownerVersions[key];
  }
  return {
    version: CSM_OWNER_EXECUTION_RECEIPT_VERSION,
    owner_versions: ownerReceipt
  };
}

export function computeCsmOwnerExecutionReceiptSha256(ownerVersions) {
  return stableJsonSha256(canonicalCsmOwnerExecutionReceiptPayload(ownerVersions));
}

export function sealCsmOwnerExecutionReceipt(ownerVersions) {
  const ownerExecutionReceiptSha256 = computeCsmOwnerExecutionReceiptSha256(ownerVersions);
  return Object.freeze({
    ...ownerVersions,
    owner_execution_receipt_version: CSM_OWNER_EXECUTION_RECEIPT_VERSION,
    owner_execution_receipt_sha256: ownerExecutionReceiptSha256
  });
}

export function publicCsmOwnerExecutionReceipt(receipt) {
  if (receipt == null) return null;
  if (!plainObject(receipt)
      || receipt.version !== CSM_OWNER_EXECUTION_RECEIPT_VERSION
      || !SHA256.test(String(receipt.sha256 || ""))) {
    throw invalidReceipt();
  }
  return Object.freeze({ version: receipt.version, sha256: receipt.sha256 });
}

// The resolution route may read the full JSON receipt with service-role
// authority, but only this two-field projection is allowed to leave the server.
// Recomputing the digest makes this a read-after-write proof over the durable
// receipt, not a readback of an unverified hash-shaped string.
export function projectCsmOwnerExecutionReceipt(ownerVersions) {
  if (!plainObject(ownerVersions)) return null;
  const version = ownerVersions.owner_execution_receipt_version;
  const sha256 = ownerVersions.owner_execution_receipt_sha256;
  if (version == null && sha256 == null) return null; // pre-v1 persisted run
  if (version !== CSM_OWNER_EXECUTION_RECEIPT_VERSION || !SHA256.test(String(sha256 || ""))) {
    throw invalidReceipt();
  }
  if (computeCsmOwnerExecutionReceiptSha256(ownerVersions) !== sha256) throw invalidReceipt();
  return publicCsmOwnerExecutionReceipt({ version, sha256 });
}
