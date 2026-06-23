import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatAgnesTitleDerivedFieldProxySummary,
  measureAgnesTitleDerivedFieldProxy,
  titleDerivedChecks
} from "./measure-agnes-title-derived-field-proxy.mjs";

const agnesReport = {
  schema_version: "agnes-supabase-feedback-eval-v1",
  provider: "agnes",
  target_count: 3,
  attempted_count: 3,
  provider_error_count: 1,
  results: [
    {
      candidate_id: "row1",
      status: "evaluated",
      corrected_title_reference: "2025 Topps Chrome Shohei Ohtani Gold Refractor 29/199 PSA 10 Auto RC",
      prediction: {
        title: "2025 Topps Chrome 029/199 PSA 10 Auto RC",
        fields: {
          year: "2025",
          subset: "Gold Refractor",
          serial_number: "029/199",
          grade_company: "PSA",
          card_grade: "10",
          auto: true,
          rc: true
        }
      }
    },
    {
      candidate_id: "row2",
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
      }
    },
    {
      candidate_id: "row3",
      status: "provider_error",
      corrected_title_reference: "2024 Topps Chrome Mike Trout Silver Refractor",
      error: "provider timeout"
    }
  ]
};

const report = measureAgnesTitleDerivedFieldProxy({
  report: agnesReport,
  now: () => new Date("2026-06-23T12:00:00.000Z")
});

assert.equal(report.schema_version, "agnes-title-derived-field-proxy-v1");
assert.equal(report.generated_at, "2026-06-23T12:00:00.000Z");
assert.equal(report.source.provider, "agnes");
assert.equal(report.source.target_count, 3);
assert.equal(report.source.attempted_count, 3);
assert.equal(report.source.evaluated_count, 2);
assert.equal(report.source.provider_error_count, 1);
assert.equal(report.scope.corrected_title_reference_only, true);
assert.equal(report.scope.title_derived_fields_are_partial, true);
assert.equal(report.scope.field_ground_truth_available, false);
assert.equal(report.scope.commercial_accuracy_claim_allowed, false);
assert.equal(report.scope.raw_titles_in_report, false);
assert.equal(report.scope.no_feedback_retention_side_effects, true);

assert.equal(report.metrics.evaluated_rows, 2);
assert.equal(report.metrics.derivable_rows, 2);
assert.equal(report.metrics.rows_without_derivable_fields, 0);
assert.equal(report.metrics.total_field_checks, 10);
assert.equal(report.metrics.correct_field_checks, 6);
assert.equal(report.metrics.incorrect_field_checks, 4);
assert.equal(report.metrics.field_level_proxy_accuracy, 0.6);
assert.equal(report.metrics.field_level_proxy_error_rate, 0.4);
assert.equal(report.metrics.card_level_title_derived_exact_count, 1);
assert.equal(report.metrics.card_level_title_derived_exact_rate, 0.5);
assert.equal(report.metrics.average_derivable_fields_per_evaluated_row, 5);
assert.equal(report.metrics.confidence_intervals.field_level_proxy_accuracy.method, "wilson_score");
assert.equal(report.metrics.confidence_intervals.field_level_proxy_accuracy.successes, 6);
assert.equal(report.metrics.confidence_intervals.field_level_proxy_accuracy.total, 10);

assert.equal(report.field_breakdown.year.denominator, 2);
assert.equal(report.field_breakdown.year.correct, 1);
assert.equal(report.field_breakdown.serial_number.denominator, 2);
assert.equal(report.field_breakdown.serial_number.correct, 1);
assert.equal(report.field_breakdown.grade.denominator, 2);
assert.equal(report.field_breakdown.grade.correct, 1);
assert.equal(report.field_breakdown.color.denominator, 2);
assert.equal(report.field_breakdown.color.correct, 1);
assert.equal(report.field_breakdown.auto.denominator, 1);
assert.equal(report.field_breakdown.auto.correct, 1);
assert.equal(report.field_breakdown.rc.denominator, 1);
assert.equal(report.field_breakdown.rc.correct, 1);

const rangeYearChecks = titleDerivedChecks({
  corrected_title_reference: "2003-04 Topps LeBron James Rookie RC PSA 10",
  prediction: {
    title: "2003 Topps LeBron James RC PSA 10",
    fields: {
      year: "2003",
      rc: true,
      grade_company: "PSA",
      card_grade: "10"
    }
  }
});
assert.equal(rangeYearChecks.find((check) => check.field === "year").matched, true);

const wrongYearChecks = titleDerivedChecks({
  corrected_title_reference: "2025 Bowman Chrome Cooper Flagg",
  prediction: {
    title: "2023 Bowman Chrome Cooper Flagg",
    fields: { year: "2023" }
  }
});
assert.equal(wrongYearChecks.find((check) => check.field === "year").matched, false);

const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /Shohei Ohtani/);
assert.doesNotMatch(serialized, /Caitlin Clark/);
assert.doesNotMatch(serialized, /"corrected_title_reference"\s*:/);
assert.doesNotMatch(serialized, /Topps Chrome Gold Refractor/);

const summary = formatAgnesTitleDerivedFieldProxySummary(report);
assert.match(summary, /field_level_proxy_accuracy: 6\/10 \(0.6\)/);
assert.match(summary, /card_level_title_derived_exact: 1\/2 \(0.5\)/);
assert.match(summary, /commercial_accuracy_claim_allowed: false/);
assert.match(summary, /raw_titles_in_report: false/);
assert.doesNotMatch(summary, /Shohei Ohtani/);
assert.doesNotMatch(summary, /Caitlin Clark/);

const tmp = await mkdtemp(join(tmpdir(), "agnes-title-derived-field-proxy-"));
const inputPath = join(tmp, "agnes-report.json");
const outPath = join(tmp, "proxy-report.json");
await writeFile(inputPath, `${JSON.stringify(agnesReport, null, 2)}\n`);
const cli = spawnSync(process.execPath, [
  "scripts/measure-agnes-title-derived-field-proxy.mjs",
  "--input",
  inputPath,
  "--out",
  outPath
], {
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /Agnes title-derived field proxy/);
assert.match(cli.stdout, /field_level_proxy_accuracy: 6\/10 \(0.6\)/);
assert.doesNotMatch(cli.stdout, /Shohei Ohtani/);

const written = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(written.metrics.total_field_checks, 10);
assert.equal(written.metrics.correct_field_checks, 6);
assert.doesNotMatch(JSON.stringify(written), /Caitlin Clark/);

console.log("Agnes title-derived field proxy tests passed");
