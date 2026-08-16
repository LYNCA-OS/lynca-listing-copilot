// COS-64 browser evidence against the actual app shell and renderer.
//
// This spec does not mirror product markup. It serves app/index.html, loads the
// shipped listing-copilot module, dispatches real DragEvents with FileList data,
// and mocks only the same-origin API boundary. It therefore catches broken DOM
// event wiring, preprocessing transactions, renderer bounds, and responsive
// overflow without credentials or provider calls.
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGQAAAAASUVORK5CYII=";
const WEBP_BASE64 = "UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==";
const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
});

let server;
let baseUrl;

function listen(serverInstance) {
  return new Promise((resolveListen, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(0, "127.0.0.1", () => {
      serverInstance.off("error", reject);
      resolveListen();
    });
  });
}

function close(serverInstance) {
  return new Promise((resolveClose, reject) => {
    serverInstance.close((error) => error ? reject(error) : resolveClose());
  });
}

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      const relative = pathname === "/" ? "app/index.html" : pathname.replace(/^\/+/, "");
      const target = resolve(root, relative);
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(target);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentTypes[extname(target)] || "application/octet-stream"
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await listen(server);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await close(server);
});

function decodeMetadata(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function durableAssetId(index) {
  const value = Number(index).toString(16);
  return `asset_${value.padStart(8, "0")}-0000-4000-8000-${value.padStart(12, "0")}`;
}

async function installApiMocks(page) {
  const state = { ingestRequests: 0, exportRequests: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/session") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: true, user: "renderer-test" })
      });
      return;
    }
    if (url.pathname === "/api/csm-resolution-view") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    if (url.pathname === "/api/csm-listing-title" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      return;
    }
    if (url.pathname === "/api/csm-listing-title-ingest") {
      const metadata = decodeMetadata(request.headers()["x-lynca-ingest-metadata"]);
      const index = Number(String(metadata.clientAssetRef || "").match(/\d+/)?.[0]);
      const assetId = durableAssetId(index);
      const tenantId = "tenant_renderer_test";
      state.ingestRequests += 1;
      const verifications = metadata.images.map((image) => {
        const fileName = String(image.fileName || `${image.imageId}.png`).replaceAll("/", "-");
        const objectPath = `tenants/${tenantId}/listing-assets/2026-08-15/${assetId}/${fileName}`;
        return {
          image_id: image.imageId,
          upload: { object_path: objectPath },
          verification: {
            tenant_id: tenantId,
            object_path: objectPath,
            bucket: "listing-images",
            verification_token: `verified-${image.imageId}`,
            content_sha256: image.contentSha256
          },
          verification_record: { saved: true, durable: true }
        };
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          asset_id: assetId,
          tenant_id: tenantId,
          image_generation_id: assetId,
          expected_original_count: metadata.images.length,
          client_asset_ref: metadata.clientAssetRef,
          verifications,
          title: `Mock card ${index} title`,
          fields: {},
          low_confidence_fields: [],
          unreadable_fields: [],
          trace_status: "PERSISTED",
          recognition_session_id: `session-${index}`,
          csm_rows: [],
          route: "CSM_THIN_INGEST",
          model: "renderer-mock"
        })
      });
      return;
    }
    if (url.pathname === "/api/v4/listing-export-workbook") {
      const rawBody = request.postData() || "";
      const body = JSON.parse(rawBody);
      state.exportRequests.push({ bytes: Buffer.byteLength(rawBody), body });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          batch_id: "writer_export_renderer",
          tenant_id: "tenant_renderer_test",
          asset_count: body.rows.length,
          item_count: body.rows.length,
          file_name: "writer_export_renderer.xlsx",
          download_url: ""
        })
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, code: "UNMOCKED_TEST_ROUTE", path: url.pathname })
    });
  });
  return state;
}

async function openApp(page) {
  await page.goto(baseUrl);
  await page.evaluate(async () => {
    const module = await import("/app/listing-copilot.js");
    globalThis.__listingCopilotHooks = module.__listingCopilotAppTestHooks;
  });
  await page.waitForFunction(() => Boolean(globalThis.__listingCopilotHooks));
}

async function dropImageSelection(page, {
  target,
  count,
  firstFileNumber = 1,
  corruptOffset = -1,
  format = "png"
}) {
  return page.evaluate(({ selector, count: fileCount, first, corrupt, imageFormat, pngBase64, webpBase64 }) => {
    const bytes = Uint8Array.from(
      atob(imageFormat === "webp" ? webpBase64 : pngBase64),
      (character) => character.charCodeAt(0)
    );
    const transfer = new DataTransfer();
    for (let offset = 0; offset < fileCount; offset += 1) {
      const corruptFile = offset === corrupt;
      transfer.items.add(new File(
        [corruptFile ? new Uint8Array([0, 1, 2, 3]) : bytes],
        `card-${first + offset}.${corruptFile ? "heic" : imageFormat}`,
        { type: corruptFile ? "image/heic" : `image/${imageFormat}` }
      ));
    }
    const element = document.querySelector(selector);
    const dispatch = (type) => {
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      });
      return !element.dispatchEvent(event);
    };
    const dragEnterPrevented = dispatch("dragenter");
    const dragOverPrevented = dispatch("dragover");
    const highlighted = element.classList.contains("is-dragging")
      || element.classList.contains("is-terminal-dragging");
    const dropPrevented = dispatch("drop");
    return {
      dragEnterPrevented,
      dragOverPrevented,
      dropPrevented,
      highlighted,
      highlightCleared: !element.classList.contains("is-dragging")
        && !element.classList.contains("is-terminal-dragging")
    };
  }, {
    selector: target,
    count,
    first: firstFileNumber,
    corrupt: corruptOffset,
    imageFormat: format,
    pngBase64: PNG_BASE64,
    webpBase64: WEBP_BASE64
  });
}

async function waitForDirectory(page, { assets, results = null }) {
  await page.waitForFunction(({ expectedAssets, expectedResults }) => {
    const snapshot = globalThis.__listingCopilotHooks?.listingCopilotStateSnapshot?.();
    return snapshot?.assetIndexes?.length === expectedAssets
      && snapshot.preparingFiles === false
      && (expectedResults === null || snapshot.resultIndexes.length === expectedResults);
  }, { expectedAssets: assets, expectedResults: results });
}

test("real drop builds a populated 10 + 20 card Terminal on desktop and narrow viewports", async ({ page }) => {
  const api = await installApiMocks(page);
  await openApp(page);

  const initialDrop = await dropImageSelection(page, {
    target: "#dropZone",
    count: 20
  });
  expect(initialDrop).toEqual({
    dragEnterPrevented: true,
    dragOverPrevented: true,
    dropPrevented: true,
    highlighted: true,
    highlightCleared: true
  });
  await waitForDirectory(page, { assets: 10 });

  const appendedDrop = await dropImageSelection(page, {
    target: "#assetPreviewList",
    count: 40,
    firstFileNumber: 21
  });
  expect(appendedDrop).toEqual({
    dragEnterPrevented: true,
    dragOverPrevented: true,
    dropPrevented: true,
    highlighted: true,
    highlightCleared: true
  });
  await waitForDirectory(page, { assets: 30, results: 30 });

  const snapshot = await page.evaluate(() => globalThis.__listingCopilotHooks.listingCopilotStateSnapshot());
  expect(snapshot.assetIndexes).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  expect(snapshot.writerDirectory).toMatchObject({ turns: 2, assets: 30, completed: 30 });
  expect(api.ingestRequests).toBe(30);
  await expect(page.locator(".terminal-result-card")).toHaveCount(30);
  await expect(page.locator(".terminal-card-preview")).toHaveCount(30);
  await expect(page.locator('[data-title-input]')).toHaveCount(30);
  await expect(page.locator('[data-title-input="30"]')).toHaveValue("Mock card 30 title");

  const desktop = await page.evaluate(() => ({
    pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    shellWidth: document.querySelector(".terminal-shell").getBoundingClientRect().width,
    viewportWidth: document.documentElement.clientWidth
  }));
  expect(desktop.pageOverflows).toBe(false);
  expect(desktop.shellWidth).toBeLessThanOrEqual(desktop.viewportWidth);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".terminal-result-card")).toHaveCount(30);
  const narrow = await page.evaluate(() => {
    const thread = document.querySelector(".terminal-thread").getBoundingClientRect();
    const messages = [...document.querySelectorAll(".terminal-message")].map((message) => message.getBoundingClientRect());
    return {
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      messagesFit: messages.every((message) => message.left >= thread.left - 1 && message.right <= thread.right + 1)
    };
  });
  expect(narrow).toEqual({ pageOverflows: false, messagesFit: true });
});

test("a failed pair preparation rejects the whole real selection without a directory hole", async ({ page }) => {
  const api = await installApiMocks(page);
  await openApp(page);
  await dropImageSelection(page, { target: "#dropZone", count: 2 });
  await waitForDirectory(page, { assets: 1, results: 1 });
  const before = await page.evaluate(() => globalThis.__listingCopilotHooks.listingCopilotStateSnapshot());
  const requestsBefore = api.ingestRequests;

  await dropImageSelection(page, {
    target: "#assetPreviewList",
    count: 6,
    firstFileNumber: 3,
    corruptOffset: 2
  });
  await expect(page.locator("#statusText")).toContainText("本次选择未添加");
  await page.waitForFunction(() => globalThis.__listingCopilotHooks.listingCopilotStateSnapshot().preparingFiles === false);
  const rejected = await page.evaluate(() => globalThis.__listingCopilotHooks.listingCopilotStateSnapshot());
  expect(rejected.assetIndexes).toEqual(before.assetIndexes);
  expect(rejected.resultIndexes).toEqual(before.resultIndexes);
  expect(rejected.writerDirectory.eventCount).toBe(before.writerDirectory.eventCount);
  expect(api.ingestRequests).toBe(requestsBefore);
  await expect(page.locator('[data-terminal-asset="2"]')).toHaveCount(0);

  await dropImageSelection(page, {
    target: "#assetPreviewList",
    count: 2,
    firstFileNumber: 9
  });
  await waitForDirectory(page, { assets: 2, results: 2 });
  const recovered = await page.evaluate(() => globalThis.__listingCopilotHooks.listingCopilotStateSnapshot());
  expect(recovered.assetIndexes).toEqual([1, 2]);
  expect(api.ingestRequests).toBe(requestsBefore + 1);
});

test("WebP originals become bounded JPEG workbook display bytes before export", async ({ page }) => {
  const api = await installApiMocks(page);
  await openApp(page);
  await dropImageSelection(page, { target: "#dropZone", count: 2, format: "webp" });
  await waitForDirectory(page, { assets: 1, results: 1 });

  await page.locator('button[data-workspace-mode="standard"]').click();
  await expect(page.locator("#exportWorkbookButton")).toBeEnabled();
  await page.locator("#exportWorkbookButton").click();
  await expect.poll(() => api.exportRequests.length).toBe(1);

  const [{ bytes, body }] = api.exportRequests;
  expect(bytes).toBeLessThanOrEqual(4_000_000);
  expect(body.rows).toHaveLength(1);
  expect(body.rows[0].images).toHaveLength(2);
  for (const image of body.rows[0].images) {
    expect(image.originalType).toBe("image/webp");
    expect(image.objectPath).toMatch(/\.webp$/);
    expect(image.embedDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(Buffer.from(image.embedDataUrl.split(",")[1], "base64").subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff])
    );
  }
});

test("a 100-card session keeps at most 30 full cards in the real DOM and all pages reachable", async ({ page }) => {
  await installApiMocks(page);
  await openApp(page);
  for (let turn = 0; turn < 4; turn += 1) {
    await dropImageSelection(page, {
      target: turn === 0 ? "#dropZone" : "#assetPreviewList",
      count: 50,
      firstFileNumber: turn * 50 + 1
    });
    await waitForDirectory(page, { assets: (turn + 1) * 25 });
  }

  const snapshot = await page.evaluate(() => globalThis.__listingCopilotHooks.listingCopilotStateSnapshot());
  expect(snapshot.writerDirectory).toMatchObject({ turns: 4, assets: 100 });
  expect(snapshot.terminalRenderCardWindow).toBe(30);
  await expect(page.locator(".terminal-result-card")).toHaveCount(10);
  await expect(page.locator("[data-terminal-window-summary]")).toContainText("91–100 / 100");

  const pages = [];
  for (;;) {
    pages.push(await page.locator("[data-terminal-asset]").evaluateAll((cards) => cards.map((card) => Number(card.dataset.terminalAsset))));
    const previous = page.locator('[data-terminal-window="previous"]');
    if (await previous.isDisabled()) break;
    await previous.click();
    expect(await page.locator(".terminal-result-card").count()).toBeLessThanOrEqual(30);
  }
  expect([...new Set(pages.flat())].sort((left, right) => left - right)).toEqual(
    Array.from({ length: 100 }, (_, index) => index + 1)
  );
  expect(pages.map((indexes) => indexes.length)).toEqual([10, 30, 30, 30]);
});
