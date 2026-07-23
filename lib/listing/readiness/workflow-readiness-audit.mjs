import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { providerCatalog } from "../providers/provider-registry.mjs";
import { visionProviderIds } from "../providers/provider-contract.mjs";
import {
  defaultProviderOptionsFromEnv,
  ultraFastImageDetail,
  ultraFastServiceTier,
  ultraFastTextVerbosity
} from "../pipeline/provider-options.mjs";
import { publicStorageReadiness } from "../storage/storage-config.mjs";
import { vectorRetrievalConfig, vectorRetrievalModes } from "../retrieval/vector-feature-flags.mjs";
import { paddleOcrConfig } from "../ocr/paddle-ocr-client.mjs";
import { workflowSidecarsEnabled } from "../../data-loop/workflow-events.mjs";
import {
  v4QueueConfigured,
  v4WorkerProcessConcurrency
} from "../v4/jobs/production-job-queue.mjs";
import { v4JobRetryPolicy } from "../v4/jobs/job-retry-policy.mjs";
import { trustedInternalServiceOrigin } from "../v4/jobs/internal-service-origin.mjs";
import { configuredWorkerSecret } from "../v4/jobs/worker-auth.mjs";
import {
  checkWorkflowContextSchema,
  loadEnvFiles
} from "./workflow-context-schema.mjs";

export const workflowReadinessVersion = "listing-workflow-readiness-v1";

const componentStatuses = Object.freeze({
  READY: "READY",
  DISABLED: "DISABLED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  FAIL_CLOSED: "FAIL_CLOSED",
  DEGRADED: "DEGRADED",
  BLOCKED: "BLOCKED"
});

const defaultEnvFiles = Object.freeze([
  ".env.vercel.production.local",
  ".vercel/.env.production.local",
  ".env.cloud-eval.local",
  ".env.local",
  ".env"
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function argValues(argv, name) {
  const values = [];
  argv.forEach((item, index) => {
    if (item === name && argv[index + 1]) values.push(argv[index + 1]);
    if (item.startsWith(`${name}=`)) values.push(item.slice(name.length + 1));
  });
  return values;
}

function firstFilled(...values) {
  return values.map(cleanText).find(Boolean) || "";
}

function envHas(env = {}, ...keys) {
  return keys.some((key) => Boolean(cleanText(env[key])));
}

function mergeEnv(fileEnv = {}, runtimeEnv = {}) {
  const merged = { ...fileEnv };
  Object.entries(runtimeEnv || {}).forEach(([key, value]) => {
    if (cleanText(value)) merged[key] = value;
  });
  return merged;
}

export function loadWorkflowReadinessEnv({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd()
} = {}) {
  const noEnvFile = hasFlag(argv, "--no-env-file");
  const explicitEnvFiles = argValues(argv, "--env-file");
  const envFiles = noEnvFile ? [] : (explicitEnvFiles.length ? explicitEnvFiles : defaultEnvFiles);
  const loaded = loadEnvFiles({ cwd, envFiles });
  return {
    env: mergeEnv(loaded.values, env),
    loaded_env_files: loaded.loaded
  };
}

function component({
  id,
  status,
  required = false,
  fail_closed = false,
  summary,
  details = {},
  next_action = ""
}) {
  return {
    id,
    status,
    required,
    fail_closed,
    ready: status === componentStatuses.READY,
    summary,
    details,
    next_action: next_action || null
  };
}

function statusPriority(status) {
  return {
    [componentStatuses.BLOCKED]: 5,
    [componentStatuses.NOT_CONFIGURED]: 4,
    [componentStatuses.FAIL_CLOSED]: 3,
    [componentStatuses.DEGRADED]: 2,
    [componentStatuses.DISABLED]: 1,
    [componentStatuses.READY]: 0
  }[status] ?? 0;
}

function providerComponent(env = {}) {
  const openai = providerCatalog(env)[visionProviderIds.OPENAI_LEGACY] || {};
  const providerOptions = defaultProviderOptionsFromEnv(env);
  if (openai.enabled && openai.configured) {
    const modelId = cleanText(openai.model_id) || "OpenAI vision model";
    return component({
      id: "vision_provider",
      status: componentStatuses.READY,
      required: true,
      summary: `${modelId} is configured as the production vision path.`,
      details: {
        provider_id: openai.id,
        role: openai.role,
        model_id: openai.model_id,
        recommended_concurrency: openai.recommended_concurrency,
        image_detail: ultraFastImageDetail(providerOptions),
        text_verbosity: ultraFastTextVerbosity(providerOptions),
        service_tier: ultraFastServiceTier(providerOptions) || "default"
      }
    });
  }

  return component({
    id: "vision_provider",
    status: openai.enabled === false ? componentStatuses.DISABLED : componentStatuses.NOT_CONFIGURED,
    required: true,
    summary: "The production GPT vision provider is not ready.",
    details: {
      provider_id: openai.id || visionProviderIds.OPENAI_LEGACY,
      role: openai.role || "primary",
      model_id: openai.model_id || null,
      image_detail: ultraFastImageDetail(providerOptions),
      text_verbosity: ultraFastTextVerbosity(providerOptions),
      service_tier: ultraFastServiceTier(providerOptions) || "default",
      enabled: Boolean(openai.enabled),
      configured: Boolean(openai.configured),
      disabled_reason: openai.disabled_reason || "missing_openai_api_key"
    },
    next_action: "Configure OPENAI_API_KEY and an allowed OPENAI_LISTING_MODEL before paid recognition runs."
  });
}

function storageComponent(env = {}) {
  const storage = publicStorageReadiness(env);
  if (storage.configured) {
    return component({
      id: "image_storage",
      status: componentStatuses.READY,
      required: true,
      summary: "Supabase image storage is configured for signed upload and provider URL flow.",
      details: {
        bucket: storage.bucket,
        max_upload_bytes: storage.max_upload_bytes,
        max_image_dimension_pixels: storage.max_image_dimension_pixels,
        max_image_total_pixels: storage.max_image_total_pixels,
        signed_url_ttl_seconds: storage.signed_url_ttl_seconds
      }
    });
  }

  return component({
    id: "image_storage",
    status: componentStatuses.NOT_CONFIGURED,
    required: true,
    summary: "Supabase image storage is not fully configured.",
    details: {
      missing: storage.missing,
      bucket: storage.bucket,
      max_upload_bytes: storage.max_upload_bytes
    },
    next_action: "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and LISTING_IMAGE_BUCKET for cloud image flow."
  });
}

function productionQueueComponent(env = {}) {
  const queueStoreReady = v4QueueConfigured(env);
  const workerSecretReady = Boolean(configuredWorkerSecret(env));
  const internalOriginReady = Boolean(trustedInternalServiceOrigin(env));
  const ready = queueStoreReady && workerSecretReady && internalOriginReady;
  const missing = [];
  if (!queueStoreReady) missing.push("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  if (!workerSecretReady) missing.push("V4_JOB_WORKER_SECRET");
  if (!internalOriginReady) missing.push("V4_INTERNAL_BASE_URL or VERCEL_URL");
  return component({
    id: "production_queue",
    status: ready ? componentStatuses.READY : componentStatuses.NOT_CONFIGURED,
    required: true,
    summary: ready
      ? "The durable recognition queue, trusted internal wake path, and worker authentication are configured."
      : "The durable recognition queue cannot reliably dispatch or wake production workers.",
    details: {
      queue_store_ready: queueStoreReady,
      worker_secret_configured: workerSecretReady,
      trusted_internal_origin_configured: internalOriginReady,
      provider_process_concurrency: v4WorkerProcessConcurrency(env),
      retry_max_attempts: v4JobRetryPolicy.maxAttempts,
      retry_backoff_seconds: [...v4JobRetryPolicy.backoffSeconds],
      delayed_retry_wake: "detached_deduplicated"
    },
    next_action: ready
      ? ""
      : `Configure ${missing.join(", ")} before production queue traffic.`
  });
}

async function feedbackSchemaComponent({ env = {}, argv = [], cwd = process.cwd(), fetchImpl = globalThis.fetch } = {}) {
  const retentionEnabled = boolValue(env.LISTING_FEEDBACK_RETENTION_ENABLED || env.ENABLE_LISTING_FEEDBACK_RETENTION, false);
  const schema = await checkWorkflowContextSchema({
    argv: [...argv, "--no-env-file"],
    env,
    cwd,
    fetchImpl
  });
  if (schema.ok) {
    return component({
      id: "feedback_workflow_schema",
      status: componentStatuses.READY,
      required: retentionEnabled,
      summary: "Supabase REST can see feedback workflow context columns.",
      details: {
        retention_enabled: retentionEnabled,
        mode: schema.mode,
        column_ok_count: schema.summary.column_ok_count,
        column_required_count: schema.summary.column_required_count,
        indexes_check_mode: "unverified_by_rest"
      }
    });
  }

  return component({
    id: "feedback_workflow_schema",
    status: retentionEnabled ? componentStatuses.BLOCKED : componentStatuses.FAIL_CLOSED,
    required: retentionEnabled,
    fail_closed: !retentionEnabled,
    summary: retentionEnabled
      ? "Feedback retention is enabled but workflow context schema is not ready."
      : "Feedback workflow context schema is not verified; retention remains fail-closed when disabled.",
    details: {
      retention_enabled: retentionEnabled,
      mode: schema.mode,
      column_ok_count: schema.summary.column_ok_count,
      column_required_count: schema.summary.column_required_count,
      missing_columns: schema.required_columns
        .filter((item) => item.ok === false || item.ok === null)
        .map((item) => `${item.table}.${item.column}`),
      migration_file: schema.migration_file
    },
    next_action: schema.next_action
  });
}

async function probeVectorWorker(config = {}, fetchImpl = globalThis.fetch) {
  if (!config.workerUrl || typeof fetchImpl !== "function") {
    return { ready: false, status: "NOT_CONFIGURED", reason: "vector_worker_not_configured" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetchImpl(`${config.workerUrl}/readyz`, { signal: controller.signal });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    const preloadStatus = cleanText(payload.visual_embedding_preload_status?.status).toUpperCase();
    const modelMatches = cleanText(payload.visual_embedding_model_id) === cleanText(config.modelId)
      && cleanText(payload.visual_embedding_model_revision) === cleanText(config.modelRevision);
    const ready = response.ok
      && cleanText(payload.status).toLowerCase() === "ready"
      && payload.visual_embeddings_enabled === true
      && payload.visual_embedding_preload_enabled === true
      && preloadStatus === "READY"
      && modelMatches;
    return {
      ready,
      status: ready ? "READY" : "DEGRADED",
      reason: ready ? "" : "vector_worker_model_not_preloaded",
      preload_status: preloadStatus || "UNKNOWN",
      model_matches: modelMatches
    };
  } catch (error) {
    return {
      ready: false,
      status: "UNAVAILABLE",
      reason: error?.name === "AbortError" ? "vector_worker_readiness_timeout" : "vector_worker_readiness_error",
      preload_status: "UNKNOWN",
      model_matches: false
    };
  } finally {
    clearTimeout(timer);
  }
}

async function vectorComponent(env = {}, fetchImpl = globalThis.fetch) {
  const environmentConfig = vectorRetrievalConfig(env);
  const productionRequestOptions = defaultProviderOptionsFromEnv(env);
  const config = vectorRetrievalConfig(env, productionRequestOptions);
  const indexReady = boolValue(env.VECTOR_INDEX_READY, false);
  const workerConfigured = Boolean(config.workerUrl && config.workerToken);
  const runtime = workerConfigured
    ? await probeVectorWorker(config, fetchImpl)
    : { ready: false, status: "NOT_CONFIGURED", reason: "vector_worker_not_configured", preload_status: "UNKNOWN", model_matches: false };
  const productionRequestEnabled = config.enabled;
  const productionAssistEnabled = productionRequestEnabled && config.mode === vectorRetrievalModes.ASSIST;
  const infrastructureReady = indexReady && workerConfigured && runtime.ready;
  const assistReady = productionAssistEnabled && infrastructureReady;
  const commonDetails = {
    default_enabled: productionRequestEnabled,
    online_retrieval_default_enabled: productionRequestEnabled,
    default_mode: config.mode,
    environment_default_enabled: environmentConfig.enabled,
    environment_default_mode: environmentConfig.mode,
    production_request_enabled: productionRequestEnabled,
    production_request_mode: config.mode,
    index_ready: indexReady,
    index_state: indexReady ? "READY" : "NOT_READY",
    worker_configured: workerConfigured,
    runtime_ready: runtime.ready,
    runtime_status: runtime.status,
    preload_status: runtime.preload_status,
    runtime_reason: runtime.reason,
    infrastructure_ready: infrastructureReady,
    assist_ready: assistReady,
    request_override_supported: infrastructureReady,
    prompt_influence_by_default: assistReady,
    participation_state: assistReady
      ? "ASSIST_ACTIVE"
      : infrastructureReady
        ? "AVAILABLE_NOT_ACTIVE"
        : "UNAVAILABLE",
    mode: config.mode,
    model_id: config.modelId,
    model_revision: config.modelRevision,
    preprocessing_version: config.preprocessingVersion,
    roles: config.multiVectorRoles,
    top_k: config.topK,
    internal_top_n: config.internalTopN,
    gpt_candidate_limit: config.gptCandidateLimit,
    advanced_retrieval_enabled: config.advancedRetrievalEnabled,
    hybrid_retrieval_enabled: config.hybridRetrievalEnabled
  };

  if (!config.enabled) {
    return component({
      id: "vector_retrieval",
      status: infrastructureReady ? componentStatuses.READY : componentStatuses.DISABLED,
      fail_closed: true,
      summary: infrastructureReady
        ? "Vector index and worker are ready, but the production request profile does not enable vector participation."
        : "The production request profile does not enable vector participation; index and worker readiness are reported separately.",
      details: commonDetails,
      next_action: infrastructureReady
        ? "Enable the production request profile only after retrieval application tests remain positive."
        : "Prepare the index and preloaded worker before enabling vector participation."
    });
  }

  const missing = [];
  if (!config.workerUrl) missing.push("VECTOR_WORKER_URL or RECOGNITION_WORKER_URL");
  if (!config.workerToken) missing.push("VECTOR_WORKER_TOKEN or RECOGNITION_WORKER_TOKEN");
  if (missing.length) {
    return component({
      id: "vector_retrieval",
      status: componentStatuses.FAIL_CLOSED,
      fail_closed: true,
      summary: "Vector retrieval is enabled but worker config is incomplete, so assist should fail closed.",
      details: {
        ...commonDetails,
        missing,
      },
      next_action: "Configure vector worker URL/token before enabling paid C-group or vector-assisted runs."
    });
  }

  if (!indexReady) {
    return component({
      id: "vector_retrieval",
      status: componentStatuses.FAIL_CLOSED,
      fail_closed: true,
      summary: "The production request profile enables vector retrieval, but the index is not marked ready, so assist is fail-closed.",
      details: commonDetails,
      next_action: "Complete and verify the vector index before setting VECTOR_INDEX_READY=true."
    });
  }

  return component({
    id: "vector_retrieval",
    status: runtime.ready
      ? (productionAssistEnabled ? componentStatuses.READY : componentStatuses.DEGRADED)
      : componentStatuses.FAIL_CLOSED,
    fail_closed: !assistReady,
    summary: !runtime.ready
      ? "Vector retrieval is configured, but its runtime is not preloaded and request-level assist is fail-closed."
      : productionAssistEnabled
        ? "Vector index, preloaded worker, and the production request profile are ready for prompt-safe assist."
        : "Vector infrastructure is ready, but the production request profile is not in assist mode.",
    details: commonDetails,
    next_action: assistReady
      ? ""
      : runtime.ready
        ? "Use VECTOR_RETRIEVAL_MODE=assist only after candidate prompt eligibility tests stay positive."
        : "Warm and verify the pinned vector worker model before enabling request-level vector assist."
  });
}

async function probeOcrWorker(config = {}, fetchImpl = globalThis.fetch) {
  if (!config.url || typeof fetchImpl !== "function") {
    return { ready: false, runtime_profile: "NOT_CONFIGURED", reason: "ocr_worker_not_configured" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetchImpl(`${config.url}/readyz`, { signal: controller.signal });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    const ready = response.ok && cleanText(payload.status).toLowerCase() === "ready";
    const leanGoogleVision = ready
      && cleanText(payload.service) === "vision-ocr"
      && cleanText(payload.backend) === "google_vision"
      && cleanText(payload.auth_mode) === "adc"
      && payload.paddle_loaded === false;
    return {
      ready,
      runtime_profile: leanGoogleVision ? "lean-google-vision-v1" : "legacy-or-unknown-ocr-worker",
      backend: cleanText(payload.backend || payload.ocr_backend) || "unknown",
      auth_mode: cleanText(payload.auth_mode) || "unknown",
      paddle_loaded: typeof payload.paddle_loaded === "boolean" ? payload.paddle_loaded : null,
      reason: ready ? "" : "ocr_worker_not_ready"
    };
  } catch (error) {
    return {
      ready: false,
      runtime_profile: "UNAVAILABLE",
      backend: "unknown",
      auth_mode: "unknown",
      paddle_loaded: null,
      reason: error?.name === "AbortError" ? "ocr_worker_readiness_timeout" : "ocr_worker_readiness_error"
    };
  } finally {
    clearTimeout(timer);
  }
}

async function ocrComponent(env = {}, fetchImpl = globalThis.fetch) {
  const config = paddleOcrConfig(env);
  if (!config.enabled) {
    return component({
      id: "paddle_ocr",
      status: componentStatuses.DISABLED,
      fail_closed: true,
      summary: "PaddleOCR field verifier is disabled.",
      details: {
        model_id: config.model_id,
        model_revision: config.model_revision,
        reason: config.reason
      },
      next_action: "Enable only for field-level verifier tasks after worker /readyz reports paddleocr_enabled:true."
    });
  }

  const missing = [];
  if (!config.configured) missing.push("PADDLE_OCR_WORKER_URL or RECOGNITION_WORKER_URL");
  if (!config.token) missing.push("PADDLE_OCR_WORKER_TOKEN or RECOGNITION_WORKER_TOKEN");
  if (missing.length) {
    return component({
      id: "paddle_ocr",
      status: componentStatuses.FAIL_CLOSED,
      fail_closed: true,
      summary: "PaddleOCR is enabled but worker config is incomplete.",
      details: {
        missing,
        url_count: config.urls.length,
        timeout_ms: config.timeout_ms,
        model_id: config.model_id,
        model_revision: config.model_revision
      },
      next_action: "Configure OCR worker URL/token or disable ENABLE_PADDLE_OCR_FIELD_VERIFIER to avoid queued-but-unreachable verifier tasks."
    });
  }

  const runtime = await probeOcrWorker(config, fetchImpl);
  return component({
    id: "paddle_ocr",
    status: runtime.ready ? componentStatuses.READY : componentStatuses.FAIL_CLOSED,
    fail_closed: !runtime.ready,
    summary: runtime.ready
      ? "OCR field verifier runtime is reachable."
      : "OCR field verifier is configured but its runtime is not ready.",
    details: {
      url_count: config.urls.length,
      timeout_ms: config.timeout_ms,
      model_id: config.model_id,
      model_revision: config.model_revision,
      runtime_ready: runtime.ready,
      runtime_profile: runtime.runtime_profile,
      backend: runtime.backend,
      auth_mode: runtime.auth_mode,
      paddle_loaded: runtime.paddle_loaded,
      reason: runtime.reason
    },
    next_action: runtime.ready ? "" : "Restore the configured OCR worker /readyz contract before running paid recognition."
  });
}

function catalogComponent(env = {}) {
  const supabaseReady = envHas(env, "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
    && envHas(env, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");
  const importerFiles = [
    "scripts/import-official-checklists.mjs",
    "scripts/import-writer-title-catalog-seed.mjs",
    "scripts/import-pokemon-tcg-community-api-v0.mjs",
    "scripts/import-scryfall-community-api-v0.mjs",
    "scripts/import-ygoprodeck-community-api-v0.mjs"
  ];
  const filesPresent = importerFiles.filter((file) => fs.existsSync(path.resolve(file)));
  if (supabaseReady) {
    return component({
      id: "catalog_store",
      status: componentStatuses.READY,
      summary: "Catalog staging/import code has a configured Supabase store.",
      details: {
        importer_files_present: filesPresent.length,
        importer_files_expected: importerFiles.length,
        source_policy: "staging_first_no_auto_promote"
      }
    });
  }
  return component({
    id: "catalog_store",
    status: componentStatuses.FAIL_CLOSED,
    fail_closed: true,
    summary: "Catalog import/lookup code is present, but the store is not configured in this environment.",
    details: {
      importer_files_present: filesPresent.length,
      importer_files_expected: importerFiles.length,
      missing: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
    },
    next_action: "Configure server-side Supabase credentials before catalog import, gap queue, or approved-reference promotion."
  });
}

function marketplaceComponent(env = {}) {
  const configured = envHas(env, "EBAY_CLIENT_ID") && envHas(env, "EBAY_CLIENT_SECRET");
  if (configured) {
    return component({
      id: "marketplace_reference",
      status: componentStatuses.READY,
      summary: "eBay Browse credentials are configured for marketplace-reference collection.",
      details: {
        env: cleanText(env.EBAY_ENV) || "production",
        marketplace_id: cleanText(env.EBAY_MARKETPLACE_ID) || "EBAY_US",
        seller_username: cleanText(env.EBAY_SELLER_USERNAME) || null,
        boundary: "marketplace_reference_not_ground_truth"
      }
    });
  }
  return component({
    id: "marketplace_reference",
    status: componentStatuses.NOT_CONFIGURED,
    fail_closed: true,
    summary: "eBay Browse is not configured in this environment.",
    details: {
      missing: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
      boundary: "optional_marketplace_reference_only"
    },
    next_action: "Configure eBay Browse only for reference collection or blind-eval sample intake; never treat seller titles as reviewed GT."
  });
}

function sidecarComponent(env = {}) {
  const enabled = workflowSidecarsEnabled(env);
  if (!enabled) {
    return component({
      id: "data_loop_sidecars",
      status: componentStatuses.DISABLED,
      fail_closed: true,
      summary: "Data-loop sidecars are disabled.",
      details: { enabled: false },
      next_action: "Set DATA_LOOP_SIDECARS_ENABLED=true when feedback, review queues, and sidecar endpoints are configured."
    });
  }

  const internalToken = envHas(env, "DATA_LOOP_INTERNAL_SIDECAR_TOKEN", "VERCEL_AUTOMATION_BYPASS_SECRET");
  const lightGbmShadowRequested = boolValue(env.DATA_LOOP_LIGHTGBM_SHADOW_ENABLED, true);
  const tools = {
    paddle_ocr_dispatch: boolValue(env.DATA_LOOP_PADDLE_OCR_DISPATCH_ENABLED, false),
    splink_lookup: boolValue(env.DATA_LOOP_SPLINK_LOOKUP_ENABLED, false),
    splink_batch: boolValue(env.DATA_LOOP_SPLINK_BATCH_ENABLED, false),
    cleanlab_external: envHas(env, "DATA_LOOP_CLEANLAB_SCORE_URL", "CLEANLAB_SCORE_URL"),
    label_studio: envHas(env, "LABEL_STUDIO_URL") && envHas(env, "LABEL_STUDIO_TOKEN"),
    cvat: envHas(env, "CVAT_URL") && envHas(env, "CVAT_TOKEN"),
    fiftyone_export: boolValue(env.DATA_LOOP_FIFTYONE_EXPORT_ENABLED, false),
    lightgbm_shadow: lightGbmShadowRequested
      && envHas(env, "DATA_LOOP_LIGHTGBM_RERANKER_URL", "LIGHTGBM_RERANKER_URL"),
    phoenix: envHas(env, "PHOENIX_COLLECTOR_ENDPOINT", "PHOENIX_ENDPOINT", "DATA_LOOP_PHOENIX_ENDPOINT")
  };
  const activeCount = Object.values(tools).filter(Boolean).length;
  return component({
    id: "data_loop_sidecars",
    status: activeCount ? componentStatuses.READY : componentStatuses.DEGRADED,
    fail_closed: activeCount === 0,
    summary: activeCount
      ? "Data-loop sidecar orchestration has at least one active downstream path."
      : "Data-loop sidecars are enabled but no downstream tool is active.",
    details: {
      enabled,
      internal_token_configured: internalToken,
      active_tool_count: activeCount,
      requested_without_endpoint: {
        lightgbm_shadow: lightGbmShadowRequested && !tools.lightgbm_shadow
      },
      tools
    },
    next_action: activeCount
      ? ""
      : "Enable at least one sidecar path, or disable DATA_LOOP_SIDECARS_ENABLED to make fail-closed behavior explicit."
  });
}

function rankComponents(components = []) {
  return [...components].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return statusPriority(b.status) - statusPriority(a.status);
  });
}

// Browser bootstrap needs a fast answer about the three components that can
// actually accept a paid recognition request. Live schema and worker probes
// remain part of the full audit used by CI, deploy gates, and operations, but
// a slow optional probe must not hide configured Storage or strand an upload
// on the first page load.
export function buildWorkflowCoreReadinessAudit({
  env = process.env,
  reason = "deep_diagnostics_deferred"
} = {}) {
  const components = rankComponents([
    providerComponent(env),
    storageComponent(env),
    productionQueueComponent(env)
  ]);
  const blockers = components.filter((item) => item.required && !item.ready);
  return {
    schema_version: workflowReadinessVersion,
    checked_at: new Date().toISOString(),
    loaded_env_files: [],
    ok: blockers.length === 0,
    can_run_cloud_recognition: blockers.length === 0,
    low_friction_ready: false,
    diagnostics_deferred: true,
    diagnostics_reason: cleanText(reason) || "deep_diagnostics_deferred",
    summary: {
      component_count: components.length,
      ready_count: components.filter((item) => item.ready).length,
      blocker_count: blockers.length,
      fail_closed_count: 0,
      degraded_count: 0
    },
    components,
    blockers: blockers.map((item) => item.id),
    fail_closed_components: [],
    next_actions: components
      .filter((item) => item.next_action)
      .map((item) => ({ component: item.id, action: item.next_action })),
    notes: [
      "Core runtime readiness is available; deep schema and optional worker diagnostics were deferred.",
      "The full readiness audit remains mandatory in CI and the production deployment gate."
    ]
  };
}

export async function buildWorkflowReadinessAudit({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  fetchImpl = globalThis.fetch
} = {}) {
  const loaded = loadWorkflowReadinessEnv({ argv, env, cwd });
  const runtimeEnv = loaded.env;
  const components = rankComponents([
    providerComponent(runtimeEnv),
    storageComponent(runtimeEnv),
    productionQueueComponent(runtimeEnv),
    await feedbackSchemaComponent({ env: runtimeEnv, argv, cwd, fetchImpl }),
    catalogComponent(runtimeEnv),
    await vectorComponent(runtimeEnv, fetchImpl),
    await ocrComponent(runtimeEnv, fetchImpl),
    sidecarComponent(runtimeEnv),
    marketplaceComponent(runtimeEnv)
  ]);
  const blockers = components.filter((item) => item.required && !item.ready);
  const failClosed = components.filter((item) => item.fail_closed || item.status === componentStatuses.FAIL_CLOSED);
  const degraded = components.filter((item) => item.status === componentStatuses.DEGRADED);
  const nextActions = components
    .filter((item) => item.next_action)
    .map((item) => ({ component: item.id, action: item.next_action }));

  return {
    schema_version: workflowReadinessVersion,
    checked_at: new Date().toISOString(),
    loaded_env_files: loaded.loaded_env_files,
    ok: blockers.length === 0,
    can_run_cloud_recognition: blockers.length === 0,
    low_friction_ready: blockers.length === 0 && failClosed.length === 0 && degraded.length === 0,
    summary: {
      component_count: components.length,
      ready_count: components.filter((item) => item.ready).length,
      blocker_count: blockers.length,
      fail_closed_count: failClosed.length,
      degraded_count: degraded.length
    },
    components,
    blockers: blockers.map((item) => item.id),
    fail_closed_components: failClosed.map((item) => item.id),
    next_actions: nextActions.slice(0, 12),
    notes: [
      "This audit is a low-cost readiness gate; it does not call paid vision providers.",
      "Marketplace data remains reference-only and must not become reviewed ground truth.",
      "Optional fail-closed components are safe but reduce catalog/vector/OCR contribution."
    ]
  };
}

function formatText(report = {}) {
  const lines = [
    `workflow_readiness: ${report.ok ? "OK" : "NOT_READY"}`,
    `can_run_cloud_recognition: ${report.can_run_cloud_recognition ? "yes" : "no"}`,
    `low_friction_ready: ${report.low_friction_ready ? "yes" : "no"}`,
    `components: ${report.summary.ready_count}/${report.summary.component_count} ready, ${report.summary.blocker_count} blockers, ${report.summary.fail_closed_count} fail-closed`,
    "component_status:"
  ];
  report.components.forEach((item) => {
    lines.push(`  - ${item.id}: ${item.status}${item.required ? " required" : ""} - ${item.summary}`);
  });
  if (report.next_actions.length) {
    lines.push("next_actions:");
    report.next_actions.forEach((item) => lines.push(`  - ${item.component}: ${item.action}`));
  }
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2), {
  env = process.env,
  cwd = process.cwd(),
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  const report = await buildWorkflowReadinessAudit({ argv, env, cwd, fetchImpl });
  const json = hasFlag(argv, "--json");
  const allowNotReady = hasFlag(argv, "--allow-not-ready");
  stdout.write(`${json ? JSON.stringify(report, null, 2) : formatText(report)}\n`);
  if (!report.ok && !allowNotReady) {
    stderr.write("Workflow readiness audit is not ready.\n");
    return 1;
  }
  return 0;
}
