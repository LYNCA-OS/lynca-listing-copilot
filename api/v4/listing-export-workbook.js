import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import { createWriterBatchExport } from "../../lib/listing/v4/export/writer-batch-export.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";

const migrationPath = join(process.cwd(), "supabase/migrations/20260707130906_v4_writer_export_batches.sql");
let schemaReadyPromise = null;

function safeError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 280);
}

function dbUrl(env = process.env) {
  return String(env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || "").trim();
}

function connectionStringForPg(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("ssl");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function ensureWriterExportSchema(env = process.env) {
  if (schemaReadyPromise) return schemaReadyPromise;
  schemaReadyPromise = (async () => {
    const connectionString = dbUrl(env);
    if (!connectionString) return { applied: false, skipped: true, reason: "postgres_url_not_configured" };
    const client = new pg.Client({
      connectionString: connectionStringForPg(connectionString),
      ssl: { rejectUnauthorized: false }
    });
    try {
      const sql = await readFile(migrationPath, "utf8");
      await client.connect();
      await client.query(sql);
      return { applied: true, skipped: false, reason: null };
    } finally {
      await client.end().catch(() => {});
    }
  })();
  return schemaReadyPromise;
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
    await ensureWriterExportSchema(process.env);
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
