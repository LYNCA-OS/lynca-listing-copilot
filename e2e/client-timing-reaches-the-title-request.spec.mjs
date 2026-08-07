import { test, expect } from "@playwright/test";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

// The client half of the 2026-08-06 latency gap.
//
// The browser measures its own work -- image metadata, signature, sha256,
// upload bytes, network retries -- and on THIS path it accumulated those on the
// asset and threw them away, because only the ingest endpoint accepted them.
// This asserts the request body actually carries them, so "wired" is something
// observed rather than assumed. Recognition itself may fail locally; the
// request is sent before that, and the request is what is under test.
const baseUrl = (process.env.WRITER_JOURNEY_BASE_URL || "").replace(/\/+$/, "");

test("the title request carries the client's own stage timings", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const dir = process.env.WRITER_JOURNEY_LOCAL_IMAGES;
  const files = (await readdir(dir))
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
    .sort()
    .slice(0, 2)
    .map((name) => resolve(dir, name));
  expect(files.length, "need two images for one card").toBe(2);

  const { createListingSessionToken } = await import("../lib/listing-session.mjs");
  const token = createListingSessionToken({
    user_id: "user_staging_cos51", tenant_id: "tenant_staging_cos51",
    email: "staging-cos51@listing.lynca.test", session_version: 1
  }, process.env.METAVERSE_AUTH_SECRET);

  const context = await browser.newContext({
    baseURL: baseUrl, viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [{
        name: "lynca_metaverse_session", value: token,
        domain: new URL(baseUrl).hostname, path: "/",
        httpOnly: true, secure: baseUrl.startsWith("https://"), sameSite: "Lax", expires: -1
      }],
      origins: []
    }
  });
  const page = await context.newPage();

  // The client picks between two endpoints at runtime, and the timings travel
  // differently on each: a JSON field on the direct call, a header on the
  // binary ingest fast path. Production took the direct one on 2026-08-06 --
  // its rows carry neither `ingest_body_bytes` nor `ingest_total_ms` -- and this
  // machine takes ingest. Asserting only one path would pass while the path
  // that actually ran stayed blind, which is the failure being fixed.
  const sent = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const url = request.url();
    if (!url.includes("/api/csm-listing-title")) return;
    if (url.includes("-ingest")) {
      const header = request.headers()["x-lynca-ingest-metadata"];
      let metadata = {};
      try { metadata = JSON.parse(Buffer.from(header || "", "base64").toString("utf8")); }
      catch { try { metadata = JSON.parse(header || "{}"); } catch { metadata = {}; } }
      sent.push({ path: "ingest", timing: metadata.clientTiming || metadata.client_timing || null });
      return;
    }
    try {
      const body = JSON.parse(request.postData() || "{}");
      sent.push({ path: "direct", timing: body.client_timing || null });
    } catch { /* not JSON */ }
  });

  await page.goto("/app/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.getByTestId("image-upload-input").setInputFiles(files);
  await expect.poll(() => sent.length, { timeout: 3 * 60 * 1000 }).toBeGreaterThan(0);

  const carrying = sent.find((entry) => entry.timing
    && Object.keys(entry.timing).some((key) => key.startsWith("client_")));
  expect(carrying,
    `no title request carried client_ stages: ${JSON.stringify(sent)}`).toBeTruthy();
  console.log(`client timings left the browser on the ${carrying.path} path: ${JSON.stringify(carrying.timing)}`);
  await context.close();
});
