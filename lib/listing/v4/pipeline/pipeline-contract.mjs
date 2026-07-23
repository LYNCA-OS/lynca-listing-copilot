import { candidateSelectionHeuristicVersion } from "../../candidates/candidate-selection-pass.mjs";
import { v4ProductionStrategyProfile } from "../policy/production-strategy.mjs";
import { buildShadowRecognitionPolicyAudit } from "../policy/recognition-policy-observer.mjs";
import { buildRetrievalSourceContract } from "./retrieval-source-contract.mjs";

export const v4PipelineStages = Object.freeze({
  INPUT: "input_contract",
  PREINGESTION: "preingestion_evidence",
  ROUTE: "route_planning",
  OBSERVATION: "observation",
  RETRIEVAL: "retrieval",
  CANDIDATE_DECISION: "candidate_decision",
  FIELD_RESOLUTION: "field_resolution",
  RENDERER: "renderer",
  PERSISTENCE: "persistence"
});

export const v4DecisionOwners = Object.freeze({
  [v4PipelineStages.INPUT]: "V4_INPUT_CONTRACT",
  [v4PipelineStages.PREINGESTION]: "PREINGESTION_EVIDENCE",
  [v4PipelineStages.ROUTE]: "TYPED_ANCHOR_ROUTE_PLANNER",
  [v4PipelineStages.OBSERVATION]: "PROVIDER_OBSERVATION",
  [v4PipelineStages.RETRIEVAL]: "RETRIEVAL_ORCHESTRATOR",
  [v4PipelineStages.CANDIDATE_DECISION]: "CANDIDATE_CONTROL_PLANE",
  [v4PipelineStages.FIELD_RESOLUTION]: "IDENTITY_RESOLUTION",
  [v4PipelineStages.RENDERER]: "DETERMINISTIC_RENDERER",
  [v4PipelineStages.PERSISTENCE]: "V4_PERSISTENCE"
});

export const v4PipelineTopology = Object.freeze({
  [v4PipelineStages.INPUT]: Object.freeze([]),
  [v4PipelineStages.PREINGESTION]: Object.freeze([v4PipelineStages.INPUT]),
  [v4PipelineStages.ROUTE]: Object.freeze([v4PipelineStages.PREINGESTION]),
  [v4PipelineStages.OBSERVATION]: Object.freeze([v4PipelineStages.ROUTE]),
  [v4PipelineStages.RETRIEVAL]: Object.freeze([v4PipelineStages.ROUTE]),
  [v4PipelineStages.CANDIDATE_DECISION]: Object.freeze([
    v4PipelineStages.OBSERVATION,
    v4PipelineStages.RETRIEVAL
  ]),
  [v4PipelineStages.FIELD_RESOLUTION]: Object.freeze([
    v4PipelineStages.OBSERVATION,
    v4PipelineStages.CANDIDATE_DECISION
  ]),
  [v4PipelineStages.RENDERER]: Object.freeze([v4PipelineStages.FIELD_RESOLUTION]),
  [v4PipelineStages.PERSISTENCE]: Object.freeze([v4PipelineStages.RENDERER])
});

const terminalStatuses = new Set(["COMPLETED", "SKIPPED", "FAILED", "REVIEW_REQUIRED"]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (value && typeof value === "object") return Object.values(value).some(hasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function fieldContainer(result = {}) {
  const value = result.resolved_fields || result.resolved || result.fields || {};
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function titleFromResult(result = {}) {
  return cleanText(result.final_title || result.rendered_title || result.title);
}

function countCandidates(result = {}) {
  const catalog = Number(result.catalog_activation_funnel?.raw_candidate_count || 0);
  const vector = Number(result.vector_activation_funnel?.raw_candidate_count || 0);
  return Math.max(0, catalog) + Math.max(0, vector);
}

function persistedArtifactCount(persistence = {}) {
  return Object.values(persistence || {}).filter((value) => (
    value && typeof value === "object" && (value.saved === true || value.deferred === true)
  )).length;
}

function stage({
  id,
  status,
  executionMode = "NATIVE_V4",
  reason = null,
  metrics = {}
}) {
  return {
    stage_id: id,
    owner: v4DecisionOwners[id],
    dependencies: v4PipelineTopology[id],
    status,
    execution_mode: executionMode,
    reason,
    metrics
  };
}

function exactAnchorRoute(routePlan = {}) {
  return routePlan.route === "EXACT_ANCHOR_FAST_LANE"
    || routePlan.route === "ANCHOR_CONSTRAINED_L2";
}

function typedAnchorRoute(payload = {}) {
  return ["TCG_EXACT_LOOKUP", "SPORTS_COMPOSITE_LOOKUP"]
    .includes(cleanText(payload.v4_anchor_probe?.plan?.route));
}

function candidateStage(result = {}) {
  const decision = result.candidate_decision_stage;
  const candidateCount = countCandidates(result);
  if (result.exact_anchor_finalize?.used === true) {
    return stage({
      id: v4PipelineStages.CANDIDATE_DECISION,
      status: "COMPLETED",
      executionMode: "NATIVE_V4_EXACT_ANCHOR",
      reason: "unique_typed_anchor_candidate_finalized",
      metrics: { selected_candidate_id: result.exact_anchor_finalize?.candidate?.candidate_id || null }
    });
  }
  if (decision?.schema_version === "candidate-decision-stage-v1") {
    return stage({
      id: v4PipelineStages.CANDIDATE_DECISION,
      status: "COMPLETED",
      executionMode: "EXTRACTED_SHARED_MODULE",
      metrics: {
        heuristic_version: decision.heuristic_version || null,
        selected_candidate_id: decision.selected_candidate_id || null,
        applied_field_count: decision.field_application?.applied_fields?.length || 0,
        blocked_field_count: decision.field_application?.blocked_fields?.length || 0
      }
    });
  }
  return stage({
    id: v4PipelineStages.CANDIDATE_DECISION,
    status: candidateCount > 0 ? "REVIEW_REQUIRED" : "SKIPPED",
    executionMode: candidateCount > 0 ? "NATIVE_V4" : "NOT_RUN",
    reason: candidateCount > 0 ? "native_candidate_decision_failed_closed_without_atomic_selection" : "no_candidates_available",
    metrics: { candidate_count: candidateCount }
  });
}

function contractViolations({ payload = {}, routePlan = {}, result = {}, stages = [], retrievalSourceContract = {} } = {}) {
  const violations = [...(Array.isArray(retrievalSourceContract.violations) ? retrievalSourceContract.violations : [])];
  if (exactAnchorRoute(routePlan) && !typedAnchorRoute(payload)) {
    violations.push({
      severity: "ERROR",
      code: "EXACT_ROUTE_WITHOUT_TYPED_ANCHOR",
      owner: v4DecisionOwners[v4PipelineStages.ROUTE]
    });
  }

  const appliedFields = result.candidate_decision_stage?.field_application?.applied_fields
    || result.candidate_safe_overlay_applied_fields
    || [];
  if (appliedFields.length > 0 && result.candidate_decision_stage?.schema_version !== "candidate-decision-stage-v1") {
    violations.push({
      severity: "ERROR",
      code: "CANDIDATE_FIELDS_APPLIED_OUTSIDE_ATOMIC_STAGE",
      owner: v4DecisionOwners[v4PipelineStages.CANDIDATE_DECISION]
    });
  }
  if (result.selected_candidate_decision
    && result.selected_candidate_decision.heuristic_version !== candidateSelectionHeuristicVersion) {
    violations.push({
      severity: "ERROR",
      code: "UNVERSIONED_OR_MUTATED_CANDIDATE_HEURISTIC",
      owner: v4DecisionOwners[v4PipelineStages.CANDIDATE_DECISION]
    });
  }
  if (result.candidate_decision_stage?.selected_candidate_id
    && result.selected_candidate_decision?.selected_candidate_id
    && result.candidate_decision_stage.selected_candidate_id !== result.selected_candidate_decision.selected_candidate_id) {
    violations.push({
      severity: "ERROR",
      code: "CANDIDATE_SELECTION_APPLICATION_ID_MISMATCH",
      owner: v4DecisionOwners[v4PipelineStages.CANDIDATE_DECISION]
    });
  }

  for (const node of stages) {
    if (!v4DecisionOwners[node.stage_id] || node.owner !== v4DecisionOwners[node.stage_id]) {
      violations.push({ severity: "ERROR", code: "STAGE_OWNER_MISMATCH", stage_id: node.stage_id });
    }
    if (!terminalStatuses.has(node.status)) {
      violations.push({ severity: "ERROR", code: "NON_TERMINAL_STAGE_STATUS", stage_id: node.stage_id });
    }
  }
  return violations;
}

export function buildV4PipelineContract({
  payload = {},
  routePlan = {},
  result = {},
  persistence = {}
} = {}) {
  const retrievalSourceContract = buildRetrievalSourceContract(result);
  const resolved = fieldContainer(result);
  const title = titleFromResult(result);
  const providerFailed = String(result.confidence || "").toUpperCase() === "FAILED"
    || Boolean(result.provider_error_type || result.provider_error_code);
  const exactAnchor = result.exact_anchor_finalize?.used === true
    || result.provider === "v4_anchor_router";
  const hasRetrieval = countCandidates(result) > 0
    || Boolean(result.catalog_retrieval || result.vector_retrieval || exactAnchor);
  const hasBundle = Boolean(payload.preingestion_bundle_id || payload.preingestionBundleId);
  const candidate = candidateStage(result);
  const stages = [
    stage({
      id: v4PipelineStages.INPUT,
      status: "COMPLETED",
      metrics: { image_count: Array.isArray(payload.images) ? payload.images.length : 0 }
    }),
    stage({
      id: v4PipelineStages.PREINGESTION,
      status: hasBundle ? "COMPLETED" : "SKIPPED",
      reason: hasBundle ? null : "no_preingestion_bundle",
      metrics: { bundle_id: payload.preingestion_bundle_id || payload.preingestionBundleId || null }
    }),
    stage({
      id: v4PipelineStages.ROUTE,
      status: "COMPLETED",
      metrics: {
        route: routePlan.route || null,
        typed_anchor_route: payload.v4_anchor_probe?.plan?.route || null
      }
    }),
    stage({
      id: v4PipelineStages.OBSERVATION,
      status: providerFailed ? "FAILED" : exactAnchor || result.provider || result.provider_id ? "COMPLETED" : "SKIPPED",
      executionMode: exactAnchor ? "NATIVE_V4_EXACT_ANCHOR" : "NATIVE_V4",
      reason: exactAnchor ? "provider_not_required" : "native_v4_provider_observation",
      metrics: { provider: result.provider || result.provider_id || null, model: result.model || result.model_id || null }
    }),
    stage({
      id: v4PipelineStages.RETRIEVAL,
      status: hasRetrieval ? "COMPLETED" : "SKIPPED",
      executionMode: exactAnchor ? "NATIVE_V4_EXACT_ANCHOR" : hasRetrieval ? "NATIVE_V4" : "NOT_RUN",
      reason: hasRetrieval ? null : "no_retrieval_result",
      metrics: { raw_candidate_count: countCandidates(result) }
    }),
    candidate,
    stage({
      id: v4PipelineStages.FIELD_RESOLUTION,
      status: Object.values(resolved).some(hasValue) ? "COMPLETED" : providerFailed ? "FAILED" : "REVIEW_REQUIRED",
      executionMode: exactAnchor ? "NATIVE_V4_EXACT_ANCHOR" : "NATIVE_V4",
      reason: exactAnchor ? null : "native_v4_identity_resolution",
      metrics: { resolved_field_count: Object.values(resolved).filter(hasValue).length }
    }),
    stage({
      id: v4PipelineStages.RENDERER,
      status: title ? "COMPLETED" : providerFailed ? "FAILED" : "REVIEW_REQUIRED",
      executionMode: "NATIVE_V4",
      metrics: { title_length: title.length, render_source: result.title_render_source || null }
    }),
    stage({
      id: v4PipelineStages.PERSISTENCE,
      status: Object.keys(persistence || {}).length ? "COMPLETED" : "SKIPPED",
      reason: Object.keys(persistence || {}).length ? null : "persistence_not_observed_yet",
      metrics: { observed_artifact_count: persistedArtifactCount(persistence) }
    })
  ];
  const violations = contractViolations({ payload, routePlan, result, stages, retrievalSourceContract });
  const bridgedStages = [];
  const executionModeCounts = Object.fromEntries(
    [...new Set(stages.map((node) => node.execution_mode))]
      .map((mode) => [mode, stages.filter((node) => node.execution_mode === mode).length])
  );
  const shadowPolicyAudit = buildShadowRecognitionPolicyAudit({
    payload,
    result,
    stateId: result.recognition_session_id || payload.recognition_session_id || null,
    elapsedMs: result.provider_latency_ms ?? result.timing?.total_ms ?? 0
  });
  return {
    schema_version: "v4-native-pipeline-contract-v2",
    core_implementation: "NATIVE_V4",
    legacy_core_dependency: false,
    strategy_profile: v4ProductionStrategyProfile,
    contract_status: violations.some((violation) => violation.severity === "ERROR") ? "FAILED" : "PASSED",
    candidate_heuristic_version: candidateSelectionHeuristicVersion,
    owners: v4DecisionOwners,
    stages,
    bridged_stages: bridgedStages,
    native_stage_count: executionModeCounts.NATIVE_V4 || 0,
    native_exact_anchor_stage_count: executionModeCounts.NATIVE_V4_EXACT_ANCHOR || 0,
    extracted_shared_stage_count: executionModeCounts.EXTRACTED_SHARED_MODULE || 0,
    not_run_stage_count: executionModeCounts.NOT_RUN || 0,
    bridged_stage_count: bridgedStages.length,
    execution_mode_counts: executionModeCounts,
    shadow_recognition_policy: shadowPolicyAudit,
    retrieval_source_contract: retrievalSourceContract,
    violations,
    migration_complete: bridgedStages.length === 0
  };
}
