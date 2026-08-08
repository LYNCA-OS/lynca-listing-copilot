#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  acquireCheckpointLock,
  deploymentOrigin,
  durableJsonWriter,
  invokePreview,
  readJson,
  runTokenFromKeychain
} from "./cloud-io.mjs";
import {
  FROZEN_REQUEST_CONTRACTS,
  IMAGE_DETAIL,
  MODEL,
  REASONING_EFFORT,
  requestForAsset,
  requestIdentity,
  sha256
} from "./request-contract.mjs";

const CONTROL_ROLE = "control";
const TREATMENT_ROLE = "treatment";
const CONTROL_ARM = "canonical_high";
const TREATMENT_ARM = "canonical_residual_v1_high";
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_MIN_SIGNED_URL_TTL_MS = 30 * 60 * 1000;
const FROZEN_STORAGE_HOST = "irpgnhkslrsiucybkufc.supabase.co";

export const PAID105_PREREGISTERED_CONTRACT = Object.freeze({
  control: FROZEN_REQUEST_CONTRACTS[CONTROL_ARM],
  treatment: FROZEN_REQUEST_CONTRACTS[TREATMENT_ARM],
  normalized_request_delta_bytes: 1126,
  contract_wire_delta_bytes: 1126,
  cards: 105,
  paired_provider_calls: 210
});

function cliArguments(argv) {
  const booleans = new Set(["--dry-run"]);
  const allowed = new Set([
    "--control-payload",
    "--treatment-payload",
    "--deployment",
    "--out",
    "--preflight",
    "--concurrency",
    "--run-id",
    "--dry-run"
  ]);
  const values = {};
  for (let index = 0; index < argv.length;) {
    const name = argv[index];
    if (!allowed.has(name) || Object.hasOwn(values, name)) {
      throw new Error("unsupported_or_duplicate_option");
    }
    if (booleans.has(name)) {
      values[name] = true;
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("option_value_required");
    values[name] = value;
    index += 2;
  }
  return values;
}

function integer(value, fallback, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error("integer_option_invalid");
  }
  return parsed;
}

function contractIdentity(template) {
  return requestIdentity(requestForAsset(template, [
    "https://contract.invalid/front",
    "https://contract.invalid/back"
  ]));
}

function assertContract(actual, expected, label) {
  for (const field of [
    "normalized_request_sha256",
    "normalized_request_bytes",
    "contract_wire_sha256",
    "contract_wire_bytes"
  ]) {
    const actualField = field.startsWith("contract_") ? field.slice("contract_".length) : field;
    if (actual[actualField] !== expected[field]) {
      throw new Error(`${label}_request_contract_not_preregistered`);
    }
  }
}

function signedUrlExpiryMs(rawUrl) {
  const parsed = new URL(String(rawUrl || ""));
  const token = parsed.searchParams.get("token");
  const payload = token?.split(".")?.[1];
  if (!payload) throw new Error("signed_url_token_missing");
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("signed_url_token_invalid");
  }
  if (!Number.isInteger(claims?.exp) || claims.exp <= 0) {
    throw new Error("signed_url_expiry_missing");
  }
  return claims.exp * 1000;
}

function validateAssets(control, treatment, preregistered, nowMs, minimumTtlMs) {
  if (!Array.isArray(control.assets) || control.assets.length !== preregistered.cards) {
    throw new Error("control_payload_card_count_mismatch");
  }
  if (JSON.stringify(control.assets) !== JSON.stringify(treatment.assets)) {
    throw new Error("paired_asset_or_signed_url_mismatch");
  }
  const seen = new Set();
  const storageHosts = new Set();
  let earliestExpiryMs = Number.POSITIVE_INFINITY;
  for (const [index, asset] of control.assets.entries()) {
    if (!asset?.asset_id || seen.has(asset.asset_id)) {
      throw new Error(`paired_asset_id_invalid_at_${index + 1}`);
    }
    seen.add(asset.asset_id);
    if (!/^[0-9a-f]{64}$/.test(String(asset.image_set_sha256 || ""))) {
      throw new Error(`paired_image_set_sha256_invalid_at_${index + 1}`);
    }
    if (!Array.isArray(asset.image_urls)
        || asset.image_urls.length < 1 || asset.image_urls.length > 2) {
      throw new Error(`paired_image_count_invalid_at_${index + 1}`);
    }
    for (const imageUrl of asset.image_urls) {
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== "https:" || parsed.hostname !== FROZEN_STORAGE_HOST
          || !parsed.pathname.startsWith("/storage/v1/object/sign/")) {
        throw new Error(`paired_signed_url_invalid_at_${index + 1}`);
      }
      storageHosts.add(parsed.hostname);
      earliestExpiryMs = Math.min(earliestExpiryMs, signedUrlExpiryMs(imageUrl));
    }
  }
  if (storageHosts.size !== 1) throw new Error("paired_storage_host_not_unique");
  if (earliestExpiryMs - nowMs < minimumTtlMs) throw new Error("paired_signed_url_ttl_too_short");
  return {
    assets: control.assets,
    storageHost: [...storageHosts][0],
    earliestExpiryMs,
    minimumTtlMs
  };
}

function validateLocalContracts(control, treatment, preregistered) {
  if (control.arm_id !== CONTROL_ARM || treatment.arm_id !== TREATMENT_ARM) {
    throw new Error("paired_arm_ids_invalid");
  }
  const controlIdentity = contractIdentity(control.request_template);
  const treatmentIdentity = contractIdentity(treatment.request_template);
  assertContract(controlIdentity, preregistered.control, CONTROL_ROLE);
  assertContract(treatmentIdentity, preregistered.treatment, TREATMENT_ROLE);
  if (treatmentIdentity.normalized_request_bytes - controlIdentity.normalized_request_bytes
        !== preregistered.normalized_request_delta_bytes
      || treatmentIdentity.wire_bytes - controlIdentity.wire_bytes
        !== preregistered.contract_wire_delta_bytes) {
    throw new Error("paired_request_delta_not_preregistered");
  }
  return { control: controlIdentity, treatment: treatmentIdentity };
}

function pairIdentity({
  control,
  treatment,
  deployment,
  runId,
  concurrency,
  preregistered,
  assetsEvidence
}) {
  const contracts = validateLocalContracts(control, treatment, preregistered);
  const value = {
    schema_version: "lynca-cloud-paired-accuracy-contract-v2",
    deployment,
    deployment_hostname: new URL(deployment).hostname,
    run_id: runId,
    task_count: assetsEvidence.assets.length,
    concurrency,
    model: MODEL,
    reasoning_effort: REASONING_EFFORT,
    image_detail: IMAGE_DETAIL,
    storage_host: assetsEvidence.storageHost,
    minimum_signed_url_ttl_ms: assetsEvidence.minimumTtlMs,
    earliest_signed_url_expiry_ms: assetsEvidence.earliestExpiryMs,
    control_template_sha256: sha256(JSON.stringify(control.request_template)),
    treatment_template_sha256: sha256(JSON.stringify(treatment.request_template)),
    control_contract: contracts.control,
    treatment_contract: contracts.treatment,
    ordered_assets_sha256: sha256(JSON.stringify(assetsEvidence.assets.map((asset) => ({
      asset_id: asset.asset_id,
      image_set_sha256: asset.image_set_sha256
    })))),
    ordered_signed_urls_sha256: sha256(JSON.stringify(assetsEvidence.assets.map((asset) => (
      asset.image_urls.map((url) => sha256(url))
    ))))
  };
  return { ...value, pair_contract_fingerprint: sha256(JSON.stringify(value)) };
}

function balancedOrders(assets, fingerprint) {
  const ranked = assets.map((asset) => ({
    asset_id: asset.asset_id,
    rank: sha256(`${fingerprint}:${asset.asset_id}`)
  })).sort((left, right) => left.rank.localeCompare(right.rank));
  const controlFirst = new Set(ranked.slice(0, Math.ceil(assets.length / 2)).map((row) => row.asset_id));
  return new Map(assets.map((asset) => [
    asset.asset_id,
    controlFirst.has(asset.asset_id)
      ? [CONTROL_ROLE, TREATMENT_ROLE]
      : [TREATMENT_ROLE, CONTROL_ROLE]
  ]));
}

function createPairs(assets, identity) {
  const orders = balancedOrders(assets, identity.pair_contract_fingerprint);
  return assets.map((asset, index) => ({
    pair_index: index + 1,
    asset_id: asset.asset_id,
    image_set_sha256: asset.image_set_sha256,
    signed_urls_sha256: sha256(JSON.stringify(asset.image_urls)),
    order: orders.get(asset.asset_id),
    arms: {}
  }));
}

function bodyFor(payload, asset, role, pairIndex, runId, dryRun) {
  return {
    run_id: `${runId}.pair-${String(pairIndex).padStart(3, "0")}.${role}`,
    arm_id: payload.arm_id,
    request_template: payload.request_template,
    assets: [asset],
    concurrency: 1,
    dry_run: dryRun
  };
}

function expectedRequest(payload, asset) {
  return requestIdentity(requestForAsset(payload.request_template, asset.image_urls));
}

function validateCloudReport(report, {
  body,
  asset,
  dryRun,
  identity,
  expectedContract,
  expectedWire
}) {
  if (!report || report.schema_version !== "lynca-cloud-accuracy-arm-v1") {
    throw new Error("cloud_report_contract_invalid");
  }
  if (report.environment !== "preview" || report.region !== "sin1"
      || report.deployment_hostname !== identity.deployment_hostname
      || report.storage_host !== identity.storage_host) {
    throw new Error("cloud_report_runtime_identity_mismatch");
  }
  if (report.run_id !== body.run_id || report.arm_id !== body.arm_id
      || report.model !== MODEL || report.reasoning_effort !== REASONING_EFFORT
      || report.requested_effort !== REASONING_EFFORT
      || report.image_detail !== IMAGE_DETAIL || Number(report.tasks) !== 1
      || Number(report.concurrency) !== 1 || Number(report.provider_retries) !== 0) {
    throw new Error("cloud_report_request_identity_mismatch");
  }
  if (report.contract_normalized_request_sha256 !== expectedContract.normalized_request_sha256
      || Number(report.contract_normalized_request_bytes) !== expectedContract.normalized_request_bytes
      || report.contract_wire_sha256 !== expectedContract.contract_wire_sha256
      || Number(report.contract_wire_bytes) !== expectedContract.contract_wire_bytes) {
    throw new Error("cloud_report_frozen_contract_mismatch");
  }
  if (dryRun) {
    if (report.evidence_scope !== "DRY_RUN_NO_PROVIDER_CALL"
        || Number(report.provider_calls) !== 0 || report.rows !== undefined) {
      throw new Error("cloud_dry_run_crossed_provider_boundary");
    }
    return;
  }
  if (report.evidence_scope !== "VERCEL_SIN1_TO_OPENAI_CANONICAL_VISION_RAW_CHECKPOINT"
      || Number(report.provider_calls) !== 1
      || !Array.isArray(report.rows) || report.rows.length !== 1) {
    throw new Error("cloud_paid_report_shape_invalid");
  }
  const row = report.rows[0];
  if (row.asset_id !== asset.asset_id
      || row.image_set_sha256 !== asset.image_set_sha256
      || row.normalized_request_sha256 !== expectedWire.normalized_request_sha256
      || Number(row.normalized_request_bytes) !== expectedWire.normalized_request_bytes
      || row.request_wire_sha256 !== expectedWire.wire_sha256
      || Number(row.request_wire_bytes) !== expectedWire.wire_bytes) {
    throw new Error("cloud_paid_row_identity_mismatch");
  }
  if (report.ok === true && (Number(report.succeeded_count) !== 1
      || Number(report.failed_count) !== 0 || row.ok !== true
      || row.served_model !== MODEL || row.requested_effort !== REASONING_EFFORT
      || row.served_effort !== REASONING_EFFORT
      || !row.provider_response_id || !row.structured_output
      || row.provider_status !== "completed" || row.incomplete_details !== null
      || row.structured_output_error !== null)) {
    throw new Error("cloud_paid_success_contract_invalid");
  }
}

function validatePreflight(checkpoint, identity) {
  if (checkpoint?.state !== "COMPLETE" || checkpoint?.dry_run !== true
      || checkpoint?.pair_contract_fingerprint !== identity.pair_contract_fingerprint
      || checkpoint?.preregistered_contract_verified !== true
      || Number(checkpoint?.provider_calls) !== 0
      || Number(checkpoint?.preflight_calls) !== 2
      || checkpoint?.deployment_hostname !== identity.deployment_hostname
      || checkpoint?.storage_host !== identity.storage_host) {
    throw new Error("dry_run_preflight_receipt_invalid");
  }
}

function validateCompletePaidCheckpoint(checkpoint, preregistered) {
  if (checkpoint.state !== "COMPLETE" || checkpoint.dry_run !== false
      || checkpoint.pairs.length !== preregistered.cards
      || checkpoint.completed_pairs !== preregistered.cards
      || checkpoint.provider_calls !== preregistered.paired_provider_calls) {
    throw new Error("paid_checkpoint_completion_mismatch");
  }
  const responseIds = new Set();
  const roleCounts = { control: 0, treatment: 0 };
  for (const pair of checkpoint.pairs) {
    for (const role of [CONTROL_ROLE, TREATMENT_ROLE]) {
      const arm = pair.arms[role];
      if (arm?.state !== "COMPLETE") throw new Error("paid_checkpoint_pair_incomplete");
      roleCounts[role] += 1;
      const responseId = arm.report.rows[0].provider_response_id;
      if (responseIds.has(responseId)) throw new Error("paid_checkpoint_duplicate_provider_response_id");
      responseIds.add(responseId);
    }
  }
  if (roleCounts.control !== preregistered.cards || roleCounts.treatment !== preregistered.cards) {
    throw new Error("paid_checkpoint_arm_count_mismatch");
  }
}

async function runDryPreflight({
  checkpoint,
  control,
  treatment,
  assets,
  identity,
  preregistered,
  token,
  invoke,
  persist,
  nowMs
}) {
  const payloadByRole = { control, treatment };
  const sample = assets[0];
  const sampleOrder = balancedOrders(assets, identity.pair_contract_fingerprint).get(sample.asset_id);
  checkpoint.preflight_arms ||= {};
  for (const role of sampleOrder) {
    if (checkpoint.preflight_arms[role]?.state === "COMPLETE") continue;
    const body = bodyFor(payloadByRole[role], sample, role, 1, identity.run_id, true);
    checkpoint.preflight_arms[role] = { state: "IN_FLIGHT", started_at_ms: nowMs() };
    await persist(checkpoint);
    let report;
    try {
      report = await invoke({ deployment: identity.deployment, body, runToken: token });
      validateCloudReport(report, {
        body,
        asset: sample,
        dryRun: true,
        identity,
        expectedContract: preregistered[role],
        expectedWire: expectedRequest(payloadByRole[role], sample)
      });
    } catch (error) {
      checkpoint.state = "STOPPED_AMBIGUOUS";
      checkpoint.preflight_arms[role] = {
        ...checkpoint.preflight_arms[role],
        state: "AMBIGUOUS",
        error: String(error?.message || error).slice(0, 700)
      };
      await persist(checkpoint);
      throw error;
    }
    checkpoint.preflight_arms[role] = {
      ...checkpoint.preflight_arms[role],
      state: "COMPLETE",
      completed_at_ms: nowMs(),
      report
    };
    await persist(checkpoint);
  }
  checkpoint.state = "COMPLETE";
  checkpoint.preflight_calls = 2;
  checkpoint.validated_asset_count = assets.length;
  checkpoint.provider_calls = 0;
  checkpoint.preregistered_contract_verified = true;
  await persist(checkpoint);
}

async function runPaidPairs({
  checkpoint,
  control,
  treatment,
  assets,
  identity,
  preregistered,
  token,
  invoke,
  persist,
  nowMs
}) {
  const payloadByRole = { control, treatment };
  const stop = { error: null };
  let cursor = 0;

  const stopWith = async (state, error, pair, role, armState, report = null) => {
    if (!stop.error) stop.error = error;
    checkpoint.state = state;
    pair.arms[role] = {
      ...pair.arms[role],
      state: armState,
      completed_at_ms: nowMs(),
      ...(report ? { report } : {}),
      error: String(error?.message || error).slice(0, 700)
    };
    await persist(checkpoint);
  };

  const runPair = async (pair) => {
    const asset = assets[pair.pair_index - 1];
    for (const role of pair.order) {
      if (pair.arms[role]?.state === "COMPLETE") continue;
      if (stop.error) return;
      const body = bodyFor(payloadByRole[role], asset, role, pair.pair_index, identity.run_id, false);
      const expectedWire = expectedRequest(payloadByRole[role], asset);
      const startedAtMs = nowMs();
      if (Object.keys(pair.arms).length === 1) {
        const firstRole = pair.order[0];
        pair.arm_gap_ms = Math.max(0, startedAtMs - Number(pair.arms[firstRole]?.completed_at_ms || startedAtMs));
      }
      pair.arms[role] = {
        state: "IN_FLIGHT",
        started_at_ms: startedAtMs,
        body_identity_sha256: sha256(JSON.stringify({
          run_id: body.run_id,
          arm_id: body.arm_id,
          asset_id: asset.asset_id,
          image_set_sha256: asset.image_set_sha256,
          normalized_request_sha256: expectedWire.normalized_request_sha256,
          wire_sha256: expectedWire.wire_sha256
        }))
      };
      await persist(checkpoint);
      if (stop.error) {
        pair.arms[role] = { state: "NOT_STARTED_STOP" };
        await persist(checkpoint);
        return;
      }
      let report;
      try {
        report = await invoke({ deployment: identity.deployment, body, runToken: token });
        validateCloudReport(report, {
          body,
          asset,
          dryRun: false,
          identity,
          expectedContract: preregistered[role],
          expectedWire
        });
      } catch (error) {
        await stopWith("STOPPED_AMBIGUOUS", error, pair, role, "AMBIGUOUS", report);
        return;
      }
      checkpoint.provider_calls += Number(report.provider_calls) || 0;
      if (report.ok !== true || Number(report.failed_count) !== 0) {
        const error = new Error("cloud_pair_contains_failed_provider_row");
        await stopWith("STOPPED_FAILED", error, pair, role, "FAILED", report);
        return;
      }
      pair.arms[role] = {
        ...pair.arms[role],
        state: "COMPLETE",
        completed_at_ms: nowMs(),
        report
      };
      await persist(checkpoint);
    }
  };

  const worker = async () => {
    while (!stop.error) {
      const index = cursor;
      cursor += 1;
      if (index >= checkpoint.pairs.length) return;
      await runPair(checkpoint.pairs[index]);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(identity.concurrency, checkpoint.pairs.length) },
    worker
  ));
  if (stop.error) throw stop.error;

  checkpoint.completed_pairs = checkpoint.pairs.filter((pair) => (
    pair.arms.control?.state === "COMPLETE" && pair.arms.treatment?.state === "COMPLETE"
  )).length;
  checkpoint.state = "COMPLETE";
  checkpoint.preregistered_contract_verified = true;
  validateCompletePaidCheckpoint(checkpoint, preregistered);
  await persist(checkpoint);
}

export async function runCloudPairedAccuracy({
  controlPayloadPath,
  treatmentPayloadPath,
  deployment,
  outPath,
  preflightPath = null,
  runId,
  concurrency = DEFAULT_CONCURRENCY,
  dryRun = false,
  runToken = null,
  invoke = invokePreview,
  preregisteredContract = PAID105_PREREGISTERED_CONTRACT,
  nowMs = Date.now,
  minimumSignedUrlTtlMs = DEFAULT_MIN_SIGNED_URL_TTL_MS
} = {}) {
  if (!controlPayloadPath || !treatmentPayloadPath || !outPath) {
    throw new Error("paired_paths_required");
  }
  if (!/^[a-zA-Z0-9._-]{8,80}$/.test(String(runId || ""))) {
    throw new Error("paired_run_id_invalid");
  }
  const effectiveConcurrency = integer(concurrency, DEFAULT_CONCURRENCY, 16);
  const normalizedDeployment = deploymentOrigin(deployment);
  const [control, treatment] = await Promise.all([
    readFile(controlPayloadPath, "utf8").then(JSON.parse),
    readFile(treatmentPayloadPath, "utf8").then(JSON.parse)
  ]);
  const assetsEvidence = validateAssets(
    control,
    treatment,
    preregisteredContract,
    nowMs(),
    minimumSignedUrlTtlMs
  );
  const identity = pairIdentity({
    control,
    treatment,
    deployment: normalizedDeployment,
    runId: String(runId),
    concurrency: effectiveConcurrency,
    preregistered: preregisteredContract,
    assetsEvidence
  });
  if (!dryRun) {
    if (!preflightPath) throw new Error("paid_run_requires_dry_run_preflight");
    validatePreflight(await readJson(preflightPath), identity);
  }
  const checkpointFingerprint = sha256(JSON.stringify({ ...identity, dry_run: dryRun }));
  const releaseLock = await acquireCheckpointLock(outPath);
  try {
    const previous = await readJson(outPath);
    if (previous && previous.checkpoint_fingerprint !== checkpointFingerprint) {
      throw new Error("paired_checkpoint_fingerprint_mismatch");
    }
    if (["STOPPED_AMBIGUOUS", "STOPPED_FAILED"].includes(previous?.state)) {
      throw new Error("paired_checkpoint_requires_manual_resolution");
    }
    const ambiguous = previous?.pairs?.some((pair) => (
      Object.values(pair.arms || {}).some((arm) => arm.state === "IN_FLIGHT")
    )) || Object.values(previous?.preflight_arms || {}).some((arm) => arm.state === "IN_FLIGHT");
    if (ambiguous) throw new Error("paired_checkpoint_has_ambiguous_inflight_arm");
    if (previous?.state === "COMPLETE") {
      if (!dryRun) validateCompletePaidCheckpoint(previous, preregisteredContract);
      return previous;
    }
    const token = String(runToken || await runTokenFromKeychain()).trim();
    if (!token) throw new Error("cloud_sim_run_token_required");
    const checkpoint = previous || {
      ...identity,
      checkpoint_fingerprint: checkpointFingerprint,
      dry_run: dryRun,
      state: "RUNNING",
      provider_calls: 0,
      provider_retries: 0,
      preregistered_contract_verified: false,
      ...(dryRun ? {} : { pairs: createPairs(assetsEvidence.assets, identity) })
    };
    const persist = durableJsonWriter(outPath);
    await persist(checkpoint);
    if (dryRun) {
      await runDryPreflight({
        checkpoint,
        control,
        treatment,
        assets: assetsEvidence.assets,
        identity,
        preregistered: preregisteredContract,
        token,
        invoke,
        persist,
        nowMs
      });
    } else {
      await runPaidPairs({
        checkpoint,
        control,
        treatment,
        assets: assetsEvidence.assets,
        identity,
        preregistered: preregisteredContract,
        token,
        invoke,
        persist,
        nowMs
      });
    }
    return checkpoint;
  } finally {
    await releaseLock();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = cliArguments(argv);
  const result = await runCloudPairedAccuracy({
    controlPayloadPath: args["--control-payload"],
    treatmentPayloadPath: args["--treatment-payload"],
    deployment: args["--deployment"],
    outPath: args["--out"],
    preflightPath: args["--preflight"],
    runId: args["--run-id"],
    concurrency: args["--concurrency"],
    dryRun: args["--dry-run"] === true
  });
  process.stdout.write(`${JSON.stringify({
    ok: result.state === "COMPLETE",
    state: result.state,
    dry_run: result.dry_run,
    task_count: result.task_count,
    completed_pairs: result.completed_pairs || 0,
    provider_calls: result.provider_calls,
    pair_contract_fingerprint: result.pair_contract_fingerprint
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || "cloud_paired_accuracy_failed").slice(0, 1000)}\n`);
    process.exitCode = 1;
  });
}
