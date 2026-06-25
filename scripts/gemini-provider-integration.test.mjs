import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeCardEvidenceWithGemini } from "../lib/listing/providers/gemini-provider.mjs";

function firstPublicCardImageUrl() {
  const raw = JSON.parse(publicCardCandidateText);
  const item = raw.items?.find((candidate) => candidate.card_image_url || candidate.image_urls?.[0]);
  return {
    url: item?.card_image_url || item?.image_urls?.[0] || "",
    referenceName: item?.reference?.card_name || ""
  };
}

const publicCardCandidateText = await readFile(
  "data/public-card-candidates/public-card-image-candidates-latest.json",
  "utf8"
);

const apiKey = process.env.GEMINI_API_KEY || "";
assert.ok(apiKey, "GEMINI_API_KEY is required for the real Gemini image integration test.");

const fallback = firstPublicCardImageUrl();
const imageUrl = process.env.GEMINI_INTEGRATION_IMAGE_URL || process.env.GEMINI_SMOKE_IMAGE_URL || fallback.url;
assert.ok(imageUrl, "A real card image URL is required. Set GEMINI_INTEGRATION_IMAGE_URL or keep the public-card candidate fixture.");

const startedAt = Date.now();
const result = await analyzeCardEvidenceWithGemini({
  images: [
    {
      name: "gemini-integration-real-card",
      url: imageUrl,
      side: "front"
    }
  ],
  prompt: [
    "This is a real Listing Copilot Gemini image integration test.",
    "Read only the supplied card image and return the required JSON.",
    "If the card identity is uncertain, set recognition_status to ABSTAIN.",
    fallback.referenceName ? `Reference-name context for smoke validation only: ${fallback.referenceName}` : ""
  ].filter(Boolean).join("\n"),
  env: {
    ...process.env,
    GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS || "45000",
    GEMINI_MAX_OUTPUT_TOKENS: process.env.GEMINI_MAX_OUTPUT_TOKENS || "700"
  }
});

assert.equal(result.provider, "gemini");
assert.match(String(result.model_id), new RegExp((process.env.GEMINI_MODEL || "gemini-3.1-flash-lite").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.ok(["CONFIRMED", "RESOLVED", "ABSTAIN"].includes(result.recognition_status));
assert.equal(result.usage.image_count, 1);
assert.ok(result.usage.provider_calls >= 1 && result.usage.provider_calls <= 2);
assert.ok(Number(result.latency_ms) > 0);
assert.equal(JSON.stringify(result).includes(apiKey), false);
assert.equal(JSON.stringify(result).includes("AIza"), false);

console.log(JSON.stringify({
  ok: true,
  provider: result.provider,
  model_id: result.model_id,
  recognition_status: result.recognition_status,
  latency_ms: result.latency_ms,
  input_tokens: result.usage.input_tokens,
  output_tokens: result.usage.output_tokens,
  image_count: result.usage.image_count,
  elapsed_ms: Date.now() - startedAt
}));
