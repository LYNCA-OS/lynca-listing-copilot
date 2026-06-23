import { evaluateTitleAcceptance } from "./title-acceptance-policy.mjs";

export const goldenDatasetSchemaVersion = "golden-dataset-v1";

export const requiredSplits = [
  "development",
  "calibration",
  "held_out_commercial"
];

export const commercialMetricCriticalFields = [
  "player",
  "players",
  "character",
  "year",
  "season",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "card_type",
  "insert",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "rc",
  "first_bowman",
  "auto",
  "patch",
  "relic",
  "ssp",
  "case_hit",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "final_title_required_fields",
  "final_title_unsubstantiated_fields"
];

export const commercialAcceptanceDefaults = Object.freeze({
  minimum_held_out_assets: 100,
  required_strata: [
    "glare",
    "serial",
    "front_only",
    "front_back",
    "non_standard"
  ],
  thresholds: {
    ai_overall_exact_resolution_rate: { operator: ">=", value: 0.95 },
    human_authored_critical_resolution_rate: { operator: "<=", value: 0.05 },
    accepted_critical_error_rate: { operator: "<=", value: 0.005 },
    ai_complete_result_precision: { operator: ">=", value: 0.99 }
  }
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableValue).join("|");
  }

  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function predictionFields(prediction = {}) {
  return prediction.resolved_fields || prediction.resolved || prediction.fields || {};
}

function predictionTitle(prediction = {}) {
  return prediction.final_title || prediction.title || prediction.rendered_title || "";
}

function finalApprovedFields(prediction = {}) {
  return prediction.corrected_resolved_fields
    || prediction.final_resolved_fields
    || prediction.corrected_fields
    || predictionFields(prediction);
}

function hasPrediction(item) {
  return isPlainObject(item.prediction);
}

function titleAcceptanceForPrediction(item, {
  finalApproved = false
} = {}) {
  if (!hasPrediction(item)) {
    return {
      accepted: false,
      required_fields_present: false,
      unsubstantiated_critical_errors: true,
      missing_required_fields: [],
      critical_errors: [{ field: "title", type: "missing_prediction" }]
    };
  }

  const predictedFields = finalApproved ? finalApprovedFields(item.prediction) : predictionFields(item.prediction);
  const title = finalApproved
    ? (item.prediction.corrected_title || item.prediction.final_title || item.prediction.title || "")
    : predictionTitle(item.prediction);

  return evaluateTitleAcceptance({
    title,
    groundTruthFields: item.ground_truth_fields || {},
    predictedFields,
    criticalFields: itemCriticalFields(item)
  });
}

function criticalFieldMatches(item, field) {
  if (field === "final_title_required_fields") {
    return titleAcceptanceForPrediction(item).required_fields_present === (item.ground_truth_fields?.[field] !== false);
  }
  if (field === "final_title_unsubstantiated_fields") {
    return titleAcceptanceForPrediction(item).unsubstantiated_critical_errors === (item.ground_truth_fields?.[field] === true);
  }
  const expected = normalizeComparableValue(item.ground_truth_fields?.[field]);
  const actual = normalizeComparableValue(predictionFields(item.prediction)[field]);
  return expected === actual;
}

function finalCriticalFieldMatches(item, field) {
  if (field === "final_title_required_fields") {
    return titleAcceptanceForPrediction(item, { finalApproved: true }).required_fields_present === (item.ground_truth_fields?.[field] !== false);
  }
  if (field === "final_title_unsubstantiated_fields") {
    return titleAcceptanceForPrediction(item, { finalApproved: true }).unsubstantiated_critical_errors === (item.ground_truth_fields?.[field] === true);
  }
  const expected = normalizeComparableValue(item.ground_truth_fields?.[field]);
  const actual = normalizeComparableValue(finalApprovedFields(item.prediction)[field]);
  return expected === actual;
}

function itemCriticalFields(item) {
  return Array.isArray(item.critical_fields) ? item.critical_fields : [];
}

function itemIsExact(item) {
  if (!hasPrediction(item)) return false;
  const fields = itemCriticalFields(item);
  if (!fields.length) return false;
  return fields.every((field) => criticalFieldMatches(item, field));
}

function itemFinalApprovedExact(item) {
  if (!hasPrediction(item)) return false;
  const fields = itemCriticalFields(item);
  if (!fields.length) return false;
  return fields.every((field) => finalCriticalFieldMatches(item, field));
}

function predictedAiComplete(item) {
  const route = String(item.prediction?.route || "").toUpperCase();
  return route === "AI_COMPLETE_REVIEW" || route === "AI_COMPLETE";
}

function needsHumanCriticalResolution(item) {
  if (typeof item.prediction?.human_authored_critical_resolution === "boolean") {
    return item.prediction.human_authored_critical_resolution;
  }

  const outcome = String(item.prediction?.review_outcome || "").toUpperCase();
  const route = String(item.prediction?.route || "").toUpperCase();

  return [
    "CORRECTED_FIELDS",
    "NON_STANDARD_MANUAL"
  ].includes(outcome) || [
    "NON_STANDARD_MANUAL"
  ].includes(route);
}

function acceptedCriticalError(item) {
  return item.prediction?.accepted_critical_error === true;
}

function technicalFailure(item) {
  return item.prediction?.technical_failure === true
    || String(item.prediction?.route || "").toUpperCase() === "FAILED_TECHNICAL"
    || String(item.prediction?.review_outcome || "").toUpperCase() === "TECHNICAL_FAILURE";
}

function routeMatches(item) {
  if (!hasPrediction(item)) return false;
  return String(item.ground_truth_route || "").toUpperCase() === String(item.prediction?.route || "").toUpperCase();
}

function nonStandardRoute(value) {
  return String(value || "").toUpperCase() === "NON_STANDARD_MANUAL";
}

function safeRate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function roundMetric(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) {
    return {
      method: "wilson_score",
      confidence_level: 0.95,
      successes,
      total,
      rate: null,
      lower: null,
      upper: null
    };
  }

  const rate = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const center = (rate + zSquared / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((rate * (1 - rate) / total) + (zSquared / (4 * total * total)));

  return {
    method: "wilson_score",
    confidence_level: 0.95,
    successes,
    total,
    rate: roundMetric(rate),
    lower: roundMetric(Math.max(0, center - margin)),
    upper: roundMetric(Math.min(1, center + margin))
  };
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function sum(values) {
  return values.map(Number).filter(Number.isFinite).reduce((total, value) => total + value, 0);
}

function predictionUsage(item) {
  return isPlainObject(item.prediction?.usage) ? item.prediction.usage : {};
}

function usageNumber(item, keys = []) {
  const usage = predictionUsage(item);
  for (const key of keys) {
    const value = Number(usage[key] ?? item.prediction?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function predictionRecovery(item) {
  return isPlainObject(item.prediction?.recovery) ? item.prediction.recovery : {};
}

function predictionRetrieval(item) {
  return isPlainObject(item.prediction?.retrieval) ? item.prediction.retrieval : {};
}

function boolFromAny(values = []) {
  return values.some((value) => value === true || String(value || "").toLowerCase() === "true");
}

function reviewOutcome(item) {
  return String(item.prediction?.review_outcome || "").toUpperCase();
}

function routeValue(item) {
  return String(item.prediction?.route || "").toUpperCase();
}

const approvedReviewOutcomes = new Set([
  "ACCEPTED_UNCHANGED",
  "CORRECTED_FIELDS",
  "TITLE_ONLY_OVERRIDE",
  "TARGETED_RESCAN_RECOVERED"
]);

function isFinalApprovedPublishCandidate(item) {
  if (!hasPrediction(item)) return false;
  const reviewStatus = String(item.prediction?.review_status || "").toUpperCase();
  const publishStatus = String(item.prediction?.publish_status || "").toUpperCase();

  return approvedReviewOutcomes.has(reviewOutcome(item))
    || reviewStatus === "APPROVED"
    || publishStatus === "READY"
    || publishStatus === "PUBLISHED"
    || item.prediction?.approved === true
    || Boolean(item.prediction?.approved_at);
}

function hasTag(item, tag) {
  return [...(item.difficulty_tags || []), ...(item.capture_tags || [])]
    .map((value) => String(value || "").toLowerCase())
    .includes(tag);
}

function recoveryMetric(items, {
  attemptedKeys = [],
  recoveredKeys = [],
  attemptedWhen = () => false,
  recoveredWhen = () => false
} = {}) {
  const attemptedItems = items.filter((item) => {
    const recovery = predictionRecovery(item);
    return boolFromAny(attemptedKeys.map((key) => recovery[key] ?? item.prediction?.[key]))
      || attemptedWhen(item);
  });
  const recoveredItems = attemptedItems.filter((item) => {
    const recovery = predictionRecovery(item);
    return boolFromAny(recoveredKeys.map((key) => recovery[key] ?? item.prediction?.[key]))
      || recoveredWhen(item);
  });

  return {
    attempted_assets: attemptedItems.length,
    recovered_assets: recoveredItems.length,
    rate: safeRate(recoveredItems.length, attemptedItems.length)
  };
}

function recoveryMetrics(items) {
  return {
    retrieval_recovery_rate: recoveryMetric(items, {
      attemptedKeys: ["retrieval_attempted"],
      recoveredKeys: ["retrieval_recovered"]
    }),
    focused_reread_recovery_rate: recoveryMetric(items, {
      attemptedKeys: ["focused_reread_attempted", "focused_re_read_attempted"],
      recoveredKeys: ["focused_reread_recovered", "focused_re_read_recovered"]
    }),
    targeted_rescan_recovery_rate: recoveryMetric(items, {
      attemptedKeys: ["targeted_rescan_attempted"],
      recoveredKeys: ["targeted_rescan_recovered"],
      attemptedWhen: (item) => routeValue(item) === "TARGETED_RESCAN_REQUIRED" || reviewOutcome(item) === "TARGETED_RESCAN_RECOVERED",
      recoveredWhen: (item) => reviewOutcome(item) === "TARGETED_RESCAN_RECOVERED"
    }),
    glare_recovery_rate: recoveryMetric(items, {
      attemptedKeys: ["glare_attempted"],
      recoveredKeys: ["glare_recovered"],
      attemptedWhen: (item) => hasTag(item, "glare"),
      recoveredWhen: (item) => predictionRecovery(item).glare_recovered === true
        || (hasTag(item, "glare") && reviewOutcome(item) === "TARGETED_RESCAN_RECOVERED")
    })
  };
}

function recoveryConfidenceIntervals(metrics = {}) {
  return Object.fromEntries(Object.entries(metrics).map(([metricName, metric]) => [
    metricName,
    wilsonInterval(metric.recovered_assets || 0, metric.attempted_assets || 0)
  ]));
}

const retrievalProviderMetricSpecs = Object.freeze([
  {
    id: "brave",
    aliases: ["brave", "brave_search"],
    attemptedKeys: ["brave_attempted", "brave_search_attempted"],
    recoveredKeys: ["brave_recovered", "brave_search_recovered"],
    referenceKeys: ["brave_reference_helped", "brave_search_reference_helped"]
  },
  {
    id: "ebay_browse",
    aliases: ["ebay", "ebay_browse"],
    attemptedKeys: ["ebay_attempted", "ebay_browse_attempted", "ebay_reference_used", "ebay_browse_reference_used"],
    recoveredKeys: ["ebay_recovered", "ebay_browse_recovered"],
    referenceKeys: ["ebay_reference_helped", "ebay_browse_reference_helped"]
  },
  {
    id: "openai_web_search",
    aliases: ["ows", "openai_web_search", "openai_web_search_fallback"],
    attemptedKeys: ["ows_attempted", "openai_web_search_attempted", "openai_web_search_fallback_attempted"],
    recoveredKeys: ["ows_recovered", "openai_web_search_recovered", "openai_web_search_fallback_recovered"],
    referenceKeys: ["ows_reference_helped", "openai_web_search_reference_helped"]
  }
]);

function normalizeProviderId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (["brave", "brave_search"].includes(normalized)) return "brave";
  if (["ebay", "ebay_browse"].includes(normalized)) return "ebay_browse";
  if (["ows", "openai_web_search", "openai_web_search_fallback"].includes(normalized)) return "openai_web_search";
  return normalized;
}

function arrayFromAny(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function providerIdFromEntry(entry) {
  if (typeof entry === "string") return entry;
  if (!isPlainObject(entry)) return "";
  return entry.provider_id || entry.providerId || entry.provider || entry.id || "";
}

function collectProviderIds(item, keys = [], { includeActivity = false } = {}) {
  const retrieval = predictionRetrieval(item);
  const providerIds = [];

  keys.forEach((key) => {
    arrayFromAny(retrieval[key]).forEach((entry) => providerIds.push(providerIdFromEntry(entry)));
    arrayFromAny(item.prediction?.[key]).forEach((entry) => providerIds.push(providerIdFromEntry(entry)));
  });

  if (includeActivity) {
    arrayFromAny(retrieval.queries).forEach((entry) => providerIds.push(providerIdFromEntry(entry)));
    arrayFromAny(retrieval.sources).forEach((entry) => providerIds.push(providerIdFromEntry(entry)));
    arrayFromAny(retrieval.trace).forEach((entry) => providerIds.push(providerIdFromEntry(entry)));
  }

  return new Set(providerIds.map(normalizeProviderId).filter(Boolean));
}

function providerSetIncludes(providerSet, spec) {
  return spec.aliases.some((alias) => providerSet.has(normalizeProviderId(alias)));
}

function recoveryKeyEnabled(item, keys) {
  const recovery = predictionRecovery(item);
  return boolFromAny(keys.map((key) => recovery[key] ?? item.prediction?.[key]));
}

function retrievalProviderGains(items, totalAssets) {
  return Object.fromEntries(retrievalProviderMetricSpecs.map((spec) => {
    const usedProviderIds = (item) => collectProviderIds(item, ["providers_used"], { includeActivity: true });
    const recoveredProviderIds = (item) => collectProviderIds(item, ["providers_recovered", "recovered_providers"]);
    const referenceProviderIds = (item) => collectProviderIds(item, ["reference_helped", "reference_providers", "reference_helped_providers"]);

    const usedItems = items.filter((item) => {
      return providerSetIncludes(usedProviderIds(item), spec) || recoveryKeyEnabled(item, spec.attemptedKeys);
    });
    const recoveredItems = usedItems.filter((item) => {
      return providerSetIncludes(recoveredProviderIds(item), spec) || recoveryKeyEnabled(item, spec.recoveredKeys);
    });
    const referenceHelpedItems = usedItems.filter((item) => {
      return providerSetIncludes(referenceProviderIds(item), spec) || recoveryKeyEnabled(item, spec.referenceKeys);
    });
    const exactItems = usedItems.filter(itemIsExact);

    return [
      spec.id,
      {
        used_assets: usedItems.length,
        recovered_assets: recoveredItems.length,
        reference_helped_assets: referenceHelpedItems.length,
        exact_assets_when_used: exactItems.length,
        usage_rate: safeRate(usedItems.length, totalAssets),
        recovery_rate: safeRate(recoveredItems.length, usedItems.length),
        reference_helped_rate: safeRate(referenceHelpedItems.length, usedItems.length),
        exact_when_used_rate: safeRate(exactItems.length, usedItems.length),
        sample_asset_ids: usedItems.slice(0, 5).map((item) => item.asset_id)
      }
    ];
  }));
}

function predictionProviderId(item) {
  return String(item.prediction?.provider || "").trim() || "no_prediction";
}

function visionProviderMetrics(items) {
  const providerIds = new Set(items.map(predictionProviderId));
  const providers = {};

  providerIds.forEach((providerId) => {
    const providerItems = items.filter((item) => predictionProviderId(item) === providerId);
    const exactItems = providerItems.filter(itemIsExact);
    const aiCompleteItems = providerItems.filter((item) => hasPrediction(item) && predictedAiComplete(item));
    const aiCompleteExactItems = aiCompleteItems.filter(itemIsExact);
    const technicalFailureItems = providerItems.filter((item) => hasPrediction(item) && technicalFailure(item));
    const acceptedCriticalErrorItems = providerItems.filter((item) => hasPrediction(item) && acceptedCriticalError(item));
    const costs = providerItems.map((item) => usageNumber(item, ["estimated_cost_usd", "cost_usd"]));

    providers[providerId] = {
      total_assets: providerItems.length,
      exact_assets: exactItems.length,
      exact_rate: safeRate(exactItems.length, providerItems.length),
      ai_complete_assets: aiCompleteItems.length,
      ai_complete_exact_assets: aiCompleteExactItems.length,
      ai_complete_precision: safeRate(aiCompleteExactItems.length, aiCompleteItems.length),
      false_ai_complete_assets: aiCompleteItems.length - aiCompleteExactItems.length,
      technical_failure_assets: technicalFailureItems.length,
      technical_failure_rate: safeRate(technicalFailureItems.length, providerItems.length),
      accepted_critical_error_assets: acceptedCriticalErrorItems.length,
      accepted_critical_error_rate: safeRate(acceptedCriticalErrorItems.length, providerItems.length),
      average_provider_calls: average(providerItems.map((item) => usageNumber(item, ["provider_calls"]))),
      average_latency_ms: average(providerItems.map((item) => usageNumber(item, ["latency_ms"]))),
      cost_per_asset: providerItems.length ? Number((sum(costs) / providerItems.length).toFixed(6)) : null
    };
  });

  const delta = (left, right) => {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return left - right;
  };
  const agnes = providers.agnes || {};
  const openaiLegacy = providers.openai_legacy || {};

  return {
    providers,
    agnes_vs_openai_legacy: {
      exact_rate_delta: delta(agnes.exact_rate, openaiLegacy.exact_rate),
      ai_complete_precision_delta: delta(agnes.ai_complete_precision, openaiLegacy.ai_complete_precision),
      technical_failure_rate_delta: delta(agnes.technical_failure_rate, openaiLegacy.technical_failure_rate),
      accepted_critical_error_rate_delta: delta(agnes.accepted_critical_error_rate, openaiLegacy.accepted_critical_error_rate)
    }
  };
}

function finalApprovedPublishMetrics(items) {
  const approvedItems = items.filter(isFinalApprovedPublishCandidate);
  const exactItems = approvedItems.filter(itemFinalApprovedExact);
  const errorItems = approvedItems.filter((item) => !itemFinalApprovedExact(item));

  return {
    approved_assets: approvedItems.length,
    final_exact_assets: exactItems.length,
    error_assets: errorItems.length,
    rate: safeRate(exactItems.length, approvedItems.length),
    sample_error_asset_ids: errorItems.slice(0, 5).map((item) => item.asset_id)
  };
}

function glareImpactMetrics(items, totalAssets, recovery = {}, finalApproved = {}) {
  const glareItems = items.filter((item) => hasTag(item, "glare"));
  const nonGlareItems = items.filter((item) => !hasTag(item, "glare"));
  const glareExactItems = glareItems.filter(itemIsExact);
  const nonGlareExactItems = nonGlareItems.filter(itemIsExact);
  const glareAiCompleteItems = glareItems.filter((item) => hasPrediction(item) && predictedAiComplete(item));
  const glareAiCompleteExactItems = glareAiCompleteItems.filter(itemIsExact);
  const glareFinalApprovedItems = glareItems.filter(isFinalApprovedPublishCandidate);
  const glareFinalApprovedExactItems = glareFinalApprovedItems.filter(itemFinalApprovedExact);
  const glareRecovery = recovery.glare_recovery_rate || {};

  const glareExactRate = safeRate(glareExactItems.length, glareItems.length);
  const nonGlareExactRate = safeRate(nonGlareExactItems.length, nonGlareItems.length);
  const exactRateDelta = Number.isFinite(glareExactRate) && Number.isFinite(nonGlareExactRate)
    ? glareExactRate - nonGlareExactRate
    : null;

  return {
    glare_assets: glareItems.length,
    non_glare_assets: nonGlareItems.length,
    glare_asset_rate: safeRate(glareItems.length, totalAssets),
    exact_assets: glareExactItems.length,
    exact_rate: glareExactRate,
    non_glare_exact_rate: nonGlareExactRate,
    exact_rate_delta_vs_non_glare: exactRateDelta,
    ai_complete_assets: glareAiCompleteItems.length,
    ai_complete_exact_assets: glareAiCompleteExactItems.length,
    ai_complete_precision: safeRate(glareAiCompleteExactItems.length, glareAiCompleteItems.length),
    human_critical_resolution_assets: glareItems.filter((item) => hasPrediction(item) && needsHumanCriticalResolution(item)).length,
    human_critical_resolution_rate: safeRate(glareItems.filter((item) => hasPrediction(item) && needsHumanCriticalResolution(item)).length, glareItems.length),
    accepted_critical_error_assets: glareItems.filter((item) => hasPrediction(item) && acceptedCriticalError(item)).length,
    accepted_critical_error_rate: safeRate(glareItems.filter((item) => hasPrediction(item) && acceptedCriticalError(item)).length, glareItems.length),
    technical_failure_assets: glareItems.filter((item) => hasPrediction(item) && technicalFailure(item)).length,
    technical_failure_rate: safeRate(glareItems.filter((item) => hasPrediction(item) && technicalFailure(item)).length, glareItems.length),
    targeted_rescan_required_assets: glareItems.filter((item) => routeValue(item) === "TARGETED_RESCAN_REQUIRED").length,
    recovery_attempted_assets: glareRecovery.attempted_assets || 0,
    recovered_assets: glareRecovery.recovered_assets || 0,
    recovery_rate: glareRecovery.rate ?? null,
    final_approved_assets: glareFinalApprovedItems.length,
    final_approved_exact_assets: glareFinalApprovedExactItems.length,
    final_approved_publish_accuracy: safeRate(glareFinalApprovedExactItems.length, glareFinalApprovedItems.length),
    overall_final_approved_publish_accuracy: finalApproved.rate ?? null,
    sample_asset_ids: glareItems.slice(0, 5).map((item) => item.asset_id)
  };
}

function predictionFieldChanges(item) {
  return Array.isArray(item.prediction?.field_changes) ? item.prediction.field_changes : [];
}

function explicitFailureRootCauses(item) {
  const causes = item.prediction?.failure_root_causes || item.prediction?.failureRootCauses || item.prediction?.failure_root_cause;
  const values = Array.isArray(causes) ? causes : [causes];
  return values
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

function predictionFieldMissing(item, field) {
  if (!hasPrediction(item)) return true;
  const value = predictionFields(item.prediction)[field];
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || value === "";
}

function addFailureMetric(target, cause, item, totalAssets) {
  if (!cause) return;
  if (!target[cause]) {
    target[cause] = {
      assets: 0,
      asset_rate: null,
      sample_asset_ids: []
    };
  }

  target[cause].assets += 1;
  if (target[cause].sample_asset_ids.length < 5) target[cause].sample_asset_ids.push(item.asset_id);
  target[cause].asset_rate = safeRate(target[cause].assets, totalAssets);
}

function failureRootCauses(items, totalAssets) {
  const causes = {};

  items.forEach((item) => {
    const exact = itemIsExact(item);
    const itemCauses = new Set(explicitFailureRootCauses(item));

    if (!hasPrediction(item)) itemCauses.add("no_prediction");
    if (technicalFailure(item)) itemCauses.add("technical_failure");
    if (needsHumanCriticalResolution(item)) itemCauses.add("human_critical_resolution");
    if (acceptedCriticalError(item)) itemCauses.add("accepted_critical_error");
    if (predictedAiComplete(item) && !exact) itemCauses.add("false_ai_complete");
    if (hasPrediction(item) && !routeMatches(item)) itemCauses.add("route_mismatch");
    if (routeValue(item) === "TARGETED_RESCAN_REQUIRED") itemCauses.add("unresolved_targeted_rescan");
    if (nonStandardRoute(item.prediction?.route) || reviewOutcome(item) === "NON_STANDARD_MANUAL") itemCauses.add("non_standard_manual");
    if (hasTag(item, "glare") && !exact) itemCauses.add("glare_related_error");
    if (!exact && itemCriticalFields(item).some((field) => !criticalFieldMatches(item, field))) itemCauses.add("critical_field_mismatch");
    if (!exact && itemCauses.size === 0) itemCauses.add("unclassified_failure");

    itemCauses.forEach((cause) => addFailureMetric(causes, cause, item, totalAssets));
  });

  return Object.fromEntries(Object.entries(causes).sort(([leftKey, leftMetric], [rightKey, rightMetric]) => {
    const countDelta = rightMetric.assets - leftMetric.assets;
    if (countDelta !== 0) return countDelta;
    return leftKey.localeCompare(rightKey);
  }));
}

function fieldErrorDistribution(items) {
  const result = {};

  items.forEach((item) => {
    itemCriticalFields(item).forEach((field) => {
      if (!result[field]) {
        result[field] = {
          total: 0,
          correct: 0,
          incorrect: 0,
          missing_prediction: 0,
          error_rate: null,
          sample_asset_ids: []
        };
      }

      const metric = result[field];
      metric.total += 1;

      if (hasPrediction(item) && criticalFieldMatches(item, field)) {
        metric.correct += 1;
        return;
      }

      metric.incorrect += 1;
      if (predictionFieldMissing(item, field)) metric.missing_prediction += 1;
      if (metric.sample_asset_ids.length < 5) metric.sample_asset_ids.push(item.asset_id);
    });
  });

  Object.values(result).forEach((metric) => {
    metric.error_rate = safeRate(metric.incorrect, metric.total);
  });

  return Object.fromEntries(Object.entries(result).sort(([leftKey, leftMetric], [rightKey, rightMetric]) => {
    const errorDelta = rightMetric.incorrect - leftMetric.incorrect;
    if (errorDelta !== 0) return errorDelta;
    const totalDelta = rightMetric.total - leftMetric.total;
    if (totalDelta !== 0) return totalDelta;
    return leftKey.localeCompare(rightKey);
  }));
}

function correctionRateByField(items, totalAssets) {
  const result = {};
  items.forEach((item) => {
    predictionFieldChanges(item).forEach((change) => {
      const field = String(change?.field || "").trim();
      if (!field) return;
      if (!result[field]) {
        result[field] = {
          corrections: 0,
          critical_field_denominator: 0,
          rate: null,
          asset_rate: null
        };
      }
      result[field].corrections += 1;
    });

    itemCriticalFields(item).forEach((field) => {
      if (!result[field]) {
        result[field] = {
          corrections: 0,
          critical_field_denominator: 0,
          rate: null,
          asset_rate: null
        };
      }
      result[field].critical_field_denominator += 1;
    });
  });

  Object.values(result).forEach((metric) => {
    metric.rate = safeRate(metric.corrections, metric.critical_field_denominator);
    metric.asset_rate = safeRate(metric.corrections, totalAssets);
  });

  return result;
}

function addBreakdownMetric(target, key, exact) {
  if (!key) return;
  if (!target[key]) {
    target[key] = { total_assets: 0, exact_assets: 0 };
  }
  target[key].total_assets += 1;
  if (exact) target[key].exact_assets += 1;
}

function withRate(metric) {
  const total = metric.total_assets || 0;
  return {
    ...metric,
    rate: total ? metric.exact_assets / total : null
  };
}

function metricScopeSummary(items, {
  metricScope = "all_configured_splits"
} = {}) {
  const totalAssets = items.length;
  const evaluatedAssets = items.filter(hasPrediction).length;
  const exactAssets = items.filter(itemIsExact).length;
  const aiCompleteItems = items.filter((item) => hasPrediction(item) && predictedAiComplete(item));
  const aiCompleteExact = aiCompleteItems.filter(itemIsExact).length;
  const falseAiComplete = aiCompleteItems.length - aiCompleteExact;
  const humanCritical = items.filter((item) => hasPrediction(item) && needsHumanCriticalResolution(item)).length;
  const acceptedCriticalErrors = items.filter((item) => hasPrediction(item) && acceptedCriticalError(item)).length;
  const technicalFailures = items.filter((item) => hasPrediction(item) && technicalFailure(item)).length;
  const routingCorrect = items.filter(routeMatches).length;
  const nonStandardItems = items.filter((item) => nonStandardRoute(item.ground_truth_route));
  const nonStandardCorrect = nonStandardItems.filter((item) => nonStandardRoute(item.prediction?.route)).length;
  const byCategory = {};
  const byDifficulty = {};
  const byProvider = {};
  const fieldTotals = {};
  let totalFieldChecks = 0;
  let correctFieldChecks = 0;

  items.forEach((item) => {
    const exact = itemIsExact(item);
    addBreakdownMetric(byCategory, item.category, exact);
    addBreakdownMetric(byProvider, predictionProviderId(item), exact);
    item.difficulty_tags?.forEach((tag) => addBreakdownMetric(byDifficulty, tag, exact));

    itemCriticalFields(item).forEach((field) => {
      if (!fieldTotals[field]) {
        fieldTotals[field] = { total: 0, correct: 0 };
      }
      fieldTotals[field].total += 1;
      totalFieldChecks += 1;
      if (hasPrediction(item) && criticalFieldMatches(item, field)) {
        fieldTotals[field].correct += 1;
        correctFieldChecks += 1;
      }
    });
  });

  const providerCalls = items.map((item) => usageNumber(item, ["provider_calls"]));
  const retrievalRounds = items.map((item) => usageNumber(item, ["retrieval_rounds", "retrieval_calls"]));
  const latencyMs = items.map((item) => usageNumber(item, ["latency_ms"]));
  const reviewDurations = items.map((item) => usageNumber(item, ["review_duration_ms"]));
  const costs = items.map((item) => usageNumber(item, ["estimated_cost_usd", "cost_usd"]));
  const recovery = recoveryMetrics(items);
  const retrievalGains = retrievalProviderGains(items, totalAssets);
  const providerComparison = visionProviderMetrics(items);
  const finalApprovedPublish = finalApprovedPublishMetrics(items);
  const glareImpact = glareImpactMetrics(items, totalAssets, recovery, finalApprovedPublish);

  return {
    metric_scope: metricScope,
    total_assets: totalAssets,
    evaluated_assets: evaluatedAssets,
    missing_predictions: totalAssets - evaluatedAssets,
    commercial_metrics: {
      ai_overall_exact_resolution_rate: totalAssets ? exactAssets / totalAssets : null,
      card_level_exact_accuracy: totalAssets ? exactAssets / totalAssets : null,
      field_level_accuracy: safeRate(correctFieldChecks, totalFieldChecks),
      human_authored_critical_resolution_rate: totalAssets ? humanCritical / totalAssets : null,
      accepted_critical_error_rate: totalAssets ? acceptedCriticalErrors / totalAssets : null,
      ai_complete_result_precision: aiCompleteItems.length ? aiCompleteExact / aiCompleteItems.length : null,
      final_approved_publish_accuracy: finalApprovedPublish.rate,
      technical_failure_rate: totalAssets ? technicalFailures / totalAssets : null,
      false_ai_complete: falseAiComplete,
      routing_accuracy: totalAssets ? routingCorrect / totalAssets : null,
      non_standard_recall: safeRate(nonStandardCorrect, nonStandardItems.length),
      ...recovery
    },
    confidence_intervals: {
      method: "wilson_score",
      confidence_level: 0.95,
      ai_overall_exact_resolution_rate: wilsonInterval(exactAssets, totalAssets),
      card_level_exact_accuracy: wilsonInterval(exactAssets, totalAssets),
      field_level_accuracy: wilsonInterval(correctFieldChecks, totalFieldChecks),
      human_authored_critical_resolution_rate: wilsonInterval(humanCritical, totalAssets),
      accepted_critical_error_rate: wilsonInterval(acceptedCriticalErrors, totalAssets),
      ai_complete_result_precision: wilsonInterval(aiCompleteExact, aiCompleteItems.length),
      final_approved_publish_accuracy: wilsonInterval(finalApprovedPublish.final_exact_assets, finalApprovedPublish.approved_assets),
      technical_failure_rate: wilsonInterval(technicalFailures, totalAssets),
      routing_accuracy: wilsonInterval(routingCorrect, totalAssets),
      non_standard_recall: wilsonInterval(nonStandardCorrect, nonStandardItems.length),
      recovery: recoveryConfidenceIntervals(recovery)
    },
    operational_metrics: {
      average_review_duration_ms: average(reviewDurations),
      average_provider_calls: average(providerCalls),
      average_retrieval_rounds: average(retrievalRounds),
      average_latency_ms: average(latencyMs),
      total_cost_usd: Number(sum(costs).toFixed(6)),
      cost_per_asset: totalAssets ? Number((sum(costs) / totalAssets).toFixed(6)) : null
    },
    counts: {
      exact_assets: exactAssets,
      ai_complete_assets: aiCompleteItems.length,
      ai_complete_exact_assets: aiCompleteExact,
      false_ai_complete_assets: falseAiComplete,
      human_critical_resolution_assets: humanCritical,
      accepted_critical_error_assets: acceptedCriticalErrors,
      final_approved_publish_assets: finalApprovedPublish.approved_assets,
      final_approved_publish_exact_assets: finalApprovedPublish.final_exact_assets,
      final_approved_publish_error_assets: finalApprovedPublish.error_assets,
      technical_failure_assets: technicalFailures,
      routing_correct_assets: routingCorrect,
      non_standard_assets: nonStandardItems.length,
      non_standard_correct_assets: nonStandardCorrect,
      total_field_checks: totalFieldChecks,
      correct_field_checks: correctFieldChecks
    },
    field_accuracy: Object.fromEntries(Object.entries(fieldTotals).map(([field, metric]) => [
      field,
      {
        ...metric,
        rate: metric.total ? metric.correct / metric.total : null
      }
    ])),
    correction_rate_per_field: correctionRateByField(items, totalAssets),
    breakdowns: {
      category: Object.fromEntries(Object.entries(byCategory).map(([key, metric]) => [key, withRate(metric)])),
      difficulty: Object.fromEntries(Object.entries(byDifficulty).map(([key, metric]) => [key, withRate(metric)])),
      provider: Object.fromEntries(Object.entries(byProvider).map(([key, metric]) => [key, withRate(metric)]))
    },
    retrieval_provider_gains: retrievalGains,
    vision_provider_comparison: providerComparison,
    final_approved_publish: finalApprovedPublish,
    glare_impact: glareImpact,
    failure_analysis: {
      root_causes: failureRootCauses(items, totalAssets),
      field_error_distribution: fieldErrorDistribution(items)
    }
  };
}

function normalizeAcceptanceConfig(dataset = {}) {
  const configured = isPlainObject(dataset.commercial_acceptance)
    ? dataset.commercial_acceptance
    : {};
  const configuredThresholds = isPlainObject(configured.thresholds) ? configured.thresholds : {};
  const thresholds = {
    ...commercialAcceptanceDefaults.thresholds,
    ...configuredThresholds
  };

  return {
    minimum_held_out_assets: Number.isFinite(Number(configured.minimum_held_out_assets))
      ? Number(configured.minimum_held_out_assets)
      : commercialAcceptanceDefaults.minimum_held_out_assets,
    required_strata: Array.isArray(configured.required_strata)
      ? configured.required_strata.map((value) => String(value || "").trim()).filter(Boolean)
      : commercialAcceptanceDefaults.required_strata,
    thresholds
  };
}

function thresholdPassed(metricValue, threshold = {}) {
  if (!Number.isFinite(metricValue)) return false;
  const value = Number(threshold.value);
  if (!Number.isFinite(value)) return false;
  return threshold.operator === "<=" ? metricValue <= value : metricValue >= value;
}

function commercialAcceptanceGate(heldOutScope, dataset) {
  const config = normalizeAcceptanceConfig(dataset);
  const reasons = [];
  const metrics = heldOutScope.commercial_metrics;
  const totalAssets = heldOutScope.total_assets;
  const allTags = new Set();

  heldOutScope.breakdowns.difficulty
    && Object.keys(heldOutScope.breakdowns.difficulty).forEach((tag) => allTags.add(tag));

  if (totalAssets === 0) {
    reasons.push("held_out_commercial split is empty");
  }

  if (totalAssets > 0 && totalAssets < config.minimum_held_out_assets) {
    reasons.push(`held_out_commercial has ${totalAssets} assets; minimum is ${config.minimum_held_out_assets}`);
  }

  if (heldOutScope.missing_predictions > 0) {
    reasons.push(`${heldOutScope.missing_predictions} held-out assets are missing predictions`);
  }

  const missingStrata = config.required_strata.filter((stratum) => !allTags.has(stratum));
  if (missingStrata.length) {
    reasons.push(`held_out_commercial is missing required strata: ${missingStrata.join(", ")}`);
  }

  const threshold_results = Object.fromEntries(Object.entries(config.thresholds).map(([metricName, threshold]) => {
    const value = metrics[metricName];
    const passed = thresholdPassed(value, threshold);
    if (!passed) {
      reasons.push(`${metricName}=${value ?? "n/a"} does not satisfy ${threshold.operator || ">="} ${threshold.value}`);
    }
    return [
      metricName,
      {
        value,
        operator: threshold.operator || ">=",
        threshold: Number(threshold.value),
        passed
      }
    ];
  }));

  const eligible = reasons.length === 0;

  return {
    metric_scope: "held_out_commercial",
    eligible,
    passed: eligible && Object.values(threshold_results).every((result) => result.passed),
    reasons,
    minimum_held_out_assets: config.minimum_held_out_assets,
    required_strata: config.required_strata,
    threshold_results
  };
}

export function listGoldenDatasetItems(dataset) {
  return requiredSplits.flatMap((split) => {
    const items = dataset?.splits?.[split] || [];
    return items.map((item) => ({ ...item, split }));
  });
}

export function validateGoldenDataset(dataset) {
  const errors = [];
  const warnings = [];
  const seenAssetIds = new Set();

  if (!isPlainObject(dataset)) {
    return { ok: false, errors: ["dataset must be a JSON object"], warnings };
  }

  if (dataset.schema_version !== goldenDatasetSchemaVersion) {
    errors.push(`schema_version must be ${goldenDatasetSchemaVersion}`);
  }

  if (!isPlainObject(dataset.splits)) {
    errors.push("splits must be an object");
    return { ok: false, errors, warnings };
  }

  requiredSplits.forEach((split) => {
    if (!Array.isArray(dataset.splits[split])) {
      errors.push(`splits.${split} must be an array`);
    }
  });

  listGoldenDatasetItems(dataset).forEach((item, index) => {
    const location = `${item.split}[${index}]`;

    if (!item.asset_id || typeof item.asset_id !== "string") {
      errors.push(`${location}.asset_id is required`);
    } else if (seenAssetIds.has(item.asset_id)) {
      errors.push(`${location}.asset_id duplicates ${item.asset_id}`);
    } else {
      seenAssetIds.add(item.asset_id);
    }

    if (!Array.isArray(item.images) || item.images.length < 1) {
      errors.push(`${location}.images must contain at least one image reference`);
    }

    if (!item.category || typeof item.category !== "string") {
      errors.push(`${location}.category is required`);
    }

    if (!Array.isArray(item.difficulty_tags)) {
      errors.push(`${location}.difficulty_tags must be an array`);
    }

    if (!Array.isArray(item.capture_tags)) {
      errors.push(`${location}.capture_tags must be an array`);
    }

    if (!item.ground_truth_route || typeof item.ground_truth_route !== "string") {
      errors.push(`${location}.ground_truth_route is required`);
    }

    if (!isPlainObject(item.ground_truth_fields)) {
      errors.push(`${location}.ground_truth_fields must be an object`);
    }

    if (!Array.isArray(item.critical_fields) || item.critical_fields.length < 1) {
      errors.push(`${location}.critical_fields must contain at least one field`);
    }

    const unknownCriticalFields = itemCriticalFields(item).filter((field) => {
      return !commercialMetricCriticalFields.includes(field);
    });
    if (unknownCriticalFields.length) {
      warnings.push(`${location}.critical_fields contains non-standard fields: ${unknownCriticalFields.join(", ")}`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

export function evaluateGoldenDataset(dataset) {
  const validation = validateGoldenDataset(dataset);
  if (!validation.ok) {
    return { ok: false, validation };
  }

  const items = listGoldenDatasetItems(dataset);
  const heldOutItems = items.filter((item) => item.split === "held_out_commercial");
  const totalAssets = items.length;
  const evaluatedAssets = items.filter(hasPrediction).length;
  const exactAssets = items.filter(itemIsExact).length;
  const aiCompleteItems = items.filter((item) => hasPrediction(item) && predictedAiComplete(item));
  const aiCompleteExact = aiCompleteItems.filter(itemIsExact).length;
  const falseAiComplete = aiCompleteItems.length - aiCompleteExact;
  const humanCritical = items.filter((item) => hasPrediction(item) && needsHumanCriticalResolution(item)).length;
  const acceptedCriticalErrors = items.filter((item) => hasPrediction(item) && acceptedCriticalError(item)).length;
  const technicalFailures = items.filter((item) => hasPrediction(item) && technicalFailure(item)).length;
  const routingCorrect = items.filter(routeMatches).length;
  const nonStandardItems = items.filter((item) => nonStandardRoute(item.ground_truth_route));
  const nonStandardCorrect = nonStandardItems.filter((item) => nonStandardRoute(item.prediction?.route)).length;
  const byCategory = {};
  const byDifficulty = {};
  const byProvider = {};
  const fieldTotals = {};
  let totalFieldChecks = 0;
  let correctFieldChecks = 0;

  items.forEach((item) => {
    const exact = itemIsExact(item);
    addBreakdownMetric(byCategory, item.category, exact);
    addBreakdownMetric(byProvider, predictionProviderId(item), exact);
    item.difficulty_tags?.forEach((tag) => addBreakdownMetric(byDifficulty, tag, exact));

    itemCriticalFields(item).forEach((field) => {
      if (!fieldTotals[field]) {
        fieldTotals[field] = { total: 0, correct: 0 };
      }
      fieldTotals[field].total += 1;
      totalFieldChecks += 1;
      if (hasPrediction(item) && criticalFieldMatches(item, field)) {
        fieldTotals[field].correct += 1;
        correctFieldChecks += 1;
      }
    });
  });

  const providerCalls = items.map((item) => usageNumber(item, ["provider_calls"]));
  const retrievalRounds = items.map((item) => usageNumber(item, ["retrieval_rounds", "retrieval_calls"]));
  const latencyMs = items.map((item) => usageNumber(item, ["latency_ms"]));
  const reviewDurations = items.map((item) => usageNumber(item, ["review_duration_ms"]));
  const costs = items.map((item) => usageNumber(item, ["estimated_cost_usd", "cost_usd"]));
  const heldOutCount = dataset.splits.held_out_commercial.length;
  const recovery = recoveryMetrics(items);
  const retrievalGains = retrievalProviderGains(items, totalAssets);
  const providerComparison = visionProviderMetrics(items);
  const finalApprovedPublish = finalApprovedPublishMetrics(items);
  const glareImpact = glareImpactMetrics(items, totalAssets, recovery, finalApprovedPublish);
  const allConfiguredSplitsEvidence = metricScopeSummary(items, {
    metricScope: "all_configured_splits"
  });
  const heldOutCommercialEvidence = metricScopeSummary(heldOutItems, {
    metricScope: "held_out_commercial"
  });
  const acceptanceGate = commercialAcceptanceGate(heldOutCommercialEvidence, dataset);

  return {
    ok: true,
    schema_version: dataset.schema_version,
    generated_at: new Date().toISOString(),
    dataset: {
      total_assets: totalAssets,
      evaluated_assets: evaluatedAssets,
      missing_predictions: totalAssets - evaluatedAssets,
      split_counts: Object.fromEntries(requiredSplits.map((split) => [split, dataset.splits[split].length])),
      has_held_out_commercial: heldOutCount > 0,
      commercial_claim_allowed: acceptanceGate.passed,
      legacy_metric_scope: "all_configured_splits",
      commercial_metric_scope: "held_out_commercial"
    },
    commercial_metrics: {
      ai_overall_exact_resolution_rate: totalAssets ? exactAssets / totalAssets : null,
      card_level_exact_accuracy: totalAssets ? exactAssets / totalAssets : null,
      field_level_accuracy: safeRate(correctFieldChecks, totalFieldChecks),
      human_authored_critical_resolution_rate: totalAssets ? humanCritical / totalAssets : null,
      accepted_critical_error_rate: totalAssets ? acceptedCriticalErrors / totalAssets : null,
      ai_complete_result_precision: aiCompleteItems.length ? aiCompleteExact / aiCompleteItems.length : null,
      final_approved_publish_accuracy: finalApprovedPublish.rate,
      technical_failure_rate: totalAssets ? technicalFailures / totalAssets : null,
      false_ai_complete: falseAiComplete,
      routing_accuracy: totalAssets ? routingCorrect / totalAssets : null,
      non_standard_recall: safeRate(nonStandardCorrect, nonStandardItems.length),
      ...recovery
    },
    confidence_intervals: {
      method: "wilson_score",
      confidence_level: 0.95,
      ai_overall_exact_resolution_rate: wilsonInterval(exactAssets, totalAssets),
      card_level_exact_accuracy: wilsonInterval(exactAssets, totalAssets),
      field_level_accuracy: wilsonInterval(correctFieldChecks, totalFieldChecks),
      human_authored_critical_resolution_rate: wilsonInterval(humanCritical, totalAssets),
      accepted_critical_error_rate: wilsonInterval(acceptedCriticalErrors, totalAssets),
      ai_complete_result_precision: wilsonInterval(aiCompleteExact, aiCompleteItems.length),
      final_approved_publish_accuracy: wilsonInterval(finalApprovedPublish.final_exact_assets, finalApprovedPublish.approved_assets),
      technical_failure_rate: wilsonInterval(technicalFailures, totalAssets),
      routing_accuracy: wilsonInterval(routingCorrect, totalAssets),
      non_standard_recall: wilsonInterval(nonStandardCorrect, nonStandardItems.length),
      recovery: recoveryConfidenceIntervals(recovery)
    },
    operational_metrics: {
      average_review_duration_ms: average(reviewDurations),
      average_provider_calls: average(providerCalls),
      average_retrieval_rounds: average(retrievalRounds),
      average_latency_ms: average(latencyMs),
      total_cost_usd: Number(sum(costs).toFixed(6)),
      cost_per_asset: totalAssets ? Number((sum(costs) / totalAssets).toFixed(6)) : null
    },
    counts: {
      exact_assets: exactAssets,
      ai_complete_assets: aiCompleteItems.length,
      ai_complete_exact_assets: aiCompleteExact,
      false_ai_complete_assets: falseAiComplete,
      human_critical_resolution_assets: humanCritical,
      accepted_critical_error_assets: acceptedCriticalErrors,
      final_approved_publish_assets: finalApprovedPublish.approved_assets,
      final_approved_publish_exact_assets: finalApprovedPublish.final_exact_assets,
      final_approved_publish_error_assets: finalApprovedPublish.error_assets,
      technical_failure_assets: technicalFailures,
      routing_correct_assets: routingCorrect,
      non_standard_assets: nonStandardItems.length,
      non_standard_correct_assets: nonStandardCorrect,
      total_field_checks: totalFieldChecks,
      correct_field_checks: correctFieldChecks
    },
    field_accuracy: Object.fromEntries(Object.entries(fieldTotals).map(([field, metric]) => [
      field,
      {
        ...metric,
        rate: metric.total ? metric.correct / metric.total : null
      }
    ])),
    correction_rate_per_field: correctionRateByField(items, totalAssets),
    breakdowns: {
      category: Object.fromEntries(Object.entries(byCategory).map(([key, metric]) => [key, withRate(metric)])),
      difficulty: Object.fromEntries(Object.entries(byDifficulty).map(([key, metric]) => [key, withRate(metric)])),
      provider: Object.fromEntries(Object.entries(byProvider).map(([key, metric]) => [key, withRate(metric)]))
    },
    retrieval_provider_gains: retrievalGains,
    vision_provider_comparison: providerComparison,
    final_approved_publish: finalApprovedPublish,
    glare_impact: glareImpact,
    all_configured_splits_evidence: allConfiguredSplitsEvidence,
    held_out_commercial_evidence: heldOutCommercialEvidence,
    commercial_acceptance_gate: acceptanceGate,
    failure_analysis: {
      root_causes: failureRootCauses(items, totalAssets),
      field_error_distribution: fieldErrorDistribution(items)
    },
    warnings: [
      ...validation.warnings,
      ...(totalAssets === 0 ? ["No golden dataset items are configured; metrics are null and no accuracy claim is possible."] : []),
      ...(heldOutCount === 0 ? ["Held-out commercial split is empty; reported metrics are not commercial acceptance evidence."] : []),
      ...(evaluatedAssets < totalAssets ? ["Assets without predictions remain in the denominator for overall commercial metrics."] : []),
      ...(acceptanceGate.passed ? [] : [`Commercial acceptance gate failed: ${acceptanceGate.reasons.join("; ")}`])
    ]
  };
}
