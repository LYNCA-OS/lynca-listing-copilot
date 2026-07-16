import crypto from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import { publicTenantAuthError, requireTenantAccess } from "../lib/tenant/index.mjs";
import { PublishingApprovalError } from "../lib/listing/publishing/listing-draft.mjs";
import { PublishingProviderError } from "../lib/listing/publishing/publisher-contract.mjs";
import { publishListingDraft } from "../lib/listing/publishing/publish-listing-draft.mjs";
import { selectPublishAuditStore } from "../lib/listing/publishing/publish-audit-store.mjs";

const cookieName = "lynca_metaverse_session";

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

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-publish-draft" });
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  try {
    const context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), publicTenantAuthError(error));
    return;
  }

  // The legacy publisher has a global audit/idempotency store and cannot prove
  // tenant ownership. Keep the external side-effect closed until the dedicated
  // tenant-aware publishing contract is available.
  sendJson(res, 410, {
    ok: false,
    code: "tenant_aware_publishing_required",
    message: "Publishing is temporarily unavailable in the multi-tenant pilot."
  });
  return;

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_publish",
    limit: 60,
    windowMs: 60_000,
    message: "Too many publish requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  try {
    const auditStore = selectPublishAuditStore();
    const result = await publishListingDraft(
      payload.listing_draft || payload.listingDraft || payload,
      payload.destination_context || payload.destinationContext || {},
      {
        auditStore,
        idempotencyKey: payload.idempotency_key || payload.idempotencyKey || null
      }
    );

    sendJson(res, 200, {
      ok: true,
      audit_durable: auditStore.durable === true,
      ...result
    });
  } catch (error) {
    if (error instanceof PublishingApprovalError) {
      sendJson(res, 403, {
        ok: false,
        code: error.code,
        message: error.message,
        details: error.details
      });
      return;
    }

    if (error instanceof PublishingProviderError) {
      sendJson(res, 502, {
        ok: false,
        code: error.code,
        message: error.message,
        destination: error.destination || null,
        retryable: error.retryable === true
      });
      return;
    }

    sendJson(res, 500, {
      ok: false,
      code: "publish_api_error",
      message: error.message || "Publish failed."
    });
  }
}
