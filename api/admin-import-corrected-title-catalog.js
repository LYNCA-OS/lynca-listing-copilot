import { importCorrectedTitleCatalogV0 } from "../scripts/import-corrected-title-catalog-v0.mjs";
import { platformAdminAuth } from "../lib/platform-admin-auth.mjs";
import { cookieName, parseCookies, readSignedSession } from "../lib/listing-session.mjs";

export const config = {
  maxDuration: 300
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boundedInteger(value, { min = 0, max = 10_000, fallback = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
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

function adminAuth(req, env = process.env) {
  const expected = cleanText(env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const token = internalBearerToken(req);
  if (expected && token && token === expected) return { ok: true, mode: "internal_token" };

  const cookies = parseCookies(req.headers?.cookie);
  if (readSignedSession(cookies[cookieName], env.METAVERSE_AUTH_SECRET)) return { ok: true, mode: "session" };
  return { ok: false, mode: "" };
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

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_json_body" });
    return;
  }

  const limit = boundedInteger(body.limit, { min: 1, max: 2000, fallback: 1000 });
  const offset = boundedInteger(body.offset, { min: 0, max: 1_000_000, fallback: 0 });
  const apply = body.apply === true;
  const argv = ["--no-env-file", "--limit", String(limit), "--offset", String(offset)];
  if (!apply) argv.push("--dry-run");

  try {
    const report = await importCorrectedTitleCatalogV0({
      argv,
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    sendJson(res, 200, {
      ok: true,
      auth_mode: auth.mode,
      apply,
      report
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: "corrected_title_catalog_import_failed",
      message: cleanText(error?.message || error).slice(0, 500)
    });
  }
}
