import { createHash } from "node:crypto";
import { applyIdentityResolutionGateWithConvergence } from "../../identity-resolution/listing-resolution-gate.mjs";
import { buildCandidateSelectionPass } from "../candidates/candidate-selection-pass.mjs";
import { buildRetrievalApplicationLayer } from "../candidates/retrieval-application-layer.mjs";

export const retrievalApplicationReplaySchemaVersion = "retrieval-application-replay-v1";

const convergenceOptions = Object.freeze({ maxIterations: 1 });

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizedKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function isVolatileKey(key) {
  const normalized = normalizedKey(key);
  return normalized === "time"
    || normalized === "timestamp"
    || normalized === "timestamps"
    || normalized === "timing"
    || normalized === "timings"
    || normalized.endsWith("_at")
    || normalized.endsWith("_ms")
    || /(^|_)(latency|duration|elapsed|wall_time)(_|$)/.test(normalized);
}

function withoutVolatileData(value) {
  if (Array.isArray(value)) {
    return value.map((item) => withoutVolatileData(item) ?? null);
  }
  if (value instanceof Date) return undefined;
  if (!isRecord(value)) {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    if (["function", "symbol", "undefined"].includes(typeof value)) return undefined;
    return value;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !isVolatileKey(key) && item !== undefined)
    .map(([key, item]) => [key, withoutVolatileData(item)])
    .filter(([, item]) => item !== undefined));
}

function stableJsonValue(value) {
  const semantic = withoutVolatileData(value);
  if (Array.isArray(semantic)) return semantic.map(stableJsonValue);
  if (!isRecord(semantic)) return semantic;
  return Object.fromEntries(Object.keys(semantic)
    .sort()
    .map((key) => [key, stableJsonValue(semantic[key])]));
}

function fingerprint(value) {
  const canonical = JSON.stringify(stableJsonValue(value));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function firstRecord(...values) {
  return values.find((value) => isRecord(value) && Object.keys(value).length)
    || values.find(isRecord)
    || {};
}

function compactRecord(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === undefined || item === null || item === "") return false;
    if (Array.isArray(item)) return item.length > 0;
    if (isRecord(item)) return Object.keys(item).length > 0;
    return true;
  }));
}

function directObservationProjection(result = {}, candidateControl = {}) {
  return withoutVolatileData(compactRecord({
    provider_id: result.identity_provider_id || result.provider || result.source || "",
    field_sources: compactRecord({
      resolved: result.resolved,
      resolved_fields: result.resolved_fields,
      fields: result.fields,
      raw_provider_fields: result.raw_provider_fields,
      provider_fields: result.provider_fields
    }),
    evidence_sources: compactRecord({
      evidence: result.evidence,
      normalized_evidence: result.normalized_evidence,
      provider_evidence: result.provider_evidence,
      generated_evidence: result.generated_evidence
    }),
    unresolved: Array.isArray(result.unresolved) ? result.unresolved : [],
    candidate_observation_snapshot: candidateControl.candidate_observation_snapshot || {}
  }));
}

function candidateSelectionProjection(candidateControl = {}) {
  const selected = candidateControl.selected_candidate_decision || {};
  return withoutVolatileData({
    heuristic_version: selected.heuristic_version || null,
    observation_snapshot: candidateControl.candidate_observation_snapshot || {},
    participation_level: candidateControl.participation_level || null,
    candidate_count: Array.isArray(candidateControl.candidate_application_trace)
      ? candidateControl.candidate_application_trace.length
      : 0,
    decision_eligible_candidate_ids: candidateControl.decision_eligible_candidate_ids || [],
    field_evidence_eligible_candidate_ids: candidateControl.field_evidence_eligible_candidate_ids || [],
    shadow_only_candidate_ids: candidateControl.shadow_only_candidate_ids || [],
    selected_candidate: {
      selected_candidate_id: selected.selected_candidate_id || "",
      selected_candidate_group_ids: selected.selected_candidate_group_ids || [],
      selected_candidate_source: selected.selected_candidate_source || "",
      selected_candidate_source_trust: selected.selected_candidate_source_trust || "",
      match_level: selected.match_level || "NO_MATCH",
      selection_confidence: Number(selected.selection_confidence || 0),
      selection_margin: Number(selected.selection_margin || 0),
      low_margin_candidate_id: selected.low_margin_candidate_id || "",
      selected_reason_codes: selected.selected_reason_codes || []
    },
    application_trace: (candidateControl.candidate_application_trace || []).map((trace) => ({
      candidate_id: trace.candidate_id || "",
      candidate_identity_id: trace.candidate_identity_id || "",
      candidate_lane: trace.candidate_lane || "",
      source_type: trace.source_type || "",
      source_trust: trace.source_trust || "",
      match_level: trace.match_level || "NO_MATCH",
      identity_decision_eligible: trace.identity_decision_eligible === true,
      field_evidence_eligible: trace.field_evidence_eligible === true,
      field_evidence_fields: trace.field_evidence_fields || [],
      direct_conflicts: trace.direct_conflicts || [],
      blocked_fields: trace.blocked_fields || [],
      shadow_only_reason: trace.shadow_only_reason || ""
    })),
    field_inventory: (candidateControl.candidate_field_inventory || []).map((row) => ({
      candidate_id: row.candidate_id || "",
      candidate_identity_id: row.candidate_identity_id || "",
      candidate_lane: row.candidate_lane || "",
      field: row.field_name || row.field || "",
      value: row.value,
      permission: row.permission || null,
      source_type: row.source_type || "",
      source_trust: row.source_trust || ""
    })),
    selected_safe_field_application: candidateControl.selected_candidate_safe_field_application || {},
    low_margin_safe_field_application: candidateControl.low_margin_safe_field_application || {}
  });
}

function identityEvidenceProjection(item = {}) {
  const metadata = item.metadata || {};
  return {
    field: item.field || "",
    value: item.value,
    source: item.source || "",
    confidence: Number(item.confidence || 0),
    candidate_id: metadata.candidate_id || "",
    candidate_identity_id: metadata.candidate_identity_id || "",
    decision: metadata.retrieval_application_decision || "",
    reason: metadata.retrieval_application_reason || "",
    permission: metadata.field_permission || null
  };
}

function applicationDecisionProjection(item = {}) {
  return {
    candidate_id: item.candidate_id || "",
    candidate_identity_id: item.candidate_identity_id || "",
    candidate_lane: item.candidate_lane || "",
    field: item.field || "",
    resolver_field: item.resolver_field || item.field || "",
    old_value: item.old_value ?? null,
    candidate_value: item.candidate_value ?? null,
    final_value: item.final_value ?? null,
    confidence: Number(item.confidence || 0),
    source: item.source || item.source_type || "",
    permission: item.permission || item.field_permission || null,
    decision: item.decision || "",
    reason: item.reason || "",
    applied_to_final: item.applied_to_final === true,
    supported_final: item.supported_final === true,
    outcome: item.outcome || ""
  };
}

function armSemanticProjection(result = {}) {
  const application = result.retrieval_application || {};
  const identityResolution = result.identity_resolution || {};
  const convergence = identityResolution.convergence || {};
  const identityEvidenceItems = (application.identity_evidence_items || []).map(identityEvidenceProjection);
  return withoutVolatileData({
    final_title: result.final_title || "",
    rendered_title: result.rendered_title || "",
    resolved_fields: result.resolved_fields || identityResolution.identity || {},
    unresolved: Array.isArray(result.unresolved) ? result.unresolved : [],
    identity_resolution: {
      status: identityResolution.status || result.identity_resolution_status || null,
      ambiguity_status: identityResolution.ambiguity_status || result.ambiguity_status || null,
      abstain_reason_codes: identityResolution.abstain_reason_codes || result.abstain_reason_codes || [],
      convergence: {
        max_iterations: convergence.max_iterations ?? convergenceOptions.maxIterations,
        iterations: convergence.iterations ?? 0,
        converged: convergence.converged === true
      }
    },
    retrieval_application: {
      enabled: application.enabled === true,
      owner: application.owner || null,
      resolver_consumed: application.resolver_consumed === true,
      selected_candidate_id: application.selected_candidate_id || "",
      identity_evidence_count: Number(application.identity_evidence_count || 0),
      identity_evidence_fields: identityEvidenceItems.map((item) => item.field),
      identity_evidence_items: identityEvidenceItems,
      decision_counts: application.decision_counts || {},
      actual_application_count: Number(application.actual_application_count || 0),
      actual_applied_fields: application.actual_applied_fields || [],
      actual_support_count: Number(application.actual_support_count || 0),
      actual_supported_fields: application.actual_supported_fields || [],
      decisions: (application.decisions || []).map(applicationDecisionProjection)
    },
    retrieval_evidence_isolation: result.retrieval_evidence_isolation || null
  });
}

async function resolveReplayArm(result, retrievalApplication, { maxLength, providerId }) {
  return applyIdentityResolutionGateWithConvergence({
    ...result,
    retrieval_application: retrievalApplication
  }, {
    maxLength,
    providerId,
    retrievalCandidates: [],
    registryRecords: [],
    productSchemas: [],
    retrieveEvidence: null,
    convergenceOptions
  });
}

export async function buildRetrievalApplicationReplay({
  result = {},
  catalogContext = {},
  vectorContext = {},
  maxLength = 80
} = {}) {
  const candidateControl = buildCandidateSelectionPass({ result, catalogContext, vectorContext });
  const controlledResult = {
    ...result,
    ...candidateControl,
    resolved: firstRecord(result.resolved, result.resolved_fields, result.fields),
    evidence: isRecord(result.evidence) ? result.evidence : {}
  };
  const providerId = result.identity_provider_id || result.provider || result.source || "";
  const offApplication = buildRetrievalApplicationLayer({
    result: controlledResult,
    candidateControl,
    enabled: false,
    maxLength
  });
  const onApplication = buildRetrievalApplicationLayer({
    result: controlledResult,
    candidateControl,
    enabled: true,
    maxLength
  });
  const offResult = await resolveReplayArm(controlledResult, offApplication, { maxLength, providerId });
  const onResult = await resolveReplayArm(controlledResult, onApplication, { maxLength, providerId });
  const directObservation = directObservationProjection(result, candidateControl);
  const candidateSelection = candidateSelectionProjection(candidateControl);
  const replayInput = {
    candidate_decorated_direct_result: withoutVolatileData(result),
    candidate_control: withoutVolatileData(candidateControl),
    resolver_options: {
      max_length: maxLength,
      retrieval_candidates: [],
      registry_records: [],
      product_schemas: [],
      retrieve_evidence: null,
      convergence: convergenceOptions
    }
  };
  const replayInputFingerprint = fingerprint(replayInput);
  const offProjection = armSemanticProjection(offResult);
  const onProjection = armSemanticProjection(onResult);

  return {
    schema_version: retrievalApplicationReplaySchemaVersion,
    shared: {
      fingerprints: {
        candidate_decorated_direct_result: fingerprint(result),
        direct_observation: fingerprint(directObservation),
        candidate_selection: fingerprint(candidateSelection),
        replay_input: replayInputFingerprint
      },
      projection: {
        direct_observation: directObservation,
        candidate_selection: candidateSelection,
        resolver_options: replayInput.resolver_options
      }
    },
    arms: {
      off: {
        input_fingerprint: replayInputFingerprint,
        semantic_fingerprint: fingerprint(offProjection),
        semantic_projection: offProjection
      },
      on: {
        input_fingerprint: replayInputFingerprint,
        semantic_fingerprint: fingerprint(onProjection),
        semantic_projection: onProjection
      }
    }
  };
}
