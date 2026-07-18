import { normalizeHardInvariantSnapshot } from "./hard-invariant-spec.mjs";
import {
  normalizeRecognitionPolicyState,
  recognitionPolicyActions,
  solveOptimalRecognitionPolicy
} from "./optimal-recognition-policy.mjs";

const fieldGroups = Object.freeze({
  subject: ["subject", "subjects", "player", "players", "character", "characters"],
  year: ["year"],
  product: ["product", "product_or_set", "set"],
  set: ["set", "subset", "insert"],
  card_number: ["card_number", "collector_number", "checklist_code", "tcg_card_number"],
  parallel: ["parallel", "parallel_exact", "parallel_family", "surface_color", "product_finish"],
  numerical_rarity: ["numerical_rarity", "print_run_number", "serial_number", "serial_denominator", "numbered_to"],
  grade: ["grade", "grade_company", "card_grade", "auto_grade", "grading_info"]
});

const alwaysCriticalFields = Object.freeze(["subject", "year", "product"]);
const optionalCriticalFields = Object.freeze(["set", "card_number", "parallel", "numerical_rarity", "grade"]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (value && typeof value === "object") return Object.values(value).some(hasValue);
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resolvedFields(result = {}) {
  return plainObject(result.resolved_fields || result.resolved || result.fields);
}

function normalizedFieldStateRows(result = {}) {
  const source = result.field_states;
  if (Array.isArray(source)) return source;
  return Object.entries(plainObject(source)).map(([field, state]) => ({ field, ...plainObject(state) }));
}

function fieldStateForGroup(rows = [], aliases = []) {
  return rows.find((row) => aliases.includes(cleanText(row.field_name || row.field).toLowerCase())) || null;
}

function valueForGroup(resolved = {}, aliases = []) {
  for (const alias of aliases) {
    if (hasValue(resolved[alias])) return resolved[alias];
  }
  return null;
}

function fieldRisk({ state = null, value = null } = {}) {
  if (!hasValue(value)) return 1;
  const status = cleanText(state?.display_status || state?.status).toUpperCase();
  if (status === "CONFLICT") return 0.9;
  if (["REVIEW", "AMBIGUOUS", "ABSTAIN"].includes(status)) return 0.4;
  const confidence = finiteNumber(state?.resolution_confidence ?? state?.confidence, null);
  if (confidence !== null) return Math.max(0.02, Math.min(0.95, 1 - confidence));
  return 0.05;
}

function funnel(result = {}, lane = "catalog") {
  const direct = plainObject(result[`${lane}_activation_funnel`]);
  const decision = plainObject(result.candidate_decision_stage?.activation_funnels?.[lane]);
  return Object.keys(direct).length ? direct : decision;
}

function attempted(funnelValue = {}) {
  return funnelValue.query_attempted === true
    || funnelValue.pre_observation_query_attempted === true
    || funnelValue.post_observation_query_attempted === true;
}

function candidateCount(funnelValue = {}) {
  return Math.max(0, finiteNumber(
    funnelValue.raw_candidate_count
    ?? funnelValue.approved_candidate_count
    ?? funnelValue.prompt_candidate_count,
    0
  ));
}

function directConflictCount(result = {}, fieldRows = []) {
  const map = Array.isArray(result.conflict_map) ? result.conflict_map : [];
  const fieldConflicts = fieldRows.filter((row) => {
    const status = cleanText(row.display_status || row.status).toUpperCase();
    return status === "CONFLICT" || (Array.isArray(row.conflicts) && row.conflicts.length > 0);
  }).length;
  return Math.max(map.length, fieldConflicts);
}

function actionAttempts({ payload = {}, result = {}, catalog = {}, vector = {} } = {}) {
  const actions = [];
  if (payload.preingestion_bundle_id || payload.preingestionBundleId || result.preingestion_ocr_rendezvous) {
    actions.push(recognitionPolicyActions.RUN_CHEAP_EVIDENCE);
  }
  if (attempted(catalog)) actions.push(recognitionPolicyActions.RUN_EXACT_CATALOG_LOOKUP);
  if (result.provider || result.provider_id || result.model || result.model_id) {
    actions.push(recognitionPolicyActions.RUN_GPT_OBSERVATION);
  }
  if (attempted(vector) || result.vector_retrieval || result.vector_worker) {
    actions.push(recognitionPolicyActions.RUN_VECTOR_RETRIEVAL);
  }
  if (result.focused_verifier_attempted === true || result.preingestion_ocr_rendezvous?.focused_verifier_attempted === true) {
    actions.push(recognitionPolicyActions.RUN_FOCUSED_VERIFIER);
  }
  if (result.external_retrieval_attempted === true || result.external_retrieval?.attempted === true) {
    actions.push(recognitionPolicyActions.RUN_EXTERNAL_RETRIEVAL);
  }
  return [...new Set(actions)];
}

export function buildObservedRecognitionPolicyState({
  payload = {},
  result = {},
  stateId = null,
  elapsedMs = 0,
  remainingLatencyBudgetMs = 60_000
} = {}) {
  const resolved = resolvedFields(result);
  const rows = normalizedFieldStateRows(result);
  const values = Object.fromEntries(Object.entries(fieldGroups)
    .map(([field, aliases]) => [field, valueForGroup(resolved, aliases)]));
  const criticalFields = [
    ...alwaysCriticalFields,
    ...optionalCriticalFields.filter((field) => hasValue(values[field])
      || Boolean(fieldStateForGroup(rows, fieldGroups[field])))
  ];
  const fieldStates = Object.fromEntries(criticalFields.map((field) => {
    const state = fieldStateForGroup(rows, fieldGroups[field]);
    const value = values[field] ?? state?.field_value ?? state?.value ?? state?.resolved_value ?? null;
    return [field, {
      resolved_value: value,
      risk: fieldRisk({ state, value }),
      display_status: cleanText(state?.display_status || state?.status).toUpperCase() || null
    }];
  }));
  const catalog = funnel(result, "catalog");
  const vector = funnel(result, "vector");
  const completedActions = actionAttempts({ payload, result, catalog, vector });
  const invariantInput = payload.v4_hard_invariant_snapshot || result.v4_hard_invariant_snapshot || {};
  const exactAnchorCount = Math.max(0, finiteNumber(
    payload.v4_anchor_probe?.metrics?.direct_anchor_count
    ?? payload.v4_anchor_probe?.metrics?.anchor_count
    ?? (result.exact_anchor_finalize?.used === true ? 1 : 0),
    0
  ));
  return normalizeRecognitionPolicyState({
    state_id: stateId,
    invariants: invariantInput?.schema_version === "v4-hard-invariant-snapshot-v1"
      ? invariantInput
      : normalizeHardInvariantSnapshot(invariantInput),
    evidence: {
      field_states: fieldStates,
      critical_fields: criticalFields,
      direct_conflict_count: directConflictCount(result, rows),
      cheap_evidence_ready: completedActions.includes(recognitionPolicyActions.RUN_CHEAP_EVIDENCE),
      exact_anchor_count: exactAnchorCount,
      ocr_anchor_count: Math.max(0, finiteNumber(payload.v4_anchor_probe?.metrics?.anchor_count, 0)),
      catalog: {
        attempted: attempted(catalog),
        candidate_count: candidateCount(catalog),
        unique_exact_match: result.exact_anchor_finalize?.used === true
          || payload.v4_anchor_probe?.finalized === true,
        top_margin: finiteNumber(result.selected_candidate_decision?.selection_margin, 0),
        direct_conflict_count: Math.max(0, finiteNumber(catalog.conflict_blocked_count, 0))
      },
      vector: {
        attempted: attempted(vector),
        candidate_count: candidateCount(vector),
        top_margin: finiteNumber(result.vector_candidate_decision?.selection_margin, 0)
      },
      gpt: { attempted: completedActions.includes(recognitionPolicyActions.RUN_GPT_OBSERVATION) },
      focused_verifier: { attempted: completedActions.includes(recognitionPolicyActions.RUN_FOCUSED_VERIFIER) },
      external_retrieval: { attempted: completedActions.includes(recognitionPolicyActions.RUN_EXTERNAL_RETRIEVAL) }
    },
    completed_actions: completedActions,
    elapsed_ms: elapsedMs,
    remaining_latency_budget_ms: remainingLatencyBudgetMs
  });
}

export function buildShadowRecognitionPolicyAudit(input = {}) {
  const state = buildObservedRecognitionPolicyState(input);
  const decision = solveOptimalRecognitionPolicy({ state });
  return {
    schema_version: "v4-shadow-recognition-policy-audit-v1",
    shadow_only: true,
    can_execute: false,
    observation_point: "TERMINAL_PIPELINE_STATE",
    state,
    decision
  };
}
