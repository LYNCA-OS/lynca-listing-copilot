import { createRequire } from "node:module";
import { indexVisualVectorDataset } from "../scripts/index-visual-vector-embeddings.mjs";
import { cookieName, parseCookies, readSignedSession } from "../lib/listing-session.mjs";
import { contractedConcurrency } from "../lib/listing/v4/orchestration/concurrency-contract.mjs";
import { platformAdminAuth } from "../lib/platform-admin-auth.mjs";

export const config = {
  maxDuration: 300,
  includeFiles: [
    "data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json"
  ]
};

const defaultDatasetPath = "data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json";
const require = createRequire(import.meta.url);
const defaultSeedDataset = require("../data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function adminAuth(req, env = process.env) {
  if (isInternalTokenAuthorized(req, env)) return { ok: true, mode: "internal_token" };
  if (isSessionAuthorized(req, env)) return { ok: true, mode: "session" };
  return { ok: false };
}

function publicIndexReport(report = {}, { authMode = "" } = {}) {
  const summary = report.summary || {};
  return {
    ok: report.ok === true,
    auth_mode: authMode,
    generated_at: report.generated_at || null,
    dataset_path: report.dataset_path || "",
    dry_run: report.dry_run === true,
    retrieval_status: report.retrieval_status || "",
    retrieval_enabled: report.retrieval_enabled === true,
    model_id: report.model_id || "",
    model_revision: report.model_revision || "",
    preprocessing_version: report.preprocessing_version || "",
    dimensions: report.dimensions || null,
    summary: {
      source_items: Number(summary.source_items || 0),
      image_backed_items: Number(summary.image_backed_items || 0),
      offset: Number(summary.offset || report.offset || 0),
      requested_items: Number(summary.requested_items || 0),
      indexed_items: Number(summary.indexed_items || 0),
      failed_items: Number(summary.failed_items || 0),
      embeddings_written: Number(summary.embeddings_written || 0),
      worker_cache_hit_count: Number(summary.worker_cache_hit_count || 0),
      worker_attempt_count: Number(summary.worker_attempt_count || 0),
      worker_latency_p50_ms: finiteNumberOrNull(summary.worker_latency_p50_ms),
      worker_latency_p95_ms: finiteNumberOrNull(summary.worker_latency_p95_ms),
      next_offset: Number(summary.offset || report.offset || 0) + Number(summary.requested_items || 0),
      done: Number(summary.offset || report.offset || 0) + Number(summary.requested_items || 0) >= Number(summary.image_backed_items || 0)
    },
    failed_items: Array.isArray(report.items)
      ? report.items.filter((item) => item?.ok === false).slice(0, 10).map((item) => ({
        index: item.index,
        identity_key: item.identity_key || "",
        error: cleanText(item.error || "").slice(0, 300)
      }))
      : []
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const auth = platformAdminAuth(req);
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
  const limit = boundedInteger(body.limit, { min: 1, max: 50, fallback: 10 });
  const requestedConcurrency = boundedInteger(body.concurrency, { min: 1, max: 4, fallback: 2 });
  const retrievalStatus = cleanText(body.retrieval_status || "approved");
  const retrievalEnabled = body.retrieval_enabled !== false;
  const dryRun = body.dry_run === true;
  const concurrency = dryRun && body.capacity_sweep === true
    ? requestedConcurrency
    : contractedConcurrency("vector_index", requestedConcurrency);

  if (!["approved", "reviewed", "registry", "candidate", "disabled"].includes(retrievalStatus)) {
    sendJson(res, 400, { ok: false, error: "invalid_retrieval_status" });
    return;
  }

  try {
    const report = await indexVisualVectorDataset({
      dataset: cleanText(body.dataset_path) ? null : defaultSeedDataset,
      datasetPath: cleanText(body.dataset_path) || defaultDatasetPath,
      outPath: "",
      offset,
      limit,
      concurrency,
      env: process.env,
      dryRun,
      retrievalStatus,
      retrievalEnabled,
      fetchImpl: globalThis.fetch
    });
    sendJson(res, 200, publicIndexReport(report, { authMode: auth.mode }));
  } catch (error) {
    const report = error?.report;
    if (report && typeof report === "object") {
      sendJson(res, 500, {
        ...publicIndexReport(report, { authMode: auth.mode }),
        ok: false,
        error: "visual_vector_index_failed",
        message: cleanText(error?.message || error).slice(0, 500)
      });
      return;
    }
    sendJson(res, 500, {
      ok: false,
      error: "visual_vector_index_failed",
      message: cleanText(error?.message || error).slice(0, 500)
    });
  }
}
