import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireCheckpointLock } from "./cloud-io.mjs";
import {
  runCloudPairedAccuracy
} from "./run-cloud-paired-accuracy.mjs";
import {
  requestForAsset,
  requestIdentity
} from "./request-contract.mjs";

const now = 1_800_000_000_000;
const deployment = "https://cloud-preview.example.vercel.app";
const storageHost = "irpgnhkslrsiucybkufc.supabase.co";
const directory = await mkdtemp(join(tmpdir(), "lynca-cloud-pair-test-"));
const controlPath = join(directory, "control.json");
const treatmentPath = join(directory, "treatment.json");

function template({ treatment = false } = {}) {
  return {
    model: "gpt-5.6-luna",
    max_output_tokens: 4096,
    reasoning: { effort: "none" },
    input: [{
      role: "user",
      content: [{ type: "input_text", text: treatment ? "treatment-longer" : "control" }]
    }],
    text: {
      format: {
        type: "json_schema",
        name: treatment ? "canonical_card_fields_residual_v1" : "canonical_card_fields",
        strict: true,
        schema: treatment
          ? {
              type: "object",
              additionalProperties: false,
              required: ["year", "residual_evidence"],
              properties: {
                year: { type: "string" },
                residual_evidence: { type: "array", items: {} }
              }
            }
          : {
              type: "object",
              additionalProperties: false,
              required: ["year"],
              properties: { year: { type: "string" } }
            }
      }
    }
  };
}

function jwt(exp) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp })}.signature`;
}

const token = jwt(Math.floor((now + 60 * 60 * 1000) / 1000));
const assets = Array.from({ length: 5 }, (_, index) => ({
  asset_id: `asset-${index + 1}`,
  image_set_sha256: String(index + 1).repeat(64),
  image_urls: (index === 0 ? [
    `https://${storageHost}/storage/v1/object/sign/b/${index}-front?token=${token}`
  ] : [
    `https://${storageHost}/storage/v1/object/sign/b/${index}-front?token=${token}`,
    `https://${storageHost}/storage/v1/object/sign/b/${index}-back?token=${token}`
  ])
}));
const control = {
  arm_id: "canonical_high",
  request_template: template(),
  assets
};
const treatment = {
  arm_id: "canonical_residual_v1_high",
  request_template: template({ treatment: true }),
  assets
};
await Promise.all([
  writeFile(controlPath, JSON.stringify(control)),
  writeFile(treatmentPath, JSON.stringify(treatment))
]);

function frozenContract(value) {
  const identity = requestIdentity(requestForAsset(value, [
    "https://contract.invalid/front",
    "https://contract.invalid/back"
  ]));
  return {
    normalized_request_sha256: identity.normalized_request_sha256,
    normalized_request_bytes: identity.normalized_request_bytes,
    contract_wire_sha256: identity.wire_sha256,
    contract_wire_bytes: identity.wire_bytes
  };
}

const preregisteredContract = {
  control: frozenContract(control.request_template),
  treatment: frozenContract(treatment.request_template),
  normalized_request_delta_bytes: (
    frozenContract(treatment.request_template).normalized_request_bytes
      - frozenContract(control.request_template).normalized_request_bytes
  ),
  contract_wire_delta_bytes: (
    frozenContract(treatment.request_template).contract_wire_bytes
      - frozenContract(control.request_template).contract_wire_bytes
  ),
  cards: assets.length,
  paired_provider_calls: assets.length * 2
};

function cloudReport(body, { dryRun, ok = true, responseId = "response-1" } = {}) {
  const role = body.arm_id === "canonical_high" ? "control" : "treatment";
  const contract = preregisteredContract[role];
  const asset = body.assets[0];
  const wire = requestIdentity(requestForAsset(body.request_template, asset.image_urls));
  const base = {
    ok,
    schema_version: "lynca-cloud-accuracy-arm-v1",
    evidence_scope: dryRun
      ? "DRY_RUN_NO_PROVIDER_CALL"
      : "VERCEL_SIN1_TO_OPENAI_CANONICAL_VISION_RAW_CHECKPOINT",
    provider_calls: dryRun ? 0 : 1,
    provider_retries: 0,
    run_id: body.run_id,
    arm_id: body.arm_id,
    model: "gpt-5.6-luna",
    reasoning_effort: "none",
    image_detail: "high",
    tasks: 1,
    concurrency: 1,
    storage_host: storageHost,
    environment: "preview",
    region: "sin1",
    deployment_hostname: "cloud-preview.example.vercel.app",
    contract_normalized_request_sha256: contract.normalized_request_sha256,
    contract_normalized_request_bytes: contract.normalized_request_bytes,
    contract_wire_sha256: contract.contract_wire_sha256,
    contract_wire_bytes: contract.contract_wire_bytes
  };
  if (dryRun) return base;
  return {
    ...base,
    succeeded_count: ok ? 1 : 0,
    failed_count: ok ? 0 : 1,
    rows: [{
      ok,
      asset_id: asset.asset_id,
      image_set_sha256: asset.image_set_sha256,
      normalized_request_sha256: wire.normalized_request_sha256,
      normalized_request_bytes: wire.normalized_request_bytes,
      request_wire_sha256: wire.wire_sha256,
      request_wire_bytes: wire.wire_bytes,
      provider_response_id: ok ? responseId : null,
      provider_response_raw: ok ? "{\"ok\":true}" : "{\"error\":\"known\"}",
      provider_status: ok ? "completed" : "failed",
      incomplete_details: null,
      served_model: ok ? "gpt-5.6-luna" : null,
      served_effort: ok ? "none" : null,
      served_effort_attested: ok,
      structured_output: ok ? { year: "2024" } : null,
      structured_output_error: ok ? null : "provider_error"
    }]
  };
}

async function preflight(path, concurrency) {
  const calls = [];
  const result = await runCloudPairedAccuracy({
    controlPayloadPath: controlPath,
    treatmentPayloadPath: treatmentPath,
    deployment,
    outPath: path,
    runId: "paired-test-run",
    concurrency,
    dryRun: true,
    runToken: "token",
    preregisteredContract,
    nowMs: () => now,
    invoke: async ({ body }) => {
      calls.push(body);
      return cloudReport(body, { dryRun: true });
    }
  });
  assert.equal(calls.length, 2, "preflight must prove both arms without 210 redundant calls");
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.validated_asset_count, assets.length);
  assert.equal(result.provider_calls, 0);
  assert.equal(result.preregistered_contract_verified, true);
  return result;
}

const dryPath = join(directory, "dry.json");
await preflight(dryPath, 3);

const paidPath = join(directory, "paid.json");
let paidCalls = 0;
const paid = await runCloudPairedAccuracy({
  controlPayloadPath: controlPath,
  treatmentPayloadPath: treatmentPath,
  deployment,
  outPath: paidPath,
  preflightPath: dryPath,
  runId: "paired-test-run",
  concurrency: 3,
  dryRun: false,
  runToken: "token",
  preregisteredContract,
  nowMs: () => now + paidCalls,
  invoke: async ({ body }) => {
    const callNumber = ++paidCalls;
    const assetNumber = Number(body.assets[0].asset_id.split("-")[1]);
    await new Promise((resolve) => setTimeout(resolve, (6 - assetNumber) % 3));
    return cloudReport(body, { dryRun: false, responseId: `response-${callNumber}` });
  }
});
assert.equal(paid.state, "COMPLETE");
assert.equal(paid.completed_pairs, assets.length);
assert.equal(paid.provider_calls, assets.length * 2);
assert.equal(paidCalls, assets.length * 2);
assert.equal(paid.pairs.filter((pair) => pair.order[0] === "control").length, 3);
assert.equal(paid.pairs.filter((pair) => pair.order[0] === "treatment").length, 2);
assert.ok(paid.pairs.every((pair) => (
  pair.arms.control.state === "COMPLETE" && pair.arms.treatment.state === "COMPLETE"
)));

const resumed = await runCloudPairedAccuracy({
  controlPayloadPath: controlPath,
  treatmentPayloadPath: treatmentPath,
  deployment,
  outPath: paidPath,
  preflightPath: dryPath,
  runId: "paired-test-run",
  concurrency: 3,
  dryRun: false,
  runToken: "token",
  preregisteredContract,
  nowMs: () => now,
  invoke: async () => { throw new Error("completed checkpoint must not call"); }
});
assert.equal(resumed.state, "COMPLETE");

const failedDryPath = join(directory, "failed-dry.json");
await preflight(failedDryPath, 1);
const failedPath = join(directory, "failed.json");
let failedCalls = 0;
await assert.rejects(() => runCloudPairedAccuracy({
  controlPayloadPath: controlPath,
  treatmentPayloadPath: treatmentPath,
  deployment,
  outPath: failedPath,
  preflightPath: failedDryPath,
  runId: "paired-test-run",
  concurrency: 1,
  dryRun: false,
  runToken: "token",
  preregisteredContract,
  nowMs: () => now,
  invoke: async ({ body }) => {
    failedCalls += 1;
    return cloudReport(body, { dryRun: false, ok: false });
  }
}), /cloud_pair_contains_failed_provider_row/);
assert.equal(failedCalls, 1, "known provider failure must stop the other arm and every later card");
const failed = JSON.parse(await readFile(failedPath, "utf8"));
assert.equal(failed.state, "STOPPED_FAILED");
assert.match(JSON.stringify(failed), /known/);

const ambiguousPath = join(directory, "ambiguous.json");
const ambiguous = structuredClone(paid);
ambiguous.state = "RUNNING";
ambiguous.pairs[0].arms.control.state = "IN_FLIGHT";
await writeFile(ambiguousPath, JSON.stringify(ambiguous));
await assert.rejects(() => runCloudPairedAccuracy({
  controlPayloadPath: controlPath,
  treatmentPayloadPath: treatmentPath,
  deployment,
  outPath: ambiguousPath,
  preflightPath: dryPath,
  runId: "paired-test-run",
  concurrency: 3,
  dryRun: false,
  runToken: "token",
  preregisteredContract,
  nowMs: () => now,
  invoke: async () => { throw new Error("must not call ambiguous checkpoint"); }
}), /paired_checkpoint_has_ambiguous_inflight_arm/);

const lockPath = join(directory, "lock-proof.json");
const release = await acquireCheckpointLock(lockPath);
await assert.rejects(() => acquireCheckpointLock(lockPath), /cloud_checkpoint_lock_exists/);
await release();

const transportSource = await readFile(new URL("./cloud-io.mjs", import.meta.url), "utf8");
assert.match(transportSource, /`@\$\{headerPath\}`/);
assert.match(transportSource, /delete childEnvironment\.LYNCA_CLOUD_SIM_RUN_TOKEN/);
assert.match(transportSource, /rm\(secretDirectory, \{ recursive: true, force: true \}\)/);
assert.doesNotMatch(transportSource, /`x-lynca-cloud-sim-token: \$\{runToken\}`[\s\S]{0,300}spawn\("vercel"/);

process.stdout.write("cloud paired accuracy tests passed\n");
