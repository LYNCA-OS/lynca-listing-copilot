import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportSmokeSelfImprovingLoop } from "./export-smoke-self-improving-loop.mjs";

const report = {
  results: [
    {
      candidate_id: "query-1",
      source_feedback_id: "fb-1",
      provider: "openai_legacy",
      corrected_title_reference: "2025 Topps Chrome Test Player Gold /50 PSA 10",
      final_evaluated_title: "2025 Topps Chrome Test Player Gold /50 PSA 10",
      raw_provider_fields: {
        year: "2025",
        product: "Topps Chrome"
      },
      normalized_evidence: {
        year: { status: "CONFIRMED" }
      },
      resolved_fields: {
        year: "2025",
        product: "Topps Chrome",
        players: ["Test Player"],
        surface_color: "Gold",
        serial_number: "12/50",
        grade_company: "PSA",
        card_grade: "10"
      },
      retrieval_title_assist_used: true,
      vector_lazy_skip: false,
      catalog_cache_hit: true,
      candidate_proxy_decision: {
        selected_candidate_id: "self-1",
        delta: 0.2
      },
      catalog_candidates: [
        {
          id: "self-1",
          source_feedback_id: "fb-1",
          rank: 1,
          title: "2025 Topps Chrome Test Player Gold /50 PSA 10",
          provider: "catalog",
          source_trust: "VERIFIED_CANONICAL_TITLE",
          normalized_score: 0.99,
          supporting_fields: ["year", "product", "subject", "serial_denominator"]
        },
        {
          id: "near-1",
          rank: 2,
          title: "2025 Topps Chrome Test Player Purple /99 PSA 10",
          provider: "catalog",
          source_trust: "VERIFIED_CANONICAL_TITLE",
          normalized_score: 0.7,
          conflicting_fields: ["serial_denominator", "surface_color"]
        }
      ],
      vector_candidates: [
        {
          id: "vec-bad-1",
          rank: 1,
          title: "2024 Topps Chrome Other Player Gold /50 PSA 10",
          provider: "visual_vector",
          normalized_score: 0.88,
          front_similarity: 0.91,
          back_similarity: 0.8,
          conflicting_fields: ["year", "subject"]
        }
      ]
    },
    {
      candidate_id: "query-2",
      source_feedback_id: "fb-2",
      provider: "openai_legacy",
      corrected_title_reference: "2025 Panini Prizm Another Player Silver /99",
      final_evaluated_title: "2025 Panini Prizm Another Player Blue /199",
      raw_provider_fields: {
        year: "2025",
        product: "Panini Prizm"
      },
      catalog_candidates: [
        {
          id: "wrong-top1",
          rank: 1,
          title: "2025 Panini Prizm Another Player Blue /199",
          provider: "catalog",
          normalized_score: 0.82,
          conflicting_fields: ["serial_denominator", "surface_color"]
        },
        {
          id: "correct-2",
          rank: 2,
          title: "2025 Panini Prizm Another Player Silver /99",
          provider: "catalog",
          normalized_score: 0.8,
          supporting_fields: ["year", "product", "subject", "serial_denominator"]
        }
      ],
      candidate_proxy_decision: {
        selected_candidate_id: "wrong-top1",
        delta: -0.2
      }
    }
  ]
};

const tmp = await mkdtemp(join(tmpdir(), "smoke-self-improving-loop-"));

try {
  const inputPath = join(tmp, "report.json");
  await writeFile(inputPath, `${JSON.stringify(report, null, 2)}\n`);

  const recapture = await exportSmokeSelfImprovingLoop({
    inputPaths: [inputPath],
    mode: "recapture_smoke",
    dashboardPath: join(tmp, "recapture-dashboard.json"),
    tracePath: join(tmp, "recapture-trace.jsonl"),
    fieldDiffPath: join(tmp, "recapture-field-diff.jsonl"),
    hardNegativesPath: join(tmp, "recapture-hard-negatives.jsonl"),
    opportunityPath: join(tmp, "recapture-opportunity.md")
  });

  assert.equal(recapture.dashboard.smoke_mode, "recapture_smoke");
  assert.equal(recapture.dashboard.accuracy_policy.recapture_score_is_oracle_upper_bound, true);
  assert.equal(recapture.dashboard.query_count, 2);
  assert.equal(recapture.dashboard.recapture_accuracy.pass_at_0_80_count, 1);
  assert.ok(recapture.traces[0].parsed_corrected_title_fields.fields.year);
  assert.equal(recapture.traces[0].parsed_corrected_title_fields.fields.year.source_status, "AUTO_PARSED_FROM_VERIFIED_TITLE");
  assert.equal(recapture.traces[0].parsed_corrected_title_fields.reviewed_internal_promoted, false);
  assert.ok(recapture.hard_negatives.some((record) => record.error_type === "VISUAL_HIGH_SIMILARITY_DIRECT_CONFLICT"));
  assert.ok(recapture.hard_negatives.some((record) => record.error_type === "TOP1_WRONG_BUT_TOPK_CONTAINS_CORRECT"));
  assert.match(recapture.opportunity_report, /Smoke Self-Improving Loop v0 Opportunity Report/);

  const holdout = await exportSmokeSelfImprovingLoop({
    inputPaths: [inputPath],
    mode: "holdout_smoke",
    dashboardPath: join(tmp, "holdout-dashboard.json"),
    tracePath: join(tmp, "holdout-trace.jsonl"),
    fieldDiffPath: join(tmp, "holdout-field-diff.jsonl"),
    hardNegativesPath: join(tmp, "holdout-hard-negatives.jsonl"),
    opportunityPath: join(tmp, "holdout-opportunity.md")
  });

  assert.equal(holdout.dashboard.accuracy_policy.holdout_excludes_self_corrected_title, true);
  assert.equal(holdout.traces[0].leakage_guard.excluded_self_candidate_count, 1);
  assert.equal(holdout.traces[0].selected_candidate, null);
  assert.ok(holdout.traces[0].error_taxonomy.all.includes("SELF_CANDIDATE_EXCLUDED_FOR_LEAKAGE_GUARD"));

  const coldStart = await exportSmokeSelfImprovingLoop({
    inputPaths: [inputPath],
    mode: "cold_start_smoke",
    dashboardPath: join(tmp, "cold-dashboard.json"),
    tracePath: join(tmp, "cold-trace.jsonl"),
    fieldDiffPath: join(tmp, "cold-field-diff.jsonl"),
    hardNegativesPath: join(tmp, "cold-hard-negatives.jsonl"),
    opportunityPath: join(tmp, "cold-opportunity.md")
  });

  assert.equal(coldStart.dashboard.accuracy_policy.cold_start_excludes_correct_identity, true);
  assert.equal(coldStart.dashboard.cold_start_usable_draft_rate.usable_draft_count, 2);
  assert.equal(coldStart.traces[1].selected_candidate?.label_is_correct, false);

  assert.ok(existsSync(join(tmp, "recapture-dashboard.json")));
  assert.ok(existsSync(join(tmp, "holdout-trace.jsonl")));
  const opportunity = await readFile(join(tmp, "cold-opportunity.md"), "utf8");
  assert.match(opportunity, /Recapture smoke is an oracle upper bound/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log("smoke-self-improving-loop tests passed");
