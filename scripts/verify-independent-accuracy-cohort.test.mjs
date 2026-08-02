import assert from "node:assert/strict";
import test from "node:test";
import { validateIndependentAccuracyCohort } from "./verify-independent-accuracy-cohort.mjs";

function item(id, overrides = {}) {
  return {
    asset_id: id,
    canonical_title: "",
    source_titles: {},
    sealed_eval_label_ref: { path: "labels.jsonl", key: id },
    source_record: {
      reviewed_title_visible_to_model: false,
      title_derived_fields_visible_to_model: false
    },
    images: [{ bucket: "listing-feedback-images", object_path: `feedback/${id}/front.jpg` }],
    ...overrides
  };
}

test("accepts a blind materializable independent cohort", async () => {
  const dataset = { items: Array.from({ length: 3 }, (_, index) => item(`new-${index + 1}`)) };
  const result = await validateIndependentAccuracyCohort({ dataset, targetCount: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(result.development_overlap_count, 0);
});

test("rejects overlap with development", async () => {
  await assert.rejects(
    validateIndependentAccuracyCohort({ dataset: { items: [item("dev-1")] }, developmentAssetIds: ["dev-1"], targetCount: 1 }),
    (error) => error.code === "cohort_overlaps_development"
  );
});

test("rejects fixture-only images", async () => {
  await assert.rejects(
    validateIndependentAccuracyCohort({
      dataset: { items: [item("new-1", { images: [{ local_path: "/benchmark-fixture-not-required/new-1.jpg" }] })] },
      targetCount: 1
    }),
    (error) => error.code === "cohort_contract_invalid"
  );
});

test("rejects visible labels", async () => {
  await assert.rejects(
    validateIndependentAccuracyCohort({ dataset: { items: [item("new-1", { canonical_title: "visible" })] }, targetCount: 1 }),
    (error) => error.code === "cohort_contract_invalid"
  );
});

test("selects a disjoint holdout from a larger mixed dataset", async () => {
  const dataset = { items: [item("dev-1"), item("new-1"), item("new-2")] };
  const sealedLabels = ["new-1", "new-2"].map((id) => ({
    key: id,
    reviewed_title: "sealed",
    policy: {
      reviewed_title_is_ground_truth: true,
      model_prompt_visible: false,
      load_after_predictions_frozen: true
    }
  }));
  const result = await validateIndependentAccuracyCohort({
    dataset,
    developmentAssetIds: ["dev-1"],
    selectedAssetIds: ["new-2", "new-1"],
    sealedLabels,
    targetCount: 2
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
});

test("rejects a selected row without a sealed label key", async () => {
  await assert.rejects(
    validateIndependentAccuracyCohort({
      dataset: { items: [item("new-1")] },
      selectedAssetIds: ["new-1"],
      sealedLabels: [],
      targetCount: 1
    }),
    (error) => error.code === "cohort_contract_invalid"
  );
});

console.log("Independent accuracy cohort gate tests passed.");
