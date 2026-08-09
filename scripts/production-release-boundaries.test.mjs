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
  "api/admin-apply-sem-definition-migration.js"
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
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const health = readFileSync("api/health.js", "utf8");
for (const [file, minimumRedirects] of Object.entries({
  "lib/supabase-rest.mjs": 1,
  "lib/listing/v4/session/supabase-rest.mjs": 1,
  "lib/listing/thin/csm-provider-admission-authority.mjs": 2,
  "lib/listing/thin/csm-supabase-writer.mjs": 9,
  "lib/supabase-feedback.mjs": 2,
  "lib/listing/storage/storage-retention.mjs": 3,
  "lib/listing/storage/storage-verification-store.mjs": 2,
  "lib/listing/storage/supabase-image-storage.mjs": 5,
  "lib/listing/v4/export/writer-batch-export.mjs": 2,
  "lib/tenant/access.mjs": 1,
  "lib/tenant/members.mjs": 1,
  "scripts/check-csm-thin-production-readiness.mjs": 2
})) {
  const source = readFileSync(file, "utf8");
  const fetchCount = [...source.matchAll(/fetchImpl\s*\(/g)].length;
  const redirectCount = [...source.matchAll(/redirect:\s*["']error["']/g)].length;
  assert.ok(redirectCount >= fetchCount && redirectCount >= minimumRedirects,
    `${file} must fail closed on every service-key fetch redirect`);
}
const writerJourneyMaterializer = readFileSync("scripts/materialize-writer-journey-source.mjs", "utf8");
assert.match(writerJourneyMaterializer,
  /headers:\s*supabaseServiceHeaders\([^\n]+\),\s*\n\s*redirect:\s*"error"/,
  "Writer Journey signing must not redirect its server-only apikey");
const dispatchGate = workflow.indexOf("Fail closed unless this dispatch targets the current main commit");
const setupNode = workflow.indexOf("actions/setup-node");
const schemaPreflight = workflow.indexOf("Verify CSM persistence and global provider authority before deploy");
const immutableReleaseGate = workflow.indexOf("Re-confirm the exact main commit before building the immutable release");
const vercelProjectBinding = workflow.indexOf("Bind the canonical Vercel project from tracked service context");
const vercelDeploy = workflow.indexOf("Build and deploy the exact dispatched checkout");
const prepromotionHealth = workflow.indexOf("Verify the immutable deployment before production promotion");
const vercelPromote = workflow.indexOf("Promote the verified immutable deployment to production");
const productionHealth = workflow.indexOf("Wait for the exact CSM thin main commit to reach production");
assert.ok(dispatchGate >= 0, "production deployment must have an explicit dispatch gate");
assert.ok(setupNode > dispatchGate, "dispatch validation must run before release setup");
assert.ok(schemaPreflight > dispatchGate, "dispatch validation must run before production schema access");
assert.ok(immutableReleaseGate > schemaPreflight, "current main must be re-read after tests and schema preflight");
assert.ok(vercelProjectBinding > immutableReleaseGate, "the canonical Vercel identity must come from tracked service context");
assert.ok(vercelDeploy > vercelProjectBinding, "the immutable build must follow the final commit and project gates");
assert.ok(prepromotionHealth > vercelDeploy, "the immutable deployment must be healthy before promotion");
assert.ok(vercelPromote > prepromotionHealth, "production promotion must follow immutable deployment health");
assert.ok(productionHealth > vercelPromote, "the promoted production alias must be verified independently");
assert.match(workflow, /test "\$DEFAULT_BRANCH" = "main"/);
assert.match(workflow, /test "\$DISPATCH_REF" = "refs\/heads\/main"/);
assert.match(workflow, /git fetch --no-tags --depth=1 origin main:refs\/remotes\/origin\/main/);
assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$DISPATCH_SHA"/);
assert.doesNotMatch(workflow, /VERCEL_DEPLOY_HOOK_URL|Deploy Hook|vercel-deploy-hook/,
  "a branch-reading deploy hook can race with main and must not mutate production");
assert.match(workflow, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
assert.equal(
  [...workflow.matchAll(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/g)].length,
  3,
  "build, prepromotion health, and promotion must authenticate independently"
);
const immutableBuildStep = workflow.slice(vercelDeploy, prepromotionHealth);
assert.match(immutableBuildStep, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/,
  "encrypted provider credentials must be injected into the local prebuild explicitly");
assert.match(immutableBuildStep, /SUPABASE_URL: \$\{\{ vars\.SUPABASE_URL \}\}/);
assert.match(immutableBuildStep,
  /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
for (const name of ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  assert.match(immutableBuildStep, new RegExp(`test -n "\\$${name}"`),
    `${name} must fail closed before the immutable build`);
}
assert.match(workflow, /active-service-context\.json/);
assert.match(workflow, /VERCEL_SCOPE_SLUG=\$\{scopeSlug\}/);
assert.match(workflow, /VERCEL_ORG_ID=\$\{orgId\}/);
assert.match(workflow, /VERCEL_PROJECT_ID=\$\{projectId\}/);
assert.equal(
  [...workflow.matchAll(/--scope "\$VERCEL_SCOPE_SLUG"/g)].length,
  4,
  "every scope-aware Vercel control must bind the canonical tenant instead of using the CLI default scope"
);
assert.doesNotMatch(workflow, /--scope "leon-using-s-projects"/,
  "production controls must never fall back to the forbidden Vercel scope");
assert.match(workflow,
  /vercel@54\.14\.5 pull --yes --environment=production \\\n\s*--scope "\$VERCEL_SCOPE_SLUG"/,
  "project settings must be pulled from the canonical tenant");
assert.match(workflow, /vercel@54\.14\.5 build --prod \\\n\s*--scope "\$VERCEL_SCOPE_SLUG"/,
  "the release must build the already checked-out immutable dispatch SHA");
assert.match(workflow,
  /vercel@54\.14\.5 deploy --prebuilt --prod --skip-domain --yes \\\n\s*--scope "\$VERCEL_SCOPE_SLUG"/,
  "the exact prebuilt artifact must remain unpromoted until its deployment URL is healthy");
assert.doesNotMatch(workflow, /vercel@54\.14\.5 curl/,
  "the curl subcommand cannot safely bind a non-default team in token mode");
assert.match(workflow,
  /node scripts\/fetch-vercel-protected-health\.mjs \\\n\s*> \/tmp\/csm-thin-health-prepromotion\.json/,
  "the immutable health probe must use the team-scoped Vercel API helper");
assert.match(workflow,
  /vercel@54\.14\.5 promote "\$DEPLOYMENT_URL" --yes \\\n\s*--scope "\$VERCEL_SCOPE_SLUG"/);
assert.match(workflow, /--env "LYNCA_RELEASE_GIT_SHA=\$DISPATCH_SHA"/);
assert.doesNotMatch(workflow, /--token\b/,
  "the Vercel token must stay in the protected environment, not process arguments");
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
assert.match(
  workflow,
  /npm run check\s*\n\s*npm run test:release/,
  "production deploy must run the complete offline check and test gates instead of a hand-picked subset"
);
assert.doesNotMatch(
  workflow,
  /npm run check:csm-thin|npm run test:csm-thin|node scripts\/system-boundary-contract\.test\.mjs/,
  "release workflow must not restate a subset that can drift from package.json"
);
assert.equal(
  packageJson.scripts["test:release"],
  "npm run test:csm-thin && npm run test:production && npm run test:accuracy",
  "one repository script must own the complete checkout-independent release suite"
);
assert.match(ciWorkflow, /run: npm run test:release/,
  "CI and production deploy must execute the same release suite");
assert.doesNotMatch(packageJson.scripts["test:release"], /test:internal-library/,
  "the release runner must not depend on the operator-only protected evaluation checkout");
assert.match(
  workflow,
  /import \{ CSM_THIN_RUNTIME_CONTRACT \} from '\.\/lib\/listing\/thin\/csm-runtime-contract\.mjs'/,
  "the release gate must read the checked-out runtime contract instead of restating it"
);
assert.match(workflow, /h\.active_path === CSM_THIN_RUNTIME_CONTRACT\.route/);
assert.match(workflow, /h\.model === CSM_THIN_RUNTIME_CONTRACT\.model/);
assert.match(workflow, /h\.reasoning_effort === CSM_THIN_RUNTIME_CONTRACT\.reasoningEffort/);
assert.match(workflow, /scheduler_attempt_slots === 120/);
assert.match(workflow, /baseline_working_attempts === 43/);
assert.match(workflow, /pacer_estimated_tokens_per_second === 60000/);
assert.match(workflow, /pacer_burst_estimated_tokens === 66000/);
assert.match(workflow, /steady_reserved_attempts_per_minute === 553/);
assert.match(workflow, /effective_reserved_attempt_ceiling === 67/);
assert.match(
  health,
  /pacer_burst_estimated_tokens:\s*CSM_PROVIDER_AUTHORITY_LIMITS\.pacerBurstEstimatedTokens/,
  "health must report the running runtime contract, not a database rollout compatibility value"
);
assert.match(workflow, /h\.runtime\?\.model_profile_id === CSM_ACTIVE_MODEL_PROFILE\.id/);
assert.equal(
  [...workflow.matchAll(/resolveCsmProviderAdapter\(\s*CSM_ACTIVE_MODEL_PROFILE\.provider\s*\)\.contract\.id/g)].length,
  2,
  "both release gates must resolve the adapter owned by the active profile"
);
assert.match(workflow, /h\.runtime\?\.provider_adapter_version === expectedProviderAdapterVersion/);
assert.doesNotMatch(workflow, /CSM_OPENAI_RESPONSES_ADAPTER_VERSION/,
  "release verification must not pin the active profile to one provider adapter");
assert.match(workflow, /csmExecutionContractImageUrls/);
assert.equal(
  [...workflow.matchAll(/execution_contract_sha256_by_image_count/g)].length,
  4,
  "both release gates must compare the one- and two-image execution contracts"
);
assert.equal(
  [...workflow.matchAll(/buildCsmModelExecutionContractSha256\(\{\s*imageUrls: csmExecutionContractImageUrls\(count\)\s*\}\)/g)].length,
  2,
  "both release gates must derive execution receipts from the actual image-slot count"
);
assert.match(workflow, /h\.runtime\?\.max_output_tokens === CSM_ACTIVE_MODEL_PROFILE\.max_output_tokens/);
assert.match(workflow, /h\.runtime\?\.transport_profile\?\.id === CSM_STAGED_TRANSPORT_PROFILE\.id/);
assert.match(workflow, /h\.runtime\?\.transport_profile\?\.lane_version === CSM_STAGED_TRANSPORT_PROFILE\.lane_version/);
assert.match(workflow, /RETIRED_LISTING_EXECUTION_PATH/);
assert.match(workflow, /r\.code!=="missing_asset_id"/);
assert.match(workflow, /--data-binary @-/,
  "production smoke credentials must flow over stdin instead of process arguments");
assert.doesNotMatch(workflow, /--data\s+"\$\(node/,
  "production smoke must not expose the password in curl's process arguments");
assert.match(health, /LYNCA_RELEASE_GIT_SHA\s*\|\|\s*process\.env\.VERCEL_GIT_COMMIT_SHA/);
assert.match(health, /LYNCA_RELEASE_GIT_REF\s*\|\|\s*process\.env\.VERCEL_GIT_COMMIT_REF/);
assert.equal(
  packageJson.scripts["vercel-build"],
  "node lib/listing/thin/csm-deployment-environment.mjs",
  "Vercel must fail the build before promotion when the actual deployment environment is unsafe"
);

const vercelConfig = readFileSync("vercel.json", "utf8");
const localDeployEntrypoint = readFileSync("scripts/deploy-production-release.mjs", "utf8");
assert.match(localDeployEntrypoint, /DIRECT_PRODUCTION_DEPLOY_RETIRED/);
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

console.log("production release boundary tests passed");
