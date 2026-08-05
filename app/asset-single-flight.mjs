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

  // The entry is registered BEFORE `operation` is invoked. Invoking first and
  // registering after leaves a synchronous window in which a second call sees
  // an empty registry -- the same shape of hole this replaces.
  let promise;
  const entry = { promise: null };
  registry.set(key, entry);
  try {
    promise = Promise.resolve(operation());
  } catch (error) {
    registry.delete(key);
    throw error;
  }
  // Released only on a terminal outcome, success or failure, so a failed
  // attempt does not leave the asset permanently claimed.
  entry.promise = promise.finally(() => {
    if (registry.get(key) === entry) registry.delete(key);
  });
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
