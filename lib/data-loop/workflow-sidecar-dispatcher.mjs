import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  actionsForTool,
  buildWorkflowActionPlan,
  sidecarActionSummary
} from "./workflow-action-plan.mjs";
import {
  buildRecognitionWorkflowEvent,
  defaultWorkflowSidecars,
  mergeWorkflowSidecars,
  workflowSidecarStatuses,
  workflowSidecarsEnabled
} from "./workflow-events.mjs";

const recognitionEventsTable = "recognition_workflow_events";
const qualityFindingsTable = "data_quality_findings";
const annotationTasksTable = "annotation_tasks";
const hardNegativeExamplesTable = "hard_negative_examples";
const catalogEntityClustersTable = "catalog_entity_clusters";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeBaseUrl(value) {
  return cleanText(value).replace(/\/+$/, "");
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function supabaseConfigured(env = process.env) {
  return Boolean(normalizeBaseUrl(env.SUPABASE_URL) && cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY));
}

function configFromEnv(env = process.env) {
  return {
    supabaseUrl: normalizeBaseUrl(env.SUPABASE_URL),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY),
    sidecarsEnabled: workflowSidecarsEnabled(env),
    awaitDispatch: boolValue(env.DATA_LOOP_SIDECAR_AWAIT_DISPATCH, false),
    eventLogEnabled: boolValue(env.DATA_LOOP_WORKFLOW_EVENT_LOG_ENABLED, false),
    splinkLookupEnabled: boolValue(env.DATA_LOOP_SPLINK_LOOKUP_ENABLED, false),
    externalTaskCreationEnabled: boolValue(env.DATA_LOOP_EXTERNAL_TASK_CREATION_ENABLED, false),
    fiftyOneExportEnabled: boolValue(env.DATA_LOOP_FIFTYONE_EXPORT_ENABLED, false),
    fiftyOneExportDir: cleanText(env.DATA_LOOP_FIFTYONE_EXPORT_DIR) || "data/eval/fiftyone-sidecar",
    fiftyOneDatasetName: cleanText(env.DATA_LOOP_FIFTYONE_DATASET_NAME) || "lynca_listing_workflow_sidecar",
    labelStudioUrl: normalizeBaseUrl(env.LABEL_STUDIO_URL),
    labelStudioToken: cleanText(env.LABEL_STUDIO_TOKEN),
    cvatUrl: normalizeBaseUrl(env.CVAT_URL),
    cvatToken: cleanText(env.CVAT_TOKEN)
  };
}

function supabaseHeaders(config = {}, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function supabaseInsertRows({
  config,
  table,
  rows,
  onConflict = "",
  upsert = false,
  fetchImpl = globalThis.fetch
}) {
  if (!rows.length) return [];
  if (!supabaseConfigured({
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey
  })) {
    return [];
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  const prefer = upsert
    ? "resolution=merge-duplicates,return=representation"
    : "return=representation";
  const response = await fetchImpl(`${config.supabaseUrl}/rest/v1/${table}${query}`, {
    method: "POST",
    headers: supabaseHeaders(config, { prefer }),
    body: JSON.stringify(rows)
  });
  const payload = await readResponseJson(response);
  if (!response.ok) {
    const message = payload?.message || payload?.error || JSON.stringify(payload || {}).slice(0, 180);
    throw new Error(`Supabase ${table} insert failed: HTTP ${response.status} ${message}`);
  }
  return Array.isArray(payload) ? payload : [];
}

async function supabaseSelectRows({
  config,
  table,
  query = "",
  fetchImpl = globalThis.fetch
}) {
  if (!supabaseConfigured({
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey
  })) {
    return [];
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const response = await fetchImpl(`${config.supabaseUrl}/rest/v1/${table}${query}`, {
    method: "GET",
    headers: supabaseHeaders(config)
  });
  const payload = await readResponseJson(response);
  if (!response.ok) {
    const message = payload?.message || payload?.error || JSON.stringify(payload || {}).slice(0, 180);
    throw new Error(`Supabase ${table} select failed: HTTP ${response.status} ${message}`);
  }
  return Array.isArray(payload) ? payload : [];
}

function sidecarFailure(error) {
  return {
    status: workflowSidecarStatuses.FAILED,
    reason: cleanText(error?.message || error?.code || "sidecar_failed").slice(0, 180)
  };
}

function reviewPriority(event = {}) {
  const flags = event.risk_flags || [];
  const fields = event.review_required_fields || [];
  if (flags.some((flag) => /PROVIDER_FAILURE|OCR_FIELD_CONFLICT|CRITICAL|FIELD_CONFLICT/i.test(flag))) return "HIGH";
  if (fields.some((field) => /serial|grade|year|collector|checklist|subject|player/i.test(field))) return "HIGH";
  if (fields.length || flags.length) return "MEDIUM";
  return "LOW";
}

function findingType(event = {}) {
  const flags = event.risk_flags || [];
  if (flags.includes("PROVIDER_FAILURE")) return "PROVIDER_FAILURE";
  if (flags.some((flag) => /CONFLICT/i.test(flag))) return "FIELD_CONFLICT";
  if (flags.some((flag) => /GAP|NO_EXACT|NONE/i.test(flag))) return "CATALOG_GAP_OR_OPEN_SET";
  return "NEEDS_REVIEW";
}

function qualityFindingRow(event = {}, workflowAction = null) {
  const priority = reviewPriority(event);
  return {
    workflow_action_id: workflowAction?.workflow_action_id || null,
    idempotency_key: workflowAction?.idempotency_key || null,
    source_record_id: event.source_record_id,
    analysis_run_id: event.analysis_run_id,
    finding_type: findingType(event),
    severity: priority,
    score: priority === "HIGH" ? 0.9 : priority === "MEDIUM" ? 0.6 : 0.3,
    affected_fields: event.review_required_fields || [],
    explanation: "Workflow sidecar quality stub flagged this recognition for review; no field value was overwritten.",
    recommended_action: priority === "HIGH" ? "FIELD_REVIEW" : "QUEUE_REVIEW",
    review_status: "OPEN",
    workflow_payload: workflowAction || {}
  };
}

function annotationTaskPayload(event = {}, tool = "label_studio", workflowAction = null) {
  const imageIds = (event.images || []).map((image) => image.image_id).filter(Boolean);
  return {
    workflow_action_id: workflowAction?.workflow_action_id || null,
    idempotency_key: workflowAction?.idempotency_key || null,
    tool,
    source_record_id: event.source_record_id,
    analysis_run_id: event.analysis_run_id,
    image_ids: imageIds,
    prelabel_fields: event.resolved_fields || {},
    task_payload: {
      final_title: event.final_title,
      rendered_title: event.rendered_title,
      review_required_fields: event.review_required_fields || [],
      risk_flags: event.risk_flags || [],
      catalog_candidates: event.catalog_candidates || [],
      vector_candidates: event.vector_candidates || [],
      workflow_action: workflowAction || null,
      crop_labels: tool === "cvat"
        ? [
          "SERIAL_REGION",
          "CARD_NUMBER_REGION",
          "SLAB_LABEL_REGION",
          "PRODUCT_TEXT_REGION",
          "PLAYER_NAME_REGION",
          "TCG_CODE_REGION",
          "SURFACE_REGION",
          "FRONT_CARD_REGION",
          "BACK_CARD_REGION"
        ]
        : []
    },
    status: "QUEUED",
    review_url: null,
    exported_at: new Date().toISOString()
  };
}

function hardNegativeRows(event = {}, workflowAction = null) {
  const candidates = [
    ...(event.catalog_candidates || []),
    ...(event.vector_candidates || [])
  ];
  return candidates
    .filter((candidate) => (candidate.conflicting_fields || []).length > 0)
    .slice(0, 10)
    .map((candidate) => ({
      workflow_action_id: workflowAction?.workflow_action_id || null,
      idempotency_key: workflowAction
        ? `${workflowAction.idempotency_key}:${candidate.candidate_id}`
        : null,
      query_card_id: event.asset_id || event.source_record_id || event.analysis_run_id,
      correct_candidate_id: event.selected_candidate?.candidate_id || null,
      wrong_candidate_id: candidate.candidate_id,
      error_type: "HIGH_SIMILARITY_DIRECT_CONFLICT",
      matched_fields: candidate.supporting_fields || [],
      conflicting_fields: candidate.conflicting_fields || [],
      similarity_features: {
        normalized_score: finiteNumber(candidate.normalized_score, null),
        raw_score: finiteNumber(candidate.raw_score, null),
        match_probability: finiteNumber(candidate.match_probability, null)
      },
      source_trace: {
        analysis_run_id: event.analysis_run_id,
        source_record_id: event.source_record_id,
        provider: candidate.provider,
        workflow_action: workflowAction || null
      },
      training_eligible: false
    }));
}

async function dispatchPaddleOcr({ actionPlan }) {
  const actions = actionsForTool(actionPlan, "paddle_ocr");
  if (!actions.length) return defaultWorkflowSidecars().paddle_ocr;
  const cropTypes = [...new Set(actions.flatMap((action) => action.payload?.input_roles || []))];
  return {
    ...defaultWorkflowSidecars().paddle_ocr,
    ...sidecarActionSummary(actionPlan, "paddle_ocr"),
    status: workflowSidecarStatuses.QUEUED,
    task_count: actions.reduce((count, action) => count + (action.payload?.task_ids?.length || 1), 0),
    crop_types: cropTypes,
    reason: "field_ocr_verifier_queued"
  };
}

async function dispatchSplink({ event, config, actionPlan, fetchImpl }) {
  const actions = actionsForTool(actionPlan, "splink");
  if (!actions.length) return defaultWorkflowSidecars().splink;
  const primaryAction = actions[0];
  try {
    if (!config.splinkLookupEnabled || !supabaseConfigured({
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey
    })) {
      return {
        ...sidecarActionSummary(actionPlan, "splink"),
        status: workflowSidecarStatuses.QUEUED,
        cluster_id: null,
        duplicate_warning: true,
        match_probability: null,
        reason: "cluster_lookup_stub_queued"
      };
    }

    const candidateIds = [
      ...(event.catalog_candidates || []),
      ...(event.vector_candidates || [])
    ].map((candidate) => candidate.candidate_id).filter(Boolean).slice(0, 10);
    const query = candidateIds.length
      ? `?select=cluster_id,canonical_fields,confidence,match_probability,source_record_ids,review_status&or=(${candidateIds.map((id) => `source_record_ids.cs.%5B%22${encodeURIComponent(id)}%22%5D`).join(",")})&limit=5`
      : "?select=cluster_id,canonical_fields,confidence,match_probability,source_record_ids,review_status&limit=1";
    const rows = await supabaseSelectRows({
      config,
      table: catalogEntityClustersTable,
      query,
      fetchImpl
    });
    const top = rows[0] || null;
    return {
      ...sidecarActionSummary(actionPlan, "splink"),
      status: workflowSidecarStatuses.COMPLETED,
      cluster_id: top?.cluster_id || null,
      duplicate_warning: rows.length > 1 || (event.catalog_candidates || []).length > 1,
      match_probability: finiteNumber(top?.match_probability, null),
      reason: rows.length ? "cluster_lookup_completed" : "no_cluster_match",
      action_id: primaryAction.workflow_action_id
    };
  } catch (error) {
    return { ...defaultWorkflowSidecars().splink, ...sidecarActionSummary(actionPlan, "splink"), ...sidecarFailure(error), duplicate_warning: true };
  }
}

async function dispatchCleanlab({ event, config, actionPlan, fetchImpl }) {
  const actions = actionsForTool(actionPlan, "cleanlab");
  if (!actions.length) return defaultWorkflowSidecars().cleanlab;
  const primaryAction = actions[0];
  try {
    const row = qualityFindingRow(event, primaryAction);
    if (config.eventLogEnabled) {
      await supabaseInsertRows({
        config,
        table: qualityFindingsTable,
        rows: [row],
        onConflict: "idempotency_key",
        upsert: true,
        fetchImpl
      });
      return {
        ...sidecarActionSummary(actionPlan, "cleanlab"),
        status: workflowSidecarStatuses.CREATED,
        quality_finding_count: 1,
        review_priority: reviewPriority(event),
        reason: "quality_finding_stub_created"
      };
    }
    return {
      ...sidecarActionSummary(actionPlan, "cleanlab"),
      status: workflowSidecarStatuses.QUEUED,
      quality_finding_count: 1,
      review_priority: reviewPriority(event),
      reason: "quality_finding_stub_queued"
    };
  } catch (error) {
    return { ...defaultWorkflowSidecars().cleanlab, ...sidecarActionSummary(actionPlan, "cleanlab"), ...sidecarFailure(error) };
  }
}

async function dispatchAnnotationTool({ event, config, actionPlan, tool, fetchImpl }) {
  const defaults = defaultWorkflowSidecars()[tool === "cvat" ? "cvat" : "label_studio"];
  const actions = actionsForTool(actionPlan, tool);
  if (!actions.length) return defaults;
  const primaryAction = actions[0];

  try {
    const configured = tool === "cvat"
      ? Boolean(config.cvatUrl && config.cvatToken)
      : Boolean(config.labelStudioUrl && config.labelStudioToken);
    const row = annotationTaskPayload(event, tool, primaryAction);
    if (config.eventLogEnabled) {
      row.status = configured ? "QUEUED" : "NOT_CONFIGURED";
      await supabaseInsertRows({
        config,
        table: annotationTasksTable,
        rows: [row],
        onConflict: "idempotency_key",
        upsert: true,
        fetchImpl
      });
    }

    if (!configured) {
      return {
        ...defaults,
        ...sidecarActionSummary(actionPlan, tool),
        status: workflowSidecarStatuses.NOT_CONFIGURED,
        task_created: false,
        reason: `${tool}_env_missing`
      };
    }

    if (!config.externalTaskCreationEnabled) {
      return {
        ...defaults,
        ...sidecarActionSummary(actionPlan, tool),
        status: workflowSidecarStatuses.QUEUED,
        task_created: false,
        reason: `${tool}_adapter_stub_queued`
      };
    }

    return {
      ...defaults,
      ...sidecarActionSummary(actionPlan, tool),
      status: workflowSidecarStatuses.QUEUED,
      task_created: false,
      reason: `${tool}_external_creation_disabled_in_stub`
    };
  } catch (error) {
    return { ...defaults, ...sidecarActionSummary(actionPlan, tool), ...sidecarFailure(error) };
  }
}

async function dispatchFiftyOne({ event, config, actionPlan, fetchImpl }) {
  const actions = actionsForTool(actionPlan, "fiftyone");
  if (!actions.length) return defaultWorkflowSidecars().fiftyone;
  const primaryAction = actions[0];
  const sampleId = `${event.analysis_run_id || "analysis"}_${event.event_id}`.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 120);
  try {
    if (config.eventLogEnabled) {
      const rows = hardNegativeRows(event, primaryAction);
      if (rows.length) {
        await supabaseInsertRows({
          config,
          table: hardNegativeExamplesTable,
          rows,
          onConflict: "idempotency_key",
          upsert: true,
          fetchImpl
        });
      }
    }

    if (config.fiftyOneExportEnabled) {
      await mkdir(config.fiftyOneExportDir, { recursive: true });
      const samplePath = join(config.fiftyOneExportDir, `${sampleId}.json`);
      await writeFile(samplePath, `${JSON.stringify({
        dataset_name: config.fiftyOneDatasetName,
        sample_id: sampleId,
        event,
        workflow_action_plan: actionPlan
      }, null, 2)}\n`);
      return {
        ...sidecarActionSummary(actionPlan, "fiftyone"),
        status: workflowSidecarStatuses.COMPLETED,
        sample_exported: true,
        dataset_name: config.fiftyOneDatasetName,
        sample_id: sampleId,
        reason: "fiftyone_manifest_exported"
      };
    }

    return {
      ...sidecarActionSummary(actionPlan, "fiftyone"),
      status: workflowSidecarStatuses.QUEUED,
      sample_exported: false,
      dataset_name: config.fiftyOneDatasetName,
      sample_id: sampleId,
      reason: "fiftyone_manifest_export_queued"
    };
  } catch (error) {
    return { ...defaultWorkflowSidecars().fiftyone, ...sidecarActionSummary(actionPlan, "fiftyone"), ...sidecarFailure(error) };
  }
}

async function persistRecognitionWorkflowEvent({ event, actionPlan, config, fetchImpl }) {
  if (!config.eventLogEnabled) return { saved: false, reason: "event_log_disabled" };
  await supabaseInsertRows({
    config,
    table: recognitionEventsTable,
    rows: [{
      event_id: event.event_id,
      analysis_run_id: event.analysis_run_id,
      asset_id: event.asset_id,
      source_record_id: event.source_record_id,
      event_payload: event,
      workflow_action_plan: actionPlan,
      dispatched_at: new Date().toISOString()
    }],
    fetchImpl
  });
  return { saved: true };
}

export function previewWorkflowSidecars({
  event,
  actionPlan = null,
  env = process.env
} = {}) {
  const config = configFromEnv(env);
  if (!config.sidecarsEnabled) return defaultWorkflowSidecars(workflowSidecarStatuses.NOT_TRIGGERED, "workflow_sidecars_disabled");
  if (!event) return defaultWorkflowSidecars();
  const plan = actionPlan || buildWorkflowActionPlan(event);
  const actions = (tool) => actionsForTool(plan, tool);
  return {
    paddle_ocr: actions("paddle_ocr").length
      ? {
        ...defaultWorkflowSidecars().paddle_ocr,
        ...sidecarActionSummary(plan, "paddle_ocr"),
        status: workflowSidecarStatuses.QUEUED,
        task_count: actions("paddle_ocr").reduce((count, item) => count + (item.payload?.task_ids?.length || 1), 0),
        crop_types: [...new Set(actions("paddle_ocr").flatMap((item) => item.payload?.input_roles || []))],
        reason: "field_ocr_verifier_queued_async"
      }
      : defaultWorkflowSidecars().paddle_ocr,
    splink: actions("splink").length
      ? {
        ...sidecarActionSummary(plan, "splink"),
        status: workflowSidecarStatuses.QUEUED,
        cluster_id: null,
        duplicate_warning: true,
        match_probability: null,
        reason: "cluster_lookup_queued_async"
      }
      : defaultWorkflowSidecars().splink,
    cleanlab: actions("cleanlab").length
      ? {
        ...sidecarActionSummary(plan, "cleanlab"),
        status: workflowSidecarStatuses.QUEUED,
        quality_finding_count: 1,
        review_priority: reviewPriority(event),
        reason: "quality_finding_queued_async"
      }
      : defaultWorkflowSidecars().cleanlab,
    label_studio: actions("label_studio").length
      ? {
        ...defaultWorkflowSidecars().label_studio,
        ...sidecarActionSummary(plan, "label_studio"),
        status: config.labelStudioUrl && config.labelStudioToken
          ? workflowSidecarStatuses.QUEUED
          : workflowSidecarStatuses.NOT_CONFIGURED,
        reason: config.labelStudioUrl && config.labelStudioToken
          ? "label_studio_task_queued_async"
          : "label_studio_env_missing"
      }
      : defaultWorkflowSidecars().label_studio,
    cvat: actions("cvat").length
      ? {
        ...defaultWorkflowSidecars().cvat,
        ...sidecarActionSummary(plan, "cvat"),
        status: config.cvatUrl && config.cvatToken
          ? workflowSidecarStatuses.QUEUED
          : workflowSidecarStatuses.NOT_CONFIGURED,
        reason: config.cvatUrl && config.cvatToken
          ? "cvat_task_queued_async"
          : "cvat_env_missing"
      }
      : defaultWorkflowSidecars().cvat,
    fiftyone: actions("fiftyone").length
      ? {
        ...sidecarActionSummary(plan, "fiftyone"),
        status: workflowSidecarStatuses.QUEUED,
        sample_exported: false,
        dataset_name: config.fiftyOneDatasetName,
        sample_id: `${event.analysis_run_id || "analysis"}_${event.event_id}`.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 120),
        reason: "fiftyone_export_queued_async"
      }
      : defaultWorkflowSidecars().fiftyone
  };
}

export async function dispatchWorkflowSidecars({
  event,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = configFromEnv(env);
  const defaults = defaultWorkflowSidecars();
  if (!config.sidecarsEnabled) return defaultWorkflowSidecars(workflowSidecarStatuses.NOT_TRIGGERED, "workflow_sidecars_disabled");
  if (!event) return defaults;

  const actionPlan = buildWorkflowActionPlan(event);
  await persistRecognitionWorkflowEvent({ event, actionPlan, config, fetchImpl }).catch(() => null);
  const [paddleOcr, splink, cleanlab, labelStudio, cvat, fiftyone] = await Promise.all([
    dispatchPaddleOcr({ actionPlan }),
    dispatchSplink({ event, config, actionPlan, fetchImpl }),
    dispatchCleanlab({ event, config, actionPlan, fetchImpl }),
    dispatchAnnotationTool({ event, config, actionPlan, tool: "label_studio", fetchImpl }),
    dispatchAnnotationTool({ event, config, actionPlan, tool: "cvat", fetchImpl }),
    dispatchFiftyOne({ event, config, actionPlan, fetchImpl })
  ]);

  return {
    paddle_ocr: paddleOcr,
    splink,
    cleanlab,
    label_studio: labelStudio,
    cvat,
    fiftyone
  };
}

export async function attachWorkflowSidecarsToListingResult({
  result = {},
  payload = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  scheduler = null
} = {}) {
  try {
    const event = buildRecognitionWorkflowEvent({
      result,
      payload,
      timing: result.timing
    });
    const config = configFromEnv(env);
    const actionPlan = buildWorkflowActionPlan(event);
    if (!config.awaitDispatch) {
      const sidecars = previewWorkflowSidecars({ event, actionPlan, env });
      const dispatchPromise = dispatchWorkflowSidecars({ event, env, fetchImpl }).catch(() => null);
      if (typeof scheduler === "function") {
        scheduler(dispatchPromise);
      } else {
        dispatchPromise.catch(() => null);
      }
      return mergeWorkflowSidecars(result, sidecars);
    }
    const sidecars = await dispatchWorkflowSidecars({ event, env, fetchImpl });
    return mergeWorkflowSidecars(result, sidecars);
  } catch (error) {
    return mergeWorkflowSidecars(result, defaultWorkflowSidecars(workflowSidecarStatuses.FAILED, cleanText(error?.message || "workflow_sidecar_failed")));
  }
}
