import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CONVERSATION_WRITER_MODE,
  WRITER_TERMINAL_EVENTS,
  appendWriterTerminalEvent,
  conversationLedgerSummary,
  createWriterTerminalLedger,
  groupConversationAssets,
  projectWriterTerminal,
  selectWriterTerminalExportRows,
  writerTerminalExportReadiness
} from "../app/conversation-writer-mode.mjs";

const assets = [
  ...Array.from({ length: 10 }, (_, index) => ({
    index: index + 1,
    intakeTurnId: "turn-1",
    images: [{ role: "front" }, { role: "back" }]
  })),
  ...Array.from({ length: 20 }, (_, index) => ({
    index: index + 11,
    intakeTurnId: "turn-2",
    images: [{ role: "front" }, { role: "back" }]
  }))
];

// Ten cards followed by twenty are two conversational turns over one stable,
// thirty-card directory. Completion order never changes export order.
{
  const turns = groupConversationAssets(assets);
  assert.equal(CONVERSATION_WRITER_MODE, "writer");
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((turn) => [turn.first_asset_index, turn.last_asset_index, turn.assets.length]), [
    [1, 10, 10],
    [11, 30, 20]
  ]);
  assert.deepEqual(conversationLedgerSummary({
    assets,
    results: [{ index: 30 }, { index: 1 }, { index: 11 }]
  }), { turns: 2, assets: 30, completed: 3 });
}

let ledger = createWriterTerminalLedger({ sessionId: "terminal-session-1" });
const originalLedger = ledger;
let sequence = 0;
const append = (event) => {
  sequence += 1;
  ledger = appendWriterTerminalEvent(ledger, {
    id: `event-${sequence}`,
    occurred_at: new Date(Date.UTC(2026, 7, 15, 0, 0, sequence)).toISOString(),
    ...event
  });
};

for (const asset of assets) {
  append({
    type: WRITER_TERMINAL_EVENTS.INTAKE_APPENDED,
    turn_id: asset.intakeTurnId,
    asset_index: asset.index,
    image_count: asset.images.length
  });
}
for (const asset of [...assets].reverse()) {
  append({
    type: WRITER_TERMINAL_EVENTS.RECOGNITION_SETTLED,
    asset_index: asset.index,
    attempt_id: `attempt-${asset.index}`,
    outcome: "READY",
    title: `Card ${asset.index} title`
  });
}

assert.equal(originalLedger.events.length, 0, "append returns a new immutable ledger");
assert.ok(Object.isFrozen(ledger));
assert.ok(Object.isFrozen(ledger.events));
assert.deepEqual(projectWriterTerminal(ledger).cards.map((card) => card.asset_index),
  Array.from({ length: 30 }, (_, index) => index + 1),
  "out-of-order responses project back to stable card order");
assert.deepEqual(selectWriterTerminalExportRows(ledger).map((row) => row.asset_index),
  Array.from({ length: 30 }, (_, index) => index + 1));

append({
  type: WRITER_TERMINAL_EVENTS.REVIEW_PERSISTED,
  asset_index: 1,
  decision: "SAVED",
  title: "Founder edited card 1"
});
append({
  type: WRITER_TERMINAL_EVENTS.REVIEW_PERSISTED,
  asset_index: 2,
  decision: "REJECTED",
  title: ""
});
append({
  type: WRITER_TERMINAL_EVENTS.RECOGNITION_SETTLED,
  asset_index: 3,
  attempt_id: "attempt-3-retry-failed",
  outcome: "FAILED",
  title: ""
});
const selected = selectWriterTerminalExportRows(ledger);
assert.equal(selected.length, 29, "a persisted rejection is not an export row");
assert.equal(selected[0].final_title, "Founder edited card 1", "a persisted edit supersedes recognition");
assert.equal(selected.find((row) => row.asset_index === 3)?.final_title, "Card 3 title",
  "a failed retry is append-only evidence and does not erase the last settled title");
assert.deepEqual(writerTerminalExportReadiness(ledger), {
  ready: true,
  card_count: 30,
  export_count: 29,
  rejected_count: 1,
  rejected_asset_indexes: [2],
  unresolved_asset_indexes: [],
  rows: selected
}, "a persisted rejection settles the directory without becoming an Excel row");

append({
  type: WRITER_TERMINAL_EVENTS.EXPORT_RECORDED,
  batch_id: "export-batch-1",
  asset_indexes: selected.map((row) => row.asset_index)
});
assert.equal(projectWriterTerminal(ledger).exports.length, 1);

assert.throws(() => appendWriterTerminalEvent(ledger, {
  id: "bad-pair",
  occurred_at: "2026-08-15T00:02:00.000Z",
  type: WRITER_TERMINAL_EVENTS.INTAKE_APPENDED,
  turn_id: "turn-3",
  asset_index: 31,
  image_count: 1
}), /pair_requires_two_images/);
assert.throws(() => appendWriterTerminalEvent(ledger, {
  id: "unknown-review",
  occurred_at: "2026-08-15T00:02:01.000Z",
  type: WRITER_TERMINAL_EVENTS.REVIEW_PERSISTED,
  asset_index: 31,
  decision: "SAVED",
  title: "Unknown"
}), /asset_unknown/);

const js = await readFile("app/listing-copilot.js", "utf8");
const html = await readFile("app/index.html", "utf8");
const css = await readFile("app/workbench-v2.css", "utf8");
assert.equal((html.match(/<button class="workspace-mode-tab/g) || []).length, 2,
  "Writer Terminal replaces the Writer Wheel instead of becoming a third mode");
assert.match(html, /data-workspace-mode="writer"[\s\S]*<span>写手终端<\/span>/,
  "the original Writer entry now opens the conversation terminal");
assert.doesNotMatch(html, /data-workspace-mode="terminal"/, "no additive Terminal tab remains");
assert.match(js, /mode === CONVERSATION_WRITER_MODE \|\| mode === "terminal"[\s\S]*\? CONVERSATION_WRITER_MODE/,
  "the short-lived Terminal key is normalized to the canonical Writer key");
assert.match(js, /if \(batchWasEmpty\) state\.workspaceMode = CONVERSATION_WRITER_MODE;/,
  "the first upload must enter Writer Terminal before the first ledger event");
assert.match(js, /terminalPairContractActive\(\).*imageFiles\.length % 2 !== 0/,
  "Terminal must reject an odd front\/back selection before creating assets");
const pairContractSource = js.slice(js.indexOf("function terminalPairContractActive"), js.indexOf("function workspaceInteractionLocked"));
assert.match(pairContractSource, /return state\.mode === "pair"/,
  "strict pair admission belongs to the shared session, not the visible projection");
assert.match(js, /terminalPairContractActive\(\) && imageFiles\.length !== candidates\.length/,
  "Terminal must reject an unsupported file atomically instead of re-pairing the survivors");
const intakeTransactionSource = js.slice(js.indexOf("const preparedGroups = await mapWithConcurrency"), js.indexOf("const prepareElapsedMs"));
assert.match(intakeTransactionSource, /const incompleteGroup = preparedGroups\.some/,
  "pair completeness must be decided across the prepared selection");
assert.match(intakeTransactionSource, /if \(failures\.length \|\| incompleteGroup\)[\s\S]*releaseImagePreviewUrls\(preparedImages\)[\s\S]*本次选择未添加[\s\S]*return;/,
  "one failed side must roll back every prepared pair in that selection");
assert.ok(
  intakeTransactionSource.indexOf("if (failures.length || incompleteGroup)")
    < intakeTransactionSource.indexOf("state.assets.push(...preparedAssets)"),
  "no directory mutation may precede selection-level preparation admission"
);
assert.match(js, /recordTerminalRecognition\(result\)/,
  "each settled per-asset recognition must append a ledger event");
assert.match(js, /selectWriterTerminalExportRows\(state\.terminalLedger\)/,
  "Terminal export must read the ledger projection rather than message DOM");
const readinessSource = js.slice(js.indexOf("function completedExportRowsReady"), js.indexOf("function setExportWorkbookStatus"));
assert.match(readinessSource, /if \(state\.terminalLedger\)/,
  "export readiness must use the shared ledger whenever the session has one");
assert.doesNotMatch(readinessSource, /terminalModeActive\(\)/,
  "switching to Queue Overview must not change the session export truth");
const exportSource = js.slice(js.indexOf("async function exportWriterWorkbook"), js.indexOf("function resetTool"));
assert.match(exportSource, /const exportingTerminalRows = Boolean\(state\.terminalLedger\)/,
  "export row selection must remain ledger-backed in both projections");
assert.match(js, /const WRITER_EXPORT_REQUEST_MAX_BYTES = 4_000_000;/);
assert.match(js, /const WRITER_EXPORT_IMAGE_MAX_EDGE = 480;/);
assert.match(js, /const WRITER_EXPORT_IMAGE_QUALITY = 0\.70;/);
const exportImageSource = js.slice(js.indexOf("async function exportImageReference"), js.indexOf("function imageIsDerivedForRequest"));
assert.match(exportImageSource, /compressImageDataUrl\([\s\S]*WRITER_EXPORT_IMAGE_MAX_EDGE,[\s\S]*WRITER_EXPORT_IMAGE_QUALITY/,
  "WebP workbook display bytes must reuse the bounded browser canvas path");
assert.match(exportImageSource, /data:image\/jpeg;base64/,
  "the browser must fail closed unless the display derivative is a JPEG");
assert.match(exportSource, /const requestBytes = new Blob\(\[requestBody\]\)\.size/);
assert.match(exportSource, /requestBytes > WRITER_EXPORT_REQUEST_MAX_BYTES/,
  "the exact serialized JSON body must fail before POST when it exceeds 4 MB");
assert.match(js, /const result = await processAssetViaCsmThinPath\(asset/,
  "the existing per-card provider boundary remains unchanged");
assert.match(js, /state\.terminalProjectionError = String\(error\?\.message/,
  "a Terminal projection defect must be isolated from canonical recognition, review, and export");
assert.match(js, /function terminalRecognitionTitle\(result\)/,
  "the Terminal observation event must read generated output rather than an unsaved writer edit");
assert.match(js, /elements\.assetPreviewList\.innerHTML = navigation \+ groups\.map/,
  "the Standard full-batch rail must remain after the first recognition result arrives");
assert.match(js, /const directoryRange = assetIndexes\.length[\s\S]*实际 \$\{assetIndexes\.length\} 张/,
  "Terminal must describe the real immutable directory range");
assert.match(js, /const TERMINAL_RENDER_CARD_WINDOW = 30;/,
  "30 populated cards are the Terminal render bound");
assert.match(js, /batchReviewWindow\(orderedAssets, \{[\s\S]*size: TERMINAL_RENDER_CARD_WINDOW/,
  "large Terminal sessions must window the real card renderer");
assert.match(js, /data-terminal-window="previous"[\s\S]*data-terminal-window="next"/,
  "every bounded Terminal segment must remain reachable through conversation navigation");
assert.doesNotMatch(js, /function renderWriterWheel|data-writer-go|saveWriterTitleAndAdvance/,
  "the old wheel renderer and advance state machine are removed");
assert.doesNotMatch(css, /\.writer-wheel|\.writer-queue-window/,
  "the old wheel visual layer is removed");
const workspaceModeSource = js.slice(js.indexOf("function setWorkspaceMode"), js.indexOf("function updatePreviewSummary"));
assert.doesNotMatch(workspaceModeSource, /state\.terminalLedger = null/,
  "switching projections must not destroy the append-only Writer directory");
assert.match(workspaceModeSource, /ensureTerminalLedger\(\{ rebuildOnProjectionError: true \}\)/,
  "returning to Writer Terminal must repair a failed ledger projection");
assert.match(js, /elements\.assetPreviewList\.addEventListener\(eventName[\s\S]*is-terminal-dragging[\s\S]*handleFiles\(event\.dataTransfer\.files/,
  "cards can be dropped directly into the Writer Terminal surface");
assert.ok(
  js.indexOf("exportAssets = exportAssets.filter")
    < js.indexOf("if (!writerExportWithinLimit(exportAssets.length))"),
  "Terminal must apply the 250-row limit after rejected cards are removed"
);

process.stdout.write("conversation writer mode: ok\n");
