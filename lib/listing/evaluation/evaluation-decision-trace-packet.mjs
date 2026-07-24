import { recognitionBenchmarkProfileIds } from "./recognition-benchmark-profile.mjs";

export const evaluationDecisionTraceSchemaVersion = "evaluation-decision-trace-packet-v1";

const missingFieldCategories = Object.freeze({
  PROVIDER_NOT_OBSERVED: "PROVIDER_NOT_OBSERVED",
  NORMALIZATION_DROPPED: "NORMALIZATION_DROPPED",
  CATALOG_NOT_RETRIEVED: "CATALOG_NOT_RETRIEVED"
});

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

function candidateRows(result = {}) {
  const control = object(result.candidate_control_plane_trace);
  const applicationRows = array(control.candidate_application_trace || control.candidate_application_trace_rows);
  const retrieval = object(result.retrieval);
  const retrievalCandidates = array(retrieval.candidates || retrieval.results || retrieval.matches);
  const rows = applicationRows.length ? applicationRows : retrievalCandidates;
  return rows.slice(0, 20).map((candidate, index) => {
    const row = object(candidate);
    const actions = array(row.field_actions || row.actions).slice(0, 40).map((action) => {
      const item = object(action);
      return {
        field: cleanText(item.field || item.field_name, 80) || null,
        action: reasonCode(item.action || item.decision, "SUPPORT"),
        reason: reasonCode(item.reason_code || item.reason || item.block_reason, "UNSPECIFIED")
      };
    });
    for (const field of array(row.applied_fields)) actions.push({ field: cleanText(field, 80), action: "APPLY", reason: "APPLIED" });
    for (const field of array(row.supported_fields)) actions.push({ field: cleanText(field, 80), action: "SUPPORT", reason: "SUPPORTED_ONLY" });
    for (const field of array(row.blocked_fields)) actions.push({ field: cleanText(field, 80), action: "BLOCK", reason: reasonCode(row.block_reason, "BLOCKED") });
    return {
      candidate_id: cleanText(row.candidate_id || row.id || row.identity_id, 180) || null,
      rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : index + 1,
      source: cleanText(row.source || row.provider_id || row.source_type, 80) || null,
      source_trust: cleanText(row.source_trust || row.trust_tier || row.authority_tier, 80) || null,
      score: Number.isFinite(Number(row.score ?? row.total_score)) ? Number(row.score ?? row.total_score) : null,
      selected: row.selected === true || row.selection_status === "SELECTED",
      rejection_reasons: array(row.rejection_reasons || row.reason_codes)
        .map((value) => reasonCode(value)).filter(Boolean).slice(0, 20),
      field_actions: actions.slice(0, 40)
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

export function evaluationTraceEnabled(payload = {}) {
  const options = object(payload.provider_options || payload.providerOptions);
  const profile = cleanText(options.recognition_benchmark_profile || payload.benchmark_profile || payload.recognition_benchmark_profile);
  const traceLevel = cleanText(options.trace_level || payload.trace_level).toLowerCase();
  return [recognitionBenchmarkProfileIds.COLD_ALGORITHM, "cold_algorithm"].includes(profile)
    && traceLevel === "evaluation";
}

export function buildEvaluationDecisionTracePacket(result = {}, payload = {}) {
  if (!evaluationTraceEnabled(payload)) return null;
  const candidates = candidateRows(result);
  const retrieval = object(result.retrieval);
  const selected = candidates.find((candidate) => candidate.selected) || null;
  return Object.freeze({
    schema_version: evaluationDecisionTraceSchemaVersion,
    benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
    trace_level: "evaluation",
    provider_observation_fields: compactFields(result.raw_provider_fields || {}),
    normalization: normalizationTrace(result),
    retrieval: {
      query: compactFields(retrieval.query || retrieval.query_fields || result.retrieval_query || {}),
      top_k: candidates,
      candidate_count: candidates.length
    },
    selection: {
      selected_candidate_id: selected?.candidate_id || null,
      selected_rank: selected?.rank || null,
      rejection_reasons: candidates.filter((candidate) => !candidate.selected)
        .flatMap((candidate) => candidate.rejection_reasons).slice(0, 40)
    },
    application: candidates.flatMap((candidate) => candidate.field_actions.map((action) => ({
      candidate_id: candidate.candidate_id,
      ...action
    }))).slice(0, 120),
    resolver: resolutionTrace(result),
    renderer: rendererTrace(result)
  });
}

export function classifyEvaluationMissingField(packet = {}, fieldName = "") {
  const field = cleanText(fieldName, 80);
  if (!field || !Object.hasOwn(object(packet.provider_observation_fields), field)) {
    return missingFieldCategories.PROVIDER_NOT_OBSERVED;
  }
  if (!Object.hasOwn(object(packet.normalization?.output), field)) {
    return missingFieldCategories.NORMALIZATION_DROPPED;
  }
  return missingFieldCategories.CATALOG_NOT_RETRIEVED;
}

export const evaluationMissingFieldCategories = missingFieldCategories;
