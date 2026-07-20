import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const cleanText = (value) => String(value ?? "").trim();
const finiteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const sum = (values) => values.reduce((total, value) => total + (finiteNumber(value) ?? 0), 0);
const round = (value, places = 6) => {
  const number = finiteNumber(value);
  if (number === null) return null;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
};
const countWhere = (items, predicate) => items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);

function argumentValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function participationUsed(value) {
  const level = cleanText(value).toUpperCase();
  return Boolean(level) && !level.includes("LEVEL_0") && level !== "NOT_USED";
}

function isInternalReviewedGroundTruth(result = {}) {
  return result?.reference_title_is_reviewed_ground_truth === true
    && cleanText(result?.reference_title_type).toUpperCase() === "REVIEWED_INTERNAL_TITLE";
}

function policyTokenRecall(result = {}) {
  return finiteNumber(result?.final_scoring?.policy_fair_token_recall);
}

function semWeightedAccuracy(result = {}) {
  return finiteNumber(result?.sem_projection_scoring?.weighted_accuracy);
}

function aggregateSemFailureClusters(results = []) {
  const clusters = new Map();
  for (const result of results) {
    for (const component of result?.sem_projection_scoring?.components || []) {
      if (component?.correct === true) continue;
      const field = cleanText(component?.field) || "unknown";
      const key = `${field}:${cleanText(component?.component) || "unknown"}`;
      const current = clusters.get(key) || {
        field,
        component: cleanText(component?.component) || "unknown",
        affected_card_count: 0,
        failed_weight: 0
      };
      current.affected_card_count += 1;
      current.failed_weight += finiteNumber(component?.weight) ?? 0;
      clusters.set(key, current);
    }
  }
  return [...clusters.values()]
    .map((item) => ({ ...item, failed_weight: round(item.failed_weight) }))
    .sort((left, right) => right.failed_weight - left.failed_weight
      || right.affected_card_count - left.affected_card_count
      || left.field.localeCompare(right.field));
}

function resultAnomalies(result) {
  return (result?.pipeline_node_ledger?.reconciliation?.anomalies || []).map((item) => ({
    check_id: cleanText(item?.check_id),
    severity: cleanText(item?.severity),
    detail: cleanText(item?.detail)
  }));
}

function activationFunnel(result, lane) {
  return result?.l2_candidate_debug?.[`${lane}_activation_funnel`] || {};
}

function aggregateRetrieval(results, lane) {
  const prefix = `l2_${lane}_`;
  const raw = results.map((item) => finiteNumber(item?.[`${prefix}raw_candidate_count`]) ?? 0);
  const approved = results.map((item) => finiteNumber(item?.[`${prefix}approved_candidate_count`]) ?? 0);
  const prompt = results.map((item) => finiteNumber(item?.[`${prefix}prompt_candidate_count`]) ?? 0);
  const support = results.map((item) => finiteNumber(item?.[`${prefix}evidence_support_field_count`]) ?? 0);
  const applied = results.map((item) => finiteNumber(activationFunnel(item, lane)?.applied_field_count) ?? 0);
  const selected = results.map((item) => cleanText(activationFunnel(item, lane)?.selected_candidate_id));
  const titleChanged = results.map((item, index) => applied[index] > 0 && activationFunnel(item, lane)?.title_changed === true);
  return {
    card_count: results.length,
    available_card_count: countWhere(raw, (value) => value > 0),
    approved_card_count: countWhere(approved, (value) => value > 0),
    prompt_card_count: countWhere(prompt, (value) => value > 0),
    participation_card_count: countWhere(results, (item) => participationUsed(item?.[`${prefix}participation_level`])),
    selected_card_count: countWhere(selected, Boolean),
    applied_card_count: countWhere(applied, (value) => value > 0),
    title_changed_card_count: countWhere(titleChanged, Boolean),
    raw_candidate_count: sum(raw),
    approved_candidate_count: sum(approved),
    prompt_candidate_count: sum(prompt),
    evidence_support_field_count: sum(support),
    applied_field_count: sum(applied)
  };
}

function sampleFingerprint(report = {}) {
  const runs = report?.data_contract?.sample_provenance?.runs;
  const run = Array.isArray(runs) ? runs[0] : null;
  return cleanText(
    run?.evaluated_item_ids_sha256
    || run?.dataset_provenance?.selected_item_ids_sha256
    || report?.data_contract?.evaluated_item_ids_sha256
  ) || null;
}

function comparisonSnapshot(report = {}, diagnostic = analyzeLaunchGateReport(report)) {
  return {
    profile: cleanText(report?.profile) || null,
    sample_fingerprint: sampleFingerprint(report),
    measured_count: diagnostic.accuracy.measured_count,
    accuracy_rate: diagnostic.accuracy.rate,
    technical_success_rate: diagnostic.technical.success_rate,
    cards_per_minute: diagnostic.technical.cards_per_minute,
    run_wall_ms: diagnostic.technical.run_wall_ms
  };
}

function buildBaselineComparison(report, diagnostic, baselineReport) {
  if (!baselineReport) return null;
  const baselineDiagnostic = analyzeLaunchGateReport(baselineReport);
  const current = comparisonSnapshot(report, diagnostic);
  const baseline = comparisonSnapshot(baselineReport, baselineDiagnostic);
  const sameFingerprint = Boolean(current.sample_fingerprint)
    && current.sample_fingerprint === baseline.sample_fingerprint;
  const sameProfile = Boolean(current.profile) && current.profile === baseline.profile;
  const sameMeasuredCount = current.measured_count === baseline.measured_count;
  return {
    direct_causal_comparison: sameFingerprint && sameProfile && sameMeasuredCount,
    comparability: {
      same_sample_fingerprint: sameFingerprint,
      same_profile: sameProfile,
      same_measured_count: sameMeasuredCount
    },
    current,
    baseline,
    delta: {
      accuracy_rate: current.accuracy_rate === null || baseline.accuracy_rate === null
        ? null
        : round(current.accuracy_rate - baseline.accuracy_rate),
      technical_success_rate: current.technical_success_rate === null || baseline.technical_success_rate === null
        ? null
        : round(current.technical_success_rate - baseline.technical_success_rate),
      cards_per_minute: current.cards_per_minute === null || baseline.cards_per_minute === null
        ? null
        : round(current.cards_per_minute - baseline.cards_per_minute),
      run_wall_ms: current.run_wall_ms === null || baseline.run_wall_ms === null
        ? null
        : current.run_wall_ms - baseline.run_wall_ms
    }
  };
}

function buildMarkdown(diagnostic) {
  const accuracy = diagnostic.accuracy;
  const technical = diagnostic.technical;
  const retrieval = diagnostic.retrieval;
  const lines = [
    "# Launch Gate Diagnostic",
    "",
    `- Policy token recall: avg=${accuracy.policy_token_recall_avg ?? "n/a"}, measured=${accuracy.measured_count}, threshold=${accuracy.threshold_rate}, gate=${accuracy.gate_passed ? "PASS" : "FAIL"}`,
    `- SEM disaster guard: min=${accuracy.sem_weighted_accuracy_min ?? "n/a"}, floor=${accuracy.sem_catastrophic_floor}, catastrophic cards=${accuracy.catastrophic_card_count}`,
    `- Technical success: ${technical.completed_count}/${technical.attempted_count} (${technical.success_rate ?? "n/a"})`,
    `- Throughput: ${technical.cards_per_minute ?? "n/a"} cards/min, wall=${technical.run_wall_ms ?? "n/a"}ms`,
    `- Tokens (observed): input=${diagnostic.provider.input_tokens}, output=${diagnostic.provider.output_tokens}, total=${diagnostic.provider.total_tokens}; complete=${diagnostic.provider.token_totals_complete}`,
    "",
    "## Slowest Nodes",
    "",
    "| Node | p50 ms | p95 ms | Status |",
    "| --- | ---: | ---: | --- |",
    ...diagnostic.pipeline.slowest_nodes.map((node) => `| ${node.node_id} | ${node.duration_p50_ms ?? ""} | ${node.duration_p95_ms ?? ""} | ${node.status} |`),
    "",
    "Node durations can overlap and must not be added together.",
    "",
    "## Retrieval Funnel",
    "",
    "| Lane | Available cards | Prompt cards | Applied cards | Applied fields | Title changed |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Catalog | ${retrieval.catalog.available_card_count} | ${retrieval.catalog.prompt_card_count} | ${retrieval.catalog.applied_card_count} | ${retrieval.catalog.applied_field_count} | ${retrieval.catalog.title_changed_card_count} |`,
    `| Vector | ${retrieval.vector.available_card_count} | ${retrieval.vector.prompt_card_count} | ${retrieval.vector.applied_card_count} | ${retrieval.vector.applied_field_count} | ${retrieval.vector.title_changed_card_count} |`,
    "",
    "## Accuracy Failure Clusters",
    "",
    "| Field | Component | Cards | Failed weight |",
    "| --- | --- | ---: | ---: |",
    ...accuracy.sem_failure_clusters.slice(0, 12).map((item) => `| ${item.field} | ${item.component} | ${item.affected_card_count} | ${item.failed_weight} |`),
    "",
    "## Diagnostic Cards",
    ""
  ];
  if (!diagnostic.failed_cards.length) lines.push("None.");
  for (const card of diagnostic.failed_cards) {
    lines.push(`- ${card.asset_id}: token=${card.policy_fair_token_recall ?? "n/a"}; SEM=${card.sem_weighted_accuracy ?? "n/a"}; reasons=${card.diagnostic_reasons.join(",") || "none"}; title=${card.final_title || "<missing>"}; reference=${card.reference_title || "<missing>"}`);
  }
  lines.push("", "## Integrity", "");
  lines.push(`- OCR partial cards: ${diagnostic.pipeline.ocr_partial_card_count}`);
  lines.push(`- Node errors/warnings/anomalies: ${diagnostic.pipeline.error_count}/${diagnostic.pipeline.warning_count}/${diagnostic.pipeline.anomaly_count}`);
  lines.push(`- Missing required nodes: ${diagnostic.pipeline.missing_required_node_count}`);
  lines.push(`- Unexplained terminal drops: ${diagnostic.pipeline.unexplained_terminal_drop_count}`);
  lines.push("- Candidate correctness audit: unavailable without reviewed field-level candidate identity ground truth; no proxy is invented.");
  if (diagnostic.comparison) {
    lines.push("", "## Baseline Comparison", "");
    lines.push(`- Direct causal comparison: ${diagnostic.comparison.direct_causal_comparison}`);
    lines.push(`- Accuracy delta: ${diagnostic.comparison.delta.accuracy_rate ?? "n/a"}`);
    lines.push(`- Technical success delta: ${diagnostic.comparison.delta.technical_success_rate ?? "n/a"}`);
    lines.push(`- Throughput delta: ${diagnostic.comparison.delta.cards_per_minute ?? "n/a"} cards/min`);
    lines.push(`- Wall-time delta: ${diagnostic.comparison.delta.run_wall_ms ?? "n/a"}ms`);
  }
  return `${lines.join("\n")}\n`;
}

export function analyzeLaunchGateReport(report, { baselineReport = null } = {}) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const internalResults = results.filter(isInternalReviewedGroundTruth);
  const technical = report?.technical_summary || {};
  const observability = technical?.pipeline_node_observability || {};
  const internal = report?.strata?.internal_reviewed_gt || {};
  const formal = internal?.formal_accuracy || {};
  const threshold = finiteNumber(report?.formal_accuracy_gate?.threshold_rate) ?? 0.87;
  const semCatastrophicFloor = finiteNumber(report?.formal_accuracy_gate?.sem_diagnostics?.catastrophic_floor) ?? 0.5;
  const nodeMetrics = Array.isArray(observability?.node_metrics) ? observability.node_metrics : [];
  const slowestNodes = nodeMetrics
    .map((node) => ({
      node_id: cleanText(node?.node_id),
      duration_p50_ms: finiteNumber(node?.duration_p50_ms),
      duration_p95_ms: finiteNumber(node?.duration_p95_ms),
      status: Object.entries(node?.status_breakdown || {}).map(([key, value]) => `${key}:${value}`).join(", ")
    }))
    .filter((node) => (node.duration_p95_ms ?? 0) > 0)
    .sort((left, right) => (right.duration_p95_ms ?? 0) - (left.duration_p95_ms ?? 0))
    .slice(0, 12);
  const attempted = finiteNumber(technical?.attempted_count) ?? results.length;
  const completed = finiteNumber(technical?.completed_count) ?? countWhere(results, (item) => item?.ok === true);
  const runWallMs = finiteNumber(technical?.run_wall_ms);
  const policyTokenValues = internalResults.map(policyTokenRecall).filter((value) => value !== null);
  const semValues = internalResults.map(semWeightedAccuracy).filter((value) => value !== null);
  const policyTokenRecallAvg = policyTokenValues.length
    ? round(sum(policyTokenValues) / policyTokenValues.length)
    : null;
  const semWeightedAccuracyAvg = semValues.length
    ? round(sum(semValues) / semValues.length)
    : null;
  const semWeightedAccuracyMin = semValues.length ? Math.min(...semValues) : null;
  const accuracyGatePassed = internalResults.length > 0
    && policyTokenValues.length === internalResults.length
    && semValues.length === internalResults.length
    && policyTokenRecallAvg >= threshold
    && semWeightedAccuracyMin >= semCatastrophicFloor;
  const semFailureClusters = aggregateSemFailureClusters(internalResults);
  const failedCards = internalResults
    .filter((item) => item?.ok !== true
      || policyTokenRecall(item) === null
      || policyTokenRecall(item) < threshold
      || semWeightedAccuracy(item) === null
      || semWeightedAccuracy(item) < semCatastrophicFloor)
    .map((item) => ({
      asset_id: cleanText(item?.asset_id),
      ok: item?.ok === true,
      error: cleanText(item?.error),
      sem_weighted_accuracy: round(item?.sem_projection_scoring?.weighted_accuracy),
      sem_accepted: item?.sem_projection_scoring?.accepted === true,
      sem_components: item?.sem_projection_scoring?.components || [],
      policy_fair_token_recall: round(item?.final_scoring?.policy_fair_token_recall),
      fair_token_recall: round(item?.final_scoring?.fair_token_recall),
      final_title: cleanText(item?.final_title),
      reference_title: cleanText(item?.reference_title),
      catalog_participation_level: cleanText(item?.l2_catalog_participation_level),
      vector_participation_level: cleanText(item?.l2_vector_participation_level),
      diagnostic_reasons: [
        item?.ok !== true ? "technical_failure" : "",
        policyTokenRecall(item) === null ? "missing_token_recall" : "",
        policyTokenRecall(item) !== null && policyTokenRecall(item) < threshold ? "token_below_threshold" : "",
        semWeightedAccuracy(item) === null ? "missing_sem" : "",
        semWeightedAccuracy(item) !== null && semWeightedAccuracy(item) < semCatastrophicFloor ? "sem_catastrophic" : ""
      ].filter(Boolean),
      anomalies: resultAnomalies(item)
    }))
    .sort((left, right) => (left.policy_fair_token_recall ?? -1) - (right.policy_fair_token_recall ?? -1));
  const providerInput = results.map((item) => item?.input_tokens ?? item?.provider_diagnostics?.input_tokens);
  const providerOutput = results.map((item) => item?.output_tokens ?? item?.provider_diagnostics?.output_tokens);
  const providerTotal = results.map((item) => item?.total_tokens ?? item?.provider_diagnostics?.total_tokens);
  const completeTokenRows = results.filter((item) => {
    const input = item?.input_tokens ?? item?.provider_diagnostics?.input_tokens;
    const output = item?.output_tokens ?? item?.provider_diagnostics?.output_tokens;
    const total = item?.total_tokens ?? item?.provider_diagnostics?.total_tokens;
    return finiteNumber(input) !== null && finiteNumber(output) !== null && finiteNumber(total) !== null;
  }).length;
  const providerLatencies = results.map((item) => finiteNumber(item?.provider_latency_ms ?? item?.provider_diagnostics?.provider_latency_ms)).filter((value) => value !== null);
  const diagnostic = {
    schema_version: "launch-gate-diagnostic-v2",
    generated_at: new Date().toISOString(),
    source_report_schema_version: cleanText(report?.schema_version),
    profile: cleanText(report?.profile),
    accuracy: {
      metric: "policy_fair_token_recall_avg_with_sem_catastrophic_guard",
      decision_authority: "policy_fair_token_recall_avg",
      measured_count: policyTokenValues.length,
      policy_token_recall_avg: policyTokenRecallAvg,
      rate: policyTokenRecallAvg,
      below_threshold_card_count: countWhere(policyTokenValues, (value) => value < threshold),
      sem_role: "catastrophic_guard_only",
      sem_measured_count: semValues.length,
      sem_weighted_accuracy_avg: semWeightedAccuracyAvg,
      sem_weighted_accuracy_min: semWeightedAccuracyMin,
      sem_catastrophic_floor: semCatastrophicFloor,
      catastrophic_card_count: countWhere(semValues, (value) => value < semCatastrophicFloor),
      sem_failure_clusters: semFailureClusters,
      threshold_rate: threshold,
      gate_passed: accuracyGatePassed,
      source_report_gate_passed: report?.formal_accuracy_gate?.passed === true,
      source_report_gate_metric: cleanText(report?.formal_accuracy_gate?.decision_metric || formal?.metric)
    },
    technical: {
      attempted_count: attempted,
      completed_count: completed,
      failed_count: finiteNumber(technical?.failed_count) ?? Math.max(0, attempted - completed),
      success_rate: attempted > 0 ? round(completed / attempted) : null,
      run_wall_ms: runWallMs,
      cards_per_minute: runWallMs && runWallMs > 0 ? round(completed / (runWallMs / 60000)) : null
    },
    provider: {
      input_tokens: sum(providerInput),
      output_tokens: sum(providerOutput),
      total_tokens: sum(providerTotal),
      token_observed_count: completeTokenRows,
      token_missing_count: Math.max(0, results.length - completeTokenRows),
      token_totals_complete: completeTokenRows === results.length,
      latency_ms_total: sum(providerLatencies),
      request_count: providerLatencies.length,
      rate_limit_remaining_requests_min: Math.min(...results.map((item) => finiteNumber(item?.["x-ratelimit-remaining-requests"] ?? item?.provider_diagnostics?.["x-ratelimit-remaining-requests"])).filter((value) => value !== null), Infinity),
      rate_limit_remaining_tokens_min: Math.min(...results.map((item) => finiteNumber(item?.["x-ratelimit-remaining-tokens"] ?? item?.provider_diagnostics?.["x-ratelimit-remaining-tokens"])).filter((value) => value !== null), Infinity)
    },
    pipeline: {
      slowest_nodes: slowestNodes,
      partial_or_failed_nodes: nodeMetrics.filter((node) => Object.entries(node?.status_breakdown || {}).some(([status, count]) => ["PARTIAL", "FAILED"].includes(status) && Number(count) > 0)),
      ledger_present_count: finiteNumber(observability?.ledger_present_count) ?? 0,
      missing_required_node_count: finiteNumber(observability?.missing_required_node_count) ?? 0,
      unexplained_terminal_drop_count: finiteNumber(observability?.unexplained_terminal_drop_count) ?? 0,
      error_count: finiteNumber(observability?.error_count) ?? 0,
      warning_count: finiteNumber(observability?.warning_count) ?? 0,
      anomaly_count: finiteNumber(observability?.anomaly_count) ?? 0,
      ocr_partial_card_count: nodeMetrics.find((node) => node?.node_id === "preingestion_ocr")?.status_breakdown?.PARTIAL ?? 0,
      anomaly_examples: observability?.anomaly_examples || []
    },
    retrieval: {
      catalog: aggregateRetrieval(results, "catalog"),
      vector: aggregateRetrieval(results, "vector"),
      candidate_correct_but_not_applied: {
        measurable: false,
        count: null,
        reason: "reviewed title-level GT does not prove candidate identity or field correctness"
      },
      candidate_wrong_but_applied: {
        measurable: false,
        count: null,
        reason: "reviewed title-level GT does not prove candidate identity or field correctness"
      }
    },
    failed_cards: failedCards
  };
  if (diagnostic.provider.rate_limit_remaining_requests_min === Infinity) diagnostic.provider.rate_limit_remaining_requests_min = null;
  if (diagnostic.provider.rate_limit_remaining_tokens_min === Infinity) diagnostic.provider.rate_limit_remaining_tokens_min = null;
  diagnostic.comparison = buildBaselineComparison(report, diagnostic, baselineReport);
  diagnostic.markdown = buildMarkdown(diagnostic);
  return diagnostic;
}

export async function runCli(argv = process.argv.slice(2)) {
  const reportPath = resolve(argumentValue(argv, "--report"));
  const baselinePath = argumentValue(argv, "--baseline-report");
  const outPath = resolve(argumentValue(argv, "--out", "launch-gate-diagnostic.json"));
  const defaultMarkdownPath = outPath.toLowerCase().endsWith(".json")
    ? `${outPath.slice(0, -5)}.md`
    : `${outPath}.md`;
  const markdownPath = resolve(argumentValue(argv, "--markdown", defaultMarkdownPath));
  if (!argumentValue(argv, "--report")) throw new Error("--report is required");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const baselineReport = baselinePath
    ? JSON.parse(await readFile(resolve(baselinePath), "utf8"))
    : null;
  const diagnostic = analyzeLaunchGateReport(report, { baselineReport });
  const { markdown, ...jsonDiagnostic } = diagnostic;
  await writeFile(outPath, `${JSON.stringify(jsonDiagnostic, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  process.stdout.write(`${JSON.stringify({ out: outPath, markdown: markdownPath, accuracy: diagnostic.accuracy, technical: diagnostic.technical }, null, 2)}\n`);
  return diagnostic;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runCli().catch((error) => {
    console.error(`Analyze launch-gate report failed: ${error.message}`);
    process.exitCode = 1;
  });
}
