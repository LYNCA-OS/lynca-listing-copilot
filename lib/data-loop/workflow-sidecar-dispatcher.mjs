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
import { buildWorkflowSummary } from "./workflow-summary.mjs";
import { createPaddleOcrClient } from "../listing/ocr/paddle-ocr-client.mjs";

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
  return Boolean(normalizeBaseUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) && cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY));
}

function configFromEnv(env = process.env) {
  return {
    supabaseUrl: normalizeBaseUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY),
    sidecarsEnabled: workflowSidecarsEnabled(env),
    awaitDispatch: boolValue(env.DATA_LOOP_SIDECAR_AWAIT_DISPATCH, false),
    eventLogEnabled: boolValue(env.DATA_LOOP_WORKFLOW_EVENT_LOG_ENABLED, false),
    paddleOcrDispatchEnabled: boolValue(env.DATA_LOOP_PADDLE_OCR_DISPATCH_ENABLED, false),
    splinkLookupEnabled: boolValue(env.DATA_LOOP_SPLINK_LOOKUP_ENABLED, false),
    splinkBatchEnabled: boolValue(env.DATA_LOOP_SPLINK_BATCH_ENABLED, false),
    splinkBatchUrl: normalizeBaseUrl(env.DATA_LOOP_SPLINK_BATCH_URL || env.SPLINK_BATCH_URL),
    splinkBatchToken: cleanText(env.DATA_LOOP_SPLINK_BATCH_TOKEN || env.SPLINK_BATCH_TOKEN),
    cleanlabScoreUrl: normalizeBaseUrl(env.DATA_LOOP_CLEANLAB_SCORE_URL || env.CLEANLAB_SCORE_URL),
    cleanlabScoreToken: cleanText(env.DATA_LOOP_CLEANLAB_SCORE_TOKEN || env.CLEANLAB_SCORE_TOKEN || env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET),
    externalTaskCreationEnabled: boolValue(env.DATA_LOOP_EXTERNAL_TASK_CREATION_ENABLED, false),
    internalAnnotationQueueEnabled: boolValue(env.DATA_LOOP_INTERNAL_ANNOTATION_QUEUE_ENABLED, false),
    fiftyOneExportEnabled: boolValue(env.DATA_LOOP_FIFTYONE_EXPORT_ENABLED, false),
    fiftyOneSyncUrl: normalizeBaseUrl(env.DATA_LOOP_FIFTYONE_SYNC_URL || env.FIFTYONE_SYNC_URL),
    fiftyOneSyncToken: cleanText(env.DATA_LOOP_FIFTYONE_SYNC_TOKEN || env.FIFTYONE_SYNC_TOKEN || env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET),
    fiftyOneExportDir: cleanText(env.DATA_LOOP_FIFTYONE_EXPORT_DIR) || "data/eval/fiftyone-sidecar",
    fiftyOneDatasetName: cleanText(env.DATA_LOOP_FIFTYONE_DATASET_NAME) || "lynca_listing_workflow_sidecar",
    labelStudioUrl: normalizeBaseUrl(env.LABEL_STUDIO_URL),
    labelStudioToken: cleanText(env.LABEL_STUDIO_TOKEN),
    labelStudioProjectId: cleanText(env.LABEL_STUDIO_PROJECT_ID || env.DATA_LOOP_LABEL_STUDIO_PROJECT_ID),
    cvatUrl: normalizeBaseUrl(env.CVAT_URL),
    cvatToken: cleanText(env.CVAT_TOKEN),
    cvatProjectId: cleanText(env.CVAT_PROJECT_ID || env.DATA_LOOP_CVAT_PROJECT_ID),
    lightGbmShadowEnabled: boolValue(env.DATA_LOOP_LIGHTGBM_SHADOW_ENABLED, true),
    lightGbmUrl: normalizeBaseUrl(env.DATA_LOOP_LIGHTGBM_RERANKER_URL || env.LIGHTGBM_RERANKER_URL),
    lightGbmToken: cleanText(env.DATA_LOOP_LIGHTGBM_RERANKER_TOKEN || env.LIGHTGBM_RERANKER_TOKEN || env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET),
    phoenixEndpoint: normalizeBaseUrl(env.PHOENIX_COLLECTOR_ENDPOINT || env.PHOENIX_ENDPOINT || env.DATA_LOOP_PHOENIX_ENDPOINT),
    phoenixApiKey: cleanText(env.PHOENIX_API_KEY || env.DATA_LOOP_PHOENIX_API_KEY || env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET)
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

function bearerHeaders(token = "", extra = {}) {
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

async function postJson({
  url,
  token = "",
  body = {},
  fetchImpl = globalThis.fetch,
  headers = {}
}) {
  if (!url) throw new Error("url_missing");
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: bearerHeaders(token, headers),
    body: JSON.stringify(body)
  });
  const payload = await readResponseJson(response);
  if (!response.ok) {
    const message = payload?.message || payload?.error || JSON.stringify(payload || {}).slice(0, 180);
    throw new Error(`HTTP ${response.status} ${message}`);
  }
  return payload;
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

function catalogGapEligibilityFromResult(result = {}) {
  const cGroup = result.c_group_diagnostics && typeof result.c_group_diagnostics === "object"
    ? result.c_group_diagnostics
    : {};
  const eligibility = result.catalog_assist_eligibility
    || cGroup.catalog_assist_eligibility
    || result.open_set_readiness?.catalog?.eligibility
    || {};
  const openSet = result.open_set_readiness && typeof result.open_set_readiness === "object"
    ? result.open_set_readiness
    : {};
  const promptCandidateCount = finiteNumber(
    eligibility.prompt_candidate_count ?? openSet.prompt_safe_candidate_count,
    0
  );
  const rawCandidateCount = finiteNumber(
    eligibility.raw_candidate_count ?? openSet.raw_candidate_count,
    0
  );
  const approvedCandidateCount = finiteNumber(
    eligibility.approved_candidate_count ?? openSet.approved_candidate_count,
    0
  );
  const conflictBlockedCount = finiteNumber(
    eligibility.conflict_blocked_count ?? openSet.conflict_blocked_count,
    0
  );
  const hasCandidateSignal = rawCandidateCount > 0 || approvedCandidateCount > 0 || conflictBlockedCount > 0;
  const nestedSignal = openSet.catalog_gap_queue_candidate === true
    || openSet.fail_closed_candidate === true
    || /NO_CATALOG|OPEN_SET|CATALOG_GAP|NO_EXACT|FAIL_CLOSED|EVIDENCE_BACKED_NO_CATALOG/i.test(cleanText(openSet.status));
  const cGroupSignal = promptCandidateCount === 0
    && hasCandidateSignal
    && /direct_conflict|no_prompt|catalog_gap|no_exact|fail_closed|reference_candidates_only|candidate/i.test(cleanText(eligibility.reason || openSet.status || ""));

  return {
    is_gap: result.catalog_gap_queue_candidate === true || nestedSignal || cGroupSignal,
    prompt_candidate_count: promptCandidateCount,
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: approvedCandidateCount,
    conflict_blocked_count: conflictBlockedCount,
    reason: cleanText(result.open_set_status || result.cold_start_status || eligibility.reason || openSet.status || "no_prompt_safe_catalog_candidate") || "no_prompt_safe_catalog_candidate"
  };
}

function catalogGapCandidateSnapshots(result = {}) {
  const direct = Array.isArray(result.catalog_candidates) ? result.catalog_candidates : [];
  const cGroup = Array.isArray(result.c_group_diagnostics?.catalog_candidate_debug)
    ? result.c_group_diagnostics.catalog_candidate_debug
    : [];
  const packet = Array.isArray(result.catalog_candidate_packet?.vector_retrieval?.candidates)
    ? result.catalog_candidate_packet.vector_retrieval.candidates
    : [];
  return [...direct, ...cGroup, ...packet]
    .filter((candidate) => candidate && typeof candidate === "object")
    .slice(0, 8)
    .map((candidate) => ({
      candidate_id: candidate.candidate_id || null,
      candidate_identity_id: candidate.candidate_identity_id || candidate.identity_id || null,
      reference_title: candidate.reference_title || candidate.title || null,
      source_trust: candidate.source_trust || null,
      prompt_admitted: candidate.prompt_admitted === true,
      prompt_blocked: candidate.prompt_blocked === true,
      conflicting_fields: candidate.conflicting_fields || candidate.direct_evidence_conflicts || candidate.conflicts || [],
      anchor_agreement: candidate.anchor_agreement || null
    }));
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

function runtimeImagesFromPayload(payload = {}) {
  return Array.isArray(payload.images) ? payload.images : [];
}

function imageUrlForOcr(image = {}) {
  return cleanText(image.signed_url || image.signedUrl || image.image_url || image.imageUrl || image.url || image.public_url || image.publicUrl);
}

function cropTypeFromInputRole(role = "") {
  const text = cleanText(role).toLowerCase();
  if (/serial/.test(text)) return "serial_number";
  if (/grade|slab/.test(text)) return "grade_label";
  if (/tcg/.test(text)) return "tcg_code";
  if (/card_code|collector|checklist|number/.test(text)) return "collector_number";
  if (/product|year|set/.test(text)) return "product_text";
  if (/subject|player|name/.test(text)) return "player_name";
  return "";
}

function selectRuntimeImage(runtimeImages = [], role = "") {
  const wanted = cleanText(role).toLowerCase();
  const candidates = runtimeImages.filter((image) => imageUrlForOcr(image));
  if (!candidates.length) return null;
  return candidates.find((image) => {
    const text = [
      image.role,
      image.image_role,
      image.storage_role,
      image.source_region,
      image.cropMetadata?.crop_role,
      image.crop_metadata?.crop_role
    ].filter(Boolean).join(" ").toLowerCase();
    return wanted && text.includes(wanted.replace(/_crop$/, ""));
  }) || candidates[0];
}

function ocrRequestsFromActions(actions = [], runtimeImages = [], event = {}) {
  const requests = [];
  for (const action of actions) {
    const roles = Array.isArray(action.payload?.input_roles) && action.payload.input_roles.length
      ? action.payload.input_roles
      : ["front"];
    const roleHints = [
      ...roles,
      ...(Array.isArray(action.payload?.affected_fields) ? action.payload.affected_fields : []),
      ...(Array.isArray(action.payload?.task_ids) ? action.payload.task_ids : [])
    ];
    for (const role of roleHints) {
      const cropType = cropTypeFromInputRole(role);
      if (!cropType) continue;
      const image = selectRuntimeImage(runtimeImages, role);
      const imageUrl = imageUrlForOcr(image || {});
      if (!imageUrl) continue;
      requests.push({
        request_id: `${action.workflow_action_id}:${role}`.slice(0, 160),
        image_url: imageUrl,
        crop_type: cropType,
        expected_pattern: "",
        metadata: {
          image_id: image?.image_id || image?.id || role,
          crop_id: role,
          analysis_run_id: event.analysis_run_id || null,
          workflow_action_id: action.workflow_action_id
        }
      });
    }
  }
  return requests.slice(0, 8);
}

async function dispatchPaddleOcr({ event, config, actionPlan, payload = {}, env = process.env, fetchImpl = globalThis.fetch }) {
  const actions = actionsForTool(actionPlan, "paddle_ocr");
  if (!actions.length) return defaultWorkflowSidecars().paddle_ocr;
  const cropTypes = [...new Set(actions.flatMap((action) => action.payload?.input_roles || []))];
  if (!config.paddleOcrDispatchEnabled) {
    return {
      ...defaultWorkflowSidecars().paddle_ocr,
      ...sidecarActionSummary(actionPlan, "paddle_ocr"),
      status: workflowSidecarStatuses.QUEUED,
      task_count: actions.reduce((count, action) => count + (action.payload?.task_ids?.length || 1), 0),
      crop_types: cropTypes,
      reason: "field_ocr_verifier_queued"
    };
  }
  const client = createPaddleOcrClient({ env, fetchImpl });
  if (!client.config.enabled || !client.config.configured) {
    return {
      ...defaultWorkflowSidecars().paddle_ocr,
      ...sidecarActionSummary(actionPlan, "paddle_ocr"),
      status: workflowSidecarStatuses.NOT_CONFIGURED,
      task_count: actions.reduce((count, action) => count + (action.payload?.task_ids?.length || 1), 0),
      crop_types: cropTypes,
      reason: client.config.reason || "paddle_ocr_not_configured"
    };
  }
  const requests = ocrRequestsFromActions(actions, runtimeImagesFromPayload(payload), event);
  if (!requests.length) {
    return {
      ...defaultWorkflowSidecars().paddle_ocr,
      ...sidecarActionSummary(actionPlan, "paddle_ocr"),
      status: workflowSidecarStatuses.QUEUED,
      task_count: actions.reduce((count, action) => count + (action.payload?.task_ids?.length || 1), 0),
      crop_types: cropTypes,
      reason: "field_ocr_worker_configured_but_no_runtime_image_url"
    };
  }
  try {
    const results = [];
    for (const request of requests) {
      results.push(await client.verifyCrop(request));
    }
    const allUnavailable = results.every((item) => {
      const status = cleanText(item?.worker_status).toUpperCase();
      return !item?.raw_text && /UNAVAILABLE|DISABLED|NOT_CONFIGURED|EMPTY|ERROR/.test(status);
    });
    if (allUnavailable) {
      return {
        ...defaultWorkflowSidecars().paddle_ocr,
        ...sidecarActionSummary(actionPlan, "paddle_ocr"),
        status: workflowSidecarStatuses.NOT_CONFIGURED,
        task_count: requests.length,
        crop_types: cropTypes,
        evidence_patch_count: 0,
        model_id: results[0]?.model_id || client.config.model_id,
        model_revision: results[0]?.model_revision || client.config.model_revision,
        reason: cleanText(results[0]?.worker_status || "field_ocr_worker_unavailable").toLowerCase()
      };
    }
    return {
      ...defaultWorkflowSidecars().paddle_ocr,
      ...sidecarActionSummary(actionPlan, "paddle_ocr"),
      status: workflowSidecarStatuses.COMPLETED,
      task_count: requests.length,
      crop_types: cropTypes,
      evidence_patch_count: results.filter((item) => item.evidence_patch).length,
      model_id: results[0]?.model_id || client.config.model_id,
      model_revision: results[0]?.model_revision || client.config.model_revision,
      reason: "field_ocr_worker_completed"
    };
  } catch (error) {
    return {
      ...defaultWorkflowSidecars().paddle_ocr,
      ...sidecarActionSummary(actionPlan, "paddle_ocr"),
      ...sidecarFailure(error),
      task_count: requests.length,
      crop_types: cropTypes
    };
  }
}

async function dispatchSplink({ event, config, actionPlan, fetchImpl }) {
  const actions = actionsForTool(actionPlan, "splink");
  if (!actions.length) return defaultWorkflowSidecars().splink;
  const primaryAction = actions[0];
  try {
    if (config.splinkBatchEnabled && config.splinkBatchUrl) {
      const payload = await postJson({
        url: config.splinkBatchUrl,
        token: config.splinkBatchToken,
        fetchImpl,
        body: {
          event,
          workflow_action: primaryAction,
          mode: "catalog_entity_cluster_batch",
          output_contract: primaryAction.output_contract
        }
      });
      return {
        ...sidecarActionSummary(actionPlan, "splink"),
        status: workflowSidecarStatuses.COMPLETED,
        cluster_id: payload?.cluster_id || payload?.clusterId || null,
        duplicate_warning: payload?.duplicate_warning === true || (event.catalog_candidates || []).length > 1,
        match_probability: finiteNumber(payload?.match_probability, null),
        reason: "cloud_batch_clustering_completed",
        action_id: primaryAction.workflow_action_id
      };
    }

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
    let externalScore = null;
    let externalPayload = null;
    if (config.cleanlabScoreUrl) {
      externalPayload = await postJson({
        url: config.cleanlabScoreUrl,
        token: config.cleanlabScoreToken,
        fetchImpl,
        body: {
          event,
          workflow_action: primaryAction,
          mode: "label_quality_score",
          output_contract: primaryAction.output_contract
        }
      });
      externalScore = finiteNumber(externalPayload?.label_quality_score ?? externalPayload?.score, null);
    }
    const row = {
      ...qualityFindingRow(event, primaryAction),
      ...(externalScore !== null ? { score: externalScore } : {}),
      workflow_payload: {
        ...primaryAction,
        cleanlab_score: externalScore,
        cleanlab_reason: externalPayload?.reason || externalPayload?.explanation || null
      }
    };
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
        label_quality_score: externalScore,
        reason: config.cleanlabScoreUrl ? "cleanlab_score_created" : "quality_finding_stub_created"
      };
    }
    return {
      ...sidecarActionSummary(actionPlan, "cleanlab"),
      status: workflowSidecarStatuses.QUEUED,
      quality_finding_count: 1,
      review_priority: reviewPriority(event),
      label_quality_score: externalScore,
      reason: config.cleanlabScoreUrl ? "cleanlab_score_queued_without_event_log" : "quality_finding_stub_queued"
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
      : Boolean(config.labelStudioUrl && config.labelStudioToken && config.labelStudioProjectId);
    const row = annotationTaskPayload(event, tool, primaryAction);
    if (config.eventLogEnabled) {
      row.status = configured || config.internalAnnotationQueueEnabled ? "QUEUED" : "NOT_CONFIGURED";
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
      if (config.internalAnnotationQueueEnabled && config.eventLogEnabled && supabaseConfigured({
        SUPABASE_URL: config.supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey
      })) {
        return {
          ...defaults,
          ...sidecarActionSummary(actionPlan, tool),
          status: workflowSidecarStatuses.CREATED,
          task_created: true,
          task_id: primaryAction.idempotency_key,
          review_url: null,
          reason: `${tool}_internal_queue_created`
        };
      }
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

    if (tool === "label_studio") {
      const payload = await postJson({
        url: `${config.labelStudioUrl}/api/projects/${encodeURIComponent(config.labelStudioProjectId)}/import`,
        token: config.labelStudioToken,
        fetchImpl,
        body: [{
          data: {
            source_record_id: event.source_record_id,
            analysis_run_id: event.analysis_run_id,
            images: event.images || [],
            final_title: event.final_title,
            rendered_title: event.rendered_title
          },
          predictions: [{
            model_version: "lynca-workflow-sidecar",
            result: row.prelabel_fields,
            score: 0
          }],
          meta: {
            workflow_action_id: primaryAction.workflow_action_id,
            review_required_fields: event.review_required_fields || [],
            risk_flags: event.risk_flags || []
          }
        }]
      });
      const taskId = payload?.task_count ? null : payload?.id || payload?.task_id || null;
      return {
        ...defaults,
        ...sidecarActionSummary(actionPlan, tool),
        status: workflowSidecarStatuses.CREATED,
        task_created: true,
        task_id: taskId,
        review_url: config.labelStudioUrl,
        reason: "label_studio_task_imported"
      };
    }

    if (tool === "cvat") {
      const labels = row.task_payload.crop_labels.map((name) => ({ name }));
      const payload = await postJson({
        url: `${config.cvatUrl}/api/tasks`,
        token: config.cvatToken,
        fetchImpl,
        body: {
          name: `LYNCA ${event.source_record_id || event.analysis_run_id || primaryAction.workflow_action_id}`,
          ...(config.cvatProjectId ? { project_id: Number(config.cvatProjectId) || config.cvatProjectId } : {}),
          labels,
          bug_tracker: "",
          subset: "workflow-sidecar"
        },
        headers: {
          // CVAT accepts Token auth in many deployments; Bearer remains the default
          // from postJson for hosted gateways that normalize auth headers.
          authorization: config.cvatToken ? `Token ${config.cvatToken}` : undefined
        }
      });
      return {
        ...defaults,
        ...sidecarActionSummary(actionPlan, tool),
        status: workflowSidecarStatuses.CREATED,
        task_created: true,
        task_id: payload?.id || payload?.task_id || null,
        review_url: payload?.url || config.cvatUrl,
        reason: "cvat_task_created"
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

    const manifest = {
      dataset_name: config.fiftyOneDatasetName,
      sample_id: sampleId,
      event,
      workflow_action_plan: actionPlan
    };

    if (config.fiftyOneSyncUrl) {
      await postJson({
        url: config.fiftyOneSyncUrl,
        token: config.fiftyOneSyncToken,
        fetchImpl,
        body: manifest
      });
      return {
        ...sidecarActionSummary(actionPlan, "fiftyone"),
        status: workflowSidecarStatuses.COMPLETED,
        sample_exported: true,
        dataset_name: config.fiftyOneDatasetName,
        sample_id: sampleId,
        reason: "fiftyone_cloud_gallery_synced"
      };
    }

    if (config.fiftyOneExportEnabled) {
      await mkdir(config.fiftyOneExportDir, { recursive: true });
      const samplePath = join(config.fiftyOneExportDir, `${sampleId}.json`);
      await writeFile(samplePath, `${JSON.stringify(manifest, null, 2)}\n`);
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

function shadowCandidateRows(event = {}) {
  return [
    ...(event.catalog_candidates || []).map((candidate) => ({ ...candidate, source_type: "catalog" })),
    ...(event.vector_candidates || []).map((candidate) => ({ ...candidate, source_type: "vector" }))
  ].slice(0, 30);
}

function heuristicShadowScore(candidate = {}) {
  const support = Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields.length : 0;
  const conflicts = Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields.length : 0;
  const trust = /APPROVED|OFFICIAL|REVIEWED/i.test(candidate.source_trust || "") ? 0.35 : 0;
  const score = (finiteNumber(candidate.normalized_score, 0) * 0.45) + (support * 0.08) + trust - (conflicts * 0.25);
  return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}

async function dispatchLightGbm({ event, config, actionPlan, fetchImpl }) {
  const actions = actionsForTool(actionPlan, "lightgbm");
  if (!actions.length) return defaultWorkflowSidecars().lightgbm;
  const candidates = shadowCandidateRows(event);
  if (!candidates.length) return defaultWorkflowSidecars().lightgbm;
  const primaryAction = actions[0];
  try {
    if (!config.lightGbmShadowEnabled) {
      return {
        ...defaultWorkflowSidecars().lightgbm,
        ...sidecarActionSummary(actionPlan, "lightgbm"),
        status: workflowSidecarStatuses.NOT_TRIGGERED,
        candidate_count: candidates.length,
        reason: "lightgbm_shadow_disabled"
      };
    }
    let scored = null;
    if (config.lightGbmUrl) {
      scored = await postJson({
        url: config.lightGbmUrl,
        token: config.lightGbmToken,
        fetchImpl,
        body: {
          event_id: event.event_id,
          analysis_run_id: event.analysis_run_id,
          candidates,
          workflow_action: primaryAction,
          shadow_only: true
        }
      });
    }
    const selectedCandidateId = scored?.selected_candidate_id
      || scored?.selectedCandidateId
      || candidates
        .map((candidate) => ({ candidate, score: heuristicShadowScore(candidate) }))
        .sort((left, right) => right.score - left.score)[0]?.candidate?.candidate_id
      || null;
    return {
      ...defaultWorkflowSidecars().lightgbm,
      ...sidecarActionSummary(actionPlan, "lightgbm"),
      status: config.lightGbmUrl ? workflowSidecarStatuses.COMPLETED : workflowSidecarStatuses.QUEUED,
      shadow_scored: Boolean(config.lightGbmUrl),
      candidate_count: candidates.length,
      selected_candidate_id: selectedCandidateId,
      shadow_score: finiteNumber(scored?.score ?? scored?.shadow_score, null),
      reason: config.lightGbmUrl ? "lightgbm_shadow_reranker_completed" : "lightgbm_shadow_reranker_queued"
    };
  } catch (error) {
    return { ...defaultWorkflowSidecars().lightgbm, ...sidecarActionSummary(actionPlan, "lightgbm"), ...sidecarFailure(error), candidate_count: candidates.length };
  }
}

function phoenixTracePayload(event = {}, actionPlan = {}) {
  return {
    resource: {
      service_name: "lynca-listing-copilot",
      workflow: "listing-recognition"
    },
    spans: [{
      name: "listing.recognition.workflow",
      trace_id: event.event_id,
      span_id: event.analysis_run_id,
      attributes: {
        provider_mode: event.provider_mode,
        source_record_id: event.source_record_id,
        asset_id: event.asset_id,
        risk_flags: event.risk_flags || [],
        review_required_fields: event.review_required_fields || [],
        workflow_action_count: actionPlan.actions?.length || 0,
        timing: event.timing || {}
      }
    }]
  };
}

async function dispatchPhoenix({ event, config, actionPlan, fetchImpl }) {
  const actions = actionsForTool(actionPlan, "phoenix");
  if (!actions.length) return defaultWorkflowSidecars().phoenix;
  try {
    if (!config.phoenixEndpoint) {
      return {
        ...defaultWorkflowSidecars().phoenix,
        ...sidecarActionSummary(actionPlan, "phoenix"),
        status: workflowSidecarStatuses.NOT_CONFIGURED,
        span_count: 1,
        reason: "phoenix_endpoint_missing"
      };
    }
    await postJson({
      url: config.phoenixEndpoint,
      token: config.phoenixApiKey,
      fetchImpl,
      body: phoenixTracePayload(event, actionPlan)
    });
    return {
      ...defaultWorkflowSidecars().phoenix,
      ...sidecarActionSummary(actionPlan, "phoenix"),
      status: workflowSidecarStatuses.COMPLETED,
      trace_exported: true,
      span_count: 1,
      reason: "phoenix_trace_exported"
    };
  } catch (error) {
    return { ...defaultWorkflowSidecars().phoenix, ...sidecarActionSummary(actionPlan, "phoenix"), ...sidecarFailure(error), span_count: 1 };
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
        status: (config.labelStudioUrl && config.labelStudioToken) || config.internalAnnotationQueueEnabled
          ? workflowSidecarStatuses.QUEUED
          : workflowSidecarStatuses.NOT_CONFIGURED,
        reason: config.labelStudioUrl && config.labelStudioToken
          ? "label_studio_task_queued_async"
          : config.internalAnnotationQueueEnabled
            ? "label_studio_internal_queue_queued_async"
          : "label_studio_env_missing"
      }
      : defaultWorkflowSidecars().label_studio,
    cvat: actions("cvat").length
      ? {
        ...defaultWorkflowSidecars().cvat,
        ...sidecarActionSummary(plan, "cvat"),
        status: (config.cvatUrl && config.cvatToken) || config.internalAnnotationQueueEnabled
          ? workflowSidecarStatuses.QUEUED
          : workflowSidecarStatuses.NOT_CONFIGURED,
        reason: config.cvatUrl && config.cvatToken
          ? "cvat_task_queued_async"
          : config.internalAnnotationQueueEnabled
            ? "cvat_internal_queue_queued_async"
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
      : defaultWorkflowSidecars().fiftyone,
    lightgbm: actions("lightgbm").length
      ? {
        ...defaultWorkflowSidecars().lightgbm,
        ...sidecarActionSummary(plan, "lightgbm"),
        status: config.lightGbmShadowEnabled
          ? workflowSidecarStatuses.QUEUED
          : workflowSidecarStatuses.NOT_TRIGGERED,
        candidate_count: shadowCandidateRows(event).length,
        reason: config.lightGbmShadowEnabled
          ? "lightgbm_shadow_reranker_queued_async"
          : "lightgbm_shadow_disabled"
      }
      : defaultWorkflowSidecars().lightgbm,
    phoenix: actions("phoenix").length
      ? {
        ...defaultWorkflowSidecars().phoenix,
        ...sidecarActionSummary(plan, "phoenix"),
        status: config.phoenixEndpoint
          ? workflowSidecarStatuses.QUEUED
          : workflowSidecarStatuses.NOT_CONFIGURED,
        span_count: 1,
        reason: config.phoenixEndpoint
          ? "phoenix_trace_queued_async"
          : "phoenix_endpoint_missing"
      }
      : defaultWorkflowSidecars().phoenix
  };
}


// A4: the response has flagged catalog_gap_queue_candidate since the C-group
// evals began (48/50 on eBay C50), but nothing ever persisted the gap - the
// flywheel table stayed at 0 rows. Persist a pending gap row (deduped per
// asset) so writers can promote missing identities into the catalog.
async function dispatchCatalogGapQueue({ result = {}, config, payload = {}, fetchImpl = globalThis.fetch }) {
  try {
    const gapEligibility = catalogGapEligibilityFromResult(result);
    if (gapEligibility.is_gap !== true) {
      return { status: workflowSidecarStatuses.NOT_TRIGGERED, reason: "not_a_catalog_gap_candidate" };
    }
    if (!supabaseConfigured({
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey
    })) {
      return { status: workflowSidecarStatuses.NOT_TRIGGERED, reason: "supabase_not_configured" };
    }
    const assetId = cleanText(result.asset_id || payload.assetId || payload.asset_id);
    if (!assetId) return { status: workflowSidecarStatuses.NOT_TRIGGERED, reason: "asset_id_missing" };
    const tenantId = cleanText(result.tenant_id || result.tenantId || payload.tenant_id || payload.tenantId);
    if (!tenantId) return { status: workflowSidecarStatuses.NOT_TRIGGERED, reason: "tenant_id_missing" };

    const existing = await supabaseSelectRows({
      config,
      table: "catalog_gap_queue",
      query: `?tenant_id=eq.${encodeURIComponent(tenantId)}&asset_id=eq.${encodeURIComponent(assetId)}&status=eq.PENDING&select=gap_id&limit=1`,
      fetchImpl
    });
    if (existing.length) {
      return { status: workflowSidecarStatuses.NOT_TRIGGERED, reason: "pending_gap_exists", gap_id: existing[0].gap_id || null };
    }

    const resolved = result.resolved || result.resolved_fields || {};
    const rendered = result.rendered_fields?.fields && typeof result.rendered_fields.fields === "object"
      ? result.rendered_fields.fields
      : result.rendered_fields || {};
    const rawProvider = result.raw_provider_fields || result.provider_fields || result.fields || {};
    const firstFieldValue = (field) => {
      for (const source of [resolved, rendered, rawProvider]) {
        const value = source?.[field];
        if (value === undefined || value === null || value === "") continue;
        if (Array.isArray(value) && !value.length) continue;
        return value;
      }
      return undefined;
    };
    const identityFields = {};
    for (const field of [
      "category",
      "sport",
      "language",
      "year",
      "manufacturer",
      "brand",
      "product",
      "set",
      "subset",
      "insert",
      "players",
      "player",
      "subject",
      "character",
      "team",
      "card_name",
      "card_number",
      "collector_number",
      "checklist_code",
      "official_card_type",
      "card_type",
      "release_variant",
      "variation",
      "parallel",
      "parallel_family",
      "parallel_exact",
      "surface_color",
      "print_finish",
      "descriptive_rarity",
      "special_stamp",
      "rc",
      "first_bowman",
      "auto",
      "patch",
      "relic",
      "jersey",
      "memorabilia",
      "ssp",
      "case_hit",
      "observable_components",
      "expected_serial_denominator",
      "serial_denominator",
      "numbered_to"
    ]) {
      const value = firstFieldValue(field);
      if (value !== undefined && value !== null && value !== "") identityFields[field] = value;
    }
    const instanceFields = {};
    for (const field of [
      "serial_number",
      "print_run_number",
      "print_run_numerator",
      "print_run_denominator",
      "numerical_rarity",
      "grade_company",
      "card_grade",
      "auto_grade",
      "grade_type",
      "cert_number"
    ]) {
      const value = firstFieldValue(field);
      if (value !== undefined && value !== null && value !== "") instanceFields[field] = value;
    }
    const imageIds = (Array.isArray(payload.images) ? payload.images : [])
      .map((image) => cleanText(image?.image_id || image?.id || image?.name))
      .filter(Boolean);
    const internalCandidates = catalogGapCandidateSnapshots(result);

    const [row] = await supabaseInsertRows({
      config,
      table: "catalog_gap_queue",
      rows: [{
        tenant_id: tenantId,
        asset_id: assetId,
        gap_reason: gapEligibility.reason,
        status: "PENDING",
        source_batch: cleanText(payload.source_batch || payload.sourceBatch || "listing_api") || "listing_api",
        proposed_identity_fields: identityFields,
        proposed_instance_fields: instanceFields,
        observed_fields: {
          ...identityFields,
          current_image_instance: instanceFields
        },
        ai_draft_title: cleanText(result.final_title || result.title) || null,
        cold_start_status: cleanText(result.cold_start_status) || null,
        writer_action_required: result.writer_action_required === true,
        unresolved_fields: (Array.isArray(result.unresolved) ? result.unresolved : []).slice(0, 12),
        query_image_ids: imageIds,
        image_ids: imageIds,
        internal_candidates: internalCandidates,
        metadata: {
          provider: result.provider || result.source || null,
          open_set_status: result.open_set_status || null,
          recorded_by: "workflow_sidecar_dispatcher",
          catalog_gap_eligibility: gapEligibility,
          raw_provider_fields: rawProvider && typeof rawProvider === "object" && !Array.isArray(rawProvider) ? rawProvider : null,
          rendered_fields: rendered && typeof rendered === "object" && !Array.isArray(rendered) ? rendered : null
        }
      }],
      fetchImpl
    });
    return { status: workflowSidecarStatuses.DISPATCHED, gap_id: row?.gap_id || null };
  } catch (error) {
    return { status: workflowSidecarStatuses.FAILED, reason: cleanText(error?.message || "catalog_gap_queue_failed").slice(0, 160) };
  }
}

export async function dispatchWorkflowSidecars({
  event,
  env = process.env,
  fetchImpl = globalThis.fetch,
  payload = {},
  result = {}
} = {}) {
  const config = configFromEnv(env);
  const defaults = defaultWorkflowSidecars();
  if (!config.sidecarsEnabled) return defaultWorkflowSidecars(workflowSidecarStatuses.NOT_TRIGGERED, "workflow_sidecars_disabled");
  if (!event) return defaults;

  const actionPlan = buildWorkflowActionPlan(event);
  await persistRecognitionWorkflowEvent({ event, actionPlan, config, fetchImpl }).catch(() => null);
  const [paddleOcr, splink, cleanlab, labelStudio, cvat, fiftyone, lightgbm, phoenix, catalogGapQueue] = await Promise.all([
    dispatchPaddleOcr({ event, config, actionPlan, payload, env, fetchImpl }),
    dispatchSplink({ event, config, actionPlan, fetchImpl }),
    dispatchCleanlab({ event, config, actionPlan, fetchImpl }),
    dispatchAnnotationTool({ event, config, actionPlan, tool: "label_studio", fetchImpl }),
    dispatchAnnotationTool({ event, config, actionPlan, tool: "cvat", fetchImpl }),
    dispatchFiftyOne({ event, config, actionPlan, fetchImpl }),
    dispatchLightGbm({ event, config, actionPlan, fetchImpl }),
    dispatchPhoenix({ event, config, actionPlan, fetchImpl }),
    dispatchCatalogGapQueue({ result, config, payload, fetchImpl })
  ]);

  return {
    paddle_ocr: paddleOcr,
    splink,
    cleanlab,
    label_studio: labelStudio,
    cvat,
    fiftyone,
    lightgbm,
    phoenix,
    catalog_gap_queue: catalogGapQueue
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
      const dispatchPromise = dispatchWorkflowSidecars({ event, env, fetchImpl, payload, result }).catch(() => null);
      if (typeof scheduler === "function") {
        scheduler(dispatchPromise);
      } else {
        dispatchPromise.catch(() => null);
      }
      const merged = mergeWorkflowSidecars(result, sidecars);
      return {
        ...merged,
        workflow_summary: buildWorkflowSummary({ result: merged, event, actionPlan, sidecars })
      };
    }
    const sidecars = await dispatchWorkflowSidecars({ event, env, fetchImpl, payload, result });
    const merged = mergeWorkflowSidecars(result, sidecars);
    return {
      ...merged,
      workflow_summary: buildWorkflowSummary({ result: merged, event, actionPlan, sidecars })
    };
  } catch (error) {
    const sidecars = defaultWorkflowSidecars(workflowSidecarStatuses.FAILED, cleanText(error?.message || "workflow_sidecar_failed"));
    const merged = mergeWorkflowSidecars(result, sidecars);
    return {
      ...merged,
      workflow_summary: buildWorkflowSummary({ result: merged, sidecars })
    };
  }
}
