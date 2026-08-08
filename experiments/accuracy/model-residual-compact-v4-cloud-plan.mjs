import { createHash } from "node:crypto";

import { MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4 } from "./model-residual-compact-v4.mjs";

export const MODEL_RESIDUAL_COMPACT_V4_PROPERTY = "residual_printed_phrase";
export const MODEL_RESIDUAL_COMPACT_V4_MODEL = "gpt-5.6-luna";
export const MODEL_RESIDUAL_COMPACT_V4_EFFORT = "low";
export const MODEL_RESIDUAL_COMPACT_V4_DETAIL = "high";
export const MODEL_RESIDUAL_COMPACT_V4_REGION = "sin1";
export const MODEL_RESIDUAL_COMPACT_V4_CONCURRENCY = 1;
export const MODEL_RESIDUAL_COMPACT_V4_MAX_ATTEMPTS_PER_JOB = 1;
export const MODEL_RESIDUAL_COMPACT_V4_SCHEMA_SHA256 =
  "2ec797216b90df9c8d4ab634325f6a1dee4959cc58f4064dca4c5f7b4e5b628b";
export const MODEL_RESIDUAL_COMPACT_V4_CONFIRMATORY_SALT =
  "model-residual-compact-v4-confirmatory-2026-08-09-v1";
export const MODEL_RESIDUAL_COMPACT_V4_BLOCK_ORDERS = Object.freeze([
  ["paired_control", "paired_treatment", "unpaired_treatment"],
  ["paired_control", "unpaired_treatment", "paired_treatment"],
  ["paired_treatment", "paired_control", "unpaired_treatment"],
  ["paired_treatment", "unpaired_treatment", "paired_control"],
  ["unpaired_treatment", "paired_control", "paired_treatment"],
  ["unpaired_treatment", "paired_treatment", "paired_control"]
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const bytes = (value) => JSON.stringify(value);

function stableRank(seed, assetId) {
  return sha256(`${seed}\0${assetId}`);
}

function combinations(n, k) {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (n - k + index) / index;
  return result;
}

export function binomialTailProbability(n, threshold, probability) {
  if (!Number.isInteger(n) || !Number.isInteger(threshold) || threshold < 0 || threshold > n
      || !(probability >= 0 && probability <= 1)) {
    throw new RangeError("compact_v4_binomial_parameters_invalid");
  }
  let result = 0;
  for (let wins = threshold; wins <= n; wins += 1) {
    result += combinations(n, wins) * probability ** wins * (1 - probability) ** (n - wins);
  }
  return result;
}

export function minimumTrialsForBinomialPower({ threshold, probability, power }) {
  for (let trials = threshold; trials <= 10_000; trials += 1) {
    if (binomialTailProbability(trials, threshold, probability) >= power) return trials;
  }
  throw new Error("compact_v4_binomial_power_search_exhausted");
}

export function semanticCompactV4RequestSha256(request) {
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

export function withModelResidualCompactV4(request) {
  if (sha256(bytes(MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4))
      !== MODEL_RESIDUAL_COMPACT_V4_SCHEMA_SHA256) {
    throw new Error("compact_v4_schema_fingerprint_changed");
  }
  const treatment = structuredClone(request);
  const schema = treatment?.text?.format?.schema;
  if (!schema?.properties || !Array.isArray(schema.required)) {
    throw new Error("compact_v4_response_schema_missing");
  }
  if (Object.hasOwn(schema.properties, MODEL_RESIDUAL_COMPACT_V4_PROPERTY)
      || schema.required.includes(MODEL_RESIDUAL_COMPACT_V4_PROPERTY)) {
    throw new Error("compact_v4_property_already_present");
  }
  schema.properties = {
    [MODEL_RESIDUAL_COMPACT_V4_PROPERTY]: structuredClone(
      MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4
    ),
    ...schema.properties
  };
  schema.required = [MODEL_RESIDUAL_COMPACT_V4_PROPERTY, ...schema.required];
  return treatment;
}

function assertRequestEnvelope(request) {
  if (request?.model !== MODEL_RESIDUAL_COMPACT_V4_MODEL
      || request?.reasoning?.effort !== MODEL_RESIDUAL_COMPACT_V4_EFFORT) {
    throw new Error("compact_v4_model_or_effort_not_frozen");
  }
  const images = request?.input?.[0]?.content?.filter((part) => part.type === "input_image") || [];
  if (!images.length || images.some((part) => part.detail !== MODEL_RESIDUAL_COMPACT_V4_DETAIL)) {
    throw new Error("compact_v4_image_detail_not_frozen");
  }
}

export function assertCompactV4RequestIsolation({ control, treatment }) {
  assertRequestEnvelope(control);
  assertRequestEnvelope(treatment);
  const left = structuredClone(control);
  const right = structuredClone(treatment);
  const leftSchema = left.text?.format?.schema;
  const rightSchema = right.text?.format?.schema;
  if (!leftSchema || !rightSchema) throw new Error("compact_v4_response_schema_missing");
  const property = MODEL_RESIDUAL_COMPACT_V4_PROPERTY;
  if (Object.hasOwn(leftSchema.properties || {}, property)
      || !Object.hasOwn(rightSchema.properties || {}, property)) {
    throw new Error("compact_v4_property_delta_invalid");
  }
  if (bytes(rightSchema.properties) !== bytes({
    [property]: MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4,
    ...leftSchema.properties
  }) || bytes(rightSchema.required) !== bytes([property, ...leftSchema.required])) {
    throw new Error("compact_v4_canonical_schema_path_changed");
  }
  const leftShell = structuredClone(leftSchema);
  const rightShell = structuredClone(rightSchema);
  delete leftShell.properties;
  delete leftShell.required;
  delete rightShell.properties;
  delete rightShell.required;
  if (bytes(leftShell) !== bytes(rightShell)) throw new Error("compact_v4_schema_shell_changed");
  delete left.text.format.schema;
  delete right.text.format.schema;
  if (bytes(left) !== bytes(right)) {
    throw new Error("compact_v4_treatment_changed_outside_response_schema");
  }
  return {
    control_request_sha256: semanticCompactV4RequestSha256(control),
    treatment_request_sha256: semanticCompactV4RequestSha256(treatment),
    control_schema_sha256: sha256(bytes(leftSchema)),
    treatment_schema_sha256: sha256(bytes(rightSchema))
  };
}

export function selectCompactV4ConfirmatoryCohort(populationIds, excludedIds, {
  count = 70,
  seed = MODEL_RESIDUAL_COMPACT_V4_CONFIRMATORY_SALT
} = {}) {
  if (!Array.isArray(populationIds) || new Set(populationIds).size !== populationIds.length) {
    throw new Error("compact_v4_population_invalid");
  }
  const excluded = new Set(excludedIds || []);
  const eligible = populationIds.filter((assetId) => !excluded.has(assetId));
  if (eligible.length < count) throw new Error("compact_v4_confirmatory_population_too_small");
  return [...eligible].sort((left, right) => stableRank(seed, left)
    .localeCompare(stableRank(seed, right))).slice(0, count);
}

export function balancedCompactV4BudgetSchedule(cohort, {
  seed = `${MODEL_RESIDUAL_COMPACT_V4_CONFIRMATORY_SALT}:schedule`
} = {}) {
  if (!Array.isArray(cohort) || cohort.length !== 70 || new Set(cohort).size !== 70) {
    throw new Error("compact_v4_budget_schedule_requires_70_cards");
  }
  const ranked = [...cohort].sort((left, right) => stableRank(`${seed}:pair-split`, left)
    .localeCompare(stableRank(`${seed}:pair-split`, right)));
  const paired = ranked.slice(0, 35).sort((left, right) => stableRank(`${seed}:paired`, left)
    .localeCompare(stableRank(`${seed}:paired`, right)));
  const unpaired = ranked.slice(35).sort((left, right) => stableRank(`${seed}:unpaired`, left)
    .localeCompare(stableRank(`${seed}:unpaired`, right)));
  return paired.map((pairedAssetId, index) => ({
    block_index: index + 1,
    paired_asset_id: pairedAssetId,
    unpaired_asset_id: unpaired[index],
    order: [...MODEL_RESIDUAL_COMPACT_V4_BLOCK_ORDERS[index
      % MODEL_RESIDUAL_COMPACT_V4_BLOCK_ORDERS.length]]
  }));
}

export function assertCompactV4BudgetSchedule(schedule) {
  if (!Array.isArray(schedule) || schedule.length !== 35) {
    throw new Error("compact_v4_budget_schedule_requires_35_blocks");
  }
  const treatmentIds = new Set();
  const controlIds = new Set();
  const jobs = new Set();
  const counts = Object.fromEntries(MODEL_RESIDUAL_COMPACT_V4_BLOCK_ORDERS
    .map((order) => [order.join(">"), 0]));
  for (const block of schedule) {
    if (treatmentIds.has(block.paired_asset_id)
        || treatmentIds.has(block.unpaired_asset_id)
        || block.paired_asset_id === block.unpaired_asset_id) {
      throw new Error("compact_v4_budget_schedule_duplicate_asset");
    }
    treatmentIds.add(block.paired_asset_id);
    treatmentIds.add(block.unpaired_asset_id);
    controlIds.add(block.paired_asset_id);
    const orderKey = block.order?.join(">");
    if (!Object.hasOwn(counts, orderKey)) throw new Error("compact_v4_budget_schedule_order_invalid");
    counts[orderKey] += 1;
    jobs.add(`${block.paired_asset_id}\0control`);
    jobs.add(`${block.paired_asset_id}\0treatment`);
    jobs.add(`${block.unpaired_asset_id}\0treatment`);
  }
  if (jobs.size !== 105 || treatmentIds.size !== 70 || controlIds.size !== 35
      || JSON.stringify(Object.values(counts).sort((left, right) => right - left))
        !== JSON.stringify([6, 6, 6, 6, 6, 5])) {
    throw new Error("compact_v4_budget_schedule_unbalanced");
  }
  return { treatment_cards: treatmentIds.size, paired_control_cards: controlIds.size,
    jobs: jobs.size, order_counts: counts };
}
