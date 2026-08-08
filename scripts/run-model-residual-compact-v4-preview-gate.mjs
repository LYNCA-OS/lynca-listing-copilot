#!/usr/bin/env node

// Zero-network execution core. A separately reviewed Preview adapter must be
// injected. Direct CLI execution always refuses to make a provider request.

import { open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  MODEL_RESIDUAL_COMPACT_V4_CONCURRENCY,
  MODEL_RESIDUAL_COMPACT_V4_MAX_ATTEMPTS_PER_JOB,
  MODEL_RESIDUAL_COMPACT_V4_REGION,
  assertCompactV4BudgetSchedule,
  assertCompactV4RequestIsolation,
  semanticCompactV4RequestSha256,
  withModelResidualCompactV4
} from "../experiments/accuracy/model-residual-compact-v4-cloud-plan.mjs";

const EXPECTED_STORAGE_HOST = "irpgnhkslrsiucybkufc.supabase.co";
const AUTHORIZATION_KEYS = Object.freeze([
  "schema_version",
  "run_fingerprint",
  "environment",
  "region",
  "concurrency",
  "max_provider_attempts",
  "zero_call_title_fidelity",
  "zero_call_field_fidelity"
]);

function exactKeys(value, keys) {
  return value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function assertAuthorization(prereg, authorization) {
  if (prereg?.schema_version !== "model-residual-compact-v4-cloud-prereg-v1"
      || prereg?.status !== "AUTHORIZED_FOR_ONE_RUN"
      || prereg?.execution_authorized !== true) {
    throw new Error("compact_v4_prereg_not_authorized");
  }
  if (!exactKeys(authorization, AUTHORIZATION_KEYS)
      || authorization.schema_version !== "model-residual-compact-v4-cloud-authorization-v1"
      || authorization.run_fingerprint !== prereg.run_fingerprint
      || authorization.environment !== "preview"
      || authorization.region !== MODEL_RESIDUAL_COMPACT_V4_REGION
      || authorization.concurrency !== MODEL_RESIDUAL_COMPACT_V4_CONCURRENCY
      || authorization.max_provider_attempts !== 105
      || authorization.zero_call_title_fidelity !== "35/35"
      || authorization.zero_call_field_fidelity !== "35/35") {
    throw new Error("compact_v4_independent_authorization_required");
  }
}

function assertAsset(asset, expectedId) {
  if (asset?.asset_id !== expectedId || !Array.isArray(asset.image_urls)
      || asset.image_urls.length < 1 || asset.image_urls.length > 2) {
    throw new Error(`compact_v4_asset_invalid:${expectedId}`);
  }
  for (const value of asset.image_urls) {
    let url;
    try { url = new URL(value); } catch { throw new Error(`compact_v4_asset_url_invalid:${expectedId}`); }
    if (url.protocol !== "https:" || url.hostname !== EXPECTED_STORAGE_HOST) {
      throw new Error(`compact_v4_asset_storage_not_singapore:${expectedId}`);
    }
  }
}

function jobsFromSchedule(schedule) {
  const jobs = [];
  for (const block of schedule) {
    const bySlot = {
      paired_control: { asset_id: block.paired_asset_id, arm: "control" },
      paired_treatment: { asset_id: block.paired_asset_id, arm: "treatment" },
      unpaired_treatment: { asset_id: block.unpaired_asset_id, arm: "treatment" }
    };
    for (const slot of block.order) jobs.push({ ...bySlot[slot], slot,
      block_index: block.block_index });
  }
  return jobs;
}

async function acquireRunLock(path) {
  let handle;
  try { handle = await open(path, "wx", 0o600); } catch (error) {
    if (error?.code === "EEXIST") throw new Error("compact_v4_out_dir_locked");
    throw error;
  }
  await handle.write(`${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
  await handle.sync();
  return handle;
}

async function releaseRunLock(path, handle) {
  await handle.close();
  const { unlink } = await import("node:fs/promises");
  await unlink(path);
}

export async function appendCompactV4Checkpoint(path, row) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(row)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readCompactV4Checkpoint(path, {
  runFingerprint,
  expectedRequestShaByImageCount
} = {}) {
  let body = "";
  try { body = await readFile(path, "utf8"); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const rows = [];
  const states = new Map();
  let attempts = 0;
  for (const [index, line] of body.split("\n").filter(Boolean).entries()) {
    let row;
    try { row = JSON.parse(line); } catch {
      throw new Error(`compact_v4_checkpoint_invalid_json:${index + 1}`);
    }
    if (!row?.job_key) throw new Error(`compact_v4_checkpoint_job_key_missing:${index + 1}`);
    if (row.run_fingerprint !== runFingerprint) {
      throw new Error(`compact_v4_checkpoint_fingerprint_mismatch:${index + 1}`);
    }
    const expected = expectedRequestShaByImageCount?.[String(row.image_count)]?.[row.arm];
    if (!expected || row.request_sha256 !== expected) {
      throw new Error(`compact_v4_checkpoint_request_hash_mismatch:${index + 1}`);
    }
    if (row.request_attempt_count !== 1 || row.provider_retries !== 0) {
      throw new Error(`compact_v4_checkpoint_attempt_contract_mismatch:${index + 1}`);
    }
    const prior = states.get(row.job_key);
    if (row.state === "ATTEMPTED") {
      if (prior) throw new Error(`compact_v4_checkpoint_duplicate_attempt:${index + 1}`);
      states.set(row.job_key, "ATTEMPTED");
      attempts += 1;
    } else if (["COMPLETE", "AMBIGUOUS_STOP", "CONTRACT_VIOLATION"].includes(row.state)) {
      if (prior !== "ATTEMPTED") {
        throw new Error(`compact_v4_checkpoint_result_without_attempt:${index + 1}`);
      }
      states.set(row.job_key, row.state);
    } else {
      throw new Error(`compact_v4_checkpoint_state_invalid:${index + 1}`);
    }
    rows.push(row);
  }
  if (attempts > 105) throw new Error("compact_v4_checkpoint_attempt_cap_exceeded");
  const terminal = [...states].find(([, state]) => state !== "COMPLETE");
  if (terminal) {
    throw new Error(`compact_v4_checkpoint_terminal_failure_requires_reconciliation:${terminal[0]}`);
  }
  return { rows, attemptedJobs: attempts,
    completedJobKeys: new Set([...states].filter(([, state]) => state === "COMPLETE")
      .map(([jobKey]) => jobKey)) };
}

export async function runModelResidualCompactV4PreviewGate({
  prereg,
  authorization,
  assets,
  buildControlRequest,
  invoke = null,
  checkpointPath,
  lockPath = `${checkpointPath}.lock`
}) {
  assertAuthorization(prereg, authorization);
  if (typeof invoke !== "function") throw new Error("compact_v4_preview_adapter_required");
  if (typeof buildControlRequest !== "function") {
    throw new TypeError("compact_v4_request_builder_required");
  }
  if (!checkpointPath) throw new Error("compact_v4_checkpoint_path_required");
  const schedule = prereg.confirmatory_70?.schedule;
  assertCompactV4BudgetSchedule(schedule);
  const expectedRequestShaByImageCount = Object.fromEntries(Object.entries(
    prereg.frozen_contract.provider.request_contracts_by_image_count
  ).map(([imageCount, contract]) => [imageCount, {
    control: contract.control_request_sha256,
    treatment: contract.treatment_request_sha256
  }]));
  const assetMap = new Map((assets || []).map((asset) => [asset.asset_id, asset]));
  if (assetMap.size !== 70) throw new Error("compact_v4_runner_requires_70_unique_assets");
  for (const assetId of prereg.confirmatory_70.asset_ids || []) assertAsset(assetMap.get(assetId), assetId);
  // A prereg generated before `asset_ids` was embedded may still be used only
  // when the schedule proves the exact same 70-card membership.
  const scheduleIds = new Set(schedule.flatMap((block) => [block.paired_asset_id,
    block.unpaired_asset_id]));
  if (scheduleIds.size !== 70 || [...scheduleIds].some((assetId) => !assetMap.has(assetId))) {
    throw new Error("compact_v4_asset_schedule_membership_mismatch");
  }

  const lockHandle = await acquireRunLock(lockPath);
  try {
    const checkpoint = await readCompactV4Checkpoint(checkpointPath, {
      runFingerprint: prereg.run_fingerprint,
      expectedRequestShaByImageCount
    });
    const jobs = jobsFromSchedule(schedule);
    if (jobs.length !== 105 || checkpoint.attemptedJobs > authorization.max_provider_attempts) {
      throw new Error("compact_v4_attempt_cap_exceeded");
    }
    let newJobsCompleted = 0;
    for (const job of jobs) {
      const jobKey = `${job.asset_id}:${job.arm}`;
      if (checkpoint.completedJobKeys.has(jobKey)) continue;
      if (checkpoint.attemptedJobs + newJobsCompleted >= authorization.max_provider_attempts) {
        throw new Error("compact_v4_attempt_cap_exceeded");
      }
      const asset = assetMap.get(job.asset_id);
      assertAsset(asset, job.asset_id);
      const control = await buildControlRequest(structuredClone(asset));
      const treatment = withModelResidualCompactV4(control);
      const isolation = assertCompactV4RequestIsolation({ control, treatment });
      const request = job.arm === "control" ? control : treatment;
      const requestSha = semanticCompactV4RequestSha256(request);
      const expected = expectedRequestShaByImageCount[String(asset.image_urls.length)]?.[job.arm];
      if (requestSha !== expected
          || isolation[`${job.arm}_request_sha256`] !== expected) {
        throw new Error(`compact_v4_request_not_preregistered:${jobKey}`);
      }
      await appendCompactV4Checkpoint(checkpointPath, {
        schema_version: "model-residual-compact-v4-preview-checkpoint-row-v1",
        state: "ATTEMPTED",
        run_fingerprint: prereg.run_fingerprint,
        job_key: jobKey,
        block_index: job.block_index,
        slot: job.slot,
        asset_id: job.asset_id,
        arm: job.arm,
        image_count: asset.image_urls.length,
        request_sha256: requestSha,
        request_attempt_count: 1,
        provider_retries: 0
      });
      let result;
      try {
        result = await invoke({
          job_key: jobKey,
          block_index: job.block_index,
          slot: job.slot,
          asset_id: job.asset_id,
          arm: job.arm,
          environment: "preview",
          region: MODEL_RESIDUAL_COMPACT_V4_REGION,
          concurrency: MODEL_RESIDUAL_COMPACT_V4_CONCURRENCY,
          max_attempts: MODEL_RESIDUAL_COMPACT_V4_MAX_ATTEMPTS_PER_JOB,
          request: structuredClone(request)
        });
      } catch (error) {
        await appendCompactV4Checkpoint(checkpointPath, {
          schema_version: "model-residual-compact-v4-preview-checkpoint-row-v1",
          state: "AMBIGUOUS_STOP",
          run_fingerprint: prereg.run_fingerprint,
          job_key: jobKey,
          asset_id: job.asset_id,
          arm: job.arm,
          image_count: asset.image_urls.length,
          request_sha256: requestSha,
          request_attempt_count: 1,
          provider_retries: 0,
          error_code: String(error?.code || "INVOKE_THROWN").slice(0, 80)
        });
        throw new Error(`compact_v4_provider_ambiguous_stop:${jobKey}`);
      }
      if (result?.ok !== true || result?.environment !== "preview"
          || result?.region !== MODEL_RESIDUAL_COMPACT_V4_REGION
          || result?.request_attempt_count !== 1 || result?.provider_retries !== 0
          || result?.provider_calls !== 1 || result?.request_sha256 !== requestSha) {
        await appendCompactV4Checkpoint(checkpointPath, {
          schema_version: "model-residual-compact-v4-preview-checkpoint-row-v1",
          state: "CONTRACT_VIOLATION",
          run_fingerprint: prereg.run_fingerprint,
          job_key: jobKey,
          asset_id: job.asset_id,
          arm: job.arm,
          image_count: asset.image_urls.length,
          request_sha256: requestSha,
          request_attempt_count: Number(result?.request_attempt_count || 0),
          provider_retries: Number(result?.provider_retries || 0),
          error_code: "RESULT_CONTRACT_VIOLATION"
        });
        throw new Error(`compact_v4_result_contract_violated:${jobKey}`);
      }
      await appendCompactV4Checkpoint(checkpointPath, {
        schema_version: "model-residual-compact-v4-preview-checkpoint-row-v1",
        state: "COMPLETE",
        run_fingerprint: prereg.run_fingerprint,
        job_key: jobKey,
        block_index: job.block_index,
        slot: job.slot,
        asset_id: job.asset_id,
        arm: job.arm,
        image_count: asset.image_urls.length,
        request_sha256: requestSha,
        request_attempt_count: 1,
        provider_retries: 0,
        result
      });
      checkpoint.completedJobKeys.add(jobKey);
      newJobsCompleted += 1;
    }
    return {
      state: "COMPLETE",
      provider_calls: checkpoint.attemptedJobs + newJobsCompleted,
      provider_retries: 0,
      new_jobs_completed: newJobsCompleted,
      total_jobs_complete: checkpoint.completedJobKeys.size,
      region: MODEL_RESIDUAL_COMPACT_V4_REGION,
      concurrency: MODEL_RESIDUAL_COMPACT_V4_CONCURRENCY
    };
  } finally {
    await releaseRunLock(lockPath, lockHandle);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.stderr.write("Refusing to call a provider: inject a separately reviewed Preview adapter.\n");
  process.exitCode = 2;
}
