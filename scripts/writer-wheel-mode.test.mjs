import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  nextWriterOutstandingIndex,
  WRITER_EXPORT_MAX_ROWS,
  writerExportRowsReady,
  writerExportWithinLimit,
  writerFeedbackPersisted
} from "../app/writer-wheel-mode.mjs";

const html = await readFile("app/index.html", "utf8");
const loginHtml = await readFile("app/login.html", "utf8");
const registerHtml = await readFile("app/register.html", "utf8");
const js = await readFile("app/listing-copilot.js", "utf8");
const css = await readFile("app/workbench-v2.css", "utf8");
const sessionControls = await readFile("app/session-controls.js", "utf8");

assert.match(html, /<main class="workspace"[^>]*data-workspace-mode="standard"[^>]*data-batch-state="empty"/, "the product must expose one staged writer workspace");
assert.match(html, /data-workspace-mode="writer"/, "writer mode must remain additive to the full card view");
assert.match(html, /aria-label="工作模式"/, "workspace switching must expose an accessible group");
assert.match(html, /<section class="asset-workbench">/, "the single workspace must retain per-card review");
assert.match(html, /<section class="batch-titles-panel" aria-label="全部标题">/, "the single workspace must retain batch output");
assert.match(html, /data-theme-cycle/, "the product workspace must expose the reviewed theme control");
assert.match(loginHtml, /id="listingLoginForm"/, "product styling must retain the production password login contract");
assert.match(loginHtml, /id="username"/, "product styling must retain username login");
assert.doesNotMatch(loginHtml, /id="otpRequestForm"/, "the unverified OTP prototype must not enter production");
for (const id of ["inviteLoginHint", "inviteLoginSection", "inviteLoginLink"]) {
  assert.match(registerHtml, new RegExp(`id="${id}"`), `registration must retain ${id}`);
}
assert.doesNotMatch(sessionControls, /if \(!response\.ok \|\| !session\.authenticated\)/, "transient session errors must not force logout");

const feedbackSource = js.slice(
  js.indexOf("function pendingFeedbackSubmission"),
  js.indexOf("async function copyAllTitles")
);
assert.ok(feedbackSource.length > 0, "the writer feedback workflow must remain present");
assert.match(feedbackSource, /pendingFeedbackSubmissionId/, "feedback retries must retain a client-owned idempotency key");
assert.match(feedbackSource, /pendingFeedbackOccurredAt/, "feedback retries must retain the original client timestamp");
assert.match(feedbackSource, /feedback_submission_id: submission\.id/, "feedback must send the retained idempotency key");
assert.match(feedbackSource, /client_occurred_at: submission\.occurredAt/, "feedback must send the retained client timestamp");
assert.match(feedbackSource, /if \(feedbackRequest\.error\)[\s\S]*throw new Error/, "feedback must fail closed on a rejected persistence response");
assert.ok(
  feedbackSource.indexOf("clearPendingFeedbackSubmission(result, submission)")
    > feedbackSource.indexOf("payload.v4_persistence?.transaction?.saved !== true"),
  "the idempotency key must only clear after the database transaction is acknowledged"
);
assert.match(feedbackSource, /result\.persistenceStatus = "persisted";/, "the transaction acknowledgement must be the source of persisted state");
assert.match(feedbackSource, /catch \(error\)[\s\S]*result\.persistenceStatus = "failed";/, "failed persistence must leave the card retryable");
assert.match(feedbackSource, /async function saveTitleFeedback[\s\S]*const persisted = await saveFeedbackForResult\(result, asset,[\s\S]*return persisted/, "writer saves must return the persistence result");
assert.match(feedbackSource, /\(!correctedTitle && !explicitReject\)[\s\S]*return false/, "an empty title must fail locally unless the writer explicitly rejects the card");
assert.match(js, /event\.isComposing/, "Enter must not submit while an IME composition is active");
assert.doesNotMatch(js, /feedbackStatus = payload\.training_eligible/, "training eligibility must never decide whether an accepted title is treated as stored");

const directRecognitionSource = js.slice(
  js.indexOf("async function processAssetViaCsmThinPath"),
  js.indexOf("function backgroundPreparationAvailable")
);
assert.match(directRecognitionSource, /await ensureAssetPreparedForRecognition\(asset\)/, "recognition must wait for verified originals and their bounded automatic recovery");
assert.match(directRecognitionSource, /fetchJsonWithRetry\(CSM_THIN_API_ENDPOINT/, "recognition and retry must use the direct CSM boundary");
assert.match(directRecognitionSource, /asset_id: canonicalAssetId\(asset\)/, "recognition must bind the durable asset identity");
assert.doesNotMatch(directRecognitionSource, /\bimages\s*:|\bobject_path\s*:/, "recognition must not carry browser image transport fields");

// `retryFailedAsset` is synchronous as of COS-51 -- the single-flight claim
// must land before any await -- and the awaiting half moved to `runAssetRetry`,
// which follows it. Slice from the entry point through both.
const retrySource = js.slice(
  js.indexOf("function retryFailedAsset"),
  js.indexOf("async function copyTitle")
);
assert.match(retrySource, /retryStateForResult\(current \|\| \{\}\)/, "retry must apply the result recovery policy");
assert.match(retrySource, /resetAssetPreparationForRetry\(asset, \{[\s\S]*inputRebind: retryState\.input_rebind_required/, "an immutable-input conflict must rebind before retry");
assert.match(retrySource, /await processAssetViaCsmThinPath\(asset, \{[\s\S]*manualRetry:\s*true/, "retry must use the same direct CSM route");
assert.match(retrySource, /assetLifecycleMatches\(asset, lifecycleGeneration\)/, "a stale retry response must not overwrite a newer upload generation");
assert.doesNotMatch(retrySource, /JOB_RECOVERY_API_ENDPOINT|processAssetViaQueue|Cloud Run|v4_job_id/, "retry must not fall back to the retired queue or Cloud Run");

assert.match(js, /backgroundPreparationRunId/, "asynchronous image preparation must own a stale-run guard");
assert.match(js, /filePreparationRunId/, "file preparation must own an independent UI stale-run guard");
assert.match(js, /assetLifecycleGeneration/, "product interactions must retain the canonical image generation fence");
assert.match(js, /async function saveWriterTitleAndAdvance/, "writer mode must advance only through the persistence bridge");
assert.match(js, /persisted = await saveFeedbackForResult\(result, asset, \{ deferFinalRender: true \}\)/, "writer advance must await durable persistence");
assert.match(js, /titleSnapshotByIndex/, "writer export must freeze persisted titles before asynchronous uploads");
assert.match(js, /state\.retryInFlight/, "direct retry must participate in the workspace mutation lock");
assert.match(js, /function updateCorrectedTitle[\s\S]*result\.persistenceStatus = "";/, "editing a persisted title must reopen its persistence contract");
assert.match(css, /prefers-reduced-motion: reduce/, "writer transitions must respect reduced-motion preferences");
assert.match(css, /--wb-bg:/, "the writer workbench must own one coherent visual token layer");
assert.match(css, /\.writer-wheel/, "the workbench stylesheet must ship the writer wheel");
assert.match(js, /slice\(0, INTAKE_PREVIEW_CARD_WINDOW\)/, "the writer queue must expose at most eight outstanding cards");
assert.match(js, /writerQueueWindowHtml\(current\)/, "the writer wheel must replenish its bounded queue window");
assert.match(css, /\.writer-queue-window-list/, "the writer queue window must have a bounded visual rail");
assert.match(js, /kind: "queue-advance"/, "persisted cards should advance through one shared queue transition");
assert.match(js, /saveWriterTitleAndAdvance\(resultIndex, \{ animate: false \}\)/, "keyboard saves must stay instant");
assert.match(css, /data-workbench-transition="queue-advance"[\s\S]*animation-duration: var\(--duration-queue\)/, "queue movement must stay on the reviewed duration token");
assert.doesNotMatch(
  js.slice(js.indexOf("function renderWriterWheel"), js.indexOf("function renderAssetRows")),
  /writerPeekHtml\(/,
  "the bounded queue must not duplicate hidden wheel peeks"
);

const assets = [{ index: 1 }, { index: 2 }, { index: 3 }];
const savedOne = [{ index: 1, correctedTitle: "Saved title", feedbackStatus: "saved", persistenceStatus: "persisted" }];

assert.equal(
  writerExportRowsReady({ assets: [assets[0]], results: savedOne }),
  true,
  "a persisted writer card should be exportable without waiting for unrelated cards"
);
assert.equal(
  writerExportRowsReady({
    assets: [assets[0]],
    results: [{ index: 1, correctedTitle: "Unsaved title", feedbackStatus: "" }]
  }),
  false,
  "a title that has not been persisted must never enter the workbook"
);
assert.equal(
  writerExportRowsReady({
    assets: [assets[0]],
    results: [{ index: 1, correctedTitle: "Pending title", feedbackStatus: "saved", persistenceStatus: "persisted", writerTitlePending: true }]
  }),
  false,
  "a pending writer title must not be exported"
);
assert.equal(
  nextWriterOutstandingIndex({
    assets,
    results: [
      { index: 1, feedbackStatus: "saved", persistenceStatus: "persisted" },
      { index: 2, feedbackStatus: "" },
      { index: 3, feedbackStatus: "" }
    ],
    currentIndex: 1
  }),
  2,
  "successful persistence should advance to the next outstanding card"
);
assert.equal(
  nextWriterOutstandingIndex({
    assets,
    results: [
      { index: 1, feedbackStatus: "" },
      { index: 2, feedbackStatus: "saved", persistenceStatus: "persisted" },
      { index: 3, feedbackStatus: "skipped", persistenceStatus: "persisted" }
    ],
    currentIndex: 3
  }),
  1,
  "writer navigation should wrap to the first outstanding card"
);
assert.equal(
  nextWriterOutstandingIndex({
    assets,
    results: assets.map(({ index }) => ({ index, feedbackStatus: "saved", persistenceStatus: "persisted" })),
    currentIndex: 3
  }),
  null,
  "a fully processed batch should enter the completion state"
);

assert.equal(
  writerFeedbackPersisted({ feedbackStatus: "skipped", persistenceStatus: "persisted" }),
  true,
  "a rejected V4 review is processed once its transaction is durably stored"
);
assert.equal(
  writerFeedbackPersisted({ feedbackStatus: "skipped", persistenceStatus: "not_persisted" }),
  false,
  "a legacy retention skip must remain outstanding in writer mode"
);
assert.equal(
  writerFeedbackPersisted({ feedbackStatus: "saved" }),
  false,
  "a visual saved status without the transaction acknowledgement must fail closed"
);
assert.equal(
  nextWriterOutstandingIndex({
    assets,
    results: [
      { index: 1, feedbackStatus: "skipped", persistenceStatus: "persisted" },
      { index: 2, feedbackStatus: "skipped", persistenceStatus: "not_persisted" },
      { index: 3, feedbackStatus: "saved", persistenceStatus: "persisted" }
    ],
    currentIndex: 1
  }),
  2,
  "only an acknowledged feedback transaction may leave the writer queue"
);
assert.equal(
  writerExportRowsReady({
    assets: [assets[0]],
    results: [{ index: 1, correctedTitle: "Not stored", feedbackStatus: "saved", persistenceStatus: "not_persisted" }]
  }),
  false,
  "a visually saved title without a durable transaction must never be exported"
);
assert.equal(WRITER_EXPORT_MAX_ROWS, 250, "frontend and server export limits must stay aligned");
assert.equal(writerExportWithinLimit(250), true, "a full 250-card workbook should remain allowed");
assert.equal(writerExportWithinLimit(251), false, "the frontend must stop oversized exports before upload work begins");

console.log("writer wheel mode tests passed");
