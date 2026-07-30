import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INTAKE_PREVIEW_CARD_WINDOW,
  claimNextBatchAsset,
  groupIntakeFileSlots,
  windowIntakePreviewGroups
} from "../lib/listing/client/batch-recognition-intent.mjs";

const source = await readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8");

assert.match(
  source,
  /elements\.processButton\.disabled = !canGenerateTitles\(\)[\s\S]{0,220}state\.writerIntakeCommitInFlight[\s\S]{0,120}state\.writerSaveInFlight[\s\S]{0,120}state\.exportingWorkbook/,
  "file preparation must not block committing recognition intent"
);
assert.match(
  source,
  /function interactionLocksForState[\s\S]*writer_mutation: writerMutation[\s\S]*destructive_transition: preparation/,
  "preparation, writer mutation and destructive transition need independent lock ownership"
);
assert.match(
  source,
  /beginWriterIntakeSelection\(expectedCardGroupCount\(imageFiles\.length\)\)/,
  "the declared batch size must come from the complete file selection before progressive parsing"
);
const processTitlesSource = source.slice(
  source.indexOf("async function processTitles"),
  source.indexOf("function successorClientAssetRef")
);
assert.ok(
  processTitlesSource.indexOf("await commitWriterIntakeSelection()") < processTitlesSource.indexOf("state.processing = true"),
  "the server-owned intake batch must commit before any paid recognition worker can start"
);
const queueSource = source.slice(
  source.indexOf("async function processAssetViaQueue"),
  source.indexOf("function failedResult")
);
assert.ok(
  queueSource.indexOf("await ensureWriterIntakeItemAppended(asset)") < queueSource.indexOf("fetchJsonWithRetry(JOB_ENQUEUE_API_ENDPOINT"),
  "each item must be durably declared before its recognition enqueue"
);
assert.match(
  source,
  /state\.writerIntakeItemsByPosition = new Map\([\s\S]*payload\.items/,
  "the atomic commit response must hydrate every predeclared position"
);
assert.ok(
  source.indexOf("state.writerIntakeItemsByPosition.get(Number(asset.index))")
    < source.indexOf('fetchWriterIntakeMutation("APPEND_ITEM"'),
  "the normal path must consume atomic stubs without one APPEND request per card"
);
assert.match(queueSource, /writer_intake_batch_id:\s*asset\.writerIntakeBatchId/);
assert.match(queueSource, /writer_intake_item_id:\s*asset\.writerIntakeItemId/);
assert.match(queueSource, /writer_intake_previous_queue_job_id:\s*asset\.writerIntakeQueueJobId \|\| null/);
assert.doesNotMatch(source, /function bindWriterIntakeItemToQueue|function scheduleWriterIntakeAdmissionRecovery/,
  "the browser must not synchronously write or retry a reconstructible queue projection");
assert.match(
  queueSource,
  /asset\.writerIntakeQueueJobId = job\.job_id;[\s\S]*asset\.writerIntakeState = "QUEUE_PROJECTION_PENDING"[\s\S]*writer_intake_recovery_required = false/,
  "the browser must retain the canonical retry pointer while leaving projection repair to Worker and status"
);
assert.match(
  queueSource,
  /asset\.recognitionBatchId = batchId;[\s\S]*fetchJsonWithRetry\(JOB_ENQUEUE_API_ENDPOINT/,
  "the queue idempotency token must be retained before the response can be lost"
);
assert.match(
  source,
  /batchId: retriesFailedDurableJob[\s\S]*\(asset\.recognitionBatchId \|\| createClientBatchId\(\)\)/,
  "an uncertain pre-enqueue failure must replay the original deterministic token instead of creating a duplicate paid job"
);
assert.match(
  source,
  /Math\.max\(1, Math\.min\(3, Math\.trunc\(Number\(maxAttempts\) \|\| 1\)\)\)/,
  "writer intake mutations must use a bounded retry count"
);
assert.match(
  source,
  /JSON\.stringify\(\{ batch_id, idempotency_key \}\)/,
  "browser persistence must retain only the batch id and idempotency key"
);
assert.match(source, /return `\$\{prefix\}\.\$\{namespace\}`;/, "local recovery pointers must be scoped to the authenticated principal hash");
assert.match(source, /removeItem\(WRITER_INTAKE_POINTER_STORAGE_KEY\)/, "the unsafe legacy global pointer must be discarded after principal verification");
const commitSource = source.slice(
  source.indexOf("async function commitWriterIntakeSelection"),
  source.indexOf("function writerIntakeItemFromPayload")
);
assert.ok(
  commitSource.indexOf("persistWriterIntakePointer({") < commitSource.indexOf('fetchWriterIntakeMutation("COMMIT_BATCH"'),
  "the recovery key must survive a committed response that never reaches the browser"
);
assert.match(
  source,
  /idempotency_key=\$\{encodeURIComponent\(pointer\.idempotency_key\)\}/,
  "a pointer without a batch id must recover the deterministic server batch by key"
);
const abandonSource = source.slice(
  source.indexOf("async function abandonPreviousWriterIntakeBeforeSelection"),
  source.indexOf("async function commitWriterIntakeSelection")
);
assert.match(
  abandonSource,
  /fetchWriterIntakeMutation\("ABANDON_BATCH", \{\s*batch_id: batchId\s*\}\)/,
  "the browser may abandon only by the persisted batch identity"
);
assert.doesNotMatch(
  abandonSource,
  /status:|updated_at:|last_error_code:|asset_id:|queue_job_id:|recognition_session_id:/,
  "the browser must never manufacture batch-abandonment lifecycle truth"
);
const handleFilesSource = source.slice(
  source.indexOf("async function handleFiles"),
  source.indexOf("async function processAssetViaQueue")
);
assert.ok(
  handleFilesSource.indexOf("await abandonPreviousWriterIntakeBeforeSelection()")
    < handleFilesSource.indexOf("beginWriterIntakeSelection(expectedCardGroupCount(imageFiles.length))"),
  "a replacement selection must settle the prior denominator before dropping its recovery pointer"
);
assert.match(
  handleFilesSource,
  /catch \{[\s\S]{0,220}原批次恢复指针仍已保留。[\s\S]{0,80}return;/,
  "an abandon failure must retain the prior recovery pointer and stop replacement"
);
assert.match(handleFilesSource, /confirmPendingWorkspaceTransition\(/, "replacement must use the same explicit pending-work confirmation boundary");
assert.match(abandonSource, /preserveWriterIntakeRecoveryPointer\(/, "confirmed replacement must retain a canonical recovery pointer for the old batch");
const resetSource = source.slice(source.indexOf("async function resetTool"), source.indexOf("function bindEvents"));
assert.ok(
  resetSource.indexOf("await abandonPreviousWriterIntakeBeforeSelection()")
    < resetSource.indexOf("clearWriterIntakePointer()"),
  "reset must not discard a committed recovery pointer before server abandonment"
);
const modeChangeSource = source.slice(
  source.indexOf("document.querySelectorAll(\"input[name='assetMode']\")"),
  source.indexOf("[\"dragenter\", \"dragover\"]")
);
assert.ok(
  modeChangeSource.indexOf("await abandonPreviousWriterIntakeBeforeSelection()")
    < modeChangeSource.indexOf("beginWriterIntakeSelection(expectedCardGroupCount(state.files.length, state.mode))"),
  "mode regrouping must close the old frozen denominator before creating a new one"
);
assert.match(modeChangeSource, /confirmPendingWorkspaceTransition\(/, "mode regrouping must not silently discard a running or unsaved result");
assert.match(
  source,
  /input\.checked = input\.value === state\.mode;[\s\S]{0,120}input\.disabled = destructiveInteractionLocked/,
  "pair-mode controls must be disabled and resynchronized during destructive locks"
);
assert.match(
  modeChangeSource,
  /if \(destructiveTransitionInteractionLocked\(\) \|\| state\.processing\) \{[\s\S]{0,120}updateWorkspaceModeUi\(\);/,
  "a change event delivered during preparation or processing must roll the browser radio back to state.mode"
);
assert.match(
  source,
  /writer_intake_batch_id:\s*asset\.writerIntakeBatchId[\s\S]*writer_intake_item_id:\s*asset\.writerIntakeItemId[\s\S]*writer_intake_previous_queue_job_id:\s*asset\.writerIntakeQueueJobId \|\| null[\s\S]*enqueue_workers:\s*authorizePaidSensors/,
  "paid pre-ingestion must carry the committed server intake authorization"
);
assert.match(
  commitSource,
  /Number\(payload\?\.item_count\) !== expectedItemCount[\s\S]*state\.writerIntakeItemsByPosition\.size !== expectedItemCount/,
  "the browser must fail closed unless the atomic response contains the full declared denominator"
);
assert.doesNotMatch(
  source,
  /JSON\.stringify\(\{ batch_id, idempotency_key,[^}]+\}\)/,
  "browser persistence must not retain images, titles, truth labels, or secrets beyond the idempotency pointer"
);
assert.match(
  source,
  /浏览器不会保存本地原图；需要补传时请重新选择图片/,
  "read-only resume copy must not pretend that a lost browser File can be recovered"
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
assert.match(
  source,
  /if \(!images\.length\) \{[\s\S]{0,180}writerIntakeUnusablePositions\.set\(group\.index/,
  "a fully unreadable file group must retain its frozen batch position"
);
assert.match(
  handleFilesSource,
  /groupIntakeFileSlots\(imageFiles, state\.mode\)[\s\S]*pairedGroupIncomplete[\s\S]{0,520}PAIRED_IMAGE_GROUP_INCOMPLETE[\s\S]{0,260}CANCEL_ITEM/,
  "a half-decoded pair must be cancelled instead of entering the single-image path"
);
const mixedPairSelection = groupIntakeFileSlots([
  { name: "card-1-front.jpg" },
  { name: "card-1-back.unsupported" },
  { name: "card-2-front.jpg" },
  { name: "card-2-back.jpg" }
], "pair");
assert.deepEqual(
  mixedPairSelection.map((group) => group.files.map((file) => file.name)),
  [
    ["card-1-front.jpg", "card-1-back.unsupported"],
    ["card-2-front.jpg", "card-2-back.jpg"]
  ],
  "invalid slots must remain in their original pair so later cards cannot shift forward"
);
assert.match(
  handleFilesSource,
  /state\.mode === "pair" \? candidates : candidates\.filter\(isSupportedImageFile\)/,
  "pair grouping must happen before image-format filtering"
);
assert.match(
  processTitlesSource,
  /state\.processingTotal = state\.writerIntakeExpectedItemCount/,
  "progress and completion must use the denominator frozen before paid work"
);
assert.match(
  source,
  /writerIntakeUnusablePositions\.set\(group\.index[\s\S]{0,260}state\.writerIntakeBatchId[\s\S]{0,220}settleWriterIntakePosition\(group\.index, "CANCEL_ITEM"\)/,
  "a file group that fails after an early click must settle its already-committed position"
);
assert.ok(
  processTitlesSource.indexOf("await settleUnusableWriterIntakePositions()")
    < processTitlesSource.indexOf("state.processing = true"),
  "unreadable positions must reach a durable terminal disposition before paid work starts"
);
const settlementSource = source.slice(
  source.indexOf("async function settleWriterIntakePosition"),
  source.indexOf("function fileExtension")
);
assert.doesNotMatch(
  settlementSource,
  /status:|failed_at:|failure_code:/,
  "the browser must not manufacture intake lifecycle truth"
);
assert.match(
  processTitlesSource,
  /catch \(error\) \{[\s\S]*await recordWriterIntakeAssetFailure\(asset\)/,
  "an exhausted pre-queue asset failure must not leave a permanent DECLARED row"
);
assert.ok(
  processTitlesSource.lastIndexOf("await settleUnusableWriterIntakePositions()")
    > processTitlesSource.indexOf("await Promise.all(Array.from({ length: workerCount }, worker))"),
  "progressive groups discovered after click need a final idempotent settlement pass"
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
