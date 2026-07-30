import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const [login, index, app, spec, config, workflow] = await Promise.all([
  readFile(new URL("../app/login.html", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8"),
  readFile(new URL("../e2e/production-writer-journey.spec.mjs", import.meta.url), "utf8"),
  readFile(new URL("../playwright.config.mjs", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/production-writer-journey.yml", import.meta.url), "utf8")
]);

const pinnedActions = Object.freeze({
  checkout: "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
  setupNode: "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
  uploadArtifact: "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  downloadArtifact: "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
  attest: "actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d"
});

for (const testId of ["login-username", "login-password", "login-submit"]) {
  assert.match(login, new RegExp(`data-testid="${testId}"`));
}
for (const testId of ["image-upload-input", "start-recognition", "writer-journey-status"]) {
  assert.match(index, new RegExp(`data-testid="${testId}"`));
}
for (const testId of ["writer-title-result", "writer-title-input", "accept-writer-title", "writer-persistence-status"]) {
  assert.match(app, new RegExp(`data-testid="${testId}"`));
}

assert.match(spec, /\/api\/v4\/listing-feedback/);
assert.match(spec, /v4_persistence\?\.transaction\?\.saved/);
assert.match(spec, /e2eEditedTitle\(title\)/);
assert.match(spec, /status, "the Journey must exercise EDIT rather than ACCEPT"/);
assert.match(spec, /training_eligible, "administrator Journey output must never enter training"/);
assert.match(spec, /production_promotion_eligible, "administrator Journey output must never be promoted"/);
assert.match(spec, /feedback_data_use, "the embedded writer feedback must remain admin-test only"/);
assert.match(spec, /admin_test_persistence_proof/);
assert.match(spec, /PostgreSQL must prove the administrator edit stayed outside replay authority/);
assert.match(spec, /active_writer_final_replay_source_count/);
assert.match(spec, /active_admin_test_replay_for_image_count/);
assert.match(spec, /image_generation_hash_verified/);
assert.match(spec, /admin_test_persistence_verified:\s*true/);
assert.match(spec, /writer_final_replay_excluded:\s*true/);
assert.match(spec, /\/api\/v4\/listing-job-status\?job_ids=/);
assert.match(spec, /worker_execution/);
assert.match(spec, /\/api\/v4\/listing-session-status\?recognition_session_id=/);
assert.match(spec, /writer_feedback_event_id/);
assert.match(spec, /read_after_write:\s*true/);
assert.doesNotMatch(spec, /getByTestId\("writer-persistence-status"\).*toBeVisible/);
assert.match(spec, /deployment_id/);
for (const field of [
  "production-writer-journey-evidence-v3",
  "deployment_git_commit_sha",
  "expected_git_commit_sha",
  "exact_sha_match",
  "required_stage_ids",
  "all_required_stages_passed",
  "launch_ready_mutated"
]) {
  assert.match(spec, new RegExp(field));
}
for (const field of [
  "repository",
  "workflow_ref",
  "run_id",
  "run_attempt",
  "event",
  "source_ref",
  "production_base_url"
]) {
  assert.match(spec, new RegExp(`${field}:`));
}
for (const environmentName of [
  "GITHUB_REPOSITORY",
  "GITHUB_WORKFLOW_REF",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_EVENT_NAME",
  "WRITER_JOURNEY_SOURCE_REF"
]) {
  assert.match(spec, new RegExp(`requiredEnv\\("${environmentName}"\\)`));
}
const expectedRequiredStages = ["health", "real_image_materialization", "login", "upload", "enqueue", "status", "l2_ready", "accept_edit", "persistence"];
for (const stage of expectedRequiredStages) {
  assert.match(spec, new RegExp(`"${stage}"`));
}
const requiredStageBlock = spec.match(/const requiredStageIds = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || "";
assert.deepEqual(
  [...requiredStageBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
  expectedRequiredStages,
  "the launch gate consumes one exact required-stage contract"
);
for (const field of ["safe_to_upload", "har_uploaded", "trace_uploaded", "sensitive_value_scan_passed"]) {
  assert.match(spec, new RegExp(`${field}:`));
}
assert.match(spec, /launch_ready_mutated:\s*false/);
assert.equal([...spec.matchAll(/baseURL: baseUrl/g)].length, 2, "both browser contexts must use the normalized production base URL");
assert.doesNotMatch(spec, /\{\s*baseURL\s*[,}]/, "undefined baseURL shorthand must never reach production E2E");
for (const id of ["request_ids", "asset_ids", "batch_ids", "job_ids", "session_ids"]) {
  assert.match(spec, new RegExp(id));
}
assert.doesNotMatch(spec, /launch_ready\s*=/i);
assert.doesNotMatch(spec, /update.*launch_ready/i);
assert.doesNotMatch(spec, /recordHar|tracing\.(?:start|stop)/, "authenticated HAR and trace capture must remain disabled");
assert.match(spec, /mask:\s*\[sensitiveControls\]/, "authenticated failure screenshots must mask editable controls");
assert.match(spec, /writeSafeFailureScreenshot\(journeyPage\)/, "the credential-bearing login page must never be screenshotted");
assert.doesNotMatch(spec, /writeSafeFailureScreenshot\(loginPage\)/);
assert.match(config, /screenshot:\s*"off"/);
assert.match(config, /trace:\s*"off"/);

assert.equal((workflow.match(new RegExp(pinnedActions.checkout, "g")) || []).length, 2);
assert.equal((workflow.match(new RegExp(pinnedActions.setupNode, "g")) || []).length, 2);
assert.equal((workflow.match(new RegExp(pinnedActions.uploadArtifact, "g")) || []).length, 2);
assert.equal((workflow.match(new RegExp(pinnedActions.downloadArtifact, "g")) || []).length, 1);
assert.equal((workflow.match(new RegExp(pinnedActions.attest, "g")) || []).length, 1);
assert.doesNotMatch(workflow, /uses:\s*actions\/(?:checkout|setup-node|upload-artifact)@v\d+/);
for (const guardedPath of [
  "api/v4/listing-feedback.js",
  "lib/listing/v4/session/session-store.mjs",
  "scripts/admin-test-writer-final-replay-contract.test.mjs",
  "scripts/admin-test-writer-final-replay.pg17.test.mjs",
  "supabase/migrations/20260730120000_admin_test_writer_final_replay_isolation_v1.sql"
]) {
  assert.match(workflow, new RegExp(guardedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(workflow, /expected_git_sha:[\s\S]*required:\s*true/);
assert.match(workflow, /EXPECTED_GIT_SHA:.*workflow_run\.head_sha.*inputs\.expected_git_sha/);
assert.match(workflow, /EVENT_REF:\s*\$\{\{ github\.ref \}\}/);
assert.match(workflow, /EVENT_SHA:\s*\$\{\{ github\.sha \}\}/);
assert.match(workflow, /test "\$EVENT_REF" = "refs\/heads\/main"/);
assert.match(workflow, /gh api "\/repos\/\$CURRENT_REPOSITORY\/commits\/main" --jq \.sha/);
assert.match(workflow, /test "\$EXPECTED_GIT_SHA" = "\$live_main_sha"/);
assert.match(workflow, /test "\$EXPECTED_GIT_SHA" = "\$EVENT_SHA"/);
assert.match(workflow, /ref:\s*\$\{\{ env\.EXPECTED_GIT_SHA \}\}/);
assert.match(workflow, /git fetch --no-tags --depth=1 origin refs\/heads\/main:refs\/remotes\/origin\/main/);
assert.match(workflow, /git rev-parse refs\/remotes\/origin\/main/);
assert.match(workflow, /WRITER_JOURNEY_EXPECTED_GIT_SHA:\s*\$\{\{ env\.EXPECTED_GIT_SHA \}\}/);
assert.match(workflow, /production-writer-journey-evidence-\$\{\{ env\.EXPECTED_GIT_SHA \}\}/);

const jobEnv = workflow.slice(workflow.indexOf("    env:\n", workflow.indexOf("  writer-journey:")), workflow.indexOf("    steps:", workflow.indexOf("  writer-journey:")));
for (const name of ["METAVERSE_USERNAME", "METAVERSE_PASSWORD", "LAUNCH_GATE_EVAL_SECRET"]) {
  assert.doesNotMatch(jobEnv, new RegExp(name), `${name} must not be exposed at job scope`);
  assert.equal((workflow.match(new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`, "g")) || []).length, 1);
}
assert.match(workflow, /id:\s*artifact_safety[\s\S]*safe_to_upload[\s\S]*har_uploaded[\s\S]*trace_uploaded[\s\S]*sensitive_value_scan_passed/);
assert.doesNotMatch(workflow, /test-results\/production-writer-journey|journey\.har|failure-trace\.zip/);
assert.match(workflow, /artifacts\/production-writer-journey\/evidence\.json[\s\S]*artifacts\/production-writer-journey\/failure\.png/);

const signerJob = workflow.slice(workflow.indexOf("  attest-passing-evidence:"));
assert.match(signerJob, /needs:\s*writer-journey/);
assert.match(signerJob, /if:\s*needs\.writer-journey\.result == 'success'/);
assert.match(signerJob, /environment:\s*launch-attestation/);
assert.match(signerJob, /permissions:\s*\n\s*contents:\s*read\s*\n\s*id-token:\s*write\s*\n\s*attestations:\s*write\s*\n\s*artifact-metadata:\s*write/);
assert.doesNotMatch(signerJob, /npm\s|playwright|METAVERSE_|LAUNCH_GATE_EVAL_SECRET/);
assert.match(signerJob, /subject-path:\s*attestation-subject\/evidence\.json/);
assert.match(workflow, /WRITER_JOURNEY_SOURCE_REF:\s*refs\/heads\/main/);
assert.match(workflow, /production-writer-journey-evidence-v3/);

const validationBlock = workflow.match(
  /- name: Validate the immutable production target[\s\S]*?\n        run: \|\n([\s\S]*?)\n      - uses:/
)?.[1]?.replace(/^ {10}/gm, "");
assert.ok(validationBlock, "the exact pre-checkout target validation script must remain extractable");
const targetTestDirectory = await mkdtemp(join(tmpdir(), "writer-journey-target-"));
try {
  const fakeGh = join(targetTestDirectory, "gh");
  const githubOutput = join(targetTestDirectory, "github-output");
  await writeFile(fakeGh, "#!/bin/sh\nprintf '%s\\n' \"$FAKE_LIVE_MAIN_SHA\"\n", { mode: 0o700 });
  await chmod(fakeGh, 0o700);
  async function runDispatchTarget(overrides = {}) {
    return execFileAsync("bash", ["-euo", "pipefail", "-c", validationBlock], {
      env: {
        ...process.env,
        PATH: `${targetTestDirectory}:${process.env.PATH}`,
        EXPECTED_GIT_SHA: "a".repeat(40),
        EVENT_NAME: "workflow_dispatch",
        EVENT_REF: "refs/heads/main",
        EVENT_SHA: "a".repeat(40),
        TRIGGER_HEAD_BRANCH: "",
        TRIGGER_HEAD_REPOSITORY: "",
        CURRENT_REPOSITORY: "LYNCA-OS/lynca-listing-copilot",
        FAKE_LIVE_MAIN_SHA: "a".repeat(40),
        GITHUB_OUTPUT: githubOutput,
        ...overrides
      }
    });
  }
  await runDispatchTarget();
  await assert.rejects(() => runDispatchTarget({
    EXPECTED_GIT_SHA: "b".repeat(40),
    EVENT_SHA: "b".repeat(40)
  }));
  await assert.rejects(() => runDispatchTarget({ EVENT_REF: "refs/heads/feature" }));
  await assert.rejects(() => runDispatchTarget({ EVENT_SHA: "b".repeat(40) }));
  await assert.rejects(() => runDispatchTarget({ FAKE_LIVE_MAIN_SHA: "b".repeat(40) }));
} finally {
  await rm(targetTestDirectory, { recursive: true, force: true });
}

console.log("production writer journey contract tests passed");
