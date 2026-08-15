import crypto from "node:crypto";
// Writer export only needs the non-streaming browser Workbook API. Keep that
// exact, integrity-checked artifact local so Node-only archive dependencies are
// neither installed nor reachable from the production export path.
import ExcelJS from "../../../vendor/exceljs-browser/exceljs.min.js";
import { listingImageStorageReadiness } from "../../storage/storage-config.mjs";
import { createListingImageSignedReadUrl } from "../../storage/supabase-image-storage.mjs";
import { writeV4Row, writeV4Rows } from "../session/supabase-rest.mjs";
import { supabaseRestAdminHeaders as supabaseServiceHeaders } from "../../../supabase-service-headers.mjs";

const schemaVersion = "v4-writer-export-batch-v1";
const defaultExportBucket = "listing-card-images";
const workbookMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const maxExportRows = 250;
const maxExportTitleLength = 80;
const imageDisplayWidth = 150;
const imageDisplayHeight = 210;
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

function dataUrlToImage(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpe?g));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  return {
    buffer: Buffer.from(match[2], "base64"),
    contentType: mime,
    extension: mime === "image/png" ? "png" : "jpeg",
    source: "data_url"
  };
}

function extensionFromContentType(contentType = "") {
  const normalized = String(contentType || "").split(";")[0].toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpeg";
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
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
    extension: extensionFromContentType(contentType),
    source: "storage"
  };
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
  if (!downloaded.extension) return null;
  return downloaded;
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
      try {
        const workbookImage = await loadImageForWorkbook(image, { env, fetchImpl });
        if (!workbookImage) continue;
        const imageId = workbook.addImage({
          buffer: workbookImage.buffer,
          extension: workbookImage.extension
        });
        sheet.addImage(imageId, {
          tl: { col: imageIndex + 1, row: rowNumber - 1 },
          ext: { width: imageDisplayWidth, height: imageDisplayHeight },
          editAs: "oneCell"
        });
      } catch {
        sheet.getCell(rowNumber, imageIndex + 2).value = image.name || "Image unavailable";
      }
    }
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
    file_size_bytes: buffer.byteLength
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
    image_refs: row.images,
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
  now = new Date()
} = {}) {
  const normalizedTenantId = normalizeWriterExportTenantId(tenantId);
  const rows = Array.isArray(normalizedRows) ? normalizedRows : [];
  const itemRows = buildItemRows({ tenantId: normalizedTenantId, batchId, rows });
  const manifest = {
    schema_version: schemaVersion,
    source: "writer_export",
    training_use: writerExportTrainingUse,
    training_eligible: false,
    training_admission: writerExportTrainingAdmission,
    asset_count: rows.length,
    item_count: itemRows.length,
    image_count: rows.reduce((sum, row) => sum + row.images.length, 0),
    contains_images: true,
    contains_final_titles: true,
    created_at: now.toISOString()
  };
  const batchRow = {
    id: batchId,
    tenant_id: normalizedTenantId,
    schema_version: schemaVersion,
    status: "READY",
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
  const batchId = `writer_export_${crypto.randomUUID()}`;
  const fileName = `${batchId}.xlsx`;
  const { buffer, rows: normalizedRows, file_size_bytes: fileSizeBytes } = await buildWriterExportWorkbook({
    rows,
    env,
    fetchImpl
  });
  const bucket = exportBucket(env);
  const objectPath = buildWriterExportObjectPath({ tenantId: normalizedTenantId, batchId, now });
  await uploadStorageObject({
    objectPath,
    bucket,
    body: buffer,
    contentType: workbookMimeType,
    env,
    fetchImpl
  });

  const { batchRow, itemRows, manifest } = buildWriterExportPersistenceRows({
    tenantId: normalizedTenantId,
    batchId,
    normalizedRows,
    exportedBy,
    bucket,
    objectPath,
    fileName,
    fileSizeBytes,
    now
  });

  const batchPersistence = await writeV4Row({
    table: "v4_writer_export_batches",
    row: batchRow,
    upsert: true,
    onConflict: "tenant_id,id",
    env,
    fetchImpl
  });
  const itemPersistence = await writeV4Rows({
    table: "v4_writer_export_items",
    rows: itemRows,
    upsert: true,
    // Track C gives export items a globally unique `id` primary key and
    // enforces tenant lineage through the parent batch. Unlike batches, items
    // do not have a `(tenant_id, id)` unique index, so naming that pair as a
    // PostgREST conflict target would make every real item write fail.
    onConflict: "id",
    env,
    fetchImpl
  });
  if (!batchPersistence.saved || !itemPersistence.saved) {
    throw new Error(`Writer export retention failed: ${batchPersistence.error || itemPersistence.error || "unknown_error"}`);
  }
  const downloadUrl = await createListingImageSignedReadUrl({
    objectPath,
    bucket,
    env,
    fetchImpl
  });

  return {
    ok: true,
    batch_id: batchId,
    tenant_id: normalizedTenantId,
    file_name: fileName,
    storage_bucket: bucket,
    storage_object_path: objectPath,
    file_size_bytes: fileSizeBytes,
    asset_count: normalizedRows.length,
    item_count: itemRows.length,
    download_url: downloadUrl,
    manifest,
    persistence: {
      batch: batchPersistence,
      items: itemPersistence
    }
  };
}
