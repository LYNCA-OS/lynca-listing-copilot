#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import { resolveModelResidualVisibleEvidenceV3 } from
  "../experiments/accuracy/model-residual-visible-evidence-v3.mjs";
import { captureModelResidualCandidatesV3, splitModelResidualCandidateEnvelopeV3,
  withModelResidualCandidateLaneV3 } from
  "../experiments/accuracy/model-residual-candidate-lane-v3.mjs";
import { requestForAsset, requestIdentity } from
  "../experiments/vercel-capacity-probe/request-contract.mjs";
import { ARM_SPECS } from "./run-thin-path-eval.mjs";
import {
  analyzeModelResidualV3Files,
  analyzeValidatedModelResidualV3,
  pairedSignTest,
  validateModelResidualV3FrozenRun
} from "./analyze-model-residual-candidate-v3-35x3.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const preregBody = await readFile(resolve(
  "experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json"
));
const prereg = JSON.parse(preregBody);

function buildFixture({ usefulCards = 8, treatmentLatency = 110 } = {}) {
  const dataset = {
    schema_version: "test-image-only-v1",
    items: prereg.cohort.map(({ asset_id }, index) => ({
      asset_id,
      image_set_sha256: prereg.cohort[index].image_set_sha256,
      sealed_eval_label_ref: {
        path: "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl",
        key: `label-${index}`
      }
    }))
  };
  const datasetBody = Buffer.from(`${JSON.stringify(dataset)}\n`);
  const fixturePrereg = structuredClone(prereg);
  const selectedLabelRefs = fixturePrereg.cohort.map(({ asset_id }) => ({ asset_id,
    sealed_eval_label_ref: structuredClone(dataset.items.find((item) => item.asset_id === asset_id)
      .sealed_eval_label_ref) }));
  fixturePrereg.analysis_inputs = {
    dataset_path: "data/eval/reviewed-title-blind/reviewed-title-image-only.json",
    dataset_sha256: sha256(datasetBody),
    selected_label_ref_mapping_sha256: sha256(JSON.stringify(selectedLabelRefs)),
    expected_labels_path: "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl",
    sealed_labels_sha256: "0".repeat(64),
    sealed_label_bytes_read_before_predictions_frozen: false
  };
  const context = { imageUrls: [], model: "gpt-5.6-luna", effort: "low", imageDetail: "high" };
  const controlTemplate = ARM_SPECS.thin_canonical_high_effort_low.buildRequest(context);
  const residualTemplate = withModelResidualCandidateLaneV3(controlTemplate, { enabled: true });
  const assets = prereg.cohort.map((card, index) => ({ asset_id: card.asset_id,
    image_set_sha256: card.image_set_sha256,
    image_urls: [`https://irpgnhkslrsiucybkufc.supabase.co/storage/v1/object/sign/cards/${index}`] }));
  const payload = {
    schema_version: "cloud-residual-v3-materialized-payload-v1",
    materialized_at: "2027-01-01T00:00:00.000Z",
    minimum_remaining_ttl_ms: 10_800_000,
    ordered_signed_urls_sha256: sha256(JSON.stringify(assets.map((asset) => asset.image_urls))),
    control_a: { arm_id: "control_a", request_template: structuredClone(controlTemplate), assets },
    control_b: { arm_id: "control_b", request_template: structuredClone(controlTemplate), assets },
    residual_c: { arm_id: "residual_c", request_template: structuredClone(residualTemplate), assets }
  };
  const contracts = Object.fromEntries(["control_a", "control_b", "residual_c"].map((arm) => [
    arm, requestIdentity(requestForAsset(payload[arm].request_template,
      ["https://contract.invalid/front", "https://contract.invalid/back"]))
  ]));
  const jobs = prereg.cohort.flatMap((card) => card.order.map((arm) => ({
    job_key: `${card.asset_id}:${arm}`, asset_id: card.asset_id,
    image_set_sha256: card.image_set_sha256, arm
  })));
  const fingerprintValue = {
    schema_version: "cloud-residual-v3-run-contract-v1",
    origin: "https://residual-v3-preview.vercel.app",
    runId: "test-v3-run",
    prereg_sha256: sha256(JSON.stringify(fixturePrereg)),
    payload_sha256: sha256(JSON.stringify(payload)),
    jobs_sha256: sha256(JSON.stringify(jobs)),
    contracts,
    concurrency: 1,
    max_provider_attempts: 105,
    retries: 0,
    earliest_signed_url_expiry_ms: 1_900_000_000_000,
    minimum_remaining_ttl_ms: 10_800_000,
    ordered_signed_urls_sha256: payload.ordered_signed_urls_sha256
  };
  let runFingerprint = sha256(JSON.stringify(fingerprintValue));
  const labels = [];
  const rows = [];
  for (const [index, card] of prereg.cohort.entries()) {
    const useful = index < usefulCards;
    const canonicalPayload = {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Chrome",
      subjects: ["Player"],
      surface_color: "",
      parallel_family: "",
      parallel_exact: "",
      print_finish: "",
      serial: "",
      grammar: "standard"
    };
    const candidates = useful ? [{ text: "Topps Chrome Sapphire", role: "identity_phrase",
      region: "card_front", basis: "printed_text" }] : [];
    const canonical = finishCanonicalTitle(JSON.stringify(canonicalPayload));
    const residualRaw = { residual_visible_evidence: candidates, ...canonicalPayload };
    const residualEnvelope = splitModelResidualCandidateEnvelopeV3(residualRaw);
    const residualCanonical = finishCanonicalTitle(JSON.stringify(residualEnvelope.canonical_payload));
    const residualCapture = captureModelResidualCandidatesV3(residualRaw,
      { canonicalFields: residualCanonical.fields });
    const residualResolved = resolveModelResidualVisibleEvidenceV3(
      residualCanonical.fields, residualCapture.candidates);
    const canonicalTitle = canonical.title;
    labels.push({
      key: `label-${index}`,
      reviewed_title: useful ? residualResolved.title : canonicalTitle,
      label_type: "REVIEWED_INTERNAL_TITLE",
      policy: { reviewed_title_is_ground_truth: true, field_ground_truth: false,
        model_prompt_visible: false, load_after_predictions_frozen: true,
        self_retrieval_exclusion_required: true }
    });
    for (const arm of card.order) {
      const isTreatment = arm === "residual_c";
      const rawEnvelope = isTreatment ? residualRaw : canonicalPayload;
      const finished = isTreatment ? residualCanonical : canonical;
      const result = {
        request_attempt_count: 1,
        response_id: `response-${index}-${arm}`,
        provider_response_sha256: sha256(`provider-response-${index}-${arm}`),
        structured_output_raw_sha256: sha256(`structured-output-${index}-${arm}`),
        structured_output_envelope: structuredClone(rawEnvelope),
        served_model: "gpt-5.6-luna",
        requested_effort: "low",
        served_effort: "low",
        latency_ms: isTreatment ? treatmentLatency : 100,
        usage: { input_tokens: isTreatment ? 105 : 100,
          output_tokens: isTreatment ? 21 : 20 },
        canonical_payload: structuredClone(canonicalPayload),
        canonical_fields: structuredClone(finished.fields),
        canonical_title: finished.title,
        canonical_field_defects: structuredClone(finished.field_defects),
        candidate_capture: isTreatment ? structuredClone(residualCapture) : null,
        resolved: isTreatment ? structuredClone(residualResolved) : null
      };
      result.structured_output_envelope_sha256 = sha256(JSON.stringify(result.structured_output_envelope));
      const asset = assets[index];
      rows.push({
        job_key: `${card.asset_id}:${arm}`,
        asset_id: card.asset_id,
        image_set_sha256: card.image_set_sha256,
        arm,
        state: "COMPLETE",
        attempt_count: 1,
        result
      });
      result.run_fingerprint = runFingerprint;
      result.request_sha256 = requestIdentity(requestForAsset(
        payload[arm].request_template, asset.image_urls
      )).wire_sha256;
    }
  }
  const labelsBody = Buffer.from(`${labels.map((row) => JSON.stringify(row)).join("\n")}\n`);
  fixturePrereg.analysis_inputs.sealed_labels_sha256 = sha256(labelsBody);
  fingerprintValue.prereg_sha256 = sha256(JSON.stringify(fixturePrereg));
  runFingerprint = sha256(JSON.stringify(fingerprintValue));
  for (const row of rows) row.result.run_fingerprint = runFingerprint;
  const checkpoint = { ...fingerprintValue, run_fingerprint: runFingerprint,
    state: "COMPLETE", provider_attempts: 105, provider_calls: 105, provider_retries: 0,
    single_job_minimum_ttl_ms: 180_000,
    authorization_receipt_sha256: sha256("synthetic-authorization-receipt"),
    sealed_labels_accessed_during_execution: false,
    jobs: Object.fromEntries(rows.map((row) => [row.job_key, row])) };
  return {
    preregBody: Buffer.from(`${JSON.stringify(fixturePrereg)}\n`),
    payload,
    payloadBody: Buffer.from(`${JSON.stringify(payload)}\n`),
    checkpoint,
    checkpointBody: Buffer.from(`${JSON.stringify(checkpoint)}\n`),
    datasetBody,
    labelsBody,
    rows,
    dataset,
    labels
  };
}

assert.equal(pairedSignTest(8, 0), 0.0078125);
assert.equal(pairedSignTest(0, 0), 1);
assert.equal(pairedSignTest(2, 2), 1);

const passing = buildFixture();
const frozen = validateModelResidualV3FrozenRun(passing);
assert.deepEqual(frozen.completion, {
  status: "COMPLETE", completed_jobs: 105, expected_jobs: 105,
  complete_cards: 35, arms_per_card: 3
});
const report = analyzeValidatedModelResidualV3({
  frozen,
  datasetBody: passing.datasetBody,
  labelsBody: passing.labelsBody
});
assert.equal(report.decision, "PASS");
assert.equal(report.provider_calls_by_analysis, 0);
assert.equal(report.validated_run.sealed_labels_opened_after_complete_run_validation, true);
assert.equal(report.self_jitter.exact_canonical_title_equal_cards, 35);
assert.equal(report.self_jitter.exact_canonical_field_equal_cards, 35);
assert.equal(report.self_jitter.paired_f1.two_sided_sign_test_p, 1);
assert.equal(report.canonical_interference.delta_macro_f1, 0);
assert.equal(report.resolver_utility.wins, 8);
assert.equal(report.resolver_utility.losses, 0);
assert.equal(report.resolver_utility.ties, 27);
assert.equal(report.resolver_utility.two_sided_sign_test_p, 0.0078125);
assert.ok(report.resolver_utility.delta_macro_f1 >= 0.003);
assert.equal(report.candidate_capture.cards_with_rows, 8);
assert.equal(report.candidate_capture.by_role.identity_phrase, 8);
assert.deepEqual(report.safety, {
  critical_cards: 0,
  reference_loss_cards: 0,
  unbacked_new_token_cards: 0,
  unsupported_numeric_change_cards: 0,
  titles_over_80: 0,
  canonical_field_shape_defect_cards: 0,
  candidate_contract_defect_cards: 0
});
assert.equal(report.cost_latency.input_tokens.treatment_to_pooled_control.p50, 1.05);
assert.equal(report.cost_latency.input_tokens.treatment_to_pooled_control.p95, 1.05);
assert.equal(report.cost_latency.latency_ms.treatment_to_pooled_control.p50, 1.1);
assert.equal(report.cost_latency.latency_ms.treatment_to_pooled_control.p95, 1.1);
assert.equal(report.gates.primary_screen.pass, true);
assert.equal(report.gates.canonical_interference.pass, true);
assert.equal(report.gates.cost_latency.pass, true);

const swappedDataset = Buffer.from(`${JSON.stringify({ ...passing.dataset,
  generated_at: "swapped-after-prereg" })}\n`);
assert.throws(() => analyzeValidatedModelResidualV3({ frozen,
  datasetBody: swappedDataset, labelsBody: passing.labelsBody }),
/v3_analysis_dataset_fingerprint_mismatch/);
const swappedLabels = structuredClone(passing.labels);
swappedLabels[0].reviewed_title += " tampered-with-same-key";
assert.throws(() => analyzeValidatedModelResidualV3({ frozen,
  datasetBody: passing.datasetBody,
  labelsBody: Buffer.from(`${swappedLabels.map((row) => JSON.stringify(row)).join("\n")}\n`) }),
/v3_sealed_labels_fingerprint_mismatch/);

const noUtility = buildFixture({ usefulCards: 0 });
const noUtilityReport = analyzeValidatedModelResidualV3({
  frozen: validateModelResidualV3FrozenRun(noUtility),
  datasetBody: noUtility.datasetBody,
  labelsBody: noUtility.labelsBody
});
assert.equal(noUtilityReport.decision, "FAIL");
assert.equal(noUtilityReport.gates.primary_screen.pass, false);
assert.equal(noUtilityReport.resolver_utility.wins, 0);

const slow = buildFixture({ treatmentLatency: 121 });
const slowReport = analyzeValidatedModelResidualV3({
  frozen: validateModelResidualV3FrozenRun(slow),
  datasetBody: slow.datasetBody,
  labelsBody: slow.labelsBody
});
assert.equal(slowReport.decision, "FAIL");
assert.equal(slowReport.gates.cost_latency.pass, false);
assert.equal(slowReport.gates.cost_latency.checks
  .treatment_to_control_latency_p95_at_most_120, false);

const captureDefect = buildFixture();
const defectRow = captureDefect.rows.find((row) => row.arm === "residual_c");
defectRow.result.candidate_capture.defects.push("synthetic_contract_defect");
captureDefect.checkpointBody = Buffer.from(`${JSON.stringify(captureDefect.checkpoint)}\n`);
assert.throws(() => validateModelResidualV3FrozenRun(captureDefect),
  /v3_provider_envelope_replay_mismatch:candidate_capture/);

for (const [mutate, pattern] of [
  [(fixture) => { delete fixture.checkpoint.jobs[fixture.rows.at(-1).job_key]; },
    /v3_checkpoint_not_complete:104\/105/],
  [(fixture) => { fixture.rows[0].result.run_fingerprint = "0".repeat(64); },
    /v3_checkpoint_fingerprint_mismatch/],
  [(fixture) => { fixture.rows[0].result.request_sha256 = "0".repeat(64); },
    /v3_checkpoint_request_fingerprint_mismatch/],
  [(fixture) => { fixture.rows[0].result.request_attempt_count = 2; }, /v3_attempt_count_invalid/]
]) {
  const fixture = buildFixture();
  mutate(fixture);
  fixture.checkpointBody = Buffer.from(`${JSON.stringify(fixture.checkpoint)}\n`);
  assert.throws(() => validateModelResidualV3FrozenRun(fixture), pattern);
}

const temp = await mkdtemp(join(tmpdir(), "residual-v3-analysis-"));
try {
  const incomplete = buildFixture();
  delete incomplete.checkpoint.jobs[incomplete.rows.at(-1).job_key];
  incomplete.checkpointBody = Buffer.from(`${JSON.stringify(incomplete.checkpoint)}\n`);
  const paths = {
    preregPath: join(temp, "prereg.json"),
    payloadPath: join(temp, "payload.json"),
    checkpointPath: join(temp, "checkpoint.json"),
    datasetPath: join(temp, "dataset.json"),
    labelsPath: join(temp, "sealed-labels.jsonl")
  };
  await Promise.all([
    writeFile(paths.preregPath, incomplete.preregBody),
    writeFile(paths.payloadPath, incomplete.payloadBody),
    writeFile(paths.checkpointPath, incomplete.checkpointBody),
    writeFile(paths.datasetPath, incomplete.datasetBody),
    writeFile(paths.labelsPath, incomplete.labelsBody)
  ]);
  const reads = [];
  await assert.rejects(() => analyzeModelResidualV3Files({
    ...paths,
    readFileImpl: async (path) => { reads.push(path); return readFile(path); }
  }), /v3_checkpoint_not_complete:104\/105/);
  assert.equal(reads.includes(paths.datasetPath), false,
    "dataset must not be opened before the run is frozen");
  assert.equal(reads.includes(paths.labelsPath), false,
    "sealed labels must not be opened before the run is frozen");

  const complete = buildFixture();
  const boundRoot = join(temp, "bound-eval-root");
  const boundDataset = join(boundRoot,
    "data/eval/reviewed-title-blind/reviewed-title-image-only.json");
  const wrongLabels = join(boundRoot, "swapped-sealed-labels.jsonl");
  await mkdir(join(boundRoot, "data/eval/reviewed-title-blind"), { recursive: true });
  await Promise.all([
    writeFile(paths.preregPath, complete.preregBody),
    writeFile(paths.payloadPath, complete.payloadBody),
    writeFile(paths.checkpointPath, complete.checkpointBody),
    writeFile(boundDataset, complete.datasetBody),
    writeFile(wrongLabels, complete.labelsBody)
  ]);
  const swappedReads = [];
  await assert.rejects(() => analyzeModelResidualV3Files({ preregPath: paths.preregPath,
    payloadPath: paths.payloadPath, checkpointPath: paths.checkpointPath,
    datasetPath: boundDataset, labelsPath: wrongLabels,
    readFileImpl: async (path) => { swappedReads.push(path); return readFile(path); } }),
  /v3_analysis_labels_path_identity_mismatch/);
  assert.equal(swappedReads.includes(wrongLabels), false,
    "path-swapped labels must not be opened");
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("model residual candidate v3 35x3 analyzer tests passed");
