import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const reviewedSeedDataset = require("../../../data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json");
const ebayColdStartDataset = require("../../../data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json");

const allowedBucket = "listing-feedback-images";
const allowedPathPrefixes = Object.freeze(["feedback/", "listing-assets/"]);
const sourceDatasets = Object.freeze([
  Object.freeze({ cohort: "INTERNAL_REVIEWED_GT", dataset: reviewedSeedDataset }),
  Object.freeze({ cohort: "EBAY_COLD_START", dataset: ebayColdStartDataset })
]);

function cleanText(value) {
  return String(value || "").trim();
}

function datasetItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || [];
}

function safeSourceId(value) {
  const sourceId = cleanText(value);
  if (!sourceId || sourceId.length > 180 || !/^[a-zA-Z0-9:_-]+$/.test(sourceId)) {
    throw new Error("launch_gate_source_id_invalid");
  }
  return sourceId;
}

function safeImageReference(image = {}) {
  const bucket = cleanText(image.bucket);
  const objectPath = cleanText(image.object_path || image.objectPath);
  if (
    bucket !== allowedBucket
    || !objectPath
    || objectPath.startsWith("/")
    || objectPath.includes("..")
    || !allowedPathPrefixes.some((prefix) => objectPath.startsWith(prefix))
  ) {
    throw new Error("launch_gate_image_reference_out_of_scope");
  }
  return Object.freeze({
    image_id: cleanText(image.image_id || image.id),
    bucket,
    object_path: objectPath,
    role: cleanText(image.role),
    content_sha256: cleanText(image.content_sha256 || image.contentSha256).toLowerCase() || null
  });
}

function buildSourceIndex(datasets = sourceDatasets) {
  const index = new Map();
  for (const source of datasets) {
    for (const item of datasetItems(source.dataset)) {
      const sourceId = cleanText(item.source_feedback_id);
      if (!sourceId || index.has(sourceId)) continue;
      const images = (Array.isArray(item.images) ? item.images : []).map(safeImageReference);
      if (!images.length) continue;
      index.set(sourceId, Object.freeze({
        source_feedback_id: sourceId,
        evaluation_cohort: source.cohort,
        images: Object.freeze(images)
      }));
    }
  }
  return index;
}

const defaultSourceIndex = buildSourceIndex();

export function launchGateImageSourceCount() {
  return defaultSourceIndex.size;
}

export function resolveLaunchGateImageSources(sourceFeedbackIds = [], { sourceIndex = defaultSourceIndex } = {}) {
  const requested = [...new Set((Array.isArray(sourceFeedbackIds) ? sourceFeedbackIds : [])
    .map(safeSourceId))];
  if (!requested.length || requested.length > 100) {
    throw new Error("launch_gate_source_count_invalid");
  }
  const missing = requested.filter((sourceId) => !sourceIndex.has(sourceId));
  if (missing.length) {
    const error = new Error("launch_gate_source_not_allowlisted");
    error.missingCount = missing.length;
    throw error;
  }
  return requested.map((sourceId) => sourceIndex.get(sourceId));
}

