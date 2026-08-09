import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCompactV4Authorization } from
  "../../scripts/authorize-model-residual-compact-v4-cloud.mjs";
import { analyzeCompactV4Files, analyzeCompactV4FrozenRun,
  applyCompactV4TypedGoldBoundary, validateCompactV4SealedLabelKeys } from
  "../../scripts/analyze-model-residual-compact-v4-cloud.mjs";
import { buildCompactV4DeploymentReceipt } from
  "../../scripts/build-model-residual-compact-v4-deployment-receipt.mjs";
import { reverifyCompactV4AssetBytes } from
  "../../scripts/reverify-model-residual-compact-v4-assets.mjs";
import { buildResidualCompactV4Inputs } from "./build-residual-compact-v4-inputs.mjs";
import { attachCompactV4ImageByteReceipts, materializeResidualCompactV4Payload } from
  "./materialize-residual-compact-v4-payload.mjs";
import { validateAssetsOnlyManifest } from "./materialize-residual-v3-payload.mjs";
import { normalizedPayload, runAccuracyArm } from "./api/accuracy.js";
import { writeJsonAtomic } from "./cloud-io.mjs";
import { runCloudResidualCompactV4 } from "./run-cloud-residual-compact-v4.mjs";
import { FROZEN_REQUEST_CONTRACTS, requestForAsset, requestIdentity, sha256 } from
  "./request-contract.mjs";

const now = 1_800_000_000_000;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256" })}.${encode({
  exp: Math.floor((now + 8 * 60 * 60 * 1000) / 1000)
})}.sig`;
const [preregBody, v3PreregBody] = await Promise.all([
  readFile(new URL("../accuracy/model-residual-compact-v4-cloud-prereg.json", import.meta.url)),
  readFile(new URL("../accuracy/model-residual-candidate-v3-35x3-prereg.json", import.meta.url))
]);
const prereg = JSON.parse(preregBody); const v3Prereg = JSON.parse(v3PreregBody);
const syntheticItems = prereg.confirmatory_70.asset_ids.map((assetId, index) => ({
  asset_id: assetId,
  physical_card_id: `synthetic-physical-${String(index + 1).padStart(3, "0")}`,
  sealed_eval_label_ref: { path: "synthetic/labels.jsonl", key: `label-${index + 1}` },
  images: [
    { bucket: "listing-feedback-images",
      object_path: `synthetic/${String(index + 1).padStart(3, "0")}/front.jpg`,
      role: "front_original" },
    ...(index === 0 ? [] : [{ bucket: "listing-feedback-images",
      object_path: `synthetic/${String(index + 1).padStart(3, "0")}/back.jpg`,
      role: "back_original" }])
  ]
}));
const datasetBody = Buffer.from(JSON.stringify({ items: syntheticItems }));
const syntheticLabelsBody = Buffer.from(`${syntheticItems.map((item, index) => JSON.stringify({
  key: item.sealed_eval_label_ref.key,
  label_type: "REVIEWED_INTERNAL_TITLE",
  reviewed_title: `2024 Topps Chrome Test Player ${index + 1}`,
  policy: { reviewed_title_is_ground_truth: true, field_ground_truth: false,
    model_prompt_visible: false, load_after_predictions_frozen: true,
    self_retrieval_exclusion_required: true }
})).join("\n")}\n`);
v3Prereg.analysis_inputs.dataset_sha256 = sha256(datasetBody);
v3Prereg.analysis_inputs.expected_labels_path = "synthetic/labels.jsonl";
v3Prereg.analysis_inputs.sealed_labels_sha256 = sha256(syntheticLabelsBody);
let labelsBody = null;
let labelsPath = "";
const built = buildResidualCompactV4Inputs({ datasetBody, prereg, v3Prereg });
assert.equal(built.manifest.assets.length, 70);
assert.equal(built.manifest.assets.filter((asset) => asset.images.length === 1).length, 1);
assert.equal(built.labelRefReceipt.selected.length, 70);
assert.equal(built.labelRefReceipt.sealed_label_bytes_read, false);

const duplicatedDataset = JSON.parse(datasetBody);
duplicatedDataset.items.push(structuredClone(duplicatedDataset.items[0]));
const duplicatedDatasetBody = Buffer.from(JSON.stringify(duplicatedDataset));
const duplicateSource = structuredClone(v3Prereg);
duplicateSource.analysis_inputs.dataset_sha256 = sha256(duplicatedDatasetBody);
assert.throws(() => buildResidualCompactV4Inputs({ datasetBody: duplicatedDatasetBody,
  prereg, v3Prereg: duplicateSource }), /dataset_asset_id_duplicate/);
const duplicateLabelDataset = JSON.parse(datasetBody);
const selectedA = duplicateLabelDataset.items.find((item) =>
  item.asset_id === prereg.confirmatory_70.asset_ids[0]);
const selectedB = duplicateLabelDataset.items.find((item) =>
  item.asset_id === prereg.confirmatory_70.asset_ids[1]);
selectedB.sealed_eval_label_ref.key = selectedA.sealed_eval_label_ref.key;
const duplicateLabelDatasetBody = Buffer.from(JSON.stringify(duplicateLabelDataset));
const duplicateLabelSource = structuredClone(v3Prereg);
duplicateLabelSource.analysis_inputs.dataset_sha256 = sha256(duplicateLabelDatasetBody);
assert.throws(() => buildResidualCompactV4Inputs({ datasetBody: duplicateLabelDatasetBody,
  prereg, v3Prereg: duplicateLabelSource }), /selected_label_key_duplicate/);
const duplicateObjectManifest = structuredClone(built.manifest);
duplicateObjectManifest.assets[1].images[0]
  = structuredClone(duplicateObjectManifest.assets[0].images[0]);
assert.throws(() => validateAssetsOnlyManifest(duplicateObjectManifest, {
  expectedCards: 70, minimumImages: 1, maximumImages: 2,
  schemaVersion: "residual-compact-v4-assets-only-manifest-v1"
}), /assets_only_image_duplicate/);

let signCalls = 0; let storageReadCalls = 0; let storageReadsActive = 0;
let maximumStorageReadsActive = 0;
const fixtureImageBytes = (url) => Buffer.from(`fixture-image-bytes:${new URL(url).pathname}`);
const payload = await materializeResidualCompactV4Payload({ prereg,
  manifest: built.manifest, labelRefReceipt: built.labelRefReceipt,
  controlTemplate: built.control, treatmentTemplate: built.treatment,
  serviceKey: "storage-secret", materializedAt: new Date(now).toISOString(),
  fetchImpl: async (url, options) => {
    if (options?.method === "POST") {
      signCalls += 1;
      const pathname = new URL(url).pathname.replace(/^\/storage\/v1/, "");
      return { ok: true, json: async () => ({ signedURL: `${pathname}?token=${token}` }) };
    }
    storageReadCalls += 1;
    storageReadsActive += 1;
    maximumStorageReadsActive = Math.max(maximumStorageReadsActive, storageReadsActive);
    await new Promise((resolve) => setImmediate(resolve));
    const bytes = fixtureImageBytes(url);
    storageReadsActive -= 1;
    return { ok: true, arrayBuffer: async () => bytes };
  } });
assert.equal(signCalls, 139);
assert.equal(storageReadCalls, 139);
assert(maximumStorageReadsActive > 1);
assert(maximumStorageReadsActive <= 8);
assert.deepEqual(payload.control.assets, payload.treatment.assets);
await assert.rejects(attachCompactV4ImageByteReceipts({ manifest: built.manifest,
  signedAssets: payload.control.assets, concurrency: 9,
  fetchImpl: async () => { throw new Error("must_not_fetch"); } }),
/compact_v4_byte_receipt_concurrency_invalid/);
const assetReverifyReceipt = await reverifyCompactV4AssetBytes({ payload,
  verifiedAt: new Date(now + 1).toISOString(), fetchImpl: async (url) => ({ ok: true,
    arrayBuffer: async () => fixtureImageBytes(url) }) });
assert.equal(assetReverifyReceipt.provider_calls, 0);
assert.equal(assetReverifyReceipt.storage_read_calls, 139);
let reverifyReads = 0;
await assert.rejects(reverifyCompactV4AssetBytes({ payload, fetchImpl: async (url) => {
  reverifyReads += 1;
  return { ok: true, arrayBuffer: async () => reverifyReads === 1
    ? Buffer.from("changed") : fixtureImageBytes(url) };
} }), /reverify_byte_mismatch/);
assert.equal(reverifyReads, 1);

const env = { VERCEL_ENV: "preview", VERCEL_REGION: "sin1", LYNCA_CLOUD_SIM_ENABLED: "true",
  OPENAI_API_KEY: "configured", LYNCA_CLOUD_SIM_RUN_TOKEN: "configured",
  LYNCA_CLOUD_SIM_STORAGE_HOST: "irpgnhkslrsiucybkufc.supabase.co" };
for (const arm of ["control", "treatment"]) {
  const { asset_id, image_set_sha256, image_urls } = payload[arm].assets[0];
  const normalized = normalizedPayload({ arm_id: payload[arm].arm_id,
    run_id: `compact-v4-${arm}`, concurrency: 1, dry_run: true,
    request_template: payload[arm].request_template,
    assets: [{ asset_id, image_set_sha256, image_urls }] }, env);
  const report = await runAccuracyArm(normalized, { env });
  assert.equal(report.provider_calls, 0);
  assert.equal(report.reasoning_effort, "low");
}

const deploymentReadiness = { ready: true, environment: "preview", region: "sin1",
    deployment_id: "dpl_compact_v4_test", deployment_hostname: "compact-v4-test.vercel.app",
    release_git_sha: "a".repeat(40),
    model: "gpt-5.6-luna", image_detail: "high", production_calls_allowed: false,
    max_batch_size: 1, max_concurrency: 1, openai_configured: true,
    run_token_configured: true, storage_host_configured: true,
    arm_request_specs: { compact_v4_control: {}, compact_v4_treatment: {} },
    frozen_request_contracts: { compact_v4_control: {}, compact_v4_treatment: {} } };
const cleanSourceState = { head_sha: "a".repeat(40), clean: true,
  status_porcelain_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" };
const deploymentReceiptInputs = {
  deployment: "https://compact-v4-test.vercel.app", sourceGitSha: "a".repeat(40),
  project: { projectName: "lynca-capacity-lab",
    projectId: "prj_OnBhU4kHtWuOBCs3iGoYZsYfaWbg",
    orgId: "team_il17GLcdGsr5fows3jsKwMoA" },
  activeContext: { vercel: { scope: { id: "team_il17GLcdGsr5fows3jsKwMoA" },
    capacity_lab: { project: "lynca-capacity-lab", project_id: "prj_OnBhU4kHtWuOBCs3iGoYZsYfaWbg",
      deployment_target: "preview" } } },
  vercelConfig: { regions: ["sin1"], functions: { "api/accuracy.js": { regions: ["sin1"] } } },
  sourceState: cleanSourceState
};
const deploymentReceipt = buildCompactV4DeploymentReceipt({ readiness: deploymentReadiness,
  ...deploymentReceiptInputs });
assert.throws(() => buildCompactV4DeploymentReceipt({
  readiness: { ...deploymentReadiness, release_git_sha: null }, ...deploymentReceiptInputs
}), /deployment_readiness_invalid/);
assert.throws(() => buildCompactV4DeploymentReceipt({ readiness: deploymentReadiness,
  ...deploymentReceiptInputs, sourceState: { ...cleanSourceState, clean: false }
}), /deployment_readiness_invalid/);
assert.throws(() => buildCompactV4DeploymentReceipt({
  readiness: { ...deploymentReadiness, release_git_sha: "b".repeat(40) },
  ...deploymentReceiptInputs
}), /deployment_readiness_invalid/);
const canonical = { recognition_status: "CONFIRMED", year: "2024", manufacturer: "Topps",
  brand: "", product: "Chrome", set: "", subset: "", language: "",
  players: ["Test Player"], card_name: "", team: "", card_type: "",
  official_card_type: "", observable_components: [], insert: "", surface_color: "",
  parallel_family: "", parallel_exact: "", parallel: "", variation: "",
  print_run_number: "", print_run_numerator: "", print_run_denominator: "", numbered_to: "",
  serial_number: "", numerical_rarity: "", card_number: "", tcg_card_number: "",
  collector_number: "", checklist_code: "", attributes: [], grade_company: "",
  card_grade: "", auto_grade: "", grade_type: "", cert_number: "", rc: false,
  first_bowman: false, ssp: false, case_hit: false, auto: false, patch: false,
  relic: false, jersey: false, sketch: false, redemption: false, one_of_one: false,
  multi_card: false, card_count: null, lot_type: "", field_evidence: [], unresolved: [] };

const preflightInvoke = async ({ body }) => {
  assert.equal(labelsBody, null, "sealed labels must not be loaded during preflight");
  return { ok: true, arm_id: body.arm_id, run_id: body.run_id,
  provider_calls: 0, provider_retries: 0, environment: "preview", region: "sin1",
  deployment_id: deploymentReceipt.deployment_id,
  deployment_hostname: deploymentReceipt.deployment_hostname,
  release_git_sha: deploymentReceipt.source_git_sha,
  storage_host: "irpgnhkslrsiucybkufc.supabase.co", model: "gpt-5.6-luna",
  reasoning_effort: "low", requested_effort: "low", image_detail: "high",
  request_template_sha256: sha256(JSON.stringify(body.request_template)),
  contract_normalized_request_sha256:
    FROZEN_REQUEST_CONTRACTS[body.arm_id].normalized_request_sha256,
  contract_normalized_request_bytes:
    FROZEN_REQUEST_CONTRACTS[body.arm_id].normalized_request_bytes,
    contract_wire_sha256: FROZEN_REQUEST_CONTRACTS[body.arm_id].contract_wire_sha256,
    contract_wire_bytes: FROZEN_REQUEST_CONTRACTS[body.arm_id].contract_wire_bytes };
};

function cloudReport({ body }) {
  assert.equal(labelsBody, null, "sealed labels must not be loaded during paid execution");
  const asset = body.assets[0];
  const actual = requestIdentity(requestForAsset(body.request_template, asset.image_urls));
  const frozen = FROZEN_REQUEST_CONTRACTS[body.arm_id];
  const structuredOutput = body.arm_id === "compact_v4_treatment"
    ? { residual_printed_phrase: "1st Bowman", ...canonical } : canonical;
  const structuredRaw = JSON.stringify(structuredOutput);
  const providerResponse = {
    id: `resp-${body.run_id}`,
    status: "completed",
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    incomplete_details: null,
    output: [{ type: "message", content: [{ type: "output_text", text: structuredRaw }] }],
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 40 }
  };
  const providerResponseRaw = JSON.stringify(providerResponse);
  return Promise.resolve({ ok: true, provider_calls: 1, provider_retries: 0,
    arm_id: body.arm_id, run_id: body.run_id, environment: "preview", region: "sin1",
    deployment_id: deploymentReceipt.deployment_id,
    deployment_hostname: deploymentReceipt.deployment_hostname,
    release_git_sha: deploymentReceipt.source_git_sha,
    storage_host: "irpgnhkslrsiucybkufc.supabase.co", model: "gpt-5.6-luna",
    reasoning_effort: "low", requested_effort: "low", image_detail: "high",
    contract_normalized_request_sha256: frozen.normalized_request_sha256,
    contract_normalized_request_bytes: frozen.normalized_request_bytes,
    contract_wire_sha256: frozen.contract_wire_sha256,
    contract_wire_bytes: frozen.contract_wire_bytes,
    rows: [{ ok: true, asset_id: asset.asset_id, image_set_sha256: asset.image_set_sha256,
      normalized_request_sha256: actual.normalized_request_sha256,
      normalized_request_bytes: actual.normalized_request_bytes,
      request_wire_sha256: actual.wire_sha256, request_wire_bytes: actual.wire_bytes,
      provider_response_raw: providerResponseRaw,
      provider_response_id: providerResponse.id,
      provider_response_sha256: sha256(providerResponseRaw),
      structured_output_raw_sha256: sha256(structuredRaw), served_model: "gpt-5.6-luna",
      requested_effort: "low", served_effort: "low", latency_ms: 10,
      input_tokens: 100, cached_input_tokens: 0, output_tokens: 40,
      structured_output: structuredOutput }] });
}

const directory = await mkdtemp(join(tmpdir(), "compact-v4-cloud-"));
labelsPath = join(directory, "labels.jsonl");
await writeFile(labelsPath, syntheticLabelsBody);
const checkpointPath = join(directory, "checkpoint.json");
const common = { prereg, payload, manifest: built.manifest,
  labelRefReceipt: built.labelRefReceipt, deploymentReceipt,
  deployment: "https://compact-v4-test.vercel.app", outPath: checkpointPath,
  runId: "compact-v4-paid105", runToken: "token", nowMs: () => now,
  sourceState: cleanSourceState };
const preflight = await runCloudResidualCompactV4({ ...common, dryRun: true,
  invoke: preflightInvoke });
assert.equal(preflight.state, "PREFLIGHT_COMPLETE");
assert.equal(preflight.provider_attempts, 0);
const authorization = buildCompactV4Authorization({ prereg, payload,
  manifest: built.manifest, labelRefReceipt: built.labelRefReceipt,
  deploymentReceipt, checkpoint: preflight });
assert.equal(authorization.max_provider_attempts, 105);
assert.equal(authorization.preflight_receipt_sha256, preflight.preflight_receipt_sha256);
assert.equal(authorization.materialization_byte_receipts_sha256,
  payload.materialization_byte_receipts_sha256);

let active = 0; let maxActive = 0; let calls = 0;
const durableEvents = [];
const checkpointIo = {
  open: async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    const directoryHandle = flags === "r";
    return {
      writeFile: (...args) => handle.writeFile(...args),
      sync: async () => {
        durableEvents.push(directoryHandle ? "directory_sync" : "file_sync");
        await handle.sync();
      },
      close: () => handle.close()
    };
  },
  rename: async (...args) => { durableEvents.push("rename"); await rename(...args); },
  unlink
};
const complete = await runCloudResidualCompactV4({ ...common, authorization,
  checkpointIo,
  invoke: async (args) => {
    assert.equal(durableEvents.at(-1), "directory_sync",
      "provider invocation must follow durable directory sync");
    const lastDirectorySync = durableEvents.lastIndexOf("directory_sync");
    const lastRename = durableEvents.lastIndexOf("rename");
    const lastFileSync = durableEvents.lastIndexOf("file_sync");
    assert(lastFileSync < lastRename && lastRename < lastDirectorySync,
      "file sync -> rename -> directory sync order must precede provider invocation");
    durableEvents.push("invoke");
    active += 1; maxActive = Math.max(maxActive, active); calls += 1;
    const result = await cloudReport(args); active -= 1; return result;
  } });
assert.equal(complete.state, "COMPLETE");
assert.equal(complete.provider_attempts, 105);
assert.equal(complete.provider_calls, 105);
assert.equal(complete.provider_retries, 0);
assert.equal(calls, 105); assert.equal(maxActive, 1);
assert.equal(Object.values(complete.jobs).filter((job) => job.arm === "treatment").length, 70);
assert.equal(Object.values(complete.jobs).filter((job) => job.arm === "control").length, 35);
assert.equal(Object.values(complete.jobs).every((job) =>
  job.authorization_receipt_sha256 === complete.authorization_receipt_sha256), true);
assert.equal(Object.values(complete.jobs).every((job) =>
  job.result.structured_output_envelope_sha256.length === 64), true);
assert.equal(Object.values(complete.jobs).filter((job) => job.arm === "treatment")
  .every((job) => job.result.residual_printed_phrase === "1st Bowman"), true);
const resumed = await runCloudResidualCompactV4({ ...common, authorization,
  invoke: async () => { throw new Error("must_not_reinvoke"); } });
assert.equal(resumed.state, "COMPLETE");

const tamperedPath = join(directory, "tampered.json");
const tampered = structuredClone(complete);
Object.values(tampered.jobs)[0].result.structured_output_envelope.year = "1999";
await writeFile(tamperedPath, JSON.stringify(tampered));
let tamperedInvokes = 0;
await assert.rejects(runCloudResidualCompactV4({ ...common, outPath: tamperedPath,
  authorization, invoke: async () => { tamperedInvokes += 1; } }),
/complete_checkpoint_invalid/);
assert.equal(tamperedInvokes, 0);

const rawTamperedPath = join(directory, "raw-tampered.json");
const rawTampered = structuredClone(complete);
const rawTamperedResult = Object.values(rawTampered.jobs)[0].result;
const rawResponse = JSON.parse(rawTamperedResult.provider_response_raw);
rawResponse.status = "failed";
rawTamperedResult.provider_response_raw = JSON.stringify(rawResponse);
rawTamperedResult.provider_response_sha256 = sha256(rawTamperedResult.provider_response_raw);
await writeFile(rawTamperedPath, JSON.stringify(rawTampered));
let rawTamperedInvokes = 0;
await assert.rejects(runCloudResidualCompactV4({ ...common, outPath: rawTamperedPath,
  authorization, invoke: async () => { rawTamperedInvokes += 1; } }),
/provider_raw_contract_invalid/);
assert.equal(rawTamperedInvokes, 0);

const noPreflightPath = join(directory, "no-preflight.json");
let noPreflightInvokes = 0;
await assert.rejects(runCloudResidualCompactV4({ ...common, outPath: noPreflightPath,
  authorization, invoke: async () => { noPreflightInvokes += 1; } }),
/preflight_receipt_invalid/);
assert.equal(noPreflightInvokes, 0);

const preflightTamperedPath = join(directory, "preflight-tampered.json");
const preflightTampered = structuredClone(preflight);
preflightTampered.preflight_receipt_sha256 = "f".repeat(64);
await writeFile(preflightTamperedPath, JSON.stringify(preflightTampered));
let preflightTamperedInvokes = 0;
await assert.rejects(runCloudResidualCompactV4({ ...common,
  outPath: preflightTamperedPath, authorization,
  invoke: async () => { preflightTamperedInvokes += 1; } }), /preflight_receipt_invalid/);
assert.equal(preflightTamperedInvokes, 0);

const swappedPayload = structuredClone(payload);
const twoImageIndex = swappedPayload.control.assets.findIndex((asset) =>
  asset.image_urls.length === 2);
swappedPayload.control.assets[twoImageIndex].image_urls.reverse();
swappedPayload.treatment.assets = structuredClone(swappedPayload.control.assets);
swappedPayload.ordered_signed_urls_sha256 = sha256(JSON.stringify(
  swappedPayload.control.assets.map((asset) => asset.image_urls)));
let swappedUrlInvokes = 0;
await assert.rejects(runCloudResidualCompactV4({ ...common, payload: swappedPayload,
  outPath: join(directory, "swapped-url.json"), dryRun: true,
  invoke: async () => { swappedUrlInvokes += 1; } }), /signed_url_slot_mismatch/);
assert.equal(swappedUrlInvokes, 0);

const twoImageTamperedPrereg = structuredClone(prereg);
twoImageTamperedPrereg.frozen_contract.provider.request_contracts_by_image_count
  ["2"].treatment_schema_sha256 = "f".repeat(64);
const twoImageTamperedPayload = structuredClone(payload);
twoImageTamperedPayload.prereg_sha256 = sha256(JSON.stringify(twoImageTamperedPrereg));
let twoImageTamperedInvokes = 0;
await assert.rejects(runCloudResidualCompactV4({ ...common,
  prereg: twoImageTamperedPrereg, payload: twoImageTamperedPayload,
  outPath: join(directory, "two-image-contract.json"), dryRun: true,
  invoke: async () => { twoImageTamperedInvokes += 1; } }),
/preregistered_request_mismatch:2/);
assert.equal(twoImageTamperedInvokes, 0);

for (const [field, mutate] of [
  ["reviewed_title", (receipt) => { receipt.reviewed_title = "forbidden"; }],
  ["ground_truth", (receipt) => {
    receipt.selected[0].sealed_eval_label_ref.ground_truth = "forbidden";
  }]
]) {
  const poisonedReceipt = structuredClone(built.labelRefReceipt);
  mutate(poisonedReceipt);
  let labelReceiptInvokes = 0;
  await assert.rejects(runCloudResidualCompactV4({ ...common,
    labelRefReceipt: poisonedReceipt,
    outPath: join(directory, `poisoned-label-ref-${field}.json`), dryRun: true,
    invoke: async () => { labelReceiptInvokes += 1; } }), /forbidden_execution_key/);
  assert.equal(labelReceiptInvokes, 0);
}

let dirtySourceInvokes = 0;
await assert.rejects(runCloudResidualCompactV4({ ...common,
  sourceState: { ...cleanSourceState, clean: false },
  outPath: join(directory, "dirty-source.json"), dryRun: true,
  invoke: async () => { dirtySourceInvokes += 1; } }), /execution_source_not_clean/);
assert.equal(dirtySourceInvokes, 0);

const fsyncFailureEvents = [];
await assert.rejects(writeJsonAtomic(join(directory, "directory-fsync-failure.json"),
  { durable: true }, { io: {
    open: async (path, flags, mode) => {
      const handle = await open(path, flags, mode); const isDirectory = flags === "r";
      return { writeFile: (...args) => handle.writeFile(...args),
        sync: async () => {
          fsyncFailureEvents.push(isDirectory ? "directory_sync" : "file_sync");
          if (isDirectory) throw new Error("injected_directory_fsync_failure");
          await handle.sync();
        }, close: () => handle.close() };
    },
    rename: async (...args) => { fsyncFailureEvents.push("rename"); await rename(...args); },
    unlink
  } }), /injected_directory_fsync_failure/);
assert.deepEqual(fsyncFailureEvents, ["file_sync", "rename", "directory_sync"]);

const failedPath = join(directory, "failed.json");
const failedCommon = { ...common, outPath: failedPath, runId: "compact-v4-failed" };
const failedPreflight = await runCloudResidualCompactV4({ ...failedCommon, dryRun: true,
  invoke: preflightInvoke });
const failedAuthorization = buildCompactV4Authorization({ prereg, payload,
  manifest: built.manifest, labelRefReceipt: built.labelRefReceipt,
  deploymentReceipt, checkpoint: failedPreflight });
let failedCalls = 0;
await assert.rejects(runCloudResidualCompactV4({ ...failedCommon,
  authorization: failedAuthorization, invoke: async () => {
    failedCalls += 1; throw new Error("ambiguous_transport");
  } }), /ambiguous_transport/);
await assert.rejects(runCloudResidualCompactV4({ ...failedCommon,
  authorization: failedAuthorization, invoke: async () => { failedCalls += 1; } }),
/unretryable_prior_attempt/);
assert.equal(failedCalls, 1);

const poisonedPayload = structuredClone(payload);
poisonedPayload.control.assets[0].reviewed_title = "forbidden";
let poisonedInvokes = 0;
await assert.rejects(runCloudResidualCompactV4({ ...common, payload: poisonedPayload,
  outPath: join(directory, "poisoned.json"), dryRun: true,
  invoke: async () => { poisonedInvokes += 1; } }), /forbidden_execution_key/);
assert.equal(poisonedInvokes, 0);

// Only now, after COMPLETE plus runner raw replay and every execution negative,
// may the test load the sealed label bytes.
labelsBody = await readFile(labelsPath);
assert.throws(() => validateCompactV4SealedLabelKeys(Buffer.from(
  `${JSON.stringify({ key: "duplicate" })}\n${JSON.stringify({ key: "duplicate" })}\n`
)), /sealed_label_key_duplicate/);

const analysis = analyzeCompactV4FrozenRun({ prereg, payload, manifest: built.manifest,
  labelRefReceipt: built.labelRefReceipt, deploymentReceipt, authorization,
  checkpoint: complete, assetReverifyReceipt, datasetBody, labelsBody });
assert.equal(analysis.validated_run.provider_calls, 105);
assert.equal(analysis.treatment_rows.length, 70);
assert.equal(analysis.control_rows.length, 35);
assert.equal(analysis.production_authorized, false);
assert.equal(analysis.treatment_rows.every((row) =>
  Object.hasOwn(row, "title_proxy_error") && !Object.hasOwn(row, "critical_error")), true);
assert.equal(analysis.gate.safety.critical_error, null);
assert.equal(analysis.gate.safety.critical_factual_error_cards, null);
assert(["STOP_HARD_REGRESSION", "HOLD_TYPED_GOLD_REQUIRED"].includes(
  analysis.gate.decision));
const typedBoundary = applyCompactV4TypedGoldBoundary({
  decision: "PASS_FOR_FRESH150_BUNDLE_ONLY", production_authorized: false,
  utility: { passed: true }, safety: { passed: true, critical_error: 0 }
});
assert.equal(typedBoundary.decision, "HOLD_TYPED_GOLD_REQUIRED");
assert.equal(typedBoundary.capture_economics_decision, "PASS_FOR_FRESH150_BUNDLE_ONLY");
assert.equal(typedBoundary.safety.title_proxy_error_cards, 0);
assert.equal(typedBoundary.safety.critical_factual_error_cards, null);
assert.equal(typedBoundary.safety.typed_field_precision, null);
assert.equal(typedBoundary.safety.typed_gold_coverage, "0/70");

const authorizationTampered = { ...authorization, payload_sha256: "f".repeat(64) };
assert.throws(() => analyzeCompactV4FrozenRun({ prereg, payload,
  manifest: built.manifest, labelRefReceipt: built.labelRefReceipt, deploymentReceipt,
  authorization: authorizationTampered, checkpoint: complete, assetReverifyReceipt,
  datasetBody, labelsBody }), /analysis_authorization_invalid/);
const reverifyTampered = structuredClone(assetReverifyReceipt);
reverifyTampered.images[0].content_sha256 = "f".repeat(64);
reverifyTampered.images_sha256 = sha256(JSON.stringify(reverifyTampered.images));
assert.throws(() => analyzeCompactV4FrozenRun({ prereg, payload,
  manifest: built.manifest, labelRefReceipt: built.labelRefReceipt, deploymentReceipt,
  authorization, checkpoint: complete, assetReverifyReceipt: reverifyTampered,
  datasetBody, labelsBody }), /asset_reverify_mismatch/);

const artifactPaths = {
  preregPath: join(directory, "prereg.json"), payloadPath: join(directory, "payload.json"),
  manifestPath: join(directory, "manifest.json"),
  labelRefReceiptPath: join(directory, "label-ref.json"),
  deploymentReceiptPath: join(directory, "deployment.json"),
  authorizationPath: join(directory, "authorization.json"),
  checkpointPath: join(directory, "analysis-checkpoint.json"),
  assetReverifyPath: join(directory, "asset-reverify.json"),
  datasetPath: join(directory, "dataset.json"), labelsPath
};
await Promise.all([
  [artifactPaths.preregPath, prereg], [artifactPaths.payloadPath, payload],
  [artifactPaths.manifestPath, built.manifest],
  [artifactPaths.labelRefReceiptPath, built.labelRefReceipt],
  [artifactPaths.deploymentReceiptPath, deploymentReceipt],
  [artifactPaths.authorizationPath, authorization],
  [artifactPaths.checkpointPath, complete],
  [artifactPaths.assetReverifyPath, assetReverifyReceipt]
].map(([path, value]) => writeFile(path, JSON.stringify(value))));
await writeFile(artifactPaths.datasetPath, datasetBody);
const stagedAnalysis = await analyzeCompactV4Files({ ...artifactPaths,
  readLabelsImpl: async (path) => {
    assert.equal(path, labelsPath); return labelsBody;
  } });
assert.equal(stagedAnalysis.validated_run.run_fingerprint, complete.run_fingerprint);

const invalidCheckpointPath = join(directory, "invalid-analysis-checkpoint.json");
await writeFile(invalidCheckpointPath, JSON.stringify({ ...complete, provider_calls: 104 }));
let invalidCheckpointLabelReads = 0;
await assert.rejects(analyzeCompactV4Files({ ...artifactPaths,
  checkpointPath: invalidCheckpointPath,
  readLabelsImpl: async () => {
    invalidCheckpointLabelReads += 1; throw new Error("must_not_call");
  } }), /analysis_checkpoint_incomplete/);
assert.equal(invalidCheckpointLabelReads, 0);

console.log("cloud residual compact v4 tests passed (0 network, 0 provider calls)");
