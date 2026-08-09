import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { ARM_SPECS, imageSetFingerprint } from "../../scripts/run-thin-path-eval.mjs";
import { validateModelResidualV3FrozenRun }
  from "../../scripts/analyze-model-residual-candidate-v3-35x3.mjs";
import { withModelResidualCandidateLaneV3 } from "../accuracy/model-residual-candidate-lane-v3.mjs";
import { semanticRequestSha256 }
  from "../accuracy/model-residual-v3-screen-plan.mjs";
import accuracyHandler, { normalizedPayload, runAccuracyArm } from "./api/accuracy.js";
import { materializeResidualV3Payload, signAssetsOnlyManifest, validateAssetsOnlyManifest }
  from "./materialize-residual-v3-payload.mjs";
import { runCloudResidualV3 } from "./run-cloud-residual-v3.mjs";
import { runTokenFromKeychain } from "./cloud-io.mjs";
import { FROZEN_REQUEST_CONTRACTS, requestForAsset, requestIdentity } from "./request-contract.mjs";

const now = 1_800_000_000_000;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256" })}.${encode({ exp: Math.floor((now + 8 * 60 * 60 * 1000) / 1000) })}.sig`;
const context = { imageUrls: [], model: "gpt-5.6-luna", effort: "low", imageDetail: "high" };
const controlTemplate = ARM_SPECS.thin_canonical_high_effort_low.buildRequest(context);
const residualTemplate = withModelResidualCandidateLaneV3(controlTemplate, { enabled: true });
const controlWithoutSchema = structuredClone(controlTemplate);
const residualWithoutSchema = structuredClone(residualTemplate);
delete controlWithoutSchema.text.format.schema;
delete residualWithoutSchema.text.format.schema;
assert.deepEqual(residualWithoutSchema, controlWithoutSchema);
assert.equal(Object.keys(residualTemplate.text.format.schema.properties)[0], "residual_visible_evidence");
const preregBody = await readFile(new URL(
  "../accuracy/model-residual-candidate-v3-35x3-prereg.json", import.meta.url));
const preregSource = JSON.parse(preregBody);
const semanticControl = semanticRequestSha256(requestForAsset(controlTemplate,
  ["https://contract.invalid/front", "https://contract.invalid/back"]));
const semanticResidual = semanticRequestSha256(requestForAsset(residualTemplate,
  ["https://contract.invalid/front", "https://contract.invalid/back"]));
assert.equal(semanticControl, preregSource.frozen_contract.control_request_sha256);
assert.equal(semanticResidual, preregSource.frozen_contract.residual_request_sha256);
const assetsOnlyManifest = { schema_version: "residual-v3-assets-only-manifest-v1",
  assets: preregSource.cohort.map((card) => { const images = ["front", "back"].map((side) => ({ bucket: "cards",
    object_path: `residual-v3/${card.asset_id}-${side}.jpg`, role: `${side}_original` }));
    return { asset_id: card.asset_id, image_set_sha256: imageSetFingerprint({ images }), images }; }) };
const imageShaByAsset = new Map(assetsOnlyManifest.assets.map((asset) =>
  [asset.asset_id, asset.image_set_sha256]));
const prereg = { ...structuredClone(preregSource), cohort: preregSource.cohort.map((card) => ({
  ...structuredClone(card), image_set_sha256: imageShaByAsset.get(card.asset_id)
})) };
const preregFixtureBody = Buffer.from(JSON.stringify(prereg));
const cohort = prereg.cohort;
const assets = cohort.map((card) => ({ asset_id: card.asset_id, image_set_sha256: card.image_set_sha256,
  image_urls: ["front", "back"].map((side) =>
    `https://irpgnhkslrsiucybkufc.supabase.co/storage/v1/object/sign/cards/${card.asset_id}-${side}?token=${token}`) }));
assert.equal(validateAssetsOnlyManifest(assetsOnlyManifest), assetsOnlyManifest);
assert.throws(() => validateAssetsOnlyManifest({ ...assetsOnlyManifest, sealed_labels: [] }),
  /assets_only_manifest_invalid/);
let signCalls = 0;
const signedAssets = await signAssetsOnlyManifest(assetsOnlyManifest, { serviceKey: "storage-secret",
  fetchImpl: async (url, options) => {
    signCalls += 1;
    assert.equal(url.startsWith("https://irpgnhkslrsiucybkufc.supabase.co/storage/v1/object/sign/cards/"), true);
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, "Bearer storage-secret");
    assert.equal(JSON.parse(options.body).expiresIn, 8 * 60 * 60);
    const pathname = new URL(url).pathname.replace(/^\/storage\/v1/, "");
    return { ok: true, json: async () => ({ signedURL: `${pathname}?token=${token}` }) };
  } });
assert.equal(signCalls, 70);
assert.equal(signedAssets.length, 35);
assert.equal(signedAssets[0].image_urls.length, 2);
const payload = materializeResidualV3Payload({ prereg, assets, controlTemplate, residualTemplate,
  materializedAt: new Date(now).toISOString() });
assert.deepEqual(payload.control_a.assets, payload.control_b.assets);
assert.deepEqual(payload.control_a.assets, payload.residual_c.assets);

const env = { VERCEL_ENV: "preview", VERCEL_REGION: "sin1", LYNCA_CLOUD_SIM_ENABLED: "true",
  OPENAI_API_KEY: "configured", LYNCA_CLOUD_SIM_RUN_TOKEN: "configured",
  LYNCA_CLOUD_SIM_STORAGE_HOST: "irpgnhkslrsiucybkufc.supabase.co" };
for (const arm of ["control_a", "control_b", "residual_c"]) {
  const normalized = normalizedPayload({ arm_id: arm, run_id: "v3-test-run", concurrency: 1,
    dry_run: true, request_template: payload[arm].request_template, assets: [assets[0]] }, env);
  const report = await runAccuracyArm(normalized, { env });
  assert.equal(report.provider_calls, 0);
  assert.equal(report.reasoning_effort, "low");
}
const readinessKeys = [...Object.keys(env), "VERCEL_URL"];
const readinessBefore = Object.fromEntries(readinessKeys.map((key) => [key, process.env[key]]));
Object.assign(process.env, env, { VERCEL_URL: "preview-test.vercel.app" });
let readinessBody = null;
await accuracyHandler({ method: "GET" }, { setHeader() {}, end(value) { readinessBody = JSON.parse(value); } });
for (const [key, value] of Object.entries(readinessBefore)) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
assert.equal(readinessBody.ready, true);
assert.equal(readinessBody.schema_version, "lynca-cloud-accuracy-readiness-v2");
assert.equal(readinessBody.reasoning_effort, null);
assert.equal(readinessBody.reasoning_effort_mode, "per_arm");
assert.deepEqual(Object.keys(readinessBody.arm_request_specs),
  ["canonical_high", "canonical_residual_v1_high", "control_a", "control_b", "residual_c",
    "compact_v4_control", "compact_v4_treatment"]);
assert.equal(readinessBody.frozen_request_contracts.control_a.normalized_request_sha256,
  readinessBody.frozen_request_contracts.control_b.normalized_request_sha256);

const canonical = { recognition_status: "CONFIRMED", year: "2024", manufacturer: "Topps", brand: "",
  product: "Chrome", set: "", subset: "", language: "", players: ["Test Player"], card_name: "",
  team: "", card_type: "", official_card_type: "", observable_components: [], insert: "",
  surface_color: "", parallel_family: "", parallel_exact: "", parallel: "", variation: "",
  print_run_number: "", print_run_numerator: "", print_run_denominator: "", numbered_to: "",
  serial_number: "", numerical_rarity: "", card_number: "", tcg_card_number: "", collector_number: "",
  checklist_code: "", attributes: [], grade_company: "", card_grade: "", auto_grade: "",
  grade_type: "", cert_number: "", rc: false, first_bowman: false, ssp: false, case_hit: false,
  auto: false, patch: false, relic: false, jersey: false, sketch: false, redemption: false,
  one_of_one: false, multi_card: false, card_count: null, lot_type: "", field_evidence: [], unresolved: [] };

function cloudReport({ body }) {
  const asset = body.assets[0]; const isResidual = body.arm_id === "residual_c";
  const actual = requestIdentity(requestForAsset(body.request_template, asset.image_urls));
  const frozen = FROZEN_REQUEST_CONTRACTS[body.arm_id];
  return Promise.resolve({ ok: true, provider_calls: 1, provider_retries: 0, arm_id: body.arm_id,
    run_id: body.run_id, environment: "preview", region: "sin1",
    deployment_hostname: "preview-test.vercel.app", storage_host: "irpgnhkslrsiucybkufc.supabase.co",
    model: "gpt-5.6-luna", reasoning_effort: "low", requested_effort: "low", image_detail: "high",
    contract_normalized_request_sha256: frozen.normalized_request_sha256,
    contract_normalized_request_bytes: frozen.normalized_request_bytes,
    contract_wire_sha256: frozen.contract_wire_sha256, contract_wire_bytes: frozen.contract_wire_bytes,
    rows: [{ ok: true, asset_id: asset.asset_id, image_set_sha256: asset.image_set_sha256,
      normalized_request_sha256: actual.normalized_request_sha256,
      normalized_request_bytes: actual.normalized_request_bytes,
      request_wire_sha256: actual.wire_sha256, request_wire_bytes: actual.wire_bytes,
      provider_response_id: `resp-${body.run_id}`,
      provider_response_sha256: "a".repeat(64), structured_output_raw_sha256: "b".repeat(64),
      served_model: "gpt-5.6-luna", requested_effort: "low", served_effort: "low", latency_ms: 10,
      input_tokens: 100, cached_input_tokens: 0, output_tokens: 40,
      structured_output: isResidual ? { residual_visible_evidence: [], ...canonical } : canonical }] });
}

const directory = await mkdtemp(join(tmpdir(), "v3-cloud-runner-"));
const outPath = join(directory, "checkpoint.json");
const preflightInvoke = async ({ body }) => ({ ok: true, arm_id: body.arm_id,
  provider_calls: 0, provider_retries: 0 });
let boundaryCase = 0;
async function assertInputBoundaryRejects({ badPrereg = prereg, badPayload = payload, pattern }) {
  let invokes = 0; boundaryCase += 1;
  await assert.rejects(() => runCloudResidualV3({ prereg: badPrereg, payload: badPayload,
    deployment: "https://preview-test.vercel.app",
    outPath: join(directory, `rejected-${boundaryCase}.json`), runId: `v3-reject-${boundaryCase}`,
    runToken: "token", dryRun: true, nowMs: () => now,
    invoke: async () => { invokes += 1; } }), pattern);
  assert.equal(invokes, 0);
}
const payloadTopLabel = structuredClone(payload);
payloadTopLabel.sealed_labels = [];
await assertInputBoundaryRejects({ badPayload: payloadTopLabel, pattern: /payload_shape_invalid/ });
const payloadAssetLabel = structuredClone(payload);
for (const arm of ["control_a", "control_b", "residual_c"]) {
  payloadAssetLabel[arm].assets[0].reviewed_title = "forbidden";
}
await assertInputBoundaryRejects({ badPayload: payloadAssetLabel, pattern: /asset_shape_invalid/ });
const preregLabel = structuredClone(prereg);
preregLabel.design.nested_review_input = { reviewed_title: "forbidden" };
await assertInputBoundaryRejects({ badPrereg: preregLabel,
  pattern: /forbidden_execution_key:prereg.*reviewed_title/ });
const preflight = await runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath, runId: "v3-test-run", runToken: "token",
  dryRun: true, nowMs: () => now, invoke: preflightInvoke });
assert.equal(preflight.state, "PREFLIGHT_COMPLETE");
assert.equal(preflight.preflight_provider_calls, 0);
const poisonedCheckpointPath = join(directory, "poisoned-checkpoint.json");
await writeFile(poisonedCheckpointPath, JSON.stringify({ ...preflight,
  nested_execution_input: { sealed_labels: [] } }), "utf8");
let poisonedCheckpointInvokes = 0;
await assert.rejects(() => runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath: poisonedCheckpointPath,
  runId: "v3-test-run", runToken: "token", dryRun: true, nowMs: () => now,
  invoke: async () => { poisonedCheckpointInvokes += 1; } }),
/forbidden_execution_key:checkpoint.*sealed_labels/);
assert.equal(poisonedCheckpointInvokes, 0);
let unauthorizedInvokes = 0;
await assert.rejects(() => runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath, runId: "v3-test-run", runToken: "token",
  nowMs: () => now, invoke: async () => { unauthorizedInvokes += 1; } }),
  /independent_authorization_required/);
assert.equal(unauthorizedInvokes, 0);
const authorization = { schema_version: "model-residual-v3-paid105-authorization-v1",
  execution_surface: "vercel_preview_only", authorized: true,
  prereg_sha256: preflight.prereg_sha256, payload_sha256: preflight.payload_sha256,
  sealed_labels_sha256: prereg.analysis_inputs.sealed_labels_sha256,
  run_id: "v3-test-run", deployment_hostname: "preview-test.vercel.app",
  run_fingerprint: preflight.run_fingerprint, max_provider_attempts: 105 };
let invalidAuthorizationInvokes = 0;
await assert.rejects(() => runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath, runId: "v3-test-run", runToken: "token",
  authorization: { ...authorization, reviewed_title: "forbidden" }, nowMs: () => now,
  invoke: async () => { invalidAuthorizationInvokes += 1; } }),
/forbidden_execution_key:authorization.*reviewed_title/);
assert.equal(invalidAuthorizationInvokes, 0);
let wrongOracleInvokes = 0;
await assert.rejects(() => runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath, runId: "v3-test-run", runToken: "token",
  authorization: { ...authorization, sealed_labels_sha256: "0".repeat(64) }, nowMs: () => now,
  invoke: async () => { wrongOracleInvokes += 1; } }), /independent_authorization_required/);
assert.equal(wrongOracleInvokes, 0);
let active = 0; let maximumActive = 0; let calls = 0;
const complete = await runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath, runId: "v3-test-run", runToken: "token",
  authorization,
  nowMs: () => now, invoke: async (args) => {
    active += 1; maximumActive = Math.max(maximumActive, active); calls += 1;
    const report = await cloudReport(args); active -= 1; return report;
  } });
assert.equal(complete.state, "COMPLETE");
assert.equal(complete.provider_attempts, 105);
assert.equal(complete.provider_calls, 105);
assert.equal(calls, 105);
assert.equal(maximumActive, 1);
const first = Object.values(complete.jobs)[0];
assert.equal(first.result.request_attempt_count, 1);
assert.equal(first.result.requested_effort, "low");
assert.equal(first.result.canonical_title.length > 0, true);
assert.equal(first.result.run_fingerprint, complete.run_fingerprint);
assert.equal(first.result.provider_response_sha256, "a".repeat(64));
assert.equal(first.result.structured_output_raw_sha256, "b".repeat(64));
assert.equal(first.result.structured_output_envelope_sha256.length, 64);
assert.deepEqual(first.result.structured_output_envelope,
  first.arm === "residual_c" ? { residual_visible_evidence: [], ...canonical } : canonical);
assert.equal(complete.authorization_receipt_sha256.length, 64);
const expectedFirst = requestIdentity(requestForAsset(
  payload[first.arm].request_template, payload[first.arm].assets
    .find((asset) => asset.asset_id === first.asset_id).image_urls));
assert.equal(first.result.request_sha256, expectedFirst.wire_sha256);
assert.equal(first.result.request_wire_sha256, expectedFirst.wire_sha256);
assert.equal(first.result.normalized_request_sha256, expectedFirst.normalized_request_sha256);
assert.equal(first.result.semantic_request_sha256,
  first.arm === "residual_c" ? semanticResidual : semanticControl);
assert.notEqual(first.result.semantic_request_sha256, first.result.normalized_request_sha256);
assert.notEqual(first.result.normalized_request_sha256, first.result.request_wire_sha256);
const analyzerValidated = validateModelResidualV3FrozenRun({ preregBody: preregFixtureBody,
  payloadBody: Buffer.from(JSON.stringify(payload)), checkpointBody: Buffer.from(JSON.stringify(complete)) });
assert.equal(analyzerValidated.completion.status, "COMPLETE");
assert.equal(analyzerValidated.rows.length, 105);

const resumed = await runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath, runId: "v3-test-run", runToken: "token",
  authorization,
  nowMs: () => now, invoke: async () => { throw new Error("complete checkpoint must not invoke"); } });
assert.equal(resumed.state, "COMPLETE");

const tamperedPath = join(directory, "tampered-complete.json");
const tampered = structuredClone(complete);
Object.values(tampered.jobs)[0].result.request_sha256 = "0".repeat(64);
await writeFile(tamperedPath, JSON.stringify(tampered), "utf8");
let tamperedInvokes = 0;
await assert.rejects(() => runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath: tamperedPath,
  runId: "v3-test-run", runToken: "token", authorization, nowMs: () => now,
  invoke: async () => { tamperedInvokes += 1; } }), /complete_checkpoint_identity_invalid/);
assert.equal(tamperedInvokes, 0);

const ttlPath = join(directory, "ttl-expiry.json");
const ttlRunId = "v3-ttl-run";
await runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath: ttlPath, runId: ttlRunId,
  runToken: "token", dryRun: true, nowMs: () => now, invoke: preflightInvoke });
const ttlPreflight = JSON.parse(await readFile(ttlPath, "utf8"));
const ttlAuthorization = { schema_version: "model-residual-v3-paid105-authorization-v1",
  execution_surface: "vercel_preview_only", authorized: true,
  prereg_sha256: ttlPreflight.prereg_sha256, payload_sha256: ttlPreflight.payload_sha256,
  sealed_labels_sha256: prereg.analysis_inputs.sealed_labels_sha256,
  run_id: ttlRunId, deployment_hostname: "preview-test.vercel.app",
  run_fingerprint: ttlPreflight.run_fingerprint, max_provider_attempts: 105 };
const tokenExpiryMs = Math.floor((now + 8 * 60 * 60 * 1000) / 1000) * 1000;
let ttlClockReads = 0; let ttlInvokes = 0;
await assert.rejects(() => runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath: ttlPath, runId: ttlRunId,
  runToken: "token", authorization: ttlAuthorization,
  nowMs: () => ttlClockReads++ === 0 ? now : tokenExpiryMs - 179_999,
  invoke: async () => { ttlInvokes += 1; } }), /job_signed_url_ttl_insufficient/);
assert.equal(ttlInvokes, 0);
assert.equal(JSON.parse(await readFile(ttlPath, "utf8")).provider_attempts, 0);

const failPath = join(directory, "failed.json"); let failedCalls = 0;
await runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath: failPath, runId: "v3-fail-run", runToken: "token",
  dryRun: true, nowMs: () => now, invoke: preflightInvoke });
const failedPreflight = JSON.parse(await readFile(failPath, "utf8"));
const failedAuthorization = { schema_version: "model-residual-v3-paid105-authorization-v1",
  execution_surface: "vercel_preview_only", authorized: true,
  prereg_sha256: failedPreflight.prereg_sha256, payload_sha256: failedPreflight.payload_sha256,
  sealed_labels_sha256: prereg.analysis_inputs.sealed_labels_sha256,
  run_id: "v3-fail-run", deployment_hostname: "preview-test.vercel.app",
  run_fingerprint: failedPreflight.run_fingerprint, max_provider_attempts: 105 };
await assert.rejects(() => runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath: failPath, runId: "v3-fail-run", runToken: "token",
  authorization: failedAuthorization,
  nowMs: () => now, invoke: async () => { failedCalls += 1; throw new Error("ambiguous"); } }), /ambiguous/);
assert.equal(failedCalls, 1);
await assert.rejects(() => runCloudResidualV3({ prereg, payload,
  deployment: "https://preview-test.vercel.app", outPath: failPath, runId: "v3-fail-run", runToken: "token",
  authorization: failedAuthorization,
  nowMs: () => now, invoke: async () => { failedCalls += 1; } }), /unretryable_prior_attempt/);
assert.equal(failedCalls, 1);
const failed = JSON.parse(await readFile(failPath, "utf8"));
assert.equal(failed.provider_attempts, 1);

const spawnImpl = (command, args, options) => {
  const child = new EventEmitter(); child.stdout = new PassThrough();
  queueMicrotask(() => {
    assert.equal(command, "security");
    assert.deepEqual(args.slice(0, 5), ["find-generic-password", "-a", "lynca-cloud-sim",
      "-s", "lynca-cloud-sim-preview-run-token"]);
    assert.equal(args.some((value) => value.includes("runner-secret")), false);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"]);
    child.stdout.end("runner-secret\n");
    child.emit("close", 0);
  });
  return child;
};
assert.equal(await runTokenFromKeychain({ spawnImpl }), "runner-secret");
await assert.rejects(() => runTokenFromKeychain({ spawnImpl: (command, _args, _options) => {
  assert.equal(command, "security");
  const child = new EventEmitter(); child.stdout = new PassThrough();
  queueMicrotask(() => { child.stdout.end(); child.emit("close", 0); });
  return child;
} }), /cloud_sim_run_token_unavailable/);
console.log("cloud residual v3 tests passed");
