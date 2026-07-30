import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import {
  bindProductionRequestContext,
  instrumentProductionRequest
} from "../../lib/observability/production-events.mjs";
import {
  abandonWriterIntakeBatch,
  admitWriterIntakeItem,
  appendWriterIntakeItem,
  commitWriterIntakeBatch,
  getWriterIntakeStatus,
  settleWriterIntakeItem,
  WriterIntakeStoreError
} from "../../lib/listing/intake/writer-intake-store.mjs";
import { WriterIntakeContractError } from "../../lib/listing/intake/writer-intake-contract.mjs";
import {
  isTenantAuthError,
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";
import {
  readJsonPayload,
  requestPayloadErrorStatus,
  sendJson
} from "../../lib/listing/v4/session/http-handler-utils.mjs";

const maxBodyBytes = 32 * 1024;
export const writerIntakeRatePolicies = Object.freeze({
  GET_STATUS: Object.freeze({ scope: "writer_intake_get", limit: 1200, windowMs: 60_000 }),
  COMMIT_BATCH: Object.freeze({ scope: "writer_intake_commit_batch", limit: 12, windowMs: 60_000 }),
  COMMIT_BATCH_ROWS: Object.freeze({ scope: "writer_intake_commit_batch_rows", limit: 2000, windowMs: 60_000 }),
  APPEND_ITEM: Object.freeze({ scope: "writer_intake_append_item", limit: 1200, windowMs: 60_000 }),
  ADMIT_ITEM: Object.freeze({ scope: "writer_intake_admit_item", limit: 600, windowMs: 60_000 }),
  ABANDON_BATCH: Object.freeze({ scope: "writer_intake_abandon_batch", limit: 60, windowMs: 60_000 }),
  FAIL_ITEM: Object.freeze({ scope: "writer_intake_settle_item", limit: 1200, windowMs: 60_000 }),
  CANCEL_ITEM: Object.freeze({ scope: "writer_intake_settle_item", limit: 1200, windowMs: 60_000 }),
  INVALID_ACTION: Object.freeze({ scope: "writer_intake_invalid_action", limit: 120, windowMs: 60_000 })
});

async function defaultRequireAccess(req) {
  return requireTenantAccess(req);
}

function headerValue(req, name) {
  const headers = req?.headers;
  const lower = String(name || "").toLowerCase();
  const value = typeof headers?.get === "function"
    ? headers.get(lower)
    : headers?.[lower] ?? headers?.[name];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function queryValue(req, name) {
  return String(new URL(req?.url || "/", "https://local.test").searchParams.get(name) || "").trim();
}

function publicError(error, requestId) {
  if (isTenantAuthError(error)) return publicTenantAuthError(error);
  if (error instanceof WriterIntakeContractError || error instanceof WriterIntakeStoreError) {
    return {
      ok: false,
      request_id: requestId,
      code: error.code,
      retryable: error.retryable,
      message: error.code
    };
  }
  if (error instanceof SyntaxError || error?.code === "REQUEST_BODY_TOO_LARGE") {
    return {
      ok: false,
      request_id: requestId,
      code: "invalid_writer_intake_request",
      retryable: false,
      message: "invalid_writer_intake_request"
    };
  }
  return {
    ok: false,
    request_id: requestId,
    code: "writer_intake_unavailable",
    retryable: true,
    message: "writer_intake_unavailable"
  };
}

export function createWriterIntakeHandler(overrides = {}) {
  const deps = {
    requireAccess: overrides.requireAccess || defaultRequireAccess,
    requirePermission: overrides.requirePermission || requirePermission,
    rateLimit: overrides.rateLimit || enforceApiRateLimit,
    instrument: overrides.instrument || instrumentProductionRequest,
    bindContext: overrides.bindContext || bindProductionRequestContext,
    commitBatch: overrides.commitBatch || commitWriterIntakeBatch,
    appendItem: overrides.appendItem || appendWriterIntakeItem,
    admitItem: overrides.admitItem || admitWriterIntakeItem,
    abandonBatch: overrides.abandonBatch || abandonWriterIntakeBatch,
    settleItem: overrides.settleItem || settleWriterIntakeItem,
    getStatus: overrides.getStatus || getWriterIntakeStatus
  };

  return async function writerIntakeHandler(req, res) {
    deps.instrument(req, res, { api: "/api/v4/listing-intake" });
    if (!new Set(["GET", "POST"]).has(req.method)) {
      res.setHeader("allow", "GET, POST");
      sendJson(res, 405, { ok: false, message: "Method not allowed" });
      return;
    }

    let context;
    try {
      context = await deps.requireAccess(req);
      deps.bindContext(res, context);
    } catch (error) {
      sendJson(res, isTenantAuthError(error) ? error.statusCode : 503, publicError(error));
      return;
    }

    try {
      if (req.method === "GET") {
        if (!deps.rateLimit(req, res, {
          ...writerIntakeRatePolicies.GET_STATUS,
          message: "Too many intake status requests. Please try again shortly."
        })) return;
        deps.requirePermission(context, TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK, {
          assignedUserId: context.userId
        });
        const status = await deps.getStatus({
          tenantId: context.tenantId,
          operatorId: context.userId,
          batchId: queryValue(req, "batch_id"),
          idempotencyKey: queryValue(req, "idempotency_key")
        });
        sendJson(res, 200, { ok: true, request_id: context.requestId, ...status });
        return;
      }

      deps.requirePermission(context, TENANT_PERMISSIONS.CREATE_JOB);
      const payload = await readJsonPayload(req, { maxBytes: maxBodyBytes });
      const action = String(payload.action || "").trim().toUpperCase();
      const policy = writerIntakeRatePolicies[action] || writerIntakeRatePolicies.INVALID_ACTION;
      if (!deps.rateLimit(req, res, {
        ...policy,
        message: "Too many intake mutations. Please try again shortly."
      })) return;
      if (action === "COMMIT_BATCH" && !deps.rateLimit(req, res, {
        ...writerIntakeRatePolicies.COMMIT_BATCH_ROWS,
        cost: Number(payload.expected_item_count) || 1,
        message: "Intake batch row budget exceeded. Please try again shortly."
      })) return;
      let status;
      if (action === "COMMIT_BATCH") {
        status = await deps.commitBatch({
          tenantId: context.tenantId,
          operatorId: context.userId,
          idempotencyKey: payload.idempotency_key || payload.client_batch_token || headerValue(req, "x-idempotency-key"),
          expectedItemCount: payload.expected_item_count
        });
      } else if (action === "APPEND_ITEM") {
        status = await deps.appendItem({
          tenantId: context.tenantId,
          operatorId: context.userId,
          batchId: payload.batch_id,
          clientItemRef: payload.client_item_ref,
          itemPosition: payload.item_position
        });
      } else if (action === "ADMIT_ITEM") {
        status = await deps.admitItem({
          tenantId: context.tenantId,
          operatorId: context.userId,
          batchId: payload.batch_id,
          itemId: payload.item_id,
          assetId: payload.asset_id,
          queueJobId: payload.queue_job_id,
          previousQueueJobId: payload.previous_queue_job_id
        });
      } else if (action === "ABANDON_BATCH") {
        status = await deps.abandonBatch({
          tenantId: context.tenantId,
          operatorId: context.userId,
          batchId: payload.batch_id
        });
      } else if (action === "FAIL_ITEM" || action === "CANCEL_ITEM") {
        status = await deps.settleItem({
          tenantId: context.tenantId,
          operatorId: context.userId,
          batchId: payload.batch_id,
          itemId: payload.item_id,
          disposition: action === "FAIL_ITEM" ? "FAILED" : "CANCELLED"
        });
      } else {
        throw new WriterIntakeContractError("invalid_writer_intake_action");
      }
      sendJson(res, 200, { ok: true, request_id: context.requestId, ...status });
    } catch (error) {
      const statusCode = error instanceof SyntaxError
        ? 400
        : error?.code === "REQUEST_BODY_TOO_LARGE"
        ? requestPayloadErrorStatus(error)
        : Number(error?.statusCode || 503);
      sendJson(res, statusCode, publicError(error, context.requestId));
    }
  };
}

export default createWriterIntakeHandler();
