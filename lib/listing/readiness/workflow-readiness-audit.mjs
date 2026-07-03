import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { providerCatalog } from "../providers/provider-registry.mjs";
import { visionProviderIds } from "../providers/provider-contract.mjs";
import { publicStorageReadiness } from "../storage/storage-config.mjs";
import { vectorRetrievalConfig, vectorRetrievalModes } from "../retrieval/vector-feature-flags.mjs";
import { paddleOcrConfig } from "../ocr/paddle-ocr-client.mjs";
import { workflowSidecarsEnabled } from "../../data-loop/workflow-events.mjs";
import {
  checkWorkflowContextSchema,
  loadEnvFiles
} from "../../../scripts/check-feedback-workflow-context-schema.mjs";

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
  if (openai.enabled && openai.configured) {
    return component({
      id: "vision_provider",
      status: componentStatuses.READY,
      required: true,
      summary: "GPT-4.1 mini provider is configured as the production vision path.",
      details: {
        provider_id: openai.id,
        role: openai.role,
        model_id: openai.model_id,
        recommended_concurrency: openai.recommended_concurrency
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

function vectorComponent(env = {}) {
  const config = vectorRetrievalConfig(env);
  if (!config.enabled) {
    return component({
      id: "vector_retrieval",
      status: componentStatuses.DISABLED,
      fail_closed: true,
      summary: "Vector retrieval is disabled and will not influence GPT prompts.",
      details: {
        mode: config.mode,
        model_id: config.modelId,
        model_revision: config.modelRevision,
        roles: config.multiVectorRoles
      },
      next_action: "Set ENABLE_VECTOR_RETRIEVAL=true and VECTOR_RETRIEVAL_MODE=assist or shadow after worker readiness is confirmed."
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
        mode: config.mode,
        missing,
        model_id: config.modelId,
        model_revision: config.modelRevision,
        roles: config.multiVectorRoles,
        gpt_candidate_limit: config.gptCandidateLimit
      },
      next_action: "Configure vector worker URL/token before enabling paid C-group or vector-assisted runs."
    });
  }

  return component({
    id: "vector_retrieval",
    status: config.mode === vectorRetrievalModes.SHADOW ? componentStatuses.DEGRADED : componentStatuses.READY,
    fail_closed: config.mode !== vectorRetrievalModes.ASSIST,
    summary: config.mode === vectorRetrievalModes.ASSIST
      ? "Vector retrieval is configured for prompt-safe assist."
      : "Vector retrieval is configured outside assist mode.",
    details: {
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
    },
    next_action: config.mode === vectorRetrievalModes.ASSIST
      ? ""
      : "Use VECTOR_RETRIEVAL_MODE=assist only after candidate prompt eligibility tests stay positive."
  });
}

function ocrComponent(env = {}) {
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

  return component({
    id: "paddle_ocr",
    status: componentStatuses.READY,
    summary: "PaddleOCR field verifier client is configured for crop-level hard text evidence.",
    details: {
      url_count: config.urls.length,
      timeout_ms: config.timeout_ms,
      model_id: config.model_id,
      model_revision: config.model_revision
    }
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
    await feedbackSchemaComponent({ env: runtimeEnv, argv, cwd, fetchImpl }),
    catalogComponent(runtimeEnv),
    vectorComponent(runtimeEnv),
    ocrComponent(runtimeEnv),
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
