import { recognitionBenchmarkProfileIds } from "./recognition-benchmark-profile.mjs";

export const evaluationDecisionTraceSchemaVersion = "evaluation-decision-trace-packet-v2";

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
  const control = Object.keys(object(result.candidate_control_plane_trace)).length
    ? object(result.candidate_control_plane_trace)
    : object(result.l2_candidate_debug);
  const applicationRows = array(control.candidate_application_trace || control.candidate_application_trace_rows);
  const retrieval = object(result.retrieval);
  const retrievalCandidates = array(retrieval.candidates || retrieval.results || retrieval.matches);
  const rows = applicationRows.length ? applicationRows : retrievalCandidates;
  const selectedId = cleanText(control.selected_candidate_id, 180);
  const decisionRows = array(control.retrieval_application?.decisions);
  return rows.slice(0, 20).map((candidate, index) => {
    const row = object(candidate);
    const actions = array(row.field_actions || row.actions).slice(0, 40).map((action) => {
      const item = object(action);
      return {
        field: cleanText(item.field || item.field_name, 80) || null,
        action: reasonCode(item.action || item.decision, "SUPPORT"),
        reason: reasonCode(item.reason_code || item.reason || item.block_reason, "UNSPECIFIED"),
        value: compactValue(item.value ?? item.candidate_value)
      };
    });
    for (const field of array(row.applied_fields)) actions.push({ field: cleanText(field, 80), action: "APPLY", reason: "APPLIED" });
    for (const field of array(row.supported_fields)) actions.push({ field: cleanText(field, 80), action: "SUPPORT", reason: "SUPPORTED_ONLY" });
    for (const field of array(row.blocked_fields)) actions.push({ field: cleanText(field, 80), action: "BLOCK", reason: reasonCode(row.block_reason, "BLOCKED") });
    for (const decision of decisionRows.filter((item) => cleanText(item?.candidate_id, 180) === cleanText(row.candidate_id || row.id || row.identity_id, 180))) {
      actions.push({
        field: cleanText(decision.field || decision.resolver_field, 80) || null,
        action: reasonCode(decision.decision, "SUPPORT"),
        reason: reasonCode(decision.reason, "UNSPECIFIED"),
        value: compactValue(decision.candidate_value)
      });
    }
    const candidateId = cleanText(row.candidate_id || row.id || row.identity_id, 180) || null;
    return {
      candidate_id: candidateId,
      rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : index + 1,
      source: cleanText(row.source || row.provider_id || row.source_type || row.candidate_lane, 80) || null,
      source_trust: cleanText(row.source_trust || row.trust_tier || row.authority_tier, 80) || null,
      score: Number.isFinite(Number(row.score ?? row.total_score)) ? Number(row.score ?? row.total_score) : null,
      selected: row.selected === true || row.selection_status === "SELECTED" || Boolean(selectedId && selectedId === candidateId),
      rejection_reasons: array(row.rejection_reasons || row.reason_codes)
        .map((value) => reasonCode(value)).filter(Boolean).slice(0, 20),
      field_actions: actions.slice(0, 40)
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
    const candidateDecisions = candidates.flatMap((candidate) => candidate.field_actions
      .filter((action) => aliases.includes(action.field) || action.field === field)
      .map((action) => ({
        candidate_id: candidate.candidate_id,
        selected: candidate.selected,
        action: action.action,
        reason: action.reason,
        value: action.value ?? null
      }))).slice(0, 40);
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
        owner: "CANDIDATE_CONTROL_PLANE",
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
    field_lineage: buildFieldLineage(result, candidates),
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
