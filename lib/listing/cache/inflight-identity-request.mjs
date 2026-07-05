const defaultTtlMs = 45_000;
const defaultMaxEntries = 128;
const sha256HexPattern = /^[0-9a-f]{64}$/;
const inFlightRequests = new Map();

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(normalizeText(value).toLowerCase());
}

function falsy(value) {
  return ["0", "false", "no", "off"].includes(normalizeText(value).toLowerCase());
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function cacheKeyIsValid(cacheKey) {
  return sha256HexPattern.test(normalizeText(cacheKey).toLowerCase());
}

function usageNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function identityInFlightCoalescingEnabled(env = process.env) {
  const explicit = env.LISTING_IDENTITY_INFLIGHT_DEDUP_ENABLED
    ?? env.LISTING_IDENTITY_INFLIGHT_COALESCING_ENABLED;
  if (explicit === undefined || explicit === null || explicit === "") return true;
  if (falsy(explicit)) return false;
  return truthy(explicit);
}

export function identityInFlightCoalescingLimits(env = process.env) {
  return {
    ttl_ms: positiveInteger(env.LISTING_IDENTITY_INFLIGHT_DEDUP_TTL_MS, defaultTtlMs),
    max_entries: positiveInteger(env.LISTING_IDENTITY_INFLIGHT_DEDUP_MAX_ENTRIES, defaultMaxEntries)
  };
}

function cleanupExpired(nowMs, ttlMs) {
  for (const [key, entry] of inFlightRequests.entries()) {
    if (nowMs - entry.started_at_ms > ttlMs) inFlightRequests.delete(key);
  }
}

function trimOldest(maxEntries) {
  while (inFlightRequests.size >= maxEntries) {
    const oldestKey = inFlightRequests.keys().next().value;
    if (!oldestKey) break;
    inFlightRequests.delete(oldestKey);
  }
}

function withCoalescingMetadata(result = {}, {
  cacheKey,
  coalesced,
  waitMs,
  startedAtMs
} = {}) {
  const usage = result.usage && typeof result.usage === "object" ? result.usage : {};
  const avoided = {
    provider_calls: usageNumber(usage.provider_calls),
    recognition_worker_calls: usageNumber(usage.recognition_worker_calls),
    retrieval_calls: usageNumber(usage.retrieval_calls),
    estimated_cost_usd: usageNumber(usage.estimated_cost_usd)
  };
  const coalescedUsage = coalesced
    ? {
      ...usage,
      provider_calls: 0,
      recognition_worker_calls: 0,
      retrieval_calls: 0,
      estimated_cost_usd: 0,
      latency_ms: Math.max(0, Math.round(waitMs || 0)),
      coalesced_provider_calls_avoided: avoided.provider_calls,
      coalesced_recognition_worker_calls_avoided: avoided.recognition_worker_calls,
      coalesced_retrieval_calls_avoided: avoided.retrieval_calls,
      coalesced_cost_usd_avoided: avoided.estimated_cost_usd
    }
    : usage;

  return {
    ...result,
    usage: coalesced ? coalescedUsage : result.usage,
    identity_inflight: {
      ...(result.identity_inflight || {}),
      enabled: true,
      coalesced: coalesced === true,
      cache_key: cacheKey || null,
      wait_ms: Math.max(0, Math.round(waitMs || 0)),
      started_at_ms: startedAtMs || null,
      avoided_usage: coalesced ? avoided : null
    },
    resolution_trace: [
      ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : []),
      {
        phase: "identity_inflight_coalescing",
        step: coalesced ? "reuse_inflight_result" : "register_inflight_result",
        input: {
          cache_key: cacheKey || null
        },
        output: {
          coalesced: coalesced === true,
          wait_ms: Math.max(0, Math.round(waitMs || 0))
        },
        decision: coalesced ? "reuse_inflight_identity_request" : "execute_identity_request",
        created_at: new Date().toISOString()
      }
    ]
  };
}

export async function runWithInFlightIdentityRequest({
  cacheKey,
  run,
  env = process.env,
  now = Date.now
} = {}) {
  if (typeof run !== "function") throw new Error("runWithInFlightIdentityRequest requires a run function.");
  if (!identityInFlightCoalescingEnabled(env) || !cacheKeyIsValid(cacheKey)) return run();

  const limits = identityInFlightCoalescingLimits(env);
  const nowMs = now();
  cleanupExpired(nowMs, limits.ttl_ms);

  const existing = inFlightRequests.get(cacheKey);
  if (existing) {
    const waitStartedAtMs = now();
    const result = await existing.promise;
    return withCoalescingMetadata(result, {
      cacheKey,
      coalesced: true,
      waitMs: now() - waitStartedAtMs,
      startedAtMs: existing.started_at_ms
    });
  }

  trimOldest(limits.max_entries);
  const startedAtMs = now();
  const promise = Promise.resolve().then(run);
  inFlightRequests.set(cacheKey, {
    promise,
    started_at_ms: startedAtMs
  });

  try {
    const result = await promise;
    return withCoalescingMetadata(result, {
      cacheKey,
      coalesced: false,
      waitMs: now() - startedAtMs,
      startedAtMs
    });
  } finally {
    const current = inFlightRequests.get(cacheKey);
    if (current?.promise === promise) inFlightRequests.delete(cacheKey);
  }
}

export function inFlightIdentityRequestStats() {
  return {
    active: inFlightRequests.size,
    keys: [...inFlightRequests.keys()]
  };
}

export function clearInFlightIdentityRequestsForTests() {
  inFlightRequests.clear();
}

