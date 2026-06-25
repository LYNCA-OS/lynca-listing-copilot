import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { visionProviderIds } from "../lib/listing/providers/provider-contract.mjs";
import { providerCatalog } from "../lib/listing/providers/provider-registry.mjs";
import { publicStorageReadiness } from "../lib/listing/storage/storage-config.mjs";

const cookieName = "lynca_metaverse_session";
const defaultGeminiSmokeReportPath = "data/smoke/gemini-smoke-latest.json";
const smokeCapabilityNames = new Set([
  "single_image_json",
  "front_back_multi_image_json",
  "tool_call",
  "error_response"
]);
const smokeStatuses = new Set(["passed", "passed_with_limitations", "failed", "skipped", "not_run", "unreadable"]);
const smokeCapabilityStatuses = new Set(["passed", "failed", "skipped"]);
const smokeDetailFields = new Set([
  "model_id",
  "parse_source",
  "finish_reason",
  "image_count",
  "provider_calls",
  "error_code",
  "status"
]);

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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function safeSmokeDetailValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const stringValue = String(value);
  if (/sk-[A-Za-z0-9_-]+/.test(stringValue)) return null;
  if (/AIza[0-9A-Za-z_-]+/.test(stringValue)) return null;
  if (/Bearer\s+/i.test(stringValue)) return null;
  if (/https?:\/\//i.test(stringValue)) return null;
  if (stringValue.length > 160) return stringValue.slice(0, 160);
  return stringValue;
}

function sanitizeSmokeCapability(capability = {}) {
  const name = String(capability.name || "");
  if (!smokeCapabilityNames.has(name)) return null;
  const status = String(capability.status || "");
  if (!smokeCapabilityStatuses.has(status)) return null;
  const details = Object.fromEntries(
    Object.entries(capability.details || {})
      .filter(([key]) => smokeDetailFields.has(key))
      .map(([key, value]) => [key, safeSmokeDetailValue(value)])
      .filter(([, value]) => value !== null)
  );

  return {
    name,
    status,
    required: capability.required === true,
    ...(Object.keys(details).length ? { details } : {})
  };
}

function smokeCapabilityPassed(report, name) {
  return report.capabilities.some((capability) => capability.name === name && capability.status === "passed");
}

function emptySmokeStatus(status, reason) {
  return {
    status,
    generated_at: null,
    json_baseline_verified: false,
    multi_image_verified: false,
    tool_call_verified: false,
    error_response_verified: false,
    capabilities: [],
    reason
  };
}

async function readProviderSmokeStatus(providerId, env = process.env) {
  const reportPath = providerId === visionProviderIds.GEMINI
    ? env.GEMINI_SMOKE_REPORT_PATH || defaultGeminiSmokeReportPath
    : "";
  if (!reportPath) return emptySmokeStatus("not_run", "smoke_report_not_configured");

  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolve(reportPath), "utf8"));
  } catch {
    return emptySmokeStatus("not_run", "smoke_report_missing_or_unreadable");
  }

  const status = String(parsed.status || "unreadable");
  if (parsed.provider !== providerId || !smokeStatuses.has(status) || !Array.isArray(parsed.capabilities)) {
    return emptySmokeStatus("unreadable", "smoke_report_invalid");
  }

  const capabilities = parsed.capabilities
    .map(sanitizeSmokeCapability)
    .filter(Boolean);
  const report = { ...parsed, capabilities };

  return {
    status,
    generated_at: typeof parsed.generated_at === "string" ? parsed.generated_at : null,
    json_baseline_verified: smokeCapabilityPassed(report, "single_image_json"),
    multi_image_verified: smokeCapabilityPassed(report, "front_back_multi_image_json"),
    tool_call_verified: smokeCapabilityPassed(report, "tool_call"),
    error_response_verified: smokeCapabilityPassed(report, "error_response"),
    capabilities
  };
}

function providerDisabledReason(provider, storage) {
  if (!provider.enabled) return "disabled_by_env";
  if (provider.disabled_reason === "emergency_retry_disabled") return "emergency_retry_disabled";
  if (!provider.configured) return provider.disabled_reason || "provider_not_configured";
  return null;
}

function providerStatus(provider, storage, smoke = null) {
  const disabledReason = providerDisabledReason(provider, storage);

  return {
    id: provider.id,
    role: provider.role,
    roles: Array.isArray(provider.roles) ? provider.roles : [provider.role].filter(Boolean),
    label: provider.label,
    display_name: provider.display_name,
    model_id: provider.model_id,
    primary_provider_id: provider.primary_provider_id || null,
    secondary_provider_id: provider.secondary_provider_id || null,
    secondary_role: provider.secondary_role || null,
    secondary_configured: provider.secondary_configured ?? null,
    secondary_disabled_reason: provider.secondary_disabled_reason || null,
    recommended_concurrency: provider.recommended_concurrency || null,
    enabled: provider.enabled,
    configured: provider.configured,
    selectable: !disabledReason,
    disabled_reason: disabledReason,
    requires_explicit_retry: Boolean(provider.requires_explicit_retry),
    requires_remote_image_url: Boolean(provider.requires_remote_image_url),
    requires_storage: false,
    ...(provider.id === visionProviderIds.GEMINI ? { smoke } : {})
  };
}

function defaultProviderId(providers) {
  const gemini = providers.find((provider) => provider.id === visionProviderIds.GEMINI);
  if (gemini?.selectable) return gemini.id;

  return "";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
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
    scope: "listing_provider_status",
    limit: 180,
    windowMs: 60_000,
    message: "Too many provider status requests. Please try again shortly."
  })) return;

  const storage = publicStorageReadiness();
  const geminiSmoke = await readProviderSmokeStatus(visionProviderIds.GEMINI);
  const catalog = providerCatalog();
  const providers = [
    catalog[visionProviderIds.GEMINI],
    catalog[visionProviderIds.OPENAI_LEGACY]
  ]
    .filter(Boolean)
    .filter((provider) => provider.visible !== false)
    .map((provider) => providerStatus(
      provider,
      storage,
      provider.id === visionProviderIds.GEMINI ? geminiSmoke : null
    ));

  sendJson(res, 200, {
    ok: true,
    default_provider: defaultProviderId(providers),
    fallback_available: !process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY,
    storage,
    providers
  });
}
