import crypto from "node:crypto";

export const releaseSetTypes = Object.freeze({
  CORE_HOLDOUT: "CORE_HOLDOUT",
  COLD_START_HOLDOUT: "COLD_START_HOLDOUT",
  PRODUCTION_REPLAY: "PRODUCTION_REPLAY"
});

export const releaseMetricIds = Object.freeze([
  "writer_first_pass_accept_rate",
  "critical_identity_error_rate",
  "core_field_exact_accuracy",
  "active_recognition_p95_ms",
  "cost_per_accepted_title"
]);

export const defaultReleaseCoreFields = Object.freeze([
  "year",
  "product",
  "set",
  "players",
  "card_name",
  "collector_number",
  "print_run_number",
  "grade_company",
  "card_grade"
]);

const setTypeValues = new Set(Object.values(releaseSetTypes));
const unknownValues = new Set(["", "UNKNOWN", "NOT_APPLICABLE", "N/A", "NULL"]);
const forbiddenRecognitionKeys = new Set([
  "corrected_title",
  "expected_title",
  "ground_truth",
  "hidden_ground_truth",
  "label",
  "listing_title",
  "marketplace_title",
  "reviewed_fields",
  "reviewed_ground_truth",
  "sealed_title",
  "seller_title",
  "writer_final_title"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stableItemIds(items = []) {
  return [...new Set(items.map((item) => cleanText(item?.item_id || item?.query_card_id)).filter(Boolean))].sort();
}

export function releaseSetItemSetSha256(items = []) {
  return crypto.createHash("sha256").update(stableItemIds(items).join("\n")).digest("hex");
}

function recognitionLeakPaths(value, path = "recognition_input") {
  if (!value || typeof value !== "object") return [];
  const leaks = [];
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = cleanText(key).toLowerCase();
    const childPath = `${path}.${key}`;
    if (forbiddenRecognitionKeys.has(normalizedKey)) leaks.push(childPath);
    if (child && typeof child === "object") leaks.push(...recognitionLeakPaths(child, childPath));
  }
  return leaks;
}

function reviewedFields(item = {}) {
  return plainObject(item.reviewed_ground_truth?.fields || item.reviewed_fields);
}

export function validateReleaseSetManifest(manifest = {}) {
  const errors = [];
  const warnings = [];
  const setType = cleanText(manifest.set_type).toUpperCase();
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const leakage = plainObject(manifest.leakage_policy);

  if (manifest.schema_version !== "release-set-v1") errors.push("schema_version must be release-set-v1");
  if (!cleanText(manifest.set_id)) errors.push("set_id is required");
  if (!setTypeValues.has(setType)) errors.push(`unsupported set_type: ${manifest.set_type || "missing"}`);
  if (!cleanText(manifest.version)) errors.push("version is required");
  if (!cleanText(manifest.frozen_at)) errors.push("frozen_at is required");
  if (!items.length) errors.push("items must not be empty");
  if (stableItemIds(items).length !== items.length) errors.push("item_id values must be present and unique");

  const computedSha256 = releaseSetItemSetSha256(items);
  if (!cleanText(manifest.item_set_sha256)) errors.push("item_set_sha256 is required");
  else if (cleanText(manifest.item_set_sha256) !== computedSha256) errors.push("item_set_sha256 does not match frozen items");

  if (leakage.exclude_from_training !== true) errors.push("release sets must be excluded from training");
  if (leakage.exclude_query_images_from_reference_index !== true) {
    errors.push("release query images must be excluded from the reference index");
  }
  if (leakage.exclude_from_catalog_promotion !== true) errors.push("release set rows must not be promoted into catalog truth");
  if (setType === releaseSetTypes.COLD_START_HOLDOUT && leakage.exclude_identity_from_catalog !== true) {
    errors.push("cold-start holdout must exclude the query identity from catalog candidates");
  }

  items.forEach((item, index) => {
    const itemId = cleanText(item?.item_id || item?.query_card_id) || `index_${index}`;
    const fields = reviewedFields(item);
    if (!Object.keys(fields).length) errors.push(`${itemId}: reviewed field ground truth is required`);
    const leaks = recognitionLeakPaths(item?.recognition_input || {});
    leaks.forEach((path) => errors.push(`${itemId}: sealed evaluation data leaked at ${path}`));
    if (!Array.isArray(item?.recognition_input?.images) || item.recognition_input.images.length < 1) {
      warnings.push(`${itemId}: recognition_input.images is empty`);
    }
  });

  return {
    ok: errors.length === 0,
    schema_version: "release-set-validation-v1",
    set_id: cleanText(manifest.set_id) || null,
    set_type: setType || null,
    version: cleanText(manifest.version) || null,
    item_count: items.length,
    item_set_sha256: computedSha256,
    errors,
    warnings
  };
}

export function assertReleaseSetManifest(manifest = {}) {
  const validation = validateReleaseSetManifest(manifest);
  if (!validation.ok) throw new Error(`Invalid release set: ${validation.errors.join("; ")}`);
  return validation;
}

function isApplicable(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return !unknownValues.has(cleanText(value).toUpperCase());
}

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable).filter(Boolean).sort().join("|");
  if (value && typeof value === "object") {
    return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${key}:${comparable(child)}`).join("|");
  }
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function percentile(values = [], quantile = 0.95) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function metric(value, numerator, denominator, unit) {
  return {
    value: denominator > 0 ? value : null,
    numerator,
    denominator,
    unit
  };
}

function firstPassAccepted(row = {}) {
  if (typeof row.writer_first_pass_accepted === "boolean") return row.writer_first_pass_accepted;
  return ["ACCEPTED_UNCHANGED", "APPROVED_UNCHANGED", "ACCEPT_UNCHANGED"]
    .includes(cleanText(row.writer_outcome || row.review_outcome).toUpperCase());
}

function finalTitleAccepted(row = {}) {
  if (typeof row.title_accepted === "boolean") return row.title_accepted;
  return [
    "ACCEPTED_UNCHANGED",
    "APPROVED_UNCHANGED",
    "ACCEPT_UNCHANGED",
    "CORRECTED_FIELDS",
    "EDITED_AND_ACCEPTED",
    "APPROVED_AFTER_EDIT"
  ].includes(cleanText(row.writer_outcome || row.review_outcome).toUpperCase());
}

function fieldsForRow(row = {}) {
  return {
    groundTruth: plainObject(row.reviewed_ground_truth?.fields || row.ground_truth || row.reviewed_fields),
    prediction: plainObject(row.prediction?.fields || row.predicted_fields || row.resolved_fields)
  };
}

export function summarizeReleaseMetrics(rows = [], {
  coreFields = defaultReleaseCoreFields
} = {}) {
  const items = Array.isArray(rows) ? rows : [];
  let firstPassCount = 0;
  let criticalErrorCardCount = 0;
  let criticalEvaluatedCardCount = 0;
  let correctFieldCount = 0;
  let applicableFieldCount = 0;
  let totalCost = 0;
  let observedCostCount = 0;
  const activeRecognitionValues = [];

  for (const row of items) {
    if (firstPassAccepted(row)) firstPassCount += 1;
    const { groundTruth, prediction } = fieldsForRow(row);
    const criticalFields = Array.isArray(row.critical_fields) && row.critical_fields.length
      ? row.critical_fields
      : coreFields;
    const applicableCriticalFields = criticalFields.filter((field) => isApplicable(groundTruth[field]));
    if (applicableCriticalFields.length) {
      criticalEvaluatedCardCount += 1;
      const explicitCriticalError = typeof row.critical_identity_error === "boolean"
        ? row.critical_identity_error
        : applicableCriticalFields.some((field) => comparable(groundTruth[field]) !== comparable(prediction[field]));
      if (explicitCriticalError) criticalErrorCardCount += 1;
    }
    for (const field of coreFields) {
      if (!isApplicable(groundTruth[field])) continue;
      applicableFieldCount += 1;
      if (comparable(groundTruth[field]) === comparable(prediction[field])) correctFieldCount += 1;
    }
    const activeMs = Number(row.active_recognition_ms ?? row.writer_visible_recognition_ms);
    if (Number.isFinite(activeMs) && activeMs >= 0) activeRecognitionValues.push(activeMs);
    const cost = Number(row.cost_usd ?? row.estimated_cost_usd);
    if (Number.isFinite(cost) && cost >= 0) {
      totalCost += cost;
      observedCostCount += 1;
    }
  }

  const acceptedCount = items.filter(finalTitleAccepted).length;
  return {
    schema_version: "release-metrics-v1",
    evaluated_card_count: items.length,
    metric_ids: releaseMetricIds,
    metrics: {
      writer_first_pass_accept_rate: metric(
        items.length ? firstPassCount / items.length : null,
        firstPassCount,
        items.length,
        "ratio"
      ),
      critical_identity_error_rate: metric(
        criticalEvaluatedCardCount ? criticalErrorCardCount / criticalEvaluatedCardCount : null,
        criticalErrorCardCount,
        criticalEvaluatedCardCount,
        "ratio"
      ),
      core_field_exact_accuracy: metric(
        applicableFieldCount ? correctFieldCount / applicableFieldCount : null,
        correctFieldCount,
        applicableFieldCount,
        "ratio"
      ),
      active_recognition_p95_ms: metric(
        percentile(activeRecognitionValues, 0.95),
        activeRecognitionValues.length,
        activeRecognitionValues.length,
        "milliseconds"
      ),
      cost_per_accepted_title: metric(
        acceptedCount > 0 && observedCostCount === items.length ? totalCost / acceptedCount : null,
        Number(totalCost.toFixed(8)),
        acceptedCount,
        "usd_per_title"
      )
    },
    diagnostics: {
      accepted_title_count: acceptedCount,
      observed_cost_card_count: observedCostCount,
      cost_coverage_complete: items.length > 0 && observedCostCount === items.length,
      active_recognition_observation_count: activeRecognitionValues.length
    }
  };
}
