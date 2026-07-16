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

assert.match(html, /data-workspace-mode="standard"/, "the existing card workspace must remain available");
assert.match(html, /data-workspace-mode="writer"/, "writer mode must be an additive workspace option");
assert.match(html, /role="tablist"[^>]*aria-label="工作模式"/, "workspace modes must expose an accessible tablist");
assert.match(js, /async function saveWriterTitleAndAdvance/, "writer mode must own one guarded save-and-advance path");
assert.match(js, /persisted = await saveFeedbackForResult\(result, asset\)/, "writer cards must await durable feedback before advancing");
assert.match(js, /if \(!persisted\) return false;/, "failed persistence must keep the current card in place");
assert.match(js, /event\.isComposing/, "Enter must not submit while an IME composition is active");
assert.match(js, /writerCompositionActive/, "IME composition state must survive browser-specific key event ordering");
assert.match(js, /event\.keyCode === 229/, "IME completion key events must not submit accidentally");
assert.match(js, /event\.repeat/, "a held Enter key must not create duplicate submissions");
assert.match(js, /标题不能为空/, "empty writer titles must fail locally and remain on the current card");
assert.match(js, /state\.writerSaveInFlight/, "writer navigation and reset must share one in-flight submission lock");
assert.match(js, /const editorDisabled = titlePending \|\| interactionLocked \|\| retrySubmitting \|\| result\.feedbackStatus === "saving"/, "the current title editor must lock during persistence, export, file preparation, and retry");
assert.match(js, /preserveFocusedWriterInput/, "background polling must not replace the active writer input");
assert.match(js, /aria-label="卡片 \$\{result\.index\} 最终英文标题"/, "the active title editor must expose an accessible name");
assert.match(js, /payload\.v4_persistence\?\.transaction\?\.saved !== true/, "writer advance must require an explicit V4 transaction acknowledgement");
assert.match(js, /titleSnapshotByIndex/, "writer export must freeze persisted title values before asynchronous uploads");
assert.match(js, /requireSaved: exportingWriterRows/, "writer export must revalidate persistence before building workbook rows");
assert.match(js, /feedback_submission_id: feedbackSubmission\.id/, "V4 feedback must carry a client-owned idempotency key");
assert.match(js, /client_occurred_at: feedbackSubmission\.clientOccurredAt/, "V4 feedback retries must reuse the original client timestamp");
assert.match(js, /const rejected = feedbackAction === "REJECT"/, "feedback persistence and training eligibility must remain separate states");
assert.doesNotMatch(js, /feedbackStatus = payload\.training_eligible/, "training eligibility must never decide whether an accepted title is treated as stored");
assert.match(js, /filePreparationRunId/, "asynchronous file preparation must own a stale-run guard");
assert.match(js, /state\.priorityRetryInFlight/, "priority retry must share the workspace mutation lock");
assert.match(css, /\.writer-wheel-viewport::before/, "writer wheel must provide the upper focus mask");
assert.match(css, /\.writer-wheel-viewport::after/, "writer wheel must provide the lower focus mask");
assert.match(css, /prefers-reduced-motion: reduce/, "writer transitions must respect reduced-motion preferences");

const setWorkspaceModeSource = js.slice(
  js.indexOf("function setWorkspaceMode"),
  js.indexOf("function updatePreviewSummary")
);
assert.doesNotMatch(setWorkspaceModeSource, /renderPreviews\(/, "switching views must preserve asset promises and preingestion state");
assert.match(setWorkspaceModeSource, /renderResults\(\{ forceWriterRender: true \}\)/, "mode switches must repaint even when the editor owns focus");

const writerSaveSource = js.slice(
  js.indexOf("async function saveWriterTitleAndAdvance"),
  js.indexOf("async function rejectWriterTitleAndAdvance")
);
assert.match(
  writerSaveSource,
  /标题不能为空[\s\S]*renderResults\(\{ forceWriterRender: true \}\)/,
  "invalid Enter submissions must render the error and restore focus"
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
