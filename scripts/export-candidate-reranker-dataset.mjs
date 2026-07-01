import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";

const defaultPositiveRecallThreshold = 0.9;

const rowColumns = Object.freeze([
  "query_card_id",
  "candidate_id",
  "label_is_correct",
  "candidate_source_type",
  "source_trust",
  "candidate_rank",
  "selected_by_current_system",
  "match_score",
  "normalized_score",
  "front_similarity",
  "back_similarity",
  "front_back_agreement",
  "year_match",
  "product_match",
  "set_match",
  "subject_match",
  "subject_count_match",
  "collector_number_match",
  "checklist_code_match",
  "serial_denominator_match",
  "surface_color_match",
  "observable_component_match",
  "direct_conflict_count",
  "conflicting_fields",
  "supporting_field_count",
  "candidate_margin",
  "title_token_overlap",
  "current_system_recovery",
  "current_system_regression",
  "oracle_candidate_upper_bound_bucket"
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

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) ? value : fallback;
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

function tokenRecall(referenceTitle = "", candidateTitle = "") {
  const reference = new Set(titleTokens(referenceTitle));
  const candidate = new Set(titleTokens(candidateTitle));
  if (!reference.size) return null;
  const overlap = [...reference].filter((token) => candidate.has(token)).length;
  return Number((overlap / reference.size).toFixed(6));
}

function exactTitleMatch(left = "", right = "") {
  return normalizeToken(left) === normalizeToken(right) && Boolean(normalizeToken(left));
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return value.map(normalizeComparable).filter(Boolean).sort().join("|");
  return normalizeToken(value).replace(/^0+(?=\d)/, "");
}

function boolMatch(left, right) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (!a || !b) return null;
  return a === b || a.includes(b) || b.includes(a);
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

function subjectMatch(gt = {}, candidate = {}) {
  const gtSubjects = subjectValues(gt).map(normalizeToken).filter(Boolean);
  const candidateSubjects = subjectValues(candidate).map(normalizeToken).filter(Boolean);
  if (!gtSubjects.length || !candidateSubjects.length) return null;
  return gtSubjects.every((subject) => candidateSubjects.some((candidateSubject) => {
    return candidateSubject === subject || candidateSubject.includes(subject) || subject.includes(candidateSubject);
  }));
}

function subjectCountMatch(gt = {}, candidate = {}) {
  const gtCount = subjectValues(gt).length;
  const candidateCount = subjectValues(candidate).length;
  if (!gtCount || !candidateCount) return null;
  return gtCount === candidateCount;
}

function serialDenominator(value = "") {
  return cleanText(value).match(/\/\s*0*(\d{1,4})\b/)?.[1] || "";
}

function fieldMatch(gt = {}, candidate = {}, field = "") {
  return boolMatch(gt[field], candidate[field]);
}

function observableComponents(fields = {}) {
  return [
    ...arrayValues(fields.observable_components),
    fields.auto ? "auto" : "",
    fields.patch ? "patch" : "",
    fields.relic ? "relic" : "",
    fields.jersey ? "jersey" : "",
    fields.rc ? "rc" : "",
    fields.first_bowman ? "1st bowman" : "",
    fields.ssp ? "ssp" : ""
  ].map(normalizeToken).filter(Boolean);
}

function observableComponentMatch(gt = {}, candidate = {}) {
  const gtComponents = observableComponents(gt);
  if (!gtComponents.length) return null;
  const candidateText = normalizeToken([
    candidate.title,
    candidate.official_card_type,
    candidate.card_type,
    candidate.card_name,
    ...observableComponents(candidate)
  ].filter(Boolean).join(" "));
  return gtComponents.every((component) => candidateText.includes(component));
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function candidateTrust(candidate = {}) {
  return cleanText(candidate.source_trust || candidate.trust || candidate.trust_tier || candidate.source_tier || "");
}

function candidateScore(candidate = {}) {
  return finiteNumber(candidate.match_score, finiteNumber(candidate.normalized_score, finiteNumber(candidate.raw_score, null)));
}

function candidateRawSimilarity(candidate = {}) {
  return finiteNumber(candidate.raw_score, finiteNumber(candidate.similarity, finiteNumber(candidate.front_similarity, finiteNumber(candidate.back_similarity, null))));
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => cleanText(typeof value === "string" ? value : value?.field || value?.field_name || value?.name)).filter(Boolean))];
}

function candidateConflicts(candidate = {}) {
  return uniqueStrings([
    ...(Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : []),
    ...(Array.isArray(candidate.direct_evidence_conflicts) ? candidate.direct_evidence_conflicts : []),
    ...(Array.isArray(candidate.conflicts) ? candidate.conflicts : [])
  ]);
}

function identityBlockingConflicts(conflicts = []) {
  const instanceOnlyFields = new Set([
    "serial_number",
    "serial",
    "serial_numerator",
    "grade",
    "grade_company",
    "card_grade",
    "auto_grade",
    "cert_number",
    "certificate_number"
  ]);
  return conflicts.filter((field) => !instanceOnlyFields.has(normalizeToken(field).replace(/\s+/g, "_")));
}

function selectedCandidateIds(result = {}) {
  return new Set([
    result.candidate_proxy_decision?.selected_candidate_id,
    result.catalog_selected_candidate_id,
    result.vector_selected_candidate_id,
    ...(Array.isArray(result.catalog_candidates) ? result.catalog_candidates.filter((candidate) => candidate.selected === true).map(candidateId) : []),
    ...(Array.isArray(result.vector_candidates) ? result.vector_candidates.filter((candidate) => candidate.selected === true).map(candidateId) : [])
  ].map(cleanText).filter(Boolean));
}

function allCandidates(result = {}) {
  const rows = [];
  const seen = new Set();
  const add = (candidate, source) => {
    const id = candidateId(candidate, rows.length);
    const key = `${source}:${id}:${normalizeToken(candidateTitle(candidate))}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      ...candidate,
      candidate_source_type: source || candidateSourceType(candidate)
    });
  };
  (Array.isArray(result.catalog_candidates) ? result.catalog_candidates : []).forEach((candidate) => add(candidate, "catalog"));
  (Array.isArray(result.vector_candidates) ? result.vector_candidates : []).forEach((candidate) => add(candidate, "vector"));
  const best = result.candidate_proxy_decision?.best_candidate;
  if (best?.candidate_id || best?.title) add({
    id: best.candidate_id,
    rank: best.rank,
    title: best.title,
    provider: best.source,
    normalized_score: best.token_recall,
    supporting_fields: Array.isArray(best.supporting_fields) ? best.supporting_fields : [],
    conflicting_fields: Array.isArray(best.conflicts) ? best.conflicts : []
  }, best.source || "candidate_proxy");
  return rows.sort((left, right) => {
    const leftRank = finiteNumber(left.rank, 9999);
    const rightRank = finiteNumber(right.rank, 9999);
    return leftRank - rightRank;
  });
}

function currentSystemDelta(result = {}) {
  const before = finiteNumber(result.raw_corrected_title_comparison?.token_recall, 0);
  const after = finiteNumber(result.corrected_title_comparison?.token_recall, before);
  return Number((after - before).toFixed(6));
}

function oracleBucketForRows(queryRows = []) {
  const sorted = [...queryRows].sort((left, right) => Number(left.candidate_rank || 9999) - Number(right.candidate_rank || 9999));
  const index = sorted.findIndex((row) => row.label_is_correct === true);
  if (index < 0) return "MISSING_CORRECT_CANDIDATE";
  if (index === 0) return "TOP_1";
  if (index < 3) return "TOP_3";
  if (index < 5) return "TOP_5";
  if (index < 10) return "TOP_10";
  return "BEYOND_TOP_10";
}

function positiveIdentityLabel({
  exact = false,
  overlap = null,
  fieldResults = [],
  conflicts = [],
  positiveRecallThreshold = defaultPositiveRecallThreshold
} = {}) {
  if (identityBlockingConflicts(conflicts).length > 0) return false;
  const knownResults = fieldResults.filter((value) => value !== null && value !== undefined);
  if (knownResults.some((value) => value === false)) return false;
  if (exact) return true;
  const supportingMatches = knownResults.filter((value) => value === true).length;
  return Number(overlap || 0) >= positiveRecallThreshold && supportingMatches >= 2;
}

function buildRow({ result = {}, candidate = {}, index = 0, candidates = [], positiveRecallThreshold = defaultPositiveRecallThreshold } = {}) {
  const referenceTitle = cleanText(result.corrected_title_reference || result.corrected_title || result.reference_title);
  const title = candidateTitle(candidate);
  const gtFields = parseReviewedTitleFields(referenceTitle);
  const candidateFields = parseReviewedTitleFields(title);
  const overlap = tokenRecall(referenceTitle, title);
  const conflicts = candidateConflicts(candidate);
  const yearMatch = fieldMatch(gtFields, candidateFields, "year");
  const productMatch = fieldMatch(gtFields, candidateFields, "product");
  const setMatch = fieldMatch(gtFields, candidateFields, "set");
  const subjectFieldMatch = subjectMatch(gtFields, candidateFields);
  const subjectCountFieldMatch = subjectCountMatch(gtFields, candidateFields);
  const collectorNumberMatch = fieldMatch(gtFields, candidateFields, "collector_number");
  const checklistCodeMatch = fieldMatch(gtFields, candidateFields, "checklist_code");
  const serialDenominatorMatch = (() => {
    const gtDenom = gtFields.serial_denominator || serialDenominator(gtFields.serial_number);
    const candidateDenom = candidateFields.serial_denominator || serialDenominator(candidateFields.serial_number);
    if (!gtDenom || !candidateDenom) return null;
    return gtDenom === candidateDenom;
  })();
  const surfaceColorMatch = fieldMatch(gtFields, candidateFields, "surface_color");
  const observableMatch = observableComponentMatch(gtFields, candidateFields);
  const label = positiveIdentityLabel({
    exact: exactTitleMatch(referenceTitle, title),
    overlap,
    conflicts,
    positiveRecallThreshold,
    fieldResults: [
      yearMatch,
      productMatch,
      setMatch,
      subjectFieldMatch,
      subjectCountFieldMatch,
      collectorNumberMatch,
      checklistCodeMatch,
      serialDenominatorMatch,
      surfaceColorMatch,
      observableMatch
    ]
  });
  const id = candidateId(candidate, index);
  const selectedIds = selectedCandidateIds(result);
  const selected = selectedIds.has(id) || result.candidate_proxy_decision?.selected_candidate_id === id;
  const score = candidateScore(candidate);
  const sortedScores = candidates.map(candidateScore).filter((value) => Number.isFinite(value)).sort((a, b) => b - a);
  const nextLowerScore = sortedScores.find((value) => value < score);
  const margin = Number.isFinite(score) && sortedScores.length > 1
    ? Number.isFinite(nextLowerScore)
      ? Number((score - nextLowerScore).toFixed(6))
      : null
    : null;
  const delta = currentSystemDelta(result);
  return {
    query_card_id: cleanText(result.candidate_id || result.query_card_id || result.asset_id),
    candidate_id: id,
    label_is_correct: label,
    candidate_source_type: candidateSourceType(candidate),
    source_trust: candidateTrust(candidate),
    candidate_rank: finiteNumber(candidate.rank, index + 1),
    selected_by_current_system: selected,
    match_score: score,
    normalized_score: finiteNumber(candidate.normalized_score, score),
    front_similarity: finiteNumber(candidate.front_similarity, null),
    back_similarity: finiteNumber(candidate.back_similarity, null),
    front_back_agreement: Boolean(candidate.front_back_identity_agreement || (finiteNumber(candidate.front_similarity, null) !== null && finiteNumber(candidate.back_similarity, null) !== null)),
    year_match: yearMatch,
    product_match: productMatch,
    set_match: setMatch,
    subject_match: subjectFieldMatch,
    subject_count_match: subjectCountFieldMatch,
    collector_number_match: collectorNumberMatch,
    checklist_code_match: checklistCodeMatch,
    serial_denominator_match: serialDenominatorMatch,
    surface_color_match: surfaceColorMatch,
    observable_component_match: observableMatch,
    direct_conflict_count: conflicts.length,
    conflicting_fields: conflicts,
    supporting_field_count: Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields.length : 0,
    candidate_margin: margin,
    title_token_overlap: overlap,
    current_system_recovery: selected && delta > 0.015,
    current_system_regression: selected && delta < -0.015,
    oracle_candidate_upper_bound_bucket: ""
  };
}

function attachOracleBuckets(rows = []) {
  const byQuery = groupBy(rows, (row) => row.query_card_id);
  byQuery.forEach((queryRows) => {
    const bucket = oracleBucketForRows(queryRows);
    queryRows.forEach((row) => {
      row.oracle_candidate_upper_bound_bucket = bucket;
    });
  });
}

function candidateRecall(rows = [], k = 10, queryIds = []) {
  const byQuery = groupBy(rows, (row) => row.query_card_id);
  queryIds.forEach((queryId) => {
    if (!byQuery.has(queryId)) byQuery.set(queryId, []);
  });
  let hit = 0;
  let total = 0;
  byQuery.forEach((queryRows) => {
    total += 1;
    const topK = [...queryRows].sort((left, right) => Number(left.candidate_rank || 9999) - Number(right.candidate_rank || 9999)).slice(0, k);
    if (topK.some((row) => row.label_is_correct === true)) hit += 1;
  });
  return {
    count: hit,
    denominator: total,
    rate: total ? Number((hit / total).toFixed(6)) : null
  };
}

function groupBy(rows = [], keyFn) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

function metrics(rows = [], reports = [], queryIds = []) {
  const byQuery = groupBy(rows, (row) => row.query_card_id);
  queryIds.forEach((queryId) => {
    if (!byQuery.has(queryId)) byQuery.set(queryId, []);
  });
  const selectedRows = rows.filter((row) => row.selected_by_current_system === true);
  const selectedCorrect = selectedRows.filter((row) => row.label_is_correct === true).length;
  const positives = rows.filter((row) => row.label_is_correct === true).length;
  let hardNegatives = 0;
  let missingCorrect = 0;
  const sourceBreakdown = {};
  byQuery.forEach((queryRows) => {
    if (!queryRows.some((row) => row.label_is_correct === true)) missingCorrect += 1;
    hardNegatives += queryRows.filter((row) => {
      return row.label_is_correct !== true
        && (row.selected_by_current_system === true || Number(row.title_token_overlap || 0) >= 0.72 || row.direct_conflict_count > 0);
    }).length;
  });
  rows.forEach((row) => {
    const source = row.candidate_source_type || "unknown";
    sourceBreakdown[source] ||= {
      candidate_count: 0,
      positive_candidate_count: 0,
      selected_count: 0,
      selected_correct_count: 0,
      hard_negative_count: 0
    };
    sourceBreakdown[source].candidate_count += 1;
    if (row.label_is_correct === true) sourceBreakdown[source].positive_candidate_count += 1;
    if (row.selected_by_current_system === true) sourceBreakdown[source].selected_count += 1;
    if (row.selected_by_current_system === true && row.label_is_correct === true) sourceBreakdown[source].selected_correct_count += 1;
    if (row.label_is_correct !== true && (row.selected_by_current_system === true || Number(row.title_token_overlap || 0) >= 0.72 || row.direct_conflict_count > 0)) {
      sourceBreakdown[source].hard_negative_count += 1;
    }
  });
  return {
    schema_version: "candidate-reranker-dataset-metrics-v1",
    generated_at: new Date().toISOString(),
    input_report_count: reports.length,
    query_count: byQuery.size,
    row_count: rows.length,
    candidate_recall_at_1: candidateRecall(rows, 1, queryIds),
    candidate_recall_at_3: candidateRecall(rows, 3, queryIds),
    candidate_recall_at_5: candidateRecall(rows, 5, queryIds),
    candidate_recall_at_10: candidateRecall(rows, 10, queryIds),
    oracle_upper_bound: {
      count: byQuery.size - missingCorrect,
      denominator: byQuery.size,
      rate: byQuery.size ? Number(((byQuery.size - missingCorrect) / byQuery.size).toFixed(6)) : null
    },
    current_selected_accuracy: {
      selected_correct_count: selectedCorrect,
      selected_count: selectedRows.length,
      rate: selectedRows.length ? Number((selectedCorrect / selectedRows.length).toFixed(6)) : null
    },
    positive_candidate_count: positives,
    reranker_training_positive_count: positives,
    hard_negative_count: hardNegatives,
    missing_correct_candidate_count: missingCorrect,
    candidate_source_breakdown: sourceBreakdown,
    label_policy: {
      basis: "reviewed corrected_title title-level proxy",
      positive_rule: `exact title match or token recall >= ${defaultPositiveRecallThreshold}, with no identity-field mismatch and no identity-blocking conflict`,
      field_ground_truth: false
    }
  };
}

function similarityFeatures(row = {}) {
  return {
    match_score: row.match_score,
    normalized_score: row.normalized_score,
    front_similarity: row.front_similarity,
    back_similarity: row.back_similarity,
    front_back_agreement: row.front_back_agreement,
    title_token_overlap: row.title_token_overlap,
    candidate_margin: row.candidate_margin
  };
}

function candidateSupportingFields(candidate = {}) {
  return uniqueStrings([
    ...(Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : []),
    ...(Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [])
  ]);
}

function hardNegativeRecord({
  queryCardId = "",
  correctIdentityId = "",
  wrongCandidateId = "",
  errorType = "",
  row = {},
  candidate = {},
  writerResolution = "CORRECTED_TITLE_PROXY",
  trainingEligible = true
} = {}) {
  return {
    query_card_id: queryCardId,
    correct_identity_id: correctIdentityId,
    wrong_candidate_id: wrongCandidateId,
    error_type: errorType,
    similarity_features: similarityFeatures(row),
    matched_fields: candidateSupportingFields(candidate),
    conflicting_fields: row.conflicting_fields || [],
    writer_resolution: writerResolution,
    training_eligible: trainingEligible
  };
}

function hardNegativeRecordsForQuery({ result = {}, rows = [], candidates = [] } = {}) {
  const records = [];
  const queryCardId = rows[0]?.query_card_id || cleanText(result.candidate_id || result.query_card_id || result.asset_id);
  const candidateById = new Map(candidates.map((candidate, index) => [candidateId(candidate, index), candidate]));
  const sorted = [...rows].sort((left, right) => Number(left.candidate_rank || 9999) - Number(right.candidate_rank || 9999));
  const correctRows = sorted.filter((row) => row.label_is_correct === true);
  const correctIdentityId = correctRows[0]?.candidate_id || "";
  const top1 = sorted[0];

  if (top1 && top1.label_is_correct !== true && correctIdentityId) {
    records.push(hardNegativeRecord({
      queryCardId,
      correctIdentityId,
      wrongCandidateId: top1.candidate_id,
      errorType: "TOP1_WRONG_CORRECT_IN_TOPK",
      row: top1,
      candidate: candidateById.get(top1.candidate_id)
    }));
  }

  rows.forEach((row) => {
    const candidate = candidateById.get(row.candidate_id) || {};
    const rawSimilarity = candidateRawSimilarity(candidate);
    if (/vector/i.test(row.candidate_source_type || "") && row.direct_conflict_count > 0 && Number(rawSimilarity || row.normalized_score || 0) >= 0.72) {
      records.push(hardNegativeRecord({
        queryCardId,
        correctIdentityId,
        wrongCandidateId: row.candidate_id,
        errorType: "VECTOR_HIGH_SIMILARITY_DIRECT_CONFLICT",
        row,
        candidate
      }));
    }
    if (/catalog/i.test(row.candidate_source_type || "") && row.label_is_correct === true && row.selected_by_current_system !== true) {
      records.push(hardNegativeRecord({
        queryCardId,
        correctIdentityId: row.candidate_id,
        wrongCandidateId: cleanText(result.candidate_proxy_decision?.selected_candidate_id || ""),
        errorType: "CATALOG_CORRECT_NOT_SELECTED",
        row,
        candidate,
        trainingEligible: Boolean(result.candidate_proxy_decision?.selected_candidate_id)
      }));
    }
    if (row.selected_by_current_system === true && row.current_system_recovery === true) {
      records.push(hardNegativeRecord({
        queryCardId,
        correctIdentityId: row.label_is_correct ? row.candidate_id : correctIdentityId,
        wrongCandidateId: row.label_is_correct ? "" : row.candidate_id,
        errorType: "SAFE_ASSIST_IMPROVED_TITLE",
        row,
        candidate,
        trainingEligible: false
      }));
    }
    if (row.selected_by_current_system === true && row.direct_conflict_count > 0 && Number(row.title_token_overlap || 0) >= 0.72) {
      records.push(hardNegativeRecord({
        queryCardId,
        correctIdentityId,
        wrongCandidateId: row.candidate_id,
        errorType: "SAFE_ASSIST_NEARLY_CONFLICTED",
        row,
        candidate
      }));
    }
  });

  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.query_card_id}:${record.error_type}:${record.correct_identity_id}:${record.wrong_candidate_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shadowScore(row = {}) {
  const sourceTrust = /approved/i.test(row.source_trust || "")
    ? 0.25
    : /catalog/i.test(row.candidate_source_type || "")
      ? 0.15
      : /vector/i.test(row.candidate_source_type || "")
        ? 0.05
        : 0;
  const fieldScore = [
    row.year_match,
    row.product_match,
    row.set_match,
    row.subject_match,
    row.subject_count_match,
    row.collector_number_match,
    row.checklist_code_match,
    row.serial_denominator_match,
    row.surface_color_match,
    row.observable_component_match
  ].reduce((sum, value) => sum + (value === true ? 0.08 : value === false ? -0.12 : 0), 0);
  const baseScore = Math.max(0, Math.min(1, Number(row.normalized_score ?? row.match_score ?? 0)));
  const conflictPenalty = Number(row.direct_conflict_count || 0) * 0.18;
  const score = baseScore * 0.45 + sourceTrust + fieldScore - conflictPenalty;
  return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}

function shadowDecisionForQuery({ result = {}, rows = [], candidates = [] } = {}) {
  const queryCardId = rows[0]?.query_card_id || cleanText(result.candidate_id || result.query_card_id || result.asset_id);
  const currentSelectedIds = selectedCandidateIds(result);
  const candidateById = new Map(candidates.map((candidate, index) => [candidateId(candidate, index), candidate]));
  const scored = rows.map((row) => ({ row, score: shadowScore(row) })).sort((left, right) => right.score - left.score);
  const top = scored[0] || null;
  const runnerUp = scored[1] || null;
  const selectedCandidate = top ? candidateById.get(top.row.candidate_id) || {} : {};
  const selectedFields = selectedCandidate ? parseReviewedTitleFields(candidateTitle(selectedCandidate)) : {};
  const margin = top && runnerUp ? Number((top.score - runnerUp.score).toFixed(6)) : top ? top.score : null;
  const noneScore = top
    ? Number(Math.max(0, Math.min(1, 0.65 - top.score + (margin !== null && margin < 0.08 ? 0.18 : 0) + Number(top.row.direct_conflict_count || 0) * 0.12)).toFixed(6))
    : 1;
  const wouldChange = top ? !currentSelectedIds.has(top.row.candidate_id) : false;
  const expectedRisk = !top || noneScore >= 0.55 || Number(top.row.direct_conflict_count || 0) > 0
    ? "HIGH"
    : margin !== null && margin < 0.12
      ? "MEDIUM"
      : "LOW";
  const trace = [];
  if (top) {
    trace.push(`selected ${top.row.candidate_id} with score ${top.score}`);
    trace.push(`source=${top.row.candidate_source_type || "unknown"} rank=${top.row.candidate_rank}`);
    if (Number(top.row.direct_conflict_count || 0) > 0) trace.push(`conflicts=${(top.row.conflicting_fields || []).join("|")}`);
    if (margin !== null) trace.push(`margin=${margin}`);
  } else {
    trace.push("no candidates available");
  }
  return {
    query_card_id: queryCardId,
    shadow_candidate_score: top?.score ?? null,
    shadow_selected_candidate_id: top?.row.candidate_id || "",
    shadow_field_assignment: selectedFields,
    shadow_none_of_the_above_score: noneScore,
    shadow_would_change_title: wouldChange,
    shadow_expected_risk: expectedRisk,
    shadow_reason_trace: trace
  };
}

function shadowDecisionsForReports(reportCandidateRows = []) {
  return reportCandidateRows.map(({ result, rows, candidates }) => shadowDecisionForQuery({ result, rows, candidates }));
}

function hardNegativeBreakdown(records = []) {
  const breakdown = {};
  records.forEach((record) => {
    breakdown[record.error_type] = (breakdown[record.error_type] || 0) + 1;
  });
  return breakdown;
}

function sourceBreakdownLines(sourceBreakdown = {}) {
  return Object.entries(sourceBreakdown)
    .sort((left, right) => right[1].candidate_count - left[1].candidate_count)
    .map(([source, stats]) => `- ${source}: candidates=${stats.candidate_count}, positives=${stats.positive_candidate_count}, hard_negatives=${stats.hard_negative_count}, selected=${stats.selected_correct_count}/${stats.selected_count}`);
}

function buildMarkdownReport({ summary = {}, hardNegatives = [], shadowDecisions = [] } = {}) {
  const currentSelected = summary.current_selected_accuracy || {};
  const oracle = summary.oracle_upper_bound || {};
  const oracleGap = Math.max(0, Number(oracle.count || 0) - Number(currentSelected.selected_correct_count || 0));
  const hardNegativeByType = hardNegativeBreakdown(hardNegatives);
  const riskyShadowCount = shadowDecisions.filter((decision) => decision.shadow_expected_risk === "HIGH").length;
  const wouldChangeCount = shadowDecisions.filter((decision) => decision.shadow_would_change_title).length;
  const hardNegativeLines = Object.entries(hardNegativeByType)
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `- ${type}: ${count}`);
  return [
    "# Decision Learning Foundation v1 Report",
    "",
    "## Scope",
    "",
    "This report is generated from saved eval artifacts only. It does not change the production prompt, provider, renderer, resolver, or gate.",
    "",
    "## Current System Failure Shape",
    "",
    `- Queries: ${summary.query_count ?? 0}`,
    `- Candidate rows: ${summary.row_count ?? 0}`,
    `- Candidate Recall@1/3/5/10: ${summary.candidate_recall_at_1?.rate ?? "n/a"} / ${summary.candidate_recall_at_3?.rate ?? "n/a"} / ${summary.candidate_recall_at_5?.rate ?? "n/a"} / ${summary.candidate_recall_at_10?.rate ?? "n/a"}`,
    `- Current selected accuracy: ${currentSelected.selected_correct_count ?? 0}/${currentSelected.selected_count ?? 0}`,
    `- Oracle upper bound: ${oracle.count ?? 0}/${oracle.denominator ?? 0}`,
    `- Missing correct candidate count: ${summary.missing_correct_candidate_count ?? 0}`,
    "",
    "The main error surface is the oracle gap: correct candidates that exist in the candidate set but are not selected, plus queries where the correct candidate is missing entirely.",
    "",
    "## Candidate Error Sources",
    "",
    ...sourceBreakdownLines(summary.candidate_source_breakdown || {}),
    "",
    "## Hard Negative Breakdown",
    "",
    ...(hardNegativeLines.length ? hardNegativeLines : ["- none"]),
    "",
    "## Fields Worth Training First",
    "",
    "- subject and subject_count: wrong near-neighbor candidates usually share product/year but differ by subject or multi-subject composition.",
    "- serial_denominator and surface_color: strong identity anchors that should separate visually similar parallels without copying serial numerator.",
    "- product/set: catalog candidates must become hard constraints when they match direct evidence, not just prompt suggestions.",
    "",
    "## Reranker Expected Impact",
    "",
    `- Estimated oracle gap that a learned reranker can target now: ${oracleGap} query decisions.`,
    `- Shadow decisions that would change the current selected candidate: ${wouldChangeCount}.`,
    `- Shadow high-risk decisions requiring calibration before production: ${riskyShadowCount}.`,
    "",
    "## Next Validation Rule",
    "",
    "Train nothing until this export shows stable positives, hard negatives, and a non-zero oracle gap on a held-out eval set. A learned reranker should only graduate if recovery exceeds regression in shadow mode."
  ].join("\n") + "\n";
}

function csvCell(value) {
  if (Array.isArray(value)) return `"${value.join("|").replace(/"/g, '""')}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows = []) {
  return [
    rowColumns.join(","),
    ...rows.map((row) => rowColumns.map((column) => csvCell(row[column])).join(","))
  ].join("\n") + "\n";
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

export async function exportCandidateRerankerDataset({
  inputPaths = [],
  rowsPath = "",
  csvPath = "",
  metricsPath = "",
  hardNegativesPath = "",
  shadowPath = "",
  reportPath = "",
  positiveRecallThreshold = defaultPositiveRecallThreshold
} = {}) {
  if (!inputPaths.length) throw new Error("At least one --input report path is required.");
  const reports = await Promise.all(inputPaths.map(readJson));
  const rows = [];
  const reportCandidateRows = [];
  const hardNegatives = [];
  const queryIds = [];
  reports.forEach((report) => {
    (Array.isArray(report.results) ? report.results : []).forEach((result) => {
      const queryId = cleanText(result.candidate_id || result.query_card_id || result.asset_id);
      if (queryId) queryIds.push(queryId);
      const candidates = allCandidates(result);
      const queryRows = [];
      candidates.forEach((candidate, index) => {
        const row = buildRow({ result, candidate, index, candidates, positiveRecallThreshold });
        rows.push(row);
        queryRows.push(row);
      });
      attachOracleBuckets(queryRows);
      reportCandidateRows.push({ result, rows: queryRows, candidates });
      hardNegatives.push(...hardNegativeRecordsForQuery({ result, rows: queryRows, candidates }));
    });
  });
  attachOracleBuckets(rows);
  const summary = metrics(rows, reports, queryIds);
  const shadowDecisions = shadowDecisionsForReports(reportCandidateRows);
  const markdownReport = buildMarkdownReport({ summary, hardNegatives, shadowDecisions });
  if (rowsPath) await writeText(rowsPath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  if (csvPath) await writeText(csvPath, rowsToCsv(rows));
  if (metricsPath) await writeJson(metricsPath, summary);
  if (hardNegativesPath) await writeText(hardNegativesPath, hardNegatives.map((row) => JSON.stringify(row)).join("\n") + (hardNegatives.length ? "\n" : ""));
  if (shadowPath) await writeJson(shadowPath, {
    schema_version: "shadow-decision-graph-v1",
    generated_at: new Date().toISOString(),
    decisions: shadowDecisions
  });
  if (reportPath) await writeText(reportPath, markdownReport);
  return {
    rows,
    metrics: summary,
    hard_negatives: hardNegatives,
    shadow_decisions: shadowDecisions,
    markdown_report: markdownReport
  };
}

export async function main(argv = process.argv) {
  const inputPaths = argValues(argv, "--input");
  const rowsPath = argValue(argv, "--rows-out", "data/eval/decision-learning/candidate-reranker-rows.jsonl");
  const csvPath = argValue(argv, "--csv-out", "");
  const metricsPath = argValue(argv, "--metrics-out", "data/eval/decision-learning/candidate-reranker-metrics.json");
  const hardNegativesPath = argValue(argv, "--hard-negatives-out", "data/eval/decision-learning/hard-negatives.jsonl");
  const shadowPath = argValue(argv, "--shadow-out", "data/eval/decision-learning/shadow-decisions.json");
  const reportPath = argValue(argv, "--report-out", "data/eval/decision-learning/decision-learning-foundation-report.md");
  const positiveRecallThreshold = numberArg(argv, "--positive-recall-threshold", defaultPositiveRecallThreshold);
  const result = await exportCandidateRerankerDataset({
    inputPaths,
    rowsPath,
    csvPath,
    metricsPath,
    hardNegativesPath,
    shadowPath,
    reportPath,
    positiveRecallThreshold
  });
  process.stdout.write([
    "candidate reranker dataset exported",
    `input_report_count: ${inputPaths.length}`,
    `row_count: ${result.metrics.row_count}`,
    `query_count: ${result.metrics.query_count}`,
    `candidate_recall@1: ${result.metrics.candidate_recall_at_1.count}/${result.metrics.candidate_recall_at_1.denominator}`,
    `candidate_recall@3: ${result.metrics.candidate_recall_at_3.count}/${result.metrics.candidate_recall_at_3.denominator}`,
    `candidate_recall@5: ${result.metrics.candidate_recall_at_5.count}/${result.metrics.candidate_recall_at_5.denominator}`,
    `candidate_recall@10: ${result.metrics.candidate_recall_at_10.count}/${result.metrics.candidate_recall_at_10.denominator}`,
    `oracle_upper_bound: ${result.metrics.oracle_upper_bound.count}/${result.metrics.oracle_upper_bound.denominator}`,
    `current_selected_accuracy: ${result.metrics.current_selected_accuracy.selected_correct_count}/${result.metrics.current_selected_accuracy.selected_count}`,
    `positive_candidate_count: ${result.metrics.positive_candidate_count}`,
    `hard_negative_count: ${result.metrics.hard_negative_count}`,
    `missing_correct_candidate_count: ${result.metrics.missing_correct_candidate_count}`,
    `hard_negative_store_count: ${result.hard_negatives.length}`,
    `shadow_decision_count: ${result.shadow_decisions.length}`,
    `rows_out: ${rowsPath || "n/a"}`,
    `csv_out: ${csvPath || "n/a"}`,
    `metrics_out: ${metricsPath || "n/a"}`,
    `hard_negatives_out: ${hardNegativesPath || "n/a"}`,
    `shadow_out: ${shadowPath || "n/a"}`,
    `report_out: ${reportPath || "n/a"}`
  ].join("\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Candidate reranker dataset export failed: ${error.message}`);
    process.exit(1);
  }
}
