const durableAssetIdPattern = /^asset_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const assetLifecycleStates = Object.freeze({
  LOCAL: "LOCAL",
  ASSET_CREATED: "ASSET_CREATED",
  ORIGINALS_UPLOADING: "ORIGINALS_UPLOADING",
  ORIGINALS_VERIFIED: "ORIGINALS_VERIFIED",
  IMAGE_SET_READY: "IMAGE_SET_READY",
  ENQUEUE_READY: "ENQUEUE_READY",
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  L2_READY: "L2_READY",
  WRITER_REVIEWED: "WRITER_REVIEWED"
});

export const assetRecoveryActions = Object.freeze({
  EXECUTION_RETRY: "EXECUTION_RETRY",
  INPUT_REBIND: "INPUT_REBIND",
  NONE: "NONE"
});

export const clientForbiddenImageTransportKeys = Object.freeze([
  "images",
  "asset_images", "assetImages",
  "image_references", "imageReferences",
  "front_object_path", "frontObjectPath",
  "back_object_path", "backObjectPath",
  "additional_image_paths", "additionalImagePaths",
  "front_bucket", "frontBucket",
  "back_bucket", "backBucket",
  "front_content_sha256", "frontContentSha256",
  "back_content_sha256", "backContentSha256",
  "front_image_url", "frontImageUrl",
  "back_image_url", "backImageUrl",
  "image_urls", "imageUrls",
  "image_set_sha256", "imageSetSha256",
  "expected_original_count", "expectedOriginalCount"
]);

const inputRebindCodes = new Set([
  "CANONICAL_ASSET_ID_MISSING",
  "CANONICAL_ASSET_TENANT_ID_MISSING",
  "CANONICAL_IMAGE_ASSET_MISMATCH",
  "CANONICAL_IMAGE_GENERATION_MISSING",
  "CANONICAL_IMAGE_GENERATION_MISMATCH",
  "CANONICAL_IMAGE_GENERATION_STALE",
  "CANONICAL_IMAGE_MANIFEST_MISSING",
  "CANONICAL_IMAGE_OBJECT_PATH_OUT_OF_SCOPE",
  "CANONICAL_IMAGE_TENANT_MISMATCH",
  "CANONICAL_LISTING_ASSET_NOT_FOUND",
  "CANONICAL_ORIGINAL_IMAGE_MISSING",
  "CANONICAL_VERIFIED_IMAGE_SET_INCOMPLETE",
  "IMAGE_GENERATION_STALE",
  "LISTING_ASSET_NOT_FOUND",
  "NO_VERIFIED_STORAGE_IMAGES",
  "STALE_IMAGE_GENERATION",
  "STORAGE_UPLOAD_OBJECT_PATH_OUT_OF_SCOPE",
  "VERIFIED_IMAGE_SET_INCOMPLETE",
  "VERIFIED_IMAGE_SET_MANIFEST_INVALID"
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

export function normalizeAssetLifecycleCode(value) {
  return cleanText(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 160);
}

export function stripClientImageTransport(value = {}) {
  const scoped = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
  for (const key of clientForbiddenImageTransportKeys) delete scoped[key];
  return scoped;
}

export function normalizeImageGenerationId(value) {
  const generationId = cleanText(value);
  if (!durableAssetIdPattern.test(generationId)) {
    throw new AssetLifecycleContractError("canonical_image_generation_missing", {
      statusCode: 400,
      recoveryAction: assetRecoveryActions.INPUT_REBIND
    });
  }
  return generationId;
}

export function requestedImageGenerationId(value = {}) {
  const payload = value?.payload && typeof value.payload === "object" && !Array.isArray(value.payload)
    ? value.payload
    : {};
  return normalizeImageGenerationId(
    value?.image_generation_id
    || value?.imageGenerationId
    || payload.image_generation_id
    || payload.imageGenerationId
  );
}

export class AssetLifecycleContractError extends Error {
  constructor(code, {
    statusCode = 409,
    retryable = false,
    recoveryAction = assetRecoveryActions.INPUT_REBIND,
    cause = null
  } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = "AssetLifecycleContractError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.recoveryAction = recoveryAction;
  }
}

export function assertMatchingImageGeneration({ requestedGenerationId, canonicalGenerationId } = {}) {
  const requested = normalizeImageGenerationId(requestedGenerationId);
  const canonical = normalizeImageGenerationId(canonicalGenerationId);
  if (requested !== canonical) {
    throw new AssetLifecycleContractError("canonical_image_generation_stale", {
      statusCode: 409,
      retryable: false,
      recoveryAction: assetRecoveryActions.INPUT_REBIND
    });
  }
  return canonical;
}

export function classifyAssetLifecycleFailure(error = {}) {
  const input = error && typeof error === "object" ? error : { message: String(error || "") };
  const code = normalizeAssetLifecycleCode(input.code || input.error_code || input.type || input.message);
  const message = cleanText(input.message || input.error).toLowerCase();
  const explicitRecoveryAction = cleanText(input.recovery_action || input.recoveryAction).toUpperCase();
  const isInputStateFailure = explicitRecoveryAction === assetRecoveryActions.INPUT_REBIND
    || inputRebindCodes.has(code)
    || /canonical_(?:image|asset).*(?:mismatch|missing|stale|incomplete|out_of_scope)/.test(message)
    || /verified_image_set_(?:incomplete|manifest_invalid)/.test(message)
    || /storage_upload_object_path_out_of_scope/.test(message);
  if (isInputStateFailure) {
    return {
      code: code || "INPUT_STATE_INVALID",
      recovery_action: assetRecoveryActions.INPUT_REBIND,
      retryable: false
    };
  }
  return {
    code,
    recovery_action: assetRecoveryActions.NONE,
    retryable: null
  };
}
