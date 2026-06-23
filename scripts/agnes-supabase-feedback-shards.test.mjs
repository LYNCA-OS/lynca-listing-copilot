import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shardAgnesSupabaseFeedbackDataset } from "./shard-agnes-supabase-feedback-dataset.mjs";
import { mergeAgnesSupabaseFeedbackReports } from "./merge-agnes-supabase-feedback-reports.mjs";
import { measureAgnesRenderedCommercialAcceptance } from "./measure-agnes-rendered-commercial-acceptance.mjs";

function item(index) {
  return {
    asset_id: `asset-${index}`,
    physical_card_id: `card-${index}`,
    capture_session_id: `session-${index}`,
    source_feedback_id: `fb-${index}`,
    images: [
      {
        image_id: `front-${index}`,
        role: "front_original",
        bucket: "listing-feedback-images",
        object_path: `feedback/${index}/front.jpg`
      },
      {
        image_id: `back-${index}`,
        role: "back_original",
        bucket: "listing-feedback-images",
        object_path: `feedback/${index}/back.jpg`
      }
    ],
    category: "sports_card",
    ground_truth: {
      year: null,
      manufacturer: null,
      product: null,
      set: null,
      players: [],
      card_type: null,
      insert: null,
      parallel: null,
      variation: null,
      serial_number: null,
      collector_number: null,
      checklist_code: null,
      attributes: [],
      rc: false,
      first_bowman: false,
      auto: false,
      patch: false,
      relic: false,
      ssp: false,
      case_hit: false,
      one_of_one: false,
      grade_company: null,
      card_grade: null,
      auto_grade: null,
      grade_type: "UNKNOWN"
    },
    critical_fields: [],
    difficulty_tags: ["front_back", "needs_owner_review"],
    ground_truth_sources: [],
    reviewed_by: ["needs_owner_review"],
    review_status: "NEEDS_REVIEW",
    source_titles: {
      corrected_title: `2025 Topps Chrome Test Player ${index} PSA 10`
    }
  };
}

function evaluatedResult(index) {
  return {
    candidate_id: `fb-${index}`,
    source_feedback_id: `fb-${index}`,
    status: "evaluated",
    corrected_title_reference: `2025 Topps Chrome Test Player ${index} PSA 10`,
    prediction: {
      title: `2025 Topps Chrome Test Player ${index} PSA 10`,
      fields: {
        year: "2025",
        product: "Topps Chrome",
        players: [`Test Player ${index}`],
        grade_company: "PSA",
        card_grade: "10"
      }
    },
    corrected_title_comparison: {
      corrected_title_exact: true,
      token_recall: 1,
      token_precision: 1,
      critical_title_error: false,
      wrong_year: false,
      wrong_serial: false,
      wrong_grade: false,
      unexpected_color: false
    },
    usage: {
      estimated_cost_usd: 0.01,
      image_count: 2
    }
  };
}

const dataset = {
  schema_version: "recognition-candidate-export-v1",
  source: {
    provider: "supabase",
    table: "listing_title_feedback",
    source_row_count: 5
  },
  manifest_hash: "manifest-test",
  summary: {
    item_count: 5
  },
  items: [1, 2, 3, 4, 5].map(item)
};

const tempDir = await mkdtemp(join(tmpdir(), "lynca-agnes-shards-"));
const shardResult = await shardAgnesSupabaseFeedbackDataset({
  dataset,
  outDir: tempDir,
  shardCount: 2,
  now: () => new Date("2026-06-24T00:00:00.000Z")
});
assert.equal(shardResult.plan.total_items, 5);
assert.equal(shardResult.plan.selected_items, 5);
assert.deepEqual(shardResult.plan.shards.map((shard) => shard.count), [3, 2]);
assert.equal(shardResult.shards[0].payload.items[0].source_feedback_id, "fb-1");
assert.equal(shardResult.shards[1].payload.items[0].source_feedback_id, "fb-2");

const writtenPlan = JSON.parse(await readFile(join(tempDir, "plan.json"), "utf8"));
assert.equal(writtenPlan.shard_count, 2);

const merged = await mergeAgnesSupabaseFeedbackReports({
  dataset,
  reports: [
    {
      schema_version: "agnes-supabase-feedback-eval-v1",
      status: "partial",
      target_count: 2,
      results: [
        {
          candidate_id: "fb-1",
          status: "provider_error",
          corrected_title_reference: "2025 Topps Chrome Test Player 1 PSA 10"
        },
        evaluatedResult(2)
      ]
    },
    {
      schema_version: "agnes-supabase-feedback-eval-v1",
      status: "partial",
      target_count: 1,
      results: [
        evaluatedResult(1)
      ]
    }
  ],
  now: () => new Date("2026-06-24T00:00:00.000Z")
});
assert.equal(merged.status, "partial");
assert.equal(merged.target_count, 5);
assert.equal(merged.attempted_count, 2);
assert.equal(merged.evaluated_count, 2);
assert.equal(merged.provider_error_count, 0);
assert.equal(merged.missing_result_count, 3);
assert.deepEqual(merged.results.map((result) => result.candidate_id), ["fb-1", "fb-2"]);

const rendered = measureAgnesRenderedCommercialAcceptance({
  report: merged,
  now: () => new Date("2026-06-24T00:00:00.000Z")
});
assert.equal(rendered.metrics.target_rows, 5);
assert.equal(rendered.metrics.rendered_title_accepted_count, 2);
assert.equal(rendered.metrics.rendered_title_accepted_rate, 0.4);
assert.equal(rendered.metrics.current_manual_over_budget_count, 3);

console.log("Agnes Supabase feedback shard tests passed");
