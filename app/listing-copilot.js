import {
  analyzeImageQualityFromImageData,
  defaultCaptureProfileId,
  summarizeAssetImageQuality
} from "../lib/listing/image-quality/quality-gate.mjs";
import { planTargetedCrops } from "../lib/listing/image-quality/crop-planner.mjs";

const apiCostPerRequest = 0.003;
const maxTitleLength = 80;
const MAX_CONCURRENT_WORKERS = 6;
const IMAGE_PREPROCESS_CONCURRENCY = 4;
const IMAGE_MAX_EDGE = 1400;
const IMAGE_MIN_EDGE = 900;
const IMAGE_INITIAL_QUALITY = 0.82;
const IMAGE_MIN_QUALITY = 0.72;
const IMAGE_EMERGENCY_MIN_QUALITY = 0.58;
const TARGET_IMAGE_DATA_URL_CHARS = 1_250_000;
const MAX_ASSET_REQUEST_BYTES = 3_400_000;
const TARGETED_CROP_QUALITY = 0.88;
const supportedImageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const supportedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const heicUnsupportedMessage = "当前浏览器暂不支持 HEIC/HEIF 预览，请先在手机相册中导出为 JPG，或使用微信/系统截图后上传。";

const state = {
  files: [],
  mode: "single",
  assets: [],
  results: [],
  modal: null,
  resolutionMap: {},
  providerStatus: null,
  selectedProvider: ""
};

const elements = {
  imageInput: document.querySelector("#imageInput"),
  dropZone: document.querySelector("#dropZone"),
  processButton: document.querySelector("#processButton"),
  resetButton: document.querySelector("#resetButton"),
  copyAllButton: document.querySelector("#copyAllButton"),
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
    imageQuality
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

function imageHasVerifiedStorageReference(image = {}) {
  return Boolean(image.objectPath && image.storageVerified);
}

function serializableAssetImage(image) {
  const useStorageReference = imageHasVerifiedStorageReference(image);
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
    derived: Boolean(image.derived),
    contentSha256: image.contentSha256 || "",
    objectPath: image.objectPath || "",
    bucket: image.bucket || "",
    storageVerificationToken: image.storageVerificationToken || "",
    storageVerified: Boolean(image.storageVerified),
    storageUploaded: Boolean(image.storageUploaded)
  };
}

function reviewImageReference(image) {
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
    derived: Boolean(image.derived),
    contentSha256: image.contentSha256 || "",
    objectPath: image.objectPath || "",
    bucket: image.bucket || "",
    storageVerified: Boolean(image.storageVerified),
    storageUploaded: Boolean(image.storageUploaded)
  };
}

function buildAssetRequestBody(asset, options = {}) {
  const provider = options.provider || state.selectedProvider;
  const body = {
    assetId: asset.id,
    mode: state.mode,
    maxTitleLength,
    images: (asset.providerImages || asset.images).map(serializableAssetImage),
    captureProfileId: defaultCaptureProfileId,
    captureQuality: summarizeAssetImageQuality(asset.providerImages || asset.images),
    resolutionMap: state.resolutionMap,
    clientTiming: asset.clientTiming || {}
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

  throw new Error(`图片请求体过大，请先裁剪或压缩后重试（约 ${(requestBytes / 1_000_000).toFixed(1)}MB）`);
}

function storageReady() {
  return Boolean(state.providerStatus?.storage?.configured);
}

function storageSourceForImage(image) {
  if (image.sourceFile) return image.sourceFile;
  if (image.sourceBlob) return image.sourceBlob;
  return null;
}

function storageRoleForImage(image, imageIndex) {
  if (image.storageRole) return image.storageRole;
  if (state.mode === "pair") return imageIndex === 0 ? "front_original" : "back_original";
  return "front_original";
}

function storageDimensionsForImage(image) {
  if (image.sourceFile) {
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

async function ensureAssetImagesUploaded(asset) {
  if (!storageReady()) return false;

  let uploadedAny = false;
  const images = asset.providerImages || asset.images;
  for (const [imageIndex, image] of images.entries()) {
    const source = storageSourceForImage(image);
    if (image.objectPath || !source) continue;
    const signatureHex = await fileSignatureHex(source);
    const contentSha256 = image.contentSha256 || await contentSha256Hex(source);
    const dimensions = storageDimensionsForImage(image);
    image.contentSha256 = contentSha256;

    const uploadResponse = await fetch("/api/listing-image-upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        assetId: asset.id,
        imageId: image.id,
        role: storageRoleForImage(image, imageIndex),
        fileName: image.name,
        contentType: image.originalType || source.type || "image/jpeg",
        size: source.size,
        width: dimensions.width,
        height: dimensions.height,
        signatureHex,
        contentSha256
      })
    });

    const uploadPayload = await uploadResponse.json();
    if (!uploadResponse.ok || !uploadPayload.ok) {
      throw new Error(uploadPayload.message || `Storage upload URL failed: ${uploadResponse.status}`);
    }

    const storageResponse = await fetch(uploadPayload.upload.signed_upload_url, {
      method: "PUT",
      headers: {
        "content-type": uploadPayload.upload.content_type || image.originalType || "application/octet-stream"
      },
      body: source
    });

    if (!storageResponse.ok) {
      throw new Error(`Storage upload failed: ${storageResponse.status}`);
    }

    const verifyResponse = await fetch("/api/listing-image-verify-upload", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        assetId: asset.id,
        imageId: image.id,
        role: storageRoleForImage(image, imageIndex),
        objectPath: uploadPayload.upload.object_path,
        contentType: uploadPayload.upload.content_type,
        size: source.size,
        width: dimensions.width,
        height: dimensions.height,
        signatureHex,
        contentSha256
      })
    });
    const verifyPayload = await verifyResponse.json();
    if (!verifyResponse.ok || !verifyPayload.ok) {
      throw new Error(verifyPayload.message || `Storage upload verification failed: ${verifyResponse.status}`);
    }

    image.objectPath = verifyPayload.verification.object_path;
    image.bucket = verifyPayload.verification.bucket;
    image.storageVerificationToken = verifyPayload.verification.verification_token || "";
    image.contentSha256 = verifyPayload.verification.content_sha256 || contentSha256;
    image.storageVerified = true;
    image.storageUploaded = true;
    uploadedAny = true;
  }

  return uploadedAny;
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

function emergencyProvider() {
  return (state.providerStatus?.providers || []).find((provider) => provider.id === "openai_legacy" && provider.selectable) || null;
}

function providerDisabledText(provider) {
  const reason = provider.disabled_reason || "";
  if (reason === "storage_not_configured") return "Storage 未配置";
  if (reason.includes("api_key")) return "未配置";
  if (reason === "disabled_by_env") return "已禁用";
  if (reason === "emergency_retry_disabled") return "应急关闭";
  if (reason) return "不可用";
  return provider.requires_explicit_retry ? "显式应急" : "可用";
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

function providerStatusText(provider) {
  return [
    `${provider.label} · ${providerDisabledText(provider)}`,
    providerSmokeText(provider)
  ].filter(Boolean).join(" · ");
}

function renderProviderControl() {
  const providers = state.providerStatus?.providers || [];

  if (!providers.length) {
    elements.providerControl.innerHTML = "";
    elements.providerStatusText.textContent = state.providerStatus?.fallback_available
      ? "未配置服务端 Provider，当前使用本地 fallback。"
      : "未读取到可用 Provider。";
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
      ${providerSmokeText(provider) ? `<small class="provider-smoke">${escapeHtml(providerSmokeText(provider))}</small>` : ""}
    </button>
  `).join("");

  const selected = providerById(state.selectedProvider);
  if (selected) {
    elements.providerStatusText.textContent = providerStatusText(selected);
    return;
  }

  elements.providerStatusText.textContent = state.providerStatus?.fallback_available
    ? "未配置服务端 Provider，当前使用本地 fallback。"
    : "请选择可用 Provider。";
}

function selectProvider(providerId) {
  const provider = providerById(providerId);
  if (!provider?.selectable) return;

  state.selectedProvider = provider.id;
  state.results = [];
  renderProviderControl();
  elements.processButton.disabled = !canGenerateTitles();
  renderResults();
}

function canGenerateTitles() {
  return Boolean(state.assets.length && (state.selectedProvider || state.providerStatus?.fallback_available));
}

function selectedProviderConfig() {
  return (state.providerStatus?.providers || []).find((provider) => provider.id === state.selectedProvider) || null;
}

function processingConcurrencyLimit() {
  const configured = Number(selectedProviderConfig()?.recommended_concurrency);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.min(configured, MAX_CONCURRENT_WORKERS));
  }
  return Math.min(3, MAX_CONCURRENT_WORKERS);
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

function setStatus(message) {
  elements.statusText.textContent = message;
}

function assetCountLabel(count) {
  return `${count} 张图片`;
}

function imagesForProvider(assetImages) {
  return assetImages.flatMap((image) => [
    image,
    ...(Array.isArray(image.targetedCrops) ? image.targetedCrops : [])
  ]);
}

function buildAssets() {
  const assets = [];

  if (state.mode === "single") {
    state.files.forEach((image, index) => {
      assets.push({
        id: `asset-${index + 1}`,
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
        index: Math.floor(index / 2) + 1,
        images,
        providerImages: imagesForProvider(images)
      });
    }
  }

  state.assets = assets;
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

  elements.processButton.disabled = !canGenerateTitles();

  if (!state.assets.length) {
    closeImageModal();
    elements.previewSummary.textContent = "等待上传图片。";
    elements.assetPreviewList.innerHTML = `<div class="empty-state">上传 10 张图片后，正反面配对模式会预览为 5 个 card assets，每个资产右侧会出现一个标题输出框。</div>`;
    return;
  }

  const orphanNote = state.mode === "pair" && state.files.length % 2 === 1
    ? "最后 1 张图会作为缺少背面的资产处理。"
    : "";

  elements.previewSummary.textContent = `${state.files.length} 张图片，${state.assets.length} 个 card asset。${orphanNote}`;
  renderAssetRows();
}

function renderResults() {
  updateStats();
  renderBatchTitles();
  renderAssetRows();
}

function resultForAsset(asset) {
  return state.results.find((result) => result.index === asset.index);
}

function generatedTitleResults() {
  return [...state.results]
    .filter((result) => normalizeConfidence(result.confidence) !== "FAILED" && String((result.correctedTitle ?? result.title) || "").trim())
    .sort((a, b) => a.index - b.index);
}

function renderBatchTitles() {
  const titleResults = generatedTitleResults();
  elements.copyAllButton.disabled = titleResults.length === 0;

  if (!titleResults.length) {
    elements.batchTitleList.innerHTML = `<li class="batch-empty">生成完成后，这里会按上传顺序汇总所有非空英文 eBay title。</li>`;
    return;
  }

  elements.batchTitleList.innerHTML = titleResults.map((result) => `
    <li>
      <span>资产 ${result.index}</span>
      <p>${escapeHtml(result.correctedTitle ?? result.title)}</p>
    </li>
  `).join("");
}

function imageSideLabel(imageIndex) {
  if (state.mode !== "pair") return "图片 Image";
  return imageIndex === 0 ? "正面 Front" : "背面 Back";
}

function renderAssetRows() {
  if (!state.assets.length) return;

  // Preserve upload/pairing order so writers can match titles against eBay assets.
  elements.assetPreviewList.innerHTML = state.assets.map((asset) => {
    const result = resultForAsset(asset);

    return `
      <article class="asset-row-card">
        <div class="asset-source">
          <div class="preview-images ${asset.images.length === 1 ? "single" : ""}">
            ${asset.images.map((image, imageIndex) => `
              <button class="thumb-button" type="button" data-preview-asset="${asset.index}" data-preview-image="${imageIndex}" aria-label="打开${escapeHtml(imageSideLabel(imageIndex))}预览">
                <img class="thumb" src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
                <span>${imageSideLabel(imageIndex)}</span>
              </button>
            `).join("")}
          </div>
          <div class="preview-meta">
            <h3>资产 ${asset.index}</h3>
            ${asset.images.map((image, imageIndex) => `
              <p class="file-name">${imageSideLabel(imageIndex)} · ${escapeHtml(image.name)}</p>
            `).join("")}
            <span>${assetCountLabel(asset.images.length)}</span>
          </div>
        </div>
        ${result ? resultBox(result) : pendingBox(asset)}
      </article>
    `;
  }).join("");
}

function pendingBox(asset) {
  return `
    <div class="title-output title-output-pending">
      <div class="title-output-head">
        <span class="confidence-badge confidence-pending">等待中</span>
        <span>资产 ${asset.index}</span>
      </div>
      <textarea readonly placeholder="点击开始生成后，这里会输出英文 eBay listing title。"></textarea>
      <p class="follow-up-advice">等待 Vision Engine 提取字段，再由 Resolution Engine 补全映射，最后交给 Title Engine 生成 80 字符以内标题。</p>
    </div>
  `;
}

function resultBox(result) {
  const confidence = normalizeConfidence(result.confidence);
  const disabled = confidence === "FAILED" || !result.title;
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
  const generatedTitle = result.generatedTitle || result.final_title || result.title || "";
  const correctedTitle = result.correctedTitle ?? generatedTitle;
  const saveDisabled = disabled || result.feedbackStatus === "saving" || result.feedbackStatus === "saved" || result.feedbackStatus === "skipped";
  const showPublish = shouldShowPublishButton(result);
  const publishDisabled = !canPublishResult(result);
  const retryProvider = emergencyProvider();
  const canEmergencyRetry = confidence === "FAILED" && retryProvider && result.provider !== "openai_legacy";
  const saveLabel = {
    saved: "已保存",
    skipped: "未留存",
    saving: "保存中…"
  }[result.feedbackStatus] || "保存";
  const providerLabel = result.provider_label || providerById(result.provider)?.label || result.provider || "-";

  return `
    <div class="title-output ${confidenceClass(confidence)}">
      <div class="title-output-head">
        <span class="confidence-badge ${confidenceClass(confidence)}">${confidence}</span>
        <div class="title-actions">
          <span>${escapeHtml(providerLabel)}</span>
          ${canEmergencyRetry ? `<button class="copy-button" type="button" data-emergency-retry="${result.index}">GPT‑4.1 应急重试</button>` : ""}
          <button class="copy-button" type="button" data-copy-title="${encodeURIComponent(correctedTitle || "")}" ${disabled ? "disabled" : ""}>复制</button>
          <button class="copy-button" type="button" data-save-title="${result.index}" ${saveDisabled ? "disabled" : ""}>${saveLabel}</button>
          ${showPublish ? `<button class="copy-button publish-button" type="button" data-publish-draft="${result.index}" ${publishDisabled ? "disabled" : ""}>${escapeHtml(publishButtonLabel(result))}</button>` : ""}
        </div>
      </div>
      <textarea data-title-input="${result.index}" ${disabled ? "readonly" : ""}>${escapeHtml(correctedTitle || "标题暂不可用")}</textarea>
      ${titleOverrideNotice(result)}
      ${moduleSummary(result)}
      <p class="follow-up-advice">${result.reason || ""}</p>
      ${result.feedbackMessage ? `<p class="feedback-save-status">${escapeHtml(result.feedbackMessage)}</p>` : ""}
      ${result.publishMessage ? `<p class="publish-status">${escapeHtml(result.publishMessage)}</p>` : ""}
      <details>
        <summary>查看判断依据</summary>
        <div class="field-list">
          ${[
            ...reasoningFields(result.fields || {}, unresolved, result.resolved || {}),
            ...qualityFields(result)
          ].map(([label, value]) => `
            <div>
              <span>${label}</span>
              <strong>${value || "-"}</strong>
            </div>
          `).join("")}
        </div>
      </details>
    </div>
  `;
}

function titleOverrideNotice(result) {
  if (!result.title_override) return "";

  const renderedTitle = result.rendered_title || result.final_title || "";
  const canReplace = renderedTitle && renderedTitle !== result.title_override;

  return `
    <div class="title-override-note">
      <span>人工标题覆盖</span>
      ${canReplace ? `<button class="copy-button" type="button" data-use-rendered-title="${result.index}">使用模块标题</button>` : ""}
    </div>
  `;
}

function moduleSummary(result) {
  const modules = result.modules || {};
  const order = Array.isArray(result.module_order) && result.module_order.length
    ? result.module_order
    : Object.keys(modules);
  const visibleModules = order
    .map((key) => modules[key])
    .filter(Boolean);

  if (!visibleModules.length) return "";

  return `
    <div class="writer-modules">
      ${visibleModules.map((module) => `
        <div class="writer-module ${module.requires_review ? "needs-review" : ""}">
          <span>${escapeHtml(module.label || module.key)}</span>
          <textarea data-module-input="${result.index}" data-module-key="${escapeHtml(module.key)}">${escapeHtml(module.text || "")}</textarea>
          <small>${escapeHtml(module.status || "REVIEW")}</small>
        </div>
      `).join("")}
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

  const imageIndex = Math.min(state.modal.imageIndex, asset.images.length - 1);
  const image = asset.images[imageIndex];
  const sideLabel = imageSideLabel(imageIndex);

  elements.imageModalImage.src = image.dataUrl;
  elements.imageModalImage.alt = image.name;
  elements.imageModalSide.textContent = `${sideLabel}预览`;
  elements.imageModalTitle.textContent = `资产 ${asset.index}`;
  elements.imageModalFileName.textContent = image.name;
  elements.imageModalSwitcher.innerHTML = asset.images.map((assetImage, index) => `
    <button class="modal-side-button ${index === imageIndex ? "active" : ""}" type="button" data-modal-image="${index}">
      ${imageSideLabel(index)}
    </button>
  `).join("");
}

function openImageModal(assetIndex, imageIndex) {
  state.modal = { assetIndex, imageIndex };
  renderImageModal();
  elements.imageModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  elements.imageModalClose.focus();
}

function closeImageModal() {
  if (!state.modal) return;
  state.modal = null;
  elements.imageModal.setAttribute("aria-hidden", "true");
  elements.imageModalImage.removeAttribute("src");
  document.body.classList.remove("modal-open");
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

function qualityFields(result) {
  const quality = result.capture_quality || {};
  return [
    ["Capture Profile", result.capture_profile_id || quality.capture_profile_id],
    ["Image Quality Route", quality.route],
    ["Image Quality", quality.image_quality_degraded ? "degraded" : "clear"],
    ["Images Evaluated", quality.image_count]
  ];
}

async function handleFiles(fileList) {
  const candidates = [...fileList];
  const imageFiles = candidates.filter(isSupportedImageFile);
  if (!imageFiles.length) return;

  setStatus("正在优化图片…");
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
  state.clientImagePrepareMs = prepareElapsedMs;

  if (failures.length || ignoredFiles.length) {
    setStatus(`${images.length} 张图片已优化，${failures.length + ignoredFiles.length} 张未读取：${[...failures, ...ignoredFiles].join("；")}`);
  } else {
    const compressedCount = images.filter((image) => image.originalSize && image.size < image.originalSize).length;
    setStatus(compressedCount ? `${images.length} 张图片已优化，图片过大，已自动压缩用于识别。` : `${images.length} 张图片已优化。`);
  }

  renderPreviews();
  renderResults();
}

async function processAsset(asset, options = {}) {
  const processStartedAt = performance.now();
  const uploadStartedAt = performance.now();
  const uploaded = await ensureAssetImagesUploaded(asset);
  const uploadMs = Math.round(performance.now() - uploadStartedAt);
  if (uploaded) setStatus("原图已上传到对象存储，正在生成短期读取 URL。");

  asset.clientTiming = {
    client_image_prepare_ms: Math.round(Number(state.clientImagePrepareMs || 0)),
    client_upload_ms: uploadMs
  };
  const requestPrepareStartedAt = performance.now();
  const { requestBody, compressedAgain } = await ensureSafeAssetPayload(asset, options);
  const requestPrepareMs = Math.round(performance.now() - requestPrepareStartedAt);
  asset.clientTiming.client_request_prepare_ms = requestPrepareMs;
  if (compressedAgain) setStatus("图片过大，已自动压缩用于识别。");

  const apiStartedAt = performance.now();
  const response = await fetch("/api/listing-copilot-title", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "same-origin",
    body: requestBody
  });
  const apiRoundtripMs = Math.round(performance.now() - apiStartedAt);

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("请求失败：413，图片请求体过大，请压缩或裁剪图片后重试。");
    }

    throw new Error(`请求失败：${response.status}`);
  }

  const payload = await response.json();
  const finalTitle = payload.final_title || payload.title || "";
  const clientTotalMs = Math.round(performance.now() - processStartedAt);
  const timing = {
    ...(payload.timing || {}),
    client_image_prepare_ms: asset.clientTiming.client_image_prepare_ms,
    client_upload_ms: uploadMs,
    client_request_prepare_ms: requestPrepareMs,
    client_api_roundtrip_ms: apiRoundtripMs,
    client_total_ms: clientTotalMs
  };

  return {
    index: asset.index,
    thumbnail: asset.images[0].dataUrl,
    generatedTitle: finalTitle,
    correctedTitle: finalTitle,
    generated_resolved_fields: payload.resolved || {},
    generated_evidence: payload.evidence || {},
    generated_modules: payload.modules || {},
    reviewStartedAt: Date.now(),
    feedbackStatus: "",
    feedbackMessage: "",
    ...payload,
    timing
  };
}

function failedResult(asset, error) {
  return {
    index: asset.index,
    thumbnail: asset.images[0].dataUrl,
    title: "",
    confidence: "FAILED",
    reason: error.message,
    fields: {},
    unresolved: ["request"],
    provider: state.selectedProvider || null
  };
}

async function processTitles() {
  if (!canGenerateTitles()) return;

  state.results = [];
  renderResults();
  elements.processButton.disabled = true;
  setStatus("图片已优化，开始识别…");

  const queue = [...state.assets];
  const workerCount = Math.min(processingConcurrencyLimit(), queue.length);
  let startedCount = 0;

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      startedCount += 1;
      setStatus(`正在处理 ${startedCount} / ${state.assets.length}...`);

      try {
        const result = await processAsset(asset);
        state.results.push(result);
      } catch (error) {
        state.results.push(failedResult(asset, error));
      }

      state.results.sort((a, b) => a.index - b.index);
      renderResults();
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  renderResults();

  elements.processButton.disabled = !canGenerateTitles();
  setStatus("已完成，结果保持上传顺序。");
}

async function retryAssetWithEmergency(button) {
  const assetIndex = Number(button.dataset.emergencyRetry);
  const asset = state.assets.find((item) => item.index === assetIndex);
  const retryProvider = emergencyProvider();
  if (!asset || !retryProvider) return;

  button.disabled = true;
  button.textContent = "应急重试中";
  setStatus(`资产 ${asset.index} 正在使用 GPT‑4.1 应急重试...`);

  try {
    const result = await processAsset(asset, {
      provider: retryProvider.id,
      explicitEmergency: true
    });
    state.results = state.results.filter((item) => item.index !== asset.index);
    state.results.push(result);
    state.results.sort((a, b) => a.index - b.index);
    setStatus(`资产 ${asset.index} 应急重试完成。`);
  } catch (error) {
    state.results = state.results.filter((item) => item.index !== asset.index);
    state.results.push({
      ...failedResult(asset, error),
      provider: retryProvider.id,
      provider_label: retryProvider.label,
      explicit_emergency: true
    });
    state.results.sort((a, b) => a.index - b.index);
    setStatus(`资产 ${asset.index} 应急重试失败。`);
  }

  renderResults();
}

async function copyTitle(button) {
  const title = decodeURIComponent(button.dataset.copyTitle || "");
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
  resetPublishState(result);
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

function currentEvidenceForResult(result) {
  return result.corrected_evidence || result.evidence || {};
}

function mergeFieldChanges(existing = [], incoming = []) {
  const byField = new Map(existing.map((change) => [change.field, change]));
  incoming.forEach((change) => byField.set(change.field, change));
  return [...byField.values()];
}

async function applyModuleEdit(input) {
  const result = state.results.find((item) => item.index === Number(input.dataset.moduleInput));
  const moduleKey = input.dataset.moduleKey;
  if (!result || !moduleKey) return;

  input.disabled = true;
  result.feedbackStatus = "";
  result.feedbackMessage = "模块更新中…";
  renderBatchTitles();

  try {
    const response = await fetch("/api/listing-render-title", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        resolved: currentResolvedForResult(result),
        evidence: currentEvidenceForResult(result),
        maxTitleLength,
        module_edit: {
          module_key: moduleKey,
          module_text: input.value
        }
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `模块更新失败：${response.status}`);
    }

    result.corrected_resolved = payload.corrected_resolved;
    result.corrected_evidence = payload.corrected_evidence;
    result.resolved = payload.corrected_resolved;
    result.evidence = payload.corrected_evidence;
    result.fields = {
      ...(result.fields || {}),
      ...(payload.fields || {})
    };
    result.modules = payload.modules;
    result.module_order = payload.module_order;
    result.rendered_title = payload.rendered_title;
    result.final_title = payload.final_title;
    result.title = payload.final_title || result.title;
    result.renderer = payload.renderer;
    result.renderer_version = payload.renderer_version;
    result.title_length_policy = payload.title_length_policy;
    result.field_changes = mergeFieldChanges(result.field_changes || [], payload.field_changes || []);
    resetPublishState(result);

    if (result.title_override) {
      result.feedbackMessage = "模块已更新；当前仍保留人工标题覆盖。";
    } else {
      result.correctedTitle = payload.final_title || result.correctedTitle;
      result.feedbackMessage = "模块已更新，标题已重新渲染。";
    }
  } catch (error) {
    result.feedbackMessage = error.message || "模块更新失败。";
  }

  renderResults();
}

function useRenderedTitle(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.useRenderedTitle));
  if (!result) return;

  const renderedTitle = result.rendered_title || result.final_title || result.title || "";
  result.correctedTitle = renderedTitle;
  result.title_override = null;
  result.feedbackStatus = "";
  result.feedbackMessage = "已使用模块重新渲染标题。";
  resetPublishState(result);
  renderResults();
}

function resetPublishState(result) {
  result.publishStatus = "";
  result.publishMessage = "";
  result.publishAuditJobId = "";
  result.publishExternalId = "";
  result.publishDuplicate = false;
}

function finalTitleForResult(result) {
  return String(result.correctedTitle ?? result.final_title ?? result.rendered_title ?? result.title ?? "").trim();
}

function resultHasResolvedFields(result) {
  return Object.keys(currentResolvedForResult(result) || {}).length > 0;
}

function shouldShowPublishButton(result) {
  if (result.publishStatus) return true;
  return result.feedbackStatus === "saved"
    && Boolean(result.review_id)
    && Boolean(result.approved_at)
    && Boolean(result.approved_by);
}

function publishButtonLabel(result) {
  if (result.publishStatus === "publishing") return "发布中…";
  if (result.publishStatus === "PUBLISHED") return "已发布";
  if (result.publishStatus === "SKIPPED_DUPLICATE") return "已发布";
  if (result.publishStatus === "FAILED") return "重试发布";
  return "发布 Mock";
}

function canPublishResult(result) {
  if (["publishing", "PUBLISHED", "SKIPPED_DUPLICATE"].includes(result.publishStatus)) return false;
  return shouldShowPublishButton(result)
    && Boolean(result.review_id)
    && Boolean(result.approved_at)
    && Boolean(result.approved_by)
    && finalTitleForResult(result)
    && resultHasResolvedFields(result);
}

function buildListingDraft(result, asset) {
  return {
    asset_id: result.asset_id || asset?.id || `asset-${result.index}`,
    review_id: result.review_id,
    final_title: finalTitleForResult(result),
    resolved_fields: currentResolvedForResult(result),
    modules: result.modules || {},
    review_status: "APPROVED",
    approved_by: result.approved_by,
    approved_at: result.approved_at,
    publish_status: "READY"
  };
}

async function saveTitleFeedback(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.saveTitle));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.saveTitle));
  if (!result) return;

  const generatedTitle = String(result.generatedTitle || result.title || "").trim();
  const correctedTitle = String(result.correctedTitle ?? generatedTitle).trim();

  if (!generatedTitle || !correctedTitle) return;

  result.feedbackStatus = "saving";
  result.feedbackMessage = "正在保存审核记录…";
  renderResults();

  try {
    const response = await fetch("/api/listing-title-feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        asset_id: result.asset_id || asset?.id || `asset-${result.index}`,
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
        usage: result.usage || null,
        recovery: result.recovery || null,
        targeted_rescan_recovered: result.targeted_rescan_recovered === true,
        review_duration_ms: result.reviewStartedAt ? Date.now() - result.reviewStartedAt : null,
        field_changes: result.field_changes || [],
        images: (asset?.providerImages || asset?.images || []).map(reviewImageReference)
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `保存失败：${response.status}`);
    }

    const retentionSkipped = payload.retention_skipped === true || payload.retention_enabled === false;
    result.feedbackStatus = retentionSkipped ? "skipped" : "saved";
    result.review_id = retentionSkipped ? "" : payload.record?.review?.id || "";
    result.approved_at = retentionSkipped ? "" : payload.record?.review?.approved_at || "";
    result.approved_by = retentionSkipped ? "" : payload.record?.review?.operator_id || "";
    result.review_outcome = payload.review_outcome || payload.record?.review?.review_outcome || "";
    resetPublishState(result);
    result.feedbackMessage = retentionSkipped
      ? `审核接口已接收，当前未开通反馈留存：${payload.review_outcome || "未写入"}。`
      : payload.review_outcome
      ? `已保存审核记录：${payload.review_outcome}。`
      : "已保存审核记录。";
  } catch (error) {
    result.feedbackStatus = "";
    result.feedbackMessage = error.message || "记忆保存失败。";
  }

  renderResults();
}

async function publishDraft(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.publishDraft));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.publishDraft));
  if (!result || !canPublishResult(result)) return;

  result.publishStatus = "publishing";
  result.publishMessage = "正在发布到 Mock B 端…";
  renderResults();

  try {
    const response = await fetch("/api/listing-publish-draft", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        listing_draft: buildListingDraft(result, asset),
        destination_context: {
          destination: "mock_b_end",
          dry_run: true
        }
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `发布失败：${response.status}`);
    }

    result.publishStatus = payload.status || "PUBLISHED";
    result.publishAuditJobId = payload.audit_job?.id || "";
    result.publishExternalId = payload.response?.external_id || "";
    result.publishDuplicate = payload.duplicate === true;
    result.publishMessage = payload.duplicate
      ? "重复发布请求已跳过，Mock B 端未再次提交。"
      : `已发布到 Mock B 端${result.publishExternalId ? `：${result.publishExternalId}` : ""}。`;
  } catch (error) {
    result.publishStatus = "FAILED";
    result.publishMessage = error.message || "Mock 发布失败。";
  }

  renderResults();
}

async function copyAllTitles() {
  const titles = generatedTitleResults().map((result) => String(result.correctedTitle ?? result.title).trim());
  if (!titles.length) return;

  await navigator.clipboard.writeText(titles.join("\n"));
  const original = elements.copyAllButton.textContent;
  elements.copyAllButton.textContent = "已复制全部";
  setTimeout(() => {
    elements.copyAllButton.textContent = original;
  }, 1200);
}

function resetTool() {
  state.files = [];
  state.assets = [];
  state.results = [];
  closeImageModal();
  elements.imageInput.value = "";
  setStatus("");
  renderPreviews();
  renderResults();
}

function bindEvents() {
  elements.imageInput.addEventListener("change", (event) => {
    handleFiles(event.target.files);
  });

  document.querySelectorAll("input[name='assetMode']").forEach((input) => {
    input.addEventListener("change", () => {
      state.mode = input.value;
      state.results = [];
      closeImageModal();
      renderPreviews();
      renderResults();
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
    handleFiles(event.dataTransfer.files);
  });

  elements.processButton.addEventListener("click", processTitles);
  elements.resetButton.addEventListener("click", resetTool);
  elements.copyAllButton.addEventListener("click", copyAllTitles);
  elements.providerControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-provider-id]");
    if (button) selectProvider(button.dataset.providerId);
  });

  elements.assetPreviewList.addEventListener("click", (event) => {
    const previewButton = event.target.closest("[data-preview-asset]");
    if (previewButton) {
      openImageModal(Number(previewButton.dataset.previewAsset), Number(previewButton.dataset.previewImage));
      return;
    }

    const button = event.target.closest("[data-copy-title]");
    if (button) {
      copyTitle(button);
      return;
    }

    const saveButton = event.target.closest("[data-save-title]");
    if (saveButton) {
      saveTitleFeedback(saveButton);
      return;
    }

    const publishButton = event.target.closest("[data-publish-draft]");
    if (publishButton) {
      publishDraft(publishButton);
      return;
    }

    const useRenderedTitleButton = event.target.closest("[data-use-rendered-title]");
    if (useRenderedTitleButton) {
      useRenderedTitle(useRenderedTitleButton);
      return;
    }

    const emergencyRetryButton = event.target.closest("[data-emergency-retry]");
    if (emergencyRetryButton) retryAssetWithEmergency(emergencyRetryButton);
  });

  elements.assetPreviewList.addEventListener("input", (event) => {
    const input = event.target.closest("[data-title-input]");
    if (input) updateCorrectedTitle(input);
  });

  elements.assetPreviewList.addEventListener("change", (event) => {
    const titleInput = event.target.closest("[data-title-input]");
    if (titleInput) {
      finalizeTitleOverride(titleInput);
      return;
    }

    const moduleInput = event.target.closest("[data-module-input]");
    if (moduleInput) applyModuleEdit(moduleInput);
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
    if (event.key === "Escape") closeImageModal();
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

await Promise.all([
  loadResolutionMap(),
  loadProviderStatus()
]);
bindEvents();
renderPreviews();
renderResults();
