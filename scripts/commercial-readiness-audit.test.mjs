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
const ebayCandidatesPath = join(tmp, "ebay-image-candidates.json");
const supabaseSnapshotPath = join(tmp, "supabase-live-snapshot.json");
const supabaseCandidateReportPath = join(tmp, "supabase-candidates-report.json");
const commercialReviewPacketPath = join(tmp, "commercial-review-packet.json");
const commercialReviewWorklistPath = join(tmp, "commercial-review-worklist.json");

await writeFile(datasetPath, `${JSON.stringify({
  schema_version: "golden-dataset-v1",
  splits: {
    development: [],
    calibration: [],
    held_out_commercial: []
  }
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
    corrected_title_is_reviewed_title_ground_truth: true,
    corrected_title_used_as_ground_truth: false,
    corrected_title_used_as_field_ground_truth: false,
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
    corrected_title_is_reviewed_title_ground_truth: true,
    corrected_title_used_as_ground_truth: false,
    corrected_title_used_as_field_ground_truth: false,
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
    corrected_title_is_reviewed_title_ground_truth: true,
    corrected_title_used_as_ground_truth: false,
    corrected_title_used_as_field_ground_truth: false,
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
      corrected_title_is_reviewed_title_ground_truth: true,
      corrected_title_used_as_ground_truth: false
    }
  ]
}, null, 2)}\n`);

await writeFile(commercialReviewWorklistPath, `${JSON.stringify({
  schema_version: "commercial-review-worklist-v1",
  generated_at: "2026-06-23T10:30:00.000Z",
  summary: {
    task_count: 248,
    source_task_count: 248,
    priority_band_counts: {
      P0: 23,
      P1: 97,
      P2: 108,
      P3: 20
    },
    review_effort_counts: {
      MEDIUM: 216,
      HIGH: 12,
      LOW: 20
    },
    corrected_title_used_as_ground_truth_count: 0,
    suggestions_are_ground_truth_count: 0,
    bad_policy_task_count: 0,
    worklist_uses_ground_truth: false
  },
  items: [
    {
      asset_id: "supabase_feedback_1",
      priority_band: "P0",
      priority_score: 0.83,
      suggestions_are_ground_truth: false
    }
  ]
}, null, 2)}\n`);

const report = await createCommercialReadinessReport({
  datasetPath,
  env: {
    BRAVE_SMOKE_REPORT_PATH: join(tmp, "brave-smoke.json"),
    EBAY_SMOKE_REPORT_PATH: join(tmp, "ebay-smoke.json"),
    OWS_SMOKE_REPORT_PATH: join(tmp, "ows-smoke.json"),
    EBAY_IMAGE_CANDIDATES_OUT: ebayCandidatesPath,
    SUPABASE_LIVE_SNAPSHOT_PATH: supabaseSnapshotPath,
    SUPABASE_RECOGNITION_CANDIDATE_REPORT_PATH: supabaseCandidateReportPath,
    COMMERCIAL_REVIEW_PACKET_PATH: commercialReviewPacketPath,
    COMMERCIAL_REVIEW_WORKLIST_PATH: commercialReviewWorklistPath,
    LISTING_IDENTITY_CACHE_READ_ENABLED: "true",
    LISTING_IDENTITY_CACHE_WRITE_ENABLED: "false",
    LISTING_IDENTITY_CACHE_WRITE_RESOLVED: "false",
    LISTING_IDENTITY_CACHE_TTL_DAYS: "30"
  }
});

assert.equal(report.ok, false);
assert.equal(report.status, "blocked");

const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));
assert.equal(byId.golden_dataset.status, "passed");
assert.equal(byId.commercial_acceptance_gate.status, "blocked");
assert.equal(byId.commercial_acceptance_gate.details.held_out_commercial_assets, 0);
assert.match(byId.commercial_acceptance_gate.details.reasons.join("; "), /held_out_commercial split is empty/);
assert.equal(byId.provider_default_policy.status, "passed");
assert.equal(byId.provider_default_policy.details.gpt_production_default, true);
assert.equal(byId.provider_default_policy.details.single_gpt_provider_only, true);
assert.equal(byId.provider_default_policy.details.gpt_primary_fast_vision, true);
assert.equal(byId.provider_default_policy.details.gpt_provider_present, true);
assert.equal(byId.provider_default_policy.details.mixed_model_cascade, "removed");
assert.equal(byId.provider_default_policy.details.gpt_implicit_default, "production_primary");
assert.equal(byId.provider_default_policy.details.standalone_gpt_default, "server_default");
assert.equal(byId.provider_default_policy.details.gpt_visible_button, true);
assert.equal(byId.provider_default_policy.details.recognition_profile_server_owned, true);
assert.equal(byId.provider_default_policy.details.client_algorithm_controls_absent, true);
assert.equal(byId.publishing_approval_gate.status, "passed");
assert.equal(byId.publishing_destination.status, "blocked");
assert.equal(byId.external_retrieval_live_smoke.status, "blocked");
assert.equal(byId.ebay_300_image_candidates.status, "blocked");
assert.equal(byId.ebay_300_image_candidates.details.collected_count, 0);
assert.equal(byId.ebay_300_image_candidates.details.target_count, 300);
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
assert.equal(byId.supabase_commercial_ground_truth.details.corrected_title_is_reviewed_title_ground_truth, true);
assert.equal(byId.supabase_commercial_ground_truth.details.corrected_title_used_as_ground_truth, false);
assert.equal(byId.supabase_commercial_ground_truth.details.corrected_title_used_as_field_ground_truth, false);
assert.equal(byId.commercial_review_packet.status, "passed");
assert.equal(byId.commercial_review_packet.details.task_count, 248);
assert.equal(byId.commercial_review_packet.details.corrected_title_hint_count, 248);
assert.equal(byId.commercial_review_packet.details.corrected_title_is_reviewed_title_ground_truth, true);
assert.equal(byId.commercial_review_packet.details.corrected_title_used_as_ground_truth, false);
assert.equal(byId.commercial_review_packet.details.corrected_title_used_as_field_ground_truth, false);
assert.equal(byId.commercial_review_packet.details.suggested_fields_are_ground_truth, false);
assert.equal(byId.commercial_review_packet.details.suggested_field_task_count, 248);
assert.equal(byId.commercial_review_packet.details.suggested_field_counts.year, 248);
assert.equal(byId.commercial_review_worklist.status, "passed");
assert.equal(byId.commercial_review_worklist.details.task_count, 248);
assert.equal(byId.commercial_review_worklist.details.priority_band_counts.P0, 23);
assert.equal(byId.commercial_review_worklist.details.priority_band_counts.P1, 97);
assert.equal(byId.commercial_review_worklist.details.worklist_uses_ground_truth, false);
assert.equal(byId.commercial_review_worklist.details.bad_policy_task_count, 0);
assert.equal(byId.identity_result_cache.status, "passed");
assert.equal(byId.identity_result_cache.details.table, "listing_identity_resolution_cache");
assert.equal(byId.identity_result_cache.details.read_enabled, true);
assert.equal(byId.identity_result_cache.details.write_enabled, false);
assert.equal(byId.identity_result_cache.details.terminal_l2_abstain_replay_enabled, true);
assert.equal(byId.identity_result_cache.details.training_table, false);
assert.equal(byId.identity_result_cache.details.stores_signed_urls, false);
assert.deepEqual(byId.identity_result_cache.details.failures, []);

const text = formatCommercialReadinessReport(report);
assert.match(text, /Commercial readiness audit blocked/);
assert.match(text, /held_out_commercial_assets: 0/);
assert.match(text, /commercial_acceptance_gate: blocked/);
assert.match(text, /external_retrieval_smoke_statuses: brave=missing, ebay_browse=missing, openai_web_search=missing/);
assert.match(text, /ebay_image_candidates: skipped 0\/300/);
assert.match(text, /supabase_commercial_sample: passed rows 351, image-backed 248, no-image 103/);
assert.match(text, /supabase_commercial_ground_truth: blocked required fields year=0, product=0, players=0/);
assert.match(text, /commercial_review_packet: passed tasks 248, reviewed-title-gt yes, field-gt-from-title no, suggested-field-hints 248/);
assert.match(text, /commercial_review_worklist: passed tasks 248, P0 23, P1 97, uses-ground-truth no/);
assert.match(text, /identity_result_cache: passed read yes, write no, training no/);
assert.match(text, /gpt_implicit_default: production_primary/);
assert.match(text, /standalone_gpt_default: server_default/);
assert.match(text, /publishing_destination: blocked/);

console.log("commercial readiness audit tests passed");
