import assert from "node:assert/strict";
import {
  assignRecognitionSplits,
  createRecognitionCandidatesFromFeedbackRows,
  detectRecognitionLeakage,
  recognitionDatasetStats,
  stableManifestHash,
  validateRecognitionDataset
} from "../lib/listing/recognition/recognition-dataset.mjs";
import { evaluateRecognitionDataset } from "../lib/listing/recognition/recognition-evaluation.mjs";

function item(overrides = {}) {
  return {
    asset_id: Object.hasOwn(overrides, "asset_id") ? overrides.asset_id : "asset_1",
    physical_card_id: Object.hasOwn(overrides, "physical_card_id") ? overrides.physical_card_id : "card_1",
    capture_session_id: Object.hasOwn(overrides, "capture_session_id") ? overrides.capture_session_id : "session_1",
    source_feedback_id: Object.hasOwn(overrides, "source_feedback_id") ? overrides.source_feedback_id : "feedback_1",
    split: Object.hasOwn(overrides, "split") ? overrides.split : "development",
    images: overrides.images || [
      {
        object_path: "cards/card-1/front.jpg",
        role: "front_original",
        capture_angle: "primary",
        has_glare: false
      }
    ],
    category: "sports_card",
    ground_truth: {
      year: "2025-26",
      manufacturer: "Topps",
      product: "Topps Chrome",
      set: "Topps Chrome Basketball",
      players: ["Cooper Flagg"],
      card_type: "Chrome Rookie Auto",
      insert: null,
      parallel: "Gold Refractor",
      variation: null,
      serial_number: "31/50",
      collector_number: "136",
      checklist_code: "TCAR-CF",
      attributes: ["RC"],
      rc: true,
      first_bowman: false,
      auto: true,
      patch: false,
      relic: false,
      ssp: false,
      case_hit: false,
      one_of_one: false,
      grade_company: "PSA",
      card_grade: "9",
      auto_grade: "10",
      grade_type: "CARD_AND_AUTO"
    },
    critical_fields: ["year", "product", "players", "serial_number", "checklist_code", "card_grade", "auto_grade"],
    difficulty_tags: ["front_back", "serial", "slab", "complex_parallel"],
    ground_truth_sources: [
      { field: "serial_number", source_type: "CARD_FRONT", source_ref: "front serial", confidence: 0.98 }
    ],
    reviewed_by: ["operator_a", "operator_b"],
    review_status: "DOUBLE_REVIEWED",
    prediction: overrides.prediction || {
      route: "AI_COMPLETE",
      resolved_fields: {
        year: "2025-26",
        product: "Topps Chrome",
        players: ["Cooper Flagg"],
        serial_number: "31/50",
        checklist_code: "TCAR-CF",
        card_grade: "9",
        auto_grade: "10"
      },
      latency_ms: 1200,
      provider_calls: 1,
      retrieval_calls: 1,
      cost_usd: 0.01,
      candidate_top1_correct: true,
      candidate_top5_contains_truth: true
    }
  };
}

const valid = item();
assert.deepEqual(validateRecognitionDataset([valid]), []);
assert.equal(stableManifestHash([valid]).length, 64);

const invalid = item({ asset_id: "" });
assert.ok(validateRecognitionDataset([invalid]).some((error) => error.path.endsWith(".asset_id")));

const split = assignRecognitionSplits([
  item({ asset_id: "a1", physical_card_id: "pc1", capture_session_id: "s1" }),
  item({ asset_id: "a2", physical_card_id: "pc1", capture_session_id: "s1" }),
  item({ asset_id: "a3", physical_card_id: "pc2", capture_session_id: "s2" })
]);
assert.equal(split[0].split, split[1].split);

const leaks = detectRecognitionLeakage([
  item({ asset_id: "a1", physical_card_id: "same", capture_session_id: "s1", split: "development" }),
  item({ asset_id: "a2", physical_card_id: "same", capture_session_id: "s2", split: "held_out" })
]);
assert.equal(leaks[0].group_type, "physical_card_id");

const stats = recognitionDatasetStats([valid]);
assert.equal(stats.total_items, 1);
assert.equal(stats.ground_truth_field_counts.serial_number, 1);

const evalResult = evaluateRecognitionDataset([valid]);
assert.equal(evalResult.overall.card_level_exact_accuracy, 1);
assert.equal(evalResult.overall.serial_exact_accuracy, 1);
assert.equal(evalResult.overall.candidate_top1_accuracy, 1);
assert.equal(evalResult.breakdowns.by_difficulty_tag.serial.total_assets, 1);

const candidates = createRecognitionCandidatesFromFeedbackRows([
  {
    id: "fb1",
    generated_title: "bad",
    corrected_title: "better",
    front_object_path: "cards/fb1/front.jpg"
  }
]);
assert.equal(candidates[0].review_status, "NEEDS_REVIEW");
assert.deepEqual(candidates[0].critical_fields, []);
assert.match(candidates[0].notes, /writer-reviewed title ground truth/);

console.log("recognition dataset tests passed");
