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
    AGNES_REAL_PHOTO_PILOT_OUT: realPhotoPilotPath
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
assert.match(report, /Public eval commercial claim allowed: no/);
assert.match(report, /Feedback retention enabled: no/);
assert.match(report, /Approved-memory reuse enabled: no/);
assert.match(report, /OWS Fallback Status/);
assert.match(report, /Only mock_b_end is configured/);
assert.match(report, /Skipped smoke reports are explicit missing-validation evidence/);
assert.match(report, /label those candidates before accuracy evaluation/);
assert.match(report, /This generated report does not execute test commands/);
assert.doesNotMatch(report, /commercial acceptance passed/i);
assert.doesNotMatch(report, /95% achieved/i);

console.log("delivery report tests passed");
