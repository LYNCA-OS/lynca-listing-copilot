import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [login, index, app, spec, workflow] = await Promise.all([
  readFile(new URL("../app/login.html", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8"),
  readFile(new URL("../e2e/production-writer-journey.spec.mjs", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/production-writer-journey.yml", import.meta.url), "utf8")
]);

for (const testId of ["login-username", "login-password", "login-submit"]) {
  assert.match(login, new RegExp(`data-testid="${testId}"`));
}
for (const testId of ["image-upload-input", "start-recognition", "writer-journey-status"]) {
  assert.match(index, new RegExp(`data-testid="${testId}"`));
}
for (const testId of ["writer-title-result", "writer-title-input", "accept-writer-title", "writer-persistence-status"]) {
  assert.match(app, new RegExp(`data-testid="${testId}"`));
}

assert.match(spec, /\/api\/health/);
assert.match(spec, /\/api\/csm-listing-title/);
assert.match(spec, /\/api\/csm-resolution-view/);
assert.doesNotMatch(spec, /\/api\/v4\/health/);
assert.doesNotMatch(spec, /startButton\.click\(\)/);
assert.match(spec, /getByTestId\("start-recognition"\)\)\.toBeHidden/);
assert.match(spec, /\/api\/v4\/listing-feedback/);
assert.match(spec, /v4_persistence\?\.transaction\?\.saved/);
assert.match(spec, /provider_attempt_number[\s\S]*?\.toBe\(1\)/);
assert.match(spec, /provider_retry_count[\s\S]*?\.toBe\(0\)/);
assert.match(spec, /test\.setTimeout\(15 \* 60 \* 1000\)/,
  "two sequential hard-capped provider attempts must fit inside the live test budget");
assert.match(spec, /composer\?\.trace_reliable[\s\S]*?\.toBe\(true\)/);
assert.match(spec, /composer\?\.recomposed_matches_stored[\s\S]*?\.toBe\(true\)/);
assert.match(spec, /panelTitleSha256 === generatedTitleSha256/);
assert.match(spec, /expectedTitleSha256: panelTitleSha256/,
  "feedback must bind directly to the title captured before opening Glass Box");
assert.match(spec, /titleSha256\(titleAfterPanel\) === generatedTitleSha256/);
assert.doesNotMatch(spec, /expect\((?:titleBeforePanel|titleAfterPanel|resolutionView\?\.composer\?\.stored_title)/,
  "title matchers can print private titles into Actions logs");
assert.match(spec, /details\.glass-box/);
assert.match(spec, /resolutionRequests\.every\(\(request\) => request\.method === "GET"\)/);
assert.match(spec, /accuracy_claim: null/);
assert.match(spec, /field_ground_truth_available: false/);
assert.match(spec, /LIVE_CONTRACT_RECEIPT_ONLY/);
assert.match(spec, /writer-journey-cases-v2/);
assert.match(spec, /WRITER_JOURNEY_CASES_MANIFEST/);
assert.match(spec, /\["NON_TCG", "TCG"\]/);
assert.match(spec, /entry\.files\[0\]\?\.role !== "front_original"/);
assert.match(spec, /entry\.files\[1\]\?\.role !== "back_original"/);
assert.match(spec, /resolution_view_schema/);
assert.match(spec, /csm_owner_versions/);
assert.match(spec, /VERSION_RESOLVER_MISMATCH/);
assert.match(spec, /VERSION_COMPOSER_MISMATCH/);
assert.match(spec, /waitForRequest/);
assert.match(spec, /requestExchangeReceipt/);
assert.match(spec, /persistenceRequest === responseRequest/,
  "the intercepted request and response must be the same Playwright exchange, not identical retries");
assert.match(spec, /responsePayload\?\.feedback_submission_id === requestPayload\.feedback_submission_id/);
assert.match(spec, /requestPayload\?\.action === "ACCEPT"/);
assert.match(spec, /feedback_exchange_bound/);
assert.match(spec, /feedback_session_matches/);
assert.match(spec, /feedback_request_title_matches/);
assert.match(spec, /feedback_response_title_matches/);
assert.match(spec, /titleEvidenceReceipt/);
assert.doesNotMatch(spec, /title_sha256:\s*generatedTitleSha256/,
  "the title hash is comparison-only and must not enter uploaded evidence");
assert.match(spec, /!titleArtifact\.includes\("title_sha256"\)/);
assert.match(spec, /!titleArtifact\.includes\("writer_final_title"\)/);
assert.match(spec, /!titleArtifact\.includes\("stored_title"\)/);
assert.match(spec, /error_code = errorCode/);
assert.doesNotMatch(spec, /evidence\.error\s*=/);
assert.doesNotMatch(spec, /String\(error\?\.message \|\| error\)/);
assert.match(spec, /PRIVATE EXPECTED TITLE/,
  "the offline counterexample must prove unsafe matcher text is not serialized");
assert.match(spec, /cookieDomainMatches/);
assert.match(spec, /cookiePathMatches/);
assert.match(spec, /productionOrigin = "https:\/\/listing\.lyncafei\.team"/);
assert.doesNotMatch(spec, /getByTestId\("writer-persistence-status"\).*toBeVisible/);
assert.match(spec, /deployment_id/);
assert.match(spec, /WRITER_JOURNEY_INITIAL_STORAGE_STATE/,
  "a storage state may be used only after cookies are matched to the canonical production URL");
assert.match(spec, /deployment\?\.environment[\s\S]*?\.toBe\("production"\)/,
  "ordinary Preview must not masquerade as a production-target candidate");
assert.equal([...spec.matchAll(/baseURL: baseUrl/g)].length, 2, "both browser contexts must use the normalized production base URL");
assert.doesNotMatch(spec, /\{\s*baseURL\s*[,}]/, "undefined baseURL shorthand must never reach production E2E");
for (const id of ["request_ids", "asset_ids", "batch_ids", "job_ids", "session_ids"]) {
  assert.match(spec, new RegExp(id));
}
assert.doesNotMatch(spec, /launch_ready\s*=/i);
assert.doesNotMatch(spec, /update.*launch_ready/i);
assert.match(workflow, /METAVERSE_USERNAME: \$\{\{ secrets\.METAVERSE_USERNAME \}\}/);
assert.match(workflow, /METAVERSE_PASSWORD: \$\{\{ secrets\.METAVERSE_PASSWORD \}\}/);
assert.match(workflow, /name: Run real production Writer Journey[\s\S]*?METAVERSE_USERNAME:[\s\S]*?METAVERSE_PASSWORD:/,
  "writer credentials must be scoped to the live browser step, not npm install or Storage materialization");
assert.equal([...workflow.matchAll(/METAVERSE_USERNAME: \$\{\{ secrets\.METAVERSE_USERNAME \}\}/g)].length, 2);
assert.equal([...workflow.matchAll(/METAVERSE_PASSWORD: \$\{\{ secrets\.METAVERSE_PASSWORD \}\}/g)].length, 2);
assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
assert.match(workflow, /materialize-writer-journey-source\.mjs/);
assert.match(workflow, /WRITER_JOURNEY_CASES_MANIFEST: \$\{\{ steps\.source\.outputs\.cases_manifest \}\}/);
assert.match(workflow, /writer-journey-cases-v2\.json/);
assert.match(workflow, /Materialize fixed NON_TCG and TCG cases/);
assert.match(workflow, /--grep @offline/);
assert.match(workflow, /WRITER_JOURNEY_EXPECTED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
assert.match(workflow, /test "\$UPSTREAM_BRANCH" = "main"/);
assert.match(workflow, /git rev-parse origin\/main/);
assert.doesNotMatch(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /LAUNCH_GATE_EVAL_SECRET/);
assert.doesNotMatch(spec, /launch-gate-source-images/);
assert.match(spec, /expect\(health\?\.deployment\?\.git_commit_sha[\s\S]*?\.toBe\(expectedSha\)/);
assert.match(spec, /expect\(finalHealth\?\.deployment\?\.git_commit_sha[\s\S]*?\.toBe\(expectedSha\)/);
assert.doesNotMatch(spec, /recordHar|\.tracing\.|failure\.png|journey\.har/);
assert.doesNotMatch(workflow, /test-results\/production-writer-journey/);
assert.match(workflow, /if: failure\(\)/);

console.log("production writer journey contract tests passed");
