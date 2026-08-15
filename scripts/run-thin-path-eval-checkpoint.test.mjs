#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import {
  ARM_SPECS,
  acquireOutDirLock,
  buildRunManifest,
  callProviderWithRetry,
  evaluationCardIdentity,
  imageSetFingerprint,
  main,
  requestFingerprint,
  setReviewedCorpus,
  validateCheckpointRows
} from "./run-thin-path-eval.mjs";
import { withResidualEvidenceLaneV1 } from "../lib/listing/thin/residual-evidence-lane-v1.mjs";
import { foldFor } from "../lib/listing/evaluation/kfold-few-shot.mjs";
import {
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT,
  CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA
} from "../lib/listing/thin/captured-production-e1ae-assets.mjs";

const root = await mkdtemp(join(tmpdir(), "thin-eval-checkpoint-adversarial-"));
const model = "gpt-5.6-luna";
const effort = "none";
const imageDetail = "high";
const armFor = (key) => ({ key, ...ARM_SPECS[key] });

async function fixture(name, items = [{
  asset_id: "asset-a",
  physical_card_id: "physical-a",
  sealed_eval_label_ref: { key: "label-a" },
  images: []
}]) {
  const evalRoot = join(root, name, "eval");
  const outDir = join(root, name, "out");
  const dataset = join(evalRoot, "dataset.json");
  const sealedLabels = join(evalRoot, "labels.jsonl");
  const assetIdsFile = join(root, name, "asset-ids.json");
  const scorer = join(evalRoot, "scripts", "evaluate-cloud-listing-api.mjs");
  await mkdir(join(evalRoot, "scripts"), { recursive: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(scorer, "export const policyFairTokenRecall = () => 1;\n");
  await writeFile(dataset, `${JSON.stringify({ items })}\n`);
  await writeFile(sealedLabels, `${items.map((item, index) => JSON.stringify({
    key: item.sealed_eval_label_ref.key,
    title: index ? "Beta" : "Alpha",
    reviewed_title: index ? "Beta" : "Alpha"
  })).join("\n")}\n`);
  await writeFile(assetIdsFile, `${JSON.stringify(items.map(({ asset_id }) => asset_id))}\n`);
  return { evalRoot, outDir, dataset, sealedLabels, assetIdsFile, scorer, items };
}

function checkpointRow({ item, arm, manifest, reference = "Alpha" }) {
  const armEffort = arm.effort ?? effort;
  const request = arm.buildRequest({
    imageUrls: [], model, effort: armEffort, imageDetail,
    cardKey: evaluationCardIdentity(item)
  });
  return {
    asset_id: item.asset_id,
    arm: arm.key,
    image_detail: arm.imageDetail || imageDetail,
    score: 1,
    f1: 1,
    recall: 1,
    precision: 1,
    title: reference,
    raw_title: reference,
    reference,
    length: reference.length,
    latency_ms: 1,
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    model,
    served_model: model,
    requested_effort: armEffort,
    served_effort: armEffort,
    served_effort_attested: true,
    request_sha256: requestFingerprint(request),
    image_set_sha256: imageSetFingerprint(item),
    image_count: 0,
    request_attempt_count: 1,
    run_fingerprint: manifest.fingerprint,
    finisher_fingerprint: manifest.finisher.fingerprint,
    arm_eval_version: arm.evalVersion || null,
    fields: {},
    low_confidence_fields: [],
    unreadable_fields: []
  };
}

try {
  const response = (status, body, retryAfter = null) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "retry-after" ? retryAfter : null },
    json: async () => body
  });
  const retrySequence = [
    response(429, { error: { code: "rate_limit", message: "slow down" } }, "1"),
    response(503, { error: { code: "server_error" } }),
    response(200, { output_text: "ok" })
  ];
  const retryRecords = [];
  const retrySleeps = [];
  let retryCalls = 0;
  const retried = await callProviderWithRetry({
    request: {}, maxAttempts: 3,
    callProvider: async () => retrySequence[retryCalls++],
    recordAttempt: async (entry) => retryRecords.push(entry),
    sleepImpl: async (delay) => retrySleeps.push(delay),
    random: () => 0
  });
  assert.equal(retried.ok, true);
  assert.equal(retryCalls, 3);
  assert.equal(retryRecords.length, 3);
  assert.deepEqual(retryRecords.map(({ will_retry }) => will_retry), [true, true, false]);
  assert.deepEqual(retrySleeps, [1000, 1000]);
  let failFastCalls = 0;
  const failedFast = await callProviderWithRetry({
    request: {}, maxAttempts: 3,
    callProvider: async () => { failFastCalls += 1; return response(400, { error: { code: "rate_limit" } }); },
    sleepImpl: async () => assert.fail("non-retryable 4xx must not sleep")
  });
  assert.equal(failedFast.ok, false);
  assert.equal(failFastCalls, 1);
  let bodyErrorCalls = 0;
  const bodyErrorRecovered = await callProviderWithRetry({
    request: {}, maxAttempts: 2,
    callProvider: async () => ++bodyErrorCalls === 1
      ? response(200, { error: { type: "temporarily_unavailable" } })
      : response(200, { output_text: "ok" }),
    sleepImpl: async () => {}, random: () => 0
  });
  assert.equal(bodyErrorRecovered.ok, true);
  assert.equal(bodyErrorCalls, 2);

  const promptRequest = ARM_SPECS.thin_budgeted.buildRequest({
    imageUrls: ["https://example.invalid/card.jpg"], model, effort, imageDetail: "original"
  });
  assert.equal(promptRequest.input[0].content.find(({ type }) => type === "input_image").detail, "original");

  const parityContext = {
    imageUrls: [
      "https://example.invalid/front.jpg",
      "https://example.invalid/back.jpg"
    ],
    model,
    effort: "none",
    imageDetail: "original"
  };
  const activeRequest = ARM_SPECS.runtime_active_high_low.buildRequest(parityContext);
  const repeatRequest = ARM_SPECS.runtime_active_high_low_repeat.buildRequest(parityContext);
  const originalRequest = ARM_SPECS.runtime_active_detail_original_low.buildRequest(parityContext);
  const directRequest = ARM_SPECS.lynca_csm_direct_title_high_low.buildRequest(parityContext);
  assert.deepEqual(repeatRequest, activeRequest,
    "the A/A arm must be provider-byte-equivalent to the active runtime baseline");
  assert.equal(activeRequest.input[0].content[0].text,
    CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT);
  assert.deepEqual(activeRequest.text.format.schema,
    CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA);
  assert.equal(activeRequest.reasoning.effort, "low");
  assert.equal(activeRequest.max_output_tokens, 8192);
  assert.equal(Object.hasOwn(activeRequest, "tools"), false);
  assert.equal(Object.hasOwn(activeRequest, "temperature"), false);
  assert.equal(Object.hasOwn(activeRequest, "top_p"), false);
  assert.equal(Object.hasOwn(activeRequest, "seed"), false);
  assert.deepEqual(
    activeRequest.input[0].content.filter(({ type }) => type === "input_image"),
    directRequest.input[0].content.filter(({ type }) => type === "input_image")
  );
  assert.deepEqual(directRequest.reasoning, activeRequest.reasoning);
  assert.equal(directRequest.max_output_tokens, activeRequest.max_output_tokens);
  assert.equal(Object.hasOwn(directRequest, "text"), false);
  assert.equal(Object.hasOwn(directRequest, "tools"), false);
  assert.notEqual(requestFingerprint(directRequest), requestFingerprint(activeRequest));
  assert.deepEqual(
    originalRequest.input[0].content.filter(({ type }) => type === "input_image")
      .map(({ detail }) => detail),
    ["original", "original"]
  );
  assert.deepEqual(
    activeRequest.input[0].content.filter(({ type }) => type === "input_image")
      .map(({ detail }) => detail),
    ["high", "high"]
  );

  const activePayload = ARM_SPECS.runtime_active_high_low.extract({
    status: "completed",
    model,
    reasoning: { effort: "low" },
    output_text: JSON.stringify({
      year: "2024", manufacturer: "Topps", product: "Chrome", set: "",
      subjects: ["A Player"], team: "", card_name: "", release_variant: "",
      surface_color: "Gold", parallel_family: "Refractor", parallel_exact: "",
      descriptive_rarity: "", card_number: "1", serial: "01/50",
      attributes: [], grading_info: {
        company: "", card_grade: "", auto_grade: "", grade_type: ""
      },
      grammar: "standard", lot_count: "", language: "", unreadable: [],
      low_confidence: [], special_stamp: "", description: ""
    })
  });
  const activeFinished = ARM_SPECS.runtime_active_high_low.finish(activePayload);
  assert.match(activeFinished.title, /^2024 Topps Chrome A Player/);
  assert.ok(activeFinished.length <= 80);

  const residualContext = {
    imageUrls: ["https://example.invalid/front.jpg", "https://example.invalid/back.jpg"],
    model,
    effort,
    imageDetail
  };
  const controlResidualRequest = ARM_SPECS.thin_canonical_high.buildRequest(residualContext);
  const treatmentResidualRequest = ARM_SPECS.thin_canonical_residual_v1_high.buildRequest(residualContext);
  assert.deepEqual(treatmentResidualRequest, withResidualEvidenceLaneV1(controlResidualRequest, { enabled: true }));
  assert.notEqual(requestFingerprint(controlResidualRequest), requestFingerprint(treatmentResidualRequest));
  assert.equal(treatmentResidualRequest.model, controlResidualRequest.model);
  assert.deepEqual(treatmentResidualRequest.reasoning, controlResidualRequest.reasoning);
  assert.equal(treatmentResidualRequest.max_output_tokens, controlResidualRequest.max_output_tokens);
  assert.deepEqual(
    treatmentResidualRequest.input[0].content.filter(({ type }) => type === "input_image"),
    controlResidualRequest.input[0].content.filter(({ type }) => type === "input_image")
  );
  const residualFinished = ARM_SPECS.thin_canonical_residual_v1_high.finish(JSON.stringify({
    grammar: "standard",
    year: "2024",
    manufacturer: "Topps",
    product: "Chrome",
    subjects: ["A Player"],
    serial: "8/25",
    residual_evidence: [{ text: "08/25", target: "serial", anchor: "stamped_number" }]
  }));
  assert.equal(residualFinished.residual_source_present, true);
  assert.equal(residualFinished.residual_replay_candidates.length, 1);
  assert.equal(residualFinished.residual_canonical_fields_unchanged, true);

  const base = await fixture("manifest");
  const canonicalArm = armFor("thin_canonical_high");
  const evidenceArm = armFor("thin_canonical_bounded_evidence_v2_high");
  const candidateArm = armFor("candidate_expression_v3_high");
  const manifestInput = {
    model, effort, imageDetail, limit: 1,
    dataset: base.dataset,
    sealedLabels: base.sealedLabels,
    assetIdsFile: base.assetIdsFile,
    scorer: base.scorer,
    selectedAssetIds: ["asset-a"],
    selectionRole: "development_screen"
  };
  const canonicalManifest = await buildRunManifest({ ...manifestInput, arms: [canonicalArm] });
  const evidenceManifest = await buildRunManifest({ ...manifestInput, arms: [evidenceArm] });
  const candidateManifest = await buildRunManifest({ ...manifestInput, arms: [candidateArm] });
  const residualArm = armFor("thin_canonical_residual_v1_high");
  const residualManifest = await buildRunManifest({ ...manifestInput, arms: [residualArm] });
  const canonicalSources = Object.keys(canonicalManifest.finisher.contract.source_sha256);
  const evidenceSources = Object.keys(evidenceManifest.finisher.contract.source_sha256);
  const candidateSources = Object.keys(candidateManifest.finisher.contract.source_sha256);
  const residualSources = Object.keys(residualManifest.finisher.contract.source_sha256);
  assert.ok(canonicalSources.some((name) => name.includes("sem-definition.mjs")));
  assert.ok(canonicalSources.some((name) => name.includes("product-semantics.mjs")));
  assert.ok(canonicalSources.some((name) => name.includes("marketplace-composer-rules.mjs")));
  assert.ok(canonicalSources.some((name) => name.includes("sanitize-listing-title.mjs")));
  assert.ok(canonicalSources.some((name) => name.startsWith("scorer:")));
  assert.ok(!canonicalSources.some((name) => name.includes("bounded-evidence-v2.mjs")));
  assert.ok(evidenceSources.some((name) => name.includes("bounded-evidence-v2.mjs")));
  assert.ok(candidateSources.some((name) => name.includes("candidate-expression-v3.mjs")));
  assert.ok(!candidateSources.some((name) => name.includes("canonical-fields.mjs")),
    "candidate-first v3 must not acquire a canonical-schema source dependency");
  assert.ok(residualSources.some((name) => name.includes("residual-evidence-lane-v1.mjs")));
  assert.equal(residualManifest.contract.arms[0].response_schema_name, "canonical_card_fields_residual_v1");
  assert.notEqual(residualManifest.fingerprint, canonicalManifest.fingerprint);
  assert.equal(candidateManifest.contract.arms[0].response_schema_name, "card_candidate_expression_v3");
  assert.deepEqual(Object.keys(evidenceManifest.contract.source_sha256), ["provider_request_behavior"]);
  assert.ok(!JSON.stringify(evidenceManifest.contract).includes(evidenceManifest.finisher.fingerprint),
    "resolver/finisher identity must remain outside the paid provider fingerprint");
  assert.notEqual((await buildRunManifest({
    ...manifestInput, arms: [canonicalArm], selectionRole: "confirmatory"
  })).fingerprint, canonicalManifest.fingerprint);
  assert.notEqual((await buildRunManifest({
    ...manifestInput, arms: [canonicalArm], concurrency: 120
  })).fingerprint, canonicalManifest.fingerprint);

  // Every selectable arm must close over an explicit source root. In
  // particular, all eight pinned-effort arms used to silently contribute no
  // source files, and their manifest templates were hashed at the run-level
  // effort instead of the effort actually sent.
  const allArms = Object.keys(ARM_SPECS).map(armFor);
  const allArmsManifest = await buildRunManifest({ ...manifestInput, arms: allArms });
  assert.equal(allArmsManifest.contract.arms.length, allArms.length);
  for (const armKey of [
    "thin_canonical_high_effort_none",
    "thin_canonical_high_effort_low",
    "thin_canonical_fewshot_low",
    "thin_canonical_serial_parts_low",
    "thin_canonical_kfold_fewshot_low",
    "thin_canonical_low_targeted",
    "thin_canonical_high_effort_medium",
    "thin_canonical_high_effort_max"
  ]) {
    const arm = armFor(armKey);
    const actual = arm.buildRequest({
      imageUrls: [], model, effort: arm.effort ?? effort, imageDetail,
      cardKey: evaluationCardIdentity(base.items[0])
    });
    const frozen = allArmsManifest.contract.arms.find(({ key }) => key === armKey);
    assert.equal(frozen.request_template_sha256[0], requestFingerprint(actual),
      `${armKey} must hash the request it actually sends`);
  }

  const item = base.items[0];
  const labels = new Map([["label-a", "Alpha"]]);
  const validRow = checkpointRow({ item, arm: canonicalArm, manifest: canonicalManifest });
  const validate = (rows) => validateCheckpointRows(`${rows.map(JSON.stringify).join("\n")}\n`, {
    arms: [canonicalArm], items: [item], labels,
    runFingerprint: canonicalManifest.fingerprint,
    finisherFingerprint: canonicalManifest.finisher.fingerprint,
    model, effort, imageDetail
  });
  assert.equal(validate([validRow]).size, 1);
  assert.throws(() => validate([{ ...validRow, run_fingerprint: "wrong" }]), /checkpoint_row_fingerprint_mismatch/);
  assert.throws(() => validate([{ ...validRow, finisher_fingerprint: "old" }]), /checkpoint_finisher_replay_required/);
  assert.throws(() => validate([{ ...validRow, arm: "thin_budgeted" }]), /checkpoint_row_unexpected_arm/);
  assert.throws(() => validate([{ ...validRow, asset_id: "outside" }]), /checkpoint_row_outside_selected_cohort/);
  assert.throws(() => validate([{ ...validRow, reference: "wrong" }]), /checkpoint_reference_mismatch/);
  assert.throws(() => validate([{ ...validRow, request_sha256: "wrong" }]), /checkpoint_request_shape_mismatch/);
  assert.throws(() => validate([validRow, validRow]), /checkpoint_duplicate_key/);

  const lockDir = join(root, "locks");
  await mkdir(lockDir, { recursive: true });
  const release = await acquireOutDirLock(lockDir);
  await assert.rejects(() => acquireOutDirLock(lockDir), /evaluation_out_dir_locked/);
  await release();
  const stalePath = join(lockDir, ".thin-path-eval.lock");
  await mkdir(stalePath);
  await writeFile(join(stalePath, "owner.json"), JSON.stringify({ pid: 999999, hostname: hostname() }));
  const releaseRecovered = await acquireOutDirLock(lockDir, { processAlive: () => false });
  await releaseRecovered();
  await mkdir(stalePath);
  const releaseUnknown = await acquireOutDirLock(lockDir, { unknownLockStaleMs: 0 });
  await releaseUnknown();

  const integration = await fixture("integration");
  const integrationArm = armFor("thin_canonical_high");
  const integrationManifest = await buildRunManifest({
    arms: [integrationArm], model, effort, imageDetail, limit: 1,
    dataset: integration.dataset, sealedLabels: integration.sealedLabels,
    assetIdsFile: integration.assetIdsFile, scorer: integration.scorer,
    selectedAssetIds: ["asset-a"], selectionRole: "development_screen", concurrency: 2
  });
  await writeFile(join(integration.outDir, `thin-path-${model}.manifest.json`), `${JSON.stringify(integrationManifest)}\n`);
  await writeFile(join(integration.outDir, `thin-path-${model}.jsonl`), `${JSON.stringify(checkpointRow({
    item: integration.items[0], arm: integrationArm, manifest: integrationManifest
  }))}\n`);
  const previousFetch = globalThis.fetch;
  const previousStdout = process.stdout.write;
  const previousStderr = process.stderr.write;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("provider_must_not_be_called"); };
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SECRET_KEY = "dummy";
  process.env.OPENAI_API_KEY = "dummy";
  const mainArgs = [
    "--eval-root", integration.evalRoot,
    "--dataset", "dataset.json",
    "--sealed-labels", "labels.jsonl",
    "--asset-ids-file", integration.assetIdsFile,
    "--arms", integrationArm.key,
    "--limit", "1",
    "--selection-role", "development_screen",
    "--out-dir", integration.outDir
  ];
  try {
    const summary = await main(mainArgs);
    assert.equal(summary.arms[0].n, 1);
    const completedCheckpointPath = join(integration.outDir, `thin-path-${model}.jsonl`);
    const completedCheckpointBody = await readFile(completedCheckpointPath);
    const beforePoisonAttempt = JSON.parse(await readFile(
      join(integration.outDir, `thin-path-${model}.manifest.json`), "utf8"
    ));
    assert.equal(beforePoisonAttempt.checkpoint_rows, 1);
    assert.equal(beforePoisonAttempt.checkpoint_bytes, completedCheckpointBody.length);
    assert.equal(
      beforePoisonAttempt.checkpoint_sha256,
      createHash("sha256").update(completedCheckpointBody).digest("hex")
    );
    await assert.rejects(() => main(mainArgs.map((value, index, values) => (
      values[index - 1] === "--limit" ? "2" : value
    ))), /selected_asset_count_mismatch:1\/2/);
    const afterPoisonAttempt = JSON.parse(await readFile(
      join(integration.outDir, `thin-path-${model}.manifest.json`), "utf8"
    ));
    assert.equal(afterPoisonAttempt.max_requested_limit, beforePoisonAttempt.max_requested_limit);
    await assert.rejects(() => main([
      ...mainArgs.slice(0, mainArgs.indexOf("--arms") + 1),
      `${integrationArm.key},${integrationArm.key}`,
      ...mainArgs.slice(mainArgs.indexOf("--arms") + 2)
    ]), /duplicate_arms_not_allowed/);
    const tamperedRow = JSON.parse(completedCheckpointBody.toString("utf8").trim());
    tamperedRow.raw_title = "tampered-after-completion";
    await writeFile(completedCheckpointPath, `${JSON.stringify(tamperedRow)}\n`);
    await assert.rejects(() => main(mainArgs), /checkpoint_sha256_mismatch/);
  } finally {
    globalThis.fetch = previousFetch;
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  assert.equal(networkCalls, 0);

  const replay = await fixture("replay");
  const replayManifest = await buildRunManifest({
    arms: [integrationArm], model, effort, imageDetail, limit: 1,
    dataset: replay.dataset, sealedLabels: replay.sealedLabels,
    assetIdsFile: replay.assetIdsFile, scorer: replay.scorer,
    selectedAssetIds: ["asset-a"], concurrency: 2
  });
  const staleManifest = structuredClone(replayManifest);
  staleManifest.finisher.fingerprint = "old-finisher";
  const staleRow = checkpointRow({ item: replay.items[0], arm: integrationArm, manifest: replayManifest });
  staleRow.finisher_fingerprint = "old-finisher";
  await writeFile(join(replay.outDir, `thin-path-${model}.manifest.json`), `${JSON.stringify(staleManifest)}\n`);
  await writeFile(join(replay.outDir, `thin-path-${model}.jsonl`), `${JSON.stringify(staleRow)}\n`);
  globalThis.fetch = async () => { throw new Error("provider_must_not_be_called"); };
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    await assert.rejects(() => main([
      "--eval-root", replay.evalRoot,
      "--dataset", "dataset.json",
      "--sealed-labels", "labels.jsonl",
      "--asset-ids-file", replay.assetIdsFile,
      "--arms", integrationArm.key,
      "--limit", "1",
      "--out-dir", replay.outDir
    ]), /checkpoint_finisher_replay_required/);
  } finally {
    globalThis.fetch = previousFetch;
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }

  const retryIntegration = await fixture("retry-integration");
  let retryIntegrationCalls = 0;
  const retryFetch = async () => {
    retryIntegrationCalls += 1;
    return retryIntegrationCalls === 1
      ? response(503, { error: { code: "server_error", message: "retry" } }, "0")
      : response(200, {
          output_text: "Alpha",
          model,
          reasoning: { effort },
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 }
        });
  };
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    const retrySummary = await main([
      "--eval-root", retryIntegration.evalRoot,
      "--dataset", "dataset.json",
      "--sealed-labels", "labels.jsonl",
      "--asset-ids-file", retryIntegration.assetIdsFile,
      "--arms", "thin_budgeted",
      "--limit", "1",
      "--max-attempts", "2",
      "--out-dir", retryIntegration.outDir
    ], { fetchImpl: retryFetch, sleepImpl: async () => {}, random: () => 0 });
    assert.equal(retrySummary.arms[0].n, 1);
  } finally {
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  assert.equal(retryIntegrationCalls, 2);
  const retryCheckpoint = (await readFile(
    join(retryIntegration.outDir, `thin-path-${model}.jsonl`), "utf8"
  )).trim().split("\n").map(JSON.parse);
  assert.equal(retryCheckpoint.length, 1, "a retried success must produce exactly one scored row");
  assert.equal(retryCheckpoint[0].request_attempt_count, 2);
  assert.equal(retryCheckpoint[0].provider_attempts.length, 2);
  assert.equal(retryCheckpoint[0].served_effort_attested, true);
  const retryAttemptLog = (await readFile(
    join(retryIntegration.outDir, `thin-path-${model}.attempts.jsonl`), "utf8"
  )).trim().split("\n").map(JSON.parse);
  assert.deepEqual(retryAttemptLog.map(({ event }) => event), [
    "provider_attempt", "provider_attempt", "final_status"
  ]);
  assert.equal(retryAttemptLog.at(-1).status, "checkpoint_committed");

  const frontierFront = join(root, "frontier-front.jpg");
  const frontierBack = join(root, "frontier-back.jpg");
  const frontBytes = Buffer.from("frontier-front-image");
  const backBytes = Buffer.from("frontier-back-image");
  await writeFile(frontierFront, frontBytes);
  await writeFile(frontierBack, backBytes);
  const frontierItem = {
    asset_id: "asset-frontier",
    physical_card_id: "physical-frontier",
    sealed_eval_label_ref: { key: "label-frontier" },
    images: [
      {
        role: "front_original",
        local_path: frontierFront,
        content_type: "image/jpeg",
        content_sha256: createHash("sha256").update(frontBytes).digest("hex")
      },
      {
        role: "back_original",
        local_path: frontierBack,
        content_type: "image/jpeg",
        content_sha256: createHash("sha256").update(backBytes).digest("hex")
      }
    ]
  };
  const frontierPayload = {
    year: "2024", manufacturer: "Topps", product: "Chrome", set: "",
    subjects: ["Alpha"], team: "", card_name: "", release_variant: "",
    surface_color: "", parallel_family: "", parallel_exact: "",
    descriptive_rarity: "", card_number: "", serial: "", attributes: [],
    grading_info: { company: "", card_grade: "", auto_grade: "", grade_type: "" },
    grammar: "standard", lot_count: "", language: "", unreadable: [],
    low_confidence: [], special_stamp: "", description: ""
  };
  const frontierArgs = (testFixture) => [
    "--eval-root", testFixture.evalRoot,
    "--dataset", "dataset.json",
    "--sealed-labels", "labels.jsonl",
    "--asset-ids-file", testFixture.assetIdsFile,
    "--arms", "runtime_active_high_low,lynca_csm_direct_title_high_low",
    "--limit", "1",
    "--selection-role", "frontier_mechanism_screen",
    "--max-attempts", "3",
    "--concurrency", "1",
    "--out-dir", testFixture.outDir
  ];

  const frontierSuccess = await fixture("frontier-success", [frontierItem]);
  let frontierSuccessCalls = 0;
  const frontierSuccessFetch = async (_url, options) => {
    frontierSuccessCalls += 1;
    const request = JSON.parse(options.body);
    const images = request.input[0].content.filter(({ type }) => type === "input_image");
    assert.equal(images.length, 2);
    return response(200, {
      id: `resp-frontier-${frontierSuccessCalls}`,
      status: "completed",
      model,
      reasoning: { effort: "low" },
      output_text: Object.hasOwn(request, "text")
        ? JSON.stringify(frontierPayload)
        : "2024 Topps Chrome Alpha",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    });
  };
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    const frontierSummary = await main(frontierArgs(frontierSuccess), {
      fetchImpl: frontierSuccessFetch,
      sleepImpl: async () => assert.fail("frontier arms must never retry")
    });
    assert.equal(frontierSummary.cards_paired, 1);
  } finally {
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  assert.equal(frontierSuccessCalls, 2,
    "two frontier arms must make one provider request each");
  const frontierRows = (await readFile(
    join(frontierSuccess.outDir, `thin-path-${model}.jsonl`), "utf8"
  )).trim().split("\n").map(JSON.parse);
  assert.equal(frontierRows.length, 2);
  assert.deepEqual(frontierRows.map(({ request_attempt_count }) => request_attempt_count), [1, 1]);
  assert.deepEqual(frontierRows.map(({ provider_max_attempts }) => provider_max_attempts), [1, 1]);
  assert.equal(new Set(frontierRows.map(({ image_transport_sha256 }) =>
    image_transport_sha256)).size, 1);
  assert.equal(new Set(frontierRows.map(({ image_set_sha256 }) => image_set_sha256)).size, 1);

  const frontierPartial = await fixture("frontier-partial", [frontierItem]);
  let frontierPartialCalls = 0;
  const frontierPartialFetch = async (_url, options) => {
    frontierPartialCalls += 1;
    const request = JSON.parse(options.body);
    if (frontierPartialCalls === 2) {
      return response(503, { error: { code: "server_error", message: "do not retry" } });
    }
    return response(200, {
      id: "resp-frontier-partial-control",
      status: "completed",
      model,
      reasoning: { effort: "low" },
      output_text: Object.hasOwn(request, "text")
        ? JSON.stringify(frontierPayload)
        : "2024 Topps Chrome Alpha",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    });
  };
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    const partialSummary = await main(frontierArgs(frontierPartial), {
      fetchImpl: frontierPartialFetch,
      sleepImpl: async () => assert.fail("a frontier 503 must not retry")
    });
    assert.equal(partialSummary.cards_paired, 0);
    assert.equal(partialSummary.arms.reduce((sum, arm) => sum + arm.n, 0), 1);
    await main(frontierArgs(frontierPartial), {
      fetchImpl: async () => {
        frontierPartialCalls += 1;
        throw new Error("a claimed partial frontier pair must not resume");
      }
    });
  } finally {
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  assert.equal(frontierPartialCalls, 2,
    "the failed arm must get one attempt and a partial pair must remain terminal");
  const frontierAttemptRows = (await readFile(
    join(frontierPartial.outDir, `thin-path-${model}.attempts.jsonl`), "utf8"
  )).trim().split("\n").map(JSON.parse);
  assert.equal(frontierAttemptRows.filter(({ event }) => event === "provider_claimed").length, 2);
  assert.equal(frontierAttemptRows.filter(({ event, http_status: status }) =>
    event === "provider_attempt" && status === 503).length, 1);
  assert.ok(frontierAttemptRows.some(({ event, status }) =>
    event === "partial_pair_terminal" && status === "manual_review_required"));

  // Regression for the live k-fold leak: the old caller passed
  // `${asset_id}::${arm}` even though the corpus is keyed by sealed label.
  // Choose an asset whose legacy composite falls in another fold so this one
  // row corpus would deterministically expose its own reviewed title under the
  // old implementation.
  const kfoldLabel = "label-kfold-self";
  const kfoldArm = armFor("thin_canonical_kfold_fewshot_low");
  let kfoldAssetId = "asset-kfold-0";
  for (let candidate = 0; candidate < 100; candidate += 1) {
    const value = `asset-kfold-${candidate}`;
    if (foldFor(`${value}::${kfoldArm.key}`) !== foldFor(kfoldLabel)) {
      kfoldAssetId = value;
      break;
    }
  }
  const kfold = await fixture("kfold-live-identity", [{
    asset_id: kfoldAssetId,
    physical_card_id: "physical-kfold-self",
    sealed_eval_label_ref: { key: kfoldLabel },
    images: []
  }]);
  const selfTitle = "SELF LEAK SENTINEL 17/50";
  await writeFile(kfold.sealedLabels, `${JSON.stringify({
    key: kfoldLabel, reviewed_title: selfTitle
  })}\n`);
  let capturedKfoldRequest = null;
  const kfoldFetch = async (_url, init = {}) => {
    capturedKfoldRequest = JSON.parse(init.body);
    return response(200, {
      id: "resp-kfold-identity",
      model,
      reasoning: { effort: "low" },
      output_text: JSON.stringify({
        grammar: "standard", product: "Chrome", subjects: ["Player One"]
      }),
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    });
  };
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    const kfoldSummary = await main([
      "--eval-root", kfold.evalRoot,
      "--dataset", "dataset.json",
      "--sealed-labels", "labels.jsonl",
      "--asset-ids-file", kfold.assetIdsFile,
      "--arms", kfoldArm.key,
      "--limit", "1",
      "--out-dir", kfold.outDir
    ], { fetchImpl: kfoldFetch });
    assert.equal(kfoldSummary.arms[0].n, 1);
  } finally {
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  assert.equal(capturedKfoldRequest.reasoning.effort, "low");
  assert.doesNotMatch(capturedKfoldRequest.input[0].content[0].text, new RegExp(selfTitle),
    "the live request must use sealed identity and exclude its own reviewed title");
  setReviewedCorpus([{ key: kfoldLabel, reviewed_title: selfTitle }]);
  const legacyCompositeRequest = kfoldArm.buildRequest({
    imageUrls: [], model, effort: "low", imageDetail,
    cardKey: `${kfoldAssetId}::${kfoldArm.key}`
  });
  assert.match(legacyCompositeRequest.input[0].content[0].text, new RegExp(selfTitle),
    "the fixture must prove it would catch the historical composite-key leak");

  const candidateIntegration = await fixture("candidate-v3-integration");
  const candidatePayload = {
    candidate_facts: [{
      value: "Leaf Metal Draft",
      kind: "identity",
      basis: "model_knowledge",
      image: "none",
      region: "unknown",
      uncertainty: "uncertain"
    }],
    unreadable_regions: []
  };
  let candidateCalls = 0;
  const candidateFetch = async () => {
    candidateCalls += 1;
    return response(200, {
      output_text: JSON.stringify(candidatePayload),
      model,
      reasoning: { effort },
      usage: { input_tokens: 2, output_tokens: 20, total_tokens: 22 }
    });
  };
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    const candidateSummary = await main([
      "--eval-root", candidateIntegration.evalRoot,
      "--dataset", "dataset.json",
      "--sealed-labels", "labels.jsonl",
      "--asset-ids-file", candidateIntegration.assetIdsFile,
      "--arms", "candidate_expression_v3_high",
      "--limit", "1",
      "--selection-role", "mechanism_probe_known_wins",
      "--out-dir", candidateIntegration.outDir
    ], { fetchImpl: candidateFetch });
    assert.equal(candidateSummary.arms[0].n, 1);
    assert.equal(candidateSummary.arms[0].canonical_n, 0);
  } finally {
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  assert.equal(candidateCalls, 1);
  const candidateCheckpoint = JSON.parse((await readFile(
    join(candidateIntegration.outDir, `thin-path-${model}.jsonl`), "utf8"
  )).trim());
  assert.equal(candidateCheckpoint.candidate_schema_version, "candidate-expression-v3");
  assert.deepEqual(candidateCheckpoint.candidate_facts, candidatePayload.candidate_facts);
  assert.deepEqual(candidateCheckpoint.candidate_defects, []);
  assert.equal(candidateCheckpoint.fields, null);
  assert.equal(candidateCheckpoint.production_promoted, null);
  assert.equal(candidateCheckpoint.title, "",
    "candidate-only evaluation must not render the ledger as a title");

  const residualIntegration = await fixture("residual-v1-integration");
  let residualCalls = 0;
  const residualFetch = async (_url, options) => {
    residualCalls += 1;
    const request = JSON.parse(options.body);
    const treatment = request.text.format.name === "canonical_card_fields_residual_v1";
    return response(200, {
      output_text: JSON.stringify({
        grammar: "standard",
        manufacturer: "Topps",
        product: "Chrome",
        subjects: ["Alpha"],
        serial: "8/25",
        ...(treatment ? {
          residual_evidence: [{ text: "08/25", target: "serial", anchor: "stamped_number" }]
        } : {})
      }),
      model,
      reasoning: { effort },
      usage: { input_tokens: 2, output_tokens: treatment ? 22 : 12, total_tokens: treatment ? 24 : 14 }
    });
  };
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    const residualSummary = await main([
      "--eval-root", residualIntegration.evalRoot,
      "--dataset", "dataset.json",
      "--sealed-labels", "labels.jsonl",
      "--asset-ids-file", residualIntegration.assetIdsFile,
      "--arms", "thin_canonical_high,thin_canonical_residual_v1_high",
      "--limit", "1",
      "--selection-role", "disjoint105_learning",
      "--out-dir", residualIntegration.outDir
    ], { fetchImpl: residualFetch });
    assert.equal(residualSummary.cards_paired, 1);
  } finally {
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
  assert.equal(residualCalls, 2, "paired control+treatment is exactly one provider call per arm");
  const residualRows = (await readFile(
    join(residualIntegration.outDir, `thin-path-${model}.jsonl`), "utf8"
  )).trim().split("\n").map(JSON.parse);
  const residualTreatment = residualRows.find((row) => row.arm === "thin_canonical_residual_v1_high");
  assert.equal(residualTreatment.residual_source_present, true);
  assert.equal(residualTreatment.residual_replay_candidates.length, 1);
  assert.equal(residualTreatment.residual_canonical_fields_unchanged, true);

  console.log("thin path eval checkpoint adversarial tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
