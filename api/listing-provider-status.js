import crypto from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { visionProviderIds } from "../lib/listing/providers/provider-contract.mjs";
import { openAiProviderPoolStatus } from "../lib/listing/providers/openai-key-pool.mjs";
import { providerCatalog } from "../lib/listing/providers/provider-registry.mjs";
import { buildWorkflowReadinessAudit } from "../lib/listing/readiness/workflow-readiness-audit.mjs";
import { publicStorageReadiness } from "../lib/listing/storage/storage-config.mjs";
import {
  v4ProviderDoneCapacityHandoffEnabled,
  v4ProviderCapacityControlEnabled,
  v4QueueGlobalDrainEnabled,
  v4QueueKickDedupMs
} from "../lib/listing/v4/jobs/production-job-queue.mjs";
import { listingStageCapacityPlan } from "../lib/listing/v4/orchestration/stage-capacity.mjs";

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
    "OPENAI_API_KEY_POOL",
    "OPENAI_API_KEYS",
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
    "VECTOR_INDEX_READY",
    "VECTOR_WORKER_URL",
    "RECOGNITION_WORKER_URL",
    "VECTOR_WORKER_TOKEN",
    "RECOGNITION_WORKER_TOKEN",
    "ENABLE_PADDLE_OCR_FIELD_VERIFIER",
    "PADDLE_OCR_WORKER_URL",
    "PADDLE_OCR_WORKER_TOKEN",
    "PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED",
    "PREINGESTION_OCR_GLOBAL_CAPACITY",
    "PREINGESTION_OCR_ANCHOR_CONCURRENCY",
    "PREINGESTION_OCR_DETAIL_CONCURRENCY",
    "RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED",
    "RETRIEVAL_CATALOG_GLOBAL_CAPACITY",
    "RETRIEVAL_INTERNAL_QUERY_CONCURRENCY",
    "VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED",
    "VECTOR_QUERY_GLOBAL_CAPACITY",
    "VISUAL_VECTOR_INDEX_CONCURRENCY",
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
    "EBAY_SELLER_USERNAME",
    ...Array.from({ length: 50 }, (_, index) => `OPENAI_API_KEY_${index + 1}`)
  ];
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(relevantKeys.map((key) => [key, env[key] || ""])))
    .digest("hex");
}

function publicWorkflowReadiness(report = {}) {
  function publicComponentDetails(item = {}) {
    const details = item.details || {};
    if (item.id === "vision_provider") {
      return {
        provider_id: details.provider_id || null,
        role: details.role || null,
        model_id: details.model_id || null,
        recommended_concurrency: details.recommended_concurrency || null
      };
    }
    if (item.id === "vector_retrieval") {
      return {
        index_ready: details.index_ready === true,
        worker_configured: details.worker_configured === true,
        runtime_ready: details.runtime_ready === true,
        runtime_status: details.runtime_status || "UNKNOWN",
        preload_status: details.preload_status || "UNKNOWN",
        default_enabled: details.default_enabled === true,
        default_mode: details.default_mode || details.mode || "off",
        request_override_supported: details.request_override_supported === true,
        prompt_influence_by_default: details.prompt_influence_by_default === true,
        model_id: details.model_id || null,
        model_revision: details.model_revision || null,
        preprocessing_version: details.preprocessing_version || null
      };
    }
    return undefined;
  }

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
        details: publicComponentDetails(item),
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
  const providerPool = openAiProviderPoolStatus(process.env);
  const stageCapacity = listingStageCapacityPlan(process.env);

  sendJson(res, 200, {
    ok: true,
    default_provider: defaultProviderId(providers),
    fallback_available: false,
    workflow_readiness: workflowReadiness,
    execution_control: {
      distributed_provider_capacity_enabled: v4ProviderCapacityControlEnabled(process.env),
      provider_done_capacity_handoff_enabled: v4ProviderDoneCapacityHandoffEnabled(process.env),
      global_fair_drain_enabled: v4QueueGlobalDrainEnabled(process.env),
      queue_kick_dedup_ms: v4QueueKickDedupMs(process.env),
      provider_key_pool_size: providerPool.key_pool_size,
      per_key_stable_concurrency: providerPool.per_key_stable_concurrency,
      global_provider_concurrency: providerPool.global_concurrency,
      stage_capacity: {
        paddle_ocr: stageCapacity.ocr,
        catalog: stageCapacity.catalog,
        vector: stageCapacity.vector
      }
    },
    storage,
    providers
  });
}
