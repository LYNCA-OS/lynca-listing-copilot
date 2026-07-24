import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INTAKE_PREVIEW_CARD_WINDOW,
  claimNextBatchAsset,
  windowIntakePreviewGroups
} from "../lib/listing/client/batch-recognition-intent.mjs";

const source = await readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8");

assert.match(
  source,
  /elements\.processButton\.disabled = !canGenerateTitles\(\)[\s\S]{0,160}state\.writerSaveInFlight[\s\S]{0,120}state\.exportingWorkbook/,
  "file preparation must not block committing recognition intent"
);
assert.match(
  source,
  /const workerCount = queueSubmissionConcurrencyLimit\(\);/,
  "the bounded submission pool must start even when only the first card is ready"
);
assert.match(source, /const claimedAssetIndexes = new Set\(\);/, "progressive intake must claim each card once");
assert.match(
  source,
  /claimNextBatchAsset\(state\.assets, claimedAssetIndexes\)/,
  "workers must consume cards that arrive after recognition intent was committed"
);
assert.match(
  source,
  /if \(state\.preparingFiles\) \{\s*await wait\(50\);\s*continue;/,
  "workers must keep the batch open while later images are still being prepared"
);
assert.doesNotMatch(source, /const queue = \[\.\.\.state\.assets\];/, "click-time snapshots strand later cards");
assert.match(
  source,
  /卡片已进入识别队列；后续图片准备完成后会自动加入。/,
  "writer-facing copy should expose one recognition queue"
);

const arrivingAssets = [{ index: 1 }];
const claimed = new Set();
const completed = [];
let intakeOpen = true;
let active = 0;
let maxActive = 0;

async function simulatedWorker() {
  while (true) {
    const asset = claimNextBatchAsset(arrivingAssets, claimed);
    if (!asset) {
      if (intakeOpen) {
        await new Promise((resolve) => setImmediate(resolve));
        continue;
      }
      return;
    }
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    completed.push(asset.index);
    active -= 1;
  }
}

const workers = [simulatedWorker(), simulatedWorker()];
for (let index = 2; index <= 100; index += 1) {
  arrivingAssets.push({ index });
  if (index % 5 === 0) await new Promise((resolve) => setImmediate(resolve));
}
intakeOpen = false;
await Promise.all(workers);

assert.equal(completed.length, 100, "all 100 progressively arriving cards should be processed");
assert.equal(new Set(completed).size, 100, "no card should be claimed twice");
assert.ok(maxActive <= 2, "the bounded worker pool must not exceed its configured concurrency");
const previewWindow = windowIntakePreviewGroups(arrivingAssets.map((asset) => [asset]));
assert.equal(previewWindow.visible.length, INTAKE_PREVIEW_CARD_WINDOW, "large intake should bound live preview DOM");
assert.equal(previewWindow.remaining, 100 - INTAKE_PREVIEW_CARD_WINDOW);

console.log("progressive batch intent tests passed");
