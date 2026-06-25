import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "reviewed-field-accuracy-report-v1";
const defaultLabels = "data/eval/reviewed-ground-truth/development-reviewed-30.json";
const defaultPredictions = "data/eval/provider-regression-30/gemini31flashlite-only-current-30.json";
const defaultOut = "data/eval/reviewed-ground-truth/baseline-gemini31flashlite-current-30.json";

export const reviewedFieldKeys = Object.freeze([
  "subject",
  "year",
  "product_or_set",
  "card_type",
  "variant_or_parallel",
  "collector_number",
  "serial_number",
  "grade"
]);

const denominatorExcludedStatuses = new Set(["UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED"]);

const fieldSourceMap = Object.freeze({
  subject: ["subject", "subjects", "players", "player", "character"],
  year: ["year"],
  product_or_set: ["product_or_set", "product", "set", "subset", "brand", "manufacturer"],
  card_type: ["card_type", "insert", "rc", "auto", "patch", "relic"],
  variant_or_parallel: ["variant_or_parallel", "parallel_exact", "parallel", "parallel_family", "surface_color", "variation"],
  collector_number: ["collector_number", "card_number", "checklist_code"],
  serial_number: ["serial_number"],
  grade: ["grade", "grade_company", "card_grade", "auto_grade", "grade_type"]
});

const reviewLikeValues = new Set([
  "REVIEW",
  "REVIEW_REQUIRED",
  "WRITER_REVIEW",
  "INCLUDE_HIGHLIGHTED",
  "PUBLISHABLE_REVIEW",
  "PUBLISHABLE_NARROW_REVIEW"
]);

const conflictLikeValues = new Set([
  "CONFLICT",
  "CONFLICTING",
  "BLOCKING",
  "BLOCKED",
  "AMBIGUOUS",
  "ABSTAIN",
  "SUGGEST_ONLY",
  "OMIT",
  "NOT_PUBLISHABLE",
  "MANUAL_REQUIRED"
]);

const colorWords = Object.freeze([
  "black",
  "blue",
  "bronze",
  "brown",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "teal",
  "violet",
  "white",
  "yellow"
]);

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/\bautograph\b/g, "auto")
    .replace(/\brookie\b/g, "rc")
    .replace(/[^\w/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (value && typeof value === "object") return Object.values(value).some(valuePresent);
  return normalizeText(value) !== "";
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function emptyFieldStats(field) {
  return {
    field,
    correct: 0,
    total: 0,
    accuracy: null
  };
}

function normalizeId(value) {
  return normalizeText(value)
    .replace(/^supabase_feedback_/i, "")
    .replace(/^needs_review_/i, "")
    .toLowerCase();
}

function candidateIds(object = {}) {
  return [
    object.card_id,
    object.candidate_id,
    object.source_feedback_id,
    object.asset_id,
    object.physical_card_id
  ].map(normalizeId).filter(Boolean);
}

function resultFields(result = {}) {
  return result.prediction?.fields
    || result.fields
    || result.resolved
    || result.prediction?.resolved
    || {};
}

function resultGate(result = {}) {
  return result.publication_gate
    || result.prediction?.publication_gate
    || result.gate
    || {};
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

export function normalizeSubject(value) {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (value.subjects || value.players || value.value || [])
      : value;
  return [...new Set(asArray(raw).map(comparableText).filter(Boolean))].sort();
}

function subjectDisplay(value) {
  return normalizeSubject(value);
}

function normalizeSerial(value) {
  const text = normalizeText(value);
  const match = text.match(/\b#?\s*0*(\d+|[xX?]+)\s*\/\s*0*(\d+)\b/);
  if (!match) return comparableText(text);
  return `${match[1].toLowerCase()}/${Number(match[2])}`;
}

function serialDenominator(value) {
  const text = normalizeText(value);
  const match = text.match(/(?:#|0*\d+|[xX?]+)\s*\/\s*0*(\d+)\b/);
  return match ? String(Number(match[1])) : "";
}

function normalizeGrade(value) {
  if (!valuePresent(value)) return "";
  if (typeof value === "object" && !Array.isArray(value)) {
    const company = comparableText(value.company || value.grade_company);
    const cardGrade = comparableText(value.card_grade || value.grade || value.cardGrade);
    const autoGrade = comparableText(value.auto_grade || value.autoGrade);
    const gradeType = comparableText(value.grade_type || value.gradeType);
    return [
      company,
      cardGrade ? `card:${cardGrade}` : "",
      autoGrade ? `auto:${autoGrade}` : "",
      gradeType && gradeType !== "unknown" ? `type:${gradeType}` : ""
    ].filter(Boolean).join("|");
  }
  return comparableText(value);
}

function gradeDisplay(value) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  return normalizeText(value);
}

function colorFromText(value) {
  const text = ` ${comparableText(value)} `;
  return colorWords.find((color) => text.includes(` ${color} `)) || "";
}

function variantParts(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const exact = normalizeText(value.exact || value.value || value.parallel_exact || value.parallel || value.variant);
    const narrow = normalizeText(value.narrow || value.family || value.parallel_family);
    const color = normalizeText(value.color || value.surface_color || colorFromText(exact || narrow));
    return { exact, narrow, color };
  }
  const exact = normalizeText(value);
  return {
    exact,
    narrow: "",
    color: colorFromText(exact)
  };
}

function productOrSetParts(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const product = normalizeText(value.product);
    const set = normalizeText(value.set);
    const joined = normalizeText(value.value || [product, set].filter(Boolean).join(" "));
    return {
      product,
      set,
      value: joined
    };
  }
  return {
    product: "",
    set: "",
    value: normalizeText(value)
  };
}

function normalizeProductOrSet(value) {
  const parts = productOrSetParts(value);
  return comparableText(parts.value || [parts.product, parts.set].filter(Boolean).join(" "));
}

function normalizeCardType(value) {
  if (Array.isArray(value)) return [...new Set(value.map(comparableText).filter(Boolean))].sort().join("|");
  return comparableText(value);
}

function predictionCardType(fields = {}) {
  const components = [];
  if (valuePresent(fields.card_type)) components.push(fields.card_type);
  if (valuePresent(fields.insert)) components.push(fields.insert);
  if (fields.rc === true) components.push("RC");
  if (fields.auto === true) components.push("Auto");
  if (fields.patch === true) components.push("Patch");
  if (fields.relic === true) components.push("Relic");
  return [...new Set(components.map(normalizeText).filter(Boolean))].join(" ");
}

function predictionProductOrSet(fields = {}) {
  if (valuePresent(fields.product_or_set)) return fields.product_or_set;
  return {
    product: normalizeText(fields.product),
    set: normalizeText(fields.set || fields.subset),
    value: [fields.product, fields.set || fields.subset].map(normalizeText).filter(Boolean).join(" ")
  };
}

function predictionVariant(fields = {}) {
  if (valuePresent(fields.variant_or_parallel)) return fields.variant_or_parallel;
  return {
    exact: normalizeText(fields.parallel_exact || fields.parallel || fields.variation),
    narrow: normalizeText(fields.parallel_family),
    color: normalizeText(fields.surface_color || colorFromText(fields.parallel_exact || fields.parallel || fields.variation || fields.parallel_family))
  };
}

function predictionGrade(fields = {}) {
  if (valuePresent(fields.grade)) return fields.grade;
  return {
    company: normalizeText(fields.grade_company),
    card_grade: normalizeText(fields.card_grade),
    auto_grade: normalizeText(fields.auto_grade),
    grade_type: normalizeText(fields.grade_type)
  };
}

function pickPredictionValue(result = {}, field) {
  const fields = resultFields(result);
  switch (field) {
    case "subject":
      return fields.subject || fields.subjects || fields.players || fields.player || fields.character || [];
    case "year":
      return normalizeText(fields.year);
    case "product_or_set":
      return predictionProductOrSet(fields);
    case "card_type":
      return predictionCardType(fields);
    case "variant_or_parallel":
      return predictionVariant(fields);
    case "collector_number":
      return normalizeText(fields.collector_number || fields.card_number || fields.checklist_code);
    case "serial_number":
      return normalizeText(fields.serial_number);
    case "grade":
      return predictionGrade(fields);
    default:
      return "";
  }
}

function legacyGroundTruthValue(item = {}, field) {
  const groundTruth = item.ground_truth || {};
  switch (field) {
    case "subject":
      return groundTruth.subject || groundTruth.subjects || groundTruth.players || [];
    case "year":
      return groundTruth.year;
    case "product_or_set":
      return {
        product: normalizeText(groundTruth.product),
        set: normalizeText(groundTruth.set),
        value: normalizeText(groundTruth.product_or_set || [groundTruth.product, groundTruth.set].map(normalizeText).filter(Boolean).join(" "))
      };
    case "card_type":
      return groundTruth.card_type || groundTruth.insert;
    case "variant_or_parallel":
      return {
        exact: normalizeText(groundTruth.variant_or_parallel || groundTruth.parallel || groundTruth.variation),
        narrow: normalizeText(groundTruth.parallel_family),
        color: normalizeText(groundTruth.surface_color)
      };
    case "collector_number":
      return groundTruth.collector_number || groundTruth.card_number;
    case "serial_number":
      return groundTruth.serial_number;
    case "grade":
      return {
        company: normalizeText(groundTruth.grade_company),
        card_grade: normalizeText(groundTruth.card_grade),
        auto_grade: normalizeText(groundTruth.auto_grade),
        grade_type: normalizeText(groundTruth.grade_type)
      };
    default:
      return "";
  }
}

function reviewedField(item = {}, field) {
  const fieldRecord = item.fields?.[field];
  if (fieldRecord) {
    const status = normalizeText(fieldRecord.status || fieldRecord.reviewed_status || "UNREVIEWED").toUpperCase();
    return {
      status,
      value: fieldRecord.value ?? fieldRecord.reviewed_value ?? null
    };
  }

  const value = legacyGroundTruthValue(item, field);
  return {
    status: valuePresent(value) ? "CONFIRMED" : "UNKNOWN",
    value
  };
}

function compareValues(field, groundTruth, prediction) {
  if (field === "subject") {
    const expected = normalizeSubject(groundTruth);
    const actual = normalizeSubject(prediction);
    return {
      is_correct: expected.join("|") === actual.join("|"),
      normalized_ground_truth: expected,
      normalized_prediction: actual
    };
  }

  if (field === "serial_number") {
    const expected = normalizeSerial(groundTruth);
    const actual = normalizeSerial(prediction);
    const expectedDenominator = serialDenominator(groundTruth);
    const actualDenominator = serialDenominator(prediction);
    return {
      is_correct: expected !== "" && expected === actual,
      normalized_ground_truth: expected,
      normalized_prediction: actual,
      serial_denominator_match: Boolean(expectedDenominator && expectedDenominator === actualDenominator)
    };
  }

  if (field === "variant_or_parallel") {
    const expected = variantParts(groundTruth);
    const actual = variantParts(prediction);
    const expectedExact = comparableText(expected.exact);
    const actualExact = comparableText(actual.exact);
    const expectedNarrow = comparableText(expected.narrow);
    const actualNarrow = comparableText(actual.narrow);
    const expectedColor = comparableText(expected.color || colorFromText(expected.exact));
    const actualColor = comparableText(actual.color || colorFromText(actual.exact || actual.narrow));

    return {
      is_correct: expectedExact !== "" && expectedExact === actualExact,
      normalized_ground_truth: expectedExact,
      normalized_prediction: actualExact,
      parallel_narrow_match: expectedNarrow ? expectedNarrow === actualNarrow : null,
      parallel_color_match: expectedColor ? expectedColor === actualColor : null
    };
  }

  if (field === "grade") {
    const expected = normalizeGrade(groundTruth);
    const actual = normalizeGrade(prediction);
    return {
      is_correct: expected !== "" && expected === actual,
      normalized_ground_truth: expected,
      normalized_prediction: actual
    };
  }

  if (field === "product_or_set") {
    const expected = normalizeProductOrSet(groundTruth);
    const actual = normalizeProductOrSet(prediction);
    return {
      is_correct: expected !== "" && expected === actual,
      normalized_ground_truth: expected,
      normalized_prediction: actual
    };
  }

  const expected = field === "card_type" ? normalizeCardType(groundTruth) : comparableText(groundTruth);
  const actual = field === "card_type" ? normalizeCardType(prediction) : comparableText(prediction);
  return {
    is_correct: expected !== "" && expected === actual,
    normalized_ground_truth: expected,
    normalized_prediction: actual
  };
}

function mapStatusValue(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (conflictLikeValues.has(normalized)) return "CONFLICT";
  if (reviewLikeValues.has(normalized)) return "REVIEW";
  return null;
}

function displayStatusFromNode(node = {}) {
  const direct = mapStatusValue(node.display_status || node.display_policy || node.publication_state || node.publishability);
  if (direct) return direct;
  if (Array.isArray(node.conflicts) && node.conflicts.length) return "CONFLICT";
  if (node.requires_writer_confirmation === true) return "REVIEW";
  const systemStatus = mapStatusValue(node.system_status || node.decision_route);
  if (systemStatus) return systemStatus;
  return null;
}

function displayStatusForField(result = {}, field) {
  const gate = resultGate(result);
  const sourceFields = fieldSourceMap[field] || [field];
  const sourceSet = new Set(sourceFields);
  let status = "NORMAL";

  const apply = (candidate) => {
    if (candidate === "CONFLICT") status = "CONFLICT";
    if (candidate === "REVIEW" && status !== "CONFLICT") status = "REVIEW";
  };

  const byField = gate.draft_gate?.by_field
    || gate.field_level_publication?.by_field
    || gate.field_level_publication?.fields
    || {};

  for (const sourceField of sourceFields) {
    if (byField[sourceField]) apply(displayStatusFromNode(byField[sourceField]));
  }

  const writerRequired = new Set(asArray(gate.writer_required_fields));
  for (const sourceField of sourceFields) {
    if (writerRequired.has(sourceField)) apply("REVIEW");
  }

  const reviewItems = asArray(gate.writer_review_items)
    .concat(asArray(gate.field_level_publication?.review_required_fields));
  for (const item of reviewItems) {
    if (!sourceSet.has(item?.field)) continue;
    apply(displayStatusFromNode(item) || "REVIEW");
  }

  const states = {
    ...(gate.field_publication_states || {}),
    ...(gate.field_publishability || {})
  };
  for (const sourceField of sourceFields) {
    apply(mapStatusValue(states[sourceField]));
  }

  return status;
}

function displayGroundTruth(field, value) {
  if (field === "subject") return subjectDisplay(value);
  if (field === "grade") return gradeDisplay(value);
  return value;
}

function displayPrediction(field, value) {
  if (field === "subject") return subjectDisplay(value);
  if (field === "grade") return gradeDisplay(value);
  return value;
}

function evaluateField(item, result, field) {
  const groundTruth = reviewedField(item, field);
  const prediction = result ? pickPredictionValue(result, field) : "";
  const displayStatus = result ? displayStatusForField(result, field) : "CONFLICT";
  const excludedByStatus = denominatorExcludedStatuses.has(groundTruth.status);
  const emptyConfirmed = groundTruth.status === "CONFIRMED" && !valuePresent(groundTruth.value);
  const excluded = excludedByStatus || emptyConfirmed;
  const comparison = excluded
    ? {
      is_correct: null,
      normalized_ground_truth: null,
      normalized_prediction: null
    }
    : compareValues(field, groundTruth.value, prediction);

  return {
    field,
    ground_truth: displayGroundTruth(field, groundTruth.value),
    ground_truth_status: groundTruth.status,
    prediction: displayPrediction(field, prediction),
    display_status: displayStatus,
    is_correct: comparison.is_correct,
    risk_flagged: displayStatus !== "NORMAL",
    excluded_from_denominator: excluded,
    exclusion_reason: excludedByStatus
      ? `ground_truth_status_${groundTruth.status.toLowerCase()}`
      : emptyConfirmed
        ? "empty_confirmed_ground_truth"
        : null,
    normalized_ground_truth: comparison.normalized_ground_truth,
    normalized_prediction: comparison.normalized_prediction,
    auxiliary: {
      parallel_narrow_match: comparison.parallel_narrow_match ?? null,
      parallel_color_match: comparison.parallel_color_match ?? null,
      serial_denominator_match: comparison.serial_denominator_match ?? null
    }
  };
}

function predictionMap(predictionReport = {}) {
  const results = Array.isArray(predictionReport.results)
    ? predictionReport.results
    : Array.isArray(predictionReport.items)
      ? predictionReport.items
      : [];
  const map = new Map();
  for (const result of results) {
    for (const id of candidateIds(result)) {
      if (!map.has(id)) map.set(id, result);
    }
  }
  return map;
}

function matchPrediction(item, map) {
  for (const id of candidateIds(item)) {
    if (map.has(id)) return map.get(id);
  }
  return null;
}

function metricBucket(correct = 0, total = 0) {
  return {
    correct,
    total,
    rate: rate(correct, total)
  };
}

function auxiliaryBucket(match, total) {
  return {
    match,
    total,
    rate: rate(match, total)
  };
}

export function evaluateReviewedFieldAccuracy({
  labels,
  predictions,
  now = () => new Date()
} = {}) {
  const labelItems = Array.isArray(labels?.items) ? labels.items : [];
  const predictionsById = predictionMap(predictions);
  const perField = new Map(reviewedFieldKeys.map((field) => [field, emptyFieldStats(field)]));
  const cards = [];
  const labelIssues = [];

  let matchedPredictionCount = 0;
  let evaluatedCardCount = 0;
  let cardExactCount = 0;
  let evaluatedFieldCount = 0;
  let criticalErrorCount = 0;
  let flaggedCriticalErrorCount = 0;
  let unflaggedCriticalErrorCount = 0;
  let parallelExactTotal = 0;
  let parallelExactCorrect = 0;
  let parallelNarrowTotal = 0;
  let parallelNarrowMatch = 0;
  let parallelColorTotal = 0;
  let parallelColorMatch = 0;
  let serialExactTotal = 0;
  let serialExactCorrect = 0;
  let serialDenominatorTotal = 0;
  let serialDenominatorMatch = 0;

  for (const [index, item] of labelItems.entries()) {
    const result = matchPrediction(item, predictionsById);
    if (result) matchedPredictionCount += 1;

    const fieldResults = Object.fromEntries(reviewedFieldKeys.map((field) => [
      field,
      evaluateField(item, result, field)
    ]));
    const evaluatedFields = Object.values(fieldResults).filter((fieldResult) => !fieldResult.excluded_from_denominator);
    const cardExact = evaluatedFields.length ? evaluatedFields.every((fieldResult) => fieldResult.is_correct === true) : null;

    if (evaluatedFields.length) {
      evaluatedCardCount += 1;
      if (cardExact) cardExactCount += 1;
    }

    for (const fieldResult of Object.values(fieldResults)) {
      if (fieldResult.exclusion_reason === "empty_confirmed_ground_truth") {
        labelIssues.push({
          card_id: item.card_id || item.source_feedback_id || item.asset_id || `card-${index + 1}`,
          field: fieldResult.field,
          issue: "CONFIRMED field has an empty value and was excluded"
        });
      }
      if (fieldResult.excluded_from_denominator) continue;

      evaluatedFieldCount += 1;
      const stats = perField.get(fieldResult.field);
      stats.total += 1;
      if (fieldResult.is_correct) stats.correct += 1;

      if (!fieldResult.is_correct) {
        criticalErrorCount += 1;
        if (fieldResult.risk_flagged) flaggedCriticalErrorCount += 1;
        else unflaggedCriticalErrorCount += 1;
      }

      if (fieldResult.field === "variant_or_parallel") {
        parallelExactTotal += 1;
        if (fieldResult.is_correct) parallelExactCorrect += 1;
        if (fieldResult.auxiliary.parallel_narrow_match !== null) {
          parallelNarrowTotal += 1;
          if (fieldResult.auxiliary.parallel_narrow_match) parallelNarrowMatch += 1;
        }
        if (fieldResult.auxiliary.parallel_color_match !== null) {
          parallelColorTotal += 1;
          if (fieldResult.auxiliary.parallel_color_match) parallelColorMatch += 1;
        }
      }

      if (fieldResult.field === "serial_number") {
        serialExactTotal += 1;
        if (fieldResult.is_correct) serialExactCorrect += 1;
        if (fieldResult.auxiliary.serial_denominator_match !== null) {
          serialDenominatorTotal += 1;
          if (fieldResult.auxiliary.serial_denominator_match) serialDenominatorMatch += 1;
        }
      }
    }

    cards.push({
      card_id: item.card_id || item.source_feedback_id || item.asset_id || `card-${index + 1}`,
      asset_id: item.asset_id || null,
      source_feedback_id: item.source_feedback_id || null,
      prediction_candidate_id: result?.candidate_id || null,
      prediction_status: result?.status || "missing_prediction",
      evaluated_field_count: evaluatedFields.length,
      card_exact: cardExact,
      errors: evaluatedFields
        .filter((fieldResult) => fieldResult.is_correct === false)
        .map((fieldResult) => ({
          field: fieldResult.field,
          ground_truth: fieldResult.ground_truth,
          prediction: fieldResult.prediction,
          display_status: fieldResult.display_status,
          risk_flagged: fieldResult.risk_flagged
        })),
      fields: fieldResults
    });
  }

  const perFieldExactAccuracy = Object.fromEntries([...perField.entries()].map(([field, stats]) => [
    field,
    {
      ...stats,
      incorrect: stats.total - stats.correct,
      accuracy: rate(stats.correct, stats.total)
    }
  ]));

  const status = evaluatedCardCount > 0 ? "completed" : "no_reviewed_ground_truth";

  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    status,
    source: {
      labels_schema_version: labels?.schema_version || null,
      labels_dataset_id: labels?.dataset_id || null,
      labels_split: labels?.split || null,
      labels_commercial_heldout: labels?.commercial_heldout === true,
      predictions_schema_version: predictions?.schema_version || null,
      predictions_provider: predictions?.provider || predictions?.requested_cloud_provider || null,
      predictions_provider_display_name: predictions?.provider_display_name || null
    },
    scope: {
      metric_dimensions: ["AI Card-Exact Accuracy", "Critical Risk Detection Quality"],
      key_fields: reviewedFieldKeys,
      corrected_title_used_as_ground_truth: false,
      corrected_title_policy: "annotation_hint_only",
      commercial_heldout_acceptance_set: false,
      development_set_only: true,
      excluded_ground_truth_statuses: [...denominatorExcludedStatuses]
    },
    summary: {
      label_item_count: labelItems.length,
      matched_prediction_count: matchedPredictionCount,
      evaluated_card_count: evaluatedCardCount,
      evaluated_field_count: evaluatedFieldCount,
      label_issue_count: labelIssues.length
    },
    metrics: {
      ai_card_exact_accuracy: metricBucket(cardExactCount, evaluatedCardCount),
      per_field_exact_accuracy: perFieldExactAccuracy,
      critical_risk_recall: {
        flagged_critical_error_count: flaggedCriticalErrorCount,
        total_critical_error_count: criticalErrorCount,
        rate: rate(flaggedCriticalErrorCount, criticalErrorCount)
      },
      unflagged_critical_error_rate: {
        unflagged_critical_error_count: unflaggedCriticalErrorCount,
        total_critical_error_count: criticalErrorCount,
        rate: rate(unflaggedCriticalErrorCount, criticalErrorCount)
      },
      unflagged_critical_error_per_evaluated_field_rate: {
        unflagged_critical_error_count: unflaggedCriticalErrorCount,
        evaluated_field_count: evaluatedFieldCount,
        rate: rate(unflaggedCriticalErrorCount, evaluatedFieldCount)
      },
      auxiliary: {
        parallel_exact_match: auxiliaryBucket(parallelExactCorrect, parallelExactTotal),
        parallel_narrow_match: auxiliaryBucket(parallelNarrowMatch, parallelNarrowTotal),
        parallel_color_match: auxiliaryBucket(parallelColorMatch, parallelColorTotal),
        serial_exact_match: auxiliaryBucket(serialExactCorrect, serialExactTotal),
        serial_denominator_match: auxiliaryBucket(serialDenominatorMatch, serialDenominatorTotal)
      }
    },
    label_issues: labelIssues,
    cards
  };
}

export async function readJson(path, label = "input") {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) throw new Error(`${label} not found: ${resolvedPath}`);
  return JSON.parse(await readFile(resolvedPath, "utf8"));
}

async function writeJson(path, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (!path) {
    process.stdout.write(text);
    return;
  }
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, text);
}

export function formatReviewedFieldAccuracySummary(report = {}) {
  const card = report.metrics?.ai_card_exact_accuracy || {};
  const risk = report.metrics?.critical_risk_recall || {};
  const unflagged = report.metrics?.unflagged_critical_error_rate || {};
  return [
    `status: ${report.status}`,
    `evaluated_cards: ${report.summary?.evaluated_card_count ?? 0}/${report.summary?.label_item_count ?? 0}`,
    `evaluated_fields: ${report.summary?.evaluated_field_count ?? 0}`,
    `ai_card_exact_accuracy: ${card.correct ?? 0}/${card.total ?? 0} (${card.rate ?? "n/a"})`,
    `critical_risk_recall: ${risk.flagged_critical_error_count ?? 0}/${risk.total_critical_error_count ?? 0} (${risk.rate ?? "n/a"})`,
    `unflagged_critical_error_rate: ${unflagged.unflagged_critical_error_count ?? 0}/${unflagged.total_critical_error_count ?? 0} (${unflagged.rate ?? "n/a"})`,
    "corrected_title_used_as_ground_truth: false",
    "commercial_heldout_acceptance_set: false"
  ].join("\n");
}

function usage() {
  return [
    "Usage:",
    "  node scripts/evaluate-reviewed-field-accuracy.mjs --labels <reviewed-labels.json> --predictions <provider-report.json> --out <report.json>",
    "",
    "Metrics:",
    "  - AI Card-Exact Accuracy",
    "  - Per-field Exact Accuracy",
    "  - Critical Risk Recall",
    "  - Unflagged Critical Error Rate"
  ].join("\n");
}

export async function main(argv = process.argv.slice(2), {
  now = () => new Date()
} = {}) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }

  const labelsPath = argValue(argv, "--labels", defaultLabels);
  const predictionsPath = argValue(argv, "--predictions", defaultPredictions);
  const out = argValue(argv, "--out", defaultOut);
  const requireReviewed = hasFlag(argv, "--require-reviewed");
  const labels = await readJson(labelsPath, "reviewed ground truth labels");
  const predictions = await readJson(predictionsPath, "provider predictions");
  const report = evaluateReviewedFieldAccuracy({
    labels,
    predictions,
    now
  });
  await writeJson(out, report);
  process.stdout.write(`${formatReviewedFieldAccuracySummary(report)}\n`);
  if (requireReviewed && report.status !== "completed") process.exitCode = 1;
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
