import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 8 * 60 * 1000,
  expect: { timeout: 30_000 },
  reporter: [["line"]],
  outputDir: "test-results/production-writer-journey",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // The bundled chromium is a ~150MB download that a developer with Chrome
    // already installed does not need. `--project=chrome` drives the system
    // Chrome instead, so these specs are runnable on a fresh checkout without
    // `npx playwright install`. CI keeps using `chromium`, which is pinned and
    // reproducible; this project is for local runs and is deliberately not the
    // default.
    { name: "chrome", use: { browserName: "chromium", channel: "chrome" } }
  ],
  use: {
    baseURL: process.env.WRITER_JOURNEY_BASE_URL || "https://listing.lyncafei.team",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    video: "off"
  }
});
