import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";

const smokeModes = new Set(["recapture_smoke", "holdout_smoke", "cold_start_smoke"]);
const topKValues = [1, 3, 5, 10];

const fieldNames = Object.freeze([
  "year",
  "product_or_set",
  "set",
  "subject",
  "subject_count",
  "card_type",
  "variant_or_parallel",
  "collector_number",
  "checklist_code",
  "serial_denominator",
  "surface_color",
  "grade"
]);

const reviewRequiredParsedFields = new Set([
  "product_or_set",
  "set",
  "card_type",
  "variant_or_parallel",
  "parallel_exact",
  "official_card_type",
  "rc",
  "ssp",
  "case_hit"
]);

function argValues(argv, name) {
  const values = [];
  argv.forEach((value, index) => {
    if (value === name && argv[index + 1]) values.push(argv[index + 1]);
    else if (value.startsWith(`${name}=`)) values.push(value.slice(name.length + 1));
  });
  return values;
}

function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value) {
  return normalizeToken(value).split(/\s+/).filter(Boolean);
}

function titleComparison(referenceTitle = "", candidateTitle = "") {
  const referenceTokens = new Set(titleTokens(referenceTitle));
  const candidateTokens = new Set(titleTokens(candidateTitle));
  if (!referenceTokens.size) return {
    token_recall: null,
    exact: false
  };
  const overlap = [...referenceTokens].filter((token) => candidateTokens.has(token)).length;
  return {
    token_recall: Number((overlap / referenceTokens.size).toFixed(6)),
    exact: normalizeToken(referenceTitle) === normalizeToken(candidateTitle) && Boolean(normalizeToken(referenceTitle))
  };
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSet(values = []) {
  return [...new Set(values.map(normalizeToken).filter(Boolean))].sort();
}

function arrayValues(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  return text ? [text] : [];
}

function subjectValues(fields = {}) {
  return [
    ...arrayValues(fields.players),
    ...arrayValues(fields.player),
    ...arrayValues(fields.subject),
    ...arrayValues(fields.subjects),
    ...arrayValues(fields.character)
  ].filter(Boolean);
}

function serialDenominator(value = "") {
  return cleanText(value).match(/\/\s*0*(\d{1,4})\b/)?.[1] || "";
}

function gradeValue(fields = {}) {
  return normalizeSet([fields.grade_company, fields.card_grade, fields.auto_grade].filter(Boolean));
}

function fieldValue(fields = {}, field = "") {
  if (field === "subject") return normalizeSet(subjectValues(fields));
  if (field === "subject_count") return subjectValues(fields).length || null;
  if (field === "product_or_set") return normalizeSet([fields.manufacturer, fields.product, fields.set].filter(Boolean));
  if (field === "card_type") return normalizeSet([fields.official_card_type, fields.card_type, fields.card_name].filter(Boolean));
  if (field === "variant_or_parallel") return normalizeSet([fields.parallel_exact, fields.parallel, fields.surface_color, fields.variation, fields.insert].filter(Boolean));
  if (field === "serial_denominator") {
    const denominator = fields.serial_denominator || serialDenominator(fields.serial_number || fields.title);
    return denominator ? `/${denominator}` : "";
  }
  if (field === "grade") return gradeValue(fields);
  return cleanText(fields[field]);
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function valuesEqual(left, right) {
  if (!hasValue(left) || !hasValue(right)) return null;
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = Array.isArray(left) ? left : normalizeSet([left]);
    const b = Array.isArray(right) ? right : normalizeSet([right]);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return normalizeToken(left) === normalizeToken(right);
}

function referenceTitle(result = {}) {
  return cleanText(result.corrected_title_reference || result.corrected_title || result.reviewed_ground_truth?.title || result.reference_title);
}

function finalTitle(result = {}) {
  return cleanText(result.final_evaluated_title || result.scored_title || result.final_title || result.title || result.rendered_fields?.title || result.rendered_fields?.rendered_title);
}

function rawProviderTitle(result = {}) {
  return cleanText(result.raw_model_title || result.raw_title || result.title || result.final_title);
}

function candidateId(candidate = {}, index = 0) {
  return cleanText(candidate.id || candidate.candidate_id || candidate.candidate_identity_id || candidate.identity_id || candidate.source_url || `candidate-${index + 1}`);
}

function candidateTitle(candidate = {}) {
  return cleanText(candidate.reference_title || candidate.canonical_title || candidate.title || candidate.evidence_excerpt);
}

function candidateSourceType(candidate = {}) {
  return cleanText(candidate.candidate_source_type || candidate.source_type || candidate.provider || candidate.provider_id || candidate.source_provider || "unknown");
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => {
    if (typeof value === "string") return cleanText(value);
    return cleanText(value?.field || value?.field_name || value?.name || value?.conflicting_field || "");
  }).filter(Boolean))];
}

function candidateConflicts(candidate = {}) {
  return uniqueStrings([
    ...(Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : []),
    ...(Array.isArray(candidate.direct_evidence_conflicts) ? candidate.direct_evidence_conflicts : []),
    ...(Array.isArray(candidate.conflicts) ? candidate.conflicts : [])
  ]);
}

function compactCandidate(candidate = {}, index = 0, source = "") {
  return {
    candidate_id: candidateId(candidate, index),
    source_type: source || candidateSourceType(candidate),
    source_trust: cleanText(candidate.source_trust || candidate.trust || candidate.source_tier || ""),
    rank: finiteNumber(candidate.rank, index + 1),
    title: candidateTitle(candidate),
    match_score: finiteNumber(candidate.match_score, finiteNumber(candidate.normalized_score, finiteNumber(candidate.raw_score, null))),
    normalized_score: finiteNumber(candidate.normalized_score, null),
    front_similarity: finiteNumber(candidate.front_similarity, null),
    back_similarity: finiteNumber(candidate.back_similarity, null),
    supporting_fields: uniqueStrings([
      ...(Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : []),
      ...(Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [])
    ]),
    conflicting_fields: candidateConflicts(candidate),
    raw: candidate
  };
}

function collectPacketCandidates(packet = {}, source = "") {
  const candidates = [];
  const push = (candidate) => {
    if (candidate && typeof candidate === "object") candidates.push(candidate);
  };
  if (Array.isArray(packet.candidates)) packet.candidates.forEach(push);
  if (Array.isArray(packet.vector_retrieval?.candidates)) packet.vector_retrieval.candidates.forEach(push);
  if (Array.isArray(packet.retrieval?.candidates)) packet.retrieval.candidates.forEach(push);
  return candidates.map((candidate, index) => compactCandidate(candidate, index, source));
}

function collectCandidates(result = {}) {
  const catalog = [
    ...(Array.isArray(result.catalog_candidates) ? result.catalog_candidates.map((candidate, index) => compactCandidate(candidate, index, "catalog")) : []),
    ...collectPacketCandidates(result.catalog_candidate_packet, "catalog_packet"),
    ...collectPacketCandidates(result.catalog_assist_packet, "catalog_assist")
  ];
  const vector = [
    ...(Array.isArray(result.vector_candidates) ? result.vector_candidates.map((candidate, index) => compactCandidate(candidate, index, "vector")) : []),
    ...collectPacketCandidates(result.vector_candidate_packet, "vector_packet"),
    ...collectPacketCandidates(result.vector_assist_packet, "vector_assist")
  ];
  const postgres = [];
  (Array.isArray(result.retrieval?.sources) ? result.retrieval.sources : [])
    .filter((source) => /postgres|hybrid/i.test(source.provider_id || source.source_type || ""))
    .forEach((source, index) => postgres.push(compactCandidate(source, index, "postgres_hybrid")));

  const seen = new Set();
  const dedupe = (candidate) => {
    const key = `${candidate.source_type}:${candidate.candidate_id}:${normalizeToken(candidate.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  return {
    catalog: catalog.filter(dedupe).slice(0, 10),
    vector: vector.filter(dedupe).slice(0, 10),
    postgres_hybrid: postgres.filter(dedupe).slice(0, 10)
  };
}

function parsedFieldsFromTitle(title = "") {
  const parsed = parseReviewedTitleFields(title);
  parsed.title = title;
  return parsed;
}

function parsedFieldConfidence(field = "", value) {
  if (!hasValue(value)) return null;
  if (reviewRequiredParsedFields.has(field)) return "REVIEW_REQUIRED";
  if (["year", "collector_number", "checklist_code", "serial_denominator", "grade", "surface_color"].includes(field)) return "HIGH";
  if (["subject", "subject_count"].includes(field)) return "MEDIUM";
  return "REVIEW_REQUIRED";
}

function parsedCorrectedTitleLayer(title = "") {
  const parsed = parsedFieldsFromTitle(title);
  const fields = {};
  fieldNames.forEach((field) => {
    const value = fieldValue(parsed, field);
    if (!hasValue(value)) return;
    fields[field] = {
      value,
      source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
      parser_confidence: parsedFieldConfidence(field, value),
      promotion_allowed: false
    };
  });
  return {
    title,
    title_status: "VERIFIED_CANONICAL_TITLE",
    fields,
    reviewed_internal_promoted: false
  };
}

function fieldDiff(result = {}) {
  const corrected = referenceTitle(result);
  const predicted = finalTitle(result);
  const gtParsed = parsedFieldsFromTitle(corrected);
  const predictedParsed = parsedFieldsFromTitle(predicted);
  return fieldNames.map((field) => {
    const expected = fieldValue(gtParsed, field);
    if (!hasValue(expected)) return null;
    const actual = fieldValue(predictedParsed, field);
    return {
      query_card_id: cleanText(result.candidate_id || result.query_card_id || result.asset_id),
      field,
      expected,
      actual,
      is_correct: valuesEqual(expected, actual) === true,
      expected_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
      actual_status: hasValue(actual) ? "PREDICTED_TITLE_PARSE" : "MISSING"
    };
  }).filter(Boolean);
}

function labelCandidate(candidate = {}, correctedTitle = "") {
  const comparison = titleComparison(correctedTitle, candidate.title);
  const gtParsed = parsedFieldsFromTitle(correctedTitle);
  const candidateParsed = parsedFieldsFromTitle(candidate.title);
  const fieldResults = [
    valuesEqual(fieldValue(gtParsed, "year"), fieldValue(candidateParsed, "year")),
    valuesEqual(fieldValue(gtParsed, "product_or_set"), fieldValue(candidateParsed, "product_or_set")),
    valuesEqual(fieldValue(gtParsed, "subject"), fieldValue(candidateParsed, "subject")),
    valuesEqual(fieldValue(gtParsed, "subject_count"), fieldValue(candidateParsed, "subject_count")),
    valuesEqual(fieldValue(gtParsed, "serial_denominator"), fieldValue(candidateParsed, "serial_denominator")),
    valuesEqual(fieldValue(gtParsed, "surface_color"), fieldValue(candidateParsed, "surface_color"))
  ].filter((value) => value !== null);
  const hasBlockingConflict = candidate.conflicting_fields.some((field) => !/serial_number|grade|cert/i.test(field));
  const fieldMismatch = fieldResults.some((value) => value === false);
  const supportingMatches = fieldResults.filter((value) => value === true).length;
  return {
    ...comparison,
    label_is_correct: !hasBlockingConflict && !fieldMismatch && (comparison.exact || (Number(comparison.token_recall || 0) >= 0.9 && supportingMatches >= 2))
  };
}

function isSelfLeakageCandidate(candidate = {}, result = {}, correctedTitle = "") {
  const queryIds = [
    result.candidate_id,
    result.query_card_id,
    result.asset_id,
    result.source_feedback_id,
    result.physical_card_id
  ].map(cleanText).filter(Boolean);
  const raw = candidate.raw || {};
  const candidateIds = [
    candidate.candidate_id,
    raw.source_feedback_id,
    raw.query_card_id,
    raw.asset_id,
    raw.physical_card_id,
    raw.reference_metadata?.source_feedback_id,
    raw.reference_metadata?.query_card_id
  ].map(cleanText).filter(Boolean);
  if (queryIds.some((id) => candidateIds.includes(id))) return true;
  if (raw.field_derivation?.corrected_title_as_temporary_gt === true || raw.reference_metadata?.corrected_title_as_temporary_gt === true) return true;
  return titleComparison(correctedTitle, candidate.title).exact === true && /corrected|temporary|feedback|catalog/i.test(candidate.source_type || "");
}

function candidatesForMode(result = {}, mode = "recapture_smoke") {
  const corrected = referenceTitle(result);
  const packets = collectCandidates(result);
  const all = [
    ...packets.catalog.map((candidate) => ({ ...candidate, channel: "catalog" })),
    ...packets.vector.map((candidate) => ({ ...candidate, channel: "vector" })),
    ...packets.postgres_hybrid.map((candidate) => ({ ...candidate, channel: "postgres_hybrid" }))
  ].map((candidate) => ({
    ...candidate,
    ...labelCandidate(candidate, corrected)
  }));
  const leakageCandidates = all.filter((candidate) => isSelfLeakageCandidate(candidate, result, corrected));
  const filtered = all.filter((candidate) => {
    if (mode === "recapture_smoke") return true;
    if (isSelfLeakageCandidate(candidate, result, corrected)) return false;
    if (mode === "cold_start_smoke" && candidate.label_is_correct === true) return false;
    return true;
  });
  return {
    packets,
    all,
    filtered,
    leakageCandidates
  };
}

function selectedCandidateId(result = {}) {
  return cleanText(
    result.candidate_proxy_decision?.selected_candidate_id
    || result.catalog_selected_candidate_id
    || result.vector_selected_candidate_id
    || result.vector_candidate_decision?.selected_candidate_id
    || ""
  );
}

function selectedCandidate(result = {}, candidates = []) {
  const selectedId = selectedCandidateId(result);
  if (!selectedId) return null;
  return candidates.find((candidate) => candidate.candidate_id === selectedId) || null;
}

function usableDraft(result = {}) {
  if (result.technical_failure === true || result.status === "FAILED" || result.confidence === "FAILED") return false;
  if (!finalTitle(result)) return false;
  return true;
}

function decisionTrace(result = {}, mode = "recapture_smoke") {
  const corrected = referenceTitle(result);
  const modeCandidates = candidatesForMode(result, mode);
  const selected = selectedCandidate(result, modeCandidates.filtered);
  const diffs = fieldDiff(result);
  const errorTaxonomy = errorTaxonomyForResult(result, modeCandidates, selected, diffs, mode);
  const traceCandidates = (channel) => modeCandidates.filtered
    .filter((candidate) => candidate.channel === channel)
    .slice(0, 10)
    .map(withoutRaw);
  return {
    schema_version: "smoke-self-improving-decision-trace-v0",
    smoke_mode: mode,
    query_card_id: cleanText(result.candidate_id || result.query_card_id || result.asset_id),
    raw_provider_fields: result.raw_provider_fields || result.fields || {},
    normalized_evidence: result.normalized_evidence || {},
    catalog_candidates_top10: traceCandidates("catalog"),
    vector_candidates_top10: traceCandidates("vector"),
    postgres_hybrid_candidates_top10: traceCandidates("postgres_hybrid"),
    raw_candidate_counts: {
      catalog: modeCandidates.packets.catalog.length,
      vector: modeCandidates.packets.vector.length,
      postgres_hybrid: modeCandidates.packets.postgres_hybrid.length,
      filtered_total: modeCandidates.filtered.length
    },
    selected_candidate: selected ? withoutRaw(selected) : null,
    retrieval_title_assist_used: Boolean(result.retrieval_title_assist_used),
    vector_lazy_skip: Boolean(result.vector_lazy_skip),
    catalog_cache_hit: Boolean(result.catalog_cache_hit),
    resolved_fields: result.resolved_fields || result.resolved || {},
    rendered_title: finalTitle(result),
    corrected_title: corrected,
    corrected_title_truth: {
      value: corrected,
      status: "VERIFIED_CANONICAL_TITLE"
    },
    parsed_corrected_title_fields: parsedCorrectedTitleLayer(corrected),
    field_diff: diffs,
    error_taxonomy: errorTaxonomy,
    leakage_guard: {
      excluded_self_candidate_count: mode === "recapture_smoke" ? 0 : modeCandidates.leakageCandidates.length,
      recapture_score_must_not_be_called_blind_accuracy: mode === "recapture_smoke"
    }
  };
}

function withoutRaw(candidate = {}) {
  const { raw, ...rest } = candidate;
  return rest;
}

function errorTaxonomyForResult(result = {}, modeCandidates = {}, selected = null, diffs = [], mode = "recapture_smoke") {
  const errors = [];
  if (result.technical_failure === true || result.status === "FAILED" || result.confidence === "FAILED") errors.push("PROVIDER_FAILURE");
  if (!modeCandidates.filtered.some((candidate) => candidate.label_is_correct === true)) errors.push("CANDIDATE_MISS");
  if (modeCandidates.filtered.some((candidate) => candidate.label_is_correct === true) && selected && selected.label_is_correct !== true) errors.push("CANDIDATE_SELECTION_ERROR");
  if (mode !== "recapture_smoke" && modeCandidates.leakageCandidates.length > 0) errors.push("SELF_CANDIDATE_EXCLUDED_FOR_LEAKAGE_GUARD");
  const wrongFields = diffs.filter((diff) => diff.is_correct !== true).map((diff) => diff.field);
  if (wrongFields.length) errors.push("FIELD_MISMATCH");
  if (mode === "cold_start_smoke" && usableDraft(result)) errors.push("CATALOG_GAP_USABLE_DRAFT");
  return {
    primary: errors[0] || "SUCCESS",
    all: errors,
    wrong_fields: wrongFields
  };
}

function hardNegativeRecords(result = {}, modeCandidates = {}, selected = null) {
  const correctedRows = modeCandidates.filtered.filter((candidate) => candidate.label_is_correct === true);
  const topRanked = [...modeCandidates.filtered].sort((left, right) => Number(left.rank || 9999) - Number(right.rank || 9999));
  const top1 = topRanked[0] || null;
  const correctIdentityId = correctedRows[0]?.candidate_id || "";
  const queryCardId = cleanText(result.candidate_id || result.query_card_id || result.asset_id);
  const records = [];
  const push = (candidate, errorType) => {
    if (!candidate) return;
    records.push({
      query_card_id: queryCardId,
      correct_identity_id: correctIdentityId,
      wrong_candidate_id: candidate.candidate_id,
      error_type: errorType,
      similarity_features: {
        match_score: candidate.match_score,
        normalized_score: candidate.normalized_score,
        front_similarity: candidate.front_similarity,
        back_similarity: candidate.back_similarity,
        title_token_overlap: candidate.token_recall
      },
      matched_fields: candidate.supporting_fields || [],
      conflicting_fields: candidate.conflicting_fields || [],
      writer_resolution: "VERIFIED_CANONICAL_TITLE_PROXY",
      training_eligible: true
    });
  };
  if (top1 && top1.label_is_correct !== true && correctedRows.length) push(top1, "TOP1_WRONG_BUT_TOPK_CONTAINS_CORRECT");
  modeCandidates.filtered
    .filter((candidate) => candidate.channel === "vector" && candidate.conflicting_fields.length && Number(candidate.normalized_score || candidate.match_score || 0) >= 0.72)
    .forEach((candidate) => push(candidate, "VISUAL_HIGH_SIMILARITY_DIRECT_CONFLICT"));
  modeCandidates.filtered
    .filter((candidate) => candidate.channel === "catalog" && candidate.label_is_correct === true && selected?.candidate_id !== candidate.candidate_id)
    .forEach((candidate) => push(candidate, "CATALOG_CORRECT_NOT_SELECTED"));
  if (selected?.label_is_correct === true && Number(result.candidate_proxy_decision?.delta || 0) > 0.015) push(selected, "SAFE_ASSIST_RECOVERY");
  if (selected && selected.conflicting_fields.length && Number(selected.token_recall || 0) >= 0.72) push(selected, "SAFE_ASSIST_NEAR_REGRESSION");
  return records;
}

function candidateRecall(candidates = [], k = 10) {
  const sorted = [...candidates].sort((left, right) => Number(left.rank || 9999) - Number(right.rank || 9999)).slice(0, k);
  return sorted.some((candidate) => candidate.label_is_correct === true);
}

function fieldErrorByName(traces = []) {
  const stats = {};
  traces.forEach((trace) => {
    trace.field_diff.forEach((diff) => {
      stats[diff.field] ||= {
        evaluated_count: 0,
        error_count: 0,
        examples: []
      };
      stats[diff.field].evaluated_count += 1;
      if (diff.is_correct !== true) {
        stats[diff.field].error_count += 1;
        if (stats[diff.field].examples.length < 5) stats[diff.field].examples.push({
          query_card_id: trace.query_card_id,
          expected: diff.expected,
          actual: diff.actual
        });
      }
    });
  });
  Object.values(stats).forEach((stat) => {
    stat.error_rate = stat.evaluated_count ? Number((stat.error_count / stat.evaluated_count).toFixed(6)) : null;
  });
  return stats;
}

function parserConfidenceStats(traces = []) {
  const stats = {};
  traces.forEach((trace) => {
    Object.entries(trace.parsed_corrected_title_fields.fields || {}).forEach(([field, detail]) => {
      stats[field] ||= {
        high: 0,
        medium: 0,
        review_required: 0,
        total: 0
      };
      stats[field].total += 1;
      if (detail.parser_confidence === "HIGH") stats[field].high += 1;
      else if (detail.parser_confidence === "MEDIUM") stats[field].medium += 1;
      else stats[field].review_required += 1;
    });
  });
  return stats;
}

function scoreDashboard({ traces = [], hardNegatives = [], mode = "recapture_smoke" } = {}) {
  const total = traces.length;
  const passAt80 = traces.filter((trace) => titleComparison(trace.corrected_title, trace.rendered_title).token_recall >= 0.8).length;
  const usableDrafts = traces.filter((trace) => usableDraft({ final_title: trace.rendered_title })).length;
  const candidateSets = traces.map((trace) => [
    ...trace.catalog_candidates_top10,
    ...trace.vector_candidates_top10,
    ...trace.postgres_hybrid_candidates_top10
  ]);
  const recall = Object.fromEntries(topKValues.map((k) => {
    const hits = candidateSets.filter((candidates) => candidateRecall(candidates, k)).length;
    return [`candidate_recall_at_${k}`, {
      count: hits,
      denominator: total,
      rate: total ? Number((hits / total).toFixed(6)) : null
    }];
  }));
  const selected = traces.map((trace) => trace.selected_candidate).filter(Boolean);
  const selectedCorrect = selected.filter((candidate) => candidate.label_is_correct === true).length;
  const catalogRecovery = traces.filter((trace) => trace.selected_candidate?.channel === "catalog" && Number(trace.selected_candidate?.token_recall || 0) >= 0.8).length;
  const vectorRecovery = traces.filter((trace) => trace.selected_candidate?.channel === "vector" && Number(trace.selected_candidate?.token_recall || 0) >= 0.8).length;
  return {
    schema_version: "smoke-self-improving-loop-dashboard-v0",
    generated_at: new Date().toISOString(),
    smoke_mode: mode,
    accuracy_policy: {
      recapture_score_is_oracle_upper_bound: mode === "recapture_smoke",
      holdout_excludes_self_corrected_title: mode === "holdout_smoke",
      cold_start_excludes_correct_identity: mode === "cold_start_smoke",
      corrected_title_status: "VERIFIED_CANONICAL_TITLE",
      parsed_field_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
      parser_fields_auto_promoted_to_reviewed_internal: false
    },
    query_count: total,
    recapture_accuracy: mode === "recapture_smoke" ? {
      pass_at_0_80_count: passAt80,
      denominator: total,
      rate: total ? Number((passAt80 / total).toFixed(6)) : null
    } : null,
    holdout_accuracy: mode === "holdout_smoke" ? {
      pass_at_0_80_count: passAt80,
      denominator: total,
      rate: total ? Number((passAt80 / total).toFixed(6)) : null
    } : null,
    cold_start_usable_draft_rate: mode === "cold_start_smoke" ? {
      usable_draft_count: usableDrafts,
      denominator: total,
      rate: total ? Number((usableDrafts / total).toFixed(6)) : null
    } : null,
    ...recall,
    candidate_selection_accuracy: {
      selected_correct_count: selectedCorrect,
      selected_count: selected.length,
      rate: selected.length ? Number((selectedCorrect / selected.length).toFixed(6)) : null
    },
    hard_negative_count: hardNegatives.length,
    parser_field_confidence: parserConfidenceStats(traces),
    field_error_by_name: fieldErrorByName(traces),
    catalog_recovery_count: catalogRecovery,
    catalog_regression_count: hardNegatives.filter((record) => /CATALOG|TOP1/.test(record.error_type)).length,
    vector_recovery_count: vectorRecovery,
    vector_regression_count: hardNegatives.filter((record) => /VISUAL|VECTOR/.test(record.error_type)).length
  };
}

function opportunityReport({ dashboard = {}, traces = [], hardNegatives = [] } = {}) {
  const fieldErrors = Object.entries(dashboard.field_error_by_name || {})
    .sort((left, right) => right[1].error_count - left[1].error_count)
    .slice(0, 8)
    .map(([field, stats]) => `- ${field}: errors=${stats.error_count}/${stats.evaluated_count}, rate=${stats.error_rate ?? "n/a"}`);
  const hardNegativeTypes = {};
  hardNegatives.forEach((record) => {
    hardNegativeTypes[record.error_type] = (hardNegativeTypes[record.error_type] || 0) + 1;
  });
  const hardNegativeLines = Object.entries(hardNegativeTypes)
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `- ${type}: ${count}`);
  const parserReviewFields = Object.entries(dashboard.parser_field_confidence || {})
    .filter(([, stats]) => stats.review_required > 0)
    .sort((left, right) => right[1].review_required - left[1].review_required)
    .map(([field, stats]) => `- ${field}: review_required=${stats.review_required}/${stats.total}`);

  return [
    "# Smoke Self-Improving Loop v0 Opportunity Report",
    "",
    "## Guardrails",
    "",
    "- This report is generated from saved eval artifacts only.",
    "- VERIFIED_CANONICAL_TITLE is title-level truth, not field-level reviewed GT.",
    "- AUTO_PARSED_FROM_VERIFIED_TITLE fields are not promoted to REVIEWED_INTERNAL.",
    "- Recapture smoke is an oracle upper bound and must not be reported as blind commercial accuracy.",
    "",
    "## Smoke Scores",
    "",
    `- mode: ${dashboard.smoke_mode}`,
    `- query_count: ${dashboard.query_count}`,
    `- candidate_selection_accuracy: ${dashboard.candidate_selection_accuracy.selected_correct_count}/${dashboard.candidate_selection_accuracy.selected_count}`,
    `- hard_negative_count: ${dashboard.hard_negative_count}`,
    "",
    "## Field Risk Opportunities",
    "",
    ...(fieldErrors.length ? fieldErrors : ["- none"]),
    "",
    "## Parser Review Opportunities",
    "",
    ...(parserReviewFields.length ? parserReviewFields : ["- none"]),
    "",
    "## Hard Negative Opportunities",
    "",
    ...(hardNegativeLines.length ? hardNegativeLines : ["- none"]),
    "",
    "## Next Iteration",
    "",
    "Prioritize parser fixes and catalog normalization for the highest field-error groups, then rerun the same smoke mode and compare recovery/regression before any production rule change.",
    "",
    `decision_trace_count: ${traces.length}`
  ].join("\n") + "\n";
}

function jsonl(rows = []) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeText(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, value);
}

async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function exportSmokeSelfImprovingLoop({
  inputPaths = [],
  mode = "recapture_smoke",
  dashboardPath = "",
  tracePath = "",
  fieldDiffPath = "",
  hardNegativesPath = "",
  opportunityPath = ""
} = {}) {
  if (!smokeModes.has(mode)) throw new Error(`Unsupported smoke mode: ${mode}`);
  if (!inputPaths.length) throw new Error("At least one --input report path is required.");
  const reports = await Promise.all(inputPaths.map(readJson));
  const traces = [];
  const hardNegatives = [];
  reports.forEach((report) => {
    (Array.isArray(report.results) ? report.results : []).forEach((result) => {
      const trace = decisionTrace(result, mode);
      const candidates = candidatesForMode(result, mode);
      const selected = selectedCandidate(result, candidates.filtered);
      traces.push(trace);
      hardNegatives.push(...hardNegativeRecords(result, candidates, selected));
    });
  });
  const dashboard = scoreDashboard({ traces, hardNegatives, mode });
  const fieldDiffRows = traces.flatMap((trace) => trace.field_diff.map((diff) => ({
    smoke_mode: mode,
    query_card_id: trace.query_card_id,
    ...diff
  })));
  const opportunity = opportunityReport({ dashboard, traces, hardNegatives });

  if (dashboardPath) await writeJson(dashboardPath, dashboard);
  if (tracePath) await writeText(tracePath, jsonl(traces));
  if (fieldDiffPath) await writeText(fieldDiffPath, jsonl(fieldDiffRows));
  if (hardNegativesPath) await writeText(hardNegativesPath, jsonl(hardNegatives));
  if (opportunityPath) await writeText(opportunityPath, opportunity);

  return {
    dashboard,
    traces,
    field_diffs: fieldDiffRows,
    hard_negatives: hardNegatives,
    opportunity_report: opportunity
  };
}

export async function main(argv = process.argv) {
  const inputPaths = argValues(argv, "--input");
  const mode = argValue(argv, "--mode", "recapture_smoke");
  const dashboardPath = argValue(argv, "--dashboard-out", `data/eval/smoke-self-improving-loop/${mode}-dashboard.json`);
  const tracePath = argValue(argv, "--trace-out", `data/eval/smoke-self-improving-loop/${mode}-decision-traces.jsonl`);
  const fieldDiffPath = argValue(argv, "--field-diff-out", `data/eval/smoke-self-improving-loop/${mode}-field-diff.jsonl`);
  const hardNegativesPath = argValue(argv, "--hard-negatives-out", `data/eval/smoke-self-improving-loop/${mode}-hard-negatives.jsonl`);
  const opportunityPath = argValue(argv, "--opportunity-out", `data/eval/smoke-self-improving-loop/${mode}-opportunity-report.md`);
  const result = await exportSmokeSelfImprovingLoop({
    inputPaths,
    mode,
    dashboardPath,
    tracePath,
    fieldDiffPath,
    hardNegativesPath,
    opportunityPath
  });
  process.stdout.write([
    "smoke self-improving loop exported",
    `mode: ${mode}`,
    `query_count: ${result.dashboard.query_count}`,
    `candidate_selection_accuracy: ${result.dashboard.candidate_selection_accuracy.selected_correct_count}/${result.dashboard.candidate_selection_accuracy.selected_count}`,
    `hard_negative_count: ${result.dashboard.hard_negative_count}`,
    `dashboard_out: ${dashboardPath || "n/a"}`,
    `trace_out: ${tracePath || "n/a"}`,
    `field_diff_out: ${fieldDiffPath || "n/a"}`,
    `hard_negatives_out: ${hardNegativesPath || "n/a"}`,
    `opportunity_out: ${opportunityPath || "n/a"}`
  ].join("\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Smoke self-improving loop export failed: ${error.message}`);
    process.exit(1);
  }
}
