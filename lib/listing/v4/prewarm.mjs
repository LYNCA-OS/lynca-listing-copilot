import { catalogProvider } from "../retrieval/catalog-provider.mjs";
import { postgresHybridProvider } from "../retrieval/postgres-hybrid-provider.mjs";
import { checkV4Tables } from "./session/session-store.mjs";

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function safeError(error) {
  if (error?.name === "AbortError") return "timeout";
  return String(error?.message || error || "unknown_error").slice(0, 120);
}

function deploymentValue(env, key) {
  return String(env[key] || "").trim();
}

export function v4DeploymentInfo(env = process.env) {
  return {
    git_commit_sha: deploymentValue(env, "VERCEL_GIT_COMMIT_SHA") || deploymentValue(env, "GIT_COMMIT_SHA"),
    git_commit_ref: deploymentValue(env, "VERCEL_GIT_COMMIT_REF") || deploymentValue(env, "GIT_BRANCH"),
    vercel_env: deploymentValue(env, "VERCEL_ENV"),
    vercel_region: deploymentValue(env, "VERCEL_REGION"),
    deployment_id: deploymentValue(env, "VERCEL_DEPLOYMENT_ID")
  };
}

async function runStep(name, task) {
  const startedAt = performance.now();
  try {
    const result = await task();
    return {
      name,
      ok: result?.ok !== false,
      latency_ms: elapsedMs(startedAt),
      ...result
    };
  } catch (error) {
    return {
      name,
      ok: false,
      latency_ms: elapsedMs(startedAt),
      error: safeError(error)
    };
  }
}

function prewarmEnv(env = process.env) {
  const catalogTimeout = positiveInteger(env.PREWARM_CATALOG_TIMEOUT_MS, 2500);
  const hybridTimeout = positiveInteger(env.PREWARM_HYBRID_TIMEOUT_MS, 2500);
  return {
    ...env,
    CATALOG_RETRIEVAL_TIMEOUT_MS: String(catalogTimeout),
    CATALOG_RETRIEVAL_TOP_N: "1",
    CATALOG_LIVE_CURATED_ALWAYS: "false",
    ENABLE_LIVE_CURATED_CATALOG_FALLBACK: "false",
    POSTGRES_HYBRID_RETRIEVAL_TIMEOUT_MS: String(hybridTimeout),
    POSTGRES_HYBRID_RETRIEVAL_TOP_N: "1",
    ADVANCED_RETRIEVAL_STAGE1_TOP_N: "1"
  };
}

function stepSummary(providerResult = {}) {
  if (Array.isArray(providerResult.candidates)) {
    return {
      candidate_count: providerResult.candidates.length,
      unavailable_reason: null
    };
  }
  return {
    candidate_count: 0,
    unavailable_reason: providerResult.unavailable_reason || providerResult.reason || null
  };
}

export async function runV4Prewarm({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const startedAt = performance.now();
  const warmEnv = prewarmEnv(env);
  const includeCatalog = truthy(env.PREWARM_CATALOG_RETRIEVAL, true);
  const includeHybrid = truthy(env.PREWARM_POSTGRES_HYBRID, true);
  const steps = [];

  steps.push(await runStep("supabase_v4_tables", async () => {
    const tables = await checkV4Tables({ env: warmEnv, fetchImpl });
    const allTablesOk = tables.configured && Object.values(tables.tables || {}).every((table) => table.ok);
    return {
      ok: allTablesOk,
      configured: tables.configured,
      table_count: Object.keys(tables.tables || {}).length,
      error: tables.error || null
    };
  }));

  if (includeCatalog) {
    steps.push(await runStep("catalog_rpc", async () => {
      const provider = catalogProvider({ env: warmEnv, fetchImpl });
      const result = await provider.search({
        query: {
          family: "prewarm",
          search_text: "Michael Jordan",
          exact_subject: "Michael Jordan",
          match_count: 1
        },
        resolved: {}
      });
      return {
        ok: !result.unavailable,
        ...stepSummary(result)
      };
    }));
  }

  if (includeHybrid) {
    steps.push(await runStep("postgres_hybrid_rpc", async () => {
      const provider = postgresHybridProvider({
        env: {
          ...warmEnv,
          ENABLE_POSTGRES_HYBRID_RETRIEVAL: "true"
        },
        fetchImpl
      });
      const result = await provider.search({
        query: {
          family: "prewarm",
          search_text: "Michael Jordan",
          exact_subject: "Michael Jordan",
          match_count: 1
        },
        resolved: {}
      });
      return {
        ok: !result.unavailable,
        ...stepSummary(result)
      };
    }));
  }

  return {
    ok: true,
    warmed: steps.some((step) => step.ok),
    total_ms: elapsedMs(startedAt),
    vector_index_ready: truthy(env.VECTOR_INDEX_READY, false),
    deployment: v4DeploymentInfo(env),
    steps
  };
}
