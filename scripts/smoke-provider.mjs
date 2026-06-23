import { analyzeCardEvidenceWithAgnes } from "../lib/listing/providers/agnes-provider.mjs";
import { analyzeCardEvidenceWithOpenAiEmergency } from "../lib/listing/providers/openai-emergency-provider.mjs";
import { safeProviderErrorMessage } from "../lib/listing/providers/provider-errors.mjs";
import { braveSearchProvider } from "../lib/listing/retrieval/brave-search-provider.mjs";
import { ebayBrowseProvider } from "../lib/listing/retrieval/ebay-browse-provider.mjs";
import { openAiWebSearchProvider } from "../lib/listing/retrieval/openai-web-search-provider.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const provider = String(process.argv[2] || "").trim().toLowerCase();
const reportPath = argValue("--report", defaultSmokeReportPath(provider, process.env));
const smokePrompt = [
  "This is a Listing Copilot provider smoke test.",
  "Return only valid JSON in this shape:",
  JSON.stringify({
    title: "Smoke Test Card",
    confidence: "LOW",
    reason: "Smoke test response.",
    fields: {},
    unresolved: ["smoke test"]
  })
].join("\n");

const toolSmokePrompt = [
  "This is a Listing Copilot Agnes tool-call smoke test.",
  "Call submit_card_evidence exactly once.",
  "The tool arguments must match the Listing ProviderEvidenceResponse runtime shape.",
  "Use evidence keyed by field name. Every evidence field must be an object, never a raw string.",
  "Example evidence field: {\"value\":\"Smoke Test Card\",\"confidence\":0.5,\"status\":\"REVIEW\",\"candidates\":[{\"value\":\"Smoke Test Card\",\"confidence\":0.5}],\"sources\":[],\"conflicts\":[]}.",
  "If you cannot identify the card, still submit one low-confidence field named model_title_suggestion and put unknown facts in unresolved."
].join("\n");

const evidenceFieldParameterSchema = {
  type: "object",
  properties: {
    value: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: { type: "string" } },
        { type: "null" }
      ]
    },
    normalized_value: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: { type: "string" } },
        { type: "null" }
      ]
    },
    status: {
      type: "string",
      enum: ["CONFIRMED", "REVIEW", "MISSING", "CONFLICT", "MANUAL_CONFIRMED", "NOT_APPLICABLE"]
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          value: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "array", items: { type: "string" } },
              { type: "null" }
            ]
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1
          }
        }
      }
    },
    sources: {
      type: "array",
      items: { type: "object" }
    },
    conflicts: {
      type: "array",
      items: { type: "object" }
    },
    unresolved_reason: { type: "string" }
  },
  required: ["value", "confidence"]
};

const agnesSmokeTool = {
  type: "function",
  function: {
    name: "submit_card_evidence",
    description: "Submit structured card evidence observed during the Listing Copilot smoke test.",
    parameters: {
      type: "object",
      properties: {
        model_title_suggestion: { type: "string" },
        reason: { type: "string" },
        evidence: {
          type: "object",
          additionalProperties: evidenceFieldParameterSchema
        },
        image_quality: { type: "object" },
        unresolved: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["evidence", "unresolved"]
    }
  }
};

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function defaultSmokeReportPath(providerId, env = process.env) {
  if (env.SMOKE_PROVIDER_REPORT_PATH) return env.SMOKE_PROVIDER_REPORT_PATH;
  if (providerId === "agnes") return env.AGNES_SMOKE_REPORT_PATH || "data/smoke/agnes-smoke-latest.json";
  if (providerId === "brave") return env.BRAVE_SMOKE_REPORT_PATH || "data/smoke/brave-smoke-latest.json";
  if (providerId === "ebay") return env.EBAY_SMOKE_REPORT_PATH || "data/smoke/ebay-smoke-latest.json";
  if (providerId === "ows") return env.OWS_SMOKE_REPORT_PATH || "data/smoke/ows-smoke-latest.json";
  return "";
}

function skip(message) {
  console.log(`${provider} smoke skipped: ${message}`);
  process.exit(0);
}

function pass(result) {
  console.log(`${provider} smoke passed: ${result.provider} ${result.model_id || "unknown-model"}.`);
}

function passRetrieval(result) {
  console.log(`${provider} smoke passed: ${result.provider_id} candidates=${result.candidates?.length || 0}.`);
}

function createSmokeReport(providerId) {
  return {
    provider: providerId,
    status: "passed",
    generated_at: new Date().toISOString(),
    capabilities: []
  };
}

function booleanFromEnv(env, key, fallback = false) {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function safeDetailValue(value) {
  if (value === undefined || value === null || value === "") return null;
  return safeProviderErrorMessage({ message: String(value) });
}

function addCapability(report, name, status, details = {}, {
  required = true
} = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details)
      .map(([key, value]) => [key, safeDetailValue(value)])
      .filter(([, value]) => value !== null)
  );
  report.capabilities.push({
    name,
    status,
    required,
    ...(Object.keys(safeDetails).length ? { details: safeDetails } : {})
  });
  if (status === "failed" && required) report.status = "failed";
  if (status === "failed" && !required && report.status === "passed") {
    report.status = "passed_with_limitations";
  }
  if (status === "skipped" && required && report.status === "passed" && report.capabilities.length === 1) {
    report.status = "skipped";
  }
}

function resultDetails(result = {}) {
  return {
    model_id: result.model_id || "unknown-model",
    parse_source: result.parse_source || "unknown",
    finish_reason: result.finish_reason || "unknown",
    image_count: result.usage?.image_count ?? "unknown",
    provider_calls: result.usage?.provider_calls ?? "unknown"
  };
}

function retrievalResultDetails(result = {}, {
  queryId = "unknown"
} = {}) {
  return {
    provider_id: result.provider_id || "unknown",
    query_id: queryId,
    candidates_count: Array.isArray(result.candidates) ? result.candidates.length : 0,
    unavailable: result.unavailable === true,
    more_results_available: result.more_results_available === true,
    marketplace_id: result.marketplace_id || "",
    model_id: result.model_id || ""
  };
}

function providerUnavailableError(result = {}) {
  const error = new Error(result.reason || "Provider unavailable.");
  error.code = "provider_unavailable";
  error.provider = result.provider_id || null;
  return error;
}

async function runCapability(report, name, fn, {
  required = true
} = {}) {
  try {
    const details = await fn();
    addCapability(report, name, "passed", details, { required });
  } catch (error) {
    addCapability(report, name, "failed", {
      error_code: error.code || "error",
      message: safeProviderErrorMessage(error)
    }, { required });
  }
}

export async function runAgnesSmoke({
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes
} = {}) {
  const report = createSmokeReport("agnes");
  const requireMultiImage = booleanFromEnv(env, "AGNES_SMOKE_REQUIRE_MULTI_IMAGE", false);
  const requireToolCall = booleanFromEnv(env, "AGNES_SMOKE_REQUIRE_TOOL_CALL", false);
  const requireErrorResponse = booleanFromEnv(env, "AGNES_SMOKE_REQUIRE_ERROR_RESPONSE", false);

  if (!env.AGNES_API_KEY) {
    addCapability(report, "credentials", "skipped", { reason: "AGNES_API_KEY is not configured." });
    return report;
  }
  if (!env.AGNES_SMOKE_IMAGE_URL) {
    addCapability(report, "single_image_json", "skipped", { reason: "AGNES_SMOKE_IMAGE_URL is not configured." });
    return report;
  }

  const frontImage = {
    name: "agnes-smoke-front",
    url: env.AGNES_SMOKE_IMAGE_URL
  };

  await runCapability(report, "single_image_json", async () => {
    const result = await analyzeImpl({
      images: [frontImage],
      prompt: smokePrompt,
      env
    });
    return resultDetails(result);
  });

  if (env.AGNES_SMOKE_BACK_IMAGE_URL) {
    await runCapability(report, "front_back_multi_image_json", async () => {
      const result = await analyzeImpl({
        images: [
          frontImage,
          {
            name: "agnes-smoke-back",
            url: env.AGNES_SMOKE_BACK_IMAGE_URL
          }
        ],
        prompt: smokePrompt,
        env
      });
      return resultDetails(result);
    }, { required: requireMultiImage });
  } else {
    addCapability(report, "front_back_multi_image_json", "skipped", {
      reason: "AGNES_SMOKE_BACK_IMAGE_URL is not configured."
    }, { required: requireMultiImage });
  }

  await runCapability(report, "tool_call", async () => {
    const result = await analyzeImpl({
      images: [frontImage],
      prompt: toolSmokePrompt,
      tools: [agnesSmokeTool],
      toolChoice: {
        type: "function",
        function: {
          name: "submit_card_evidence"
        }
      },
      env
    });
    return resultDetails(result);
  }, { required: requireToolCall });

  if (env.AGNES_SMOKE_ERROR_IMAGE_URL) {
    await runCapability(report, "error_response", async () => {
      try {
        await analyzeImpl({
          images: [
            {
              name: "agnes-smoke-error-image",
              url: env.AGNES_SMOKE_ERROR_IMAGE_URL
            }
          ],
          prompt: smokePrompt,
          env
        });
      } catch (error) {
        return {
          error_code: error.code || "provider_error",
          status: error.status || "unknown"
        };
      }
      throw new Error("Expected Agnes smoke error image to produce a provider error.");
    }, { required: requireErrorResponse });
  } else {
    addCapability(report, "error_response", "skipped", {
      reason: "AGNES_SMOKE_ERROR_IMAGE_URL is not configured."
    }, { required: requireErrorResponse });
  }

  return report;
}

async function runOpenAiSmoke() {
  if (!process.env.OPENAI_API_KEY) skip("OPENAI_API_KEY is not configured.");
  if (!process.env.OPENAI_SMOKE_IMAGE_URL && !process.env.OPENAI_SMOKE_IMAGE_DATA_URL) {
    skip("OPENAI_SMOKE_IMAGE_URL or OPENAI_SMOKE_IMAGE_DATA_URL is not configured.");
  }

  const result = await analyzeCardEvidenceWithOpenAiEmergency({
    images: [
      {
        name: "openai-smoke-image",
        url: process.env.OPENAI_SMOKE_IMAGE_URL || "",
        dataUrl: process.env.OPENAI_SMOKE_IMAGE_DATA_URL || ""
      }
    ],
    prompt: smokePrompt
  });

  pass(result);
}

export async function runBraveSmoke({
  env = process.env,
  providerImpl = null
} = {}) {
  const report = createSmokeReport("brave");
  const queryId = "brave_smoke_1";

  if (!env.BRAVE_SEARCH_API_KEY) {
    addCapability(report, "credentials", "skipped", { reason: "BRAVE_SEARCH_API_KEY is not configured." });
    return report;
  }

  const brave = providerImpl || braveSearchProvider({ env });
  await runCapability(report, "web_search", async () => {
    const result = await brave.search({
      query: {
        query_id: queryId,
        query: env.BRAVE_SEARCH_SMOKE_QUERY || "\"TCAR-CF\" \"Cooper Flagg\""
      }
    });
    if (result.unavailable) throw providerUnavailableError(result);
    return retrievalResultDetails(result, { queryId });
  });

  return report;
}

export async function runEbaySmoke({
  env = process.env,
  providerImpl = null
} = {}) {
  const report = createSmokeReport("ebay_browse");
  const queryId = "ebay_smoke_1";

  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    addCapability(report, "credentials", "skipped", { reason: "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured." });
    return report;
  }

  const ebay = providerImpl || ebayBrowseProvider({ env });
  await runCapability(report, "marketplace_search", async () => {
    const result = await ebay.search({
      query: {
        query_id: queryId,
        query: env.EBAY_BROWSE_SMOKE_QUERY || "\"TCAR-CF\" \"Cooper Flagg\""
      }
    });
    if (result.unavailable) throw providerUnavailableError(result);
    return retrievalResultDetails(result, { queryId });
  });

  return report;
}

export async function runOwsSmoke({
  env = process.env,
  providerImpl = null
} = {}) {
  const report = createSmokeReport("openai_web_search");
  const queryId = "ows_smoke_1";

  if (!env.OPENAI_API_KEY) {
    addCapability(report, "credentials", "skipped", { reason: "OPENAI_API_KEY is not configured." });
    return report;
  }
  if (!env.OPENAI_WEB_SEARCH_MODEL) {
    addCapability(report, "model", "skipped", { reason: "OPENAI_WEB_SEARCH_MODEL is not configured." });
    return report;
  }

  const ows = providerImpl || openAiWebSearchProvider({ env });
  await runCapability(report, "web_search_fallback", async () => {
    const result = await ows.search({
      query: {
        query_id: queryId,
        query: env.OPENAI_WEB_SEARCH_SMOKE_QUERY || "\"TCAR-CF\" \"Cooper Flagg\""
      }
    });
    if (result.unavailable) throw providerUnavailableError(result);
    return retrievalResultDetails(result, { queryId });
  });

  return report;
}

function printSmokeReport(report) {
  console.log(`${report.provider} smoke ${report.status}.`);
  for (const capability of report.capabilities) {
    const details = capability.details
      ? ` ${JSON.stringify(capability.details)}`
      : "";
    console.log(`- ${capability.name}: ${capability.status}${details}`);
  }
}

export async function writeSmokeReport(report, outputPath) {
  if (!outputPath) return;
  const resolvedPath = resolve(outputPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  let report = null;

  if (provider === "agnes") {
    report = await runAgnesSmoke();
  } else if (provider === "openai") {
    await runOpenAiSmoke();
    return;
  } else if (provider === "brave") {
    report = await runBraveSmoke();
  } else if (provider === "ebay") {
    report = await runEbaySmoke();
  } else if (provider === "ows") {
    report = await runOwsSmoke();
  } else {
    console.error("Usage: node scripts/smoke-provider.mjs <agnes|openai|brave|ebay|ows>");
    process.exit(1);
  }

  printSmokeReport(report);
  await writeSmokeReport(report, reportPath);
  if (report.status === "failed") process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`${provider} smoke failed: ${safeProviderErrorMessage(error)}`);
    process.exit(1);
  }
}
