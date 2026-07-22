import assert from "node:assert/strict";
import { analyzeCardEvidenceWithOpenAiEmergency } from "../lib/listing/providers/openai-emergency-provider.mjs";

const baseEnv = {
  OPENAI_API_KEY: "test-key-never-sent",
  OPENAI_LISTING_MODEL: "gpt-5-mini",
  OPENAI_LISTING_TIMEOUT_MS: "10",
  OPENAI_LISTING_TRANSIENT_RETRIES: "0"
};

let abortObserved = false;
const diagnostics = [];
const originalInfo = console.info;
console.info = (prefix, line) => {
  if (prefix === "[openai_provider_request_diagnostics]") diagnostics.push(JSON.parse(line));
};
try {
  await assert.rejects(analyzeCardEvidenceWithOpenAiEmergency({
    images: [{ signedUrl: "https://images.example/card.jpg" }],
    prompt: "Return grounded card evidence.",
    env: baseEnv,
    fetchImpl: async (_url, init = {}) => new Promise((resolve, reject) => {
      const abort = () => {
        abortObserved = true;
        const error = new Error("aborted by provider deadline");
        error.name = "AbortError";
        reject(error);
      };
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
      void resolve;
    })
  }), (error) => {
    assert.equal(error.code, "PROVIDER_TIMEOUT");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(abortObserved, true, "provider deadline must abort the in-flight transport");

  await assert.rejects(analyzeCardEvidenceWithOpenAiEmergency({
    images: [{ signedUrl: "https://images.example/card.jpg" }],
    prompt: "Return grounded card evidence.",
    env: baseEnv,
    fetchImpl: async () => {
      throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    }
  }), (error) => {
    assert.equal(error.code, "network_error");
    assert.equal(error.retryable, true);
    return true;
  });
} finally {
  console.info = originalInfo;
}

assert.equal(diagnostics.length, 2, "every attempted provider transport needs one diagnostic record");
assert.equal(diagnostics[0].response_status, "provider_timeout");
assert.equal(diagnostics[0].input_tokens, null);
assert.equal(diagnostics[0].output_tokens, null);
assert.ok(diagnostics[0].provider_latency_ms >= 0);
assert.equal(diagnostics[1].response_status, "network_error");

let retryCalls = 0;
await assert.rejects(analyzeCardEvidenceWithOpenAiEmergency({
  images: [{ signedUrl: "https://images.example/card.jpg" }],
  prompt: "Return grounded card evidence.",
  env: {
    ...baseEnv,
    OPENAI_LISTING_TIMEOUT_MS: "100",
    OPENAI_LISTING_ATTEMPT_TIMEOUT_MS: "10",
    OPENAI_LISTING_TRANSIENT_RETRIES: "1",
    OPENAI_LISTING_TRANSIENT_RETRY_DELAY_MS: "0"
  },
  fetchImpl: async (_url, init = {}) => {
    retryCalls += 1;
    return await new Promise((resolve, reject) => {
      const abort = () => {
        const error = new Error("attempt deadline");
        error.name = "AbortError";
        reject(error);
      };
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
      void resolve;
    });
  }
}), (error) => {
  assert.equal(error.code, "PROVIDER_TIMEOUT");
  return true;
});
assert.equal(retryCalls, 2, "a soft provider tail must get one immediate bounded retry");

console.log("OpenAI provider timeout tests passed");
