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
const dispatchGate = workflow.indexOf("Fail closed unless this dispatch targets the current main commit");
const setupNode = workflow.indexOf("actions/setup-node");
const schemaPreflight = workflow.indexOf("Fail closed unless the Track C production schema is ready");
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
assert.doesNotMatch(workflow, /\/api\/admin-apply-/, "code deploy must not invoke runtime migration routes");

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));
assert.equal(
  vercelConfig.git?.deploymentEnabled,
  false,
  "Git pushes and main merges must not bypass the explicit production deploy workflow"
);

console.log("production release boundary tests passed");
