import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  FEEDBACK_DATASET_DISPOSITION,
  feedbackPayloadSha256,
  sha256Hex,
  stableJson
} from "../feedback/feedback-capture.mjs";
import {
  buildErrorDatasetCandidate,
  buildGoldenSemCandidate,
  buildGoldenTitleCandidate
} from "../evaluation/data-asset-projections.mjs";
import {
  isTrustedStorageVerificationImage,
  isTrustedSupabaseDailyBundle
} from "./source-trust.mjs";

export const DAILY_LEARNING_EXPORT_SCHEMA_VERSION = "daily-learning-export-v1";
export const DAILY_SEMANTIC_CANDIDATE_SCHEMA_VERSION = "daily-semantic-candidate-v1";

const DATASET_FILES = Object.freeze({
  feedback: "feedback/events.jsonl",
  semantic: "semantic/candidates.jsonl",
  errors: "errors/candidates.jsonl",
  golden: "golden/candidates.jsonl"
});

const OMIT = Symbol("omit-from-learning-export");
const SENSITIVE_KEY = /(?:^|_)(?:access_?token|refresh_?token|api_?key|service_?role(?:_key)?|authorization|cookie|password|secret|signed_?url|image_?base64|raw_?image)(?:$|_)/i;
const SIGNED_OR_EMBEDDED_URL = /(?:\/storage\/v1\/object\/sign\/|[?&](?:token|signature|x-amz-signature|x-goog-signature|expires)=|^data:)/i;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedExportDate(value) {
  const date = cleanText(value) || new Date().toISOString().slice(0, 10);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || Number.isNaN(parsed.getTime())
      || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("invalid_learning_export_date");
  }
  return date;
}

function scrubExportValue(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return OMIT;
  if (typeof value === "string" && SIGNED_OR_EMBEDDED_URL.test(value)) return OMIT;
  if (Array.isArray(value)) {
    return value.map((child) => scrubExportValue(child)).filter((child) => child !== OMIT);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, child]) => [childKey, scrubExportValue(child, childKey)])
      .filter(([, child]) => child !== OMIT));
  }
  return value;
}

function exportSafe(value) {
  const scrubbed = scrubExportValue(value);
  return scrubbed === OMIT ? null : scrubbed;
}

function recordWithHash(value) {
  const safe = exportSafe(value);
  const { content_sha256: _ignored, ...withoutHash } = plainObject(safe);
  return {
    ...withoutHash,
    content_sha256: feedbackPayloadSha256(withoutHash)
  };
}

function sortedRecords(records, key = "id") {
  return [...records].sort((left, right) => {
    const leftKey = cleanText(left?.[key] || left?.candidate_id || left?.content_sha256);
    const rightKey = cleanText(right?.[key] || right?.candidate_id || right?.content_sha256);
    return leftKey.localeCompare(rightKey);
  });
}

function feedbackRevision(value) {
  const revision = Number(value?.feedback_revision ?? value?.revision);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

function latestFeedbackEvents(records = []) {
  const latest = new Map();
  const seenRevisions = new Map();
  for (const event of records) {
    const sessionId = cleanText(event?.recognition_session_id) || `event:${cleanText(event?.id)}`;
    const revision = feedbackRevision(event);
    if (revision !== null) {
      const revisionKey = `${sessionId}:${revision}`;
      const priorId = seenRevisions.get(revisionKey);
      if (priorId && priorId !== cleanText(event?.id)) {
        throw new Error(`feedback_revision_conflict:${sessionId}:${revision}`);
      }
      seenRevisions.set(revisionKey, cleanText(event?.id));
    }
    const prior = latest.get(sessionId);
    if (!prior) {
      latest.set(sessionId, event);
      continue;
    }
    const priorRevision = feedbackRevision(prior);
    const eventTime = Date.parse(event?.received_at || event?.created_at || "");
    const priorTime = Date.parse(prior?.received_at || prior?.created_at || "");
    const eventTimestamp = Number.isFinite(eventTime) ? eventTime : Number.NEGATIVE_INFINITY;
    const priorTimestamp = Number.isFinite(priorTime) ? priorTime : Number.NEGATIVE_INFINITY;
    const isLater = revision !== null && priorRevision !== null
      ? revision > priorRevision
      : eventTimestamp !== priorTimestamp
        ? eventTimestamp > priorTimestamp
        : cleanText(event?.id).localeCompare(cleanText(prior?.id)) > 0;
    if (isLater) latest.set(sessionId, event);
  }
  return sortedRecords([...latest.values()]);
}

function uniqueProjectedRecords(records = [], kind = "projection") {
  const seen = new Map();
  for (const record of records) {
    const id = cleanText(record?.candidate_id || record?.id);
    if (!id) throw new Error(`${kind}_candidate_id_required`);
    const digest = feedbackPayloadSha256(record);
    if (seen.has(id) && seen.get(id) !== digest) {
      throw new Error(`${kind}_candidate_payload_conflict:${id}`);
    }
    if (seen.has(id)) throw new Error(`${kind}_candidate_duplicate:${id}`);
    seen.set(id, digest);
  }
  return records;
}

function uniqueSourceRecords(records, kind) {
  const seen = new Map();
  for (const record of arrayValue(records)) {
    const id = cleanText(record?.id);
    if (!id) throw new Error(`${kind}_id_required`);
    const digest = feedbackPayloadSha256(record);
    if (seen.has(id) && seen.get(id).digest !== digest) {
      throw new Error(`${kind}_id_payload_conflict:${id}`);
    }
    if (!seen.has(id)) seen.set(id, { digest, record });
  }
  return sortedRecords([...seen.values()].map(({ record }) => record));
}

function tenantAssetKey(tenantId, assetId) {
  return JSON.stringify([cleanText(tenantId), cleanText(assetId)]);
}

function normalizedImagesByAsset(value = {}) {
  const grouped = new Map();
  if (Array.isArray(value)) {
    for (const image of value) {
      const assetId = cleanText(image?.dataset_asset_id || image?.asset_id);
      const tenantId = cleanText(image?.tenant_id);
      if (!assetId || !tenantId) continue;
      const key = tenantAssetKey(tenantId, assetId);
      grouped.set(key, [...(grouped.get(key) || []), image]);
    }
    return grouped;
  }
  for (const [assetId, images] of Object.entries(plainObject(value))) {
    const rows = arrayValue(images);
    const first = plainObject(rows[0]);
    const tenantId = cleanText(first.tenant_id);
    const datasetAssetId = cleanText(first.dataset_asset_id || assetId);
    const key = assetId.startsWith("[")
      ? assetId
      : tenantId && datasetAssetId
        ? tenantAssetKey(tenantId, datasetAssetId)
        : cleanText(assetId);
    grouped.set(key, rows);
  }
  return grouped;
}

function feedbackAssetId(feedbackEvent = {}) {
  return cleanText(
    feedbackEvent.asset_id
    || feedbackEvent.recognition_result?.asset_id
    || feedbackEvent.writer_feedback?.asset_id
  );
}

function feedbackTenantId(feedbackEvent = {}) {
  return cleanText(
    feedbackEvent.tenant_id
    || feedbackEvent.recognition_result?.tenant_id
    || feedbackEvent.writer_feedback?.tenant_id
  );
}

function feedbackImageReferences(feedbackEvent = {}) {
  const recognition = plainObject(feedbackEvent.recognition_result);
  const dataIdentity = plainObject(recognition.data_identity);
  return arrayValue(dataIdentity.image_references);
}

function safeImagesFor({ tenantId = "", assetId = "", imagesByAsset = new Map(), additionalImages = [] } = {}) {
  const images = [
    ...arrayValue(imagesByAsset.get(tenantAssetKey(tenantId, assetId))),
    ...arrayValue(additionalImages)
  ]
    .map((image) => isTrustedStorageVerificationImage(image)
      ? image
      : {
        ...plainObject(image),
        object_verified: false,
        content_hash_verified: false,
        verified_at: null,
        storage_verification_source: null,
        storage_verification_record_key: null,
        storage_verification_record_sha256: null
      });
  const unique = new Map();
  for (const image of images) {
    const bucket = cleanText(image?.bucket);
    const objectPath = cleanText(image?.object_path || image?.path);
    const contentSha256 = cleanText(image?.content_sha256).toLowerCase();
    const key = objectPath
      ? ["storage", bucket || "<unscoped>", objectPath].join(":")
      : contentSha256
        ? ["sha256", contentSha256].join(":")
        : "";
    if (!key) continue;
    const existing = unique.get(key);
    const existingHash = cleanText(existing?.content_sha256).toLowerCase();
    if (existing && existingHash && contentSha256 && existingHash !== contentSha256) {
      throw new Error(`image_reference_content_conflict:${objectPath || key}`);
    }
    unique.set(key, existing ? {
      ...existing,
      ...image,
      bucket: cleanText(existing.bucket) || bucket || null,
      object_path: objectPath || cleanText(existing.object_path || existing.path) || null,
      content_sha256: existingHash || contentSha256 || null,
      object_verified: existing.object_verified === true || image?.object_verified === true,
      content_hash_verified: existing.content_hash_verified === true || image?.content_hash_verified === true,
      storage_etag: cleanText(existing.storage_etag || existing.etag || image?.storage_etag || image?.etag) || null,
      verified_at: cleanText(existing.verified_at || image?.verified_at) || null,
      storage_verification_source: cleanText(
        existing.storage_verification_source || image?.storage_verification_source
      ) || null,
      storage_verification_record_key: cleanText(
        existing.storage_verification_record_key || image?.storage_verification_record_key
      ) || null,
      storage_verification_record_sha256: cleanText(
        existing.storage_verification_record_sha256 || image?.storage_verification_record_sha256
      ) || null
    } : image);
  }
  return [...unique.values()].sort((left, right) => [
    cleanText(left?.bucket),
    cleanText(left?.object_path || left?.path),
    cleanText(left?.content_sha256)
  ].join("\u001f").localeCompare([
    cleanText(right?.bucket),
    cleanText(right?.object_path || right?.path),
    cleanText(right?.content_sha256)
  ].join("\u001f")));
}

function exportFeedbackEvent(feedbackEvent = {}) {
  const recognition = plainObject(feedbackEvent.recognition_result);
  const writerFeedback = plainObject(feedbackEvent.writer_feedback);
  const value = {
    schema_version: cleanText(feedbackEvent.schema_version) || "v4-writer-feedback-capture-v1",
    id: cleanText(feedbackEvent.id),
    submission_id: cleanText(feedbackEvent.submission_id) || null,
    recognition_session_id: cleanText(feedbackEvent.recognition_session_id) || null,
    tenant_id: cleanText(feedbackEvent.tenant_id || writerFeedback.tenant_id || recognition.tenant_id) || null,
    user_id: cleanText(feedbackEvent.user_id || writerFeedback.user_id || recognition.user_id) || null,
    asset_id: feedbackAssetId(feedbackEvent) || null,
    action: cleanText(feedbackEvent.action || writerFeedback.action).toUpperCase(),
    ai_title: cleanText(recognition.ai_title || feedbackEvent.generated_title) || null,
    writer_final_title: cleanText(
      writerFeedback.final_title || feedbackEvent.writer_raw_title || feedbackEvent.writer_final_title
    ) || null,
    writer_normalized_title: cleanText(feedbackEvent.writer_normalized_title || writerFeedback.normalized_title) || null,
    model_version: cleanText(feedbackEvent.model_version || recognition.model_version) || null,
    prompt_version: cleanText(feedbackEvent.prompt_version || recognition.prompt_version) || null,
    recognition_result: {
      schema_version: cleanText(recognition.schema_version) || null,
      result_id: cleanText(recognition.result_id) || null,
      recognition_session_id: cleanText(recognition.recognition_session_id) || null,
      tenant_id: cleanText(recognition.tenant_id) || null,
      user_id: cleanText(recognition.user_id) || null,
      asset_id: cleanText(recognition.asset_id) || null,
      client_asset_ref: cleanText(recognition.client_asset_ref) || null,
      asset_fingerprint: cleanText(recognition.asset_fingerprint) || null,
      data_identity: plainObject(recognition.data_identity),
      recognition_schema_version: cleanText(recognition.recognition_schema_version) || null,
      sem_standard_version: cleanText(recognition.sem_standard_version) || null,
      ai_title: cleanText(recognition.ai_title) || null,
      ai_sem: plainObject(recognition.ai_sem),
      model_version: cleanText(recognition.model_version) || null,
      prompt_version: cleanText(recognition.prompt_version) || null,
      generation_manifest: plainObject(recognition.generation_manifest),
      result_sha256: cleanText(recognition.result_sha256) || null
    },
    writer_feedback: {
      schema_version: cleanText(writerFeedback.schema_version) || null,
      submission_id: cleanText(writerFeedback.submission_id) || null,
      tenant_id: cleanText(writerFeedback.tenant_id) || null,
      user_id: cleanText(writerFeedback.user_id) || null,
      asset_id: cleanText(writerFeedback.asset_id) || null,
      action: cleanText(writerFeedback.action).toUpperCase() || null,
      final_title: cleanText(writerFeedback.final_title) || null,
      raw_input_title: cleanText(writerFeedback.raw_input_title) || null,
      normalized_title: cleanText(writerFeedback.normalized_title) || null,
      operator_id: cleanText(writerFeedback.operator_id) || null,
      client_occurred_at: cleanText(writerFeedback.client_occurred_at) || null
    },
    title_diff: plainObject(feedbackEvent.title_diff),
    diff_algorithm_version: cleanText(feedbackEvent.diff_algorithm_version) || null,
    revision: Number.isFinite(Number(feedbackEvent.feedback_revision ?? feedbackEvent.revision))
      ? Number(feedbackEvent.feedback_revision ?? feedbackEvent.revision)
      : null,
    previous_feedback_event_id: cleanText(feedbackEvent.previous_feedback_event_id) || null,
    client_occurred_at: cleanText(feedbackEvent.client_occurred_at) || null,
    received_at: cleanText(feedbackEvent.received_at || feedbackEvent.created_at) || null,
    source: "writer_feedback",
    dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
    training_eligible: false
  };
  return recordWithHash(value);
}

function extractionFromLearning(learningEvent = {}, feedbackEvent = {}) {
  return plainObject(learningEvent.sem_extraction || feedbackEvent.sem_extraction);
}

function exportSemanticCandidate(learningEvent = {}, feedbackEvent = {}, validationEvent = {}) {
  const action = cleanText(feedbackEvent.action || feedbackEvent.writer_feedback?.action).toUpperCase();
  if (action === "REJECT") return null;
  const extraction = extractionFromLearning(learningEvent, feedbackEvent);
  if (!Object.keys(extraction).length) return null;
  const recordedValidation = plainObject(validationEvent);
  const validation = Object.keys(recordedValidation).length
    ? recordedValidation
    : plainObject(learningEvent.sem_validation || extraction.validation);
  const recognition = plainObject(feedbackEvent.recognition_result);
  const writerFeedback = plainObject(feedbackEvent.writer_feedback);
  const candidate = {
    schema_version: DAILY_SEMANTIC_CANDIDATE_SCHEMA_VERSION,
    candidate_id: `semantic:${cleanText(learningEvent.id || feedbackEvent.id)}`,
    source_learning_event_id: cleanText(learningEvent.id) || null,
    source_feedback_event_id: cleanText(learningEvent.feedback_event_id || feedbackEvent.id) || null,
    recognition_result_id: cleanText(recognition.result_id) || null,
    asset_id: feedbackAssetId(feedbackEvent) || null,
    writer_title: cleanText(
      writerFeedback.final_title
      || feedbackEvent.writer_raw_title
      || learningEvent.writer_final_title
    ) || null,
    semantic_candidate: plainObject(extraction.candidate_sem || extraction.sem),
    validated_sem: plainObject(recordedValidation.validated_sem),
    extraction: extraction,
    validation: validation,
    validation_status: cleanText(
      recordedValidation.validation_status
      || extraction.validation_status
      || extraction.status
      || validation.validation_status
      || validation.status
    ).toUpperCase() || "PENDING",
    confidence: Number.isFinite(Number(recordedValidation.confidence ?? extraction.confidence))
      ? Number(recordedValidation.confidence ?? extraction.confidence)
      : null,
    source: "writer_verified_title_parser",
    title_truth: true,
    semantic_truth: cleanText(recordedValidation.validation_status).toUpperCase() === "VALIDATED"
      && recordedValidation.semantic_truth === true,
    dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
    training_eligible: false
  };
  return recordWithHash(candidate);
}

function exportedErrorCandidate(feedbackEvent = {}, learningEvent = {}) {
  const candidate = buildErrorDatasetCandidate({
    feedbackEvent,
    semExtraction: extractionFromLearning(learningEvent, feedbackEvent)
  });
  if (!candidate) return null;
  return recordWithHash({
    ...candidate,
    source_learning_event_id: cleanText(learningEvent.id) || null,
    dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
    training_eligible: false
  });
}

function historicalWriterTitleFeedback(row = {}) {
  const writerTitle = cleanText(row.writer_verified_title || row.writer_title || row.title);
  if (!writerTitle) return null;
  const assetId = cleanText(row.asset_id);
  const sourceId = cleanText(row.id || row.source_id)
    || feedbackPayloadSha256({ asset_id: assetId, writer_verified_title: writerTitle }).slice(0, 32);
  return {
    id: `writer_verified_title_${sourceId}`,
    action: "ACCEPT",
    tenant_id: cleanText(row.tenant_id) || null,
    asset_id: assetId || null,
    writer_raw_title: writerTitle,
    recognition_result: {
      result_id: cleanText(row.recognition_result_id) || null,
      tenant_id: cleanText(row.tenant_id) || null,
      asset_id: assetId || null,
      ai_title: null,
      ai_sem: {},
      model_version: null,
      prompt_version: null
    },
    writer_feedback: {
      action: "ACCEPT",
      tenant_id: cleanText(row.tenant_id) || null,
      asset_id: assetId || null,
      final_title: writerTitle,
      raw_input_title: writerTitle
    },
    source: "writer_verified"
  };
}

function jsonl(records) {
  return records.length ? `${records.map((record) => stableJson(record)).join("\n")}\n` : "";
}

export function buildDailyLearningExport(bundle = {}, { date, generatedAt } = {}) {
  const exportDate = normalizedExportDate(date);
  const generatedAtIso = cleanText(generatedAt) || new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAtIso))) throw new Error("invalid_learning_export_generated_at");
  const trustedSupabaseBundle = isTrustedSupabaseDailyBundle(bundle);

  const feedbackEvents = uniqueSourceRecords(bundle.feedback_events, "feedback_event");
  const learningEvents = uniqueSourceRecords(bundle.learning_events, "learning_event");
  const validationEvents = uniqueSourceRecords(bundle.sem_validation_events, "sem_validation_event");
  const recognitionSessions = uniqueSourceRecords(bundle.recognition_sessions, "recognition_session");
  const sessionById = new Map(
    recognitionSessions.map((session) => [cleanText(session.id), session])
  );
  const currentValidation = (validation, learning, feedback) => {
    if (!validation || !Object.keys(validation).length) return {};
    const session = sessionById.get(cleanText(feedback?.recognition_session_id));
    if (!session) return recognitionSessions.length ? {} : validation;
    return cleanText(session.writer_feedback_event_id) === cleanText(feedback?.id)
      && cleanText(session.learning_event_id) === cleanText(learning?.id)
      && cleanText(validation.feedback_event_id) === cleanText(feedback?.id)
      && cleanText(validation.learning_event_id) === cleanText(learning?.id)
      && cleanText(validation.recognition_session_id) === cleanText(session.id)
      ? validation
      : {};
  };
  const imagesByAsset = normalizedImagesByAsset(bundle.images_by_asset);
  const feedbackById = new Map(feedbackEvents.map((event) => [cleanText(event.id), event]));
  const learningByFeedbackId = new Map();
  for (const event of learningEvents) {
    const feedbackId = cleanText(event.feedback_event_id);
    if (!feedbackId) continue;
    learningByFeedbackId.set(feedbackId, [...(learningByFeedbackId.get(feedbackId) || []), event]);
  }
  const validationByLearningId = new Map();
  for (const event of validationEvents) {
    const learningId = cleanText(event.learning_event_id);
    if (!learningId) continue;
    validationByLearningId.set(learningId, [
      ...(validationByLearningId.get(learningId) || []),
      event
    ]);
  }

  const feedback = feedbackEvents.map(exportFeedbackEvent);
  const semantic = [];
  const errors = [];
  for (const learningEvent of learningEvents) {
    const feedbackEvent = feedbackById.get(cleanText(learningEvent.feedback_event_id)) || {};
    const recordedValidation = sortedRecords(
      validationByLearningId.get(cleanText(learningEvent.id)) || [],
      "created_at"
    ).at(-1) || {};
    const validationEvent = currentValidation(recordedValidation, learningEvent, feedbackEvent);
    const semanticCandidate = exportSemanticCandidate(learningEvent, feedbackEvent, validationEvent);
    if (semanticCandidate) semantic.push(semanticCandidate);
    const errorCandidate = Object.keys(feedbackEvent).length
      ? exportedErrorCandidate(feedbackEvent, learningEvent)
      : null;
    if (errorCandidate) errors.push(errorCandidate);
  }

  const golden = [];
  for (const feedbackEvent of latestFeedbackEvents(feedbackEvents)) {
    const currentSession = sessionById.get(cleanText(feedbackEvent.recognition_session_id));
    if (recognitionSessions.length
        && (
          !currentSession
          || cleanText(currentSession.writer_feedback_event_id) !== cleanText(feedbackEvent.id)
        )) {
      continue;
    }
    const matchingLearning = sortedRecords(
      learningByFeedbackId.get(cleanText(feedbackEvent.id)) || [],
      "created_at"
    );
    const latestLearning = currentSession
      ? matchingLearning.find((event) => (
        cleanText(event.id) === cleanText(currentSession.learning_event_id)
      )) || {}
      : matchingLearning.at(-1) || {};
    const selectedValidation = sortedRecords(
      validationByLearningId.get(cleanText(latestLearning.id)) || [],
      "created_at"
    ).at(-1) || {};
    const latestValidation = currentValidation(selectedValidation, latestLearning, feedbackEvent);
    const images = safeImagesFor({
      tenantId: feedbackTenantId(feedbackEvent),
      assetId: feedbackAssetId(feedbackEvent),
      imagesByAsset,
      additionalImages: [
        ...arrayValue(feedbackEvent.images),
        ...feedbackImageReferences(feedbackEvent)
      ]
    });
    const titleCandidate = buildGoldenTitleCandidate({
      feedbackEvent,
      semExtraction: extractionFromLearning(latestLearning, feedbackEvent),
      images
    });
    if (titleCandidate) {
      golden.push(recordWithHash({
        ...titleCandidate,
        asset_kind: "GOLDEN_TITLE",
        dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
        training_eligible: false
      }));
    }
    const semCandidate = buildGoldenSemCandidate({
      feedbackEvent,
      reviewedSem: latestValidation.validated_sem || latestLearning.reviewed_sem,
      review: Object.keys(latestValidation).length ? {
        status: latestValidation.validation_status,
        confidence: latestValidation.confidence,
        reviewed_by: latestValidation.reviewed_by,
        reviewed_at: latestValidation.reviewed_at,
        evidence_sources: latestValidation.validation_sources,
        semantic_truth: latestValidation.semantic_truth,
        golden_sem_candidate: latestValidation.golden_sem_candidate,
        sem_standard_version: latestValidation.sem_standard_version,
        parser_version: latestValidation.parser_version
      } : latestLearning.sem_review || latestLearning.review,
      images,
      identityGroupId: latestValidation.identity_group_id || latestLearning.identity_group_id
    });
    if (semCandidate) {
      golden.push(recordWithHash({
        ...semCandidate,
        asset_kind: "GOLDEN_SEM",
        dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
        training_eligible: false
      }));
    }
  }

  for (const row of arrayValue(bundle.writer_verified_titles)) {
    const feedbackEvent = historicalWriterTitleFeedback(row);
    if (!feedbackEvent) continue;
    const images = safeImagesFor({
      tenantId: feedbackTenantId(feedbackEvent),
      assetId: feedbackAssetId(feedbackEvent),
      imagesByAsset,
      additionalImages: row.images || (row.image ? [row.image] : [])
    });
    const titleCandidate = buildGoldenTitleCandidate({
      feedbackEvent,
      semExtraction: plainObject(row.sem_extraction),
      images
    });
    if (titleCandidate) {
      golden.push(recordWithHash({
        ...titleCandidate,
        asset_kind: "GOLDEN_TITLE",
        dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
        training_eligible: false
      }));
    }
  }

  const datasets = {
    feedback: sortedRecords(feedback),
    semantic: sortedRecords(uniqueProjectedRecords(semantic, "semantic"), "candidate_id"),
    errors: sortedRecords(uniqueProjectedRecords(errors, "error"), "candidate_id"),
    golden: sortedRecords(uniqueProjectedRecords(golden, "golden"), "candidate_id")
  };
  const goldenTitleCount = datasets.golden.filter((row) => row.asset_kind === "GOLDEN_TITLE").length;
  const goldenSemCount = datasets.golden.filter((row) => row.asset_kind === "GOLDEN_SEM").length;
  const manifest = {
    schema_version: DAILY_LEARNING_EXPORT_SCHEMA_VERSION,
    export_date: exportDate,
    generated_at: new Date(generatedAtIso).toISOString(),
    input_scope: cleanText(bundle.input_scope) || "CALLER_PROVIDED_BUNDLE",
    source_trust: {
      supabase_loader_verified: trustedSupabaseBundle,
      storage_verification_proof: trustedSupabaseBundle
        ? "IN_PROCESS_SUPABASE_LOADER_PROOF_V1"
        : "UNTRUSTED_CALLER_INPUT"
    },
    dependency_closure: plainObject(bundle.dependency_closure),
    dataset_disposition: FEEDBACK_DATASET_DISPOSITION,
    counts: {
      feedback: datasets.feedback.length,
      semantic: datasets.semantic.length,
      errors: datasets.errors.length,
      golden: datasets.golden.length,
      golden_title: goldenTitleCount,
      golden_sem: goldenSemCount,
      sem_validation_events: validationEvents.length,
      recognition_sessions: recognitionSessions.length
    },
    ground_truth_contract: {
      writer_verified_titles_are_title_truth: true,
      parsed_sem_is_field_truth: false,
      golden_title_source: "writer_verified",
      training_eligible: false
    },
    privacy: {
      signed_urls_included: false,
      embedded_images_included: false,
      credentials_included: false,
      image_reference_policy: "durable_listing_image_verification_record_required_for_freeze"
    }
  };

  return { date: exportDate, datasets, manifest };
}

export async function writeDailyLearningExport({ bundle = {}, outRoot = "learning", date, generatedAt } = {}) {
  const built = buildDailyLearningExport(bundle, { date, generatedAt });
  const destination = resolve(outRoot, built.date);
  await mkdir(destination, { recursive: true });
  await rm(join(destination, "manifest.json"), { force: true });

  const files = {};
  for (const [dataset, relativePath] of Object.entries(DATASET_FILES)) {
    const finalPath = join(destination, relativePath);
    const temporaryPath = `${finalPath}.tmp-${process.pid}`;
    const content = jsonl(built.datasets[dataset]);
    await mkdir(resolve(finalPath, ".."), { recursive: true });
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, finalPath);
    files[dataset] = {
      path: relativePath,
      rows: built.datasets[dataset].length,
      bytes: Buffer.byteLength(content),
      sha256: sha256Hex(content)
    };
  }

  const manifest = exportSafe({ ...built.manifest, files });
  const manifestPath = join(destination, "manifest.json");
  const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(temporaryManifestPath, `${stableJson(manifest)}\n`, "utf8");
  await rename(temporaryManifestPath, manifestPath);

  return {
    destination,
    files: Object.fromEntries(Object.entries(files).map(([dataset, file]) => [dataset, join(destination, file.path)])),
    manifest_path: manifestPath,
    manifest
  };
}
