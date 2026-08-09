import { createHash } from "node:crypto";

export const LUNA_EXPLICIT_CACHE_SCREEN_VERSION = "luna-explicit-cache-screen-v1";
export const LUNA_EXPLICIT_CACHE_POLICY = Object.freeze({
  id: "openai-gpt-5.6-explicit-prefix-cache-v1",
  provider: "openai",
  model: "gpt-5.6-luna",
  request_mode: "explicit",
  breakpoint_mode: "explicit",
  ttl: "30m",
  key_strategy: "one-run-scoped-experiment-key-no-production-sharding",
  production_enabled: false
});

export const LUNA_EXPLICIT_CACHE_STEPS = Object.freeze([
  Object.freeze({ id: "same_card_cold", fixture_id: "synthetic-card-a", gate: "cold_write" }),
  Object.freeze({ id: "same_card_warm", fixture_id: "synthetic-card-a", gate: "same_card_read" }),
  Object.freeze({ id: "cross_card_warm", fixture_id: "synthetic-card-b", gate: "cross_card_read" })
]);

const BREAKPOINT = Object.freeze({ mode: "explicit" });
const CACHE_OPTIONS = Object.freeze({ mode: "explicit", ttl: "30m" });

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function requiredRunId(value) {
  const runId = String(value || "").trim();
  if (!/^[a-zA-Z0-9._-]{8,120}$/.test(runId)) throw new Error("run_id_invalid");
  return runId;
}

export function normalizeCachePreviewIdentity(value) {
  const identity = {
    environment: String(value?.environment || "").trim().toLowerCase(),
    region: String(value?.region || "").trim().toLowerCase(),
    deployment_id: String(value?.deployment_id || "").trim(),
    deployment_hostname: String(value?.deployment_hostname || "").trim().toLowerCase(),
    release_git_sha: String(value?.release_git_sha || "").trim().toLowerCase()
  };
  if (identity.environment !== "preview"
      || identity.region !== "sin1"
      || !/^dpl_[a-zA-Z0-9_-]{3,160}$/.test(identity.deployment_id)
      || !/^[a-z0-9.-]+\.vercel\.app$/.test(identity.deployment_hostname)
      || !/^[0-9a-f]{40}$/.test(identity.release_git_sha)) {
    throw new Error("cache_preview_identity_invalid");
  }
  return Object.freeze(identity);
}

export function experimentalCacheKey(runId) {
  return `lynca:luna-cache-screen:v1:${sha256(requiredRunId(runId)).slice(0, 24)}`;
}

export function stripExplicitCacheTransport(request) {
  const value = structuredClone(request);
  delete value.prompt_cache_key;
  delete value.prompt_cache_options;
  const content = value?.input?.[0]?.content;
  if (Array.isArray(content)) {
    for (const block of content) delete block.prompt_cache_breakpoint;
  }
  return value;
}

export function withExplicitCacheTransport(productionRequest, cacheKey) {
  const request = structuredClone(productionRequest);
  request.prompt_cache_key = cacheKey;
  request.prompt_cache_options = structuredClone(CACHE_OPTIONS);
  request.input[0].content[0].prompt_cache_breakpoint = structuredClone(BREAKPOINT);
  assertCacheOnlyTransportDelta(productionRequest, request);
  return request;
}

export function assertCacheOnlyTransportDelta(production, treatment) {
  if (JSON.stringify(stripExplicitCacheTransport(treatment)) !== JSON.stringify(production)) {
    throw new Error("cache_treatment_changed_semantic_request");
  }
  const prompt = treatment?.input?.[0]?.content?.[0];
  const content = treatment?.input?.[0]?.content;
  if (JSON.stringify(treatment?.prompt_cache_options) !== JSON.stringify(CACHE_OPTIONS)
      || JSON.stringify(prompt?.prompt_cache_breakpoint) !== JSON.stringify(BREAKPOINT)
      || (Array.isArray(content) && content.slice(1).some((block) => (
        Object.hasOwn(block || {}, "prompt_cache_breakpoint")
      )))
      || typeof treatment?.prompt_cache_key !== "string"
      || !treatment.prompt_cache_key) {
    throw new Error("explicit_cache_transport_contract_invalid");
  }
  return true;
}

function normalizedImageContract(request) {
  const value = structuredClone(request);
  for (const block of value?.input?.[0]?.content || []) {
    if (block?.type === "input_image") block.image_url = "synthetic-image";
  }
  return value;
}

function requestReceipt({ request, fixtureId, expectedCacheKey }) {
  const semantic = stripExplicitCacheTransport(request);
  const prompt = semantic?.input?.[0]?.content?.[0];
  const image = semantic?.input?.[0]?.content?.[1];
  if (request?.prompt_cache_key !== expectedCacheKey
      || semantic?.model !== LUNA_EXPLICIT_CACHE_POLICY.model
      || semantic?.reasoning?.effort !== "low"
      || semantic?.max_output_tokens !== 8192
      || semantic?.text?.format?.type !== "json_schema"
      || semantic?.text?.format?.strict !== true
      || prompt?.type !== "input_text" || typeof prompt?.text !== "string"
      || image?.type !== "input_image" || image?.detail !== "high"
      || typeof image?.image_url !== "string"
      || !image.image_url.startsWith("data:image/png;base64,")
      || semantic.input[0].content.length !== 2) {
    throw new Error("cache_screen_request_shape_invalid");
  }
  assertCacheOnlyTransportDelta(semantic, request);
  const stablePrefix = {
    model: semantic.model,
    max_output_tokens: semantic.max_output_tokens,
    reasoning: semantic.reasoning,
    text: semantic.text,
    input: [{ role: semantic.input[0].role, content: [prompt] }]
  };
  return Object.freeze({
    fixture_id: fixtureId,
    model: semantic.model,
    reasoning_effort: semantic.reasoning.effort,
    image_detail: image.detail,
    max_output_tokens: semantic.max_output_tokens,
    prompt_sha256: sha256(prompt.text),
    prompt_bytes: Buffer.byteLength(prompt.text),
    schema_sha256: sha256(JSON.stringify(semantic.text.format.schema)),
    schema_bytes: Buffer.byteLength(JSON.stringify(semantic.text.format.schema)),
    stable_prefix_sha256: sha256(JSON.stringify(stablePrefix)),
    semantic_request_sha256: sha256(JSON.stringify(semantic)),
    semantic_request_bytes: Buffer.byteLength(JSON.stringify(semantic)),
    semantic_contract_sha256: sha256(JSON.stringify(normalizedImageContract(semantic))),
    transport_request_sha256: sha256(JSON.stringify(request)),
    transport_request_bytes: Buffer.byteLength(JSON.stringify(request)),
    image_sha256: sha256(image.image_url),
    cache_policy_id: LUNA_EXPLICIT_CACHE_POLICY.id,
    cache_key_sha256: sha256(expectedCacheKey)
  });
}

export function validateLunaExplicitCacheScreenRequests(runId, entries) {
  const normalizedRunId = requiredRunId(runId);
  const cacheKey = experimentalCacheKey(normalizedRunId);
  if (!Array.isArray(entries) || entries.length !== LUNA_EXPLICIT_CACHE_STEPS.length) {
    throw new Error("cache_screen_steps_invalid");
  }
  const steps = LUNA_EXPLICIT_CACHE_STEPS.map((expected, index) => {
    const entry = entries[index];
    if (entry?.id !== expected.id || !entry?.request || typeof entry.request !== "object") {
      throw new Error("cache_screen_step_identity_invalid");
    }
    return Object.freeze({
      ...expected,
      request: structuredClone(entry.request),
      receipt: requestReceipt({
        request: entry.request,
        fixtureId: expected.fixture_id,
        expectedCacheKey: cacheKey
      })
    });
  });

  const [cold, warm, cross] = steps;
  if (cold.receipt.semantic_request_sha256 !== warm.receipt.semantic_request_sha256
      || cold.receipt.transport_request_sha256 !== warm.receipt.transport_request_sha256
      || cold.receipt.image_sha256 !== warm.receipt.image_sha256) {
    throw new Error("same_card_requests_not_identical");
  }
  if (warm.receipt.image_sha256 === cross.receipt.image_sha256
      || warm.receipt.semantic_request_sha256 === cross.receipt.semantic_request_sha256
      || warm.receipt.transport_request_sha256 === cross.receipt.transport_request_sha256) {
    throw new Error("cross_card_fixture_not_distinct");
  }
  if (new Set(steps.map((step) => step.receipt.stable_prefix_sha256)).size !== 1
      || new Set(steps.map((step) => step.receipt.semantic_contract_sha256)).size !== 1
      || new Set(steps.map((step) => step.receipt.cache_key_sha256)).size !== 1) {
    throw new Error("stable_prefix_contract_invalid");
  }

  const contract = Object.freeze({
    screen_version: LUNA_EXPLICIT_CACHE_SCREEN_VERSION,
    cache_policy_id: LUNA_EXPLICIT_CACHE_POLICY.id,
    cache_policy_sha256: sha256(JSON.stringify(LUNA_EXPLICIT_CACHE_POLICY)),
    cache_transport_shape_sha256: sha256(JSON.stringify({
      prompt_cache_options: CACHE_OPTIONS,
      prompt_cache_breakpoint: BREAKPOINT
    })),
    semantic_step_contract_sha256: sha256(JSON.stringify(steps.map((step) => ({
      id: step.id,
      fixture_id: step.fixture_id,
      gate: step.gate,
      semantic_request_sha256: step.receipt.semantic_request_sha256,
      semantic_request_bytes: step.receipt.semantic_request_bytes,
      semantic_contract_sha256: step.receipt.semantic_contract_sha256,
      image_sha256: step.receipt.image_sha256
    })))),
    stable_prefix_sha256: cold.receipt.stable_prefix_sha256,
    semantic_contract_sha256: cold.receipt.semantic_contract_sha256,
    prompt_sha256: cold.receipt.prompt_sha256,
    schema_sha256: cold.receipt.schema_sha256,
    model: cold.receipt.model,
    reasoning_effort: cold.receipt.reasoning_effort,
    image_detail: cold.receipt.image_detail,
    max_output_tokens: cold.receipt.max_output_tokens
  });
  return Object.freeze({
    run_id: normalizedRunId,
    cache_key: cacheKey,
    cache_key_sha256: sha256(cacheKey),
    contract,
    steps
  });
}

export function preflightReceiptSha256(plan, previewIdentity) {
  const identity = normalizeCachePreviewIdentity(previewIdentity);
  return sha256(JSON.stringify({
    screen_version: plan.contract.screen_version,
    run_id: plan.run_id,
    cache_key_sha256: plan.cache_key_sha256,
    preview_identity: identity,
    contract: plan.contract,
    requests: plan.steps.map((step) => ({
      id: step.id,
      semantic_request_sha256: step.receipt.semantic_request_sha256,
      transport_request_sha256: step.receipt.transport_request_sha256
    }))
  }));
}
