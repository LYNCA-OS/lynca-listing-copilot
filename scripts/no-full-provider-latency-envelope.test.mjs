import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateNoFullProviderLatencyEnvelope,
  calculateUploadPhysicalLowerBound,
  latencyEvidenceClasses,
  modelParallelFocusedOcrFromMarginals,
  modelSerialFocusedOcrFromMarginals,
  NoFullProviderLatencyContractError,
  noFullProviderCurrentSerialOcrModel,
  noFullProviderOneShotOcrPlanningProxy,
  noFullProviderReferenceStages,
  noFullProviderStretchOneShotStages
} from "../lib/listing/evaluation/no-full-provider-latency-envelope.mjs";

function expectCode(code, fn) {
  assert.throws(fn, (error) => (
    error instanceof NoFullProviderLatencyContractError
    && error.code === code
  ));
}

test("reference envelope reproduces the frozen no-full-Provider report", () => {
  const result = calculateNoFullProviderLatencyEnvelope();

  assert.deepEqual(result.critical_path.p50.evidence_branch_ms, {
    lower: 1593,
    upper: 1893
  });
  assert.deepEqual(result.critical_path.p50.writer_visible_ms, {
    lower: 1893.3,
    upper: 2633.5
  });
  assert.deepEqual(result.critical_path.p95.evidence_branch_ms, {
    lower: 3623,
    upper: 4173
  });
  assert.deepEqual(result.critical_path.p95.writer_visible_ms, {
    lower: 4273.4,
    upper: 5614
  });
});

test("the one-shot stretch target is reported separately from the evidence-grounded proxy", () => {
  const result = calculateNoFullProviderLatencyEnvelope({
    stages: noFullProviderStretchOneShotStages
  });

  assert.deepEqual(result.critical_path.p50.writer_visible_ms, { lower: 1550.3, upper: 2290.5 });
  assert.deepEqual(result.critical_path.p95.writer_visible_ms, { lower: 3000.4, upper: 4341 });
  assert.deepEqual(result.evidence_inventory.modelled_stage_ids, []);
  assert.ok(result.evidence_inventory.budget_stage_ids.includes("focused_ocr"));
});

test("original upload and focused evidence use a critical-path max, not a serial sum", () => {
  const result = calculateNoFullProviderLatencyEnvelope({
    original_upload_remaining_ms: {
      p50: { lower: 2400, upper: 2400 },
      p95: { lower: 4800, upper: 4800 }
    }
  });

  assert.deepEqual(result.critical_path.p50.readiness_max_ms, { lower: 2400, upper: 2400 });
  assert.deepEqual(result.critical_path.p50.writer_visible_ms, { lower: 2700.3, upper: 3140.5 });
  assert.deepEqual(result.critical_path.p95.readiness_max_ms, { lower: 4800, upper: 4800 });
  assert.deepEqual(result.critical_path.p95.writer_visible_ms, { lower: 5450.4, upper: 6241 });

  const illegalSerialP50Lower = 2400 + 905 + 300;
  assert.notEqual(result.critical_path.p50.writer_visible_ms.lower, illegalSerialP50Lower);
});

test("6 MB at 20 Mbps has 2.4 s one-side and 4.8 s two-side byte floors", () => {
  const oneSide = calculateUploadPhysicalLowerBound({
    image_megabytes: 6,
    side_count: 1,
    uplink_megabits_per_second: 20
  });
  const twoSides = calculateUploadPhysicalLowerBound({
    image_megabytes: 6,
    side_count: 2,
    uplink_megabits_per_second: 20
  });

  assert.equal(oneSide.byte_transfer_ms, 2400);
  assert.equal(twoSides.byte_transfer_ms, 4800);
  assert.equal(oneSide.evidence_class, latencyEvidenceClasses.PHYSICAL_LOWER_BOUND);
  assert.equal(oneSide.observed, false);
  assert.ok(oneSide.excludes.includes("SIGNING_RTT"));
  assert.ok(oneSide.excludes.includes("VERIFICATION_RTT"));
});

test("writer-visible file-selection scenarios reproduce the report bounds", () => {
  const fixedUpload = (milliseconds) => ({
    p50: { lower: milliseconds, upper: milliseconds },
    p95: { lower: milliseconds, upper: milliseconds }
  });
  const oneSide = calculateNoFullProviderLatencyEnvelope({
    original_upload_remaining_ms: fixedUpload(2400)
  });
  const twoSides = calculateNoFullProviderLatencyEnvelope({
    original_upload_remaining_ms: fixedUpload(4800)
  });

  assert.deepEqual(oneSide.critical_path.p50.writer_visible_ms, { lower: 2700.3, upper: 3140.5 });
  assert.deepEqual(oneSide.critical_path.p95.writer_visible_ms, { lower: 4273.4, upper: 5614 });
  assert.deepEqual(twoSides.critical_path.p50.writer_visible_ms, { lower: 5100.3, upper: 5540.5 });
  assert.deepEqual(twoSides.critical_path.p95.writer_visible_ms, { lower: 5450.4, upper: 6241 });
});

test("one-shot OCR remains a model until one real card-level batch distribution exists", () => {
  const result = calculateNoFullProviderLatencyEnvelope();

  assert.deepEqual(result.evidence_inventory.measured_stage_ids, ["compiled_lookup"]);
  assert.deepEqual(result.evidence_inventory.modelled_stage_ids, ["focused_ocr"]);
  assert.deepEqual(result.evidence_inventory.budget_stage_ids, [
    "evidence_upload",
    "product_mark",
    "candidate_control",
    "resolver_renderer",
    "commit_status"
  ]);
  assert.ok(result.evidence_inventory.parallel_sensor_assumptions.includes(
    "COMPONENTWISE_QUANTILE_MAX_IS_NOT_A_JOINT_DISTRIBUTION"
  ));
  assert.equal(result.evidence_inventory.joint_end_to_end_observation, false);
  assert.equal(result.claim.evidence_class, latencyEvidenceClasses.MIXED_COMPONENT_ENVELOPE);
});

test("three marginal crop distributions produce an explicit parallel-max model, not an observation", () => {
  const model = modelParallelFocusedOcrFromMarginals({
    crops: [
      { id: "year_product", p50_ms: 655, p95_ms: 2277 },
      { id: "subject", p50_ms: 983, p95_ms: 2337 },
      { id: "card_code", p50_ms: 656, p95_ms: 2206 }
    ]
  });
  assert.equal(model.p50_ms, 1343);
  assert.equal(model.p95_ms, 3123);
  assert.deepEqual(model, noFullProviderOneShotOcrPlanningProxy);
  assert.equal(model.observed, false);
  assert.ok(model.assumptions.includes("NOT_A_CARD_LEVEL_OBSERVATION"));
});

test("the current per-asset capacity-one graph is a serial sum, not the old parallel max", () => {
  const model = modelSerialFocusedOcrFromMarginals({
    crops: [
      { id: "year_product", p50_ms: 655, p95_ms: 2277 },
      { id: "subject", p50_ms: 983, p95_ms: 2337 },
      { id: "card_code", p50_ms: 656, p95_ms: 2206 }
    ]
  });
  assert.deepEqual(model, noFullProviderCurrentSerialOcrModel);
  assert.equal(model.p50_ms, 2628);
  assert.equal(model.p95_ms, 5192);
  assert.ok(model.assumptions.includes("ZERO_COVARIANCE_BETWEEN_CROP_LATENCIES"));
  assert.ok(model.assumptions.includes("CURRENT_PER_ASSET_CAPACITY_ONE_SERIALIZES_CROPS"));
  assert.ok(model.assumptions.includes("NOT_A_CARD_LEVEL_OBSERVATION"));
});

test("product mark and focused OCR run in parallel rather than serially", () => {
  const stages = structuredClone(noFullProviderReferenceStages);
  stages.product_mark.quantiles_ms = {
    p50: { lower: 5000, upper: 5000 },
    p95: { lower: 6000, upper: 6000 }
  };
  const result = calculateNoFullProviderLatencyEnvelope({ stages });
  assert.deepEqual(result.critical_path.p50.evidence_branch_ms, {
    lower: 5250,
    upper: 5550
  });
  assert.match(result.formula, /max\(focused_ocr, product_mark\)/);
});

test("an architecture target can never be labeled observed", () => {
  expectCode("TARGET_CANNOT_BE_OBSERVED", () => calculateNoFullProviderLatencyEnvelope({
    claim: { type: "ARCHITECTURE_TARGET", observed: true }
  }));
});

test("full Provider cannot be smuggled into this route", () => {
  expectCode("UNEXPECTED_STAGE", () => calculateNoFullProviderLatencyEnvelope({
    stages: {
      ...noFullProviderReferenceStages,
      full_provider: {
        evidence_class: "MEASURED_COMPONENT",
        observed: true,
        quantiles_ms: {
          p50: { lower: 1000, upper: 1000 },
          p95: { lower: 1000, upper: 1000 }
        }
      }
    }
  }));
});

test("budget stages cannot masquerade as measurements", () => {
  const stages = structuredClone(noFullProviderReferenceStages);
  stages.commit_status.observed = true;
  expectCode("BUDGET_CANNOT_BE_OBSERVED", () => calculateNoFullProviderLatencyEnvelope({ stages }));
});

test("one-shot OCR planning proxy cannot masquerade as an observation", () => {
  const stages = structuredClone(noFullProviderReferenceStages);
  stages.focused_ocr.observed = true;
  expectCode("MODEL_CANNOT_BE_OBSERVED", () => calculateNoFullProviderLatencyEnvelope({ stages }));
});

test("one-shot OCR stretch budget cannot masquerade as an observation", () => {
  const stages = structuredClone(noFullProviderStretchOneShotStages);
  stages.focused_ocr.observed = true;
  expectCode("BUDGET_CANNOT_BE_OBSERVED", () => calculateNoFullProviderLatencyEnvelope({ stages }));
});
