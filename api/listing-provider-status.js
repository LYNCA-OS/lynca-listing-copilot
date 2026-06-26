import crypto from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { visionProviderIds } from "../lib/listing/providers/provider-contract.mjs";
import { providerCatalog } from "../lib/listing/providers/provider-registry.mjs";
import { publicStorageReadiness } from "../lib/listing/storage/storage-config.mjs";

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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function providerDisabledReason(provider, storage) {
  if (!provider.enabled) return "disabled_by_env";
  if (provider.disabled_reason === "emergency_retry_disabled") return "emergency_retry_disabled";
  if (!provider.configured) return provider.disabled_reason || "provider_not_configured";
  return null;
}

function providerStatus(provider, storage) {
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
    requires_storage: false
  };
}

function defaultProviderId(providers) {
  const openai = providers.find((provider) => provider.id === visionProviderIds.OPENAI_LEGACY);
  if (openai?.selectable) return openai.id;

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
  const catalog = providerCatalog();
  const providers = [
    catalog[visionProviderIds.OPENAI_LEGACY]
  ]
    .filter(Boolean)
    .filter((provider) => provider.visible !== false)
    .map((provider) => providerStatus(provider, storage));

  sendJson(res, 200, {
    ok: true,
    default_provider: defaultProviderId(providers),
    fallback_available: !process.env.OPENAI_API_KEY,
    storage,
    providers
  });
}
