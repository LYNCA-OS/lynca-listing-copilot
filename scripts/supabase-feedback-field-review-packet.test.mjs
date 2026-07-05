import assert from "node:assert/strict";
import { buildSupabaseFeedbackFieldReviewPacket } from "./build-supabase-feedback-field-review-packet.mjs";

const packet = buildSupabaseFeedbackFieldReviewPacket({
  schema_version: "provider-feedback-eval-v1",
  provider: "openai_vector",
  provider_display_name: "GPT-4.1 mini + Catalog + Vector",
  source_manifest_hash: "manifest-1",
  source_table: "listing_title_feedback",
  corrected_title_reference_only: false,
  results: [
    {
      candidate_id: "card-1",
      asset_id: "asset-1",
      source_feedback_id: "feedback-1",
      corrected_title_reference: "2025 Topps Chrome Shohei Ohtani Gold 05/50 PSA 9",
      prediction: {
        title: "Topps Chrome Shohei Ohtani",
        fields: {
          product: "Topps Chrome",
          players: ["Shohei Ohtani"]
        }
      },
      identity_resolution_status: "ABSTAIN",
      identity_resolution_summary: {
        abstain_reason_codes: ["MISSING_CRITICAL_FIELD"]
      },
      publication_gate: {
        writer_required_fields: ["year", "serial_number"],
        field_publishability: {
          year: "REVIEW_REQUIRED",
          product: "PUBLISHABLE_NARROW",
          serial_number: "BLOCKING"
        }
      },
      image_inputs: [
        { role: "front_original", bucket: "listing-feedback-images", object_path: "feedback/front.jpg" }
      ]
    }
  ]
}, {
  now: () => new Date("2026-06-24T00:00:00.000Z")
});

assert.equal(packet.schema_version, "supabase-feedback-field-review-packet-v1");
assert.equal(packet.summary.task_count, 1);
assert.equal(packet.summary.corrected_title_is_reviewed_title_ground_truth, true);
assert.equal(packet.summary.corrected_title_used_as_ground_truth, false);
assert.equal(packet.summary.corrected_title_used_as_field_ground_truth, false);
assert.equal(packet.tasks[0].corrected_title_hint_policy.can_be_used_as_title_ground_truth, true);
assert.equal(packet.tasks[0].corrected_title_hint_policy.can_be_used_as_field_ground_truth, false);
assert.equal(packet.tasks[0].fields.year.requires_review, true);
assert.equal(packet.tasks[0].fields.serial_number.requires_review, true);
assert.equal(packet.tasks[0].fields.year.publishability, "REVIEW_REQUIRED");
assert.equal(packet.tasks[0].fields.serial_number.publishability, "BLOCKING");
assert.equal(packet.tasks[0].fields.product.predicted_value, "Topps Chrome");
assert.equal(packet.tasks[0].fields.product.reviewed_value, "");
assert.ok(packet.tasks[0].fields.product.allowed_reviewed_statuses.includes("CONFIRMED"));
assert.ok(packet.tasks[0].fields.product.allowed_evidence_sources.includes("OFFICIAL_CHECKLIST"));
assert.deepEqual(packet.tasks[0].fields.players.reviewed_value, []);
assert.ok(packet.tasks[0].fields.year.allowed_review_label_types.includes("FACT_CORRECTION"));
assert.ok(packet.tasks[0].fields.year.allowed_review_label_types.includes("TITLE_STYLE_CHANGE"));
assert.ok(packet.instructions.import_contract);
assert.ok(packet.summary.review_fields.includes("parallel"));

console.log("Supabase feedback field review packet tests passed");
