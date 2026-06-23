import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatAgnesReviewedCommercialAccuracySummary,
  measureAgnesReviewedCommercialAccuracy
} from "./measure-agnes-reviewed-commercial-accuracy.mjs";

const agnesReport = {
  schema_version: "agnes-supabase-feedback-eval-v1",
  provider: "agnes",
  target_count: 3,
  evaluated_count: 2,
  results: [
    {
      candidate_id: "fb1",
      source_feedback_id: "fb1",
      status: "evaluated",
      prediction: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 029/199 PSA 10",
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Shohei Ohtani"],
          parallel: "Gold Refractor",
          serial_number: "029/199",
          grade_company: "PSA",
          card_grade: "10"
        }
      }
    },
    {
      candidate_id: "fb2",
      source_feedback_id: "fb2",
      status: "evaluated",
      prediction: {
        title: "2024 Bowman Chrome Caitlin Clark Red 31/50 PSA 9",
        fields: {
          year: "2024",
          product: "Bowman Chrome",
          players: ["Caitlin Clark"],
          parallel: "Red",
          serial_number: "31/50",
          grade_company: "PSA",
          card_grade: "9"
        }
      }
    },
    {
      candidate_id: "fb3",
      source_feedback_id: "fb3",
      status: "provider_error",
      error: "timeout"
    }
  ]
};

const reviewedManifest = {
  schema_version: "reviewed-recognition-export-v1",
  manifest_hash: "reviewed-hash",
  summary: {
    item_count: 3,
    corrected_title_used_as_ground_truth: false
  },
  items: [
    {
      asset_id: "asset1",
      source_feedback_id: "fb1",
      ground_truth: {
        year: "2025",
        product: "Topps Chrome",
        players: ["Shohei Ohtani"],
        parallel: "Gold Refractor",
        serial_number: "29/199",
        grade_company: "PSA",
        card_grade: "10"
      },
      critical_fields: ["year", "product", "players", "parallel", "serial_number", "grade_company", "card_grade"]
    },
    {
      asset_id: "asset2",
      source_feedback_id: "fb2",
      ground_truth: {
        year: "2024",
        product: "Bowman Chrome",
        players: ["Caitlin Clark"],
        parallel: "Blue",
        serial_number: "51/50",
        grade_company: "PSA",
        card_grade: "10"
      },
      critical_fields: ["year", "product", "players", "parallel", "serial_number", "grade_company", "card_grade"]
    },
    {
      asset_id: "asset3",
      source_feedback_id: "fb3",
      ground_truth: {
        year: "2023",
        product: "Topps Chrome",
        players: ["Mike Trout"]
      },
      critical_fields: ["year", "product", "players"]
    }
  ]
};

const blockedMissing = measureAgnesReviewedCommercialAccuracy({
  agnesReport,
  reviewedManifest: null,
  minimumReviewedItems: 1,
  now: () => new Date("2026-06-23T12:00:00.000Z")
});
assert.equal(blockedMissing.status, "blocked");
assert.equal(blockedMissing.blocked_reason, "reviewed_field_ground_truth_missing");
assert.equal(blockedMissing.scope.commercial_accuracy_claim_allowed, false);

const blockedSmall = measureAgnesReviewedCommercialAccuracy({
  agnesReport,
  reviewedManifest,
  minimumReviewedItems: 4,
  now: () => new Date("2026-06-23T12:01:00.000Z")
});
assert.equal(blockedSmall.status, "blocked");
assert.equal(blockedSmall.blocked_reason, "insufficient_reviewed_items");

const report = measureAgnesReviewedCommercialAccuracy({
  agnesReport,
  reviewedManifest,
  minimumReviewedItems: 3,
  now: () => new Date("2026-06-23T12:02:00.000Z")
});
assert.equal(report.schema_version, "agnes-reviewed-commercial-accuracy-v1");
assert.equal(report.status, "completed");
assert.equal(report.scope.field_ground_truth_available, true);
assert.equal(report.scope.commercial_accuracy_claim_allowed, true);
assert.equal(report.scope.corrected_title_used_as_ground_truth, false);
assert.equal(report.scope.raw_titles_in_report, false);
assert.equal(report.metrics.reviewed_items, 3);
assert.equal(report.metrics.matched_predictions, 3);
assert.equal(report.metrics.provider_failure_count, 1);
assert.equal(report.metrics.missing_prediction_count, 0);
assert.equal(report.metrics.total_field_checks, 17);
assert.equal(report.metrics.correct_field_checks, 11);
assert.equal(report.metrics.field_level_accuracy, 0.647059);
assert.equal(report.metrics.card_level_critical_exact_count, 1);
assert.equal(report.metrics.card_level_critical_exact_accuracy, 0.333333);
assert.equal(report.metrics.title_accepted_count, 1);
assert.equal(report.metrics.title_acceptance_rate, 0.333333);
assert.equal(report.field_breakdown.serial_number.correct, 1);
assert.equal(report.field_breakdown.serial_number.total, 2);
assert.equal(report.field_breakdown.card_grade.correct, 1);
assert.equal(report.field_breakdown.card_grade.total, 2);

const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /Shohei Ohtani/);
assert.doesNotMatch(serialized, /Caitlin Clark/);
assert.doesNotMatch(serialized, /Mike Trout/);
assert.doesNotMatch(serialized, /"ground_truth"\s*:/);
assert.doesNotMatch(serialized, /"prediction"\s*:/);

const summary = formatAgnesReviewedCommercialAccuracySummary(report);
assert.match(summary, /card_level_critical_exact: 1\/3 \(0.333333\)/);
assert.match(summary, /field_level_accuracy: 11\/17 \(0.647059\)/);
assert.match(summary, /commercial_accuracy_claim_allowed: true/);
assert.doesNotMatch(summary, /Shohei Ohtani/);

const tmp = await mkdtemp(join(tmpdir(), "agnes-reviewed-commercial-accuracy-"));
const agnesPath = join(tmp, "agnes.json");
const reviewedPath = join(tmp, "reviewed.json");
const outPath = join(tmp, "report.json");
await writeFile(agnesPath, `${JSON.stringify(agnesReport, null, 2)}\n`);
await writeFile(reviewedPath, `${JSON.stringify(reviewedManifest, null, 2)}\n`);
const cli = spawnSync(process.execPath, [
  "scripts/measure-agnes-reviewed-commercial-accuracy.mjs",
  "--agnes",
  agnesPath,
  "--reviewed",
  reviewedPath,
  "--out",
  outPath,
  "--minimum-reviewed-items",
  "3"
], {
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /Agnes reviewed commercial accuracy completed/);
assert.match(cli.stdout, /field_level_accuracy: 11\/17 \(0.647059\)/);
assert.doesNotMatch(cli.stdout, /Caitlin Clark/);
const written = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(written.metrics.card_level_critical_exact_count, 1);
assert.doesNotMatch(JSON.stringify(written), /Mike Trout/);

const blockedCli = spawnSync(process.execPath, [
  "scripts/measure-agnes-reviewed-commercial-accuracy.mjs",
  "--agnes",
  agnesPath,
  "--reviewed",
  join(tmp, "missing-reviewed.json"),
  "--out",
  join(tmp, "blocked.json"),
  "--require-complete"
], {
  encoding: "utf8"
});
assert.equal(blockedCli.status, 1);
assert.match(blockedCli.stdout, /blocked_reason: reviewed_field_ground_truth_missing/);

console.log("Agnes reviewed commercial accuracy tests passed");
