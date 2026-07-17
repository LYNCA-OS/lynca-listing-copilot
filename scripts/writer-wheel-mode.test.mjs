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
const js = await readFile("app/listing-copilot.js", "utf8");
const css = await readFile("app/listing-copilot.css", "utf8");

assert.match(html, /<main class="workspace">/, "the product must expose one primary writer workspace");
assert.match(html, /<p class="eyebrow">写手工作台<\/p>/, "the primary workspace must be writer-facing");
assert.match(html, /<section class="asset-workbench">/, "the single workspace must retain per-card review");
assert.match(html, /<section class="batch-titles-panel" aria-label="全部标题">/, "the single workspace must retain batch output");
assert.doesNotMatch(html, /data-workspace-mode=|aria-label="工作模式"/, "retired workspace switching must not return to the product surface");

const feedbackSource = js.slice(
  js.indexOf("function pendingV4FeedbackSubmission"),
  js.indexOf("async function copyAllTitles")
);
assert.ok(feedbackSource.length > 0, "the writer feedback workflow must remain present");
assert.match(feedbackSource, /pendingFeedbackSubmissionId/, "feedback retries must retain a client-owned idempotency key");
assert.match(feedbackSource, /pendingFeedbackOccurredAt/, "feedback retries must retain the original client timestamp");
assert.match(feedbackSource, /feedback_submission_id: v4Submission\.id/, "V4 feedback must send the retained idempotency key");
assert.match(feedbackSource, /client_occurred_at: v4Submission\.occurredAt/, "V4 feedback must send the retained client timestamp");
assert.match(feedbackSource, /if \(!response\.ok \|\| !payload\.ok\)[\s\S]*throw new Error/, "feedback must fail closed on a rejected persistence response");
assert.ok(
  feedbackSource.indexOf("clearPendingV4FeedbackSubmission(result, v4Submission)")
    > feedbackSource.indexOf("if (!response.ok || !payload.ok)"),
  "the idempotency key must only clear after durable persistence succeeds"
);
assert.match(feedbackSource, /result\.feedbackStatus = "saved";/, "a successful V4 response must be the source of the saved state");
assert.match(feedbackSource, /catch \(error\)[\s\S]*result\.feedbackStatus = "";/, "failed persistence must leave the card unsaved and retryable");
assert.match(feedbackSource, /async function saveTitleFeedback[\s\S]*await saveFeedbackForResult\(result, asset\)/, "writer saves must await the persistence request");
assert.match(feedbackSource, /\(!correctedTitle && !explicitReject\)[\s\S]*return false/, "an empty title must fail locally unless the writer explicitly rejects the card");
assert.match(js, /event\.isComposing/, "Enter must not submit while an IME composition is active");
assert.doesNotMatch(js, /feedbackStatus = payload\.training_eligible/, "training eligibility must never decide whether an accepted title is treated as stored");

const queueSource = js.slice(
  js.indexOf("async function processAssetViaQueue"),
  js.indexOf("function failedResult")
);
assert.match(queueSource, /await ensureAssetImagesUploaded\(asset\)/, "enqueue must first establish the current asset's uploaded image set");
assert.match(queueSource, /await ensureSafeAssetPayload\(asset,/, "enqueue must rebuild a request from the current asset state");
assert.match(queueSource, /fetchWithTimeout\(JOB_ENQUEUE_API_ENDPOINT/, "recognition and retry must use the canonical enqueue boundary");
assert.match(queueSource, /asset_id: canonicalAssetId\(asset\)/, "fresh enqueue must bind the durable asset identity");

const priorityRetrySource = js.slice(
  js.indexOf("async function retryFailedAssetInPriorityQueue"),
  js.indexOf("async function copyTitle")
);
assert.match(priorityRetrySource, /await processAssetViaQueue\(asset, \{[\s\S]*skipSpeculative: true,[\s\S]*manualRetry: true,[\s\S]*retryOfJobId/, "priority retry must create a fresh job from the current asset images");
assert.match(priorityRetrySource, /旧任务仅保留审计记录/, "priority retry must preserve the old job only as audit history");
assert.match(priorityRetrySource, /assetLifecycleMatches\(asset, lifecycleGeneration\)/, "a stale retry response must not overwrite a newer upload generation");
assert.doesNotMatch(js, /\/api\/v4\/listing-job-retry/, "the browser must not replay a persisted legacy job payload");

assert.match(js, /backgroundPreparationRunId/, "asynchronous image preparation must own a stale-run guard");
assert.match(css, /prefers-reduced-motion: reduce/, "writer transitions must respect reduced-motion preferences");

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
