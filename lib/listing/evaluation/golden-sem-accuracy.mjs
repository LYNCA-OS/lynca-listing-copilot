import crypto from "node:crypto";
import {
  goldenSemCriticalFields,
  goldenSemLaunchFields,
  goldenSemPartitionSchemaVersion
} from "./golden-sem-release.mjs";
import {
  canonicalReleaseItemId,
  releaseSetItemDigestSchemaVersion,
  validateReleaseSetManifest
} from "./release-set-contract.mjs";
import {
  numericalRarityComponents,
  semFieldEquivalent,
  scoreRequiredSemProjection
} from "../v4/policy/sem-scoring-policy.mjs";
import { titleCriticalIdentityFields } from "./title-critical-guard.mjs";
import { semProjectionFromTitle } from "./reviewed-title-sem-projection.mjs";
import { renderListingPresentation } from "../renderer/listing-renderer.mjs";

export const goldenSemAccuracySchemaVersion = "golden-sem-accuracy-report-v1";
export const goldenSemPredictionRunSchemaVersion = "golden-sem-prediction-run-v1";
export const predictionContentDigestSchemaVersion = "canonical-json-sha256-v1";

const excludedStatuses = new Set(["UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED", ""]);
const criticalOverclaimStatuses = new Set(["UNKNOWN", "NOT_APPLICABLE"]);
const criticalFields = new Set([...goldenSemCriticalFields, ...titleCriticalIdentityFields]);
const setFields = new Set(["subject", "special_stamp", "search_optimization"]);

function cleanText(value) {
  return String(value ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function exactText(value) {
  return typeof value === "string" ? cleanText(value) : "";
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
    value[key] === undefined ? [] : [[key, canonicalValue(value[key])]]
  )));
}

function contentSha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function normalizeScalar(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\bautograph\b/g, "auto")
    .replace(/\bprofessional sports authenticator\b/g, "psa")
    .replace(/\bbeckett\b/g, "bgs")
    .replace(/[^a-z0-9/#+&.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGrade(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const company = normalizeScalar(value.company || value.grade_company);
    const cardGrade = normalizeScalar(value.card_grade || value.grade);
    const autoGrade = normalizeScalar(value.auto_grade);
    const gradeType = normalizeScalar(value.grade_type);
    return [
      company,
      cardGrade ? `card:${cardGrade}` : "",
      autoGrade ? `auto:${autoGrade}` : "",
      gradeType && gradeType !== "unknown" ? `type:${gradeType}` : ""
    ].filter(Boolean).join("|");
  }
  return normalizeScalar(value);
}

export function normalizeGoldenSemValue(field, value) {
  if (field === "grading_info") return normalizeGrade(value);
  if (field === "numerical_rarity") {
    const rarity = numericalRarityComponents(value);
    if (rarity.denominator) {
      return rarity.numerator
        ? `${rarity.numerator}/${rarity.denominator}`
        : `#/${rarity.denominator}`;
    }
  }
  if (setFields.has(field)) {
    return [...new Set(asArray(value).map(normalizeScalar).filter(Boolean))].sort().join("|");
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${key}:${normalizeGoldenSemValue(key, child)}`).join("|");
  }
  return normalizeScalar(value);
}

function resultId(result = {}) {
  return canonicalReleaseItemId(
    result.item_id
    || result.query_card_id
    || result.card_id
    || result.asset_id
    || result.source_feedback_id
    || result.candidate_id
  );
}

function predictionRows(report = {}) {
  for (const key of ["results", "items", "records", "cards"]) {
    if (Array.isArray(report?.[key])) return report[key];
  }
  return [];
}

function resolvedFields(result = {}) {
  return plainObject(
    result.resolved_fields
    || result.summary?.resolved_fields
    || result.prediction?.resolved_fields
    || result.prediction?.fields
    || result.resolved
    || result.fields
    || result.field_graph?.resolved_fields
  );
}

function gradingInfoFromFields(fields = {}) {
  if (fields.grading_info) return fields.grading_info;
  const grade = {
    company: fields.grade_company,
    card_grade: fields.card_grade || fields.grade,
    auto_grade: fields.auto_grade,
    grade_type: fields.grade_type
  };
  return Object.values(grade).some((value) => cleanText(value)) ? grade : "";
}

export function canonicalSemPrediction(result = {}) {
  const fields = resolvedFields(result);
  return {
    year: fields.year || fields.season_year || fields.product_year || "",
    ip_sport: fields.ip_sport || fields.ip || fields.sport || fields.category || "",
    language: fields.language || "",
    manufacturer: fields.manufacturer || fields.brand || "",
    product: fields.product || "",
    set: fields.set || fields.subset || "",
    subject: fields.subject || fields.subjects || fields.players || fields.player || fields.character || [],
    card_name: fields.card_name || fields.official_card_type || fields.card_type || fields.insert || "",
    card_number: fields.card_number || fields.tcg_card_number || fields.checklist_code || fields.collector_number || "",
    descriptive_rarity: fields.descriptive_rarity || fields.rarity || "",
    numerical_rarity: fields.numerical_rarity || fields.print_run_number || fields.serial_number || "",
    release_variant: fields.release_variant || fields.variant || fields.variation || "",
    print_finish: fields.print_finish || fields.product_finish || fields.parallel_exact || fields.parallel || fields.surface_color || "",
    special_stamp: fields.special_stamp || [],
    grading_info: gradingInfoFromFields(fields)
  };
}

function predictionMap(report = {}) {
  const map = new Map();
  for (const result of predictionRows(report)) {
    const id = resultId(result);
    if (id && !map.has(id)) map.set(id, result);
  }
  return map;
}

function sortedIds(values = []) {
  return [...values].filter(Boolean).sort();
}

function groundTruthStatus(item = {}, field) {
  const explicit = cleanText(item.reviewed_ground_truth?.field_statuses?.[field]).toUpperCase();
  if (explicit) return explicit;
  const value = item.reviewed_ground_truth?.fields?.[field];
  const marker = cleanText(value).toUpperCase();
  return excludedStatuses.has(marker) ? marker : "CONFIRMED";
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function datasetItems(dataset = {}) {
  return Array.isArray(dataset?.items) ? dataset.items : [];
}

function itemSemGrammar(item = {}) {
  const grammar = cleanText(
    item.reviewed_ground_truth?.grammar
    || item.sem_grammar
    || item.grammar
    || "STANDARD"
  ).toUpperCase();
  return grammar === "TCG" ? "TCG" : "STANDARD";
}

function releaseValidation(dataset = {}) {
  if (dataset.schema_version === "release-set-v1") {
    return {
      ...validateReleaseSetManifest(dataset),
      launch_gate_authority: dataset.set_type === "CORE_HOLDOUT"
    };
  }
  if (dataset.schema_version === goldenSemPartitionSchemaVersion) {
    const formalHoldout = dataset.partition === "holdout"
      && dataset.evaluation_truth_policy?.formal_golden_sem === true;
    return {
      ok: !formalHoldout,
      launch_gate_authority: false,
      errors: formalHoldout
        ? ["formal holdout launch authority requires release-set-v1 CORE_HOLDOUT"]
        : [],
      warnings: ["golden-sem-partition-v1 is diagnostic-only and has no launch authority"]
    };
  }
  return {
    ok: false,
    launch_gate_authority: false,
    errors: ["unsupported Golden SEM dataset schema"],
    warnings: []
  };
}

function evaluationTruthPolicy(dataset = {}) {
  const explicit = plainObject(dataset.evaluation_truth_policy);
  const fieldGroundTruthClass = cleanText(explicit.field_ground_truth_class).toUpperCase();
  const explicitlyDeclared = Boolean(fieldGroundTruthClass);
  const formalGoldenSem = explicitlyDeclared
    && fieldGroundTruthClass === "HUMAN_REVIEWED_FIELD_GROUND_TRUTH"
    && explicit.formal_golden_sem === true
    && explicit.writer_title_used_as_field_ground_truth === false;
  const diagnosticProxy = explicitlyDeclared
    && fieldGroundTruthClass === "REVIEWED_TITLE_DERIVED_SEM_PROXY"
    && explicit.launch_gate_eligible === false;
  return {
    field_ground_truth_class: fieldGroundTruthClass || "UNDECLARED",
    explicitly_declared: explicitlyDeclared,
    recognized: formalGoldenSem || diagnosticProxy,
    formal_golden_sem: formalGoldenSem,
    launch_gate_eligible: formalGoldenSem && explicit.launch_gate_eligible === true,
    writer_title_used_as_field_ground_truth: fieldGroundTruthClass === "REVIEWED_TITLE_DERIVED_SEM_PROXY",
    limitations: Array.isArray(explicit.limitations) ? explicit.limitations.map(cleanText).filter(Boolean) : []
  };
}

function predictionRowVersion(row = {}) {
  const replayVersions = plainObject(row.evaluation_decision_trace_packet?.replay_snapshot?.versions);
  const versions = plainObject(row.versions);
  return {
    deployment_git_commit_sha: exactText(
      row.deployment_git_commit_sha
      || row.deployment?.git_commit_sha
      || replayVersions.deployment_git_commit_sha
      || versions.deployment_git_commit_sha
    ).toLowerCase(),
    recognition_pipeline_fingerprint: exactText(
      row.recognition_pipeline_fingerprint
      || row.identity_cache?.recognition_pipeline_fingerprint
      || replayVersions.recognition_pipeline_fingerprint
      || versions.recognition_pipeline_fingerprint
    ).toLowerCase(),
    catalog_snapshot_revision: exactText(
      row.catalog_snapshot_revision
      || row.active_catalog_snapshot_revision
      || replayVersions.catalog_snapshot
      || versions.catalog_snapshot_revision
    )
  };
}

function predictionRunProvenance(predictions = {}, dataset = {}) {
  const provenance = plainObject(predictions.provenance);
  const versions = plainObject(predictions.versions);
  const expected = {
    deployment_git_commit_sha: exactText(
      provenance.deployment_git_commit_sha
      || predictions.deployment_git_commit_sha
      || predictions.deployment?.git_commit_sha
    ).toLowerCase(),
    recognition_pipeline_fingerprint: exactText(
      provenance.recognition_pipeline_fingerprint
      || predictions.recognition_pipeline_fingerprint
      || versions.recognition_pipeline_fingerprint
    ).toLowerCase(),
    catalog_snapshot_revision: exactText(
      provenance.catalog_snapshot_revision
      || provenance.active_catalog_snapshot_revision
      || predictions.catalog_snapshot_revision
      || predictions.active_catalog_snapshot_revision
      || versions.catalog_snapshot_revision
      || versions.catalog_snapshot
    )
  };
  const rows = predictionRows(predictions);
  const rowIds = rows.map(resultId);
  const datasetIds = datasetItems(dataset).map(resultId);
  const uniqueRowIds = rowIds.length > 0
    && rowIds.every(Boolean)
    && new Set(rowIds).size === rowIds.length;
  const uniqueDatasetIds = datasetIds.length > 0
    && datasetIds.every(Boolean)
    && new Set(datasetIds).size === datasetIds.length;
  const exactItemSetMatch = uniqueRowIds && uniqueDatasetIds
    && JSON.stringify(sortedIds(rowIds)) === JSON.stringify(sortedIds(datasetIds));
  const validExpected = /^[0-9a-f]{40}$/.test(expected.deployment_git_commit_sha)
    && /^[0-9a-f]{64}$/.test(expected.recognition_pipeline_fingerprint)
    && Boolean(expected.catalog_snapshot_revision)
    && predictions.schema_version === goldenSemPredictionRunSchemaVersion;
  const rowVersions = rows.map(predictionRowVersion);
  const rowsMatch = rows.length > 0 && rowVersions.every((row) => (
    row.deployment_git_commit_sha === expected.deployment_git_commit_sha
    && row.recognition_pipeline_fingerprint === expected.recognition_pipeline_fingerprint
    && row.catalog_snapshot_revision === expected.catalog_snapshot_revision
  ));
  return {
    ...expected,
    prediction_content_sha256: contentSha256(predictions),
    row_count: rows.length,
    rows_version_bound: rowsMatch,
    prediction_item_ids_unique: uniqueRowIds,
    dataset_item_ids_unique: uniqueDatasetIds,
    exact_item_set_match: exactItemSetMatch,
    complete: validExpected && rowsMatch && exactItemSetMatch
  };
}

function rendererReplayAssessment(result = {}) {
  const replay = plainObject(result.renderer_replay);
  const replayResolved = plainObject(replay.resolved_fields);
  const scoredResolved = resolvedFields(result);
  const evidencePresent = Object.hasOwn(replay, "field_evidence")
    && replay.field_evidence
    && typeof replay.field_evidence === "object"
    && !Array.isArray(replay.field_evidence);
  const serialFlagValid = replay.serial_numerator_verified === null
    || typeof replay.serial_numerator_verified === "boolean";
  const complete = replay.schema_version === "listing-renderer-replay-v1"
    && Object.keys(replayResolved).length > 0
    && contentSha256(replayResolved) === contentSha256(scoredResolved)
    && evidencePresent
    && replay.max_length === 80
    && serialFlagValid
    && typeof replay.trust_resolved_print_run_without_evidence === "boolean"
    && exactText(replay.renderer_version).length > 0;
  const finalTitlePresent = typeof result.final_title === "string"
    && result.final_title.length > 0
    && result.final_title.length <= 80;
  if (!complete) {
    return {
      complete: false,
      faithful: false,
      final_title_present: finalTitlePresent,
      renderer_version_match: false,
      exact_title_match: false,
      reason: "RENDERER_REPLAY_INPUT_INCOMPLETE"
    };
  }
  const presentation = renderListingPresentation({
    resolved: replayResolved,
    evidence: replay.field_evidence,
    maxLength: replay.max_length,
    serialNumeratorVerified: replay.serial_numerator_verified,
    trustResolvedPrintRunWithoutEvidence: replay.trust_resolved_print_run_without_evidence
  });
  const rendererVersionMatch = replay.renderer_version === presentation.renderer_version;
  const exactTitleMatch = finalTitlePresent && result.final_title === presentation.final_title;
  return {
    complete: true,
    faithful: rendererVersionMatch && exactTitleMatch,
    final_title_present: finalTitlePresent,
    renderer_version: replay.renderer_version,
    replayed_renderer_version: presentation.renderer_version,
    renderer_version_match: rendererVersionMatch,
    exact_title_match: exactTitleMatch,
    final_title: finalTitlePresent ? result.final_title : null,
    replayed_final_title: presentation.final_title,
    reason: rendererVersionMatch && exactTitleMatch
      ? null
      : !rendererVersionMatch
        ? "RENDERER_VERSION_MISMATCH"
        : "RENDERED_TITLE_MISMATCH"
  };
}

function titleCriticalAssessment(item = {}, result = {}) {
  const finalTitle = typeof result.final_title === "string" ? result.final_title : "";
  const projection = finalTitle ? semProjectionFromTitle(finalTitle) : { sem: {}, field_statuses: {} };
  const resolvedPrediction = canonicalSemPrediction(result);
  const mismatches = [];
  for (const field of titleCriticalIdentityFields) {
    if (groundTruthStatus(item, field) !== "CONFIRMED") continue;
    const expected = item.reviewed_ground_truth?.fields?.[field];
    const actual = projection.sem?.[field];
    const resolvedAlreadyMismatch = !normalizeGoldenSemValue(field, resolvedPrediction[field])
      || !semFieldEquivalent(field, expected, resolvedPrediction[field]);
    const parserConfirmed = projection.field_statuses?.[field] === "CONFIRMED"
      && Boolean(normalizeGoldenSemValue(field, actual));
    if (parserConfirmed && semFieldEquivalent(field, expected, actual)) continue;
    mismatches.push({
      field,
      reason: parserConfirmed && !resolvedAlreadyMismatch
        ? "TITLE_CRITICAL_CONFLICT"
        : "TITLE_CRITICAL_NOT_PROVEN",
      expected,
      actual: actual ?? null
    });
  }
  return {
    complete: Boolean(finalTitle) && mismatches.length === 0,
    mismatch_count: mismatches.length,
    fabrication_count: mismatches.filter((row) => row.reason === "TITLE_CRITICAL_CONFLICT").length,
    mismatches
  };
}

export function evaluateGoldenSemAccuracy({
  dataset = {},
  predictions = {},
  now = () => new Date()
} = {}) {
  const items = datasetItems(dataset);
  const predictionsById = predictionMap(predictions);
  const validation = releaseValidation(dataset);
  const truthPolicy = evaluationTruthPolicy(dataset);
  const predictionProvenance = predictionRunProvenance(predictions, dataset);
  const perField = Object.fromEntries(goldenSemLaunchFields.map((field) => [field, {
    correct: 0,
    total: 0,
    accuracy: null
  }]));
  const cards = [];
  let matchedPredictionCount = 0;
  let evaluatedCardCount = 0;
  let exactCardCount = 0;
  let applicableFieldCount = 0;
  let correctFieldCount = 0;
  let policyWeightedCorrect = 0;
  let policyWeightedTotal = 0;
  let criticalOverclaimCount = 0;
  let criticalOverclaimCardCount = 0;
  let criticalConfirmedMismatchCount = 0;
  let criticalFabricationCount = 0;
  let catastrophicTitleCount = 0;
  let titleCriticalMismatchCount = 0;
  let rendererReplayCompleteCount = 0;
  let rendererFidelityCount = 0;
  let titleCriticalFidelityCount = 0;

  for (const item of items) {
    const id = resultId(item);
    const result = predictionsById.get(id) || null;
    if (result) matchedPredictionCount += 1;
    const prediction = result ? canonicalSemPrediction(result) : canonicalSemPrediction({});
    const fields = {};
    const errors = [];
    let cardCriticalOverclaimCount = 0;
    let cardCriticalConfirmedMismatchCount = 0;
    let cardCriticalFabricationCount = 0;
    for (const field of goldenSemLaunchFields) {
      const status = groundTruthStatus(item, field);
      const excluded = excludedStatuses.has(status);
      const groundTruth = item.reviewed_ground_truth?.fields?.[field];
      const normalizedPrediction = normalizeGoldenSemValue(field, prediction[field]);
      const criticalOverclaim = criticalFields.has(field)
        && criticalOverclaimStatuses.has(status)
        && Boolean(normalizedPrediction);
      const expected = excluded ? null : normalizeGoldenSemValue(field, groundTruth);
      const actual = excluded ? null : normalizedPrediction;
      const isCorrect = excluded ? null : expected === actual;
      const criticalConfirmedMismatch = criticalFields.has(field)
        && status === "CONFIRMED"
        && isCorrect === false;
      const conflictingCriticalValue = criticalConfirmedMismatch && Boolean(normalizedPrediction);
      fields[field] = {
        ground_truth: groundTruth,
        ground_truth_status: status,
        prediction: prediction[field],
        normalized_ground_truth: expected,
        normalized_prediction: normalizedPrediction,
        excluded_from_denominator: excluded,
        critical_overclaim: criticalOverclaim,
        critical_confirmed_mismatch: criticalConfirmedMismatch,
        critical_fabrication: criticalOverclaim || conflictingCriticalValue,
        is_correct: isCorrect
      };
      if (criticalOverclaim) {
        cardCriticalOverclaimCount += 1;
        criticalOverclaimCount += 1;
        errors.push({
          field,
          reason: `CRITICAL_${status}_OVERCLAIM`,
          ground_truth: groundTruth,
          ground_truth_status: status,
          prediction: prediction[field]
        });
      }
      if (criticalConfirmedMismatch) {
        cardCriticalConfirmedMismatchCount += 1;
        criticalConfirmedMismatchCount += 1;
        if (conflictingCriticalValue) {
          cardCriticalFabricationCount += 1;
          criticalFabricationCount += 1;
        }
        errors.push({
          field,
          reason: conflictingCriticalValue
            ? "CRITICAL_CONFIRMED_CONFLICT"
            : "CRITICAL_CONFIRMED_MISSING",
          ground_truth: groundTruth,
          ground_truth_status: status,
          prediction: prediction[field]
        });
      }
      if (excluded) continue;
      applicableFieldCount += 1;
      perField[field].total += 1;
      if (isCorrect) {
        correctFieldCount += 1;
        perField[field].correct += 1;
      } else {
        errors.push({
          field,
          ground_truth: groundTruth,
          prediction: prediction[field]
        });
      }
    }
    const evaluatedFields = Object.values(fields).filter((field) => !field.excluded_from_denominator);
    const policyWeighted = scoreRequiredSemProjection({
      expectedSem: item.reviewed_ground_truth?.fields || {},
      actualSem: prediction,
      fieldStatuses: item.reviewed_ground_truth?.field_statuses || {},
      grammar: itemSemGrammar(item)
    });
    policyWeightedCorrect += policyWeighted.correct_weight;
    policyWeightedTotal += policyWeighted.total_weight;
    const rendererFidelity = result ? rendererReplayAssessment(result) : rendererReplayAssessment({});
    const titleCritical = result ? titleCriticalAssessment(item, result) : titleCriticalAssessment(item, {});
    if (truthPolicy.formal_golden_sem) {
      if (rendererFidelity.complete) rendererReplayCompleteCount += 1;
      if (rendererFidelity.faithful) rendererFidelityCount += 1;
      else errors.push({ reason: rendererFidelity.reason || "RENDERER_FIDELITY_FAILED" });
      if (titleCritical.complete) titleCriticalFidelityCount += 1;
      else {
        titleCriticalMismatchCount += titleCritical.mismatch_count;
        cardCriticalConfirmedMismatchCount += titleCritical.mismatch_count;
        criticalConfirmedMismatchCount += titleCritical.mismatch_count;
        cardCriticalFabricationCount += titleCritical.fabrication_count;
        criticalFabricationCount += titleCritical.fabrication_count;
        errors.push(...titleCritical.mismatches);
      }
    }
    cardCriticalFabricationCount += cardCriticalOverclaimCount;
    criticalFabricationCount += cardCriticalOverclaimCount;
    const catastrophicTitle = cardCriticalOverclaimCount > 0 || cardCriticalConfirmedMismatchCount > 0;
    if (cardCriticalOverclaimCount > 0) {
      criticalOverclaimCardCount += 1;
    }
    if (catastrophicTitle) catastrophicTitleCount += 1;
    const cardExact = evaluatedFields.length > 0 ? errors.length === 0 : null;
    if (cardExact !== null) {
      evaluatedCardCount += 1;
      if (cardExact) exactCardCount += 1;
    }
    cards.push({
      item_id: cleanText(item.item_id || item.query_card_id),
      prediction_present: Boolean(result),
      card_exact: cardExact,
      evaluated_field_count: evaluatedFields.length,
      error_count: errors.length,
      critical_overclaim_count: cardCriticalOverclaimCount,
      critical_confirmed_mismatch_count: cardCriticalConfirmedMismatchCount,
      critical_fabrication_count: cardCriticalFabricationCount,
      catastrophic_title: catastrophicTitle,
      renderer_fidelity: rendererFidelity,
      title_critical_fidelity: titleCritical,
      errors,
      fields,
      policy_weighted_sem: policyWeighted
    });
  }

  for (const field of goldenSemLaunchFields) {
    perField[field].incorrect = perField[field].total - perField[field].correct;
    perField[field].accuracy = rate(perField[field].correct, perField[field].total);
  }
  const partition = dataset.partition
    || (dataset.set_type === "CORE_HOLDOUT" ? "holdout" : null);
  return {
    schema_version: goldenSemAccuracySchemaVersion,
    generated_at: now().toISOString(),
    status: validation.ok && evaluatedCardCount > 0 && truthPolicy.recognized
      && (!truthPolicy.formal_golden_sem || (
        predictionProvenance.complete
        && rendererReplayCompleteCount === items.length
      ))
      ? (truthPolicy.formal_golden_sem ? "COMPLETED" : "COMPLETED_PROXY")
      : "INCONCLUSIVE",
    source: {
      dataset_id: dataset.dataset_id || dataset.set_id || null,
      dataset_schema_version: dataset.schema_version || null,
      set_type: dataset.set_type || null,
      partition,
      release_set_validation_ok: validation.ok,
      sem_standard_version: dataset.sem_standard_version || null,
      predictions_schema_version: predictions.schema_version || null,
      predictions_provider: predictions.provider || predictions.requested_cloud_provider || null,
      field_ground_truth_class: truthPolicy.field_ground_truth_class,
      release_set_digest_schema_version: dataset.item_set_digest_schema_version || null,
      release_set_item_set_sha256: cleanText(dataset.item_set_sha256) || validation.item_set_sha256 || null,
      prediction_digest_schema_version: predictionContentDigestSchemaVersion,
      prediction_content_sha256: predictionProvenance.prediction_content_sha256,
      deployment_git_commit_sha: predictionProvenance.deployment_git_commit_sha || null,
      recognition_pipeline_fingerprint: predictionProvenance.recognition_pipeline_fingerprint || null,
      catalog_snapshot_revision: predictionProvenance.catalog_snapshot_revision || null,
      prediction_row_count: predictionProvenance.row_count,
      prediction_rows_version_bound: predictionProvenance.rows_version_bound,
      prediction_item_ids_unique: predictionProvenance.prediction_item_ids_unique,
      prediction_exact_item_set_match: predictionProvenance.exact_item_set_match
    },
    scope: {
      reviewed_ground_truth_only: truthPolicy.formal_golden_sem,
      formal_golden_sem: truthPolicy.formal_golden_sem,
      launch_gate_eligible: truthPolicy.launch_gate_eligible
        && predictionProvenance.complete
        && rendererReplayCompleteCount === items.length
        && validation.launch_gate_authority === true,
      explicit_evaluation_truth_policy: truthPolicy.explicitly_declared,
      prediction_run_provenance_complete: predictionProvenance.complete,
      renderer_replay_inputs_complete: !truthPolicy.formal_golden_sem
        || rendererReplayCompleteCount === items.length,
      writer_title_used_as_field_ground_truth: truthPolicy.writer_title_used_as_field_ground_truth,
      evidence_limitations: truthPolicy.limitations,
      card_exact_requires_all_applicable_fields: true,
      unknown_and_not_applicable_excluded: true,
      critical_unknown_and_not_applicable_overclaims_fail_card_exact: true,
      evaluated_fields: goldenSemLaunchFields
    },
    summary: {
      label_item_count: items.length,
      matched_prediction_count: matchedPredictionCount,
      missing_prediction_count: Math.max(0, items.length - matchedPredictionCount),
      evaluated_card_count: evaluatedCardCount,
      evaluated_field_count: applicableFieldCount,
      independent_identity_group_count: validation.independent_identity_group_count ?? 0,
      launch_field_contract_covered_count: validation.launch_field_contract_covered_count ?? 0,
      critical_identity_covered_count: validation.critical_identity_covered_count ?? 0,
      renderer_replay_complete_count: rendererReplayCompleteCount,
      renderer_fidelity_count: rendererFidelityCount,
      title_critical_fidelity_count: titleCriticalFidelityCount
    },
    metrics: {
      sem_card_exact_accuracy: {
        correct: exactCardCount,
        total: evaluatedCardCount,
        rate: rate(exactCardCount, evaluatedCardCount)
      },
      sem_field_exact_accuracy: {
        correct: correctFieldCount,
        total: applicableFieldCount,
        rate: rate(correctFieldCount, applicableFieldCount)
      },
      critical_overclaim_count: criticalOverclaimCount,
      critical_overclaim_card_count: criticalOverclaimCardCount,
      critical_confirmed_mismatch_count: criticalConfirmedMismatchCount,
      critical_fabrication_count: criticalFabricationCount,
      catastrophic_title_count: catastrophicTitleCount,
      title_critical_mismatch_count: titleCriticalMismatchCount,
      renderer_fidelity: {
        correct: rendererFidelityCount,
        total: items.length,
        rate: rate(rendererFidelityCount, items.length)
      },
      title_critical_fidelity: {
        correct: titleCriticalFidelityCount,
        total: items.length,
        rate: rate(titleCriticalFidelityCount, items.length)
      },
      sem_policy_weighted_accuracy: {
        correct_weight: Number(policyWeightedCorrect.toFixed(6)),
        total_weight: Number(policyWeightedTotal.toFixed(6)),
        rate: rate(policyWeightedCorrect, policyWeightedTotal),
        launch_gate_authority: false,
        runtime_chain_effect: "NONE"
      },
      per_field_exact_accuracy: perField
    },
    validation,
    cards
  };
}
