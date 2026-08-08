import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARM_SPECS } from "./run-thin-path-eval.mjs";
import { runModelResidualV3Screen } from "./run-model-residual-candidate-v3-35x3.mjs";
import { withModelResidualCandidateLaneV3 } from "../experiments/accuracy/model-residual-candidate-lane-v3.mjs";
import prereg from "../experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json" with { type: "json" };

const assets = prereg.cohort.map((row) => ({
  asset_id: row.asset_id,
  image_set_sha256: row.image_set_sha256,
  image_urls: ["https://contract.invalid/front", "https://contract.invalid/back"]
}));
const buildRequests = async (asset) => {
  const context = { imageUrls: asset.image_urls, model: "gpt-5.6-luna", effort: "low", imageDetail: "high" };
  const control = ARM_SPECS.thin_canonical_high_effort_low.buildRequest(context);
  return { control_a: control, control_b: structuredClone(control),
    residual_c: withModelResidualCandidateLaneV3(control, { enabled: true }) };
};

const temp = await mkdtemp(join(tmpdir(), "lynca-v3-runner-"));
const checkpointPath = join(temp, "screen.jsonl");

await assert.rejects(runModelResidualV3Screen({ schedule: prereg.cohort, assets, buildRequests,
  checkpointPath }),
  /execution_adapter_required/);

const calls = [];
const result = await runModelResidualV3Screen({
  schedule: prereg.cohort,
  assets,
  buildRequests,
  invoke: async (job) => { calls.push(job); return { output: job.job_key, attempt_count: 1 }; },
  checkpointPath
});
assert.equal(result.new_jobs_completed, 105);
assert.equal(result.total_jobs_complete, 105);
assert.equal(calls.length, 105);
assert.equal(calls.every((row) => row.max_attempts === 1), true);
assert.equal((await readFile(checkpointPath, "utf8")).trim().split("\n").length, 105);
assert.deepEqual(calls.slice(0, 3).map((row) => row.arm), prereg.cohort[0].order);

const resumed = await runModelResidualV3Screen({
  schedule: prereg.cohort,
  assets,
  buildRequests,
  invoke: async () => { throw new Error("completed job repeated"); },
  checkpointPath
});
assert.equal(resumed.new_jobs_completed, 0);
assert.equal(resumed.total_jobs_complete, 105);

const badCheckpoint = join(temp, "bad-attempt.jsonl");
await assert.rejects(runModelResidualV3Screen({
  schedule: prereg.cohort, assets, buildRequests, checkpointPath: badCheckpoint,
  invoke: async () => ({ attempt_count: 2 })
}), /attempt_contract_violated/);
await assert.rejects(readFile(badCheckpoint, "utf8"), /ENOENT/);
await rm(temp, { recursive: true, force: true });
console.log("model-residual-candidate-v3 35x3 zero-network runner tests passed");
