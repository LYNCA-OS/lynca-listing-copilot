function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rows(value = {}) {
  if (Array.isArray(value)) return value;
  for (const key of ["cards", "results", "items", "records"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function idOf(row = {}) {
  return clean(row.query_card_id || row.source_feedback_id || row.source_asset_id || row.candidate_id || row.id).toLowerCase();
}

function truthIds(item = {}) {
  return [...new Set([
    ...(item.retrieval_ground_truth?.accepted_identity_ids || []),
    ...(item.retrieval_ground_truth?.accepted_candidate_ids || []),
    item.card_identity_id
  ].map(clean).filter(Boolean))];
}

function identityOf(candidate = {}) {
  return clean(candidate.identity_id || candidate.candidate_identity_id || candidate.candidate_id);
}

function matchesTruth(candidate, accepted) {
  return accepted.includes(identityOf(candidate)) || accepted.includes(clean(candidate.candidate_id));
}

function sourceGroup(candidate = {}) {
  const type = clean(candidate.source_type || candidate.source).toUpperCase();
  if (type === "OFFICIAL_CHECKLIST") return "official_catalog";
  if (["INTERNAL_APPROVED_HISTORY", "INTERNAL_REGISTRY"].includes(type)) return "internal_reviewed_history";
  if (type === "STRUCTURED_DATABASE") return "community_catalog";
  if (type === "VISUAL_VECTOR" || type === "VECTOR") return "vector";
  if (/EXTERNAL|MARKETPLACE|WEB|EBAY/.test(type)) return "external_retrieval";
  return "unknown";
}

function bestSmokeForTrace(smokeRows = [], trace = {}) {
  const traceIds = new Set((trace.retrieval_candidates || []).map((row) => clean(row.candidate_id)));
  const selected = clean(trace.selected_candidate_id);
  const score = (row) => {
    const debug = row.l2_candidate_debug || {};
    const candidates = debug.candidate_application_trace || [];
    return (selected && clean(debug.selected_candidate_id) === selected ? 1_000_000 : 0)
      + candidates.filter((candidate) => traceIds.has(clean(candidate.candidate_id))).length * 10_000
      + (row.ok === true ? 1_000 : 0);
  };
  return [...smokeRows].sort((left, right) => score(right) - score(left))[0] || {};
}

function metric(records, predicate) {
  const denominator = records.length;
  const numerator = records.filter(predicate).length;
  return { numerator, denominator, rate: denominator ? Number((numerator / denominator).toFixed(6)) : null };
}

function isConfirmed(item, field) {
  return clean(item.reviewed_ground_truth?.field_statuses?.[field]).toUpperCase() === "CONFIRMED";
}

function cohortLabels(item = {}, smoke = {}) {
  const category = clean(item.category).toLowerCase() || "unknown";
  const sports = new Set(["baseball", "basketball", "football", "hockey", "mma", "soccer", "tennis"]);
  const tcg = new Set(["pokemon", "pokémon", "magic", "mtg", "yugioh", "yu-gi-oh", "one_piece", "lorcana"]);
  const family = sports.has(category) ? "sports" : tcg.has(category) ? "tcg" : "other";
  const grade = isConfirmed(item, "grading_info") ? "graded" : "raw";
  const cardNumber = isConfirmed(item, "card_number") ? "known_card_number" : "no_card_number";
  const strongAnchor = smoke.pre_l2_anchor_fast_lane_hit === true
    || Number(smoke.pre_l2_anchor_trusted_candidate_count || 0) > 0
    || Object.keys(smoke.preingestion_retrieval_anchor_fields || {}).length > 0;
  return [category, `${family}_${grade}`, cardNumber, strongAnchor ? "strong_anchor" : "cold_start"];
}

function scoreRow(debug = {}, candidateId) {
  const rows = debug.card_domain_reranker?.ranked_candidates || [];
  return rows.find((row) => clean(row.candidate_id) === clean(candidateId)) || null;
}

function selectionFailure({ correct, selected, debug }) {
  if (!selected) {
    const trace = (debug.candidate_application_trace || []).find((row) => clean(row.candidate_id) === clean(correct?.candidate_id));
    if (trace?.decision_eligible === false || trace?.participation_level === "LEVEL_0_SHADOW") return "CORRECT_CANDIDATE_NOT_DECISION_ELIGIBLE";
    return "NO_CANDIDATE_SELECTED";
  }
  const correctScore = scoreRow(debug, correct?.candidate_id);
  const selectedScore = scoreRow(debug, selected);
  if (!correctScore) return "CORRECT_CANDIDATE_NOT_SCORED";
  if (selectedScore && Math.abs(Number(selectedScore.score || 0) - Number(correctScore.score || 0)) < 1e-9
    && Math.abs(Number(selectedScore.embedding_similarity || 0) - Number(correctScore.embedding_similarity || 0)) < 1e-9
    && Math.abs(Number(selectedScore.agreement_score || 0) - Number(correctScore.agreement_score || 0)) < 1e-9) return "IDENTITY_DUPLICATE_TIE";
  if (selectedScore && Number(selectedScore.embedding_similarity || 0) > Number(correctScore.embedding_similarity || 0)
    && Number(correctScore.exact_anchor_score || 0) <= Number(selectedScore.exact_anchor_score || 0)) return "VECTOR_SIMILARITY_OUTRANKED_CORRECT";
  if ((correctScore.conflicting_fields || []).length) return "CORRECT_CANDIDATE_DIRECT_CONFLICT";
  return "WRONG_CANDIDATE_SOFT_SCORE_HIGHER";
}

export function buildRetrievalSelectionDiagnostic({ dataset = {}, audit = {}, trace = {}, smoke = {}, generatedAt = new Date().toISOString() } = {}) {
  const traceById = new Map(rows(trace).map((row) => [idOf(row), row]));
  const auditById = new Map(rows(audit).map((row) => [idOf(row), row]));
  const smokeRowsById = new Map();
  for (const row of rows(smoke)) {
    const id = idOf(row);
    smokeRowsById.set(id, [...(smokeRowsById.get(id) || []), row]);
  }

  const cards = rows(dataset).flatMap((item) => {
    const id = idOf(item);
    const accepted = truthIds(item);
    if (!accepted.length) return [];
    const cardTrace = traceById.get(id) || {};
    const selectedSmoke = bestSmokeForTrace(smokeRowsById.get(id) || [], cardTrace);
    const debug = selectedSmoke.l2_candidate_debug || {};
    const metadataByCandidate = new Map((debug.candidate_application_trace || []).map((row) => [clean(row.candidate_id), row]));
    const candidates = (cardTrace.retrieval_candidates || []).map((candidate) => ({
      ...candidate,
      ...(metadataByCandidate.get(clean(candidate.candidate_id)) || {})
    }));
    const correctCandidates = candidates.filter((candidate) => matchesTruth(candidate, accepted));
    const correct = [...correctCandidates].sort((left, right) => Number(left.rank || left.retrieval_rank) - Number(right.rank || right.retrieval_rank))[0] || null;
    const selected = clean(cardTrace.selected_candidate_id);
    const selectedCorrect = Boolean(selected && correctCandidates.some((candidate) => clean(candidate.candidate_id) === selected));
    return [{
      query_card_id: id,
      item_category: item.category || null,
      cohorts: cohortLabels(item, selectedSmoke),
      correct_candidate_rank: correct ? Number(correct.rank || correct.retrieval_rank) : null,
      correct_candidate_id: correct?.candidate_id || null,
      correct_source_group: correct ? sourceGroup(correct) : null,
      selected_candidate_id: selected || null,
      selected_correct: selectedCorrect,
      selection_margin: Number(debug.selection_margin || 0),
      correct_score: correct ? scoreRow(debug, correct.candidate_id) : null,
      selected_score: selected ? scoreRow(debug, selected) : null,
      selection_failure: correct && !selectedCorrect ? selectionFailure({ correct, selected, debug }) : null,
      candidates: candidates.map((candidate) => ({
        candidate_id: clean(candidate.candidate_id),
        identity_id: identityOf(candidate),
        rank: Number(candidate.rank || candidate.retrieval_rank),
        source_group: sourceGroup(candidate),
        source_type: clean(candidate.source_type || candidate.source) || null,
        correct: matchesTruth(candidate, accepted)
      }))
    }];
  });

  const groups = ["official_catalog", "internal_reviewed_history", "community_catalog", "vector", "external_retrieval", "hybrid"];
  const retrieval = Object.fromEntries(groups.map((group) => [group, Object.fromEntries([1, 5, 20].map((k) => [k, metric(cards, (card) => (
    card.candidates.some((candidate) => candidate.correct && candidate.rank <= k && (group === "hybrid" || candidate.source_group === group))
  ))]))]));
  const cohortNames = [...new Set(cards.flatMap((card) => card.cohorts))].sort();
  const cohorts = Object.fromEntries(cohortNames.map((name) => {
    const members = cards.filter((card) => card.cohorts.includes(name));
    return [name, {
      card_count: members.length,
      retrieval_recall_at_5: metric(members, (card) => card.candidates.some((candidate) => candidate.correct && candidate.rank <= 5)),
      selection_given_recall: metric(members.filter((card) => card.correct_candidate_rank !== null && card.correct_candidate_rank <= 20), (card) => card.selected_correct)
    }];
  }));
  const selectionOpportunities = cards.filter((card) => card.correct_candidate_rank !== null && card.correct_candidate_rank <= 20);
  const applicationOpportunities = [];
  const canonicalApplicationField = (field) => (["parallel_exact", "parallel_family", "surface_color"].includes(clean(field)) ? "print_finish" : clean(field));
  for (const card of rows(audit)) {
    const cardTrace = traceById.get(idOf(card)) || {};
    const selectedCandidateIds = new Set([
      cardTrace.selected_candidate_id,
      ...(cardTrace.selected_candidate_group_ids || [])
    ].map(clean).filter(Boolean));
    for (const [field, result] of Object.entries(card.fields || {})) {
      if (result.application_opportunity !== true) continue;
      const decisions = (cardTrace.application_decisions || []).filter((row) => (
        selectedCandidateIds.has(clean(row.candidate_id))
        && [canonicalApplicationField(row.field), canonicalApplicationField(row.source_field)].includes(field)
      ));
      const blockingDecisions = decisions.filter((row) => ["BLOCK", "REJECT"].includes(clean(row.decision).toUpperCase()));
      const diagnosticDecisions = blockingDecisions.length ? blockingDecisions : decisions;
      applicationOpportunities.push({
        query_card_id: idOf(card),
        field,
        applied: result.application_correct === true,
        reasons: [...new Set(diagnosticDecisions.map((row) => clean(row.reason)).filter(Boolean))],
        decisions: [...new Set(diagnosticDecisions.map((row) => clean(row.decision)).filter(Boolean))]
      });
    }
  }
  const countValues = (values) => Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((entry) => entry === value).length]));
  return {
    schema_version: "retrieval-selection-diagnostic-v1",
    generated_at: generatedAt,
    policy: { holdout_is_read_only: true, diagnostic_only: true, top_k_not_expanded: true },
    retrieval,
    cohorts,
    selection: {
      ...metric(selectionOpportunities, (card) => card.selected_correct),
      failure_counts: countValues(selectionOpportunities.map((card) => card.selection_failure).filter(Boolean)),
      opportunities: selectionOpportunities
    },
    safe_application: {
      ...metric(applicationOpportunities, (row) => row.applied),
      reason_counts: countValues(applicationOpportunities.flatMap((row) => row.reasons.length ? row.reasons : ["NO_APPLICATION_DECISION_RECORDED"])),
      opportunities: applicationOpportunities
    }
  };
}
