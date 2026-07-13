import crypto from "node:crypto";

export const evaluationSampleModes = Object.freeze([
  "UNSPECIFIED",
  "FIXED_REGRESSION",
  "FRESH_GENERALIZATION",
  "PAIRED_ABLATION",
  "CONCURRENCY_FRESH"
]);

const allowedModes = new Set(evaluationSampleModes);
const freshModes = new Set(["FRESH_GENERALIZATION", "CONCURRENCY_FRESH"]);
const reusableModes = new Set(["FIXED_REGRESSION", "PAIRED_ABLATION"]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedIds(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))].sort();
}

export function normalizeEvaluationSampleMode(value = "UNSPECIFIED") {
  const mode = cleanText(value || "UNSPECIFIED").toUpperCase();
  if (!allowedModes.has(mode)) throw new Error(`Unsupported evaluation sample mode: ${value}`);
  return mode;
}

export function evaluationItemSetSha256(values = []) {
  return crypto.createHash("sha256").update(normalizedIds(values).join("\n")).digest("hex");
}

export function buildEvaluationSamplePolicy({
  mode = "UNSPECIFIED",
  excludedItemIds = [],
  selectedItemIds = [],
  exclusionSourceCount = 0
} = {}) {
  const normalizedMode = normalizeEvaluationSampleMode(mode);
  const excluded = normalizedIds(excludedItemIds);
  const selected = normalizedIds(selectedItemIds);
  const excludedSet = new Set(excluded);
  const overlap = selected.filter((itemId) => excludedSet.has(itemId));
  const fresh = freshModes.has(normalizedMode);
  const hasExclusionEvidence = excluded.length > 0 && Number(exclusionSourceCount || 0) > 0;
  return {
    mode: normalizedMode,
    sample_reuse_permitted: reusableModes.has(normalizedMode),
    generalization_claim_permitted: fresh,
    same_sample_required: normalizedMode === "PAIRED_ABLATION",
    cross_wave_overlap_permitted: reusableModes.has(normalizedMode),
    selected_item_count: selected.length,
    selected_item_ids_sha256: evaluationItemSetSha256(selected),
    excluded_item_count: excluded.length,
    excluded_item_ids_sha256: evaluationItemSetSha256(excluded),
    exclusion_source_count: Math.max(0, Math.trunc(Number(exclusionSourceCount) || 0)),
    prior_history_exclusion_present: hasExclusionEvidence,
    prior_history_overlap_count: overlap.length,
    novelty_verified: fresh && hasExclusionEvidence && overlap.length === 0
  };
}

export function assertEvaluationSampleProvenance({
  requestedMode = "UNSPECIFIED",
  datasetPolicy = null
} = {}) {
  const mode = normalizeEvaluationSampleMode(requestedMode);
  if (!freshModes.has(mode)) return { mode, verified: false, required: false };
  if (!datasetPolicy || typeof datasetPolicy !== "object") {
    throw new Error(`${mode} requires dataset evaluation_sample_policy provenance.`);
  }
  const datasetMode = normalizeEvaluationSampleMode(datasetPolicy.mode || "UNSPECIFIED");
  if (datasetMode !== mode) {
    throw new Error(`Evaluation sample mode mismatch: requested ${mode}, dataset proves ${datasetMode}.`);
  }
  if (datasetPolicy.novelty_verified !== true) {
    throw new Error(`${mode} requires novelty_verified=true.`);
  }
  if (Number(datasetPolicy.excluded_item_count || 0) < 1 || Number(datasetPolicy.exclusion_source_count || 0) < 1) {
    throw new Error(`${mode} requires non-empty prior evaluation history exclusion evidence.`);
  }
  if (Number(datasetPolicy.prior_history_overlap_count || 0) !== 0) {
    throw new Error(`${mode} dataset overlaps prior evaluation history.`);
  }
  if (!cleanText(datasetPolicy.selected_item_ids_sha256) || !cleanText(datasetPolicy.excluded_item_ids_sha256)) {
    throw new Error(`${mode} requires selected and excluded item-set hashes.`);
  }
  return { mode, verified: true, required: true };
}
