import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  batchAssetReviewStatus,
  batchReviewWindow,
  INTAKE_PREVIEW_CARD_WINDOW
} from "../lib/listing/client/batch-recognition-intent.mjs";

const batch = (n) => Array.from({ length: n }, (_, i) => ({ index: i + 1 }));

// The full-batch rail has one canonical six-state projection. In particular,
// Explicit rejection must win even when a replayed/legacy result carries the
// generic saved status.
{
  const cases = [
    [{}, { code: "pending", label: "等待中" }],
    [{ processing: true }, { code: "pending", label: "排队中" }],
    [{ processing: true, active: true }, { code: "recognizing", label: "识别中" }],
    [{ result: { confidence: "FAILED" } }, { code: "failed", label: "失败" }],
    [{ result: { confidence: "HIGH" } }, { code: "ready", label: "待录入" }],
    [{ result: { confidence: "FAILED", feedbackStatus: "saved", persistenceStatus: "persisted" } }, { code: "saved", label: "已入库" }],
    [{ result: { confidence: "FAILED", feedbackStatus: "saved", persistenceStatus: "persisted", explicitReviewOutcome: "REJECTED" } }, { code: "rejected", label: "已记录拒绝" }],
    [{ result: { confidence: "HIGH", feedbackStatus: "skipped", persistenceStatus: "persisted" } }, { code: "rejected", label: "已记录拒绝" }],
    [{ result: { confidence: "FAILED", retryStatus: "submitting" } }, { code: "recognizing", label: "识别中" }],
    [{ result: { confidence: "HIGH", feedbackStatus: "saving", persistenceStatus: "saving" } }, { code: "ready", label: "待录入" }],
    [{ result: { confidence: "HIGH", feedbackStatus: "saved", persistenceStatus: "persisted", retryStatus: "submitting" } }, { code: "saved", label: "已入库" }]
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(batchAssetReviewStatus(input), expected);
  }
}

// COS-50's headline case: a 20-card batch must never present itself as 8 / 8.
{
  const window = batchReviewWindow(batch(20));
  assert.equal(window.total, 20, "the batch model keeps every card");
  assert.equal(window.visible.length, INTAKE_PREVIEW_CARD_WINDOW, "the render stays bounded");
  assert.equal(window.from, 1);
  assert.equal(window.to, 8);
  assert.equal(window.pages, 3, "20 cards over an 8-card window is three pages");
  assert.equal(window.hasNext, true);
  assert.equal(window.hasPrevious, false);
  assert.equal(window.remaining, 12, "cards 9-20 are accounted for, not hidden");
}

// Window controls reach the tail, and the last page is short rather than
// padded backwards.
{
  const second = batchReviewWindow(batch(20), { start: 8 });
  assert.deepEqual(second.visible.map((c) => c.index), [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.equal(second.hasPrevious, true);

  const third = batchReviewWindow(batch(20), { start: 16 });
  assert.deepEqual(third.visible.map((c) => c.index), [17, 18, 19, 20]);
  assert.equal(third.from, 17);
  assert.equal(third.to, 20);
  assert.equal(third.hasNext, false);
  assert.equal(third.remaining, 0);
}

// Direct selection: card 9 and card 20 must become reachable WITHOUT saving
// cards 1-8 first. This is the acceptance criterion the issue states.
for (const [focus, expectedFrom] of [[9, 9], [20, 17], [1, 1], [8, 1]]) {
  const window = batchReviewWindow(batch(20), { start: 0, focusIndex: focus });
  assert.ok(window.visible.some((card) => card.index === focus),
    `card ${focus} must be reachable from the first window`);
  assert.equal(window.from, expectedFrom);
}

// A focus already inside the current window must not move it -- selecting a
// visible card should not scroll the batch out from under the operator.
{
  const window = batchReviewWindow(batch(20), { start: 8, focusIndex: 12 });
  assert.equal(window.start, 8, "a focus inside the window leaves it in place");
}

// The window must survive the batch shrinking under it. Saving a card is the
// normal way that happens, and an out-of-range window that renders nothing is
// a dead end the operator cannot navigate out of.
{
  const stale = batchReviewWindow(batch(3), { start: 16 });
  assert.ok(stale.visible.length > 0, "a stale window must degrade to a real page");
  assert.equal(stale.start, 0);
  assert.deepEqual(stale.visible.map((c) => c.index), [1, 2, 3]);
}

// Degenerate inputs must not throw: this runs on every render.
{
  const empty = batchReviewWindow([]);
  assert.deepEqual(empty.visible, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.from, 0);
  assert.equal(empty.pages, 0);
  assert.equal(empty.hasNext, false);
  assert.equal(batchReviewWindow(null).total, 0);
  assert.equal(batchReviewWindow(batch(5), { start: -4 }).start, 0);
  assert.equal(batchReviewWindow(batch(5), { size: 0 }).size, INTAKE_PREVIEW_CARD_WINDOW);
}

// A 100-card batch still renders 8 cards. Bounding the live DOM was always the
// legitimate half of the old behaviour and must not be lost.
{
  const large = batchReviewWindow(batch(100), { start: 40 });
  assert.equal(large.visible.length, 8, "a 100-card batch never renders 100 cards");
  assert.equal(large.total, 100);
  assert.equal(large.pages, 13);
}

// `from` / `to` are positions in the window, not asset IDs. Preparation may
// safely reject one pair and leave a gap in the immutable asset indexes.
{
  const gap = batchReviewWindow([{ index: 1 }, { index: 3 }, { index: 4 }]);
  assert.deepEqual(gap.visible.map((card) => card.index), [1, 3, 4]);
  assert.equal(gap.from, 1);
  assert.equal(gap.to, 3);
}

// The product must show total and window separately, and must not claim 8 / 8.
const js = await readFile("app/listing-copilot.js", "utf8");
const html = await readFile("app/index.html", "utf8");
assert.match(js, /batchReviewWindow\(/, "the review surface must use the two-axis window");
assert.match(js, /const reviewAssets = \[\.\.\.state\.assets\]/,
  "standard review navigation must retain saved and rejected cards");
assert.match(js, /data-batch-status=/, "off-window cards must expose their real state");
assert.match(js, /selected \? 'aria-current="true"' : ""/,
  "aria-current must describe one selected card, not every visible card");
assert.match(js, /const visible = window\.visible\.some/,
  "window membership must use positions rather than assuming gap-free asset indexes");
assert.match(js, /elements\.assetPreviewList\.innerHTML = navigation \+ groups\.map/,
  "the full-batch rail must remain visible after the first recognition result arrives");
assert.match(js, /正在显示第 \$\{window\.from\}–\$\{window\.to\} 项/,
  "position copy must not misrepresent gap-bearing asset indexes as card numbers");
assert.match(js, /function syncBatchRailStatus\(asset\)/,
  "in-place recognition updates must have a narrow rail synchronizer");
assert.match(js, /state\.activeAssetIndexes\.add\(asset\.index\);\s*syncBatchRailStatus\(asset\);/,
  "the rail must enter recognizing state when the worker claims an asset");
assert.match(js, /state\.activeAssetIndexes\.delete\(asset\.index\);\s*syncBatchRailStatus\(asset\);/,
  "the rail must settle immediately when an in-place result arrives");
assert.doesNotMatch(js, /\$\{visible\.length\} \/ \$\{INTAKE_PREVIEW_CARD_WINDOW\}/,
  "the queue footer must not read as window-size / window-size");
assert.doesNotMatch(html, /最多显示 8 张/, "static copy must not contradict the batch counter");

process.stdout.write("batch review window: ok\n");
