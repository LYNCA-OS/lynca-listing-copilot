import { requireTenantListingAsset } from "../../tenant/assets.mjs";
import {
  callV4Rpc,
  patchV4Row,
  readV4Rows
} from "../v4/session/supabase-rest.mjs";
import {
  WriterIntakeContractError,
  normalizeWriterIntakeBatchId,
  normalizeWriterIntakeExpectedItemCount,
  normalizeWriterIntakeItemId,
  normalizeWriterIntakeItemPosition,
  normalizeWriterIntakeOperatorId,
  normalizeWriterIntakeTenantId,
  writerIntakeBatchIdentity,
  writerIntakeContractVersion,
  writerIntakeItemIdentity,
  writerIntakeResumeAction
} from "./writer-intake-contract.mjs";
import {
  projectWriterIntakeCanonicalEvent,
  writerIntakeProjectionEvents
} from "./writer-intake-projection.mjs";

const batchTable = "v4_writer_intake_batches";
const itemTable = "v4_writer_intake_items";
const settledItemStatuses = new Set(["WRITER_COMPLETED", "FAILED_TERMINAL", "CANCELLED"]);
const operatorSettlement = Object.freeze({
  FAILED: Object.freeze({
    status: "FAILED_TERMINAL",
    durability_status: "FAILED_TERMINAL",
    last_error_code: "OPERATOR_REPORTED_INPUT_FAILURE"
  }),
  CANCELLED: Object.freeze({
    status: "CANCELLED",
    last_error_code: "OPERATOR_CANCELLED_INPUT"
  })
});

export class WriterIntakeStoreError extends Error {
  constructor(code, { statusCode = 503, retryable = statusCode >= 500 } = {}) {
    super(code);
    this.name = "WriterIntakeStoreError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function dependencies(options = {}) {
  return {
    commitBatchAtomic: options.commitBatchAtomic || ((payload) => callV4Rpc({
      fn: "commit_v4_writer_intake_batch",
      payload,
      env: options.env || process.env,
      fetchImpl: options.fetchImpl || globalThis.fetch
    })),
    abandonBatchAtomic: options.abandonBatchAtomic || ((payload) => callV4Rpc({
      fn: "abandon_v4_writer_intake_batch",
      payload,
      env: options.env || process.env,
      fetchImpl: options.fetchImpl || globalThis.fetch
    })),
    readRows: options.readRows || readV4Rows,
    patchRow: options.patchRow || patchV4Row,
    requireAsset: options.requireAsset || requireTenantListingAsset,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    now: options.now || (() => new Date()),
    logger: options.logger || console
  };
}

function isoNow(now) {
  return now().toISOString();
}

function validIso(value) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function searchScope(tenantId, operatorId) {
  return {
    tenant_id: `eq.${tenantId}`,
    operator_id: `eq.${operatorId}`
  };
}

async function readExactlyOne({ table, select = "*", search, missingCode }, deps) {
  const result = await deps.readRows({
    table,
    select,
    search: { ...search, limit: "2" },
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (!result?.ok) throw new WriterIntakeStoreError(`${missingCode}_read_failed`);
  if (result.rows.length !== 1) {
    throw new WriterIntakeStoreError(missingCode, { statusCode: 404, retryable: false });
  }
  return result.rows[0];
}

async function readBatch({ tenantId, operatorId, batchId }, deps) {
  return readExactlyOne({
    table: batchTable,
    search: {
      ...searchScope(tenantId, operatorId),
      id: `eq.${batchId}`
    },
    missingCode: "writer_intake_batch_not_found"
  }, deps);
}

async function readItem({ tenantId, operatorId, batchId, itemId }, deps) {
  return readExactlyOne({
    table: itemTable,
    search: {
      ...searchScope(tenantId, operatorId),
      batch_id: `eq.${batchId}`,
      id: `eq.${itemId}`
    },
    missingCode: "writer_intake_item_not_found"
  }, deps);
}

function assertItemContract(item, { itemId, refHash, position } = {}) {
  if (
    item?.id !== itemId
    || item?.client_item_ref_sha256 !== refHash
    || Number(item?.item_position) !== position
  ) {
    throw new WriterIntakeStoreError("writer_intake_item_conflict", {
      statusCode: 409,
      retryable: false
    });
  }
}

function publicItem(item = {}) {
  const resumeAction = writerIntakeResumeAction(item);
  const settled = settledItemStatuses.has(String(item?.status || ""));
  const actionRequired = resumeAction !== "NONE";
  return Object.freeze({
    id: item.id,
    batch_id: item.batch_id,
    item_position: Number(item.item_position),
    status: item.status,
    durability_status: item.durability_status,
    asset_id: item.asset_id || null,
    queue_job_id: item.queue_job_id || null,
    recognition_session_id: item.recognition_session_id || null,
    appended_at: item.appended_at || null,
    asset_admitted_at: item.asset_admitted_at || null,
    queue_admitted_at: item.queue_admitted_at || null,
    writer_ready_at: item.writer_ready_at || null,
    writer_completed_at: item.writer_completed_at || null,
    asset_durable_at: item.asset_durable_at || null,
    last_error_code: item.last_error_code || null,
    resume_action: resumeAction,
    settled,
    action_required: actionRequired,
    terminal: settled && !actionRequired,
    training_eligible: false,
    catalog_promotion_eligible: false,
    identity_truth: false
  });
}

function publicMutationResult(batchId, item) {
  return Object.freeze({
    contract_version: writerIntakeContractVersion,
    batch_id: batchId,
    item: publicItem(item),
    truth_boundary: Object.freeze({
      training_eligible: false,
      catalog_promotion_eligible: false,
      identity_truth: false
    })
  });
}

export async function commitWriterIntakeBatch({
  tenantId,
  operatorId,
  idempotencyKey,
  expectedItemCount
} = {}, options = {}) {
  const deps = dependencies(options);
  const tenant_id = normalizeWriterIntakeTenantId(tenantId);
  const operator_id = normalizeWriterIntakeOperatorId(operatorId);
  const expected_item_count = normalizeWriterIntakeExpectedItemCount(expectedItemCount);
  const identity = writerIntakeBatchIdentity({ tenantId: tenant_id, operatorId: operator_id, idempotencyKey });

  const committed = await deps.commitBatchAtomic({
    p_tenant_id: tenant_id,
    p_operator_id: operator_id,
    p_batch_id: identity.batch_id,
    p_idempotency_key_sha256: identity.idempotency_key_sha256,
    p_expected_item_count: expected_item_count
  });
  const transaction = committed?.rows?.[0] || {};
  if (!committed?.ok || transaction.saved !== true || transaction.batch_id !== identity.batch_id) {
    const commitError = String(committed?.error || "");
    const conflict = /idempotency_conflict|item_set_conflict/i.test(commitError);
    const rateLimited = /writer_intake_commit_rate_limited/i.test(commitError);
    throw new WriterIntakeStoreError(
      rateLimited
        ? "writer_intake_commit_rate_limited"
        : conflict
          ? "writer_intake_idempotency_conflict"
          : "writer_intake_commit_failed",
      {
        statusCode: rateLimited ? 429 : conflict ? 409 : 503,
        retryable: rateLimited || !conflict
      }
    );
  }
  return getWriterIntakeStatus({ tenantId: tenant_id, operatorId: operator_id, batchId: identity.batch_id }, deps);
}

export async function appendWriterIntakeItem({
  tenantId,
  operatorId,
  batchId,
  clientItemRef,
  itemPosition
} = {}, options = {}) {
  const deps = dependencies(options);
  const tenant_id = normalizeWriterIntakeTenantId(tenantId);
  const operator_id = normalizeWriterIntakeOperatorId(operatorId);
  const batch_id = normalizeWriterIntakeBatchId(batchId);
  const item_position = normalizeWriterIntakeItemPosition(itemPosition);
  const identity = writerIntakeItemIdentity({ batchId: batch_id, clientItemRef });
  const batch = await readBatch({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id }, deps);
  if (item_position > Number(batch.expected_item_count)) {
    throw new WriterIntakeContractError("writer_intake_item_position_exceeds_batch");
  }

  let item;
  try {
    item = await readItem({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id, itemId: identity.item_id }, deps);
  } catch (error) {
    if (error instanceof WriterIntakeStoreError && error.statusCode === 404) {
      throw new WriterIntakeStoreError("writer_intake_item_not_predeclared", { statusCode: 409, retryable: false });
    }
    throw error;
  }
  assertItemContract(item, {
    itemId: identity.item_id,
    refHash: identity.client_item_ref_sha256,
    position: item_position
  });

  return publicMutationResult(batch_id, item);
}

// This mutation records only operator workflow intent. It cannot manufacture
// an asset, queue result, title, or learning truth, and it never accepts a
// browser-supplied lifecycle status, clock, or error code. A replay of the same
// disposition is idempotent; a late report cannot overwrite canonical asset or
// queue admission that already won the race.
export async function settleWriterIntakeItem({
  tenantId,
  operatorId,
  batchId,
  itemId,
  disposition
} = {}, options = {}) {
  const deps = dependencies(options);
  const tenant_id = normalizeWriterIntakeTenantId(tenantId);
  const operator_id = normalizeWriterIntakeOperatorId(operatorId);
  const batch_id = normalizeWriterIntakeBatchId(batchId);
  const item_id = normalizeWriterIntakeItemId(itemId);
  const normalizedDisposition = String(disposition || "").trim().toUpperCase();
  const desired = operatorSettlement[normalizedDisposition];
  if (!desired) throw new WriterIntakeContractError("invalid_writer_intake_settlement");

  const item = await readItem({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id, itemId: item_id }, deps);
  if (item.asset_id || item.queue_job_id || item.recognition_session_id) {
    throw new WriterIntakeStoreError("writer_intake_canonical_admission_already_exists", {
      statusCode: 409,
      retryable: false
    });
  }
  if (
    item.status === desired.status
    && (item.last_error_code || null) === desired.last_error_code
  ) {
    return publicMutationResult(batch_id, item);
  }
  const allowedStatuses = normalizedDisposition === "CANCELLED"
    ? new Set(["DECLARED", "FAILED_RETRYABLE", "FAILED_TERMINAL"])
    : new Set(["DECLARED", "FAILED_RETRYABLE"]);
  if (!allowedStatuses.has(String(item.status || ""))) {
    throw new WriterIntakeStoreError("writer_intake_item_settlement_conflict", {
      statusCode: 409,
      retryable: false
    });
  }

  const patch = {
    ...desired,
    updated_at: isoNow(deps.now)
  };
  const saved = await deps.patchRow({
    table: itemTable,
    id: item_id,
    patch,
    match: {
      tenant_id: `eq.${tenant_id}`,
      operator_id: `eq.${operator_id}`,
      batch_id: `eq.${batch_id}`,
      status: `eq.${item.status}`,
      asset_id: "is.null",
      queue_job_id: "is.null",
      recognition_session_id: "is.null"
    },
    requireMatch: true,
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (!saved?.saved) {
    const winner = await readItem({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id, itemId: item_id }, deps);
    if (
      winner.status !== desired.status
      || (winner.last_error_code || null) !== desired.last_error_code
    ) {
      throw new WriterIntakeStoreError("writer_intake_item_settlement_conflict", {
        statusCode: 409,
        retryable: false
      });
    }
  }
  const current = await readItem({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id, itemId: item_id }, deps);
  return publicMutationResult(batch_id, current);
}

async function verifiedQueueAdmission({
  tenantId,
  operatorId,
  batchId,
  itemId,
  batchCommittedAt,
  assetId = "",
  queueJobId
}, deps) {
  if (!queueJobId) return null;
  const jobId = String(queueJobId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(jobId)) {
    throw new WriterIntakeContractError("invalid_writer_intake_queue_job_id");
  }
  const job = await readExactlyOne({
    table: "v4_recognition_jobs",
    select: "id,tenant_id,operator_id,asset_id,recognition_session_id,job_type,status,queue_tags,payload,error,created_at,completed_at",
    search: {
      tenant_id: `eq.${tenantId}`,
      operator_id: `eq.${operatorId}`,
      id: `eq.${jobId}`,
      ...(assetId ? { asset_id: `eq.${assetId}` } : {})
    },
    missingCode: "writer_intake_queue_job_not_found"
  }, deps);
  if (job.job_type !== "FINAL_ASSISTED_TITLE" || !job.recognition_session_id) {
    throw new WriterIntakeStoreError("writer_intake_final_queue_job_required", {
      statusCode: 409,
      retryable: false
    });
  }
  const tags = writerIntakeTags(job);
  if (!tags || tags.batch_id !== batchId || tags.item_id !== itemId) {
    throw new WriterIntakeStoreError("writer_intake_queue_reference_mismatch", {
      statusCode: 409,
      retryable: false
    });
  }
  const canonicalCreatedAt = validIso(job.created_at);
  const canonicalCommittedAt = validIso(batchCommittedAt);
  if (!canonicalCreatedAt) {
    throw new WriterIntakeStoreError("writer_intake_queue_job_clock_missing", {
      statusCode: 409,
      retryable: false
    });
  }
  if (!canonicalCommittedAt || Date.parse(canonicalCreatedAt) < Date.parse(canonicalCommittedAt)) {
    throw new WriterIntakeStoreError("writer_intake_queue_job_predates_batch", {
      statusCode: 409,
      retryable: false
    });
  }
  return { ...job, writer_intake_reference: tags };
}

export async function admitWriterIntakeItem({
  tenantId,
  operatorId,
  batchId,
  itemId,
  assetId,
  queueJobId = "",
  previousQueueJobId = "",
  reservedQueueJobId = ""
} = {}, options = {}) {
  const deps = dependencies(options);
  const tenant_id = normalizeWriterIntakeTenantId(tenantId);
  const operator_id = normalizeWriterIntakeOperatorId(operatorId);
  const batch_id = normalizeWriterIntakeBatchId(batchId);
  const item_id = normalizeWriterIntakeItemId(itemId);
  const normalizedAssetId = String(assetId || "").trim();
  const normalizedQueueJobId = String(queueJobId || "").trim();
  const normalizedPreviousJobId = String(previousQueueJobId || "").trim();
  const normalizedReservedJobId = String(reservedQueueJobId || "").trim();
  for (const id of [normalizedQueueJobId, normalizedPreviousJobId, normalizedReservedJobId].filter(Boolean)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id)) {
      throw new WriterIntakeStoreError("writer_intake_queue_job_id_invalid", {
        statusCode: 400,
        retryable: false
      });
    }
  }
  const [batch, item] = await Promise.all([
    readBatch({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id }, deps),
    readItem({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id, itemId: item_id }, deps)
  ]);
  // commit_v4_writer_intake_batch closes the immutable denominator in the
  // same transaction that creates every DECLARED item. Anything else is not a
  // writer-authorized paid-work intent, even when a syntactically valid tag was
  // supplied by the browser.
  if (String(batch.status || "") !== "INTAKE_CLOSED" || !validIso(batch.committed_at)) {
    throw new WriterIntakeStoreError("writer_intake_batch_not_committed", {
      statusCode: 409,
      retryable: false
    });
  }
  if (options.requireQueueSuccessorAuthorization === true) {
    if (options.requireQueueReservation === true && !normalizedReservedJobId) {
      throw new WriterIntakeStoreError("writer_intake_queue_reservation_required", {
        statusCode: 409,
        retryable: false
      });
    }
    const storedQueueJobId = String(item.queue_job_id || "").trim();
    const storedPendingJobId = String(item.pending_queue_job_id || "").trim();
    const storedPendingPredecessorId = String(item.pending_predecessor_queue_job_id || "").trim();
    if (
      options.requireQueueReservation === true
      && storedPendingJobId
      && storedPendingJobId !== normalizedReservedJobId
    ) {
      throw new WriterIntakeStoreError("writer_intake_queue_reservation_conflict", {
        statusCode: 409,
        retryable: false
      });
    }
    let replayingCurrentJob = false;
    if (
      options.requireQueueReservation === true
      && storedQueueJobId
      && storedQueueJobId === normalizedReservedJobId
    ) {
      const existingReservedJob = await verifiedQueueAdmission({
        tenantId: tenant_id,
        operatorId: operator_id,
        batchId: batch_id,
        itemId: item_id,
        batchCommittedAt: batch.committed_at,
        assetId: normalizedAssetId,
        queueJobId: storedQueueJobId
      }, deps);
      if (
        String(existingReservedJob.writer_intake_reference?.previous_queue_job_id || "")
        !== normalizedPreviousJobId
      ) {
        throw new WriterIntakeStoreError("writer_intake_successor_job_link_conflict", {
          statusCode: 409,
          retryable: false
        });
      }
      replayingCurrentJob = true;
    }
    const replayingAssetRebindPreparation = Boolean(
      options.requireQueueReservation !== true
      && normalizedPreviousJobId
      && !storedQueueJobId
      && String(item.status || "") === "ASSET_ADMITTED"
      && String(item.asset_id || "") === normalizedAssetId
    );
    const expectedPredecessorId = storedPendingJobId || storedPendingPredecessorId
      ? storedPendingPredecessorId
      : replayingCurrentJob
        ? normalizedPreviousJobId
        : storedQueueJobId;
    if (!replayingAssetRebindPreparation && normalizedPreviousJobId !== expectedPredecessorId) {
      throw new WriterIntakeStoreError("writer_intake_previous_job_link_conflict", {
        statusCode: 409,
        retryable: false
      });
    }
    if (normalizedPreviousJobId) {
      const previousJob = await verifiedQueueAdmission({
        tenantId: tenant_id,
        operatorId: operator_id,
        batchId: batch_id,
        itemId: item_id,
        batchCommittedAt: batch.committed_at,
        queueJobId: normalizedPreviousJobId
      }, deps);
      if (!["FAILED", "CANCELLED"].includes(String(previousJob?.status || "").toUpperCase())) {
        throw new WriterIntakeStoreError("writer_intake_previous_job_not_terminal", {
          statusCode: 409,
          retryable: false
        });
      }
    }
  }
  if (
    String(item.status || "") === "WRITER_COMPLETED"
    || (
      String(item.status || "") === "CANCELLED"
      && !String(item.queue_job_id || "").trim()
      && !normalizedQueueJobId
    )
  ) {
    throw new WriterIntakeStoreError("writer_intake_item_terminal", {
      statusCode: 409,
      retryable: false
    });
  }

  const asset = await deps.requireAsset({
    tenantId: tenant_id,
    assetId: normalizedAssetId,
    requireDurable: true,
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (asset?.asset_id !== normalizedAssetId || asset?.tenant_id !== tenant_id) {
    throw new WriterIntakeStoreError("writer_intake_canonical_asset_not_found", { statusCode: 409, retryable: false });
  }
  if (
    asset?.row?.image_set_state !== "FINALIZED"
    || !/^[0-9a-f]{64}$/.test(String(asset?.row?.image_set_sha256 || ""))
    || !validIso(asset?.row?.image_set_finalized_at)
  ) {
    throw new WriterIntakeStoreError("writer_intake_canonical_asset_not_finalized", {
      statusCode: 409,
      retryable: true
    });
  }
  const queueJob = await verifiedQueueAdmission({
    tenantId: tenant_id,
    operatorId: operator_id,
    batchId: batch_id,
    itemId: item_id,
    batchCommittedAt: batch.committed_at,
    assetId: normalizedAssetId,
    queueJobId: normalizedQueueJobId
  }, deps);
  if (
    queueJob
    && item.pending_queue_job_id
    && String(item.pending_queue_job_id) !== queueJob.id
  ) {
    throw new WriterIntakeStoreError("writer_intake_queue_reservation_conflict", {
      statusCode: 409,
      retryable: false
    });
  }
  if (
    queueJob
    && item.pending_queue_job_id
    && String(item.pending_predecessor_queue_job_id || "")
      !== String(queueJob.writer_intake_reference?.previous_queue_job_id || "")
  ) {
    throw new WriterIntakeStoreError("writer_intake_successor_job_link_conflict", {
      statusCode: 409,
      retryable: false
    });
  }
  const replacingAsset = Boolean(item.asset_id && item.asset_id !== normalizedAssetId);
  const replacingQueueJob = Boolean(item.queue_job_id && queueJob && item.queue_job_id !== queueJob.id);
  if (replacingAsset || replacingQueueJob) {
    const previousJobId = normalizedPreviousJobId;
    if (!item.queue_job_id || previousJobId !== item.queue_job_id) {
      throw new WriterIntakeStoreError(
        replacingAsset ? "writer_intake_asset_conflict" : "writer_intake_queue_job_conflict",
        { statusCode: 409, retryable: false }
      );
    }
    const previousJob = await verifiedQueueAdmission({
      tenantId: tenant_id,
      operatorId: operator_id,
      batchId: batch_id,
      itemId: item_id,
      batchCommittedAt: batch.committed_at,
      queueJobId: previousJobId
    }, deps);
    if (
      previousJob.asset_id !== item.asset_id
      || previousJob.recognition_session_id !== item.recognition_session_id
    ) {
      throw new WriterIntakeStoreError("writer_intake_previous_job_link_conflict", {
        statusCode: 409,
        retryable: false
      });
    }
    if (!["FAILED", "CANCELLED"].includes(String(previousJob?.status || "").toUpperCase())) {
      throw new WriterIntakeStoreError("writer_intake_previous_job_not_terminal", {
        statusCode: 409,
        retryable: false
      });
    }
    if (queueJob && queueJob.writer_intake_reference?.previous_queue_job_id !== previousJobId) {
      throw new WriterIntakeStoreError("writer_intake_successor_job_link_conflict", {
        statusCode: 409,
        retryable: false
      });
    }
  }

  const canonicalFinalizedAt = validIso(asset.row.image_set_finalized_at);
  const canonicalQueueAdmittedAt = queueJob ? validIso(queueJob.created_at) : null;
  if (queueJob && !canonicalQueueAdmittedAt) {
    throw new WriterIntakeStoreError("writer_intake_queue_job_clock_missing", {
      statusCode: 409,
      retryable: false
    });
  }
  if (canonicalQueueAdmittedAt && Date.parse(canonicalQueueAdmittedAt) < Date.parse(canonicalFinalizedAt)) {
    throw new WriterIntakeStoreError("writer_intake_queue_job_clock_invalid", {
      statusCode: 409,
      retryable: false
    });
  }
  const patch = {};
  if (replacingAsset && normalizedPreviousJobId && !item.pending_predecessor_queue_job_id) {
    patch.pending_predecessor_queue_job_id = normalizedPreviousJobId;
  }
  if (
    options.requireQueueReservation === true
    && String(item.queue_job_id || "") !== normalizedReservedJobId
    && !item.pending_queue_job_id
  ) {
    patch.pending_queue_job_id = normalizedReservedJobId;
    patch.pending_predecessor_queue_job_id = normalizedPreviousJobId || null;
  }
  if (!item.asset_id || replacingAsset) {
    patch.asset_id = normalizedAssetId;
    patch.asset_admitted_at = isoNow(deps.now);
    patch.status = "ASSET_ADMITTED";
  }
  if (!validIso(item.asset_durable_at) || replacingAsset || replacingQueueJob) {
    patch.asset_durable_at = canonicalFinalizedAt;
    patch.durability_status = "DURABLE";
  }
  if (replacingAsset && !queueJob) {
    patch.queue_job_id = null;
    patch.recognition_session_id = null;
    patch.queue_admitted_at = null;
    patch.writer_ready_at = null;
    patch.writer_completed_at = null;
    patch.last_error_code = null;
  }
  if (queueJob && (!item.queue_job_id || replacingQueueJob)) {
    patch.queue_job_id = queueJob.id;
    patch.recognition_session_id = queueJob.recognition_session_id || null;
    patch.queue_admitted_at = canonicalQueueAdmittedAt;
    patch.status = "QUEUE_ADMITTED";
    patch.last_error_code = null;
    patch.pending_queue_job_id = null;
    patch.pending_predecessor_queue_job_id = null;
    if (replacingQueueJob) {
      patch.writer_ready_at = null;
      patch.writer_completed_at = null;
    }
  }

  if (Object.keys(patch).length) {
    patch.updated_at = isoNow(deps.now);
    const saved = await deps.patchRow({
      table: itemTable,
      id: item_id,
      patch,
      match: {
        tenant_id: `eq.${tenant_id}`,
        operator_id: `eq.${operator_id}`,
        batch_id: `eq.${batch_id}`,
        status: `eq.${item.status}`,
        pending_queue_job_id: item.pending_queue_job_id
          ? `eq.${item.pending_queue_job_id}`
          : "is.null",
        pending_predecessor_queue_job_id: item.pending_predecessor_queue_job_id
          ? `eq.${item.pending_predecessor_queue_job_id}`
          : "is.null",
        ...(replacingAsset || replacingQueueJob
          ? { asset_id: `eq.${item.asset_id}`, queue_job_id: `eq.${item.queue_job_id}` }
          : {
            ...(item.asset_id ? { asset_id: `eq.${normalizedAssetId}` } : { asset_id: "is.null" }),
            ...(queueJob && !item.queue_job_id ? { queue_job_id: "is.null" } : {})
          })
      },
      requireMatch: true,
      env: deps.env,
      fetchImpl: deps.fetchImpl
    });
    if (!saved?.saved) {
      const winner = await readItem({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id, itemId: item_id }, deps);
      const sameWinner = winner.asset_id === normalizedAssetId
        && (!queueJob || winner.queue_job_id === queueJob.id)
        && (
          options.requireQueueSuccessorAuthorization !== true
          || winner.pending_queue_job_id === normalizedReservedJobId
          || winner.queue_job_id === normalizedReservedJobId
        );
      if (!sameWinner) {
        throw new WriterIntakeStoreError("writer_intake_admission_conflict", { statusCode: 409, retryable: false });
      }
    }
  }

  // The atomic queue owner can only persist this job after the canonical
  // image set has reached FINALIZED. Project the independent durability clock
  // after that success; projection failure is observable but cannot undo or
  // counterfeit the canonical asset/job admission above.
  if (queueJob) {
    await projectWriterIntakeCanonicalEvent({
      event: writerIntakeProjectionEvents.ASSET_FINALIZED,
      tenantId: tenant_id,
      operatorId: operator_id,
      assetId: normalizedAssetId,
      queueJobId: queueJob.id,
      recognitionSessionId: queueJob.recognition_session_id
    }, options);
    // Close the only remaining ordering race: the final job may have reached
    // L2_READY before this operational link was written. Re-read after the
    // link exists; if it completed earlier, catch up now. If it completes
    // later, the normal job-terminal projection will find the link.
    const refreshedQueueJob = await verifiedQueueAdmission({
      tenantId: tenant_id,
      operatorId: operator_id,
      batchId: batch_id,
      itemId: item_id,
      batchCommittedAt: batch.committed_at,
      assetId: normalizedAssetId,
      queueJobId: queueJob.id
    }, deps);
    if (refreshedQueueJob?.status === "L2_READY") {
      await projectWriterIntakeCanonicalEvent({
        event: writerIntakeProjectionEvents.L2_READY,
        tenantId: tenant_id,
        operatorId: operator_id,
        assetId: normalizedAssetId,
        queueJobId: refreshedQueueJob.id,
        recognitionSessionId: refreshedQueueJob.recognition_session_id
      }, options);
    }
  }

  const current = await readItem({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id, itemId: item_id }, deps);
  return publicMutationResult(batch_id, current);
}

async function repairWriterIntakeBatchFromCanonicalJobs({ tenantId, operatorId, batchId }, deps) {
  const canonical = await deps.readRows({
    table: "v4_recognition_jobs",
    select: "id,created_at",
    search: {
      tenant_id: `eq.${tenantId}`,
      operator_id: `eq.${operatorId}`,
      job_type: "eq.FINAL_ASSISTED_TITLE",
      "queue_tags->>writer_intake_batch_id": `eq.${batchId}`,
      order: "created_at.asc",
      limit: "2000"
    },
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (!canonical?.ok) {
    throw new WriterIntakeStoreError("writer_intake_batch_canonical_repair_read_failed");
  }
  const jobIds = [...new Set((canonical.rows || []).map((job) => String(job?.id || "").trim()).filter(Boolean))];
  if (!jobIds.length) return { ok: true, considered: 0, linked: 0, patched: 0, l2_repaired: 0 };
  return reconcileWriterIntakeCanonicalJobRows({ jobIds, strictBatchId: batchId }, deps);
}

export async function abandonWriterIntakeBatch({
  tenantId,
  operatorId,
  batchId
} = {}, options = {}) {
  const deps = dependencies(options);
  const tenant_id = normalizeWriterIntakeTenantId(tenantId);
  const operator_id = normalizeWriterIntakeOperatorId(operatorId);
  const batch_id = normalizeWriterIntakeBatchId(batchId);
  await readBatch({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id }, deps);
  // Canonical queue truth wins even if its reconstructible intake projection was
  // lost. Repair every tagged job before cancelling only still-unadmitted rows.
  await repairWriterIntakeBatchFromCanonicalJobs({
    tenantId: tenant_id,
    operatorId: operator_id,
    batchId: batch_id
  }, deps);
  const abandoned = await deps.abandonBatchAtomic({
    p_tenant_id: tenant_id,
    p_operator_id: operator_id,
    p_batch_id: batch_id
  });
  const transaction = abandoned?.rows?.[0] || {};
  if (!abandoned?.ok || transaction.saved !== true || transaction.batch_id !== batch_id) {
    throw new WriterIntakeStoreError("writer_intake_abandon_failed");
  }
  return getWriterIntakeStatus({
    tenantId: tenant_id,
    operatorId: operator_id,
    batchId: batch_id
  }, deps);
}

export async function getWriterIntakeStatus({
  tenantId,
  operatorId,
  batchId = "",
  idempotencyKey = ""
} = {}, options = {}) {
  const deps = dependencies(options);
  const tenant_id = normalizeWriterIntakeTenantId(tenantId);
  const operator_id = normalizeWriterIntakeOperatorId(operatorId);
  const batch_id = String(batchId || "").trim()
    ? normalizeWriterIntakeBatchId(batchId)
    : writerIntakeBatchIdentity({
      tenantId: tenant_id,
      operatorId: operator_id,
      idempotencyKey
    }).batch_id;
  const batch = await readBatch({ tenantId: tenant_id, operatorId: operator_id, batchId: batch_id }, deps);
  await repairWriterIntakeBatchFromCanonicalJobs({
    tenantId: tenant_id,
    operatorId: operator_id,
    batchId: batch_id
  }, deps);
  const result = await deps.readRows({
    table: itemTable,
    select: "id,batch_id,item_position,status,durability_status,asset_id,queue_job_id,recognition_session_id,appended_at,asset_admitted_at,queue_admitted_at,writer_ready_at,writer_completed_at,asset_durable_at,last_error_code",
    search: {
      ...searchScope(tenant_id, operator_id),
      batch_id: `eq.${batch_id}`,
      order: "item_position.asc",
      limit: String(batch.expected_item_count)
    },
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (!result?.ok) throw new WriterIntakeStoreError("writer_intake_items_read_failed");
  const items = result.rows.map(publicItem);
  const counts = Object.fromEntries(items.map((item) => item.status).filter(Boolean).map((status) => [status, 0]));
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  const settledCount = items.filter((item) => item.settled === true).length;
  const actionRequiredCount = items.filter((item) => item.action_required === true).length;
  const terminalCount = items.filter((item) => item.terminal === true).length;
  const expectedItemCount = Number(batch.expected_item_count);
  return Object.freeze({
    contract_version: writerIntakeContractVersion,
    batch_id,
    batch_status: batch.status,
    expected_item_count: expectedItemCount,
    item_count: items.length,
    admitted_item_count: items.filter((item) => Boolean(item.asset_id)).length,
    queue_admitted_item_count: items.filter((item) => Boolean(item.queue_job_id)).length,
    writer_ready_item_count: items.filter((item) => Boolean(item.writer_ready_at)).length,
    durable_item_count: items.filter((item) => item.durability_status === "DURABLE").length,
    settled_item_count: settledCount,
    action_required_item_count: actionRequiredCount,
    terminal_item_count: terminalCount,
    outstanding_item_count: Math.max(0, expectedItemCount - terminalCount),
    intake_complete: items.length === expectedItemCount,
    batch_settled: items.length === expectedItemCount && settledCount === expectedItemCount,
    batch_terminal: items.length === expectedItemCount && terminalCount === expectedItemCount,
    counts_by_status: Object.freeze(counts),
    committed_at: batch.committed_at,
    intake_closed_at: batch.intake_closed_at || null,
    updated_at: batch.updated_at,
    items: Object.freeze(items),
    truth_boundary: Object.freeze({
      training_eligible: false,
      catalog_promotion_eligible: false,
      identity_truth: false
    })
  });
}

function canonicalJobFailureCode(job = {}) {
  const error = job?.error && typeof job.error === "object" && !Array.isArray(job.error)
    ? job.error
    : {};
  return String(error.code || error.error_code || error.type || job.error_type || "")
    .trim()
    .slice(0, 160) || null;
}

function desiredProjectionForCanonicalJob(job = {}, item = {}) {
  const jobStatus = String(job?.status || "").trim().toUpperCase();
  if (jobStatus === "RETRYING") {
    return { status: "FAILED_RETRYABLE", last_error_code: canonicalJobFailureCode(job) };
  }
  if (jobStatus === "FAILED") {
    return { status: "FAILED_TERMINAL", last_error_code: canonicalJobFailureCode(job) };
  }
  if (jobStatus === "CANCELLED") {
    return { status: "CANCELLED", last_error_code: canonicalJobFailureCode(job) };
  }
  if (["QUEUED", "RUNNING"].includes(jobStatus) && item.status === "FAILED_RETRYABLE") {
    return { status: "QUEUE_ADMITTED", last_error_code: null };
  }
  return null;
}

function writerIntakeTags(job = {}) {
  const tags = job?.queue_tags && typeof job.queue_tags === "object" && !Array.isArray(job.queue_tags)
    ? job.queue_tags
    : {};
  const batchId = String(tags.writer_intake_batch_id || "").trim();
  const itemId = String(tags.writer_intake_item_id || "").trim();
  if (!batchId || !itemId) return null;
  try {
    return {
      batch_id: normalizeWriterIntakeBatchId(batchId),
      item_id: normalizeWriterIntakeItemId(itemId),
      previous_queue_job_id: String(tags.writer_intake_previous_queue_job_id || "").trim() || null
    };
  } catch {
    return null;
  }
}

export function isWriterIntakeCanonicalJob(job = {}) {
  return writerIntakeTags(job) !== null;
}

// Repair-only materialized projection. Callers provide opaque job IDs only;
// status, ownership, queue tags and clocks are always re-read from the
// canonical queue owner before any intake row changes.
export async function reconcileWriterIntakeCanonicalJobRows({
  jobIds = [],
  jobs = [],
  strictBatchId = ""
} = {}, options = {}) {
  const deps = dependencies(options);
  const strict_batch_id = String(strictBatchId || "").trim()
    ? normalizeWriterIntakeBatchId(strictBatchId)
    : "";
  const requestedJobIds = [...new Set([
    ...(Array.isArray(jobIds) ? jobIds : []),
    ...(Array.isArray(jobs) ? jobs.map((job) => job?.id) : [])
  ].map((id) => String(id || "").trim()).filter((id) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(id)))];
  if (!requestedJobIds.length) return { ok: true, considered: 0, linked: 0, patched: 0, l2_repaired: 0 };
  const quotedRequestedIds = requestedJobIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",");
  const canonicalRead = await deps.readRows({
    table: "v4_recognition_jobs",
    select: "id,tenant_id,operator_id,asset_id,recognition_session_id,job_type,status,queue_tags,error,created_at,completed_at",
    search: {
      id: `in.(${quotedRequestedIds})`,
      order: "created_at.asc",
      limit: String(requestedJobIds.length)
    },
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (!canonicalRead?.ok) throw new WriterIntakeStoreError("writer_intake_canonical_jobs_read_failed");
  const canonicalJobs = (canonicalRead.rows || []).filter((job) => (
    job?.id
    && job?.tenant_id
    && job?.operator_id
    && job?.asset_id
    && job?.recognition_session_id
    && job?.job_type === "FINAL_ASSISTED_TITLE"
  ));
  if (!canonicalJobs.length) return { ok: true, considered: 0, linked: 0, patched: 0, l2_repaired: 0 };

  const tenantIds = [...new Set(canonicalJobs.map((job) => normalizeWriterIntakeTenantId(job.tenant_id)))];
  if (tenantIds.length !== 1) {
    throw new WriterIntakeStoreError("writer_intake_reconciliation_tenant_mixed", {
      statusCode: 400,
      retryable: false
    });
  }
  const canonicalJobIds = [...new Set(canonicalJobs.map((job) => String(job.id)))];
  const quotedIds = canonicalJobIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",");
  const read = await deps.readRows({
    table: itemTable,
    select: "id,tenant_id,operator_id,batch_id,asset_id,queue_job_id,recognition_session_id,status,durability_status,asset_durable_at,writer_ready_at,writer_completed_at,last_error_code,updated_at",
    search: {
      tenant_id: `eq.${tenantIds[0]}`,
      queue_job_id: `in.(${quotedIds})`,
      limit: String(Math.min(2000, canonicalJobIds.length + 1))
    },
    count: "exact",
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (!read?.ok) throw new WriterIntakeStoreError("writer_intake_reconciliation_read_failed");
  const itemRows = read.rows || [];
  const itemCountsByJobId = new Map();
  for (const item of itemRows) {
    const jobId = String(item?.queue_job_id || "");
    itemCountsByJobId.set(jobId, (itemCountsByJobId.get(jobId) || 0) + 1);
  }
  if (
    (Number.isInteger(read.count) && read.count > canonicalJobIds.length)
    || [...itemCountsByJobId.values()].some((count) => count !== 1)
  ) {
    throw new WriterIntakeStoreError("writer_intake_reconciliation_ambiguous_queue_link", {
      statusCode: 409,
      retryable: false
    });
  }
  const itemByJobId = new Map(itemRows.map((item) => [String(item.queue_job_id || ""), item]));
  let linked = 0;
  let patched = 0;
  let l2Repaired = 0;

  for (const job of canonicalJobs) {
    const tags = writerIntakeTags(job);
    if (strict_batch_id && (!tags || tags.batch_id !== strict_batch_id)) {
      throw new WriterIntakeStoreError("writer_intake_reconciliation_reference_mismatch", {
        statusCode: 409,
        retryable: false
      });
    }
    let item = itemByJobId.get(String(job.id)) || null;
    if (item && (
      !tags
      || tags.batch_id !== item.batch_id
      || tags.item_id !== item.id
      || item.tenant_id !== job.tenant_id
      || item.operator_id !== job.operator_id
      || item.asset_id !== job.asset_id
      || item.recognition_session_id !== job.recognition_session_id
    )) {
      throw new WriterIntakeStoreError("writer_intake_reconciliation_reference_mismatch", {
        statusCode: 409,
        retryable: false
      });
    }
    if (!item) {
      if (tags) {
        try {
          const admission = await admitWriterIntakeItem({
            tenantId: job.tenant_id,
            operatorId: job.operator_id,
            batchId: tags.batch_id,
            itemId: tags.item_id,
            assetId: job.asset_id,
            queueJobId: job.id,
            previousQueueJobId: tags.previous_queue_job_id
          }, options);
          item = admission.item || null;
          if (item) linked += 1;
        } catch (error) {
          deps.logger?.warn?.(JSON.stringify({
            event: "writer_intake_canonical_reconciliation",
            outcome: "LINK_FAILED",
            job_id: job.id,
            code: String(error?.code || error?.message || "writer_intake_link_failed").slice(0, 160)
          }));
          if (strict_batch_id) throw error;
          continue;
        }
      }
    }
    if (!item) continue;

    if (String(job.status || "").toUpperCase() === "L2_READY"
        && (!validIso(item.writer_ready_at) || !validIso(item.writer_completed_at))) {
      const repaired = await projectWriterIntakeCanonicalEvent({
        event: writerIntakeProjectionEvents.L2_READY,
        tenantId: job.tenant_id,
        operatorId: job.operator_id,
        assetId: job.asset_id,
        queueJobId: job.id,
        recognitionSessionId: job.recognition_session_id
      }, options);
      if (repaired.ok) l2Repaired += 1;
      continue;
    }

    if (["WRITER_COMPLETED", "FAILED_TERMINAL", "CANCELLED"].includes(String(item.status || ""))) continue;
    const desired = desiredProjectionForCanonicalJob(job, item);
    if (!desired || (
      desired.status === item.status
      && (desired.last_error_code || null) === (item.last_error_code || null)
    )) continue;
    const saved = await deps.patchRow({
      table: itemTable,
      id: item.id,
      patch: { ...desired, updated_at: isoNow(deps.now) },
      match: {
        tenant_id: `eq.${job.tenant_id}`,
        operator_id: `eq.${job.operator_id}`,
        queue_job_id: `eq.${job.id}`,
        recognition_session_id: `eq.${job.recognition_session_id}`,
        status: `eq.${item.status}`
      },
      requireMatch: true,
      env: deps.env,
      fetchImpl: deps.fetchImpl
    });
    if (saved?.saved) patched += 1;
  }

  return {
    ok: true,
    considered: canonicalJobs.length,
    linked,
    patched,
    l2_repaired: l2Repaired
  };
}

// Queue/session truth must remain available even when this repair-only intake
// projection is temporarily unavailable. Background callers use this wrapper
// so a transport/schema error is observable without becoming an unhandled
// rejection on an otherwise successful writer request.
export async function reconcileWriterIntakeCanonicalJobRowsBestEffort(input = {}, options = {}) {
  try {
    return await reconcileWriterIntakeCanonicalJobRows(input, options);
  } catch (error) {
    const logger = options.logger || console;
    const code = String(error?.code || error?.message || "writer_intake_reconciliation_failed").slice(0, 160);
    logger.warn?.("[writer_intake_canonical_reconciliation_failed]", JSON.stringify({
      code,
      retryable: error?.retryable === true,
      job_count: Array.isArray(input?.jobIds) ? input.jobIds.length : 0
    }));
    return {
      ok: false,
      error: "writer_intake_reconciliation_failed",
      code,
      retryable: error?.retryable === true
    };
  }
}
