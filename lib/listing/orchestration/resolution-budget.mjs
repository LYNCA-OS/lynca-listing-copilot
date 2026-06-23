const defaultBudget = Object.freeze({
  maxRounds: 6,
  maxExternalQueries: 8,
  maxAgnesCalls: 3,
  maxRetrievalTimeMs: 8000,
  maxResolutionTimeMs: 18000,
  maxResolutionCostUsd: 0.16
});

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createResolutionBudget({
  env = process.env,
  now = Date.now(),
  overrides = {}
} = {}) {
  const limits = {
    maxRounds: numberFromEnv(env.MAX_RESOLUTION_ROUNDS, defaultBudget.maxRounds),
    maxExternalQueries: numberFromEnv(env.MAX_EXTERNAL_QUERIES, defaultBudget.maxExternalQueries),
    maxAgnesCalls: numberFromEnv(env.MAX_AGNES_CALLS_PER_ASSET, defaultBudget.maxAgnesCalls),
    maxRetrievalTimeMs: numberFromEnv(env.MAX_RETRIEVAL_TIME_MS, defaultBudget.maxRetrievalTimeMs),
    maxResolutionTimeMs: numberFromEnv(env.MAX_RESOLUTION_TIME_MS, defaultBudget.maxResolutionTimeMs),
    maxResolutionCostUsd: numberFromEnv(env.MAX_RESOLUTION_COST_USD, defaultBudget.maxResolutionCostUsd),
    ...overrides
  };

  return {
    started_at_ms: now,
    limits,
    used: {
      rounds: 0,
      external_queries: 0,
      agnes_calls: 0,
      retrieval_time_ms: 0,
      resolution_time_ms: 0,
      estimated_cost_usd: 0
    }
  };
}

export function remainingResolutionBudget(budget, now = Date.now()) {
  const elapsed = Math.max(0, now - budget.started_at_ms);
  const usedResolutionTime = Math.max(budget.used.resolution_time_ms, elapsed);

  return {
    rounds: Math.max(0, budget.limits.maxRounds - budget.used.rounds),
    external_queries: Math.max(0, budget.limits.maxExternalQueries - budget.used.external_queries),
    agnes_calls: Math.max(0, budget.limits.maxAgnesCalls - budget.used.agnes_calls),
    retrieval_time_ms: Math.max(0, budget.limits.maxRetrievalTimeMs - budget.used.retrieval_time_ms),
    resolution_time_ms: Math.max(0, budget.limits.maxResolutionTimeMs - usedResolutionTime),
    estimated_cost_usd: Math.max(0, budget.limits.maxResolutionCostUsd - budget.used.estimated_cost_usd)
  };
}

export function isResolutionBudgetExhausted(budget, now = Date.now()) {
  const remaining = remainingResolutionBudget(budget, now);
  return remaining.rounds <= 0
    || remaining.resolution_time_ms <= 0
    || remaining.estimated_cost_usd <= 0;
}

export function consumeResolutionBudget(budget, {
  rounds = 0,
  externalQueries = 0,
  agnesCalls = 0,
  retrievalTimeMs = 0,
  resolutionTimeMs = 0,
  estimatedCostUsd = 0
} = {}) {
  return {
    ...budget,
    used: {
      rounds: budget.used.rounds + rounds,
      external_queries: budget.used.external_queries + externalQueries,
      agnes_calls: budget.used.agnes_calls + agnesCalls,
      retrieval_time_ms: budget.used.retrieval_time_ms + retrievalTimeMs,
      resolution_time_ms: Math.max(budget.used.resolution_time_ms, resolutionTimeMs),
      estimated_cost_usd: Number((budget.used.estimated_cost_usd + estimatedCostUsd).toFixed(6))
    }
  };
}
