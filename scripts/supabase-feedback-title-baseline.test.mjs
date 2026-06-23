import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  formatSupabaseFeedbackTitleBaselineSummary,
  measureSupabaseFeedbackTitleBaseline
} from "./measure-supabase-feedback-title-baseline.mjs";

const rows = [
  {
    id: "fb1",
    generated_title: "2025 Topps Chrome Shohei Ohtani Red Refractor 5/5",
    corrected_title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 5/5 PSA 10",
    front_image_url: "https://supabase.test/storage/v1/object/sign/listing-feedback-images/fb1/front.jpg",
    back_image_url: "https://supabase.test/storage/v1/object/sign/listing-feedback-images/fb1/back.jpg",
    created_at: "2026-06-22T11:00:00.000Z"
  },
  {
    id: "fb2",
    generated_title: "2024 Panini Prizm Victor Wembanyama Silver Prizm RC",
    corrected_title: "2024 Panini Prizm Victor Wembanyama Silver Prizm RC",
    front_image_url: "https://supabase.test/storage/v1/object/sign/listing-feedback-images/fb2/front.jpg",
    created_at: "2026-06-22T10:00:00.000Z"
  },
  {
    id: "fb3",
    generated_title: "2023 Bowman Chrome Caitlin Clark 31/50 PSA 9",
    corrected_title: "2024 Bowman Chrome Caitlin Clark 51/50 PSA 10",
    created_at: "2026-06-21T09:00:00.000Z"
  },
  {
    id: "fb4",
    generated_title: "missing corrected",
    corrected_title: "",
    created_at: "2026-06-21T08:00:00.000Z"
  }
];

const report = measureSupabaseFeedbackTitleBaseline({
  rows,
  source: {
    provider: "test"
  },
  now: () => new Date("2026-06-23T12:00:00.000Z")
});

assert.equal(report.schema_version, "supabase-feedback-title-baseline-v1");
assert.equal(report.source.row_count, 4);
assert.equal(report.source.image_backed_row_count, 2);
assert.equal(report.source.no_image_row_count, 2);
assert.equal(report.source.first_created_at, "2026-06-21T08:00:00.000Z");
assert.equal(report.source.last_created_at, "2026-06-22T11:00:00.000Z");
assert.equal(report.scope.corrected_title_reference_only, true);
assert.equal(report.scope.field_ground_truth_available, false);
assert.equal(report.scope.image_level_agnes_eval, false);
assert.equal(report.scope.no_feedback_retention_side_effects, true);
assert.equal(report.scope.raw_titles_in_report, false);
assert.equal(report.scope.commercial_accuracy_claim_allowed, false);
assert.equal(report.scope.commercial_proxy_metric_available, true);

const allRows = report.cohorts.find((cohort) => cohort.cohort === "all_feedback_rows");
assert.equal(allRows.source_rows, 4);
assert.equal(allRows.comparable_rows, 3);
assert.equal(allRows.image_backed_rows, 2);
assert.equal(allRows.raw_exact_count, 1);
assert.equal(allRows.normalized_exact_count, 1);
assert.equal(allRows.normalized_exact_rate, 0.333333);
assert.equal(allRows.human_corrected_proxy_count, 2);
assert.equal(allRows.critical_title_error_count, 2);
assert.equal(allRows.wrong_year_count, 1);
assert.equal(allRows.wrong_serial_count, 1);
assert.equal(allRows.wrong_grade_count, 1);
assert.equal(allRows.unexpected_color_count, 1);
assert.equal(allRows.confidence_intervals.normalized_exact_rate.method, "wilson_score");
assert.equal(allRows.confidence_intervals.normalized_exact_rate.successes, 1);
assert.equal(allRows.confidence_intervals.normalized_exact_rate.total, 3);
assert.equal(allRows.confidence_intervals.normalized_exact_rate.lower, 0.06149);
assert.equal(allRows.confidence_intervals.normalized_exact_rate.upper, 0.792345);

const imageRows = report.cohorts.find((cohort) => cohort.cohort === "image_backed_rows");
assert.equal(imageRows.source_rows, 2);
assert.equal(imageRows.comparable_rows, 2);
assert.equal(imageRows.normalized_exact_count, 1);
assert.equal(imageRows.critical_title_error_count, 1);

const noImageRows = report.cohorts.find((cohort) => cohort.cohort === "no_image_rows");
assert.equal(noImageRows.source_rows, 2);
assert.equal(noImageRows.comparable_rows, 1);
assert.equal(noImageRows.normalized_exact_count, 0);
assert.equal(noImageRows.critical_title_error_count, 1);

const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /Shohei Ohtani/);
assert.doesNotMatch(serialized, /Victor Wembanyama/);
assert.doesNotMatch(serialized, /Caitlin Clark/);

const summary = formatSupabaseFeedbackTitleBaselineSummary(report);
assert.match(summary, /source_rows: 4/);
assert.match(summary, /image_backed_rows: 2/);
assert.match(summary, /commercial_accuracy_claim_allowed: false/);
assert.match(summary, /all_feedback_rows: comparable=3 normalized_exact=1\/3/);
assert.doesNotMatch(summary, /Shohei Ohtani/);

const tmp = await mkdtemp(join(tmpdir(), "supabase-feedback-title-baseline-"));
const inputPath = join(tmp, "rows.json");
const outPath = join(tmp, "report.json");
await writeFile(inputPath, `${JSON.stringify(rows, null, 2)}\n`);
const cli = spawnSync(process.execPath, [
  "scripts/measure-supabase-feedback-title-baseline.mjs",
  "--input",
  inputPath,
  "--out",
  outPath
], {
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /Supabase feedback title baseline/);
assert.match(cli.stdout, /all_feedback_rows: comparable=3/);
const written = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(written.source.row_count, 4);
assert.equal(written.cohorts[0].critical_title_error_count, 2);

const manifestPath = join(tmp, "manifest.json");
await writeFile(manifestPath, `${JSON.stringify({
  schema_version: "recognition-candidate-export-v1",
  source: {
    provider: "test_manifest"
  },
  manifest_hash: "abc",
  items: [
    {
      asset_id: "asset1",
      source_feedback_id: "fb1",
      images: [{ object_path: "fb1/front.jpg", bucket: "listing-feedback-images" }],
      source_titles: {
        generated_title: "2024 Topps Chrome Test Card",
        corrected_title: "2024 Topps Chrome Test Card"
      }
    }
  ]
}, null, 2)}\n`);
const manifestCli = spawnSync(process.execPath, [
  "scripts/measure-supabase-feedback-title-baseline.mjs",
  "--input",
  manifestPath,
  "--no-write"
], {
  encoding: "utf8"
});
assert.equal(manifestCli.status, 0, manifestCli.stderr);
assert.match(manifestCli.stdout, /source_rows: 1/);
assert.match(manifestCli.stdout, /image_backed_rows: 1/);

console.log("Supabase feedback title baseline tests passed");
