import { createHash } from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import {
  hasTenantPermission,
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../lib/tenant/index.mjs";
import { visionProviderIds } from "../lib/listing/providers/provider-contract.mjs";
import { openAiProviderPoolStatus } from "../lib/listing/providers/openai-key-pool.mjs";
import { providerCatalog } from "../lib/listing/providers/provider-registry.mjs";
import {
  buildWorkflowCoreReadinessAudit,
  buildWorkflowReadinessAudit
} from "../lib/listing/readiness/workflow-readiness-audit.mjs";
import { publicStorageReadiness } from "../lib/listing/storage/storage-config.mjs";
import { recognitionWorkerConfig } from "../lib/listing/recognition/recognition-feature-flags.mjs";
import { paddleOcrConfig } from "../lib/listing/ocr/paddle-ocr-client.mjs";
import {
  v4ProviderDoneCapacityHandoffEnabled,
  v4ProviderCapacityControlEnabled,
  v4QueueSubmissionConcurrency,
  v4QueueGlobalDrainEnabled,
  v4QueueKickDedupMs
} from "../lib/listing/v4/jobs/production-job-queue.mjs";
import { listingStageCapacityPlan } from "../lib/listing/v4/orchestration/stage-capacity.mjs";
import { v4DeploymentInfo } from "../lib/listing/v4/prewarm.mjs";

const workflowReadinessCacheTtlMs = 60_000;
let workflowReadinessCache = {
  key: "",
  expiresAt: 0,
  report: null
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
    "ENABLE_OPENAI_PROVIDER",
    "ENABLE_GPT41_PROVIDER",
    "ENABLE_GPT41_EMERGENCY_PROVIDER",
    "ALLOW_EXPLICIT_OPENAI_RETRY",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "LISTING_IMAGE_BUCKET",
    "V4_JOB_WORKER_SECRET",
    "V4_INTERNAL_BASE_URL",
    "LYNCA_INTERNAL_BASE_URL",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "PORT",
    "OPENAI_PER_KEY_STABLE_CONCURRENCY",
    "LISTING_FEEDBACK_RETENTION_ENABLED",
    "ENABLE_LISTING_FEEDBACK_RETENTION",
    "ENABLE_VECTOR_RETRIEVAL",
    "ENABLE_VECTOR_ASSIST_DEFAULT",
    "VECTOR_RETRIEVAL_MODE",
    "VECTOR_INDEX_READY",
    "VECTOR_WORKER_URL",
    "RECOGNITION_WORKER_URL",
    "ENABLE_RECOGNITION_WORKER",
    "VECTOR_WORKER_TOKEN",
    "RECOGNITION_WORKER_TOKEN",
    "ENABLE_PADDLE_OCR_FIELD_VERIFIER",
    "PADDLE_OCR_WORKER_URL",
    "PADDLE_OCR_WORKER_TOKEN",
    "PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED",
    "PREINGESTION_OCR_GLOBAL_CAPACITY",
    "PREINGESTION_OCR_PER_ASSET_CAPACITY",
    "PREINGESTION_OCR_PER_ASSET_BATCH_SIZE",
    "PREINGESTION_OCR_ANCHOR_CONCURRENCY",
    "PREINGESTION_OCR_DETAIL_CONCURRENCY",
    "PREINGESTION_OCR_POST_PROVIDER_WAIT_MS",
    "PREINGESTION_OCR_GRADE_RESCUE_WAIT_MS",
    "PREINGESTION_OCR_CRITICAL_FIELD_WAIT_MS",
    "RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED",
    "RETRIEVAL_CATALOG_GLOBAL_CAPACITY",
    "RETRIEVAL_INTERNAL_QUERY_CONCURRENCY",
    "VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED",
    "VECTOR_QUERY_GLOBAL_CAPACITY",
    "V4_ULTRA_FAST_IMAGE_DETAIL",
    "V4_ULTRA_FAST_TEXT_VERBOSITY",
    "V4_ULTRA_FAST_SERVICE_TIER",
    "V4_QUEUE_SUBMISSION_CONCURRENCY",
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
  return createHash("sha256")
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
        recommended_concurrency: details.recommended_concurrency || null,
        image_detail: details.image_detail || null,
        text_verbosity: details.text_verbosity || null,
        service_tier: details.service_tier || null
      };
    }
    if (item.id === "vector_retrieval") {
      return {
        index_ready: details.index_ready === true,
        index_state: details.index_state || (details.index_ready === true ? "READY" : "NOT_READY"),
        worker_configured: details.worker_configured === true,
        runtime_ready: details.runtime_ready === true,
        runtime_status: details.runtime_status || "UNKNOWN",
        preload_status: details.preload_status || "UNKNOWN",
        default_enabled: details.default_enabled === true,
        online_retrieval_default_enabled: details.online_retrieval_default_enabled === true,
        default_mode: details.default_mode || details.mode || "off",
        environment_default_enabled: details.environment_default_enabled === true,
        environment_default_mode: details.environment_default_mode || "off",
        production_request_enabled: details.production_request_enabled === true,
        production_request_mode: details.production_request_mode || "off",
        infrastructure_ready: details.infrastructure_ready === true,
        assist_ready: details.assist_ready === true,
        participation_state: details.participation_state || "UNAVAILABLE",
        request_override_supported: details.request_override_supported === true,
        prompt_influence_by_default: details.prompt_influence_by_default === true,
        model_id: details.model_id || null,
        model_revision: details.model_revision || null,
        preprocessing_version: details.preprocessing_version || null
      };
    }
    if (item.id === "paddle_ocr") {
      return {
        runtime_ready: details.runtime_ready === true,
        runtime_profile: details.runtime_profile || "UNKNOWN",
        backend: details.backend || "unknown",
        auth_mode: details.auth_mode || "unknown",
        paddle_loaded: typeof details.paddle_loaded === "boolean" ? details.paddle_loaded : null
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
    diagnostics_deferred: report.diagnostics_deferred === true,
    diagnostics_reason: report.diagnostics_deferred === true
      ? cleanText(report.diagnostics_reason || "deep_diagnostics_deferred")
      : null,
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

function readinessProbeTimeoutMs(env = process.env) {
  const configured = Number(env.PROVIDER_STATUS_READINESS_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 3000;
  return Math.max(100, Math.min(8000, Math.trunc(configured)));
}

function fetchWithOverallSignal(fetchImpl, overallSignal) {
  return (url, init = {}) => {
    const signals = [overallSignal, init.signal].filter(Boolean);
    const signal = signals.length > 1
      && typeof AbortSignal !== "undefined"
      && typeof AbortSignal.any === "function"
      ? AbortSignal.any(signals)
      : signals[0];
    return fetchImpl(url, { ...init, ...(signal ? { signal } : {}) });
  };
}

async function loadWorkflowReadiness() {
  const now = Date.now();
  const key = workflowReadinessCacheKey(process.env);
  if (workflowReadinessCache.report && workflowReadinessCache.key === key && workflowReadinessCache.expiresAt > now) {
    return workflowReadinessCache.report;
  }

  const controller = new AbortController();
  let deadlineReached = false;
  const timeout = setTimeout(() => {
    deadlineReached = true;
    controller.abort(new Error("provider_status_readiness_deadline"));
  }, readinessProbeTimeoutMs(process.env));
  let fullReport = null;
  try {
    fullReport = await buildWorkflowReadinessAudit({
      argv: ["--no-env-file"],
      env: process.env,
      cwd: process.cwd(),
      fetchImpl: fetchWithOverallSignal(globalThis.fetch, controller.signal)
    });
  } catch {
    // The core snapshot below is deliberately config-only and cannot be held
    // hostage by an optional network diagnostic.
  } finally {
    clearTimeout(timeout);
  }
  const report = publicWorkflowReadiness(deadlineReached || !fullReport
    ? buildWorkflowCoreReadinessAudit({
      env: process.env,
      reason: deadlineReached ? "deep_diagnostics_timeout" : "deep_diagnostics_failed"
    })
    : fullReport);
  workflowReadinessCache = {
    key,
    expiresAt: now + (report.diagnostics_deferred ? 5000 : workflowReadinessCacheTtlMs),
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

function writerProviderStatus(provider = {}) {
  return {
    id: provider.id || null,
    role: provider.role || null,
    roles: Array.isArray(provider.roles) ? provider.roles : [],
    label: provider.label || "",
    display_name: provider.display_name || "",
    model_id: provider.model_id || null,
    enabled: provider.enabled === true,
    configured: provider.configured === true,
    selectable: provider.selectable === true,
    disabled_reason: provider.disabled_reason || null,
    requires_explicit_retry: provider.requires_explicit_retry === true
  };
}

function writerStorageStatus(storage = {}) {
  return {
    configured: storage.configured === true,
    max_upload_bytes: Number(storage.max_upload_bytes || 0) || null,
    max_image_dimension_pixels: Number(storage.max_image_dimension_pixels || 0) || null,
    max_image_total_pixels: Number(storage.max_image_total_pixels || 0) || null
  };
}

function writerWorkflowReadiness(readiness = {}) {
  const summary = readiness.summary && typeof readiness.summary === "object" ? readiness.summary : {};
  return {
    ok: readiness.ok === true,
    can_run_cloud_recognition: readiness.can_run_cloud_recognition === true,
    low_friction_ready: readiness.low_friction_ready === true,
    summary: {
      component_count: Number(summary.component_count || 0),
      ready_count: Number(summary.ready_count || 0),
      blocked_count: Number(summary.blocked_count || 0),
      degraded_count: Number(summary.degraded_count || 0),
      fail_closed_count: Number(summary.fail_closed_count || 0)
    }
  };
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/listing-provider-status" });
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), publicTenantAuthError(error));
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
  const canViewOperations = hasTenantPermission(context, TENANT_PERMISSIONS.VIEW_TEAM);
  if (!canViewOperations) {
    sendJson(res, 200, {
      ok: true,
      default_provider: defaultProviderId(providers),
      fallback_available: false,
      workflow_readiness: writerWorkflowReadiness(workflowReadiness),
      storage: writerStorageStatus(storage),
      providers: providers.map(writerProviderStatus)
    });
    return;
  }
  const providerPool = openAiProviderPoolStatus(process.env);
  const stageCapacity = listingStageCapacityPlan(process.env);
  const recognitionWorker = recognitionWorkerConfig(process.env);
  const paddleOcr = paddleOcrConfig(process.env);

  sendJson(res, 200, {
    ok: true,
    deployment: v4DeploymentInfo(),
    default_provider: defaultProviderId(providers),
    fallback_available: false,
    workflow_readiness: workflowReadiness,
    execution_control: {
      recognition_worker: {
        enabled: recognitionWorker.enabled === true,
        configured: recognitionWorker.configured === true
      },
      paddle_ocr_verifier: {
        enabled: paddleOcr.enabled === true,
        configured: paddleOcr.configured === true && Boolean(paddleOcr.token)
      },
      distributed_provider_capacity_enabled: v4ProviderCapacityControlEnabled(process.env),
      provider_done_capacity_handoff_enabled: v4ProviderDoneCapacityHandoffEnabled(process.env),
      global_fair_drain_enabled: v4QueueGlobalDrainEnabled(process.env),
      queue_kick_dedup_ms: v4QueueKickDedupMs(process.env),
      provider_key_pool_size: providerPool.key_pool_size,
      per_key_stable_concurrency: providerPool.per_key_stable_concurrency,
      global_provider_concurrency: providerPool.global_concurrency,
      queue_submission_concurrency: v4QueueSubmissionConcurrency(process.env),
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
