import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

function titleTokens(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function titleComparison(referenceTitle, predictionTitle) {
  const reference = new Set(titleTokens(referenceTitle));
  const predicted = new Set(titleTokens(predictionTitle));
  if (!reference.size) return null;
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return {
    token_recall: Number((overlap / reference.size).toFixed(6)),
    exact: normalizeText(referenceTitle).toLowerCase() === normalizeText(predictionTitle).toLowerCase()
  };
}

function resultMap(report = {}) {
  return new Map((Array.isArray(report.results) ? report.results : [])
    .map((item) => [normalizeText(item.candidate_id), item])
    .filter(([id]) => Boolean(id)));
}

function pass(item = {}, threshold = 0.72) {
  return Number(item.corrected_title_comparison?.token_recall ?? item.corrected_title_token_recall ?? 0) >= threshold;
}

function classifyChange(before = {}, after = {}, threshold = 0.72) {
  const beforePass = pass(before, threshold);
  const afterPass = pass(after, threshold);
  if (!beforePass && afterPass) return "recovery";
  if (beforePass && !afterPass) return "regression";
  return "no_change";
}

function fieldValue(fields = {}, key = "") {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "";
  const value = fields[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeText(value.normalized_value ?? value.resolved_value ?? value.value ?? "");
  }
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join("|");
  return normalizeText(value);
}

function changedFields(left = {}, right = {}) {
  const leftFields = left.rendered_fields || left.resolved_fields || left.fields || {};
  const rightFields = right.rendered_fields || right.resolved_fields || right.fields || {};
  const keys = [
    "year",
    "product",
    "set",
    "players",
    "player",
    "surface_color",
    "parallel_exact",
    "collector_number",
    "checklist_code",
    "serial_number",
    "grade_company",
    "card_grade",
    "auto",
    "rc"
  ];
  return keys.filter((key) => fieldValue(leftFields, key) !== fieldValue(rightFields, key));
}

function compactCandidates(item = {}, key = "catalog_candidates") {
  return Array.isArray(item[key]) ? item[key] : [];
}

function safeTitle(item = {}) {
  return normalizeText(item.title || item.final_title || item.rendered_title);
}

function perCardTrace({ baseline = {}, catalog = {}, vector = {}, threshold = 0.72 } = {}) {
  const baselineMap = resultMap(baseline);
  const catalogMap = resultMap(catalog);
  const vectorMap = resultMap(vector);
  const ids = [...new Set([
    ...baselineMap.keys(),
    ...catalogMap.keys(),
    ...vectorMap.keys()
  ])];

  return ids.map((candidateId) => {
    const a = baselineMap.get(candidateId) || {};
    const b = catalogMap.get(candidateId) || {};
    const c = vectorMap.get(candidateId) || {};
    const correctedTitle = normalizeText(
      a.corrected_title_reference
      || b.corrected_title_reference
      || c.corrected_title_reference
    );
    const cComparison = titleComparison(correctedTitle, safeTitle(c));
    const catalogChange = classifyChange(a, b, threshold);
    const vectorChange = classifyChange(b, c, threshold);
    const overallChange = classifyChange(a, c, threshold);
    return {
      candidate_id: candidateId,
      gpt_only_title: safeTitle(a),
      catalog_only_title: safeTitle(b),
      catalog_vector_title: safeTitle(c),
      final_title: safeTitle(c) || safeTitle(b) || safeTitle(a),
      corrected_title: correctedTitle,
      corrected_title_token_recall: c.corrected_title_comparison?.token_recall ?? cComparison?.token_recall ?? null,
      catalog_candidates: compactCandidates(b, "catalog_candidates"),
      catalog_selected_candidate_id: b.catalog_selected_candidate_id || "",
      catalog_selected: Boolean(b.catalog_selected_candidate_id || b.catalog_candidate_selected_count > 0),
      vector_candidates: compactCandidates(c, "vector_candidates"),
      vector_selected_candidate_id: c.vector_selected_candidate_id || "",
      vector_selected: Boolean(c.vector_selected_candidate_id || c.visual_vector_selected_count > 0),
      catalog_change: catalogChange,
      vector_change: vectorChange,
      recovery_regression_no_change: overallChange,
      main_changed_fields: [...new Set([
        ...changedFields(a, b).map((field) => `catalog:${field}`),
        ...changedFields(b, c).map((field) => `vector:${field}`)
      ])]
    };
  });
}

function countWhere(items = [], predicate) {
  return items.filter(predicate).length;
}

function summarizeAblation({ baseline = {}, catalog = {}, vector = {}, trace = [], threshold = 0.72 } = {}) {
  return {
    threshold,
    target_count: Math.max(
      Number(baseline.target_count || 0),
      Number(catalog.target_count || 0),
      Number(vector.target_count || 0)
    ),
    corrected_title_token_recall_avg: {
      gpt_only: baseline.corrected_title_token_recall_avg ?? null,
      catalog_only: catalog.corrected_title_token_recall_avg ?? null,
      catalog_vector: vector.corrected_title_token_recall_avg ?? null
    },
    pass_at_0_72: {
      gpt_only: baseline.pass_at_0_72_count ?? null,
      catalog_only: catalog.pass_at_0_72_count ?? null,
      catalog_vector: vector.pass_at_0_72_count ?? null
    },
    pass_at_0_80: {
      gpt_only: baseline.pass_at_0_80_count ?? null,
      catalog_only: catalog.pass_at_0_80_count ?? null,
      catalog_vector: vector.pass_at_0_80_count ?? null
    },
    catalog_lookup_used_count: catalog.catalog_lookup_used_count ?? null,
    catalog_candidate_count: catalog.catalog_candidate_count ?? null,
    catalog_prompt_candidate_count: catalog.catalog_prompt_candidate_count ?? null,
    catalog_candidate_selected_count: catalog.catalog_candidate_selected_count ?? null,
    catalog_recovery_count: countWhere(trace, (item) => item.catalog_change === "recovery"),
    catalog_regression_count: countWhere(trace, (item) => item.catalog_change === "regression"),
    vector_raw_candidate_count: vector.vector_raw_candidate_count ?? null,
    vector_prompt_candidate_count: vector.vector_prompt_candidate_count ?? null,
    vector_recovery_count: countWhere(trace, (item) => item.vector_change === "recovery"),
    vector_regression_count: countWhere(trace, (item) => item.vector_change === "regression"),
    latency_ms: {
      gpt_only: baseline.per_card_latency_ms || null,
      catalog_only: catalog.per_card_latency_ms || null,
      catalog_vector: vector.per_card_latency_ms || null
    },
    usage_totals: {
      gpt_only: baseline.usage_totals || null,
      catalog_only: catalog.usage_totals || null,
      catalog_vector: vector.usage_totals || null
    }
  };
}

export async function compareCloudEvalAblation({
  baselinePath,
  catalogPath,
  vectorPath,
  outPath = "",
  threshold = 0.72
} = {}) {
  if (!baselinePath || !catalogPath || !vectorPath) {
    throw new Error("baselinePath, catalogPath, and vectorPath are required.");
  }
  const [baseline, catalog, vector] = await Promise.all([
    readJson(baselinePath),
    readJson(catalogPath),
    readJson(vectorPath)
  ]);
  const trace = perCardTrace({ baseline, catalog, vector, threshold });
  const report = {
    schema_version: "cloud-listing-api-ablation-comparison-v1",
    status: "completed",
    generated_at: new Date().toISOString(),
    inputs: {
      gpt_only: baselinePath,
      catalog_only: catalogPath,
      catalog_vector: vectorPath
    },
    summary: summarizeAblation({ baseline, catalog, vector, trace, threshold }),
    decision_trace: trace
  };
  if (outPath) await writeJson(outPath, report);
  return report;
}

export async function main(argv = process.argv) {
  const baselinePath = argValue(argv, "--gpt-only", argValue(argv, "--baseline", ""));
  const catalogPath = argValue(argv, "--catalog-only", "");
  const vectorPath = argValue(argv, "--catalog-vector", argValue(argv, "--vector", ""));
  const outPath = argValue(argv, "--out", "");
  const threshold = Number(argValue(argv, "--threshold", "0.72")) || 0.72;
  const report = await compareCloudEvalAblation({
    baselinePath,
    catalogPath,
    vectorPath,
    outPath,
    threshold
  });
  process.stdout.write([
    `cloud eval ablation comparison ${report.status}`,
    `threshold: ${report.summary.threshold}`,
    `catalog_recovery_count: ${report.summary.catalog_recovery_count}`,
    `catalog_regression_count: ${report.summary.catalog_regression_count}`,
    `vector_recovery_count: ${report.summary.vector_recovery_count}`,
    `vector_regression_count: ${report.summary.vector_regression_count}`,
    `decision_trace_count: ${report.decision_trace.length}`
  ].join("\n") + "\n");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Cloud eval ablation comparison failed: ${error.message}`);
    process.exit(1);
  }
}
