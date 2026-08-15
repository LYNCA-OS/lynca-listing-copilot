#!/usr/bin/env node

// csmdata reveal boundary. All execution artifacts are validated COMPLETE
// before this process opens sealed labels. It has no network dependency and
// never mutates the raw execution artifacts.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  lunaParityArm,
  parseLunaParityResponse,
  sha256
} from "./luna-parity-core.mjs";

const arg = (argv, name, fallback = "") => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : String(argv[index + 1] || "");
};

const average = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function tokens(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9]+(?:[./-][a-z0-9]+)*/g) || [];
}

function f1(reference, candidate) {
  const expected = tokens(reference);
  const actual = tokens(candidate);
  const remaining = new Map();
  for (const token of expected) remaining.set(token, (remaining.get(token) || 0) + 1);
  let matches = 0;
  for (const token of actual) {
    const count = remaining.get(token) || 0;
    if (count > 0) {
      matches += 1;
      remaining.set(token, count - 1);
    }
  }
  const precision = actual.length ? matches / actual.length : 0;
  const recall = expected.length ? matches / expected.length : 0;
  return {
    precision,
    recall,
    f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0
  };
}

function exactSignTest(deltas) {
  const wins = deltas.filter((value) => value > 1e-9).length;
  const losses = deltas.filter((value) => value < -1e-9).length;
  const ties = deltas.length - wins - losses;
  const n = wins + losses;
  if (!n) return { wins, losses, ties, p: 1 };
  const choose = (count, pick) => {
    let value = 1;
    for (let index = 1; index <= pick; index += 1) {
      value = value * (count - pick + index) / index;
    }
    return value;
  };
  const tail = Math.min(wins, losses);
  let probability = 0;
  for (let index = 0; index <= tail; index += 1) {
    probability += choose(n, index) * (0.5 ** n);
  }
  return { wins, losses, ties, p: Math.min(1, 2 * probability) };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function readJsonLines(path) {
  const rows = [];
  for (const [index, line] of String(await readFile(resolve(path))).split("\n").entries()) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); }
    catch { throw new Error(`luna_parity_score_jsonl_invalid:line_${index + 1}`); }
  }
  return rows;
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function validateScoreContract(contract, {
  assetsManifest, labelMap, scorerBody
}) {
  const { score_contract_sha256: fingerprint, ...frozen } = contract || {};
  if (contract?.schema_version !== "luna-parity-score-contract-v1"
      || fingerprint !== sha256(JSON.stringify(frozen))
      || contract.assets_manifest_sha256 !== sha256(JSON.stringify(assetsManifest))
      || contract.label_map_sha256 !== sha256(JSON.stringify(labelMap))
      || contract.sealed_labels_sha256 !== labelMap.sealed_labels_sha256
      || contract.scorer_sha256 !== sha256(scorerBody)
      || contract.selected_asset_ids_sha256 !== assetsManifest.selected_asset_ids_sha256
      || contract.selected_cards !== assetsManifest.assets.length
      || !Array.isArray(contract.arms) || contract.arms.length !== 2
      || contract.control_arm !== contract.arms[0]
      || contract.treatment_arm !== contract.arms[1]
      || contract.primary_metric !== "reviewed_title_token_f1"
      || contract.paired_test !== "exact_two_sided_sign_test"
      || contract.complete_pair_only !== true || contract.no_replacement !== true
      || contract.typed_field_gold !== false
      || contract.production_authorized !== false) {
    throw new Error("luna_parity_score_contract_invalid");
  }
  return fingerprint;
}

function validateFrozenExecution({ executionManifest, receipt, rawBody, results,
  scoreContract, assetsManifest }) {
  if (executionManifest?.schema_version !== "luna-parity-blind-execution-v1"
      || executionManifest.run_fingerprint !== sha256(JSON.stringify((({ run_fingerprint, ...rest }) => rest)(executionManifest)))
      || executionManifest.score_contract_sha256 !== scoreContract.score_contract_sha256
      || executionManifest.assets_manifest_sha256 !== sha256(JSON.stringify(assetsManifest))
      || JSON.stringify(executionManifest.arms) !== JSON.stringify(scoreContract.arms)
      || executionManifest.selected_cards !== assetsManifest.assets.length
      || executionManifest.sealed_labels_accessed_during_execution !== false
      || receipt?.state !== "COMPLETE"
      || receipt.run_fingerprint !== executionManifest.run_fingerprint
      || receipt.score_contract_sha256 !== scoreContract.score_contract_sha256
      || receipt.selected_cards !== assetsManifest.assets.length
      || receipt.expected_jobs !== assetsManifest.assets.length * scoreContract.arms.length
      || receipt.completed_jobs !== receipt.expected_jobs
      || receipt.provider_claims !== receipt.expected_jobs
      || receipt.provider_retries !== 0
      || receipt.provider_max_attempts !== 1
      || receipt.sealed_labels_accessed_during_execution !== false
      || receipt.raw_results_sha256 !== sha256(rawBody)
      || receipt.raw_results_bytes !== rawBody.length
      || (receipt.incomplete_assets || []).length !== 0
      || results.length !== receipt.expected_jobs) {
    throw new Error("luna_parity_execution_not_frozen_complete");
  }
  const expected = new Set(assetsManifest.assets.flatMap((asset) => scoreContract.arms.map((arm) =>
    `${asset.asset_id}::${arm}`)));
  const responseIds = new Set();
  for (const row of results) {
    const key = `${row.asset_id}::${row.arm}`;
    const asset = assetsManifest.assets.find(({ asset_id: assetId }) => assetId === row.asset_id);
    const arm = lunaParityArm(row.arm);
    if (!expected.delete(key) || !asset
        || row.schema_version !== "luna-parity-blind-result-v1"
        || row.run_fingerprint !== executionManifest.run_fingerprint
        || row.image_set_sha256 !== asset.image_set_sha256
        || row.request_attempt_count !== 1 || row.provider_retries !== 0
        || row.served_model !== executionManifest.model
        || row.served_effort !== executionManifest.effort
        || row.provider_body_sha256 !== sha256(JSON.stringify(row.provider_body))
        || responseIds.has(row.provider_response_id)) {
      throw new Error(`luna_parity_raw_result_invalid:${key}`);
    }
    const replay = parseLunaParityResponse({ arm, body: row.provider_body, request: null });
    if (replay.rawOutput !== row.raw_output || replay.finished.title !== row.title
        || row.title_length !== row.title.length || row.title.length > 80) {
      throw new Error(`luna_parity_raw_result_replay_mismatch:${key}`);
    }
    responseIds.add(row.provider_response_id);
  }
  if (expected.size) throw new Error("luna_parity_raw_result_coverage_missing");
}

function parseLabels(body) {
  const labels = new Map();
  for (const [index, line] of String(body).split("\n").entries()) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!row?.key || labels.has(row.key)
        || typeof row.reviewed_title !== "string" || !row.reviewed_title.trim()
        || row.policy?.reviewed_title_is_ground_truth !== true
        || row.policy?.model_prompt_visible !== false
        || row.policy?.load_after_predictions_frozen !== true) {
      throw new Error(`luna_parity_sealed_label_invalid:line_${index + 1}`);
    }
    labels.set(row.key, row.reviewed_title);
  }
  return labels;
}

export async function scoreLunaParityBlind({
  executionManifest,
  receipt,
  rawBody,
  results,
  assetsManifest,
  labelMap,
  scoreContract,
  scorerBody,
  readLabels
}) {
  validateScoreContract(scoreContract, { assetsManifest, labelMap, scorerBody });
  validateFrozenExecution({ executionManifest, receipt, rawBody, results,
    scoreContract, assetsManifest });
  if (labelMap?.schema_version !== "luna-parity-sealed-label-map-v1"
      || labelMap.assets_manifest_sha256 !== scoreContract.assets_manifest_sha256
      || labelMap.selected_asset_ids_sha256 !== scoreContract.selected_asset_ids_sha256
      || labelMap.mapping_sha256 !== sha256(JSON.stringify(labelMap.mapping))
      || !Array.isArray(labelMap.mapping)
      || labelMap.mapping.length !== assetsManifest.assets.length
      || labelMap.sealed_label_bytes_read !== false) {
    throw new Error("luna_parity_label_map_invalid");
  }

  // The only label read in this workflow occurs after every execution receipt
  // above has been replayed and proven COMPLETE.
  const labelsBody = await readLabels();
  if (sha256(labelsBody) !== scoreContract.sealed_labels_sha256) {
    throw new Error("luna_parity_sealed_labels_hash_mismatch");
  }
  const labels = parseLabels(labelsBody);
  const labelByAsset = new Map(labelMap.mapping.map(({ asset_id: assetId, label_key: key }) => {
    const reference = labels.get(key);
    if (!reference) throw new Error(`luna_parity_label_key_missing:${assetId}`);
    return [assetId, reference];
  }));
  const byKey = new Map(results.map((row) => [`${row.asset_id}::${row.arm}`, row]));
  const scored = [];
  const deltas = [];
  for (const asset of assetsManifest.assets) {
    const reference = labelByAsset.get(asset.asset_id);
    const control = byKey.get(`${asset.asset_id}::${scoreContract.control_arm}`);
    const treatment = byKey.get(`${asset.asset_id}::${scoreContract.treatment_arm}`);
    const controlScore = f1(reference, control.title);
    const treatmentScore = f1(reference, treatment.title);
    const delta = treatmentScore.f1 - controlScore.f1;
    deltas.push(delta);
    scored.push({
      asset_id: asset.asset_id,
      reference,
      control_arm: scoreContract.control_arm,
      control_title: control.title,
      control: controlScore,
      treatment_arm: scoreContract.treatment_arm,
      treatment_title: treatment.title,
      treatment: treatmentScore,
      delta_f1: delta,
      control_over_80: control.title.length > 80,
      treatment_over_80: treatment.title.length > 80
    });
  }
  const signTest = exactSignTest(deltas);
  const meanDelta = average(deltas);
  const mechanismSignal = meanDelta >= 0.02 && signTest.p <= 0.05
    && signTest.wins > signTest.losses
    && scored.every((row) => !row.control_over_80 && !row.treatment_over_80);
  return {
    schema_version: "luna-parity-blind-score-v1",
    authority: "evaluation_only",
    production_authorized: false,
    decision: mechanismSignal ? "MECHANISM_SIGNAL_HOLD_TYPED_GOLD" : "NO_MECHANISM_SIGNAL",
    score_contract_sha256: scoreContract.score_contract_sha256,
    execution_run_fingerprint: executionManifest.run_fingerprint,
    sealed_labels_opened_after_complete_validation: true,
    metric_scope: "writer_reviewed_title_token_proxy",
    typed_field_gold: false,
    cards: scored.length,
    control_arm: scoreContract.control_arm,
    treatment_arm: scoreContract.treatment_arm,
    control_mean_f1: average(scored.map((row) => row.control.f1)),
    treatment_mean_f1: average(scored.map((row) => row.treatment.f1)),
    paired_mean_delta_f1: meanDelta,
    sign_test: signTest,
    rows: scored
  };
}

export async function main(argv = process.argv.slice(2), {
  readLabelsImpl = readFile
} = {}) {
  const executionDirArg = arg(argv, "--execution-dir");
  const assetsPath = arg(argv, "--assets-manifest");
  const labelMapPath = arg(argv, "--label-map");
  const scoreContractPath = arg(argv, "--score-contract");
  const labelsPath = arg(argv, "--labels");
  const outDirArg = arg(argv, "--out-dir");
  if (!executionDirArg || !assetsPath || !labelMapPath || !scoreContractPath
      || !labelsPath || !outDirArg) {
    throw new Error("luna_parity_score_argument_missing");
  }
  const executionDir = resolve(executionDirArg);
  const outDir = resolve(outDirArg);
  const scorerPath = fileURLToPath(import.meta.url);
  const rawPath = resolve(executionDir, "raw-results.jsonl");
  const [executionManifest, receipt, rawBody, results, assetsManifest, labelMap,
    scoreContract, scorerBody] = await Promise.all([
    readJson(resolve(executionDir, "execution-manifest.json")),
    readJson(resolve(executionDir, "execution-receipt.json")),
    readFile(rawPath),
    readJsonLines(rawPath),
    readJson(assetsPath),
    readJson(labelMapPath),
    readJson(scoreContractPath),
    readFile(scorerPath)
  ]);
  const scored = await scoreLunaParityBlind({
    executionManifest,
    receipt,
    rawBody,
    results,
    assetsManifest,
    labelMap,
    scoreContract,
    scorerBody,
    readLabels: () => readLabelsImpl(resolve(labelsPath))
  });
  await mkdir(outDir, { recursive: true });
  await writeJsonAtomic(resolve(outDir, "scored-summary.json"), scored);
  await writeJsonAtomic(resolve(outDir, "score-manifest.json"), {
    schema_version: "luna-parity-score-manifest-v1",
    score_contract_sha256: scoreContract.score_contract_sha256,
    execution_run_fingerprint: executionManifest.run_fingerprint,
    raw_results_sha256: receipt.raw_results_sha256,
    sealed_labels_sha256: scoreContract.sealed_labels_sha256,
    scorer_sha256: scoreContract.scorer_sha256,
    scored_summary_sha256: sha256(JSON.stringify(scored))
  });
  process.stdout.write(`${JSON.stringify({
    decision: scored.decision,
    cards: scored.cards,
    paired_mean_delta_f1: scored.paired_mean_delta_f1,
    sign_test: scored.sign_test
  })}\n`);
  return scored;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
