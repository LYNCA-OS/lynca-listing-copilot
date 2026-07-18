#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateFullInformationReplay,
  fitRecognitionTransitionModelFromReplay
} from "../lib/listing/v4/policy/full-information-replay.mjs";
import { buildReplayFromSourceDocuments } from "../lib/listing/v4/policy/replay-source-adapters.mjs";

function argValues(argv, name) {
  const values = [];
  argv.forEach((value, index) => {
    if (value === name && argv[index + 1]) values.push(argv[index + 1]);
    else if (value.startsWith(`${name}=`)) values.push(value.slice(name.length + 1));
  });
  return values;
}

function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function percentage(value) {
  return value === null || value === undefined ? "不可计算" : `${(Number(value) * 100).toFixed(2)}%`;
}

export function renderFullInformationReplayReport({ replay, evaluation, transitionModel }) {
  const lines = [
    "# Full-Information Replay / Optimal Policy Calibration",
    "",
    `生成时间：${evaluation.generated_at}`,
    "",
    "## 数据资格",
    "",
    `- 输入卡片：${replay.data_quality.card_count}`,
    `- 字段级 Reviewed GT：${replay.data_quality.field_reviewed_card_count}`,
    `- Full-Information 完整卡：${evaluation.data_quality.full_information_oracle_evaluable_count}`,
    `- 可用于商业准确率声明：${replay.data_quality.commercial_claim_eligible_card_count}`,
    `- Oracle 声明状态：${evaluation.data_quality.oracle_claim_blocked ? `阻断（${evaluation.data_quality.oracle_claim_blocked_reason}）` : "可计算"}`,
    "",
    "## 链路 Oracle",
    "",
    `- Chain Oracle SEM 上界：${percentage(evaluation.chain_oracle.sem_accuracy_upper_bound)}`,
    `- Chain Oracle 关键字段上界：${percentage(evaluation.chain_oracle.critical_accuracy_upper_bound)}`,
    "",
    "## 目标前沿",
    ""
  ];
  for (const row of evaluation.target_frontier) {
    const policy = row.minimum_latency_policy;
    lines.push(policy
      ? `- ${(row.target * 100).toFixed(0)}%：${policy.actions.join(" + ")}；中位顺序耗时 ${policy.median_sequential_latency_ms}ms；容量 ${policy.median_capacity_ms}ms`
      : `- ${(row.target * 100).toFixed(0)}%：当前 Full-Information 数据无法证明可达`);
  }
  lines.push(
    "",
    "## Launch Gate 可行策略",
    ""
  );
  if (!evaluation.launch_policy_candidates.length) {
    lines.push("- 当前没有可评估的完整动作策略；不得据此上线。");
  } else {
    for (const policy of evaluation.launch_policy_candidates.slice(0, 10)) {
      lines.push(
        `- ${policy.launch_feasible ? "PASS" : "BLOCK"}：${policy.actions.join(" + ")}`,
        `  - SEM=${percentage(policy.sem_accuracy)}；关键字段=${percentage(policy.critical_field_accuracy)}；技术失败=${percentage(policy.technical_failure_rate)}`,
        `  - 估算吞吐=${policy.estimated_cards_per_minute === null ? "不可计算" : `${policy.estimated_cards_per_minute.toFixed(2)} cards/min`}；容量槽=${policy.effective_capacity_slots}`,
        `  - blockers=${policy.launch_blockers.length ? policy.launch_blockers.join(", ") : "none"}`
      );
    }
  }
  lines.push(
    "",
    "## 现实参数拟合",
    "",
    `- Transition Model：${transitionModel.model_id}`,
    `- 已由风险前后状态拟合：${transitionModel.fitted_from_replay ? "是" : "否，继续使用保守先验"}`,
    ""
  );
  for (const [action, quality] of Object.entries(transitionModel.fit_quality)) {
    lines.push(`- ${action}：observations=${quality.observation_count}，risk_pairs=${quality.risk_pair_count}，outcomes_fitted=${quality.outcomes_fitted}`);
  }
  lines.push(
    "",
    "## 解释边界",
    "",
    "- corrected_title、seller title 和 token recall 只保留为代理标签，不会进入 Chain Oracle。",
    "- 只有字段级 Reviewed GT 且同卡动作信息完整时，才进入 Oracle/Pareto 分母。",
    "- 在线优化器使用拉格朗日损失选择下一动作；是否上线由上面的严格 Accuracy/Throughput/Reliability 可行域单独裁决。",
    "- 本报告只校准 shadow 策略，不改变生产路由。",
    ""
  );
  return `${lines.join("\n")}\n`;
}

export async function buildReplayArtifacts({ inputs, replayOut, evaluationOut, transitionOut, reportOut }) {
  const sourceDocuments = await Promise.all(inputs.map(async (path) => ({
    path,
    document: JSON.parse(await readFile(path, "utf8"))
  })));
  const replay = buildReplayFromSourceDocuments(sourceDocuments, { builder: "build-full-information-replay.mjs" });
  const evaluation = evaluateFullInformationReplay(replay);
  const transitionModel = fitRecognitionTransitionModelFromReplay(replay);
  await Promise.all([
    writeJson(replayOut, replay),
    writeJson(evaluationOut, evaluation),
    writeJson(transitionOut, transitionModel),
    mkdir(dirname(reportOut), { recursive: true }).then(() => writeFile(
      reportOut,
      renderFullInformationReplayReport({ replay, evaluation, transitionModel }),
      "utf8"
    ))
  ]);
  return { replay, evaluation, transitionModel };
}

async function main() {
  const argv = process.argv.slice(2);
  const inputs = argValues(argv, "--input").map((path) => resolve(path));
  if (!inputs.length) throw new Error("At least one --input JSON report is required");
  const outputDir = resolve(argValue(argv, "--output-dir", "data/eval/optimal-policy"));
  const result = await buildReplayArtifacts({
    inputs,
    replayOut: resolve(argValue(argv, "--replay-out", `${outputDir}/full-information-replay.json`)),
    evaluationOut: resolve(argValue(argv, "--evaluation-out", `${outputDir}/oracle-evaluation.json`)),
    transitionOut: resolve(argValue(argv, "--transition-out", `${outputDir}/transition-model.json`)),
    reportOut: resolve(argValue(argv, "--report-out", `${outputDir}/optimal-policy-calibration.md`))
  });
  console.log(JSON.stringify({
    card_count: result.replay.data_quality.card_count,
    oracle_evaluable_count: result.evaluation.data_quality.full_information_oracle_evaluable_count,
    chain_oracle_sem_upper_bound: result.evaluation.chain_oracle.sem_accuracy_upper_bound,
    transition_model_fitted: result.transitionModel.fitted_from_replay,
    output_dir: outputDir
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
