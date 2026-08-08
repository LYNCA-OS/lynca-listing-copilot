const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function quantile(values, probability) {
  if (!values.length) return NaN;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(probability * ordered.length) - 1)];
}

function combinations(n, k) {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (n - k + index) / index;
  return result;
}

export function exactTwoSidedSignP(wins, losses) {
  const directional = wins + losses;
  if (!directional) return 1;
  const tail = Math.min(wins, losses);
  let probability = 0;
  for (let index = 0; index <= tail; index += 1) {
    probability += combinations(directional, index) * (0.5 ** directional);
  }
  return Math.min(1, 2 * probability);
}

function count(rows, key) {
  return rows.filter((row) => row[key] === true).length;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertRows({ prereg, treatmentRows, controlRows }) {
  if (!Array.isArray(treatmentRows) || treatmentRows.length !== 70
      || !Array.isArray(controlRows) || controlRows.length !== 35) {
    throw new Error("compact_v4_gate_requires_70t_35c");
  }
  const treatmentById = new Map(treatmentRows.map((row) => [row.asset_id, row]));
  const controlById = new Map(controlRows.map((row) => [row.asset_id, row]));
  if (treatmentById.size !== 70 || controlById.size !== 35) {
    throw new Error("compact_v4_gate_duplicate_asset");
  }
  const expectedTreatment = new Set(prereg.confirmatory_70.asset_ids);
  const expectedControls = new Set(prereg.confirmatory_70.schedule.map((block) => block.paired_asset_id));
  if ([...expectedTreatment].some((assetId) => !treatmentById.has(assetId))
      || [...expectedControls].some((assetId) => !controlById.has(assetId))
      || [...controlById].some(([assetId]) => !expectedControls.has(assetId))) {
    throw new Error("compact_v4_gate_cohort_mismatch");
  }
  for (const row of [...treatmentRows, ...controlRows]) {
    const arm = treatmentById.get(row.asset_id) === row ? "treatment" : "control";
    const requiredBooleans = arm === "treatment" ? [
      "critical_error",
      "reference_loss",
      "unbacked_new_token",
      "unsupported_numeric_change",
      "invalid_compact_value",
      "ambiguous_route_applied",
      "title_over_80",
      "canonical_shape_defect",
      "resolved_field_regression",
      "canonical_critical_field_regression"
    ] : ["canonical_shape_defect", "canonical_critical_field_regression"];
    const expectedRequest = prereg.frozen_contract.provider.request_contracts_by_image_count
      ?.[String(row.image_count)]?.[`${arm}_request_sha256`];
    if (requiredBooleans.some((key) => typeof row[key] !== "boolean")
        || !finiteNumber(row.canonical_f1) || row.canonical_f1 < 0 || row.canonical_f1 > 1
        || (arm === "treatment" && (!finiteNumber(row.resolved_f1)
          || row.resolved_f1 < 0 || row.resolved_f1 > 1))
        || !finiteNumber(row.latency_ms) || row.latency_ms < 0
        || !finiteNumber(row.total_tokens) || row.total_tokens < 0
        || !finiteNumber(row.output_tokens) || row.output_tokens < 0
        || row.environment !== "preview" || row.region !== "sin1"
        || row.request_attempt_count !== 1 || row.provider_retries !== 0
        || row.request_sha256 !== expectedRequest) {
      throw new Error(`compact_v4_gate_row_contract_invalid:${row.asset_id}:${arm}`);
    }
  }
  return { treatmentById, controlById, expectedControls };
}

export function evaluateModelResidualCompactV4PreviewGate({
  prereg,
  treatmentRows,
  controlRows
}) {
  const { treatmentById, controlById, expectedControls } = assertRows({ prereg,
    treatmentRows, controlRows });
  const gates = prereg.gates.budgeted_strict_70t_35c;
  const deltas = treatmentRows.map((row) => row.resolved_f1 - row.canonical_f1);
  const wins = deltas.filter((value) => value > 1e-12).length;
  const losses = deltas.filter((value) => value < -1e-12).length;
  const ties = deltas.length - wins - losses;
  const resolverDelta = mean(treatmentRows.map((row) => row.resolved_f1))
    - mean(treatmentRows.map((row) => row.canonical_f1));
  const signP = exactTwoSidedSignP(wins, losses);
  const pairedTreatment = [...expectedControls].map((assetId) => treatmentById.get(assetId));
  const pairedControl = [...expectedControls].map((assetId) => controlById.get(assetId));
  const canonicalInterference = mean(pairedTreatment.map((row) => row.canonical_f1))
    - mean(pairedControl.map((row) => row.canonical_f1));
  const ratios = {
    total_tokens_p50: quantile(pairedTreatment.map((row) => row.total_tokens), 0.5)
      / quantile(pairedControl.map((row) => row.total_tokens), 0.5),
    output_tokens_p50: quantile(pairedTreatment.map((row) => row.output_tokens), 0.5)
      / quantile(pairedControl.map((row) => row.output_tokens), 0.5),
    latency_p50: quantile(pairedTreatment.map((row) => row.latency_ms), 0.5)
      / quantile(pairedControl.map((row) => row.latency_ms), 0.5),
    latency_p95: quantile(pairedTreatment.map((row) => row.latency_ms), 0.95)
      / quantile(pairedControl.map((row) => row.latency_ms), 0.95)
  };
  const safetyCounts = Object.fromEntries([
    "critical_error",
    "reference_loss",
    "unbacked_new_token",
    "unsupported_numeric_change",
    "invalid_compact_value",
    "ambiguous_route_applied",
    "title_over_80",
    "canonical_shape_defect",
    "resolved_field_regression",
    "canonical_critical_field_regression"
  ].map((key) => [key, count(treatmentRows, key) + (key === "canonical_shape_defect"
    || key === "canonical_critical_field_regression" ? count(controlRows, key) : 0)]));
  const hardSafetyPass = losses === gates.resolver_losses
    && safetyCounts.critical_error === gates.critical_error_cards
    && safetyCounts.reference_loss === gates.reference_loss_cards
    && safetyCounts.unbacked_new_token === gates.unbacked_new_token_cards
    && safetyCounts.unsupported_numeric_change === gates.unsupported_numeric_change_cards
    && safetyCounts.invalid_compact_value === gates.invalid_compact_value_cards
    && safetyCounts.ambiguous_route_applied === gates.ambiguous_route_applied_cards
    && safetyCounts.title_over_80 === gates.titles_over_80
    && safetyCounts.canonical_shape_defect === gates.canonical_shape_defect_cards
    && safetyCounts.resolved_field_regression === gates.treatment_resolved_field_regressions
    && safetyCounts.canonical_critical_field_regression
      === gates.treatment_canonical_critical_field_regressions_vs_fresh_paired_control;
  const utilityPass = resolverDelta >= gates.resolver_delta_macro_f1_at_least
    && wins >= gates.resolver_wins_at_least
    && signP <= gates.two_sided_exact_sign_p_at_most;
  const nonInterferencePass = canonicalInterference
    >= gates.treatment_canonical_delta_f1_vs_fresh_paired_control_at_least;
  const economicsPass = ratios.total_tokens_p50
      <= gates.treatment_to_control_total_tokens_p50_at_most
    && ratios.output_tokens_p50 <= gates.treatment_to_control_output_tokens_p50_at_most
    && ratios.latency_p50 <= gates.treatment_to_control_latency_p50_at_most
    && ratios.latency_p95 <= gates.treatment_to_control_latency_p95_at_most;
  const decision = !hardSafetyPass ? "STOP_HARD_REGRESSION"
    : utilityPass && nonInterferencePass && economicsPass
      ? "PASS_FOR_FRESH150_BUNDLE_ONLY"
      : "HOLD_INCONCLUSIVE_OR_UNECONOMIC";
  return {
    schema_version: "model-residual-compact-v4-preview-gate-result-v1",
    authority: "evaluation_only",
    decision,
    production_authorized: false,
    sample: { treatment_cards: 70, paired_control_cards: 35, provider_calls: 105 },
    utility: { resolver_delta_macro_f1: resolverDelta, wins, losses, ties,
      exact_two_sided_sign_p: signP, passed: utilityPass },
    non_interference: { paired_canonical_delta_macro_f1: canonicalInterference,
      passed: nonInterferencePass },
    economics: { ...ratios, passed: economicsPass },
    safety: { ...safetyCounts, passed: hardSafetyPass },
    next_if_pass: "include the frozen mechanism in a new shared-control fresh150 bundle; never deploy directly"
  };
}
