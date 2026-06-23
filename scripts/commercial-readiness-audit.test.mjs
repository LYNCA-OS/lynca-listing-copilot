import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCommercialReadinessReport,
  formatCommercialReadinessReport
} from "./commercial-readiness-audit.mjs";

const tmp = await mkdtemp(join(tmpdir(), "listing-readiness-"));
const datasetPath = join(tmp, "golden-dataset.json");
const smokePath = join(tmp, "agnes-smoke.json");
const ebayCandidatesPath = join(tmp, "ebay-image-candidates.json");
const publicCardEvalPath = join(tmp, "public-card-eval.json");
const supabaseSnapshotPath = join(tmp, "supabase-live-snapshot.json");
const supabaseCandidateReportPath = join(tmp, "supabase-candidates-report.json");
const commercialReviewPacketPath = join(tmp, "commercial-review-packet.json");

await writeFile(datasetPath, `${JSON.stringify({
  schema_version: "golden-dataset-v1",
  splits: {
    development: [],
    calibration: [],
    held_out_commercial: []
  }
}, null, 2)}\n`);

await writeFile(smokePath, `${JSON.stringify({
  provider: "agnes",
  status: "passed_with_limitations",
  generated_at: "2026-06-22T12:01:52.878Z",
  capabilities: [
    {
      name: "single_image_json",
      status: "passed",
      required: true,
      details: {
        model_id: "agnes-2.0-flash",
        parse_source: "content",
        finish_reason: "stop",
        image_count: "1",
        provider_calls: "1"
      }
    },
    {
      name: "tool_call",
      status: "failed",
      required: false,
      details: {
        error_code: "response_format_invalid",
        message: "Provider content was not valid JSON."
      }
    }
  ]
}, null, 2)}\n`);

await writeFile(ebayCandidatesPath, `${JSON.stringify({
  schema_version: "ebay-image-candidates-v1",
  status: "skipped",
  created_at: "2026-06-22T12:41:10.961Z",
  source: "ebay_browse",
  target_count: 300,
  collected_count: 0,
  blocked_reason: "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured.",
  queries: [],
  items: []
}, null, 2)}\n`);

await writeFile(publicCardEvalPath, `${JSON.stringify({
  schema_version: "agnes-public-card-image-eval-v1",
  status: "completed",
  generated_at: "2026-06-22T13:35:00.000Z",
  provider: "agnes",
  target_count: 300,
  attempted_count: 300,
  evaluated_count: 300,
  provider_error_count: 0,
  card_name_exact_count: 296,
  card_name_exact_rate: 0.986667,
  structured_reference_name_exact_or_corrected_count: 300,
  structured_reference_name_exact_or_corrected_rate: 1,
  name_threshold: 0.95,
  commercial_accuracy_claim_allowed: false,
  commercial_accuracy_eval_eligible: false,
  reference_scope: "public_structured_card_name_reference",
  results: []
}, null, 2)}\n`);

await writeFile(supabaseSnapshotPath, `${JSON.stringify({
  schema_version: "supabase-recognition-live-snapshot-v1",
  generated_at: "2026-06-23T07:27:43.000Z",
  source: {
    provider: "supabase_mcp",
    project_id: "osrrujmpxxiefppjfgpd",
    project_name: "Listing Copilot"
  },
  tables: {
    "public.listing_title_feedback": {
      rows: 351,
      rows_with_front_image_url: 248,
      rows_with_back_image_url: 247,
      image_backed_rows: 248,
      rows_with_corrected_title: 351
    },
    "storage.objects": {
      rows: 495
    }
  },
  candidate_export_status: {
    local_candidate_count: 248,
    filtered_out_no_image_count: 103,
    table_records_without_images: 103,
    corrected_title_used_as_ground_truth: false,
    ground_truth_status: "NEEDS_REVIEW"
  }
}, null, 2)}\n`);

await writeFile(supabaseCandidateReportPath, `${JSON.stringify({
  schema_version: "supabase-recognition-candidate-report-v1",
  generated_at: "2026-06-23T07:26:59.990Z",
  summary: {
    item_count: 248,
    front_image_items: 248,
    back_image_items: 247,
    review_status: "NEEDS_REVIEW",
    corrected_title_used_as_ground_truth: false,
    validation_error_count: 0
  },
  dataset_stats: {
    total_items: 248,
    ground_truth_field_counts: {
      grade_type: 248
    }
  },
  validation: {
    ok: true,
    errors: []
  }
}, null, 2)}\n`);

await writeFile(commercialReviewPacketPath, `${JSON.stringify({
  schema_version: "commercial-review-packet-v1",
  generated_at: "2026-06-23T10:00:00.000Z",
  summary: {
    task_count: 248,
    corrected_title_hint_count: 248,
    corrected_title_used_as_ground_truth: false,
    suggested_field_task_count: 248,
    suggested_field_counts: {
      year: 248,
      product: 237,
      serial_number: 131
    },
    suggested_fields_are_ground_truth: false,
    required_critical_fields: ["year", "product", "players"]
  },
  tasks: [
    {
      asset_id: "supabase_feedback_1",
      corrected_title_used_as_ground_truth: false
    }
  ]
}, null, 2)}\n`);

const report = await createCommercialReadinessReport({
  datasetPath,
  agnesSmokePath: smokePath,
  env: {
    BRAVE_SMOKE_REPORT_PATH: join(tmp, "brave-smoke.json"),
    EBAY_SMOKE_REPORT_PATH: join(tmp, "ebay-smoke.json"),
    OWS_SMOKE_REPORT_PATH: join(tmp, "ows-smoke.json"),
    EBAY_IMAGE_CANDIDATES_OUT: ebayCandidatesPath,
    AGNES_PUBLIC_CARD_EVAL_OUT: publicCardEvalPath,
    SUPABASE_LIVE_SNAPSHOT_PATH: supabaseSnapshotPath,
    SUPABASE_RECOGNITION_CANDIDATE_REPORT_PATH: supabaseCandidateReportPath,
    COMMERCIAL_REVIEW_PACKET_PATH: commercialReviewPacketPath
  }
});

assert.equal(report.ok, false);
assert.equal(report.status, "blocked");

const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));
assert.equal(byId.golden_dataset.status, "passed");
assert.equal(byId.commercial_acceptance_gate.status, "blocked");
assert.equal(byId.commercial_acceptance_gate.details.held_out_commercial_assets, 0);
assert.match(byId.commercial_acceptance_gate.details.reasons.join("; "), /held_out_commercial split is empty/);
assert.equal(byId.agnes_live_smoke.status, "warning");
assert.equal(byId.agnes_live_smoke.details.json_baseline_verified, true);
assert.deepEqual(byId.agnes_live_smoke.details.optional_failures, ["tool_call"]);
assert.equal(byId.provider_default_policy.status, "passed");
assert.equal(byId.provider_default_policy.details.gpt_implicit_default, "blocked_by_policy");
assert.equal(byId.provider_default_policy.details.gpt_visible_button, true);
assert.equal(byId.publishing_approval_gate.status, "passed");
assert.equal(byId.publishing_destination.status, "blocked");
assert.equal(byId.external_retrieval_live_smoke.status, "blocked");
assert.equal(byId.ebay_300_image_candidates.status, "blocked");
assert.equal(byId.ebay_300_image_candidates.details.collected_count, 0);
assert.equal(byId.ebay_300_image_candidates.details.target_count, 300);
assert.equal(byId.public_card_reference_eval.status, "passed");
assert.equal(byId.public_card_reference_eval.details.attempted_count, 300);
assert.equal(byId.public_card_reference_eval.details.card_name_exact_count, 296);
assert.equal(byId.public_card_reference_eval.details.card_name_exact_rate, 0.986667);
assert.equal(byId.public_card_reference_eval.details.structured_reference_name_exact_or_corrected_count, 300);
assert.equal(byId.public_card_reference_eval.details.structured_reference_name_exact_or_corrected_rate, 1);
assert.equal(byId.public_card_reference_eval.details.commercial_accuracy_claim_allowed, false);
assert.equal(byId.supabase_commercial_inventory.status, "passed");
assert.equal(byId.supabase_commercial_inventory.details.table_rows, 351);
assert.equal(byId.supabase_commercial_inventory.details.image_backed_rows, 248);
assert.equal(byId.supabase_commercial_inventory.details.rows_without_images, 103);
assert.equal(byId.supabase_commercial_inventory.details.no_image_rows_counted_separately, true);
assert.equal(byId.supabase_commercial_ground_truth.status, "blocked");
assert.deepEqual(byId.supabase_commercial_ground_truth.details.required_truth_field_coverage, {
  year: 0,
  product: 0,
  players: 0
});
assert.deepEqual(byId.supabase_commercial_ground_truth.details.missing_required_truth_fields, ["year", "product", "players"]);
assert.equal(byId.supabase_commercial_ground_truth.details.corrected_title_used_as_ground_truth, false);
assert.equal(byId.commercial_review_packet.status, "passed");
assert.equal(byId.commercial_review_packet.details.task_count, 248);
assert.equal(byId.commercial_review_packet.details.corrected_title_hint_count, 248);
assert.equal(byId.commercial_review_packet.details.corrected_title_used_as_ground_truth, false);
assert.equal(byId.commercial_review_packet.details.suggested_fields_are_ground_truth, false);
assert.equal(byId.commercial_review_packet.details.suggested_field_task_count, 248);
assert.equal(byId.commercial_review_packet.details.suggested_field_counts.year, 248);

const text = formatCommercialReadinessReport(report);
assert.match(text, /Commercial readiness audit blocked/);
assert.match(text, /held_out_commercial_assets: 0/);
assert.match(text, /commercial_acceptance_gate: blocked/);
assert.match(text, /agnes_smoke_status: passed_with_limitations/);
assert.match(text, /external_retrieval_smoke_statuses: brave=missing, ebay_browse=missing, openai_web_search=missing/);
assert.match(text, /ebay_image_candidates: skipped 0\/300/);
assert.match(text, /public_card_reference_eval: completed exact 296\/300 \(0.986667\), trusted 300\/300 \(1\)/);
assert.match(text, /supabase_commercial_sample: passed rows 351, image-backed 248, no-image 103/);
assert.match(text, /supabase_commercial_ground_truth: blocked required fields year=0, product=0, players=0/);
assert.match(text, /commercial_review_packet: passed tasks 248, corrected-title-as-truth no, suggested-field-hints 248/);
assert.match(text, /gpt_implicit_default: blocked_by_policy/);
assert.match(text, /publishing_destination: blocked/);

console.log("commercial readiness audit tests passed");
