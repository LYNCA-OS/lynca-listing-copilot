export const WRITER_IMAGE_INTAKE_CONTRACT_VERSION = "writer-image-intake-v1";
export const SIGNED_UPLOAD_URL_GENERATION_LIMIT = 2;

const retryableSignedUploadStatuses = new Set([401, 403, 408, 425, 429, 500, 502, 503, 504]);

export function shouldRefreshSignedUpload({ generation = 1, status = 0, networkError = false } = {}) {
  if (Number(generation) >= SIGNED_UPLOAD_URL_GENERATION_LIMIT) return false;
  if (networkError) return true;
  return retryableSignedUploadStatuses.has(Number(status));
}
