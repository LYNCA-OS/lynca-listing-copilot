import { renderCsmGlassBox, loadCsmResolutionView } from "./csm-glass-box.mjs";
import { claimAssetSingleFlight, nextRetrySubmissionId } from "./asset-single-flight.mjs";
import {
  analyzeImageQualityFromImageData,
  batchReviewWindow,
  claimNextBatchAsset,
  defaultCaptureProfileId,
  fetchWithBoundedRetry,
  INTAKE_PREVIEW_CARD_WINDOW,
  planTargetedCrops,
  SIGNED_UPLOAD_URL_GENERATION_LIMIT,
  shouldRefreshSignedUpload,
  startNonBlockingDerivedUpload,
  summarizeDerivedUploadOutcomes,
  windowIntakePreviewGroups
} from "./listing-copilot-sdk.mjs";
import {
  nextWriterOutstandingIndex,
  WRITER_EXPORT_MAX_ROWS,
  writerExportRowsReady,
  writerExportWithinLimit,
  writerFeedbackPersisted
} from "./writer-wheel-mode.mjs";

const apiCostPerRequest = 0.003;
const maxTitleLength = 80;
const MAX_DIRECT_RECOGNITION_WORKERS = 6;
const MAX_BACKGROUND_PREP_WORKERS = 4;
const IMAGE_PREPROCESS_CONCURRENCY = 4;
const STORAGE_UPLOAD_CONCURRENCY = 3;
const STORAGE_OBJECT_UPLOAD_TIMEOUT_MS = 30000;
const STORAGE_UPLOAD_RELAY_MAX_BYTES = 3_200_000;
const STORAGE_UPLOAD_RELAY_TIMEOUT_MS = 12_000;
const STORAGE_API_RETRY_DELAYS_MS = Object.freeze([250, 750, 1500]);
const STORAGE_CONTROL_RECOVERY_TIMEOUT_MS = 3500;
const STORAGE_CONTROL_RECOVERY_DELAYS_MS = Object.freeze([0]);
const STORAGE_VERIFY_TIMEOUT_MS = STORAGE_CONTROL_RECOVERY_TIMEOUT_MS;
const STORAGE_VERIFY_RETRY_DELAYS_MS = STORAGE_CONTROL_RECOVERY_DELAYS_MS;
const ASSET_CREATE_REQUEST_TIMEOUT_MS = 3500;
const FEEDBACK_REQUEST_TIMEOUT_MS = 20000;
const EXPORT_REQUEST_TIMEOUT_MS = 90000;
const CSM_THIN_REQUEST_TIMEOUT_MS = 290000; // csm-runtime-contract.mjs
const IMAGE_MAX_EDGE = 2200;
const IMAGE_MIN_EDGE = 1400;
const IMAGE_INITIAL_QUALITY = 0.9;
const IMAGE_MIN_QUALITY = 0.78;
const IMAGE_EMERGENCY_MIN_QUALITY = 0.64;
const TARGET_IMAGE_DATA_URL_CHARS = 2_400_000;
const REQUEST_IMAGE_BATCH_LIMIT = 14;
const TARGETED_CROP_QUALITY = 0.88;
const FIELD_MAX_CROPS_PER_IMAGE = 6;
const FIELD_MAX_CROPS_PER_ASSET = 8;
const CSM_THIN_API_ENDPOINT = "/api/csm-listing-title";
const CSM_THIN_INGEST_API_ENDPOINT = "/api/csm-listing-title-ingest";
const ASSET_CREATE_API_ENDPOINT = "/api/listing-asset-create";
const FEEDBACK_API_ENDPOINT = "/api/v4/listing-feedback";
const EXPORT_WORKBOOK_API_ENDPOINT = "/api/v4/listing-export-workbook";
const supportedImageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const supportedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const storageFirstImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const heicUnsupportedMessage = "当前浏览器暂不支持 HEIC/HEIF 预览，请先在手机相册中导出为 JPG，或使用微信/系统截图后上传。";

const state = {
  files: [],
  // Wall clock for the whole batch, from the moment images enter it to the
  // moment the last card resolves. The per-card stages answer where time goes;
  // this answers the question a writer actually asks, which is how long the
  // batch took.
  batchStartedAt: 0,
  batchFinishedAt: 0,
  mode: "pair",
  assets: [],
  results: [],
  modal: null,
  modalReturnFocus: null,
  processing: false,
  activeAssetIndexes: new Set(),
  assetProgress: new Map(),
  progressTimer: null,
  assetGenerationTimings: new Map(),
  generationTimer: null,
  completedAssetCount: 0,
  processingTotal: 0,
  exportingWorkbook: false,
  preparingFiles: false,
  intakePreviewRecords: [],
  filePreparationRunId: 0,
  retryInFlight: 0,
  // COS-50: where the bounded eight-card window sits in the whole batch, and
  // which card the operator asked for. Separate from the window size, which is
  // a rendering bound and never a limit on what is reachable.
  reviewWindowStart: 0,
  reviewFocusIndex: null,
  workspaceMode: "standard",
  writerActiveIndex: null,
  writerTransition: "",
  writerFocusPending: false,
  writerSaveInFlight: false,
  writerReviewComplete: false,
  writerCompletionFocusPending: false,
  writerCompositionActive: false,
  fileSelectionPointerRequested: false,
  workbenchTransitionSequence: 0,
  activeWorkbenchTransition: null,
  backgroundPreparationRunId: 0,
  backgroundRecognitionBatchId: "",
  assetLifecycleGeneration: 0
};
let backgroundPreparationQueue = [];
let backgroundPreparationActiveCount = 0;
let csmWarmupStartedAt = 0;
let csmWarmupPromise = null;

function startCsmWarmup(fetchImpl = globalThis.fetch, now = Date.now) {
  const timestamp = now();
  if (
    typeof fetchImpl !== "function"
    || (csmWarmupPromise && timestamp - csmWarmupStartedAt < 45_000)
  ) return csmWarmupPromise;
  csmWarmupStartedAt = timestamp;
  csmWarmupPromise = Promise.resolve(fetchImpl(CSM_THIN_API_ENDPOINT, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store"
  })).catch(() => null);
  return csmWarmupPromise;
}

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
    elapsed: document.querySelector("#statElapsed"),
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

function recordClientNetworkStage(asset, stage, result = {}) {
  if (!asset || !stage) return;
  const timing = asset.clientTiming || (asset.clientTiming = {});
  const prefix = `client_${stage}`;
  const elapsedMs = Math.max(0, Math.round(Number(result.elapsed_ms ?? result.elapsedMs ?? 0) || 0));
  const attempts = Math.max(0, Math.round(Number(result.attempts || 0) || 0));
  timing[`${prefix}_ms`] = Math.max(0, Number(timing[`${prefix}_ms`] || 0)) + elapsedMs;
  timing[`${prefix}_attempts`] = Math.max(0, Number(timing[`${prefix}_attempts`] || 0)) + attempts;
  timing.client_network_retry_count = Math.max(0, Number(timing.client_network_retry_count || 0))
    + Math.max(0, attempts - 1);
  if (result.error) {
    timing.client_network_error_stage = stage;
    timing.client_network_error_code = String(result.error.code || result.error.name || "CLIENT_NETWORK_ERROR").slice(0, 80);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStorageApiResponse(response, payload = {}) {
  const status = Number(response?.status || 0);
  const code = String(payload?.code || "").trim().toUpperCase();
  if (payload?.retryable === true) return [408, 425, 429, 500, 502, 503, 504].includes(status);
  if (["VERIFICATION_RECORD_WRITE_FAILED", "STORAGE_UPLOAD_IDENTITY_MISMATCH"].includes(code)) return false;
  if (code && !["AUTH_UNAVAILABLE", "AUTH_RATE_LIMITED"].includes(code)) return false;
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fetchStorageApiJson(url, options = {}, {
  timeoutMs = STORAGE_OBJECT_UPLOAD_TIMEOUT_MS,
  retryDelaysMs = STORAGE_API_RETRY_DELAYS_MS
} = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const request = await fetchWithBoundedRetry(url, options, {
        timeoutMs,
        maxAttempts: 1,
        retryNetworkErrors: true
      });
      const response = request.response;
      const payload = await response.json().catch(() => ({}));
      if (
        attempt === retryDelaysMs.length
        || !retryableStorageApiResponse(response, payload)
      ) {
        return {
          response,
          payload,
          retryCount: attempt,
          attempts: attempt + 1,
          elapsed_ms: request.elapsed_ms
        };
      }
    } catch (error) {
      lastError = error;
      if (attempt === retryDelaysMs.length) throw error;
    }
    await wait(retryDelaysMs[attempt]);
  }
  throw lastError || new Error("Storage API request failed.");
}

async function fetchJsonWithRetry(url, options = {}, {
  timeoutMs = FEEDBACK_REQUEST_TIMEOUT_MS,
  maxAttempts = 3,
  retryNetworkErrors = true,
  asset = null,
  stage = "api_request"
} = {}) {
  let request;
  try {
    request = await fetchWithBoundedRetry(url, options, {
      timeoutMs,
      maxAttempts,
      retryNetworkErrors
    });
  } catch (error) {
    recordClientNetworkStage(asset, stage, {
      elapsed_ms: error.elapsed_ms,
      attempts: error.attempts,
      error
    });
    throw error;
  }

  const payload = await request.response.json().catch(() => ({}));
  const requestError = request.response.ok && payload.ok !== false
    ? null
    : Object.assign(
      new Error(payload.message || payload.error || `request_failed_${request.response.status}`),
      { http_status: request.response.status }
    );
  recordClientNetworkStage(asset, stage, { ...request, error: requestError });
  return { ...request, payload, error: requestError };
}

function fileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function imageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function assetCreateIdempotencyKey(asset = {}) {
  const current = String(asset.assetCreateIdempotencyKey || "").trim();
  if (current) return current;
  const key = globalThis.crypto?.randomUUID?.();
  if (!key) throw new Error("listing_asset_idempotency_key_unavailable");
  asset.assetCreateIdempotencyKey = key;
  return key;
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

function createImagePreviewUrl(blob) {
  if (!blob || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return "";
  try {
    return URL.createObjectURL(blob);
  } catch {
    return "";
  }
}

function imagePreviewUrl(image = {}) {
  return image.previewUrl || image.dataUrl || "";
}

function releaseImagePreviewUrls(images = []) {
  const visited = new Set();
  const release = (image) => {
    if (!image || visited.has(image)) return;
    visited.add(image);
    if (
      String(image.previewUrl || "").startsWith("blob:")
      && typeof URL !== "undefined"
      && typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(image.previewUrl);
    }
    image.previewUrl = "";
    (image.targetedCrops || []).forEach(release);
  };
  images.forEach(release);
}

function releaseIntakePreviewRecords(records = state.intakePreviewRecords) {
  for (const record of Array.isArray(records) ? records : []) {
    const previewUrl = String(record?.previewUrl || "");
    if (
      previewUrl.startsWith("blob:")
      && typeof URL !== "undefined"
      && typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(previewUrl);
    }
  }
  if (records === state.intakePreviewRecords) state.intakePreviewRecords = [];
}

function createIntakePreviewRecords(files = []) {
  return files.map((file, index) => {
    const previewable = storageFirstImageTypes.has(contentTypeForFile(file));
    return {
      id: `intake-preview-${index + 1}`,
      name: file.name,
      previewUrl: previewable ? createImagePreviewUrl(file) : "",
      previewable
    };
  });
}

function renderInstantIntakePreviews(records = []) {
  const source = Array.isArray(records) ? records : [];
  const groupSize = state.mode === "single" ? 1 : 2;
  const groups = [];
  for (let index = 0; index < source.length; index += groupSize) {
    groups.push(source.slice(index, index + groupSize));
  }
  const previewWindow = windowIntakePreviewGroups(groups, INTAKE_PREVIEW_CARD_WINDOW);

  elements.processButton.disabled = true;
  elements.previewSummary.textContent = `${source.length} 张图片已选择，本地预览已显示；正在后台校验原图。`;
  elements.assetPreviewList.innerHTML = previewWindow.visible.map((images, index) => `
    <article class="asset-row-card intake-preview-card" aria-busy="true">
      <div class="asset-source">
        <div class="preview-images ${images.length === 1 ? "single" : ""}">
          ${images.map((image) => image.previewable
            ? `<span class="thumb-button intake-preview-thumb"><img class="thumb" src="${escapeHtml(image.previewUrl)}" alt="${escapeHtml(image.name)}" decoding="async"></span>`
            : `<span class="thumb-button intake-preview-thumb intake-preview-unavailable"><strong>正在转换</strong><small>${escapeHtml(image.name)}</small></span>`).join("")}
        </div>
        <div class="preview-meta">
          <h3>卡片 ${index + 1}</h3>
          <span>${assetCountLabel(images.length)}</span>
        </div>
      </div>
      <div class="title-output title-output-pending is-working">
        <div class="pending-state pending-active" role="status" aria-live="polite">
          <span class="loading-spinner" aria-hidden="true"></span>
          <strong>本地图片已读取</strong>
          <p>正在校验原图；完成后自动上传并进入识别准备。</p>
          <span class="pending-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        </div>
      </div>
    </article>
  `).join("") + (previewWindow.remaining > 0 ? `
    <div class="empty-state intake-preview-overflow" role="status">
      其余 ${previewWindow.remaining} 张卡已接收，正在后台进入同一识别批次。
    </div>
  ` : "");
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

async function compressImageDataUrl(originalDataUrl, maxEdge, quality) {
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
    // Keep the final canvas only for the caller's single crop pass. Large
    // images may be recompressed several times; generating six crops inside
    // every attempt made local intake do the same expensive work repeatedly.
    sourceCanvas: canvas
  };
}

async function fileToAssetImage(file) {
  const id = imageId();
  const originalDataUrl = await readFileAsDataUrl(file);
  let maxEdge = IMAGE_MAX_EDGE;
  let quality = IMAGE_INITIAL_QUALITY;
  let compressed;

  try {
    compressed = await compressImageDataUrl(originalDataUrl, maxEdge, quality);
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

    compressed = await compressImageDataUrl(originalDataUrl, maxEdge, quality);
  }

  compressed.targetedCrops = buildTargetedCropImages({
    id,
    name: file.name
  }, compressed.sourceCanvas, compressed.imageQuality);
  delete compressed.sourceCanvas;
  const sourceBlob = dataUrlToBlob(compressed.dataUrl);
  compressed.targetedCrops.forEach((crop) => {
    crop.previewUrl = createImagePreviewUrl(crop.sourceBlob);
  });

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
    previewUrl: createImagePreviewUrl(sourceBlob),
    captureProfileId: defaultCaptureProfileId,
    imageQuality: compressed.imageQuality,
    sourceFile: file,
    sourceBlob,
    contentSha256: "",
    objectPath: "",
    targetedCrops: compressed.targetedCrops
  };
}

export function shouldUseStorageFirstImage(file, {
  // Production is storage-first; the upload API remains the authoritative
  // readiness boundary and fails closed if storage is unavailable.
  storageConfigured = true,
  maxUploadBytes = storageUploadLimitBytes()
} = {}) {
  const size = Number(file?.size || 0);
  return storageConfigured === true
    && storageFirstImageTypes.has(contentTypeForFile(file || {}))
    && size > 0
    && size <= Math.max(1, Number(maxUploadBytes) || 0);
}

function storageFirstAssetImage(file) {
  const id = imageId();
  const previewUrl = createImagePreviewUrl(file);
  const type = contentTypeForFile(file);
  const image = {
    id,
    name: file.name,
    originalType: type,
    type,
    size: file.size,
    originalSize: file.size,
    originalWidth: 0,
    originalHeight: 0,
    width: 0,
    height: 0,
    dataUrl: "",
    previewUrl,
    captureProfileId: defaultCaptureProfileId,
    imageQuality: null,
    sourceFile: file,
    sourceBlob: null,
    contentSha256: "",
    objectPath: "",
    targetedCrops: [],
    storageFirst: true
  };

  return image;
}

async function ensureImageUploadMetadata(image = {}) {
  if (image.storageFirst && !image.localMetadataPromise) {
    // Start decoding only when a bounded background-upload worker reaches this
    // image. Large batches therefore do not decode every full-resolution file at once.
    image.localMetadataPromise = loadImage(image.previewUrl)
      .then((decoded) => {
        const width = Number(decoded.naturalWidth || decoded.width || 0);
        const height = Number(decoded.naturalHeight || decoded.height || 0);
        if (!width || !height) throw new Error("图片尺寸读取失败");
        image.originalWidth = width;
        image.originalHeight = height;
        image.width = width;
        image.height = height;
        return { width, height };
      })
      .catch((error) => {
        throw new Error(`图片无法读取或预览：${error?.message || "浏览器解码失败"}`);
      });
  }
  if (image.localMetadataPromise) await image.localMetadataPromise;
  const width = Number(image.originalWidth || image.width || 0);
  const height = Number(image.originalHeight || image.height || 0);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("图片尺寸读取失败");
  }
  return image;
}

async function prepareFileForIntake(file) {
  if (shouldUseStorageFirstImage(file)) return storageFirstAssetImage(file);
  return fileToAssetImage(file);
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
    const idempotencyKey = assetCreateIdempotencyKey(asset);
    const request = await fetchJsonWithRetry(ASSET_CREATE_API_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        client_asset_ref: clientAssetRef,
        idempotency_key: idempotencyKey,
        capture_profile_id: defaultCaptureProfileId,
        expected_original_count: Math.max(1, Math.min(2, Array.isArray(asset.images) ? asset.images.length : 1))
      })
    }, {
      timeoutMs: ASSET_CREATE_REQUEST_TIMEOUT_MS,
      maxAttempts: 2,
      retryNetworkErrors: true,
      asset,
      stage: "asset_create"
    });
    const response = request.response;
    const payload = request.payload;
    assertCurrentAssetLifecycle(asset);
    if (request.error) {
      throw new Error(payload.message || `listing_asset_create_failed_${response.status}`);
    }
    if (String(payload.client_asset_ref || "") !== clientAssetRef) {
      throw new Error("listing_asset_client_ref_mismatch");
    }
    if (payload.idempotency_key && String(payload.idempotency_key) !== idempotencyKey) {
      throw new Error("listing_asset_idempotency_key_mismatch");
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

function createClientBatchId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `web-csm-${random}`;
}

function storageReady() {
  return true;
}

function storageUploadLimitBytes() {
  return 25 * 1024 * 1024;
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

function notePendingStorageConfirmationFailure(image = {}, limit = 2) {
  const pending = image.pendingStorageVerification;
  if (!pending) return { retained: false, exhausted: false, attempts: 0 };
  const attempts = Math.max(0, Number(pending.confirmationAttempts || 0)) + 1;
  pending.confirmationAttempts = attempts;
  const exhausted = attempts >= Math.max(1, Number(limit) || 2);
  if (exhausted) delete image.pendingStorageVerification;
  return { retained: !exhausted, exhausted, attempts };
}

function applyVerifiedStorageBinding({ asset, image, uploadObjectPath, contentSha256, verifyPayload }) {
  const assetId = canonicalAssetId(asset);
  const tenantId = canonicalAssetTenantId(asset);
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
    if (image.cropPlan) image.cropPlan = { ...image.cropPlan, crop_metadata: metadata };
  }
  return true;
}

/**
 * COS-51: recover from a signed-upload collision without overwriting anything.
 *
 * The object path is deterministic, so a second attempt for the same tenant +
 * asset + image + role lands on the object the first attempt already wrote.
 * `upsert: false` is correct and stays -- original images are immutable. The
 * failure this repairs is that the browser had no way OUT: it re-signed the
 * same identity and collided again, which is what pinned card 5 of a 20-card
 * batch and blocked every card after it.
 *
 * Returns the rows that could NOT be recovered, so the caller can classify them
 * as INPUT_REBIND and mint a successor generation. Verification compares the
 * stored bytes against what we were about to upload; a mismatch means the path
 * belongs to different content and reusing it would silently bind the wrong
 * image, so that row is deliberately NOT recovered here.
 */
async function recoverCollidedStorageObjects(asset, rows, collisions) {
  const assetId = canonicalAssetId(asset);
  const byImage = new Map(collisions.map((row) => [row.image_id, row]));
  const unrecovered = [];
  await mapWithConcurrency(rows, STORAGE_UPLOAD_CONCURRENCY, async (row) => {
    const collision = byImage.get(row.image.id);
    if (!collision?.object_path) { unrecovered.push(row); return; }
    try {
      const objectPath = assertCanonicalImageObjectPath({
        objectPath: collision.object_path,
        tenantId: canonicalAssetTenantId(asset),
        assetId
      });
      const verify = await fetchStorageApiJson("/api/listing-image-verify-existing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          assetId,
          imageId: row.image.id,
          role: row.storageRole,
          fileName: row.image.name,
          contentType: row.contentType,
          objectPath,
          bucket: collision.bucket || undefined,
          cropMetadata: row.image.cropMetadata || row.image.crop_metadata || null
        })
      }, { timeoutMs: STORAGE_VERIFY_TIMEOUT_MS, retryDelaysMs: STORAGE_VERIFY_RETRY_DELAYS_MS });
      if (!verify.response.ok || verify.payload?.ok !== true) throw new Error("verify_existing_failed");

      // The bytes must be OUR bytes. Same path with different content is a
      // stale or foreign object, not a resumable upload, and binding it would
      // put someone else's image behind this card's title.
      const storedSha = String(verify.payload.verification?.content_sha256 || "").toLowerCase();
      const expectedSha = String(row.contentSha256 || "").toLowerCase();
      if (expectedSha && storedSha && storedSha !== expectedSha) throw new Error("existing_object_content_mismatch");

      applyVerifiedStorageBinding({
        asset,
        image: row.image,
        uploadObjectPath: objectPath,
        contentSha256: row.contentSha256,
        verifyPayload: verify.payload
      });
    } catch {
      unrecovered.push(row);
    }
  });
  return unrecovered;
}

function encodeUploadRelayMetadata(metadata) {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function uploadAssetImageViaRelay(asset, row) {
  const assetId = canonicalAssetId(asset);
  const metadata = {
    assetId,
    imageId: row.image.id,
    role: row.storageRole,
    fileName: row.image.name,
    contentType: row.contentType,
    size: row.source.size,
    width: row.dimensions.width,
    height: row.dimensions.height,
    signatureHex: row.signatureHex,
    contentSha256: row.contentSha256,
    cropMetadata: row.image.cropMetadata || row.image.crop_metadata || null
  };
  const relayRequest = await fetchStorageApiJson("/api/listing-image-upload-relay", {
    method: "POST",
    headers: {
      "content-type": row.contentType,
      "x-lynca-upload-metadata": encodeUploadRelayMetadata(metadata)
    },
    credentials: "same-origin",
    body: row.source
  }, {
    timeoutMs: STORAGE_UPLOAD_RELAY_TIMEOUT_MS,
    retryDelaysMs: []
  });
  const relayError = relayRequest.response.ok && relayRequest.payload?.ok === true
    ? null
    : Object.assign(new Error(relayRequest.payload?.message || `Storage upload relay failed: ${relayRequest.response.status}`), {
      code: relayRequest.payload?.code || "STORAGE_UPLOAD_RELAY_FAILED",
      http_status: relayRequest.response.status
    });
  recordClientNetworkStage(asset, "storage_object_relay", { ...relayRequest, error: relayError });
  if (relayError) throw relayError;
  if (
    relayRequest.payload.asset_id !== assetId
    || relayRequest.payload.upload?.image_id !== row.image.id
    || relayRequest.payload.upload?.storage_role !== row.storageRole
  ) throw new Error("Storage upload relay identity mismatch.");
  const objectPath = assertCanonicalImageObjectPath({
    objectPath: relayRequest.payload.upload.object_path,
    tenantId: canonicalAssetTenantId(asset),
    assetId
  });
  applyVerifiedStorageBinding({
    asset,
    image: row.image,
    uploadObjectPath: objectPath,
    contentSha256: row.contentSha256,
    verifyPayload: relayRequest.payload
  });
  row.upload = relayRequest.payload.upload;
  row.objectPath = objectPath;
  row.relayUploaded = true;
  return true;
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
  let verificationRequest;
  try {
    verificationRequest = await fetchStorageApiJson("/api/listing-image-verify-upload", {
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
    }, {
      // Verification is idempotent and the uploaded object is preserved on
      // transient errors. Bound this stage separately so one dead storage read
      // cannot pin a writer card for minutes.
      timeoutMs: STORAGE_VERIFY_TIMEOUT_MS,
      retryDelaysMs: STORAGE_VERIFY_RETRY_DELAYS_MS
    });
  } catch (error) {
    notePendingStorageConfirmationFailure(image);
    throw error;
  }
  const { response: verifyResponse, payload: verifyPayload } = verificationRequest;
  assertCurrentAssetLifecycle(asset);
  if (!verifyResponse.ok || !verifyPayload.ok) {
    if (verifyPayload.cleanup?.deleted || verifyPayload.cleanup?.already_absent) {
      delete image.pendingStorageVerification;
    } else {
      notePendingStorageConfirmationFailure(image);
    }
    throw new Error(verifyPayload.message || `Storage upload verification failed: ${verifyResponse.status}`);
  }
  return applyVerifiedStorageBinding({ asset, image, uploadObjectPath, contentSha256, verifyPayload });
}

async function uploadAssetImage(asset, image, imageIndex) {
  assertCurrentAssetLifecycle(asset);
  await ensureImageUploadMetadata(image);
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

  let lastStorageError = null;
  for (let signedUrlGeneration = 1; signedUrlGeneration <= SIGNED_UPLOAD_URL_GENERATION_LIMIT; signedUrlGeneration += 1) {
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
    const contentType = uploadPayload.upload.content_type || uploadContentType;
    const pendingVerification = {
      ...expectedPending,
      objectPath: uploadObjectPath,
      contentType
    };

    // Warm the one expensive function while the browser is uploading bytes to
    // the separate Supabase origin. This hides cold start without competing
    // with the Vercel control-plane requests or calling the paid provider.
    void startCsmWarmup();

    let storageRequest;
    try {
      storageRequest = await fetchWithBoundedRetry(uploadPayload.upload.signed_upload_url, {
        method: "PUT",
        headers: {
          "content-type": contentType
        },
        body: source
      }, {
        timeoutMs: STORAGE_OBJECT_UPLOAD_TIMEOUT_MS,
        maxAttempts: 3,
        // A signed PUT is idempotent for one canonical object path. Retry the
        // same URL first; if it expires or its response is lost, verify the
        // object and then obtain one fresh signed URL generation.
        retryNetworkErrors: true,
        retryStatuses: [408, 425, 429, 500, 502, 503, 504],
        maxDelayMs: 1500
      });
    } catch (error) {
      recordClientNetworkStage(asset, "storage_object_upload", {
        elapsed_ms: error.elapsed_ms,
        attempts: error.attempts,
        signed_url_generation: signedUrlGeneration,
        error
      });
      lastStorageError = error;
      image.pendingStorageVerification = pendingVerification;
      try {
        return await verifyUploadedAssetImage({
          asset,
          image,
          source,
          storageRole,
          dimensions,
          signatureHex,
          contentSha256,
          uploadObjectPath,
          contentType
        });
      } catch {
        delete image.pendingStorageVerification;
      }
      if (shouldRefreshSignedUpload({ generation: signedUrlGeneration, networkError: true })) continue;
      throw error;
    }

    const storageResponse = storageRequest.response;
    const storageError = storageResponse.ok
      ? null
      : Object.assign(new Error(`Storage upload failed: ${storageResponse.status}`), {
        http_status: storageResponse.status
      });
    recordClientNetworkStage(asset, "storage_object_upload", {
      ...storageRequest,
      signed_url_generation: signedUrlGeneration,
      error: storageError
    });

    if (!storageResponse.ok) {
      lastStorageError = storageError;
      if (shouldRefreshSignedUpload({ generation: signedUrlGeneration, status: storageResponse.status })) {
        image.pendingStorageVerification = pendingVerification;
        try {
          return await verifyUploadedAssetImage({
            asset,
            image,
            source,
            storageRole,
            dimensions,
            signatureHex,
            contentSha256,
            uploadObjectPath,
            contentType
          });
        } catch {
          delete image.pendingStorageVerification;
          continue;
        }
      }
      throw storageError;
    }
    assertCurrentAssetLifecycle(asset);
    image.pendingStorageVerification = pendingVerification;
    return verifyUploadedAssetImage({
      asset,
      image,
      source,
      storageRole,
      dimensions,
      signatureHex,
      contentSha256,
      uploadObjectPath,
      contentType
    });
  }
  throw lastStorageError || new Error("Storage upload failed after signed URL refresh.");
}

async function uploadOriginalAssetImagesBatch(asset, entries = []) {
  const assetId = canonicalAssetId(asset);
  const tenantId = canonicalAssetTenantId(asset);
  const descriptors = await Promise.all(entries.map(async ({ image, imageIndex }) => {
    await ensureImageUploadMetadata(image);
    assertCurrentAssetLifecycle(asset);
    if (imageHasVerifiedStorageReference(image, assetId, tenantId)) return { image, imageIndex, alreadyVerified: true };
    if (image.objectPath || image.storageAssetId || image.storageTenantId) clearImageStorageBinding(image);
    const source = storageSourceForImage(image);
    if (!source) return { image, imageIndex, missingSource: true };
    const usingOriginalSource = source === image.sourceFile;
    const contentType = usingOriginalSource
      ? image.originalType || source.type || "image/jpeg"
      : source.type || image.type || "image/jpeg";
    const storageRole = storageRoleForImage(image, imageIndex);
    image.storageRole = storageRole;
    const [signatureHex, contentSha256] = await Promise.all([
      fileSignatureHex(source),
      image.contentSha256 ? Promise.resolve(image.contentSha256) : contentSha256Hex(source)
    ]);
    const dimensions = storageDimensionsForImage(image, source);
    image.contentSha256 = contentSha256;
    const expectedPending = {
      assetId, tenantId, imageId: image.id, storageRole,
      size: source.size, width: dimensions.width, height: dimensions.height, contentSha256
    };
    return {
      image, imageIndex, source, contentType, storageRole, signatureHex, contentSha256, dimensions, expectedPending,
      pending: pendingStorageVerificationMatches(image.pendingStorageVerification, expectedPending)
    };
  }));
  if (descriptors.some((row) => row.pending || row.missingSource)) {
    return mapWithConcurrency(entries, STORAGE_UPLOAD_CONCURRENCY, async ({ image, imageIndex }) => ({
      ok: true,
      uploaded: await uploadAssetImage(asset, image, imageIndex)
    }));
  }
  let pending = descriptors.filter((row) => !row.alreadyVerified);
  if (!pending.length) return descriptors.map(() => ({ ok: true, uploaded: false }));

  // China-to-Supabase direct PUTs occasionally spend the whole 30s timeout in
  // connection setup even for sub-megabyte images. Keep original bytes and
  // storage-first authority, but carry typical images over the same Vercel
  // origin as the app; sin1 then signs, stores, verifies and persists locally.
  // Any relay failure falls back to the existing signed direct path below.
  void startCsmWarmup();
  const relayEligible = pending.filter((row) => row.source.size <= STORAGE_UPLOAD_RELAY_MAX_BYTES);
  if (relayEligible.length) {
    await mapWithConcurrency(relayEligible, STORAGE_UPLOAD_CONCURRENCY, async (row) => {
      try {
        await uploadAssetImageViaRelay(asset, row);
      } catch (error) {
        row.relayError = error;
      }
    });
    pending = descriptors.filter((row) => !imageHasVerifiedStorageReference(row.image, assetId, tenantId));
    if (!pending.length) {
      return descriptors.map((row) => ({ ok: true, uploaded: row.relayUploaded === true }));
    }
  }

  const signRequest = await fetchStorageApiJson("/api/listing-image-upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      assetId,
      clientAssetRef: asset.clientAssetRef || asset.id,
      images: pending.map((row) => ({
        imageId: row.image.id,
        role: row.storageRole,
        fileName: row.image.name,
        contentType: row.contentType,
        size: row.source.size,
        width: row.dimensions.width,
        height: row.dimensions.height,
        signatureHex: row.signatureHex,
        contentSha256: row.contentSha256
      }))
    })
  }, {
    // Signing is deterministic for one asset/image identity. If the response
    // path stalls, one short replay is cheaper than pinning the card for 30s.
    timeoutMs: STORAGE_CONTROL_RECOVERY_TIMEOUT_MS,
    retryDelaysMs: STORAGE_CONTROL_RECOVERY_DELAYS_MS
  });
  if (!signRequest.response.ok || !signRequest.payload.ok || !Array.isArray(signRequest.payload.uploads)) {
    // COS-51. A collision is the one signing failure with a way forward, and
    // the blind-evaluation path has verified-reuse already; this is the same
    // recovery finally wired into the production browser path.
    const collisions = Array.isArray(signRequest.payload?.collisions)
      ? signRequest.payload.collisions
      : (signRequest.payload?.code === "STORAGE_OBJECT_ALREADY_EXISTS" && signRequest.payload?.object_path
        ? [{
            image_id: pending[0]?.image?.id,
            object_path: signRequest.payload.object_path,
            bucket: signRequest.payload.bucket
          }]
        : []);
    if (!collisions.length) {
      throw new Error(signRequest.payload.message || `Storage upload URL batch failed: ${signRequest.response.status}`);
    }
    const unrecovered = await recoverCollidedStorageObjects(asset, pending, collisions);
    if (!unrecovered.length) {
      return descriptors.map((row) => ({ ok: true, uploaded: false, recovered: true }));
    }
    // Stored bytes are absent, mismatched, or out of scope. Not resumable and
    // not overwritable: the input identity itself has to move, which is what
    // INPUT_REBIND means. Retrying the same identity here is the loop.
    throw Object.assign(new Error("识别输入需要重新绑定：已存在的图片对象与本次上传不一致。"), {
      code: "STORAGE_OBJECT_ALREADY_EXISTS",
      recovery_action: "INPUT_REBIND",
      requires_input_rebind: true,
      retryable: true
    });
  }
  const uploadsByImage = new Map(signRequest.payload.uploads.map((upload) => [upload.image_id, upload]));
  const putOutcomes = await mapWithConcurrency(pending, STORAGE_UPLOAD_CONCURRENCY, async (row) => {
    try {
      const upload = uploadsByImage.get(row.image.id);
      if (!upload || upload.tenant_id !== tenantId || upload.storage_role !== row.storageRole) throw new Error("Storage upload identity mismatch.");
      const objectPath = assertCanonicalImageObjectPath({ objectPath: upload.object_path, tenantId, assetId });
      row.upload = upload;
      row.objectPath = objectPath;
      // Record the exact confirmation identity before the PUT. A connection
      // can disappear after Storage committed the bytes but before fetch saw
      // the 2xx; recovery must verify this path before paying to upload again.
      row.image.pendingStorageVerification = {
        ...row.expectedPending,
        objectPath,
        contentType: upload.content_type
      };
      const storageRequest = await fetchWithBoundedRetry(upload.signed_upload_url, {
        method: "PUT",
        headers: { "content-type": upload.content_type || row.contentType },
        body: row.source
      }, {
        timeoutMs: STORAGE_OBJECT_UPLOAD_TIMEOUT_MS,
        maxAttempts: 3,
        retryNetworkErrors: true,
        maxDelayMs: 1500
      });
      const error = storageRequest.response.ok ? null : Object.assign(new Error(`Storage upload failed: ${storageRequest.response.status}`), {
        http_status: storageRequest.response.status
      });
      recordClientNetworkStage(asset, "storage_object_upload", { ...storageRequest, error });
      if (error) throw error;
      return { ok: true };
    } catch (error) {
      row.putError = error;
      return { ok: false, error };
    }
  });
  const unverifiablePut = putOutcomes.find((outcome, index) => outcome.ok !== true && !pending[index]?.objectPath);
  if (unverifiablePut) throw unverifiablePut.error;

  let verifyRequest;
  try {
    verifyRequest = await fetchStorageApiJson("/api/listing-image-verify-upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        assetId,
        images: pending.map((row) => ({
          imageId: row.image.id,
          role: row.storageRole,
          fileName: row.image.name,
          objectPath: row.objectPath,
          contentType: row.upload.content_type,
          size: row.source.size,
          width: row.dimensions.width,
          height: row.dimensions.height,
          signatureHex: row.signatureHex,
          contentSha256: row.contentSha256,
          cropMetadata: row.image.cropMetadata || row.image.crop_metadata || null
        }))
      })
    }, { timeoutMs: STORAGE_VERIFY_TIMEOUT_MS, retryDelaysMs: STORAGE_VERIFY_RETRY_DELAYS_MS });
  } catch (error) {
    pending.forEach((row) => notePendingStorageConfirmationFailure(row.image));
    throw error;
  }
  const verificationByImage = new Map((verifyRequest.payload.verifications || []).map((row) => [row.image_id, row]));
  let firstVerificationError = null;
  for (const row of pending) {
    const verification = verificationByImage.get(row.image.id);
    if (!verification?.ok) {
      if (verification?.cleanup?.deleted || verification?.cleanup?.already_absent) delete row.image.pendingStorageVerification;
      // A definite PUT rejection is safe to re-sign after verification proves
      // the object absent. A transport error remains ambiguous and keeps the
      // pending path for the next exact-state confirmation.
      if (Number.isFinite(Number(row.putError?.http_status))) delete row.image.pendingStorageVerification;
      else notePendingStorageConfirmationFailure(row.image);
      firstVerificationError ||= new Error(verification?.message || verifyRequest.payload.message || `Storage upload verification failed: ${verifyRequest.response.status}`);
      continue;
    }
    applyVerifiedStorageBinding({
      asset,
      image: row.image,
      uploadObjectPath: row.objectPath,
      contentSha256: row.contentSha256,
      verifyPayload: verification
    });
  }
  if (firstVerificationError) throw firstVerificationError;
  return descriptors.map((row) => ({ ok: true, uploaded: row.relayUploaded === true || !row.alreadyVerified }));
}

function syncDerivedImageSourceMetadata(asset, images = []) {
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
}

function ensureAssetOriginalImagesUploaded(asset) {
  // COS-51: the single-flight claim happens BEFORE any await, and this is the
  // whole fix. The memo below already existed, but it sat after
  // `await ensureDurableAssetIdentity(asset)` -- so two callers both reached it
  // while it was still unset, both started an upload run, and both signed the
  // same deterministic object path. The second one got
  // `400 The resource already exists` before any model call, which is why the
  // production reproduction shows "模型未启动" next to the storage error.
  //
  // The two callers are real and not hypothetical: a manual retry and the
  // background preparation loop both reach here, and neither can see the
  // other's `retryStatus`. A per-asset claim is the only thing that answers
  // "is this asset already being prepared?"; `state.retryInFlight` is a count
  // and can only answer "is anything retrying?".
  if (asset.originalStorageUploadPromise) return asset.originalStorageUploadPromise;

  // The direct path's blind spot, measured.
  //
  // Recognition awaits this before it calls the title endpoint, and originals
  // are uploaded verbatim up to 25MB -- so on a phone photo this is where the
  // wall clock goes. Eight production cards on 2026-08-07 reported 3.4-7.6s of
  // server work against a writer-observed ~23s, and the difference was here,
  // unmeasured: the stage timers lived inside the ingest fast path's own local
  // accumulator, which this path never touches.
  //
  // One coarse number on purpose. It answers the question actually being asked
  // -- how many seconds pass before recognition can start -- without adding
  // timing calls to a hot loop.
  const originalUploadStartedAt = performance.now();
  const timing = asset.clientTiming || (asset.clientTiming = {});
  const recordOriginalUploadTiming = () => {
    timing.client_original_upload_ms = Math.round(performance.now() - originalUploadStartedAt);
    timing.client_upload_bytes = (asset.providerImages || asset.images || [])
      .reduce((total, image) => {
        const source = storageSourceForImage(image);
        return total + (source && source.size ? source.size : 0);
      }, 0);
  };

  const attempt = (async () => {
    await ensureDurableAssetIdentity(asset);
    assertCurrentAssetLifecycle(asset);
    if (!storageReady()) throw new Error("listing_storage_not_ready");
    const images = boundedProviderImagesForRequest(asset.providerImages || asset.images);
    asset.providerImages = images;
    const indexedImages = images.map((image, imageIndex) => ({ image, imageIndex }));
    const uploadPhase = async (entries) => {
      const originalsOnly = entries.length > 1 && entries.every(({ image }) => !imageIsDerivedForRequest(image));
      if (originalsOnly) {
        try {
          return await uploadOriginalAssetImagesBatch(asset, entries);
        } catch (error) {
          return entries.map(() => ({ ok: false, error }));
        }
      }
      return mapWithConcurrency(entries, STORAGE_UPLOAD_CONCURRENCY, async ({ image, imageIndex }) => {
        try {
          return { ok: true, uploaded: await uploadAssetImage(asset, image, imageIndex) };
        } catch (error) {
          return { ok: false, error };
        }
      });
    };
    const phases = await startNonBlockingDerivedUpload({
      entries: indexedImages,
      isDerived: ({ image }) => imageIsDerivedForRequest(image),
      uploadPhase,
      beforeDerived: () => syncDerivedImageSourceMetadata(asset, images)
    });
    assertCurrentAssetLifecycle(asset);
    asset.derivedStorageUploadStatus = phases.derived.length ? "uploading" : "not_required";
    asset.derivedStorageUploadPromise = phases.derivedPromise
      .then((outcomes) => {
        const summary = summarizeDerivedUploadOutcomes(outcomes);
        asset.derivedStorageUploadStatus = summary.status;
        asset.derivedStorageUploadFailureCount = summary.failed;
        asset.derivedStorageUploadError = summary.first_error
          ? String(summary.first_error.message || summary.first_error).slice(0, 160)
          : "";
        syncDerivedImageSourceMetadata(asset, images);
        return summary;
      })
      .catch((error) => {
        asset.derivedStorageUploadStatus = "partial";
        asset.derivedStorageUploadFailureCount = Math.max(1, phases.derived.length);
        asset.derivedStorageUploadError = String(error?.message || error || "derived_upload_failed").slice(0, 160);
        return {
          total: phases.derived.length,
          uploaded: 0,
          failed: phases.derived.length,
          status: "partial",
          first_error: error
        };
      });
    const failedOriginal = phases.originalOutcomes.find((outcome) => outcome.ok !== true);
    if (failedOriginal) {
      // Throw so the outer guard clears originalStorageUploadPromise. The
      // background preparation loop can then retry only the pending
      // verification; the successful signed PUT is preserved and is not paid
      // for a second time.
      throw failedOriginal.error || new Error("listing_original_upload_failed");
    }
    const originalsReady = indexedImages
      .filter(({ image }) => !imageIsDerivedForRequest(image))
      .every(({ image }) => imageHasVerifiedStorageReference(image, canonicalAssetId(asset), canonicalAssetTenantId(asset)));
    if (!originalsReady) {
      throw new Error("listing_original_verification_incomplete");
    }
    // Recorded here rather than by wrapping the promise. A `.then()` around the
    // single-flight claim inserts a microtask between the upload settling and
    // the claim being observed, and `progressive-handle-files` caught the
    // consequence on CI while every local run passed: a card was recognized
    // twice. Measurement must not change the shape of what it measures.
    recordOriginalUploadTiming();
    return phases.originalOutcomes.some((outcome) => outcome.uploaded === true);
  })();

  // Release the claim on failure only, so a failed attempt does not leave the
  // asset permanently claimed while a successful one stays memoised. The
  // identity check keeps a stale rejection from clearing a NEWER claim that a
  // successor generation already installed.
  // Record on both outcomes. A failed upload still consumed the writer's time,
  // and a stage that only reports on success is the shape that made the
  // original latency gap invisible in the first place.
  const guarded = attempt.catch((error) => {
    // In the catch the chain already had, not a new link. A failed upload still
    // consumed the writer's time, and a stage recorded only on success is the
    // shape that made this gap invisible to begin with.
    recordOriginalUploadTiming();
    if (asset.originalStorageUploadPromise === guarded) asset.originalStorageUploadPromise = null;
    throw error;
  });
  asset.originalStorageUploadPromise = guarded;
  return guarded;
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
  if (state.preparingFiles) {
    setStatus(`已读取 ${total} 张卡；已就绪的卡正在后台上传和识别，其余图片继续读取中…`, { busy: true });
    return;
  }
  if (ready === total) {
    setStatus(`${state.files.length} 张图片已上传并校验，正在自动识别。`);
    return;
  }
  if (ready + failed === total && failed > 0) {
    setStatus(`${state.files.length} 张图片已读取；${failed} 张卡上传遇到瞬时错误，识别时会自动重试。`);
    return;
  }
  setStatus(`${state.files.length} 张图片已读取；原图上传中 ${ready} / ${total}。`, { busy: true });
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
    let lastError = null;
    let attempt = 0;
    try {
      for (attempt = 1; attempt <= 3; attempt += 1) {
        try {
          if (runId !== state.backgroundPreparationRunId) return { stale: true };
          asset.backgroundPrepareAttemptCount = attempt;
          asset.backgroundPrepareStatus = "uploading";
          syncBackgroundPreparationStatus();
          await ensureAssetOriginalImagesUploaded(asset);
          if (runId !== state.backgroundPreparationRunId) return { stale: true };
          asset.backgroundPrepareStatus = "ready";
          asset.backgroundPrepareError = "";
          asset.backgroundPrepareRecoveredByRetry = attempt > 1;
          asset.backgroundPrepareMs = Math.round(performance.now() - startedAt);
          syncBackgroundPreparationStatus();
          return { ok: true, attempt_count: attempt, route: "CSM_THIN_DIRECT" };
        } catch (error) {
          lastError = error;
          if (runId !== state.backgroundPreparationRunId) return { stale: true };
          if (attempt >= 3) break;
          asset.backgroundPrepareStatus = "queued";
          asset.backgroundPrepareError = String(error?.message || "background_prepare_retrying").slice(0, 160);
          syncBackgroundPreparationStatus();
          await wait(350 * attempt);
        }
      }
      asset.backgroundPrepareStatus = "failed";
      asset.backgroundPrepareError = String(lastError?.message || "background_prepare_failed").slice(0, 160);
      asset.backgroundPrepareMs = Math.round(performance.now() - startedAt);
      syncBackgroundPreparationStatus();
      return { ok: false, attempt_count: attempt, error: asset.backgroundPrepareError };
    } finally {
      if (!state.processing && runId === state.backgroundPreparationRunId) {
        renderResultControls();
        if (!writerModeActive()) renderAssetRowInPlace(asset);
        syncBackgroundPreparationStatus();
      }
    }
  })();

  return asset.backgroundPreparationPromise;
}

async function ensureAssetPreparedForRecognition(asset) {
  while (
    !asset.backgroundPreparationPromise
    && asset.backgroundPreparationScheduledRunId === state.backgroundPreparationRunId
  ) {
    assertCurrentAssetLifecycle(asset);
    await wait(25);
  }
  const backgroundPreparation = asset.backgroundPreparationPromise;
  if (
    backgroundPreparation
    && asset.backgroundPreparationRunId === state.backgroundPreparationRunId
  ) {
    const outcome = await backgroundPreparation;
    assertCurrentAssetLifecycle(asset);
    if (outcome?.ok === true) return true;
    const error = new Error(outcome?.error || "background_prepare_failed");
    error.code = "LISTING_PREMODEL_PREPARATION_FAILED";
    error.retryable = true;
    throw error;
  }
  return ensureAssetOriginalImagesUploaded(asset);
}

function csmIngestFastPathEligible(asset = {}) {
  if (asset.durableAssetId || asset.originalStorageUploadPromise) return false;
  const images = Array.isArray(asset.images) ? asset.images : [];
  if (!images.length || images.length > 2) return false;
  const sources = images.map(storageSourceForImage);
  return sources.every((source) => source && source.size > 0)
    && sources.reduce((total, source) => total + source.size, 0) <= STORAGE_UPLOAD_RELAY_MAX_BYTES;
}

async function requestCsmIngestFastPath(asset, intentId) {
  // The 18 seconds nobody could see.
  //
  // A production run measured 4,652ms server-side against roughly 23 seconds
  // in front of the operator. Everything in between happens HERE, before the
  // request exists: decoding each image for its dimensions, reading its
  // signature, and hashing the WHOLE file with SHA-256 -- then shipping the
  // bytes as the request body. None of it was timed, and `client_total_ms` was
  // computed and written to local state only, so the gap has never been
  // recorded anywhere.
  //
  // These ride the metadata header the request already carries, so they cost
  // no round trip and add no latency to the thing being measured.
  // The asset's accumulator, not a local one. As a local it was invisible to
  // the direct path, which is why that path had no client stages to send even
  // after it was wired to send them.
  const clientTiming = asset.clientTiming || (asset.clientTiming = {});
  const clientStage = async (name, work) => {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      clientTiming[name] = Math.round((clientTiming[name] || 0) + performance.now() - startedAt);
    }
  };
  const preparationStartedAt = performance.now();
  const images = await Promise.all(asset.images.map(async (image, imageIndex) => {
    await clientStage("client_image_metadata_ms", () => ensureImageUploadMetadata(image));
    const source = storageSourceForImage(image);
    const usingOriginalSource = source === image.sourceFile;
    const contentType = usingOriginalSource
      ? image.originalType || source.type || "image/jpeg"
      : source.type || image.type || "image/jpeg";
    const dimensions = storageDimensionsForImage(image, source);
    const [signatureHex, contentSha256] = await Promise.all([
      clientStage("client_signature_ms", () => fileSignatureHex(source)),
      // Hashing the whole file. On a phone photo this is the expensive one, and
      // it is charged per image, before anything reaches the network.
      clientStage("client_sha256_ms", () => (image.contentSha256
        ? Promise.resolve(image.contentSha256)
        : contentSha256Hex(source)))
    ]);
    image.contentSha256 = contentSha256;
    return {
      image,
      source,
      imageId: image.id,
      role: storageRoleForImage(image, imageIndex),
      fileName: image.name,
      contentType,
      size: source.size,
      width: dimensions.width,
      height: dimensions.height,
      signatureHex,
      contentSha256
    };
  }));
  clientTiming.client_preparation_ms = Math.round(performance.now() - preparationStartedAt);
  clientTiming.client_upload_bytes = images.reduce((total, image) => total + (image.size || 0), 0);
  const metadata = {
    clientTiming,
    clientAssetRef: asset.clientAssetRef || asset.id,
    idempotencyKey: assetCreateIdempotencyKey(asset),
    captureProfileId: defaultCaptureProfileId,
    intentId,
    imageDetail: "high",
    images: images.map(({ source: _source, image: _image, ...image }) => image)
  };
  const request = await fetchJsonWithRetry(CSM_THIN_INGEST_API_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-lynca-ingest-metadata": encodeUploadRelayMetadata(metadata)
    },
    credentials: "same-origin",
    body: new Blob(images.map((image) => image.source), { type: "application/octet-stream" })
  }, {
    timeoutMs: CSM_THIN_REQUEST_TIMEOUT_MS,
    maxAttempts: 1,
    retryNetworkErrors: false,
    asset,
    stage: "csm_thin_ingest"
  });
  const payload = request.payload || {};
  const canRecoverUpload = payload.client_asset_ref === metadata.clientAssetRef
    && payload.asset_id
    && payload.tenant_id
    && Array.isArray(payload.verifications);
  if (canRecoverUpload) {
    asset.durableAssetId = payload.asset_id;
    asset.durableTenantId = payload.tenant_id;
    asset.imageGenerationId = payload.image_generation_id || payload.asset_id;
    asset.expectedOriginalCount = Number(payload.expected_original_count || images.length);
    const verificationByImage = new Map(payload.verifications.map((row) => [row.image_id, row]));
    for (const row of images) {
      const verification = verificationByImage.get(row.imageId);
      if (!verification?.upload?.object_path || verification.verification_record?.durable !== true) {
        throw new Error("csm_ingest_verification_identity_missing");
      }
      row.image.storageRole = row.role;
      applyVerifiedStorageBinding({
        asset,
        image: row.image,
        uploadObjectPath: verification.upload.object_path,
        contentSha256: row.contentSha256,
        verifyPayload: verification
      });
    }
    asset.backgroundPrepareStatus = "ready";
  }
  if (request.error || request.payload?.ok !== true) {
    const error = new Error(request.payload?.message || `CSM 一体化链路失败：${request.response?.status || "network"}`);
    error.code = String(request.payload?.code || "").trim();
    error.retryable = request.payload?.retryable === true;
    throw error;
  }
  if (!canRecoverUpload) {
    throw new Error("csm_ingest_asset_identity_mismatch");
  }
  return payload;
}

async function processAssetViaCsmThinPath(asset, {
  intentId = state.backgroundRecognitionBatchId,
  manualRetry = false,
  retrySubmissionId = ""
} = {}) {
  assertCurrentAssetLifecycle(asset);
  const durableIntentId = String(intentId || "").trim();
  if (!durableIntentId) throw new Error("CSM 识别意图缺失");
  const startedAt = performance.now();
  let payload;
  if (manualRetry !== true && csmIngestFastPathEligible(asset)) {
    setAssetProgress(asset.index, "上传与 Luna 并行", 0.28);
    markAssetStarted(asset, Date.now(), "client_csm_ingest_request");
    try {
      payload = await requestCsmIngestFastPath(asset, durableIntentId);
    } catch (fastPathError) {
      // The durable operation key is asset/intent/image based, so falling back
      // can safely recover a lost response without buying a second model call.
      asset.fastIngestFallbackReason = String(fastPathError?.code || fastPathError?.message || "fast_ingest_failed").slice(0, 160);
    }
  }
  if (!payload) {
    setAssetProgress(asset.index, "上传并校验原图", 0.12);
    await ensureAssetPreparedForRecognition(asset);
    setAssetProgress(asset.index, "Luna 单次识别", 0.45);
    markAssetStarted(asset, Date.now(), "client_csm_request");
    const request = await fetchJsonWithRetry(CSM_THIN_API_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        asset_id: canonicalAssetId(asset),
        intent_id: durableIntentId,
        image_detail: "high",
        manual_retry: manualRetry === true,
        // What the browser already measured about its OWN work -- image
        // metadata, signature, sha256, upload bytes and network retries -- sent
        // where it can be recorded. It was accumulated on the asset and thrown
        // away on this path, which is the path the writer flow takes, so the
        // gap between the server's few seconds and the ~23s a writer waits had
        // no measurement behind it at all.
        ...(asset.clientTiming && Object.keys(asset.clientTiming).length
          ? { client_timing: asset.clientTiming }
          : {}),
        ...(retrySubmissionId ? { retry_submission_id: retrySubmissionId } : {})
      })
    }, {
      timeoutMs: CSM_THIN_REQUEST_TIMEOUT_MS,
      maxAttempts: 1,
      retryNetworkErrors: false,
      asset,
      stage: "csm_thin_direct"
    });
    if (request.error || request.payload?.ok !== true) {
      const error = new Error(request.payload?.message || `CSM 薄链路失败：${request.response?.status || "network"}`);
      error.code = String(request.payload?.code || "").trim();
      error.retryable = request.payload?.retryable === true;
      throw error;
    }
    payload = request.payload;
  }
  const lowConfidence = payload.low_confidence_fields || [];
  setAssetProgress(asset.index, "CSM / SEM 组合完成", 0.96);
  const csmResult = attachGenerationTimingToResult({
    index: asset.index,
    lifecycleGeneration: asset.lifecycleGeneration,
    asset_id: canonicalAssetId(asset),
    client_asset_ref: asset.clientAssetRef || asset.id,
    thumbnail: imagePreviewUrl(asset.images[0]),
    title: payload.title,
    final_title: payload.title,
    rendered_title: payload.title,
    generatedTitle: payload.title,
    // CSM's title is the initial writer draft. Keeping this populated is
    // important because an empty correctedTitle is a deliberate "no title"
    // value in the writer UI, not a signal to fall back to generatedTitle.
    correctedTitle: payload.title,
    writerTitlePending: false,
    confidence: lowConfidence.length || payload.trace_status !== "PERSISTED" ? "MEDIUM" : "HIGH",
    provider: "gpt-5.6-luna",
    provider_label: "Luna 5.6",
    model_id: payload.model || "gpt-5.6-luna",
    reason: payload.trace_status === "PERSISTED" ? "" : "CSM trace persistence failed",
    fields: payload.fields || {},
    resolved: payload.fields || {},
    generated_resolved_fields: payload.fields || {},
    unresolved: payload.unreadable_fields || [],
    recognition_session_id: payload.recognition_session_id || "",
    title_stage: "FINAL",
    assisted_draft_status: "READY",
    csm_trace_status: payload.trace_status,
    csm_intent_id: durableIntentId,
    csm_rows: payload.csm_rows,
    route: payload.route || "CSM_THIN_DIRECT",
    timing: { client_total_ms: Math.round(performance.now() - startedAt) }
  });
  // Glass Box (COS-42): fetch the field-level trace once the title is final.
  // Read-only and fire-and-forget, so a failure here must never disturb the
  // title the writer is waiting on -- an inspector that can break the thing it
  // inspects is worse than no inspector. This hook used to hang off the V4
  // assisted-draft poller, which the direct CSM route retired; the anchor is
  // now the point where the CSM result itself becomes final.
  if (csmResult.asset_id && !csmResult.csmResolutionView) {
    loadCsmResolutionView(csmResult.asset_id)
      .then((view) => { if (view) { csmResult.csmResolutionView = view; renderResults(); } })
      .catch(() => {});
  }
  return csmResult;
}

function backgroundPreparationAvailable() {
  return true;
}

function beginBackgroundPreparationRun() {
  const runId = ++state.backgroundPreparationRunId;
  state.backgroundRecognitionBatchId = createClientBatchId();
  backgroundPreparationQueue = [];
  return runId;
}

function drainBackgroundPreparationQueue() {
  while (backgroundPreparationActiveCount < MAX_BACKGROUND_PREP_WORKERS && backgroundPreparationQueue.length) {
    const entry = backgroundPreparationQueue.shift();
    if (!entry || entry.runId !== state.backgroundPreparationRunId) continue;
    backgroundPreparationActiveCount += 1;
    void Promise.resolve(prepareAssetInBackground(entry.asset, entry.runId))
      .finally(() => {
        backgroundPreparationActiveCount = Math.max(0, backgroundPreparationActiveCount - 1);
        drainBackgroundPreparationQueue();
      });
  }
}

function scheduleAssetBackgroundPreparation(asset, runId = state.backgroundPreparationRunId) {
  if (!asset || !runId || runId !== state.backgroundPreparationRunId) return false;
  if (!backgroundPreparationAvailable()) return false;
  // Typical one/two-image assets use one same-origin ingest request. Starting
  // the legacy upload worker here would recreate the serial boundary and race
  // the same deterministic object paths.
  if (csmIngestFastPathEligible(asset)) return true;
  if (asset.backgroundPrepareStatus === "ready") return true;
  if (asset.backgroundPreparationScheduledRunId === runId) return true;
  asset.backgroundPreparationScheduledRunId = runId;
  asset.backgroundPrepareStatus = "queued";
  asset.backgroundPreparationRunId = runId;
  backgroundPreparationQueue.push({ asset, runId });
  drainBackgroundPreparationQueue();
  return true;
}

function startBackgroundPreparation(reason = "file_ready") {
  if (!backgroundPreparationAvailable() || !state.assets.length) return false;
  const reuseCurrentRun = reason === "provider_status_ready"
    && state.backgroundPreparationRunId > 0
    && Boolean(state.backgroundRecognitionBatchId);
  const runId = reuseCurrentRun ? state.backgroundPreparationRunId : beginBackgroundPreparationRun();
  const scheduled = state.assets.reduce(
    (count, asset) => count + (scheduleAssetBackgroundPreparation(asset, runId) ? 1 : 0),
    0
  );
  if (!state.processing && !state.preparingFiles) renderResults();
  return scheduled > 0;
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

function renderProviderControl() {
  elements.providerControl.innerHTML = `
    <button
      class="provider-option active"
      type="button"
      disabled
    >
      <strong>Luna 5.6</strong>
      <small>CSM / SEM 单次识别</small>
    </button>
  `;
  elements.providerStatusText.textContent = "上传后自动识别 · 原图直达 Luna · CSM / SEM 生成标题";
  elements.processButton.disabled = !canGenerateTitles();
}

function canGenerateTitles() {
  return canStartRecognitionRun();
}

function hasAssetsAwaitingRecognition() {
  const completedAssetIndexes = new Set(state.results.map((result) => Number(result.index)));
  return state.assets.some((asset) => !completedAssetIndexes.has(Number(asset.index)));
}

function canStartRecognitionRun() {
  return Boolean(
    hasAssetsAwaitingRecognition()
    && !state.processing
  );
}

function syncProcessButtonState() {
  const busy = state.processing;
  elements.processButton.disabled = !canGenerateTitles()
    || state.writerSaveInFlight
    || state.exportingWorkbook;
  setProcessButtonBusy(busy);
}

function directRecognitionConcurrencyLimit({
  maxWorkers = MAX_DIRECT_RECOGNITION_WORKERS
} = {}) {
  return Math.max(1, Math.trunc(Number(maxWorkers) || MAX_DIRECT_RECOGNITION_WORKERS));
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
  elements.processButton.textContent = isBusy ? "识别中" : "开始识别";
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
  return false;
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
  if (!state.processing) return;
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
  return state.processing;
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
  assetCreateIdempotencyKey,
  assetLifecycleMatches,
  boundedProviderImagesForRequest,
  clearImageStorageBinding,
  directRecognitionConcurrencyLimit,
  ensureAssetPreparedForRecognition,
  generationTimingView,
  handleFiles,
  imageHasVerifiedStorageReference,
  imagesForProvider,
  notePendingStorageConfirmationFailure,
  listingCopilotStateSnapshot: () => ({
    assetIndexes: state.assets.map((asset) => Number(asset.index)),
    intentId: state.backgroundRecognitionBatchId,
    preparingFiles: state.preparingFiles,
    processing: state.processing,
    resultIndexes: state.results.map((result) => Number(result.index))
  }),
  recognitionClockFromServerPayload,
  resetAssetPreparationForRetry,
  retryStateForResult,
  shouldUseStorageFirstImage,
  startCsmWarmup,
  storageDimensionsForImage,
  storageSourceForImage,
  syncAssetGenerationTimingFromServer,
  uploadOriginalAssetImagesBatch
};

function createClientAsset(images, index) {
  return {
    id: `asset-${index}`,
    clientAssetRef: `asset-${index}`,
    durableAssetId: "",
    durableTenantId: "",
    lifecycleGeneration: state.assetLifecycleGeneration,
    index,
    images,
    providerImages: imagesForProvider(images)
  };
}

function buildAssets() {
  const assets = [];

  if (state.mode === "single") {
    state.files.forEach((image, index) => {
      assets.push(createClientAsset([image], index + 1));
    });
  } else {
    for (let index = 0; index < state.files.length; index += 2) {
      const images = state.files.slice(index, index + 2);
      assets.push(createClientAsset(images, Math.floor(index / 2) + 1));
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
    || state.preparingFiles;
}

function destructiveWorkspaceInteractionLocked() {
  return workspaceInteractionLocked() || state.retryInFlight > 0;
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

function writerOutstandingAssets() {
  return state.assets.filter((asset) => !writerFeedbackPersisted(resultForAsset(asset)));
}

function syncWriterActiveIndex() {
  if (!state.assets.length) {
    state.writerActiveIndex = null;
    return null;
  }

  const current = state.assets.find((asset) => asset.index === Number(state.writerActiveIndex));
  if (state.writerReviewComplete && writerProcessedCount() === state.assets.length && current) return current;
  const outstanding = writerOutstandingAssets().sort((left, right) => left.index - right.index);
  const next = outstanding[0] || state.assets[0];
  state.writerActiveIndex = next?.index ?? null;
  return next || null;
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
  const visibleIndexes = [...new Set(indexes.map(Number).filter(Number.isFinite))]
    // The UI still exposes eight cards. During one queue handoff the outgoing
    // card and the incoming ninth card coexist only as transition snapshots.
    .slice(0, INTAKE_PREVIEW_CARD_WINDOW + 1);
  const visibleIndexSet = new Set(visibleIndexes);
  clearCardViewTransitionNames();
  elements.assetPreviewList?.querySelectorAll("[data-card-transition-index]").forEach((card) => {
    const index = Number(card.dataset.cardTransitionIndex);
    if (visibleIndexSet.has(index)) card.style.viewTransitionName = `listing-card-${index}`;
  });
  return visibleIndexes;
}

function visibleOutstandingAssetIndexes() {
  return writerOutstandingAssets()
    .sort((left, right) => left.index - right.index)
    .slice(0, INTAKE_PREVIEW_CARD_WINDOW)
    .map((asset) => asset.index);
}

function renderQueueAdvance(beforeIndexes = [], { animate = true } = {}) {
  const transitionIndexes = [...new Set([...beforeIndexes, ...visibleOutstandingAssetIndexes()])];
  return runWorkbenchViewTransition({
    kind: "queue-advance",
    enabled: animate,
    prepareSharedElements: () => setCardViewTransitionNames(transitionIndexes),
    update: () => renderResults({ forceWriterRender: true })
  });
}

function writerWheelVisibleAssetIndexes(activeIndex = state.writerActiveIndex) {
  const outstanding = writerOutstandingAssets().sort((left, right) => left.index - right.index);
  const current = outstanding.find((asset) => asset.index === Number(activeIndex)) || outstanding[0];
  if (!current) return [];
  return [current, ...outstanding.filter((asset) => asset.index !== current.index)]
    .slice(0, INTAKE_PREVIEW_CARD_WINDOW)
    .map((asset) => asset.index);
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
  const destructiveInteractionLocked = destructiveWorkspaceInteractionLocked() || state.processing;
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

/** "48 秒" under a minute, "2 分 05 秒" beyond it. Seconds alone stop being
 *  readable at the batch sizes this is for. */
function formatBatchElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes} 分 ${String(totalSeconds % 60).padStart(2, "0")} 秒`;
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

  // Only once every card in the batch has resolved. A running total would
  // change on every render and read as a stopwatch nobody asked for; the
  // finished total is the number worth showing.
  const complete = state.assets.length > 0 && state.results.length >= state.assets.length;
  if (complete && state.batchStartedAt && !state.batchFinishedAt) {
    state.batchFinishedAt = Date.now();
  }
  if (!complete) state.batchFinishedAt = 0;
  if (elements.stats.elapsed) {
    elements.stats.elapsed.textContent = state.batchFinishedAt && state.batchStartedAt
      ? formatBatchElapsed(state.batchFinishedAt - state.batchStartedAt)
      : "—";
  }
  elements.stats.requests.textContent = state.assets.length;
  elements.stats.cost.textContent = formatCost(state.assets.length);
}

function renderPreviews({ rebuildAssets = true } = {}) {
  if (rebuildAssets) buildAssets();
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
  renderResultControls();
  if (!preserveFocusedTitleInput) renderAssetRows();
  if (writerModeActive() && state.writerFocusPending && !preserveFocusedTitleInput) scheduleWriterInputFocus();
  if (writerModeActive() && state.writerCompletionFocusPending && !preserveFocusedTitleInput) scheduleWriterCompletionFocus();
}

function renderResultControls() {
  updateStats();
  updateWorkspaceModeUi();
  renderBatchTitles();
  syncProcessButtonState();
  updatePreviewSummary();
}

function renderAssetRowInPlace(asset) {
  if (writerModeActive()) return false;
  const current = elements.assetPreviewList.querySelector(`[data-asset-row="${Number(asset.index)}"]`);
  if (!current) return false;
  current.outerHTML = assetRowHtml(asset);
  return true;
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
      processing: state.writerSaveInFlight || state.preparingFiles || state.retryInFlight,
      exporting: state.exportingWorkbook,
      finalTitleForResult
    });
  }
  if (!state.assets.length) return false;
  if (state.processing || state.exportingWorkbook || state.preparingFiles) return false;
  return state.assets.every((asset) => {
    const result = resultForAsset(asset);
    return Boolean(result && finalTitleForResult(result));
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
  return "待录入";
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
      <div class="asset-row-card writer-wheel-current-card" data-asset-index="${asset.index}" data-asset-row="${asset.index}">
        <div class="asset-source">
          <div class="preview-images ${asset.images.length === 1 ? "single" : ""}">
            ${asset.images.map((image, imageIndex) => `
              <button class="thumb-button" type="button" data-preview-asset="${asset.index}" data-preview-image="${imageIndex}" aria-label="打开卡片图片预览">
                <img class="thumb" src="${escapeHtml(imagePreviewUrl(image))}" alt="${escapeHtml(image.name)}" loading="lazy" decoding="async">
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

function writerQueueWindowHtml(current) {
  const outstanding = writerOutstandingAssets().sort((left, right) => left.index - right.index);
  // COS-50: the strip still renders at most eight, but it now says how many
  // there are. `8 / 8` read as "this batch has 8 cards" on a 20-card batch,
  // which is the reading that made a correctly accepted batch look truncated.
  const queueWindow = batchReviewWindow(outstanding, { focusIndex: current.index });
  const visible = queueWindow.visible;
  const queued = visible.filter((asset) => asset.index !== current.index);
  if (!queued.length) return "";
  return `
    <section class="writer-queue-window" aria-label="待处理卡片队列">
      <header><strong>待处理窗口</strong><span>正在显示 ${queueWindow.from}–${queueWindow.to} / 共 ${queueWindow.total} 张</span></header>
      <div class="writer-queue-window-list">
        ${queued.map((asset, index) => {
          const image = asset.images?.[0];
          return `
            <div class="writer-queue-window-item" data-card-transition-index="${asset.index}" aria-label="队列第 ${index + 2} 张，卡片 ${asset.index}">
              ${image ? `<img src="${escapeHtml(imagePreviewUrl(image))}" alt="" loading="lazy" decoding="async">` : ""}
              <span>卡片 ${asset.index}</span>
              <small>${escapeHtml(writerAssetStatusLabel(asset))}</small>
            </div>
          `;
        }).join("")}
      </div>
    </section>
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
        <div class="writer-wheel-track writer-queue-mode ${writerTransition ? `writer-transition-${writerTransition}` : ""}">
          ${writerCurrentCardHtml(current)}
        </div>
      </div>
      ${writerQueueWindowHtml(current)}
      <footer class="writer-wheel-footer">
        <span>标题保存成功后卡片才会上移；失败会停留在当前卡。</span>
        <button class="copy-button" type="button" data-writer-export ${completedExportRowsReady() ? "" : "disabled"}>导出已入库 ${savedCount} 张</button>
      </footer>
      <p class="writer-wheel-export-status" data-writer-export-status role="status" aria-live="polite">${escapeHtml(elements.exportWorkbookStatus?.textContent || "")}</p>
    </section>
  `;
  updateExportWorkbookControls();
}

/**
 * Full-batch navigation over a bounded render window. COS-50.
 *
 * The rail lists every card index, not just the visible eight, because the
 * complaint this answers is that cards 9-20 were not DISCOVERABLE -- an
 * operator could not tell they had been accepted at all. The rail entries are
 * one small button each, which is cheap; what stays bounded is the eight
 * rendered CARDS, which is the expensive part and the reason the window exists.
 *
 * Every entry is selectable regardless of state. A card that is still
 * recognising shows that when opened, which is information; refusing to open it
 * is the behaviour being repaired.
 */
function batchNavigationHtml(window, assets) {
  if (!window.total) return "";
  const rail = assets.map((asset) => {
    const active = asset.index >= window.from && asset.index <= window.to
      && window.visible.some((visible) => visible.index === asset.index);
    return `<button type="button" class="batch-rail-item${active ? " is-visible" : ""}"
      data-batch-focus="${asset.index}"
      aria-current="${active ? "true" : "false"}"
      title="${escapeHtml(`卡片 ${asset.index} · ${writerAssetStatusLabel(asset)}`)}"
    >${asset.index}</button>`;
  }).join("");
  return `
    <nav class="batch-navigation" aria-label="全批导航">
      <div class="batch-navigation-summary">
        <strong>正在显示 ${window.from}–${window.to} / 共 ${window.total} 张</strong>
        <span>第 ${window.page} / ${window.pages} 页</span>
      </div>
      <div class="batch-navigation-controls">
        <button type="button" data-batch-window="previous" ${window.hasPrevious ? "" : "disabled"} aria-label="上一组卡片">上一组</button>
        <button type="button" data-batch-window="next" ${window.hasNext ? "" : "disabled"} aria-label="下一组卡片">下一组</button>
      </div>
      <div class="batch-rail" role="group" aria-label="直接选择卡片">${rail}</div>
    </nav>
  `;
}

function renderAssetRows() {
  if (!state.assets.length) return;
  if (writerModeActive()) {
    renderWriterWheel();
    return;
  }

  // COS-50: the render stays bounded at eight cards; what changed is that the
  // window can MOVE. One constant used to decide both how much DOM is live and
  // which cards the operator may reach, so a 20-card batch showed `8 / 8` and
  // cards 9-20 could not be opened until earlier ones were saved.
  const outstanding = writerOutstandingAssets().sort((left, right) => left.index - right.index);
  const reviewWindow = batchReviewWindow(outstanding, {
    start: state.reviewWindowStart,
    focusIndex: state.reviewFocusIndex
  });
  state.reviewWindowStart = reviewWindow.start;
  const visibleAssets = reviewWindow.visible;
  if (!visibleAssets.length) {
    elements.assetPreviewList.innerHTML = `<div class="empty-state"><strong>本批卡片已全部确认</strong><p>可以导出已入库标题，或开始下一批。</p></div>`;
    return;
  }
  const navigation = batchNavigationHtml(reviewWindow, outstanding);
  const hasAnyResult = state.results.length > 0;
  if (!hasAnyResult) {
    elements.assetPreviewList.innerHTML = navigation + visibleAssets.map(assetRowHtml).join("");
    return;
  }

  const groups = [
    {
      key: "quick",
      label: "优先检查",
      assets: visibleAssets.filter((asset) => modelQuickApprovalCandidate(resultForAsset(asset)))
    },
    {
      key: "review",
      label: "需要确认",
      assets: visibleAssets.filter((asset) => {
        const result = resultForAsset(asset);
        if (!result || modelQuickApprovalCandidate(result)) return false;
        const gate = result.publication_gate || {};
        return gate.writer_review_ready === true;
      })
    },
    {
      key: "manual",
      label: "需要处理",
      assets: visibleAssets.filter((asset) => {
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
      <article class="asset-row-card" data-asset-index="${asset.index}" data-asset-row="${asset.index}" data-card-transition-index="${asset.index}">
        <div class="asset-source">
          <div class="preview-images ${asset.images.length === 1 ? "single" : ""}">
            ${asset.images.map((image, imageIndex) => `
              <button class="thumb-button" type="button" data-preview-asset="${asset.index}" data-preview-image="${imageIndex}" aria-label="打开卡片图片预览">
                <img class="thumb" src="${escapeHtml(imagePreviewUrl(image))}" alt="${escapeHtml(image.name)}" loading="lazy" decoding="async">
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
      : "图片上传后会自动识别，并在这里显示进度与最终标题。";
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
  if (/csm_persistence_not_ready|csm_persistence_failed|csm_persistence_incomplete/i.test(text)) {
    return "识别结果暂时无法安全入库，请稍后重试。";
  }
  return text || "识别未返回可用标题。";
}

function failureAdviceHtml(reason = "") {
  return escapeHtml(friendlyErrorSummary(reason));
}

function resultBox(result, asset = null) {
  return TitleCardComponent(result, asset);
}

function retryStateForResult(result = {}) {
  const confidence = normalizeConfidence(result.confidence);
  const hasVisibleTitle = Boolean(finalTitleForResult(result));
  const requestFailed = confidence === "FAILED"
    || (!hasVisibleTitle && Array.isArray(result.unresolved) && result.unresolved.includes("request"));
  const retryable = requestFailed && result.retryable !== false;
  const submitting = result.retryStatus === "submitting";
  const persistenceLocked = result.feedbackStatus === "saving" || writerFeedbackPersisted(result);
  const inputRebindRequired = String(
    result.recoveryAction
    || result.recovery_action
    || result.retry?.recovery_action
    || result.error?.recovery_action
    || ""
  ).trim().toUpperCase() === "INPUT_REBIND";
  return {
    retryable,
    submitting,
    disabled: !retryable || submitting || persistenceLocked,
    terminal_failure: requestFailed,
    terminal_without_title: requestFailed && !hasVisibleTitle,
    input_rebind_required: inputRebindRequired,
    recovery_mode: inputRebindRequired ? "INPUT_REBIND" : "CSM_DIRECT_RETRY"
  };
}

function TitleCardComponent(result, asset = null) {
  const confidence = normalizeConfidence(result.confidence);
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
  const generatedTitle = result.generatedTitle || result.final_title || result.title || "";
  const correctedTitle = result.correctedTitle ?? generatedTitle;
  const writerReviewWithoutDraft = result.writerReviewRequired === true && !String(correctedTitle || "").trim();
  const feedbackCommitted = writerFeedbackPersisted(result);
  const retryState = retryStateForResult(result);
  const failed = confidence === "FAILED" || retryState.terminal_failure;
  const displayConfidence = failed ? "FAILED" : confidence;
  const retrySubmitting = retryState.submitting;
  const interactionLocked = workspaceInteractionLocked();
  const hasPersistedSession = Boolean(String(result.recognition_session_id || "").trim());
  // COS-51: a failed card has a durable asset but never a recognition session,
  // and requiring the session here is what disabled Save and Reject on exactly
  // the cards that needed them. The durable asset is enough to persist the
  // operator's decision -- it is the identity the manual-recovery ledger is
  // keyed on.
  const hasDurableAsset = Boolean(String(result.asset_id || "").trim());
  const canPersistDecision = hasPersistedSession || hasDurableAsset;
  const copyDisabled = !correctedTitle;
  const saveDisabled = !canPersistDecision
    || interactionLocked
    || retrySubmitting
    || result.feedbackStatus === "saving"
    || feedbackCommitted;
  const editorDisabled = interactionLocked || retrySubmitting || result.feedbackStatus === "saving";
  const rejectDisabled = saveDisabled;
  const retryLabel = retrySubmitting
    ? "正在重新识别…"
    : retryState.input_rebind_required
      ? "重新绑定图片"
      : "重新识别";
  const titleEdited = String(correctedTitle || "").trim()
    && String(correctedTitle || "").trim() !== String(generatedTitle || "").trim();
  const saveLabel = {
    saved: "已保存",
    skipped: feedbackCommitted ? "已记录拒绝" : "未留存",
    saving: "保存中…"
  }[result.feedbackStatus] || (titleEdited ? "保存编辑" : "接受");
  const statusLabel = failed
    ? "失败"
    : writerReviewWithoutDraft
      ? "需人工输入"
      : ["MEDIUM", "LOW"].includes(confidence) || unresolved.length
        ? "需确认"
        : "已生成";
  const unavailableTitle = writerReviewWithoutDraft
    ? "证据不足，系统未猜测；请直接输入最终英文标题"
    : failed
      ? `标题暂不可用：${friendlyErrorSummary(result.reason)}`
      : "标题暂不可用";
  const textareaValue = writerReviewWithoutDraft || (failed && !correctedTitle)
    ? ""
    : (correctedTitle || unavailableTitle);
  const omissionNotice = writerTitleOmissionNotice(result);

  return `
    <div class="title-output ${confidenceClass(displayConfidence)}" data-testid="writer-title-result" data-result-index="${result.index}">
      <div class="title-output-head">
        <span class="confidence-badge ${confidenceClass(displayConfidence)}">${escapeHtml(statusLabel)}</span>
        <div class="title-actions">
          ${generationTimingBadge(result.index)}
          ${retryState.retryable ? `<button class="copy-button retry-priority-button" type="button" data-retry-recognition="${result.index}" ${retryState.disabled ? "disabled" : ""}>${retryLabel}</button>` : ""}
          <button class="copy-button" type="button" data-copy-result="${result.index}" ${copyDisabled ? "disabled" : ""}>复制</button>
          <button class="copy-button" type="button" data-testid="accept-writer-title" data-save-title="${result.index}" ${saveDisabled ? "disabled" : ""}>${saveLabel}</button>
          <button class="copy-button reject-button" type="button" data-reject-title="${result.index}" ${rejectDisabled ? "disabled" : ""}>拒绝</button>
        </div>
      </div>
      <textarea rows="1" maxlength="80" spellcheck="false" aria-label="卡片 ${result.index} 最终英文标题" data-testid="writer-title-input" data-title-input="${result.index}" placeholder="${escapeHtml(unavailableTitle)}" ${editorDisabled ? "disabled" : ""}>${escapeHtml(textareaValue)}</textarea>
      ${omissionNotice ? `<p class="title-omission-notice">${escapeHtml(omissionNotice)}</p>` : ""}
      ${titleOverrideNotice(result)}
      ${failed || result.reason ? `<p class="follow-up-advice">${failureAdviceHtml(result.reason || "")}</p>` : ""}
      ${result.feedbackMessage ? `<p class="feedback-save-status" data-testid="writer-persistence-status" role="status" aria-live="polite">${escapeHtml(result.feedbackMessage)}</p>` : ""}
      ${result.csmResolutionView ? renderCsmGlassBox(result.csmResolutionView, { assetIndex: result.index }) : ""}
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
  elements.imageModalImage.src = imagePreviewUrl(image);
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

function writerTitleOmissionNotice(result = {}) {
  const policy = result.title_length_policy
    || result.provider_result?.title_length_policy
    || result.provider_result_summary?.title_length_policy
    || {};
  const removed = [...new Set((Array.isArray(policy.removed_terms) ? policy.removed_terms : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!removed.length) return "";
  const visible = removed.slice(0, 3);
  const suffix = removed.length > visible.length ? ` 等 ${removed.length} 项` : "";
  return `已识别但因 80 字符限制省略：${visible.join(" · ")}${suffix}`;
}

function requestRecognitionContinuation({
  lifecycleGeneration = state.assetLifecycleGeneration,
  filePreparationRunId = state.filePreparationRunId
} = {}) {
  queueMicrotask(() => {
    if (
      lifecycleGeneration !== state.assetLifecycleGeneration
      || filePreparationRunId !== state.filePreparationRunId
      || !canStartRecognitionRun()
    ) return;
    void processTitles();
  });
}

async function handleFiles(
  fileList,
  { animateIntake = false } = {},
  { prepareFileForIntake: prepareFile = prepareFileForIntake } = {}
) {
  if (destructiveWorkspaceInteractionLocked()) {
    setStatus(state.exportingWorkbook
        ? "Excel 正在生成，请等待导出完成后再更换图片。"
        : state.preparingFiles
          ? "图片正在准备，请等待当前选择完成。"
          : state.retryInFlight
            ? "重新识别正在进行，请等待完成后再更换图片。"
            : "当前卡片正在入库，请等待保存完成后再更换图片。", { busy: true });
    return;
  }

  const candidates = [...fileList];
  const imageFiles = candidates.filter(isSupportedImageFile);
  if (!imageFiles.length) return;

  const batchWasEmpty = state.assets.length === 0;
  // The batch clock starts HERE -- the moment the writer's files arrive -- not
  // when the first card object appears. Decoding and preparing the selection
  // happens in between, and the writer is waiting through it; a clock that
  // starts after it reports a number smaller than the wait it claims to
  // describe.
  if (!state.batchStartedAt) state.batchStartedAt = Date.now();
  state.batchFinishedAt = 0;
  // A lifecycle represents the whole visible workspace, not one file-picker
  // selection. Additional selections inherit the original recognition intent.
  const lifecycleGeneration = batchWasEmpty
    ? ++state.assetLifecycleGeneration
    : state.assetLifecycleGeneration;
  const filePreparationRunId = state.filePreparationRunId + 1;
  const firstAssetIndex = state.assets.reduce((max, asset) => Math.max(max, Number(asset.index) || 0), 0) + 1;
  const intakePreviewRecords = createIntakePreviewRecords(imageFiles);
  let initialWriterForwardReady = null;
  state.filePreparationRunId = filePreparationRunId;
  state.preparingFiles = true;
  releaseIntakePreviewRecords();
  state.intakePreviewRecords = intakePreviewRecords;
  renderInstantIntakePreviews(intakePreviewRecords);

  try {
    setStatus(batchWasEmpty
      ? "本地预览已显示；正在校验原图，随后自动上传并识别…"
      : `已追加 ${imageFiles.length} 张图片；正在校验原图并延续当前识别任务…`, { busy: true });
    closeImageModal();
    if (batchWasEmpty) {
      state.workspaceMode = "writer";
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
    }

    const failures = [];
    const prepareStartedAt = performance.now();
    const groupSize = state.mode === "single" ? 1 : 2;
    const fileGroups = [];
    for (let index = 0; index < imageFiles.length; index += groupSize) {
      fileGroups.push({ index: firstAssetIndex + Math.floor(index / groupSize), files: imageFiles.slice(index, index + groupSize) });
    }
    const backgroundRunId = batchWasEmpty
      ? beginBackgroundPreparationRun()
      : state.backgroundPreparationRunId || beginBackgroundPreparationRun();
    const groupPreparationConcurrency = state.mode === "single"
      ? IMAGE_PREPROCESS_CONCURRENCY
      : Math.max(1, Math.floor(IMAGE_PREPROCESS_CONCURRENCY / 2));
    await mapWithConcurrency(fileGroups, groupPreparationConcurrency, async (group) => {
      const outcomes = await Promise.all(group.files.map(async (file) => {
        try {
          return { image: await prepareFile(file) };
        } catch (error) {
          return { failure: `${file.name}: ${error.message}` };
        }
      }));
      const images = outcomes.flatMap((item) => item.image ? [item.image] : []);
      outcomes.forEach((item) => {
        if (item.failure) failures.push(item.failure);
      });
      if (
        lifecycleGeneration !== state.assetLifecycleGeneration
        || state.filePreparationRunId !== filePreparationRunId
        || backgroundRunId !== state.backgroundPreparationRunId
      ) {
        releaseImagePreviewUrls(images);
        return null;
      }
      if (!images.length) return null;

      // A card starts uploading as soon as its own image group is readable.
      // Slow files later in the batch no longer hold earlier cards at a
      // whole-batch barrier.
      const asset = createClientAsset(images, group.index);
      state.assets.push(asset);
      state.assets.sort((left, right) => left.index - right.index);
      state.files = state.assets.flatMap((entry) => entry.images);
      scheduleAssetBackgroundPreparation(asset, backgroundRunId);
      if (state.processing) state.processingTotal = state.assets.length;
      syncProcessButtonState();
      syncBackgroundPreparationStatus();
      requestRecognitionContinuation({ lifecycleGeneration, filePreparationRunId });
      return asset;
    });
    const prepareElapsedMs = Math.round(performance.now() - prepareStartedAt);
    if (
      lifecycleGeneration !== state.assetLifecycleGeneration
      || state.filePreparationRunId !== filePreparationRunId
    ) {
      releaseImagePreviewUrls(state.files);
      releaseIntakePreviewRecords(intakePreviewRecords);
      return;
    }
    const ignoredFiles = candidates
      .filter((file) => !isSupportedImageFile(file))
      .map((file) => `${file.name}: 不支持的图片格式`);
    const images = state.files;
    state.clientImagePrepareMs = prepareElapsedMs;

    if (failures.length || ignoredFiles.length) {
      setStatus(`${images.length} 张图片已准备，${failures.length + ignoredFiles.length} 张未读取：${[...failures, ...ignoredFiles].join("；")}`);
    } else {
      const previewOptimizedCount = images.filter((image) => image.originalSize && image.size < image.originalSize).length;
      setStatus(previewOptimizedCount
        ? `${images.length} 张图片已读取，正在自动上传原图并识别；本地预览已优化。`
        : `${images.length} 张图片已读取，正在自动上传原图并识别。`, { busy: true });
    }

    const intakeTransition = runWorkbenchViewTransition({
      kind: "intake",
      enabled: animateIntake && batchWasEmpty && images.length > 0,
      update: () => {
        releaseIntakePreviewRecords(intakePreviewRecords);
        renderPreviews({ rebuildAssets: false });
        renderResults();
      }
    });
    if (intakeTransition?.finished) initialWriterForwardReady = Promise.resolve(intakeTransition.finished).catch(() => {});
    if (intakeTransition?.updateCallbackDone) await Promise.resolve(intakeTransition.updateCallbackDone).catch(() => {});
    if (lifecycleGeneration !== state.assetLifecycleGeneration) return;
  } finally {
    if (
      lifecycleGeneration === state.assetLifecycleGeneration
      && state.filePreparationRunId === filePreparationRunId
    ) {
      state.preparingFiles = false;
      if (state.intakePreviewRecords === intakePreviewRecords) {
        releaseIntakePreviewRecords(intakePreviewRecords);
        renderPreviews({ rebuildAssets: false });
      }
      renderResults({ forceWriterRender: true });
      syncBackgroundPreparationStatus();
      if (state.assets.length) {
        // Selecting card images is the recognition intent. Asset-ready calls
        // start the pool progressively; this batch-end call is the fail-safe.
        requestRecognitionContinuation({ lifecycleGeneration, filePreparationRunId });
      }
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

function failedResult(asset, error, intentId = state.backgroundRecognitionBatchId) {
  return attachGenerationTimingToResult({
    index: asset.index,
    lifecycleGeneration: asset.lifecycleGeneration,
    asset_id: asset.durableAssetId || "",
    client_asset_ref: asset.clientAssetRef || asset.id,
    thumbnail: imagePreviewUrl(asset.images[0]),
    title: "",
    generatedTitle: "",
    correctedTitle: "",
    confidence: "FAILED",
    reason: error.message,
    recoveryAction: String(error?.recovery_action || error?.recoveryAction || "").trim().toUpperCase(),
    error_code: String(error?.code || error?.error_code || "").trim(),
    retryable: error?.retryable !== false,
    fields: {},
    unresolved: ["request"],
    provider: "gpt-5.6-luna",
    provider_label: "Luna 5.6",
    csm_intent_id: String(intentId || "")
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
  if (!canStartRecognitionRun()) return;
  const lifecycleGeneration = state.assetLifecycleGeneration;

  state.processing = true;
  state.activeAssetIndexes = new Set();
  const completedAssetIndexes = new Set(state.results.map((result) => Number(result.index)));
  state.completedAssetCount = completedAssetIndexes.size;
  state.processingTotal = state.assets.length;
  const generationQueuedAt = Date.now();
  renderResults();
  elements.processButton.disabled = true;
  setProcessButtonBusy(true);
  setStatus("图片已上传，正在自动识别卡片名称。", { busy: true });

  const recognitionBatchId = state.backgroundRecognitionBatchId || createClientBatchId();
  state.backgroundRecognitionBatchId = recognitionBatchId;
  // Each browser uses a small bounded request pool. The server-side durable
  // authority independently owns global provider capacity across tenants.
  const workerCount = directRecognitionConcurrencyLimit();
  const claimedAssetIndexes = new Set(completedAssetIndexes);
  let completedCount = completedAssetIndexes.size;

  async function worker() {
    while (true) {
      const asset = claimNextBatchAsset(state.assets, claimedAssetIndexes);
      if (!asset) {
        if (state.preparingFiles) {
          await wait(50);
          continue;
        }
        return;
      }
      state.processingTotal = state.assets.length;
      markAssetQueued(asset, generationQueuedAt);
      state.activeAssetIndexes.add(asset.index);
      setAssetProgress(asset.index, "准备直接识别", 0.03);

      try {
        const result = await processAssetViaCsmThinPath(asset, { intentId: recognitionBatchId });
        if (lifecycleGeneration !== state.assetLifecycleGeneration) return;
        markAssetFinished(asset.index, { failed: normalizeConfidence(result.confidence) === "FAILED" });
        clearAssetProgress(asset.index);
        attachGenerationTimingToResult(result);
        state.results.push(result);
        state.results.sort((a, b) => a.index - b.index);
      } catch (error) {
        if (lifecycleGeneration !== state.assetLifecycleGeneration) return;
        markAssetFinished(asset.index, { failed: true });
        clearAssetProgress(asset.index);
        state.results.push(failedResult(asset, error, recognitionBatchId));
      }

      state.activeAssetIndexes.delete(asset.index);
      completedCount += 1;
      state.completedAssetCount = completedCount;
      state.results.sort((a, b) => a.index - b.index);
      renderResultControls();
      if (!renderAssetRowInPlace(asset)) renderResults();
      setStatus(processingProgressStatus(completedCount), { busy: completedCount < state.assets.length });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  if (lifecycleGeneration !== state.assetLifecycleGeneration) return;
  state.processing = false;
  state.activeAssetIndexes = new Set();
  state.assetProgress.clear();
  stopProgressTicker();
  state.completedAssetCount = 0;
  state.processingTotal = 0;
  renderResults();

  syncProcessButtonState();
  if (hasAssetsAwaitingRecognition()) {
    requestRecognitionContinuation({ lifecycleGeneration });
  } else {
    setStatus(processingCompletionStatus());
  }
}

function successorClientAssetRef(asset = {}) {
  const base = String(asset.clientAssetRef || asset.id || `asset-${asset.index || 0}`)
    .replace(/:rebind:[^:]+$/i, "")
    .slice(0, 110);
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  return `${base}:rebind:${suffix}`.slice(0, 160);
}

function resetAssetPreparationForRetry(asset = {}, { inputRebind = false } = {}) {
  asset.backgroundPrepareError = "";

  if (inputRebind) {
    const previousAssetId = String(asset.durableAssetId || "").trim();
    asset.rebindOfAssetId = previousAssetId;
    asset.clientAssetRef = successorClientAssetRef(asset);
    asset.durableAssetId = "";
    asset.durableTenantId = "";
    asset.imageGenerationId = "";
    asset.expectedOriginalCount = null;
    asset.durableAssetPromise = null;
    asset.assetCreateIdempotencyKey = "";
    asset.originalStorageUploadPromise = null;
    asset.backgroundPreparationPromise = null;
    asset.backgroundPreparationRunId = null;
    asset.backgroundPreparationScheduledRunId = null;
    asset.backgroundPrepareStatus = "queued";
    for (const image of asset.images || []) clearImageStorageBinding(image);
    for (const image of asset.providerImages || []) clearImageStorageBinding(image);
    return;
  }

  const assetId = String(asset.durableAssetId || "").trim();
  const tenantId = String(asset.durableTenantId || "").trim();
  const originalsVerified = Boolean(assetId && tenantId)
    && (asset.images || []).every((image) => imageHasVerifiedStorageReference(image, assetId, tenantId));
  if (!originalsVerified) {
    asset.originalStorageUploadPromise = null;
    asset.backgroundPreparationPromise = null;
    asset.backgroundPreparationScheduledRunId = null;
    asset.backgroundPrepareStatus = "queued";
  }
}

function retryFailedAsset(button) {
  const assetIndex = Number(button.dataset.retryRecognition);
  const asset = state.assets.find((item) => item.index === assetIndex);
  const current = state.results.find((item) => item.index === assetIndex);
  const retryState = retryStateForResult(current || {});
  if (!asset || !current || retryState.disabled) return Promise.resolve();

  // COS-51: disable the clicked control synchronously, before anything can
  // yield. A rerender is not a guard -- it happens on a later turn, and the
  // second half of a double-click arrives before it.
  button.disabled = true;
  button.setAttribute("aria-busy", "true");

  // Collapse onto the running attempt rather than starting a second one. The
  // operator asked for the result, so they get the result; rejecting would show
  // an error for an action that is in fact underway.
  const claim = claimAssetSingleFlight("retry", canonicalAssetId(asset) || assetIndex,
    () => runAssetRetry({ button, asset, current, retryState, assetIndex }));
  return claim.promise;
}

async function runAssetRetry({ asset, current, retryState, assetIndex }) {
  const retrySubmissionId = nextRetrySubmissionId(canonicalAssetId(asset) || assetIndex);
  const lifecycleGeneration = state.assetLifecycleGeneration;
  const writerEditedTitle = String(current.correctedTitle || "").trim();
  const intentId = String(current.csm_intent_id || state.backgroundRecognitionBatchId || createClientBatchId());
  state.backgroundRecognitionBatchId = intentId;
  state.retryInFlight += 1;
  current.retryStatus = "submitting";
  current.feedbackMessage = "正在重新识别…";
  setStatus(`卡片 ${asset.index} 正在通过 CSM 薄链路重新识别…`, { busy: true });
  state.assetGenerationTimings.delete(asset.index);
  markAssetQueued(asset, Date.now());
  renderResults();

  try {
    resetAssetPreparationForRetry(asset, {
      inputRebind: retryState.input_rebind_required
    });
    const result = await processAssetViaCsmThinPath(asset, {
      intentId,
      manualRetry: true,
      // COS-51: one stable key per operator retry action, so the server can be
      // idempotent for the same tenant + asset + image + intent + submission.
      retrySubmissionId
    });
    if (!assetLifecycleMatches(asset, lifecycleGeneration)) return;
    markAssetFinished(asset.index);
    if (writerEditedTitle) {
      result.correctedTitle = writerEditedTitle;
      result.title_override = {
        source: "writer_edit_before_retry",
        value: writerEditedTitle
      };
    }
    result.retryStatus = "";
    result.feedbackMessage = retryState.input_rebind_required
      ? "图片已绑定到新的不可变资产，并完成重新识别。"
      : "已通过 CSM 薄链路重新识别。";
    state.results = state.results.filter((item) => item.index !== asset.index);
    state.results.push(result);
    state.results.sort((a, b) => a.index - b.index);
    setStatus(`卡片 ${asset.index} 已完成 CSM 薄链路重识别。`);
  } catch (error) {
    if (!assetLifecycleMatches(asset, lifecycleGeneration)) return;
    markAssetFinished(asset.index, { failed: true });
    clearAssetProgress(asset.index);
    current.retryStatus = "";
    current.recoveryAction = String(error?.recovery_action || current.recoveryAction || "")
      .trim()
      .toUpperCase();
    current.error_code = String(error?.code || current.error_code || "").trim();
    current.retryable = error?.retryable !== false;
    current.feedbackMessage = `重新识别失败：${error.message || "请再次重试"}`;
    setStatus(`卡片 ${asset.index} 重新识别失败。`);
  } finally {
    state.retryInFlight = Math.max(0, state.retryInFlight - 1);
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

  const wasCommitted = writerFeedbackPersisted(result);
  result.correctedTitle = input.value;
  const renderedTitle = String(result.rendered_title || result.final_title || result.generatedTitle || result.title || "").trim();
  const correctedTitle = String(input.value || "").trim();
  result.title_override = correctedTitle && renderedTitle && correctedTitle !== renderedTitle ? correctedTitle : null;
  result.explicitReviewOutcome = "";
  result.feedbackStatus = "";
  result.persistenceStatus = "";
  result.feedbackMessage = "";
  if (wasCommitted) {
    const saveButton = input.closest(".title-output")?.querySelector("[data-save-title]");
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "保存编辑";
    }
  }
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

function finalTitleForResult(result) {
  return String(result.correctedTitle ?? result.final_title ?? result.rendered_title ?? result.title ?? "").trim();
}

function feedbackActionForResult(result, generatedTitle, correctedTitle) {
  if (result.explicitReviewOutcome === "REJECTED") return "REJECT";
  return String(generatedTitle || "").trim() === String(correctedTitle || "").trim() ? "ACCEPT" : "EDIT";
}

function clientFeedbackSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function pendingFeedbackSubmission(result, { action, writerTitle } = {}) {
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

function clearPendingFeedbackSubmission(result, submission = {}) {
  if (!result || result.pendingFeedbackSubmissionId !== submission.id) return;
  delete result.pendingFeedbackSubmissionId;
  delete result.pendingFeedbackSubmissionSignature;
  delete result.pendingFeedbackOccurredAt;
}

/**
 * Persist manual work for a card whose recognition failed. COS-51.
 *
 * Returns true only after the record is durably acknowledged, because the
 * caller advances the writer queue on that answer. Acknowledging an unwritten
 * record would cost the operator both the card and the title they typed.
 */
async function saveManualRecoveryForResult(result, asset, { deferFinalRender = false } = {}) {
  const assetId = canonicalAssetId(asset) || String(result.asset_id || "").trim();
  const rejected = result.explicitReviewOutcome === "REJECTED";
  const manualTitle = String(result.correctedTitle ?? result.final_title ?? result.title ?? "").trim();

  if (!assetId || (!rejected && !manualTitle)) {
    result.feedbackStatus = "";
    result.persistenceStatus = "failed";
    result.feedbackMessage = assetId
      ? "请先填写人工标题，或选择拒绝并继续。"
      : "该卡尚未建立持久资产，无法保存。";
    if (!deferFinalRender) renderResults();
    return false;
  }

  result.feedbackStatus = "saving";
  result.persistenceStatus = "saving";
  if (!deferFinalRender) renderResults();

  try {
    const request = await fetchJsonWithRetry("/api/listing-manual-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        asset_id: assetId,
        client_asset_ref: asset?.clientAssetRef || asset?.id || result.client_asset_ref || "",
        manual_title: rejected ? "" : manualTitle,
        source: rejected ? "REJECTED_AFTER_RECOGNITION_FAILURE" : "MANUAL_AFTER_RECOGNITION_FAILURE",
        failure_code: String(result.error_code || "").trim(),
        failure_stage: String(result.failure_stage || "recognition").trim()
      })
    }, { timeoutMs: 20000, maxAttempts: 2, asset, stage: "manual_recovery" });

    if (request.error || request.payload?.ok !== true) {
      throw new Error(request.payload?.error || `保存失败：${request.response?.status || "network"}`);
    }
    result.feedbackStatus = "saved";
    result.persistenceStatus = "saved";
    result.manualRecoverySource = request.payload.source;
    // Shown so the operator can tell this card apart from an AI-reviewed one.
    // A workaround that looks identical to a good result is how a batch is
    // signed off without anyone noticing what happened.
    result.feedbackMessage = rejected
      ? "已记录「识别失败后拒绝」，可继续下一张。"
      : "已记录「识别失败后人工标题」（不进入训练，不作为语义真值）。";
    return true;
  } catch (error) {
    result.feedbackStatus = "";
    result.persistenceStatus = "failed";
    result.feedbackMessage = `保存人工标题失败：${error.message || "请重试"}`;
    return false;
  } finally {
    if (!deferFinalRender) renderResults();
  }
}

async function saveFeedbackForResult(result, asset, { deferFinalRender = false } = {}) {
  if (!result) return false;

  const sessionId = String(result.recognition_session_id || "").trim();
  if (!sessionId) {
    // COS-51. This used to be a dead end: no session meant no persistence, and
    // a failed recognition can never produce one. The operator could type a
    // complete title and had nowhere to put it, so the card could not advance
    // and neither could the rest of the batch.
    //
    // Manual work after a failure is not AI feedback -- there is no generated
    // title to compare it against -- so it goes to its own durable ledger,
    // marked never-training and never-semantic-truth. What matters to the
    // writer is only that the transaction is acknowledged and the queue moves.
    return saveManualRecoveryForResult(result, asset, { deferFinalRender });
  }

  const generatedTitle = String(result.generatedTitle || result.title || "").trim();
  const correctedTitle = String(
    result.correctedTitle
    ?? result.final_title
    ?? result.rendered_title
    ?? result.title
    ?? ""
  ).trim();
  const explicitReject = result.explicitReviewOutcome === "REJECTED";
  if ((!correctedTitle && !explicitReject) || (!generatedTitle && !explicitReject)) return false;

  const action = feedbackActionForResult(result, generatedTitle, correctedTitle);
  const submission = pendingFeedbackSubmission(result, {
    action,
    writerTitle: correctedTitle
  });

  result.feedbackStatus = "saving";
  result.persistenceStatus = "saving";
  result.feedbackMessage = "正在保存审核记录…";
  renderResults();

  try {
    const feedbackRequest = await fetchJsonWithRetry(FEEDBACK_API_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        recognition_session_id: sessionId,
        feedback_submission_id: submission.id,
        client_occurred_at: submission.occurredAt,
        action,
        writer_final_title: correctedTitle
      })
    }, {
      timeoutMs: FEEDBACK_REQUEST_TIMEOUT_MS,
      maxAttempts: 3,
      retryNetworkErrors: true,
      asset,
      stage: "feedback_save"
    });

    const response = feedbackRequest.response;
    const payload = feedbackRequest.payload;
    if (feedbackRequest.error) {
      throw new Error(payload.message || `保存失败：${response.status}`);
    }
    if (payload.v4_persistence?.transaction?.saved !== true) {
      throw new Error("审核事务尚未确认入库，请重试。");
    }

    clearPendingFeedbackSubmission(result, submission);
    const canonicalWriterTitle = String(payload.writer_final_title || "").trim();
    if (canonicalWriterTitle) {
      result.correctedTitle = canonicalWriterTitle;
      result.final_title = canonicalWriterTitle;
      result.rendered_title = canonicalWriterTitle;
      result.title = canonicalWriterTitle;
      result.title_override = null;
    }
    result.csmNormalization = payload.csm_normalization || null;
    const rejected = action === "REJECT" || String(payload.status || "").toUpperCase() === "REJECTED";
    result.feedbackStatus = rejected ? "skipped" : "saved";
    result.persistenceStatus = "persisted";
    result.trainingEligibility = payload.training_eligible === true ? "eligible" : "ineligible";
    result.feedbackSubmissionId = payload.feedback_submission_id || submission.id;
    result.review_id = payload.feedback_event_id || "";
    result.approved_at = "";
    result.approved_by = "";
    result.review_outcome = payload.status || "";
    result.feedbackMessage = rejected
      ? "已记录拒绝反馈；事务已入库，不进入正样本训练。"
      : payload.csm_normalization?.applied === true
        ? `写手反馈已保存，标题已按 CSM 标准顺序整理：${payload.learning_event_id || "已写入"}。`
        : payload.training_eligible === false
          ? "写手反馈已入库；当前处于观察期，不自动进入训练集。"
          : `写手反馈已保存，并生成学习事件：${payload.learning_event_id || "已写入"}。`;
    return true;
  } catch (error) {
    result.feedbackStatus = "";
    result.persistenceStatus = "failed";
    result.feedbackMessage = error.message || "审核记录保存失败。";
    return false;
  } finally {
    if (!deferFinalRender) renderResults();
  }
}

async function saveTitleFeedback(button, { animate = true } = {}) {
  const result = state.results.find((item) => item.index === Number(button.dataset.saveTitle));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.saveTitle));
  const beforeIndexes = visibleOutstandingAssetIndexes();
  const persisted = await saveFeedbackForResult(result, asset, { deferFinalRender: true });
  if (persisted) renderQueueAdvance(beforeIndexes, { animate });
  else renderResults();
  return persisted;
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

async function saveWriterTitleAndAdvance(resultIndex, { animate = true } = {}) {
  if (workspaceInteractionLocked()) return false;
  const index = Number(resultIndex);
  const result = state.results.find((item) => item.index === index);
  const asset = state.assets.find((item) => item.index === index);
  if (!result || !asset) return false;
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
  const beforeIndexes = visibleOutstandingAssetIndexes();
  let persisted = false;
  try {
    persisted = await saveFeedbackForResult(result, asset, { deferFinalRender: true });
    if (!persisted) return false;
    advanceWriterAfterPersistence(index);
    return true;
  } finally {
    state.writerSaveInFlight = false;
    if (!persisted) state.writerFocusPending = true;
    if (persisted) renderQueueAdvance(beforeIndexes, { animate });
    else renderResults({ forceWriterRender: true });
  }
}

async function rejectWriterTitleAndAdvance(resultIndex, { animate = true } = {}) {
  if (workspaceInteractionLocked()) return false;
  const index = Number(resultIndex);
  const result = state.results.find((item) => item.index === index);
  const asset = state.assets.find((item) => item.index === index);
  if (!result || !asset) return false;
  if (writerFeedbackPersisted(result)) {
    advanceWriterAfterPersistence(index);
    renderResults({ forceWriterRender: true });
    return true;
  }

  state.writerSaveInFlight = true;
  const beforeIndexes = visibleOutstandingAssetIndexes();
  result.explicitReviewOutcome = "REJECTED";
  result.feedbackStatus = "";
  result.persistenceStatus = "";
  result.feedbackMessage = "已标记为拒绝，正在写入训练负例…";
  let persisted = false;
  try {
    persisted = await saveFeedbackForResult(result, asset, { deferFinalRender: true });
    if (!persisted) return false;
    advanceWriterAfterPersistence(index);
    return true;
  } finally {
    state.writerSaveInFlight = false;
    if (!persisted) state.writerFocusPending = true;
    if (persisted) renderQueueAdvance(beforeIndexes, { animate });
    else renderResults({ forceWriterRender: true });
  }
}

async function rejectTitleFeedback(button, { animate = true } = {}) {
  const result = state.results.find((item) => item.index === Number(button.dataset.rejectTitle));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.rejectTitle));
  if (!result || writerFeedbackPersisted(result) || result.feedbackStatus === "saving") return false;
  const beforeIndexes = visibleOutstandingAssetIndexes();
  result.explicitReviewOutcome = "REJECTED";
  result.feedbackStatus = "";
  result.persistenceStatus = "";
  result.feedbackMessage = "已标记为拒绝，正在写入训练负例…";
  const persisted = await saveFeedbackForResult(result, asset, { deferFinalRender: true });
  if (persisted) renderQueueAdvance(beforeIndexes, { animate });
  else renderResults();
  return persisted;
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
      await ensureAssetOriginalImagesUploaded(asset);
    });
    const rows = buildWriterExportRows(exportAssets, {
      requireSaved: exportingWriterRows,
      titleSnapshotByIndex
    });
    const exportRequest = await fetchJsonWithRetry(EXPORT_WORKBOOK_API_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ rows })
    }, {
      timeoutMs: EXPORT_REQUEST_TIMEOUT_MS,
      maxAttempts: 1,
      retryNetworkErrors: false,
      stage: "workbook_export"
    });
    const response = exportRequest.response;
    const payload = exportRequest.payload;
    if (exportRequest.error) {
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
  if (destructiveWorkspaceInteractionLocked()) {
    setStatus(state.exportingWorkbook
      ? "Excel 正在生成，请等待导出完成后再清空。"
      : state.preparingFiles
        ? "图片正在准备，请等待完成后再清空。"
        : state.retryInFlight
          ? "重新识别正在进行，请等待完成后再清空。"
          : "当前卡片正在入库，请等待保存完成后再清空。", { busy: true });
    return;
  }
  const hasPendingWork = state.results.some((result) => {
    return finalTitleForResult(result) && !writerFeedbackPersisted(result);
  });
  if (hasPendingWork && typeof globalThis.confirm === "function") {
    const confirmed = globalThis.confirm("仍有生成中或未入库的卡片。确定清空本轮内容吗？");
    if (!confirmed) return;
  }
  state.assetLifecycleGeneration += 1;
  state.backgroundPreparationRunId += 1;
  state.backgroundRecognitionBatchId = "";
  releaseIntakePreviewRecords();
  releaseImagePreviewUrls(state.files);
  state.files = [];
  state.batchStartedAt = 0;
  state.batchFinishedAt = 0;
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
  state.retryInFlight = 0;
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
      if (destructiveWorkspaceInteractionLocked() || state.processing) return;
      state.assetLifecycleGeneration += 1;
      state.backgroundPreparationRunId += 1;
      state.backgroundRecognitionBatchId = "";
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
      if (writerModeActive()) void saveWriterTitleAndAdvance(Number(saveButton.dataset.saveTitle), { animate: true });
      else void saveTitleFeedback(saveButton, { animate: true });
      return;
    }

    const rejectButton = event.target.closest("[data-reject-title]");
    if (rejectButton) {
      if (writerModeActive()) void rejectWriterTitleAndAdvance(Number(rejectButton.dataset.rejectTitle), { animate: true });
      else void rejectTitleFeedback(rejectButton, { animate: true });
      return;
    }

    // COS-50: window controls and direct card selection. Selection sets a focus
    // the window follows, so choosing card 20 opens card 20 rather than merely
    // scrolling a list it is not in.
    const windowButton = event.target.closest("[data-batch-window]");
    if (windowButton) {
      const step = windowButton.dataset.batchWindow === "previous" ? -1 : 1;
      state.reviewWindowStart = Math.max(0, (state.reviewWindowStart || 0) + step * INTAKE_PREVIEW_CARD_WINDOW);
      state.reviewFocusIndex = null;
      renderResults();
      return;
    }
    const railButton = event.target.closest("[data-batch-focus]");
    if (railButton) {
      state.reviewFocusIndex = Number(railButton.dataset.batchFocus);
      renderResults();
      return;
    }

    const retryButton = event.target.closest("[data-retry-recognition]");
    if (retryButton) void retryFailedAsset(retryButton);
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
      void saveWriterTitleAndAdvance(resultIndex, { animate: false });
      return;
    }
    if (saveButton && !saveButton.disabled) {
      void saveTitleFeedback(saveButton, { animate: false }).then((saved) => {
        if (!saved || !Number.isFinite(nextResultIndex)) return;
        elements.assetPreviewList.querySelector(`[data-title-input="${nextResultIndex}"]:not([disabled])`)?.focus();
      });
    } else if (Number.isFinite(nextResultIndex)) {
      elements.assetPreviewList.querySelector(`[data-title-input="${nextResultIndex}"]:not([disabled])`)?.focus();
    }
  });

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
    const pending = state.processing;
    const unsaved = state.results.some((result) => {
      return finalTitleForResult(result) && !writerFeedbackPersisted(result);
    });
    if (!pending && !unsaved) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

bindEvents();
renderProviderControl();
renderPreviews();
renderResults();
