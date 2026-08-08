#!/usr/bin/env node

// Execution core for the preregistered three-arm screen. Deliberately no
// provider, Storage, auth, or fetch import exists here: a separately reviewed
// adapter must inject `invoke`, and every completed row can be durably written
// by the injected `checkpoint` before the next paid job starts.

import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertScreenSchedule,
  assertThreeArmRequestIsolation,
  semanticRequestSha256
} from "../experiments/accuracy/model-residual-v3-screen-plan.mjs";

export async function runModelResidualV3Screen({
  schedule,
  assets,
  buildRequests,
  invoke = null,
  checkpointPath,
  runFingerprint = null,
  expectedRequestShaByArm = null
}) {
  assertScreenSchedule(schedule);
  if (typeof invoke !== "function") throw new Error("v3_execution_adapter_required");
  if (typeof buildRequests !== "function") throw new TypeError("v3_runner_adapter_invalid");
  if (!checkpointPath) throw new Error("v3_durable_checkpoint_path_required");
  const completedJobKeys = await readCompletedJobKeys(checkpointPath, {
    expectedFingerprint: runFingerprint, expectedRequestShaByArm
  });
  const assetMap = new Map(assets.map((asset) => [asset.asset_id, asset]));
  if (assetMap.size !== 35) throw new Error("v3_runner_requires_35_unique_assets");
  const results = [];
  for (const card of schedule) {
    if (card.order.every((arm) => completedJobKeys.has(`${card.asset_id}:${arm}`))) continue;
    const asset = assetMap.get(card.asset_id);
    if (!asset || asset.image_set_sha256 !== card.image_set_sha256) {
      throw new Error(`v3_runner_asset_mismatch:${card.asset_id}`);
    }
    const requests = await buildRequests(asset);
    const isolation = assertThreeArmRequestIsolation({
      controlA: requests.control_a,
      controlB: requests.control_b,
      residualC: requests.residual_c
    });
    const actualByArm = { control_a: isolation.control_request_sha256,
      control_b: isolation.control_request_sha256, residual_c: isolation.residual_request_sha256 };
    if (expectedRequestShaByArm
      && Object.keys(actualByArm).some((arm) => actualByArm[arm] !== expectedRequestShaByArm[arm])) {
      throw new Error(`v3_request_not_preregistered:${card.asset_id}`);
    }
    for (const arm of card.order) {
      const jobKey = `${card.asset_id}:${arm}`;
      if (completedJobKeys.has(jobKey)) continue;
      const result = await invoke({
        job_key: jobKey,
        asset_id: card.asset_id,
        image_set_sha256: card.image_set_sha256,
        arm,
        max_attempts: 1,
        request: structuredClone(requests[arm])
      });
      const attemptCount = result?.request_attempt_count ?? result?.attempt_count;
      if (attemptCount !== 1) throw new Error(`v3_runner_attempt_contract_violated:${jobKey}`);
      const row = { job_key: jobKey, asset_id: card.asset_id,
        image_set_sha256: card.image_set_sha256, arm, max_attempts: 1,
        run_fingerprint: runFingerprint, request_sha256: semanticRequestSha256(requests[arm]), result };
      await appendDurableCheckpoint(checkpointPath, row);
      completedJobKeys.add(jobKey);
      results.push(row);
    }
  }
  return { new_jobs_completed: results.length, total_jobs_complete: completedJobKeys.size, results };
}

export async function readCompletedJobKeys(path, {
  expectedFingerprint = null, expectedRequestShaByArm = null
} = {}) {
  let body = "";
  try { body = await readFile(path, "utf8"); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const keys = new Set();
  for (const [index, line] of body.split("\n").filter(Boolean).entries()) {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`v3_checkpoint_invalid_json:${index + 1}`); }
    if (!row?.job_key || keys.has(row.job_key)) throw new Error(`v3_checkpoint_duplicate_or_missing_key:${index + 1}`);
    if (expectedFingerprint && row.run_fingerprint !== expectedFingerprint) {
      throw new Error(`v3_checkpoint_fingerprint_mismatch:${index + 1}`);
    }
    if (expectedRequestShaByArm && row.request_sha256 !== expectedRequestShaByArm[row.arm]) {
      throw new Error(`v3_checkpoint_request_sha_mismatch:${index + 1}`);
    }
    keys.add(row.job_key);
  }
  if (keys.size > 105) throw new Error("v3_checkpoint_hard_cap_exceeded");
  return keys;
}

export async function appendDurableCheckpoint(path, row) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(row)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write("Refusing to call a provider: inject a reviewed execution adapter.\n");
  process.exitCode = 2;
}
