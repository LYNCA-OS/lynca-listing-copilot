import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { listingImageStorageReadiness } from "../../storage/storage-config.mjs";
import {
  assertTenantListingImageObjectPath,
  createListingImageSignedReadUrl
} from "../../storage/supabase-image-storage.mjs";
import { writeV4Row, writeV4Rows } from "../session/supabase-rest.mjs";

const schemaVersion = "v4-writer-export-batch-v1";
const defaultExportBucket = "listing-card-images";
const workbookMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const maxExportRows = 250;
const imageDisplayWidth = 150;
const imageDisplayHeight = 210;
const mebibyte = 1024 * 1024;

const writerExportImageHardLimits = Object.freeze({
  max_image_bytes: 25 * mebibyte,
  max_total_unique_image_bytes: 64 * mebibyte,
  max_unique_images: 500,
  download_concurrency: 4,
  download_timeout_ms: 15_000
});

function boundedEnvInteger(value, fallback, hardMaximum, minimum = 1) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(hardMaximum, parsed));
}

export function writerExportImageLimits(env = process.env) {
  return {
    max_image_bytes: boundedEnvInteger(
      env.WRITER_EXPORT_MAX_IMAGE_BYTES,
      writerExportImageHardLimits.max_image_bytes,
      writerExportImageHardLimits.max_image_bytes
    ),
    max_total_unique_image_bytes: boundedEnvInteger(
      env.WRITER_EXPORT_MAX_TOTAL_UNIQUE_IMAGE_BYTES,
      writerExportImageHardLimits.max_total_unique_image_bytes,
      writerExportImageHardLimits.max_total_unique_image_bytes
    ),
    max_unique_images: boundedEnvInteger(
      env.WRITER_EXPORT_MAX_UNIQUE_IMAGES,
      writerExportImageHardLimits.max_unique_images,
      writerExportImageHardLimits.max_unique_images
    ),
    download_concurrency: boundedEnvInteger(
      env.WRITER_EXPORT_IMAGE_DOWNLOAD_CONCURRENCY,
      writerExportImageHardLimits.download_concurrency,
      writerExportImageHardLimits.download_concurrency
    ),
    download_timeout_ms: boundedEnvInteger(
      env.WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT_MS,
      writerExportImageHardLimits.download_timeout_ms,
      writerExportImageHardLimits.download_timeout_ms,
      10
    )
  };
}

class WriterExportSafetyError extends Error {
  constructor(message, { code, statusCode, retryable = false } = {}) {
    super(message);
    this.name = "WriterExportSafetyError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function writerExportLimitError(message, code) {
  return new WriterExportSafetyError(message, { code, statusCode: 413, retryable: false });
}

function writerExportTimeoutError(timeoutMs) {
  return new WriterExportSafetyError(
    `Writer export image download timed out after ${timeoutMs} ms.`,
    { code: "WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT", statusCode: 504, retryable: true }
  );
}

function isWriterExportSafetyError(error) {
  return error instanceof WriterExportSafetyError
    || ["WRITER_EXPORT_IMAGE_TOO_LARGE", "WRITER_EXPORT_IMAGE_BUDGET_EXCEEDED", "WRITER_EXPORT_TOO_MANY_UNIQUE_IMAGES", "WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT"].includes(String(error?.code || ""));
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

function safeTenantId(value) {
  const tenantId = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tenantId)) throw new Error("Writer export tenant_id is required.");
  return tenantId;
}

function encodedObjectPath(path) {
  return String(path || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

const inlineImageDataUrlPattern = /^data:(image\/(?:png|jpe?g));base64,([a-zA-Z0-9+/=]+)$/;

function normalizedInlineImageDataUrl(dataUrl = "") {
  const candidate = String(dataUrl || "");
  return inlineImageDataUrlPattern.test(candidate) ? candidate : "";
}

function decodedBase64ByteLength(base64 = "") {
  const normalized = String(base64 || "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function dataUrlToImage(dataUrl = "", { maxBytes = null } = {}) {
  const match = String(dataUrl || "").match(inlineImageDataUrlPattern);
  if (!match) return null;
  if (Number.isFinite(maxBytes) && decodedBase64ByteLength(match[2]) > maxBytes) {
    throw writerExportLimitError(
      `Writer export image exceeds the ${maxBytes} byte limit.`,
      "WRITER_EXPORT_IMAGE_TOO_LARGE"
    );
  }
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (Number.isFinite(maxBytes) && buffer.byteLength > maxBytes) {
    throw writerExportLimitError(
      `Writer export image exceeds the ${maxBytes} byte limit.`,
      "WRITER_EXPORT_IMAGE_TOO_LARGE"
    );
  }
  return {
    buffer,
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

function declaredContentLength(headers) {
  const raw = String(headerValue(headers, "content-length") || "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function assertImageChunkWithinBudget({ imageBytes, chunkBytes, budget, limits }) {
  if (imageBytes + chunkBytes > limits.max_image_bytes) {
    throw writerExportLimitError(
      `Writer export image exceeds the ${limits.max_image_bytes} byte limit.`,
      "WRITER_EXPORT_IMAGE_TOO_LARGE"
    );
  }
  if (budget.total_unique_image_bytes + chunkBytes > limits.max_total_unique_image_bytes) {
    throw writerExportLimitError(
      `Writer export images exceed the ${limits.max_total_unique_image_bytes} byte total limit.`,
      "WRITER_EXPORT_IMAGE_BUDGET_EXCEEDED"
    );
  }
}

async function readResponseBodyWithinBudget(response, { budget, limits } = {}) {
  const declaredBytes = declaredContentLength(response?.headers);
  if (declaredBytes !== null && declaredBytes > limits.max_image_bytes) {
    throw writerExportLimitError(
      `Writer export image exceeds the ${limits.max_image_bytes} byte limit.`,
      "WRITER_EXPORT_IMAGE_TOO_LARGE"
    );
  }
  if (declaredBytes !== null
      && budget.total_unique_image_bytes + declaredBytes > limits.max_total_unique_image_bytes) {
    throw writerExportLimitError(
      `Writer export images exceed the ${limits.max_total_unique_image_bytes} byte total limit.`,
      "WRITER_EXPORT_IMAGE_BUDGET_EXCEEDED"
    );
  }

  const reader = response?.body?.getReader?.();
  if (!reader) throw new Error("Storage image download did not provide a readable response stream.");
  const chunks = [];
  let imageBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value || []);
      if (!chunk.byteLength) continue;
      assertImageChunkWithinBudget({ imageBytes, chunkBytes: chunk.byteLength, budget, limits });
      imageBytes += chunk.byteLength;
      budget.total_unique_image_bytes += chunk.byteLength;
      chunks.push(chunk);
    }
  } catch (error) {
    Promise.resolve(reader.cancel(error)).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, imageBytes);
}

async function readStorageObject({
  objectPath,
  tenantId,
  bucket,
  budget,
  limits,
  signal,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = listingImageStorageReadiness(env);
  const url = normalizeStorageUrl(config.url);
  const key = serviceRoleKey(env);
  if (!url || !key) throw new Error("Supabase export storage is not configured.");
  const safeBucket = safeStorageBucket(bucket, config.bucket);
  const safePath = assertTenantListingImageObjectPath(objectPath, safeTenantId(tenantId));
  const endpoint = `${url}/storage/v1/object/${encodeURIComponent(safeBucket)}/${encodedObjectPath(safePath)}`;
  const controller = new AbortController();
  const forwardBatchAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardBatchAbort();
  else signal?.addEventListener?.("abort", forwardBatchAbort, { once: true });
  const timeoutFailure = writerExportTimeoutError(limits.download_timeout_ms);
  let timedOut = false;
  let timeoutId;
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason instanceof Error
      ? controller.signal.reason
      : new Error("Writer export image download was aborted."));
    if (controller.signal.aborted) rejectAbort();
    else controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutFailure);
      reject(timeoutFailure);
    }, limits.download_timeout_ms);
  });
  const download = (async () => {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Storage image download failed: ${response.status}`);
    }
    const contentType = String(headerValue(response.headers, "content-type") || "").split(";")[0].toLowerCase();
    const buffer = await readResponseBodyWithinBudget(response, { budget, limits });
    return {
      buffer,
      contentType,
      extension: extensionFromContentType(contentType),
      source: "storage"
    };
  })();

  try {
    return await Promise.race([download, timeout, aborted]);
  } catch (error) {
    if (timedOut) throw timeoutFailure;
    if (signal?.aborted && isWriterExportSafetyError(signal.reason)) throw signal.reason;
    if (isWriterExportSafetyError(error)) controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    controller.signal.removeEventListener("abort", rejectAbort);
    signal?.removeEventListener?.("abort", forwardBatchAbort);
  }
}

async function uploadStorageObject({
  objectPath,
  tenantId,
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
  const safePath = assertTenantListingImageObjectPath(objectPath, safeTenantId(tenantId));
  const endpoint = `${url}/storage/v1/object/${encodeURIComponent(safeBucket)}/${encodedObjectPath(safePath)}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": contentType || "application/octet-stream",
      "x-upsert": "false"
    },
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
  const embedDataUrl = normalizedInlineImageDataUrl(image.embedDataUrl || image.embed_data_url || "");
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

function workbookImageDescriptor(image = {}, { tenantId, limits, env = process.env } = {}) {
  const inline = dataUrlToImage(image.embedDataUrl || "", { maxBytes: limits.max_image_bytes });
  if (inline) {
    const digest = crypto.createHash("sha256").update(inline.buffer).digest("hex");
    return { key: `inline:${inline.contentType}:${digest}`, kind: "inline", image: inline };
  }
  if (!image.objectPath) return null;
  const config = listingImageStorageReadiness(env);
  const bucket = safeStorageBucket(image.bucket, config.bucket);
  const objectPath = assertTenantListingImageObjectPath(image.objectPath, safeTenantId(tenantId));
  return {
    key: `storage:${tenantId}:${bucket}:${objectPath}`,
    kind: "storage",
    bucket,
    objectPath
  };
}

function consumeInlineImageWithinBudget(image, { budget, limits }) {
  const byteLength = image.buffer.byteLength;
  assertImageChunkWithinBudget({ imageBytes: 0, chunkBytes: byteLength, budget, limits });
  budget.total_unique_image_bytes += byteLength;
  return image;
}

async function preloadWorkbookImages(normalizedRows, {
  tenantId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const limits = writerExportImageLimits(env);
  const budget = { total_unique_image_bytes: 0 };
  const descriptors = new Map();
  const imageKeys = new WeakMap();
  const loadedImages = new Map();
  let unavailableIndex = 0;

  for (const row of normalizedRows) {
    for (const image of row.images) {
      try {
        const descriptor = workbookImageDescriptor(image, { tenantId, limits, env });
        if (!descriptor) continue;
        imageKeys.set(image, descriptor.key);
        if (descriptors.has(descriptor.key)) continue;
        descriptors.set(descriptor.key, descriptor);
        if (descriptors.size > limits.max_unique_images) {
          throw writerExportLimitError(
            `Writer export exceeds the ${limits.max_unique_images} unique image limit.`,
            "WRITER_EXPORT_TOO_MANY_UNIQUE_IMAGES"
          );
        }
      } catch (error) {
        if (isWriterExportSafetyError(error)) throw error;
        const unavailableKey = `unavailable:${unavailableIndex++}`;
        imageKeys.set(image, unavailableKey);
        loadedImages.set(unavailableKey, null);
      }
    }
  }

  const pending = [...descriptors.values()];
  const batchController = new AbortController();
  let cursor = 0;
  let fatalError = null;
  const worker = async () => {
    while (!fatalError) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      const descriptor = pending[index];
      try {
        const loaded = descriptor.kind === "inline"
          ? consumeInlineImageWithinBudget(descriptor.image, { budget, limits })
          : await readStorageObject({
            objectPath: descriptor.objectPath,
            tenantId,
            bucket: descriptor.bucket,
            budget,
            limits,
            signal: batchController.signal,
            env,
            fetchImpl
          });
        loadedImages.set(descriptor.key, loaded?.extension ? loaded : null);
      } catch (error) {
        if (isWriterExportSafetyError(error)) {
          fatalError ||= error;
          batchController.abort(fatalError);
          return;
        }
        loadedImages.set(descriptor.key, null);
      }
    }
  };

  const workerCount = Math.min(limits.download_concurrency, Math.max(1, pending.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (fatalError) throw fatalError;
  return { imageKeys, loadedImages };
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
  tenantId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = safeTenantId(tenantId);
  const normalizedRows = normalizeWriterExportRows(rows);
  const { imageKeys, loadedImages } = await preloadWorkbookImages(normalizedRows, {
    tenantId: normalizedTenantId,
    env,
    fetchImpl
  });
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
  const workbookImageIds = new Map();

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
        const imageKey = imageKeys.get(image);
        const workbookImage = imageKey ? loadedImages.get(imageKey) : null;
        if (!workbookImage) continue;
        let imageId = workbookImageIds.get(imageKey);
        if (imageId === undefined) {
          imageId = workbook.addImage({
            buffer: workbookImage.buffer,
            extension: workbookImage.extension
          });
          workbookImageIds.set(imageKey, imageId);
        }
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

function buildExportObjectPath(tenantId, batchId, now = new Date()) {
  const yyyyMm = now.toISOString().slice(0, 7).replace("-", "/");
  return `tenants/${safeTenantId(tenantId)}/exports/writer-batches/${yyyyMm}/${batchId}.xlsx`;
}

function exportBucket(env = process.env) {
  return safeStorageBucket(env.LISTING_EXPORT_BUCKET || env.LISTING_IMAGE_BUCKET, defaultExportBucket);
}

function buildItemRows({ tenantId, batchId, rows }) {
  return rows.map((row) => ({
    id: `${batchId}_${row.asset_index}_${crypto.createHash("sha1").update(row.asset_id).digest("hex").slice(0, 10)}`,
    export_batch_id: batchId,
    tenant_id: safeTenantId(tenantId),
    recognition_session_id: row.recognition_session_id || null,
    asset_id: row.asset_id,
    asset_index: row.asset_index,
    final_title: row.final_title,
    image_refs: row.images,
    training_use: "writer_export_reviewed_title"
  }));
}

export async function createWriterBatchExport({
  rows,
  tenantId,
  exportedBy = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  const normalizedTenantId = safeTenantId(tenantId);
  const batchId = `writer_export_${crypto.randomUUID()}`;
  const fileName = `${batchId}.xlsx`;
  const { buffer, rows: normalizedRows, file_size_bytes: fileSizeBytes } = await buildWriterExportWorkbook({
    rows,
    tenantId: normalizedTenantId,
    env,
    fetchImpl
  });
  const bucket = exportBucket(env);
  const objectPath = buildExportObjectPath(normalizedTenantId, batchId, now);
  await uploadStorageObject({
    objectPath,
    tenantId: normalizedTenantId,
    bucket,
    body: buffer,
    contentType: workbookMimeType,
    env,
    fetchImpl
  });

  const itemRows = buildItemRows({ tenantId: normalizedTenantId, batchId, rows: normalizedRows });
  const manifest = {
    schema_version: schemaVersion,
    source: "writer_export",
    training_use: "reviewed_title_dataset_candidate",
    asset_count: normalizedRows.length,
    item_count: itemRows.length,
    image_count: normalizedRows.reduce((sum, row) => sum + row.images.length, 0),
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
    asset_count: normalizedRows.length,
    item_count: itemRows.length,
    storage_bucket: bucket,
    storage_object_path: objectPath,
    file_name: fileName,
    file_size_bytes: fileSizeBytes,
    manifest
  };

  const batchPersistence = await writeV4Row({
    table: "v4_writer_export_batches",
    row: batchRow,
    upsert: true,
    env,
    fetchImpl
  });
  const itemPersistence = await writeV4Rows({
    table: "v4_writer_export_items",
    rows: itemRows,
    upsert: true,
    env,
    fetchImpl
  });
  if (!batchPersistence.saved || !itemPersistence.saved) {
    throw new Error(`Writer export retention failed: ${batchPersistence.error || itemPersistence.error || "unknown_error"}`);
  }
  const downloadUrl = await createListingImageSignedReadUrl({
    objectPath,
    tenantId: normalizedTenantId,
    bucket,
    env,
    fetchImpl
  });

  return {
    ok: true,
    batch_id: batchId,
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
