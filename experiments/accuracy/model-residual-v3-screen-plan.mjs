import { createHash } from "node:crypto";

export const MODEL_RESIDUAL_V3_ARMS = Object.freeze(["control_a", "control_b", "residual_c"]);
export const MODEL_RESIDUAL_V3_ORDERS = Object.freeze([
  ["control_a", "control_b", "residual_c"],
  ["control_a", "residual_c", "control_b"],
  ["control_b", "control_a", "residual_c"],
  ["control_b", "residual_c", "control_a"],
  ["residual_c", "control_a", "control_b"],
  ["residual_c", "control_b", "control_a"]
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableRank = (seed, assetId) => sha256(`${seed}\0${assetId}`);

export function semanticRequestSha256(request) {
  let imageIndex = 0;
  const normalized = JSON.parse(JSON.stringify(request, (key, value) => {
    if (key === "image_url" && typeof value === "string") {
      imageIndex += 1;
      return `semantic-image-${imageIndex}`;
    }
    return value;
  }));
  return sha256(JSON.stringify(normalized));
}

function canonicalFieldDifference(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null));
}

// The input rows may contain scorer labels, but this projection cannot see
// them. Cohort selection therefore remains invariant if every label is erased
// or adversarially replaced.
export function providerOnlyFeatures(rows, { seed = "model-residual-v3-2026-08-08" } = {}) {
  const pairs = new Map();
  for (const row of rows) {
    const assetId = String(row?.asset_id || "");
    if (!assetId) throw new Error("v3_feature_asset_id_missing");
    const side = row.arm === "thin_canonical_high" ? "control"
      : row.arm === "thin_canonical_field_observation_v2_high" ? "observation" : null;
    if (!side) continue;
    const pair = pairs.get(assetId) || { asset_id: assetId };
    if (pair[side]) throw new Error(`v3_feature_duplicate_arm:${assetId}:${side}`);
    pair[side] = {
      fields: structuredClone(row.fields || {}),
      observation_count: Array.isArray(row.observations) ? row.observations.length : 0,
      image_set_sha256: String(row.image_set_sha256 || "")
    };
    pairs.set(assetId, pair);
  }
  return [...pairs.values()].map((pair) => {
    if (!pair.control || !pair.observation) throw new Error(`v3_feature_pair_missing:${pair.asset_id}`);
    if (!/^[0-9a-f]{64}$/.test(pair.control.image_set_sha256)
      || pair.control.image_set_sha256 !== pair.observation.image_set_sha256) {
      throw new Error(`v3_feature_image_set_mismatch:${pair.asset_id}`);
    }
    const differing = canonicalFieldDifference(pair.control.fields, pair.observation.fields);
    return {
      asset_id: pair.asset_id,
      image_set_sha256: pair.control.image_set_sha256,
      prior_candidate_count: pair.observation.observation_count,
      prior_schema_sensitive_field_count: differing.length,
      prior_schema_sensitive_fields_sha256: sha256(JSON.stringify(differing.sort())),
      stable_rank: stableRank(seed, pair.asset_id)
    };
  });
}

export function selectLabelBlindCohort(features, {
  candidateRich = 14, schemaSensitive = 14, stableControls = 7
} = {}) {
  const byId = new Map(features.map((row) => [row.asset_id, row]));
  if (byId.size !== features.length) throw new Error("v3_feature_duplicate_asset");
  const selected = [];
  const take = (rows, count, stratum) => {
    for (const row of rows) {
      if (selected.some((item) => item.asset_id === row.asset_id)) continue;
      selected.push({ ...row, stratum });
      if (selected.filter((item) => item.stratum === stratum).length === count) break;
    }
    if (selected.filter((item) => item.stratum === stratum).length !== count) {
      throw new Error(`v3_cohort_stratum_short:${stratum}`);
    }
  };
  const ranked = (rows, key) => [...rows].sort((a, b) => b[key] - a[key]
    || a.stable_rank.localeCompare(b.stable_rank));
  take(ranked(features.filter((row) => row.prior_candidate_count > 0), "prior_candidate_count"),
    candidateRich, "prior_candidate_rich");
  take(ranked(features.filter((row) => row.prior_schema_sensitive_field_count > 0),
    "prior_schema_sensitive_field_count"), schemaSensitive, "prior_schema_sensitive");
  take([...features].filter((row) => row.prior_candidate_count === 0
      && row.prior_schema_sensitive_field_count === 0)
    .sort((a, b) => a.stable_rank.localeCompare(b.stable_rank)), stableControls, "prior_stable_control");
  if (selected.length !== candidateRich + schemaSensitive + stableControls) {
    throw new Error("v3_cohort_size_mismatch");
  }
  return selected;
}

export function balancedThreeArmSchedule(cohort, { seed = "model-residual-v3-order-2026-08-08" } = {}) {
  const ranked = [...cohort].sort((a, b) => stableRank(seed, a.asset_id)
    .localeCompare(stableRank(seed, b.asset_id)));
  return ranked.map((row, index) => ({
    asset_id: row.asset_id,
    image_set_sha256: row.image_set_sha256,
    stratum: row.stratum,
    order: [...MODEL_RESIDUAL_V3_ORDERS[index % MODEL_RESIDUAL_V3_ORDERS.length]]
  }));
}

export function assertThreeArmRequestIsolation({ controlA, controlB, residualC }) {
  const bytes = (value) => JSON.stringify(value);
  if (bytes(controlA) !== bytes(controlB)) throw new Error("v3_controls_not_byte_identical");
  for (const request of [controlA, controlB, residualC]) {
    if (request?.reasoning?.effort !== "low") throw new Error("v3_reasoning_effort_not_low");
    const images = request?.input?.[0]?.content?.filter((part) => part.type === "input_image") || [];
    if (!images.length || images.some((part) => part.detail !== "high")) {
      throw new Error("v3_image_detail_not_high");
    }
  }
  const left = structuredClone(controlA);
  const right = structuredClone(residualC);
  const leftSchema = left.text?.format?.schema;
  const rightSchema = right.text?.format?.schema;
  if (!leftSchema || !rightSchema) throw new Error("v3_response_schema_missing");
  const property = "residual_visible_evidence";
  if (Object.hasOwn(leftSchema.properties || {}, property)
    || !Object.hasOwn(rightSchema.properties || {}, property)) {
    throw new Error("v3_residual_property_delta_invalid");
  }
  const expectedProperties = { [property]: structuredClone(rightSchema.properties[property]),
    ...structuredClone(leftSchema.properties) };
  const expectedRequired = [property, ...leftSchema.required];
  if (bytes(rightSchema.properties) !== bytes(expectedProperties)
    || bytes(rightSchema.required) !== bytes(expectedRequired)) {
    throw new Error("v3_canonical_schema_path_changed");
  }
  const leftSchemaShell = structuredClone(leftSchema);
  const rightSchemaShell = structuredClone(rightSchema);
  delete leftSchemaShell.properties; delete leftSchemaShell.required;
  delete rightSchemaShell.properties; delete rightSchemaShell.required;
  if (bytes(leftSchemaShell) !== bytes(rightSchemaShell)) throw new Error("v3_schema_shell_changed");
  delete left.text.format.schema;
  delete right.text.format.schema;
  if (bytes(left) !== bytes(right)) throw new Error("v3_treatment_changed_outside_response_schema");
  return {
    control_request_sha256: semanticRequestSha256(controlA),
    residual_request_sha256: semanticRequestSha256(residualC),
    control_schema_sha256: sha256(bytes(leftSchema)),
    residual_schema_sha256: sha256(bytes(rightSchema))
  };
}

export function assertScreenSchedule(schedule) {
  if (schedule.length !== 35) throw new Error("v3_schedule_requires_35_cards");
  const counts = Object.fromEntries(MODEL_RESIDUAL_V3_ORDERS.map((order) => [order.join(">"), 0]));
  const jobs = new Set();
  for (const card of schedule) {
    const key = card.order.join(">");
    if (!Object.hasOwn(counts, key)) throw new Error("v3_schedule_unknown_order");
    counts[key] += 1;
    if (new Set(card.order).size !== 3) throw new Error("v3_schedule_arm_duplicate");
    for (const arm of card.order) jobs.add(`${card.asset_id}\0${arm}`);
  }
  if (jobs.size !== 105) throw new Error("v3_schedule_job_count_mismatch");
  if (JSON.stringify(Object.values(counts).sort((a, b) => b - a)) !== JSON.stringify([6, 6, 6, 6, 6, 5])) {
    throw new Error("v3_schedule_order_imbalance");
  }
  return { cards: schedule.length, jobs: jobs.size, order_counts: counts };
}
