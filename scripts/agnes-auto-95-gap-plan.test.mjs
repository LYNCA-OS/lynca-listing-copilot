import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAgnesAuto95GapPlan,
  formatAgnesAuto95GapPlanSummary
} from "./build-agnes-auto-95-gap-plan.mjs";

const agnesReport = {
  schema_version: "agnes-supabase-feedback-eval-v1",
  provider: "agnes",
  target_count: 4,
  attempted_count: 4,
  evaluated_count: 3,
  provider_error_count: 1,
  results: [
    {
      candidate_id: "ok",
      source_feedback_id: "ok",
      asset_id: "asset-ok",
      status: "evaluated",
      corrected_title_reference: "2025 Topps Chrome Shohei Ohtani Gold Refractor 29/199 PSA 10 Auto RC",
      prediction: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 029/199 PSA 10 Auto RC",
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Shohei Ohtani"],
          parallel: "Gold Refractor",
          serial_number: "029/199",
          grade_company: "PSA",
          card_grade: "10",
          auto: true,
          rc: true
        }
      },
      corrected_title_comparison: {
        token_recall: 0.95,
        token_precision: 0.95,
        wrong_year: false,
        wrong_serial: false,
        wrong_grade: false,
        unexpected_color: false
      }
    },
    {
      candidate_id: "principle-fail",
      source_feedback_id: "principle-fail",
      asset_id: "asset-principle",
      status: "evaluated",
      corrected_title_reference: "2024 Bowman Chrome Caitlin Clark Blue 51/50 PSA 10",
      prediction: {
        title: "2023 Bowman Chrome Red 31/50 PSA 9",
        fields: {
          year: "2023",
          product: "Panini Prizm",
          players: ["LeBron James"],
          parallel: "Red",
          serial_number: "31/50",
          grade_company: "PSA",
          card_grade: "9"
        }
      },
      corrected_title_comparison: {
        token_recall: 0.75,
        token_precision: 0.75,
        wrong_year: true,
        wrong_serial: true,
        wrong_grade: true,
        unexpected_color: true
      }
    },
    {
      candidate_id: "content-ok-token-low",
      source_feedback_id: "content-ok-token-low",
      asset_id: "asset-soft",
      status: "evaluated",
      corrected_title_reference: "2025 Topps Chrome Mike Trout Red 5/5",
      prediction: {
        title: "2025 Red 5/5",
        fields: {
          year: "2025",
          parallel: "Red",
          serial_number: "5/5"
        }
      },
      corrected_title_comparison: {
        token_recall: 0.5,
        token_precision: 0.9,
        wrong_year: false,
        wrong_serial: false,
        wrong_grade: false,
        unexpected_color: false
      }
    },
    {
      candidate_id: "provider-error",
      source_feedback_id: "provider-error",
      asset_id: "asset-provider",
      status: "provider_error",
      corrected_title_reference: "2024 Topps Chrome Mike Trout Silver Refractor",
      error: "timeout"
    }
  ]
};

const reviewPacket = {
  schema_version: "commercial-review-packet-v1",
  tasks: [
    {
      asset_id: "asset-ok",
      source_feedback_id: "ok",
      suggested_fields: {
        year: "2025"
      }
    },
    {
      asset_id: "asset-principle",
      source_feedback_id: "principle-fail",
      suggested_fields: {
        year: "2024"
      }
    }
  ]
};

const report = buildAgnesAuto95GapPlan({
  agnesReport,
  reviewPacket,
  targetAccuracy: 0.75,
  maxManualRate: 0.25,
  now: () => new Date("2026-06-23T12:00:00.000Z")
});

assert.equal(report.schema_version, "agnes-auto-95-gap-plan-v1");
assert.equal(report.generated_at, "2026-06-23T12:00:00.000Z");
assert.equal(report.status, "completed");
assert.equal(report.scope.exact_title_match_required, false);
assert.equal(report.scope.word_order_required, false);
assert.equal(report.scope.token_similarity_is_diagnostic_only, true);
assert.equal(report.scope.final_title_content_required, true);
assert.equal(report.scope.deterministic_renderer_applied, true);
assert.equal(report.scope.commercial_accuracy_claim_allowed, false);
assert.equal(report.scope.raw_titles_in_report, false);
assert.equal(report.source.title_mode, "rendered");
assert.equal(report.source.max_title_length, 80);
assert.equal(report.target.required_auto_correct_count, 3);
assert.equal(report.target.max_manual_count, 1);
assert.equal(report.current.accepted_count, 2);
assert.equal(report.current.rejected_or_abstain_count, 2);
assert.equal(report.current.accepted_rate, 0.5);
assert.equal(report.current.additional_auto_correct_needed_for_target, 1);
assert.equal(report.current.current_manual_over_budget_count, 1);
assert.equal(report.failure_summary.primary_failure_reasons.principle_error, 1);
assert.equal(report.failure_summary.primary_failure_reasons.provider_error, 1);
assert.equal(report.failure_summary.principle_failures.wrong_player, 1);
assert.equal(report.failure_summary.principle_failures.wrong_product, 1);
assert.equal(report.failure_summary.token_diagnostics.low_token_recall, 2);
assert.equal(report.field_layer_summary.layers.T1_VALUE_CRITICAL, 1);
assert.equal(report.field_layer_summary.layers.T0_IDENTITY_CORE, 1);
assert.equal(report.field_layer_summary.fields.year, 1);
assert.equal(report.field_layer_summary.fields.players, 1);
assert.equal(report.field_layer_summary.fields.product, 1);
assert.equal(report.auto_recovery_strategy.manual_budget_candidate_count, 1);
assert.equal(report.auto_recovery_strategy.must_auto_recover_count, 1);
assert.ok(report.auto_recovery_strategy.scenarios.some((scenario) => scenario.meets_target_accuracy));

const manualCandidates = report.items.filter((item) => item.manual_budget_candidate);
const mustRecover = report.items.filter((item) => item.must_auto_recover_for_95);
assert.equal(manualCandidates.length, 1);
assert.equal(mustRecover.length, 1);
assert.equal(report.items.find((item) => item.source_feedback_id === "content-ok-token-low").accepted_by_principle_safe_proxy, true);
assert.equal(report.items.find((item) => item.source_feedback_id === "principle-fail").priority_band, "P0_MUST_AUTO_FIX");
assert.ok(report.items.find((item) => item.source_feedback_id === "principle-fail").auto_fix_tracks.includes("identity_resolution_hard_constraints"));

const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /Shohei Ohtani/);
assert.doesNotMatch(serialized, /Caitlin Clark/);
assert.doesNotMatch(serialized, /Mike Trout/);
assert.doesNotMatch(serialized, /"corrected_title_reference"\s*:/);
assert.doesNotMatch(serialized, /"prediction"\s*:/);

const summary = formatAgnesAuto95GapPlanSummary(report);
assert.match(summary, /current_principle_safe_accepted: 2\/4 \(0.5\)/);
assert.match(summary, /title_mode: rendered/);
assert.match(summary, /required_auto_correct: 3\/4 \(0.75\)/);
assert.match(summary, /max_manual_count: 1\/4 \(0.25\)/);
assert.doesNotMatch(summary, /Shohei Ohtani/);

const tmp = await mkdtemp(join(tmpdir(), "agnes-auto-95-gap-plan-"));
const agnesPath = join(tmp, "agnes.json");
const packetPath = join(tmp, "packet.json");
const outPath = join(tmp, "gap.json");
const csvPath = join(tmp, "gap.csv");
await writeFile(agnesPath, `${JSON.stringify(agnesReport, null, 2)}\n`);
await writeFile(packetPath, `${JSON.stringify(reviewPacket, null, 2)}\n`);
const cli = spawnSync(process.execPath, [
  "scripts/build-agnes-auto-95-gap-plan.mjs",
  "--agnes",
  agnesPath,
  "--packet",
  packetPath,
  "--out",
  outPath,
  "--csv-out",
  csvPath,
  "--target-accuracy",
  "0.75",
  "--max-manual-rate",
  "0.25"
], {
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /Agnes auto 95 gap plan/);
assert.match(cli.stdout, /additional_auto_correct_needed_for_target: 1/);
assert.doesNotMatch(cli.stdout, /Caitlin Clark/);

const written = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(written.current.accepted_count, 2);
assert.equal(written.auto_recovery_strategy.must_auto_recover_count, 1);
assert.doesNotMatch(JSON.stringify(written), /Mike Trout/);
const csv = await readFile(csvPath, "utf8");
assert.match(csv, /must_auto_recover_for_95/);
assert.doesNotMatch(csv, /Shohei Ohtani/);

console.log("Agnes auto 95 gap plan tests passed");
