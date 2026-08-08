import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ARM_SPECS } from "./run-thin-path-eval.mjs";
import {
  assertScreenSchedule,
  assertThreeArmRequestIsolation,
  providerOnlyFeatures,
  semanticRequestSha256
} from "../experiments/accuracy/model-residual-v3-screen-plan.mjs";
import { withModelResidualCandidateLaneV3 } from "../experiments/accuracy/model-residual-candidate-lane-v3.mjs";

const prereg = JSON.parse(readFileSync(
  new URL("../experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json", import.meta.url)));
const ids = JSON.parse(readFileSync(
  new URL("../experiments/accuracy/model-residual-candidate-v3-35.asset-ids.json", import.meta.url)));
assert.equal(ids.length, 35);
assert.equal(new Set(ids).size, 35);
assert.equal(prereg.design.planned_provider_calls, 105);
assert.equal(prereg.design.arms_per_card, 3);
assert.equal(prereg.frozen_contract.reasoning_effort, "low");
assert.equal(prereg.frozen_contract.image_detail, "high");
assert.equal(prereg.frozen_contract.controls_byte_identical, true);
assert.equal(prereg.frozen_contract.treatment_changes_response_schema_only, true);
assert.equal(prereg.frozen_contract.format_name_unchanged, true);
assert.equal(prereg.execution_authorized, false);
assert.equal(prereg.provider_calls_made, 0);
assert.equal(prereg.analysis_inputs.dataset_sha256,
  "5aebd6a4bb08665d6601801258e39a5954ec82b7187f71f577f18c71bd27adca");
assert.equal(prereg.analysis_inputs.selected_label_ref_mapping_sha256,
  "16d80d87632d083a6abb98fedc5c6c57c47092369391f92f1bd684f0ece75ab9");
assert.equal(prereg.analysis_inputs.sealed_labels_sha256,
  "59669f166180aab0bef24b5133b3cc92b06366f955eae54af0c43f7247436646");
assert.equal(prereg.analysis_inputs.sealed_label_bytes_read_before_predictions_frozen, false);
const preregSource = readFileSync(new URL(
  "./preregister-model-residual-candidate-v3-35x3.mjs", import.meta.url), "utf8");
assert.doesNotMatch(preregSource, /readFileSync\(resolve\(evalRoot,\s*LABELS_PATH\)/,
  "preregistration must freeze the sealed hash constant without opening sealed label bytes");
assert.deepEqual(Object.values(prereg.design.order_balance).sort((a, b) => b - a), [6, 6, 6, 6, 6, 5]);
assert.deepEqual(Object.fromEntries([...new Set(prereg.cohort.map((row) => row.stratum))]
  .map((stratum) => [stratum, prereg.cohort.filter((row) => row.stratum === stratum).length])), {
  prior_candidate_rich: 14,
  prior_schema_sensitive: 14,
  prior_stable_control: 7
});
assert.equal(assertScreenSchedule(prereg.cohort).jobs, 105);

// Label-blind is behavioral, not a comment: replacing every scoring-side
// value must leave the only permitted feature projection byte-identical.
const imageSetSha256 = "a".repeat(64);
const rows = [
  { asset_id: "synthetic-1", arm: "thin_canonical_high", image_set_sha256: imageSetSha256,
    fields: { product: "Topps Chrome" }, observations: [] },
  { asset_id: "synthetic-1", arm: "thin_canonical_field_observation_v2_high",
    image_set_sha256: imageSetSha256, fields: { product: "Topps Chrome Sapphire" },
    observations: [{ text: "Topps Chrome Sapphire" }] }
];
const adversarialLabels = rows.map((row, index) => ({
  ...row,
  reference: `ADVERSARIAL LABEL ${index}`,
  score: index % 2,
  f1: index / 1000,
  recall: 1,
  precision: 0,
  title: `SCORER TITLE ${index}`
}));
assert.deepEqual(providerOnlyFeatures(rows), providerOnlyFeatures(adversarialLabels));

const context = { imageUrls: ["https://contract.invalid/front"], model: "gpt-5.6-luna",
  effort: "low", imageDetail: "high" };
const controlA = ARM_SPECS.thin_canonical_high_effort_low.buildRequest(context);
const controlB = structuredClone(controlA);
const residualC = withModelResidualCandidateLaneV3(controlA, { enabled: true });
assert.doesNotThrow(() => assertThreeArmRequestIsolation({ controlA, controlB, residualC }));
const rotated = ARM_SPECS.thin_canonical_high_effort_low.buildRequest({ ...context,
  imageUrls: ["https://different-signed-url.invalid/front?token=rotated"] });
assert.equal(semanticRequestSha256(controlA), semanticRequestSha256(rotated));

const badControl = structuredClone(controlB);
badControl.reasoning.effort = "none";
assert.throws(() => assertThreeArmRequestIsolation({ controlA, controlB: badControl, residualC }),
  /controls_not_byte_identical/);
const badPrompt = structuredClone(residualC);
badPrompt.input[0].content[0].text += " extra instruction";
assert.throws(() => assertThreeArmRequestIsolation({ controlA, controlB, residualC: badPrompt }),
  /changed_outside_response_schema/);
const badName = structuredClone(residualC);
badName.text.format.name += "_treatment";
assert.throws(() => assertThreeArmRequestIsolation({ controlA, controlB, residualC: badName }),
  /changed_outside_response_schema/);
const badCanonicalProperty = structuredClone(residualC);
badCanonicalProperty.text.format.schema.properties.year.description += " drift";
assert.throws(() => assertThreeArmRequestIsolation({ controlA, controlB, residualC: badCanonicalProperty }),
  /canonical_schema_path_changed/);
const badRequired = structuredClone(residualC);
badRequired.text.format.schema.required.push("year");
assert.throws(() => assertThreeArmRequestIsolation({ controlA, controlB, residualC: badRequired }),
  /canonical_schema_path_changed/);
const badOutputCap = structuredClone(residualC);
badOutputCap.max_output_tokens += 1;
assert.throws(() => assertThreeArmRequestIsolation({ controlA, controlB, residualC: badOutputCap }),
  /changed_outside_response_schema/);
const badDetail = structuredClone(residualC);
badDetail.input[0].content.find((part) => part.type === "input_image").detail = "original";
assert.throws(() => assertThreeArmRequestIsolation({ controlA, controlB, residualC: badDetail }),
  /image_detail_not_high|changed_outside_response_schema/);
const badModel = structuredClone(residualC);
badModel.model = "different-model";
assert.throws(() => assertThreeArmRequestIsolation({ controlA, controlB, residualC: badModel }),
  /changed_outside_response_schema/);
const badOrder = structuredClone(prereg.cohort);
badOrder[0].order = ["control_a", "control_b", "control_a"];
assert.throws(() => assertScreenSchedule(badOrder),
  /schedule_unknown_order|schedule_arm_duplicate|schedule_job_count_mismatch/);

console.log("model-residual-candidate-v3 35x3 prereg tests passed");
