import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importCloudPaid105Checkpoint } from "./import-cloud-paid105-checkpoint.mjs";
import { ARM_SPECS, imageSetFingerprint, requestFingerprint } from "./run-thin-path-eval.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const directory = await mkdtemp(join(tmpdir(), "lynca-cloud-import-test-"));
const deployment = "https://cloud-preview.example.vercel.app";
const storageHost = "irpgnhkslrsiucybkufc.supabase.co";
const armKeys = { control: "thin_canonical_high", treatment: "thin_canonical_residual_v1_high" };
const armIds = { control: "canonical_high", treatment: "canonical_residual_v1_high" };

const items = [1, 2].map((number) => ({
  asset_id: `asset-${number}`,
  sealed_eval_label_ref: { key: `label-${number}` },
  images: [
    { bucket: "listing-feedback-images", object_path: `card-${number}/front.jpg`, role: "front_original" },
    ...(number === 1 ? [] : [
      { bucket: "listing-feedback-images", object_path: `card-${number}/back.jpg`, role: "back_original" }
    ])
  ]
}));
const assets = items.map((item) => ({
  asset_id: item.asset_id,
  image_set_sha256: imageSetFingerprint(item),
  image_urls: (item.asset_id === "asset-1" ? [
    `https://${storageHost}/storage/v1/object/sign/b/${item.asset_id}-front?token=x`
  ] : [
    `https://${storageHost}/storage/v1/object/sign/b/${item.asset_id}-front?token=x`,
    `https://${storageHost}/storage/v1/object/sign/b/${item.asset_id}-back?token=y`
  ])
}));
const template = (role) => ARM_SPECS[armKeys[role]].buildRequest({
  imageUrls: [],
  model: "gpt-5.6-luna",
  effort: "none",
  imageDetail: "high"
});
const control = { arm_id: armIds.control, request_template: template("control"), assets };
const treatment = { arm_id: armIds.treatment, request_template: template("treatment"), assets };

function requestIdentity(role, imageUrls) {
  const request = ARM_SPECS[armKeys[role]].buildRequest({
    imageUrls,
    model: "gpt-5.6-luna",
    effort: "none",
    imageDetail: "high"
  });
  const body = JSON.stringify(request);
  return {
    normalized_request_sha256: requestFingerprint(request),
    normalized_request_bytes: Buffer.byteLength(JSON.stringify(request, (() => {
      let image = 0;
      return (key, value) => key === "image_url" ? `signed-image-${++image}` : value;
    })())),
    wire_sha256: sha256(body),
    wire_bytes: Buffer.byteLength(body)
  };
}

const contract = {
  control: requestIdentity("control", ["https://contract.invalid/front", "https://contract.invalid/back"]),
  treatment: requestIdentity("treatment", ["https://contract.invalid/front", "https://contract.invalid/back"])
};

function fields(role) {
  return {
    year: "2024",
    manufacturer: "Topps",
    product: "Chrome",
    set: "",
    subjects: ["Player One"],
    team: "",
    card_name: "",
    release_variant: "",
    surface_color: "Gold",
    parallel_family: "Refractor",
    parallel_exact: "",
    descriptive_rarity: "",
    card_number: "1",
    serial: "01/50",
    attributes: ["RC"],
    grade: "",
    grammar: "standard",
    lot_count: "",
    language: "",
    unreadable: [],
    low_confidence: [],
    ...(role === "treatment" ? {
      residual_evidence: [{ text: "SSP", target: "marker", anchor: "front_text" }]
    } : {})
  };
}

let responseNumber = 0;
function report(role, asset, pairIndex) {
  responseNumber += 1;
  const responseId = `response-${responseNumber}`;
  const outputText = JSON.stringify(fields(role));
  const body = {
    id: responseId,
    model: "gpt-5.6-luna",
    status: "completed",
    incomplete_details: null,
    reasoning: { effort: "none" },
    output: [{ type: "message", content: [{ type: "output_text", text: outputText }] }],
    usage: {
      input_tokens: 5000,
      output_tokens: 120,
      total_tokens: 5120,
      input_tokens_details: { cached_tokens: 4000 }
    }
  };
  const raw = JSON.stringify(body);
  const wire = requestIdentity(role, asset.image_urls);
  return {
    ok: true,
    schema_version: "lynca-cloud-accuracy-arm-v1",
    evidence_scope: "VERCEL_SIN1_TO_OPENAI_CANONICAL_VISION_RAW_CHECKPOINT",
    provider_calls: 1,
    provider_retries: 0,
    run_id: `paired-test.pair-${String(pairIndex).padStart(3, "0")}.${role}`,
    arm_id: armIds[role],
    model: "gpt-5.6-luna",
    reasoning_effort: "none",
    image_detail: "high",
    tasks: 1,
    concurrency: 1,
    storage_host: storageHost,
    environment: "preview",
    region: "sin1",
    deployment_hostname: new URL(deployment).hostname,
    contract_normalized_request_sha256: contract[role].normalized_request_sha256,
    contract_normalized_request_bytes: contract[role].normalized_request_bytes,
    contract_wire_sha256: contract[role].wire_sha256,
    contract_wire_bytes: contract[role].wire_bytes,
    succeeded_count: 1,
    failed_count: 0,
    rows: [{
      ok: true,
      status: 200,
      asset_id: asset.asset_id,
      image_set_sha256: asset.image_set_sha256,
      latency_ms: 5000,
      normalized_request_sha256: wire.normalized_request_sha256,
      normalized_request_bytes: wire.normalized_request_bytes,
      request_wire_sha256: wire.wire_sha256,
      request_wire_bytes: wire.wire_bytes,
      provider_response_id: responseId,
      provider_status: "completed",
      incomplete_details: null,
      provider_response_raw: raw,
      provider_response_sha256: sha256(raw),
      served_model: "gpt-5.6-luna",
      served_effort: "none",
      served_effort_attested: true,
      structured_output: fields(role),
      structured_output_error: null,
      input_tokens: 5000,
      cached_input_tokens: 4000,
      output_tokens: 120
    }]
  };
}

const stableIdentity = assets.map((asset) => ({
  asset_id: asset.asset_id,
  image_set_sha256: asset.image_set_sha256
}));
const checkpoint = {
  schema_version: "lynca-cloud-paired-accuracy-contract-v2",
  state: "COMPLETE",
  dry_run: false,
  task_count: 2,
  completed_pairs: 2,
  provider_calls: 4,
  provider_retries: 0,
  preregistered_contract_verified: true,
  pair_contract_fingerprint: "pair-fingerprint",
  checkpoint_fingerprint: "checkpoint-fingerprint",
  deployment,
  deployment_hostname: new URL(deployment).hostname,
  storage_host: storageHost,
  concurrency: 2,
  control_template_sha256: sha256(JSON.stringify(control.request_template)),
  treatment_template_sha256: sha256(JSON.stringify(treatment.request_template)),
  control_contract: contract.control,
  treatment_contract: contract.treatment,
  ordered_assets_sha256: sha256(JSON.stringify(stableIdentity)),
  ordered_signed_urls_sha256: sha256(JSON.stringify(assets.map((asset) => (
    asset.image_urls.map((url) => sha256(url))
  )))),
  pairs: assets.map((asset, index) => ({
    pair_index: index + 1,
    asset_id: asset.asset_id,
    image_set_sha256: asset.image_set_sha256,
    signed_urls_sha256: sha256(JSON.stringify(asset.image_urls)),
    order: index % 2 === 0 ? ["control", "treatment"] : ["treatment", "control"],
    arm_gap_ms: 1,
    arms: Object.fromEntries(["control", "treatment"].map((role) => [role, {
      state: "COMPLETE",
      started_at_ms: 1_800_000_000_000 + index,
      completed_at_ms: 1_800_000_005_000 + index,
      report: report(role, asset, index + 1)
    }]))
  }))
};
const preflight = {
  state: "COMPLETE",
  dry_run: true,
  provider_calls: 0,
  preflight_calls: 2,
  preregistered_contract_verified: true,
  pair_contract_fingerprint: checkpoint.pair_contract_fingerprint
};

const paths = Object.fromEntries([
  ["checkpoint", checkpoint],
  ["preflight", preflight],
  ["control", control],
  ["treatment", treatment],
  ["dataset", { items }],
  ["asset_ids", items.map((item) => item.asset_id)]
].map(([name, value]) => [name, join(directory, `${name}.json`)]));
await Promise.all([
  writeFile(paths.checkpoint, JSON.stringify(checkpoint)),
  writeFile(paths.preflight, JSON.stringify(preflight)),
  writeFile(paths.control, JSON.stringify(control)),
  writeFile(paths.treatment, JSON.stringify(treatment)),
  writeFile(paths.dataset, JSON.stringify({ items })),
  writeFile(paths.asset_ids, JSON.stringify(items.map((item) => item.asset_id)))
]);
const labelsPath = join(directory, "labels.jsonl");
await writeFile(labelsPath, items.map((_, index) => JSON.stringify({
  key: `label-${index + 1}`,
  reviewed_title: `2024 Topps Chrome Player One Gold Refractor 01/50 RC`
})).join("\n"));

const result = await importCloudPaid105Checkpoint({
  checkpointPath: paths.checkpoint,
  preflightPath: paths.preflight,
  controlPayloadPath: paths.control,
  treatmentPayloadPath: paths.treatment,
  datasetPath: paths.dataset,
  sealedLabelsPath: labelsPath,
  assetIdsPath: paths.asset_ids,
  outDirectory: join(directory, "out"),
  expectedCards: 2
});
assert.equal(result.rows.length, 4);
assert.equal(result.manifest.checkpoint_rows, 4);
assert.equal(result.manifest.paired_cards, 2);
assert.equal(result.manifest.cloud_evidence.provider_calls, 4);
assert.equal(result.manifest.cloud_evidence.labels_loaded_after_predictions_frozen, true);
assert.ok(result.rows.filter((row) => row.arm === "thin_canonical_residual_v1_high").every((row) => (
  row.residual_source_present === true && row.residual_candidates.length === 1
)));
assert.equal((await readFile(result.outputPath, "utf8")).trim().split("\n").length, 4);

const mutated = structuredClone(checkpoint);
mutated.pairs[0].arms.control.report.rows[0].request_wire_sha256 = "0".repeat(64);
const mutatedPath = join(directory, "mutated.json");
await writeFile(mutatedPath, JSON.stringify(mutated));
await assert.rejects(() => importCloudPaid105Checkpoint({
  checkpointPath: mutatedPath,
  preflightPath: paths.preflight,
  controlPayloadPath: paths.control,
  treatmentPayloadPath: paths.treatment,
  datasetPath: paths.dataset,
  sealedLabelsPath: labelsPath,
  assetIdsPath: paths.asset_ids,
  outDirectory: join(directory, "mutated-out"),
  expectedCards: 2
}), /cloud_pair_request_identity_mismatch/);

const unattested = structuredClone(checkpoint);
const unattestedRow = unattested.pairs[0].arms.control.report.rows[0];
const unattestedBody = JSON.parse(unattestedRow.provider_response_raw);
delete unattestedBody.reasoning;
unattestedRow.provider_response_raw = JSON.stringify(unattestedBody);
unattestedRow.provider_response_sha256 = sha256(unattestedRow.provider_response_raw);
unattestedRow.served_effort = "none";
unattestedRow.served_effort_attested = true;
const unattestedPath = join(directory, "unattested.json");
await writeFile(unattestedPath, JSON.stringify(unattested));
await assert.rejects(() => importCloudPaid105Checkpoint({
  checkpointPath: unattestedPath,
  preflightPath: paths.preflight,
  controlPayloadPath: paths.control,
  treatmentPayloadPath: paths.treatment,
  datasetPath: paths.dataset,
  sealedLabelsPath: labelsPath,
  assetIdsPath: paths.asset_ids,
  outDirectory: join(directory, "unattested-out"),
  expectedCards: 2
}), /cloud_pair_served_contract_invalid/,
"a row-level claim cannot substitute for the provider response echo");

process.stdout.write("cloud paid105 checkpoint importer: ok\n");
