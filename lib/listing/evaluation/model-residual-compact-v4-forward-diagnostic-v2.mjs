// Evaluation-only interpretation of an already frozen compact-v4 run.
//
// This module deliberately does not score truth. It separates mechanically
// observable invariants from model/model disagreement and schema heuristics so
// a missing typed-gold authority cannot be disguised as a factual regression.

export const MODEL_RESIDUAL_COMPACT_V4_FORWARD_DIAGNOSTIC_VERSION =
  "model-residual-compact-v4-forward-diagnostic-v2";

export const COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP = Object.freeze({
  year: Object.freeze(["year"]),
  ip_sport: Object.freeze(["ip"]),
  language: Object.freeze(["language"]),
  manufacturer: Object.freeze(["manufacturer"]),
  product: Object.freeze(["product"]),
  set: Object.freeze(["set"]),
  subject: Object.freeze(["subjects"]),
  card_name: Object.freeze(["card_name"]),
  card_number: Object.freeze(["card_number"]),
  descriptive_rarity: Object.freeze(["descriptive_rarity"]),
  numerical_rarity: Object.freeze(["serial"]),
  release_variant: Object.freeze(["release_variant"]),
  print_finish: Object.freeze(["print_finish"]),
  special_stamp: Object.freeze(["special_stamp"]),
  grading_info: Object.freeze(["grading_info"]),
  description: Object.freeze(["description"]),
  search_optimization: Object.freeze(["components", "team"]),
  lot_quantity: Object.freeze(["lot_count"])
});

const record = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!record(value)) return value ?? null;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalJson(value[key])]));
}

const semanticallyEqual = (left, right) =>
  JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));

const jsonByteEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function textArray(value) {
  return (Array.isArray(value) ? value : []).map(clean).filter(Boolean);
}

function searchOptimization(fields) {
  const components = new Set(textArray(fields.components || fields.attributes));
  return ["RC", "Auto", "Patch", "Relic"]
    .filter((value) => components.has(value))
    .concat(clean(fields.team) ? [clean(fields.team)] : []);
}

export function projectCompactV4CurrentCanonicalFields(fields = {}) {
  invariant(record(fields), "compact_v4_forward_diagnostic_fields_invalid");
  return {
    year: clean(fields.year),
    ip_sport: clean(fields.ip),
    language: clean(fields.language),
    manufacturer: clean(fields.manufacturer),
    product: clean(fields.product),
    set: clean(fields.set),
    subject: textArray(fields.subjects),
    card_name: clean(fields.card_name),
    card_number: clean(fields.card_number),
    descriptive_rarity: clean(fields.descriptive_rarity),
    numerical_rarity: clean(fields.serial),
    release_variant: clean(fields.release_variant),
    print_finish: clean(fields.print_finish),
    special_stamp: clean(fields.special_stamp),
    grading_info: record(fields.grading_info) ? canonicalJson(fields.grading_info) : null,
    description: clean(fields.description),
    search_optimization: searchOptimization(fields),
    lot_quantity: clean(fields.lot_count)
  };
}

export function classifyCompactV4ResolverOutcomeV2({ canonicalFields, canonicalTitle,
  resolved }) {
  invariant(record(canonicalFields) && typeof canonicalTitle === "string" && record(resolved),
    "compact_v4_forward_diagnostic_resolver_input_invalid");
  const defects = Array.isArray(resolved.defects) ? resolved.defects : null;
  const fieldsByteEqual = record(resolved.fields)
    && jsonByteEqual(resolved.fields, canonicalFields);
  const titleByteEqual = typeof resolved.title === "string"
    && resolved.title === canonicalTitle;
  const safeGuardRejection = resolved.accepted === false && defects?.length === 0
    && fieldsByteEqual && titleByteEqual;
  const classification = safeGuardRejection
    ? "SAFE_GUARD_REJECTION_NO_OUTPUT_CHANGE"
    : resolved.accepted === false
      ? "GUARD_REJECTION_WITH_OUTPUT_DISAGREEMENT"
      : resolved.accepted === true && fieldsByteEqual && titleByteEqual
        ? "ACCEPTED_NO_OUTPUT_CHANGE"
        : resolved.accepted === true
          ? "ACCEPTED_OUTPUT_CHANGE"
          : "RESOLVER_SHAPE_INVALID";
  return {
    classification,
    accepted: typeof resolved.accepted === "boolean" ? resolved.accepted : null,
    defects: defects ? [...defects] : null,
    final_title_byte_equal_canonical: titleByteEqual,
    final_fields_byte_equal_canonical: fieldsByteEqual,
    safe_guard_rejection_no_output_change: safeGuardRejection,
    output_title_disagreement: !titleByteEqual,
    output_field_disagreement: !fieldsByteEqual,
    field_regression: null,
    factual_regression: null,
    critical_factual_regression: null,
    factual_authority: "UNAVAILABLE_WITHOUT_INDEPENDENT_TYPED_GOLD"
  };
}

function jobsFrom(checkpoint) {
  invariant(record(checkpoint?.jobs), "compact_v4_forward_diagnostic_checkpoint_jobs_missing");
  const jobs = Object.values(checkpoint.jobs);
  invariant(jobs.every((job) => record(job) && clean(job.asset_id)
    && ["control", "treatment"].includes(job.arm) && record(job.result)),
  "compact_v4_forward_diagnostic_checkpoint_job_invalid");
  const keys = jobs.map((job) => `${job.asset_id}:${job.arm}`);
  invariant(new Set(keys).size === keys.length,
    "compact_v4_forward_diagnostic_checkpoint_job_duplicate");
  return new Map(jobs.map((job) => [`${job.asset_id}:${job.arm}`, job]));
}

function rowsFrom(analysis, arm) {
  const rows = analysis?.[`${arm}_rows`];
  invariant(Array.isArray(rows), `compact_v4_forward_diagnostic_${arm}_rows_missing`);
  invariant(rows.every((row) => record(row) && clean(row.asset_id)),
    `compact_v4_forward_diagnostic_${arm}_row_invalid`);
  invariant(new Set(rows.map((row) => row.asset_id)).size === rows.length,
    `compact_v4_forward_diagnostic_${arm}_row_duplicate`);
  return rows;
}

function fieldDifferences(controlFields, treatmentFields) {
  const control = projectCompactV4CurrentCanonicalFields(controlFields);
  const treatment = projectCompactV4CurrentCanonicalFields(treatmentFields);
  return Object.keys(COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP)
    .filter((field) => !semanticallyEqual(control[field], treatment[field]))
    .map((field) => ({
      canonical_field: field,
      current_thin_sources: [...COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP[field]],
      control_value: control[field],
      treatment_value: treatment[field]
    }));
}

function pairedDisagreement(assetId, controlJob, treatmentJob) {
  const differences = fieldDifferences(controlJob.result.canonical_fields,
    treatmentJob.result.canonical_fields);
  return {
    asset_id: assetId,
    classification: differences.length
      ? "PAIRED_MODEL_OUTPUT_DISAGREEMENT_NO_TRUTH_AUTHORITY"
      : "PAIRED_MODEL_OUTPUT_AGREEMENT",
    canonical_field_disagreement: differences.length > 0,
    changed_fields: differences,
    factual_regression: null,
    critical_factual_regression: null,
    factual_authority: "UNAVAILABLE_WITHOUT_INDEPENDENT_TYPED_GOLD"
  };
}

function shapeFinding(job) {
  const heuristics = job.result.canonical_field_defects;
  invariant(Array.isArray(heuristics),
    `compact_v4_forward_diagnostic_shape_heuristics_invalid:${job.asset_id}:${job.arm}`);
  if (!heuristics.length) return null;
  return {
    asset_id: job.asset_id,
    arm: job.arm,
    classification: "SCHEMA_POLICY_HEURISTIC",
    heuristics: [...heuristics],
    factual_truth: false,
    factual_error: null
  };
}

const trueCount = (rows, key) => rows.filter((row) => row[key] === true).length;

export function buildCompactV4ForwardDiagnosticV2({ checkpoint, analysis,
  independentTypedGoldCards = 0 }) {
  invariant(independentTypedGoldCards === 0,
    "compact_v4_forward_diagnostic_typed_gold_not_supported");
  invariant(record(checkpoint) && record(analysis),
    "compact_v4_forward_diagnostic_inputs_invalid");
  const jobs = jobsFrom(checkpoint);
  const treatmentRows = rowsFrom(analysis, "treatment");
  const controlRows = rowsFrom(analysis, "control");
  const treatmentIds = new Set(treatmentRows.map((row) => row.asset_id));
  const controlIds = new Set(controlRows.map((row) => row.asset_id));
  const checkpointTreatmentIds = new Set([...jobs.values()]
    .filter((job) => job.arm === "treatment").map((job) => job.asset_id));
  const checkpointControlIds = new Set([...jobs.values()]
    .filter((job) => job.arm === "control").map((job) => job.asset_id));
  invariant(checkpointTreatmentIds.size === treatmentIds.size
    && checkpointControlIds.size === controlIds.size
    && [...treatmentIds].every((assetId) => checkpointTreatmentIds.has(assetId))
    && [...controlIds].every((assetId) => treatmentIds.has(assetId)
      && checkpointControlIds.has(assetId)),
  "compact_v4_forward_diagnostic_analysis_checkpoint_mismatch");
  const checkpointFingerprint = clean(checkpoint.run_fingerprint);
  const analysisFingerprint = clean(analysis.validated_run?.run_fingerprint);
  invariant(!checkpointFingerprint || !analysisFingerprint
    || checkpointFingerprint === analysisFingerprint,
  "compact_v4_forward_diagnostic_run_fingerprint_mismatch");

  const resolver_outcomes = treatmentRows.map(({ asset_id: assetId }) => {
    const result = jobs.get(`${assetId}:treatment`).result;
    return { asset_id: assetId, ...classifyCompactV4ResolverOutcomeV2({
      canonicalFields: result.canonical_fields,
      canonicalTitle: result.canonical_title,
      resolved: result.resolved
    }) };
  });
  const paired_canonical_comparisons = controlRows.map(({ asset_id: assetId }) =>
    pairedDisagreement(assetId, jobs.get(`${assetId}:control`),
      jobs.get(`${assetId}:treatment`)));
  const shape_heuristic_findings = [...jobs.values()].map(shapeFinding).filter(Boolean);
  const pairedDisagreementCards = paired_canonical_comparisons
    .filter((row) => row.canonical_field_disagreement).length;

  return {
    schema_version: MODEL_RESIDUAL_COMPACT_V4_FORWARD_DIAGNOSTIC_VERSION,
    authority: "evaluation_only_supplemental_diagnostic",
    production_authorized: false,
    mutates_frozen_prereg_or_analysis: false,
    source: {
      checkpoint_schema_version: checkpoint.schema_version || null,
      checkpoint_state: checkpoint.state || null,
      analysis_schema_version: analysis.schema_version || null,
      run_fingerprint: checkpointFingerprint || analysisFingerprint || null,
      frozen_gate_decision: analysis.gate?.decision || null,
      frozen_gate_result_unchanged: true
    },
    canonical_field_mapping: COMPACT_V4_CURRENT_CANONICAL_FIELD_MAP,
    summary: {
      treatment_cards: treatmentRows.length,
      paired_control_cards: controlRows.length,
      safe_guard_rejection_no_output_change_cards: resolver_outcomes
        .filter((row) => row.safe_guard_rejection_no_output_change).length,
      resolver_output_field_disagreement_cards: resolver_outcomes
        .filter((row) => row.output_field_disagreement).length,
      resolver_output_title_disagreement_cards: resolver_outcomes
        .filter((row) => row.output_title_disagreement).length,
      paired_canonical_disagreement_cards: pairedDisagreementCards,
      paired_canonical_agreement_cards: controlRows.length - pairedDisagreementCards,
      paired_canonical_disagreement_cells: paired_canonical_comparisons
        .reduce((sum, row) => sum + row.changed_fields.length, 0),
      schema_policy_heuristic_rows: shape_heuristic_findings.length,
      invalid_compact_value_cards: trueCount(treatmentRows, "invalid_compact_value"),
      title_over_80_cards: trueCount(treatmentRows, "title_over_80")
    },
    factual_metrics: {
      availability: "UNAVAILABLE_WITHOUT_INDEPENDENT_TYPED_GOLD",
      independent_typed_gold_cards: 0,
      factual_regression_cards: null,
      critical_factual_regression_cards: null,
      resolver_factual_regression_cards: null,
      paired_canonical_factual_regression_cards: null,
      shape_factual_error_cards: null
    },
    resolver_outcomes,
    paired_canonical_comparisons,
    shape_heuristic_findings,
    interpretation: {
      diagnostic_decision: "NO_PROMOTION_DECISION_SUPPLEMENT_ONLY",
      frozen_gate_must_not_be_rewritten_post_hoc: true,
      next_evidence: "independent typed gold is required for factual or critical regression claims"
    }
  };
}
