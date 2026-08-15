import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  WRITER_EXPORT_MAX_ROWS,
  writerFeedbackDecision,
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
assert.equal((html.match(/<button class="workspace-mode-tab/g) || []).length, 2, "the product exposes exactly Queue Overview and Writer Terminal");
assert.match(html, /data-workspace-mode="writer"[\s\S]*<span>写手终端<\/span>/, "the original Writer entry is upgraded in place");
assert.doesNotMatch(html, /data-workspace-mode="terminal"/, "the short-lived additive Terminal entry must not remain");
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
assert.match(feedbackSource, /async function saveTitleFeedback[\s\S]*persisted = await saveFeedbackForResult\(result, asset,[\s\S]*return persisted/, "writer saves must return the persistence result");
assert.match(feedbackSource, /writerFeedbackDecision\(\{[\s\S]*generatedTitle,[\s\S]*correctedTitle,[\s\S]*explicitReject/, "writer saves must use the shared client decision contract");
assert.doesNotMatch(feedbackSource, /!generatedTitle && !explicitReject/, "a manually entered title must remain savable when the model supplied no draft");
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
assert.doesNotMatch(js, /renderWriterWheel|saveWriterTitleAndAdvance|rejectWriterTitleAndAdvance/, "the superseded wheel state machine must be unreachable");
assert.match(js, /persisted = await saveFeedbackForResult\(result, asset, \{ deferFinalRender: true \}\)/, "Writer Terminal review must await durable persistence");
assert.match(js, /titleSnapshotByIndex/, "writer export must freeze persisted titles before asynchronous uploads");
assert.match(js, /state\.retryInFlight/, "direct retry must participate in the workspace mutation lock");
assert.match(js, /function updateCorrectedTitle[\s\S]*result\.persistenceStatus = "";/, "editing a persisted title must reopen its persistence contract");
assert.match(css, /prefers-reduced-motion: reduce/, "writer transitions must respect reduced-motion preferences");
assert.match(css, /--wb-bg:/, "the writer workbench must own one coherent visual token layer");
assert.doesNotMatch(css, /\.writer-wheel|\.writer-queue-window/, "superseded wheel CSS must be removed");
assert.match(js, /kind: "queue-advance"/, "persisted cards should advance through one shared queue transition");
assert.match(css, /data-workbench-transition="queue-advance"[\s\S]*animation-duration: var\(--duration-queue\)/, "queue movement must stay on the reviewed duration token");

assert.deepEqual(
  writerFeedbackDecision({ generatedTitle: "", correctedTitle: "Writer supplied title" }),
  { ready: true, action: "EDIT", reason: "" },
  "a no-draft model result must accept a writer-supplied title"
);
assert.deepEqual(
  writerFeedbackDecision({ generatedTitle: "Draft", correctedTitle: "" }),
  { ready: false, action: "", reason: "TITLE_REQUIRED" },
  "an empty final title must fail locally with an actionable reason"
);
assert.equal(
  writerFeedbackDecision({ generatedTitle: "Draft", correctedTitle: "Draft" }).action,
  "ACCEPT"
);
assert.equal(
  writerFeedbackDecision({ generatedTitle: "Draft", correctedTitle: "", explicitReject: true }).action,
  "REJECT"
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
  writerFeedbackPersisted({
    feedbackStatus: "saved",
    persistenceStatus: "persisted",
    manualRecoverySource: "MANUAL_AFTER_RECOGNITION_FAILURE"
  }),
  true,
  "a durably acknowledged manual recovery must leave the outstanding queue"
);
assert.equal(WRITER_EXPORT_MAX_ROWS, 250, "frontend and server export limits must stay aligned");
assert.equal(writerExportWithinLimit(250), true, "a full 250-card workbook should remain allowed");
assert.equal(writerExportWithinLimit(251), false, "the frontend must stop oversized exports before upload work begins");

console.log("writer persistence contracts passed");
