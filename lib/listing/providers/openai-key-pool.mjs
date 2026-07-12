import crypto from "node:crypto";

function cleanText(value) {
  return String(value ?? "").trim();
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function splitKeyList(value = "") {
  const text = cleanText(value);
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(cleanText).filter(Boolean);
    } catch {
      // Fall through to delimiter parsing.
    }
  }
  return text
    .split(/[\n,;]+/g)
    .map(cleanText)
    .filter(Boolean);
}

function indexedKeysFromEnv(env = process.env) {
  const keys = [];
  for (let index = 1; index <= 50; index += 1) {
    const value = cleanText(env[`OPENAI_API_KEY_${index}`]);
    if (value) keys.push(value);
  }
  return keys;
}

export function openAiApiKeyPool(env = process.env) {
  const rawKeys = [
    ...splitKeyList(env.OPENAI_API_KEY_POOL),
    ...splitKeyList(env.OPENAI_API_KEYS),
    ...indexedKeysFromEnv(env),
    cleanText(env.OPENAI_API_KEY)
  ].filter(Boolean);

  const seen = new Set();
  return rawKeys.filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function openAiKeyPoolSize(env = process.env) {
  return openAiApiKeyPool(env).length;
}

export function openAiPerKeyStableConcurrency(env = process.env) {
  return positiveInteger(
    env.OPENAI_PER_KEY_STABLE_CONCURRENCY ?? env.V4_OPENAI_PER_KEY_CONCURRENCY,
    2,
    { min: 1, max: 8 }
  );
}

export function openAiProviderGlobalConcurrency(env = process.env) {
  const poolSize = Math.max(1, openAiKeyPoolSize(env));
  const perKey = openAiPerKeyStableConcurrency(env);
  const computed = Math.max(1, poolSize * perKey);
  const explicitMax = env.OPENAI_PROVIDER_MAX_TOTAL_CONCURRENCY ?? env.V4_OPENAI_MAX_TOTAL_CONCURRENCY;
  if (cleanText(explicitMax)) {
    return Math.min(computed, positiveInteger(explicitMax, computed, { min: 1, max: 96 }));
  }
  // The 2026-07-12 production sweep found the throughput/stability knee at 2.
  // Additional keys provide rotation and headroom; they do not implicitly
  // raise global concurrency without an explicit capacity experiment.
  return Math.min(computed, 2);
}

function hashToIndex(value = "", size = 1) {
  if (size <= 1) return 0;
  const digest = crypto.createHash("sha256").update(String(value || "")).digest("hex");
  const number = Number.parseInt(digest.slice(0, 12), 16);
  return Number.isFinite(number) ? number % size : 0;
}

export function selectOpenAiApiKey({
  env = process.env,
  shardKey = "",
  preferredKeySlot = null
} = {}) {
  const keys = openAiApiKeyPool(env);
  if (!keys.length) {
    return {
      apiKey: "",
      keyIndex: null,
      keySlot: null,
      poolSize: 0,
      source: "missing"
    };
  }

  const preferredIndex = Number.isFinite(Number(preferredKeySlot))
    && Number(preferredKeySlot) >= 1
    && Number(preferredKeySlot) <= keys.length
    ? Math.trunc(Number(preferredKeySlot)) - 1
    : null;
  const keyIndex = preferredIndex ?? (cleanText(shardKey)
    ? hashToIndex(shardKey, keys.length)
    : Math.floor(Math.random() * keys.length));
  return {
    apiKey: keys[keyIndex] || "",
    keyIndex,
    keySlot: keyIndex + 1,
    poolSize: keys.length,
    source: preferredIndex !== null ? "capacity_lease" : keys.length > 1 ? "pool" : "single"
  };
}

export function orderedOpenAiApiKeySelections({
  env = process.env,
  shardKey = "",
  preferredKeySlot = null
} = {}) {
  const keys = openAiApiKeyPool(env);
  if (!keys.length) return [];
  const first = selectOpenAiApiKey({ env, shardKey, preferredKeySlot });
  const startIndex = Number.isFinite(Number(first.keyIndex)) ? Number(first.keyIndex) : 0;
  return keys.map((apiKey, offset) => {
    const keyIndex = (startIndex + offset) % keys.length;
    return {
      apiKey: keys[keyIndex] || apiKey,
      keyIndex,
      keySlot: keyIndex + 1,
      poolSize: keys.length,
      source: offset === 0 && first.source === "capacity_lease"
        ? "capacity_lease"
        : keys.length > 1 ? "pool" : "single"
    };
  });
}

export function openAiProviderPoolStatus(env = process.env) {
  return {
    key_pool_size: openAiKeyPoolSize(env),
    per_key_stable_concurrency: openAiPerKeyStableConcurrency(env),
    global_concurrency: openAiProviderGlobalConcurrency(env)
  };
}
