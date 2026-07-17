import { launchGateImageSourceRecords } from "./launch-gate-image-source-index.generated.mjs";

const allowedBucket = "listing-feedback-images";
const allowedPathPrefixes = Object.freeze(["feedback/", "listing-assets/"]);

function cleanText(value) {
  return String(value || "").trim();
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

function buildSourceIndex(records = launchGateImageSourceRecords) {
  const index = new Map();
  for (const item of records) {
    const sourceId = cleanText(item.source_feedback_id);
    if (!sourceId || index.has(sourceId)) continue;
    const images = (Array.isArray(item.images) ? item.images : []).map(safeImageReference);
    if (!images.length) continue;
    index.set(sourceId, Object.freeze({
      source_feedback_id: sourceId,
      evaluation_cohort: cleanText(item.evaluation_cohort),
      images: Object.freeze(images)
    }));
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
