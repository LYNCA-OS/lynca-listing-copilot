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
  maxCrops: 3
});

assert.equal(plans.length, 2);
assert.deepEqual(plans.map((plan) => plan.source_region), ["serial_number", "checklist_code"]);
assert.deepEqual(plans.map((plan) => plan.role), ["serial_crop", "card_code_crop"]);
assert.equal(plans[0].source_image_id, "image-front");
assert.equal(plans[0].reason, "critical_region_occluded");
assert.equal(plans[1].reason, "critical_region_review");
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
  profile: defaultCaptureProfile
});
assert.deepEqual(parallelPlans.map((plan) => plan.source_region), ["serial_number", "parallel"]);
assert.equal(parallelPlans[1].role, "parallel_crop");

console.log("image crop planner tests passed");
