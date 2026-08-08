import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assetSingleFlightKey,
  assetSingleFlightActive,
  claimAssetSingleFlight,
  nextRetrySubmissionId,
  resetAssetSingleFlight
} from "../app/asset-single-flight.mjs";

assert.equal(
  assetSingleFlightKey({ durableAssetId: "", clientAssetRef: "asset-7" }, 7),
  "asset-7",
  "an asset-create failure must remain retryable before a canonical id exists"
);
assert.equal(
  assetSingleFlightKey({ durableAssetId: "asset_00000007-0000-4000-8000-000000000007", clientAssetRef: "asset-7" }, 7),
  "asset-7",
  "a durable id arriving mid-flight must not change the browser claim identity"
);
assert.notEqual(
  assetSingleFlightKey({ clientAssetRef: "asset-7", lifecycleGeneration: 1 }, 7),
  assetSingleFlightKey({ clientAssetRef: "asset-7", lifecycleGeneration: 2 }, 7),
  "reusing a browser asset label after reset must not join an older lifecycle"
);

// The durable id is written by the operation itself. A second click after
// that write must still join the claim that began under browser identity.
{
  resetAssetSingleFlight();
  const asset = { clientAssetRef: "asset-lifecycle", durableAssetId: "" };
  let release;
  let runs = 0;
  const first = claimAssetSingleFlight("retry", assetSingleFlightKey(asset), async () => {
    runs += 1;
    asset.durableAssetId = "asset_00000008-0000-4000-8000-000000000008";
    return new Promise((resolve) => { release = resolve; });
  });
  await Promise.resolve();
  const second = claimAssetSingleFlight("retry", assetSingleFlightKey(asset), () => {
    runs += 1;
    return Promise.resolve("duplicate");
  });
  assert.equal(second.joined, true);
  assert.equal(first.promise, second.promise);
  assert.equal(runs, 1);
  release("done");
  assert.equal(await second.promise, "done");
}

// COS-51's headline case: two rapid clicks must produce exactly ONE submission.
{
  resetAssetSingleFlight();
  let runs = 0;
  let release;
  const operation = () => {
    runs += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  // Both claims happen in the same synchronous turn -- no await between them,
  // which is the situation a double-click creates and the situation a rerender
  // guard cannot see.
  const first = claimAssetSingleFlight("retry", "asset_a", operation);
  const second = claimAssetSingleFlight("retry", "asset_a", operation);
  await Promise.resolve();
  assert.equal(runs, 1, "a second claim must not start a second operation");
  assert.equal(first.joined, false);
  assert.equal(second.joined, true, "the second claim must report that it joined");
  assert.equal(first.promise, second.promise, "both callers await the same result");
  release("done");
  assert.equal(await second.promise, "done", "the joining caller receives the result, not an error");
}

// The claim is registered before the operation's first await, so a claim made
// from inside the operation itself still sees it. Registering after invoking
// leaves exactly the synchronous window this replaces.
{
  resetAssetSingleFlight();
  let inner = null;
  const outer = claimAssetSingleFlight("prepare_images", "asset_b", async () => {
    inner = claimAssetSingleFlight("prepare_images", "asset_b", () => Promise.resolve("second"));
    return "first";
  });
  assert.equal(await outer.promise, "first");
  assert.equal(inner.joined, true, "a reentrant claim must join, never start a second run");
  assert.equal(inner.promise, outer.promise, "a reentrant claim must receive the live shared promise, never null");
  assert.equal(await inner.promise, "first");
}

// A failed attempt must release the asset, or one failure locks the card out of
// every future retry -- the deadlock this issue is about, moved one layer down.
{
  resetAssetSingleFlight();
  const failing = claimAssetSingleFlight("retry", "asset_c", () => Promise.reject(new Error("boom")));
  await assert.rejects(failing.promise, /boom/);
  assert.equal(assetSingleFlightActive("retry", "asset_c"), false, "a terminal failure releases the claim");
  let ran = false;
  const retry = claimAssetSingleFlight("retry", "asset_c", () => { ran = true; return Promise.resolve("ok"); });
  assert.equal(await retry.promise, "ok");
  assert.ok(ran, "the asset must be retryable after a failure");
}

// A synchronous throw is normalized to a rejected shared promise and must not
// leave a claim behind either.
{
  resetAssetSingleFlight();
  const failed = claimAssetSingleFlight("retry", "asset_d", () => { throw new Error("sync"); });
  await assert.rejects(failed.promise, /sync/);
  assert.equal(assetSingleFlightActive("retry", "asset_d"), false, "a synchronous throw releases the claim");
}

// Success keeps no claim, and different assets and scopes never collapse into
// each other -- a batch must stay parallel.
{
  resetAssetSingleFlight();
  const done = claimAssetSingleFlight("retry", "asset_e", () => Promise.resolve(1));
  await done.promise;
  assert.equal(assetSingleFlightActive("retry", "asset_e"), false);

  let runs = 0;
  const op = () => { runs += 1; return new Promise(() => {}); };
  claimAssetSingleFlight("retry", "asset_f", op);
  claimAssetSingleFlight("retry", "asset_g", op);
  claimAssetSingleFlight("prepare_images", "asset_f", op);
  await Promise.resolve();
  assert.equal(runs, 3, "distinct assets and distinct scopes are independent");
}

// Two clicks in the same millisecond must not share a submission id by
// accident. Only the call that actually starts work ever mints one.
{
  const ids = new Set([
    nextRetrySubmissionId("asset_h"),
    nextRetrySubmissionId("asset_h"),
    nextRetrySubmissionId("asset_h")
  ]);
  assert.equal(ids.size, 3, "submission ids must be unique without depending on the clock");
}

// The product must actually use it, and must disable the control synchronously.
// A guard that exists but is not wired is the failure mode this whole issue is
// an instance of.
const js = await readFile("app/listing-copilot.js", "utf8");
assert.match(js, /claimAssetSingleFlight\("retry"/, "the retry control must be single-flighted");
assert.match(js, /button\.disabled = true;\s*\n\s*button\.setAttribute\("aria-busy", "true"\)/,
  "the clicked control must be disabled synchronously, before any await");
assert.match(js, /retry_submission_id: retrySubmissionId/,
  "the retry must carry a stable submission key to the server");
assert.match(js, /claimAssetSingleFlight\("retry", assetSingleFlightKey\(asset, assetIndex\)/,
  "a failure before durable asset creation must still have a stable retry key");
assert.doesNotMatch(js, /claimAssetSingleFlight\("retry", canonicalAssetId\(asset\)/,
  "retry dispatch must not throw while trying to key an asset-creation failure");
assert.match(js, /if \(!result \|\| !asset \|\| result\.feedbackStatus === "saving" \|\| writerFeedbackPersisted\(result\)\) return false;/,
  "a rapid second Accept must not submit the same feedback request twice");

const beforeUnloadHandler = js.slice(js.indexOf('globalThis.window?.addEventListener("beforeunload"'));
for (const inFlightState of [
  "state.processing",
  "state.preparingFiles",
  "state.retryInFlight > 0",
  "state.writerSaveInFlight",
  "state.exportingWorkbook"
]) {
  assert.match(beforeUnloadHandler, new RegExp(inFlightState.replace(/[.>]/g, "\\$&")),
    `${inFlightState} must keep the browser from silently discarding in-flight work`);
}
assert.match(beforeUnloadHandler, /state\.results\.some\(\(result\) => \{\s*return !writerFeedbackPersisted\(result\);/,
  "a failed card without a title is still unresolved work and must not be silently discarded");

// The image-preparation memo must be claimed BEFORE the first await. This is
// the actual production defect: the memo existed, but two callers both reached
// it while it was still unset and both signed the same immutable object path.
const prepare = js.slice(
  js.indexOf("function ensureAssetOriginalImagesUploaded"),
  js.indexOf("function syncBackgroundPreparationStatus")
);
assert.ok(prepare.length > 0, "the image preparation entry point must remain present");
// Comments in this function DESCRIBE the await that used to precede the memo,
// so a raw indexOf("await ") finds prose and fails a correct implementation.
// Strip comments before asking where the first real await is.
const prepareCode = prepare
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const memoIndex = prepareCode.indexOf("if (asset.originalStorageUploadPromise) return asset.originalStorageUploadPromise;");
const firstAwaitIndex = prepareCode.indexOf("await ");
assert.ok(memoIndex >= 0, "the per-asset preparation memo must remain");
assert.ok(memoIndex < firstAwaitIndex,
  "the preparation claim must precede every await, or two callers race into one object path");
assert.doesNotMatch(prepare, /^async function ensureAssetOriginalImagesUploaded/,
  "the entry point must be synchronous up to the claim");

process.stdout.write("asset single flight: ok\n");
