#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARM_SPECS } from "./run-thin-path-eval.mjs";
import prereg from "../experiments/accuracy/model-residual-compact-v4-cloud-prereg.json" with { type: "json" };
import {
  MODEL_RESIDUAL_COMPACT_V4_SCHEMA_SHA256,
  assertCompactV4BudgetSchedule,
  assertCompactV4RequestIsolation,
  balancedCompactV4BudgetSchedule,
  binomialTailProbability,
  minimumTrialsForBinomialPower,
  semanticCompactV4RequestSha256,
  withModelResidualCompactV4
} from "../experiments/accuracy/model-residual-compact-v4-cloud-plan.mjs";
import {
  readCompactV4Checkpoint,
  runModelResidualCompactV4PreviewGate
} from "./run-model-residual-compact-v4-preview-gate.mjs";
import {
  evaluateModelResidualCompactV4PreviewGate,
  exactTwoSidedSignP
} from "../experiments/accuracy/model-residual-compact-v4-preview-gate.mjs";

const STORAGE = "irpgnhkslrsiucybkufc.supabase.co";
const controlRequest = (asset) => ARM_SPECS.thin_canonical_high_effort_low.buildRequest({
  imageUrls: asset.image_urls,
  model: "gpt-5.6-luna",
  effort: "low",
  imageDetail: "high"
});

assert.equal(MODEL_RESIDUAL_COMPACT_V4_SCHEMA_SHA256,
  "2ec797216b90df9c8d4ab634325f6a1dee4959cc58f4064dca4c5f7b4e5b628b");
assert.ok(Math.abs(binomialTailProbability(70, 6, 4 / 35)
  - 0.8252286319156475) < 1e-12);
assert.ok(Math.abs(binomialTailProbability(70, 8, 4 / 35)
  - 0.5555774689704569) < 1e-12);
assert.equal(minimumTrialsForBinomialPower({ threshold: 6, probability: 4 / 35, power: 0.8 }), 68);
assert.equal(minimumTrialsForBinomialPower({ threshold: 8, probability: 4 / 35, power: 0.8 }), 88);
const control = controlRequest({ image_urls: [`https://${STORAGE}/one`] });
const treatment = withModelResidualCompactV4(control);
const isolation = assertCompactV4RequestIsolation({ control, treatment });
assert.equal(isolation.control_request_sha256,
  prereg.frozen_contract.provider.request_contracts_by_image_count["1"].control_request_sha256);
assert.equal(isolation.treatment_request_sha256,
  prereg.frozen_contract.provider.request_contracts_by_image_count["1"].treatment_request_sha256);
assert.throws(() => assertCompactV4RequestIsolation({ control, treatment: {
  ...treatment, max_output_tokens: 7
} }), /changed_outside_response_schema/);

const cohort = prereg.confirmatory_70.schedule.flatMap((block) => [block.paired_asset_id,
  block.unpaired_asset_id]);
assert.equal(new Set(cohort).size, 70);
assert.deepEqual(balancedCompactV4BudgetSchedule(
  JSON.parse(await readFile(prereg.confirmatory_70.asset_ids_path, "utf8"))
), prereg.confirmatory_70.schedule);
const scheduleEvidence = assertCompactV4BudgetSchedule(prereg.confirmatory_70.schedule);
assert.deepEqual({ treatment: scheduleEvidence.treatment_cards,
  control: scheduleEvidence.paired_control_cards, jobs: scheduleEvidence.jobs },
{ treatment: 70, control: 35, jobs: 105 });

const assets = [...new Set(cohort)].map((assetId, index) => ({
  asset_id: assetId,
  image_urls: Array.from({ length: index % 2 + 1 }, (_, imageIndex) =>
    `https://${STORAGE}/storage/v1/object/sign/test/${assetId}-${imageIndex}`)
}));
const assetById = new Map(assets.map((asset) => [asset.asset_id, asset]));
const pairedIds = prereg.confirmatory_70.schedule.map((block) => block.paired_asset_id);
const treatmentRows = prereg.confirmatory_70.asset_ids.map((assetId, index) => {
  const imageCount = assetById.get(assetId).image_urls.length;
  return {
    asset_id: assetId,
    image_count: imageCount,
    environment: "preview",
    region: "sin1",
    request_attempt_count: 1,
    provider_retries: 0,
    request_sha256: prereg.frozen_contract.provider.request_contracts_by_image_count
      [String(imageCount)].treatment_request_sha256,
    canonical_f1: 0.7,
    resolved_f1: index < 6 ? 0.74 : 0.7,
    latency_ms: 110,
    total_tokens: 105,
    output_tokens: 115,
    critical_error: false,
    reference_loss: false,
    unbacked_new_token: false,
    unsupported_numeric_change: false,
    invalid_compact_value: false,
    ambiguous_route_applied: false,
    title_over_80: false,
    canonical_shape_defect: false,
    resolved_field_regression: false,
    canonical_critical_field_regression: false
  };
});
const controlRows = pairedIds.map((assetId) => {
  const imageCount = assetById.get(assetId).image_urls.length;
  return {
    asset_id: assetId,
    image_count: imageCount,
    environment: "preview",
    region: "sin1",
    request_attempt_count: 1,
    provider_retries: 0,
    request_sha256: prereg.frozen_contract.provider.request_contracts_by_image_count
      [String(imageCount)].control_request_sha256,
    canonical_f1: 0.7,
    latency_ms: 100,
    total_tokens: 100,
    output_tokens: 100,
    canonical_shape_defect: false,
    canonical_critical_field_regression: false
  };
});
assert.equal(exactTwoSidedSignP(6, 0), 0.03125);
const passedGate = evaluateModelResidualCompactV4PreviewGate({ prereg, treatmentRows, controlRows });
assert.equal(passedGate.decision, "PASS_FOR_FRESH150_BUNDLE_ONLY");
assert.equal(passedGate.production_authorized, false);
const heldRows = structuredClone(treatmentRows);
heldRows[5].resolved_f1 = heldRows[5].canonical_f1;
assert.equal(evaluateModelResidualCompactV4PreviewGate({ prereg,
  treatmentRows: heldRows, controlRows }).decision, "HOLD_INCONCLUSIVE_OR_UNECONOMIC");
const stoppedRows = structuredClone(treatmentRows);
stoppedRows[10].resolved_field_regression = true;
assert.equal(evaluateModelResidualCompactV4PreviewGate({ prereg,
  treatmentRows: stoppedRows, controlRows }).decision, "STOP_HARD_REGRESSION");
const missingSafetyRows = structuredClone(treatmentRows);
delete missingSafetyRows[0].critical_error;
assert.throws(() => evaluateModelResidualCompactV4PreviewGate({ prereg,
  treatmentRows: missingSafetyRows, controlRows }), /row_contract_invalid/);
const authorization = {
  schema_version: "model-residual-compact-v4-cloud-authorization-v1",
  run_fingerprint: prereg.run_fingerprint,
  environment: "preview",
  region: "sin1",
  concurrency: 1,
  max_provider_attempts: 105,
  zero_call_title_fidelity: "35/35",
  zero_call_field_fidelity: "35/35"
};
const authorized = structuredClone(prereg);
authorized.status = "AUTHORIZED_FOR_ONE_RUN";
authorized.execution_authorized = true;
authorized.stages.zero_call_precondition.status = "PASS";
authorized.stages.zero_call_precondition.exact_field_fidelity_vs_wide_v3 = "35/35";

const temp = await mkdtemp(join(tmpdir(), "lynca-compact-v4-cloud-"));
try {
  await assert.rejects(runModelResidualCompactV4PreviewGate({
    prereg, authorization, assets, buildControlRequest: controlRequest,
    invoke: async () => { throw new Error("must_not_call"); },
    checkpointPath: join(temp, "blocked.jsonl")
  }), /prereg_not_authorized/);
  await assert.rejects(runModelResidualCompactV4PreviewGate({
    prereg: authorized, authorization, assets, buildControlRequest: controlRequest,
    checkpointPath: join(temp, "no-adapter.jsonl")
  }), /preview_adapter_required/);

  let active = 0;
  let maximumActive = 0;
  const calls = [];
  const checkpointPath = join(temp, "complete.jsonl");
  const result = await runModelResidualCompactV4PreviewGate({
    prereg: authorized,
    authorization,
    assets,
    buildControlRequest: controlRequest,
    checkpointPath,
    invoke: async (job) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      calls.push(job);
      active -= 1;
      return {
        ok: true,
        environment: job.environment,
        region: job.region,
        request_attempt_count: 1,
        provider_retries: 0,
        provider_calls: 1,
        request_sha256: semanticCompactV4RequestSha256(job.request),
        structured_output: { residual_printed_phrase: null }
      };
    }
  });
  assert.equal(result.total_jobs_complete, 105);
  assert.equal(result.new_jobs_completed, 105);
  assert.equal(result.provider_calls, 105);
  assert.equal(maximumActive, 1);
  assert.equal(calls.length, 105);
  assert.equal(calls.filter((row) => row.arm === "treatment").length, 70);
  assert.equal(calls.filter((row) => row.arm === "control").length, 35);
  assert.equal(calls.every((row) => row.environment === "preview" && row.region === "sin1"
    && row.concurrency === 1 && row.max_attempts === 1), true);
  assert.equal((await readFile(checkpointPath, "utf8")).trim().split("\n").length, 210);

  const resumed = await runModelResidualCompactV4PreviewGate({
    prereg: authorized,
    authorization,
    assets,
    buildControlRequest: controlRequest,
    checkpointPath,
    invoke: async () => { throw new Error("completed_job_repeated"); }
  });
  assert.equal(resumed.new_jobs_completed, 0);
  assert.equal(resumed.total_jobs_complete, 105);

  const lockedPath = join(temp, "locked.jsonl");
  await writeFile(`${lockedPath}.lock`, "occupied\n");
  await assert.rejects(runModelResidualCompactV4PreviewGate({
    prereg: authorized, authorization, assets, buildControlRequest: controlRequest,
    checkpointPath: lockedPath, invoke: async () => ({})
  }), /out_dir_locked/);

  const failedPath = join(temp, "failed.jsonl");
  await assert.rejects(runModelResidualCompactV4PreviewGate({
    prereg: authorized, authorization, assets, buildControlRequest: controlRequest,
    checkpointPath: failedPath,
    invoke: async (job) => ({ ok: true, environment: "preview", region: "sin1",
      request_attempt_count: 2, provider_retries: 1, provider_calls: 2,
      request_sha256: semanticCompactV4RequestSha256(job.request) })
  }), /result_contract_violated/);
  await assert.rejects(readCompactV4Checkpoint(failedPath, {
    runFingerprint: authorized.run_fingerprint,
    expectedRequestShaByImageCount: Object.fromEntries(Object.entries(
      authorized.frozen_contract.provider.request_contracts_by_image_count
    ).map(([count, contract]) => [count, { control: contract.control_request_sha256,
      treatment: contract.treatment_request_sha256 }]))
  }), /attempt_contract_mismatch|terminal_failure_requires_reconciliation/);

  const attemptedOnlyPath = join(temp, "attempted-only.jsonl");
  const firstAsset = assetById.get(prereg.confirmatory_70.schedule[0].paired_asset_id);
  const firstRequest = controlRequest(firstAsset);
  await (await import("./run-model-residual-compact-v4-preview-gate.mjs"))
    .appendCompactV4Checkpoint(attemptedOnlyPath, {
      schema_version: "model-residual-compact-v4-preview-checkpoint-row-v1",
      state: "ATTEMPTED",
      run_fingerprint: prereg.run_fingerprint,
      job_key: `${firstAsset.asset_id}:control`,
      asset_id: firstAsset.asset_id,
      arm: "control",
      image_count: firstAsset.image_urls.length,
      request_sha256: semanticCompactV4RequestSha256(firstRequest),
      request_attempt_count: 1,
      provider_retries: 0
    });
  let reinvokes = 0;
  await assert.rejects(runModelResidualCompactV4PreviewGate({
    prereg: authorized, authorization, assets, buildControlRequest: controlRequest,
    checkpointPath: attemptedOnlyPath, invoke: async () => { reinvokes += 1; }
  }), /terminal_failure_requires_reconciliation/);
  assert.equal(reinvokes, 0);
} finally {
  await rm(temp, { recursive: true, force: true });
}

process.stdout.write("model residual compact v4 cloud gate: ok (0 network, 0 provider calls)\n");
