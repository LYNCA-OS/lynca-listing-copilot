// COS-50 browser-level regression for full-batch navigation.
//
// Deliberately self-contained: it builds a page from the SHIPPED stylesheet and
// the SHIPPED window function, and drives the real navigation markup. It needs
// no credentials and no live batch, so it runs in CI on every change -- unlike
// the 20-card production journey, which needs a real instance and is tracked
// separately on the issue.
//
// What it can prove: the window arithmetic the UI renders, that every card
// index is reachable, that direct selection moves the window, and that a
// 100-card rail never makes the PAGE scroll sideways. What it cannot prove is
// that a real recognised batch wires into it; that is the production journey.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(root, "app/workbench-v2.css"), "utf8");
const sdk = readFileSync(resolve(root, "app/listing-copilot-sdk.mjs"), "utf8");

// The navigation markup mirrors `batchNavigationHtml` in app/listing-copilot.js.
// Kept in step by `scripts/batch-review-window.test.mjs`, which asserts the
// product renders the same summary copy and control attributes.
const harness = (total) => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div id="assetPreviewList"></div>
<script type="module">
${sdk}
const total = ${total};
const cards = Array.from({length: total}, (_, i) => ({index: i + 1}));
let start = 0, focus = null;
function render() {
  const w = batchReviewWindow(cards, { start, focusIndex: focus });
  start = w.start;
  const rail = cards.map((c) => {
    const visible = w.visible.some((v) => v.index === c.index);
    return \`<button type="button" class="batch-rail-item\${visible ? " is-visible" : ""}" data-batch-focus="\${c.index}" aria-current="\${visible}">\${c.index}</button>\`;
  }).join("");
  document.querySelector("#assetPreviewList").innerHTML = \`
    <nav class="batch-navigation" aria-label="全批导航">
      <div class="batch-navigation-summary">
        <strong data-summary>正在显示 \${w.from}–\${w.to} / 共 \${w.total} 张</strong>
        <span data-pages>第 \${w.page} / \${w.pages} 页</span>
      </div>
      <div class="batch-navigation-controls">
        <button type="button" data-batch-window="previous" \${w.hasPrevious ? "" : "disabled"}>上一组</button>
        <button type="button" data-batch-window="next" \${w.hasNext ? "" : "disabled"}>下一组</button>
      </div>
      <div class="batch-rail">\${rail}</div>
    </nav>\`;
}
document.addEventListener("click", (event) => {
  const win = event.target.closest("[data-batch-window]");
  if (win) { start = Math.max(0, start + (win.dataset.batchWindow === "previous" ? -8 : 8)); focus = null; render(); return; }
  const pick = event.target.closest("[data-batch-focus]");
  if (pick) { focus = Number(pick.dataset.batchFocus); render(); }
});
render();
window.__ready = true;
</script></body></html>`;

async function open(page, total) {
  await page.setContent(harness(total));
  await page.waitForFunction(() => window.__ready === true);
}

test("a 20-card batch never presents itself as 8 / 8", async ({ page }) => {
  await open(page, 20);
  await expect(page.locator("[data-summary]")).toHaveText("正在显示 1–8 / 共 20 张");
  await expect(page.locator("[data-pages]")).toHaveText("第 1 / 3 页");
  // Every card index is discoverable before anything is saved. This is the
  // complaint: cards 9-20 could not be seen to exist at all.
  await expect(page.locator(".batch-rail-item")).toHaveCount(20);
  await expect(page.locator('[data-batch-window="previous"]')).toBeDisabled();
  await expect(page.locator('[data-batch-window="next"]')).toBeEnabled();
});

test("cards 9 and 20 open directly, without saving cards 1-8 first", async ({ page }) => {
  await open(page, 20);
  await page.click('[data-batch-focus="9"]');
  await expect(page.locator("[data-summary]")).toHaveText("正在显示 9–16 / 共 20 张");
  await expect(page.locator('[data-batch-focus="9"]')).toHaveAttribute("aria-current", "true");

  await page.click('[data-batch-focus="20"]');
  await expect(page.locator("[data-summary]")).toHaveText("正在显示 17–20 / 共 20 张");
  await expect(page.locator('[data-batch-focus="20"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator('[data-batch-window="next"]')).toBeDisabled();
});

test("window controls walk the batch and stop at both ends", async ({ page }) => {
  await open(page, 20);
  await page.click('[data-batch-window="next"]');
  await expect(page.locator("[data-summary]")).toHaveText("正在显示 9–16 / 共 20 张");
  await page.click('[data-batch-window="next"]');
  await expect(page.locator("[data-summary]")).toHaveText("正在显示 17–20 / 共 20 张");
  await page.click('[data-batch-window="previous"]');
  await expect(page.locator("[data-summary]")).toHaveText("正在显示 9–16 / 共 20 张");
});

test("a 100-card rail scrolls inside itself and never scrolls the page sideways", async ({ page }) => {
  await open(page, 100);
  await expect(page.locator("[data-summary]")).toHaveText("正在显示 1–8 / 共 100 张");
  const metrics = await page.evaluate(() => {
    const rail = document.querySelector(".batch-rail");
    return {
      railOverflows: rail.scrollWidth > rail.clientWidth,
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      visibleChips: document.querySelectorAll(".batch-rail-item.is-visible").length
    };
  });
  // The rail is allowed to overflow -- inside its own scroll container. The
  // page is not, and a wide rail forcing a horizontal page scrollbar is the
  // obvious way to get this wrong.
  expect(metrics.railOverflows).toBe(true);
  expect(metrics.pageOverflows).toBe(false);
  expect(metrics.visibleChips).toBe(8);
});
