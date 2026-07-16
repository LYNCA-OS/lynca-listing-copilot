import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest, persistProductionEvent } from "../../lib/observability/production-events.mjs";
import { createWriterBatchExport } from "../../lib/listing/v4/export/writer-batch-export.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { readV4Rows } from "../../lib/listing/v4/session/supabase-rest.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import {
  LEGACY_TENANT_ID,
  hasTenantPermission,
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 280);
}

export function writerExportFailureResponse(error) {
  const message = safeError(error);
  const explicitStatus = Number(error?.statusCode);
  if ([413, 504].includes(explicitStatus)) {
    return {
      status: explicitStatus,
      body: withV4Version({
        ok: false,
        retryable: error?.retryable === true,
        message,
        error_type: String(error?.code || "WRITER_EXPORT_FAILED")
      })
    };
  }
  const clientError = /missing|invalid|limited|no completed/i.test(message);
  return {
    status: clientError ? 400 : 503,
    body: withV4Version({
      ok: false,
      retryable: !clientError,
      message,
      error_type: "WRITER_EXPORT_FAILED"
    })
  };
}

async function writerExportSchemaReadiness(tenantId, env = process.env) {
  const [batches, items] = await Promise.all([
    readV4Rows({
      table: "v4_writer_export_batches",
      select: "id",
      search: { tenant_id: `eq.${tenantId}`, limit: "1" },
      env
    }),
    readV4Rows({
      table: "v4_writer_export_items",
      select: "id",
      search: { tenant_id: `eq.${tenantId}`, limit: "1" },
      env
    })
  ]);
  return {
    ready: batches.ok && items.ok,
    error: batches.error || items.error || null
  };
}

async function writerExportRowsBelongToOperator(rows, context, env = process.env) {
  const sessionIds = [...new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.recognition_session_id || row?.session_id || row?.recognitionSessionId || "").trim())
    .filter(Boolean))];
  if (!sessionIds.length) return { allowed: true, checked_session_count: 0, error: null };
  const tenantId = context.tenantId;
  const sessions = await readV4Rows({
    table: "v4_recognition_sessions",
    select: "id,tenant_id,operator_id,created_by_user_id,assigned_to_user_id",
    search: {
      tenant_id: `eq.${tenantId}`,
      id: `in.(${sessionIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`,
      limit: String(sessionIds.length)
    },
    env
  });
  if (!sessions.ok) return { allowed: false, unavailable: true, checked_session_count: 0, error: sessions.error };
  const canViewAll = hasTenantPermission(context, TENANT_PERMISSIONS.VIEW_ALL_WORK);
  const owned = new Set(sessions.rows
    .filter((row) => canViewAll
      || String(row.operator_id || "").trim() === context.userId
      || String(row.created_by_user_id || "").trim() === context.userId
      || String(row.assigned_to_user_id || "").trim() === context.userId)
    .map((row) => String(row.id)));
  return {
    allowed: sessionIds.every((id) => owned.has(id)),
    unavailable: false,
    checked_session_count: sessionIds.length,
    error: null
  };
}

function writerExportRowsUseTenantStorage(rows, tenantId) {
  const prefix = `tenants/${tenantId}/`;
  return (Array.isArray(rows) ? rows : []).every((row) => {
    return (Array.isArray(row?.images) ? row.images : []).every((image) => {
      const objectPath = String(image?.object_path || image?.objectPath || "").trim();
      if (!objectPath || objectPath.startsWith(prefix)) return true;
      // Existing legacy objects predate tenant prefixes. They remain readable
      // only inside tenant_legacy; a path already under `tenants/` can never be
      // borrowed from another customer.
      return tenantId === LEGACY_TENANT_ID && !objectPath.startsWith("tenants/");
    });
  });
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-export-workbook" });
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
    requirePermission(context, TENANT_PERMISSIONS.EXPORT_DATA);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_export_workbook",
    limit: 30,
    windowMs: 60_000,
    message: "Too many export requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch (error) {
    const status = requestPayloadErrorStatus(error);
    sendJson(res, status, withV4Version({
      ok: false,
      retryable: false,
      message: status === 413 ? "Export request is too large. Export fewer cards at a time." : "Invalid request.",
      error_type: status === 413 ? "WRITER_EXPORT_REQUEST_TOO_LARGE" : "WRITER_EXPORT_INVALID_REQUEST"
    }));
    return;
  }

  try {
    const schema = await writerExportSchemaReadiness(context.tenantId, process.env);
    if (!schema.ready) {
      sendJson(res, 503, withV4Version({
        ok: false,
        retryable: false,
        message: "Writer export storage schema is not ready. Run the deployment migration before exporting.",
        error_type: "WRITER_EXPORT_SCHEMA_UNAVAILABLE",
        details: schema.error
      }));
      return;
    }
    const rows = payload.rows || payload.items || [];
    if (!writerExportRowsUseTenantStorage(rows, context.tenantId)) {
      sendJson(res, 403, withV4Version({
        ok: false,
        retryable: false,
        message: "One or more export images are outside this tenant.",
        error_type: "WRITER_EXPORT_STORAGE_FORBIDDEN"
      }));
      return;
    }
    const ownership = await writerExportRowsBelongToOperator(rows, context, process.env);
    if (!ownership.allowed) {
      sendJson(res, ownership.unavailable ? 503 : 403, withV4Version({
        ok: false,
        retryable: ownership.unavailable === true,
        message: ownership.unavailable ? "Unable to verify export ownership." : "One or more export rows do not belong to this operator.",
        error_type: ownership.unavailable ? "WRITER_EXPORT_OWNERSHIP_UNAVAILABLE" : "WRITER_EXPORT_FORBIDDEN"
      }));
      return;
    }
    const result = await createWriterBatchExport({
      rows,
      tenantId: context.tenantId,
      exportedBy: context.userId,
      env: process.env
    });
    await persistProductionEvent({
      eventType: "export_generated",
      requestId: context.requestId,
      context,
      batchId: result.batch_id,
      success: true,
      metadata: { asset_count: result.asset_count, item_count: result.item_count }
    });
    sendJson(res, 200, withV4Version(result));
  } catch (error) {
    const failure = writerExportFailureResponse(error);
    sendJson(res, failure.status, failure.body);
  }
}
