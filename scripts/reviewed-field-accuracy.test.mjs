import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildReviewedGroundTruthDevSet
} from "./build-reviewed-ground-truth-dev-set.mjs";
import {
  evaluateReviewedFieldAccuracy,
  formatReviewedFieldAccuracySummary,
  normalizeSubject
} from "./evaluate-reviewed-field-accuracy.mjs";

function field(status, value) {
  return {
    status,
    value,
    evidence_sources: [],
    reviewer_notes: ""
  };
}

const labels = {
  schema_version: "reviewed-ground-truth-v1",
  dataset_id: "unit-reviewed-dev",
  split: "development",
  commercial_heldout: false,
  corrected_title_policy: {
    can_be_used_as_ground_truth: false
  },
  items: [
    {
      card_id: "card-1",
      source_feedback_id: "fb1",
      fields: {
        subject: field("CONFIRMED", ["Mike Trout", "Shohei Ohtani"]),
        year: field("CONFIRMED", "2024"),
        product_or_set: field("CONFIRMED", { product: "Topps Chrome", set: "Sapphire", value: "Topps Chrome Sapphire" }),
        card_type: field("CONFIRMED", "Auto RC"),
        variant_or_parallel: field("CONFIRMED", { exact: "Purple Refractor", narrow: "Refractor", color: "Purple" }),
        collector_number: field("CONFIRMED", "CL-LM"),
        serial_number: field("CONFIRMED", "031/050"),
        grade: field("CONFIRMED", { company: "PSA", card_grade: "10", auto_grade: "", grade_type: "" })
      }
    },
    {
      card_id: "card-2",
      source_feedback_id: "fb2",
      fields: {
        subject: field("CONFIRMED", ["Caitlin Clark"]),
        year: field("CONFIRMED", "2024"),
        product_or_set: field("CONFIRMED", "Bowman Chrome"),
        card_type: field("CONFIRMED", "RC"),
        variant_or_parallel: field("CONFIRMED", { exact: "Blue Hyper Prizm", narrow: "Prizm", color: "Blue" }),
        collector_number: field("NOT_APPLICABLE", ""),
        serial_number: field("CONFIRMED", "31/50"),
        grade: field("UNKNOWN", "")
      }
    }
  ]
};

const predictions = {
  schema_version: "provider-report-v1",
  provider: "openai_legacy",
  provider_display_name: "GPT-4.1 mini",
  corrected_title_reference_only: true,
  results: [
    {
      candidate_id: "supabase_feedback_fb1",
      source_feedback_id: "fb1",
      status: "evaluated",
      prediction: {
        fields: {
          year: "2024",
          product: "Topps Chrome",
          set: "Sapphire",
          players: ["Shohei Ohtani", "Mike Trout"],
          card_type: "Auto",
          rc: true,
          parallel_exact: "Purple Refractor",
          parallel_family: "Refractor",
          surface_color: "Purple",
          collector_number: "#CL-LM",
          serial_number: "31/50",
          grade_company: "PSA",
          card_grade: "10"
        }
      },
      publication_gate: {
        field_publishability: {
          year: "PUBLISHABLE_NARROW",
          product: "PUBLISHABLE_NARROW",
          set: "PUBLISHABLE_NARROW",
          players: "PUBLISHABLE_NARROW",
          card_type: "PUBLISHABLE_NARROW",
          parallel_exact: "PUBLISHABLE_NARROW",
          collector_number: "PUBLISHABLE_NARROW",
          serial_number: "PUBLISHABLE_NARROW",
          grade_company: "PUBLISHABLE_NARROW",
          card_grade: "PUBLISHABLE_NARROW"
        }
      }
    },
    {
      candidate_id: "fb2",
      source_feedback_id: "fb2",
      status: "evaluated",
      prediction: {
        fields: {
          year: "2023",
          product: "Bowman Chrome",
          players: ["Caitlin Clark"],
          card_type: "",
          rc: true,
          parallel_exact: "Blue Prizm",
          parallel_family: "Prizm",
          surface_color: "Blue",
          serial_number: "#/50"
        }
      },
      publication_gate: {
        writer_required_fields: ["year"],
        writer_review_items: [
          {
            field: "serial_number",
            publishability: "BLOCKING",
            conflicts: [{ field: "serial_number", severity: "HIGH" }]
          }
        ],
        field_publishability: {
          year: "REVIEW_REQUIRED",
          serial_number: "BLOCKING",
          parallel_exact: "PUBLISHABLE_NARROW"
        }
      }
    }
  ]
};

assert.deepEqual(normalizeSubject(["Shohei Ohtani", "Mike Trout"]), ["mike trout", "shohei ohtani"]);

const report = evaluateReviewedFieldAccuracy({
  labels,
  predictions,
  now: () => new Date("2026-06-24T00:00:00.000Z")
});

assert.equal(report.schema_version, "reviewed-field-accuracy-report-v1");
assert.equal(report.status, "completed");
assert.equal(report.scope.corrected_title_used_as_ground_truth, false);
assert.equal(report.scope.commercial_heldout_acceptance_set, false);
assert.equal(report.summary.label_item_count, 2);
assert.equal(report.summary.matched_prediction_count, 2);
assert.equal(report.summary.evaluated_card_count, 2);
assert.equal(report.summary.evaluated_field_count, 14);
assert.deepEqual(report.metrics.ai_card_exact_accuracy, { correct: 1, total: 2, rate: 0.5 });

assert.equal(report.metrics.per_field_exact_accuracy.subject.correct, 2);
assert.equal(report.metrics.per_field_exact_accuracy.subject.total, 2);
assert.equal(report.metrics.per_field_exact_accuracy.year.correct, 1);
assert.equal(report.metrics.per_field_exact_accuracy.variant_or_parallel.correct, 1);
assert.equal(report.metrics.per_field_exact_accuracy.serial_number.correct, 1);
assert.equal(report.metrics.per_field_exact_accuracy.collector_number.total, 1);
assert.equal(report.metrics.per_field_exact_accuracy.grade.total, 1);

assert.equal(report.metrics.critical_risk_recall.flagged_critical_error_count, 2);
assert.equal(report.metrics.critical_risk_recall.total_critical_error_count, 3);
assert.equal(report.metrics.critical_risk_recall.rate, 0.666667);
assert.equal(report.metrics.unflagged_critical_error_rate.unflagged_critical_error_count, 1);
assert.equal(report.metrics.unflagged_critical_error_rate.rate, 0.333333);

assert.equal(report.cards[0].fields.subject.is_correct, true);
assert.equal(report.cards[0].fields.subject.display_status, "NORMAL");
assert.equal(report.cards[1].fields.year.display_status, "REVIEW");
assert.equal(report.cards[1].fields.year.risk_flagged, true);
assert.equal(report.cards[1].fields.variant_or_parallel.is_correct, false);
assert.equal(report.cards[1].fields.variant_or_parallel.risk_flagged, false);
assert.equal(report.cards[1].fields.variant_or_parallel.auxiliary.parallel_color_match, true);
assert.equal(report.cards[1].fields.serial_number.is_correct, false);
assert.equal(report.cards[1].fields.serial_number.display_status, "CONFLICT");
assert.equal(report.cards[1].fields.serial_number.auxiliary.serial_denominator_match, true);
assert.equal(report.cards[1].fields.collector_number.excluded_from_denominator, true);
assert.equal(report.cards[1].fields.grade.excluded_from_denominator, true);

const summary = formatReviewedFieldAccuracySummary(report);
assert.match(summary, /ai_card_exact_accuracy: 1\/2 \(0.5\)/);
assert.match(summary, /critical_risk_recall: 2\/3 \(0.666667\)/);
assert.match(summary, /corrected_title_used_as_ground_truth: false/);

const devSet = buildReviewedGroundTruthDevSet({
  schema_version: "fixed-30-v1",
  manifest_hash: "hash-1",
  items: [
    {
      asset_id: "asset-1",
      source_feedback_id: "fb1",
      images: [{ role: "front_original", object_path: "front.jpg" }],
      ground_truth: {
        year: "2024",
        product: "Topps Chrome",
        set: "Sapphire",
        players: ["Shohei Ohtani"]
      },
      source_titles: {
        generated_title: "Generated",
        corrected_title: "Corrected"
      }
    }
  ]
}, {
  now: () => new Date("2026-06-24T01:00:00.000Z")
});

assert.equal(devSet.schema_version, "reviewed-ground-truth-v1");
assert.equal(devSet.summary.item_count, 1);
assert.equal(devSet.summary.corrected_title_used_as_ground_truth, false);
assert.equal(devSet.items[0].annotation_hint.can_be_used_as_ground_truth, false);
assert.equal(devSet.items[0].fields.year.status, "UNREVIEWED");

const trustedDevSet = buildReviewedGroundTruthDevSet({
  items: [
    {
      source_feedback_id: "fb1",
      ground_truth: {
        year: "2024",
        product: "Topps Chrome"
      }
    }
  ]
}, {
  trustExistingGroundTruth: true,
  now: () => new Date("2026-06-24T01:01:00.000Z")
});
assert.equal(trustedDevSet.items[0].fields.year.status, "CONFIRMED");
assert.equal(trustedDevSet.items[0].fields.subject.status, "UNKNOWN");

const emptyReport = evaluateReviewedFieldAccuracy({
  labels: devSet,
  predictions,
  now: () => new Date("2026-06-24T02:00:00.000Z")
});
assert.equal(emptyReport.status, "no_reviewed_ground_truth");
assert.equal(emptyReport.metrics.ai_card_exact_accuracy.rate, null);

const tmp = await mkdtemp(join(tmpdir(), "reviewed-field-accuracy-"));
const labelsPath = join(tmp, "labels.json");
const predictionsPath = join(tmp, "predictions.json");
const outPath = join(tmp, "report.json");
await writeFile(labelsPath, `${JSON.stringify(labels, null, 2)}\n`);
await writeFile(predictionsPath, `${JSON.stringify(predictions, null, 2)}\n`);
const cli = spawnSync(process.execPath, [
  "scripts/evaluate-reviewed-field-accuracy.mjs",
  "--labels",
  labelsPath,
  "--predictions",
  predictionsPath,
  "--out",
  outPath
], {
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /status: completed/);
const written = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(written.metrics.unflagged_critical_error_rate.unflagged_critical_error_count, 1);

console.log("Reviewed field accuracy tests passed");
