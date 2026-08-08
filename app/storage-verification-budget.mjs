const BASE_TIMEOUT_MS = 3_500;
const DIRECT_PATH_THRESHOLD_BYTES = 3_200_000;
const EXTRA_TIMEOUT_MS_PER_MEGABYTE = 1_000;
const MAX_TIMEOUT_MS = 18_000;

export function storageVerificationTimeoutMs(imageSizes = []) {
  const maxBytes = Math.max(
    0,
    ...imageSizes.map((size) => Math.max(0, Number(size) || 0))
  );
  const excessBytes = Math.max(0, maxBytes - DIRECT_PATH_THRESHOLD_BYTES);
  const extraMegabytes = Math.ceil(excessBytes / 1_000_000);
  return Math.min(
    MAX_TIMEOUT_MS,
    BASE_TIMEOUT_MS + extraMegabytes * EXTRA_TIMEOUT_MS_PER_MEGABYTE
  );
}

