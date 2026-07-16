import { readV4Rows } from "../v4/session/supabase-rest.mjs";
import { feedbackPayloadSha256 } from "../feedback/feedback-capture.mjs";
import {
  markTrustedStorageVerificationImage,
  markTrustedSupabaseDailyBundle
} from "./source-trust.mjs";

const ID_BATCH_SIZE = 100;

function cleanText(value) {
  return String(value ?? "").trim();
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))].sort();
}

function dateRange(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(date))) throw new Error("invalid_daily_learning_export_date");
  const start = `${date}T00:00:00.000Z`;
  const endDate = new Date(start);
  if (Number.isNaN(endDate.getTime()) || endDate.toISOString().slice(0, 10) !== date) {
    throw new Error("invalid_daily_learning_export_date");
  }
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  return { start, end: endDate.toISOString() };
}

function quotedPostgrestId(value) {
  return `"${cleanText(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function idFilter(ids = []) {
  return `in.(${ids.map(quotedPostgrestId).join(",")})`;
}

function rowsById(rows = []) {
  return new Map(rows.map((row) => [cleanText(row?.id), row]).filter(([id]) => id));
}

function tenantAssetKey(tenantId, assetId) {
  return JSON.stringify([cleanText(tenantId), cleanText(assetId)]);
}

export async function readAllSupabaseRows({
  table,
  select = "*",
  search = {},
  readRows,
  pageSize,
  requireExactCount,
  identityField = "id",
  identityFields = null
}) {
  const rows = [];
  const seenIds = new Set();
  let offset = 0;
  let expectedCount = null;
  for (let page = 0; page < 100_000; page += 1) {
    const result = await readRows({
      table,
      select,
      count: "exact",
      search: {
        ...search,
        limit: String(pageSize),
        offset: String(offset)
      }
    });
    if (!result.ok) throw new Error(`daily_learning_source_read_failed:${table}:${result.error || "unknown_error"}`);
    const reportedCount = Number.isSafeInteger(result.count) && result.count >= 0 ? result.count : null;
    if (requireExactCount && reportedCount === null) {
      throw new Error(`daily_learning_source_count_required:${table}`);
    }
    if (reportedCount !== null) {
      if (expectedCount !== null && reportedCount !== expectedCount) {
        throw new Error(`daily_learning_source_changed_during_export:${table}`);
      }
      expectedCount = reportedCount;
    }
    const pageRows = Array.isArray(result.rows) ? result.rows : [];
    for (const row of pageRows) {
      const fields = Array.isArray(identityFields) && identityFields.length
        ? identityFields
        : [identityField];
      const identityParts = fields.map((field) => cleanText(row?.[field]));
      const id = identityParts.join("\u001f");
      if (identityParts.some((part) => !part)) throw new Error(
        ["daily_learning_source_row_identity_required", table, fields.join(",")].join(":")
      );
      if (seenIds.has(id)) throw new Error(`daily_learning_source_page_overlap:${table}:${id}`);
      seenIds.add(id);
      rows.push(row);
    }
    offset += pageRows.length;
    if (expectedCount !== null) {
      if (offset === expectedCount) return rows;
      if (offset > expectedCount || pageRows.length === 0) {
        throw new Error(`daily_learning_source_incomplete:${table}:${offset}/${expectedCount}`);
      }
      continue;
    }
    if (pageRows.length < pageSize) return rows;
  }
  throw new Error(`daily_learning_source_pagination_limit:${table}`);
}

async function readRequiredRowsByIds({ table, ids, readRows, pageSize, requireExactCount }) {
  const requested = unique(ids);
  if (!requested.length) return [];
  const rows = [];
  for (let offset = 0; offset < requested.length; offset += ID_BATCH_SIZE) {
    const batch = requested.slice(offset, offset + ID_BATCH_SIZE);
    rows.push(...await readAllSupabaseRows({
      table,
      search: { id: idFilter(batch), order: "id.asc" },
      readRows,
      pageSize: Math.min(pageSize, batch.length),
      requireExactCount
    }));
  }
  const found = rowsById(rows);
  const missing = requested.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`daily_learning_dependency_missing:${table}:${missing.join(",")}`);
  return requested.map((id) => found.get(id));
}

async function readRowsByValues({
  table,
  field,
  values,
  select = "*",
  readRows,
  pageSize,
  requireExactCount,
  identityFields = null
}) {
  const requested = unique(values);
  if (!requested.length) return [];
  const rows = [];
  for (let offset = 0; offset < requested.length; offset += ID_BATCH_SIZE) {
    const batch = requested.slice(offset, offset + ID_BATCH_SIZE);
    rows.push(...await readAllSupabaseRows({
      table,
      select,
      search: {
        [field]: idFilter(batch),
        order: field + ".asc"
      },
      readRows,
      pageSize: Math.min(pageSize, batch.length),
      requireExactCount,
      identityField: field,
      identityFields
    }));
  }
  return rows;
}

function mergeUniqueRows(primary = [], dependencies = []) {
  const merged = rowsById(primary);
  for (const row of dependencies) {
    const id = cleanText(row?.id);
    if (!id) continue;
    if (merged.has(id)
        && feedbackPayloadSha256(merged.get(id)) !== feedbackPayloadSha256(row)) {
      throw new Error(`daily_learning_dependency_payload_conflict:${id}`);
    }
    if (!merged.has(id)) merged.set(id, row);
  }
  return [...merged.values()].sort((left, right) => cleanText(left.id).localeCompare(cleanText(right.id)));
}

export async function loadSupabaseDailyLearningBundle({
  date,
  readRows = readV4Rows,
  pageSize = 500,
  requireExactCount = readRows === readV4Rows
} = {}) {
  const { start, end } = dateRange(date);
  const boundedPageSize = Math.max(1, Math.min(1000, Number(pageSize) || 500));
  const [dailyFeedback, dailyLearning, validations] = await Promise.all([
    readAllSupabaseRows({
      table: "v4_writer_feedback_events",
      search: { and: `(received_at.gte.${start},received_at.lt.${end})`, order: "received_at.asc,id.asc" },
      readRows,
      pageSize: boundedPageSize,
      requireExactCount
    }),
    readAllSupabaseRows({
      table: "v4_learning_events",
      search: {
        and: `(created_at.gte.${start},created_at.lt.${end})`,
        event_type: "in.(WRITER_ACCEPT,WRITER_EDIT,WRITER_REJECT)",
        order: "created_at.asc,id.asc"
      },
      readRows,
      pageSize: boundedPageSize,
      requireExactCount
    }),
    readAllSupabaseRows({
      table: "v4_sem_validation_events",
      search: { and: `(created_at.gte.${start},created_at.lt.${end})`, order: "created_at.asc,id.asc" },
      readRows,
      pageSize: boundedPageSize,
      requireExactCount
    })
  ]);
  const dailyLearningIds = new Set(unique(dailyLearning.map((row) => row.id)));
  const referencedLearningIds = unique(validations.map((row) => row.learning_event_id));
  const dependencyLearningIds = referencedLearningIds.filter((id) => !dailyLearningIds.has(id));
  const dependencyLearning = await readRequiredRowsByIds({
    table: "v4_learning_events",
    ids: dependencyLearningIds,
    readRows,
    pageSize: boundedPageSize,
    requireExactCount
  });
  const allLearning = mergeUniqueRows(dailyLearning, dependencyLearning);

  const dailyFeedbackIds = new Set(unique(dailyFeedback.map((row) => row.id)));
  const referencedFeedbackIds = unique([
    ...allLearning.map((row) => row.feedback_event_id),
    ...validations.map((row) => row.feedback_event_id)
  ]);
  const dependencyFeedbackIds = referencedFeedbackIds.filter((id) => !dailyFeedbackIds.has(id));
  const dependencyFeedback = await readRequiredRowsByIds({
    table: "v4_writer_feedback_events",
    ids: dependencyFeedbackIds,
    readRows,
    pageSize: boundedPageSize,
    requireExactCount
  });
  let allFeedback = mergeUniqueRows(dailyFeedback, dependencyFeedback);

  const sessionIds = unique([
    ...allFeedback.map((row) => row.recognition_session_id),
    ...allLearning.map((row) => row.recognition_session_id),
    ...validations.map((row) => row.recognition_session_id)
  ]);
  const recognitionSessions = await readRequiredRowsByIds({
    table: "v4_recognition_sessions",
    ids: sessionIds,
    readRows,
    pageSize: boundedPageSize,
    requireExactCount
  });

  const currentFeedbackIds = unique(recognitionSessions.map((row) => row.writer_feedback_event_id));
  const currentLearningIds = unique(recognitionSessions.map((row) => row.learning_event_id));
  const currentFeedbackDependencies = await readRequiredRowsByIds({
    table: "v4_writer_feedback_events",
    ids: currentFeedbackIds.filter((id) => !rowsById(allFeedback).has(id)),
    readRows,
    pageSize: boundedPageSize,
    requireExactCount
  });
  const currentLearningDependencies = await readRequiredRowsByIds({
    table: "v4_learning_events",
    ids: currentLearningIds.filter((id) => !rowsById(allLearning).has(id)),
    readRows,
    pageSize: boundedPageSize,
    requireExactCount
  });
  allFeedback = mergeUniqueRows(allFeedback, currentFeedbackDependencies);
  const currentLearningClosure = mergeUniqueRows(allLearning, currentLearningDependencies);

  const imageReferences = allFeedback.flatMap((feedback) => {
    const recognition = feedback?.recognition_result && typeof feedback.recognition_result === "object"
      ? feedback.recognition_result
      : {};
    const identity = recognition.data_identity && typeof recognition.data_identity === "object"
      ? recognition.data_identity
      : {};
    const datasetAssetId = cleanText(feedback.asset_id || recognition.asset_id);
    return (Array.isArray(identity.image_references) ? identity.image_references : [])
      .map((image) => ({
        ...image,
        tenant_id: cleanText(feedback.tenant_id || recognition.tenant_id),
        dataset_asset_id: datasetAssetId,
        asset_id: datasetAssetId,
        client_asset_ref: cleanText(
          identity.client_asset_ref
          || recognition.client_asset_ref
          || feedback.client_asset_ref
        ) || null
      }));
  });
  const verificationRows = await readRowsByValues({
    table: "listing_image_verifications",
    field: "object_path",
    values: imageReferences.map((image) => image.object_path),
    select: "tenant_id,object_path,bucket,asset_id,image_id,storage_role,content_type,size,width,height,content_sha256,object_verified,content_hash_verified,dimension_source,verified_at,updated_at",
    readRows,
    pageSize: boundedPageSize,
    requireExactCount,
    identityFields: ["tenant_id", "bucket", "object_path"]
  });
  const verificationByStorageKey = new Map(verificationRows.map((row) => [[
    cleanText(row.tenant_id),
    cleanText(row.bucket),
    cleanText(row.object_path)
  ].join("\u001f"), row]));
  const imagesByAsset = {};
  for (const reference of imageReferences) {
    const datasetAssetId = cleanText(reference.dataset_asset_id);
    const tenantId = cleanText(reference.tenant_id);
    if (!datasetAssetId || !tenantId) continue;
    const key = [
      cleanText(reference.tenant_id),
      cleanText(reference.bucket),
      cleanText(reference.object_path)
    ].join("\u001f");
    const verification = verificationByStorageKey.get(key);
    const referencedHash = cleanText(reference.content_sha256).toLowerCase();
    const verifiedHash = cleanText(verification?.content_sha256).toLowerCase();
    const proofValid = Boolean(
      verification
      && verification.object_verified === true
      && verification.content_hash_verified === true
      && cleanText(verification.asset_id) === cleanText(reference.asset_id)
      && /^[0-9a-f]{64}$/.test(verifiedHash)
      && (!referencedHash || referencedHash === verifiedHash)
      && Number.isFinite(Date.parse(cleanText(verification.verified_at)))
    );
    const proofRecord = proofValid ? {
      source_table: "listing_image_verifications",
      record_key: key,
      tenant_id: cleanText(verification.tenant_id),
      bucket: cleanText(verification.bucket),
      object_path: cleanText(verification.object_path),
      content_sha256: verifiedHash,
      object_verified: true,
      content_hash_verified: true,
      verified_at: cleanText(verification.verified_at),
      record_sha256: feedbackPayloadSha256(verification)
    } : null;
    const exportedImage = markTrustedStorageVerificationImage({
      ...reference,
      content_sha256: proofValid ? verifiedHash : referencedHash || null,
      object_verified: proofValid,
      content_hash_verified: proofValid,
      verified_at: proofRecord?.verified_at || null,
      storage_verification_source: proofRecord?.source_table || null,
      storage_verification_record_key: proofRecord?.record_key || null,
      storage_verification_record_sha256: proofRecord?.record_sha256 || null
    });
    const assetKey = tenantAssetKey(tenantId, datasetAssetId);
    imagesByAsset[assetKey] = [
      ...(imagesByAsset[assetKey] || []),
      exportedImage
    ];
  }

  return markTrustedSupabaseDailyBundle({
    input_scope: "SUPABASE_DAILY_WITH_PARENT_CLOSURE",
    feedback_events: allFeedback,
    learning_events: currentLearningClosure,
    sem_validation_events: validations,
    recognition_sessions: recognitionSessions,
    images_by_asset: imagesByAsset,
    dependency_closure: {
      daily_feedback_events: dailyFeedback.length,
      daily_learning_events: dailyLearning.length,
      daily_sem_validation_events: validations.length,
      parent_feedback_events_loaded: dependencyFeedback.length,
      parent_learning_events_loaded: dependencyLearning.length,
      current_feedback_events_loaded: currentFeedbackDependencies.length,
      current_learning_events_loaded: currentLearningDependencies.length,
      recognition_sessions_loaded: recognitionSessions.length,
      storage_verification_rows_loaded: verificationRows.length
    }
  });
}
