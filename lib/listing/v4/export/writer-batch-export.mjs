import crypto from "node:crypto";
// Writer export only needs the non-streaming browser Workbook API. Keep that
// exact, integrity-checked artifact local so Node-only archive dependencies are
// neither installed nor reachable from the production export path.
import ExcelJS from "../../../vendor/exceljs-browser/exceljs.min.js";
import { listingImageStorageReadiness } from "../../storage/storage-config.mjs";
import { createListingImageSignedReadUrl } from "../../storage/supabase-image-storage.mjs";
import { patchV4Row, writeV4Row, writeV4Rows } from "../session/supabase-rest.mjs";
import { supabaseRestAdminHeaders as supabaseServiceHeaders } from "../../../supabase-service-headers.mjs";

const schemaVersion = "v4-writer-export-batch-v1";
const defaultExportBucket = "listing-card-images";
const workbookMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const maxExportRows = 250;
const maxExportTitleLength = 80;
const imageDisplayWidth = 150;
const imageDisplayHeight = 210;
const imageLoadConcurrency = 4;
const maxExportImageBytes = 25 * 1024 * 1024;
const maxExportWorkbookImageBytes = 128 * 1024 * 1024;
const writerExportTrainingUse = "operational_only_never_training";
const writerExportTrainingAdmission = "requires_independent_persisted_review_event";

function normalizeWriterExportTenantId(value) {
  const tenantId = String(value || "").trim();
  if (!/^tenant_[a-z0-9][a-z0-9_-]{0,62}$/i.test(tenantId)) {
    throw new TypeError("invalid_writer_export_tenant_id");
  }
  return tenantId;
}

function normalizeStorageUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function serviceRoleKey(env = process.env) {
  return String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
}

function safeStorageBucket(bucket, fallback = defaultExportBucket) {
  const candidate = String(bucket || fallback || "").trim();
  if (!candidate || candidate.includes("/") || candidate.includes("..") || !/^[a-zA-Z0-9._-]+$/.test(candidate)) {
    throw new Error("Invalid writer export storage bucket.");
  }
  return candidate;
}

function safeStorageObjectPath(objectPath) {
  const safePath = String(objectPath || "").trim();
  if (!safePath || safePath.includes("..") || safePath.startsWith("/")) {
    throw new Error("Invalid writer export storage path.");
  }
  return safePath;
}

function encodedObjectPath(path) {
  return String(path || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function imageExtensionFromBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return "";
}

function validatedWorkbookImage({ buffer, contentType = "", source = "unknown" } = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!bytes.length || bytes.length > maxExportImageBytes) {
    throw new Error(`Writer export image from ${source} has invalid size.`);
  }
  const detectedExtension = imageExtensionFromBytes(bytes);
  if (!detectedExtension) {
    throw new Error(`Writer export image from ${source} has an unsupported signature.`);
  }
  const declaredExtension = extensionFromContentType(contentType);
  if (declaredExtension && declaredExtension !== detectedExtension) {
    throw new Error(`Writer export image from ${source} has a content-type/signature mismatch.`);
  }
  if (detectedExtension === "webp") {
    throw new Error(`Writer export WebP image from ${source} requires a JPEG or PNG display derivative.`);
  }
  return {
    buffer: bytes,
    contentType: detectedExtension === "jpeg" ? "image/jpeg" : `image/${detectedExtension}`,
    extension: detectedExtension,
    source
  };
}

function dataUrlToImage(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpe?g));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  return validatedWorkbookImage({
    buffer: Buffer.from(match[2], "base64"),
    contentType: mime,
    source: "data_url"
  });
}

function extensionFromContentType(contentType = "") {
  const normalized = String(contentType || "").split(";")[0].toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpeg";
  if (normalized === "image/webp") return "webp";
  return "";
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[String(name).toLowerCase()] || "";
}

async function readStorageObject({
  objectPath,
  bucket,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = listingImageStorageReadiness(env);
  const url = normalizeStorageUrl(config.url);
  const key = serviceRoleKey(env);
  if (!url || !key) throw new Error("Supabase export storage is not configured.");
  const safeBucket = safeStorageBucket(bucket, config.bucket);
  const safePath = safeStorageObjectPath(objectPath);
  const endpoint = `${url}/storage/v1/object/${encodeURIComponent(safeBucket)}/${encodedObjectPath(safePath)}`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: supabaseServiceHeaders(key),
    redirect: "error"
  });
  if (!response.ok) {
    throw new Error(`Storage image download failed: ${response.status}`);
  }
  const contentType = String(headerValue(response.headers, "content-type") || "").split(";")[0].toLowerCase();
  return validatedWorkbookImage({
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
    source: "storage"
  });
}

async function uploadStorageObject({
  objectPath,
  bucket,
  body,
  contentType,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = listingImageStorageReadiness(env);
  const url = normalizeStorageUrl(config.url);
  const key = serviceRoleKey(env);
  if (!url || !key) throw new Error("Supabase export storage is not configured.");
  const safeBucket = safeStorageBucket(bucket, config.bucket);
  const safePath = safeStorageObjectPath(objectPath);
  const endpoint = `${url}/storage/v1/object/${encodeURIComponent(safeBucket)}/${encodedObjectPath(safePath)}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: supabaseServiceHeaders(key, {
      "content-type": contentType || "application/octet-stream",
      "x-upsert": "false"
    }),
    redirect: "error",
    body
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Storage workbook upload failed: ${response.status} ${message.slice(0, 180)}`);
  }
  return { bucket: safeBucket, object_path: safePath };
}

function normalizeImageRef(image = {}) {
  const objectPath = String(image.objectPath || image.object_path || "").trim();
  const bucket = String(image.bucket || "").trim();
  const contentType = String(image.originalType || image.content_type || image.type || "").toLowerCase();
  const embedDataUrl = dataUrlToImage(image.embedDataUrl || image.embed_data_url || "") ? String(image.embedDataUrl || image.embed_data_url) : "";
  const contentSha256 = String(image.contentSha256 || image.content_sha256 || "").trim().toLowerCase();
  return {
    id: String(image.id || "").trim(),
    name: String(image.name || "").trim(),
    type: String(image.type || "").trim(),
    originalType: String(image.originalType || image.original_type || image.content_type || "").trim(),
    width: Number(image.width || image.originalWidth || image.original_width || 0) || null,
    height: Number(image.height || image.originalHeight || image.original_height || 0) || null,
    objectPath,
    object_path: objectPath,
    bucket,
    storageRole: String(image.storageRole || image.storage_role || "").trim(),
    storageVerified: Boolean(image.storageVerified || image.storage_verified),
    contentSha256: /^[0-9a-f]{64}$/.test(contentSha256) ? contentSha256 : "",
    embedDataUrl,
    contentType
  };
}

function normalizeExportRow(row = {}, index = 0) {
  const finalTitle = String(row.final_title || row.finalTitle || row.title || "").replace(/\s+/g, " ").trim();
  if (!finalTitle) throw new Error(`Export row ${index + 1} is missing final_title.`);
  if (finalTitle.length > maxExportTitleLength) {
    throw new Error(`Export row ${index + 1} final_title is limited to ${maxExportTitleLength} characters.`);
  }
  const images = Array.isArray(row.images) ? row.images.map(normalizeImageRef).filter((image) => {
    return image.objectPath || image.embedDataUrl;
  }).slice(0, 2) : [];
  if (images.length === 0) throw new Error(`Export row ${index + 1} is missing uploaded image references.`);
  return {
    id: String(row.id || row.asset_id || row.assetId || `asset-${index + 1}`).trim(),
    asset_id: String(row.asset_id || row.assetId || row.id || `asset-${index + 1}`).trim(),
    asset_index: Number.isFinite(Number(row.asset_index ?? row.assetIndex ?? index + 1))
      ? Number(row.asset_index ?? row.assetIndex ?? index + 1)
      : index + 1,
    recognition_session_id: String(row.recognition_session_id || row.session_id || row.recognitionSessionId || "").trim(),
    final_title: finalTitle,
    images
  };
}

export function normalizeWriterExportRows(rows = []) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeExportRow);
  if (!normalizedRows.length) throw new Error("No completed card titles are available for export.");
  if (normalizedRows.length > maxExportRows) {
    throw new Error(`Writer export is limited to ${maxExportRows} cards per workbook.`);
  }
  return normalizedRows;
}

async function loadImageForWorkbook(image = {}, options = {}) {
  const inline = dataUrlToImage(image.embedDataUrl || "");
  if (inline) return inline;
  if (!image.objectPath) return null;
  const downloaded = await readStorageObject({
    objectPath: image.objectPath,
    bucket: image.bucket,
    env: options.env,
    fetchImpl: options.fetchImpl
  });
  return downloaded;
}

async function mapWithConcurrency(items, limit, worker) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let cursor = 0;
  let firstError = null;
  async function run() {
    while (cursor < source.length && !firstError) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(source[index], index);
      } catch (error) {
        firstError ||= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, source.length) }, run));
  if (firstError) throw firstError;
  return results;
}

function imagePathSummary(images = []) {
  return images
    .map((image, index) => {
      const path = image.objectPath ? `${image.bucket || ""}/${image.objectPath}` : "inline";
      return `image_${index + 1}:${path}`;
    })
    .join("\n");
}

export async function buildWriterExportWorkbook({
  rows,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedRows = normalizeWriterExportRows(rows);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LYNCA Listing Copilot";
  workbook.created = new Date();
  workbook.modified = new Date();
  const sheet = workbook.addWorksheet("Writer Export", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = [
    { header: "Asset", key: "asset", width: 14 },
    { header: "Image 1", key: "image1", width: 24 },
    { header: "Image 2", key: "image2", width: 24 },
    { header: "Final Title", key: "final_title", width: 72 },
    { header: "Recognition Session", key: "recognition_session_id", width: 32 },
    { header: "Image Storage Objects", key: "image_refs", width: 54 }
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };

  const imageEntries = normalizedRows.flatMap((row, rowIndex) => row.images.map((image, imageIndex) => ({
    rowIndex,
    imageIndex,
    image
  })));
  let sourceImageBytes = 0;
  const loadedImages = await mapWithConcurrency(imageEntries, imageLoadConcurrency, async (entry) => {
    const loaded = await loadImageForWorkbook(entry.image, { env, fetchImpl });
    if (!loaded) throw new Error(`Writer export image ${entry.rowIndex + 1}.${entry.imageIndex + 1} is unavailable.`);
    sourceImageBytes += loaded.buffer.byteLength;
    if (sourceImageBytes > maxExportWorkbookImageBytes) {
      const error = new Error(`Writer export images exceed ${maxExportWorkbookImageBytes} bytes.`);
      error.statusCode = 413;
      error.retryable = false;
      throw error;
    }
    return loaded;
  });
  let loadedImageIndex = 0;
  let embeddedImageCount = 0;

  for (const row of normalizedRows) {
    const excelRow = sheet.addRow({
      asset: `Asset ${row.asset_index}`,
      final_title: row.final_title,
      recognition_session_id: row.recognition_session_id,
      image_refs: imagePathSummary(row.images)
    });
    excelRow.height = 164;
    excelRow.alignment = { vertical: "top", wrapText: true };
    const rowNumber = excelRow.number;
    for (const [imageIndex, image] of row.images.entries()) {
      const workbookImage = loadedImages[loadedImageIndex];
      loadedImageIndex += 1;
      const imageId = workbook.addImage({
        buffer: workbookImage.buffer,
        extension: workbookImage.extension
      });
      sheet.addImage(imageId, {
        tl: { col: imageIndex + 1, row: rowNumber - 1 },
        ext: { width: imageDisplayWidth, height: imageDisplayHeight },
        editAs: "oneCell"
      });
      embeddedImageCount += 1;
    }
  }

  if (embeddedImageCount !== imageEntries.length) {
    throw new Error("Writer export workbook image count mismatch.");
  }

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    rows: normalizedRows,
    file_size_bytes: buffer.byteLength,
    embedded_image_count: embeddedImageCount,
    source_image_bytes: sourceImageBytes
  };
}

export function buildWriterExportObjectPath({ tenantId, batchId, now = new Date() } = {}) {
  const normalizedTenantId = normalizeWriterExportTenantId(tenantId);
  const yyyyMm = now.toISOString().slice(0, 7).replace("-", "/");
  return `tenants/${normalizedTenantId}/exports/writer-batches/${yyyyMm}/${batchId}.xlsx`;
}

function exportBucket(env = process.env) {
  return safeStorageBucket(env.LISTING_EXPORT_BUCKET || env.LISTING_IMAGE_BUCKET, defaultExportBucket);
}

function buildItemRows({ tenantId, batchId, rows }) {
  return rows.map((row) => ({
    id: `${batchId}_${row.asset_index}_${crypto.createHash("sha1").update(row.asset_id).digest("hex").slice(0, 10)}`,
    tenant_id: tenantId,
    export_batch_id: batchId,
    recognition_session_id: row.recognition_session_id || null,
    asset_id: row.asset_id,
    asset_index: row.asset_index,
    final_title: row.final_title,
    // Display derivatives are request-scoped workbook bytes, not durable image
    // references. Persisting their base64 payload would duplicate originals in
    // Postgres and can push a 58-image item write past the API body ceiling.
    image_refs: row.images.map((image) => ({
      id: image.id,
      name: image.name,
      type: image.type,
      originalType: image.originalType,
      width: image.width,
      height: image.height,
      objectPath: image.objectPath,
      object_path: image.object_path,
      bucket: image.bucket,
      storageRole: image.storageRole,
      storageVerified: image.storageVerified,
      contentSha256: image.contentSha256,
      contentType: image.contentType
    })),
    training_use: writerExportTrainingUse
  }));
}

export function buildWriterExportPersistenceRows({
  tenantId,
  batchId,
  normalizedRows,
  exportedBy = "",
  bucket,
  objectPath,
  fileName,
  fileSizeBytes,
  status = "READY",
  embeddedImageCount,
  failurePhase = "",
  now = new Date()
} = {}) {
  const normalizedTenantId = normalizeWriterExportTenantId(tenantId);
  const rows = Array.isArray(normalizedRows) ? normalizedRows : [];
  const itemRows = buildItemRows({ tenantId: normalizedTenantId, batchId, rows });
  const imageCount = rows.reduce((sum, row) => sum + row.images.length, 0);
  const displayDerivativeCount = rows.reduce((sum, row) => sum + row.images.filter((image) => (
    Boolean(image.objectPath && image.embedDataUrl)
  )).length, 0);
  const normalizedStatus = String(status || "").toUpperCase();
  if (!["PENDING", "READY", "FAILED"].includes(normalizedStatus)) {
    throw new Error("Invalid writer export batch status.");
  }
  const resolvedEmbeddedImageCount = embeddedImageCount === undefined
    ? (normalizedStatus === "READY" ? imageCount : null)
    : embeddedImageCount;
  if (normalizedStatus === "READY" && resolvedEmbeddedImageCount !== imageCount) {
    throw new Error("Writer export READY batch requires every image to be embedded.");
  }
  const manifest = {
    schema_version: schemaVersion,
    source: "writer_export",
    training_use: writerExportTrainingUse,
    training_eligible: false,
    training_admission: writerExportTrainingAdmission,
    asset_count: rows.length,
    item_count: itemRows.length,
    image_count: imageCount,
    embedded_image_count: resolvedEmbeddedImageCount,
    image_embedding: "excel_png_jpeg_display_bytes",
    display_derivative_count: displayDerivativeCount,
    contains_images: true,
    contains_final_titles: true,
    created_at: now.toISOString(),
    ...(normalizedStatus === "FAILED" ? {
      failure_phase: String(failurePhase || "unknown").slice(0, 48),
      failed_at: now.toISOString()
    } : {})
  };
  const batchRow = {
    id: batchId,
    tenant_id: normalizedTenantId,
    schema_version: schemaVersion,
    status: normalizedStatus,
    exported_by: exportedBy || null,
    asset_count: rows.length,
    item_count: itemRows.length,
    storage_bucket: bucket,
    storage_object_path: objectPath,
    file_name: fileName,
    file_size_bytes: fileSizeBytes,
    manifest
  };
  return { batchRow, itemRows, manifest };
}

export async function createWriterBatchExport({
  rows,
  tenantId,
  exportedBy = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  const normalizedTenantId = normalizeWriterExportTenantId(tenantId);
  const normalizedRows = normalizeWriterExportRows(rows);
  const batchId = `writer_export_${crypto.randomUUID()}`;
  const fileName = `${batchId}.xlsx`;
  const bucket = exportBucket(env);
  const objectPath = buildWriterExportObjectPath({ tenantId: normalizedTenantId, batchId, now });
  const pending = buildWriterExportPersistenceRows({
    tenantId: normalizedTenantId,
    batchId,
    normalizedRows,
    exportedBy,
    bucket,
    objectPath,
    fileName,
    fileSizeBytes: null,
    status: "PENDING",
    embeddedImageCount: null,
    now
  });
  const pendingPersistence = await writeV4Row({
    table: "v4_writer_export_batches",
    row: pending.batchRow,
    env,
    fetchImpl
  });
  if (!pendingPersistence.saved) {
    throw Object.assign(new Error("Writer export could not initialize durable state."), {
      code: "WRITER_EXPORT_INITIALIZATION_FAILED",
      statusCode: 503,
      retryable: true
    });
  }

  let failurePhase = "workbook_build";
  try {
    const workbook = await buildWriterExportWorkbook({ rows: normalizedRows, env, fetchImpl });
    failurePhase = "workbook_upload";
    await uploadStorageObject({
      objectPath,
      bucket,
      body: workbook.buffer,
      contentType: workbookMimeType,
      env,
      fetchImpl
    });

    const ready = buildWriterExportPersistenceRows({
      tenantId: normalizedTenantId,
      batchId,
      normalizedRows: workbook.rows,
      exportedBy,
      bucket,
      objectPath,
      fileName,
      fileSizeBytes: workbook.file_size_bytes,
      status: "READY",
      embeddedImageCount: workbook.embedded_image_count,
      now
    });
    failurePhase = "item_persistence";
    const itemPersistence = await writeV4Rows({
      table: "v4_writer_export_items",
      rows: ready.itemRows,
      upsert: true,
      // Track C gives export items a globally unique `id` primary key and
      // enforces tenant lineage through the parent batch. Unlike batches, items
      // do not have a `(tenant_id, id)` unique index, so naming that pair as a
      // PostgREST conflict target would make every real item write fail.
      onConflict: "id",
      env,
      fetchImpl
    });
    if (!itemPersistence.saved) {
      throw new Error(`Writer export item retention failed: ${itemPersistence.error || "unknown_error"}`);
    }
    failurePhase = "signed_download";
    const downloadUrl = await createListingImageSignedReadUrl({
      objectPath,
      bucket,
      env,
      fetchImpl
    });

    failurePhase = "ready_transition";
    const batchPersistence = await patchV4Row({
      table: "v4_writer_export_batches",
      id: batchId,
      match: { tenant_id: normalizedTenantId, status: "PENDING" },
      patch: {
        status: "READY",
        file_size_bytes: workbook.file_size_bytes,
        manifest: ready.manifest
      },
      requireMatch: true,
      env,
      fetchImpl
    });
    if (!batchPersistence.saved) {
      throw new Error(`Writer export READY transition failed: ${batchPersistence.error || "unknown_error"}`);
    }

    return {
      ok: true,
      batch_id: batchId,
      tenant_id: normalizedTenantId,
      file_name: fileName,
      storage_bucket: bucket,
      storage_object_path: objectPath,
      file_size_bytes: workbook.file_size_bytes,
      asset_count: normalizedRows.length,
      item_count: ready.itemRows.length,
      download_url: downloadUrl,
      manifest: ready.manifest,
      persistence: {
        pending_batch: pendingPersistence,
        batch: batchPersistence,
        items: itemPersistence
      }
    };
  } catch (error) {
    const failed = buildWriterExportPersistenceRows({
      tenantId: normalizedTenantId,
      batchId,
      normalizedRows,
      exportedBy,
      bucket,
      objectPath,
      fileName,
      fileSizeBytes: null,
      status: "FAILED",
      embeddedImageCount: null,
      failurePhase,
      now
    });
    await patchV4Row({
      table: "v4_writer_export_batches",
      id: batchId,
      match: { tenant_id: normalizedTenantId, status: "PENDING" },
      patch: { status: "FAILED", manifest: failed.manifest },
      requireMatch: true,
      env,
      fetchImpl
    });
    const validationFailure = /invalid size|unsupported signature|content-type\/signature mismatch|requires a JPEG or PNG|image count mismatch/i
      .test(String(error?.message || ""));
    throw Object.assign(new Error(validationFailure
      ? "Writer export image validation failed."
      : `Writer export failed during ${failurePhase}.`), {
      cause: error,
      batchId,
      failurePhase,
      code: validationFailure ? "WRITER_EXPORT_IMAGE_INVALID" : "WRITER_EXPORT_FAILED",
      statusCode: Number(error?.statusCode) || (validationFailure ? 400 : 503),
      retryable: validationFailure ? false : error?.retryable !== false
    });
  }
}
