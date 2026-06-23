import { commercialMetricCriticalFields, evaluateGoldenDataset, validateGoldenDataset } from "./golden-dataset.mjs";

const imageRoleMap = Object.freeze({
  front: "front",
  front_original: "front",
  back: "back",
  back_original: "back",
  alternate: "alternate",
  front_alternate: "alternate",
  back_alternate: "alternate",
  serial_crop: "serial_crop",
  card_code_crop: "card_code_crop",
  checklist_code_crop: "card_code_crop",
  collector_number_crop: "card_code_crop",
  grade_crop: "grade_label_crop",
  grade_label_crop: "grade_label_crop",
  year_product_crop: "year_product_crop",
  readability_derived: "readability_derived",
  surface_view: "surface_view"
});

const approvedOutcomes = new Set([
  "ACCEPTED_UNCHANGED",
  "CORRECTED_FIELDS",
  "TITLE_ONLY_OVERRIDE",
  "TARGETED_RESCAN_RECOVERED"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeId(value) {
  return normalizeText(value).replace(/[^a-z0-9._:-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function plainObject(value) {
  return isPlainObject(value) ? value : {};
}

function arrayFromAny(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function valuePresent(value, field = "") {
  if (field === "final_title_unsubstantiated_fields") return typeof value === "boolean";
  if (typeof value === "boolean") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

function rowSection(row = {}, names = []) {
  for (const name of names) {
    if (isPlainObject(row[name])) return row[name];
  }
  return {};
}

function rowAsset(row = {}) {
  return rowSection(row, ["asset", "listing_asset", "listing_assets"]);
}

function rowAnalysis(row = {}) {
  return rowSection(row, ["analysis_run", "analysis", "listing_analysis_run", "listing_analysis_runs"]);
}

function rowReview(row = {}) {
  return rowSection(row, ["review", "listing_review", "listing_reviews"]);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function safeObjectPath(value) {
  const objectPath = normalizeText(value);
  if (!objectPath) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(objectPath)) return "";
  if (objectPath.includes("?") || objectPath.includes("#") || objectPath.includes("\\") || objectPath.startsWith("/")) return "";
  if (objectPath.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  return objectPath;
}

function imageRecord(role, objectPath) {
  const safePath = safeObjectPath(objectPath);
  if (!safePath) return null;
  return {
    role: imageRoleMap[normalizeText(role).toLowerCase()] || "alternate",
    object_path: safePath
  };
}

function imageRecordsFromAsset(asset = {}, row = {}) {
  const images = [];
  const front = firstValue(asset.front_object_path, row.front_object_path, row.frontObjectPath);
  const back = firstValue(asset.back_object_path, row.back_object_path, row.backObjectPath);
  const directImages = firstValue(asset.images, row.images, []);
  const additional = firstValue(asset.additional_image_paths, row.additional_image_paths, row.additionalImagePaths, []);

  if (front) images.push(imageRecord("front_original", front));
  if (back) images.push(imageRecord("back_original", back));

  arrayFromAny(directImages).forEach((image) => {
    if (typeof image === "string") {
      images.push(imageRecord("alternate", image));
      return;
    }

    if (!isPlainObject(image)) return;
    images.push(imageRecord(
      image.role || image.storageRole || image.storage_role || image.source_region || "alternate",
      image.object_path || image.objectPath || image.path
    ));
  });

  arrayFromAny(additional).forEach((image) => {
    if (typeof image === "string") {
      images.push(imageRecord("alternate", image));
      return;
    }

    if (!isPlainObject(image)) return;
    images.push(imageRecord(
      image.role || image.storageRole || image.storage_role || image.source_region || "alternate",
      image.object_path || image.objectPath || image.path
    ));
  });

  const seen = new Set();
  return images.filter((image) => {
    if (!image?.object_path || seen.has(image.object_path)) return false;
    seen.add(image.object_path);
    return true;
  });
}

function rowCommercialQuality(row = {}) {
  return {
    ...plainObject(row.commercial_quality),
    ...plainObject(row.quality),
    ...plainObject(rowReview(row).commercial_quality),
    ...plainObject(rowReview(row).evaluation)
  };
}

function titleQualityFields(row = {}, {
  allowDerivedTitleFlags = false
} = {}) {
  const quality = rowCommercialQuality(row);
  const required = firstValue(quality.final_title_required_fields, row.final_title_required_fields);
  const unsubstantiated = firstValue(quality.final_title_unsubstantiated_fields, row.final_title_unsubstantiated_fields);

  if (typeof required === "boolean" && typeof unsubstantiated === "boolean") {
    return {
      ok: true,
      fields: {
        final_title_required_fields: required,
        final_title_unsubstantiated_fields: unsubstantiated
      },
      derived: false
    };
  }

  if (allowDerivedTitleFlags) {
    return {
      ok: true,
      fields: {
        final_title_required_fields: Boolean(firstValue(rowReview(row).corrected_title, row.corrected_title)),
        final_title_unsubstantiated_fields: false
      },
      derived: true
    };
  }

  return {
    ok: false,
    fields: {},
    derived: false,
    reason: "missing explicit final title quality flags"
  };
}

function criticalFieldsForGroundTruth(fields = {}) {
  return commercialMetricCriticalFields.filter((field) => valuePresent(fields[field], field));
}

function normalizedTags(values = []) {
  return [...new Set(arrayFromAny(values).map((value) => normalizeText(value).toLowerCase()).filter(Boolean))];
}

function routeFromOutcome(outcome, fallbackRoute = "") {
  const normalizedOutcome = normalizeText(outcome).toUpperCase();
  const route = normalizeText(fallbackRoute).toUpperCase();
  if (route) return route;
  if (normalizedOutcome === "NON_STANDARD_MANUAL") return "NON_STANDARD_MANUAL";
  if (normalizedOutcome === "TECHNICAL_FAILURE") return "FAILED_TECHNICAL";
  if (normalizedOutcome === "CORRECTED_FIELDS") return "WRITER_REVIEW_REQUIRED";
  if (normalizedOutcome === "REJECTED") return "TARGETED_RESCAN_REQUIRED";
  return "AI_COMPLETE_REVIEW";
}

function deriveDifficultyTags({ explicit, captureQuality, fields, images, route, reviewOutcome }) {
  const tags = new Set(normalizedTags(explicit));
  const imageRoles = new Set(images.map((image) => image.role));
  const normalizedRoute = normalizeText(route).toUpperCase();
  const normalizedOutcome = normalizeText(reviewOutcome).toUpperCase();
  const qualityText = JSON.stringify(captureQuality || {}).toLowerCase();

  if (imageRoles.has("front") && imageRoles.has("back")) tags.add("front_back");
  else tags.add("front_only");
  if (valuePresent(fields.serial_number)) tags.add("serial");
  if (valuePresent(fields.auto)) tags.add("auto");
  if (valuePresent(fields.patch)) tags.add("patch");
  if (valuePresent(fields.relic)) tags.add("relic");
  if (valuePresent(fields.grade_company) || valuePresent(fields.card_grade)) tags.add("slab");
  if (normalizedRoute === "NON_STANDARD_MANUAL" || normalizedOutcome === "NON_STANDARD_MANUAL") tags.add("non_standard");
  if (qualityText.includes("glare")) tags.add("glare");

  return [...tags];
}

function deriveCaptureTags({ explicit, images, reviewOutcome, route }) {
  const tags = new Set(normalizedTags(explicit));
  const imageRoles = new Set(images.map((image) => image.role));
  const normalizedRoute = normalizeText(route).toUpperCase();
  const normalizedOutcome = normalizeText(reviewOutcome).toUpperCase();

  if (imageRoles.has("front") && imageRoles.has("back")) tags.add("front_back");
  else tags.add("front_only");
  if (normalizedRoute === "TARGETED_RESCAN_REQUIRED" || normalizedOutcome === "TARGETED_RESCAN_RECOVERED") {
    tags.add("targeted_rescan");
  }

  return [...tags];
}

function reviewApproved(review = {}, row = {}) {
  const outcome = normalizeText(firstValue(review.review_outcome, row.review_outcome)).toUpperCase();
  return approvedOutcomes.has(outcome) || Boolean(firstValue(review.approved_at, row.approved_at));
}

function buildPrediction({ row, analysis, review, generatedFields }) {
  const outcome = normalizeText(review.review_outcome || row.review_outcome).toUpperCase();
  const fieldChanges = arrayFromAny(firstValue(review.field_changes, row.field_changes));

  return {
    route: normalizeText(firstValue(analysis.route, row.route)) || routeFromOutcome(outcome),
    provider: normalizeText(firstValue(analysis.provider, row.provider)) || "unknown_provider",
    model_id: normalizeText(firstValue(analysis.model_id, row.model_id)),
    resolved_fields: generatedFields,
    corrected_resolved_fields: plainObject(firstValue(review.corrected_resolved_fields, row.corrected_resolved_fields)),
    final_title: normalizeText(firstValue(analysis.rendered_title, row.generated_title, row.final_title)),
    corrected_title: normalizeText(firstValue(review.corrected_title, row.corrected_title)),
    review_outcome: outcome || "ACCEPTED_UNCHANGED",
    review_status: reviewApproved(review, row) ? "APPROVED" : "PENDING_REVIEW",
    approved_at: normalizeText(firstValue(review.approved_at, row.approved_at)),
    field_changes: fieldChanges,
    human_authored_critical_resolution: outcome === "CORRECTED_FIELDS" || outcome === "NON_STANDARD_MANUAL",
    accepted_critical_error: firstValue(row.accepted_critical_error, review.accepted_critical_error) === true,
    technical_failure: outcome === "TECHNICAL_FAILURE" || normalizeText(firstValue(analysis.route, row.route)).toUpperCase() === "FAILED_TECHNICAL",
    retrieval: plainObject(firstValue(analysis.retrieval_trace, row.retrieval_trace, row.retrieval)),
    resolution_trace: arrayFromAny(firstValue(analysis.resolution_trace, row.resolution_trace)),
    usage: plainObject(firstValue(analysis.usage, row.usage)),
    recovery: plainObject(firstValue(row.recovery, review.recovery))
  };
}

export function normalizeCommercialHeldoutRows(source) {
  if (Array.isArray(source)) return source;
  if (!isPlainObject(source)) return [];
  return arrayFromAny(source.rows || source.reviews || source.items || source.data);
}

export function buildHeldOutCommercialItems(sourceRows, options = {}) {
  const rows = normalizeCommercialHeldoutRows(sourceRows);
  const items = [];
  const rejected_rows = [];
  const warnings = [];

  rows.forEach((row, index) => {
    const asset = rowAsset(row);
    const analysis = rowAnalysis(row);
    const review = rowReview(row);
    const assetId = normalizeId(firstValue(row.asset_id, asset.id, review.asset_id, analysis.asset_id));
    const analysisId = normalizeId(firstValue(row.analysis_run_id, review.analysis_run_id, analysis.id));
    const reviewId = normalizeId(firstValue(row.review_id, review.id));
    const generatedFields = plainObject(firstValue(review.generated_resolved_fields, analysis.generated_resolved_fields, row.generated_resolved_fields));
    const correctedFields = plainObject(firstValue(review.corrected_resolved_fields, row.corrected_resolved_fields));
    const images = imageRecordsFromAsset(asset, row);
    const titleFlags = titleQualityFields(row, options);
    const reasons = [];

    if (!assetId) reasons.push("missing asset_id");
    if (!analysisId) reasons.push("missing analysis_run_id");
    if (!reviewId) reasons.push("missing review_id");
    if (!Object.keys(generatedFields).length) reasons.push("missing generated_resolved_fields");
    if (!Object.keys(correctedFields).length) reasons.push("missing corrected_resolved_fields");
    if (!images.length) reasons.push("missing safe image object paths");
    if (!titleFlags.ok) reasons.push(titleFlags.reason);

    if (reasons.length) {
      rejected_rows.push({ index, asset_id: assetId || null, reasons });
      return;
    }

    const groundTruthFields = {
      ...correctedFields,
      ...titleFlags.fields
    };
    const explicitGroundTruthRoute = firstValue(row.ground_truth_route, row.groundTruthRoute, review.ground_truth_route);
    const route = explicitGroundTruthRoute
      ? normalizeText(explicitGroundTruthRoute).toUpperCase()
      : routeFromOutcome(review.review_outcome || row.review_outcome);
    const captureQuality = plainObject(firstValue(analysis.capture_quality, row.capture_quality));
    const difficultyTags = deriveDifficultyTags({
      explicit: firstValue(row.difficulty_tags, review.difficulty_tags),
      captureQuality,
      fields: groundTruthFields,
      images,
      route,
      reviewOutcome: review.review_outcome || row.review_outcome
    });
    const captureTags = deriveCaptureTags({
      explicit: firstValue(row.capture_tags, review.capture_tags),
      images,
      reviewOutcome: review.review_outcome || row.review_outcome,
      route
    });
    const criticalFields = criticalFieldsForGroundTruth(groundTruthFields);

    if (titleFlags.derived) {
      warnings.push(`${assetId}: final title quality flags were derived and need operator confirmation`);
    }

    items.push({
      asset_id: assetId,
      source_review_id: reviewId,
      source_analysis_run_id: analysisId,
      images,
      category: normalizeText(firstValue(asset.category, row.category)) || "sports_card",
      difficulty_tags: difficultyTags,
      capture_tags: captureTags,
      ground_truth_route: route,
      ground_truth_fields: groundTruthFields,
      critical_fields: criticalFields,
      prediction: buildPrediction({
        row,
        analysis,
        review,
        generatedFields
      })
    });
  });

  return {
    items,
    rejected_rows,
    warnings
  };
}

function assetIdsForSplits(dataset = {}, splitNames = []) {
  const result = new Set();
  splitNames.forEach((split) => {
    arrayFromAny(dataset.splits?.[split]).forEach((item) => {
      if (item?.asset_id) result.add(item.asset_id);
    });
  });
  return result;
}

export function mergeHeldOutCommercialItems(dataset, items, {
  replace = false
} = {}) {
  const nextDataset = {
    ...dataset,
    splits: {
      development: [...arrayFromAny(dataset.splits?.development)],
      calibration: [...arrayFromAny(dataset.splits?.calibration)],
      held_out_commercial: replace ? [] : [...arrayFromAny(dataset.splits?.held_out_commercial)]
    }
  };
  const forbiddenAssetIds = assetIdsForSplits(nextDataset, ["development", "calibration"]);
  const existingHeldOutIds = assetIdsForSplits(nextDataset, ["held_out_commercial"]);
  const rejected_items = [];

  items.forEach((item) => {
    if (forbiddenAssetIds.has(item.asset_id)) {
      rejected_items.push({
        asset_id: item.asset_id,
        reason: "asset_id already exists in development or calibration split"
      });
      return;
    }

    if (existingHeldOutIds.has(item.asset_id)) {
      rejected_items.push({
        asset_id: item.asset_id,
        reason: "asset_id already exists in held_out_commercial split"
      });
      return;
    }

    existingHeldOutIds.add(item.asset_id);
    nextDataset.splits.held_out_commercial.push(item);
  });

  const validation = validateGoldenDataset(nextDataset);
  const evaluation = validation.ok ? evaluateGoldenDataset(nextDataset) : null;

  return {
    dataset: nextDataset,
    rejected_items,
    validation,
    evaluation
  };
}
