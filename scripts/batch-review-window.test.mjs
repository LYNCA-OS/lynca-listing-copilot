import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  batchReviewWindow,
  INTAKE_PREVIEW_CARD_WINDOW
} from "../lib/listing/client/batch-recognition-intent.mjs";

const batch = (n) => Array.from({ length: n }, (_, i) => ({ index: i + 1 }));

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

// The product must show total and window separately, and must not claim 8 / 8.
const js = await readFile("app/listing-copilot.js", "utf8");
const html = await readFile("app/index.html", "utf8");
assert.match(js, /batchReviewWindow\(/, "the review surface must use the two-axis window");
assert.match(js, /正在显示/, "copy must distinguish the visible window from the batch total");
assert.doesNotMatch(js, /\$\{visible\.length\} \/ \$\{INTAKE_PREVIEW_CARD_WINDOW\}/,
  "the queue footer must not read as window-size / window-size");
assert.doesNotMatch(html, /最多显示 8 张/, "static copy must not contradict the batch counter");

process.stdout.write("batch review window: ok\n");
