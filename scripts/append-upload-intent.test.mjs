import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { claimNextBatchAsset } from "../lib/listing/client/batch-recognition-intent.mjs";

const source = await readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
const handleFilesSource = source.slice(
  source.indexOf("async function handleFiles("),
  source.indexOf("function failedResult(")
);
const processTitlesSource = source.slice(
  source.indexOf("async function processTitles("),
  source.indexOf("function successorClientAssetRef(")
);

assert.doesNotMatch(
  handleFilesSource,
  /if \(state\.preparingFiles\)[\s\S]{0,180}return;/,
  "a second intake must not be discarded while the first intake is decoding"
);
assert.match(source, /let fileIntakeTail = Promise\.resolve\(\)/);
assert.match(
  source,
  /function queueFileIntake[\s\S]{0,600}fileIntakeTail[\s\S]{0,180}while \(destructiveWorkspaceInteractionLocked\(\)\) await wait\(50\)[\s\S]{0,120}handleFiles\(files, options, dependencies\)/,
  "file selections must be snapshotted and serialized into the same upload intent"
);
assert.match(
  source,
  /const files = \[\.\.\.event\.target\.files\];[\s\S]{0,80}event\.target\.value = "";[\s\S]{0,100}queueFileIntake\(files/,
  "the file input must reset so selecting the same files again still emits change"
);

assert.doesNotMatch(
  handleFilesSource,
  /if \(destructiveWorkspaceInteractionLocked\(\) \|\| state\.processing\)/,
  "recognition in progress must not reject a later file selection"
);
assert.match(
  source,
  /const lifecycleGeneration = batchWasEmpty[\s\S]{0,120}\? \+\+state\.assetLifecycleGeneration[\s\S]{0,80}: state\.assetLifecycleGeneration/,
  "later selections must inherit the workspace lifecycle"
);
assert.match(
  source,
  /const firstAssetIndex = state\.assets\.reduce[\s\S]{0,140}\+ 1/,
  "appended cards must receive indexes after existing assets"
);
assert.match(
  source,
  /const backgroundRunId = batchWasEmpty[\s\S]{0,160}: state\.backgroundPreparationRunId \|\| beginBackgroundPreparationRun\(\)/,
  "append intake must not invalidate in-flight background preparation"
);
assert.match(source, /function hasAssetsAwaitingRecognition\(\)/);
assert.match(
  processTitlesSource,
  /const completedAssetIndexes = new Set\(state\.results\.map/,
  "incremental runs must preserve earlier result indexes"
);
assert.match(
  processTitlesSource,
  /const claimedAssetIndexes = new Set\(completedAssetIndexes\)/,
  "incremental runs must preserve results and skip already completed assets"
);
assert.doesNotMatch(
  processTitlesSource,
  /state\.results = \[\]/,
  "starting an incremental run must not clear earlier results"
);
assert.match(source, /已追加 \$\{imageFiles\.length\} 张图片；正在延续当前识别任务并后台留存原图/);
assert.match(source, /elements\.processButton\.addEventListener\("click", processTitles\)/);
assert.match(
  handleFilesSource,
  /if \(batchWasEmpty\) renderInstantIntakePreviews\(intakePreviewRecords\)/,
  "appending files must not replace already editable title cards with intake previews"
);
assert.match(
  handleFilesSource,
  /preserveFocusedTitleInput:\s*!batchWasEmpty/,
  "append completion must preserve an active title editor and IME composition"
);
assert.match(
  source,
  /button\.disabled = interactionLocked \|\| state\.preparingFiles/,
  "destructive workspace mode switches must be locked while an append intake is decoding"
);
assert.match(
  source,
  /if \(workspaceInteractionLocked\(\) \|\| state\.preparingFiles\) return;/,
  "the workspace mode handler must enforce the append-intake lock"
);
assert.match(
  source,
  /if \(destructiveWorkspaceInteractionLocked\(\) \|\| state\.processing \|\| state\.preparingFiles\) return;/,
  "single/pair mode changes must not invalidate an in-flight append intake"
);
assert.match(
  handleFilesSource,
  /requestRecognitionContinuation\(\{ lifecycleGeneration, filePreparationRunId \}\)/,
  "every completed or appended upload selection must automatically continue recognition"
);

const assets = Array.from({ length: 110 }, (_, offset) => ({ index: offset + 1 }));
const completedAssetIndexes = new Set(Array.from({ length: 10 }, (_, offset) => offset + 1));
const claimedAssetIndexes = new Set(completedAssetIndexes);
const incrementallyProcessed = [];
for (let asset = claimNextBatchAsset(assets, claimedAssetIndexes); asset; asset = claimNextBatchAsset(assets, claimedAssetIndexes)) {
  incrementallyProcessed.push(asset.index);
}
assert.deepEqual(
  incrementallyProcessed,
  Array.from({ length: 100 }, (_, offset) => offset + 11),
  "10 completed cards must stay intact while exactly the 100 appended cards are claimed"
);

console.log("append upload intent tests passed");
