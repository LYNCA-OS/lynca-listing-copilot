import {
  goldenSemLaunchFields,
  goldenSemPartitionSchemaVersion
} from "./golden-sem-release.mjs";
import { validateReleaseSetManifest } from "./release-set-contract.mjs";

export const goldenSemAccuracySchemaVersion = "golden-sem-accuracy-report-v1";

const excludedStatuses = new Set(["UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED", ""]);
const setFields = new Set(["subject", "special_stamp", "search_optimization"]);

function cleanText(value) {
  return String(value ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
  return cleanText(
    result.item_id
    || result.query_card_id
    || result.card_id
    || result.asset_id
    || result.source_feedback_id
    || result.candidate_id
  ).toLowerCase();
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

function releaseValidation(dataset = {}) {
  if (dataset.schema_version === "release-set-v1") return validateReleaseSetManifest(dataset);
  if (dataset.schema_version === goldenSemPartitionSchemaVersion) {
    return {
      ok: dataset.partition !== "holdout" || dataset.data_policy?.frozen_holdout === true,
      errors: dataset.partition === "holdout" && dataset.data_policy?.frozen_holdout !== true
        ? ["holdout data policy is not frozen"]
        : [],
      warnings: []
    };
  }
  return { ok: false, errors: ["unsupported Golden SEM dataset schema"], warnings: [] };
}

export function evaluateGoldenSemAccuracy({
  dataset = {},
  predictions = {},
  now = () => new Date()
} = {}) {
  const items = datasetItems(dataset);
  const predictionsById = predictionMap(predictions);
  const validation = releaseValidation(dataset);
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

  for (const item of items) {
    const id = resultId(item);
    const result = predictionsById.get(id) || null;
    if (result) matchedPredictionCount += 1;
    const prediction = result ? canonicalSemPrediction(result) : canonicalSemPrediction({});
    const fields = {};
    const errors = [];
    for (const field of goldenSemLaunchFields) {
      const status = groundTruthStatus(item, field);
      const excluded = excludedStatuses.has(status);
      const groundTruth = item.reviewed_ground_truth?.fields?.[field];
      const expected = excluded ? null : normalizeGoldenSemValue(field, groundTruth);
      const actual = excluded ? null : normalizeGoldenSemValue(field, prediction[field]);
      const isCorrect = excluded ? null : expected === actual;
      fields[field] = {
        ground_truth: groundTruth,
        ground_truth_status: status,
        prediction: prediction[field],
        normalized_ground_truth: expected,
        normalized_prediction: actual,
        excluded_from_denominator: excluded,
        is_correct: isCorrect
      };
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
      errors,
      fields
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
    status: validation.ok && evaluatedCardCount > 0 ? "COMPLETED" : "INCONCLUSIVE",
    source: {
      dataset_id: dataset.dataset_id || dataset.set_id || null,
      dataset_schema_version: dataset.schema_version || null,
      partition,
      release_set_validation_ok: validation.ok,
      sem_standard_version: dataset.sem_standard_version || null,
      predictions_schema_version: predictions.schema_version || null,
      predictions_provider: predictions.provider || predictions.requested_cloud_provider || null
    },
    scope: {
      reviewed_ground_truth_only: true,
      writer_title_used_as_field_ground_truth: false,
      card_exact_requires_all_applicable_fields: true,
      unknown_and_not_applicable_excluded: true,
      evaluated_fields: goldenSemLaunchFields
    },
    summary: {
      label_item_count: items.length,
      matched_prediction_count: matchedPredictionCount,
      missing_prediction_count: Math.max(0, items.length - matchedPredictionCount),
      evaluated_card_count: evaluatedCardCount,
      evaluated_field_count: applicableFieldCount
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
      per_field_exact_accuracy: perField
    },
    validation,
    cards
  };
}
