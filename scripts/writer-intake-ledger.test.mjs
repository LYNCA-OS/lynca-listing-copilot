import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WriterIntakeContractError,
  normalizeWriterIntakeItemPosition,
  writerIntakeBatchIdentity,
  writerIntakeItemIdentity,
  writerIntakeResumeAction
} from "../lib/listing/intake/writer-intake-contract.mjs";
import {
  abandonWriterIntakeBatch,
  admitWriterIntakeItem,
  appendWriterIntakeItem,
  commitWriterIntakeBatch,
  getWriterIntakeStatus,
  isWriterIntakeCanonicalJob,
  reconcileWriterIntakeCanonicalJobRows,
  reconcileWriterIntakeCanonicalJobRowsBestEffort,
  settleWriterIntakeItem,
  WriterIntakeStoreError
} from "../lib/listing/intake/writer-intake-store.mjs";

const tenantId = "tenant_alpha";
const operatorId = "user_writer_1";
const idempotencyKey = "browser-intent-100";
const batchIdentity = writerIntakeBatchIdentity({ tenantId, operatorId, idempotencyKey });
const sameBatchIdentity = writerIntakeBatchIdentity({ tenantId, operatorId, idempotencyKey });
assert.deepEqual(batchIdentity, sameBatchIdentity, "batch identity must be deterministic");
assert.notEqual(
  batchIdentity.batch_id,
  writerIntakeBatchIdentity({ tenantId: "tenant_beta", operatorId, idempotencyKey }).batch_id,
  "tenant scope must be part of the idempotent identity"
);
assert.match(batchIdentity.batch_id, /^intake_[0-9a-f]{32}$/);
assert.match(batchIdentity.idempotency_key_sha256, /^[0-9a-f]{64}$/);
assert.throws(
  () => writerIntakeBatchIdentity({ tenantId, operatorId, idempotencyKey: "" }),
  WriterIntakeContractError
);
assert.equal(normalizeWriterIntakeItemPosition(1), 1, "positions follow the existing one-based writer card index");
assert.throws(() => normalizeWriterIntakeItemPosition(0), WriterIntakeContractError);

const itemIdentity = writerIntakeItemIdentity({ batchId: batchIdentity.batch_id, clientItemRef: "card-1" });
assert.match(itemIdentity.item_id, /^intake_item_[0-9a-f]{32}$/);
assert.equal(writerIntakeResumeAction({ status: "DECLARED" }), "ADMIT_CANONICAL_ASSET");
assert.equal(writerIntakeResumeAction({ status: "ASSET_ADMITTED" }), "ENQUEUE_CANONICAL_ASSET");
assert.equal(writerIntakeResumeAction({ status: "QUEUE_ADMITTED" }), "POLL_EXISTING_JOB");
assert.equal(writerIntakeResumeAction({ status: "FAILED_TERMINAL" }), "RETRY_ASSET_ADMISSION");
assert.equal(
  writerIntakeResumeAction({ status: "FAILED_TERMINAL", asset_id: "asset_retry" }),
  "ENQUEUE_CANONICAL_ASSET"
);
assert.equal(
  writerIntakeResumeAction({ status: "FAILED_TERMINAL", queue_job_id: "job_retry" }),
  "RETRY_SUCCESSOR_JOB"
);

const batches = new Map();
const items = new Map();
const queueJobs = new Map();
const sessions = new Map();
const listingAssets = new Map();
const calls = [];

function intakeQueueTags(batchId, itemId, previousQueueJobId = null) {
  return {
    writer_intake_batch_id: batchId,
    writer_intake_item_id: itemId,
    writer_intake_previous_queue_job_id: previousQueueJobId
  };
}

function filterRows(rows, search = {}) {
  return rows.filter((row) => Object.entries(search).every(([key, expression]) => {
    if (["limit", "order"].includes(key)) return true;
    const [operator, expected = ""] = String(expression).split(".", 2);
    const rowValue = key === "queue_tags->>writer_intake_batch_id"
      ? row.queue_tags?.writer_intake_batch_id
      : row[key];
    if (operator === "eq") return String(rowValue ?? "") === expected;
    if (operator === "is" && expected === "null") return row[key] == null;
    if (operator === "in") {
      const values = String(expression).slice(4, -1).split(",").map((value) => value.replace(/^"|"$/g, ""));
      return values.includes(String(row[key] ?? ""));
    }
    return true;
  }));
}

const storeOptions = {
  now: () => new Date("2026-07-30T01:00:00.000Z"),
  logger: { info() {}, warn() {} },
  commitBatchAtomic: async (payload) => {
    calls.push({ operation: "rpc", fn: "commit_v4_writer_intake_batch", payload: structuredClone(payload) });
    const existing = [...batches.values()].find((row) => (
      row.tenant_id === payload.p_tenant_id
      && row.operator_id === payload.p_operator_id
      && row.idempotency_key_sha256 === payload.p_idempotency_key_sha256
    ));
    if (existing && (
      existing.id !== payload.p_batch_id
      || Number(existing.expected_item_count) !== Number(payload.p_expected_item_count)
    )) {
      return { ok: false, rows: [], error: "writer_intake_idempotency_conflict" };
    }
    if (!existing) {
      batches.set(payload.p_batch_id, {
        id: payload.p_batch_id,
        tenant_id: payload.p_tenant_id,
        operator_id: payload.p_operator_id,
        idempotency_key_sha256: payload.p_idempotency_key_sha256,
        expected_item_count: payload.p_expected_item_count,
        status: "INTAKE_CLOSED",
        committed_at: "2026-07-30T00:59:00.000Z",
        intake_closed_at: "2026-07-30T00:59:00.000Z",
        updated_at: "2026-07-30T00:59:00.000Z"
      });
      for (let position = 1; position <= payload.p_expected_item_count; position += 1) {
        const identity = writerIntakeItemIdentity({
          batchId: payload.p_batch_id,
          clientItemRef: `card-${position}`
        });
        items.set(identity.item_id, {
          id: identity.item_id,
          tenant_id: payload.p_tenant_id,
          operator_id: payload.p_operator_id,
          batch_id: payload.p_batch_id,
          client_item_ref_sha256: identity.client_item_ref_sha256,
          item_position: position,
          status: "DECLARED",
          durability_status: "PENDING",
          appended_at: "2026-07-30T00:59:00.000Z",
          asset_id: null,
          queue_job_id: null,
          recognition_session_id: null,
          pending_queue_job_id: null,
          pending_predecessor_queue_job_id: null,
          asset_admitted_at: null,
          queue_admitted_at: null,
          writer_ready_at: null,
          writer_completed_at: null,
          asset_durable_at: null,
          last_error_code: null,
          updated_at: "2026-07-30T00:59:00.000Z"
        });
      }
    }
    return {
      ok: true,
      rows: [{
        saved: true,
        batch_id: payload.p_batch_id,
        expected_item_count: payload.p_expected_item_count,
        item_count: payload.p_expected_item_count
      }]
    };
  },
  abandonBatchAtomic: async (payload) => {
    calls.push({ operation: "rpc", fn: "abandon_v4_writer_intake_batch", payload: structuredClone(payload) });
    const batch = batches.get(payload.p_batch_id);
    if (
      !batch
      || batch.tenant_id !== payload.p_tenant_id
      || batch.operator_id !== payload.p_operator_id
    ) return { ok: false, rows: [], error: "writer_intake_batch_not_found" };
    let cancelled = 0;
    for (const item of items.values()) {
      if (
        item.tenant_id !== payload.p_tenant_id
        || item.operator_id !== payload.p_operator_id
        || item.batch_id !== payload.p_batch_id
        || item.queue_job_id
        || item.recognition_session_id
        || !["DECLARED", "ASSET_ADMITTED", "FAILED_RETRYABLE", "FAILED_TERMINAL"].includes(item.status)
      ) continue;
      item.status = "CANCELLED";
      item.last_error_code = "OPERATOR_ABANDONED_INPUT";
      item.updated_at = "2026-07-30T01:00:00.000Z";
      cancelled += 1;
    }
    return {
      ok: true,
      rows: [{ saved: true, batch_id: payload.p_batch_id, cancelled_item_count: cancelled }]
    };
  },
  patchRow: async ({ table, id, patch, match = {} }) => {
    calls.push({ operation: "patch", table, id, patch: structuredClone(patch), match: structuredClone(match) });
    const target = table === "v4_writer_intake_batches" ? batches : items;
    const row = target.get(id);
    if (!row || !filterRows([row], match).length) return { saved: false, row: null, error: "row_not_matched" };
    Object.assign(row, structuredClone(patch));
    return { saved: true, row };
  },
  readRows: async ({ table, search = {}, count = "" }) => {
    calls.push({ operation: "read", table, search: structuredClone(search) });
    const source = table === "v4_writer_intake_batches"
      ? [...batches.values()]
      : table === "v4_writer_intake_items"
        ? [...items.values()]
        : table === "listing_assets"
          ? [...listingAssets.values()]
          : table === "v4_recognition_sessions"
            ? [...sessions.values()]
          : [...queueJobs.values()];
    const rows = filterRows(source, search).sort((left, right) => Number(left.item_position || 0) - Number(right.item_position || 0));
    return {
      ok: true,
      rows: rows.slice(0, Number(search.limit || rows.length)),
      ...(count === "exact" ? { count: rows.length } : {})
    };
  },
  requireAsset: async ({ tenantId: requestedTenantId, assetId, requireDurable }) => {
    const row = {
      id: assetId,
      tenant_id: requestedTenantId,
      image_generation_id: assetId,
      image_set_state: "FINALIZED",
      image_set_sha256: "a".repeat(64),
      image_set_finalized_at: "2026-07-30T00:58:59.000Z"
    };
    listingAssets.set(assetId, row);
    return { found: true, tenant_id: requestedTenantId, asset_id: assetId, row, requireDurable };
  }
};

let status = await commitWriterIntakeBatch({ tenantId, operatorId, idempotencyKey, expectedItemCount: 2 }, storeOptions);
assert.equal(status.item_count, 2, "atomic commit must predeclare the complete denominator");
assert.equal(status.expected_item_count, 2);
const committedBatch = batches.get(batchIdentity.batch_id);
committedBatch.status = "COMMITTED";
await assert.rejects(
  admitWriterIntakeItem({
    tenantId,
    operatorId,
    batchId: batchIdentity.batch_id,
    itemId: itemIdentity.item_id,
    assetId: "asset_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_batch_not_committed",
  "a syntactically valid item cannot authorize paid work before the denominator transaction closes"
);
committedBatch.status = "INTAKE_CLOSED";
assert.deepEqual(status.truth_boundary, {
  training_eligible: false,
  catalog_promotion_eligible: false,
  identity_truth: false
});

status = await commitWriterIntakeBatch({ tenantId, operatorId, idempotencyKey, expectedItemCount: 2 }, storeOptions);
assert.equal(status.batch_id, batchIdentity.batch_id, "retries must resume the same batch");
const recoveredByKey = await getWriterIntakeStatus({ tenantId, operatorId, idempotencyKey }, storeOptions);
assert.equal(recoveredByKey.batch_id, batchIdentity.batch_id, "a lost commit response must recover by idempotency key alone");
await assert.rejects(
  () => commitWriterIntakeBatch({ tenantId, operatorId, idempotencyKey, expectedItemCount: 3 }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_idempotency_conflict"
);
await assert.rejects(
  () => commitWriterIntakeBatch({
    tenantId,
    operatorId,
    idempotencyKey: "browser-intent-database-rate-limit",
    expectedItemCount: 100
  }, {
    ...storeOptions,
    commitBatchAtomic: async () => ({
      ok: false,
      rows: [],
      error: '400 {"code":"P0001","message":"writer_intake_commit_rate_limited"}'
    })
  }),
  (error) => (
    error instanceof WriterIntakeStoreError
    && error.code === "writer_intake_commit_rate_limited"
    && error.statusCode === 429
    && error.retryable === true
  ),
  "database admission throttling must remain a structured retryable 429"
);

status = await appendWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  clientItemRef: "card-1",
  itemPosition: 1
}, storeOptions);
assert.equal(status.item.item_position, 1);
assert.equal(status.item.resume_action, "ADMIT_CANONICAL_ASSET");

status = await appendWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  clientItemRef: "card-2",
  itemPosition: 2
}, storeOptions);
assert.equal(status.item.item_position, 2);

status = await getWriterIntakeStatus({ tenantId, operatorId, batchId: batchIdentity.batch_id }, storeOptions);
assert.equal(status.intake_complete, true);
assert.equal(status.batch_status, "INTAKE_CLOSED");
const firstItemId = status.items[0].id;
const secondItemId = status.items[1].id;
const durableAssetId = "asset_12345678-1234-4123-8123-123456789abc";
status = await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: durableAssetId
}, storeOptions);
assert.equal(status.item.status, "ASSET_ADMITTED");
assert.equal(status.item.asset_id, durableAssetId);
assert.equal(status.item.resume_action, "ENQUEUE_CANONICAL_ASSET");

queueJobs.set("job_no_clock", {
  id: "job_no_clock",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: durableAssetId,
  recognition_session_id: "session_no_clock",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(batchIdentity.batch_id, firstItemId)
});
await assert.rejects(
  () => admitWriterIntakeItem({
    tenantId,
    operatorId,
    batchId: batchIdentity.batch_id,
    itemId: firstItemId,
    assetId: durableAssetId,
    queueJobId: "job_no_clock"
  }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_queue_job_clock_missing",
  "queue admission must fail closed when canonical job.created_at is absent"
);

queueJobs.set("job_001", {
  id: "job_001",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: durableAssetId,
  recognition_session_id: "session_001",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(batchIdentity.batch_id, firstItemId),
  created_at: "2026-07-30T00:59:10.000Z"
});
status = await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: durableAssetId,
  queueJobId: "job_001"
}, storeOptions);
assert.equal(status.item.status, "QUEUE_ADMITTED");
assert.equal(status.item.queue_job_id, "job_001");
assert.equal(status.item.recognition_session_id, "session_001", "session identity must come from the persisted queue row");
assert.equal(status.item.durability_status, "DURABLE", "canonical FINALIZED confirmation owns the durable clock");
assert.equal(status.item.asset_durable_at, "2026-07-30T00:58:59.000Z");
assert.equal(status.item.queue_admitted_at, "2026-07-30T00:59:10.000Z", "queue admission must use the canonical job creation clock");

queueJobs.get("job_001").status = "RETRYING";
queueJobs.get("job_001").error = { code: "PROVIDER_TIMEOUT" };
let repair = await reconcileWriterIntakeCanonicalJobRows({ jobIds: ["job_001"] }, storeOptions);
assert.equal(repair.patched, 1);
assert.equal(items.get(firstItemId).status, "FAILED_RETRYABLE");
assert.equal(items.get(firstItemId).last_error_code, "PROVIDER_TIMEOUT");

queueJobs.get("job_001").status = "RUNNING";
repair = await reconcileWriterIntakeCanonicalJobRows({ jobIds: ["job_001"] }, storeOptions);
assert.equal(repair.patched, 1);
assert.equal(items.get(firstItemId).status, "QUEUE_ADMITTED", "canonical retry execution must heal the projection");

queueJobs.get("job_001").status = "FAILED";
repair = await reconcileWriterIntakeCanonicalJobRows({ jobIds: ["job_001"] }, storeOptions);
assert.equal(repair.patched, 1);
assert.equal(items.get(firstItemId).status, "FAILED_TERMINAL");

queueJobs.get("job_001").status = "RUNNING";
items.get(firstItemId).status = "FAILED_RETRYABLE";
repair = await reconcileWriterIntakeCanonicalJobRows({
  jobs: [{ ...queueJobs.get("job_001"), status: "FAILED" }]
}, storeOptions);
assert.equal(repair.patched, 1);
assert.equal(items.get(firstItemId).status, "QUEUE_ADMITTED", "reconciliation must ignore caller-supplied status and re-read canonical jobs");
queueJobs.get("job_001").status = "FAILED";
items.get(firstItemId).status = "FAILED_TERMINAL";

await assert.rejects(
  admitWriterIntakeItem({
    tenantId,
    operatorId,
    batchId: batchIdentity.batch_id,
    itemId: firstItemId,
    assetId: durableAssetId,
    previousQueueJobId: "job_other"
  }, { ...storeOptions, requireQueueSuccessorAuthorization: true }),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_previous_job_link_conflict",
  "a client cannot fork a writer position by inventing a predecessor id"
);
queueJobs.get("job_001").status = "RUNNING";
await assert.rejects(
  admitWriterIntakeItem({
    tenantId,
    operatorId,
    batchId: batchIdentity.batch_id,
    itemId: firstItemId,
    assetId: durableAssetId,
    previousQueueJobId: "job_001"
  }, { ...storeOptions, requireQueueSuccessorAuthorization: true }),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_previous_job_not_terminal",
  "a live canonical job cannot be replaced by a second paid successor"
);
queueJobs.get("job_001").status = "FAILED";
await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: durableAssetId,
  previousQueueJobId: "job_001"
}, { ...storeOptions, requireQueueSuccessorAuthorization: true });

queueJobs.set("job_002", {
  id: "job_002",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: durableAssetId,
  recognition_session_id: "session_002",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(batchIdentity.batch_id, firstItemId, "job_001"),
  created_at: "2026-07-30T00:59:20.000Z"
});
status = await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: durableAssetId,
  queueJobId: "job_002",
  previousQueueJobId: "job_001"
}, storeOptions);
assert.equal(status.item.queue_job_id, "job_002", "a verified terminal retry may replace only the operational pointer");
assert.equal(status.item.status, "QUEUE_ADMITTED");

queueJobs.set("job_l1", {
  id: "job_l1",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: durableAssetId,
  recognition_session_id: "session_l1",
  job_type: "FAST_SCOUT_DRAFT",
  status: "L1_READY",
  queue_tags: intakeQueueTags(batchIdentity.batch_id, secondItemId),
  created_at: "2026-07-30T00:59:20.000Z"
});
await assert.rejects(
  () => admitWriterIntakeItem({
    tenantId,
    operatorId,
    batchId: batchIdentity.batch_id,
    itemId: secondItemId,
    assetId: durableAssetId,
    queueJobId: "job_l1"
  }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_final_queue_job_required",
  "a browser cannot bind an intake item to a non-final scout job"
);

const completedAssetId = "asset_22345678-1234-4123-8123-123456789abc";
queueJobs.set("job_completed", {
  id: "job_completed",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: completedAssetId,
  recognition_session_id: "session_completed",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "L2_READY",
  queue_tags: intakeQueueTags(batchIdentity.batch_id, secondItemId),
  created_at: "2026-07-30T00:59:30.000Z",
  completed_at: "2026-07-30T00:59:59.000Z"
});
sessions.set("session_completed", {
  id: "session_completed",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: completedAssetId,
  status: "WRITER_REVIEW",
  writer_feedback_event_id: null,
  updated_at: "2026-07-30T00:59:59.000Z"
});
status = await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: secondItemId,
  assetId: completedAssetId,
  queueJobId: "job_completed"
}, storeOptions);
assert.equal(status.item.status, "WRITER_TITLE_READY", "admission must catch up an L2 result that won the race");
assert.equal(status.item.writer_ready_at, "2026-07-30T00:59:59.000Z");

const patchesBeforeReplay = calls.filter((call) => call.operation === "patch").length;
await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: durableAssetId,
  queueJobId: "job_002"
}, storeOptions);
assert.equal(calls.filter((call) => call.operation === "patch").length, patchesBeforeReplay, "admission replay must be idempotent");

queueJobs.get("job_002").status = "FAILED";
const reboundAssetId = "asset_32345678-1234-4123-8123-123456789abc";
const reboundOptions = {
  ...storeOptions,
  requireAsset: async ({ tenantId: requestedTenantId, assetId, requireDurable }) => {
    const row = {
      id: assetId,
      tenant_id: requestedTenantId,
      image_generation_id: assetId,
      image_set_state: "FINALIZED",
      image_set_sha256: "b".repeat(64),
      image_set_finalized_at: "2026-07-30T01:05:00.000Z"
    };
    listingAssets.set(assetId, row);
    return { found: true, tenant_id: requestedTenantId, asset_id: assetId, row, requireDurable };
  }
};
status = await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: reboundAssetId,
  previousQueueJobId: "job_002"
}, reboundOptions);
assert.equal(status.item.status, "ASSET_ADMITTED", "a verified terminal input failure may rebind the same declared position");
assert.equal(status.item.asset_id, reboundAssetId);
assert.equal(status.item.queue_job_id, null, "input rebind must detach the obsolete operational job pointer");
assert.equal(status.item.recognition_session_id, null);
assert.equal(status.item.asset_durable_at, "2026-07-30T01:05:00.000Z", "input rebind must use the new canonical asset clock");
assert.equal(items.get(firstItemId).pending_predecessor_queue_job_id, "job_002", "input rebind must retain its immutable predecessor until the successor commits");

const reboundReservation = {
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: reboundAssetId,
  previousQueueJobId: "job_002",
  reservedQueueJobId: "job_003"
};
await admitWriterIntakeItem(reboundReservation, {
  ...reboundOptions,
  requireQueueSuccessorAuthorization: true,
  requireQueueReservation: true
});
assert.equal(items.get(firstItemId).pending_queue_job_id, "job_003", "preauthorization must reserve one deterministic queue identity");
await admitWriterIntakeItem(reboundReservation, {
  ...reboundOptions,
  requireQueueSuccessorAuthorization: true,
  requireQueueReservation: true
});
assert.equal(items.get(firstItemId).pending_queue_job_id, "job_003", "a zero-accepted response may replay the same reservation without forking");
await assert.rejects(
  () => admitWriterIntakeItem({ ...reboundReservation, reservedQueueJobId: "job_003_fork" }, {
    ...reboundOptions,
    requireQueueSuccessorAuthorization: true,
    requireQueueReservation: true
  }),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_queue_reservation_conflict",
  "a second deterministic target cannot fork the reserved writer position"
);

queueJobs.set("job_003", {
  id: "job_003",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: reboundAssetId,
  recognition_session_id: "session_003",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(batchIdentity.batch_id, firstItemId, "job_002"),
  created_at: "2026-07-30T01:05:01.000Z"
});
status = await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: reboundAssetId,
  queueJobId: "job_003"
}, reboundOptions);
assert.equal(status.item.status, "QUEUE_ADMITTED");
assert.equal(status.item.queue_job_id, "job_003");
assert.equal(items.get(firstItemId).pending_queue_job_id, null);
assert.equal(items.get(firstItemId).pending_predecessor_queue_job_id, null);

await admitWriterIntakeItem(reboundReservation, {
  ...reboundOptions,
  requireQueueSuccessorAuthorization: true,
  requireQueueReservation: true
});
assert.equal(items.get(firstItemId).queue_job_id, "job_003", "a lost HTTP response after projection must replay the exact predecessor and reserved target");

queueJobs.get("job_003").status = "CANCELLED";
items.get(firstItemId).status = "CANCELLED";
status = await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: batchIdentity.batch_id,
  itemId: firstItemId,
  assetId: reboundAssetId,
  previousQueueJobId: "job_003"
}, {
  ...reboundOptions,
  requireQueueSuccessorAuthorization: true
});
assert.equal(
  status.item.queue_job_id,
  "job_003",
  "a canonically cancelled job may authorize one deterministic successor without erasing its audit link"
);
items.get(firstItemId).status = "QUEUE_ADMITTED";
queueJobs.get("job_003").status = "QUEUED";

const settlementKey = "browser-intent-unavailable-input";
const settlementBatch = await commitWriterIntakeBatch({
  tenantId,
  operatorId,
  idempotencyKey: settlementKey,
  expectedItemCount: 2
}, storeOptions);
const [failedInput, cancelledInput] = settlementBatch.items;
const patchesBeforeFailure = calls.filter((call) => call.operation === "patch").length;
let settlement = await settleWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: settlementBatch.batch_id,
  itemId: failedInput.id,
  disposition: "FAILED"
}, storeOptions);
assert.equal(settlement.item.status, "FAILED_TERMINAL");
assert.equal(settlement.item.durability_status, "FAILED_TERMINAL");
assert.equal(settlement.item.last_error_code, "OPERATOR_REPORTED_INPUT_FAILURE");
assert.equal(settlement.item.resume_action, "RETRY_ASSET_ADMISSION");
assert.equal(settlement.item.identity_truth, false, "an operator failure report is not identity truth");
settlement = await settleWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: settlementBatch.batch_id,
  itemId: failedInput.id,
  disposition: "FAILED"
}, storeOptions);
assert.equal(
  calls.filter((call) => call.operation === "patch").length,
  patchesBeforeFailure + 1,
  "a lost failure response must replay without another write"
);
settlement = await settleWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: settlementBatch.batch_id,
  itemId: failedInput.id,
  disposition: "CANCELLED"
}, storeOptions);
assert.equal(settlement.item.status, "CANCELLED", "the operator may abandon an unavailable input after a failed attempt");
assert.equal(settlement.item.last_error_code, "OPERATOR_CANCELLED_INPUT");

settlement = await settleWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: settlementBatch.batch_id,
  itemId: cancelledInput.id,
  disposition: "FAILED"
}, storeOptions);
assert.equal(settlement.item.status, "FAILED_TERMINAL");
const terminalSettlementBatch = await getWriterIntakeStatus({
  tenantId,
  operatorId,
  batchId: settlementBatch.batch_id
}, storeOptions);
assert.equal(terminalSettlementBatch.settled_item_count, 2);
assert.equal(terminalSettlementBatch.action_required_item_count, 1);
assert.equal(terminalSettlementBatch.terminal_item_count, 1);
assert.equal(terminalSettlementBatch.outstanding_item_count, 1);
assert.equal(terminalSettlementBatch.batch_settled, true, "failed/cancelled positions must expose operational settlement");
assert.equal(terminalSettlementBatch.batch_terminal, false, "a retryable terminal failure must not be reported as truly terminal");

items.get(cancelledInput.id).asset_id = "asset_42345678-1234-4123-8123-123456789abc";
items.get(cancelledInput.id).asset_admitted_at = "2026-07-30T01:06:00.000Z";
await assert.rejects(
  () => settleWriterIntakeItem({
    tenantId,
    operatorId,
    batchId: settlementBatch.batch_id,
    itemId: cancelledInput.id,
    disposition: "CANCELLED"
  }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_canonical_admission_already_exists",
  "a late browser report must not overwrite canonical admission"
);

await assert.rejects(
  () => getWriterIntakeStatus({ tenantId: "tenant_beta", operatorId, batchId: batchIdentity.batch_id }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_batch_not_found"
);

const historicalBatch = await commitWriterIntakeBatch({
  tenantId,
  operatorId,
  idempotencyKey: "browser-intent-historical-job",
  expectedItemCount: 1
}, storeOptions);
const historicalItem = historicalBatch.items[0];
const historicalAssetId = "asset_52345678-1234-4123-8123-123456789abc";
queueJobs.set("job_wrong_intake_reference", {
  id: "job_wrong_intake_reference",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: historicalAssetId,
  recognition_session_id: "session_wrong_intake_reference",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(batchIdentity.batch_id, firstItemId),
  created_at: "2026-07-30T00:59:40.000Z"
});
await assert.rejects(
  () => admitWriterIntakeItem({
    tenantId,
    operatorId,
    batchId: historicalBatch.batch_id,
    itemId: historicalItem.id,
    assetId: historicalAssetId,
    queueJobId: "job_wrong_intake_reference"
  }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_queue_reference_mismatch",
  "an old same-asset job cannot be rebound to a different intake position"
);
queueJobs.set("job_predates_intake_batch", {
  id: "job_predates_intake_batch",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: historicalAssetId,
  recognition_session_id: "session_predates_intake_batch",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(historicalBatch.batch_id, historicalItem.id),
  created_at: "2026-07-30T00:58:59.000Z"
});
await assert.rejects(
  () => admitWriterIntakeItem({
    tenantId,
    operatorId,
    batchId: historicalBatch.batch_id,
    itemId: historicalItem.id,
    assetId: historicalAssetId,
    queueJobId: "job_predates_intake_batch"
  }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_queue_job_predates_batch",
  "even exact tags cannot revive a job created before the intake batch existed"
);

const cancelRaceBatch = await commitWriterIntakeBatch({
  tenantId,
  operatorId,
  idempotencyKey: "browser-intent-cancel-race",
  expectedItemCount: 1
}, storeOptions);
const cancelRaceItem = cancelRaceBatch.items[0];
await settleWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: cancelRaceBatch.batch_id,
  itemId: cancelRaceItem.id,
  disposition: "CANCELLED"
}, storeOptions);
const cancelRaceAssetId = "asset_62345678-1234-4123-8123-123456789abc";
queueJobs.set("job_cancel_race_winner", {
  id: "job_cancel_race_winner",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: cancelRaceAssetId,
  recognition_session_id: "session_cancel_race_winner",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(cancelRaceBatch.batch_id, cancelRaceItem.id),
  created_at: "2026-07-30T00:59:40.000Z"
});
const canonicalRaceWinner = await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: cancelRaceBatch.batch_id,
  itemId: cancelRaceItem.id,
  assetId: cancelRaceAssetId,
  queueJobId: "job_cancel_race_winner"
}, storeOptions);
assert.equal(canonicalRaceWinner.item.status, "QUEUE_ADMITTED", "a canonical tagged job must win a late cancel race");
assert.equal(canonicalRaceWinner.item.last_error_code, null);

const lateCommitBatch = await commitWriterIntakeBatch({
  tenantId,
  operatorId,
  idempotencyKey: "browser-intent-job-after-abandon",
  expectedItemCount: 1
}, storeOptions);
const lateCommitItem = lateCommitBatch.items[0];
await abandonWriterIntakeBatch({
  tenantId,
  operatorId,
  batchId: lateCommitBatch.batch_id
}, storeOptions);
assert.equal(items.get(lateCommitItem.id).status, "CANCELLED");
const lateCommitAssetId = "asset_82345678-1234-4123-8123-123456789abc";
queueJobs.set("job_committed_after_abandon", {
  id: "job_committed_after_abandon",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: lateCommitAssetId,
  recognition_session_id: "session_committed_after_abandon",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(lateCommitBatch.batch_id, lateCommitItem.id),
  created_at: "2026-07-30T00:59:40.000Z"
});
const repairedLateCommit = await getWriterIntakeStatus({
  tenantId,
  operatorId,
  batchId: lateCommitBatch.batch_id
}, storeOptions);
assert.equal(repairedLateCommit.items[0].status, "QUEUE_ADMITTED", "GET repair must let a later canonical commit beat cancellation");
assert.equal(repairedLateCommit.items[0].queue_job_id, "job_committed_after_abandon");

const orphanedAssetBatch = await commitWriterIntakeBatch({
  tenantId,
  operatorId,
  idempotencyKey: "browser-intent-asset-admitted-without-queue",
  expectedItemCount: 1
}, storeOptions);
const orphanedAssetItem = orphanedAssetBatch.items[0];
const orphanedAssetId = "asset_a2345678-1234-4123-8123-123456789abc";
await admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId: orphanedAssetBatch.batch_id,
  itemId: orphanedAssetItem.id,
  assetId: orphanedAssetId
}, storeOptions);
assert.equal(items.get(orphanedAssetItem.id).status, "ASSET_ADMITTED");
const abandonedOrphanedAsset = await abandonWriterIntakeBatch({
  tenantId,
  operatorId,
  batchId: orphanedAssetBatch.batch_id
}, storeOptions);
assert.equal(abandonedOrphanedAsset.items[0].status, "CANCELLED", "a zero-accepted enqueue must not leave a permanent ASSET_ADMITTED ghost");
assert.equal(abandonedOrphanedAsset.items[0].asset_id, orphanedAssetId, "abandonment must retain canonical asset provenance");

const incompleteRepairBatch = await commitWriterIntakeBatch({
  tenantId,
  operatorId,
  idempotencyKey: "browser-intent-incomplete-canonical-repair",
  expectedItemCount: 1
}, storeOptions);
queueJobs.set("job_incomplete_canonical_repair", {
  id: "job_incomplete_canonical_repair",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: "asset_92345678-1234-4123-8123-123456789abc",
  recognition_session_id: "session_incomplete_canonical_repair",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(incompleteRepairBatch.batch_id, firstItemId),
  created_at: "2026-07-30T00:59:40.000Z"
});
const abandonCallsBeforeIncompleteRepair = calls.filter((call) => call.fn === "abandon_v4_writer_intake_batch").length;
await assert.rejects(
  () => abandonWriterIntakeBatch({
    tenantId,
    operatorId,
    batchId: incompleteRepairBatch.batch_id
  }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_item_not_found",
  "an unprojectable canonical job must retain the browser recovery pointer instead of permitting cancellation"
);
assert.equal(items.get(incompleteRepairBatch.items[0].id).status, "DECLARED");
assert.equal(
  calls.filter((call) => call.fn === "abandon_v4_writer_intake_batch").length,
  abandonCallsBeforeIncompleteRepair,
  "ABANDON RPC must not run after incomplete canonical repair"
);
queueJobs.delete("job_incomplete_canonical_repair");

const duplicateItemId = "intake_item_ffffffffffffffffffffffffffffffff";
items.set(duplicateItemId, {
  ...items.get(firstItemId),
  id: duplicateItemId,
  item_position: 999,
  queue_job_id: "job_003",
  recognition_session_id: "session_003"
});
await assert.rejects(
  () => reconcileWriterIntakeCanonicalJobRows({ jobIds: ["job_003"] }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_reconciliation_ambiguous_queue_link",
  "a corrupted duplicate queue projection must fail closed before Map indexing"
);
items.delete(duplicateItemId);

const job003Tags = queueJobs.get("job_003").queue_tags;
queueJobs.get("job_003").queue_tags = intakeQueueTags(batchIdentity.batch_id, secondItemId);
await assert.rejects(
  () => reconcileWriterIntakeCanonicalJobRows({ jobIds: ["job_003"] }, storeOptions),
  (error) => error instanceof WriterIntakeStoreError && error.code === "writer_intake_reconciliation_reference_mismatch",
  "an existing projection cannot bypass exact canonical batch/item tags"
);
queueJobs.get("job_003").queue_tags = job003Tags;

const crashBatch = await commitWriterIntakeBatch({
  tenantId,
  operatorId,
  idempotencyKey: "browser-intent-crash-100",
  expectedItemCount: 100
}, storeOptions);
const crashWinner = crashBatch.items[0];
const crashAssetId = "asset_72345678-1234-4123-8123-123456789abc";
queueJobs.set("job_crash_repair_winner", {
  id: "job_crash_repair_winner",
  tenant_id: tenantId,
  operator_id: operatorId,
  asset_id: crashAssetId,
  recognition_session_id: "session_crash_repair_winner",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "QUEUED",
  queue_tags: intakeQueueTags(crashBatch.batch_id, crashWinner.id),
  created_at: "2026-07-30T00:59:40.000Z"
});
const abandonedCrash = await abandonWriterIntakeBatch({
  tenantId,
  operatorId,
  batchId: crashBatch.batch_id
}, storeOptions);
assert.equal(abandonedCrash.expected_item_count, 100);
assert.equal(abandonedCrash.counts_by_status.QUEUE_ADMITTED, 1, "tagged canonical truth must be repaired before abandonment");
assert.equal(abandonedCrash.counts_by_status.CANCELLED, 99, "every pointer-free crash remainder must be cancelled atomically");
assert.equal(abandonedCrash.counts_by_status.DECLARED || 0, 0, "abandonment must leave no permanent DECLARED tail");
assert.equal(abandonedCrash.terminal_item_count, 99);
assert.equal(abandonedCrash.outstanding_item_count, 1, "the surviving canonical job remains live work");
const abandonRpcCount = calls.filter((call) => call.fn === "abandon_v4_writer_intake_batch").length;
const abandonedCrashReplay = await abandonWriterIntakeBatch({
  tenantId,
  operatorId,
  batchId: crashBatch.batch_id
}, storeOptions);
assert.equal(abandonedCrashReplay.counts_by_status.CANCELLED, 99);
assert.equal(
  calls.filter((call) => call.fn === "abandon_v4_writer_intake_batch").length,
  abandonRpcCount + 1,
  "a lost abandon response must be safe to replay"
);

const migration = await readFile(new URL("../supabase/migrations/20260730065921_v4_writer_intake_ledger_v1.sql", import.meta.url), "utf8");
assert.match(migration, /alter table public\.v4_writer_intake_batches enable row level security/i);
assert.match(migration, /alter table public\.v4_writer_intake_items enable row level security/i);
assert.match(migration, /grant insert, update on table public\.v4_writer_intake_items to service_role/i);
assert.doesNotMatch(migration, /grant[^;]*(?:insert|update|delete)[^;]*authenticated/i, "browser roles must not mutate the ledger");
assert.match(migration, /private\.current_user_matches_operator\(operator_id\)/i);
assert.match(migration, /check \(not training_eligible and not catalog_promotion_eligible and not identity_truth\)/i);
assert.match(migration, /references public\.listing_assets\(tenant_id, id\)/i);
assert.match(migration, /references public\.v4_recognition_jobs\(tenant_id, id\)/i);
assert.doesNotMatch(
  migration,
  /create\s+trigger[^;]*on public\.v4_writer_intake_(?:batches|items)/i,
  "intake clocks must be explicit owner projections, never implicit DB triggers"
);
assert.match(migration, /commit_v4_writer_intake_batch/i, "batch denominator must commit atomically");
assert.match(migration, /image_set_finalized_at/i, "asset durability must use a canonical finalized clock");
assert.match(
  migration,
  /max\(verifications\.verified_at\)[\s\S]*set image_set_finalized_at = completion\.verified_at/i,
  "legacy FINALIZED assets must use their last canonical-original verification, never migration time"
);
assert.match(
  migration,
  /expected_original_count = completion\.original_count[\s\S]*expected_original_count = completion\.original_role_count/i,
  "legacy clock backfill must prove both canonical row and role cardinality"
);
assert.match(
  migration,
  /listing_asset_finalized_clock_source_missing/i,
  "migration must fail closed when a legacy FINALIZED asset lacks a source-complete clock"
);
assert.match(migration, /before insert or update on public\.listing_assets/i, "both direct and transitioned FINALIZED assets need a server clock");
assert.match(migration, /listing_asset_finalized_clock_immutable/i, "the canonical finalized clock must be immutable");
assert.match(migration, /writer_intake_item_set_conflict/i, "an idempotent replay must reject a tampered item denominator");
assert.match(
  migration,
  /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\([\s\S]*p_tenant_id[\s\S]*p_operator_id/i,
  "database admission must serialize new batch creation per tenant and operator"
);
assert.match(
  migration,
  /sum\(batches\.expected_item_count\)[\s\S]*committed_at >= pg_catalog\.clock_timestamp\(\) - interval '60 seconds'[\s\S]*recent_batch_count >= 12[\s\S]*recent_item_count \+ p_expected_item_count > 2000[\s\S]*writer_intake_commit_rate_limited/i,
  "database admission must bound both new-batch count and row amplification per minute"
);
assert.match(
  migration,
  /v4_writer_intake_batches_commit_rate_idx[\s\S]*tenant_id, operator_id, committed_at desc/i,
  "the cross-instance rate boundary needs an indexed principal clock lookup"
);
assert.ok(
  migration.indexOf("and batches.idempotency_key_sha256 = p_idempotency_key_sha256")
    < migration.indexOf("into recent_batch_count, recent_item_count"),
  "idempotent response-loss replay must be detected before consuming the new-batch budget"
);
assert.match(
  migration,
  /create unique index if not exists v4_writer_intake_items_queue_job_uidx[\s\S]*where queue_job_id is not null/i,
  "one canonical queue job may project to only one writer position per tenant"
);
assert.match(
  migration,
  /create unique index if not exists v4_writer_intake_items_session_uidx[\s\S]*where recognition_session_id is not null/i,
  "one recognition session may project to only one writer position per tenant"
);
assert.match(migration, /create or replace function public\.abandon_v4_writer_intake_batch/i);
assert.match(
  migration,
  /and items\.queue_job_id is null[\s\S]*and items\.recognition_session_id is null[\s\S]*and items\.status in \('DECLARED', 'ASSET_ADMITTED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL'\)/i,
  "batch abandonment may close an asset-admitted orphan only while no canonical queue owner exists"
);
assert.match(
  migration,
  /queue_tags ->> 'writer_intake_batch_id'/i,
  "batch-tagged canonical repair needs a bounded lookup index"
);

const workerSource = await readFile(new URL("../api/v4/listing-job-worker.js", import.meta.url), "utf8");
assert.match(
  workerSource,
  /jobStatus === v4JobStatuses\.L2_READY && isWriterIntakeCanonicalJob\(job\)[\s\S]*reconcileWriterIntakeCanonicalJobRowsBestEffort\(\{[\s\S]*jobIds: \[job\.id\]/,
  "a fast L2 completion must rebuild a missing queue link before projecting writer readiness"
);
assert.match(
  workerSource,
  /failure\.saved === true[\s\S]*job\.job_type === v4JobTypes\.FINAL_ASSISTED_TITLE[\s\S]*isWriterIntakeCanonicalJob\(job\)[\s\S]*reconcileWriterIntakeCanonicalJobRowsBestEffort\(\{ jobIds: \[job\.id\] \}\)/,
  "canonical failure transitions must repair the intake projection"
);
const statusSource = await readFile(new URL("../api/v4/listing-job-status.js", import.meta.url), "utf8");
assert.match(
  statusSource,
  /writerIntakeJobIds = ownedJobs[\s\S]*\.filter\(isWriterIntakeCanonicalJob\)[\s\S]*waitUntil\(reconcileWriterIntakeCanonicalJobRowsBestEffort\(\{ jobIds: writerIntakeJobIds \}\)\)/,
  "writer status polling must heal a projection write lost after canonical completion"
);
assert.equal(isWriterIntakeCanonicalJob({ queue_tags: {} }), false);
assert.equal(isWriterIntakeCanonicalJob({
  queue_tags: intakeQueueTags(batchIdentity.batch_id, firstItemId)
}), true, "only canonically tagged intake jobs should spend a repair read");
const reconciliationWarnings = [];
const bestEffortRepair = await reconcileWriterIntakeCanonicalJobRowsBestEffort({
  jobIds: ["job_background_failure"]
}, {
  ...storeOptions,
  readRows: async () => ({ ok: false, rows: [] }),
  logger: { warn: (...parts) => reconciliationWarnings.push(parts) }
});
assert.equal(bestEffortRepair.ok, false, "repair-only projection failures must settle instead of rejecting waitUntil");
assert.equal(bestEffortRepair.code, "writer_intake_canonical_jobs_read_failed");
assert.equal(reconciliationWarnings.length, 1, "repair failure remains observable exactly once");
const feedbackSource = await readFile(new URL("../api/v4/listing-feedback.js", import.meta.url), "utf8");
assert.ok(
  feedbackSource.indexOf("if (!transaction.saved)")
    < feedbackSource.indexOf("reconcileWriterIntakeCanonicalFeedbackEvent({"),
  "writer completion may project only after the canonical feedback transaction commits"
);

console.log("writer intake ledger tests passed");
