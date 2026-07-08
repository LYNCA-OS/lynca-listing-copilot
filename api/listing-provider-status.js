import crypto from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { visionProviderIds } from "../lib/listing/providers/provider-contract.mjs";
import { providerCatalog } from "../lib/listing/providers/provider-registry.mjs";
import { buildWorkflowReadinessAudit } from "../lib/listing/readiness/workflow-readiness-audit.mjs";
import { publicStorageReadiness } from "../lib/listing/storage/storage-config.mjs";

const cookieName = "lynca_metaverse_session";
const workflowReadinessCacheTtlMs = 60_000;
let workflowReadinessCache = {
  key: "",
  expiresAt: 0,
  report: null
};

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

function workflowReadinessCacheKey(env = process.env) {
  const relevantKeys = [
    "OPENAI_API_KEY",
    "OPENAI_LISTING_MODEL",
    "ENABLE_GPT41_PROVIDER",
    "ENABLE_GPT41_EMERGENCY_PROVIDER",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "LISTING_IMAGE_BUCKET",
    "LISTING_FEEDBACK_RETENTION_ENABLED",
    "ENABLE_LISTING_FEEDBACK_RETENTION",
    "ENABLE_VECTOR_RETRIEVAL",
    "VECTOR_RETRIEVAL_MODE",
    "VECTOR_WORKER_URL",
    "RECOGNITION_WORKER_URL",
    "VECTOR_WORKER_TOKEN",
    "RECOGNITION_WORKER_TOKEN",
    "ENABLE_PADDLE_OCR_FIELD_VERIFIER",
    "PADDLE_OCR_WORKER_URL",
    "PADDLE_OCR_WORKER_TOKEN",
    "DATA_LOOP_SIDECARS_ENABLED",
    "DATA_LOOP_PADDLE_OCR_DISPATCH_ENABLED",
    "DATA_LOOP_SPLINK_LOOKUP_ENABLED",
    "DATA_LOOP_SPLINK_BATCH_ENABLED",
    "DATA_LOOP_FIFTYONE_EXPORT_ENABLED",
    "DATA_LOOP_LIGHTGBM_SHADOW_ENABLED",
    "DATA_LOOP_LIGHTGBM_RERANKER_URL",
    "LIGHTGBM_RERANKER_URL",
    "DATA_LOOP_CLEANLAB_SCORE_URL",
    "CLEANLAB_SCORE_URL",
    "LABEL_STUDIO_URL",
    "LABEL_STUDIO_TOKEN",
    "CVAT_URL",
    "CVAT_TOKEN",
    "PHOENIX_COLLECTOR_ENDPOINT",
    "PHOENIX_ENDPOINT",
    "DATA_LOOP_PHOENIX_ENDPOINT",
    "EBAY_CLIENT_ID",
    "EBAY_CLIENT_SECRET",
    "EBAY_MARKETPLACE_ID",
    "EBAY_SELLER_USERNAME"
  ];
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(relevantKeys.map((key) => [key, env[key] || ""])))
    .digest("hex");
}

function publicWorkflowReadiness(report = {}) {
  return {
    schema_version: report.schema_version || "",
    checked_at: report.checked_at || "",
    ok: Boolean(report.ok),
    can_run_cloud_recognition: Boolean(report.can_run_cloud_recognition),
    low_friction_ready: Boolean(report.low_friction_ready),
    summary: report.summary || {},
    blockers: Array.isArray(report.blockers) ? report.blockers : [],
    fail_closed_components: Array.isArray(report.fail_closed_components) ? report.fail_closed_components : [],
    next_actions: Array.isArray(report.next_actions) ? report.next_actions.slice(0, 8) : [],
    components: Array.isArray(report.components)
      ? report.components.map((item) => ({
        id: item.id,
        status: item.status,
        required: Boolean(item.required),
        fail_closed: Boolean(item.fail_closed),
        ready: Boolean(item.ready),
        summary: item.summary,
        next_action: item.next_action || null
      }))
      : []
  };
}

async function loadWorkflowReadiness() {
  const now = Date.now();
  const key = workflowReadinessCacheKey(process.env);
  if (workflowReadinessCache.report && workflowReadinessCache.key === key && workflowReadinessCache.expiresAt > now) {
    return workflowReadinessCache.report;
  }

  const report = publicWorkflowReadiness(await buildWorkflowReadinessAudit({
    argv: ["--no-env-file"],
    env: process.env,
    cwd: process.cwd(),
    fetchImpl: globalThis.fetch
  }));
  workflowReadinessCache = {
    key,
    expiresAt: now + workflowReadinessCacheTtlMs,
    report
  };
  return report;
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
    key_pool_size: provider.key_pool_size || 0,
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

  const workflowReadiness = await loadWorkflowReadiness();

  sendJson(res, 200, {
    ok: true,
    default_provider: defaultProviderId(providers),
    fallback_available: false,
    workflow_readiness: workflowReadiness,
    storage,
    providers
  });
}
