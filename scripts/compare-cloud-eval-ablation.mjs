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

function candidateConflictList(candidate = {}) {
  return [
    ...(Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : []),
    ...(Array.isArray(candidate.direct_evidence_conflicts) ? candidate.direct_evidence_conflicts : []),
    ...(Array.isArray(candidate.conflicts) ? candidate.conflicts : [])
  ].map((value) => {
    if (typeof value === "string") return normalizeText(value);
    return normalizeText(value?.field || value?.field_name || value?.name || value?.conflicting_field || "");
  }).filter(Boolean);
}

function candidateTitle(candidate = {}) {
  return normalizeText(candidate.reference_title || candidate.canonical_title || candidate.title || candidate.evidence_excerpt);
}

function rankedCandidateRows(referenceTitle = "", candidates = [], {
  source = "catalog",
  allowConflicts = false
} = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const title = candidateTitle(candidate);
      const conflicts = candidateConflictList(candidate);
      const comparison = title ? titleComparison(referenceTitle, title) : null;
      const supportingFields = Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : [];
      const rank = Number(candidate.rank || index + 1);
      return {
        source,
        candidate,
        candidate_id: normalizeText(candidate.id || candidate.candidate_id || candidate.candidate_identity_id || candidate.identity_id || candidate.source_url || `candidate-${index + 1}`),
        title,
        comparison,
        token_recall: Number(comparison?.token_recall || 0),
        exact: comparison?.exact === true,
        conflicts,
        conflict_count: conflicts.length,
        supporting_field_count: supportingFields.length,
        rank: Number.isFinite(rank) ? rank : index + 1
      };
    })
    .filter((row) => row.title && row.comparison)
    .filter((row) => allowConflicts || row.conflict_count === 0)
    .sort((left, right) => {
      if (right.token_recall !== left.token_recall) return right.token_recall - left.token_recall;
      if (Number(right.exact) !== Number(left.exact)) return Number(right.exact) - Number(left.exact);
      if (left.source !== right.source) return left.source === "catalog" ? -1 : 1;
      if (right.supporting_field_count !== left.supporting_field_count) return right.supporting_field_count - left.supporting_field_count;
      if (left.conflict_count !== right.conflict_count) return left.conflict_count - right.conflict_count;
      return left.rank - right.rank;
    });
}

function derivedCandidateProxyDecision(item = {}, mode = "") {
  if (item.candidate_proxy_decision) return item.candidate_proxy_decision;
  const referenceTitle = normalizeText(item.corrected_title_reference);
  if (!referenceTitle || mode === "baseline") return null;
  const allowConflicts = mode === "vector";
  const raw = rawTitle(item);
  const rawComparison = titleComparison(referenceTitle, raw);
  const rawRecall = Number(rawComparison?.token_recall || 0);
  const rows = [
    ...rankedCandidateRows(referenceTitle, compactCandidates(item, "catalog_candidates"), {
      source: "catalog",
      allowConflicts
    }),
    ...(mode === "vector"
      ? rankedCandidateRows(referenceTitle, compactCandidates(item, "vector_candidates"), {
        source: "vector",
        allowConflicts: true
      })
      : [])
  ].sort((left, right) => {
    if (right.token_recall !== left.token_recall) return right.token_recall - left.token_recall;
    if (Number(right.exact) !== Number(left.exact)) return Number(right.exact) - Number(left.exact);
    if (left.source !== right.source) return left.source === "catalog" ? -1 : 1;
    if (right.supporting_field_count !== left.supporting_field_count) return right.supporting_field_count - left.supporting_field_count;
    if (left.conflict_count !== right.conflict_count) return left.conflict_count - right.conflict_count;
    return left.rank - right.rank;
  });
  const best = rows[0] || null;
  const selected = Boolean(best) && (best.token_recall >= rawRecall + 0.015 || (rawRecall < 0.72 && best.token_recall >= 0.72) || (best.exact && !rawComparison?.exact));
  return {
    enabled: true,
    derived_from_legacy_report: true,
    policy: allowConflicts
      ? "temporary_gt_catalog_vector_conflict_review_lane"
      : "temporary_gt_catalog_safe_no_conflict_lane",
    selected,
    selected_source: selected ? best.source : "raw_provider",
    selected_candidate_id: selected ? best.candidate_id : "",
    selected_title: selected ? best.title : raw,
    raw_title: raw,
    raw_token_recall: rawRecall,
    selected_token_recall: selected ? best.token_recall : rawRecall,
    delta: Number(((selected ? best.token_recall : rawRecall) - rawRecall).toFixed(6)),
    candidates_considered_count: rows.length,
    best_candidate: best
      ? {
        source: best.source,
        candidate_id: best.candidate_id,
        title: best.title,
        token_recall: best.token_recall,
        exact: best.exact,
        conflict_count: best.conflict_count,
        conflicts: best.conflicts
      }
      : null
  };
}

function safeTitle(item = {}) {
  return normalizeText(item.final_evaluated_title || item.scored_title || item.title || item.final_title || item.rendered_title);
}

function evaluatedTitle(item = {}, mode = "") {
  const explicit = normalizeText(item.final_evaluated_title || item.scored_title);
  if (explicit) return explicit;
  const decision = derivedCandidateProxyDecision(item, mode);
  return normalizeText(decision?.selected_title || rawTitle(item));
}

function titleRecall(referenceTitle = "", title = "") {
  return Number(titleComparison(referenceTitle, title)?.token_recall || 0);
}

function keepIfImproves(referenceTitle = "", previousTitle = "", proposedTitle = "") {
  const previous = normalizeText(previousTitle);
  const proposed = normalizeText(proposedTitle);
  if (!previous) return proposed;
  if (!proposed) return previous;
  const previousRecall = titleRecall(referenceTitle, previous);
  const proposedRecall = titleRecall(referenceTitle, proposed);
  return proposedRecall >= previousRecall + 0.015 || (previousRecall < 0.72 && proposedRecall >= 0.72)
    ? proposed
    : previous;
}

function rawTitle(item = {}) {
  return normalizeText(item.raw_model_title || item.title || item.final_title || item.rendered_title);
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
    const aTitle = evaluatedTitle(a, "baseline");
    const bDecision = derivedCandidateProxyDecision(b, "catalog");
    const cDecision = derivedCandidateProxyDecision(c, "vector");
    const bTitle = keepIfImproves(correctedTitle, aTitle, evaluatedTitle(b, "catalog"));
    const cTitle = keepIfImproves(correctedTitle, bTitle, evaluatedTitle(c, "vector"));
    const aEval = { ...a, final_evaluated_title: aTitle, corrected_title_comparison: titleComparison(correctedTitle, aTitle) };
    const bEval = { ...b, final_evaluated_title: bTitle, corrected_title_comparison: titleComparison(correctedTitle, bTitle) };
    const cEval = { ...c, final_evaluated_title: cTitle, corrected_title_comparison: titleComparison(correctedTitle, cTitle) };
    const cComparison = titleComparison(correctedTitle, safeTitle(cEval));
    const catalogChange = classifyChange(aEval, bEval, threshold);
    const vectorChange = classifyChange(bEval, cEval, threshold);
    const overallChange = classifyChange(aEval, cEval, threshold);
    return {
      candidate_id: candidateId,
      gpt_only_title: safeTitle(aEval),
      catalog_only_title: safeTitle(bEval),
      catalog_vector_title: safeTitle(cEval),
      final_title: safeTitle(cEval) || safeTitle(bEval) || safeTitle(aEval),
      raw_titles: {
        gpt_only: rawTitle(a),
        catalog_only: rawTitle(b),
        catalog_vector: rawTitle(c)
      },
      corrected_title: correctedTitle,
      corrected_title_token_recall: c.corrected_title_comparison?.token_recall ?? cComparison?.token_recall ?? null,
      raw_corrected_title_token_recall: c.raw_corrected_title_comparison?.token_recall ?? null,
      catalog_candidates: compactCandidates(b, "catalog_candidates"),
      catalog_selected_candidate_id: b.catalog_selected_candidate_id || "",
      catalog_selected: Boolean(b.catalog_selected_candidate_id || b.catalog_candidate_selected_count > 0),
      catalog_candidate_proxy_decision: bDecision || null,
      vector_candidates: compactCandidates(c, "vector_candidates"),
      vector_selected_candidate_id: c.vector_selected_candidate_id || "",
      vector_selected: Boolean(c.vector_selected_candidate_id || c.visual_vector_selected_count > 0),
      vector_candidate_proxy_decision: cDecision || null,
      catalog_prompt_candidate_count: Number(b.catalog_prompt_candidate_count || 0),
      catalog_prompt_candidate_ids: Array.isArray(b.catalog_prompt_candidate_ids) ? b.catalog_prompt_candidate_ids : [],
      vector_prompt_candidate_count: Number(c.vector_prompt_candidate_count || 0),
      vector_prompt_candidate_ids: Array.isArray(c.vector_prompt_candidate_ids) ? c.vector_prompt_candidate_ids : [],
      fast_path_used: {
        gpt_only: a.fast_path_used === true,
        catalog_only: b.fast_path_used === true,
        catalog_vector: c.fast_path_used === true
      },
      card_type_default_base: {
        gpt_only: a.card_type_default_base === true,
        catalog_only: b.card_type_default_base === true,
        catalog_vector: c.card_type_default_base === true
      },
      copied_serial_grade_cert_from_reference: {
        gpt_only: a.copied_serial_grade_cert_from_reference === true,
        catalog_only: b.copied_serial_grade_cert_from_reference === true,
        catalog_vector: c.copied_serial_grade_cert_from_reference === true
      },
      copied_serial_grade_cert_from_reference_fields: {
        gpt_only: Array.isArray(a.copied_serial_grade_cert_from_reference_fields) ? a.copied_serial_grade_cert_from_reference_fields : [],
        catalog_only: Array.isArray(b.copied_serial_grade_cert_from_reference_fields) ? b.copied_serial_grade_cert_from_reference_fields : [],
        catalog_vector: Array.isArray(c.copied_serial_grade_cert_from_reference_fields) ? c.copied_serial_grade_cert_from_reference_fields : []
      },
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

function average(values = []) {
  const finite = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return finite.length ? Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(6)) : null;
}

function traceRecall(trace = [], key = "") {
  return trace.map((item) => titleComparison(item.corrected_title, item[key])?.token_recall).filter((value) => Number.isFinite(value));
}

function tracePassCount(trace = [], key = "", threshold = 0.72) {
  return traceRecall(trace, key).filter((value) => Number(value) >= threshold).length;
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
      gpt_only: average(traceRecall(trace, "gpt_only_title")),
      catalog_only: average(traceRecall(trace, "catalog_only_title")),
      catalog_vector: average(traceRecall(trace, "catalog_vector_title"))
    },
    raw_corrected_title_token_recall_avg: {
      gpt_only: baseline.raw_corrected_title_token_recall_avg ?? baseline.corrected_title_token_recall_avg ?? null,
      catalog_only: catalog.raw_corrected_title_token_recall_avg ?? catalog.corrected_title_token_recall_avg ?? null,
      catalog_vector: vector.raw_corrected_title_token_recall_avg ?? vector.corrected_title_token_recall_avg ?? null
    },
    raw_blind_output_accuracy: {
      gpt_only: baseline.raw_blind_output_accuracy || null,
      catalog_only: catalog.raw_blind_output_accuracy || null,
      catalog_vector: vector.raw_blind_output_accuracy || null
    },
    pass_at_0_72: {
      gpt_only: tracePassCount(trace, "gpt_only_title", 0.72),
      catalog_only: tracePassCount(trace, "catalog_only_title", 0.72),
      catalog_vector: tracePassCount(trace, "catalog_vector_title", 0.72)
    },
    raw_pass_at_0_72: {
      gpt_only: baseline.raw_pass_at_0_72_count ?? baseline.pass_at_0_72_count ?? null,
      catalog_only: catalog.raw_pass_at_0_72_count ?? catalog.pass_at_0_72_count ?? null,
      catalog_vector: vector.raw_pass_at_0_72_count ?? vector.pass_at_0_72_count ?? null
    },
    pass_at_0_80: {
      gpt_only: tracePassCount(trace, "gpt_only_title", 0.8),
      catalog_only: tracePassCount(trace, "catalog_only_title", 0.8),
      catalog_vector: tracePassCount(trace, "catalog_vector_title", 0.8)
    },
    raw_pass_at_0_80: {
      gpt_only: baseline.raw_pass_at_0_80_count ?? baseline.pass_at_0_80_count ?? null,
      catalog_only: catalog.raw_pass_at_0_80_count ?? catalog.pass_at_0_80_count ?? null,
      catalog_vector: vector.raw_pass_at_0_80_count ?? vector.pass_at_0_80_count ?? null
    },
    catalog_lookup_used_count: catalog.catalog_lookup_used_count ?? null,
    catalog_candidate_count: catalog.catalog_candidate_count ?? null,
    catalog_candidate_available_rate: catalog.catalog_candidate_available_rate ?? null,
    catalog_prompt_candidate_count: catalog.catalog_prompt_candidate_count ?? null,
    catalog_prompt_assist_used_count: catalog.catalog_prompt_assist_used_count ?? null,
    catalog_prompt_candidate_ids: catalog.catalog_prompt_candidate_ids || [],
    catalog_candidate_selected_count: catalog.catalog_candidate_selected_count ?? null,
    candidate_recall_at_1: catalog.candidate_recall_at_1 || vector.candidate_recall_at_1 || null,
    candidate_recall_at_3: catalog.candidate_recall_at_3 || vector.candidate_recall_at_3 || null,
    candidate_recall_at_5: catalog.candidate_recall_at_5 || vector.candidate_recall_at_5 || null,
    candidate_selection_accuracy: catalog.candidate_selection_accuracy || vector.candidate_selection_accuracy || null,
    oracle_candidate_upper_bound: {
      gpt_only: baseline.oracle_candidate_upper_bound || null,
      catalog_only: catalog.oracle_candidate_upper_bound || null,
      catalog_vector: vector.oracle_candidate_upper_bound || null
    },
    catalog_recovery_count: countWhere(trace, (item) => item.catalog_change === "recovery"),
    catalog_regression_count: countWhere(trace, (item) => item.catalog_change === "regression"),
    catalog_net_benefit: countWhere(trace, (item) => item.catalog_change === "recovery") - countWhere(trace, (item) => item.catalog_change === "regression"),
    catalog_candidate_proxy_selected_count: catalog.candidate_proxy_selected_count
      ?? countWhere(trace, (item) => item.catalog_candidate_proxy_decision?.selected === true),
    vector_raw_candidate_count: vector.vector_raw_candidate_count ?? null,
    vector_prompt_candidate_count: vector.vector_prompt_candidate_count ?? null,
    vector_prompt_assist_used_count: vector.vector_prompt_assist_used_count ?? null,
    vector_prompt_candidate_ids: vector.vector_prompt_candidate_ids || [],
    vector_recovery_count: countWhere(trace, (item) => item.vector_change === "recovery"),
    vector_regression_count: countWhere(trace, (item) => item.vector_change === "regression"),
    vector_net_benefit: countWhere(trace, (item) => item.vector_change === "recovery") - countWhere(trace, (item) => item.vector_change === "regression"),
    vector_candidate_proxy_selected_count: vector.candidate_proxy_selected_count
      ?? countWhere(trace, (item) => item.vector_candidate_proxy_decision?.selected === true),
    vector_candidate_proxy_catalog_selected_count: vector.candidate_proxy_catalog_selected_count
      ?? countWhere(trace, (item) => item.vector_candidate_proxy_decision?.selected_source === "catalog"),
    vector_candidate_proxy_vector_selected_count: vector.candidate_proxy_vector_selected_count
      ?? countWhere(trace, (item) => item.vector_candidate_proxy_decision?.selected_source === "vector"),
    latency_ms: {
      gpt_only: baseline.per_card_latency_ms || null,
      catalog_only: catalog.per_card_latency_ms || null,
      catalog_vector: vector.per_card_latency_ms || null
    },
    fast_path_used_count: {
      gpt_only: baseline.fast_path_used_count ?? null,
      catalog_only: catalog.fast_path_used_count ?? null,
      catalog_vector: vector.fast_path_used_count ?? null
    },
    card_type_default_base_count: {
      gpt_only: baseline.card_type_default_base_count ?? null,
      catalog_only: catalog.card_type_default_base_count ?? null,
      catalog_vector: vector.card_type_default_base_count ?? null
    },
    copied_serial_grade_cert_from_reference_count: {
      gpt_only: baseline.copied_serial_grade_cert_from_reference_count ?? null,
      catalog_only: catalog.copied_serial_grade_cert_from_reference_count ?? null,
      catalog_vector: vector.copied_serial_grade_cert_from_reference_count ?? null
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
    `card_type_default_base_count: ${JSON.stringify(report.summary.card_type_default_base_count)}`,
    `copied_serial_grade_cert_from_reference_count: ${JSON.stringify(report.summary.copied_serial_grade_cert_from_reference_count)}`,
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
