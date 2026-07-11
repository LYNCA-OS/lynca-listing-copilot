import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import { createWriterBatchExport } from "../../lib/listing/v4/export/writer-batch-export.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { readV4Rows } from "../../lib/listing/v4/session/supabase-rest.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 280);
}

async function writerExportSchemaReadiness(env = process.env) {
  const [batches, items] = await Promise.all([
    readV4Rows({ table: "v4_writer_export_batches", select: "id", search: { limit: "1" }, env }),
    readV4Rows({ table: "v4_writer_export_items", select: "id", search: { limit: "1" }, env })
  ]);
  return {
    ready: batches.ok && items.ok,
    error: batches.error || items.error || null
  };
}

async function writerExportRowsBelongToOperator(rows, operatorId, env = process.env) {
  const sessionIds = [...new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.recognition_session_id || row?.session_id || row?.recognitionSessionId || "").trim())
    .filter(Boolean))];
  if (!sessionIds.length) return { allowed: true, checked_session_count: 0, error: null };
  const sessions = await readV4Rows({
    table: "v4_recognition_sessions",
    select: "id,operator_id",
    search: {
      id: `in.(${sessionIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`,
      limit: String(sessionIds.length)
    },
    env
  });
  if (!sessions.ok) return { allowed: false, unavailable: true, checked_session_count: 0, error: sessions.error };
  const owned = new Set(sessions.rows
    .filter((row) => String(row.operator_id || "") === operatorId)
    .map((row) => String(row.id)));
  return {
    allowed: sessionIds.every((id) => owned.has(id)),
    unavailable: false,
    checked_session_count: sessionIds.length,
    error: null
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  const authenticatedSession = getSessionFromRequest(req);
  if (!authenticatedSession) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
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
    const schema = await writerExportSchemaReadiness(process.env);
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
    const operatorId = operatorIdFromRequest(req);
    const ownership = await writerExportRowsBelongToOperator(rows, operatorId, process.env);
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
      exportedBy: operatorId,
      env: process.env
    });
    sendJson(res, 200, withV4Version(result));
  } catch (error) {
    const message = safeError(error);
    const clientError = /missing|invalid|limited|no completed/i.test(message);
    sendJson(res, clientError ? 400 : 503, withV4Version({
      ok: false,
      retryable: !clientError,
      message,
      error_type: "WRITER_EXPORT_FAILED"
    }));
  }
}
