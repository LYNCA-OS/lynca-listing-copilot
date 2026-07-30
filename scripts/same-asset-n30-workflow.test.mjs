import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/same-asset-n30.yml", import.meta.url), "utf8");

function job(name, nextName = null) {
  const startNeedle = `  ${name}:\n`;
  const start = workflow.indexOf(startNeedle);
  assert.notEqual(start, -1, `${name} job is missing`);
  const end = nextName ? workflow.indexOf(`  ${nextName}:\n`, start + startNeedle.length) : workflow.length;
  assert.notEqual(end, -1, `${nextName} job is missing`);
  return workflow.slice(start, end);
}

function ordered(haystack, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const next = haystack.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing ${needle}`);
    assert.ok(next > cursor, `${label}: ${needle} is out of order`);
    cursor = next;
  }
}

const binding = job("bind-public-release", "preflight");
const preflight = job("preflight", "consume-authorization");
const consumption = job("consume-authorization", "n30");
const n30 = job("n30");
const n30Header = n30.slice(0, n30.indexOf("    steps:\n"));

assert.deepEqual(
  [...workflow.matchAll(/^  ([a-z0-9-]+):$/gm)].map((match) => match[1]),
  ["bind-public-release", "preflight", "consume-authorization", "n30"]
);

assert.doesNotMatch(binding, /secrets\.|contents:\s*write|environment:/);
assert.match(binding, /test "\$DISPATCH_REF" = "refs\/heads\/main"/);
assert.match(binding, /DISPATCH_SHA:\s*\$\{\{ github\.sha \}\}/);
assert.match(binding, /test "\$EXPECTED_GIT_SHA" = "\$DISPATCH_SHA"/);
assert.match(binding, /public production release without credentials/);
assert.match(binding, /contents:\s*read/);
assert.match(binding, /persist-credentials:\s*false/);
assert.match(binding, /Prove the N30 contract without production credentials/);
assert.match(binding, /N30_CONSUMPTION_RULESET_ID:\s*"20036840"/);
assert.match(binding, /N30 immutable consumption tags/);
assert.match(binding, /\.enforcement == "active"/);
assert.match(binding, /\(\[\.rules\[\]\.type\] \| sort\) == \["deletion", "update"\]/);
assert.match(binding, /\.bypass_actors == \[\]/);

assert.match(preflight, /needs: bind-public-release/);
assert.match(preflight, /environment: Production/);
assert.match(preflight, /contents:\s*read/);
assert.doesNotMatch(preflight, /contents:\s*write|--execute|eval-same-asset-n30-/);
assert.match(preflight, /persist-credentials:\s*false/);
ordered(preflight, [
  "Verify immutable candidate SHA and deployment before any paid call",
  "Verify the cloud preparation provenance",
  "Freeze exactly one predeclared familiar Development asset",
  "Reverify canonical storage without enqueue, OCR, or Provider",
  "Prove the production session before consuming authorization",
  "Seal the completed zero-paid preflight packet",
  "Upload the zero-paid preflight packet"
], "zero-paid preflight");
assert.match(preflight, /rm -f \/tmp\/same-asset-session-cookie\.txt/);
assert.doesNotMatch(preflight, /same-asset-session-cookie\.txt\s*\\?\n\s*\/tmp\/same-asset-n30-zero-paid-preflight/);

assert.match(consumption, /needs: \[bind-public-release, preflight\]/);
assert.match(consumption, /actions:\s*read/);
assert.match(consumption, /contents:\s*write/);
assert.doesNotMatch(consumption, /secrets\.|actions\/checkout|npm\s|environment:/);
assert.match(consumption, /only after the paid-ready handshake/);
assert.match(consumption, /actions\/runs\/\$GITHUB_RUN_ID\/artifacts/);
assert.match(consumption, /same-asset-n30-paid-ready-\$\{\{ inputs\.expected_git_sha \}\}-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
assert.match(consumption, /actions\/artifacts\/\$artifact_id\/zip/);
assert.match(consumption, /\.schema_version == "same-asset-n30-paid-ready-v2"/);
assert.match(consumption, /\.run_id == \$run and \.run_attempt == \$attempt/);
assert.match(consumption, /\.provider_calls == 0/);
assert.match(consumption, /actions\/runs\/\$GITHUB_RUN_ID\/attempts\/\$GITHUB_RUN_ATTEMPT\/jobs/);
assert.match(consumption, /\.name == "n30" and \.status == "in_progress"/);
assert.match(consumption, /PERMANENT_CONSUMPTION_REF="refs\/tags\/eval-same-asset-n30-\$\{EXPECTED_GIT_SHA\}"/);
assert.match(consumption, /CURRENT_RUN_AUTHORIZATION_REF="refs\/tags\/eval-same-asset-n30-\$\{EXPECTED_GIT_SHA\}-run-\$\{GITHUB_RUN_ID\}-attempt-\$\{GITHUB_RUN_ATTEMPT\}"/);
ordered(consumption, [
  '-f ref="$PERMANENT_CONSUMPTION_REF"',
  '.ref == $ref and .object.sha == $sha',
  '-f ref="$CURRENT_RUN_AUTHORIZATION_REF"',
  '.ref == $ref and .object.sha == $sha'
], "permanent lock then current-run credential");
assert.match(consumption, /same-asset-n30-authorization-receipt-v1/);
assert.match(consumption, /actor:\$actor,actor_id:\$actor_id,created_at:\$created_at/);
assert.match(consumption, /Persist the exact successful-consume receipt/);
assert.match(consumption, /AUTHORIZATION_RECEIPT_ARTIFACT/);

assert.match(n30, /needs: \[bind-public-release, preflight\]/);
assert.doesNotMatch(n30, /needs:.*consume-authorization/);
assert.match(n30Header, /contents:\s*read/);
assert.doesNotMatch(n30Header, /secrets\.|contents:\s*write/);
assert.match(n30, /persist-credentials:\s*false/);
ordered(n30, [
  "Download the completed zero-paid preflight packet",
  "Reauthenticate immediately before the authorized paid run",
  "Validate the exact N30 plan without Provider calls",
  "Verify the paid-call authorization secret before paid-ready",
  "Publish the paid-ready handshake after every zero-paid check",
  "Expose only the non-secret paid-ready handshake",
  "Wait for and verify the late-bound exact-SHA authorization",
  "Download and validate the successful-consume receipt",
  "Bind the authorization receipt to this run attempt",
  "Run the predeclared sequential N30"
], "authorized N30");
assert.match(n30, /provider_calls:0/);
assert.match(n30, /PAID_READY_ARTIFACT:\s*same-asset-n30-paid-ready-\$\{\{ inputs\.expected_git_sha \}\}-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
assert.match(n30, /RUN_AUTHORIZATION_TAG:\s*eval-same-asset-n30-\$\{\{ inputs\.expected_git_sha \}\}-run-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
assert.match(n30, /schema_version:"same-asset-n30-paid-ready-v2"/);
assert.match(n30, /run_attempt:\$run_attempt/);
const authorizationWait = n30.slice(
  n30.indexOf("Wait for and verify the late-bound exact-SHA authorization"),
  n30.indexOf("Run the predeclared sequential N30")
);
assert.match(authorizationWait, /git\/ref\/tags\/\$RUN_AUTHORIZATION_TAG/);
assert.match(authorizationWait, /actions\/runs\/\$GITHUB_RUN_ID\/attempts\/\$GITHUB_RUN_ATTEMPT\/jobs/);
assert.match(authorizationWait, /\.name == "consume-authorization"/);
assert.match(authorizationWait, /consume_status" = "completed"/);
assert.match(authorizationWait, /test "\$consume_conclusion" = "success"/);
assert.ok(
  authorizationWait.indexOf('test "$consume_conclusion" = "success"')
    < authorizationWait.indexOf('git\/ref\/tags\/$PERMANENT_CONSUMPTION_TAG'.replaceAll('\\/', '/')),
  "a tag can authorize paid work only after the consume job completed successfully"
);
assert.match(authorizationWait, /git\/ref\/tags\/\$PERMANENT_CONSUMPTION_TAG/);
assert.doesNotMatch(
  authorizationWait,
  /git\/ref\/tags\/eval-same-asset-n30-\$\{EXPECTED_GIT_SHA\}/,
  "a second dispatch must not treat the historical permanent SHA lock as current-run authorization"
);
const authorizationTag = (runId, runAttempt) => `eval-same-asset-n30-${"a".repeat(40)}-run-${runId}-attempt-${runAttempt}`;
const paidReadyArtifact = (runId, runAttempt) => `same-asset-n30-paid-ready-${"a".repeat(40)}-${runId}-attempt-${runAttempt}`;
assert.notEqual(authorizationTag("123", "1"), authorizationTag("123", "2"), "attempt 1 authorization must not authorize attempt 2");
assert.notEqual(paidReadyArtifact("123", "1"), paidReadyArtifact("123", "2"), "attempt 1 handshake must not authorize attempt 2");
assert.doesNotMatch(consumption, /CURRENT_RUN_AUTHORIZATION_REF="refs\/tags\/eval-same-asset-n30-\$\{EXPECTED_GIT_SHA\}-run-\$\{GITHUB_RUN_ID\}"/);
assert.doesNotMatch(n30, /RUN_AUTHORIZATION_TAG:\s*eval-same-asset-n30-\$\{\{ inputs\.expected_git_sha \}\}-run-\$\{\{ github\.run_id \}\}\s*$/m);
const paidReadyOffset = n30.indexOf("Publish the paid-ready handshake after every zero-paid check");
assert.ok(n30.indexOf("LAUNCH_GATE_EVAL_SECRET", n30.indexOf("Verify the paid-call authorization secret before paid-ready")) < paidReadyOffset);
assert.equal((preflight.match(/--execute/g) || []).length, 0);
assert.equal((n30.match(/--execute/g) || []).length, 1);

const officialActionPins = new Map([
  ["actions/checkout", { sha: "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09", version: "v5" }],
  ["actions/setup-node", { sha: "a0853c24544627f65ddf259abe73b1d18a591444", version: "v5" }],
  ["actions/download-artifact", { sha: "634f93cb2916e3fdff6788551b99b062d0335ce0", version: "v5" }],
  ["actions/upload-artifact", { sha: "b7c566a772e6b6bfb58ed0dc250532a479d7789f", version: "v6" }]
]);
const officialActionUses = [...workflow.matchAll(
  /uses:\s+(actions\/(?:checkout|setup-node|download-artifact|upload-artifact))@([^\s#]+)\s+#\s+(v\d+)/g
)];
assert.equal(officialActionUses.length, 13);
for (const [, action, sha, version] of officialActionUses) {
  assert.deepEqual({ sha, version }, officialActionPins.get(action), `${action} must use its verified immutable release commit`);
}
for (const action of officialActionPins.keys()) {
  assert.doesNotMatch(workflow, new RegExp(`uses: ${action}@v\\d+(?:\\s|$)`));
}

const secretReferences = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
assert.deepEqual(secretReferences.sort(), [
  "LAUNCH_GATE_EVAL_SECRET",
  "LAUNCH_GATE_EVAL_SECRET",
  "METAVERSE_PASSWORD",
  "METAVERSE_PASSWORD",
  "METAVERSE_USERNAME",
  "METAVERSE_USERNAME",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_AUTOMATION_BYPASS_SECRET"
].sort());

console.log("same asset N30 workflow security contract tests passed");
