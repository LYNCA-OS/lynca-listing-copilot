#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const retiredRuntimeMigrationSurface = [
  "api/admin-apply-sem-definition-migration.js",
  "lib/platform-admin-auth.mjs"
];
for (const file of retiredRuntimeMigrationSurface) {
  assert.equal(existsSync(file), false,
    `${file} must stay outside the Production runtime surface`);
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

const retiredOpsSurface = [
  "app/ops.html",
  "app/ops.js",
  "app/ops.css",
  "api/v4/ops-snapshot.js",
  "lib/ops/tenant-ops.mjs"
];
for (const file of retiredOpsSurface) {
  assert.equal(existsSync(file), false, `${file} must stay outside the Production surface`);
}
const vercelManifest = JSON.parse(readFileSync("vercel.json", "utf8"));
const publicRewriteSources = (vercelManifest.rewrites || []).map(({ source }) => source);
assert.equal(publicRewriteSources.includes("/ops"), false,
  "the false-green /ops dashboard must not be publicly rewritten");
assert.equal(publicRewriteSources.includes("/ops.html"), false,
  "the legacy /ops.html alias must not be publicly rewritten");
for (const file of ["app/listing-copilot.js", "app/listing-copilot-sdk.mjs"]) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /track_c_ops_snapshot|\/api\/v4\/ops-snapshot/,
    `${file} must not call the retired Track C snapshot from the Production UI`);
}

const workflow = readFileSync(".github/workflows/deploy-production.yml", "utf8");
const writerJourneyWorkflow = readFileSync(
  ".github/workflows/production-writer-journey.yml", "utf8"
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const health = readFileSync("api/health.js", "utf8");
const productionReadiness = readFileSync("scripts/check-csm-thin-production-readiness.mjs", "utf8");
const protectedHealth = readFileSync("scripts/fetch-vercel-protected-health.mjs", "utf8");
const rollbackReceipt = readFileSync(
  "scripts/vercel-production-rollback-receipt.mjs", "utf8"
);
const activeServiceContext = JSON.parse(readFileSync(
  "docs/operations/active-service-context.json", "utf8"
));
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
  "scripts/check-csm-thin-production-readiness.mjs": 4
})) {
  const source = readFileSync(file, "utf8");
  const fetchCount = [...source.matchAll(/fetchImpl\s*\(/g)].length;
  const redirectCount = [...source.matchAll(/redirect:\s*["']error["']/g)].length;
  assert.ok(redirectCount >= fetchCount && redirectCount >= minimumRedirects,
    `${file} must fail closed on every service-key fetch redirect`);
}
assert.match(productionReadiness, /CSM_PROVIDER_AUTHORITY_RPCS\.lookupByKey/,
  "database preflight must probe key-only historical provider recovery before release");
assert.match(productionReadiness,
  /Object\.hasOwn\(operationKeyRecovery \|\| \{\}, "payload_sha256"\)/,
  "a not-found key-only recovery receipt must not expose a payload hash");
assert.match(productionReadiness,
  /Object\.hasOwn\(operationKeyRecovery \|\| \{\}, "result"\)/,
  "a not-found key-only recovery receipt must not expose a provider result");
assert.match(productionReadiness, /durable_provider_operation_key_recovery_ready: true/,
  "release evidence must attest the key-only recovery RPC readiness gate");
const writerJourneyMaterializer = readFileSync("scripts/materialize-writer-journey-source.mjs", "utf8");
assert.match(writerJourneyMaterializer,
  /headers:\s*supabaseServiceHeaders\([^\n]+\),\s*\n\s*redirect:\s*"error"/,
  "Writer Journey signing must not redirect its server-only apikey");
const dispatchGate = workflow.indexOf("Fail closed unless this dispatch targets the current main commit");
const setupNode = workflow.indexOf("actions/setup-node");
const schemaPreflight = workflow.indexOf("Verify CSM persistence and global provider authority before deploy");
const immutableReleaseGate = workflow.indexOf("Re-confirm the exact main commit before building the immutable release");
const vercelProjectBinding = workflow.indexOf("Bind the canonical Vercel project from tracked service context");
const rollbackCapture = workflow.indexOf(
  "Verify the unique alias writer and capture the current rollback deployment"
);
const vercelDeploy = workflow.indexOf("Build and deploy the exact dispatched checkout");
const prepromotionHealth = workflow.indexOf(
  "Verify the immutable deployment and prepare candidate-only browser authorization"
);
const candidateSource = workflow.indexOf(
  "Materialize fixed NON_TCG and TCG cases from Production Storage"
);
const candidateJourney = workflow.indexOf(
  "Run real candidate Writer Journey before production promotion"
);
const candidateAuthorizationCleanup = workflow.indexOf(
  "Destroy candidate browser authorization"
);
const ownershipGuard = workflow.indexOf(
  "Re-verify single-writer authority and canonical ownership before promotion"
);
const vercelPromote = workflow.indexOf("Promote the verified immutable deployment to production");
const productionHealth = workflow.indexOf("Wait for the exact CSM thin main commit to reach production");
const productionDatabase = workflow.indexOf("Re-verify CSM persistence after deployment");
const productionAuth = workflow.indexOf("Verify authenticated UI, active API, and retired boundaries");
const rollbackRestore = workflow.indexOf(
  "Restore the saved Production deployment after release verification failure"
);
const releaseEvidence = workflow.indexOf("Upload release evidence");
assert.ok(dispatchGate >= 0, "production deployment must have an explicit dispatch gate");
assert.ok(setupNode > dispatchGate, "dispatch validation must run before release setup");
assert.ok(schemaPreflight > dispatchGate, "dispatch validation must run before production schema access");
assert.ok(immutableReleaseGate > schemaPreflight, "current main must be re-read after tests and schema preflight");
assert.ok(vercelProjectBinding > immutableReleaseGate, "the canonical Vercel identity must come from tracked service context");
assert.ok(rollbackCapture > vercelProjectBinding,
  "the rollback identity must be captured only after binding the canonical team and project");
assert.ok(vercelDeploy > rollbackCapture,
  "the current canonical deployment must be durably recorded before candidate creation");
assert.ok(prepromotionHealth > vercelDeploy, "the immutable deployment must be healthy before promotion");
assert.ok(candidateSource > prepromotionHealth,
  "candidate source materialization must follow exact deployment identity and health");
assert.ok(candidateJourney > candidateSource,
  "the real Writer Journey must execute against the immutable candidate");
assert.ok(candidateAuthorizationCleanup > candidateJourney,
  "candidate browser authorization must be destroyed even when the journey fails");
assert.ok(ownershipGuard > candidateAuthorizationCleanup,
  "the ownership guard must remain unreachable until the candidate journey succeeds");
assert.ok(vercelPromote > ownershipGuard,
  "production promotion must remain unreachable until the single-writer guard succeeds");
assert.ok(productionHealth > vercelPromote, "the promoted production alias must be verified independently");
assert.ok(productionDatabase > productionHealth && productionAuth > productionDatabase,
  "post-promotion verification must remain exact SHA, database, auth, and route checks");
assert.ok(rollbackRestore > productionAuth && releaseEvidence > rollbackRestore,
  "failed post-promotion verification must restore Production before evidence upload");
const candidateJourneyStep = workflow.slice(candidateJourney, candidateAuthorizationCleanup);
const ownershipGuardStep = workflow.slice(ownershipGuard, vercelPromote);
const promotionStep = workflow.slice(vercelPromote, productionHealth);
const rollbackStep = workflow.slice(rollbackRestore, releaseEvidence);
const postPromotionHealthStep = workflow.slice(productionHealth, productionDatabase);
const postPromotion = workflow.slice(vercelPromote);
assert.doesNotMatch(candidateJourneyStep, /continue-on-error|if:\s*always\(\)/,
  "a failed candidate journey must preserve the failed job status");
assert.match(ownershipGuardStep,
  /--verify-writer-authority/,
  "promotion must re-verify that Vercel remains staged-only with no deploy hook");
assert.match(ownershipGuardStep,
  /--verify-canonical "\$VERCEL_ROLLBACK_RECEIPT"/,
  "promotion must reject canonical drift from the captured deployment");
assert.doesNotMatch(ownershipGuardStep, /id:\s*promote|vercel@54\.14\.5 promote/,
  "an ownership failure must not look like an attempted promotion or trigger rollback");
assert.doesNotMatch(workflow, /compare-and-swap|\bCAS\b/i,
  "Vercel has no public conditional promotion API; release controls must not claim CAS");
assert.doesNotMatch(promotionStep, /continue-on-error|if:\s*always\(\)/,
  "promotion must use the default success guard, never run after a failed journey");
assert.match(promotionStep, /id: promote/,
  "rollback eligibility must bind the exact promotion step outcome");
assert.doesNotMatch(promotionStep, /--verify-canonical/,
  "the promote step must only represent an actual promotion attempt");
assert.doesNotMatch(postPromotion,
  /Run real candidate Writer Journey|npm run test:e2e:production-writer-journey/,
  "post-promotion verification must not spend another provider call");
assert.doesNotMatch(postPromotion,
  /materialize-writer-journey-source|build-large-internal-writer-fixture|OPENAI_API_KEY/,
  "post-promotion verification is limited to exact SHA, DB, auth, and no-op route checks");
assert.doesNotMatch(writerJourneyWorkflow, /workflow_run|environment:\s*production/,
  "the PR workflow must remain offline and must not duplicate paid post-deploy execution");
assert.doesNotMatch(writerJourneyWorkflow,
  /METAVERSE_USERNAME|METAVERSE_PASSWORD|SUPABASE_SERVICE_ROLE_KEY/,
  "the PR-only contract workflow must not receive Production credentials");
assert.match(workflow, /test "\$DEFAULT_BRANCH" = "main"/);
assert.match(workflow, /test "\$DISPATCH_REF" = "refs\/heads\/main"/);
assert.match(workflow, /git fetch --no-tags --depth=1 origin main:refs\/remotes\/origin\/main/);
assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$DISPATCH_SHA"/);
assert.doesNotMatch(workflow, /VERCEL_DEPLOY_HOOK_URL|Deploy Hook|vercel-deploy-hook/,
  "a branch-reading deploy hook can race with main and must not mutate production");
assert.match(rollbackReceipt, /autoAssignCustomDomains !== false/,
  "the live writer-authority gate must require staged-only production deployments");
assert.match(rollbackReceipt, /hooks\.length !== 0/,
  "the live writer-authority gate must reject every deploy hook");
assert.match(rollbackReceipt, /domain\?\.gitBranch !== null/,
  "the canonical domain must not follow a Git branch outside the release workflow");
assert.equal(activeServiceContext.vercel.production.release_authority.normal_alias_writer,
  "protected_github_workflow_only");
assert.equal(activeServiceContext.vercel.production.release_authority.auto_assign_custom_domains,
  false);
assert.equal(activeServiceContext.vercel.production.release_authority.allowed_deploy_hooks, 0);
assert.equal(activeServiceContext.vercel.production.release_authority.canonical_domain_git_branch,
  null);
assert.equal(activeServiceContext.vercel.production.release_authority.provider_conditional_write_supported,
  false);
const workflowFiles = readdirSync(".github/workflows")
  .filter((name) => /\.ya?ml$/.test(name));
for (const name of workflowFiles) {
  const source = readFileSync(`.github/workflows/${name}`, "utf8");
  if (name === "deploy-production.yml") continue;
  assert.doesNotMatch(source, /^\s*environment:\s*production\s*$/m,
    `${name} must not enter the Production credential environment`);
  assert.doesNotMatch(source, /secrets\.VERCEL_TOKEN|vercel(?:@[0-9.]+)?\s+(?:promote|rollback)/,
    `${name} must not become a second Production alias writer`);
}
assert.match(workflow, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
assert.equal(
  [...workflow.matchAll(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/g)].length,
  6,
  "capture, build, candidate verification, ownership guard, promotion, and rollback authenticate independently"
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
  5,
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
  /node scripts\/fetch-vercel-protected-health\.mjs \\\n\s*--storage-state "\$candidate_storage_state" \\\n\s*> \/tmp\/csm-thin-health-prepromotion\.json/,
  "the immutable health probe must use the team-scoped Vercel API helper");
assert.match(workflow, /stat -c '%a' "\$candidate_storage_state"\)" = "600"/,
  "candidate browser authorization must be a mode-0600 temporary file");
assert.match(workflow,
  /WRITER_JOURNEY_BASE_URL=%s\\n' "\$DEPLOYMENT_URL"/,
  "the live journey must target the verified immutable candidate URL");
assert.match(workflow,
  /WRITER_JOURNEY_INITIAL_STORAGE_STATE=%s\\n' "\$candidate_storage_state"/,
  "the browser must consume the candidate-only storage state instead of a global bypass header");
assert.match(workflow, /case "\$WRITER_JOURNEY_INITIAL_STORAGE_STATE" in[\s\S]*?"\$RUNNER_TEMP"\/\*/,
  "cleanup must refuse to delete outside the runner temporary directory");
assert.doesNotMatch(workflow,
  /VERCEL_AUTOMATION_BYPASS_SECRET|x-vercel-protection-bypass|x-vercel-set-bypass-cookie/,
  "the bypass secret must remain inside the protected helper, never workflow state or logs");
const candidateSourceStep = workflow.slice(candidateSource,
  workflow.indexOf("Build executor-bound large staged transport fixture", candidateSource));
assert.doesNotMatch(candidateSourceStep, /VERCEL_TOKEN|VERCEL_AUTOMATION|protection-bypass/i,
  "Supabase source materialization must never inherit the Vercel bypass credential");
assert.doesNotMatch(protectedHealth, /supabase/i,
  "the candidate-scoped bypass helper must have no Supabase transport path");
assert.match(protectedHealth, /redirect:\s*"manual"/,
  "the cookie exchange must inspect redirects before any follow-up request");
assert.match(protectedHealth, /cookie_redirect_origin_mismatch/,
  "a bypass-cookie redirect may not escape the verified candidate origin");
assert.match(protectedHealth, /domain:\s*hostname/,
  "bypass cookies must be narrowed to the exact verified candidate hostname");
assert.match(workflow,
  /vercel@54\.14\.5 promote "\$DEPLOYMENT_URL" --yes \\\n\s*--scope "\$VERCEL_SCOPE_SLUG"/);
assert.match(workflow,
  /vercel@54\.14\.5 promote "\$rollback_url" --yes \\\n\s*--scope "\$VERCEL_SCOPE_SLUG"/,
  "rollback must re-promote the exact deployment URL loaded from the saved receipt");
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
assert.doesNotMatch(postPromotionHealthStep,
  /CSM_THIN_RUNTIME_CONTRACT|CSM_ACTIVE_MODEL_PROFILE|capacity|recognition_transport|provider_adapter/,
  "canonical alias verification needs only readiness and exact SHA after the candidate passed full gates");
assert.match(postPromotionHealthStep, /h\.ready === true/);
assert.match(postPromotionHealthStep,
  /h\.deployment\?\.git_commit_sha === process\.env\.GITHUB_SHA/);
assert.match(workflow, /h\.runtime\?\.model_profile_id === CSM_ACTIVE_MODEL_PROFILE\.id/);
assert.equal(
  [...workflow.matchAll(/resolveCsmProviderAdapter\(\s*CSM_ACTIVE_MODEL_PROFILE\.provider\s*\)\.contract\.id/g)].length,
  1,
  "the immutable candidate gate must resolve the adapter owned by the active profile"
);
assert.match(workflow, /h\.runtime\?\.provider_adapter_version === expectedProviderAdapterVersion/);
assert.doesNotMatch(workflow, /CSM_OPENAI_RESPONSES_ADAPTER_VERSION/,
  "release verification must not pin the active profile to one provider adapter");
assert.match(workflow, /csmExecutionContractImageUrls/);
assert.equal(
  [...workflow.matchAll(/execution_contract_sha256_by_transport_lane_and_image_count/g)].length,
  1,
  "the immutable candidate gate must compare execution contracts across every active transport lane"
);
assert.equal(
  [...workflow.matchAll(/buildCsmModelExecutionContractSha256\(\{\s*transportProfile,\s*imageUrls: csmExecutionContractImageUrls\(count\)\s*\}\)/g)].length,
  1,
  "the immutable candidate gate must derive receipts from the exact transport lane and image-slot count"
);
assert.match(workflow, /h\.runtime\?\.max_output_tokens === CSM_ACTIVE_MODEL_PROFILE\.max_output_tokens/);
assert.equal([...workflow.matchAll(/CSM_RECOGNITION_TRANSPORT_PROFILES\.every/g)].length, 1,
  "the immutable candidate health gate must enumerate the portable transport registry");
assert.equal([...workflow.matchAll(/sha256CsmRecognitionTransportReceipt\(transportProfile\)/g)].length, 1,
  "the immutable candidate health gate must verify exact transport profile receipts");
assert.doesNotMatch(workflow, /CSM_STAGED_TRANSPORT_PROFILE|execution_contract_sha256_by_image_count/,
  "release health may not reduce the active chain to one staged transport lane");
assert.match(workflow, /h\.runtime\?\.retired_capabilities_disabled === true/);
assert.doesNotMatch(workflow, /cloud_run_calls|vector_calls|generic_ocr_calls/,
  "release gates must not present hard-coded zeroes as measured provider-call telemetry");

assert.match(workflow, /timeout-minutes: 90/,
  "the job must reserve enough time for failure recovery after the bounded candidate journey");
assert.match(workflow,
  /rollback_receipt="\$RUNNER_TEMP\/vercel-production-rollback-receipt\.json"/);
assert.match(workflow,
  /node scripts\/vercel-production-rollback-receipt\.mjs --out "\$rollback_receipt"/);
assert.match(workflow, /stat -c '%a' "\$rollback_receipt"\)" = "600"/,
  "the rollback receipt must be owner-only before candidate creation");
assert.match(rollbackReceipt, /\/v4\/aliases\/\$\{encodeURIComponent\(canonicalHostname\)\}/,
  "capture must resolve the live canonical alias through Vercel's alias API");
assert.match(rollbackReceipt, /\/v13\/deployments\/\$\{encodeURIComponent\(expectedDeploymentId\)\}/,
  "capture must re-resolve the saved deployment by immutable ID");
assert.match(rollbackReceipt, /canonical_alias_changed_during_capture/,
  "alias double-read must reject a concurrent production change");
assert.match(rollbackReceipt, /deployment\?\.readyState !== "READY"/);
assert.match(rollbackReceipt, /deployment\?\.ownerId !== teamId/);
assert.match(rollbackReceipt, /deployment\?\.projectId !== projectId/);
assert.match(rollbackReceipt, /open\(outputPath, "wx", 0o600\)/);
assert.doesNotMatch(rollbackReceipt, /supabase/i,
  "rollback identity code must have no Supabase credential or transport path");
assert.match(rollbackStep,
  /if: failure\(\) && \(steps\.promote\.outcome == 'success' \|\| steps\.promote\.outcome == 'failure'\)/,
  "rollback runs only after promotion was attempted, including a potentially partial failed promotion");
assert.match(rollbackStep, /timeout-minutes: 12/);
assert.match(rollbackStep,
  /--verify-deployment "\$VERCEL_ROLLBACK_RECEIPT"/,
  "the saved deployment must still be READY and exact-SHA healthy before any rollback mutation");
assert.match(rollbackStep,
  /--verify-canonical-deployment "\$DEPLOYMENT_URL"/,
  "rollback must stop when an OWNER break-glass action has replaced this release");
assert.ok(
  rollbackStep.indexOf('--verify-canonical-deployment "$DEPLOYMENT_URL"')
    < rollbackStep.indexOf('vercel@54.14.5 promote "$rollback_url"'),
  "the current canonical deployment must be checked before rollback mutation",
);
assert.match(rollbackStep, /--deployment-url "\$VERCEL_ROLLBACK_RECEIPT"/);
assert.match(rollbackStep, /--git-sha "\$VERCEL_ROLLBACK_RECEIPT"/);
assert.match(rollbackStep, /--verify-canonical "\$VERCEL_ROLLBACK_RECEIPT"/,
  "rollback completion must verify canonical alias, deployment identity, and saved SHA");
assert.match(rollbackStep, /h\.deployment\?\.git_commit_sha!==process\.env\.ROLLBACK_SHA/);
assert.match(rollbackStep, /this release remains HOLD/);
assert.doesNotMatch(rollbackStep, /continue-on-error|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/,
  "recovery must not clear the failed release or acquire unrelated provider credentials");
assert.doesNotMatch(workflow, /https:\/\/[a-z0-9-]+\.vercel\.app/,
  "rollback may not hard-code a historical deployment URL");
const evidenceStep = workflow.slice(releaseEvidence);
assert.match(evidenceStep,
  /\$\{\{ runner\.temp \}\}\/vercel-production-rollback-receipt\.json/);
assert.match(evidenceStep, /\/tmp\/csm-thin-health-rollback\.json/);
assert.doesNotMatch(evidenceStep, /vercel-candidate-storage-state|WRITER_JOURNEY_INITIAL_STORAGE_STATE/,
  "candidate browser authorization must never be uploaded as release evidence");
assert.match(packageJson.scripts["test:production"],
  /vercel-production-rollback-receipt\.test\.mjs/,
  "the rollback transaction counterexamples must run in the complete Production suite");
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
