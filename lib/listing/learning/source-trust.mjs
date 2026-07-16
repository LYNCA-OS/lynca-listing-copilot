const trustedStorageVerificationImages = new WeakSet();
const trustedSupabaseDailyBundles = new WeakSet();

export function markTrustedStorageVerificationImage(image) {
  if (image && typeof image === "object") trustedStorageVerificationImages.add(image);
  return image;
}

export function isTrustedStorageVerificationImage(image) {
  return Boolean(image && typeof image === "object" && trustedStorageVerificationImages.has(image));
}

export function markTrustedSupabaseDailyBundle(bundle) {
  if (bundle && typeof bundle === "object") trustedSupabaseDailyBundles.add(bundle);
  return bundle;
}

export function isTrustedSupabaseDailyBundle(bundle) {
  return Boolean(bundle && typeof bundle === "object" && trustedSupabaseDailyBundles.has(bundle));
}
