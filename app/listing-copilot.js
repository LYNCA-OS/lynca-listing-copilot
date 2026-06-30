import {
  analyzeImageQualityFromImageData,
  defaultCaptureProfileId,
  summarizeAssetImageQuality
} from "../lib/listing/image-quality/quality-gate.mjs";
import { planTargetedCrops } from "../lib/listing/image-quality/crop-planner.mjs";

const apiCostPerRequest = 0.003;
const maxTitleLength = 85;
const MAX_CONCURRENT_WORKERS = 6;
const IMAGE_PREPROCESS_CONCURRENCY = 4;
const STORAGE_UPLOAD_CONCURRENCY = 3;
const IMAGE_MAX_EDGE = 2200;
const IMAGE_MIN_EDGE = 1400;
const IMAGE_INITIAL_QUALITY = 0.9;
const IMAGE_MIN_QUALITY = 0.78;
const IMAGE_EMERGENCY_MIN_QUALITY = 0.64;
const TARGET_IMAGE_DATA_URL_CHARS = 2_400_000;
const MAX_ASSET_REQUEST_BYTES = 3_400_000;
const REQUEST_IMAGE_BATCH_LIMIT = 14;
const TARGETED_CROP_QUALITY = 0.88;
const FIELD_MAX_CROPS_PER_ASSET = 6;
const defaultProviderOptions = Object.freeze({
  single_model_fast: false,
  enable_evidence_completion: true,
  enable_catalog_assist: true,
  enable_vector_assist: true,
  enable_stored_visual_features: true,
  enable_query_visual_embeddings: true,
  enable_vector_retrieval: true,
  vector_retrieval_mode: "assist",
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
  mode: "single",
  assets: [],
  results: [],
  modal: null,
  resolutionMap: {},
  providerStatus: null,
  selectedProvider: "",
  processing: false,
  activeAssetIndexes: new Set()
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

function inferredSourceSide(image = {}) {
  const text = [
    image.side,
    image.role,
    image.captureRole,
    image.capture_profile,
    image.storageRole,
    image.name
  ].filter(Boolean).join(" ").toLowerCase();

  if (text.includes("back") || text.includes("reverse")) return "back";
  if (text.includes("front") || text.includes("obverse")) return "front";
  return "";
}

function buildTargetedCropImages(sourceImage, sourceCanvas, imageQuality) {
  const cropPlans = planTargetedCrops({
    imageId: sourceImage.id,
    sourceObjectPath: sourceImage.objectPath || "",
    sourceSide: inferredSourceSide(sourceImage),
    sourceWidth: sourceCanvas.width,
    sourceHeight: sourceCanvas.height,
    imageQuality,
    maxCrops: FIELD_MAX_CROPS_PER_ASSET
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

function serializableAssetImage(image, assetId = "") {
  const useStorageReference = imageHasVerifiedStorageReference(image);
  const cropMetadata = image.cropMetadata || image.crop_metadata || null;
  const serializedCropMetadata = cropMetadata
    ? {
      ...cropMetadata,
      asset_id: cropMetadata.asset_id || assetId || "",
      source_object_path: cropMetadata.source_object_path || "",
      derived_object_path: cropMetadata.derived_object_path || image.objectPath || ""
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
    objectPath: image.objectPath || "",
    bucket: image.bucket || "",
    storageVerificationToken: image.storageVerificationToken || "",
    storageVerified: Boolean(image.storageVerified),
    storageUploaded: Boolean(image.storageUploaded)
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
  const body = {
    assetId: asset.id,
    mode: state.mode,
    maxTitleLength,
    images: providerImages.map((image) => serializableAssetImage(image, asset.id)),
    deferredImageCount,
    deferred_image_count: deferredImageCount,
    captureProfileId: defaultCaptureProfileId,
    captureQuality: summarizeAssetImageQuality(providerImages),
    resolutionMap: state.resolutionMap,
    clientTiming: asset.clientTiming || {},
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

async function uploadAssetImage(asset, image, imageIndex) {
  const source = storageSourceForImage(image);
  if (image.objectPath || !source) return false;
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
  if (image.cropMetadata || image.crop_metadata) {
    const metadata = {
      ...(image.cropMetadata || image.crop_metadata || {}),
      derived_object_path: image.objectPath,
      source_object_path: (image.cropMetadata || image.crop_metadata || {}).source_object_path || "",
      asset_id: (image.cropMetadata || image.crop_metadata || {}).asset_id || asset.id || ""
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

async function ensureAssetImagesUploaded(asset) {
  if (!storageReady()) return false;

  const images = boundedProviderImagesForRequest(asset.providerImages || asset.images);
  asset.providerImages = images;
  const uploadResults = await mapWithConcurrency(images, STORAGE_UPLOAD_CONCURRENCY, (image, imageIndex) => {
    return uploadAssetImage(asset, image, imageIndex);
  });
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
      asset_id: metadata.asset_id || asset.id || ""
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

  return uploadResults.some(Boolean);
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
    return "GPT-4.1 mini 生产主路径，不参与自动混合";
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

function renderProviderControl() {
  const providers = state.providerStatus?.providers || [];

  if (!providers.length) {
    elements.providerControl.innerHTML = "";
    elements.providerStatusText.textContent = state.providerStatus?.fallback_available
      ? "未配置服务端 Provider，当前使用本地 fallback。"
      : "未读取到可用 Provider。";
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
    elements.providerStatusText.textContent = providerStatusText(selected);
    elements.processButton.disabled = !canGenerateTitles();
    return;
  }

  elements.providerStatusText.textContent = state.providerStatus?.fallback_available
    ? "未配置服务端 Provider，当前使用本地 fallback。"
    : "请选择可用 Provider。";
  elements.processButton.disabled = !canGenerateTitles();
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
  const primaryImages = Array.isArray(assetImages) ? assetImages : [];
  const targetedCrops = primaryImages
    .flatMap((image, sourceIndex) => (Array.isArray(image.targetedCrops) ? image.targetedCrops : [])
      .map((crop) => ({
        crop,
        sourceIndex,
        priority: Number(crop.cropPlan?.priority || crop.crop_plan?.priority || 0)
      })))
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.sourceIndex - right.sourceIndex;
    })
    .slice(0, FIELD_MAX_CROPS_PER_ASSET)
    .map((item) => item.crop);

  return [
    ...primaryImages,
    ...targetedCrops
  ];
}

export const __listingCopilotAppTestHooks = {
  boundedProviderImagesForRequest,
  imagesForProvider
};

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

function cropRegionLabel(region = "") {
  return reviewFieldLabels[region] || String(region || "").replace(/_/g, " ") || "Field Crop";
}

function modalImagesForAsset(asset = {}) {
  return asset.images || [];
}

function imagePreviewLabel(image, imageIndex) {
  return imageSideLabel(imageIndex);
}

function fieldCropStrip(asset) {
  return "";
}

function renderAssetRows() {
  if (!state.assets.length) return;

  const hasAnyResult = state.results.length > 0;
  if (!hasAnyResult) {
    elements.assetPreviewList.innerHTML = state.assets.map(assetRowHtml).join("");
    return;
  }

  const groups = [
    {
      key: "quick",
      label: "低触审核",
      assets: state.assets.filter((asset) => modelQuickApprovalCandidate(resultForAsset(asset)))
    },
    {
      key: "review",
      label: "标准审核",
      assets: state.assets.filter((asset) => {
        const result = resultForAsset(asset);
        if (!result || modelQuickApprovalCandidate(result)) return false;
        const gate = result.publication_gate || {};
        return gate.writer_review_ready === true;
      })
    },
    {
      key: "manual",
      label: "深度审核 / 补拍",
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
            ${fieldCropStrip(asset)}
          </div>
        </div>
        ${result ? resultBox(result) : pendingBox(asset)}
      </article>
    `;
}

function pendingBox(asset) {
  const isActive = state.activeAssetIndexes.has(asset.index);
  const isQueued = state.processing && !isActive;
  const label = isActive ? "识别中" : isQueued ? "排队中" : "等待中";
  const message = isActive
    ? "正在读取原图与关键局部区域，完成后会自动生成可编辑标题。"
    : isQueued
      ? "后台队列会自动按批处理，不需要重复点击。"
      : "点击开始生成后，这里会输出英文 eBay listing title。";
  return `
    <div class="title-output title-output-pending">
      <div class="title-output-head">
        <span class="confidence-badge confidence-pending">${escapeHtml(label)}</span>
        <span>资产 ${asset.index}</span>
      </div>
      <div class="pending-state" role="status" aria-live="polite">
        <span class="loading-spinner" aria-hidden="true"></span>
        <strong>${escapeHtml(label)}</strong>
        <p>${escapeHtml(message)}</p>
      </div>
      <textarea readonly placeholder="等待生成可编辑英文标题。"></textarea>
      <p class="follow-up-advice">模型先提取字段，再由 Resolver 与 Title Engine 生成 85 字符以内标题。</p>
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
  return text || "识别未返回可用标题。";
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
  const showQuickApprove = shouldShowQuickApproveButton(result);
  const quickApproveDisabled = !canQuickApproveAndPublish(result);
  const retryProvider = emergencyProvider();
  const canEmergencyRetry = confidence === "FAILED" && retryProvider && result.provider !== "openai_legacy";
  const saveLabel = {
    saved: "已保存",
    skipped: "未留存",
    saving: "保存中…"
  }[result.feedbackStatus] || "保存";
  const providerLabel = result.provider_label || providerById(result.provider)?.label || result.provider || "-";
  const unavailableTitle = confidence === "FAILED"
    ? `标题暂不可用：${friendlyErrorSummary(result.reason)}`
    : "标题暂不可用";

  return `
    <div class="title-output ${confidenceClass(confidence)}">
      <div class="title-output-head">
        <span class="confidence-badge ${confidenceClass(confidence)}">${confidence}</span>
        <div class="title-actions">
          <span>${escapeHtml(providerLabel)}</span>
          ${canEmergencyRetry ? `<button class="copy-button" type="button" data-emergency-retry="${result.index}">GPT‑4.1 单模型重试</button>` : ""}
          <button class="copy-button" type="button" data-copy-title="${encodeURIComponent(correctedTitle || "")}" ${disabled ? "disabled" : ""}>复制</button>
          <button class="copy-button" type="button" data-save-title="${result.index}" ${saveDisabled ? "disabled" : ""}>${saveLabel}</button>
          ${showQuickApprove ? `<button class="copy-button publish-button quick-approve-button" type="button" data-quick-approve-publish="${result.index}" ${quickApproveDisabled ? "disabled" : ""}>快速批准并发布</button>` : ""}
          ${showPublish ? `<button class="copy-button publish-button" type="button" data-publish-draft="${result.index}" ${publishDisabled ? "disabled" : ""}>${escapeHtml(publishButtonLabel(result))}</button>` : ""}
        </div>
      </div>
      <textarea data-title-input="${result.index}" ${disabled ? "readonly" : ""}>${escapeHtml(correctedTitle || unavailableTitle)}</textarea>
      ${titleOverrideNotice(result)}
      ${moduleSummary(result)}
      ${vectorCandidateNotice(result)}
      ${publicationGateNotice(result)}
      <p class="follow-up-advice">${escapeHtml(result.reason || "")}</p>
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

function vectorCandidateNotice(result) {
  const retrieval = result.vector_candidate_packet?.vector_retrieval || result.vector_retrieval?.vector_retrieval || null;
  if (!retrieval) return "";
  const candidates = Array.isArray(retrieval.candidates) ? retrieval.candidates : [];
  const top = candidates[0] || null;
  const fields = top?.fields && typeof top.fields === "object"
    ? Object.keys(top.fields).slice(0, 6).map((field) => reviewFieldLabels[field] || field).join(", ")
    : "";
  const status = retrieval.status_code || retrieval.status || "VECTOR_RETRIEVAL_UNAVAILABLE";
  const assist = result.vector_prompt_assist_used === true ? "已进入 GPT" : "未进入 GPT";
  const summary = top
    ? `Top ${top.rank || 1} · sim ${top.similarity ?? "-"} · margin ${top.top1_top2_margin ?? "-"}`
    : (retrieval.unavailable?.[0]?.reason || "无候选");

  return `
    <div class="publication-gate ${top ? "writer-ready" : "manual-required"}">
      <span>向量候选支持 · ${escapeHtml(assist)}</span>
      <strong>${escapeHtml(status)} · ${escapeHtml(summary)}</strong>
      ${fields ? `<small>候选字段：${escapeHtml(fields)}</small>` : ""}
    </div>
  `;
}

const reviewFieldLabels = {
  year: "Year",
  brand: "Brand",
  manufacturer: "Manufacturer",
  product: "Product",
  set: "Set",
  subset: "Subset",
  players: "Player",
  character: "Character",
  card_type: "Card Type",
  insert: "Insert",
  surface_color: "Color",
  parallel_family: "Parallel Family",
  parallel_exact: "Exact Parallel",
  parallel: "Parallel",
  variation: "Variation",
  serial_number: "Serial",
  collector_number: "Collector Number",
  checklist_code: "Checklist Code",
  grade_company: "Grade Company",
  card_grade: "Card Grade",
  auto_grade: "Auto Grade",
  grade_type: "Grade Type",
  rc: "RC",
  first_bowman: "1st Bowman",
  ssp: "SSP",
  case_hit: "Case Hit",
  auto: "Auto",
  patch: "Patch",
  relic: "Relic",
  sketch: "Sketch",
  redemption: "Redemption",
  one_of_one: "1/1"
};

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
    ? fields.map((field) => reviewFieldLabels[field] || field).join(", ")
    : "无需补字段";
  const quickApproval = modelQuickApprovalCandidate(result);
  const route = gate.workflow_route || gate.status;
  const readyText = workflowLabels[route] || (gate.writer_review_ready ? "已生成可编辑草稿" : "需要人工处理");
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

  const renderedTitle = result.rendered_title || result.final_title || "";
  const canReplace = renderedTitle && renderedTitle !== result.title_override;

  return `
    <div class="title-override-note">
      <span>人工标题覆盖</span>
      ${canReplace ? `<button class="copy-button" type="button" data-use-rendered-title="${result.index}">使用模块标题</button>` : ""}
    </div>
  `;
}

function modulePolicySummary(module) {
  const policies = Array.isArray(module.field_policies) ? module.field_policies : [];
  const pending = policies.filter((policy) => policy.requires_writer_confirmation === true);
  if (!pending.length) return module.status || "REVIEW";
  return pending
    .slice(0, 3)
    .map((policy) => reviewFieldLabels[policy.field] || policy.field)
    .join(", ");
}

function draftGatePoliciesByField(result) {
  return result?.publication_gate?.draft_gate?.by_field || result?.draft_gate?.by_field || {};
}

function policyForFields(fields = [], result, module = {}) {
  const byField = draftGatePoliciesByField(result);
  const policies = fields
    .map((field) => byField[field])
    .filter(Boolean);
  if (policies.length) return policies;

  const modulePolicies = Array.isArray(module.field_policies) ? module.field_policies : [];
  return fields
    .map((field) => modulePolicies.find((policy) => policy.field === field))
    .filter(Boolean);
}

function strongestTokenPolicy(policies = []) {
  if (policies.some((policy) => policy.display_policy === "SUGGEST_ONLY")) return "SUGGEST_ONLY";
  if (policies.some((policy) => policy.display_policy === "OMIT")) return "OMIT";
  if (policies.some((policy) => policy.display_policy === "INCLUDE_HIGHLIGHTED")) return "INCLUDE_HIGHLIGHTED";
  if (policies.some((policy) => policy.display_policy === "INCLUDE_NORMAL")) return "INCLUDE_NORMAL";
  return "";
}

function moduleTokenReviewReason(token = {}, policies = []) {
  const highlighted = policies.find((policy) => policy.display_policy && policy.display_policy !== "INCLUDE_NORMAL");
  if (highlighted?.resolution_reason) return highlighted.resolution_reason;
  if (highlighted?.evidence_level) return `${highlighted.display_policy} · ${highlighted.evidence_level}`;
  if (token.status && token.status !== "CONFIRMED") return token.status;
  return "";
}

function moduleTokenClass(token = {}, result, module = {}) {
  const policies = policyForFields(token.fields || [], result, module);
  const policy = strongestTokenPolicy(policies);
  const status = token.status || "";
  const classes = ["module-token"];
  if (policy) classes.push(`policy-${policy.toLowerCase().replace(/_/g, "-")}`);
  if (policy === "INCLUDE_HIGHLIGHTED" || token.requires_review || ["REVIEW", "MISSING"].includes(status)) {
    classes.push("needs-review");
  }
  if (policy === "SUGGEST_ONLY" || policy === "OMIT" || status === "CONFLICT") {
    classes.push("suggest-only");
  }
  return classes.join(" ");
}

function moduleTokenSummary(module, result) {
  const tokens = Array.isArray(module.tokens) ? module.tokens : [];
  if (!tokens.length) return "";
  return `
    <div class="module-token-row" aria-label="模块词条置信状态">
      ${tokens.map((token) => {
        const policies = policyForFields(token.fields || [], result, module);
        const reason = moduleTokenReviewReason(token, policies);
        return `<mark class="${moduleTokenClass(token, result, module)}" title="${escapeHtml(reason)}">${escapeHtml(token.text || "")}</mark>`;
      }).join("")}
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
        <div class="writer-module ${module.requires_review ? "needs-review" : ""} ${module.display_policy ? `display-${String(module.display_policy).toLowerCase().replace(/_/g, "-")}` : ""} ${module.review_priority ? `priority-${String(module.review_priority).toLowerCase()}` : ""}">
          <span>${escapeHtml(module.label || module.key)}</span>
          ${moduleTokenSummary(module, result)}
          <textarea data-module-input="${result.index}" data-module-key="${escapeHtml(module.key)}">${escapeHtml(module.text || "")}</textarea>
          <small>${escapeHtml(modulePolicySummary(module))}</small>
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

  const modalImages = modalImagesForAsset(asset);
  const imageIndex = Math.min(state.modal.imageIndex, modalImages.length - 1);
  const image = modalImages[imageIndex];
  const sideLabel = imagePreviewLabel(image, imageIndex);

  elements.imageModalImage.src = image.dataUrl;
  elements.imageModalImage.alt = image.name;
  elements.imageModalSide.textContent = `${sideLabel}预览`;
  elements.imageModalTitle.textContent = `资产 ${asset.index}`;
  elements.imageModalFileName.textContent = image.name;
  elements.imageModalSwitcher.innerHTML = modalImages.map((assetImage, index) => `
    <button class="modal-side-button ${index === imageIndex ? "active" : ""}" type="button" data-modal-image="${index}">
      ${escapeHtml(imagePreviewLabel(assetImage, index))}
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

  setStatus("正在准备高质量预览与云端原图上传…");
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
    setStatus(`${images.length} 张图片已准备，${failures.length + ignoredFiles.length} 张未读取：${[...failures, ...ignoredFiles].join("；")}`);
  } else {
    const previewOptimizedCount = images.filter((image) => image.originalSize && image.size < image.originalSize).length;
    setStatus(previewOptimizedCount
      ? `${images.length} 张图片已准备。原图会优先上传云端识别，本地预览已高质量优化。`
      : `${images.length} 张图片已准备。`);
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
  if (compressedAgain) setStatus("图片请求过大，已自动缩减辅助局部图并保留主图识别。");

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
    let errorPayload = null;
    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = null;
    }
    const detail = errorPayload?.message || errorPayload?.error || "";
    if (response.status === 413) {
      throw new Error(detail || "请求失败：413，图片请求体过大，请压缩或裁剪图片后重试。");
    }

    throw new Error(detail ? `请求失败：${response.status}，${detail}` : `请求失败：${response.status}`);
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

function processingCompletionStatus() {
  const total = state.assets.length;
  const failed = state.results.filter((result) => normalizeConfidence(result.confidence) === "FAILED").length;
  const succeeded = Math.max(0, state.results.length - failed);

  if (!total) return "";
  if (failed && succeeded) return `已完成：${succeeded} 个成功，${failed} 个失败。失败项可查看错误后重试。`;
  if (failed) return `已完成：${failed} 个失败。请查看每张卡错误信息后重试。`;
  return "已完成，结果保持上传顺序。";
}

function processingProgressStatus(completedCount) {
  const total = state.assets.length;
  const failed = state.results.filter((result) => normalizeConfidence(result.confidence) === "FAILED").length;
  const suffix = failed ? `，失败 ${failed}` : "";
  return `正在处理：已完成 ${completedCount} / ${total}${suffix}...`;
}

async function processTitles() {
  if (!canGenerateTitles()) return;

  state.results = [];
  state.processing = true;
  state.activeAssetIndexes = new Set();
  renderResults();
  elements.processButton.disabled = true;
  setStatus("图片已准备，开始识别…");

  const queue = [...state.assets];
  const workerCount = Math.min(processingConcurrencyLimit(), queue.length);
  let completedCount = 0;

  async function worker() {
    while (queue.length) {
      const asset = queue.shift();
      state.activeAssetIndexes.add(asset.index);
      renderResults();

      try {
        const result = await processAsset(asset);
        state.results.push(result);
      } catch (error) {
        state.results.push(failedResult(asset, error));
      }

      state.activeAssetIndexes.delete(asset.index);
      completedCount += 1;
      state.results.sort((a, b) => a.index - b.index);
      renderResults();
      setStatus(processingProgressStatus(completedCount));
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  state.processing = false;
  state.activeAssetIndexes = new Set();
  renderResults();

  elements.processButton.disabled = !canGenerateTitles();
  setStatus(processingCompletionStatus());
}

async function retryAssetWithEmergency(button) {
  const assetIndex = Number(button.dataset.emergencyRetry);
  const asset = state.assets.find((item) => item.index === assetIndex);
  const retryProvider = emergencyProvider();
  if (!asset || !retryProvider) return;

  button.disabled = true;
  button.textContent = "GPT 重试中";
  setStatus(`资产 ${asset.index} 正在使用 GPT‑4.1 单模型重试...`);

  try {
    const result = await processAsset(asset, {
      provider: retryProvider.id,
      explicitEmergency: true
    });
    state.results = state.results.filter((item) => item.index !== asset.index);
    state.results.push(result);
    state.results.sort((a, b) => a.index - b.index);
    setStatus(`资产 ${asset.index} GPT‑4.1 单模型重试完成。`);
  } catch (error) {
    state.results = state.results.filter((item) => item.index !== asset.index);
    state.results.push({
      ...failedResult(asset, error),
      provider: retryProvider.id,
      provider_label: retryProvider.label,
      explicit_emergency: true
    });
    state.results.sort((a, b) => a.index - b.index);
    setStatus(`资产 ${asset.index} GPT‑4.1 单模型重试失败。`);
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

function shouldShowQuickApproveButton(result) {
  if (!modelQuickApprovalCandidate(result)) return false;
  if (["publishing", "PUBLISHED", "SKIPPED_DUPLICATE"].includes(result.publishStatus)) return false;
  return result.feedbackStatus !== "saved" && result.feedbackStatus !== "skipped";
}

function canQuickApproveAndPublish(result) {
  return shouldShowQuickApproveButton(result)
    && result.feedbackStatus !== "saving"
    && result.publishStatus !== "FAILED"
    && finalTitleForResult(result)
    && resultHasResolvedFields(result);
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

async function saveFeedbackForResult(result, asset) {
  if (!result) return;

  const generatedTitle = String(result.generatedTitle || result.title || "").trim();
  const correctedTitle = String(result.correctedTitle ?? generatedTitle).trim();

  if (!generatedTitle || !correctedTitle) return false;

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
    return result.feedbackStatus === "saved";
  } catch (error) {
    result.feedbackStatus = "";
    result.feedbackMessage = error.message || "记忆保存失败。";
    return false;
  } finally {
    renderResults();
  }
}

async function saveTitleFeedback(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.saveTitle));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.saveTitle));
  await saveFeedbackForResult(result, asset);
}

async function publishDraftForResult(result, asset) {
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

async function publishDraft(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.publishDraft));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.publishDraft));
  await publishDraftForResult(result, asset);
}

async function quickApproveAndPublish(button) {
  const result = state.results.find((item) => item.index === Number(button.dataset.quickApprovePublish));
  const asset = state.assets.find((item) => item.index === Number(button.dataset.quickApprovePublish));
  if (!result || !canQuickApproveAndPublish(result)) return;

  result.feedbackMessage = "正在快速批准…";
  renderResults();
  const saved = await saveFeedbackForResult(result, asset);
  if (!saved) {
    result.publishMessage = "未生成可发布的审核记录，无法一键发布。";
    renderResults();
    return;
  }
  await publishDraftForResult(result, asset);
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

    const quickApproveButton = event.target.closest("[data-quick-approve-publish]");
    if (quickApproveButton) {
      quickApproveAndPublish(quickApproveButton);
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
