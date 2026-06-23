import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatAgnesCommercialAcceptanceProxySummary,
  measureAgnesCommercialAcceptanceProxy
} from "./measure-agnes-commercial-acceptance-proxy.mjs";

const agnesReport = {
  schema_version: "agnes-supabase-feedback-eval-v1",
  provider: "agnes",
  target_count: 4,
  attempted_count: 4,
  provider_error_count: 1,
  results: [
    {
      candidate_id: "ok",
      status: "evaluated",
      corrected_title_reference: "2025 Topps Chrome Shohei Ohtani Gold Refractor 29/199 PSA 10 Auto RC",
      prediction: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 029/199 PSA 10 Auto RC",
        fields: {
          year: "2025",
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
      status: "evaluated",
      corrected_title_reference: "2024 Bowman Chrome Caitlin Clark Blue 51/50 PSA 10",
      prediction: {
        title: "2023 Bowman Chrome Red 31/50 PSA 9",
        fields: {
          year: "2023",
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
      candidate_id: "soft-fail",
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
      status: "provider_error",
      corrected_title_reference: "2024 Topps Chrome Mike Trout Silver Refractor",
      error: "timeout"
    }
  ]
};

const report = measureAgnesCommercialAcceptanceProxy({
  report: agnesReport,
  now: () => new Date("2026-06-23T12:00:00.000Z")
});

assert.equal(report.schema_version, "agnes-commercial-acceptance-proxy-v1");
assert.equal(report.generated_at, "2026-06-23T12:00:00.000Z");
assert.equal(report.source.target_count, 4);
assert.equal(report.source.attempted_count, 4);
assert.equal(report.source.evaluated_count, 3);
assert.equal(report.source.provider_error_count, 1);
assert.equal(report.scope.corrected_title_reference_only, true);
assert.equal(report.scope.title_derived_fields_are_partial, true);
assert.equal(report.scope.field_ground_truth_available, false);
assert.equal(report.scope.commercial_accuracy_claim_allowed, false);
assert.equal(report.scope.commercial_acceptance_proxy_available, true);
assert.equal(report.scope.raw_titles_in_report, false);
assert.equal(report.policy.minimum_token_recall, 0.7);
assert.equal(report.policy.minimum_token_precision, 0.7);
assert.equal(report.policy.require_all_title_derived_fields, true);
assert.equal(report.metrics.accepted_count, 1);
assert.equal(report.metrics.manual_review_or_reject_count, 3);
assert.equal(report.metrics.evaluated_rows, 3);
assert.equal(report.metrics.target_rows, 4);
assert.equal(report.metrics.accepted_rate_over_target, 0.25);
assert.equal(report.metrics.accepted_rate_over_evaluated, 0.333333);
assert.equal(report.metrics.manual_review_or_reject_rate, 0.75);
assert.equal(report.metrics.confidence_intervals.accepted_rate_over_target.method, "wilson_score");

assert.equal(report.failure_summary.primary_failure_reasons.principle_error, 1);
assert.equal(report.failure_summary.primary_failure_reasons.low_token_recall, 1);
assert.equal(report.failure_summary.primary_failure_reasons.provider_error, 1);
assert.equal(report.failure_summary.all_failure_reasons.principle_error, 1);
assert.equal(report.failure_summary.all_failure_reasons.title_derived_field_mismatch, 1);
assert.equal(report.failure_summary.all_failure_reasons.low_token_recall, 1);
assert.equal(report.failure_summary.all_failure_reasons.provider_error, 1);
assert.equal(report.failure_summary.principle_failures.wrong_year, 1);
assert.equal(report.failure_summary.principle_failures.wrong_serial, 1);
assert.equal(report.failure_summary.principle_failures.wrong_grade, 1);
assert.equal(report.failure_summary.principle_failures.unexpected_color, 1);
assert.equal(report.failure_summary.title_derived_field_mismatches.year, 1);
assert.equal(report.failure_summary.title_derived_field_mismatches.serial_number, 1);
assert.equal(report.failure_summary.title_derived_field_mismatches.grade, 1);
assert.equal(report.failure_summary.title_derived_field_mismatches.color, 1);
assert.ok(report.sensitivity.some((item) => item.min_token_recall === 0.8 && item.accepted_count === 1));

const strict = measureAgnesCommercialAcceptanceProxy({
  report: agnesReport,
  minTokenRecall: 0.96,
  minTokenPrecision: 0.96,
  now: () => new Date("2026-06-23T12:01:00.000Z")
});
assert.equal(strict.metrics.accepted_count, 0);
assert.equal(strict.failure_summary.all_failure_reasons.low_token_recall, 3);
assert.equal(strict.failure_summary.all_failure_reasons.low_token_precision, 3);

const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /Shohei Ohtani/);
assert.doesNotMatch(serialized, /Caitlin Clark/);
assert.doesNotMatch(serialized, /Mike Trout/);
assert.doesNotMatch(serialized, /"corrected_title_reference"\s*:/);
assert.doesNotMatch(serialized, /"prediction"\s*:/);

const summary = formatAgnesCommercialAcceptanceProxySummary(report);
assert.match(summary, /accepted: 1\/4 \(0.25\)/);
assert.match(summary, /manual_review_or_reject: 3\/4 \(0.75\)/);
assert.match(summary, /commercial_accuracy_claim_allowed: false/);
assert.match(summary, /raw_titles_in_report: false/);
assert.doesNotMatch(summary, /Shohei Ohtani/);

const tmp = await mkdtemp(join(tmpdir(), "agnes-commercial-acceptance-proxy-"));
const inputPath = join(tmp, "agnes-report.json");
const outPath = join(tmp, "commercial-report.json");
await writeFile(inputPath, `${JSON.stringify(agnesReport, null, 2)}\n`);
const cli = spawnSync(process.execPath, [
  "scripts/measure-agnes-commercial-acceptance-proxy.mjs",
  "--input",
  inputPath,
  "--out",
  outPath
], {
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /Agnes commercial acceptance proxy/);
assert.match(cli.stdout, /accepted: 1\/4 \(0.25\)/);
assert.doesNotMatch(cli.stdout, /Caitlin Clark/);

const written = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(written.metrics.accepted_count, 1);
assert.equal(written.failure_summary.primary_failure_reasons.provider_error, 1);
assert.doesNotMatch(JSON.stringify(written), /Mike Trout/);

console.log("Agnes commercial acceptance proxy tests passed");
