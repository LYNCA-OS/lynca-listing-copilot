export const hardInvariantStatuses = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  UNKNOWN: "UNKNOWN"
});

export const v4HardInvariantSpec = Object.freeze([
  Object.freeze({
    invariant_id: "DURABLE_ASSET_ID",
    owner: "ASSET_LIFECYCLE_CONTRACT",
    requirement: "one server-created durable asset id identifies the card asset"
  }),
  Object.freeze({
    invariant_id: "TENANT_ASSET_OWNERSHIP",
    owner: "TENANT_ASSET_STORE",
    requirement: "tenant, asset root row, and image records have one verified owner"
  }),
  Object.freeze({
    invariant_id: "IMMUTABLE_IMAGE_GENERATION",
    owner: "ASSET_LIFECYCLE_CONTRACT",
    requirement: "enqueue and execution use the same immutable image generation"
  }),
  Object.freeze({
    invariant_id: "VERIFIED_CANONICAL_IMAGE_SET",
    owner: "CANONICAL_IMAGE_REFERENCE_STORE",
    requirement: "the expected canonical original image set is complete and verified"
  }),
  Object.freeze({
    invariant_id: "CANONICAL_STORAGE_SCOPE",
    owner: "CANONICAL_IMAGE_REFERENCE_STORE",
    requirement: "all storage paths are reconstructed and scope-checked by the server"
  }),
  Object.freeze({
    invariant_id: "SINGLE_EXECUTION_IDENTITY",
    owner: "V4_JOB_QUEUE",
    requirement: "one execution job is bound to one tenant, asset, and image generation"
  })
]);

const specById = new Map(v4HardInvariantSpec.map((entry) => [entry.invariant_id, entry]));

function normalizedStatus(value) {
  if (value === true) return hardInvariantStatuses.PASS;
  if (value === false) return hardInvariantStatuses.FAIL;
  const status = String(value?.status || value || "").trim().toUpperCase();
  return Object.values(hardInvariantStatuses).includes(status)
    ? status
    : hardInvariantStatuses.UNKNOWN;
}

export function normalizeHardInvariantSnapshot(input = {}) {
  const suppliedChecks = input?.checks && typeof input.checks === "object" && !Array.isArray(input.checks)
    ? input.checks
    : input;
  const checks = v4HardInvariantSpec.map((spec) => {
    const supplied = suppliedChecks?.[spec.invariant_id];
    return {
      ...spec,
      status: normalizedStatus(supplied),
      reason_code: String(supplied?.reason_code || supplied?.reason || "").trim() || null
    };
  });
  const failed = checks.filter((check) => check.status === hardInvariantStatuses.FAIL);
  const unknown = checks.filter((check) => check.status === hardInvariantStatuses.UNKNOWN);
  return {
    schema_version: "v4-hard-invariant-snapshot-v1",
    spec_version: "2026-07-18.1",
    checks,
    failed_invariants: failed.map((check) => check.invariant_id),
    unknown_invariants: unknown.map((check) => check.invariant_id),
    feasible: failed.length === 0 && unknown.length === 0,
    complete: unknown.length === 0
  };
}

export function hardInvariantSpecForId(invariantId) {
  return specById.get(String(invariantId || "").trim().toUpperCase()) || null;
}

export class HardInvariantViolationError extends Error {
  constructor(snapshot) {
    const failed = snapshot?.failed_invariants || [];
    const unknown = snapshot?.unknown_invariants || [];
    super(`v4_hard_invariant_gate_failed:${[...failed, ...unknown].join(",") || "unknown"}`);
    this.name = "HardInvariantViolationError";
    this.code = "V4_HARD_INVARIANT_GATE_FAILED";
    this.retryable = false;
    this.snapshot = snapshot;
  }
}

export function assertHardInvariantSnapshot(input = {}) {
  const snapshot = input?.schema_version === "v4-hard-invariant-snapshot-v1"
    ? input
    : normalizeHardInvariantSnapshot(input);
  if (!snapshot.feasible) throw new HardInvariantViolationError(snapshot);
  return snapshot;
}
