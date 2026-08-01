#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runtimeMigrationAuth } from "../lib/platform-admin-auth.mjs";

const adminSecret = "track-c-platform-admin-secret";
const adminRequest = {
  headers: { "x-lynca-platform-admin-secret": adminSecret }
};

assert.deepEqual(runtimeMigrationAuth(adminRequest, {
  LYNCA_PLATFORM_ADMIN_SECRET: adminSecret
}), {
  ok: false,
  statusCode: 403,
  error: "runtime_migrations_disabled",
  mode: ""
}, "runtime migration endpoints must be disabled by default");

assert.deepEqual(runtimeMigrationAuth(adminRequest, {
  LYNCA_PLATFORM_ADMIN_SECRET: adminSecret,
  LYNCA_RUNTIME_MIGRATIONS_ENABLED: "true",
  VERCEL_ENV: "production"
}), {
  ok: false,
  statusCode: 403,
  error: "runtime_migrations_disabled",
  mode: ""
}, "production must reject runtime migrations even when the rehearsal flag is set");

assert.equal(runtimeMigrationAuth(adminRequest, {
  LYNCA_PLATFORM_ADMIN_SECRET: adminSecret,
  LYNCA_RUNTIME_MIGRATIONS_ENABLED: "true",
  VERCEL_ENV: "preview"
}).ok, true, "an isolated non-production rehearsal requires both the explicit flag and admin secret");

assert.equal(runtimeMigrationAuth({ headers: {} }, {
  LYNCA_PLATFORM_ADMIN_SECRET: adminSecret,
  LYNCA_RUNTIME_MIGRATIONS_ENABLED: "true",
  VERCEL_ENV: "preview"
}).statusCode, 401, "the rehearsal flag must not replace platform-admin authentication");

const migrationRoutes = [
  "api/admin-apply-catalog-self-exclusion-migration.js",
  "api/admin-apply-sem-definition-migration.js",
  "api/admin-apply-v4-noncritical-persistence-migration.js",
  "api/admin-apply-v4-production-job-queue-migration.js",
  "api/admin-apply-v4-writer-export-migration.js",
  "api/admin-apply-v4-writer-ready-capacity-migration.js"
];
for (const route of migrationRoutes) {
  assert.match(
    readFileSync(route, "utf8"),
    /\bruntimeMigrationAuth\s*\(/,
    `${route} must fail closed through the shared runtime migration gate`
  );
}

const retiredVisualReviewRoutes = [
  "api/admin-visual-review-run.js",
  "api/admin-visual-review-session.js",
  "api/admin/visual-review/run.js",
  "api/admin/visual-review/session.js"
];
for (const route of retiredVisualReviewRoutes) {
  assert.equal(existsSync(route), false, `${route} was retired on main and must not be reintroduced`);
}

const workflow = readFileSync(".github/workflows/deploy-production.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const dispatchGate = workflow.indexOf("Fail closed unless this dispatch targets the current main commit");
const setupNode = workflow.indexOf("actions/setup-node");
const schemaPreflight = workflow.indexOf("Verify CSM persistence and global provider authority before deploy");
const preHookCommitGate = workflow.indexOf("Re-confirm the exact main commit before the deploy hook");
const vercelDeploy = workflow.indexOf("Trigger current main through the Vercel Deploy Hook");
assert.ok(dispatchGate >= 0, "production deployment must have an explicit dispatch gate");
assert.ok(setupNode > dispatchGate, "dispatch validation must run before release setup");
assert.ok(schemaPreflight > dispatchGate, "dispatch validation must run before production schema access");
assert.ok(preHookCommitGate > schemaPreflight, "current main must be re-read after tests and schema preflight");
assert.ok(vercelDeploy > preHookCommitGate, "the final commit gate must run immediately before the Vercel deploy hook");
assert.match(workflow, /test "\$DEFAULT_BRANCH" = "main"/);
assert.match(workflow, /test "\$DISPATCH_REF" = "refs\/heads\/main"/);
assert.match(workflow, /git fetch --no-tags --depth=1 origin main:refs\/remotes\/origin\/main/);
assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$DISPATCH_SHA"/);
assert.equal(
  [...workflow.matchAll(/node scripts\/check-csm-thin-production-readiness\.mjs/g)].length,
  2,
  "both predeploy and postdeploy gates must verify Registry, atomic persistence, and provider authority"
);
assert.match(workflow, /SUPABASE_URL: \$\{\{ vars\.SUPABASE_URL \}\}/);
assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
assert.match(workflow, /CSM_PERSISTENCE_ENABLED: "true"/);
assert.equal(
  [...workflow.matchAll(/V4_QUEUE_PUMP_DISABLED: "true"/g)].length,
  2,
  "both schema gates must require the retired V4 queue pump to stay disabled"
);
for (const flag of [
  "ENABLE_RECOGNITION_WORKER",
  "ENABLE_PADDLE_OCR_FIELD_VERIFIER",
  "ENABLE_VECTOR_RETRIEVAL",
  "ENABLE_VISUAL_VECTOR_RETRIEVAL",
  "ENABLE_QUERY_VISUAL_VECTOR_PREFLIGHT",
  "ENABLE_STORED_VISUAL_FEATURE_LOOKUP",
  "DATA_LOOP_PADDLE_OCR_DISPATCH_ENABLED",
  "DATA_LOOP_SIDECARS_ENABLED"
]) {
  assert.match(workflow, new RegExp(`${flag}: "false"`), `${flag} must be disabled at release`);
}
assert.doesNotMatch(
  workflow,
  /echo[^\n]*(?:SUPABASE_SERVICE_ROLE_KEY|\$SUPABASE_SERVICE_ROLE_KEY)/,
  "the release workflow must never print the service-role key"
);
assert.doesNotMatch(workflow, /\/api\/admin-apply-/, "code deploy must not invoke runtime migration routes");
assert.doesNotMatch(workflow, /google-github-actions|setup-gcloud|deploy-vision-ocr|Cloud Run/i);
assert.doesNotMatch(workflow, /listing-provider-status|writer-assisted-production-readiness/);
assert.match(workflow, /active_path === 'CSM_THIN_DIRECT'/);
assert.match(workflow, /h\.model === 'gpt-5\.6-luna'/);
assert.match(workflow, /h\.reasoning_effort === 'none'/);
assert.match(workflow, /scheduler_attempt_slots === 120/);
assert.match(workflow, /baseline_working_attempts === 43/);
assert.match(workflow, /pacer_estimated_tokens_per_second === 60000/);
assert.match(workflow, /pacer_burst_estimated_tokens === 65200/);
assert.match(workflow, /steady_reserved_attempts_per_minute === 679/);
assert.match(workflow, /effective_reserved_attempt_ceiling === 83/);
assert.match(workflow, /RETIRED_LISTING_EXECUTION_PATH/);
assert.match(workflow, /r\.code!=="missing_asset_id"/);
assert.equal(
  packageJson.scripts["vercel-build"],
  "node lib/listing/thin/csm-deployment-environment.mjs",
  "Vercel must fail the build before promotion when the actual deployment environment is unsafe"
);

const browserPreingest = readFileSync("api/listing-preingest.js", "utf8");
assert.doesNotMatch(
  browserPreingest,
  /\bwaitUntil\s*\(|\bprocessQueuedPreingestionOcrJobs\b/,
  "browser pre-ingestion must only persist durable OCR jobs; the independent worker consumes them"
);
const vercelConfig = readFileSync("vercel.json", "utf8");
assert.doesNotMatch(
  vercelConfig,
  /"path"\s*:\s*"\/api\/v4\/listing-preingest-worker"[\s\S]*?"schedule"\s*:\s*"\* \* \* \* \*"/,
  "the active thin deployment must not schedule the retired OCR worker"
);
assert.doesNotMatch(
  vercelConfig,
  /"path"\s*:\s*"\/api\/v4\/listing-job-pump"[\s\S]*?"schedule"\s*:\s*"\* \* \* \* \*"/,
  "the active thin deployment must not schedule the retired V4 queue pump"
);
assert.match(
  vercelConfig,
  /"path"\s*:\s*"\/api\/listing-storage-retention-cleanup"[\s\S]*?"schedule"\s*:\s*"0 9 \* \* \*"/,
  "storage retention remains an active data-lifecycle responsibility"
);

for (const runtimeModule of [
  "api/listing-provider-status.js",
  "lib/listing/readiness/workflow-readiness-audit.mjs"
]) {
  assert.doesNotMatch(
    readFileSync(runtimeModule, "utf8"),
    /from\s+["'][^"']*scripts\//,
    `${runtimeModule} must not depend on CLI scripts that Vercel can omit from the function bundle`
  );
}

console.log("production release boundary tests passed");
