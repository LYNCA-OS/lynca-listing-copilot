import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRetrievalParticipationSummary,
  retrievalParticipationLevels
} from "../lib/listing/retrieval/retrieval-participation.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundedRate(count, denominator) {
  return denominator > 0 ? Number((count / denominator).toFixed(6)) : null;
}

function timestampValue(item = {}, fallback = 0) {
  for (const value of [
    item.job_created_at,
    item.recognition_started_at,
    item.job_started_at,
    item.job_completed_at
  ]) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function candidateTraceFromItem(item = {}) {
  const candidates = [
    item.l2_candidate_debug?.candidate_application_trace,
    item.candidate_control_plane_trace?.candidate_application_trace_rows,
    item.l2_status?.candidate_control_plane_trace?.candidate_application_trace_rows,
    item.l2_status?.candidate_application_trace
  ];
  return candidates.find(Array.isArray) || [];
}

function candidateDecisionStageFromItem(item = {}) {
  return item.l2_candidate_debug?.candidate_decision_stage
    || item.candidate_control_plane_trace?.candidate_decision_stage
    || item.l2_status?.candidate_control_plane_trace?.candidate_decision_stage
    || {};
}

function retrievalApplicationFromItem(item = {}) {
  return item.l2_candidate_debug?.retrieval_application
    || item.candidate_control_plane_trace?.retrieval_application
    || item.l2_status?.candidate_control_plane_trace?.retrieval_application
    || item.retrieval_application
    || {};
}

function funnelFromItem(item = {}, source = "catalog") {
  const nested = item.l2_candidate_debug?.[`${source}_activation_funnel`]
    || item.candidate_control_plane_trace?.[`${source}_activation_funnel`]
    || item.l2_status?.candidate_control_plane_trace?.[`${source}_activation_funnel`];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  const prefix = `l2_${source}_`;
  return {
    query_attempted: item[`${prefix}raw_candidate_count`] !== undefined
      || item.l2_status?.[`${source}_pre_observation_query_attempted`] === true
      || item.l2_status?.[`${source}_post_observation_query_attempted`] === true,
    raw_candidate_count: item[`${prefix}raw_candidate_count`] ?? item.l2_status?.[`${source}_raw_candidate_count`],
    approved_candidate_count: item[`${prefix}approved_candidate_count`] ?? item.l2_status?.[`${source}_approved_candidate_count`],
    conflict_blocked_count: item[`${prefix}conflict_blocked_count`] ?? item.l2_status?.[`${source}_conflict_blocked_count`],
    prompt_candidate_count: item[`${prefix}prompt_candidate_count`] ?? item.l2_status?.[`${source}_prompt_candidate_count`],
    evidence_support_field_count: item[`${prefix}evidence_support_field_count`] ?? item.l2_status?.[`${source}_evidence_support_field_count`],
    participation_level: item[`${prefix}participation_level`] ?? item.l2_status?.[`${source}_participation_level`],
    selected_candidate_id: item[`${source}_selected_candidate_id`] || "",
    applied_field_count: 0,
    applied_fields: [],
    title_changed: false
  };
}

function exactAnchorIdentityDecisionFromItem(item = {}) {
  return item.pre_l2_anchor_fast_lane_hit === true
    || item.l2_status?.pre_l2_anchor_fast_lane_hit === true
    || item.v4_l2_timing?.pre_l2_anchor_fast_lane_hit === true
    || item.l2_status?.v4_l2_timing?.pre_l2_anchor_fast_lane_hit === true
    || cleanText(item.pre_l2_anchor_finalize_reason) === "exact_anchor_catalog_finalized";
}

function explicitRetrievalOutcome(item = {}, participation = {}) {
  const recovery = item.retrieval_recovery === true
    || item.catalog_recovery === true
    || item.vector_recovery === true
    || item.external_retrieval_recovery === true;
  const regression = item.retrieval_regression === true
    || item.catalog_regression === true
    || item.vector_regression === true
    || item.external_retrieval_regression === true;
  if (recovery && regression) return { status: "CONFLICTING_EXPLICIT_OUTCOME", evaluable: false };
  if (recovery) return { status: "RECOVERY", evaluable: true };
  if (regression) return { status: "REGRESSION", evaluable: true };
  const decisionStage = candidateDecisionStageFromItem(item);
  if (decisionStage.title_changed === true || participation.retrieval_applied) {
    return { status: "CHANGED_WITHOUT_COUNTERFACTUAL_SCORE", evaluable: false };
  }
  if (Object.values(participation.sources).some((row) => row.prompt_candidate_count > 0)) {
    return { status: "PROMPT_INFLUENCE_NOT_COUNTERFACTUALLY_IDENTIFIABLE", evaluable: false };
  }
  return { status: "NO_MATERIAL_EFFECT_OBSERVED", evaluable: true };
}

function scoringFromItem(item = {}) {
  const scoring = item.final_scoring || item.corrected_title_comparison || {};
  return {
    policy_fair_token_recall: Number.isFinite(Number(scoring.policy_fair_token_recall))
      ? Number(scoring.policy_fair_token_recall)
      : null,
    pass_at_0_72: item.final_scoring?.policy_fair_pass_at_0_72 === true
      || Number(scoring.policy_fair_token_recall) >= 0.72
  };
}

export function buildRetrievalDecisionAudit(report = {}, {
  sampleSize = 100,
  selection = "latest_attempted"
} = {}) {
  const sourceResults = Array.isArray(report.results) ? report.results : [];
  const indexed = sourceResults.map((item, index) => ({ item, index }));
  const selected = selection === "latest_attempted"
    ? indexed
      .sort((left, right) => timestampValue(left.item, left.index) - timestampValue(right.item, right.index))
      .slice(-Math.max(1, sampleSize))
    : indexed.slice(0, Math.max(1, sampleSize));
  const perCard = selected.map(({ item, index }) => {
    const participation = buildRetrievalParticipationSummary({
      catalogFunnel: funnelFromItem(item, "catalog"),
      vectorFunnel: funnelFromItem(item, "vector"),
      candidateApplicationTrace: candidateTraceFromItem(item),
      candidateDecisionStage: candidateDecisionStageFromItem(item),
      retrievalApplication: retrievalApplicationFromItem(item),
      exactAnchorIdentityDecision: exactAnchorIdentityDecisionFromItem(item)
    });
    const outcome = explicitRetrievalOutcome(item, participation);
    return {
      ordinal: index + 1,
      asset_id: item.asset_id || null,
      job_id: item.job_id || null,
      job_created_at: item.job_created_at || null,
      job_completed_at: item.job_completed_at || null,
      technical_success: item.ok === true && item.writer_ready !== false,
      final_title: item.final_title || item.l2_status?.title || "",
      reviewed_reference_title: item.reference_title || item.reviewed_title || "",
      reviewed_ground_truth: item.reference_title_is_reviewed_ground_truth === true,
      scoring: scoringFromItem(item),
      retrieval_participation: participation,
      retrieval_outcome: outcome
    };
  });
  const attemptedCount = perCard.length;
  const sourceMetrics = Object.fromEntries(["catalog", "vector"].map((source) => {
    const rows = perCard.map((item) => item.retrieval_participation.sources[source]);
    const hitCount = rows.filter((row) => row.retrieval_available).length;
    const usedCount = rows.filter((row) => row.retrieval_used).length;
    const appliedCount = rows.filter((row) => row.retrieval_applied).length;
    const unusedCount = rows.filter((row) => row.retrieval_unused).length;
    const availableButNotAppliedCount = rows.filter((row) => row.retrieval_available_but_not_applied).length;
    const distribution = rows.reduce((counts, row) => {
      counts[row.participation_level] = (counts[row.participation_level] || 0) + 1;
      return counts;
    }, {});
    const roleDistribution = rows.flatMap((row) => row.participation_roles || []).reduce((counts, role) => {
      counts[role] = (counts[role] || 0) + 1;
      return counts;
    }, {});
    return [source, {
      hit_count: hitCount,
      hit_rate: roundedRate(hitCount, attemptedCount),
      used_count: usedCount,
      used_rate: roundedRate(usedCount, attemptedCount),
      used_rate_among_hits: roundedRate(usedCount, hitCount),
      applied_count: appliedCount,
      applied_rate: roundedRate(appliedCount, attemptedCount),
      applied_rate_among_hits: roundedRate(appliedCount, hitCount),
      available_but_unused_count: unusedCount,
      available_but_unused_rate_among_hits: roundedRate(unusedCount, hitCount),
      available_but_not_applied_count: availableButNotAppliedCount,
      available_but_not_applied_rate_among_hits: roundedRate(availableButNotAppliedCount, hitCount),
      raw_candidate_count: rows.reduce((sum, row) => sum + finiteCount(row.raw_candidate_count), 0),
      approved_candidate_count: rows.reduce((sum, row) => sum + finiteCount(row.approved_candidate_count), 0),
      prompt_candidate_count: rows.reduce((sum, row) => sum + finiteCount(row.prompt_candidate_count), 0),
      evidence_support_field_count: rows.reduce((sum, row) => sum + finiteCount(row.evidence_support_field_count), 0),
      applied_field_count: rows.reduce((sum, row) => sum + finiteCount(row.applied_field_count), 0),
      participation_level_distribution: distribution,
      participation_role_distribution: roleDistribution
    }];
  }));
  const retrievalAvailableCount = perCard.filter((item) => item.retrieval_participation.retrieval_available).length;
  const retrievalUnusedCount = perCard.filter((item) => item.retrieval_participation.retrieval_unused).length;
  const retrievalNotAppliedCount = perCard.filter((item) => item.retrieval_participation.retrieval_available_but_not_applied).length;
  const candidateAvailableCount = perCard.filter((item) => item.retrieval_participation.candidate_available).length;
  const candidateToFinalCount = perCard.filter((item) => item.retrieval_participation.candidate_to_final).length;
  const recoveryCount = perCard.filter((item) => item.retrieval_outcome.status === "RECOVERY").length;
  const regressionCount = perCard.filter((item) => item.retrieval_outcome.status === "REGRESSION").length;
  const counterfactualEvaluableCount = perCard.filter((item) => item.retrieval_outcome.evaluable).length;
  const promptInfluenceUnknownCount = perCard.filter((item) => (
    item.retrieval_outcome.status === "PROMPT_INFLUENCE_NOT_COUNTERFACTUALLY_IDENTIFIABLE"
  )).length;
  return {
    schema_version: "retrieval-decision-audit-v1",
    generated_at: new Date().toISOString(),
    source_report_generated_at: report.generated_at || null,
    source_run_id: report.soak_run_id || report.run_id || null,
    cohort: {
      selection,
      requested_sample_size: sampleSize,
      evaluated_count: attemptedCount,
      technical_success_count: perCard.filter((item) => item.technical_success).length,
      reviewed_ground_truth_count: perCard.filter((item) => item.reviewed_ground_truth).length,
      first_job_created_at: perCard[0]?.job_created_at || null,
      last_job_created_at: perCard.at(-1)?.job_created_at || null
    },
    metric_definitions: {
      hit_rate: "cards with one or more raw candidates divided by evaluated cards",
      applied_rate: "cards where retrieval changed a final field/title or made an identity decision divided by evaluated cards",
      candidate_to_final_rate: "cards with a ranking candidate that materially reached final fields divided by cards with a ranking candidate",
      available_but_unused: "raw candidate existed but did not enter ranking, field evidence, or identity decision",
      available_but_not_applied: "raw candidate existed but did not materially change final fields/title",
      recovery_regression: "counted only when an explicit or scored no-retrieval counterfactual exists"
    },
    metrics: {
      catalog_hit_rate: sourceMetrics.catalog.hit_rate,
      catalog_applied_rate: sourceMetrics.catalog.applied_rate,
      vector_hit_rate: sourceMetrics.vector.hit_rate,
      vector_applied_rate: sourceMetrics.vector.applied_rate,
      candidate_to_final_rate: roundedRate(candidateToFinalCount, candidateAvailableCount),
      candidate_to_final_count: candidateToFinalCount,
      candidate_available_count: candidateAvailableCount,
      retrieval_recovery_count: recoveryCount,
      retrieval_regression_count: regressionCount,
      retrieval_counterfactual_evaluable_count: counterfactualEvaluableCount,
      retrieval_prompt_influence_unknown_count: promptInfluenceUnknownCount,
      retrieval_available_count: retrievalAvailableCount,
      retrieval_available_rate: roundedRate(retrievalAvailableCount, attemptedCount),
      retrieval_available_but_unused_count: retrievalUnusedCount,
      retrieval_available_but_unused_rate: roundedRate(retrievalUnusedCount, retrievalAvailableCount),
      retrieval_available_but_not_applied_count: retrievalNotAppliedCount,
      retrieval_available_but_not_applied_rate: roundedRate(retrievalNotAppliedCount, retrievalAvailableCount)
    },
    sources: sourceMetrics,
    data_quality: {
      candidate_application_trace_card_count: perCard.filter((item) => (
        candidateTraceFromItem(selected.find((row) => row.index + 1 === item.ordinal)?.item || {}).length > 0
      )).length,
      identity_decision_card_count: perCard.filter((item) => item.retrieval_participation.identity_decision_sources.length > 0).length,
      limitation: promptInfluenceUnknownCount > 0
        ? "Prompt candidates were visible to the provider without a paired no-retrieval result, so causal recovery/regression is not identifiable for those cards."
        : null
    },
    per_card: perCard
  };
}

function percent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function auditMarkdown(audit = {}, sourcePath = "") {
  const metrics = audit.metrics || {};
  const catalog = audit.sources?.catalog || {};
  const vector = audit.sources?.vector || {};
  return `# Retrieval Decision Audit\n\n` +
    `## 结论\n\n` +
    `过去 ${audit.cohort?.evaluated_count || 0} 张中，Retrieval 在 ${metrics.retrieval_available_count || 0} 张有候选，但只有 ${metrics.candidate_to_final_count || 0} 张能被证明进入最终字段。` +
    `严格的 available-but-unused 比例为 ${percent(metrics.retrieval_available_but_unused_rate)}；更严格看最终应用，${metrics.retrieval_available_but_not_applied_count || 0} 张有候选但没有可观测的最终字段影响。\n\n` +
    `## 核心漏斗\n\n` +
    `| 来源 | Hit | Used | Applied | Available but unused | Available but not applied |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: |\n` +
    `| Catalog | ${catalog.hit_count || 0} (${percent(catalog.hit_rate)}) | ${catalog.used_count || 0} (${percent(catalog.used_rate)}) | ${catalog.applied_count || 0} (${percent(catalog.applied_rate)}) | ${catalog.available_but_unused_count || 0} (${percent(catalog.available_but_unused_rate_among_hits)}) | ${catalog.available_but_not_applied_count || 0} (${percent(catalog.available_but_not_applied_rate_among_hits)}) |\n` +
    `| Vector | ${vector.hit_count || 0} (${percent(vector.hit_rate)}) | ${vector.used_count || 0} (${percent(vector.used_rate)}) | ${vector.applied_count || 0} (${percent(vector.applied_rate)}) | ${vector.available_but_unused_count || 0} (${percent(vector.available_but_unused_rate_among_hits)}) | ${vector.available_but_not_applied_count || 0} (${percent(vector.available_but_not_applied_rate_among_hits)}) |\n\n` +
    `Candidate-to-final：${metrics.candidate_to_final_count || 0}/${metrics.candidate_available_count || 0}（${percent(metrics.candidate_to_final_rate)}）。\n\n` +
    `## 参与层分布\n\n` +
    `- Catalog: ${JSON.stringify(catalog.participation_level_distribution || {})}\n` +
    `  - roles: ${JSON.stringify(catalog.participation_role_distribution || {})}\n` +
    `- Vector: ${JSON.stringify(vector.participation_level_distribution || {})}\n` +
    `  - roles: ${JSON.stringify(vector.participation_role_distribution || {})}\n` +
    `- 合同: ${Object.values(retrievalParticipationLevels).join(" → ")}\n\n` +
    `## Recovery / Regression\n\n` +
    `- retrieval_recovery_count: ${metrics.retrieval_recovery_count || 0}\n` +
    `- retrieval_regression_count: ${metrics.retrieval_regression_count || 0}\n` +
    `- counterfactual_evaluable_count: ${metrics.retrieval_counterfactual_evaluable_count || 0}\n` +
    `- prompt_influence_unknown_count: ${metrics.retrieval_prompt_influence_unknown_count || 0}\n\n` +
    `单次运行中把候选提前送入模型，无法反推出“没有 Retrieval 时会输出什么”。因此 0 recovery / 0 regression 只表示没有可审计的显式记录，不表示 Retrieval 没有隐性正负影响。要回答因果净收益，需要同图、同模型、同 prompt core 的 retrieval-off 对照。\n\n` +
    `## 口径\n\n` +
    `- Hit：至少返回一个 raw candidate。\n` +
    `- Used：候选进入排序、字段证据或身份决策。\n` +
    `- Applied：Retrieval 改变最终字段/标题，或成为身份决策依据。\n` +
    `- Available but unused：有候选，但只停留在观察层。\n` +
    `- Available but not applied：有候选，但没有改变最终状态。\n\n` +
    `Source report: ${path.basename(sourcePath || "unknown")}\n`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    input: "",
    outDir: "data/eval/retrieval-decision-audit",
    sampleSize: 100,
    selection: "latest_attempted"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") options.input = argv[++index] || "";
    else if (value === "--out-dir") options.outDir = argv[++index] || options.outDir;
    else if (value === "--sample-size") options.sampleSize = Number(argv[++index] || 100);
    else if (value === "--selection") options.selection = argv[++index] || options.selection;
    else if (!value.startsWith("--") && !options.input) options.input = value;
  }
  return options;
}

async function main() {
  const options = parseArgs();
  if (!options.input) {
    throw new Error("Usage: node scripts/retrieval-decision-audit.mjs --input <report.json> [--sample-size 100] [--out-dir <dir>]");
  }
  const report = JSON.parse(await fs.readFile(options.input, "utf8"));
  const audit = buildRetrievalDecisionAudit(report, options);
  await fs.mkdir(options.outDir, { recursive: true });
  const runLabel = cleanText(audit.source_run_id || "report").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
  const base = `retrieval-decision-audit-${runLabel}-n${audit.cohort.evaluated_count}`;
  const jsonPath = path.join(options.outDir, `${base}.json`);
  const jsonlPath = path.join(options.outDir, `${base}.jsonl`);
  const markdownPath = path.join(options.outDir, `${base}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(audit, null, 2)}\n`);
  await fs.writeFile(jsonlPath, `${audit.per_card.map((item) => JSON.stringify(item)).join("\n")}\n`);
  await fs.writeFile(markdownPath, auditMarkdown(audit, options.input));
  process.stdout.write(`${JSON.stringify({ json: jsonPath, jsonl: jsonlPath, markdown: markdownPath, metrics: audit.metrics }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`retrieval decision audit failed: ${error.message}`);
    process.exit(1);
  });
}
