import { recognitionFieldAccuracy, recognitionMetricFields } from "./recognition-dataset.mjs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return value.map(normalizeComparable).filter(Boolean).sort().join("|");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== undefined && value !== null && value !== "";
}

function predictionFields(item = {}) {
  return item.prediction?.resolved_fields || item.prediction?.resolved || {};
}

function criticalFields(item = {}) {
  return Array.isArray(item.critical_fields) ? item.critical_fields : [];
}

function exactCriticalMatch(item = {}) {
  const fields = criticalFields(item);
  if (!fields.length || !isPlainObject(item.prediction)) return false;
  return fields.every((field) => normalizeComparable(predictionFields(item)[field]) === normalizeComparable(item.ground_truth?.[field]));
}

function route(item = {}) {
  return String(item.prediction?.route || "").toUpperCase();
}

function failedTechnical(item = {}) {
  return item.prediction?.technical_failure === true || route(item) === "FAILED_TECHNICAL";
}

function nonStandardManual(item = {}) {
  return route(item) === "NON_STANDARD_MANUAL";
}

function targetedRescanUnrecovered(item = {}) {
  return route(item) === "TARGETED_RESCAN_REQUIRED";
}

function providerFailure(item = {}) {
  return item.prediction?.provider_failure === true;
}

function ocrFailure(item = {}) {
  return item.prediction?.ocr_failure === true;
}

function retrievalFailure(item = {}) {
  return item.prediction?.retrieval_failure === true;
}

function aiComplete(item = {}) {
  return ["AI_COMPLETE", "AI_COMPLETE_REVIEW"].includes(route(item));
}

function humanCritical(item = {}) {
  return item.prediction?.human_authored_critical_resolution === true || nonStandardManual(item);
}

function acceptedCriticalError(item = {}) {
  return item.prediction?.accepted_critical_error === true;
}

function falseAiComplete(item = {}) {
  return aiComplete(item) && !exactCriticalMatch(item);
}

function numeric(values = []) {
  return values.map(Number).filter((value) => Number.isFinite(value));
}

function percentile(values = [], p) {
  const sorted = numeric(values).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return { low: null, high: null };
  const phat = successes / total;
  const denom = 1 + (z ** 2) / total;
  const center = phat + (z ** 2) / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z ** 2) / (4 * total)) / total);
  return {
    low: Math.max(0, (center - margin) / denom),
    high: Math.min(1, (center + margin) / denom)
  };
}

function groupBy(items = [], keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || "unknown";
    acc[key] ||= [];
    acc[key].push(item);
    return acc;
  }, {});
}

function evaluateGroup(items = []) {
  const total = items.length;
  const exact = items.filter(exactCriticalMatch).length;
  const aiCompleteItems = items.filter(aiComplete);
  const aiCompleteExact = aiCompleteItems.filter(exactCriticalMatch).length;
  const latencies = items.map((item) => item.prediction?.latency_ms);
  const providerCalls = items.map((item) => item.prediction?.provider_calls);
  const retrievalCalls = items.map((item) => item.prediction?.retrieval_calls ?? item.prediction?.retrieval_rounds);
  const cost = items.map((item) => item.prediction?.cost_usd ?? item.prediction?.cost_per_asset);
  const top1 = items.filter((item) => item.prediction?.candidate_top1_correct === true).length;
  const top5 = items.filter((item) => item.prediction?.candidate_top5_contains_truth === true).length;
  const topKDenom = items.filter((item) => item.prediction?.candidate_top1_correct !== undefined || item.prediction?.candidate_top5_contains_truth !== undefined).length;

  return {
    total_assets: total,
    ai_overall_exact_resolution_rate: ratio(exact, total),
    card_level_exact_accuracy: ratio(exact, total),
    field_level_accuracy: recognitionFieldAccuracy(items),
    human_authored_critical_resolution_rate: ratio(items.filter(humanCritical).length, total),
    accepted_critical_error_rate: ratio(items.filter(acceptedCriticalError).length, total),
    false_ai_complete_rate: ratio(items.filter(falseAiComplete).length, total),
    ai_complete_precision: ratio(aiCompleteExact, aiCompleteItems.length),
    targeted_rescan_recovery_rate: ratio(items.filter((item) => item.prediction?.targeted_rescan_recovered === true).length, items.filter((item) => item.prediction?.targeted_rescan_attempted === true).length),
    glare_recovery_rate: ratio(items.filter((item) => item.prediction?.glare_recovered === true).length, items.filter((item) => item.difficulty_tags?.includes("glare")).length),
    ocr_exact_accuracy: metricFieldAccuracy(items, ["ocr_text", "ocr_evidence_exact"]),
    serial_exact_accuracy: exactFieldAccuracy(items, "serial_number"),
    checklist_code_exact_accuracy: exactFieldAccuracy(items, "checklist_code"),
    collector_number_exact_accuracy: exactFieldAccuracy(items, "collector_number"),
    grade_exact_accuracy: gradeAccuracy(items),
    parallel_exact_accuracy: exactFieldAccuracy(items, "parallel"),
    candidate_top1_accuracy: ratio(top1, topKDenom),
    candidate_top5_recall: ratio(top5, topKDenom),
    latency_ms: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99)
    },
    cost_per_asset: average(cost),
    provider_calls_per_asset: average(providerCalls),
    retrieval_calls_per_asset: average(retrievalCalls),
    denominator_includes: {
      failed_technical: items.filter(failedTechnical).length,
      non_standard_manual: items.filter(nonStandardManual).length,
      targeted_rescan_unrecovered: items.filter(targetedRescanUnrecovered).length,
      provider_failure: items.filter(providerFailure).length,
      ocr_failure: items.filter(ocrFailure).length,
      retrieval_failure: items.filter(retrievalFailure).length
    },
    ci95: {
      ai_overall_exact_resolution_rate: wilsonInterval(exact, total),
      accepted_critical_error_rate: wilsonInterval(items.filter(acceptedCriticalError).length, total),
      ai_complete_precision: wilsonInterval(aiCompleteExact, aiCompleteItems.length)
    }
  };
}

function average(values = []) {
  const nums = numeric(values);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function metricFieldAccuracy(items = [], predictionKeys = []) {
  const scored = items.filter((item) => predictionKeys.some((key) => item.prediction?.[key] !== undefined));
  const exact = scored.filter((item) => predictionKeys.some((key) => item.prediction?.[key] === true)).length;
  return ratio(exact, scored.length);
}

function exactFieldAccuracy(items = [], field) {
  const applicable = items.filter((item) => valuePresent(item.ground_truth?.[field]));
  const exact = applicable.filter((item) => normalizeComparable(predictionFields(item)[field]) === normalizeComparable(item.ground_truth[field])).length;
  return ratio(exact, applicable.length);
}

function gradeAccuracy(items = []) {
  const fields = ["grade_company", "card_grade", "auto_grade", "grade_type"];
  const applicable = items.filter((item) => fields.some((field) => valuePresent(item.ground_truth?.[field])));
  const exact = applicable.filter((item) => fields.every((field) => !valuePresent(item.ground_truth?.[field]) || normalizeComparable(predictionFields(item)[field]) === normalizeComparable(item.ground_truth[field]))).length;
  return ratio(exact, applicable.length);
}

function breakdowns(items = []) {
  const byCategory = groupBy(items, (item) => item.category);
  const byProduct = groupBy(items, (item) => item.ground_truth?.product);
  const byYear = groupBy(items, (item) => item.ground_truth?.year);
  const bySlab = groupBy(items, (item) => item.difficulty_tags?.includes("slab") ? "slab" : "raw");
  const bySerial = groupBy(items, (item) => valuePresent(item.ground_truth?.serial_number) ? "serial" : "no_serial");
  const byComplexParallel = groupBy(items, (item) => item.difficulty_tags?.includes("complex_parallel") ? "complex_parallel" : "not_complex_parallel");
  const byGlare = groupBy(items, (item) => item.difficulty_tags?.includes("glare") ? "glare" : "no_glare");
  const byDifficulty = {};

  items.forEach((item) => {
    (item.difficulty_tags || ["untagged"]).forEach((tag) => {
      byDifficulty[tag] ||= [];
      byDifficulty[tag].push(item);
    });
  });

  const evaluateMap = (map) => Object.fromEntries(Object.entries(map).map(([key, group]) => [key, evaluateGroup(group)]));

  return {
    by_category: evaluateMap(byCategory),
    by_product: evaluateMap(byProduct),
    by_year: evaluateMap(byYear),
    by_field: fieldBreakdown(items),
    by_difficulty_tag: evaluateMap(byDifficulty),
    by_glare: evaluateMap(byGlare),
    by_slab: evaluateMap(bySlab),
    by_serial: evaluateMap(bySerial),
    by_complex_parallel: evaluateMap(byComplexParallel)
  };
}

function fieldBreakdown(items = []) {
  const fieldAccuracy = recognitionFieldAccuracy(items);
  return Object.fromEntries(recognitionMetricFields.map((field) => [field, fieldAccuracy[field] || { correct: 0, total: 0, accuracy: null }]));
}

export function evaluateRecognitionDataset(items = [], {
  variant = "current"
} = {}) {
  return {
    evaluation_version: "recognition-eval-v1",
    variant,
    generated_at: new Date().toISOString(),
    overall: evaluateGroup(items),
    breakdowns: breakdowns(items)
  };
}

export function evaluateRecognitionAblation(variantRuns = {}) {
  return {
    evaluation_version: "recognition-ablation-v1",
    generated_at: new Date().toISOString(),
    variants: Object.fromEntries(Object.entries(variantRuns).map(([variant, items]) => [
      variant,
      evaluateRecognitionDataset(items, { variant }).overall
    ]))
  };
}
