import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCardsightAdapter } from "../lib/listing/external/cardsight-adapter.mjs";

const defaultOutPath = "data/eval/cardsight-external/cardsight-external-poc-report.json";
const recallPassThreshold = 0.72;

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleTokens(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenRecall(reference = "", prediction = "") {
  const referenceTokens = titleTokens(reference);
  if (!referenceTokens.length) return null;
  const predicted = new Set(titleTokens(prediction));
  const matched = referenceTokens.filter((token) => predicted.has(token)).length;
  return Number((matched / referenceTokens.length).toFixed(6));
}

function readJsonl(text = "") {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readJson(path = "") {
  if (!path) return null;
  const resolved = resolve(path);
  if (!existsSync(resolved)) return null;
  return JSON.parse(await readFile(resolved, "utf8"));
}

async function readSealedLabels(path = "") {
  if (!path) return new Map();
  const resolved = resolve(path);
  if (!existsSync(resolved)) return new Map();
  const rows = readJsonl(await readFile(resolved, "utf8"));
  const map = new Map();
  rows.forEach((row) => {
    [
      row.case_id,
      row.asset_id,
      row.candidate_id,
      row.label_key,
      row.key
    ].map(normalizeText).filter(Boolean).forEach((key) => map.set(key, row));
  });
  return map;
}

function itemId(item = {}) {
  return normalizeText(item.asset_id || item.candidate_id || item.case_id || item.id || item.item_id);
}

function resultId(result = {}) {
  return normalizeText(result.candidate_id || result.asset_id || result.case_id || result.id || result.item_id);
}

function resultMap(report = {}) {
  const rows = Array.isArray(report?.results) ? report.results : Array.isArray(report?.rows) ? report.rows : [];
  return new Map(rows.map((row) => [resultId(row), row]).filter(([id]) => id));
}

function sealedLabelFor(item = {}, result = {}, sealed = new Map()) {
  const keys = [
    itemId(item),
    resultId(result),
    item.sealed_eval_label_ref?.key,
    result.sealed_eval_label_ref?.key
  ].map(normalizeText).filter(Boolean);
  for (const key of keys) {
    if (sealed.has(key)) return sealed.get(key);
  }
  return null;
}

function datasetItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  if (Array.isArray(dataset.items)) return dataset.items;
  if (Array.isArray(dataset.results)) return dataset.results;
  if (Array.isArray(dataset.rows)) return dataset.rows;
  return [];
}

function imageInputs(item = {}) {
  const images = [
    ...(Array.isArray(item.images) ? item.images : []),
    ...(Array.isArray(item.image_refs) ? item.image_refs : []),
    ...(Array.isArray(item.assets) ? item.assets : [])
  ];
  return images
    .map((image) => {
      if (typeof image === "string") return image;
      return image.local_path || image.path || image.file_path || image.url || image;
    })
    .filter(Boolean);
}

function observedFieldsFromResult(result = {}) {
  return result.resolved_fields
    || result.resolved
    || result.fields
    || result.rendered_fields
    || result.provider_response?.fields
    || result.provider_result?.fields
    || {};
}

function baselineTitle(result = {}) {
  return normalizeText(
    result.final_evaluated_title
    || result.scored_title
    || result.final_title
    || result.title
    || result.model_title_suggestion
  );
}

function candidateTitle(candidate = {}) {
  return normalizeText(candidate.title || [
    candidate.fields?.year,
    candidate.fields?.manufacturer,
    candidate.fields?.product,
    candidate.fields?.set,
    Array.isArray(candidate.fields?.players) ? candidate.fields.players.join(" ") : "",
    candidate.fields?.card_name,
    candidate.fields?.collector_number ? `#${candidate.fields.collector_number}` : ""
  ].filter(Boolean).join(" "));
}

function bestCandidateAgainstLabel(candidates = [], labelTitle = "") {
  let best = null;
  candidates.forEach((candidate, index) => {
    const recall = tokenRecall(labelTitle, candidateTitle(candidate));
    if (recall === null) return;
    if (!best || recall > best.recall) {
      best = { index, rank: index + 1, candidate, recall };
    }
  });
  return best;
}

function recallAt(candidates = [], labelTitle = "", k = 1) {
  if (!labelTitle) return null;
  return candidates.slice(0, k).some((candidate) => {
    const recall = tokenRecall(labelTitle, candidateTitle(candidate));
    return Number.isFinite(recall) && recall >= recallPassThreshold;
  });
}

function percentile(values = [], p = 0.5) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function externalRequestCostEstimate(requestCount, env = process.env) {
  const perRequest = Number(env.CARDSIGHTAI_ESTIMATED_COST_PER_REQUEST_USD || "");
  return {
    request_count: requestCount,
    cost_model: Number.isFinite(perRequest) ? "env_per_request_estimate" : "unknown_terms_not_configured",
    estimated_cost_usd: Number.isFinite(perRequest)
      ? Number((requestCount * perRequest).toFixed(6))
      : null
  };
}

async function callSafely(fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      ok: !result?.unavailable,
      result,
      latency_ms: Date.now() - start,
      error: result?.unavailable ? { code: result.code, message: result.reason } : null
    };
  } catch (error) {
    return {
      ok: false,
      result: { candidates: [] },
      latency_ms: Date.now() - start,
      error: {
        code: error?.code || "cardsight_external_error",
        status: error?.status || null,
        message: normalizeText(error?.message).slice(0, 240)
      }
    };
  }
}

function candidateCounts(candidates = []) {
  return {
    exact: candidates.filter((candidate) => candidate.match_level === "exact_card").length,
    set_level: candidates.filter((candidate) => candidate.match_level === "set_level").length,
    no_match: candidates.filter((candidate) => candidate.match_level === "no_match").length
  };
}

async function evaluateItem({
  item,
  result,
  sealedLabel,
  adapter,
  mode,
  segment,
  take
}) {
  const calls = [];
  const images = imageInputs(item);
  if ((mode === "identify" || mode === "both") && images.length) {
    calls.push({
      mode: "identify",
      promise: callSafely(() => adapter.identifyImage({ image: images[0], segment }))
    });
  }
  if (mode === "catalog" || mode === "both") {
    const observedFields = observedFieldsFromResult(result);
    calls.push({
      mode: "catalog",
      promise: callSafely(() => adapter.searchCatalog({ observedFields, segment, take }))
    });
  }

  const outputs = [];
  for (const call of calls) {
    const output = await call.promise;
    outputs.push({ ...output, mode: call.mode });
  }

  const candidates = outputs.flatMap((output) => {
    const rows = Array.isArray(output.result?.candidates) ? output.result.candidates : [];
    return rows.map((candidate) => ({
      ...candidate,
      request_mode: output.mode
    }));
  });
  const labelTitle = normalizeText(sealedLabel?.title || sealedLabel?.seller_title);
  const baseline = baselineTitle(result);
  const baselineRecall = labelTitle && baseline ? tokenRecall(labelTitle, baseline) : null;
  const best = labelTitle ? bestCandidateAgainstLabel(candidates, labelTitle) : null;
  const bestRecall = best?.recall ?? null;
  const recovery = baselineRecall !== null && bestRecall !== null
    ? baselineRecall < recallPassThreshold && bestRecall >= recallPassThreshold
    : false;
  const regression = baselineRecall !== null && bestRecall !== null
    ? baselineRecall >= recallPassThreshold && bestRecall < recallPassThreshold
    : false;

  return {
    candidate_id: itemId(item) || resultId(result),
    cardsight_modes_attempted: outputs.map((output) => output.mode),
    cardsight_errors: outputs.map((output) => output.error).filter(Boolean),
    cardsight_latency_ms: outputs.reduce((sum, output) => sum + output.latency_ms, 0),
    cardsight_candidate_count: candidates.length,
    cardsight_candidates: candidates.map((candidate) => ({
      provider_id: candidate.provider_id,
      source_trust: candidate.source_trust,
      used_as_truth: candidate.used_as_truth === true,
      match_level: candidate.match_level,
      confidence: candidate.confidence,
      rank: candidate.rank,
      request_mode: candidate.request_mode,
      external_card_id: candidate.external_card_id,
      external_set_id: candidate.external_set_id,
      external_release_id: candidate.external_release_id,
      title: candidateTitle(candidate),
      fields: candidate.fields,
      parallel_candidate: candidate.parallel_candidate,
      grading_candidate: candidate.grading_candidate,
      allowed_usage: candidate.allowed_usage,
      forbidden_usage: candidate.forbidden_usage
    })),
    baseline_title: baseline,
    sealed_weak_label_for_eval_only: labelTitle,
    sealed_label_sent_to_cardsight: false,
    baseline_token_recall_proxy: baselineRecall,
    best_cardsight_candidate_rank: best?.rank ?? null,
    best_cardsight_token_recall_proxy: bestRecall,
    cardsight_recovery: recovery,
    cardsight_regression: regression
  };
}

export async function buildCardsightExternalPocReport({
  datasetPath,
  cloudReportPath = "",
  sealedLabelsPath = "",
  outPath = "",
  markdownOutPath = "",
  mode = "both",
  segment = "basketball",
  limit = 0,
  take = 5,
  env = process.env,
  adapter = createCardsightAdapter({ env }),
  now = new Date()
} = {}) {
  if (!datasetPath) throw new Error("--dataset is required");
  const dataset = await readJson(datasetPath);
  if (!dataset) throw new Error(`Dataset not found: ${datasetPath}`);
  const cloudReport = await readJson(cloudReportPath) || {};
  const resultsById = resultMap(cloudReport);
  const sealedLabels = await readSealedLabels(sealedLabelsPath);
  const items = datasetItems(dataset).slice(0, limit > 0 ? limit : undefined);

  const rows = [];
  for (const item of items) {
    const id = itemId(item);
    const result = resultsById.get(id) || item;
    const sealedLabel = sealedLabelFor(item, result, sealedLabels);
    rows.push(await evaluateItem({
      item,
      result,
      sealedLabel,
      adapter,
      mode,
      segment,
      take
    }));
  }

  const allCandidates = rows.flatMap((row) => row.cardsight_candidates);
  const counts = candidateCounts(allCandidates);
  const labeledRows = rows.filter((row) => row.sealed_weak_label_for_eval_only);
  const latencies = rows.map((row) => row.cardsight_latency_ms).filter((value) => Number.isFinite(value));
  const metrics = {
    attempted_count: rows.length,
    cardsight_exact_match_count: counts.exact,
    cardsight_set_level_match_count: counts.set_level,
    cardsight_no_match_count: rows.filter((row) => !row.cardsight_candidate_count || row.cardsight_candidates.some((candidate) => candidate.match_level === "no_match")).length,
    cardsight_recovery_count: rows.filter((row) => row.cardsight_recovery).length,
    cardsight_regression_count: rows.filter((row) => row.cardsight_regression).length,
    external_candidate_recall_at_1: labeledRows.length ? Number((labeledRows.filter((row) => recallAt(row.cardsight_candidates, row.sealed_weak_label_for_eval_only, 1)).length / labeledRows.length).toFixed(6)) : null,
    external_candidate_recall_at_3: labeledRows.length ? Number((labeledRows.filter((row) => recallAt(row.cardsight_candidates, row.sealed_weak_label_for_eval_only, 3)).length / labeledRows.length).toFixed(6)) : null,
    external_candidate_recall_at_5: labeledRows.length ? Number((labeledRows.filter((row) => recallAt(row.cardsight_candidates, row.sealed_weak_label_for_eval_only, 5)).length / labeledRows.length).toFixed(6)) : null,
    latency: {
      p50_ms: percentile(latencies, 0.5),
      p95_ms: percentile(latencies, 0.95)
    },
    cost_estimate: externalRequestCostEstimate(rows.reduce((sum, row) => sum + row.cardsight_modes_attempted.length, 0), env)
  };

  const report = {
    schema_version: "cardsight-external-poc-v1",
    generated_at: now.toISOString(),
    source_dataset_path: datasetPath,
    cloud_report_path: cloudReportPath || null,
    sealed_labels_path: sealedLabelsPath || null,
    mode,
    segment,
    policy: {
      provider_id: "cardsight",
      source_trust: "LICENSED_EXTERNAL_DIRECTORY",
      external_candidates_used_as_truth: false,
      card_images_cached_or_bulk_copied: false,
      seller_title_sent_to_cardsight: false,
      seller_title_used_as_ground_truth: false,
      reviewed_internal_promotion_allowed: false,
      serial_grade_cert_copy_allowed: false
    },
    metrics,
    rows
  };
  if (outPath) await writeJson(outPath, report);
  if (markdownOutPath) await writeMarkdown(markdownOutPath, report);
  return report;
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeMarkdown(path, report) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  const metrics = report.metrics || {};
  const lines = [
    "# CardSight External POC Report",
    "",
    "Policy: CardSight is an external licensed directory candidate source, not reviewed internal truth.",
    "",
    `- attempted_count: ${metrics.attempted_count}`,
    `- cardsight_exact_match_count: ${metrics.cardsight_exact_match_count}`,
    `- cardsight_set_level_match_count: ${metrics.cardsight_set_level_match_count}`,
    `- cardsight_no_match_count: ${metrics.cardsight_no_match_count}`,
    `- cardsight_recovery_count: ${metrics.cardsight_recovery_count}`,
    `- cardsight_regression_count: ${metrics.cardsight_regression_count}`,
    `- external_candidate_recall@1: ${metrics.external_candidate_recall_at_1}`,
    `- external_candidate_recall@3: ${metrics.external_candidate_recall_at_3}`,
    `- external_candidate_recall@5: ${metrics.external_candidate_recall_at_5}`,
    `- p50_latency_ms: ${metrics.latency?.p50_ms}`,
    `- p95_latency_ms: ${metrics.latency?.p95_ms}`,
    "",
    "## Per Card",
    "",
    "| candidate_id | candidates | best_rank | baseline_recall | best_cardsight_recall | recovery | regression | errors |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
    ...report.rows.map((row) => `| ${row.candidate_id} | ${row.cardsight_candidate_count} | ${row.best_cardsight_candidate_rank ?? ""} | ${row.baseline_token_recall_proxy ?? ""} | ${row.best_cardsight_token_recall_proxy ?? ""} | ${row.cardsight_recovery ? "yes" : "no"} | ${row.cardsight_regression ? "yes" : "no"} | ${row.cardsight_errors.map((error) => error.code).join(", ")} |`)
  ];
  await writeFile(resolved, `${lines.join("\n")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildCardsightExternalPocReport({
    datasetPath: argValue(process.argv, "--dataset"),
    cloudReportPath: argValue(process.argv, "--cloud-report", ""),
    sealedLabelsPath: argValue(process.argv, "--sealed-labels", ""),
    outPath: argValue(process.argv, "--out", defaultOutPath),
    markdownOutPath: argValue(process.argv, "--markdown-out", ""),
    mode: argValue(process.argv, "--mode", "both"),
    segment: argValue(process.argv, "--segment", process.env.CARDSIGHTAI_SEGMENT || "basketball"),
    limit: numberArg(process.argv, "--limit", 0),
    take: numberArg(process.argv, "--take", 5)
  }).then((report) => {
    process.stdout.write(`${JSON.stringify(report.metrics, null, 2)}\n`);
  }).catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
