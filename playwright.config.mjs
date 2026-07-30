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
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: {
    baseURL: process.env.WRITER_JOURNEY_BASE_URL || "https://listing.lyncafei.team",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    screenshot: "off",
    trace: "off",
    video: "off"
  }
});
