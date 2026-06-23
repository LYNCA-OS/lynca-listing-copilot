import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runAgnesSmoke,
  runBraveSmoke,
  runEbaySmoke,
  runOwsSmoke,
  writeSmokeReport
} from "./smoke-provider.mjs";

const skipped = await runAgnesSmoke({
  env: {},
  analyzeImpl: async () => {
    throw new Error("should not call provider without credentials");
  }
});
assert.equal(skipped.status, "skipped");
assert.deepEqual(skipped.capabilities.map((capability) => capability.name), ["credentials"]);

const calls = [];
const env = {
  AGNES_API_KEY: "test-agnes-key",
  AGNES_SMOKE_IMAGE_URL: "https://example.com/front.jpg",
  AGNES_SMOKE_BACK_IMAGE_URL: "https://example.com/back.jpg",
  AGNES_SMOKE_ERROR_IMAGE_URL: "https://example.com/unreadable.jpg"
};
const report = await runAgnesSmoke({
  env,
  analyzeImpl: async ({ images, prompt, tools, toolChoice }) => {
    calls.push({ images, prompt, tools, toolChoice });
    if (images[0]?.url === env.AGNES_SMOKE_ERROR_IMAGE_URL) {
      const error = new Error("mock unreadable image");
      error.provider = "agnes";
      error.code = "bad_request";
      error.status = 400;
      throw error;
    }
    return {
      provider: "agnes",
      model_id: "agnes-2.0-flash",
      parse_source: tools ? "tool_call" : "content",
      finish_reason: tools ? "tool_calls" : "stop",
      usage: {
        image_count: images.length,
        provider_calls: 1
      }
    };
  }
});
assert.equal(report.status, "passed");
assert.deepEqual(report.capabilities.map((capability) => capability.name), [
  "single_image_json",
  "front_back_multi_image_json",
  "tool_call",
  "error_response"
]);
assert.equal(calls[0].images.length, 1);
assert.equal(calls[1].images.length, 2);
assert.match(calls[2].prompt, /tool-call smoke test/i);
assert.equal(calls[2].tools[0].function.name, "submit_card_evidence");
assert.equal(calls[2].tools[0].function.parameters.properties.evidence.additionalProperties.required.includes("value"), true);
assert.equal(calls[2].toolChoice.function.name, "submit_card_evidence");
assert.equal(calls[3].images[0].url, env.AGNES_SMOKE_ERROR_IMAGE_URL);
assert.equal(report.capabilities[1].details.image_count, "2");
assert.equal(report.capabilities[2].details.parse_source, "tool_call");
assert.equal(report.capabilities[3].details.error_code, "bad_request");

const partial = await runAgnesSmoke({
  env: {
    AGNES_API_KEY: "test-agnes-key",
    AGNES_SMOKE_IMAGE_URL: "https://example.com/front.jpg"
  },
  analyzeImpl: async ({ images }) => ({
    provider: "agnes",
    model_id: "agnes-2.0-flash",
    parse_source: "content",
    finish_reason: "stop",
    usage: {
      image_count: images.length,
      provider_calls: 1
    }
  })
});
assert.equal(partial.status, "passed");
assert.equal(partial.capabilities.find((capability) => capability.name === "front_back_multi_image_json").status, "skipped");
assert.equal(partial.capabilities.find((capability) => capability.name === "error_response").status, "skipped");

const optionalToolFailure = await runAgnesSmoke({
  env: {
    AGNES_API_KEY: "test-agnes-key",
    AGNES_SMOKE_IMAGE_URL: "https://example.com/front.jpg"
  },
  analyzeImpl: async ({ tools }) => {
    if (tools) {
      const error = new Error("tool call not stable");
      error.code = "response_format_invalid";
      throw error;
    }
    return {
      provider: "agnes",
      model_id: "agnes-2.0-flash",
      parse_source: "content",
      finish_reason: "stop",
      usage: {
        image_count: 1,
        provider_calls: 1
      }
    };
  }
});
assert.equal(optionalToolFailure.status, "passed_with_limitations");
assert.equal(optionalToolFailure.capabilities.find((capability) => capability.name === "single_image_json").status, "passed");
assert.equal(optionalToolFailure.capabilities.find((capability) => capability.name === "tool_call").status, "failed");
assert.equal(optionalToolFailure.capabilities.find((capability) => capability.name === "tool_call").required, false);

const requiredToolFailure = await runAgnesSmoke({
  env: {
    AGNES_API_KEY: "test-agnes-key",
    AGNES_SMOKE_IMAGE_URL: "https://example.com/front.jpg",
    AGNES_SMOKE_REQUIRE_TOOL_CALL: "true"
  },
  analyzeImpl: async ({ tools }) => {
    if (tools) {
      const error = new Error("tool call required but not stable");
      error.code = "response_format_invalid";
      throw error;
    }
    return {
      provider: "agnes",
      model_id: "agnes-2.0-flash",
      parse_source: "content",
      finish_reason: "stop",
      usage: {
        image_count: 1,
        provider_calls: 1
      }
    };
  }
});
assert.equal(requiredToolFailure.status, "failed");
assert.equal(requiredToolFailure.capabilities.find((capability) => capability.name === "tool_call").required, true);

const serialized = JSON.stringify({ skipped, report, partial, optionalToolFailure, requiredToolFailure });
assert.equal(serialized.includes("test-agnes-key"), false);
assert.equal(serialized.includes(env.AGNES_SMOKE_IMAGE_URL), false);
assert.equal(serialized.includes(env.AGNES_SMOKE_BACK_IMAGE_URL), false);
assert.equal(serialized.includes(env.AGNES_SMOKE_ERROR_IMAGE_URL), false);

const tempDir = await mkdtemp(join(tmpdir(), "lynca-smoke-report-"));
const reportPath = join(tempDir, "reports", "agnes-smoke.json");
await writeSmokeReport(report, reportPath);
const reportText = await readFile(reportPath, "utf8");
const writtenReport = JSON.parse(reportText);
assert.equal(writtenReport.provider, "agnes");
assert.equal(writtenReport.status, "passed");
assert.equal(writtenReport.capabilities.length, 4);
assert.equal(reportText.includes("test-agnes-key"), false);
assert.equal(reportText.includes(env.AGNES_SMOKE_IMAGE_URL), false);
assert.equal(reportText.includes(env.AGNES_SMOKE_BACK_IMAGE_URL), false);
assert.equal(reportText.includes(env.AGNES_SMOKE_ERROR_IMAGE_URL), false);
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
assert.equal(skippedBrave.capabilities[0].name, "credentials");

const braveReport = await runBraveSmoke({
  env: {
    BRAVE_SEARCH_API_KEY: "test-brave-key"
  },
  providerImpl: {
    search: async ({ query }) => ({
      provider_id: "brave",
      unavailable: false,
      more_results_available: true,
      candidates: [
        {
          source_url: "https://example.com/brave-result",
          title: "result one"
        },
        {
          source_url: "https://example.com/brave-result-2",
          title: "result two"
        }
      ],
      query
    })
  }
});
assert.equal(braveReport.status, "passed");
assert.equal(braveReport.provider, "brave");
assert.equal(braveReport.capabilities[0].name, "web_search");
assert.equal(braveReport.capabilities[0].details.provider_id, "brave");
assert.equal(braveReport.capabilities[0].details.query_id, "brave_smoke_1");
assert.equal(braveReport.capabilities[0].details.candidates_count, "2");

const ebayReport = await runEbaySmoke({
  env: {
    EBAY_CLIENT_ID: "test-ebay-client",
    EBAY_CLIENT_SECRET: "test-ebay-secret"
  },
  providerImpl: {
    search: async () => ({
      provider_id: "ebay_browse",
      unavailable: false,
      marketplace_id: "EBAY_US",
      candidates: [
        {
          source_url: "https://www.ebay.com/itm/123",
          title: "market result"
        }
      ]
    })
  }
});
assert.equal(ebayReport.status, "passed");
assert.equal(ebayReport.provider, "ebay_browse");
assert.equal(ebayReport.capabilities[0].name, "marketplace_search");
assert.equal(ebayReport.capabilities[0].details.marketplace_id, "EBAY_US");
assert.equal(ebayReport.capabilities[0].details.candidates_count, "1");

const skippedOwsModel = await runOwsSmoke({
  env: {
    OPENAI_API_KEY: "test-openai-key"
  },
  providerImpl: {
    search: async () => {
      throw new Error("should not search without OWS model config");
    }
  }
});
assert.equal(skippedOwsModel.status, "skipped");
assert.equal(skippedOwsModel.provider, "openai_web_search");
assert.equal(skippedOwsModel.capabilities[0].name, "model");

const owsReport = await runOwsSmoke({
  env: {
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_WEB_SEARCH_MODEL: "gpt-4.1-mini"
  },
  providerImpl: {
    search: async () => ({
      provider_id: "openai_web_search",
      unavailable: false,
      model_id: "gpt-4.1-mini",
      candidates: [
        {
          source_url: "https://example.com/ows-result",
          title: "ows source"
        }
      ]
    })
  }
});
assert.equal(owsReport.status, "passed");
assert.equal(owsReport.provider, "openai_web_search");
assert.equal(owsReport.capabilities[0].name, "web_search_fallback");
assert.equal(owsReport.capabilities[0].details.model_id, "gpt-4.1-mini");

const retrievalSerialized = JSON.stringify({
  skippedBrave,
  braveReport,
  ebayReport,
  skippedOwsModel,
  owsReport
});
assert.equal(retrievalSerialized.includes("test-brave-key"), false);
assert.equal(retrievalSerialized.includes("test-ebay-client"), false);
assert.equal(retrievalSerialized.includes("test-ebay-secret"), false);
assert.equal(retrievalSerialized.includes("test-openai-key"), false);
assert.equal(retrievalSerialized.includes("https://example.com/brave-result"), false);
assert.equal(retrievalSerialized.includes("https://www.ebay.com/itm/123"), false);
assert.equal(retrievalSerialized.includes("https://example.com/ows-result"), false);

const retrievalTempDir = await mkdtemp(join(tmpdir(), "lynca-retrieval-smoke-report-"));
const braveReportPath = join(retrievalTempDir, "reports", "brave-smoke.json");
await writeSmokeReport(braveReport, braveReportPath);
const braveReportText = await readFile(braveReportPath, "utf8");
assert.equal(JSON.parse(braveReportText).provider, "brave");
assert.equal(braveReportText.includes("test-brave-key"), false);
assert.equal(braveReportText.includes("https://example.com/brave-result"), false);
await rm(retrievalTempDir, { recursive: true, force: true });

console.log("smoke provider tests passed");
