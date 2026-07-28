import { recognitionBenchmarkProfileIds } from "./recognition-benchmark-profile.mjs";
import { normalizeGoldenSemValue } from "./golden-sem-accuracy.mjs";

export const evaluationDecisionTraceSchemaVersion = "evaluation-decision-trace-packet-v3";

const canonicalFieldAliases = Object.freeze({
  year: ["year", "printed_year", "release_year", "season", "product_year", "title_year"],
  manufacturer: ["manufacturer", "brand"],
  product: ["product", "product_line"],
  set: ["set", "subset"],
  subject: ["players", "player", "subjects", "subject", "character"],
  card_name: ["card_name", "official_card_type", "card_type", "insert"],
  card_number: ["card_number", "collector_number", "checklist_code", "tcg_card_number"],
  descriptive_rarity: ["descriptive_rarity", "rarity", "ssp", "case_hit"],
  numerical_rarity: ["numerical_rarity", "print_run_number", "serial_number", "numbered_to"],
  release_variant: ["release_variant", "variation", "design_variation"],
  print_finish: ["print_finish", "product_finish", "parallel", "parallel_exact", "parallel_family", "surface_color"],
  special_stamp: ["special_stamp", "first_bowman"],
  grading_info: ["grading_info", "grade_company", "card_grade", "grade", "auto_grade", "grade_type"],
  search_optimization: ["search_optimization", "observable_components", "rc", "auto", "patch", "relic", "jersey", "sketch", "redemption", "team"]
});

const missingFieldCategories = Object.freeze({
  TRACE_MISSING: "TRACE_MISSING",
  UNKNOWN: "UNKNOWN",
  PROVIDER_NOT_OBSERVED: "PROVIDER_NOT_OBSERVED",
  NORMALIZATION_DROPPED: "NORMALIZATION_DROPPED",
  CATALOG_NOT_RETRIEVED: "CATALOG_NOT_RETRIEVED",
  CANDIDATE_NOT_SELECTED: "CANDIDATE_NOT_SELECTED",
  CANDIDATE_FIELD_NOT_APPLIED: "CANDIDATE_FIELD_NOT_APPLIED"
});

const retrievalLanes = Object.freeze(["catalog", "vector"]);

// Evaluation packets may retain identity hypotheses, but never instance data
// such as a serial numerator, grade, certification number or condition.
const retrievalIdentityFieldNames = Object.freeze([
  "year",
  "printed_year",
  "release_year",
  "season",
  "product_year",
  "title_year",
  "manufacturer",
  "brand",
  "product",
  "product_line",
  "set",
  "subset",
  "insert",
  "players",
  "player",
  "subjects",
  "subject",
  "character",
  "card_name",
  "official_card_type",
  "card_type",
  "card_number",
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "parallel",
  "parallel_exact",
  "parallel_family",
  "print_finish",
  "product_finish",
  "surface_color"
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, max = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compactValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.slice(0, 12).map(compactValue).filter((item) => item !== null);
  if (typeof value === "object") return null;
  return cleanText(value);
}

function compactFields(fields = {}) {
  return Object.fromEntries(Object.entries(object(fields))
    .map(([key, value]) => [cleanText(key, 80), compactValue(value)])
    .filter(([key, value]) => key && value !== null));
}

function reasonCode(value, fallback = null) {
  const token = cleanText(value, 120).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return token || fallback;
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function candidateIdentifier(candidate = {}) {
  return cleanText(
    candidate.candidate_id
    || candidate.id
    || candidate.candidate_identity_id
    || candidate.identity_id,
    180
  ) || null;
}

function candidateLane(candidate = {}, fallback = "") {
  const lane = cleanText(candidate.candidate_lane || candidate.retrieval_lane || fallback, 24).toLowerCase();
  return retrievalLanes.includes(lane) ? lane : "";
}

function candidateTraceKey(candidateId = "", lane = "") {
  const normalizedId = cleanText(candidateId, 180);
  const normalizedLane = candidateLane({}, lane);
  return normalizedId && normalizedLane ? `${normalizedLane}:${normalizedId}` : "";
}

function compactIdentityFields(candidate = {}) {
  const sources = [candidate.fields, candidate.identity, candidate.resolved];
  const output = {};
  for (const field of retrievalIdentityFieldNames) {
    for (const source of sources) {
      const fields = object(source);
      if (!Object.hasOwn(fields, field)) continue;
      const value = compactValue(fields[field]);
      if (value !== null) output[field] = value;
      break;
    }
  }
  return output;
}

function candidateFieldValue(candidate = {}, field = "") {
  for (const source of [candidate.fields, candidate.identity, candidate.resolved, candidate]) {
    const fields = object(source);
    if (Object.hasOwn(fields, field)) return compactValue(fields[field]);
  }
  return null;
}

function compactApplicationDecision(decision = {}) {
  const row = object(decision);
  return {
    field: cleanText(row.field || row.field_name, 80) || null,
    resolver_field: cleanText(row.resolver_field, 80) || null,
    action: reasonCode(row.decision || row.action, "UNKNOWN"),
    reason: reasonCode(row.reason || row.reason_code || row.block_reason, "UNSPECIFIED"),
    value: compactValue(row.candidate_value ?? row.value),
    permission: reasonCode(row.permission),
    applied_to_final: row.applied_to_final === true,
    supported_final: row.supported_final === true,
    outcome: reasonCode(row.outcome)
  };
}

function fallbackApplicationActions(row = {}) {
  const actions = array(row.field_actions || row.actions).map(compactApplicationDecision);
  const reasonPerField = object(row.reason_per_field);
  const add = (field, action, fallbackReason) => {
    const fieldName = cleanText(field, 80);
    if (!fieldName) return;
    actions.push({
      field: fieldName,
      resolver_field: null,
      action,
      reason: reasonCode(reasonPerField[fieldName], fallbackReason),
      value: candidateFieldValue(row, fieldName),
      permission: null,
      applied_to_final: action === "APPLY",
      supported_final: false,
      outcome: null
    });
  };
  for (const field of array(row.applied_fields)) add(field, "APPLY", "APPLIED");
  for (const field of array(row.supported_fields)) add(field, "SUPPORT", "SUPPORTED_ONLY");
  for (const field of array(row.can_apply_fields)) add(field, "CAN_APPLY", "CAN_APPLY_AFTER_RESOLVER_GATE");
  for (const field of array(row.support_only_fields)) add(field, "SUPPORT_ONLY", "SUPPORT_ONLY");
  for (const field of array(row.suggest_only_fields)) add(field, "SUGGEST_ONLY", "SUGGEST_ONLY");
  for (const field of [...array(row.forbidden_fields), ...array(row.blocked_fields)]) {
    add(field, "BLOCK", reasonCode(row.block_reason, "BLOCKED"));
  }
  return actions;
}

function uniqueActions(actions = []) {
  const seen = new Set();
  return actions.filter((action) => {
    const key = JSON.stringify([
      action.field,
      action.resolver_field,
      action.action,
      action.reason,
      action.value,
      action.applied_to_final,
      action.supported_final,
      action.outcome
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

function candidateRows(result = {}) {
  const persistedControl = object(result.candidate_control_plane_trace);
  const adaptedControl = object(result.l2_candidate_debug);
  const control = Object.keys(persistedControl).length
    ? persistedControl
    : Object.keys(adaptedControl).length ? adaptedControl : result;
  const applicationRows = array(control.candidate_application_trace || control.candidate_application_trace_rows);
  const selectedDecision = object(control.selected_candidate_decision || result.selected_candidate_decision);
  const selectedId = cleanText(control.selected_candidate_id || selectedDecision.selected_candidate_id, 180);
  const selectedSource = cleanText(selectedDecision.selected_candidate_source, 80).toUpperCase();
  const decisionRows = array(control.retrieval_application?.decisions || result.retrieval_application?.decisions);
  const selectionRows = array(selectedDecision.rejected_candidate_reasons);
  const selectionById = new Map(selectionRows
    .map((row) => [candidateIdentifier(row), object(row)])
    .filter(([id]) => id));
  const authoritativeRows = retrievalLanes.flatMap((lane) => (
    array(result[`${lane}_candidate_packet`]?.vector_retrieval?.candidates)
      .slice(0, 20)
      .map((row) => ({ lane, row: object(row) }))
  ));
  const duplicateCounts = new Map();
  for (const { row } of authoritativeRows) {
    const id = candidateIdentifier(row);
    if (id) duplicateCounts.set(id, Number(duplicateCounts.get(id) || 0) + 1);
  }
  return authoritativeRows.map(({ lane, row }) => {
    const candidateId = candidateIdentifier(row);
    const authoritativeSelection = object(selectionById.get(candidateId));
    const laneApplicationRows = applicationRows.filter((item) => {
      if (candidateIdentifier(item) !== candidateId) return false;
      const itemLane = candidateLane(item);
      return !itemLane || itemLane === lane;
    });
    const authoritativeApplication = decisionRows
      .filter((item) => {
        if (candidateIdentifier(item) !== candidateId) return false;
        const itemLane = candidateLane(item);
        return !itemLane || itemLane === lane;
      })
      .map(compactApplicationDecision);
    const actions = authoritativeApplication.length
      ? authoritativeApplication
      : laneApplicationRows.flatMap(fallbackApplicationActions);
    const rank = finiteNumber(row.rank);
    const explicitRejectionReasons = array(authoritativeSelection.reasons);
    const rejectionReasons = explicitRejectionReasons.length
      ? explicitRejectionReasons
      : array(row.rejection_reasons || row.reason_codes);
    const sourceType = cleanText(row.source_type || row.reference_metadata?.source_type, 80) || null;
    const source = cleanText(row.provider_id || row.source_provider || sourceType, 80) || null;
    const sourceMatchesSelection = !selectedSource
      || [sourceType, source].map((value) => cleanText(value, 80).toUpperCase()).includes(selectedSource);
    const selected = Boolean(selectedId && selectedId === candidateId) && (
      Number(duplicateCounts.get(candidateId) || 0) === 1 || sourceMatchesSelection
    );
    return {
      candidate_trace_key: candidateTraceKey(candidateId, lane),
      candidate_id: candidateId,
      candidate_identity_id: cleanText(row.candidate_identity_id || row.identity_id, 180) || null,
      retrieval_lane: lane,
      retrieval_rank: rank,
      rank,
      rank_source: rank === null ? "UNAVAILABLE" : "AUTHORITATIVE_RETRIEVAL_PACKET",
      source,
      source_type: sourceType,
      source_trust: cleanText(row.source_trust, 80) || null,
      retrieval_score: finiteNumber(
        row.rerank_score,
        row.rank_fusion_score,
        row.combined_score,
        row.similarity,
        row.normalized_score,
        row.match_score
      ),
      score: finiteNumber(authoritativeSelection.score),
      decision_strength: finiteNumber(authoritativeSelection.decision_strength, row.decision_strength),
      selected,
      rejection_reasons: rejectionReasons
        .map((value) => reasonCode(value)).filter(Boolean).slice(0, 20),
      identity_fields: compactIdentityFields(row),
      field_actions: uniqueActions(actions)
    };
  });
}

function stageValues(fields = {}, aliases = []) {
  const values = aliases.flatMap((alias) => {
    const value = object(fields)[alias];
    return Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [value];
  }).map(compactValue).filter((value) => value !== null);
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()].slice(0, 12);
}

function comparable(value) {
  return cleanText(value, 240).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleContainsValue(title, value) {
  const haystack = ` ${comparable(title)} `;
  const needle = comparable(value);
  return needle.length >= 2 && haystack.includes(` ${needle} `);
}

function buildFieldLineage(result = {}, candidates = []) {
  const provider = object(result.raw_provider_fields);
  const normalized = object(result.raw_observed_fields || result.evidence_fields);
  const resolved = object(result.resolved_fields || result.resolved);
  const rendered = object(result.rendered_fields?.fields || result.rendered_fields);
  const finalTitle = cleanText(result.final_title || result.title || result.model_title_suggestion, 240);
  return Object.entries(canonicalFieldAliases).map(([field, aliases]) => {
    const providerValues = stageValues(provider, aliases);
    const normalizedValues = stageValues(normalized, aliases);
    const resolverValues = stageValues(resolved, aliases);
    const rendererValues = stageValues(rendered, aliases);
    const retrievedDecisions = candidates.flatMap((candidate) => stageValues(candidate.identity_fields, aliases)
      .map((value) => ({
        candidate_trace_key: candidate.candidate_trace_key,
        candidate_id: candidate.candidate_id,
        candidate_identity_id: candidate.candidate_identity_id,
        retrieval_lane: candidate.retrieval_lane,
        retrieval_rank: candidate.retrieval_rank,
        selected: candidate.selected,
        action: "RETRIEVED",
        reason: "CANDIDATE_IDENTITY_FIELD_RETRIEVED",
        value
      })));
    const applicationDecisions = candidates.flatMap((candidate) => candidate.field_actions
      .filter((action) => aliases.includes(action.field) || action.field === field)
      .map((action) => ({
        candidate_trace_key: candidate.candidate_trace_key,
        candidate_id: candidate.candidate_id,
        candidate_identity_id: candidate.candidate_identity_id,
        retrieval_lane: candidate.retrieval_lane,
        retrieval_rank: candidate.retrieval_rank,
        selected: candidate.selected,
        action: action.action,
        reason: action.reason,
        value: action.value ?? null
      })));
    const candidateDecisions = [...retrievedDecisions, ...applicationDecisions].slice(0, 80);
    const finalMatchedValues = [...rendererValues, ...resolverValues]
      .filter((value) => typeof value !== "boolean" && titleContainsValue(finalTitle, value));
    const normalizedPresent = normalizedValues.length > 0;
    const resolvedPresent = resolverValues.length > 0;
    const renderedPresent = rendererValues.length > 0;
    return {
      field,
      provider: {
        owner: "PROVIDER_OBSERVATION",
        version: cleanText(result.provider_prompt_version || result.prompt_version || result.model_id, 120) || null,
        values: providerValues,
        decision: providerValues.length ? "OBSERVED" : "NOT_OBSERVED",
        reason: providerValues.length ? "PROVIDER_FIELD_EMITTED" : "PROVIDER_FIELD_ABSENT"
      },
      normalization: {
        owner: "EVIDENCE_NORMALIZER",
        version: cleanText(result.evidence_schema_version || result.normalization_version, 120) || null,
        values: normalizedValues,
        decision: providerValues.length && !normalizedPresent ? "DROP" : normalizedPresent ? "PRESERVE_OR_NORMALIZE" : "NOT_OBSERVED",
        reason: providerValues.length && !normalizedPresent
          ? "NORMALIZED_EMPTY_OR_UNSUPPORTED"
          : normalizedPresent ? "NORMALIZATION_COMPLETED" : "NO_PROVIDER_INPUT"
      },
      retrieval: {
        owner: "RETRIEVAL_PACKETS_AND_CANDIDATE_CONTROL_PLANE",
        version: cleanText(result.candidate_policy_version || result.l2_candidate_debug?.schema_version, 120) || null,
        decisions: candidateDecisions
      },
      resolver: {
        owner: "IDENTITY_RESOLVER",
        version: cleanText(result.identity_resolution_version || result.resolver_version, 120) || null,
        values: resolverValues,
        decision: normalizedPresent && !resolvedPresent ? "DROP" : resolvedPresent ? "RETAIN_OR_ADD" : "NO_VALUE",
        reason: normalizedPresent && !resolvedPresent ? "RESOLVER_NOT_PRESERVED" : resolvedPresent ? "RESOLVER_OUTPUT_PRESENT" : "NO_NORMALIZED_VALUE"
      },
      renderer: {
        owner: "DETERMINISTIC_RENDERER",
        version: cleanText(result.renderer_version, 120) || null,
        values: rendererValues,
        decision: resolvedPresent && !renderedPresent ? "DROP" : renderedPresent ? "INCLUDE" : "NO_VALUE",
        reason: resolvedPresent && !renderedPresent ? "RENDERER_NOT_INCLUDED" : renderedPresent ? "RENDERER_MODULE_PRESENT" : "NO_RESOLVED_VALUE"
      },
      final_title_span: {
        owner: "FINAL_TITLE_SPAN_MATCHER",
        version: "final-title-span-v1",
        matched: finalMatchedValues.length > 0,
        matched_values: finalMatchedValues,
        decision: finalMatchedValues.length ? "MATCH" : "NO_MATCH",
        reason: finalMatchedValues.length ? "FIELD_VALUE_PRESENT_IN_FINAL_TITLE" : "FIELD_VALUE_NOT_FOUND_IN_FINAL_TITLE"
      }
    };
  });
}

function normalizationTrace(result = {}) {
  const input = compactFields(result.raw_provider_fields || {});
  const output = compactFields(result.raw_observed_fields || result.evidence_fields || {});
  const explicitRejections = new Map(array(result.provider_field_rejections).map((item) => {
    const row = object(item);
    return [cleanText(row.field || row.field_name, 80), reasonCode(row.reason_code || row.reason, "PROVIDER_FIELD_REJECTED")];
  }));
  const fields = [...new Set([...Object.keys(input), ...Object.keys(output)])].sort();
  return {
    input,
    output,
    decisions: fields.map((field) => ({
      field,
      decision: !(field in output)
        ? "DROP"
        : !(field in input)
          ? "DERIVE"
          : JSON.stringify(input[field]) === JSON.stringify(output[field])
            ? "PRESERVE"
            : "NORMALIZE",
      reason: !(field in output)
        ? explicitRejections.get(field) || "NORMALIZED_EMPTY_OR_UNSUPPORTED"
        : !(field in input)
          ? "NORMALIZER_DERIVED"
          : "NORMALIZATION_COMPLETED"
    }))
  };
}

function resolutionTrace(result = {}) {
  const before = compactFields(result.evidence_fields || result.raw_observed_fields || {});
  const after = compactFields(result.resolved_fields || result.resolved || {});
  const dropped = Object.keys(before).filter((field) => !(field in after)).map((field) => {
    const matching = array(result.resolution_trace).find((entry) => cleanText(entry?.field, 80) === field);
    return { field, reason: reasonCode(matching?.reason_code || matching?.decision || matching?.reason, "RESOLVER_NOT_PRESERVED") };
  });
  return { before, after, dropped };
}

function rendererTrace(result = {}) {
  const resolved = compactFields(result.resolved_fields || result.resolved || {});
  const rendered = compactFields(result.rendered_fields?.fields || result.rendered_fields || {});
  const included = Object.keys(resolved).filter((field) => field in rendered);
  const dropped = Object.keys(resolved).filter((field) => !(field in rendered))
    .map((field) => ({ field, reason: "RENDERER_NOT_INCLUDED" }));
  return {
    renderer: cleanText(result.renderer, 80) || null,
    renderer_version: cleanText(result.renderer_version, 120) || null,
    included_fields: included,
    dropped_fields: dropped,
    module_order: array(result.module_order).map((value) => cleanText(value, 80)).filter(Boolean).slice(0, 30)
  };
}

function compactAnchorRoutePlan(value = {}) {
  const plan = object(value);
  return {
    route: cleanText(plan.route, 80) || null,
    reason: reasonCode(plan.reason),
    primary_anchor_type: cleanText(plan.primary_anchor_type, 80) || null,
    allow_identity_finalize: plan.allow_identity_finalize === true,
    context_dimensions: Number.isFinite(Number(plan.context_dimensions)) ? Number(plan.context_dimensions) : null,
    direct_context_dimensions: Number.isFinite(Number(plan.direct_context_dimensions))
      ? Number(plan.direct_context_dimensions)
      : null
  };
}

function compactAnchorInputTrace(value = {}) {
  const trace = object(value);
  return {
    schema_version: cleanText(trace.schema_version, 120) || null,
    execution_summary_source: cleanText(trace.execution_summary_source, 80) || null,
    snapshot_source: cleanText(trace.snapshot_source, 80) || null,
    reason_codes: array(trace.reason_codes).map((reason) => reasonCode(reason)).filter(Boolean).slice(0, 24),
    card_code_crop_available_count: Number(trace.card_code_crop_available_count || 0),
    observable_card_code_job_count: Number(trace.observable_card_code_job_count || 0),
    current_code_patch_count: Number(trace.current_code_patch_count || 0),
    typed_direct_code_anchor_count: Number(trace.typed_direct_code_anchor_count || 0),
    threshold_eligible_code_anchor_count: Number(trace.threshold_eligible_code_anchor_count || 0),
    observable_direct_context_role_count: Number(trace.observable_direct_context_role_count || 0),
    terminal_direct_context_role_count: Number(trace.terminal_direct_context_role_count || 0),
    evidence_observable_direct_context_role_count: Number(trace.evidence_observable_direct_context_role_count || 0),
    patch_producing_direct_context_role_count: Number(trace.patch_producing_direct_context_role_count || 0),
    sports_pre_provider_reachability: cleanText(trace.sports_pre_provider_reachability, 80) || null
  };
}

function anchorRouteShadowTrace(result = {}) {
  const shadow = object(result.pre_l2_anchor_late_route_shadow);
  if (!Object.keys(shadow).length) return null;
  const strict = object(shadow.strict_post_refresh);
  const counterfactual = object(shadow.post_provider_context_counterfactual);
  return {
    schema_version: cleanText(shadow.schema_version, 120) || null,
    mode: cleanText(shadow.mode, 80) || null,
    fast_final_eligible: false,
    strict_post_refresh: {
      plan: compactAnchorRoutePlan(strict.plan),
      anchor_count: Number(strict.anchor_count || 0),
      direct_anchor_count: Number(strict.direct_anchor_count || 0),
      input_trace: compactAnchorInputTrace(strict.input_trace)
    },
    post_provider_context_counterfactual: {
      plan: compactAnchorRoutePlan(counterfactual.plan),
      anchor_count: Number(counterfactual.anchor_count || 0),
      direct_anchor_count: Number(counterfactual.direct_anchor_count || 0),
      provider_context_patch_fields: array(counterfactual.provider_context_patch_fields)
        .map((field) => cleanText(field, 80)).filter(Boolean).slice(0, 8),
      provider_already_called: true,
      fast_path_eligible: false,
      input_trace: compactAnchorInputTrace(counterfactual.input_trace)
    },
    effects: {
      catalog_lookup: false,
      provider_skip: false,
      resolver: false,
      renderer: false,
      production_title: false
    }
  };
}

function compactRetrievalQuery(query = {}, lane = "") {
  const row = object(query);
  return {
    retrieval_lane: lane,
    query_id: cleanText(row.query_id, 120) || null,
    family: cleanText(row.family, 80) || null,
    provider_id: cleanText(row.provider_id, 80) || null,
    query: cleanText(row.query, 240) || null,
    fields: array(row.fields).map((field) => cleanText(field, 80)).filter(Boolean).slice(0, 20),
    reason: cleanText(row.reason, 240) || null,
    embedding_role: cleanText(row.embedding_role, 80) || null,
    image_role: cleanText(row.image_role, 80) || null,
    model_id: cleanText(row.model_id, 120) || null,
    model_revision: cleanText(row.model_revision, 120) || null,
    preprocessing_version: cleanText(row.preprocessing_version, 120) || null
  };
}

function compactRetrievalExecutionTrace(entry = {}, lane = "") {
  const row = object(entry);
  return {
    retrieval_lane: lane,
    query_id: cleanText(row.query_id, 120) || null,
    family: cleanText(row.family, 80) || null,
    provider_id: cleanText(row.provider_id, 80) || null,
    status: reasonCode(row.status, "UNKNOWN"),
    reason: reasonCode(row.reason),
    error_code: reasonCode(row.error_code),
    candidate_count: finiteNumber(row.candidate_count),
    latency_ms: finiteNumber(row.latency_ms),
    cache_hit: row.cache_hit === true
  };
}

function retrievalPacketSkipReason(packet = {}) {
  const reasons = [
    ...array(packet.unavailable),
    ...array(packet.deferred)
  ].map((row) => cleanText(object(row).reason, 160)).filter(Boolean);
  return reasons.length ? reasonCode(reasons[0], "RETRIEVAL_EXPLICITLY_SKIPPED") : null;
}

function retrievalLaneTrace(result = {}, lane = "") {
  const rawKey = `${lane}_retrieval`;
  const packetKey = `${lane}_candidate_packet`;
  const rawDeclared = Object.hasOwn(object(result), rawKey);
  const packetDeclared = Object.hasOwn(object(result), packetKey);
  const raw = object(result[rawKey]);
  const packet = object(result[packetKey]?.vector_retrieval);
  const packetStatus = reasonCode(packet.status);
  const packetStatusCode = reasonCode(packet.status_code);
  const candidatesDeclared = Array.isArray(packet.candidates);
  const candidates = array(packet.candidates);
  const rawQueriesDeclared = Array.isArray(raw.queries);
  const rawTraceDeclared = Array.isArray(raw.trace);
  const queryExecutionDeclared = Object.keys(object(raw.query_execution)).length > 0;
  const queryCount = finiteNumber(raw.query_execution?.query_count);
  const queries = array(raw.queries);
  const executionTrace = array(raw.trace);
  const skipReason = retrievalPacketSkipReason(packet);
  const explicitSkip = ["UNAVAILABLE", "DEFERRED_SHADOW"].includes(packetStatus)
    && candidatesDeclared
    && candidates.length === 0
    && Boolean(skipReason);

  const base = {
    retrieval_lane: lane,
    packet_status: packetStatus,
    packet_status_code: packetStatusCode,
    query_count: queryCount,
    candidate_count: candidates.length,
    queries: queries.map((query) => compactRetrievalQuery(query, lane)).slice(0, 30),
    execution_trace: executionTrace.map((entry) => compactRetrievalExecutionTrace(entry, lane)).slice(0, 60)
  };

  if (explicitSkip && !Object.keys(raw).length) {
    return {
      ...base,
      status: "SKIPPED",
      reason_code: skipReason
    };
  }
  if (!rawDeclared || !packetDeclared) {
    return {
      ...base,
      status: "TRACE_MISSING",
      reason_code: !rawDeclared ? "RAW_RETRIEVAL_NOT_PERSISTED" : "CANDIDATE_PACKET_NOT_PERSISTED"
    };
  }
  if (!packetStatus || !candidatesDeclared) {
    return {
      ...base,
      status: "TRACE_MISSING",
      reason_code: "CANDIDATE_PACKET_PAYLOAD_INCOMPLETE"
    };
  }
  if (!rawQueriesDeclared || !rawTraceDeclared || !queryExecutionDeclared || queryCount === null) {
    return {
      ...base,
      status: "TRACE_MISSING",
      reason_code: "RETRIEVAL_EXECUTION_PAYLOAD_INCOMPLETE"
    };
  }
  if (queryCount !== queries.length || (queryCount > 0 && executionTrace.length < queryCount)) {
    return {
      ...base,
      status: "TRACE_MISSING",
      reason_code: "RETRIEVAL_EXECUTION_COUNT_MISMATCH"
    };
  }
  if ((packetStatus === "COMPLETED" && candidates.length === 0)
    || (packetStatus === "NO_CONFIDENT_MATCH" && candidates.length > 0)) {
    return {
      ...base,
      status: "TRACE_MISSING",
      reason_code: "RETRIEVAL_PACKET_STATUS_CANDIDATE_MISMATCH"
    };
  }
  return {
    ...base,
    status: candidates.length ? "RAN" : "RAN_EMPTY",
    reason_code: candidates.length
      ? "AUTHORITATIVE_RETRIEVAL_PACKET_PERSISTED"
      : packetStatusCode || packetStatus || "RETRIEVAL_EXECUTED_WITHOUT_CANDIDATES"
  };
}

function retrievalTrace(result = {}) {
  const lanes = retrievalLanes.map((lane) => retrievalLaneTrace(result, lane));
  const incomplete = lanes.find((lane) => lane.status === "TRACE_MISSING");
  const ran = lanes.some((lane) => lane.status === "RAN");
  const ranOrSkipped = lanes.some((lane) => ["RAN_EMPTY", "SKIPPED"].includes(lane.status));
  const stage = incomplete
    ? { status: "TRACE_MISSING", reason_code: `${incomplete.retrieval_lane.toUpperCase()}_${incomplete.reason_code}` }
    : ran
      ? { status: "RAN", reason_code: "AUTHORITATIVE_RETRIEVAL_TRACE_PERSISTED" }
      : ranOrSkipped
        ? { status: "RAN_EMPTY", reason_code: "RETRIEVAL_EMPTY_OR_EXPLICITLY_SKIPPED" }
        : { status: "TRACE_MISSING", reason_code: "RETRIEVAL_TRACE_NOT_PERSISTED" };
  return {
    stage,
    lanes,
    queries: lanes.flatMap((lane) => lane.queries),
    execution_trace: lanes.flatMap((lane) => lane.execution_trace)
  };
}

function hasOwnAny(value = {}, keys = []) {
  const row = object(value);
  return keys.some((key) => Object.hasOwn(row, key));
}

function stageExecution(result = {}, retrieval = retrievalTrace(result)) {
  const persistedControl = object(result.candidate_control_plane_trace);
  const adaptedControl = object(result.l2_candidate_debug);
  const control = Object.keys(persistedControl).length
    ? persistedControl
    : Object.keys(adaptedControl).length ? adaptedControl : result;
  const stage = (ran, ranReason, missingReason) => ({
    status: ran ? "RAN" : "TRACE_MISSING",
    reason_code: ran ? ranReason : missingReason
  });
  const providerRan = hasOwnAny(result, ["raw_provider_fields"]);
  const normalizationRan = hasOwnAny(result, ["raw_observed_fields", "evidence_fields"]);
  const selectionRan = Object.keys(object(
    control.selected_candidate_decision || result.selected_candidate_decision
  )).length > 0;
  const applicationRan = [
    control.retrieval_application,
    control.candidate_decision_stage,
    result.retrieval_application,
    result.candidate_decision_stage
  ].some((value) => Object.keys(object(value)).length > 0);
  const resolverRan = hasOwnAny(result, ["resolved_fields", "resolved", "resolution_trace"]);
  const rendererRan = hasOwnAny(result, ["rendered_fields", "renderer", "renderer_version"]);
  return {
    provider_observation: stage(providerRan, "RAW_PROVIDER_FIELDS_PERSISTED", "RAW_PROVIDER_FIELDS_NOT_PERSISTED"),
    normalization: stage(normalizationRan, "NORMALIZED_EVIDENCE_PERSISTED", "NORMALIZED_EVIDENCE_NOT_PERSISTED"),
    retrieval: retrieval.stage,
    selection: stage(selectionRan, "SELECTION_DECISION_PERSISTED", "SELECTION_DECISION_NOT_PERSISTED"),
    application: stage(applicationRan, "APPLICATION_DECISION_PERSISTED", "APPLICATION_DECISION_NOT_PERSISTED"),
    resolver: stage(resolverRan, "RESOLVER_OUTPUT_PERSISTED", "RESOLVER_OUTPUT_NOT_PERSISTED"),
    renderer: stage(rendererRan, "RENDERER_OUTPUT_PERSISTED", "RENDERER_OUTPUT_NOT_PERSISTED")
  };
}

function normalizedValuesMatch(field, expected, values = []) {
  const expectedValue = normalizeGoldenSemValue(field, expected);
  if (!expectedValue) return false;
  const expectedParts = expectedValue.split("|").filter(Boolean);
  return array(values).some((value) => {
    const actualValue = normalizeGoldenSemValue(field, value);
    if (!actualValue) return false;
    if (actualValue === expectedValue) return true;
    const actualParts = actualValue.split("|").filter(Boolean);
    return expectedParts.length > 0 && expectedParts.every((part) => actualParts.includes(part));
  });
}

function stageAvailable(packet = {}, stageName = "", legacyPath = []) {
  const status = cleanText(packet.stage_execution?.[stageName]?.status, 40).toUpperCase();
  if (status) return ["RAN", "RAN_EMPTY"].includes(status);
  let current = packet;
  for (const key of legacyPath) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

export function evaluationTraceEnabled(payload = {}) {
  const options = object(payload.provider_options || payload.providerOptions);
  const profile = cleanText(options.recognition_benchmark_profile || payload.benchmark_profile || payload.recognition_benchmark_profile);
  const traceLevel = cleanText(options.trace_level || payload.trace_level).toLowerCase();
  return [recognitionBenchmarkProfileIds.COLD_ALGORITHM, "cold_algorithm"].includes(profile)
    && traceLevel === "evaluation";
}

export function buildEvaluationDecisionTracePacket(result = {}, payload = {}) {
  if (!evaluationTraceEnabled(payload)) return null;
  const authoritativeRetrieval = retrievalTrace(result);
  const candidates = candidateRows(result);
  const selected = candidates.find((candidate) => candidate.selected) || null;
  return Object.freeze({
    schema_version: evaluationDecisionTraceSchemaVersion,
    benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
    trace_level: "evaluation",
    stage_execution: stageExecution(result, authoritativeRetrieval),
    field_lineage: buildFieldLineage(result, candidates),
    provider_observation_fields: compactFields(result.raw_provider_fields || {}),
    normalization: normalizationTrace(result),
    retrieval: {
      status: authoritativeRetrieval.stage.status,
      reason_code: authoritativeRetrieval.stage.reason_code,
      lanes: authoritativeRetrieval.lanes,
      queries: authoritativeRetrieval.queries,
      execution_trace: authoritativeRetrieval.execution_trace,
      top_k: candidates,
      candidate_count: candidates.length
    },
    selection: {
      selected_candidate_trace_key: selected?.candidate_trace_key || null,
      selected_candidate_id: selected?.candidate_id || null,
      selected_candidate_identity_id: selected?.candidate_identity_id || null,
      selected_retrieval_lane: selected?.retrieval_lane || null,
      selected_rank: selected?.rank ?? null,
      selected_score: selected?.score ?? null,
      selected_decision_strength: selected?.decision_strength ?? null,
      selection_margin: finiteNumber(
        result.selected_candidate_decision?.selection_margin,
        result.candidate_control_plane_trace?.selected_candidate_decision?.selection_margin,
        result.l2_candidate_debug?.selected_candidate_decision?.selection_margin
      ),
      selected_reason_codes: array(
        result.selected_candidate_decision?.selected_reason_codes
        || result.candidate_control_plane_trace?.selected_candidate_decision?.selected_reason_codes
        || result.l2_candidate_debug?.selected_candidate_decision?.selected_reason_codes
      ).map((reason) => reasonCode(reason)).filter(Boolean).slice(0, 20),
      rejection_reasons: candidates.filter((candidate) => !candidate.selected)
        .flatMap((candidate) => candidate.rejection_reasons).slice(0, 40)
    },
    application: candidates.flatMap((candidate) => candidate.field_actions.map((action) => ({
      candidate_trace_key: candidate.candidate_trace_key,
      candidate_id: candidate.candidate_id,
      candidate_identity_id: candidate.candidate_identity_id,
      retrieval_lane: candidate.retrieval_lane,
      ...action
    }))).slice(0, 120),
    resolver: resolutionTrace(result),
    renderer: rendererTrace(result),
    anchor_route_shadow: anchorRouteShadowTrace(result)
  });
}

export function classifyEvaluationMissingField(packet = {}, fieldName = "", expectedValue = null) {
  const field = cleanText(fieldName, 80);
  if (!field || !normalizeGoldenSemValue(field, expectedValue)) {
    return missingFieldCategories.UNKNOWN;
  }
  const canonicalEntry = Object.entries(canonicalFieldAliases).find(([canonical, aliases]) => (
    canonical === field || aliases.includes(field)
  ));
  const canonicalField = canonicalEntry?.[0] || field;
  const aliases = [...new Set([canonicalField, ...(canonicalEntry?.[1] || []), field])];
  const lineage = array(packet.field_lineage).find((entry) => cleanText(entry?.field, 80) === canonicalField);
  if (!stageAvailable(packet, "provider_observation", ["provider_observation_fields"])) {
    return missingFieldCategories.TRACE_MISSING;
  }
  const providerValues = [
    ...aliases.flatMap((alias) => stageValues(packet.provider_observation_fields, [alias])),
    ...array(lineage?.provider?.values)
  ];
  if (!normalizedValuesMatch(canonicalField, expectedValue, providerValues)) {
    return missingFieldCategories.PROVIDER_NOT_OBSERVED;
  }
  if (!stageAvailable(packet, "normalization", ["normalization", "output"])) {
    return missingFieldCategories.TRACE_MISSING;
  }
  const normalizedValues = [
    ...aliases.flatMap((alias) => stageValues(packet.normalization?.output, [alias])),
    ...array(lineage?.normalization?.values)
  ];
  if (!normalizedValuesMatch(canonicalField, expectedValue, normalizedValues)) {
    return missingFieldCategories.NORMALIZATION_DROPPED;
  }
  if (!stageAvailable(packet, "retrieval", ["retrieval"])) {
    return missingFieldCategories.TRACE_MISSING;
  }
  const matchingCandidates = array(packet.retrieval?.top_k).filter((candidate) => {
    const values = aliases.flatMap((alias) => stageValues(candidate?.identity_fields, [alias]));
    return normalizedValuesMatch(canonicalField, expectedValue, values);
  });
  if (matchingCandidates.length) {
    if (!stageAvailable(packet, "selection", ["selection"])) {
      return missingFieldCategories.TRACE_MISSING;
    }
    const selectedMatch = matchingCandidates.find((candidate) => candidate?.selected === true);
    if (!selectedMatch) return missingFieldCategories.CANDIDATE_NOT_SELECTED;
    if (!stageAvailable(packet, "application", ["application"])) {
      return missingFieldCategories.TRACE_MISSING;
    }
    return missingFieldCategories.CANDIDATE_FIELD_NOT_APPLIED;
  }
  return missingFieldCategories.CATALOG_NOT_RETRIEVED;
}

export const evaluationMissingFieldCategories = missingFieldCategories;
