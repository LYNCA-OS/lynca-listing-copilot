import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommercialReviewPacket } from "../lib/listing/recognition/commercial-review-packet.mjs";
import {
  commercialReviewWorklistToCsv,
  createCommercialReviewWorklist
} from "../lib/listing/recognition/commercial-review-worklist.mjs";
import { runBuildCommercialReviewWorklist } from "./build-commercial-review-worklist.mjs";

const tmp = await mkdtemp(join(tmpdir(), "commercial-review-worklist-"));
const packetPath = join(tmp, "review-packet.json");
const worklistPath = join(tmp, "worklist.json");
const worklistCsvPath = join(tmp, "worklist.csv");

const packet = createCommercialReviewPacket({
  schema_version: "recognition-candidate-export-v1",
  manifest_hash: "candidate-hash",
  items: [
    {
      asset_id: "high_value_serial_grade",
      source_feedback_id: "fb_high",
      capture_session_id: "feedback/high",
      images: [
        { image_id: "high_front", role: "front_original", bucket: "listing-feedback-images", object_path: "high/front.jpg" },
        { image_id: "high_back", role: "back_original", bucket: "listing-feedback-images", object_path: "high/back.jpg" }
      ],
      source_titles: {
        generated_title: "2025 Topps Chrome Cooper Flagg Auto",
        corrected_title: "2025 Topps Chrome Cooper Flagg Gold Refractor RC Auto 031/050 PSA 9 Auto 10"
      }
    },
    {
      asset_id: "front_only_unknown",
      source_feedback_id: "fb_front",
      capture_session_id: "feedback/front-only",
      images: [
        { image_id: "front_only", role: "front_original", bucket: "listing-feedback-images", object_path: "front-only/front.jpg" }
      ],
      source_titles: {
        generated_title: "bad title",
        corrected_title: "better title"
      }
    },
    {
      asset_id: "simple_base",
      source_feedback_id: "fb_simple",
      capture_session_id: "feedback/simple",
      images: [
        { image_id: "simple_front", role: "front_original", bucket: "listing-feedback-images", object_path: "simple/front.jpg" },
        { image_id: "simple_back", role: "back_original", bucket: "listing-feedback-images", object_path: "simple/back.jpg" }
      ],
      source_titles: {
        generated_title: "2024 Topps Chrome Test Player",
        corrected_title: "2024 Topps Chrome Test Player"
      }
    }
  ]
}, {
  now: () => new Date("2026-06-23T12:00:00.000Z")
});

const worklist = createCommercialReviewWorklist(packet, {
  now: () => new Date("2026-06-23T12:30:00.000Z")
});
assert.equal(worklist.schema_version, "commercial-review-worklist-v1");
assert.equal(worklist.summary.task_count, 3);
assert.equal(worklist.summary.source_task_count, 3);
assert.equal(worklist.summary.worklist_uses_ground_truth, false);
assert.equal(worklist.summary.bad_policy_task_count, 0);
assert.equal(worklist.items[0].asset_id, "high_value_serial_grade");
assert.equal(worklist.items[0].priority_band, "P0");
assert.equal(worklist.items[0].review_effort, "MEDIUM");
assert.ok(worklist.items[0].priority_signals.includes("serial"));
assert.ok(worklist.items[0].priority_signals.includes("grade"));
assert.ok(worklist.items[0].review_targets.includes("serial_number"));
assert.ok(worklist.items[0].review_targets.includes("card_grade"));
assert.ok(worklist.items[0].operator_next_actions.some((action) => /slab label/.test(action)));
assert.equal(worklist.items[0].suggested_fields.players.length, 0);
assert.deepEqual(worklist.items[0].missing_required_fields, ["year", "product", "players"]);
assert.equal(worklist.items[1].asset_id, "front_only_unknown");
assert.equal(worklist.items[1].review_effort, "HIGH");
assert.ok(worklist.items[1].priority_signals.includes("front_only"));
assert.equal(worklist.items[2].asset_id, "simple_base");
assert.equal(worklist.summary.suggested_field_counts.year, 2);
assert.equal(worklist.summary.suggested_field_counts.product, 2);
assert.equal(worklist.summary.suggested_field_counts.serial_number, 1);

const csv = commercialReviewWorklistToCsv(worklist);
assert.match(csv, /^row_number,priority_band,priority_score,review_effort,asset_id/m);
assert.match(csv, /high_value_serial_grade/);
assert.match(csv, /Gold Refractor/);
assert.match(csv, /verify subject\/player names/);

await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
await runBuildCommercialReviewWorklist({
  argv: ["--input", packetPath, "--out", worklistPath, "--csv-out", worklistCsvPath, "--limit", "2"],
  now: () => new Date("2026-06-23T13:00:00.000Z")
});
const writtenWorklist = JSON.parse(await readFile(worklistPath, "utf8"));
const writtenCsv = await readFile(worklistCsvPath, "utf8");
assert.equal(writtenWorklist.summary.task_count, 2);
assert.equal(writtenWorklist.summary.limit_applied, 2);
assert.equal(writtenWorklist.items[0].asset_id, "high_value_serial_grade");
assert.match(writtenCsv, /front_only_unknown/);
assert.ok(writtenWorklist.items.every((item) => !Object.hasOwn(item, "reviewed_ground_truth")));
assert.ok(writtenWorklist.items.every((item) => !Object.hasOwn(item, "ground_truth_sources")));
assert.ok(!writtenWorklist.items[1].review_targets.includes("grade_type"));

console.log("commercial review worklist tests passed");
