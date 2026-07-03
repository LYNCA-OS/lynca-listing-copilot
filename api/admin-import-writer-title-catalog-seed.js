import { resolve } from "node:path";
import { applyCatalogSeed, buildWriterTitleCatalogSeed } from "../scripts/import-writer-title-catalog-seed.mjs";
import { cookieName, parseCookies, readSignedSession } from "../lib/listing-session.mjs";

export const config = {
  maxDuration: 300,
  includeFiles: [
    "data/catalog/writer-title-seed/writer-ebay-upload-20260703.xlsx"
  ]
};

const defaultInputPath = "data/catalog/writer-title-seed/writer-ebay-upload-20260703.xlsx";
const defaultLimit = 500;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boundedInteger(value, { min = 0, max = 100_000, fallback = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function internalBearerToken(req) {
  const header = cleanText(req.headers?.authorization || req.headers?.Authorization);
  return header.replace(/^Bearer\s+/i, "").trim();
}

function isInternalTokenAuthorized(req, env = process.env) {
  const expected = cleanText(env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const token = internalBearerToken(req);
  return Boolean(expected && token && token === expected);
}

function isSessionAuthorized(req, env = process.env) {
  const cookies = parseCookies(req.headers.cookie);
  return Boolean(readSignedSession(cookies[cookieName], env.METAVERSE_AUTH_SECRET));
}

function importAuth(req, env = process.env) {
  if (isInternalTokenAuthorized(req, env)) return { ok: true, mode: "internal_token" };
  if (isSessionAuthorized(req, env)) return { ok: true, mode: "session" };
  return { ok: false };
}

function publicReport(report = {}, { offset = 0, limit = 0, selectedRows = [] } = {}) {
  return {
    schema_version: report.schema_version,
    batch_id: report.batch_id,
    generated_at: report.generated_at,
    row_counts: report.row_counts,
    selected_chunk: {
      offset,
      limit,
      count: selectedRows.length,
      next_offset: offset + selectedRows.length,
      done: offset + selectedRows.length >= Number(report.row_counts?.unique_catalog_seed_rows || 0)
    },
    category_breakdown: report.category_breakdown,
    top_products: report.top_products,
    field_coverage: report.field_coverage,
    policy: report.policy,
    sample_rows: selectedRows.slice(0, 5).map((row) => ({
      source_row_key: row.staging?.source_row_key || null,
      title: row.staging?.canonical_title || "",
      identity_fields: row.staging?.identity_fields || {},
      review_required_fields: row.staging?.review_required_fields || []
    }))
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const auth = importAuth(req);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_json_body" });
    return;
  }

  const offset = boundedInteger(body.offset, { min: 0, max: 100_000, fallback: 0 });
  const limit = boundedInteger(body.limit, { min: 1, max: 1000, fallback: defaultLimit });
  const batchSize = boundedInteger(body.batch_size, { min: 1, max: 500, fallback: 250 });
  const apply = body.apply !== false;
  const inputPath = resolve(cleanText(body.input_path) || defaultInputPath);
  const batchId = cleanText(body.batch_id || "writer_ebay_upload_20260703");

  try {
    const built = await buildWriterTitleCatalogSeed({ inputPath, batchId });
    const selectedRows = built.stagedRows.slice(offset, offset + limit);
    const report = publicReport(built.report, { offset, limit, selectedRows });

    if (!apply) {
      sendJson(res, 200, {
        ok: true,
        mode: "dry_run",
        auth_mode: auth.mode,
        ...report,
        apply: { skipped: true, reason: "dry_run_apply_false" }
      });
      return;
    }

    const applyReport = await applyCatalogSeed({
      env: process.env,
      stagedRows: selectedRows,
      batchSize
    });

    sendJson(res, 200, {
      ok: true,
      mode: "applied_chunk",
      auth_mode: auth.mode,
      ...report,
      apply: applyReport
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: "writer_title_catalog_import_failed",
      message: cleanText(error?.message || error).slice(0, 500)
    });
  }
}
