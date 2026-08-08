// One in-flight operation per asset, claimed atomically.
//
// COS-51. The existing duplicate-click defence was `result.retryStatus` plus a
// rerender, and a global `state.retryInFlight` counter. Both are real, and
// neither is a single-flight:
//
//   * `retryStatus` guards the BUTTON. Image preparation is also reached from
//     background preparation and from the initial file handling, which never
//     look at it -- so a retry overlapping a background prepare produces two
//     preparations of the same asset, both signing the same deterministic
//     object path. That is a collision before any model call, which is exactly
//     what the production reproduction shows ("模型未启动" alongside
//     `resource already exists`).
//
//   * `retryInFlight` is a COUNT. It can say "something is retrying"; it can
//     never say "this asset is already being prepared", which is the question
//     that matters.
//
// A claim here is atomic in the only sense that matters in a single-threaded
// event loop: the registry is written before the first `await`, so any later
// event -- the second half of a double-click, a delegated handler firing on a
// re-rendered button, a programmatic retry -- observes the claim and joins the
// existing promise instead of starting a second operation.
//
// Joining, not rejecting. A second click means the operator wants the result,
// so they get the same result. Rejecting would surface a spurious error for an
// action that is in fact underway.

const registry = new Map();

const normalizeKey = (scope, assetKey) => `${String(scope || "op")}:${String(assetKey ?? "")}`;

/**
 * A retry can be needed before durable asset creation succeeds. Keep the
 * browser identity stable across that transition; use the canonical id only
 * when no browser identity exists.
 */
export function assetSingleFlightKey(asset = {}, fallback = "asset") {
  // Browser identity is created before any durable server identity and remains
  // immutable for the asset's whole lifecycle. If we switched to the durable
  // id when it arrived, a second click could use a different registry key and
  // bypass the still-running claim that created it.
  const browserAssetId = String(asset.clientAssetRef || asset.id || "").trim();
  if (browserAssetId) {
    const generation = Number(asset.lifecycleGeneration);
    return Number.isInteger(generation) && generation >= 0
      ? `${browserAssetId}@${generation}`
      : browserAssetId;
  }
  const durableAssetId = String(asset.durableAssetId || "").trim();
  if (/^asset_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(durableAssetId)) {
    return durableAssetId;
  }
  return String(fallback).trim() || "asset";
}

/**
 * Run `operation` for this asset, or join the one already running.
 *
 * @param scope    what is being single-flighted ("retry", "prepare_images")
 * @param assetKey stable per-asset identity
 * @param operation () => Promise
 * @returns {{promise: Promise, joined: boolean}} `joined` is true when this
 *          call attached to an existing operation and started nothing.
 */
export function claimAssetSingleFlight(scope, assetKey, operation) {
  const key = normalizeKey(scope, assetKey);
  const existing = registry.get(key);
  if (existing) return { promise: existing.promise, joined: true };

  // Defer invocation by one microtask so the entry can hold its final shared
  // promise before operation code runs. Without this, a synchronous reentrant
  // claim observes the registry entry while its promise is still null.
  const entry = { promise: null };
  const operationPromise = Promise.resolve().then(operation);
  // Released only on a terminal outcome, success or failure, so a failed
  // attempt does not leave the asset permanently claimed.
  entry.promise = operationPromise.finally(() => {
    if (registry.get(key) === entry) registry.delete(key);
  });
  registry.set(key, entry);
  return { promise: entry.promise, joined: false };
}

/** Is an operation of this scope already running for this asset? */
export function assetSingleFlightActive(scope, assetKey) {
  return registry.has(normalizeKey(scope, assetKey));
}

/** Test/reset seam. Never called in the product flow. */
export function resetAssetSingleFlight() {
  registry.clear();
}

/**
 * A stable id for one operator retry action.
 *
 * COS-51 asks for one `retry_submission_id` per user action so the server can
 * be idempotent for the same tenant + asset + image + intent + submission key.
 * Derived from the asset and a monotonic counter rather than a timestamp: two
 * clicks in the same millisecond must not share an id by accident, and must not
 * get different ids either -- the collapse happens in the registry above, so
 * only the call that actually starts work ever mints one.
 */
let submissionSequence = 0;
export function nextRetrySubmissionId(assetKey) {
  submissionSequence += 1;
  return `retry_${String(assetKey ?? "asset")}_${submissionSequence}`;
}
