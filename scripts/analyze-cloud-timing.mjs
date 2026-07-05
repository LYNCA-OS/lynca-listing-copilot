import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const timingKeys = [
  "total_ms",
  "signed_url_ms",
  "recognition_preflight_ms",
  "catalog_retrieval_ms",
  "catalog_cache_ms",
  "vector_embedding_ms",
  "vector_retrieval_ms",
  "retrieval_ms",
  "provider_total_ms",
  "evidence_completion_ms",
  "resolver_ms",
  "renderer_ms",
  "time_to_first_field_ms",
  "time_to_core_identity_ms",
  "time_to_writer_draft_ms",
  "time_to_final_assisted_title_ms"
];

function argValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function resultRowsFromReport(report = {}, sourcePath = "") {
  const results = Array.isArray(report.results)
    ? report.results
    : Array.isArray(report.report?.results)
      ? report.report.results
      : [];
  const reportProvider = normalizeText(report.provider || report.report?.provider || "");
  return results.map((item, index) => ({
    ...item,
    __report_provider: reportProvider,
    __source_path: sourcePath,
    __index: index
  }));
}

function timingValue(item = {}, key = "") {
  if (key === "total_ms") {
    return numberOrNull(item.timing?.total_ms ?? item.elapsed_ms);
  }
  return numberOrNull(item.timing?.[key]);
}

function percentile(sortedValues = [], percentileValue = 0.5) {
  if (!sortedValues.length) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1)
  );
  return Math.round(sortedValues[index]);
}

function timingStats(items = []) {
  return Object.fromEntries(timingKeys.map((key) => {
    const values = items
      .map((item) => timingValue(item, key))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    const sum = values.reduce((total, value) => total + value, 0);
    return [key, {
      count: values.length,
      avg: values.length ? Math.round(sum / values.length) : null,
      p50: percentile(values, 0.5),
      p90: percentile(values, 0.9),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
      max: values.length ? Math.round(values[values.length - 1]) : null
    }];
  }));
}

function countWhere(items = [], predicate) {
  return items.filter(predicate).length;
}

function rate(count, denominator) {
  return denominator ? Number((count / denominator).toFixed(6)) : null;
}

function boolGroupValue(value) {
  return value === true ? "true" : "false";
}

function providerMode(item = {}) {
  return normalizeText(item.provider_mode || item.provider || item.requested_cloud_provider || item.__report_provider || "unknown") || "unknown";
}

function groupBy(items = [], grouper) {
  const groups = new Map();
  for (const item of items) {
    const key = grouper(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, rows]) => [key, summarizeRows(rows)]));
}

function summarizeRows(items = []) {
  const total = items.length;
  const catalogCacheHitCount = countWhere(items, (item) => item.catalog_cache_hit === true);
  const vectorLazySkipCount = countWhere(items, (item) => item.vector_lazy_skip === true);
  const retrievalTitleAssistUsedCount = countWhere(items, (item) => item.retrieval_title_assist_used === true);
  return {
    count: total,
    provider_success_count: countWhere(items, (item) => item.technical_failure !== true && item.confidence !== "FAILED" && !item.provider_error_code),
    technical_failure_count: countWhere(items, (item) => item.technical_failure === true),
    catalog_cache_hit_count: catalogCacheHitCount,
    catalog_cache_hit_rate: rate(catalogCacheHitCount, total),
    vector_lazy_skip_count: vectorLazySkipCount,
    vector_lazy_skip_rate: rate(vectorLazySkipCount, total),
    retrieval_title_assist_used_count: retrievalTitleAssistUsedCount,
    retrieval_title_assist_used_rate: rate(retrievalTitleAssistUsedCount, total),
    timing: timingStats(items)
  };
}

export async function analyzeCloudTiming({
  inputPaths = []
} = {}) {
  if (!inputPaths.length) throw new Error("At least one input path is required.");
  const reports = await Promise.all(inputPaths.map(async (path) => ({
    path,
    report: await readJson(path)
  })));
  const rows = reports.flatMap(({ path, report }) => resultRowsFromReport(report, path));
  const summary = summarizeRows(rows);
  return {
    schema_version: "cloud-timing-analysis-v1",
    status: "completed",
    generated_at: new Date().toISOString(),
    input_paths: inputPaths,
    result_count: rows.length,
    summary,
    groups: {
      provider_mode: groupBy(rows, providerMode),
      catalog_cache_hit: groupBy(rows, (item) => boolGroupValue(item.catalog_cache_hit)),
      vector_lazy_skip: groupBy(rows, (item) => boolGroupValue(item.vector_lazy_skip)),
      retrieval_title_assist_used: groupBy(rows, (item) => boolGroupValue(item.retrieval_title_assist_used))
    }
  };
}

function formatTimingLine(label, stats = {}) {
  const total = stats.timing?.total_ms || {};
  const provider = stats.timing?.provider_total_ms || {};
  const vectorEmbedding = stats.timing?.vector_embedding_ms || {};
  const vectorRetrieval = stats.timing?.vector_retrieval_ms || {};
  const firstField = stats.timing?.time_to_first_field_ms || {};
  const writerDraft = stats.timing?.time_to_writer_draft_ms || {};
  return [
    `${label}: count=${stats.count}`,
    `total_p50=${total.p50 ?? "n/a"}`,
    `total_p95=${total.p95 ?? "n/a"}`,
    `first_field_p50=${firstField.p50 ?? "n/a"}`,
    `writer_draft_p50=${writerDraft.p50 ?? "n/a"}`,
    `provider_p95=${provider.p95 ?? "n/a"}`,
    `vector_embedding_p95=${vectorEmbedding.p95 ?? "n/a"}`,
    `vector_retrieval_p95=${vectorRetrieval.p95 ?? "n/a"}`,
    `catalog_cache_hit_rate=${stats.catalog_cache_hit_rate ?? "n/a"}`,
    `vector_lazy_skip_rate=${stats.vector_lazy_skip_rate ?? "n/a"}`
  ].join(" ");
}

export async function main(argv = process.argv) {
  const explicitInputs = argValues(argv, "--input");
  const positionalInputs = argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const inputPaths = explicitInputs.length ? explicitInputs : positionalInputs;
  const outPath = argValue(argv, "--out", "");
  const report = await analyzeCloudTiming({ inputPaths });
  if (outPath) await writeJson(outPath, report);
  const lines = [
    `cloud timing analysis ${report.status}`,
    `result_count: ${report.result_count}`,
    formatTimingLine("all", report.summary),
    ...Object.entries(report.groups.provider_mode).map(([key, value]) => formatTimingLine(`provider=${key}`, value)),
    ...Object.entries(report.groups.catalog_cache_hit).map(([key, value]) => formatTimingLine(`catalog_cache_hit=${key}`, value)),
    ...Object.entries(report.groups.vector_lazy_skip).map(([key, value]) => formatTimingLine(`vector_lazy_skip=${key}`, value)),
    ...Object.entries(report.groups.retrieval_title_assist_used).map(([key, value]) => formatTimingLine(`retrieval_title_assist_used=${key}`, value))
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Cloud timing analysis failed: ${error.message}`);
    process.exit(1);
  }
}
