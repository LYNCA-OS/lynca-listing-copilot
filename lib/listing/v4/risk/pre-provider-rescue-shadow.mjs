const schemaVersion = "pre-provider-rescue-shadow-v1";

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function present(value) {
  if (Array.isArray(value)) return value.some(present);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value ?? "").trim().length > 0;
}

function mergedFields(...sources) {
  return Object.assign({}, ...sources.map(plainObject));
}

function hasAny(fields, names) {
  return names.some((name) => present(fields[name]));
}

function serialDenominatorPresent(fields) {
  if (hasAny(fields, [
    "numerical_rarity",
    "numbered_to",
    "print_run_denominator",
    "serial_denominator",
    "expected_serial_denominator"
  ])) return true;
  return /\/\s*\d{1,6}\b/.test(String(fields.serial_number || fields.print_run_number || ""));
}

function candidateFields(candidate = {}) {
  return plainObject(candidate.fields || candidate.resolved_fields || candidate.resolved);
}

function catalogCandidates(context = {}) {
  const packet = plainObject(context.assistPacket || context.assist_packet);
  // Catalog and vector candidates intentionally share one assist-packet
  // contract. The provider identity is carried by each candidate/source; the
  // container remains `vector_retrieval` for backward compatibility.
  const retrieval = plainObject(
    packet.vector_retrieval
    || packet.catalog_retrieval
    || packet.catalog
    || context.retrieval
  );
  const candidates = [
    context.candidates,
    context.prompt_candidates,
    packet.candidates,
    retrieval.candidates
  ].find(Array.isArray);
  return Array.isArray(candidates) ? candidates : [];
}

function catalogEligibility(context = {}) {
  return plainObject(context.catalog_assist_eligibility || context.eligibility);
}

function vectorStatus(context = {}) {
  if (!context || typeof context !== "object") return "NOT_STARTED";
  const packet = plainObject(context.packet || context.assistPacket?.vector_retrieval);
  return String(packet.status || context.worker?.status || context.status || "AVAILABLE").toUpperCase();
}

/**
 * Build a value-free, observation-only risk snapshot before the main provider
 * call. The snapshot cannot select a candidate or mutate title strategy. It is
 * deliberately expressed in capabilities so OCR, catalog, and embedding
 * implementations can be replaced independently.
 */
export function buildPreProviderRescueShadow({
  enabled = false,
  resolvedFields = {},
  confirmedPreingestionFields = {},
  catalogContext = null,
  vectorContext = null,
  preingestionBundlePresent = false
} = {}) {
  if (!enabled) {
    return {
      schema_version: schemaVersion,
      enabled: false,
      mode: "SHADOW_ONLY",
      strategy_mutation_allowed: false,
      critical_path_budget_ms: 0
    };
  }

  const fields = mergedFields(resolvedFields, confirmedPreingestionFields);
  const candidates = catalogCandidates(catalogContext || {});
  const eligibility = catalogEligibility(catalogContext || {});
  const promptCandidateCount = Math.max(
    Number(eligibility.prompt_candidate_count || 0),
    Array.isArray(eligibility.prompt_candidate_ids) ? eligibility.prompt_candidate_ids.length : 0
  );
  const conflictBlockedCount = Number(eligibility.conflict_blocked_count || 0);
  const catalogHasParallel = candidates.some((candidate) => hasAny(candidateFields(candidate), [
    "parallel",
    "parallel_family",
    "parallel_exact",
    "surface_color",
    "print_finish"
  ]));
  const numbered = serialDenominatorPresent(fields);
  const parallelObserved = hasAny(fields, [
    "parallel",
    "parallel_family",
    "parallel_exact",
    "surface_color",
    "print_finish"
  ]);
  const printedCodeObserved = hasAny(fields, [
    "card_number",
    "tcg_card_number",
    "collector_number",
    "checklist_code"
  ]);
  const subjectObserved = hasAny(fields, ["player", "players", "subject", "subjects", "character"]);
  const productObserved = hasAny(fields, ["year", "product", "set", "manufacturer", "brand"]);
  const reasons = [];
  let riskPoints = 0;

  if (numbered && !parallelObserved) {
    reasons.push("NUMBERED_WITHOUT_PARALLEL_IDENTITY");
    riskPoints += 6;
  }
  if (conflictBlockedCount > 0) {
    reasons.push("CATALOG_CONFLICT_BLOCKED");
    riskPoints += 3;
  }
  if (promptCandidateCount > 1) {
    reasons.push("MULTIPLE_CATALOG_IDENTITIES");
    riskPoints += 2;
  }
  if (!printedCodeObserved && !(subjectObserved && productObserved)) {
    reasons.push("WEAK_PRE_PROVIDER_IDENTITY_ANCHOR");
    riskPoints += 2;
  }
  if (numbered && catalogHasParallel && !parallelObserved) {
    reasons.push("CATALOG_PARALLEL_NOT_YET_OBSERVED");
    riskPoints += 2;
  }

  const recommendedLanes = [];
  if (numbered && !parallelObserved) recommendedLanes.push("FOCUSED_FINISH_CROP");
  if (numbered && catalogHasParallel && !parallelObserved) recommendedLanes.push("CATALOG_PARALLEL_CONFIRMATION");
  if (preingestionBundlePresent && reasons.length) recommendedLanes.push("OCR_RENDEZVOUS");
  if ((promptCandidateCount > 1 || conflictBlockedCount > 0) && vectorContext) {
    recommendedLanes.push("VECTOR_IDENTITY_TIEBREAK");
  }

  const riskScore = Math.min(1, riskPoints / 10);
  return {
    schema_version: schemaVersion,
    enabled: true,
    mode: "SHADOW_ONLY",
    strategy_mutation_allowed: false,
    critical_path_budget_ms: 0,
    rescue_recommended: riskScore >= 0.6,
    risk_score: Number(riskScore.toFixed(3)),
    reasons,
    recommended_lanes: [...new Set(recommendedLanes)],
    signals: {
      numerical_rarity_observed: numbered,
      parallel_identity_observed: parallelObserved,
      printed_code_observed: printedCodeObserved,
      subject_observed: subjectObserved,
      product_observed: productObserved,
      preingestion_bundle_present: preingestionBundlePresent === true,
      catalog_prompt_candidate_count: promptCandidateCount,
      catalog_conflict_blocked_count: conflictBlockedCount,
      catalog_parallel_candidate_present: catalogHasParallel,
      vector_status: vectorStatus(vectorContext)
    }
  };
}

export const preProviderRescueShadowSchemaVersion = schemaVersion;
