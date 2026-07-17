import {
  analyzeImageQualityFromImageData,
  defaultCaptureProfileId,
  summarizeAssetImageQuality
} from "../lib/listing/image-quality/quality-gate.mjs";
import { labelForCsmField } from "../lib/listing/csm/field-labels.mjs";
import { planTargetedCrops } from "../lib/listing/image-quality/crop-planner.mjs";
import {
  groupClientResultsByJobId,
  observeClientJobPoll
} from "../lib/listing/v4/jobs/client-poll-policy.mjs";
import {
  nextWriterOutstandingIndex,
  WRITER_EXPORT_MAX_ROWS,
  writerExportRowsReady,
  writerExportWithinLimit,
  writerFeedbackPersisted
} from "./writer-wheel-mode.mjs";

const apiCostPerRequest = 0.003;
const maxTitleLength = 80;
const MAX_CONCURRENT_WORKERS = 6;
const MAX_BACKGROUND_PREP_WORKERS = 4;
const IMAGE_PREPROCESS_CONCURRENCY = 4;
const STORAGE_UPLOAD_CONCURRENCY = 3;
const STORAGE_API_RETRY_DELAYS_MS = Object.freeze([250, 750]);
const IMAGE_MAX_EDGE = 2200;
const IMAGE_MIN_EDGE = 1400;
const IMAGE_INITIAL_QUALITY = 0.9;
const IMAGE_MIN_QUALITY = 0.78;
const IMAGE_EMERGENCY_MIN_QUALITY = 0.64;
const TARGET_IMAGE_DATA_URL_CHARS = 2_400_000;
const MAX_ASSET_REQUEST_BYTES = 3_400_000;
const REQUEST_IMAGE_BATCH_LIMIT = 14;
const TARGETED_CROP_QUALITY = 0.88;
const FIELD_MAX_CROPS_PER_IMAGE = 6;
const FIELD_MAX_CROPS_PER_ASSET = 8;
const JOB_ENQUEUE_API_ENDPOINT = "/api/v4/listing-job-enqueue";
const JOB_STATUS_API_ENDPOINT = "/api/v4/listing-job-status";
const PREWARM_API_ENDPOINT = "/api/v4/prewarm";
const SESSION_STATUS_API_ENDPOINT = "/api/v4/listing-session-status";
const PREINGEST_API_ENDPOINT = "/api/v4/listing-preingest";
const ASSET_CREATE_API_ENDPOINT = "/api/listing-asset-create";
const FEEDBACK_API_ENDPOINT = "/api/v4/listing-feedback";
const EXPORT_WORKBOOK_API_ENDPOINT = "/api/v4/listing-export-workbook";
const LEGACY_FEEDBACK_API_ENDPOINT = "/api/listing-title-feedback";
const ASSISTED_DRAFT_DELAY_WARNING_MS = 120000;
const ASSISTED_DRAFT_POLL_INTERVALS_MS = [1200, 1800, 2600, 3800, 5500, 8000];
const QUEUED_STATUS_BATCH_SIZE = 100;
const STATUS_POLL_TIMEOUT_MS = 15000;
const QUEUED_BACKGROUND_PREP_WAIT_MS = 800;
// 识别前移：图片上传 + 证据包就绪后立即开始真正的识别（写手不可见）。
// L1 scout 与预处理并行，缓存就绪后只启动一次 L2；L1 永不直接展示给写手。
// 点击“开始生成”变成“展示已就绪的结果”，而不是“从零启动识别”。
const ENABLE_SPECULATIVE_RECOGNITION = true;
const SPECULATIVE_SETTLE_MAX_WAIT_MS = 15000;
const QUEUE_ENQUEUE_TIMEOUT_MS = 25000;
const defaultProviderOptions = Object.freeze({
  single_model_fast: false,
  enable_evidence_completion: true,
  enable_catalog_assist: true,
  enable_vector_assist: true,
  enable_stored_visual_features: true,
  enable_query_visual_embeddings: true,
  enable_vector_retrieval: true,
  vector_retrieval_mode: "assist",
  vector_query_timeout_ms: 8000,
  enable_advanced_retrieval: true,
  enable_hybrid_retrieval: true,
  enable_gpt_failure_fallback: false,
  enable_gpt_provider_failure_fallback: false,
  enable_gpt_critical_verifier: false
});
const supportedImageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const supportedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const heicUnsupportedMessage = "当前浏览器暂不支持 HEIC/HEIF 预览，请先在手机相册中导出为 JPG，或使用微信/系统截图后上传。";

const state = {
  files: [],
  mode: "pair",
  assets: [],
  results: [],
  modal: null,
  modalReturnFocus: null,
  resolutionMap: {},
  providerStatus: null,
  selectedProvider: "",
  processing: false,
  activeAssetIndexes: new Set(),
  assetProgress: new Map(),
  progressTimer: null,
  assetGenerationTimings: new Map(),
  generationTimer: null,
  assistedDraftPollTimers: new Map(),
  queuedBatchPollTimer: null,
  queuedBatchPollInFlightGeneration: null,
  queuedBatchPollGeneration: 0,
  completedAssetCount: 0,
  processingTotal: 0,
  exportingWorkbook: false,
  preparingFiles: false,
  filePreparationRunId: 0,
  priorityRetryInFlight: false,
  workspaceMode: "standard",
  writerActiveIndex: null,
  writerTransition: "",
  writerFocusPending: false,
  writerSaveInFlight: false,
  writerReviewComplete: false,
  writerCompletionFocusPending: false,
  writerCompositionActive: false,
  writerLastWheelNavigationAt: 0,
  fileSelectionPointerRequested: false,
  workbenchTransitionSequence: 0,
  activeWorkbenchTransition: null,
  backgroundPreparationRunId: 0,
  backgroundRecognitionBatchId: "",
  assetLifecycleGeneration: 0
};

const elements = {
  workspace: document.querySelector(".workspace"),
  workspaceModeHint: document.querySelector("#workspaceModeHint"),
  workspaceModeButtons: [...document.querySelectorAll("button[data-workspace-mode]")],
  imageInput: document.querySelector("#imageInput"),
  dropZone: document.querySelector("#dropZone"),
  processButton: document.querySelector("#processButton"),
  resetButton: document.querySelector("#resetButton"),
  copyAllButton: document.querySelector("#copyAllButton"),
  exportWorkbookButton: document.querySelector("#exportWorkbookButton"),
  exportWorkbookStatus: document.querySelector("#exportWorkbookStatus"),
  providerControl: document.querySelector("#providerControl"),
  providerStatusText: document.querySelector("#providerStatusText"),
  batchTitleList: document.querySelector("#batchTitleList"),
  imageModal: document.querySelector("#imageModal"),
  imageModalClose: document.querySelector("#imageModalClose"),
  imageModalImage: document.querySelector("#imageModalImage"),
  imageModalSide: document.querySelector("#imageModalSide"),
  imageModalTitle: document.querySelector("#imageModalTitle"),
  imageModalFileName: document.querySelector("#imageModalFileName"),
  imageModalSwitcher: document.querySelector("#imageModalSwitcher"),
  statusText: document.querySelector("#statusText"),
  assetBoardTitle: document.querySelector("#assetBoardTitle"),
  previewSummary: document.querySelector("#previewSummary"),
  assetPreviewList: document.querySelector("#assetPreviewList"),
  stats: {
    images: document.querySelector("#statImages"),
    assets: document.querySelector("#statAssets"),
    processed: document.querySelector("#statProcessed"),
    high: document.querySelector("#statHigh"),
    medium: document.querySelector("#statMedium"),
    low: document.querySelector("#statLow"),
    failed: document.querySelector("#statFailed"),
    requests: document.querySelector("#statRequests"),
    cost: document.querySelector("#statCost")
  }
};

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const source = Array.from(items || []);
  const results = new Array(source.length);
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, source.length || 1));
  let cursor = 0;

  async function runWorker() {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStorageApiResponse(response, payload = {}) {
  const status = Number(response?.status || 0);
  const code = String(payload?.code || "").trim().toUpperCase();
  if (code === "VERIFICATION_RECORD_WRITE_FAILED") return false;
  if (code && !["AUTH_UNAVAILABLE", "AUTH_RATE_LIMITED"].includes(code)) return false;
  return [429, 502, 503, 504].includes(status);
}

async function fetchStorageApiJson(url, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= STORAGE_API_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const payload = await response.json().catch(() => ({}));
      if (
        attempt === STORAGE_API_RETRY_DELAYS_MS.length
        || !retryableStorageApiResponse(response, payload)
      ) {
        return { response, payload, retryCount: attempt };
      }
    } catch (error) {
      lastError = error;
      if (attempt === STORAGE_API_RETRY_DELAYS_MS.length) throw error;
    }
    await wait(STORAGE_API_RETRY_DELAYS_MS[attempt]);
  }
  throw lastError || new Error("Storage API request failed.");
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = QUEUE_ENQUEUE_TIMEOUT_MS,
  timeoutMessage = "云端队列提交超时，系统已停止自动重复提交，请稍后检查任务状态再重试。"
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || QUEUE_ENQUEUE_TIMEOUT_MS));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(
  url,
  options = {},
  timeoutMs = STATUS_POLL_TIMEOUT_MS,
  timeoutMessage = "云端状态查询超时，系统会自动继续查询。"
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || STATUS_POLL_TIMEOUT_MS));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function fileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function imageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function contentTypeForFile(file) {
  const type = String(file.type || "").toLowerCase();
  if (supportedImageTypes.includes(type)) return type;

  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif"
  }[fileExtension(file.name)] || type;
}

function isHeicFile(file) {
  const extension = fileExtension(file.name);
  return ["image/heic", "image/heif"].includes(String(file.type || "").toLowerCase())
    || extension === ".heic"
    || extension === ".heif";
}

function isSupportedImageFile(file) {
  const type = String(file.type || "").toLowerCase();
  const extension = fileExtension(file.name);
  return supportedImageTypes.includes(type) || supportedImageExtensions.includes(extension);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function canvasToDataUrl(canvas, quality) {
  return canvas.toDataURL("image/jpeg", quality);
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = String(dataUrl || "").split(",");
  const contentType = header.match(/^data:([^;]+)/)?.[1] || "image/jpeg";
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: contentType });
}

function stringByteLength(value) {
  return new Blob([String(value || "")]).size;
}

function cropCanvasDataUrl(sourceCanvas, cropRegion, quality = TARGETED_CROP_QUALITY) {
  const left = Math.max(0, Math.floor(cropRegion.x * sourceCanvas.width));
  const top = Math.max(0, Math.floor(cropRegion.y * sourceCanvas.height));
  const width = Math.max(1, Math.min(sourceCanvas.width - left, Math.ceil(cropRegion.width * sourceCanvas.width)));
  const height = Math.max(1, Math.min(sourceCanvas.height - top, Math.ceil(cropRegion.height * sourceCanvas.height)));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(sourceCanvas, left, top, width, height, 0, 0, width, height);

  return {
    dataUrl: canvasToDataUrl(canvas, quality),
    width,
    height
  };
}

function buildTargetedCropImages(sourceImage, sourceCanvas, imageQuality) {
  const cropPlans = planTargetedCrops({
    imageId: sourceImage.id,
    sourceObjectPath: sourceImage.objectPath || "",
    sourceSide: "",
    sourceWidth: sourceCanvas.width,
    sourceHeight: sourceCanvas.height,
    imageQuality,
    maxCrops: FIELD_MAX_CROPS_PER_IMAGE
  });

  return cropPlans.map((plan, index) => {
    const crop = cropCanvasDataUrl(sourceCanvas, plan.crop_region);
    const blob = dataUrlToBlob(crop.dataUrl);
    const cropId = `${sourceImage.id}-${plan.source_region}-${index + 1}`;

    return {
      id: cropId,
      name: `${sourceImage.name} ${plan.source_region} crop`,
      originalType: "image/jpeg",
      type: "image/jpeg",
      size: stringByteLength(crop.dataUrl),
      originalSize: blob.size,
      width: crop.width,
      height: crop.height,
      dataUrl: crop.dataUrl,
      captureProfileId: defaultCaptureProfileId,
      imageQuality: null,
      sourceBlob: blob,
      sourceImageId: sourceImage.id,
      sourceRegion: plan.source_region,
      storageRole: plan.role,
      cropPlan: plan,
      cropMetadata: {
        ...(plan.crop_metadata || {}),
        crop_id: cropId,
        source_image_id: sourceImage.id,
        source_region: plan.source_region,
        crop_role: plan.role
      },
      derived: true,
      contentSha256: "",
      objectPath: ""
    };
  });
}

async function compressImageDataUrl(originalDataUrl, maxEdge, quality, sourceImage = null) {
  const image = await loadImage(originalDataUrl);
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const imageQuality = analyzeImageQualityFromImageData(context.getImageData(0, 0, width, height));

  return {
    dataUrl: canvasToDataUrl(canvas, quality),
    width,
    height,
    originalWidth: image.naturalWidth,
    originalHeight: image.naturalHeight,
    imageQuality,
    targetedCrops: sourceImage ? buildTargetedCropImages(sourceImage, canvas, imageQuality) : []
  };
}

async function fileToAssetImage(file) {
  const id = imageId();
  const originalDataUrl = await readFileAsDataUrl(file);
  let maxEdge = IMAGE_MAX_EDGE;
  let quality = IMAGE_INITIAL_QUALITY;
  let compressed;

  try {
    compressed = await compressImageDataUrl(originalDataUrl, maxEdge, quality, {
      id,
      name: file.name
    });
  } catch (error) {
    if (isHeicFile(file)) {
      throw new Error(heicUnsupportedMessage);
    }

    throw new Error(`图片无法读取或预览：${error.message || "浏览器解码失败"}`);
  }

  while (compressed.dataUrl.length > TARGET_IMAGE_DATA_URL_CHARS && (quality > IMAGE_EMERGENCY_MIN_QUALITY || maxEdge > IMAGE_MIN_EDGE)) {
    if (quality > IMAGE_MIN_QUALITY) {
      quality = Math.max(IMAGE_MIN_QUALITY, quality - 0.05);
    } else if (quality > IMAGE_EMERGENCY_MIN_QUALITY) {
      quality = Math.max(IMAGE_EMERGENCY_MIN_QUALITY, quality - 0.08);
    } else {
      maxEdge = Math.max(IMAGE_MIN_EDGE, Math.round(maxEdge * 0.86));
    }

    compressed = await compressImageDataUrl(originalDataUrl, maxEdge, quality, {
      id,
      name: file.name
    });
  }

  return {
    id,
    name: file.name,
    originalType: contentTypeForFile(file),
    type: "image/jpeg",
    size: stringByteLength(compressed.dataUrl),
    originalSize: file.size,
    originalWidth: compressed.originalWidth,
    originalHeight: compressed.originalHeight,
    width: compressed.width,
    height: compressed.height,
    dataUrl: compressed.dataUrl,
    captureProfileId: defaultCaptureProfileId,
    imageQuality: compressed.imageQuality,
    sourceFile: file,
    sourceBlob: dataUrlToBlob(compressed.dataUrl),
    contentSha256: "",
    objectPath: "",
    targetedCrops: compressed.targetedCrops
  };
}

async function recompressAssetImage(image, maxEdge, quality) {
  const compressed = await compressImageDataUrl(image.dataUrl, maxEdge, quality);

  return {
    ...image,
    type: "image/jpeg",
    size: stringByteLength(compressed.dataUrl),
    width: compressed.width,
    height: compressed.height,
    dataUrl: compressed.dataUrl,
    imageQuality: image.imageQuality || compressed.imageQuality,
    sourceBlob: image.sourceBlob || dataUrlToBlob(compressed.dataUrl)
  };
}

function canonicalAssetId(asset = {}) {
  const assetId = String(asset.durableAssetId || "").trim();
  if (!/^asset_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    throw new Error("canonical_asset_id_missing");
  }
  return assetId;
}

function canonicalAssetTenantId(asset = {}) {
  const tenantId = String(asset.durableTenantId || "").trim();
  if (!/^tenant_[a-z0-9][a-z0-9_-]{0,62}$/i.test(tenantId)) {
    throw new Error("canonical_asset_tenant_id_missing");
  }
  return tenantId;
}

function assertCurrentAssetLifecycle(asset = {}) {
  if (
    Number.isFinite(asset.lifecycleGeneration)
    && asset.lifecycleGeneration !== state.assetLifecycleGeneration
  ) {
    throw new Error("stale_asset_lifecycle");
  }
  return asset;
}

function assetLifecycleMatches(asset = {}, expectedGeneration, currentGeneration = state.assetLifecycleGeneration) {
  return expectedGeneration === currentGeneration && (
    !Number.isFinite(asset.lifecycleGeneration)
    || asset.lifecycleGeneration === expectedGeneration
  );
}

async function ensureDurableAssetIdentity(asset) {
  assertCurrentAssetLifecycle(asset);
  if (asset.durableAssetId && asset.durableTenantId) {
    canonicalAssetTenantId(asset);
    return canonicalAssetId(asset);
  }
  if (asset.durableAssetPromise) return asset.durableAssetPromise;
  asset.durableAssetPromise = (async () => {
    const clientAssetRef = String(asset.clientAssetRef || asset.id || "").trim();
    const response = await fetch(ASSET_CREATE_API_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        client_asset_ref: clientAssetRef,
        capture_profile_id: defaultCaptureProfileId,
        expected_original_count: Math.max(1, Math.min(2, Array.isArray(asset.images) ? asset.images.length : 1))
      })
    });
    const payload = await response.json().catch(() => ({}));
    assertCurrentAssetLifecycle(asset);
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `listing_asset_create_failed_${response.status}`);
    }
    if (String(payload.client_asset_ref || "") !== clientAssetRef) {
      throw new Error("listing_asset_client_ref_mismatch");
    }
    asset.durableAssetId = payload.asset_id;
    asset.durableTenantId = payload.tenant_id;
    asset.imageGenerationId = payload.image_generation_id || payload.asset_id;
    asset.expectedOriginalCount = Number(payload.expected_original_count || asset.images?.length || 1);
    asset.clientAssetRef = clientAssetRef;
    canonicalAssetTenantId(asset);
    return canonicalAssetId(asset);
  })();
  try {
    return await asset.durableAssetPromise;
  } catch (error) {
    asset.durableAssetPromise = null;
    throw error;
  }
}

function assertCanonicalImageObjectPath({ objectPath, tenantId, assetId } = {}) {
  const path = String(objectPath || "").trim();
  if (!path || /%2f|%5c/i.test(path) || path.includes("\\")) {
    throw new Error("storage_upload_object_path_invalid");
  }
  const parts = path.split("/");
  if (
    parts.length !== 6
    || parts[0] !== "tenants"
    || parts[1] !== tenantId
    || parts[2] !== "listing-assets"
    || !/^\d{4}-\d{2}-\d{2}$/.test(parts[3])
    || parts[4] !== assetId
    || !parts[5]
    || parts[5] === "."
    || parts[5] === ".."
  ) {
    throw new Error("storage_upload_object_path_out_of_scope");
  }
  return path;
}

function imageHasVerifiedStorageReference(image = {}, assetId = "", tenantId = "") {
  const expectedAssetId = String(assetId || "").trim();
  const expectedTenantId = String(tenantId || "").trim();
  if (
    !expectedAssetId
    || !expectedTenantId
    || image.storageVerified !== true
    || image.storageAssetId !== expectedAssetId
    || image.storageTenantId !== expectedTenantId
  ) return false;
  try {
    assertCanonicalImageObjectPath({
      objectPath: image.objectPath,
      tenantId: expectedTenantId,
      assetId: expectedAssetId
    });
    return true;
  } catch {
    return false;
  }
}

function serializableAssetImage(image, assetId = "", tenantId = "") {
  const useStorageReference = imageHasVerifiedStorageReference(image, assetId, tenantId);
  const cropMetadata = image.cropMetadata || image.crop_metadata || null;
  const serializedCropMetadata = cropMetadata
    ? {
      ...cropMetadata,
      asset_id: assetId || "",
      source_object_path: useStorageReference ? cropMetadata.source_object_path || "" : "",
      derived_object_path: useStorageReference ? cropMetadata.derived_object_path || image.objectPath || "" : ""
    }
    : null;
  return {
    id: image.id,
    name: image.name,
    type: image.type,
    originalType: image.originalType,
    size: image.size,
    originalSize: image.originalSize,
    originalWidth: image.originalWidth,
    originalHeight: image.originalHeight,
    width: image.width,
    height: image.height,
    dataUrl: useStorageReference ? "" : image.dataUrl,
    captureProfileId: image.captureProfileId || defaultCaptureProfileId,
    imageQuality: image.imageQuality || null,
    sourceImageId: image.sourceImageId || "",
    sourceRegion: image.sourceRegion || "",
    storageRole: image.storageRole || "",
    cropPlan: image.cropPlan || null,
    cropMetadata: serializedCropMetadata,
    crop_metadata: serializedCropMetadata,
    derived: Boolean(image.derived),
    contentSha256: image.contentSha256 || "",
    objectPath: useStorageReference ? image.objectPath || "" : "",
    bucket: useStorageReference ? image.bucket || "" : "",
    storageVerificationToken: useStorageReference ? image.storageVerificationToken || "" : "",
    storageVerified: useStorageReference,
    storageUploaded: useStorageReference,
    storageAssetId: useStorageReference ? image.storageAssetId || "" : "",
    storageTenantId: useStorageReference ? image.storageTenantId || "" : ""
  };
}

function reviewImageReference(image) {
  const cropMetadata = image.cropMetadata || image.crop_metadata || null;
  return {
    id: image.id,
    name: image.name,
    type: image.type,
    originalType: image.originalType,
    originalWidth: image.originalWidth,
    originalHeight: image.originalHeight,
    width: image.width,
    height: image.height,
    captureProfileId: image.captureProfileId || defaultCaptureProfileId,
    imageQuality: image.imageQuality || null,
    sourceImageId: image.sourceImageId || "",
    sourceRegion: image.sourceRegion || "",
    storageRole: image.storageRole || "",
    cropMetadata: cropMetadata || null,
    crop_metadata: cropMetadata || null,
    derived: Boolean(image.derived),
    contentSha256: image.contentSha256 || "",
    objectPath: image.objectPath || "",
    bucket: image.bucket || "",
    storageVerified: Boolean(image.storageVerified),
    storageUploaded: Boolean(image.storageUploaded)
  };
}

function excelEmbeddableImageType(image = {}) {
  const type = String(image.originalType || image.type || "").toLowerCase();
  return type === "image/jpeg" || type === "image/jpg" || type === "image/png";
}

function exportImageReference(image) {
  const reference = reviewImageReference(image);
  if (!reference.objectPath || !excelEmbeddableImageType(image)) {
    reference.embedDataUrl = String(image.dataUrl || "").startsWith("data:image/")
      ? image.dataUrl
      : "";
  }
  return reference;
}

function imageIsDerivedForRequest(image = {}) {
  return Boolean(image.derived || image.sourceRegion || image.source_region);
}

function boundedProviderImagesForRequest(images = [], maxImages = REQUEST_IMAGE_BATCH_LIMIT) {
  const allImages = Array.isArray(images) ? images : [];
  const primaryImages = allImages.filter((image) => !imageIsDerivedForRequest(image));
  const derivedImages = allImages.filter(imageIsDerivedForRequest);
  const maxDerived = Math.max(0, Math.max(2, Number(maxImages) || REQUEST_IMAGE_BATCH_LIMIT) - primaryImages.length);
  return [
    ...primaryImages,
    ...derivedImages.slice(0, maxDerived)
  ];
}

function buildAssetRequestBody(asset, options = {}) {
  const provider = options.provider || state.selectedProvider;
  const allProviderImages = asset.providerImages || asset.images || [];
  const providerImages = boundedProviderImagesForRequest(allProviderImages);
  const deferredImageCount = Math.max(0, allProviderImages.length - providerImages.length);
  const assetId = canonicalAssetId(asset);
  const tenantId = canonicalAssetTenantId(asset);
  const body = {
    assetId,
    asset_id: assetId,
    client_asset_ref: asset.clientAssetRef || asset.id,
    mode: state.mode,
    maxTitleLength,
    images: providerImages.map((image) => serializableAssetImage(image, assetId, tenantId)),
    deferredImageCount,
    deferred_image_count: deferredImageCount,
    captureProfileId: defaultCaptureProfileId,
    captureQuality: summarizeAssetImageQuality(providerImages),
    resolutionMap: state.resolutionMap,
    clientTiming: asset.clientTiming || {},
    preingestion_bundle_id: asset.preingestionBundleId || "",
    preingestionBundleId: asset.preingestionBundleId || "",
    preingestion_bundle_status: asset.preingestionBundleStatus || "",
    preingestion_summary: asset.preingestionSummary || null,
    provider_options: {
      ...defaultProviderOptions,
      ...(options.provider_options || options.providerOptions || {})
    }
  };

  if (provider) {
    body.provider = provider;
    body.explicitEmergency = Boolean(options.explicitEmergency || provider === "openai_legacy");
  }

  return JSON.stringify(body);
}

async function ensureSafeAssetPayload(asset, options = {}) {
  let requestBody = buildAssetRequestBody(asset, options);
  let requestBytes = stringByteLength(requestBody);

  if (requestBytes <= MAX_ASSET_REQUEST_BYTES) {
    return { requestBody, compressedAgain: false };
  }

  const compressionSteps = [
    { maxEdge: 1200, quality: 0.72 },
    { maxEdge: 1050, quality: 0.66 },
    { maxEdge: 900, quality: 0.58 }
  ];

  for (const step of compressionSteps) {
    asset.images = await mapWithConcurrency(asset.images, IMAGE_PREPROCESS_CONCURRENCY, async (image) => {
      const recompressed = await recompressAssetImage(image, step.maxEdge, step.quality);
      if (Array.isArray(recompressed.targetedCrops)) {
        recompressed.targetedCrops = await mapWithConcurrency(
          recompressed.targetedCrops,
          IMAGE_PREPROCESS_CONCURRENCY,
          (crop) => recompressAssetImage(crop, step.maxEdge, step.quality)
        );
      }
      return recompressed;
    });
    asset.providerImages = imagesForProvider(asset.images);
    requestBody = buildAssetRequestBody(asset, options);
    requestBytes = stringByteLength(requestBody);

    if (requestBytes <= MAX_ASSET_REQUEST_BYTES) {
      return { requestBody, compressedAgain: true };
    }
  }

  while ((asset.providerImages || []).some(imageIsDerivedForRequest)) {
    asset.providerImages = (asset.providerImages || []).slice(0, -1);
    requestBody = buildAssetRequestBody(asset, options);
    requestBytes = stringByteLength(requestBody);
    if (requestBytes <= MAX_ASSET_REQUEST_BYTES) {
      return { requestBody, compressedAgain: true };
    }
  }

  throw new Error("这组原图仍然过大，系统已保留给下一批处理；请稍后重试或减少单张卡的原图数量。");
}

function createClientBatchId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `web-v4-${random}`;
}

function v4SchemaVersionFromPayload(payload = {}) {
  return payload.v4_schema_version || payload.schema_version || payload.version || "v4";
}

function queuedPendingResult(asset, enqueuePayload = {}, job = {}, timing = {}) {
  const providerId = state.selectedProvider || null;
  return attachGenerationTimingToResult({
    index: asset.index,
    lifecycleGeneration: asset.lifecycleGeneration,
    asset_id: canonicalAssetId(asset),
    client_asset_ref: asset.clientAssetRef || asset.id,
    thumbnail: asset.images[0]?.dataUrl || "",
    title: "",
    final_title: "",
    rendered_title: "",
    generatedTitle: "",
    correctedTitle: "",
    writerTitlePending: true,
    confidence: "MEDIUM",
    provider: providerId,
    provider_label: providerById(providerId)?.label || providerId || "",
    model_id: "",
    reason: "",
    fields: {},
    resolved: {},
    generated_resolved_fields: {},
    unresolved: ["final_title"],
    recognition_session_id: job.recognition_session_id || "",
    v4_schema_version: v4SchemaVersionFromPayload(enqueuePayload),
    title_stage: "PENDING",
    assisted_draft_status: "PENDING",
    l2AssistedDraftStatus: "PENDING",
    full_assist_continued_after_l1: true,
    v4QueuedJob: true,
    v4_job_id: job.job_id || "",
    v4_batch_id: enqueuePayload.batch_id || job.batch_id || "",
    v4_job_status: job.status || "QUEUED",
    reviewStartedAt: Date.now(),
    feedbackStatus: "",
    feedbackMessage: "已进入云端生产队列，最终标题生成后会自动显示。",
    timing
  });
}

function storageReady() {
  return Boolean(state.providerStatus?.storage?.configured);
}

function storageUploadLimitBytes() {
  const configured = Number(state.providerStatus?.storage?.max_upload_bytes);
  return Number.isFinite(configured) && configured > 0 ? configured : 25 * 1024 * 1024;
}

function storageSourceForImage(image, maxUploadBytes = storageUploadLimitBytes()) {
  if (image.sourceFile && image.sourceFile.size <= maxUploadBytes) return image.sourceFile;
  if (image.sourceBlob) return image.sourceBlob;
  if (image.dataUrl) return dataUrlToBlob(image.dataUrl);
  if (image.sourceFile) return image.sourceFile;
  return null;
}

function storageRoleForImage(image, imageIndex) {
  if (image.storageRole) return image.storageRole;
  if (imageIsDerivedForRequest(image)) return image.storageRole || image.cropRole || "readability_derived";
  return `image_${imageIndex + 1}_original`;
}

function storageDimensionsForImage(image, source) {
  if (source && source === image.sourceFile) {
    return {
      width: image.originalWidth || image.width,
      height: image.originalHeight || image.height
    };
  }

  return {
    width: image.width,
    height: image.height
  };
}

async function fileSignatureHex(source, maxBytes = 32) {
  if (!source || typeof source.slice !== "function" || typeof source.arrayBuffer !== "function") {
    return "";
  }

  const buffer = await source.slice(0, maxBytes).arrayBuffer();
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function contentSha256Hex(source) {
  if (!source || typeof source.arrayBuffer !== "function" || !globalThis.crypto?.subtle) {
    return "";
  }

  const buffer = await source.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clearImageStorageBinding(image = {}) {
  image.objectPath = "";
  image.bucket = "";
  image.storageVerificationToken = "";
  image.storageVerified = false;
  image.storageUploaded = false;
  image.storageAssetId = "";
  image.storageTenantId = "";
  delete image.pendingStorageVerification;
  const metadata = image.cropMetadata || image.crop_metadata;
  if (metadata) {
    const resetMetadata = {
      ...metadata,
      asset_id: "",
      source_object_path: "",
      derived_object_path: ""
    };
    image.cropMetadata = resetMetadata;
    image.crop_metadata = resetMetadata;
    if (image.cropPlan) {
      image.cropPlan = { ...image.cropPlan, crop_metadata: resetMetadata };
    }
  }
}

function pendingStorageVerificationMatches(pending = {}, expected = {}) {
  return pending.assetId === expected.assetId
    && pending.tenantId === expected.tenantId
    && pending.imageId === expected.imageId
    && pending.storageRole === expected.storageRole
    && pending.size === expected.size
    && pending.width === expected.width
    && pending.height === expected.height
    && pending.contentSha256 === expected.contentSha256;
}

async function verifyUploadedAssetImage({
  asset,
  image,
  source,
  storageRole,
  dimensions,
  signatureHex,
  contentSha256,
  uploadObjectPath,
  contentType
}) {
  const assetId = canonicalAssetId(asset);
  const tenantId = canonicalAssetTenantId(asset);
  const { response: verifyResponse, payload: verifyPayload } = await fetchStorageApiJson("/api/listing-image-verify-upload", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify({
      assetId,
      imageId: image.id,
      role: storageRole,
      fileName: image.name,
      objectPath: uploadObjectPath,
      contentType,
      size: source.size,
      width: dimensions.width,
      height: dimensions.height,
      signatureHex,
      contentSha256,
      cropMetadata: image.cropMetadata || image.crop_metadata || null
    })
  });
  assertCurrentAssetLifecycle(asset);
  if (!verifyResponse.ok || !verifyPayload.ok) {
    if (verifyPayload.cleanup?.deleted || verifyPayload.cleanup?.already_absent) {
      delete image.pendingStorageVerification;
    }
    throw new Error(verifyPayload.message || `Storage upload verification failed: ${verifyResponse.status}`);
  }
  if (
    verifyPayload.verification?.tenant_id !== tenantId
    || verifyPayload.verification?.object_path !== uploadObjectPath
    || verifyPayload.verification_record?.saved !== true
    || verifyPayload.verification_record?.durable !== true
  ) {
    throw new Error("Storage verification identity mismatch.");
  }

  image.objectPath = uploadObjectPath;
  image.bucket = verifyPayload.verification.bucket;
  image.storageVerificationToken = verifyPayload.verification.verification_token || "";
  image.contentSha256 = verifyPayload.verification.content_sha256 || contentSha256;
  image.storageVerified = true;
  image.storageUploaded = true;
  image.storageAssetId = assetId;
  image.storageTenantId = tenantId;
  delete image.pendingStorageVerification;
  if (image.cropMetadata || image.crop_metadata) {
    const metadata = {
      ...(image.cropMetadata || image.crop_metadata || {}),
      derived_object_path: image.objectPath,
      source_object_path: (image.cropMetadata || image.crop_metadata || {}).source_object_path || "",
      asset_id: assetId
    };
    image.cropMetadata = metadata;
    image.crop_metadata = metadata;
    if (image.cropPlan) {
      image.cropPlan = {
        ...image.cropPlan,
        crop_metadata: metadata
      };
    }
  }
  return true;
}

async function uploadAssetImage(asset, image, imageIndex) {
  assertCurrentAssetLifecycle(asset);
  const assetId = canonicalAssetId(asset);
  const tenantId = canonicalAssetTenantId(asset);
  if (imageHasVerifiedStorageReference(image, assetId, tenantId)) return false;
  if (image.objectPath || image.storageAssetId || image.storageTenantId) {
    clearImageStorageBinding(image);
  }
  const source = storageSourceForImage(image);
  if (!source) return false;
  const usingOriginalSource = source === image.sourceFile;
  const uploadContentType = usingOriginalSource
    ? image.originalType || source.type || "image/jpeg"
    : source.type || image.type || "image/jpeg";
  const storageRole = storageRoleForImage(image, imageIndex);
  image.storageRole = storageRole;
  const signatureHex = await fileSignatureHex(source);
  const contentSha256 = image.contentSha256 || await contentSha256Hex(source);
  const dimensions = storageDimensionsForImage(image, source);
  image.contentSha256 = contentSha256;

  const expectedPending = {
    assetId,
    tenantId,
    imageId: image.id,
    storageRole,
    size: source.size,
    width: dimensions.width,
    height: dimensions.height,
    contentSha256
  };
  if (pendingStorageVerificationMatches(image.pendingStorageVerification, expectedPending)) {
    return verifyUploadedAssetImage({
      asset,
      image,
      source,
      storageRole,
      dimensions,
      signatureHex,
      contentSha256,
      uploadObjectPath: image.pendingStorageVerification.objectPath,
      contentType: image.pendingStorageVerification.contentType
    });
  }
  delete image.pendingStorageVerification;

  const { response: uploadResponse, payload: uploadPayload } = await fetchStorageApiJson("/api/listing-image-upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify({
      assetId,
      clientAssetRef: asset.clientAssetRef || asset.id,
      imageId: image.id,
      role: storageRole,
      fileName: image.name,
      contentType: uploadContentType,
      size: source.size,
      width: dimensions.width,
      height: dimensions.height,
      signatureHex,
      contentSha256
    })
  });

  assertCurrentAssetLifecycle(asset);
  if (!uploadResponse.ok || !uploadPayload.ok) {
    throw new Error(uploadPayload.message || `Storage upload URL failed: ${uploadResponse.status}`);
  }
  if (
    uploadPayload.asset_id !== assetId
    || uploadPayload.client_asset_ref !== (asset.clientAssetRef || asset.id)
    || uploadPayload.upload?.tenant_id !== tenantId
    || uploadPayload.upload?.image_id !== image.id
    || uploadPayload.upload?.storage_role !== storageRole
  ) {
    throw new Error("Storage upload identity mismatch.");
  }
  const uploadObjectPath = assertCanonicalImageObjectPath({
    objectPath: uploadPayload.upload.object_path,
    tenantId,
    assetId
  });

  const storageResponse = await fetch(uploadPayload.upload.signed_upload_url, {
    method: "PUT",
    headers: {
      "content-type": uploadPayload.upload.content_type || uploadContentType
    },
    body: source
  });

  if (!storageResponse.ok) {
    throw new Error(`Storage upload failed: ${storageResponse.status}`);
  }
  assertCurrentAssetLifecycle(asset);
  image.pendingStorageVerification = {
    ...expectedPending,
    objectPath: uploadObjectPath,
    contentType: uploadPayload.upload.content_type
  };
  return verifyUploadedAssetImage({
    asset,
    image,
    source,
    storageRole,
    dimensions,
    signatureHex,
    contentSha256,
    uploadObjectPath,
    contentType: uploadPayload.upload.content_type
  });
}

async function ensureAssetImagesUploaded(asset) {
  await ensureDurableAssetIdentity(asset);
  assertCurrentAssetLifecycle(asset);
  if (!storageReady()) throw new Error("listing_storage_not_ready");
  if (asset.storageUploadPromise) return asset.storageUploadPromise;

  asset.storageUploadPromise = (async () => {
    const images = boundedProviderImagesForRequest(asset.providerImages || asset.images);
    asset.providerImages = images;
    const indexedImages = images.map((image, imageIndex) => ({ image, imageIndex }));
    const uploadPhase = (entries) => mapWithConcurrency(entries, STORAGE_UPLOAD_CONCURRENCY, async ({ image, imageIndex }) => {
      try {
        return { ok: true, uploaded: await uploadAssetImage(asset, image, imageIndex) };
      } catch (error) {
        return { ok: false, error };
      }
    });
    // A crop verification must resolve exactly one durable original in the
    // same asset generation. Finish every original first; never let a crop
    // race ahead and later get paired with a cached image from another wave.
    const originalOutcomes = await uploadPhase(indexedImages.filter(({ image }) => !imageIsDerivedForRequest(image)));
    const failedOriginal = originalOutcomes.find((outcome) => !outcome.ok);
    if (failedOriginal) throw failedOriginal.error;
    const cropOutcomes = await uploadPhase(indexedImages.filter(({ image }) => imageIsDerivedForRequest(image)));
    const uploadOutcomes = [...originalOutcomes, ...cropOutcomes];
    assertCurrentAssetLifecycle(asset);
    const failedUpload = uploadOutcomes.find((outcome) => !outcome.ok);
    if (failedUpload) throw failedUpload.error;
    const imagesById = new Map(images.map((image) => [image.id, image]));
    images.forEach((image) => {
      const metadata = image.cropMetadata || image.crop_metadata;
      if (!metadata?.source_image_id) return;
      const sourceImage = imagesById.get(metadata.source_image_id);
      const sourceObjectPath = metadata.source_object_path || sourceImage?.objectPath || "";
      if (!sourceObjectPath) return;
      const updatedMetadata = {
        ...metadata,
        source_object_path: sourceObjectPath,
        derived_object_path: metadata.derived_object_path || image.objectPath || "",
        asset_id: canonicalAssetId(asset)
      };
      image.cropMetadata = updatedMetadata;
      image.crop_metadata = updatedMetadata;
      if (image.cropPlan) {
        image.cropPlan = {
          ...image.cropPlan,
          crop_metadata: updatedMetadata
        };
      }
    });

    return uploadOutcomes.some((outcome) => outcome.uploaded === true);
  })();

  try {
    return await asset.storageUploadPromise;
  } catch (error) {
    asset.storageUploadPromise = null;
    throw error;
  }
}

function preingestionImagesForAsset(asset) {
  const assetId = canonicalAssetId(asset);
  const tenantId = canonicalAssetTenantId(asset);
  return boundedProviderImagesForRequest(asset.providerImages || asset.images)
    .filter((image) => imageHasVerifiedStorageReference(image, assetId, tenantId))
    .map((image) => serializableAssetImage(image, assetId, tenantId));
}

function backgroundPreparationLabel(asset = {}) {
  return {
    queued: "图片准备排队中",
    uploading: "图片上传中",
    fast_scout_prewarming: "识别准备中",
    preingesting: "图片分析准备中",
    ready: "图片已准备",
    failed: "图片准备未完成"
  }[asset.backgroundPrepareStatus] || "";
}

function syncBackgroundPreparationStatus() {
  if (state.processing || state.results.length || !state.assets.length) return;
  const counts = state.assets.reduce((summary, asset) => {
    const status = String(asset.backgroundPrepareStatus || "queued");
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
  const ready = Number(counts.ready || 0);
  const failed = Number(counts.failed || 0);
  const total = state.assets.length;
  if (ready === total) {
    setStatus(`${state.files.length} 张图片已完成云端准备，可以生成标题。`);
    return;
  }
  if (ready + failed === total && failed > 0) {
    setStatus(`${state.files.length} 张图片已读取；${failed} 张卡的云端准备遇到瞬时错误，生成时会自动重试。`);
    return;
  }
  setStatus(`${state.files.length} 张图片已读取；云端准备中 ${ready} / ${total}。`, { busy: true });
}

async function ensurePreingestionBundle(asset) {
  if (asset.preingestionBundleId) {
    return {
      bundleId: asset.preingestionBundleId,
      reused: true
    };
  }

  const images = preingestionImagesForAsset(asset);
  if (!images.length) {
    throw new Error("no_verified_storage_images");
  }

  const response = await fetch(PREINGEST_API_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify({
      asset_id: canonicalAssetId(asset),
      assetId: canonicalAssetId(asset),
      client_asset_ref: asset.clientAssetRef || asset.id,
      images,
      captureQuality: summarizeAssetImageQuality(asset.providerImages || asset.images),
      requested_fields: [
        "serial_number",
        "collector_number",
        "checklist_code",
        "grade_label",
        "year_product",
        "subject",
        "surface"
      ],
      source: "listing_copilot_background_prepare",
      enqueue_workers: true,
      enqueue_ocr: true,
      // Only OCR currently has a production consumer. Query embeddings still
      // run concurrently inside recognition; do not create durable dead jobs.
      enqueue_embeddings: false,
      enqueue_surface: false,
      enqueue_quality: false,
      // 上传端已经完成对象校验，Provider 读取时还会独立签名。这里重复
      // 签名只增加 L2 起跑等待，不增加证据强度。
      verify_signed_read_urls: false
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.code || `preingestion_failed_${response.status}`);
  }

  asset.preingestionBundleId = payload.v4_preingestion_bundle_id || payload.bundle_id || "";
  asset.preingestionBundleStatus = payload.bundle_status || "";
  asset.preingestionSummary = payload.preprocessing_summary || null;
  return {
    bundleId: asset.preingestionBundleId,
    status: asset.preingestionBundleStatus,
    summary: asset.preingestionSummary
  };
}

async function prepareAssetInBackground(asset, runId) {
  if (!asset) return null;
  if (asset.backgroundPreparationPromise && asset.backgroundPreparationRunId === runId) {
    return asset.backgroundPreparationPromise;
  }

  asset.backgroundPreparationRunId = runId;
  asset.backgroundPrepareStatus = "queued";
  asset.backgroundPreparationPromise = (async () => {
    const startedAt = performance.now();
    try {
      if (runId !== state.backgroundPreparationRunId) return { stale: true };
      asset.backgroundPrepareStatus = "uploading";
      syncBackgroundPreparationStatus();
      await ensureAssetImagesUploaded(asset);
      if (runId !== state.backgroundPreparationRunId) return { stale: true };
      asset.backgroundPrepareStatus = "preingesting";
      syncBackgroundPreparationStatus();
      const bundle = await ensurePreingestionBundle(asset);

      if (runId === state.backgroundPreparationRunId) {
        // 证据包持久化后立即提交最终 L2。Cache-only scout 连续无命中，
        // 不再成为生产起跑门槛；L1 继续保持写手不可见。
        void ensureSpeculativeRecognition(asset, runId);
      }

      asset.backgroundPrepareStatus = "ready";
      asset.backgroundPrepareError = "";
      asset.backgroundPrepareMs = Math.round(performance.now() - startedAt);
      syncBackgroundPreparationStatus();
      return { ok: true, ...bundle };
    } catch (error) {
      asset.backgroundPrepareStatus = "failed";
      asset.backgroundPrepareError = String(error.message || "background_prepare_failed").slice(0, 160);
      asset.backgroundPrepareMs = Math.round(performance.now() - startedAt);
      syncBackgroundPreparationStatus();
      return { ok: false, error: asset.backgroundPrepareError };
    } finally {
      if (!state.processing && runId === state.backgroundPreparationRunId) {
        renderResults();
        syncBackgroundPreparationStatus();
      }
    }
  })();

  return asset.backgroundPreparationPromise;
}

async function settleBackgroundPreparation(asset, maxWaitMs = 2500) {
  if (!asset?.backgroundPreparationPromise) return { used: false };
  const startedAt = performance.now();
  try {
    const timedOut = Symbol("background_prepare_timeout");
    const result = await Promise.race([
      asset.backgroundPreparationPromise,
      wait(maxWaitMs).then(() => timedOut)
    ]);
    if (result === timedOut) {
      return {
        used: true,
        timed_out: true,
        wait_ms: Math.round(performance.now() - startedAt)
      };
    }
    return {
      used: true,
      wait_ms: Math.round(performance.now() - startedAt),
      ...result
    };
  } catch (error) {
    return {
      used: true,
      ok: false,
      wait_ms: Math.round(performance.now() - startedAt),
      error: String(error.message || "background_prepare_failed").slice(0, 160)
    };
  }
}

async function ensureSpeculativeRecognition(asset, runId) {
  if (!ENABLE_SPECULATIVE_RECOGNITION || !asset) return null;
  if (asset.speculativeRunId === runId && asset.speculativePromise) return asset.speculativePromise;
  asset.speculativeRunId = runId;
  asset.speculativePromise = (async () => {
    const startedAt = performance.now();
    try {
      const { requestBody } = await ensureSafeAssetPayload(asset, {
        provider_options: { ...defaultProviderOptions }
      });
      if (runId !== state.backgroundPreparationRunId) return { stale: true, run_id: runId };

      const enqueueJobPayload = JSON.parse(requestBody);
      enqueueJobPayload.force_l2_only = true;
      enqueueJobPayload.create_l1_job = false;
      enqueueJobPayload.create_l2_job = true;
      enqueueJobPayload.disable_fast_scout_l1 = true;
      enqueueJobPayload.v4_force_l2_direct = true;
      enqueueJobPayload.client_speculative = true;

      const batchId = state.backgroundRecognitionBatchId || createClientBatchId();
      const enqueuePayload = await fetchWithTimeout(JOB_ENQUEUE_API_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          batch_id: batchId,
          priority: 100,
          jobs: [{
            asset_id: canonicalAssetId(asset),
            force_l2_only: true,
            create_l1_job: false,
            create_l2_job: true,
            payload: enqueueJobPayload
          }]
        })
      }).then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.message || `speculative enqueue ${response.status}`);
        }
        return payload;
      });
      const job = enqueuePayload
        ? ((enqueuePayload.jobs || []).find((entry) => entry?.ok && entry.job_type === "FINAL_ASSISTED_TITLE")
          || (enqueuePayload.jobs || []).find((entry) => entry?.ok)
          || null)
        : null;
      return {
        ok: Boolean(job && job.job_id && job.recognition_session_id),
        run_id: runId,
        request_body: requestBody,
        enqueue_payload: enqueuePayload,
        job: job && job.job_id && job.recognition_session_id ? job : null,
        speculative_ms: Math.round(performance.now() - startedAt)
      };
    } catch (error) {
      return {
        ok: false,
        run_id: runId,
        error: String(error?.message || "speculative_failed").slice(0, 160),
        speculative_ms: Math.round(performance.now() - startedAt)
      };
    }
  })();
  return asset.speculativePromise;
}

async function settleSpeculativeRecognition(asset, maxWaitMs = SPECULATIVE_SETTLE_MAX_WAIT_MS) {
  if (!ENABLE_SPECULATIVE_RECOGNITION) return { used: false };
  if (!asset?.speculativePromise || asset.speculativeRunId !== state.backgroundPreparationRunId) {
    return { used: false };
  }
  const startedAt = performance.now();
  const timedOut = Symbol("speculative_timeout");
  // 完整等待（有上限）而不是短超时后另起一路：投机流程里已经包含一次 L2 入队，
  // 若这里超时改走常规入队，会给同一张卡排两个 L2 任务。
  const result = await Promise.race([
    asset.speculativePromise,
    wait(maxWaitMs).then(() => timedOut)
  ]).catch(() => null);
  if (result === timedOut) {
    return {
      used: true,
      pending: true,
      timed_out: true,
      wait_ms: Math.round(performance.now() - startedAt)
    };
  }
  if (!result || result.stale || result.run_id !== state.backgroundPreparationRunId) {
    return {
      used: false,
      timed_out: false,
      wait_ms: Math.round(performance.now() - startedAt)
    };
  }
  return { used: true, wait_ms: Math.round(performance.now() - startedAt), ...result };
}

function startBackgroundPreparation(reason = "file_ready") {
  if (!storageReady() || !state.assets.length) return false;
  const runId = ++state.backgroundPreparationRunId;
  state.backgroundRecognitionBatchId = createClientBatchId();
  const assets = [...state.assets];
  assets.forEach((asset) => {
    if (!asset.preingestionBundleId && asset.backgroundPrepareStatus !== "ready") {
      asset.backgroundPrepareStatus = "queued";
      asset.backgroundPreparationRunId = runId;
    }
  });
  if (!state.processing) {
    renderResults();
  }
  // Image upload, pre-ingestion, and OCR run ahead of the GPT queue. Keeping
  // this pool independent lets deterministic evidence finish while the
  // provider remains at its measured stable concurrency.
  const backgroundWorkerCount = MAX_BACKGROUND_PREP_WORKERS;
  void mapWithConcurrency(assets, backgroundWorkerCount, async (asset) => {
    if (runId !== state.backgroundPreparationRunId) return null;
    return prepareAssetInBackground(asset, runId);
  });
  void prewarmV4(`background_prepare_${reason}`);
  return true;
}

function formatCost(requests) {
  return `$${(requests * apiCostPerRequest).toFixed(3)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function providerById(providerId) {
  return (state.providerStatus?.providers || []).find((provider) => provider.id === providerId) || null;
}

function providerDisabledText(provider) {
  const reason = provider.disabled_reason || "";
  if (reason === "storage_not_configured") return "Storage 未配置";
  if (reason.includes("api_key")) return "未配置";
  if (reason === "disabled_by_env") return "已禁用";
  if (reason === "emergency_retry_disabled") return "手动关闭";
  if (reason) return "不可用";
  return provider.requires_explicit_retry ? "手动直跑" : "可用";
}

function providerSmokeText(provider) {
  const smoke = provider.smoke;
  if (!smoke) return "";

  if (smoke.status === "not_run") return "Smoke 未验证";
  if (smoke.status === "unreadable") return "Smoke 报告不可读";
  if (smoke.status === "skipped") return "Smoke 已跳过";

  const verified = [];
  if (smoke.json_baseline_verified) verified.push("JSON");
  if (smoke.multi_image_verified) verified.push("多图");
  if (smoke.error_response_verified) verified.push("错误响应");
  if (smoke.tool_call_verified) verified.push("工具调用");

  const prefix = smoke.status === "passed"
    ? "Smoke 已验证"
    : smoke.status === "passed_with_limitations"
      ? "Smoke 部分验证"
      : "Smoke 未通过";

  return verified.length ? `${prefix}: ${verified.join(" / ")}` : prefix;
}

function providerCascadeText(provider) {
  const roles = new Set(provider.roles || [provider.role].filter(Boolean));
  if (provider.id === "openai_legacy" || roles.has("primary")) {
    const model = String(provider.model_id || provider.display_name || "GPT").trim();
    return `${model} 生产主路径，不参与自动混合`;
  }
  if (roles.has("diagnostic")) {
    return "离线/管理员诊断";
  }
  return "";
}

function providerStatusText(provider) {
  return [
    `${provider.label} · ${providerDisabledText(provider)}`,
    providerCascadeText(provider),
    providerSmokeText(provider)
  ].filter(Boolean).join(" · ");
}

function workflowReadinessText(readiness) {
  if (!readiness) return "";
  const summary = readiness.summary || {};
  const ready = `${summary.ready_count ?? 0}/${summary.component_count ?? 0}`;
  if (readiness.low_friction_ready) return `链路预检 OK · ${ready} 已就绪`;
  if (readiness.can_run_cloud_recognition) {
    const failClosed = summary.fail_closed_count || readiness.fail_closed_components?.length || 0;
    const degraded = summary.degraded_count || 0;
    return `链路可跑 · ${ready} 已就绪 · ${failClosed} 个安全降级 · ${degraded} 个降级`;
  }
  const blockers = (readiness.blockers || []).join(", ") || "cloud";
  return `链路未就绪 · 阻断：${blockers}`;
}

function workflowAllowsGeneration() {
  const readiness = state.providerStatus?.workflow_readiness;
  if (!readiness) return false;
  return readiness.can_run_cloud_recognition !== false;
}

function renderProviderControl() {
  const providers = state.providerStatus?.providers || [];
  const readinessText = workflowReadinessText(state.providerStatus?.workflow_readiness);

  if (!providers.length) {
    elements.providerControl.innerHTML = "";
    elements.providerStatusText.textContent = state.providerStatus?.fallback_available
      ? "未配置服务端 Provider，当前使用本地 fallback。"
      : readinessText || "未读取到可用 Provider。";
    elements.processButton.disabled = !canGenerateTitles();
    return;
  }

  elements.providerControl.innerHTML = providers.map((provider) => `
    <button
      class="provider-option ${state.selectedProvider === provider.id ? "active" : ""}"
      type="button"
      data-provider-id="${escapeHtml(provider.id)}"
      ${provider.selectable ? "" : "disabled"}
    >
      <strong>${escapeHtml(provider.label)}</strong>
      <small>${escapeHtml(provider.model_id)} · ${escapeHtml(providerDisabledText(provider))}</small>
      ${providerCascadeText(provider) ? `<small>${escapeHtml(providerCascadeText(provider))}</small>` : ""}
      ${providerSmokeText(provider) ? `<small class="provider-smoke">${escapeHtml(providerSmokeText(provider))}</small>` : ""}
    </button>
  `).join("");

  const selected = providerById(state.selectedProvider);
  if (selected) {
    elements.providerStatusText.textContent = [
      providerStatusText(selected),
      readinessText
    ].filter(Boolean).join(" · ");
    elements.processButton.disabled = !canGenerateTitles();
    return;
  }

  elements.providerStatusText.textContent = state.providerStatus?.fallback_available
    ? "未配置服务端 Provider，当前使用本地 fallback。"
    : readinessText || "请选择可用 Provider。";
  elements.processButton.disabled = !canGenerateTitles();
}

function selectProvider(providerId) {
  const provider = providerById(providerId);
  if (!provider?.selectable) return;

  state.selectedProvider = provider.id;
  state.results = [];
  resetGenerationTimings();
  renderProviderControl();
  elements.processButton.disabled = !canGenerateTitles();
  renderResults();
}

function canGenerateTitles() {
  return generationSubmissionAllowed({
    assetCount: state.assets.length,
    providerId: state.selectedProvider,
    workflowReady: workflowAllowsGeneration(),
    processing: state.processing,
    resultCount: state.results.length
  });
}

function generationSubmissionAllowed({
  assetCount = 0,
  providerId = "",
  workflowReady = false,
  processing = false,
  resultCount = 0
} = {}) {
  return Boolean(assetCount && providerId && workflowReady && !processing && Number(resultCount) === 0);
}

function speculativeNeedsFreshEnqueue(speculative = {}) {
  return speculative.used !== true;
}

function syncProcessButtonState() {
  const busy = state.processing || state.results.some((result) => v4WriterTitlePending(result));
  elements.processButton.disabled = !canGenerateTitles() || workspaceInteractionLocked();
  setProcessButtonBusy(busy);
}

function selectedProviderConfig() {
  return (state.providerStatus?.providers || []).find((provider) => provider.id === state.selectedProvider) || null;
}

function queueSubmissionConcurrencyLimit({
  providerConfig = selectedProviderConfig(),
  executionControl = state.providerStatus?.execution_control,
  maxWorkers = MAX_CONCURRENT_WORKERS
} = {}) {
  const boundedMax = Math.max(1, Math.trunc(Number(maxWorkers) || MAX_CONCURRENT_WORKERS));
  const explicitSubmission = Number(executionControl?.queue_submission_concurrency);
  if (Number.isFinite(explicitSubmission) && explicitSubmission > 0) {
    return Math.max(1, Math.min(Math.trunc(explicitSubmission), boundedMax));
  }

  const providerConcurrency = Number(providerConfig?.recommended_concurrency);
  const derived = Number.isFinite(providerConcurrency) && providerConcurrency > 0
    ? Math.trunc(providerConcurrency)
    : 2;
  return Math.max(1, Math.min(derived, boundedMax));
}

function confidenceClass(confidence) {
  const normalized = normalizeConfidence(confidence);
  return {
    HIGH: "confidence-high",
    MEDIUM: "confidence-medium",
    LOW: "confidence-low",
    FAILED: "confidence-failed"
  }[normalized] || "confidence-medium";
}

function normalizeConfidence(confidence) {
  return {
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    UNSURE: "MEDIUM",
    LOW: "LOW",
    FAILED: "FAILED"
  }[String(confidence || "").toUpperCase()] || "MEDIUM";
}

function setStatus(message, options = {}) {
  const text = String(message || "");
  const busy = Boolean(options.busy && text);
  elements.statusText.classList.toggle("status-busy", busy);
  elements.statusText.setAttribute("aria-busy", busy ? "true" : "false");
  elements.dropZone.classList.toggle("status-busy", busy);

  if (busy) {
    elements.statusText.innerHTML = `
      <span class="status-spinner" aria-hidden="true"></span>
      <span class="status-message">${escapeHtml(text)}</span>
      <span class="status-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    `;
    return;
  }

  elements.statusText.textContent = text;
}

function setProcessButtonBusy(isBusy) {
  elements.processButton.classList.toggle("is-loading", Boolean(isBusy));
  elements.processButton.setAttribute("aria-busy", isBusy ? "true" : "false");
  elements.processButton.textContent = isBusy ? "识别中" : "生成标题";
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function currentProcessingPercent() {
  const total = state.processingTotal || state.assets.length || 0;
  if (!state.processing || !total) return 0;
  const completed = clampNumber(state.completedAssetCount || 0, 0, total);
  const activeFraction = [...state.assetProgress.values()].reduce((sum, progress) => {
    return sum + clampNumber(progress.displayFraction ?? progress.targetFraction ?? progress.fraction, 0, 0.98);
  }, 0);
  return Math.max(1, Math.min(99, Math.round(((completed + activeFraction) / total) * 100)));
}

function statusWithProgress(message) {
  const percent = currentProcessingPercent();
  return percent ? `${percent}% · ${message}` : message;
}

function stopGenerationTicker() {
  if (!state.generationTimer) return;
  clearInterval(state.generationTimer);
  state.generationTimer = null;
}

function hasLiveGenerationTiming() {
  if (state.processing || state.activeAssetIndexes.size) return true;
  for (const timing of state.assetGenerationTimings.values()) {
    if (timing?.startedAt && !timing.finishedAt) return true;
  }
  return state.results.some((result) => {
    const timing = state.assetGenerationTimings.get(result.index);
    return Boolean(timing?.startedAt && !timing.finishedAt && v4WriterTitlePending(result));
  });
}

function startGenerationTicker() {
  if (state.generationTimer) return;
  state.generationTimer = setInterval(() => {
    if (!hasLiveGenerationTiming()) {
      stopGenerationTicker();
      return;
    }
    for (const assetIndex of state.assetGenerationTimings.keys()) {
      updateGenerationTimingDom(assetIndex);
    }
  }, 1000);
}

function resetGenerationTimings() {
  state.assetGenerationTimings = new Map();
  stopGenerationTicker();
}

function timingForAssetIndex(assetIndex) {
  const index = Number(assetIndex);
  if (!Number.isFinite(index)) return null;
  return state.assetGenerationTimings.get(index) || null;
}

function ensureGenerationTiming(assetIndex, queuedAt = Date.now()) {
  const index = Number(assetIndex);
  if (!Number.isFinite(index)) return null;
  const existing = timingForAssetIndex(index);
  if (existing) return existing;
  const timing = {
    queuedAt,
    startedAt: null,
    finishedAt: null,
    failed: false,
    startSource: null
  };
  state.assetGenerationTimings.set(index, timing);
  return timing;
}

function markAssetQueued(asset, queuedAt = Date.now()) {
  const timing = ensureGenerationTiming(asset.index, queuedAt);
  if (timing && !timing.queuedAt) timing.queuedAt = queuedAt;
}

function markAssetStarted(asset, startedAt = Date.now(), startSource = "client_direct_request") {
  const timing = ensureGenerationTiming(asset.index, startedAt);
  if (!timing) return null;
  if (!timing.startedAt) timing.startedAt = startedAt;
  if (!timing.startSource) timing.startSource = startSource;
  timing.finishedAt = null;
  timing.failed = false;
  startGenerationTicker();
  return timing;
}

function markAssetFinished(assetIndex, options = {}) {
  const timing = ensureGenerationTiming(assetIndex);
  if (!timing) return null;
  timing.finishedAt = timing.finishedAt || Date.now();
  timing.failed = Boolean(options.failed);
  return timing;
}

function parseGenerationTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function recognitionClockFromServerPayload(payload = {}) {
  const session = payload.session && typeof payload.session === "object" ? payload.session : payload;
  const summary = session.provider_result_summary && typeof session.provider_result_summary === "object"
    ? session.provider_result_summary
    : payload.provider_result_summary && typeof payload.provider_result_summary === "object"
      ? payload.provider_result_summary
      : {};
  const startedAt = parseGenerationTimestamp(
    payload.recognition_started_at
      || summary.recognition_clock_started_at
      || payload.execution_control?.provider_capacity_leased_at
  );
  const completedAt = parseGenerationTimestamp(
    payload.recognition_completed_at
      || session.l2_ready_at
      || payload.completed_at
  );
  const startSource = String(
    payload.recognition_start_source
      || summary.recognition_clock_source
      || (payload.execution_control?.provider_capacity_leased_at ? "provider_capacity_lease" : "")
  ).trim() || null;
  return {
    startedAt,
    completedAt,
    startSource
  };
}

function recognitionClockSourcePriority(source) {
  if (["gpt_provider_request", "deterministic_anchor_finalize"].includes(source)) return 3;
  if (source === "provider_capacity_lease") return 2;
  if (source === "worker_start_fallback") return 1;
  return 0;
}

function syncAssetGenerationTimingFromServer(assetIndex, payload = {}) {
  const timing = ensureGenerationTiming(assetIndex);
  if (!timing) return null;
  const clock = recognitionClockFromServerPayload(payload);
  if (clock.startedAt) {
    const shouldReplaceStart = !timing.startedAt
      || recognitionClockSourcePriority(clock.startSource) > recognitionClockSourcePriority(timing.startSource);
    if (shouldReplaceStart) {
      timing.startedAt = clock.startedAt;
      timing.startSource = clock.startSource;
    }
    timing.failed = false;
    startGenerationTicker();
  }
  if (clock.completedAt) timing.finishedAt = clock.completedAt;
  return timing;
}

function formatGenerationElapsed(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const seconds = safeMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

function generationTimingSnapshot(assetIndex) {
  const timing = timingForAssetIndex(assetIndex);
  if (!timing) return null;
  const now = Date.now();
  const startedAt = timing.startedAt || null;
  const finishedAt = timing.finishedAt || null;
  const activeEnd = finishedAt || now;
  const activeMs = startedAt ? Math.max(0, activeEnd - startedAt) : 0;
  const queueMs = timing.queuedAt && startedAt ? Math.max(0, startedAt - timing.queuedAt) : 0;
  const waitingMs = timing.queuedAt && !startedAt ? Math.max(0, now - timing.queuedAt) : 0;
  return {
    queuedAt: timing.queuedAt || null,
    startedAt,
    finishedAt,
    failed: Boolean(timing.failed),
    start_source: timing.startSource || null,
    active_ms: activeMs,
    queue_ms: queueMs,
    waiting_ms: waitingMs
  };
}

function attachGenerationTimingToResult(result = {}) {
  const snapshot = generationTimingSnapshot(result.index);
  if (!snapshot) return result;
  result.generation_timing = snapshot;
  result.generationStartedAt = snapshot.startedAt;
  result.generationFinishedAt = snapshot.finishedAt;
  result.generationElapsedMs = snapshot.active_ms;
  result.queueWaitMs = snapshot.queue_ms;
  return result;
}

function generationTimingView(assetIndex) {
  const snapshot = generationTimingSnapshot(assetIndex);
  if (!snapshot) return null;
  if (!snapshot.startedAt) {
    return {
      label: snapshot.failed ? "模型未启动" : "等待识别",
      value: "",
      status: "queued"
    };
  }
  if (!snapshot.finishedAt) {
    return {
      label: "识别中",
      value: formatGenerationElapsed(snapshot.active_ms),
      status: "running"
    };
  }
  return {
    label: snapshot.failed ? "失败前识别耗时" : "识别耗时",
    value: formatGenerationElapsed(snapshot.active_ms),
    status: snapshot.failed ? "failed" : "done"
  };
}

function generationTimingBadge(assetIndex) {
  const view = generationTimingView(assetIndex);
  const value = view?.value ? ` ${escapeHtml(view.value)}` : "";
  const status = view?.status || "idle";
  return `<span class="generation-time-badge generation-time-${escapeHtml(status)}" data-generation-timing-asset="${Number(assetIndex)}" ${view ? "" : "hidden"}>${view ? `${escapeHtml(view.label)}${value}` : ""}</span>`;
}

function updateGenerationTimingDom(assetIndex) {
  const view = generationTimingView(assetIndex);
  const nodes = document.querySelectorAll(`[data-generation-timing-asset="${Number(assetIndex)}"]`);
  for (const node of nodes) {
    node.hidden = !view;
    node.className = `generation-time-badge generation-time-${view?.status || "idle"}`;
    node.textContent = view ? `${view.label}${view.value ? ` ${view.value}` : ""}` : "";
  }
  return nodes.length;
}

function setAssetProgress(assetIndex, label, fraction, options = {}) {
  const hasPendingResult = options.knownPending === true
    || state.results.some((result) => Number(result.index) === Number(assetIndex) && v4WriterTitlePending(result));
  if (!state.processing && !hasPendingResult) return;
  const current = state.assetProgress.get(assetIndex) || {};
  const targetFraction = clampNumber(fraction, 0.01, 0.98);
  state.assetProgress.set(assetIndex, {
    label,
    targetFraction,
    displayFraction: clampNumber(
      current.displayFraction ?? current.targetFraction ?? 0.005,
      0.005,
      Math.max(0.005, targetFraction)
    ),
    updatedAt: performance.now()
  });
  startProgressTicker();
  if (!updateAssetProgressDom(assetIndex)) renderResults();
  if (options.announce !== false) {
    setStatus(statusWithProgress(`资产 ${assetIndex}：${label}`), { busy: true });
  }
}

function clearAssetProgress(assetIndex) {
  state.assetProgress.delete(assetIndex);
}

function progressStepForTarget(targetFraction) {
  if (targetFraction <= 0.08) return 0.0028;
  if (targetFraction <= 0.36) return 0.0045;
  if (targetFraction <= 0.72) return 0.0032;
  return 0.0024;
}

function hasLiveAssetProgress() {
  return state.processing || state.results.some((result) => v4WriterTitlePending(result));
}

function stopProgressTicker() {
  if (!state.progressTimer) return;
  clearInterval(state.progressTimer);
  state.progressTimer = null;
}

function startProgressTicker() {
  if (state.progressTimer || !hasLiveAssetProgress() || !state.assetProgress.size) return;
  state.progressTimer = setInterval(() => {
    if (!hasLiveAssetProgress() || !state.assetProgress.size) {
      stopProgressTicker();
      return;
    }

    const changedAssetIndexes = [];
    for (const [assetIndex, progress] of state.assetProgress.entries()) {
      const target = clampNumber(progress.targetFraction ?? progress.fraction, 0.01, 0.98);
      const display = clampNumber(progress.displayFraction ?? 0.005, 0.005, 0.98);
      if (display >= target - 0.001) continue;
      const nextDisplay = Math.min(target, display + progressStepForTarget(target));
      state.assetProgress.set(assetIndex, {
        ...progress,
        displayFraction: nextDisplay
      });
      changedAssetIndexes.push(assetIndex);
    }

    if (changedAssetIndexes.length) {
      for (const assetIndex of changedAssetIndexes) updateAssetProgressDom(assetIndex);
      setStatus(statusWithProgress("识别中，系统正在逐步读取模块…"), { busy: true });
    }
  }, 520);
}

function assetProgressSnapshot(asset) {
  const progress = state.assetProgress.get(asset.index);
  if (progress) {
    return {
      label: progress.label || "识别中",
      percent: Math.max(1, Math.min(99, Math.round(clampNumber(progress.displayFraction ?? progress.targetFraction ?? progress.fraction, 0, 0.98) * 100))),
      targetPercent: Math.max(1, Math.min(99, Math.round(clampNumber(progress.targetFraction ?? progress.fraction, 0, 0.98) * 100)))
    };
  }

  if (state.processing && !resultForAsset(asset)) {
    return {
      label: "等待后台队列",
      percent: currentProcessingPercent()
    };
  }

  return { label: "", percent: 0 };
}

function updateAssetProgressDom(assetIndex) {
  const snapshot = assetProgressSnapshot({ index: Number(assetIndex) });
  const meters = document.querySelectorAll(`[data-progress-asset="${Number(assetIndex)}"]`);
  for (const meter of meters) {
    meter.setAttribute("aria-label", snapshot.label || "识别进度");
    meter.setAttribute("aria-valuenow", String(snapshot.percent));
    const fill = meter.querySelector(".progress-fill");
    const value = meter.querySelector(".progress-value");
    if (fill) fill.style.width = `${snapshot.percent}%`;
    if (value) value.textContent = `${snapshot.percent}%`;
  }
  const labels = document.querySelectorAll(`[data-progress-label-asset="${Number(assetIndex)}"]`);
  for (const label of labels) label.textContent = snapshot.label || "识别中";
  return meters.length + labels.length;
}

function progressMeter(percent, label = "", assetIndex = null) {
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const assetAttribute = Number.isFinite(Number(assetIndex)) ? ` data-progress-asset="${Number(assetIndex)}"` : "";
  return `
    <div class="progress-meter"${assetAttribute} aria-label="${escapeHtml(label || "识别进度")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${safePercent}" role="progressbar">
      <span class="progress-fill" style="width: ${safePercent}%"></span>
      <strong class="progress-value">${safePercent}%</strong>
    </div>
  `;
}

function assetCountLabel(count) {
  return `${count} 张图片`;
}

function imagesForProvider(assetImages) {
  const primaryImages = Array.isArray(assetImages) ? assetImages : [];
  const cropQueues = primaryImages.map((image) => (Array.isArray(image.targetedCrops) ? image.targetedCrops : [])
    .map((crop, cropIndex) => ({
      crop,
      cropIndex,
      priority: Number(crop.cropPlan?.priority || crop.crop_plan?.priority || 0)
    }))
    .sort((left, right) => right.priority - left.priority || left.cropIndex - right.cropIndex));
  const targetedCrops = [];

  // Image slots are deliberately neutral. Round-robin the best crops from each
  // uploaded image so one unknown side cannot consume the whole evidence budget.
  while (targetedCrops.length < FIELD_MAX_CROPS_PER_ASSET) {
    let added = false;
    for (const queue of cropQueues) {
      const next = queue.shift();
      if (!next) continue;
      targetedCrops.push(next.crop);
      added = true;
      if (targetedCrops.length >= FIELD_MAX_CROPS_PER_ASSET) break;
    }
    if (!added) break;
  }

  return [
    ...primaryImages,
    ...targetedCrops
  ];
}

export const __listingCopilotAppTestHooks = {
  assetLifecycleMatches,
  boundedProviderImagesForRequest,
  clearImageStorageBinding,
  generationTimingView,
  generationSubmissionAllowed,
  imageHasVerifiedStorageReference,
  imagesForProvider,
  queueSubmissionConcurrencyLimit,
  recognitionClockFromServerPayload,
  speculativeNeedsFreshEnqueue,
  storageDimensionsForImage,
  storageSourceForImage,
  syncAssetGenerationTimingFromServer
};

function buildAssets() {
  const assets = [];

  if (state.mode === "single") {
    state.files.forEach((image, index) => {
      assets.push({
        id: `asset-${index + 1}`,
        clientAssetRef: `asset-${index + 1}`,
        durableAssetId: "",
        durableTenantId: "",
        lifecycleGeneration: state.assetLifecycleGeneration,
        index: index + 1,
        images: [image],
        providerImages: imagesForProvider([image])
      });
    });
  } else {
    for (let index = 0; index < state.files.length; index += 2) {
      const images = state.files.slice(index, index + 2);
      assets.push({
        id: `asset-${Math.floor(index / 2) + 1}`,
        clientAssetRef: `asset-${Math.floor(index / 2) + 1}`,
        durableAssetId: "",
        durableTenantId: "",
        lifecycleGeneration: state.assetLifecycleGeneration,
        index: Math.floor(index / 2) + 1,
        images,
        providerImages: imagesForProvider(images)
      });
    }
  }

  state.assets = assets;
}

function writerModeActive() {
  return state.workspaceMode === "writer";
}

function workspaceInteractionLocked() {
  return state.writerSaveInFlight
    || state.exportingWorkbook
    || state.preparingFiles
    || state.priorityRetryInFlight;
}

function writerSavedAssets() {
  return state.assets.filter((asset) => {
    const result = resultForAsset(asset);
    return result?.feedbackStatus === "saved" && writerFeedbackPersisted(result);
  });
}

function writerProcessedCount() {
  return state.assets.filter((asset) => writerFeedbackPersisted(resultForAsset(asset))).length;
}

function writerAssetReadyForInput(asset) {
  const result = resultForAsset(asset);
  return Boolean(result && !v4WriterTitlePending(result) && result.feedbackStatus !== "saving");
}

function writerOutstandingAssets() {
  return state.assets.filter((asset) => !writerFeedbackPersisted(resultForAsset(asset)));
}

function syncWriterActiveIndex() {
  if (!state.assets.length) {
    state.writerActiveIndex = null;
    return null;
  }

  const current = state.assets.find((asset) => asset.index === Number(state.writerActiveIndex));
  const currentPersisted = current ? writerFeedbackPersisted(resultForAsset(current)) : false;
  if (
    current
    && writerAssetReadyForInput(current)
    && (state.writerSaveInFlight || state.writerReviewComplete || !currentPersisted)
  ) return current;

  const outstanding = writerOutstandingAssets();
  const next = outstanding.find(writerAssetReadyForInput) || current || outstanding[0] || state.assets[0];
  state.writerActiveIndex = next?.index ?? null;
  return next || null;
}

function writerAdjacentAsset(index, direction) {
  const position = state.assets.findIndex((asset) => asset.index === Number(index));
  if (position < 0) return null;
  return state.assets[position + direction] || null;
}

function scheduleWriterInputFocus(assetIndex = state.writerActiveIndex) {
  if (!writerModeActive() || !Number.isFinite(Number(assetIndex))) return;
  const focus = () => {
    const input = elements.assetPreviewList.querySelector(`[data-title-input="${Number(assetIndex)}"]:not([disabled])`);
    const currentCard = elements.assetPreviewList.querySelector(`[data-writer-card="${Number(assetIndex)}"]`);
    const focusTarget = input || currentCard;
    if (!focusTarget) return;
    focusTarget.focus({ preventScroll: true });
    if (input) {
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
    }
    state.writerFocusPending = false;
  };
  if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(focus);
  else setTimeout(focus, 0);
}

function scheduleWriterCompletionFocus() {
  if (!writerModeActive() || !state.writerCompletionFocusPending) return;
  const focus = () => {
    const action = elements.assetPreviewList.querySelector("[data-writer-export]:not([disabled]), [data-writer-go]:not([disabled])");
    action?.focus({ preventScroll: true });
    state.writerCompletionFocusPending = false;
  };
  if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(focus);
  else setTimeout(focus, 0);
}

function setWriterActiveIndex(index, { focus = true, animate = false, direction = "" } = {}) {
  if (workspaceInteractionLocked()) return;
  const asset = state.assets.find((candidate) => candidate.index === Number(index));
  if (!asset) return;
  state.writerActiveIndex = asset.index;
  state.writerTransition = animate && ["forward", "backward"].includes(direction) ? direction : "";
  state.writerFocusPending = focus;
  state.writerReviewComplete = true;
  state.writerCompletionFocusPending = false;
  renderResults({ forceWriterRender: true });
}

function clearCardViewTransitionNames() {
  elements.assetPreviewList?.querySelectorAll("[data-card-transition-index]").forEach((card) => {
    card.style.viewTransitionName = "";
  });
}

function setCardViewTransitionNames(indexes = []) {
  const visibleIndexes = [...new Set(indexes.map(Number).filter(Number.isFinite))].slice(0, 4);
  const visibleIndexSet = new Set(visibleIndexes);
  clearCardViewTransitionNames();
  elements.assetPreviewList?.querySelectorAll("[data-card-transition-index]").forEach((card) => {
    const index = Number(card.dataset.cardTransitionIndex);
    if (visibleIndexSet.has(index)) card.style.viewTransitionName = `listing-card-${index}`;
  });
  return visibleIndexes;
}

function writerWheelVisibleAssetIndexes(activeIndex = state.writerActiveIndex) {
  const current = state.assets.find((asset) => asset.index === Number(activeIndex));
  if (!current) return [];
  const previous = writerAdjacentAsset(current.index, -1);
  const nextDepthOne = writerAdjacentAsset(current.index, 1);
  const nextDepthTwo = nextDepthOne ? writerAdjacentAsset(nextDepthOne.index, 1) : null;
  return [previous, current, nextDepthOne, nextDepthTwo].filter(Boolean).map((asset) => asset.index);
}

function workbenchViewTransitionAllowed() {
  if (typeof document.startViewTransition !== "function") return false;
  if (document.documentElement.dataset.themeSwitching === "true") return false;
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches !== true;
  } catch {
    return true;
  }
}

function runWorkbenchViewTransition({ kind, enabled = true, prepareSharedElements = null, update }) {
  const transitionSequence = state.workbenchTransitionSequence + 1;
  state.workbenchTransitionSequence = transitionSequence;
  state.activeWorkbenchTransition?.skipTransition?.();
  state.activeWorkbenchTransition = null;
  clearCardViewTransitionNames();

  const performUpdate = () => {
    update();
    prepareSharedElements?.();
  };
  if (!enabled || !workbenchViewTransitionAllowed()) {
    delete document.documentElement.dataset.workbenchTransition;
    performUpdate();
    clearCardViewTransitionNames();
    return null;
  }

  prepareSharedElements?.();
  document.documentElement.dataset.workbenchTransition = kind;
  try {
    const transition = document.startViewTransition(performUpdate);
    state.activeWorkbenchTransition = transition;
    Promise.resolve(transition.finished).catch(() => {}).finally(() => {
      if (state.workbenchTransitionSequence !== transitionSequence) return;
      clearCardViewTransitionNames();
      delete document.documentElement.dataset.workbenchTransition;
      state.activeWorkbenchTransition = null;
    });
    return transition;
  } catch {
    performUpdate();
    clearCardViewTransitionNames();
    delete document.documentElement.dataset.workbenchTransition;
    return null;
  }
}

function updateWorkspaceModeUi() {
  const interactionLocked = workspaceInteractionLocked();
  const destructiveInteractionLocked = interactionLocked || state.processing;
  elements.workspace?.setAttribute("data-workspace-mode", state.workspaceMode);
  elements.workspace?.setAttribute("data-batch-state", state.assets.length ? "ready" : "empty");
  elements.workspaceModeButtons.forEach((button) => {
    const active = button.dataset.workspaceMode === state.workspaceMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.disabled = interactionLocked;
  });
  elements.imageInput.disabled = destructiveInteractionLocked;
  elements.resetButton.disabled = destructiveInteractionLocked;
  elements.dropZone.setAttribute("aria-disabled", destructiveInteractionLocked ? "true" : "false");
  if (elements.workspaceModeHint) {
    elements.workspaceModeHint.textContent = writerModeActive()
      ? "只看当前卡片；Enter 确认入库并推进到下一张。"
      : "查看全部卡片，逐张检查和编辑。";
  }
  if (elements.assetBoardTitle) elements.assetBoardTitle.textContent = writerModeActive() ? "写手滚轮" : "标题";
}

function setWorkspaceMode(mode, { animate = false } = {}) {
  if (workspaceInteractionLocked()) return;
  const nextMode = mode === "writer" ? "writer" : "standard";
  if (state.workspaceMode === nextMode) return;
  let transitionIndexes = writerWheelVisibleAssetIndexes();
  if (nextMode === "writer") {
    state.writerActiveIndex = null;
    const current = syncWriterActiveIndex();
    transitionIndexes = writerWheelVisibleAssetIndexes(current?.index);
  }
  runWorkbenchViewTransition({
    kind: "mode",
    enabled: animate && transitionIndexes.length > 0,
    prepareSharedElements: () => setCardViewTransitionNames(transitionIndexes),
    update: () => {
      state.workspaceMode = nextMode;
      state.writerTransition = "";
      state.writerFocusPending = nextMode === "writer";
      state.writerReviewComplete = false;
      state.writerCompletionFocusPending = false;
      closeImageModal();
      updateWorkspaceModeUi();
      renderResults({ forceWriterRender: true });
    }
  });
}

function updatePreviewSummary() {
  if (!state.assets.length) {
    elements.previewSummary.textContent = "等待上传图片。";
    return;
  }
  if (writerModeActive()) {
    elements.previewSummary.textContent = `${writerProcessedCount()} / ${state.assets.length} 张已处理，${writerSavedAssets().length} 张已入库。`;
    return;
  }
  const orphanNote = state.mode === "pair" && state.files.length % 2 === 1
    ? "最后 1 张图会作为单图资产处理。"
    : "";
  elements.previewSummary.textContent = `${state.files.length} 张图片，${state.assets.length} 张卡。${orphanNote}`;
}

function updateStats() {
  const high = state.results.filter((result) => normalizeConfidence(result.confidence) === "HIGH").length;
  const medium = state.results.filter((result) => normalizeConfidence(result.confidence) === "MEDIUM").length;
  const low = state.results.filter((result) => normalizeConfidence(result.confidence) === "LOW").length;
  const failed = state.results.filter((result) => normalizeConfidence(result.confidence) === "FAILED").length;

  elements.stats.images.textContent = state.files.length;
  elements.stats.assets.textContent = state.assets.length;
  elements.stats.processed.textContent = state.results.length;
  elements.stats.high.textContent = high;
  elements.stats.medium.textContent = medium;
  elements.stats.low.textContent = low;
  elements.stats.failed.textContent = failed;
  elements.stats.requests.textContent = state.assets.length;
  elements.stats.cost.textContent = formatCost(state.assets.length);
}

function renderPreviews() {
  buildAssets();
  updateStats();
  updateWorkspaceModeUi();

  elements.processButton.disabled = !canGenerateTitles();

  if (!state.assets.length) {
    closeImageModal();
    elements.previewSummary.textContent = "等待上传图片。";
    elements.assetPreviewList.innerHTML = `<div class="empty-state">${writerModeActive()
      ? "选择图片后，当前卡片会进入写手滚轮。"
      : "选择图片后，卡片会按上传顺序出现在这里。"}</div>`;
    return;
  }

  updatePreviewSummary();
  renderAssetRows();
}

function renderResults({ forceWriterRender = false } = {}) {
  const preserveFocusedTitleInput = !forceWriterRender
    && !workspaceInteractionLocked()
    && document.activeElement?.matches?.("[data-title-input]")
    && elements.assetPreviewList.contains(document.activeElement);
  updateStats();
  updateWorkspaceModeUi();
  renderBatchTitles();
  if (!preserveFocusedTitleInput) renderAssetRows();
  syncProcessButtonState();
  updatePreviewSummary();
  if (writerModeActive() && state.writerFocusPending && !preserveFocusedTitleInput) scheduleWriterInputFocus();
  if (writerModeActive() && state.writerCompletionFocusPending && !preserveFocusedTitleInput) scheduleWriterCompletionFocus();
}

function resultForAsset(asset) {
  return state.results.find((result) => result.index === asset.index);
}

function generatedTitleResults() {
  return [...state.results]
    .filter((result) => normalizeConfidence(result.confidence) !== "FAILED" && finalTitleForResult(result))
    .sort((a, b) => a.index - b.index);
}

function completedExportRowsReady() {
  if (writerModeActive()) {
    return writerExportRowsReady({
      assets: writerSavedAssets(),
      results: state.results,
      processing: state.writerSaveInFlight || state.preparingFiles || state.priorityRetryInFlight,
      exporting: state.exportingWorkbook,
      finalTitleForResult,
      isTitlePending: v4WriterTitlePending
    });
  }
  if (!state.assets.length) return false;
  if (state.processing || state.exportingWorkbook || state.preparingFiles) return false;
  return state.assets.every((asset) => {
    const result = resultForAsset(asset);
    return Boolean(result && finalTitleForResult(result) && !v4WriterTitlePending(result));
  });
}

function setExportWorkbookStatus(message = "") {
  if (!elements.exportWorkbookStatus) return;
  elements.exportWorkbookStatus.textContent = message;
  elements.assetPreviewList.querySelectorAll("[data-writer-export-status]").forEach((status) => {
    status.textContent = message;
  });
}

function updateExportWorkbookControls() {
  const ready = completedExportRowsReady();
  if (elements.exportWorkbookButton) {
    elements.exportWorkbookButton.disabled = !ready;
    elements.exportWorkbookButton.textContent = state.exportingWorkbook
      ? "正在导出…"
      : writerModeActive()
        ? `导出已入库 ${writerSavedAssets().length} 张`
        : "导出 Excel";
  }
  elements.assetPreviewList.querySelectorAll("[data-writer-export]").forEach((button) => {
    button.disabled = !ready;
    button.textContent = state.exportingWorkbook
      ? "正在导出…"
      : `导出已入库 ${writerSavedAssets().length} 张`;
  });
}

function modelQuickApprovalCandidate(result) {
  const gate = result?.publication_gate || {};
  return gate.model_quick_review_recommended === true
    || gate.writer_quick_approval_ready === true
    || gate.workflow_route === "LOW_TOUCH_REVIEW"
    || gate.status === "LOW_TOUCH_REVIEW"
    || gate.legacy_status === "WRITER_QUICK_APPROVAL_READY";
}

function renderBatchTitles() {
  const titleResults = generatedTitleResults();
  elements.copyAllButton.disabled = titleResults.length === 0;
  updateExportWorkbookControls();

  if (!titleResults.length) {
    elements.batchTitleList.innerHTML = `<li class="batch-empty">生成后可在这里统一复制或导出。</li>`;
    return;
  }

  elements.batchTitleList.innerHTML = titleResults.map((result) => `
    <li>
      <span>卡片 ${result.index}</span>
      <p>${escapeHtml(result.correctedTitle ?? result.title)}</p>
    </li>
  `).join("");
}

function cropRegionLabel(region = "") {
  return labelForCsmField(region, "Field Crop");
}

function modalImagesForAsset(asset = {}) {
  return asset.images || [];
}

function fieldCropStrip(asset) {
  return "";
}

function writerAssetStatusLabel(asset) {
  const result = resultForAsset(asset);
  if (!result) return state.processing ? "识别中" : "等待生成";
  if (result.feedbackStatus === "saved" && writerFeedbackPersisted(result)) return "已入库";
  if (result.feedbackStatus === "skipped" && writerFeedbackPersisted(result)) return "已记录拒绝";
  if (result.feedbackStatus === "skipped") return "未留存";
  if (result.feedbackStatus === "saving") return "正在入库";
  if (v4WriterTitlePending(result)) return "标题生成中";
  return "待录入";
}

function writerPeekHtml(asset, position) {
  if (!asset) return `<div class="writer-wheel-peek writer-wheel-peek-${position} writer-wheel-peek-empty" aria-hidden="true"></div>`;
  const image = asset.images?.[0];
  const status = writerAssetStatusLabel(asset);
  const relativeLabel = position === "previous" ? "上一张" : position === "next-depth-2" ? "下两张" : "下一张";
  return `
    <button class="writer-wheel-peek writer-wheel-peek-${position}" type="button" data-writer-go="${asset.index}" data-writer-direction="${position === "previous" ? "backward" : "forward"}" data-card-transition-index="${asset.index}" aria-label="${relativeLabel}，卡片 ${asset.index}，${escapeHtml(status)}">
      ${image ? `<img src="${image.dataUrl}" alt="">` : ""}
      <span>卡片 ${asset.index}</span>
      <small>${escapeHtml(status)}</small>
    </button>
  `;
}

function writerCurrentCardHtml(asset) {
  const result = resultForAsset(asset);
  const status = writerAssetStatusLabel(asset);
  return `
    <article class="writer-wheel-card" data-writer-card="${asset.index}" data-card-transition-index="${asset.index}" aria-current="true" aria-label="当前卡片 ${asset.index}，${escapeHtml(status)}" tabindex="-1">
      <header class="writer-wheel-card-head">
        <div><span>当前卡片</span><strong>卡片 ${asset.index}</strong></div>
        <small>${escapeHtml(status)}</small>
      </header>
      <div class="asset-row-card writer-wheel-current-card" data-asset-index="${asset.index}">
        <div class="asset-source">
          <div class="preview-images ${asset.images.length === 1 ? "single" : ""}">
            ${asset.images.map((image, imageIndex) => `
              <button class="thumb-button" type="button" data-preview-asset="${asset.index}" data-preview-image="${imageIndex}" aria-label="打开卡片图片预览">
                <img class="thumb" src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
              </button>
            `).join("")}
          </div>
          <div class="preview-meta"><h3>卡片 ${asset.index}</h3><span>${assetCountLabel(asset.images.length)}</span></div>
        </div>
        ${result ? resultBox(result, asset) : pendingBox(asset)}
      </div>
    </article>
  `;
}

function writerCompletionHtml() {
  const savedCount = writerSavedAssets().length;
  const rejectedCount = state.assets.filter((asset) => {
    const result = resultForAsset(asset);
    return result?.feedbackStatus === "skipped" && writerFeedbackPersisted(result);
  }).length;
  const detail = rejectedCount
    ? `${savedCount} 张已入库，${rejectedCount} 张已记录拒绝。Excel 只包含已入库卡片。`
    : `${savedCount} 张卡片已全部入库，可以直接导出。`;
  return `
    <section class="writer-wheel-complete" aria-live="polite">
      <span>本轮完成</span>
      <h3>${savedCount} 张已入库</h3>
      <p>${escapeHtml(detail)}</p>
      <div class="writer-wheel-complete-actions">
        <button class="primary-button" type="button" data-writer-export ${completedExportRowsReady() ? "" : "disabled"}>导出已入库 ${savedCount} 张</button>
        ${state.assets.length ? `<button class="copy-button" type="button" data-writer-go="${state.assets[state.assets.length - 1].index}" data-writer-direction="backward">回看上一张</button>` : ""}
      </div>
      <p class="writer-wheel-export-status" data-writer-export-status role="status" aria-live="polite">${escapeHtml(elements.exportWorkbookStatus?.textContent || "")}</p>
    </section>
  `;
}

function renderWriterWheel() {
  const allProcessed = state.assets.length > 0 && writerProcessedCount() === state.assets.length;
  if (allProcessed && !state.writerSaveInFlight && !state.writerReviewComplete) {
    elements.assetPreviewList.innerHTML = writerCompletionHtml();
    updateExportWorkbookControls();
    return;
  }

  const current = syncWriterActiveIndex();
  if (!current) {
    elements.assetPreviewList.innerHTML = `<div class="empty-state">等待卡片进入写手队列。</div>`;
    return;
  }

  const previous = writerAdjacentAsset(current.index, -1);
  const nextDepthOne = writerAdjacentAsset(current.index, 1);
  const nextDepthTwo = nextDepthOne ? writerAdjacentAsset(nextDepthOne.index, 1) : null;
  const savedCount = writerSavedAssets().length;
  const writerTransition = state.writerTransition;
  state.writerTransition = "";
  elements.assetPreviewList.innerHTML = `
    <section class="writer-wheel" aria-label="写手模式单卡队列">
      <header class="writer-wheel-head">
        <div><span>写手队列</span><strong>${current.index} / ${state.assets.length}</strong></div>
        <p>${savedCount} 张已入库 · Enter 保存并推进</p>
      </header>
      <div class="writer-wheel-viewport" data-writer-wheel>
        <div class="writer-wheel-track ${writerTransition ? `writer-transition-${writerTransition}` : ""}">
          ${writerCurrentCardHtml(current)}
          ${writerPeekHtml(previous, "previous")}
          ${writerPeekHtml(nextDepthOne, "next-depth-1")}
          ${writerPeekHtml(nextDepthTwo, "next-depth-2")}
        </div>
      </div>
      <footer class="writer-wheel-footer">
        <span>标题保存成功后卡片才会上移；失败会停留在当前卡。</span>
        <button class="copy-button" type="button" data-writer-export ${completedExportRowsReady() ? "" : "disabled"}>导出已入库 ${savedCount} 张</button>
      </footer>
      <p class="writer-wheel-export-status" data-writer-export-status role="status" aria-live="polite">${escapeHtml(elements.exportWorkbookStatus?.textContent || "")}</p>
    </section>
  `;
  updateExportWorkbookControls();
}

function renderAssetRows() {
  if (!state.assets.length) return;
  if (writerModeActive()) {
    renderWriterWheel();
    return;
  }

  const hasAnyResult = state.results.length > 0;
  if (!hasAnyResult) {
    elements.assetPreviewList.innerHTML = state.assets.map(assetRowHtml).join("");
    return;
  }

  const groups = [
    {
      key: "quick",
      label: "优先检查",
      assets: state.assets.filter((asset) => modelQuickApprovalCandidate(resultForAsset(asset)))
    },
    {
      key: "review",
      label: "需要确认",
      assets: state.assets.filter((asset) => {
        const result = resultForAsset(asset);
        if (!result || modelQuickApprovalCandidate(result)) return false;
        const gate = result.publication_gate || {};
        return gate.writer_review_ready === true;
      })
    },
    {
      key: "manual",
      label: "需要处理",
      assets: state.assets.filter((asset) => {
        const result = resultForAsset(asset);
        if (!result) return true;
        if (modelQuickApprovalCandidate(result)) return false;
        const gate = result.publication_gate || {};
        return gate.writer_review_ready !== true;
      })
    }
  ].filter((group) => group.assets.length);

  elements.assetPreviewList.innerHTML = groups.map((group) => `
    <section class="asset-review-group ${group.key}">
      <div class="asset-review-group-head">
        <span>${escapeHtml(group.label)}</span>
        <strong>${group.assets.length}</strong>
      </div>
      ${group.assets.map(assetRowHtml).join("")}
    </section>
  `).join("");
}

function assetRowHtml(asset) {
    const result = resultForAsset(asset);

    return `
      <article class="asset-row-card" data-asset-index="${asset.index}" data-card-transition-index="${asset.index}">
        <div class="asset-source">
          <div class="preview-images ${asset.images.length === 1 ? "single" : ""}">
            ${asset.images.map((image, imageIndex) => `
              <button class="thumb-button" type="button" data-preview-asset="${asset.index}" data-preview-image="${imageIndex}" aria-label="打开卡片图片预览">
                <img class="thumb" src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
              </button>
            `).join("")}
          </div>
          <div class="preview-meta">
            <h3>卡片 ${asset.index}</h3>
            <span>${assetCountLabel(asset.images.length)}</span>
            ${fieldCropStrip(asset)}
          </div>
        </div>
        ${result ? resultBox(result, asset) : pendingBox(asset)}
      </article>
    `;
}

function pendingBox(asset) {
  const isActive = state.activeAssetIndexes.has(asset.index);
  const isQueued = state.processing && !isActive;
  const isWorking = isActive || isQueued;
  const label = isActive ? "识别中" : isQueued ? "排队中" : "等待中";
  const progress = assetProgressSnapshot(asset);
  const message = isActive
    ? "正在识别这张卡，完成后会直接显示最终标题。"
    : isQueued
      ? "已经进入队列，不需要重复点击。"
      : "点击生成标题后开始识别。";
  return `
    <div class="title-output title-output-pending ${isWorking ? "is-working" : "is-idle"}">
      <div class="title-output-head">
        <span class="confidence-badge confidence-pending">${escapeHtml(label)}</span>
        <span>卡片 ${asset.index}</span>
        ${generationTimingBadge(asset.index)}
      </div>
      <div class="pending-state ${isWorking ? "pending-active" : "pending-idle"}" role="status" aria-live="polite">
        ${isWorking ? `<span class="loading-spinner" aria-hidden="true"></span>` : `<span class="idle-dot" aria-hidden="true"></span>`}
        <strong>${escapeHtml(label)}</strong>
        <p>${escapeHtml(message)}</p>
        ${isWorking ? progressMeter(progress.percent, progress.label || label, asset.index) : ""}
        ${isWorking ? `<span class="progress-label" data-progress-label-asset="${asset.index}">${escapeHtml(progress.label || label)}</span>` : ""}
        ${isWorking ? `<span class="pending-timing">${generationTimingBadge(asset.index)}</span>` : ""}
        ${isWorking ? `<span class="pending-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>` : ""}
      </div>
      <textarea readonly placeholder="等待生成最终英文标题。"></textarea>
    </div>
  `;
}

function friendlyErrorSummary(reason = "") {
  const text = String(reason || "").trim();
  if (/field_evidence\.[\w-]+\s+Unknown structured field evidence key/i.test(text)) {
    return "识别结果字段结构需要更新，请刷新页面后重试。";
  }
  if (/schema validation|schema_validation|response schema/i.test(text)) {
    return "识别结果结构校验失败，请重试。";
  }
  if (/413|request body|too large|过大/i.test(text)) {
    return "图片请求过大，系统已尝试缩减辅助图；请稍后重试。";
  }
  if (/timeout|timed out|超时/i.test(text)) {
    return "模型响应超时，请重试。";
  }
  if (queueReadinessCodeFromError(text) === "QUEUE_RPC_NOT_READY") {
    return "系统队列初始化异常，请稍后重试。";
  }
  return text || "识别未返回可用标题。";
}

function queueReadinessCodeFromError(reason = "") {
  const text = String(reason || "").trim();
  if (!text) return "";
  if (/\bQUEUE_RPC_NOT_READY\b/i.test(text)) return "QUEUE_RPC_NOT_READY";
  if (/\bPGRST202\b/i.test(text) && /enqueue_v4_recognition_batch_atomic/i.test(text)) return "QUEUE_RPC_NOT_READY";
  if (/atomic_enqueue_rpc_failed/i.test(text) && /enqueue_v4_recognition_batch_atomic/i.test(text) && /404/i.test(text)) return "QUEUE_RPC_NOT_READY";
  return "";
}

function queueFailureDisplayLines(reason = "") {
  if (queueReadinessCodeFromError(reason) !== "QUEUE_RPC_NOT_READY") return [];
  return [
    "任务提交失败",
    "原因：系统队列初始化异常",
    "请稍后重试",
    "内部：QUEUE_RPC_NOT_READY"
  ];
}

function queueFailureAdviceHtml(reason = "", skipHeadline = false) {
  const lines = queueFailureDisplayLines(reason);
  const visibleLines = (lines.length ? lines : [friendlyErrorSummary(reason)])
    .slice(skipHeadline ? 1 : 0)
    .filter(Boolean);
  if (!visibleLines.length) return "";
  return visibleLines.map((line) => escapeHtml(line)).join("<br>");
}

function compactDisplayValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(compactDisplayValue).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "";
  if (typeof value === "object") {
    const direct = value.resolved_value
      ?? value.value
      ?? value.text
      ?? value.raw_text
      ?? value.visible_text
      ?? value.direct_observation
      ?? value.best_reading;
    if (direct !== undefined && direct !== value) return compactDisplayValue(direct);
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value).trim();
}

function fieldValue(result, fields = []) {
  const resolved = currentResolvedForResult(result) || {};
  const rawFields = result.fields || {};
  const generated = result.generated_resolved_fields || {};
  const stores = [resolved, rawFields, generated];

  for (const field of fields) {
    for (const store of stores) {
      const value = compactDisplayValue(store?.[field]);
      if (value) return value;
    }
  }

  return "";
}

function subjectInitialsForDisplay(value) {
  const words = String(value || "")
    .replace(/[^A-Za-z\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
  if (words.length < 2) return "";
  return words.map((word) => word[0]).join("").toUpperCase();
}

function subjectInitialsForResult(result = {}) {
  const resolved = currentResolvedForResult(result) || {};
  const rawFields = result.fields || {};
  const subjects = [
    resolved.subject,
    resolved.player,
    rawFields.subject,
    rawFields.player,
    ...[].concat(resolved.subjects || [], resolved.players || [], rawFields.subjects || [], rawFields.players || [])
  ].filter(Boolean);
  return subjects.map(subjectInitialsForDisplay).filter(Boolean);
}

function sanitizeCollectorNumberDisplay(value, result = {}) {
  const text = compactDisplayValue(value).replace(/^#\s*/, "").trim();
  if (!text) return "";
  if (/^(?:unknown|none|null|n\/a|na|not visible|unreadable|unclear)$/i.test(text)) return "";
  if (/^[A-Z]{1,2}$/i.test(text)) return "";
  if (subjectInitialsForResult(result).includes(text.toUpperCase())) return "";
  return text;
}

function collectorNumberDisplayValue(result = {}) {
  const resolved = currentResolvedForResult(result) || {};
  const rawFields = result.fields || {};
  const generated = result.generated_resolved_fields || {};
  const stores = [resolved, rawFields, generated];
  for (const field of ["collector_number", "card_number", "checklist_code", "tcg_card_number"]) {
    for (const store of stores) {
      const value = sanitizeCollectorNumberDisplay(store?.[field], result);
      if (value) return value;
    }
  }
  return "";
}

function gradeDisplayValue(result = {}) {
  const resolved = currentResolvedForResult(result) || {};
  const rawFields = result.fields || {};
  const generated = result.generated_resolved_fields || {};
  const stores = [resolved, rawFields, generated];

  for (const store of stores) {
    const fullGrade = compactDisplayValue(store?.grade);
    if (/\b(?:PSA|BGS|SGC|CGC|TAG|PSA\/DNA)\b/i.test(fullGrade) && /\b(?:AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i.test(fullGrade.replace(/\b(?:PSA|BGS|SGC|CGC|TAG|PSA\/DNA)\b/gi, ""))) {
      return fullGrade;
    }
  }

  for (const store of stores) {
    const company = compactDisplayValue(store?.grade_company).toUpperCase();
    const cardGrade = compactDisplayValue(store?.card_grade || store?.grade);
    const autoGrade = compactDisplayValue(store?.auto_grade);
    if (!company || !/\b(?:PSA|BGS|SGC|CGC|TAG|PSA\/DNA)\b/i.test(company)) continue;
    if (!/\b(?:AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/i.test(cardGrade)) continue;
    return [company, [cardGrade, autoGrade].filter(Boolean).join("/")].filter(Boolean).join(" ");
  }

  return "";
}

function displayValueForEvidenceRow(result = {}, row = {}) {
  if (row.valueGetter === "collector_number") return collectorNumberDisplayValue(result);
  if (row.valueGetter === "grade") return gradeDisplayValue(result);
  return fieldValue(result, row.fields);
}

function evidenceSourceLabel(item = {}) {
  const source = String(
    item.source_type
      || item.sourceType
      || item.source
      || item.image_role
      || item.imageRole
      || item.region
      || item.sourceRegion
      || item.source_region
      || ""
  ).toUpperCase();

  if (/SLAB|GRADE_LABEL|LABEL/.test(source)) return "评级标签";
  if (/BACK/.test(source)) return "卡背文字";
  if (/FRONT/.test(source)) return "卡面文字";
  if (/SERIAL/.test(source)) return "Serial 局部";
  if (/YEAR|PRODUCT|CHECKLIST|COLLECTOR/.test(source)) return "文字局部";
  if (/OCR/.test(source)) return "OCR 文字";
  if (/VISUAL|IMAGE|MODEL|GPT|OPENAI/.test(source)) return "图片观察";
  if (/REGISTRY|CATALOG|CHECKLIST/.test(source)) return "目录核对";
  return "图片识别";
}

function evidenceTextFromNode(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node
      .slice(0, 2)
      .map(evidenceTextFromNode)
      .filter(Boolean)
      .join("；");
  }
  if (typeof node !== "object") return compactDisplayValue(node);

  const value = compactDisplayValue(
    node.raw_text
      ?? node.visible_text
      ?? node.direct_observation
      ?? node.evidence_text
      ?? node.text
      ?? node.value
      ?? node.best_reading
      ?? node.resolved_value
  );
  const source = evidenceSourceLabel(node);
  if (value) return `${source}：${value}`;

  const supporting = node.supporting_sources || node.sources || node.evidence || node.items;
  if (supporting) return evidenceTextFromNode(supporting);

  return source;
}

function evidenceForField(result, fields = []) {
  const containers = [
    result.field_evidence,
    result.evidence?.field_evidence,
    result.generated_evidence?.field_evidence,
    result.evidence,
    result.generated_evidence,
    result.field_states
  ].filter((container) => container && typeof container === "object");

  for (const field of fields) {
    for (const container of containers) {
      const direct = container[field];
      const text = evidenceTextFromNode(direct);
      if (text) return text;
    }
  }

  const value = fieldValue(result, fields);
  return value ? "图片识别结果，写手确认即可" : "未识别到";
}

function evidenceRows(result, unresolved = []) {
  return [
    { label: "Year", fields: ["year", "season_year", "product_year"] },
    { label: "Product / Set", fields: ["product_or_set", "product", "set", "manufacturer", "brand"] },
    { label: "Subject", fields: ["subject", "subjects", "players", "player", "character"] },
    { label: "Card Name", fields: ["card_name", "insert", "subset", "card_type"] },
    { label: "Color", fields: ["surface_color", "color", "parallel_family"] },
    { label: "Exact Parallel", fields: ["parallel_exact", "parallel", "variant_or_parallel"] },
    { label: "Collector #", fields: ["collector_number", "card_number", "checklist_code", "tcg_card_number"], valueGetter: "collector_number" },
    { label: "Serial", fields: ["serial_number"] },
    { label: "Grade", fields: ["grade_company", "card_grade", "grade", "auto_grade"], valueGetter: "grade" }
  ].map((row) => {
    const value = displayValueForEvidenceRow(result, row);
    const pending = row.fields.some((field) => unresolved.includes(field));
    return {
      ...row,
      value,
      evidence: evidenceForField(result, row.fields),
      pending
    };
  }).filter((row) => row.value || row.pending);
}

function evidenceCropStrip(asset = null) {
  const images = (asset?.providerImages || [])
    .filter((image) => imageIsDerivedForRequest(image))
    .slice(0, 6);
  if (!images.length) return "";

  return `
    <div class="evidence-crop-strip" aria-label="关键局部图">
      ${images.map((image) => {
        const label = cropRegionLabel(image.sourceRegion || image.source_region || image.cropPlan?.role || image.storageRole || "");
        return `
          <figure>
            <img src="${image.dataUrl}" alt="${escapeHtml(label)}">
            <figcaption>${escapeHtml(label)}</figcaption>
          </figure>
        `;
      }).join("")}
    </div>
  `;
}

function writerEvidenceDetails(result, asset = null, unresolved = []) {
  const rows = evidenceRows(result, unresolved);
  const qualityWarning = writerQualityWarning(result);
  if (!rows.length && !qualityWarning) return "";

  return `
    <details class="writer-evidence-details">
      <summary>查看字段依据（写手版）</summary>
      <p class="writer-evidence-help">这里只显示写手可用的信息：字段值、来自卡面/卡背/标签/局部图的位置，以及是否需要确认。</p>
      ${qualityWarning ? `<p class="writer-quality-warning">${escapeHtml(qualityWarning)}</p>` : ""}
      ${evidenceCropStrip(asset)}
      <div class="field-list writer-evidence-list">
        ${rows.map((row) => `
          <div class="${row.pending ? "needs-review" : ""}">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value || "待确认")}</strong>
            <small>${escapeHtml(row.evidence || "未识别到")}</small>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function resultBox(result, asset = null) {
  return TitleCardComponent(result, asset);
}

function TitleCardComponent(result, asset = null) {
  const confidence = normalizeConfidence(result.confidence);
  const queueFailureLines = queueFailureDisplayLines(result.reason || "");
  const failed = confidence === "FAILED";
  const titlePending = v4WriterTitlePending(result);
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
  const generatedTitle = result.generatedTitle || result.final_title || result.title || "";
  const correctedTitle = result.correctedTitle ?? generatedTitle;
  const writerReviewWithoutDraft = result.writerReviewRequired === true && !String(correctedTitle || "").trim();
  const copyDisabled = titlePending || !correctedTitle;
  const feedbackCommitted = writerFeedbackPersisted(result);
  const retrySubmitting = result.queueRetryStatus === "submitting";
  const interactionLocked = workspaceInteractionLocked();
  const saveDisabled = titlePending || interactionLocked || retrySubmitting || result.feedbackStatus === "saving" || feedbackCommitted;
  const editorDisabled = titlePending || interactionLocked || retrySubmitting || result.feedbackStatus === "saving";
  const retryableFailure = failed
    || ["FAILED", "TIMEOUT"].includes(v4AssistedStatus(result))
    || ["FAILED", "CANCELLED"].includes(String(result.v4_job_status || "").toUpperCase());
  const canPriorityRetry = retryableFailure
    && !titlePending
    && !state.processing
    && (!interactionLocked || retrySubmitting);
  const titleEdited = String(correctedTitle || "").trim() && String(correctedTitle || "").trim() !== String(generatedTitle || "").trim();
  const saveLabel = {
    saved: "已保存",
    skipped: feedbackCommitted ? "已记录拒绝" : "未留存",
    saving: "保存中…"
  }[result.feedbackStatus] || (titleEdited ? "保存编辑" : "接受");
  const rejectDisabled = titlePending || interactionLocked || retrySubmitting || result.feedbackStatus === "saving" || feedbackCommitted;
  const statusLabel = failed
    ? "失败"
    : writerReviewWithoutDraft
      ? "需人工输入"
    : ["MEDIUM", "LOW"].includes(confidence) || unresolved.length
      ? "需确认"
      : "已生成";
  const unavailableTitle = titlePending
    ? "正在生成一段式标题"
    : writerReviewWithoutDraft
    ? "证据不足，系统未猜测；请直接输入最终英文标题"
    : failed
    ? (queueFailureLines[0] || `标题暂不可用：${friendlyErrorSummary(result.reason)}`)
    : "标题暂不可用";
  const textareaValue = titlePending || writerReviewWithoutDraft || (failed && !correctedTitle) ? "" : (correctedTitle || unavailableTitle);
  const pendingProgress = titlePending ? assetProgressSnapshot(result.index) : null;
  const omissionNotice = writerTitleOmissionNotice(result);

  return `
    <div class="title-output ${confidenceClass(confidence)}">
      <div class="title-output-head">
        <span class="confidence-badge ${confidenceClass(confidence)}">${escapeHtml(statusLabel)}</span>
        <div class="title-actions">
          ${generationTimingBadge(result.index)}
          ${canPriorityRetry ? `<button class="copy-button retry-priority-button" type="button" data-priority-retry="${result.index}" ${retrySubmitting ? "disabled" : ""}>${retrySubmitting ? "正在重排…" : "优先重试"}</button>` : ""}
          <button class="copy-button" type="button" data-copy-result="${result.index}" ${copyDisabled ? "disabled" : ""}>复制</button>
          <button class="copy-button" type="button" data-save-title="${result.index}" ${saveDisabled ? "disabled" : ""}>${saveLabel}</button>
          <button class="copy-button reject-button" type="button" data-reject-title="${result.index}" ${rejectDisabled ? "disabled" : ""}>拒绝</button>
        </div>
      </div>
      ${assistedDraftNotice(result)}
      ${titlePending && pendingProgress ? progressMeter(pendingProgress.percent, pendingProgress.label || "云端生成中", result.index) : ""}
      ${titlePending && pendingProgress ? `<span class="progress-label" data-progress-label-asset="${result.index}">${escapeHtml(pendingProgress.label || "云端生成中")}</span>` : ""}
      <textarea rows="1" maxlength="80" spellcheck="false" aria-label="卡片 ${result.index} 最终英文标题" data-title-input="${result.index}" placeholder="${escapeHtml(unavailableTitle)}" ${editorDisabled ? "disabled" : ""}>${escapeHtml(textareaValue)}</textarea>
      ${omissionNotice ? `<p class="title-omission-notice">${escapeHtml(omissionNotice)}</p>` : ""}
      ${titleOverrideNotice(result)}
      ${failed || result.reason ? `<p class="follow-up-advice">${queueFailureAdviceHtml(result.reason || "", failed && Boolean(queueFailureLines[0]))}</p>` : ""}
      ${result.feedbackMessage ? `<p class="feedback-save-status" role="status" aria-live="polite">${escapeHtml(result.feedbackMessage)}</p>` : ""}
    </div>
  `;
}

function workflowStepStateText(state = "") {
  return {
    DONE: "完成",
    FAILED: "失败",
    IDENTITY_ASSIST: "已支持",
    FIELD_SUPPORT: "字段支持",
    FAIL_CLOSED: "已挡冲突",
    SHADOW_ONLY: "后台参考",
    UNAVAILABLE: "不可用",
    OFF: "未启用",
    NO_MATCH: "未命中",
    EVIDENCE_ATTACHED: "已补证据",
    COMPLETED_NO_PATCH: "已检查",
    QUEUED: "已排队",
    FAILED_NON_BLOCKING: "失败不阻塞",
    NOT_CONFIGURED: "未配置",
    NOT_USED: "未触发",
    QUEUED_OR_CREATED: "已连接",
    COMPLETED_OR_SYNCED: "已同步",
    TRACE_ONLY: "只追踪"
  }[state] || state || "-";
}

function workflowStepClass(state = "") {
  if (/DONE|IDENTITY_ASSIST|EVIDENCE_ATTACHED|COMPLETED|SYNCED/i.test(state)) return "workflow-ok";
  if (/FIELD_SUPPORT|QUEUED|SHADOW|TRACE/i.test(state)) return "workflow-pending";
  if (/FAIL_CLOSED|FAILED|UNAVAILABLE|NOT_CONFIGURED/i.test(state)) return "workflow-warn";
  return "workflow-muted";
}

function workflowActionClass(kind = "") {
  return `workflow-action-${String(kind || "review").toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
}

function workflowSummaryNotice(result) {
  const summary = result.workflow_summary;
  if (!summary || typeof summary !== "object") return "";
  const hideRawCandidateDetails = summary.ui?.hide_raw_candidate_details !== false;
  const steps = Array.isArray(summary.compact_steps) ? summary.compact_steps : [];
  const nextActions = Array.isArray(summary.operator_next_actions)
    ? summary.operator_next_actions.filter((action) => action && action.text).slice(0, 5)
    : [];
  const fields = Array.isArray(summary.highlighted_fields) && summary.highlighted_fields.length
    ? summary.highlighted_fields.slice(0, 6).map((field) => labelForCsmField(field)).join(", ")
    : "";
  const statusClass = summary.blocking ? "manual-required" : summary.status === "LOW_TOUCH_REVIEW" ? "quick-approval" : "writer-ready";

  return `
    <div class="workflow-summary ${statusClass}" data-workflow-summary data-hide-raw-candidate-details="${hideRawCandidateDetails ? "true" : "false"}">
      <div class="workflow-summary-head">
        <span>系统结论</span>
        <strong>${escapeHtml(summary.writer_action || "标题已生成，请检查后保存。")}</strong>
        ${fields ? `<small>重点模块：${escapeHtml(fields)}</small>` : ""}
      </div>
      <div class="workflow-step-row">
        ${steps.slice(0, 5).map((step) => `
          <span class="workflow-step ${workflowStepClass(step.state)}" title="${escapeHtml(step.writer_text || "")}">
            <b>${escapeHtml(step.label || step.key || "")}</b>
            <em>${escapeHtml(workflowStepStateText(step.state))}</em>
          </span>
        `).join("")}
      </div>
      ${nextActions.length ? `
        <ol class="workflow-action-list" aria-label="写手下一步动作">
          ${nextActions.map((action) => `
            <li class="${workflowActionClass(action.kind)}">${escapeHtml(action.text)}</li>
          `).join("")}
        </ol>
      ` : ""}
    </div>
  `;
}

const workflowLabels = {
  LOW_TOUCH_REVIEW: "低触审核",
  STANDARD_REVIEW: "标准审核",
  DEEP_REVIEW: "深度审核",
  RESCAN_REQUIRED: "需要补拍"
};

function publicationGateNotice(result) {
  const gate = result.publication_gate || {};
  if (!gate.status) return "";

  const fields = Array.isArray(gate.writer_required_fields)
    ? gate.writer_required_fields
    : [];
  const fieldText = fields.length
    ? fields.map((field) => labelForCsmField(field)).join(", ")
    : "无需补字段";
  const quickApproval = modelQuickApprovalCandidate(result);
  const route = gate.workflow_route || gate.status;
  const readyText = workflowLabels[route] || (gate.writer_review_ready ? "已生成可编辑标题" : "需要人工处理");
  const gateClass = quickApproval
    ? "quick-approval"
    : gate.writer_review_ready
      ? "writer-ready"
      : "manual-required";
  const helpText = quickApproval
    ? "写手看过并同意后保存审核记录，再一键发布。"
    : gate.writer_review_ready
      ? "黄色字段需要写手确认或编辑；上传前必须保存审核记录。"
      : "请补拍、拆分多卡，或人工完成关键字段。";

  return `
    <div class="publication-gate ${gateClass}">
      <span>${escapeHtml(readyText)}</span>
      <strong>写手待补：${escapeHtml(fieldText)}</strong>
      <small>${escapeHtml(helpText)}</small>
    </div>
  `;
}

function titleOverrideNotice(result) {
  if (!result.title_override) return "";

  return `
    <div class="title-override-note">
      <span>人工标题覆盖会作为训练样本保存，不会反向修改内部结构化字段。</span>
    </div>
  `;
}

function assistedDraftNotice(result = {}) {
  if (!isV4Result(result)) return "";
  const status = v4AssistedStatus(result);
  if (status === "READY") return "";
  if (!status && result.full_assist_continued_after_l1 !== true) return "";
  const label = {
    READY: "一段式标题已生成",
    RUNNING: "一段式标题生成中",
    PENDING: "一段式标题生成中",
    TIMEOUT: "一段式标题暂未完成",
    FAILED: "一段式标题生成失败"
  }[status || "PENDING"] || "一段式标题生成中";
  const detail = {
    READY: "现在可以直接检查或编辑这一条标题。",
    RUNNING: "正在生成最终标题。",
    PENDING: "正在生成最终标题。",
    TIMEOUT: "当前标题仍可编辑，稍后可重试或保存人工修改。",
    FAILED: "当前标题仍可编辑，必要时使用单模型重试。"
  }[status || "PENDING"];
  const className = status === "READY" ? "ready" : status === "FAILED" || status === "TIMEOUT" ? "warn" : "pending";
  return `
    <div class="assisted-draft-status ${className}">
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function currentModalAsset() {
  if (!state.modal) return null;
  return state.assets.find((asset) => asset.index === state.modal.assetIndex) || null;
}

function renderImageModal() {
  const asset = currentModalAsset();
  if (!asset) {
    closeImageModal();
    return;
  }

  const result = resultForAsset(asset);
  const modalImages = modalImagesForAsset(asset);
  const imageIndex = Math.min(state.modal.imageIndex, modalImages.length - 1);
  const image = modalImages[imageIndex];
  elements.imageModalImage.src = image.dataUrl;
  elements.imageModalImage.alt = image.name;
  elements.imageModalSide.textContent = "预览";
  elements.imageModalTitle.textContent = `资产 ${asset.index}`;
  elements.imageModalFileName.textContent = image.name;
  elements.imageModalSwitcher.innerHTML = modalImages.map((assetImage, index) => `
    <button class="modal-side-button ${index === imageIndex ? "active" : ""}" type="button" data-modal-image="${index}" aria-label="切换卡片图片">
      <span class="sr-only">切换卡片图片</span>
    </button>
  `).join("");
}

function openImageModal(assetIndex, imageIndex) {
  state.modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.modal = { assetIndex, imageIndex };
  renderImageModal();
  elements.imageModal.removeAttribute("inert");
  elements.imageModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  elements.imageModalClose.focus();
}

function closeImageModal() {
  if (!state.modal) return;
  const returnFocus = state.modalReturnFocus;
  state.modal = null;
  state.modalReturnFocus = null;
  elements.imageModal.setAttribute("aria-hidden", "true");
  elements.imageModal.setAttribute("inert", "");
  elements.imageModalImage.removeAttribute("src");
  document.body.classList.remove("modal-open");
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function switchModalImage(imageIndex) {
  if (!state.modal) return;
  state.modal.imageIndex = imageIndex;
  renderImageModal();
}

function reasoningFields(fields, unresolved = [], resolved = {}) {
  return [
    ["主体 Player / Character", fields.player || fields.character],
    ["画师 Artist", fields.artist],
    ["年份 Year", fields.year],
    ["品牌 Brand", fields.brand],
    ["产品 / 系列 Product / Set", [fields.product, fields.set].filter(Boolean).join(" / ")],
    ["子系列 / Insert", [fields.subset, fields.insert].filter(Boolean).join(" / ")],
    ["Parallel", fields.parallel],
    ["队伍 Team", fields.team],
    ["卡号 / 编码", fields.card_number],
    ["Serial 编号", fields.serial_number],
    ["Collector Number", resolved.collector_number],
    ["Checklist Code", resolved.checklist_code],
    ["评级 Grade", [fields.grade_company, fields.grade].filter(Boolean).join(" ")],
    ["Grade Type", resolved.grade_type && resolved.grade_type !== "UNKNOWN" ? resolved.grade_type : ""],
    ["Auto / Relic / Patch / Sketch", [
      fields.auto ? "auto" : "",
      fields.relic ? "relic" : "",
      fields.patch ? "patch" : "",
      fields.sketch ? "sketch" : "",
      fields.redemption ? "redemption" : "",
      fields.one_of_one ? "1/1" : ""
    ].filter(Boolean).join(", ")],
    ["待复核", unresolved.join(", ")]
  ];
}

function writerQualityWarning(result = {}) {
  const quality = result.capture_quality || {};
  const parts = [];
  if (quality.image_quality_degraded) parts.push("图片质量偏低");
  if (quality.route && !/^clear$/i.test(String(quality.route))) parts.push(`质量路线：${quality.route}`);
  if (!parts.length) return "";
  return `${parts.join(" · ")}，小字、编号、评级分数需要写手重点核对。`;
}

function writerTitleOmissionNotice(result = {}) {
  const policy = result.title_length_policy
    || result.provider_result?.title_length_policy
    || result.provider_result_summary?.title_length_policy
    || {};
  const removed = [...new Set((Array.isArray(policy.removed_terms) ? policy.removed_terms : [])
    .map((value) => compactDisplayValue(value))
    .filter(Boolean))];
  if (!removed.length) return "";
  const visible = removed.slice(0, 3);
  const suffix = removed.length > visible.length ? ` 等 ${removed.length} 项` : "";
  return `已识别但因 80 字符限制省略：${visible.join(" · ")}${suffix}`;
}

async function handleFiles(fileList, { animateIntake = false } = {}) {
  if (workspaceInteractionLocked() || state.processing) {
    setStatus(state.processing
      ? "当前批次正在识别，请等待完成后再更换图片。"
      : state.exportingWorkbook
        ? "Excel 正在生成，请等待导出完成后再更换图片。"
        : state.preparingFiles
          ? "图片正在准备，请等待当前选择完成。"
          : "当前卡片正在入库，请等待保存完成后再更换图片。", { busy: true });
    return;
  }

  const candidates = [...fileList];
  const imageFiles = candidates.filter(isSupportedImageFile);
  if (!imageFiles.length) return;

  const batchWasEmpty = state.assets.length === 0;
  const lifecycleGeneration = ++state.assetLifecycleGeneration;
  const filePreparationRunId = state.filePreparationRunId + 1;
  let initialWriterForwardReady = null;
  state.filePreparationRunId = filePreparationRunId;
  state.preparingFiles = true;
  renderResults({ forceWriterRender: true });

  try {
    state.backgroundPreparationRunId += 1;
    state.backgroundRecognitionBatchId = "";
    stopAllV4AssistedDraftPolling();
    void prewarmV4("file_selected");
    setStatus("正在读取本地图片预览，尚未开始识别…", { busy: true });
    closeImageModal();
    const failures = [];
    const prepareStartedAt = performance.now();
    const prepared = await mapWithConcurrency(imageFiles, IMAGE_PREPROCESS_CONCURRENCY, async (file) => {
      try {
        return { image: await fileToAssetImage(file) };
      } catch (error) {
        return { failure: `${file.name}: ${error.message}` };
      }
    });
    if (
      lifecycleGeneration !== state.assetLifecycleGeneration
      || state.filePreparationRunId !== filePreparationRunId
    ) return;

    const prepareElapsedMs = Math.round(performance.now() - prepareStartedAt);
    const settledImages = [];
    prepared.forEach((item) => {
      if (item.image) settledImages.push(item.image);
      if (item.failure) failures.push(item.failure);
    });
    const ignoredFiles = candidates
      .filter((file) => !isSupportedImageFile(file))
      .map((file) => `${file.name}: 不支持的图片格式`);
    const images = settledImages;

    state.files = images;
    state.results = [];
    if (batchWasEmpty && images.length > 0) state.workspaceMode = "writer";
    state.writerActiveIndex = null;
    state.writerTransition = "";
    state.writerFocusPending = writerModeActive();
    state.writerReviewComplete = false;
    state.writerCompletionFocusPending = false;
    state.writerCompositionActive = false;
    state.assetProgress = new Map();
    stopProgressTicker();
    resetGenerationTimings();
    state.activeAssetIndexes = new Set();
    state.completedAssetCount = 0;
    state.processingTotal = 0;
    state.clientImagePrepareMs = prepareElapsedMs;

    if (failures.length || ignoredFiles.length) {
      setStatus(`${images.length} 张图片已准备，${failures.length + ignoredFiles.length} 张未读取：${[...failures, ...ignoredFiles].join("；")}`);
    } else {
      const previewOptimizedCount = images.filter((image) => image.originalSize && image.size < image.originalSize).length;
      setStatus(previewOptimizedCount
        ? `${images.length} 张图片已准备。点击生成标题后开始识别；图片正在后台准备，本地预览已优化。`
        : `${images.length} 张图片已准备。点击生成标题后开始识别；图片正在后台准备。`);
    }

    const intakeTransition = runWorkbenchViewTransition({
      kind: "intake",
      enabled: animateIntake && batchWasEmpty && images.length > 0,
      update: () => {
        renderPreviews();
        renderResults();
      }
    });
    if (intakeTransition?.finished) initialWriterForwardReady = Promise.resolve(intakeTransition.finished).catch(() => {});
    if (intakeTransition?.updateCallbackDone) await Promise.resolve(intakeTransition.updateCallbackDone).catch(() => {});
    if (lifecycleGeneration !== state.assetLifecycleGeneration) return;
    startBackgroundPreparation("file_ready");
  } finally {
    if (
      lifecycleGeneration === state.assetLifecycleGeneration
      && state.filePreparationRunId === filePreparationRunId
    ) {
      state.preparingFiles = false;
      renderResults({ forceWriterRender: true });
      if (initialWriterForwardReady) {
        void initialWriterForwardReady.then(() => {
          if (
            lifecycleGeneration !== state.assetLifecycleGeneration
            || state.filePreparationRunId !== filePreparationRunId
            || !writerModeActive()
          ) return;
          state.writerTransition = "forward";
          state.writerFocusPending = true;
          renderResults({ forceWriterRender: true });
        });
      }
    }
  }
}

async function processAssetViaQueue(asset, options = {}) {
  assertCurrentAssetLifecycle(asset);
  const processStartedAt = performance.now();
  setAssetProgress(asset.index, "检查云端准备", 0.05);
  const backgroundPrepareResult = await settleBackgroundPreparation(asset, QUEUED_BACKGROUND_PREP_WAIT_MS);
  setAssetProgress(
    asset.index,
    asset.preingestionBundleId ? "复用云端证据包" : "上传原图",
    asset.preingestionBundleId ? 0.16 : 0.08
  );
  const uploadStartedAt = performance.now();
  const uploaded = await ensureAssetImagesUploaded(asset);
  const uploadMs = Math.round(performance.now() - uploadStartedAt);
  setAssetProgress(asset.index, uploaded ? "原图已上传云端" : "复用已上传原图", 0.2);

  const fastScoutPrewarm = asset.fastScoutPrewarmResult || {
    used: Boolean(asset.fastScoutPrewarmStatus),
    wait_ms: 0,
    cache_status: asset.fastScoutPrewarmStatus || "",
    timed_out: false
  };
  asset.clientTiming = {
    client_image_prepare_ms: Math.round(Number(state.clientImagePrepareMs || 0)),
    client_upload_ms: uploadMs,
    client_background_prepare_wait_ms: Math.round(Number(backgroundPrepareResult.wait_ms || 0)),
    client_background_prepare_ms: Math.round(Number(asset.backgroundPrepareMs || 0)),
    client_preingestion_bundle_reused: Boolean(asset.preingestionBundleId),
    client_fast_scout_prewarm_used: Boolean(fastScoutPrewarm.used),
    client_fast_scout_prewarm_wait_ms: Math.round(Number(fastScoutPrewarm.wait_ms || 0)),
    client_fast_scout_prewarm_cache_status: fastScoutPrewarm.cache_status || "",
    client_fast_scout_prewarm_timed_out: fastScoutPrewarm.timed_out === true
  };

  let speculative = options.skipSpeculative === true
    ? { used: false }
    : await settleSpeculativeRecognition(asset);
  if (speculative.used && speculative.pending) {
    setAssetProgress(asset.index, "等待已提交的预识别任务", 0.46);
    const settled = await asset.speculativePromise;
    speculative = {
      used: true,
      wait_ms: Math.round(Number(speculative.wait_ms || 0)),
      ...settled
    };
  }
  if (speculative.used && speculative.job) {
    // 识别在图片就绪时已经开始：直接挂到已在跑的 L2 job 上。
    // L1 始终隐藏，只作为 L2 可选的同图证据缓存。
    asset.clientTiming.client_speculative_used = true;
    asset.clientTiming.client_speculative_ms = Math.round(Number(speculative.speculative_ms || 0));
    asset.clientTiming.client_speculative_wait_ms = Math.round(Number(speculative.wait_ms || 0));
    setAssetProgress(asset.index, "复用预识别结果", 0.5);
    const clientTotalMs = Math.round(performance.now() - processStartedAt);
    const pending = queuedPendingResult(asset, speculative.enqueue_payload || {}, speculative.job, {
      client_image_prepare_ms: asset.clientTiming.client_image_prepare_ms,
      client_upload_ms: uploadMs,
      client_background_prepare_wait_ms: asset.clientTiming.client_background_prepare_wait_ms,
      client_speculative_used: true,
      client_speculative_ms: asset.clientTiming.client_speculative_ms,
      client_speculative_wait_ms: asset.clientTiming.client_speculative_wait_ms,
      client_total_ms: clientTotalMs
    });
    return pending;
  }
  if (!speculativeNeedsFreshEnqueue(speculative)) {
    throw new Error(speculative.error || "预识别任务未返回可追踪 ID；为避免重复付费，系统没有自动提交第二个任务。请稍后重试。");
  }

  const requestPrepareStartedAt = performance.now();
  setAssetProgress(asset.index, "准备生产队列请求", 0.3);
  const { requestBody, compressedAgain } = await ensureSafeAssetPayload(asset, {
    ...options,
    provider_options: {
      ...defaultProviderOptions,
      ...(options.provider_options || options.providerOptions || {})
    }
  });
  const requestPrepareMs = Math.round(performance.now() - requestPrepareStartedAt);
  asset.clientTiming.client_request_prepare_ms = requestPrepareMs;
  setAssetProgress(
    asset.index,
    compressedAgain ? "保留主图，缩减辅助局部图" : "队列请求已准备",
    0.36
  );

  const payload = JSON.parse(requestBody);
  payload.force_l2_only = true;
  payload.create_l1_job = false;
  payload.create_l2_job = true;
  payload.disable_fast_scout_l1 = true;
  payload.v4_force_l2_direct = true;
  payload.clientTiming = {
    ...(payload.clientTiming || {}),
    ...asset.clientTiming
  };

  const batchId = options.batchId || createClientBatchId();
  const enqueueStartedAt = performance.now();
  setAssetProgress(asset.index, "提交云端生产队列", 0.42);
  const response = await fetchWithTimeout(JOB_ENQUEUE_API_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify({
      batch_id: batchId,
      priority: Math.max(0, Math.min(10_000, Number(options.priority ?? 100) || 0)),
      jobs: [{
        asset_id: canonicalAssetId(asset),
        manual_retry: options.manualRetry === true,
        retry_of_job_id: options.retryOfJobId || null,
        force_l2_only: true,
        create_l1_job: false,
        create_l2_job: true,
        payload: {
          ...payload,
          manual_retry: options.manualRetry === true,
          retry_of_job_id: options.retryOfJobId || null
        }
      }]
    })
  });
  const enqueueRoundtripMs = Math.round(performance.now() - enqueueStartedAt);
  const enqueuePayload = await response.json().catch(() => ({}));
  assertCurrentAssetLifecycle(asset);
  if (!response.ok || enqueuePayload.ok === false) {
    const detail = enqueuePayload.message || enqueuePayload.error || enqueuePayload.jobs?.find((entry) => entry?.error)?.error || "";
    throw new Error(detail ? `队列提交失败：${response.status}，${detail}` : `队列提交失败：${response.status}`);
  }

  const job = (enqueuePayload.jobs || []).find((entry) => entry?.ok && entry.job_type === "FINAL_ASSISTED_TITLE")
    || (enqueuePayload.jobs || []).find((entry) => entry?.ok)
    || {};
  if (!job.job_id || !job.recognition_session_id) {
    throw new Error("队列提交失败：云端没有返回可追踪的 job_id / recognition_session_id。");
  }

  setAssetProgress(asset.index, "队列已提交，等待云端生成", 0.5);
  const clientTotalMs = Math.round(performance.now() - processStartedAt);
  return queuedPendingResult(asset, enqueuePayload, job, {
    client_image_prepare_ms: asset.clientTiming.client_image_prepare_ms,
    client_upload_ms: uploadMs,
    client_request_prepare_ms: requestPrepareMs,
    client_background_prepare_wait_ms: asset.clientTiming.client_background_prepare_wait_ms,
    client_enqueue_roundtrip_ms: enqueueRoundtripMs,
    client_total_ms: clientTotalMs
  });
}

function failedResult(asset, error) {
  return attachGenerationTimingToResult({
    index: asset.index,
    lifecycleGeneration: asset.lifecycleGeneration,
    asset_id: asset.durableAssetId || "",
    client_asset_ref: asset.clientAssetRef || asset.id,
    thumbnail: asset.images[0].dataUrl,
    title: "",
    generatedTitle: "",
    correctedTitle: "",
    confidence: "FAILED",
    reason: error.message,
    fields: {},
    unresolved: ["request"],
    provider: state.selectedProvider || null
  });
}

function processingCompletionStatus() {
  const total = state.assets.length;
  const failed = state.results.filter((result) => normalizeConfidence(result.confidence) === "FAILED").length;
  const succeeded = Math.max(0, state.results.length - failed);

  if (!total) return "";
  if (failed && succeeded) return `100% · 已完成：${succeeded} 个成功，${failed} 个失败。失败项可查看错误后重试。`;
  if (failed) return `100% · 已完成：${failed} 个失败。请查看每张卡错误信息后重试。`;
  return "100% · 已完成，结果保持上传顺序。";
}

function processingProgressStatus(completedCount) {
  const total = state.assets.length;
  const failed = state.results.filter((result) => normalizeConfidence(result.confidence) === "FAILED").length;
  const suffix = failed ? `，失败 ${failed}` : "";
  return `识别中 ${currentProcessingPercent()}%：已完成 ${completedCount} / ${total}${suffix}...`;
}

async function processTitles() {
  if (!canGenerateTitles()) return;
  const lifecycleGeneration = state.assetLifecycleGeneration;

  state.results = [];
  state.processing = true;
  stopAllV4AssistedDraftPolling();
  state.activeAssetIndexes = new Set();
  state.assetProgress = new Map();
  resetGenerationTimings();
  state.completedAssetCount = 0;
  state.processingTotal = state.assets.length;
  const generationQueuedAt = Date.now();
  state.assets.forEach((asset) => markAssetQueued(asset, generationQueuedAt));
  renderResults();
  elements.processButton.disabled = true;
  setProcessButtonBusy(true);
  setStatus("0% · 图片已准备，开始识别…", { busy: true });

  const queue = [...state.assets];
  const recognitionBatchId = state.backgroundRecognitionBatchId || createClientBatchId();
  state.backgroundRecognitionBatchId = recognitionBatchId;
  // This pool only prepares and enqueues durable jobs. Provider concurrency is
  // enforced independently by the server-side capacity lease.
  const workerCount = Math.min(queueSubmissionConcurrencyLimit(), queue.length);
  let completedCount = 0;

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      state.activeAssetIndexes.add(asset.index);
      setAssetProgress(asset.index, "进入识别队列", 0.03);
      renderResults();

      try {
        const result = await processAssetViaQueue(asset, { batchId: recognitionBatchId });
        if (lifecycleGeneration !== state.assetLifecycleGeneration) return;
        if (!v4WriterTitlePending(result)) {
          markAssetFinished(asset.index, { failed: normalizeConfidence(result.confidence) === "FAILED" });
          clearAssetProgress(asset.index);
        } else {
          setAssetProgress(asset.index, "云端生成中", 0.58);
        }
        attachGenerationTimingToResult(result);
        state.results.push(result);
        state.results.sort((a, b) => a.index - b.index);
        startV4AssistedDraftPolling(result);
      } catch (error) {
        if (lifecycleGeneration !== state.assetLifecycleGeneration) return;
        markAssetFinished(asset.index, { failed: true });
        clearAssetProgress(asset.index);
        state.results.push(failedResult(asset, error));
      }

      state.activeAssetIndexes.delete(asset.index);
      completedCount += 1;
      state.completedAssetCount = completedCount;
      state.results.sort((a, b) => a.index - b.index);
      renderResults();
      setStatus(processingProgressStatus(completedCount), { busy: completedCount < state.assets.length });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  if (lifecycleGeneration !== state.assetLifecycleGeneration) return;
  state.processing = false;
  state.activeAssetIndexes = new Set();
  for (const assetIndex of state.assetProgress.keys()) {
    const result = state.results.find((item) => Number(item.index) === Number(assetIndex));
    if (!result || !v4WriterTitlePending(result)) clearAssetProgress(assetIndex);
  }
  if (state.assetProgress.size) startProgressTicker();
  else stopProgressTicker();
  state.completedAssetCount = 0;
  state.processingTotal = 0;
  renderResults();

  syncProcessButtonState();
  const pendingL2 = pendingAssistedDraftCount();
  if (pendingL2) startGenerationTicker();
  setStatus(pendingL2 ? `已提交全部 ${state.assets.length} 张，${pendingL2} 张最终标题生成中…` : processingCompletionStatus(), {
    busy: pendingL2 > 0
  });
}

async function retryFailedAssetInPriorityQueue(button) {
  if (workspaceInteractionLocked()) return;
  const assetIndex = Number(button.dataset.priorityRetry);
  const asset = state.assets.find((item) => item.index === assetIndex);
  const current = state.results.find((item) => item.index === assetIndex);
  if (!asset || !current || current.queueRetryStatus === "submitting") return;
  const lifecycleGeneration = state.assetLifecycleGeneration;
  const retryOfJobId = String(current.v4_job_id || current.job_id || "").trim();
  if (!retryOfJobId) {
    current.feedbackMessage = "旧任务缺少可验证的 job_id，不能提升到优先队列；请重新上传后提交。";
    renderResults();
    return;
  }

  const writerEditedTitle = String(current.correctedTitle || "").trim();
  state.priorityRetryInFlight = true;
  current.queueRetryStatus = "submitting";
  current.feedbackMessage = "正在提交优先重试…";
  setStatus(`卡片 ${asset.index} 正在插入优先队列…`, { busy: true });
  state.assetGenerationTimings.delete(asset.index);
  markAssetQueued(asset, Date.now());
  setAssetProgress(asset.index, "提交优先重试", 0.08);
  renderResults();

  try {
    stopV4AssistedDraftPolling(asset.index);
    const result = await processAssetViaQueue(asset, {
      batchId: createClientBatchId(),
      priority: 0,
      skipSpeculative: true,
      manualRetry: true,
      retryOfJobId
    });
    if (!assetLifecycleMatches(asset, lifecycleGeneration)) return;
    if (writerEditedTitle) {
      result.correctedTitle = writerEditedTitle;
      result.title_override = {
        source: "writer_edit_before_retry",
        value: writerEditedTitle
      };
    }
    result.queueRetryStatus = "";
    result.feedbackMessage = "已创建新的识别任务并进入优先队列；旧任务仅保留审计记录。";
    state.results = state.results.filter((item) => item.index !== asset.index);
    state.results.push(result);
    state.results.sort((a, b) => a.index - b.index);
    startV4AssistedDraftPolling(result);
    setStatus(`卡片 ${asset.index} 已进入优先队列。`, { busy: true });
  } catch (error) {
    if (!assetLifecycleMatches(asset, lifecycleGeneration)) return;
    markAssetFinished(asset.index, { failed: true });
    clearAssetProgress(asset.index);
    current.queueRetryStatus = "";
    current.feedbackMessage = `优先重试提交失败：${error.message || "请再次重试"}`;
    setStatus(`卡片 ${asset.index} 优先重试提交失败。`);
  } finally {
    state.priorityRetryInFlight = false;
    renderResults({ forceWriterRender: true });
  }
}

async function copyTitle(button) {
  const resultIndex = Number(button.dataset.copyResult);
  const result = Number.isFinite(resultIndex)
    ? state.results.find((item) => item.index === resultIndex)
    : null;
  const title = result
    ? finalTitleForResult(result)
    : decodeURIComponent(button.dataset.copyTitle || "");
  if (!title) return;

  await navigator.clipboard.writeText(title);
  const original = button.textContent;
  button.textContent = "已复制";
  setTimeout(() => {
    button.textContent = original;
  }, 1100);
}

function updateCorrectedTitle(input) {
  const result = state.results.find((item) => item.index === Number(input.dataset.titleInput));
  if (!result) return;

  result.correctedTitle = input.value;
  const renderedTitle = String(result.rendered_title || result.final_title || result.generatedTitle || result.title || "").trim();
  const correctedTitle = String(input.value || "").trim();
  result.title_override = correctedTitle && renderedTitle && correctedTitle !== renderedTitle ? correctedTitle : null;
  result.feedbackStatus = "";
  result.feedbackMessage = "";
  renderBatchTitles();
}

function finalizeTitleOverride(input) {
  const result = state.results.find((item) => item.index === Number(input.dataset.titleInput));
  if (!result) return;

  if (result.title_override) {
    result.feedbackMessage = "人工标题覆盖已保留，不会反向修改 resolved fields。";
  } else if (result.feedbackMessage === "人工标题覆盖已保留，不会反向修改 resolved fields。") {
    result.feedbackMessage = "";
  }

  renderResults();
}

function currentResolvedForResult(result) {
  return result.corrected_resolved || result.resolved || {};
}

function finalTitleForResult(result) {
  return String(result.correctedTitle ?? result.final_title ?? result.rendered_title ?? result.title ?? "").trim();
}

function isV4Result(result = {}) {
  return Boolean(result.recognition_session_id && result.v4_schema_version);
}

function v4PayloadWriterTitlePending(payload = {}) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.title_stage === "L1_INTERNAL_SCOUT") return true;
  const status = String(payload.assisted_draft_status || "").toUpperCase();
  const hasVisibleTitle = String(payload.writer_draft?.title || payload.final_title || payload.title || "").trim();
  return !hasVisibleTitle && (status === "PENDING" || status === "RUNNING") && payload.full_assist_continued_after_l1 === true;
}

function v4WriterTitlePending(result = {}) {
  if (!isV4Result(result)) return false;
  if (result.title_stage === "L1_INTERNAL_SCOUT") return true;
  const status = v4AssistedStatus(result);
  const hasVisibleTitle = String(result.correctedTitle || result.generatedTitle || result.final_title || result.title || "").trim();
  return !hasVisibleTitle && (status === "PENDING" || status === "RUNNING");
}

function v4AssistedStatus(result = {}) {
  return String(result.assisted_draft_status || result.l2AssistedDraftStatus || result.provider_result_summary?.assisted_draft_status || "").toUpperCase();
}

function shouldPollV4AssistedDraft(result = {}) {
  if (!isV4Result(result)) return false;
  if (!result.recognition_session_id) return false;
  if (["saving", "saved", "skipped"].includes(String(result.feedbackStatus || ""))) return false;
  if (result.v4QueuedJob && result.v4_job_id) {
    const jobStatus = String(result.v4_job_status || "").toUpperCase();
    if (["FAILED", "CANCELLED"].includes(jobStatus)) return false;
  }
  const status = v4AssistedStatus(result);
  if (status === "READY" || status === "REVIEW_REQUIRED" || status === "FAILED" || status === "TIMEOUT") return false;
  return result.full_assist_continued_after_l1 === true
    || result.l2_background_status === "SCHEDULED"
    || status === "PENDING"
    || status === "RUNNING";
}

function titleWasEditedByWriter(result = {}) {
  const corrected = String(result.correctedTitle || "").trim();
  const generated = String(result.generatedTitle || result.final_title || result.title || "").trim();
  return Boolean(result.title_override || (corrected && generated && corrected !== generated));
}

function finalTitleFromV4Session(session = {}) {
  const summary = session.provider_result_summary || {};
  return String(session.final_title || summary.final_title || "").replace(/\s+/g, " ").trim();
}

function applyV4AssistedDraftUpdate(result = {}, session = {}) {
  syncAssetGenerationTimingFromServer(result.index, session);
  const summary = session.provider_result_summary || {};
  const finalTitle = finalTitleFromV4Session(session);
  const l2Ready = session.l2_status === "READY" && Boolean(finalTitle);
  const writerReviewRequired = session.l2_status === "READY"
    && (
      session.writer_review_required === true
      || session.status === "WRITER_REVIEW"
      || summary.writer_review_required === true
      || summary.assisted_draft_status === "REVIEW_REQUIRED"
    );
  const assistedStatus = String(summary.assisted_draft_status || (l2Ready ? "READY" : "")).toUpperCase();
  result.l2AssistedDraftStatus = assistedStatus || result.l2AssistedDraftStatus || "PENDING";
  result.assisted_draft_status = result.l2AssistedDraftStatus;
  result.provider_result_summary = {
    ...(result.provider_result_summary || {}),
    ...summary
  };

  if (writerReviewRequired && !finalTitle) {
    markAssetFinished(result.index);
    attachGenerationTimingToResult(result);
    result.title_stage = "L2_ASSISTED_DRAFT";
    result.writerTitlePending = false;
    result.writerReviewRequired = true;
    result.confidence = "LOW";
    result.reason = session.writer_review_reason
      || summary.writer_review_reason
      || "现有证据不足以生成安全标题，请人工输入。";
    result.l2AssistedDraftStatus = "REVIEW_REQUIRED";
    result.assisted_draft_status = "REVIEW_REQUIRED";
    result.feedbackMessage = "识别已完成，但没有足够证据生成安全标题；可直接人工输入。";
    return true;
  }

  if ((assistedStatus !== "READY" && !l2Ready) || !finalTitle) return false;

  markAssetFinished(result.index);
  attachGenerationTimingToResult(result);
  const oldGenerated = String(result.generatedTitle || result.final_title || result.title || "").trim();
  const writerEdited = titleWasEditedByWriter(result);
  result.title_stage = "L2_ASSISTED_DRAFT";
  result.writerTitlePending = false;
  result.assisted_draft = finalTitle;
  result.assistedTitle = finalTitle;
  result.l2UpgradeApplied = finalTitle !== oldGenerated;
  result.l2UpgradeAppliedAt = Date.now();
  result.title = finalTitle;
  result.final_title = finalTitle;
  result.rendered_title = finalTitle;
  result.generatedTitle = finalTitle;
  if (!writerEdited) {
    result.correctedTitle = finalTitle;
    result.title_override = null;
  }
  if (session.resolved_fields && typeof session.resolved_fields === "object") {
    result.resolved = session.resolved_fields;
    result.fields = session.resolved_fields;
    result.generated_resolved_fields = session.resolved_fields;
  }
  if (session.field_states && typeof session.field_states === "object") {
    result.field_states = session.field_states;
  }
  result.feedbackMessage = writerEdited
    ? "一段式标题已生成；保留你当前的人工编辑。"
    : "一段式标题已生成。";
  return true;
}

function stopV4AssistedDraftPolling(resultIndex) {
  const timer = state.assistedDraftPollTimers.get(resultIndex);
  if (timer) clearTimeout(timer);
  state.assistedDraftPollTimers.delete(resultIndex);
}

function stopV4QueuedBatchPolling() {
  if (state.queuedBatchPollTimer) clearTimeout(state.queuedBatchPollTimer);
  state.queuedBatchPollTimer = null;
  state.queuedBatchPollGeneration += 1;
}

function stopAllV4AssistedDraftPolling() {
  for (const timer of state.assistedDraftPollTimers.values()) {
    clearTimeout(timer);
  }
  state.assistedDraftPollTimers = new Map();
  stopV4QueuedBatchPolling();
}

function pendingAssistedDraftCount() {
  return state.results.filter(shouldPollV4AssistedDraft).length;
}

function pendingV4QueuedResults() {
  return state.results.filter((result) => {
    return result?.v4QueuedJob && result.v4_job_id && shouldPollV4AssistedDraft(result);
  });
}

function chunksOf(items = [], size = QUEUED_STATUS_BATCH_SIZE) {
  const chunks = [];
  const safeSize = Math.max(1, Number(size) || QUEUED_STATUS_BATCH_SIZE);
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

function queuedStatusPollDelay(elapsedMs = 0) {
  if (elapsedMs < 30_000) return 800;
  if (elapsedMs < 90_000) return 1200;
  return 1800;
}

function syncQueuedPollObservation(result = {}, status = result.v4_job_status || "QUEUED", now = performance.now()) {
  result.v4QueuedPollStartedAt = result.v4QueuedPollStartedAt || now;
  const observation = observeClientJobPoll({
    status,
    elapsedMs: now - result.v4QueuedPollStartedAt,
    warningAfterMs: ASSISTED_DRAFT_DELAY_WARNING_MS
  });
  result.v4QueuedPollDelayed = observation.delayed;
  result.v4QueuedPollWarningCode = observation.warning_code;
  return observation;
}

function recordQueuedStatusPollFailure(result = {}, error = null) {
  result.v4StatusPollFailureCount = Number(result.v4StatusPollFailureCount || 0) + 1;
  result.v4StatusPollConsecutiveFailures = Number(result.v4StatusPollConsecutiveFailures || 0) + 1;
  result.v4StatusPollLastFailureAt = Date.now();
  result.v4StatusPollLastError = String(error?.message || error || "status_poll_failed").slice(0, 240);
}

function recordQueuedStatusPollSuccess(result = {}) {
  result.v4StatusPollConsecutiveFailures = 0;
  result.v4StatusPollLastSuccessAt = Date.now();
  result.v4StatusPollLastError = null;
}

async function pollV4QueuedJobsBatch(generation) {
  if (generation !== state.queuedBatchPollGeneration || state.queuedBatchPollInFlightGeneration === generation) return;
  const pending = pendingV4QueuedResults();
  if (!pending.length) {
    state.queuedBatchPollTimer = null;
    return;
  }

  const now = performance.now();
  const active = [];
  for (const result of pending) {
    syncQueuedPollObservation(result, result.v4_job_status || "QUEUED", now);
    active.push(result);
  }

  state.queuedBatchPollInFlightGeneration = generation;
  try {
    const resultsByJobId = groupClientResultsByJobId(active);
    const batches = chunksOf([...resultsByJobId.keys()]);
    const batchReads = await Promise.allSettled(batches.map(async (jobIds) => {
      const params = new URLSearchParams({ job_ids: jobIds.join(","), limit: String(jobIds.length) });
      const { response, payload } = await fetchJsonWithTimeout(`${JOB_STATUS_API_ENDPOINT}?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      }, STATUS_POLL_TIMEOUT_MS, "云端任务状态查询超时，系统会自动继续查询。");
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || `status_poll_http_${response.status}`);
      }
      return { jobIds, payload };
    }));
    if (generation !== state.queuedBatchPollGeneration) return;

    let terminalCount = 0;
    let shouldRender = false;
    for (let batchIndex = 0; batchIndex < batchReads.length; batchIndex += 1) {
      const batchRead = batchReads[batchIndex];
      if (batchRead.status === "rejected") {
        for (const jobId of batches[batchIndex] || []) {
          for (const result of resultsByJobId.get(jobId) || []) {
            recordQueuedStatusPollFailure(result, batchRead.reason);
          }
        }
        continue;
      }
      const { jobIds, payload } = batchRead.value;
      const returnedJobIds = new Set((payload.jobs || []).map((job) => String(job?.job_id || "").trim()).filter(Boolean));
      for (const jobId of jobIds) {
        for (const result of resultsByJobId.get(jobId) || []) {
          if (returnedJobIds.has(jobId)) recordQueuedStatusPollSuccess(result);
          else recordQueuedStatusPollFailure(result, new Error("status_poll_job_missing"));
        }
      }
      for (const job of payload.jobs || []) {
        const jobId = String(job?.job_id || "").trim();
        for (const result of resultsByJobId.get(jobId) || []) {
          const update = applyV4QueuedJobStatusUpdate(result, job);
          if (update.terminal) {
            terminalCount += 1;
            shouldRender = true;
          }
        }
      }
    }
    if (shouldRender) renderResults();
    const remaining = pendingAssistedDraftCount();
    if (terminalCount > 0) {
      setStatus(remaining
        ? `一段式标题已生成，剩余 ${remaining} 张继续生成中…`
        : "一段式标题已全部生成。", { busy: remaining > 0 });
    }
  } catch {
    // A status read is observational. Keep the durable jobs running and poll again.
  } finally {
    if (state.queuedBatchPollInFlightGeneration === generation) {
      state.queuedBatchPollInFlightGeneration = null;
    }
  }

  if (generation !== state.queuedBatchPollGeneration) return;
  const remaining = pendingV4QueuedResults();
  if (!remaining.length) {
    state.queuedBatchPollTimer = null;
    return;
  }
  const earliestStart = Math.min(...remaining.map((result) => result.v4QueuedPollStartedAt || performance.now()));
  state.queuedBatchPollTimer = setTimeout(() => {
    state.queuedBatchPollTimer = null;
    void pollV4QueuedJobsBatch(generation);
  }, queuedStatusPollDelay(performance.now() - earliestStart));
}

function startV4QueuedBatchPolling() {
  if (state.queuedBatchPollTimer || state.queuedBatchPollInFlightGeneration === state.queuedBatchPollGeneration) return;
  const generation = state.queuedBatchPollGeneration;
  void pollV4QueuedJobsBatch(generation);
}

function queuedJobFailureReason(job = {}) {
  const error = job.error && typeof job.error === "object" ? job.error : {};
  return job.session?.failure_reason
    || error.message
    || error.error
    || error.provider_error_type
    || job.result?.message
    || "云端生产队列生成失败。";
}

function applyV4QueuedJobStatusUpdate(result = {}, job = {}) {
  syncAssetGenerationTimingFromServer(result.index, job);
  result.v4_job_status = job.status || result.v4_job_status || "QUEUED";
  const pollObservation = syncQueuedPollObservation(result, result.v4_job_status);
  result.v4_job_timing = job.timing || result.v4_job_timing || {};
  result.timing = {
    ...(result.timing || {}),
    v4_queue: result.v4_job_timing,
    worker_queue_wait_ms: job.timing?.worker_queue_wait_ms ?? result.timing?.worker_queue_wait_ms,
    worker_processing_ms: job.timing?.worker_processing_ms ?? result.timing?.worker_processing_ms,
    time_to_l2_ready_ms: job.timing?.time_to_l2_ready_ms ?? result.timing?.time_to_l2_ready_ms
  };

  const jobStatus = String(job.status || "").toUpperCase();
  if (jobStatus === "QUEUED" || jobStatus === "RETRYING") {
    setAssetProgress(result.index, pollObservation.delayed ? "云端队列繁忙，任务仍在安全等待" : "云端队列排队中", 0.56, {
      knownPending: true,
      announce: false
    });
  } else if (jobStatus === "RUNNING") {
    setAssetProgress(result.index, pollObservation.delayed ? "云端识别时间较长，任务仍在继续" : "云端模型生成中", 0.68, {
      knownPending: true,
      announce: false
    });
  } else if (jobStatus === "L2_READY" || job.display_status === "FINAL_READY" || job.display_status === "WRITER_REVIEW") {
    setAssetProgress(result.index, "接收最终标题", 0.94, {
      knownPending: true,
      announce: false
    });
  }

  let upgraded = false;
  if (job.session) {
    upgraded = applyV4AssistedDraftUpdate(result, job.session);
  }

  if (upgraded) {
    clearAssetProgress(result.index);
    return { terminal: true, upgraded: true };
  }

  if (jobStatus === "FAILED" || jobStatus === "CANCELLED" || job.display_status === "FAILED") {
    result.confidence = "FAILED";
    result.reason = queuedJobFailureReason(job);
    result.writerTitlePending = false;
    result.title_stage = "FAILED";
    result.assisted_draft_status = "FAILED";
    result.l2AssistedDraftStatus = "FAILED";
    markAssetFinished(result.index, { failed: true });
    attachGenerationTimingToResult(result);
    clearAssetProgress(result.index);
    return { terminal: true, upgraded: false };
  }

  return { terminal: false, upgraded: false };
}

async function pollV4AssistedDraft(
  resultIndex,
  startedAt = performance.now(),
  attempt = 0,
  lifecycleGeneration = state.assetLifecycleGeneration
) {
  if (lifecycleGeneration !== state.assetLifecycleGeneration) {
    stopV4AssistedDraftPolling(resultIndex);
    return;
  }
  const result = state.results.find((item) => item.index === resultIndex);
  if (!result || !shouldPollV4AssistedDraft(result)) {
    stopV4AssistedDraftPolling(resultIndex);
    return;
  }

  const pollObservation = observeClientJobPoll({
    status: result.l2AssistedDraftStatus || "PENDING",
    elapsedMs: performance.now() - startedAt,
    warningAfterMs: ASSISTED_DRAFT_DELAY_WARNING_MS
  });
  result.v4SessionPollDelayed = pollObservation.delayed;
  result.v4SessionPollWarningCode = pollObservation.warning_code;
  if (pollObservation.delayed) {
    setAssetProgress(result.index, "云端识别时间较长，任务仍在继续", 0.82);
  }

  try {
    const params = new URLSearchParams({ recognition_session_id: result.recognition_session_id });
    const { response, payload } = await fetchJsonWithTimeout(`${SESSION_STATUS_API_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    }, STATUS_POLL_TIMEOUT_MS, "云端识别状态查询超时，系统会自动继续查询。");
    if (lifecycleGeneration !== state.assetLifecycleGeneration) {
      stopV4AssistedDraftPolling(resultIndex);
      return;
    }
    if (response.ok && payload.ok !== false && payload.session) {
      const upgraded = applyV4AssistedDraftUpdate(result, payload.session);
      const terminalStatus = v4AssistedStatus(result);
      const terminal = ["READY", "FAILED", "TIMEOUT", "REVIEW_REQUIRED"].includes(terminalStatus);
      if (upgraded || terminal) {
        renderResults();
        if (!upgraded && terminalStatus !== "READY") {
          markAssetFinished(result.index, { failed: true });
          attachGenerationTimingToResult(result);
        }
        stopV4AssistedDraftPolling(resultIndex);
        const remaining = pendingAssistedDraftCount();
        setStatus(remaining
          ? `一段式标题已生成，剩余 ${remaining} 张继续生成中…`
          : terminalStatus === "READY"
            ? "一段式标题已全部生成。"
            : "一段式标题生成已结束，失败项可重试。");
        return;
      }
    }
  } catch (error) {
    result.l2AssistedDraftStatus = result.l2AssistedDraftStatus || "PENDING";
    result.v4SessionStatusPollFailureCount = Number(result.v4SessionStatusPollFailureCount || 0) + 1;
    result.v4SessionStatusPollLastError = String(error?.message || error || "session_status_poll_failed").slice(0, 240);
  }

  const delay = ASSISTED_DRAFT_POLL_INTERVALS_MS[Math.min(attempt, ASSISTED_DRAFT_POLL_INTERVALS_MS.length - 1)];
  const timer = setTimeout(() => {
    state.assistedDraftPollTimers.delete(resultIndex);
    void pollV4AssistedDraft(resultIndex, startedAt, attempt + 1, lifecycleGeneration);
  }, delay);
  state.assistedDraftPollTimers.set(resultIndex, timer);
}

function startV4AssistedDraftPolling(result = {}) {
  if (!shouldPollV4AssistedDraft(result)) return;
  if (result.v4QueuedJob && result.v4_job_id) {
    result.v4QueuedPollStartedAt = result.v4QueuedPollStartedAt || performance.now();
    result.l2AssistedDraftStatus = v4AssistedStatus(result) || "PENDING";
    result.assisted_draft_status = result.l2AssistedDraftStatus;
    startGenerationTicker();
    startV4QueuedBatchPolling();
    return;
  }
  if (state.assistedDraftPollTimers.has(result.index)) return;
  result.l2AssistedDraftStatus = v4AssistedStatus(result) || "PENDING";
  result.assisted_draft_status = result.l2AssistedDraftStatus;
  startGenerationTicker();
  void pollV4AssistedDraft(
    result.index,
    performance.now(),
    0,
    Number.isFinite(result.lifecycleGeneration) ? result.lifecycleGeneration : state.assetLifecycleGeneration
  );
}

function feedbackActionForResult(result, generatedTitle, correctedTitle) {
  if (result.explicitReviewOutcome === "REJECTED") return "REJECT";
  return String(generatedTitle || "").trim() === String(correctedTitle || "").trim() ? "ACCEPT" : "EDIT";
}

function clientFeedbackSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function pendingV4FeedbackSubmission(result, { action, writerTitle } = {}) {
  const signature = JSON.stringify([
    String(result?.recognition_session_id || "").trim(),
    String(action || "").trim(),
    String(writerTitle || "").trim()
  ]);
  if (!result.pendingFeedbackSubmissionId || result.pendingFeedbackSubmissionSignature !== signature) {
    result.pendingFeedbackSubmissionId = clientFeedbackSubmissionId();
    result.pendingFeedbackSubmissionSignature = signature;
    result.pendingFeedbackOccurredAt = new Date().toISOString();
  }
  return {
    id: result.pendingFeedbackSubmissionId,
    occurredAt: result.pendingFeedbackOccurredAt,
    signature
  };
}

function clearPendingV4FeedbackSubmission(result, submission = {}) {
  if (!result || result.pendingFeedbackSubmissionId !== submission.id) return;
  delete result.pendingFeedbackSubmissionId;
  delete result.pendingFeedbackSubmissionSignature;
  delete result.pendingFeedbackOccurredAt;
}

async function saveFeedbackForResult(result, asset) {
  if (!result) return false;

  const generatedTitle = String(
    result.generatedTitle
    || result.title
    || (normalizeConfidence(result.confidence) === "FAILED" ? `FAILED: ${friendlyErrorSummary(result.reason)}` : "")
  ).trim();
  const correctedTitle = String(result.correctedTitle ?? result.final_title ?? result.rendered_title ?? result.title ?? "").trim();
  const writerReviewRequired = result.writerReviewRequired === true
    || result.writer_review_required === true
    || result.assisted_draft_status === "REVIEW_REQUIRED";
  const explicitReject = result.explicitReviewOutcome === "REJECTED";

  if ((!correctedTitle && !explicitReject) || (!generatedTitle && !writerReviewRequired && !explicitReject)) return false;

  const useV4Feedback = isV4Result(result);
  const v4Action = useV4Feedback ? feedbackActionForResult(result, generatedTitle, correctedTitle) : "";
  const v4Submission = useV4Feedback
    ? pendingV4FeedbackSubmission(result, { action: v4Action, writerTitle: correctedTitle })
    : null;

  result.feedbackStatus = "saving";
  result.persistenceStatus = "saving";
  result.feedbackMessage = "正在保存审核记录…";
  renderResults();

  try {
    const response = await fetch(useV4Feedback ? FEEDBACK_API_ENDPOINT : LEGACY_FEEDBACK_API_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify(useV4Feedback ? {
        recognition_session_id: result.recognition_session_id,
        feedback_submission_id: v4Submission.id,
        client_occurred_at: v4Submission.occurredAt,
        action: v4Action,
        writer_final_title: correctedTitle,
      } : {
        asset_id: result.asset_id || canonicalAssetId(asset),
        client_asset_ref: asset?.clientAssetRef || asset?.id || `asset-${result.index}`,
        analysis_run_id: result.analysis_run_id || result.provider_response_id || "",
        generated_title: generatedTitle,
        corrected_title: correctedTitle,
        generated_resolved_fields: result.generated_resolved_fields || result.resolved || {},
        corrected_resolved_fields: currentResolvedForResult(result),
        generated_evidence: result.generated_evidence || result.evidence || {},
        generated_modules: result.generated_modules || result.modules || {},
        corrected_modules: result.modules || {},
        rendered_title: result.rendered_title || result.final_title || result.title || "",
        model_title_suggestion: result.model_title_suggestion || "",
        title_override: result.title_override || null,
        route: result.route || "",
        provider: result.provider || "",
        model_id: result.model_id || "",
        prompt_version: result.prompt_version || "",
        schema_version: result.schema_version || result.evidence_schema_version || "",
        evidence_schema_version: result.evidence_schema_version || "",
        resolver_version: result.resolver_version || "",
        registry_version: result.registry_version || "",
        capture_profile_id: result.capture_profile_id || defaultCaptureProfileId,
        capture_quality: result.capture_quality || null,
        retrieval_trace: result.retrieval || null,
        resolution_trace: result.resolution_trace || [],
        open_set_readiness: result.open_set_readiness || null,
        workflow_summary: result.workflow_summary || null,
        workflow_sidecars: result.workflow_sidecars || null,
        workflow_action_plan: result.workflow_action_plan || result.action_plan || null,
        usage: result.usage || null,
        recovery: result.recovery || null,
        targeted_rescan_recovered: result.targeted_rescan_recovered === true,
        review_outcome: result.explicitReviewOutcome || "",
        review_duration_ms: result.reviewStartedAt ? Date.now() - result.reviewStartedAt : null,
        field_changes: result.field_changes || [],
        images: (asset?.providerImages || asset?.images || []).map(reviewImageReference)
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `保存失败：${response.status}`);
    }

    if (useV4Feedback) {
      if (payload.v4_persistence?.transaction?.saved !== true) {
        throw new Error("V4 审核事务尚未确认入库，请重试。");
      }
      clearPendingV4FeedbackSubmission(result, v4Submission);
      const canonicalWriterTitle = String(payload.writer_final_title || "").trim();
      if (canonicalWriterTitle) {
        result.correctedTitle = canonicalWriterTitle;
        result.final_title = canonicalWriterTitle;
        result.rendered_title = canonicalWriterTitle;
        result.title = canonicalWriterTitle;
        result.title_override = null;
      }
      result.csmNormalization = payload.csm_normalization || null;
      const rejected = v4Action === "REJECT" || String(payload.status || "").toUpperCase() === "REJECTED";
      result.feedbackStatus = rejected ? "skipped" : "saved";
      result.persistenceStatus = "persisted";
      result.trainingEligibility = payload.training_eligible === true ? "eligible" : "ineligible";
      result.feedbackSubmissionId = payload.feedback_submission_id || v4Submission.id;
      result.review_id = payload.feedback_event_id || "";
      result.approved_at = "";
      result.approved_by = "";
      result.review_outcome = payload.status || "";
      result.feedbackMessage = rejected
        ? "V4 已记录拒绝反馈；事务已入库，不进入正样本训练。"
        : payload.csm_normalization?.applied === true
          ? `V4 已保存写手反馈，标题已按 CSM 标准顺序整理：${payload.learning_event_id || "已写入"}。`
          : payload.training_eligible === false
            ? "V4 写手反馈已入库；当前处于观察期，不自动进入训练集。"
            : `V4 已保存写手反馈，并生成学习事件：${payload.learning_event_id || "已写入"}。`;
      return true;
    }

    const retentionSkipped = payload.retention_skipped === true || payload.retention_enabled === false;
    result.feedbackStatus = retentionSkipped ? "skipped" : "saved";
    result.persistenceStatus = retentionSkipped ? "not_persisted" : "persisted";
    result.review_id = retentionSkipped ? "" : payload.record?.review?.id || "";
    result.approved_at = retentionSkipped ? "" : payload.record?.review?.approved_at || "";
    result.approved_by = retentionSkipped ? "" : payload.record?.review?.operator_id || "";
    result.review_outcome = payload.review_outcome || payload.record?.review?.review_outcome || "";
    result.feedbackMessage = retentionSkipped
      ? `审核接口已接收，当前未开通反馈留存：${payload.review_outcome || "未写入"}。`
      : payload.review_outcome
      ? `已保存审核记录：${payload.review_outcome}。`
      : "已保存审核记录。";
    return result.persistenceStatus === "persisted";
  } catch (error) {
    result.feedbackStatus = "";
    result.persistenceStatus = "failed";
    result.feedbackMessage = error.message || "记忆保存失败。";
    return false;
  } finally {
    renderResults();
  }
}

async function saveTitleFeedback(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.saveTitle));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.saveTitle));
  return saveFeedbackForResult(result, asset);
}

function advanceWriterAfterPersistence(index) {
  const nextIndex = nextWriterOutstandingIndex({
    assets: state.assets,
    results: state.results,
    currentIndex: index
  });
  state.writerReviewComplete = false;
  state.writerTransition = "";
  state.writerActiveIndex = nextIndex;
  state.writerFocusPending = Number.isFinite(Number(nextIndex));
  state.writerCompletionFocusPending = nextIndex === null;
}

async function saveWriterTitleAndAdvance(resultIndex) {
  if (workspaceInteractionLocked()) return false;
  const index = Number(resultIndex);
  const result = state.results.find((item) => item.index === index);
  const asset = state.assets.find((item) => item.index === index);
  if (!result || !asset || v4WriterTitlePending(result)) return false;
  if (writerFeedbackPersisted(result)) {
    advanceWriterAfterPersistence(index);
    renderResults({ forceWriterRender: true });
    return true;
  }
  const title = finalTitleForResult(result);
  if (!title) {
    result.feedbackMessage = "标题不能为空，请输入最终英文标题后再按 Enter。";
    state.writerFocusPending = true;
    renderResults({ forceWriterRender: true });
    return false;
  }
  if (title.length > maxTitleLength) {
    result.feedbackMessage = `标题不能超过 ${maxTitleLength} 个字符。`;
    state.writerFocusPending = true;
    renderResults({ forceWriterRender: true });
    return false;
  }

  state.writerSaveInFlight = true;
  let persisted = false;
  try {
    persisted = await saveFeedbackForResult(result, asset);
    if (!persisted) return false;
    advanceWriterAfterPersistence(index);
    return true;
  } finally {
    state.writerSaveInFlight = false;
    if (!persisted) state.writerFocusPending = true;
    renderResults({ forceWriterRender: true });
  }
}

async function rejectWriterTitleAndAdvance(resultIndex) {
  if (workspaceInteractionLocked()) return false;
  const index = Number(resultIndex);
  const result = state.results.find((item) => item.index === index);
  const asset = state.assets.find((item) => item.index === index);
  if (!result || !asset || v4WriterTitlePending(result)) return false;
  if (writerFeedbackPersisted(result)) {
    advanceWriterAfterPersistence(index);
    renderResults({ forceWriterRender: true });
    return true;
  }

  state.writerSaveInFlight = true;
  result.explicitReviewOutcome = "REJECTED";
  result.feedbackStatus = "";
  result.persistenceStatus = "";
  result.feedbackMessage = "已标记为拒绝，正在写入训练负例…";
  let persisted = false;
  try {
    persisted = await saveFeedbackForResult(result, asset);
    if (!persisted) return false;
    advanceWriterAfterPersistence(index);
    return true;
  } finally {
    state.writerSaveInFlight = false;
    if (!persisted) state.writerFocusPending = true;
    renderResults({ forceWriterRender: true });
  }
}

async function rejectTitleFeedback(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.rejectTitle));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.rejectTitle));
  if (!result || writerFeedbackPersisted(result) || result.feedbackStatus === "saving") return false;
  result.explicitReviewOutcome = "REJECTED";
  result.feedbackStatus = "";
  result.persistenceStatus = "";
  result.feedbackMessage = "已标记为拒绝，正在写入训练负例…";
  return saveFeedbackForResult(result, asset);
}

async function copyAllTitles() {
  const titles = generatedTitleResults().map((result) => finalTitleForResult(result));
  if (!titles.length) return;

  await navigator.clipboard.writeText(titles.join("\n"));
  const original = elements.copyAllButton.textContent;
  elements.copyAllButton.textContent = "已复制全部";
  setTimeout(() => {
    elements.copyAllButton.textContent = original;
  }, 1200);
}

function primaryImagesForExport(asset = {}) {
  return (asset.images || [])
    .filter((image) => !imageIsDerivedForRequest(image))
    .slice(0, 2);
}

function buildWriterExportRows(
  assets = state.assets,
  { requireSaved = false, titleSnapshotByIndex = new Map() } = {}
) {
  return assets.map((asset) => {
    const result = resultForAsset(asset);
    if (!result) throw new Error(`资产 ${asset.index} 还没有生成结果。`);
    if (requireSaved && !(result.feedbackStatus === "saved" && writerFeedbackPersisted(result))) {
      throw new Error(`资产 ${asset.index} 的当前标题尚未确认入库，已停止导出。`);
    }
    const finalTitle = titleSnapshotByIndex.has(Number(asset.index))
      ? String(titleSnapshotByIndex.get(Number(asset.index)) || "").trim()
      : finalTitleForResult(result);
    if (!finalTitle) throw new Error(`资产 ${asset.index} 缺少最终标题。`);
    if (v4WriterTitlePending(result)) throw new Error(`资产 ${asset.index} 的一段式标题仍在生成中。`);
    const images = primaryImagesForExport(asset).map(exportImageReference).filter((image) => {
      return image.objectPath || image.embedDataUrl;
    });
    if (!images.length) throw new Error(`资产 ${asset.index} 缺少可导出的图片。`);
    return {
      asset_id: canonicalAssetId(asset),
      client_asset_ref: asset.clientAssetRef || asset.id,
      asset_index: asset.index,
      recognition_session_id: result.recognition_session_id || "",
      final_title: finalTitle,
      images
    };
  });
}

async function exportWriterWorkbook() {
  if (workspaceInteractionLocked()) return;
  if (!completedExportRowsReady()) {
    setExportWorkbookStatus(writerModeActive()
      ? "至少有一张卡片成功入库后才能导出。"
      : "所有资产生成并完成写手编辑后才能导出。");
    return;
  }
  if (!storageReady()) {
    setExportWorkbookStatus("图片存储未配置，暂时无法生成可留存的 Excel。");
    return;
  }

  const exportingWriterRows = writerModeActive();
  const exportAssets = exportingWriterRows ? [...writerSavedAssets()] : [...state.assets];
  if (!writerExportWithinLimit(exportAssets.length)) {
    setExportWorkbookStatus(`单次最多导出 ${WRITER_EXPORT_MAX_ROWS} 张卡片；请缩小本轮批次后重试。`);
    return;
  }
  const titleSnapshotByIndex = new Map(exportAssets.map((asset) => {
    return [Number(asset.index), finalTitleForResult(resultForAsset(asset))];
  }));

  state.exportingWorkbook = true;
  renderResults({ forceWriterRender: true });
  setExportWorkbookStatus("正在上传图片并生成 Excel…");

  try {
    await mapWithConcurrency(exportAssets, 2, async (asset) => {
      await ensureAssetImagesUploaded(asset);
    });
    const rows = buildWriterExportRows(exportAssets, {
      requireSaved: exportingWriterRows,
      titleSnapshotByIndex
    });
    const response = await fetch(EXPORT_WORKBOOK_API_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ rows })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || `导出失败：${response.status}`);
    }

    if (payload.download_url) {
      const link = document.createElement("a");
      link.href = payload.download_url;
      link.download = payload.file_name || "lynca-writer-export.xlsx";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setExportWorkbookStatus(exportingWriterRows
      ? `已生成包含 ${rows.length} 张已入库卡片的 Excel，并留存批次 ${payload.batch_id || ""}。`
      : `已生成 Excel，并留存批次 ${payload.batch_id || ""}。`);
  } catch (error) {
    setExportWorkbookStatus(error.message || "导出失败。");
  } finally {
    state.exportingWorkbook = false;
    renderResults({ forceWriterRender: true });
  }
}

function resetTool() {
  if (state.processing) {
    setStatus("当前批次正在识别，请等待完成后再清空。", { busy: true });
    return;
  }
  if (workspaceInteractionLocked()) {
    setStatus(state.exportingWorkbook
      ? "Excel 正在生成，请等待导出完成后再清空。"
      : state.preparingFiles
        ? "图片正在准备，请等待完成后再清空。"
        : state.priorityRetryInFlight
          ? "优先重试正在提交，请等待完成后再清空。"
          : "当前卡片正在入库，请等待保存完成后再清空。", { busy: true });
    return;
  }
  const hasPendingWork = state.results.some((result) => {
    return v4WriterTitlePending(result)
      || (finalTitleForResult(result) && !writerFeedbackPersisted(result));
  });
  if (hasPendingWork && typeof globalThis.confirm === "function") {
    const confirmed = globalThis.confirm("仍有生成中或未入库的卡片。确定清空本轮内容吗？");
    if (!confirmed) return;
  }
  state.assetLifecycleGeneration += 1;
  state.backgroundPreparationRunId += 1;
  state.backgroundRecognitionBatchId = "";
  stopAllV4AssistedDraftPolling();
  state.files = [];
  state.assets = [];
  state.results = [];
  state.processing = false;
  state.activeAssetIndexes = new Set();
  state.assetProgress = new Map();
  resetGenerationTimings();
  state.exportingWorkbook = false;
  state.preparingFiles = false;
  state.filePreparationRunId += 1;
  state.writerActiveIndex = null;
  state.writerTransition = "";
  state.writerFocusPending = false;
  state.writerSaveInFlight = false;
  state.writerReviewComplete = false;
  state.writerCompletionFocusPending = false;
  state.writerCompositionActive = false;
  state.priorityRetryInFlight = false;
  setExportWorkbookStatus("");
  stopProgressTicker();
  state.completedAssetCount = 0;
  state.processingTotal = 0;
  closeImageModal();
  elements.imageInput.value = "";
  setStatus("");
  renderPreviews();
  renderResults();
}

function bindEvents() {
  elements.workspaceModeButtons.forEach((button) => {
    button.addEventListener("click", (event) => setWorkspaceMode(button.dataset.workspaceMode, {
      animate: event.detail > 0
    }));
  });

  document.querySelectorAll('label[for="imageInput"]').forEach((label) => {
    label.addEventListener("pointerdown", () => {
      state.fileSelectionPointerRequested = true;
    });
    label.addEventListener("keydown", () => {
      state.fileSelectionPointerRequested = false;
    });
    label.addEventListener("click", (event) => {
      if (event.target !== elements.imageInput && event.detail === 0) state.fileSelectionPointerRequested = false;
    });
  });
  elements.imageInput.addEventListener("keydown", () => {
    state.fileSelectionPointerRequested = false;
  });
  elements.imageInput.addEventListener("change", (event) => {
    const animateIntake = state.fileSelectionPointerRequested;
    state.fileSelectionPointerRequested = false;
    void handleFiles(event.target.files, { animateIntake });
  });

  document.querySelectorAll("input[name='assetMode']").forEach((input) => {
    input.addEventListener("change", () => {
      if (workspaceInteractionLocked() || state.processing) return;
      state.assetLifecycleGeneration += 1;
      state.backgroundPreparationRunId += 1;
      state.backgroundRecognitionBatchId = "";
      stopAllV4AssistedDraftPolling();
      state.mode = input.value;
      state.results = [];
      state.writerActiveIndex = null;
      state.writerReviewComplete = false;
      state.writerFocusPending = writerModeActive();
      state.writerCompletionFocusPending = false;
      state.writerCompositionActive = false;
      resetGenerationTimings();
      closeImageModal();
      renderPreviews();
      renderResults();
      startBackgroundPreparation("mode_changed");
    });
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  });

  elements.dropZone.addEventListener("drop", (event) => {
    void handleFiles(event.dataTransfer.files, { animateIntake: true });
  });

  elements.processButton.addEventListener("click", processTitles);
  elements.resetButton.addEventListener("click", resetTool);
  elements.copyAllButton.addEventListener("click", copyAllTitles);
  elements.exportWorkbookButton.addEventListener("click", exportWriterWorkbook);
  elements.providerControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-provider-id]");
    if (button) selectProvider(button.dataset.providerId);
  });

  elements.assetPreviewList.addEventListener("click", (event) => {
    const writerGoButton = event.target.closest("[data-writer-go]");
    if (writerGoButton) {
      setWriterActiveIndex(Number(writerGoButton.dataset.writerGo), {
        focus: true,
        animate: event.detail > 0,
        direction: writerGoButton.dataset.writerDirection
      });
      return;
    }

    const writerExportButton = event.target.closest("[data-writer-export]");
    if (writerExportButton) {
      void exportWriterWorkbook();
      return;
    }

    const previewButton = event.target.closest("[data-preview-asset]");
    if (previewButton) {
      openImageModal(Number(previewButton.dataset.previewAsset), Number(previewButton.dataset.previewImage));
      return;
    }

    const button = event.target.closest("[data-copy-title], [data-copy-result]");
    if (button) {
      copyTitle(button);
      return;
    }

    const saveButton = event.target.closest("[data-save-title]");
    if (saveButton) {
      if (writerModeActive()) void saveWriterTitleAndAdvance(Number(saveButton.dataset.saveTitle));
      else void saveTitleFeedback(saveButton);
      return;
    }

    const rejectButton = event.target.closest("[data-reject-title]");
    if (rejectButton) {
      if (writerModeActive()) void rejectWriterTitleAndAdvance(Number(rejectButton.dataset.rejectTitle));
      else void rejectTitleFeedback(rejectButton);
      return;
    }

    const priorityRetryButton = event.target.closest("[data-priority-retry]");
    if (priorityRetryButton) retryFailedAssetInPriorityQueue(priorityRetryButton);
  });

  elements.assetPreviewList.addEventListener("input", (event) => {
    const input = event.target.closest("[data-title-input]");
    if (input) updateCorrectedTitle(input);
  });

  elements.assetPreviewList.addEventListener("focusout", (event) => {
    if (!event.target.closest("[data-title-input]")) return;
    setTimeout(() => {
      if (!elements.assetPreviewList.querySelector("[data-title-input]:focus")) renderResults();
    }, 0);
  });

  elements.assetPreviewList.addEventListener("change", (event) => {
    const titleInput = event.target.closest("[data-title-input]");
    if (titleInput) {
      finalizeTitleOverride(titleInput);
      return;
    }
  });

  elements.assetPreviewList.addEventListener("compositionstart", (event) => {
    if (event.target.closest("[data-title-input]")) state.writerCompositionActive = true;
  });

  elements.assetPreviewList.addEventListener("compositionend", (event) => {
    if (event.target.closest("[data-title-input]")) state.writerCompositionActive = false;
  });

  elements.assetPreviewList.addEventListener("keydown", (event) => {
    const titleInput = event.target.closest("[data-title-input]");
    if (
      !titleInput
      || event.key !== "Enter"
      || event.shiftKey
      || event.isComposing
      || state.writerCompositionActive
      || event.keyCode === 229
      || event.repeat
    ) return;
    event.preventDefault();
    const resultIndex = Number(titleInput.dataset.titleInput);
    const saveButton = titleInput.closest(".title-output")?.querySelector("[data-save-title]");
    const inputs = [...elements.assetPreviewList.querySelectorAll("[data-title-input]:not([disabled])")];
    const currentPosition = inputs.indexOf(titleInput);
    const nextResultIndex = Number(inputs[currentPosition + 1]?.dataset.titleInput);
    finalizeTitleOverride(titleInput);
    if (writerModeActive()) {
      void saveWriterTitleAndAdvance(resultIndex);
      return;
    }
    if (saveButton && !saveButton.disabled) {
      void saveTitleFeedback(saveButton).then((saved) => {
        if (!saved || !Number.isFinite(nextResultIndex)) return;
        elements.assetPreviewList.querySelector(`[data-title-input="${nextResultIndex}"]:not([disabled])`)?.focus();
      });
    } else if (Number.isFinite(nextResultIndex)) {
      elements.assetPreviewList.querySelector(`[data-title-input="${nextResultIndex}"]:not([disabled])`)?.focus();
    }
  });

  elements.assetPreviewList.addEventListener("wheel", (event) => {
    if (!writerModeActive() || !event.target.closest("[data-writer-wheel]")) return;
    if (event.target.closest("[data-writer-card] textarea, [data-writer-card] input, [data-writer-card] select, [data-writer-card] button, [data-writer-card] [contenteditable='true']")) return;
    if (workspaceInteractionLocked() || Math.abs(event.deltaY) < 8) return;
    const now = Date.now();
    if (now - state.writerLastWheelNavigationAt < 280) return;
    const direction = event.deltaY > 0 ? 1 : -1;
    const adjacent = writerAdjacentAsset(state.writerActiveIndex, direction);
    if (!adjacent) return;
    event.preventDefault();
    state.writerLastWheelNavigationAt = now;
    setWriterActiveIndex(adjacent.index, {
      focus: true,
      animate: true,
      direction: direction > 0 ? "forward" : "backward"
    });
  }, { passive: false });

  elements.imageModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) {
      closeImageModal();
      return;
    }

    const sideButton = event.target.closest("[data-modal-image]");
    if (sideButton) switchModalImage(Number(sideButton.dataset.modalImage));
  });

  elements.imageModalClose.addEventListener("click", closeImageModal);

  document.addEventListener("keydown", (event) => {
    if (!state.modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeImageModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...elements.imageModal.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  globalThis.window?.addEventListener("beforeunload", (event) => {
    if (globalThis.__LYNCA_CONFIRMED_NAVIGATION__ === true) return;
    const pending = state.processing || state.results.some((result) => v4WriterTitlePending(result));
    const unsaved = state.results.some((result) => {
      return finalTitleForResult(result) && !writerFeedbackPersisted(result);
    });
    if (!pending && !unsaved) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function loadResolutionMap() {
  try {
    const response = await fetch("/app/resolution.json");
    state.resolutionMap = await response.json();
  } catch {
    state.resolutionMap = {};
  }
}

async function loadProviderStatus() {
  try {
    const response = await fetch("/api/listing-provider-status", {
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error(`Provider status failed: ${response.status}`);

    const payload = await response.json();
    state.providerStatus = payload;
    state.selectedProvider = payload.default_provider || "";
  } catch {
    state.providerStatus = {
      fallback_available: true,
      providers: []
    };
    state.selectedProvider = "";
  }

  renderProviderControl();
}

async function prewarmV4(reason = "page_load") {
  if (!state.selectedProvider) return;
  try {
    const params = new URLSearchParams({ reason });
    await fetch(`${PREWARM_API_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true
    });
  } catch {
    // Prewarm is opportunistic. Formal recognition must remain the source of truth.
  }
}

void prewarmV4("page_load");
await Promise.all([
  loadResolutionMap(),
  loadProviderStatus()
]);
bindEvents();
renderPreviews();
renderResults();
