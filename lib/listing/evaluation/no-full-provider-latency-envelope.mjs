export const noFullProviderLatencyEnvelopeVersion = "no-full-provider-latency-envelope-v2";

export const latencyEvidenceClasses = Object.freeze({
  MEASURED_COMPONENT: "MEASURED_COMPONENT",
  MODELLED_COMPONENT: "MODELLED_COMPONENT",
  DESIGN_BUDGET: "DESIGN_BUDGET",
  PHYSICAL_LOWER_BOUND: "PHYSICAL_LOWER_BOUND",
  MIXED_COMPONENT_ENVELOPE: "MIXED_COMPONENT_ENVELOPE"
});

const percentiles = Object.freeze(["p50", "p95"]);
const stageIds = Object.freeze([
  "evidence_upload",
  "focused_ocr",
  "product_mark",
  "compiled_lookup",
  "candidate_control",
  "resolver_renderer",
  "commit_status"
]);
const allowedStageEvidenceClasses = new Set([
  latencyEvidenceClasses.MEASURED_COMPONENT,
  latencyEvidenceClasses.MODELLED_COMPONENT,
  latencyEvidenceClasses.DESIGN_BUDGET
]);

export class NoFullProviderLatencyContractError extends Error {
  constructor(code, path = "") {
    super(path ? `${code}:${path}` : code);
    this.name = "NoFullProviderLatencyContractError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path = "") {
  throw new NoFullProviderLatencyContractError(code, path);
}

function finiteNonNegative(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) fail("NON_NEGATIVE_NUMBER_REQUIRED", path);
  return number;
}

function range(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("RANGE_REQUIRED", path);
  const lower = finiteNonNegative(value.lower, `${path}.lower`);
  const upper = finiteNonNegative(value.upper, `${path}.upper`);
  if (upper < lower) fail("RANGE_ORDER_INVALID", path);
  return { lower, upper };
}

function quantileRanges(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("QUANTILES_REQUIRED", path);
  return Object.fromEntries(percentiles.map((percentile) => [
    percentile,
    range(value[percentile], `${path}.${percentile}`)
  ]));
}

function stage(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("STAGE_REQUIRED", path);
  const evidenceClass = String(value.evidence_class ?? "").trim().toUpperCase();
  if (!allowedStageEvidenceClasses.has(evidenceClass)) fail("STAGE_EVIDENCE_CLASS_INVALID", `${path}.evidence_class`);
  const observed = value.observed === true;
  if (evidenceClass === latencyEvidenceClasses.MEASURED_COMPONENT && !observed) {
    fail("MEASURED_COMPONENT_MUST_BE_OBSERVED", `${path}.observed`);
  }
  if (evidenceClass === latencyEvidenceClasses.DESIGN_BUDGET && observed) {
    fail("BUDGET_CANNOT_BE_OBSERVED", `${path}.observed`);
  }
  if (evidenceClass === latencyEvidenceClasses.MODELLED_COMPONENT && observed) {
    fail("MODEL_CANNOT_BE_OBSERVED", `${path}.observed`);
  }
  return {
    evidence_class: evidenceClass,
    observed,
    quantiles_ms: quantileRanges(value.quantiles_ms, `${path}.quantiles_ms`),
    basis: value.basis ? String(value.basis) : null,
    assumptions: Array.isArray(value.assumptions) ? value.assumptions.map(String) : []
  };
}

function normalizeStages(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) fail("STAGES_REQUIRED", "stages");
  const unexpected = Object.keys(values).filter((key) => !stageIds.includes(key));
  if (unexpected.length) fail("UNEXPECTED_STAGE", `stages.${unexpected[0]}`);
  return Object.fromEntries(stageIds.map((id) => [id, stage(values[id], `stages.${id}`)]));
}

function addRanges(...ranges) {
  return ranges.reduce((sum, item) => ({
    lower: sum.lower + item.lower,
    upper: sum.upper + item.upper
  }), { lower: 0, upper: 0 });
}

function maxRanges(left, right) {
  return {
    lower: Math.max(left.lower, right.lower),
    upper: Math.max(left.upper, right.upper)
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return (1 + erf) / 2;
}

function inverseNormalCdf(probability) {
  if (!(probability > 0 && probability < 1)) fail("PROBABILITY_OUT_OF_RANGE", "probability");
  let lower = -8;
  let upper = 8;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (normalCdf(middle) < probability) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
}

export function modelParallelFocusedOcrFromMarginals({ crops = [] } = {}) {
  if (!Array.isArray(crops) || crops.length === 0) fail("OCR_CROPS_REQUIRED", "crops");
  const z95 = inverseNormalCdf(0.95);
  const parameters = crops.map((crop, index) => {
    const p50 = finiteNonNegative(crop.p50_ms, `crops[${index}].p50_ms`);
    const p95 = finiteNonNegative(crop.p95_ms, `crops[${index}].p95_ms`);
    if (!(p50 > 0 && p95 > p50)) fail("OCR_QUANTILES_INVALID", `crops[${index}]`);
    return {
      id: String(crop.id || `crop_${index}`),
      mu: Math.log(p50),
      sigma: (Math.log(p95) - Math.log(p50)) / z95
    };
  });
  const quantile = (probability) => {
    let lower = 0.001;
    let upper = 60_000;
    for (let iteration = 0; iteration < 120; iteration += 1) {
      const middle = (lower + upper) / 2;
      const joint = parameters.reduce((product, item) => (
        product * normalCdf((Math.log(middle) - item.mu) / item.sigma)
      ), 1);
      if (joint < probability) lower = middle;
      else upper = middle;
    }
    return Math.round((lower + upper) / 2);
  };
  return deepFreeze({
    evidence_class: latencyEvidenceClasses.MODELLED_COMPONENT,
    observed: false,
    p50_ms: quantile(0.5),
    p95_ms: quantile(0.95),
    assumptions: [
      "LOGNORMAL_MARGINALS_FIT_FROM_P50_P95",
      "THREE_CROP_LATENCIES_INDEPENDENT",
      "PARALLEL_COMPLETION_IS_MAX_NOT_SUM",
      "NOT_A_CARD_LEVEL_OBSERVATION"
    ]
  });
}

function claim(value = {}) {
  const claimType = String(value.type ?? "ARCHITECTURE_TARGET").trim().toUpperCase();
  const observed = value.observed === true;
  if (claimType !== "ARCHITECTURE_TARGET") fail("CLAIM_TYPE_NOT_ALLOWED", "claim.type");
  if (observed) fail("TARGET_CANNOT_BE_OBSERVED", "claim.observed");
  return {
    type: claimType,
    observed: false,
    evidence_class: latencyEvidenceClasses.MIXED_COMPONENT_ENVELOPE
  };
}

const focusedOcrModel = modelParallelFocusedOcrFromMarginals({
  crops: [
    { id: "year_product", p50_ms: 655, p95_ms: 2277 },
    { id: "subject", p50_ms: 983, p95_ms: 2337 },
    { id: "card_code", p50_ms: 656, p95_ms: 2206 }
  ]
});

export const noFullProviderReferenceStages = deepFreeze({
  // This combines the report's admission/durable-intent and one-fetch/decode
  // budgets. It is the small evidence branch, not the original-image upload.
  evidence_upload: {
    evidence_class: latencyEvidenceClasses.DESIGN_BUDGET,
    observed: false,
    quantiles_ms: {
      p50: { lower: 250, upper: 550 },
      p95: { lower: 500, upper: 1050 }
    }
  },
  focused_ocr: {
    evidence_class: latencyEvidenceClasses.MODELLED_COMPONENT,
    observed: false,
    basis: "300 measured marginal crops; no retained per-card paired latency packet",
    assumptions: focusedOcrModel.assumptions,
    quantiles_ms: {
      p50: { lower: focusedOcrModel.p50_ms, upper: focusedOcrModel.p50_ms },
      p95: { lower: focusedOcrModel.p95_ms, upper: focusedOcrModel.p95_ms }
    }
  },
  // Retrospective local diagnostic over previously used Development/Validation
  // images with six official mark references and a post-hoc 500-pixel target.
  // Keep it as a budget until an untouched cohort supplies prospective evidence.
  product_mark: {
    evidence_class: latencyEvidenceClasses.DESIGN_BUDGET,
    observed: false,
    basis: "docs/reports/no-full-provider-product-mark-sensor-2026-07-30.json",
    assumptions: ["RETROSPECTIVE_RESIZE_SELECTION", "RETROSPECTIVE_DEVVAL_DIAGNOSTIC"],
    quantiles_ms: {
      p50: { lower: 130, upper: 180 },
      p95: { lower: 340, upper: 400 }
    }
  },
  // Measured by the immutable 55,968-row Panini Release Pack replay. Keep a
  // rounded range instead of copying one machine's timer precision into the
  // contract. Index build/JSON parse happen before request serving.
  compiled_lookup: {
    evidence_class: latencyEvidenceClasses.MEASURED_COMPONENT,
    observed: true,
    quantiles_ms: {
      p50: { lower: 0.3, upper: 0.5 },
      p95: { lower: 0.4, upper: 1 }
    }
  },
  candidate_control: {
    evidence_class: latencyEvidenceClasses.DESIGN_BUDGET,
    observed: false,
    quantiles_ms: {
      p50: { lower: 100, upper: 240 },
      p95: { lower: 250, upper: 490 }
    }
  },
  resolver_renderer: {
    evidence_class: latencyEvidenceClasses.DESIGN_BUDGET,
    observed: false,
    quantiles_ms: {
      p50: { lower: 50, upper: 150 },
      p95: { lower: 100, upper: 300 }
    }
  },
  commit_status: {
    evidence_class: latencyEvidenceClasses.DESIGN_BUDGET,
    observed: false,
    quantiles_ms: {
      p50: { lower: 150, upper: 350 },
      p95: { lower: 300, upper: 650 }
    }
  }
});

const zeroUploadRemaining = deepFreeze({
  p50: { lower: 0, upper: 0 },
  p95: { lower: 0, upper: 0 }
});

export function calculateNoFullProviderLatencyEnvelope({
  original_upload_remaining_ms = zeroUploadRemaining,
  stages = noFullProviderReferenceStages,
  claim: claimInput = {}
} = {}) {
  const normalizedClaim = claim(claimInput);
  const upload = quantileRanges(original_upload_remaining_ms, "original_upload_remaining_ms");
  const normalizedStages = normalizeStages(stages);

  const criticalPath = {};
  for (const percentile of percentiles) {
    const parallelSensors = maxRanges(
      normalizedStages.focused_ocr.quantiles_ms[percentile],
      normalizedStages.product_mark.quantiles_ms[percentile]
    );
    const evidenceBranch = addRanges(
      normalizedStages.evidence_upload.quantiles_ms[percentile],
      parallelSensors
    );
    const readiness = maxRanges(upload[percentile], evidenceBranch);
    const downstream = addRanges(
      normalizedStages.compiled_lookup.quantiles_ms[percentile],
      normalizedStages.candidate_control.quantiles_ms[percentile],
      normalizedStages.resolver_renderer.quantiles_ms[percentile],
      normalizedStages.commit_status.quantiles_ms[percentile]
    );
    criticalPath[percentile] = {
      original_upload_remaining_ms: upload[percentile],
      evidence_branch_ms: evidenceBranch,
      // Backward-compatible name from v1 before product-mark parallelism was
      // made explicit. It represents the same complete evidence branch.
      evidence_upload_plus_focused_ocr_ms: evidenceBranch,
      readiness_max_ms: readiness,
      downstream_ms: downstream,
      writer_visible_ms: addRanges(readiness, downstream)
    };
  }

  const measuredStageIds = stageIds.filter((id) => (
    normalizedStages[id].evidence_class === latencyEvidenceClasses.MEASURED_COMPONENT
  ));
  const modelledStageIds = stageIds.filter((id) => (
    normalizedStages[id].evidence_class === latencyEvidenceClasses.MODELLED_COMPONENT
  ));
  const budgetStageIds = stageIds.filter((id) => (
    normalizedStages[id].evidence_class === latencyEvidenceClasses.DESIGN_BUDGET
  ));

  return deepFreeze({
    schema_version: noFullProviderLatencyEnvelopeVersion,
    route: "COMPILED_RECOGNITION_NO_FULL_PROVIDER",
    production_effect: false,
    provider_calls: 0,
    formula: "max(original_upload_remaining, evidence_upload + max(focused_ocr, product_mark)) + compiled_lookup + candidate_control + resolver_renderer + commit_status",
    claim: normalizedClaim,
    evidence_inventory: {
      measured_stage_ids: measuredStageIds,
      modelled_stage_ids: modelledStageIds,
      budget_stage_ids: budgetStageIds,
      parallel_sensor_assumptions: [
        "COMPONENTWISE_QUANTILE_MAX_IS_NOT_A_JOINT_DISTRIBUTION",
        "PRODUCT_MARK_IS_DOMINATED_AT_REPORTED_COMPONENT_QUANTILES",
        "PER_CARD_PAIRED_SENSOR_TIMINGS_REQUIRED_FOR_PROMOTION"
      ],
      joint_end_to_end_observation: false,
      source_report: "docs/reports/no-full-provider-feasible-speed-2026-07-30.md"
    },
    stages: normalizedStages,
    critical_path: criticalPath
  });
}

export function calculateUploadPhysicalLowerBound({
  image_megabytes,
  side_count,
  uplink_megabits_per_second
} = {}) {
  const imageMegabytes = finiteNonNegative(image_megabytes, "image_megabytes");
  const sideCount = finiteNonNegative(side_count, "side_count");
  const uplinkMbps = finiteNonNegative(uplink_megabits_per_second, "uplink_megabits_per_second");
  if (imageMegabytes === 0) fail("POSITIVE_VALUE_REQUIRED", "image_megabytes");
  if (!Number.isInteger(sideCount) || sideCount === 0) fail("POSITIVE_INTEGER_REQUIRED", "side_count");
  if (uplinkMbps === 0) fail("POSITIVE_VALUE_REQUIRED", "uplink_megabits_per_second");

  const totalMegabytes = imageMegabytes * sideCount;
  const byteTransferMs = (8 * totalMegabytes / uplinkMbps) * 1000;
  return deepFreeze({
    evidence_class: latencyEvidenceClasses.PHYSICAL_LOWER_BOUND,
    observed: false,
    unit_convention: "DECIMAL_MB",
    image_megabytes: imageMegabytes,
    side_count: sideCount,
    total_megabytes: totalMegabytes,
    uplink_megabits_per_second: uplinkMbps,
    byte_transfer_ms: byteTransferMs,
    excludes: ["SIGNING_RTT", "TLS_SETUP", "PUT_RTT", "VERIFICATION_RTT", "RETRY_BACKOFF"]
  });
}
