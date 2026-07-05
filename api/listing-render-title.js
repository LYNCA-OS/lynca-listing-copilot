import crypto from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { applyWriterModuleEdit } from "../lib/listing/writer/module-edit.mjs";
import { renderListingPresentation } from "../lib/listing/renderer/listing-renderer.mjs";

const cookieName = "lynca_metaverse_session";
const defaultMaxTitleLength = 80;

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return ["", ""];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key, value]) => key && value)
  );
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function isValidSession(cookie, secret) {
  if (!cookie || !secret) return false;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || signature !== sign(payload, secret)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function maxLengthFromPayload(payload = {}) {
  const numeric = Number(payload.maxTitleLength || payload.max_title_length || defaultMaxTitleLength);
  if (!Number.isFinite(numeric)) return defaultMaxTitleLength;
  return Math.max(40, Math.min(140, Math.round(numeric)));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const authenticated = isValidSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET);

  if (!authenticated) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_render_title",
    limit: 120,
    windowMs: 60_000,
    message: "Too many title render requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  try {
    const maxLength = maxLengthFromPayload(payload);
    const result = payload.module_edit
      ? applyWriterModuleEdit({
        resolved: payload.resolved || {},
        evidence: payload.evidence || {},
        moduleKey: payload.module_edit.module_key || payload.module_edit.moduleKey,
        moduleText: payload.module_edit.module_text ?? payload.module_edit.moduleText,
        maxLength
      })
      : {
        corrected_resolved: payload.resolved || {},
        corrected_evidence: payload.evidence || {},
        field_changes: [],
        ...renderListingPresentation({
          resolved: payload.resolved || {},
          evidence: payload.evidence || {},
          maxLength
        })
      };

    sendJson(res, 200, {
      ok: true,
      title_override: payload.title_override || null,
      ...result
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: error.message || "Unable to render title."
    });
  }
}
