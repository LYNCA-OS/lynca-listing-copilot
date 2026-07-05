import assert from "node:assert/strict";
import { planTargetedCrops } from "../lib/listing/image-quality/crop-planner.mjs";
import { criticalRegionStatus, defaultCaptureProfile } from "../lib/listing/image-quality/quality-gate.mjs";

const imageQuality = {
  critical_region_occlusion: {
    serial_number: {
      status: criticalRegionStatus.OCCLUDED,
      glare_score: 0.6,
      readability_score: 0.05
    },
    checklist_code: {
      status: criticalRegionStatus.REVIEW,
      glare_score: 0.2,
      readability_score: 0.21
    },
    subject_name: {
      status: criticalRegionStatus.OCCLUDED,
      glare_score: 0.7,
      readability_score: 0.04
    },
    year_product: {
      status: criticalRegionStatus.CLEAR,
      glare_score: 0.02,
      readability_score: 0.6
    }
  }
};

const plans = planTargetedCrops({
  imageId: "image-front",
  imageQuality,
  highRiskFields: [],
  maxCrops: 3
});

assert.equal(plans.length, 3);
assert.deepEqual(plans.map((plan) => plan.source_region), ["serial_number", "subject_name", "checklist_code"]);
assert.deepEqual(plans.map((plan) => plan.role), ["serial_crop", "subject_crop", "card_code_crop"]);
assert.equal(plans[0].source_image_id, "image-front");
assert.equal(plans[0].reason, "critical_region_occluded");
assert.equal(plans[2].reason, "critical_region_review");
assert.ok(plans.every((plan) => plan.crop_region.x >= 0 && plan.crop_region.y >= 0));
assert.ok(plans.every((plan) => plan.crop_region.x + plan.crop_region.width <= 1));
assert.ok(plans.every((plan) => plan.crop_region.y + plan.crop_region.height <= 1));

const gradePlans = planTargetedCrops({
  imageQuality: {
    critical_region_occlusion: {
      grade_label: {
        status: criticalRegionStatus.OCCLUDED,
        glare_score: 0.7,
        readability_score: 0.04
      }
    }
  },
  highRiskFields: [],
  profile: defaultCaptureProfile
});
assert.equal(gradePlans[0].role, "grade_label_crop");

const parallelPlans = planTargetedCrops({
  imageId: "image-front",
  imageQuality: {
    critical_region_occlusion: {
      parallel: {
        status: criticalRegionStatus.REVIEW,
        glare_score: 0.18,
        readability_score: 0.2
      },
      serial_number: {
        status: criticalRegionStatus.OCCLUDED,
        glare_score: 0.62,
        readability_score: 0.05
      }
    }
  },
  highRiskFields: [],
  profile: defaultCaptureProfile
});
assert.deepEqual(parallelPlans.map((plan) => plan.source_region), ["serial_number", "parallel"]);
assert.equal(parallelPlans[1].role, "parallel_crop");

const riskPlans = planTargetedCrops({
  assetId: "asset-1",
  imageId: "image-front",
  sourceObjectPath: "listing-assets/source.jpg",
  sourceSide: "front",
  sourceWidth: 1400,
  sourceHeight: 2000,
  imageQuality: {
    critical_region_occlusion: {}
  },
  maxCrops: 6
});
assert.deepEqual(riskPlans.map((plan) => plan.source_region), [
  "serial_number",
  "year_product",
  "grade_label",
  "subject_name",
  "collector_number",
  "checklist_code"
]);
assert.equal(riskPlans[0].reason, "high_risk_field");
assert.equal(riskPlans[0].crop_metadata.crop_id, "asset-1__image-front__serial_number__field-crop-v1");
assert.equal(riskPlans[0].crop_metadata.asset_id, "asset-1");
assert.equal(riskPlans[0].crop_metadata.source_object_path, "listing-assets/source.jpg");
assert.equal(riskPlans[0].crop_metadata.source_side, "front");
assert.equal(riskPlans[0].crop_metadata.crop_role, "serial_crop");
assert.deepEqual(Object.keys(riskPlans[0].crop_metadata.pixel_bounds), ["left", "top", "width", "height"]);

const requestedPlans = planTargetedCrops({
  imageId: "image-front",
  imageQuality: {
    critical_region_occlusion: {}
  },
  highRiskFields: [],
  requestedFields: ["autograph"],
  maxCrops: 2
});
assert.equal(requestedPlans.length, 1);
assert.equal(requestedPlans[0].source_region, "autograph");
assert.equal(requestedPlans[0].reason, "field_requested");

console.log("image crop planner tests passed");
