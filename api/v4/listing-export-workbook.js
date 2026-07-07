import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import { createWriterBatchExport } from "../../lib/listing/v4/export/writer-batch-export.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 280);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!getSessionFromRequest(req)) {
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
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  try {
    const result = await createWriterBatchExport({
      rows: payload.rows || payload.items || [],
      exportedBy: payload.exported_by || operatorIdFromRequest(req),
      env: process.env
    });
    sendJson(res, 200, withV4Version(result));
  } catch (error) {
    sendJson(res, 400, withV4Version({
      ok: false,
      message: safeError(error),
      error_type: "WRITER_EXPORT_FAILED"
    }));
  }
}
