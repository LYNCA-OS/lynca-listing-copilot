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

const report = await createCommercialReadinessReport({
  datasetPath,
  agnesSmokePath: smokePath,
  env: {
    BRAVE_SMOKE_REPORT_PATH: join(tmp, "brave-smoke.json"),
    EBAY_SMOKE_REPORT_PATH: join(tmp, "ebay-smoke.json"),
    OWS_SMOKE_REPORT_PATH: join(tmp, "ows-smoke.json"),
    EBAY_IMAGE_CANDIDATES_OUT: ebayCandidatesPath,
    AGNES_PUBLIC_CARD_EVAL_OUT: publicCardEvalPath
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

const text = formatCommercialReadinessReport(report);
assert.match(text, /Commercial readiness audit blocked/);
assert.match(text, /held_out_commercial_assets: 0/);
assert.match(text, /commercial_acceptance_gate: blocked/);
assert.match(text, /agnes_smoke_status: passed_with_limitations/);
assert.match(text, /external_retrieval_smoke_statuses: brave=missing, ebay_browse=missing, openai_web_search=missing/);
assert.match(text, /ebay_image_candidates: skipped 0\/300/);
assert.match(text, /public_card_reference_eval: completed exact 296\/300 \(0.986667\), trusted 300\/300 \(1\)/);
assert.match(text, /gpt_implicit_default: blocked_by_policy/);
assert.match(text, /publishing_destination: blocked/);

console.log("commercial readiness audit tests passed");
