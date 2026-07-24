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

assert.match(spec, /\/api\/v4\/listing-feedback/);
assert.match(spec, /v4_persistence\?\.transaction\?\.saved/);
assert.match(spec, /deployment_id/);
for (const id of ["request_ids", "asset_ids", "batch_ids", "job_ids", "session_ids"]) {
  assert.match(spec, new RegExp(id));
}
assert.doesNotMatch(spec, /launch_ready\s*=/i);
assert.doesNotMatch(spec, /update.*launch_ready/i);
assert.match(workflow, /METAVERSE_USERNAME: \$\{\{ secrets\.METAVERSE_USERNAME \}\}/);
assert.match(workflow, /METAVERSE_PASSWORD: \$\{\{ secrets\.METAVERSE_PASSWORD \}\}/);
assert.match(workflow, /LAUNCH_GATE_EVAL_SECRET: \$\{\{ secrets\.LAUNCH_GATE_EVAL_SECRET \}\}/);
assert.match(workflow, /if: failure\(\)/);

console.log("production writer journey contract tests passed");
