import { feedbackPayloadSha256 } from "../feedback/feedback-capture.mjs";
import { storageImageFromFeedbackUrl } from "../recognition/supabase-recognition-source.mjs";

export const GOLDEN_TITLE_RELEASE_SCHEMA_VERSION = "golden-title-release-v1";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeImage(image = {}, index = 0) {
  const objectPath = cleanText(image.object_path || image.objectPath || image.path);
  const contentSha256 = cleanText(image.content_sha256 || image.contentSha256).toLowerCase();
  if (!objectPath && !contentSha256) return null;
  return {
    image_id: cleanText(image.image_id || image.id || `image-${index + 1}`),
    bucket: cleanText(image.bucket) || null,
    object_path: objectPath || null,
    content_sha256: contentSha256 || null,
    role: cleanText(image.role || image.image_role) || null
  };
}

function imagesFromSupabaseRow(row = {}, id = "") {
  const front = storageImageFromFeedbackUrl({
    url: row.front_image_url,
    role: "front_original",
    imageId: `${id}_front`,
    fallbackBucket: row.front_bucket,
    fallbackObjectPath: row.front_object_path
  });
  const back = storageImageFromFeedbackUrl({
    url: row.back_image_url,
    role: "back_original",
    imageId: `${id}_back`,
    fallbackBucket: row.back_bucket,
    fallbackObjectPath: row.back_object_path
  });
  return [front, back].filter(Boolean).map(safeImage).filter(Boolean);
}

function imageContentPinned(images = []) {
  return images.length > 0
    && images.every((image) => /^[0-9a-f]{64}$/i.test(cleanText(image.content_sha256)));
}

function normalizedSourceRecord(record = {}, index = 0, sourcePolicy = "") {
  const sourceRecord = record.source_record && typeof record.source_record === "object"
    ? record.source_record
    : {};
  const sourceTitles = record.source_titles && typeof record.source_titles === "object"
    ? record.source_titles
    : {};
  const rawSupabaseRow = Boolean(record.corrected_title || record.front_image_url || record.back_image_url);
  const sourceId = cleanText(record.source_feedback_id || record.id || record.asset_id || `row-${index + 1}`);
  const writerTitle = cleanText(sourceTitles.corrected_title || record.corrected_title || record.writer_title);
  const explicitlyReviewed = sourceRecord.reviewed_ground_truth === true
    || sourceTitles.corrected_title_is_reviewed_title_ground_truth === true
    || (rawSupabaseRow && sourcePolicy === "WRITER_VERIFIED_SUPABASE");
  const images = Array.isArray(record.images)
    ? record.images.map(safeImage).filter(Boolean)
    : imagesFromSupabaseRow(record, sourceId);
  return {
    source_id: sourceId,
    writer_title: writerTitle,
    generated_title: cleanText(sourceTitles.generated_title || record.generated_title) || null,
    explicitly_reviewed: explicitlyReviewed,
    images,
    source_created_at: cleanText(record.created_at) || null
  };
}

export function buildGoldenTitleRelease(records = [], {
  sourcePolicy = "",
  releaseId = "golden-title-v1"
} = {}) {
  const rejected = [];
  const items = [];
  for (const [index, record] of (Array.isArray(records) ? records : []).entries()) {
    const source = normalizedSourceRecord(record, index, sourcePolicy);
    if (!source.writer_title) {
      rejected.push({ source_id: source.source_id, reason: "WRITER_TITLE_REQUIRED" });
      continue;
    }
    if (!source.explicitly_reviewed) {
      rejected.push({ source_id: source.source_id, reason: "WRITER_VERIFIED_SOURCE_REQUIRED" });
      continue;
    }
    const imageReferenceAvailable = source.images.length > 0;
    const imageContentIsPinned = imageContentPinned(source.images);
    const base = {
      schema_version: "golden-title-v1",
      golden_id: `golden-title:${source.source_id}`,
      release_id: cleanText(releaseId),
      source_feedback_id: source.source_id,
      images: source.images,
      writer_title: source.writer_title,
      validated_sem: null,
      sem_validation_status: "PENDING",
      source: "writer_verified",
      confidence: 1,
      validation_status: "VALIDATED",
      title_truth: true,
      generated_title_snapshot: source.generated_title,
      source_created_at: source.source_created_at,
      benchmark_scope: "TITLE_REGRESSION",
      image_reference_available: imageReferenceAvailable,
      image_content_pinned: imageContentIsPinned,
      image_benchmark_eligible: imageContentIsPinned,
      image_benchmark_blockers: imageReferenceAvailable
        ? imageContentIsPinned ? [] : ["IMAGE_CONTENT_SHA256_REQUIRED"]
        : ["IMAGE_REFERENCE_REQUIRED"],
      identity_group_status: "PENDING",
      training_eligible: false
    };
    items.push({ ...base, content_sha256: feedbackPayloadSha256(base) });
  }
  items.sort((left, right) => left.golden_id.localeCompare(right.golden_id));
  const manifestBase = {
    schema_version: GOLDEN_TITLE_RELEASE_SCHEMA_VERSION,
    release_id: cleanText(releaseId),
    source_policy: cleanText(sourcePolicy) || null,
    source: "writer_verified",
    confidence: 1,
    title_truth: true,
    semantic_truth: false,
    training_eligible: false,
    item_count: items.length,
    image_backed_count: items.filter((item) => item.image_reference_available).length,
    image_reference_count: items.filter((item) => item.image_reference_available).length,
    image_content_pinned_count: items.filter((item) => item.image_content_pinned).length,
    image_benchmark_eligible_count: items.filter((item) => item.image_benchmark_eligible).length,
    sem_validated_count: 0,
    rejected_count: rejected.length,
    item_hashes: items.map((item) => item.content_sha256)
  };
  return {
    ...manifestBase,
    manifest_sha256: feedbackPayloadSha256(manifestBase),
    items,
    rejected
  };
}
