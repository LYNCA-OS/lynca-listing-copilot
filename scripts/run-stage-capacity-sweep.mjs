import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectConcurrencyKnee } from "../lib/listing/v4/orchestration/concurrency-contract.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value, fallback, { min = 1, max = 1000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function parseEnvFile(text = "") {
  const env = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value.replace(/\\n/g, "\n");
  }
  return env;
}

export function parseConcurrencies(value = "") {
  return [...new Set(String(value || "1,2,4")
    .split(",")
    .map((item) => positiveInteger(item, 0, { min: 0, max: 24 }))
    .filter((item) => item > 0))];
}

function quantile(values = [], percentile = 0.5) {
  const sorted = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1));
  return sorted[index];
}

async function mapWithConcurrency(items = [], concurrency = 1, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchJson(url, {
  method = "POST",
  cookie = "",
  body = null,
  timeoutMs = 120000,
  transportAttempts = 1
} = {}) {
  const startedAt = Date.now();
  const maxAttempts = Math.max(1, Math.min(3, Number(transportAttempts) || 1));
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(body === null ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {})
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        data,
        latency_ms: Date.now() - startedAt,
        transport_attempt_count: attempt,
        set_cookie: response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || ""
      };
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError" || attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("capacity sweep transport failed");
}

async function login({ baseUrl, username, password, timeoutMs }) {
  const response = await fetchJson(`${baseUrl}/api/login`, {
    body: { username, password },
    timeoutMs
  });
  if (!response.ok || response.data?.ok !== true || !response.set_cookie) {
    throw new Error(`stage sweep login failed (${response.status})`);
  }
  return response.set_cookie.split(";")[0];
}

function fieldsFromResult(result = {}) {
  const resolved = result.resolved_fields || result.resolved || result.rendered_fields?.fields || {};
  const players = Array.isArray(resolved.players)
    ? resolved.players
    : [resolved.player || resolved.subject].filter(Boolean);
  return {
    year: cleanText(resolved.year),
    manufacturer: cleanText(resolved.manufacturer || resolved.brand),
    product: cleanText(resolved.product),
    set: cleanText(resolved.set),
    players: players.map(cleanText).filter(Boolean),
    collector_number: cleanText(resolved.collector_number || resolved.card_number),
    checklist_code: cleanText(resolved.checklist_code),
    serial_number: cleanText(resolved.serial_number)
  };
}

async function loadCatalogCases(datasetPath) {
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const source = Array.isArray(dataset) ? dataset : dataset.results || dataset.items || [];
  const cases = source
    .map((result, index) => ({
      case_id: cleanText(result.candidate_id || result.asset_id || `case_${index + 1}`),
      fields: fieldsFromResult(result)
    }))
    .filter((item) => item.fields.year || item.fields.product || item.fields.players.length || item.fields.collector_number || item.fields.checklist_code);
  if (!cases.length) throw new Error("catalog stage sweep dataset has no usable resolved fields");
  return cases;
}

export function stableCandidateKey(candidate = {}) {
  const identityId = cleanText(candidate.candidate_identity_id);
  if (identityId) return `identity:${identityId}`;
  const title = cleanText(candidate.title).toLowerCase();
  const fields = candidate.fields && typeof candidate.fields === "object"
    ? Object.fromEntries(Object.entries(candidate.fields)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .sort(([left], [right]) => left.localeCompare(right)))
    : {};
  return `semantic:${title}:${JSON.stringify(fields)}`;
}

export function catalogFingerprint(data = {}) {
  const promptCandidates = Array.isArray(data.candidates) ? data.candidates : [];
  const promptKeys = promptCandidates.map(stableCandidateKey).filter(Boolean).sort();
  return JSON.stringify({
    prompt_candidate_count: Number(data.prompt_candidate_count || 0),
    prompt_keys: promptKeys
  });
}

async function runCatalogSweep({
  baseUrl,
  cookie,
  datasetPath,
  concurrencies,
  queryConcurrencies,
  repetitions,
  timeoutMs,
  minimumRequiredThroughputPerSecond
}) {
  const cases = await loadCatalogCases(datasetPath);
  async function runArms({ stage, arms, outerConcurrency, queryConcurrencyForArm }) {
    const baselineFingerprints = new Map();
    const rows = [];
    for (const arm of arms) {
      const concurrency = outerConcurrency(arm);
      const queryConcurrency = queryConcurrencyForArm(arm);
      const tasks = Array.from({ length: repetitions }, () => cases).flat();
      const wallStartedAt = Date.now();
      const results = await mapWithConcurrency(tasks, concurrency, async (item) => {
        try {
          const response = await fetchJson(`${baseUrl}/api/admin-catalog-candidate-smoke`, {
            cookie,
            body: { fields: item.fields, query_concurrency: queryConcurrency },
            timeoutMs
          });
          return {
            ...item,
            ok: response.ok && response.data?.ok === true,
            timeout: false,
            latency_ms: response.latency_ms,
            server_latency_ms: Number(response.data?.latency_ms),
            fingerprint: catalogFingerprint(response.data || {}),
            error: response.ok ? "" : `http_${response.status}`
          };
        } catch (error) {
          return {
            ...item,
            ok: false,
            timeout: error?.name === "AbortError",
            latency_ms: null,
            server_latency_ms: null,
            fingerprint: "",
            error: error?.name === "AbortError" ? "timeout" : cleanText(error?.message || error)
          };
        }
      });
      const wallMs = Date.now() - wallStartedAt;
      if (arm === arms[0]) {
        for (const result of results.filter((item) => item.ok)) {
          if (!baselineFingerprints.has(result.case_id)) baselineFingerprints.set(result.case_id, result.fingerprint);
        }
      }
      const comparable = results.filter((item) => item.ok && baselineFingerprints.has(item.case_id));
      const consistentCount = comparable.filter((item) => baselineFingerprints.get(item.case_id) === item.fingerprint).length;
      const inconsistentCaseIds = [...new Set(comparable
        .filter((item) => baselineFingerprints.get(item.case_id) !== item.fingerprint)
        .map((item) => item.case_id))];
      const successCount = results.filter((item) => item.ok).length;
      rows.push({
        stage,
        concurrency: arm,
        outer_card_concurrency: concurrency,
        query_concurrency: queryConcurrency,
        task_count: results.length,
        success_count: successCount,
        timeout_count: results.filter((item) => item.timeout).length,
        result_consistency_rate: comparable.length ? consistentCount / comparable.length : null,
        inconsistent_case_ids: inconsistentCaseIds,
        wall_ms: wallMs,
        throughput_per_second: wallMs > 0 ? results.length / (wallMs / 1000) : null,
        p50_ms: quantile(results.map((item) => item.latency_ms), 0.5),
        p95_ms: quantile(results.map((item) => item.latency_ms), 0.95),
        server_p50_ms: quantile(results.map((item) => item.server_latency_ms), 0.5),
        server_p95_ms: quantile(results.map((item) => item.server_latency_ms), 0.95),
        error_count: results.length - successCount,
        errors: results.filter((item) => !item.ok).slice(0, 5).map((item) => item.error)
      });
    }
    return {
      stage,
      sample_count: cases.length,
      repetitions,
      rows,
      selection: selectConcurrencyKnee(rows, { minimumRequiredThroughputPerSecond })
    };
  }

  const querySweep = await runArms({
    stage: "catalog_internal_queries",
    arms: queryConcurrencies,
    outerConcurrency: () => 1,
    queryConcurrencyForArm: (arm) => arm
  });
  const selectedQueryConcurrency = querySweep.selection.recommended_concurrency || queryConcurrencies[0] || 1;
  const cardSweep = await runArms({
    stage: "catalog_cards",
    arms: concurrencies,
    outerConcurrency: (arm) => arm,
    queryConcurrencyForArm: () => selectedQueryConcurrency
  });
  return {
    stage: "catalog_retrieval",
    sample_count: cases.length,
    repetitions,
    selected_query_concurrency: selectedQueryConcurrency,
    query_sweep: querySweep,
    card_sweep: cardSweep
  };
}

async function runVectorEmbeddingSweep({
  baseUrl,
  cookie,
  concurrencies,
  repetitions,
  limit,
  offset,
  timeoutMs,
  minimumRequiredThroughputPerSecond
}) {
  const rows = [];
  for (const concurrency of concurrencies.filter((value) => value <= 4)) {
    const results = [];
    const wallStartedAt = Date.now();
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      try {
        const response = await fetchJson(`${baseUrl}/api/admin-index-visual-vector-seed`, {
          cookie,
          body: {
            dry_run: true,
            capacity_sweep: true,
            offset,
            limit,
            concurrency,
            retrieval_status: "approved",
            retrieval_enabled: true
          },
          timeoutMs,
          transportAttempts: 3
        });
        results.push({
          ok: response.ok && response.data?.ok === true,
          timeout: false,
          latency_ms: response.latency_ms,
          transport_attempt_count: response.transport_attempt_count,
          requested_items: Number(response.data?.summary?.requested_items || limit),
          embedding_count: Number(response.data?.summary?.embeddings_written || 0),
          failed_items: Number(response.data?.summary?.failed_items || 0),
          worker_cache_hit_count: Number(response.data?.summary?.worker_cache_hit_count || 0),
          worker_latency_p50_ms: response.data?.summary?.worker_latency_p50_ms ?? null,
          worker_latency_p95_ms: response.data?.summary?.worker_latency_p95_ms ?? null,
          error: response.ok ? "" : `http_${response.status}`
        });
      } catch (error) {
        results.push({
          ok: false,
          timeout: error?.name === "AbortError",
          latency_ms: null,
          requested_items: limit,
          embedding_count: 0,
          failed_items: limit,
          worker_cache_hit_count: 0,
          transport_attempt_count: null,
          error: error?.name === "AbortError" ? "timeout" : cleanText(error?.message || error)
        });
      }
    }
    const wallMs = Date.now() - wallStartedAt;
    const taskCount = results.reduce((sum, item) => sum + item.requested_items, 0);
    const embeddingCount = results.reduce((sum, item) => sum + item.embedding_count, 0);
    const failedItems = results.reduce((sum, item) => sum + item.failed_items, 0);
    const successCount = results.filter((item) => item.ok).length === results.length
      ? taskCount - failedItems
      : Math.max(0, taskCount - failedItems - results.filter((item) => !item.ok).length * limit);
    rows.push({
      stage: "vector_query",
      concurrency,
      task_count: taskCount,
      success_count: successCount,
      timeout_count: results.filter((item) => item.timeout).length,
      result_consistency_rate: results.every((item) => item.ok && item.failed_items === 0) ? 1 : 0,
      wall_ms: wallMs,
      throughput_per_second: wallMs > 0 ? taskCount / (wallMs / 1000) : null,
      p50_ms: quantile(results.map((item) => item.latency_ms), 0.5),
      p95_ms: quantile(results.map((item) => item.latency_ms), 0.95),
      worker_p50_ms: quantile(results.map((item) => item.worker_latency_p50_ms), 0.5),
      worker_p95_ms: quantile(results.map((item) => item.worker_latency_p95_ms), 0.95),
      cache_hit_count: results.reduce((sum, item) => sum + item.worker_cache_hit_count, 0),
      embedding_count: embeddingCount,
      cache_hit_rate: embeddingCount > 0
        ? results.reduce((sum, item) => sum + item.worker_cache_hit_count, 0) / embeddingCount
        : null,
      transport_attempt_count: results.reduce((sum, item) => sum + (Number(item.transport_attempt_count) || 0), 0),
      error_count: taskCount - successCount,
      errors: results.filter((item) => !item.ok).slice(0, 5).map((item) => item.error)
    });
  }
  return {
    stage: "vector_query",
    sample_count: limit,
    repetitions,
    offset,
    rows,
    selection: selectConcurrencyKnee(rows, { minimumRequiredThroughputPerSecond })
  };
}

export async function runStageCapacitySweep({
  baseUrl,
  username,
  password,
  stage = "all",
  datasetPath = "",
  catalogConcurrencies = [1, 2, 4, 6, 8],
  catalogQueryConcurrencies = [1, 2, 4, 6],
  vectorConcurrencies = [1, 2, 3, 4],
  repetitions = 2,
  vectorLimit = 8,
  vectorOffset = 0,
  timeoutMs = 180000,
  minimumRequiredThroughputPerSecond = 0.2
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  if (!normalizedBaseUrl) throw new Error("stage sweep requires --base-url");
  if (!username || !password) throw new Error("stage sweep requires login credentials");
  const cookie = await login({ baseUrl: normalizedBaseUrl, username, password, timeoutMs });
  const reports = [];
  if (["all", "catalog"].includes(stage)) {
    if (!datasetPath) throw new Error("catalog stage sweep requires --dataset");
    reports.push(await runCatalogSweep({
      baseUrl: normalizedBaseUrl,
      cookie,
      datasetPath,
      concurrencies: catalogConcurrencies,
      queryConcurrencies: catalogQueryConcurrencies,
      repetitions,
      timeoutMs,
      minimumRequiredThroughputPerSecond
    }));
  }
  if (["all", "vector"].includes(stage)) {
    reports.push(await runVectorEmbeddingSweep({
      baseUrl: normalizedBaseUrl,
      cookie,
      concurrencies: vectorConcurrencies,
      repetitions,
      limit: vectorLimit,
      offset: vectorOffset,
      timeoutMs,
      minimumRequiredThroughputPerSecond
    }));
  }
  return {
    schema_version: "listing-stage-capacity-sweep-v1",
    generated_at: new Date().toISOString(),
    base_url: normalizedBaseUrl,
    stage,
    reports
  };
}

export async function main(argv = process.argv, env = process.env) {
  const envFile = argValue(argv, "--env-file", ".secrets/local.env");
  let fileEnv = {};
  try {
    fileEnv = parseEnvFile(await readFile(resolve(envFile), "utf8"));
  } catch {
    fileEnv = {};
  }
  const report = await runStageCapacitySweep({
    baseUrl: argValue(argv, "--base-url", env.LISTING_BASE_URL || "https://listing.lyncafei.team"),
    username: argValue(argv, "--username", env.METAVERSE_USERNAME || fileEnv.METAVERSE_USERNAME || ""),
    password: argValue(argv, "--password", env.METAVERSE_PASSWORD || fileEnv.METAVERSE_PASSWORD || ""),
    stage: cleanText(argValue(argv, "--stage", "all")).toLowerCase(),
    datasetPath: argValue(argv, "--dataset", ""),
    catalogConcurrencies: parseConcurrencies(argValue(argv, "--catalog-concurrencies", "1,2,4,6,8")),
    catalogQueryConcurrencies: parseConcurrencies(argValue(argv, "--catalog-query-concurrencies", "1,2,4,6")),
    vectorConcurrencies: parseConcurrencies(argValue(argv, "--vector-concurrencies", "1,2,3,4")),
    repetitions: positiveInteger(argValue(argv, "--repetitions", "2"), 2, { max: 10 }),
    vectorLimit: positiveInteger(argValue(argv, "--vector-limit", "8"), 8, { max: 50 }),
    vectorOffset: positiveInteger(argValue(argv, "--vector-offset", "0"), 0, { min: 0, max: 100000 }),
    timeoutMs: positiveInteger(argValue(argv, "--timeout-ms", "180000"), 180000, { min: 10000, max: 300000 }),
    minimumRequiredThroughputPerSecond: positiveInteger(
      argValue(argv, "--minimum-throughput-per-minute", "12"),
      12,
      { min: 1, max: 600 }
    ) / 60
  });
  const outPath = argValue(argv, "--out", "");
  if (outPath) {
    const target = resolve(outPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  for (const stageReport of report.reports) {
    const sweeps = stageReport.stage === "catalog_retrieval"
      ? [stageReport.query_sweep, stageReport.card_sweep]
      : [stageReport];
    for (const sweep of sweeps) {
      console.log(`${sweep.stage}: recommended=${sweep.selection.recommended_concurrency ?? "none"}`);
      for (const row of sweep.selection.rows) {
        console.log(`  c=${row.concurrency} stable=${row.stable} throughput=${Number(row.throughput_per_second || 0).toFixed(3)}/s p95=${row.p95_ms ?? "n/a"}ms errors=${row.error_count || 0}`);
      }
    }
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`stage capacity sweep failed: ${cleanText(error?.message || error)}`);
    process.exitCode = 1;
  });
}
