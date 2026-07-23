const sourceNames = Object.freeze(["catalog", "vector"]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function packetRetrieval(packet = {}) {
  const retrieval = packet?.vector_retrieval;
  return retrieval && typeof retrieval === "object" && !Array.isArray(retrieval) ? retrieval : {};
}

function packetCandidateCount(packet = {}) {
  const retrieval = packetRetrieval(packet);
  return Array.isArray(retrieval.candidates) ? retrieval.candidates.length : 0;
}

function packetUnavailableReasons(packet = {}) {
  const retrieval = packetRetrieval(packet);
  const rows = Array.isArray(retrieval.unavailable) ? retrieval.unavailable : [];
  return [...new Set([
    ...rows.map((row) => cleanText(row?.reason)),
    /UNAVAILABLE|TIMEOUT|ERROR/i.test(`${retrieval.status || ""} ${retrieval.status_code || ""}`)
      ? cleanText(retrieval.reason || retrieval.status_code || retrieval.status)
      : ""
  ].filter(Boolean))];
}

function traceLane(row = {}) {
  const explicit = cleanText(row.candidate_lane || row.lane).toLowerCase();
  if (explicit.includes("vector")) return "vector";
  if (explicit.includes("catalog") || explicit.includes("checklist") || explicit.includes("registry")) return "catalog";
  const source = cleanText(row.source_type || row.candidate_source_type).toLowerCase();
  if (source.includes("vector")) return "vector";
  if (source.includes("catalog") || source.includes("checklist") || source.includes("registry") || source.includes("official")) return "catalog";
  return "";
}

function selectedLane(result = {}) {
  if (result.exact_anchor_finalize?.used === true || result.provider === "v4_anchor_router") return "catalog";
  const selectedId = cleanText(
    result.candidate_decision_stage?.selected_candidate_id
      || result.selected_candidate_decision?.selected_candidate_id
  );
  if (!selectedId) return "";
  const row = (Array.isArray(result.candidate_application_trace) ? result.candidate_application_trace : [])
    .find((candidate) => cleanText(candidate?.candidate_id) === selectedId);
  return traceLane(row);
}

function sourceState({ source, funnel = {}, packet = {}, selected = false, exactAnchor = false } = {}) {
  const packetCount = packetCandidateCount(packet);
  const funnelCount = finiteCount(funnel.raw_candidate_count);
  const candidateCount = exactAnchor ? Math.max(1, packetCount, funnelCount) : Math.max(packetCount, funnelCount);
  const unavailableReasons = packetUnavailableReasons(packet);
  const queryAttempted = exactAnchor
    || funnel.query_attempted === true
    || funnel.pre_observation_query_attempted === true
    || funnel.post_observation_query_attempted === true
    || packetCount > 0
    || unavailableReasons.length > 0
    || Boolean(cleanText(packetRetrieval(packet).status));
  const degraded = unavailableReasons.length > 0 && candidateCount === 0;
  const status = candidateCount > 0
    ? "AVAILABLE"
    : degraded
      ? "DEGRADED"
      : queryAttempted
        ? "EMPTY"
        : "NOT_RUN";
  return {
    source,
    status,
    query_attempted: queryAttempted,
    available: candidateCount > 0,
    degraded,
    selected,
    raw_candidate_count: candidateCount,
    packet_candidate_count: packetCount,
    funnel_candidate_count: funnelCount,
    prompt_candidate_count: finiteCount(funnel.prompt_candidate_count),
    unavailable_reasons: unavailableReasons
  };
}

export function buildRetrievalSourceContract(result = {}) {
  const selected = selectedLane(result);
  const exactAnchor = result.exact_anchor_finalize?.used === true || result.provider === "v4_anchor_router";
  const sources = {
    catalog: sourceState({
      source: "catalog",
      funnel: result.catalog_activation_funnel,
      packet: result.catalog_candidate_packet,
      selected: selected === "catalog",
      exactAnchor
    }),
    vector: sourceState({
      source: "vector",
      funnel: result.vector_activation_funnel,
      packet: result.vector_candidate_packet,
      selected: selected === "vector"
    })
  };
  const violations = [];
  for (const source of sourceNames) {
    const state = sources[source];
    if (state.packet_candidate_count > 0 && state.funnel_candidate_count === 0) {
      violations.push({
        severity: "ERROR",
        code: "RETRIEVAL_SOURCE_PACKET_BYPASSED_FUNNEL",
        source
      });
    }
    if (state.selected && !state.available) {
      violations.push({
        severity: "ERROR",
        code: "SELECTED_RETRIEVAL_SOURCE_NOT_OBSERVABLE",
        source
      });
    }
    if (state.degraded) {
      violations.push({
        severity: "WARNING",
        code: "RETRIEVAL_SOURCE_DEGRADED",
        source,
        reasons: state.unavailable_reasons
      });
    }
  }
  const availableSources = sourceNames.filter((source) => sources[source].available);
  const degradedSources = sourceNames.filter((source) => sources[source].degraded);
  return {
    schema_version: "v4-retrieval-source-contract-v1",
    contract_status: violations.some((violation) => violation.severity === "ERROR")
      ? "FAILED"
      : degradedSources.length
        ? "DEGRADED"
        : "PASSED",
    isolation_model: {
      catalog_and_vector_are_independent_lanes: true,
      observation_provider_is_not_a_retrieval_dependency: true,
      source_failure_is_fail_soft: true,
      field_application_remains_fail_closed: true
    },
    sources,
    available_sources: availableSources,
    degraded_sources: degradedSources,
    redundancy_active: availableSources.length > 1,
    surviving_source_available: availableSources.length > 0,
    catalog_available: sources.catalog.available,
    catalog_selected: sources.catalog.selected,
    violations
  };
}
