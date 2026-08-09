import { createHash } from "node:crypto";

const OPTIMIZATION_PACK_KEYS = Object.freeze([
  "id",
  "provider",
  "model",
  "request_defaults",
  "resource_hints"
]);
const REQUEST_DEFAULT_KEYS = Object.freeze([
  "reasoning_effort",
  "image_detail",
  "max_output_tokens",
  "sampling_parameters"
]);
const RESOURCE_HINT_KEYS = Object.freeze([
  "estimated_tokens_per_attempt",
  "provider_timeout_ms"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function exactPlainObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requiredText(value, name, { lowercase = false } = {}) {
  if (typeof value !== "string") throw new TypeError(`invalid_${name}`);
  const text = value.trim();
  if (!text) throw new TypeError(`missing_${name}`);
  const canonical = lowercase ? text.toLowerCase() : text;
  if (value !== canonical) throw new TypeError(`noncanonical_${name}`);
  return canonical;
}

function positiveInteger(value, name) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`invalid_${name}`);
  }
  return value;
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("optimization_pack_value_not_plain");
    }
    return Object.fromEntries(Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new TypeError("optimization_pack_value_undefined");
      return [key, canonicalValue(value[key])];
    }));
  }
  throw new TypeError("optimization_pack_value_invalid");
}

export function canonicalOptimizationPackJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256OptimizationPack(value) {
  return createHash("sha256").update(canonicalOptimizationPackJson(value)).digest("hex");
}

/**
 * Provider/model-specific request defaults only. Canonical field meaning,
 * Storage durability, operation identity and Composer behavior must never be
 * added here. Experimental fields stay absent until they have executable,
 * promoted wire semantics.
 */
export function validateCsmModelOptimizationPack(value) {
  if (!exactPlainObject(value, OPTIMIZATION_PACK_KEYS)) {
    throw new TypeError("model_optimization_pack_shape_invalid");
  }
  if (!exactPlainObject(value.request_defaults, REQUEST_DEFAULT_KEYS)) {
    throw new TypeError("model_optimization_pack_request_defaults_invalid");
  }
  if (!exactPlainObject(value.resource_hints, RESOURCE_HINT_KEYS)) {
    throw new TypeError("model_optimization_pack_resource_hints_invalid");
  }
  const requestDefaults = {
    reasoning_effort: requiredText(
      value.request_defaults.reasoning_effort,
      "optimization_reasoning_effort",
      { lowercase: true }
    ),
    image_detail: requiredText(
      value.request_defaults.image_detail,
      "optimization_image_detail",
      { lowercase: true }
    ),
    max_output_tokens: positiveInteger(
      value.request_defaults.max_output_tokens,
      "optimization_max_output_tokens"
    ),
    sampling_parameters: requiredText(
      value.request_defaults.sampling_parameters,
      "optimization_sampling_parameters",
      { lowercase: true }
    )
  };
  if (requestDefaults.sampling_parameters !== "omit") {
    throw new TypeError("model_optimization_pack_sampling_must_be_omitted");
  }
  return deepFreeze({
    id: requiredText(value.id, "optimization_pack_id"),
    provider: requiredText(value.provider, "optimization_pack_provider", { lowercase: true }),
    model: requiredText(value.model, "optimization_pack_model"),
    request_defaults: requestDefaults,
    resource_hints: {
      estimated_tokens_per_attempt: positiveInteger(
        value.resource_hints.estimated_tokens_per_attempt,
        "optimization_estimated_tokens_per_attempt"
      ),
      provider_timeout_ms: positiveInteger(
        value.resource_hints.provider_timeout_ms,
        "optimization_provider_timeout_ms"
      )
    }
  });
}

export const CSM_LUNA_OPTIMIZATION_PACK = validateCsmModelOptimizationPack({
  id: "openai-gpt-5.6-luna-optimization-v1",
  provider: "openai",
  model: "gpt-5.6-luna",
  request_defaults: {
    reasoning_effort: "low",
    image_detail: "high",
    max_output_tokens: 8_192,
    // GPT-5.6 Luna rejects temperature/top_p/seed in the measured path. This
    // is an executable omission policy, not a capability label.
    sampling_parameters: "omit"
  },
  resource_hints: {
    // Current low/high controls have p95 total usage near 6,457 tokens. The
    // rounded reservation prevents the global token wall from oversubscribing
    // long responses; 120s is the current Writer provider deadline.
    estimated_tokens_per_attempt: 6_500,
    provider_timeout_ms: 120_000
  }
});

export const CSM_LUNA_OPTIMIZATION_PACK_SHA256 = sha256OptimizationPack(
  CSM_LUNA_OPTIMIZATION_PACK
);

const optimizationPacks = Object.freeze({
  [CSM_LUNA_OPTIMIZATION_PACK.id]: CSM_LUNA_OPTIMIZATION_PACK
});

/** Resolve a current profile before a paid call. Historical checkpoints do
 * not use this registry; they validate their embedded contract and self-hash.
 */
export function resolveCsmModelOptimizationPack({
  id = null,
  sha256 = null,
  provider = null,
  model = null
} = {}) {
  if (id === null && sha256 === null) return null;
  if (id === null || sha256 === null) {
    throw new TypeError("model_optimization_pack_receipt_incomplete");
  }
  const packId = requiredText(id, "optimization_pack_id");
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new TypeError("invalid_optimization_pack_sha256");
  }
  const pack = optimizationPacks[packId];
  if (!pack) throw new TypeError(`unsupported_model_optimization_pack:${packId}`);
  if (sha256OptimizationPack(pack) !== sha256) {
    throw new TypeError("model_optimization_pack_sha256_mismatch");
  }
  if (provider !== null
      && requiredText(provider, "provider", { lowercase: true }) !== pack.provider) {
    throw new TypeError("model_optimization_pack_provider_mismatch");
  }
  if (model !== null && requiredText(model, "model") !== pack.model) {
    throw new TypeError("model_optimization_pack_model_mismatch");
  }
  return pack;
}
