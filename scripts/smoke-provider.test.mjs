import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runBraveSmoke,
  runEbaySmoke,
  runOwsSmoke,
  writeSmokeReport
} from "./smoke-provider.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "lynca-smoke-report-"));
const reportPath = join(tempDir, "reports", "brave-smoke.json");
const minimalReport = {
  provider: "brave",
  status: "passed",
  generated_at: "2026-06-26T00:00:00.000Z",
  capabilities: []
};
await writeSmokeReport(minimalReport, reportPath);
const reportText = await readFile(reportPath, "utf8");
const writtenReport = JSON.parse(reportText);
assert.equal(writtenReport.provider, "brave");
assert.equal(writtenReport.status, "passed");
assert.equal(writtenReport.capabilities.length, 0);
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
