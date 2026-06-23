import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeliveryReport } from "./build-delivery-report.mjs";

const tmp = await mkdtemp(join(tmpdir(), "listing-delivery-report-"));
const datasetPath = join(tmp, "golden-dataset.json");
const agnesSmokePath = join(tmp, "agnes-smoke.json");
const braveSmokePath = join(tmp, "brave-smoke.json");
const ebaySmokePath = join(tmp, "ebay-smoke.json");
const owsSmokePath = join(tmp, "ows-smoke.json");
const ebayCandidatesPath = join(tmp, "ebay-candidates.json");
const publicCardEvalPath = join(tmp, "public-card-eval.json");
const realPhotoPilotPath = join(tmp, "real-photo-pilot.json");
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

await writeFile(agnesSmokePath, `${JSON.stringify({
  provider: "agnes",
  status: "passed",
  generated_at: "2026-06-22T12:27:58.668Z",
  capabilities: [
    {
      name: "single_image_json",
      status: "passed",
      required: true,
      details: {
        model_id: "agnes-2.0-flash",
        parse_source: "content",
        image_count: "1",
        provider_calls: "1"
      }
    },
    {
      name: "tool_call",
      status: "passed",
      required: false,
      details: {
        model_id: "agnes-2.0-flash",
        parse_source: "tool_call"
      }
    }
  ]
}, null, 2)}\n`);

for (const [path, provider] of [
  [braveSmokePath, "brave"],
  [ebaySmokePath, "ebay_browse"],
  [owsSmokePath, "openai_web_search"]
]) {
  await writeFile(path, `${JSON.stringify({
    provider,
    status: "skipped",
    generated_at: "2026-06-22T12:24:22.604Z",
    capabilities: [
      {
        name: "credentials",
        status: "skipped",
        required: true,
        details: {
          reason: "credential missing in test fixture"
        }
      }
    ]
  }, null, 2)}\n`);
}

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
  commercial_accuracy_claim_allowed: false,
  commercial_accuracy_eval_eligible: false,
  name_reference_eval_only: true,
  results: []
}, null, 2)}\n`);

await writeFile(realPhotoPilotPath, `${JSON.stringify({
  schema_version: "agnes-real-photo-card-pilot-eval-v1",
  status: "completed",
  generated_at: "2026-06-23T09:35:00.000Z",
  provider: "agnes",
  target_count: 10,
  attempted_count: 10,
  evaluated_count: 7,
  provider_error_count: 3,
  title_accepted_count: 3,
  title_acceptance_evaluated_rate: 0.428571,
  controlled_storage_input_count: 0,
  external_url_input_count: 10,
  commercial_accuracy_claim_allowed: false,
  commercial_accuracy_eval_eligible: false,
  marketplace_reference_only: true,
  controlled_storage_required_for_commercial: true,
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

const report = await createDeliveryReport({
  datasetPath,
  agnesSmokePath,
  now: () => new Date("2026-06-22T13:00:00.000Z"),
  env: {
    BRAVE_SMOKE_REPORT_PATH: braveSmokePath,
    EBAY_SMOKE_REPORT_PATH: ebaySmokePath,
    OWS_SMOKE_REPORT_PATH: owsSmokePath,
    EBAY_IMAGE_CANDIDATES_OUT: ebayCandidatesPath,
    AGNES_PUBLIC_CARD_EVAL_OUT: publicCardEvalPath,
    AGNES_REAL_PHOTO_PILOT_OUT: realPhotoPilotPath,
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

assert.match(report, /^# Listing Copilot Final Delivery Report/m);
assert.match(report, /Generated at: 2026-06-22T13:00:00.000Z/);
for (let index = 1; index <= 28; index += 1) {
  assert.match(report, new RegExp(`^## ${index}\\. `, "m"), `missing section ${index}`);
}

assert.match(report, /Commercial claim allowed: no/);
assert.match(report, /Held-out commercial assets: 0/);
assert.match(report, /Agnes Integration Status/);
assert.match(report, /Smoke report: passed/);
assert.match(report, /Brave Search Status/);
assert.match(report, /Smoke status: skipped/);
assert.match(report, /eBay Browse Status/);
assert.match(report, /300-image candidate queue: skipped 0\/300/);
assert.match(report, /Public card-name reference eval: completed exact 296\/300 \(0.986667\), trusted 300\/300 \(1\)/);
assert.match(report, /Marketplace real-photo pilot: completed evaluated 7\/10, title accepted 3\/7 \(0.428571\), provider errors 3, inputs controlled=0 external=10/);
assert.match(report, /Supabase commercial inventory: passed rows 351, image-backed 248, no-image 103/);
assert.match(report, /Supabase field-level ground truth: blocked required fields year=0, product=0, players=0/);
assert.match(report, /Commercial review packet: passed tasks 248, corrected-title-as-truth=no, suggested-field-hints=248/);
assert.match(report, /Commercial review worklist: passed tasks 248, P0=23, P1=97, uses-ground-truth=no/);
assert.match(report, /Identity result cache: passed read=yes, write=no, write-resolved=no, training=no/);
assert.match(report, /Public eval commercial claim allowed: no/);
assert.match(report, /Feedback retention enabled: no/);
assert.match(report, /Approved-memory reuse enabled: no/);
assert.match(report, /short-lived duplicate-image fast path and is not approved memory or a training table/);
assert.match(report, /cache hits skip recognition, retrieval, and vision provider calls/);
assert.match(report, /Data API for service_role only/);
assert.match(report, /OWS Fallback Status/);
assert.match(report, /Only mock_b_end is configured/);
assert.match(report, /Skipped smoke reports are explicit missing-validation evidence/);
assert.match(report, /label those candidates before accuracy evaluation/);
assert.match(report, /This generated report does not execute test commands/);
assert.doesNotMatch(report, /commercial acceptance passed/i);
assert.doesNotMatch(report, /95% achieved/i);

console.log("delivery report tests passed");
