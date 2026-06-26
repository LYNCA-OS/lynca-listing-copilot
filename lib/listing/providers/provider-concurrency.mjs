import { visionProviderIds } from "./provider-contract.mjs";

const providerQueues = new Map();

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

export function providerServerConcurrencyLimit(providerId, env = process.env) {
  if (providerId === visionProviderIds.OPENAI_LEGACY) {
    return positiveInteger(env.OPENAI_PROVIDER_SERVER_CONCURRENCY, 6);
  }
  return positiveInteger(env.LISTING_PROVIDER_SERVER_CONCURRENCY, 2);
}

function queueState(providerId) {
  const key = providerId || "unknown";
  if (!providerQueues.has(key)) {
    providerQueues.set(key, {
      active: 0,
      waiting: []
    });
  }
  return providerQueues.get(key);
}

function wakeNext(state) {
  const next = state.waiting.shift();
  if (next) next();
}

export async function runWithProviderConcurrency({
  providerId,
  env = process.env,
  work
} = {}) {
  if (typeof work !== "function") {
    throw new Error("runWithProviderConcurrency requires a work function.");
  }

  const state = queueState(providerId);
  const limit = providerServerConcurrencyLimit(providerId, env);
  const queuedAt = Date.now();

  if (state.active >= limit) {
    await new Promise((resolve) => {
      state.waiting.push(resolve);
    });
  }

  const startedAt = Date.now();
  state.active += 1;
  try {
    const result = await work();
    return {
      result,
      queue_ms: Math.max(0, startedAt - queuedAt),
      active_at_start: state.active,
      limit
    };
  } finally {
    state.active = Math.max(0, state.active - 1);
    wakeNext(state);
  }
}

export function providerConcurrencyStats() {
  return Object.fromEntries([...providerQueues.entries()].map(([providerId, state]) => [
    providerId,
    {
      active: state.active,
      waiting: state.waiting.length
    }
  ]));
}

export function clearProviderConcurrencyForTests() {
  providerQueues.clear();
}
