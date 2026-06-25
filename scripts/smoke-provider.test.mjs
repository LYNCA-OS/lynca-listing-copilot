import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runGeminiSmoke,
  runBraveSmoke,
  runEbaySmoke,
  runOwsSmoke,
  writeSmokeReport
} from "./smoke-provider.mjs";

const skippedGemini = await runGeminiSmoke({
  env: {},
  analyzeImpl: async () => {
    throw new Error("should not call Gemini without credentials");
  }
});
assert.equal(skippedGemini.status, "skipped");
assert.deepEqual(skippedGemini.capabilities.map((capability) => capability.name), ["credentials"]);

const geminiCalls = [];
const geminiEnv = {
  GEMINI_API_KEY: "AIza-test-gemini-key",
  GEMINI_SMOKE_IMAGE_URL: "https://example.com/gemini-front.jpg",
  GEMINI_SMOKE_BACK_IMAGE_URL: "https://example.com/gemini-back.jpg"
};
const geminiReport = await runGeminiSmoke({
  env: geminiEnv,
  analyzeImpl: async ({ images, prompt }) => {
    geminiCalls.push({ images, prompt });
    return {
      provider: "gemini",
      model_id: "gemini-3.1-flash-lite",
      parse_source: "content",
      finish_reason: "completed",
      recognition_status: "CONFIRMED",
      usage: {
        image_count: images.length,
        provider_calls: 1
      }
    };
  }
});
assert.equal(geminiReport.status, "passed");
assert.equal(geminiReport.provider, "gemini");
assert.deepEqual(geminiReport.capabilities.map((capability) => capability.name), [
  "single_image_json",
  "front_back_multi_image_json"
]);
assert.equal(geminiCalls[0].images.length, 1);
assert.equal(geminiCalls[1].images.length, 2);
assert.match(geminiCalls[0].prompt, /provider smoke test/i);
assert.equal(geminiReport.capabilities[1].details.image_count, "2");
assert.equal(JSON.stringify(geminiReport).includes(geminiEnv.GEMINI_API_KEY), false);
assert.equal(JSON.stringify(geminiReport).includes(geminiEnv.GEMINI_SMOKE_IMAGE_URL), false);

const tempDir = await mkdtemp(join(tmpdir(), "lynca-smoke-report-"));
const reportPath = join(tempDir, "reports", "gemini-smoke.json");
await writeSmokeReport(geminiReport, reportPath);
const reportText = await readFile(reportPath, "utf8");
const writtenReport = JSON.parse(reportText);
assert.equal(writtenReport.provider, "gemini");
assert.equal(writtenReport.status, "passed");
assert.equal(writtenReport.capabilities.length, 2);
assert.equal(reportText.includes(geminiEnv.GEMINI_API_KEY), false);
assert.equal(reportText.includes(geminiEnv.GEMINI_SMOKE_IMAGE_URL), false);
assert.equal(reportText.includes(geminiEnv.GEMINI_SMOKE_BACK_IMAGE_URL), false);
await rm(tempDir, { recursive: true, force: true });

const skippedBrave = await runBraveSmoke({
  env: {},
  providerImpl: {
    search: async () => {
      throw new Error("should not search without Brave credentials");
    }
  }
});
assert.equal(skippedBrave.status, "skipped");
assert.equal(skippedBrave.provider, "brave");

const braveReport = await runBraveSmoke({
  env: { BRAVE_SEARCH_API_KEY: "brave-secret" },
  providerImpl: {
    search: async () => ({
      provider_id: "brave",
      candidates: [{ title: "Smoke Candidate" }],
      more_results_available: false
    })
  }
});
assert.equal(braveReport.status, "passed");
assert.equal(braveReport.capabilities[0].name, "web_search");
assert.equal(braveReport.capabilities[0].details.candidates_count, "1");
assert.equal(JSON.stringify(braveReport).includes("brave-secret"), false);

const skippedEbay = await runEbaySmoke({
  env: {},
  providerImpl: {
    search: async () => {
      throw new Error("should not search without eBay credentials");
    }
  }
});
assert.equal(skippedEbay.status, "skipped");
assert.equal(skippedEbay.provider, "ebay_browse");

const skippedOws = await runOwsSmoke({
  env: {},
  providerImpl: {
    search: async () => {
      throw new Error("should not search without OpenAI credentials");
    }
  }
});
assert.equal(skippedOws.status, "skipped");
assert.equal(skippedOws.provider, "openai_web_search");

console.log("smoke provider tests passed");
