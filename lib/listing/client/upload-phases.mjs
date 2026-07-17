function firstFailedOutcome(outcomes = []) {
  return (Array.isArray(outcomes) ? outcomes : []).find((outcome) => outcome?.ok === false) || null;
}

/**
 * Originals are the recognition start barrier. Derived crops start only after
 * originals, but their completion is deliberately returned as a sidecar
 * promise so a slow crop cannot block pre-ingestion or queue submission.
 */
export async function startNonBlockingDerivedUpload({
  entries = [],
  isDerived,
  uploadPhase,
  beforeDerived
} = {}) {
  if (typeof isDerived !== "function") throw new TypeError("isDerived is required");
  if (typeof uploadPhase !== "function") throw new TypeError("uploadPhase is required");

  const source = Array.isArray(entries) ? entries : [];
  const originals = source.filter((entry) => !isDerived(entry));
  const derived = source.filter((entry) => isDerived(entry));
  const originalOutcomes = await uploadPhase(originals);
  const failedOriginal = firstFailedOutcome(originalOutcomes);
  if (failedOriginal) throw failedOriginal.error || new Error("original_image_upload_failed");

  await beforeDerived?.({ originals, derived, originalOutcomes });
  const derivedPromise = derived.length
    ? Promise.resolve().then(() => uploadPhase(derived))
    : Promise.resolve([]);

  return {
    originals,
    derived,
    originalOutcomes,
    derivedPromise
  };
}

export function summarizeDerivedUploadOutcomes(outcomes = []) {
  const source = Array.isArray(outcomes) ? outcomes : [];
  const failed = source.filter((outcome) => outcome?.ok === false);
  return {
    total: source.length,
    uploaded: source.filter((outcome) => outcome?.uploaded === true).length,
    failed: failed.length,
    status: !source.length ? "not_required" : failed.length ? "partial" : "ready",
    first_error: failed[0]?.error || null
  };
}
