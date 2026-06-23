import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCommercialReviewPacket,
  reviewPacketToRecognitionDataset,
  suggestRecognitionFieldsFromEnglishTitle
} from "../lib/listing/recognition/commercial-review-packet.mjs";
import { runBuildCommercialReviewPacket } from "./build-commercial-review-packet.mjs";
import { runImportCommercialReviewLabels } from "./import-commercial-review-labels.mjs";

const tmp = await mkdtemp(join(tmpdir(), "commercial-review-packet-"));
const candidateManifestPath = join(tmp, "candidates.json");
const packetPath = join(tmp, "review-packet.json");
const reviewedManifestPath = join(tmp, "reviewed-manifest.json");
const reviewedReportPath = join(tmp, "reviewed-report.json");

const candidateManifest = {
  schema_version: "recognition-candidate-export-v1",
  manifest_hash: "candidate-hash",
  summary: {
    item_count: 2,
    corrected_title_used_as_ground_truth: false
  },
  items: [
    {
      asset_id: "supabase_feedback_1",
      source_feedback_id: "fb1",
      physical_card_id: "needs_review_fb1",
      capture_session_id: "feedback/2026-06/card-1",
      category: "sports_card",
      images: [
        {
          image_id: "fb1_front",
          object_path: "feedback/2026-06/card-1/front.jpg",
          bucket: "listing-feedback-images",
          role: "front_original",
          capture_angle: "primary",
          has_glare: false
        },
        {
          image_id: "fb1_back",
          object_path: "feedback/2026-06/card-1/back.jpg",
          bucket: "listing-feedback-images",
          role: "back_original",
          capture_angle: "primary",
          has_glare: false
        }
      ],
      difficulty_tags: ["front_back", "needs_owner_review"],
      source_titles: {
        generated_title: "2025 Topps Chrome Cooper Flagg Auto",
        corrected_title: "2025 Topps Chrome Cooper Flagg Gold Refractor Auto 31/50"
      }
    },
    {
      asset_id: "supabase_feedback_2",
      source_feedback_id: "fb2",
      physical_card_id: "needs_review_fb2",
      capture_session_id: "feedback/2026-06/card-2",
      category: "sports_card",
      images: [
        {
          image_id: "fb2_front",
          object_path: "feedback/2026-06/card-2/front.jpg",
          role: "front_original",
          capture_angle: "primary",
          has_glare: false
        }
      ],
      difficulty_tags: ["front_only", "needs_owner_review"],
      source_titles: {
        generated_title: "bad title",
        corrected_title: "better title"
      }
    }
  ]
};

await writeFile(candidateManifestPath, `${JSON.stringify(candidateManifest, null, 2)}\n`);

const parsedEnglishTitle = suggestRecognitionFieldsFromEnglishTitle(
  "2025 Topps Chrome Cooper Flagg Gold Refractor RC Auto 031/050 PSA 9 Auto 10"
);
assert.equal(parsedEnglishTitle.year, "2025");
assert.equal(parsedEnglishTitle.manufacturer, "Topps");
assert.equal(parsedEnglishTitle.product, "Topps Chrome");
assert.deepEqual(parsedEnglishTitle.players, []);
assert.equal(parsedEnglishTitle.parallel, "Gold Refractor");
assert.equal(parsedEnglishTitle.serial_number, "31/50");
assert.equal(parsedEnglishTitle.rc, true);
assert.equal(parsedEnglishTitle.auto, true);
assert.equal(parsedEnglishTitle.grade_company, "PSA");
assert.equal(parsedEnglishTitle.card_grade, "9");
assert.equal(parsedEnglishTitle.auto_grade, "10");
assert.equal(parsedEnglishTitle.grade_type, "CARD_AND_AUTO");

const packet = createCommercialReviewPacket(candidateManifest, {
  now: () => new Date("2026-06-23T10:00:00.000Z")
});
assert.equal(packet.schema_version, "commercial-review-packet-v1");
assert.equal(packet.summary.task_count, 2);
assert.equal(packet.summary.corrected_title_hint_count, 2);
assert.equal(packet.summary.corrected_title_used_as_ground_truth, false);
assert.equal(packet.summary.suggested_field_task_count, 1);
assert.equal(packet.summary.suggested_fields_are_ground_truth, false);
assert.equal(packet.summary.suggested_field_counts.year, 1);
assert.equal(packet.summary.suggested_field_counts.product, 1);
assert.equal(packet.summary.suggested_field_counts.serial_number, 1);
assert.equal(packet.tasks[0].corrected_title_hint, "2025 Topps Chrome Cooper Flagg Gold Refractor Auto 31/50");
assert.equal(packet.tasks[0].suggested_fields.year, "2025");
assert.equal(packet.tasks[0].suggested_fields.product, "Topps Chrome");
assert.equal(packet.tasks[0].suggested_fields.parallel, "Gold Refractor");
assert.equal(packet.tasks[0].suggested_fields.serial_number, "31/50");
assert.equal(packet.tasks[0].suggested_fields.auto, true);
assert.equal(packet.tasks[0].suggestion_policy.can_be_used_as_ground_truth, false);
assert.ok(packet.tasks[0].suggestion_sources.every((source) => source.evidence_weight === 0));
assert.equal(packet.tasks[0].reviewed_ground_truth.year, null);
assert.deepEqual(packet.tasks[0].reviewed_ground_truth.players, []);
assert.deepEqual(packet.tasks[0].ground_truth_sources, []);

await runBuildCommercialReviewPacket({
  argv: ["--input", candidateManifestPath, "--out", packetPath, "--limit", "1"],
  now: () => new Date("2026-06-23T10:00:00.000Z")
});
const writtenPacket = JSON.parse(await readFile(packetPath, "utf8"));
assert.equal(writtenPacket.summary.task_count, 1);
assert.equal(writtenPacket.tasks[0].corrected_title_used_as_ground_truth, false);
assert.equal(writtenPacket.tasks[0].suggested_fields.year, "2025");

const suggestionsOnly = reviewPacketToRecognitionDataset(packet);
assert.equal(suggestionsOnly.items.length, 0);
assert.equal(suggestionsOnly.rejected_tasks.length, 2);

const copiedSuggestionsWithoutEvidence = reviewPacketToRecognitionDataset({
  ...packet,
  tasks: [
    {
      ...packet.tasks[0],
      review_status: "SINGLE_REVIEWED",
      reviewed_by: ["operator_a"],
      reviewed_ground_truth: {
        ...packet.tasks[0].suggested_fields,
        players: ["Cooper Flagg"]
      },
      critical_fields: ["year", "product", "players"],
      ground_truth_sources: []
    }
  ]
});
assert.equal(copiedSuggestionsWithoutEvidence.items.length, 0);
assert.match(copiedSuggestionsWithoutEvidence.rejected_tasks[0].reasons.join("; "), /critical field year lacks ground_truth_sources evidence/);

const reviewedPacket = {
  ...packet,
  tasks: [
    {
      ...packet.tasks[0],
      review_status: "SINGLE_REVIEWED",
      reviewed_by: ["operator_a"],
      reviewed_ground_truth: {
        year: "2025",
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
      ground_truth_sources: [
        { field: "year", source_type: "CARD_BACK", source_ref: "back copyright/product line", confidence: 0.95 },
        { field: "product", source_type: "CARD_BACK", source_ref: "back product text", confidence: 0.95 },
        { field: "players", source_type: "CARD_FRONT", source_ref: "front subject name", confidence: 0.96 },
        { field: "serial_number", source_type: "CARD_FRONT", source_ref: "front serial stamp", confidence: 0.98 },
        { field: "checklist_code", source_type: "CARD_BACK", source_ref: "back checklist code", confidence: 0.94 },
        { field: "card_grade", source_type: "SLAB_LABEL", source_ref: "PSA label grade", confidence: 0.99 },
        { field: "auto_grade", source_type: "SLAB_LABEL", source_ref: "PSA/DNA autograph grade", confidence: 0.99 }
      ]
    },
    {
      ...packet.tasks[1],
      review_status: "SINGLE_REVIEWED",
      reviewed_by: ["operator_a"],
      reviewed_ground_truth: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Shohei Ohtani"]
      },
      critical_fields: ["year", "product", "players"],
      ground_truth_sources: [
        { field: "year", source_type: "CARD_FRONT", source_ref: "front text" }
      ]
    }
  ]
};

const imported = reviewPacketToRecognitionDataset(reviewedPacket);
assert.equal(imported.items.length, 1);
assert.equal(imported.rejected_tasks.length, 1);
assert.match(imported.rejected_tasks[0].reasons.join("; "), /critical field product lacks ground_truth_sources evidence/);
assert.equal(imported.validation.ok, true);
assert.equal(imported.dataset_stats.ground_truth_field_counts.year, 1);
assert.equal(imported.dataset_stats.ground_truth_field_counts.product, 1);
assert.equal(imported.dataset_stats.ground_truth_field_counts.players, 1);
assert.equal(imported.items[0].split, "held_out_commercial");
assert.equal(imported.items[0].source_titles.corrected_title, "2025 Topps Chrome Cooper Flagg Gold Refractor Auto 31/50");
assert.equal(imported.items[0].ground_truth.year, "2025");
assert.deepEqual(imported.items[0].reviewed_by, ["operator_a"]);
assert.equal(imported.items[0].suggested_fields, undefined);

const unsafePacket = {
  ...reviewedPacket,
  tasks: [
    {
      ...reviewedPacket.tasks[0],
      corrected_title_used_as_ground_truth: true
    }
  ]
};
const unsafe = reviewPacketToRecognitionDataset(unsafePacket);
assert.equal(unsafe.items.length, 0);
assert.match(unsafe.rejected_tasks[0].reasons.join("; "), /corrected_title cannot be used as field-level ground truth/);

await writeFile(packetPath, `${JSON.stringify(reviewedPacket, null, 2)}\n`);
await assert.rejects(
  () => runImportCommercialReviewLabels({
    argv: ["--input", packetPath, "--out", reviewedManifestPath, "--report-output", reviewedReportPath],
    now: () => new Date("2026-06-23T11:00:00.000Z")
  }),
  /Rejected commercial review tasks found/
);

await runImportCommercialReviewLabels({
  argv: ["--input", packetPath, "--out", reviewedManifestPath, "--report-output", reviewedReportPath, "--allow-rejections"],
  now: () => new Date("2026-06-23T11:00:00.000Z")
});
const reviewedManifest = JSON.parse(await readFile(reviewedManifestPath, "utf8"));
const reviewedReport = JSON.parse(await readFile(reviewedReportPath, "utf8"));
assert.equal(reviewedManifest.summary.item_count, 1);
assert.equal(reviewedManifest.summary.rejected_task_count, 1);
assert.equal(reviewedManifest.summary.corrected_title_used_as_ground_truth, false);
assert.equal(reviewedReport.dataset_stats.ground_truth_field_counts.year, 1);
assert.equal(reviewedReport.summary.review_status, "FIELD_REVIEWED");

console.log("commercial review packet tests passed");
