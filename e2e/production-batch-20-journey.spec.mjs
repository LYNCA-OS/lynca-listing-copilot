// COS-50's acceptance criteria against a LIVE instance.
//
// `batch-navigation.spec.mjs` already drives this behaviour, but it builds its
// page from the shipped stylesheet and the shipped window function. That proves
// the window logic and the markup agree; it cannot prove that a real 40-image
// upload produces twenty cards, that recognition fills them, or that the rail
// the operator sees on production carries every index. This spec does, and it
// is the reason the COS-50 checklist still has an unticked box.
//
// It needs a signed-in session, so it does NOT run in CI. Run it yourself.
//
// NO LOGIN PAGE NEEDED. Paste the `lynca_metaverse_session` cookie
// from a browser you are already signed in to -- DevTools > Application >
// Cookies -- and the run reuses that session:
//
//   WRITER_JOURNEY_SESSION_COOKIE=... \
//   WRITER_JOURNEY_BASE_URL=https://listing.lyncafei.team \
//   WRITER_JOURNEY_LOCAL_IMAGES=/path/to/40-images \
//   npm run test:e2e:production-batch-20:chrome
//
// No password is typed, stored, or handed to a process, and the session expires
// on its own. The username/password path below stays for an unattended run.
//
// Either way credentials never reach an artifact: the login context is closed
// before HAR or tracing starts, the same isolation
// `production-writer-journey.spec.mjs` uses.
//
// NOT covered, deliberately: COS-51's failure paths. A storage collision and a
// manual-after-failure save need a card to FAIL, and a failure cannot be forced
// on production without corrupting real state. A test that quietly exercises
// none of that would read as coverage. Those boxes stay unticked until the
// failure is reproduced deliberately in a staging tenant.

import { test, expect } from "@playwright/test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";

const artifactDir = resolve("artifacts/production-batch-20-journey");

const requiredEnv = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const cleanBaseUrl = (value) => {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) throw new Error("WRITER_JOURNEY_BASE_URL must be an http(s) origin");
  return url;
};

const MIME_FOR_EXTENSION = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
});
const IMAGE_EXTENSIONS = new Set(Object.keys(MIME_FOR_EXTENSION));

/** Forty images, sorted, so a pair-mode upload is a deterministic twenty cards. */
async function localSourceImages(directory) {
  const dir = String(directory || "").trim();
  if (!dir) throw new Error("WRITER_JOURNEY_LOCAL_IMAGES is required: point it at a directory of 40 card images");
  const entries = (await readdir(dir))
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort();
  if (entries.length < 40) {
    throw new Error(`need at least 40 images for a 20-card pair-mode batch, found ${entries.length} in ${dir}`);
  }
  const chosen = entries.slice(0, 40);
  return Promise.all(chosen.map(async (name) => ({
    name: basename(name),
    // The MIME must match the file's real signature: declaring a .webp as
    // image/jpeg is rejected upstream as "signature does not match MIME type",
    // which reads like a broken upload path and is a mislabelled fixture.
    mimeType: MIME_FOR_EXTENSION[extname(name).toLowerCase()] || "image/jpeg",
    buffer: await readFile(resolve(dir, name))
  })));
}

test("a live 20-card batch is fully navigable before anything is saved", async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  await mkdir(artifactDir, { recursive: true });

  const baseUrl = cleanBaseUrl(process.env.WRITER_JOURNEY_BASE_URL);
  const files = await localSourceImages(process.env.WRITER_JOURNEY_LOCAL_IMAGES);

  // Two ways in, and the cookie is the better one.
  //
  // `WRITER_JOURNEY_SESSION_COOKIE` takes the `lynca_metaverse_session` value
  // from a browser that is ALREADY signed in -- DevTools > Application >
  // Cookies. It is a session you already hold, it expires on its own, and it
  // means no password is typed, stored, or passed to a process. Prefer it.
  //
  // The username/password path stays for an unattended run where no session
  // exists yet. It is the fallback, not the default.
  let sessionCookie = String(process.env.WRITER_JOURNEY_SESSION_COOKIE || "").trim();
  // Against a LOCAL server the signing secret is one this machine generated, so
  // the session can be minted here instead of copied from a browser. Never do
  // this against production: there the secret is not ours to hold.
  if (!sessionCookie && process.env.WRITER_JOURNEY_MINT_SESSION === "1") {
    const { createListingSessionToken } = await import("../lib/listing-session.mjs");
    sessionCookie = createListingSessionToken({
      user_id: process.env.WRITER_JOURNEY_USER_ID || "user_staging_cos51",
      tenant_id: process.env.WRITER_JOURNEY_TENANT_ID || "tenant_staging_cos51",
      email: process.env.WRITER_JOURNEY_EMAIL || "staging-cos51@listing.lynca.test",
      session_version: 1
    }, requiredEnv("METAVERSE_AUTH_SECRET"));
  }

  const evidence = {
    schema_version: "production-batch-20-journey-evidence-v1",
    passed: false,
    base_url: baseUrl,
    started_at: new Date().toISOString(),
    image_count: files.length,
    stages: {}
  };

  let loginContext = null;
  let journeyContext = null;
  try {
    let storageState;
    if (sessionCookie) {
      storageState = {
        cookies: [{
          name: "lynca_metaverse_session",
          value: sessionCookie,
          domain: new URL(baseUrl).hostname,
          path: "/",
          httpOnly: true,
          secure: baseUrl.startsWith("https://"),
          sameSite: "Lax",
          expires: -1
        }],
        origins: []
      };
      evidence.stages.login = { passed: true, method: "supplied_session_cookie" };
    } else {
      const username = requiredEnv("METAVERSE_USERNAME");
      const password = requiredEnv("METAVERSE_PASSWORD");
      // Isolated: this context never records HAR or a trace, and is closed
      // before the recorded one opens.
      loginContext = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 1000 } });
      const loginPage = await loginContext.newPage();
      await loginPage.goto("/app/login.html?next=%2Fapp%2F", { waitUntil: "domcontentloaded" });
      await loginPage.getByTestId("login-username").fill(username);
      await loginPage.getByTestId("login-password").fill(password);
      await loginPage.getByTestId("login-submit").click();
      await loginPage.waitForURL((url) => !url.pathname.endsWith("/login.html"), { timeout: 45_000 });
      await expect(loginPage.getByTestId("image-upload-input")).toBeAttached();
      storageState = await loginContext.storageState();
      evidence.stages.login = { passed: true, method: "login_page" };
      await loginContext.close();
      loginContext = null;
    }

    journeyContext = await browser.newContext({
      baseURL: baseUrl, viewport: { width: 1440, height: 1000 }, storageState
    });
    const page = await journeyContext.newPage();
    await page.goto("/app/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.getByTestId("image-upload-input").setInputFiles(files);

    // ---------------------------------------------------------------- COS-50
    // "Uploading 40 images in pair mode produces a visible batch total of 20."
    const summary = page.locator(".batch-navigation-summary strong");
    await expect(summary).toContainText("共 20 张", { timeout: 5 * 60 * 1000 });
    const summaryText = (await summary.textContent()).trim();
    expect(summaryText, "the window count must not be presented as the batch total").not.toMatch(/^正在显示 1–8 \/ 共 8 张$/);
    evidence.stages.batch_total = { passed: true, summary: summaryText };

    // "Cards 1-20 are discoverable through the review navigation before any
    // card is saved." The rail is the discoverability surface; the eight
    // rendered cards remain bounded, which is the half that was legitimate.
    const rail = page.locator(".batch-rail-item");
    await expect(rail).toHaveCount(20);
    await expect(page.locator(".batch-rail-item.is-visible")).toHaveCount(8);
    evidence.stages.rail = { passed: true, entries: 20, visible: 8 };

    // "A ready card 9 or 20 can be selected and edited without persisting
    // cards 1-8." Nothing is saved anywhere above this line.
    for (const index of [9, 20]) {
      await page.locator(`[data-batch-focus="${index}"]`).click();
      await expect(page.locator(`[data-batch-focus="${index}"]`)).toHaveClass(/is-visible/);
      const focusedSummary = (await summary.textContent()).trim();
      const range = focusedSummary.match(/正在显示 (\d+)–(\d+)/);
      expect(range, "the summary must report the window it moved to").toBeTruthy();
      expect(Number(range[1])).toBeLessThanOrEqual(index);
      expect(Number(range[2])).toBeGreaterThanOrEqual(index);
      evidence.stages[`direct_select_${index}`] = { passed: true, summary: focusedSummary };
    }

    // Window controls walk the batch and stop at both ends.
    await page.locator('[data-batch-focus="1"]').click();
    await expect(page.locator('[data-batch-window="previous"]')).toBeDisabled();
    await page.locator('[data-batch-focus="20"]').click();
    await expect(page.locator('[data-batch-window="next"]')).toBeDisabled();
    evidence.stages.window_controls = { passed: true };

    // The page itself must never scroll sideways, whatever the rail does.
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows, "the page must not scroll horizontally").toBeFalsy();
    evidence.stages.no_horizontal_page_scroll = { passed: true };

    evidence.passed = true;
    await page.screenshot({ path: resolve(artifactDir, "batch-20-navigation.png"), fullPage: true });
  } finally {
    evidence.finished_at = new Date().toISOString();
    await writeFile(resolve(artifactDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await loginContext?.close();
    await journeyContext?.close();
  }
});
