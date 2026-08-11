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
const parityReadback = readFileSync("scripts/production-parity-readback.mjs", "utf8");
const forwardReadback = readFileSync("scripts/production-forward-readback.mjs", "utf8");
const resolutionViewApi = readFileSync("api/csm-resolution-view.js", "utf8");
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
const dependencyBootstrap = workflow.indexOf(
  "Install exact locked dependencies before release selection"
);
const releaseClassBinding = workflow.indexOf(
  "Bind the protected release class to this exact commit"
);
const releaseArtifactGate = workflow.indexOf("Verify the CSM thin release artifact");
const schemaPreflight = workflow.indexOf("Verify CSM persistence and global provider authority before deploy");
const immutableReleaseGate = workflow.indexOf("Re-confirm the exact main commit before building the immutable release");
const vercelProjectBinding = workflow.indexOf("Bind the canonical Vercel project from tracked service context");
const rollbackCapture = workflow.indexOf(
  "Verify the unique alias writer and capture the current rollback deployment"
);
const rollbackLineage = workflow.indexOf(
  "Verify the selected release rollback lineage before candidate creation"
);
const vercelDeploy = workflow.indexOf("Build and deploy the exact dispatched checkout");
const prepromotionHealth = workflow.indexOf(
  "Verify the immutable deployment and prepare candidate-only browser authorization"
);
const compatibilityBridgeProof = workflow.indexOf(
  "Prove the selected compatibility bridge runtime contract"
);
const candidateSource = workflow.indexOf(
  "Materialize release-class-bound Writer Journey cases from Production Storage"
);
const candidateJourney = workflow.indexOf(
  "Run real candidate Writer Journey before production promotion"
);
const candidateAuthorizationCleanup = workflow.indexOf(
  "Destroy candidate browser authorization"
);
const candidateForwardReadback = workflow.indexOf(
  "Prove captured Production can read the candidate durable projection"
);
const ownershipGuard = workflow.indexOf(
  "Re-verify single-writer authority and canonical ownership before promotion"
);
const vercelPromote = workflow.indexOf("Promote the verified immutable deployment to production");
const productionHealth = workflow.indexOf("Wait for the exact CSM thin main commit to reach production");
const canonicalAlias = workflow.indexOf(
  "Bind the canonical alias to the exact promoted deployment URL"
);
const productionDatabase = workflow.indexOf("Re-verify CSM persistence after deployment");
const productionAuth = workflow.indexOf("Verify authenticated UI, active API, and retired boundaries");
const canonicalReadbackRecheck = workflow.indexOf(
  "Re-confirm the exact canonical deployment after parity readback"
);
const rollbackRestore = workflow.indexOf(
  "Restore the saved Production deployment after release verification failure"
);
const releaseEvidence = workflow.indexOf("Upload release evidence");
assert.ok(dispatchGate >= 0, "production deployment must have an explicit dispatch gate");
assert.ok(setupNode > dispatchGate, "dispatch validation must run before release setup");
assert.ok(dependencyBootstrap > setupNode && releaseClassBinding > dependencyBootstrap,
  "the exact lockfile install must make the selector runnable before selection");
assert.ok(releaseClassBinding < releaseArtifactGate && releaseArtifactGate < schemaPreflight,
  "the release class and exact commit must be bound before any Production access");
assert.ok(schemaPreflight > dispatchGate, "dispatch validation must run before production schema access");
assert.ok(immutableReleaseGate > schemaPreflight, "current main must be re-read after tests and schema preflight");
assert.ok(vercelProjectBinding > immutableReleaseGate, "the canonical Vercel identity must come from tracked service context");
assert.ok(rollbackCapture > vercelProjectBinding,
  "the rollback identity must be captured only after binding the canonical team and project");
assert.ok(rollbackLineage > rollbackCapture && vercelDeploy > rollbackLineage,
  "the selected release rollback lineage must fail closed before candidate creation");
assert.ok(prepromotionHealth > vercelDeploy, "the immutable deployment must be healthy before promotion");
assert.ok(compatibilityBridgeProof > prepromotionHealth
  && candidateSource > compatibilityBridgeProof,
  "candidate source materialization must follow exact deployment identity and health");
assert.ok(candidateJourney > candidateSource,
  "the real Writer Journey must execute against the immutable candidate");
assert.ok(candidateAuthorizationCleanup > candidateJourney,
  "candidate browser authorization must be destroyed even when the journey fails");
assert.ok(candidateForwardReadback > candidateAuthorizationCleanup,
  "the captured rollback target must read the candidate projection with fresh auth");
assert.ok(ownershipGuard > candidateForwardReadback,
  "the ownership guard must remain unreachable until forward readback succeeds");
assert.ok(vercelPromote > ownershipGuard,
  "production promotion must remain unreachable until the single-writer guard succeeds");
assert.ok(productionHealth > vercelPromote, "the promoted production alias must be verified independently");
assert.ok(canonicalAlias > productionHealth && productionDatabase > canonicalAlias
  && productionAuth > productionDatabase,
"post-promotion verification must bind exact SHA, alias URL, database, auth, and readback");
assert.ok(canonicalReadbackRecheck > productionAuth && rollbackRestore > canonicalReadbackRecheck
  && releaseEvidence > rollbackRestore,
"parity readback must be bracketed by exact alias checks before rollback and evidence upload");
const candidateJourneyStep = workflow.slice(candidateJourney, candidateAuthorizationCleanup);
const candidateForwardReadbackStep = workflow.slice(candidateForwardReadback, ownershipGuard);
const candidateSourceStep = workflow.slice(candidateSource, candidateJourney);
const dependencyBootstrapStep = workflow.slice(dependencyBootstrap, releaseClassBinding);
const releaseClassStep = workflow.slice(releaseClassBinding, schemaPreflight);
const releaseArtifactStep = workflow.slice(releaseArtifactGate, schemaPreflight);
const compatibilityBridgeProofStep = workflow.slice(compatibilityBridgeProof, candidateSource);
const rollbackCaptureStep = workflow.slice(rollbackCapture, rollbackLineage);
const rollbackLineageStep = workflow.slice(rollbackLineage, vercelDeploy);
const ownershipGuardStep = workflow.slice(ownershipGuard, vercelPromote);
const promotionStep = workflow.slice(vercelPromote, productionHealth);
const rollbackStep = workflow.slice(rollbackRestore, releaseEvidence);
const postPromotionHealthStep = workflow.slice(productionHealth, canonicalAlias);
const canonicalAliasStep = workflow.slice(canonicalAlias, productionDatabase);
const productionAuthStep = workflow.slice(productionAuth, canonicalReadbackRecheck);
const parityReadbackStep = productionAuthStep.slice(productionAuthStep.indexOf("writer_evidence="));
const canonicalReadbackRecheckStep = workflow.slice(canonicalReadbackRecheck, rollbackRestore);
const postPromotion = workflow.slice(vercelPromote);
assert.doesNotMatch(candidateJourneyStep, /continue-on-error|if:\s*always\(\)/,
  "a failed candidate journey must preserve the failed job status");
assert.match(workflow,
  /release_class:[\s\S]*?default: ordinary[\s\S]*?options:[\s\S]*?- ordinary[\s\S]*?- compatibility-bridge/,
  "manual dispatch must default to the full ordinary release class");
assert.match(releaseClassStep,
  /compatibility-bridge-release\.mjs verify-selection[\s\S]*?--release-class "\$RELEASE_CLASS"[\s\S]*?--git-sha "\$DISPATCH_SHA"/,
  "the reduced class must be bound to the exact commit before release work begins");
assert.match(releaseClassStep, /production-release-selection\.json/);
assert.match(releaseClassStep, /stat -c '%a'[\s\S]*?= "600"/,
  "the release selection receipt must remain owner-only");
assert.doesNotMatch(releaseClassStep,
  /VERCEL_TOKEN|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/,
  "the zero-call release-class proof must not acquire Production credentials");
assert.equal(
  [...workflow.matchAll(/npm ci --no-audit --no-fund/g)].length,
  1,
  "the exact lockfile install must run once before selection and never be repeated"
);
assert.match(dependencyBootstrapStep,
  /npm ci --no-audit --no-fund[\s\S]*?git diff --quiet -- \.[\s\S]*?git diff --cached --quiet -- \./,
  "selection must run only after install leaves both tracked worktree and index exact");
assert.doesNotMatch(dependencyBootstrapStep,
  /\$\{\{\s*(?:secrets|vars)\.|SUPABASE|OPENAI|VERCEL|METAVERSE|POSTGRES|Writer Journey|candidate/i,
  "dependency bootstrap before selection must not acquire Production authority or run runtime work");
assert.doesNotMatch(releaseArtifactStep, /npm ci/,
  "the complete artifact proof must reuse the already installed exact dependency tree");
assert.match(releaseArtifactStep,
  /npm ls --omit=dev --all[\s\S]*?node scripts\/npm-audit-gate\.mjs[\s\S]*?npm run check[\s\S]*?npm run test:release[\s\S]*?npm run test:e2e:production-writer-journey:contract/,
  "dependency bootstrap must not split or weaken the complete runtime artifact proof");
assert.match(compatibilityBridgeProofStep,
  /if: \$\{\{ inputs\.release_class == 'compatibility-bridge' \}\}/);
assert.match(compatibilityBridgeProofStep,
  /compatibility-bridge-release\.mjs verify-health[\s\S]*?--health \/tmp\/csm-thin-health-prepromotion\.json/,
  "the bridge must prove its selected runtime contract on the immutable candidate");
assert.match(candidateSourceStep, /writer-journey-cases-v3\.json/);
assert.match(candidateSourceStep, /writer-journey-compatibility-bridge-cases-v1\.json/);
assert.match(candidateSourceStep, /writer-journey-large-source-v2\.json/);
assert.match(candidateSourceStep,
  /WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT/,
  "the candidate source gate must validate parity identity and hashes from the checked-out contract");
assert.match(candidateSourceStep,
  /WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT/,
  "the ordinary Writer source must bind the verified low-reasoning Production asset");
assert.match(candidateSourceStep, /manifest\.schema_version !== 'writer-journey-cases-v3'/);
assert.match(candidateSourceStep, /parity\.source_asset_id !== contract\.source_asset_id/);
assert.match(candidateSourceStep, /file\.content_sha256 === contract\.images\[index\]\.content_sha256/);
assert.match(candidateSourceStep,
  /standard\.source_asset_id[\s\S]*?WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT\.source_asset_id/);
assert.match(candidateSourceStep, /writer_journey_verifier_fact_leaked/,
  "verifier-only expected identity must not enter the generated provider fixture");
assert.match(candidateSourceStep, /flag: 'wx', mode: 0o600/,
  "the derived v2 subset must be exclusively created owner-only");
assert.match(candidateSourceStep, /stat\(largeSourcePath\)[\s\S]*0o777\)[\s\S]*0o600/,
  "the v2 subset mode must be verified before the large builder can consume it");
assert.match(candidateSourceStep,
  /compatibility-bridge-release\.mjs build-manifest[\s\S]*?--release-class "\$PRODUCTION_RELEASE_CLASS"[\s\S]*?--git-sha "\$GITHUB_SHA"/,
  "only the exact bridge commit may derive the parity-free compatibility manifest");
assert.match(candidateSourceStep,
  /if \[ "\$PRODUCTION_RELEASE_CLASS" = "compatibility-bridge" \]; then[\s\S]*?selected_cases_manifest="\$bridge_cases_manifest"[\s\S]*?else[\s\S]*?test "\$PRODUCTION_RELEASE_CLASS" = "ordinary"/,
  "ordinary releases must not silently select the reduced manifest");
assert.match(candidateSourceStep,
  /WRITER_JOURNEY_RELEASE_CLASS=%s\\n'[\s\S]*\$PRODUCTION_RELEASE_CLASS/);
assert.match(candidateSourceStep,
  /WRITER_JOURNEY_CASES_MANIFEST=%s\\n'[\s\S]*\$selected_cases_manifest/,
  "the real Writer Journey must receive the release-class-bound manifest");
assert.match(candidateSourceStep,
  /WRITER_JOURNEY_LARGE_SOURCE_MANIFEST=%s\\n'[\s\S]*\$large_source_manifest/);
assert.match(candidateSourceStep,
  /WRITER_JOURNEY_FORWARD_READBACK_EXPECTATION=%s\\n'[\s\S]*\$forward_readback_expectation/,
  "the Writer Journey must receive a private forward-readback expectation path");
assert.match(candidateSourceStep,
  /--source-manifest "\$WRITER_JOURNEY_LARGE_SOURCE_MANIFEST"/,
  "the strict large builder must receive the owner-only v2 subset");
assert.doesNotMatch(candidateSourceStep,
  /--source-manifest "\$WRITER_JOURNEY_CASES_MANIFEST"/,
  "the parity-bearing v3 manifest must not be passed to the v2-only large builder");
assert.doesNotMatch(rollbackCaptureStep,
  /if:|PRODUCTION_RELEASE_CLASS|compatibility-bridge/,
  "every release class must capture the current canonical rollback target identically");
assert.match(rollbackLineageStep,
  /compatibility-bridge-release\.mjs verify-rollback-lineage[\s\S]*?--selection "\$PRODUCTION_RELEASE_SELECTION_RECEIPT"[\s\S]*?--rollback-receipt "\$VERCEL_ROLLBACK_RECEIPT"/,
  "every selected release must bind its saved selection to the captured rollback receipt");
assert.match(rollbackLineageStep, /production-release-rollback-lineage\.json/);
assert.match(rollbackLineageStep, /stat -c '%a'[\s\S]*?= "600"/,
  "the rollback lineage receipt must remain owner-only");
assert.doesNotMatch(rollbackLineageStep,
  /if:|VERCEL_TOKEN|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/,
  "rollback lineage must be an unconditional zero-provider pre-candidate gate");
assert.match(candidateJourneyStep,
  /stat -c '%a' "\$WRITER_JOURNEY_FORWARD_READBACK_EXPECTATION"[\s\S]*?= "600"/,
  "the candidate must exclusively create its private exact projection expectation");
assert.match(candidateForwardReadbackStep,
  /--verify-canonical "\$VERCEL_ROLLBACK_RECEIPT"[\s\S]*?production-forward-readback\.mjs asset-id[\s\S]*?production-forward-readback\.mjs verify[\s\S]*?--rollback-receipt "\$VERCEL_ROLLBACK_RECEIPT"[\s\S]*?--verify-canonical "\$VERCEL_ROLLBACK_RECEIPT"/,
  "captured Production must remain exact before and after reading the candidate asset");
assert.match(candidateForwardReadbackStep,
  /lynca-canonical-forward-readback-cookies\.txt[\s\S]*?\/api\/login[\s\S]*?--max-redirs 0[\s\S]*?\/api\/csm-resolution-view\?\$query/,
  "forward readback must use a fresh canonical login and reject redirects");
assert.match(candidateForwardReadbackStep,
  /test "\$\{login_meta\[0\]\}" = "200"[\s\S]*?test "\$\{login_meta\[1\]\}" = "\$login_url"[\s\S]*?test "\$\{readback_meta\[0\]\}" = "200"[\s\S]*?test "\$\{readback_meta\[1\]\}" = "\$readback_url"/,
  "both authenticated requests must return exact URLs and HTTP 200 without redirect");
assert.doesNotMatch(candidateForwardReadbackStep,
  /OPENAI_API_KEY|\/api\/csm-listing-title|WRITER_JOURNEY_INITIAL_STORAGE_STATE/,
  "the rollback-target readback must be provider-free and must not reuse candidate auth");
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
assert.match(canonicalAliasStep,
  /vercel-production-canonical-deployment-receipt\.json[\s\S]*?--canonical-deployment-receipt "\$DEPLOYMENT_URL"/,
  "post-promotion control-plane evidence must bind canonical to the exact candidate URL");
assert.match(canonicalAliasStep, /stat -c '%a'[\s\S]*?= "600"/,
  "the canonical deployment receipt must remain owner-only");
assert.match(parityReadbackStep,
  /production-parity-readback\.mjs asset-id[\s\S]*?\/api\/csm-resolution-view\?\$parity_query[\s\S]*?production-parity-readback\.mjs verify/,
  "canonical must read back the exact parity asset selected by candidate evidence");
assert.match(parityReadbackStep,
  /production-parity-readback\.mjs standard-asset-id[\s\S]*?\/api\/csm-resolution-view\?\$standard_query[\s\S]*?production-parity-readback\.mjs verify-standard/,
  "canonical must read back the exact NON_TCG asset selected by candidate evidence");
assert.match(parityReadbackStep, /-b "\$cookie_jar"/,
  "the persisted parity readback must use the authenticated canonical writer session");
assert.match(parityReadbackStep,
  /stat -c '%a' "\$parity_response"[\s\S]*?= "600"[\s\S]*?stat -c '%a' "\$parity_receipt"[\s\S]*?= "600"/,
  "raw readback and sanitized receipt must remain owner-only");
assert.match(parityReadbackStep,
  /stat -c '%a' "\$standard_response"[\s\S]*?= "600"[\s\S]*?stat -c '%a' "\$standard_receipt"[\s\S]*?= "600"/,
  "raw NON_TCG readback and sanitized receipt must remain owner-only");
assert.match(productionAuthStep,
  /if \[ "\$PRODUCTION_RELEASE_CLASS" = "ordinary" \]; then[\s\S]*?else[\s\S]*?test "\$PRODUCTION_RELEASE_CLASS" = "compatibility-bridge"[\s\S]*?production-forward-readback\.mjs verify-promoted/,
  "bridge postpromotion must use the version-neutral exact projection readback");
assert.doesNotMatch(parityReadbackStep,
  /OPENAI_API_KEY|\/api\/csm-listing-title|--data|\s-X\s+POST/,
  "post-promotion persisted readback must never dispatch recognition or another provider call");
assert.match(productionAuthStep,
  /trap 'rm -f -- "\$cookie_jar" "\$parity_response" "\$standard_response" "\$bridge_response" "\$WRITER_JOURNEY_FORWARD_READBACK_EXPECTATION"' EXIT/,
  "canonical auth material, private expectation, and raw title readbacks must be destroyed before evidence upload");
assert.match(workflow,
  /\$\{\{ runner\.temp \}\}\/production-standard-readback-receipt\.json/,
  "only the sanitized NON_TCG receipt may enter release evidence");
assert.match(workflow,
  /\$\{\{ runner\.temp \}\}\/production-forward-readback-receipt\.json/,
  "the sanitized rollback-target forward-read receipt must enter release evidence");
assert.match(workflow,
  /\$\{\{ runner\.temp \}\}\/production-bridge-forward-readback-receipt\.json/,
  "the sanitized bridge postpromotion receipt must enter release evidence");
assert.match(canonicalReadbackRecheckStep,
  /--verify-canonical-deployment "\$DEPLOYMENT_URL"/,
  "canonical must still name the same deployment after the persisted parity GET");
assert.doesNotMatch(canonicalReadbackRecheckStep,
  /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|METAVERSE_PASSWORD/,
  "the post-readback control-plane recheck needs only Vercel alias authority");
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
assert.match(workflow,
  /actions\/checkout@v5\s*\n\s*with:\s*\n\s*fetch-depth: 2/,
  "the release selector needs the exact commit parent in the checked-out object graph");
assert.equal(
  [...workflow.matchAll(
    /git fetch --no-tags --depth=2 origin main:refs\/remotes\/origin\/main/g
  )].length,
  2,
  "both main-ref freshness checks must retain the selected commit parent"
);
assert.doesNotMatch(workflow, /git fetch --no-tags --depth=1/,
  "a depth-one re-fetch would erase the bridge parent required by selection");
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
  9,
  "capture, build, candidate verification, forward readback, ownership guard, promotion, alias receipt, post-readback recheck, and rollback authenticate independently"
);
assert.match(parityReadback, /provider_calls: 0/,
  "the sanitized receipt must attest the zero-provider persisted-read contract");
assert.match(parityReadback, /production-parity-persisted-readback-receipt-v2/);
assert.match(parityReadback, /production-standard-canonical-naming-readback-receipt-v2/);
assert.match(parityReadback, /function standardEvidence/);
assert.match(parityReadback, /CANONICAL_NAMING_RELEASE_CONTRACT\.composer_version/);
assert.match(parityReadback, /CANONICAL_NAMING_RELEASE_CONTRACT\.marketplace_profile_version/);
assert.match(parityReadback, /export function productionStandardAssetId/);
assert.match(parityReadback, /export function verifyProductionStandardReadback/);
assert.match(parityReadback, /productionStandardP0ResolutionProofValid/);
assert.match(parityReadback, /card_number_exact_match/);
assert.match(parityReadback, /serial_exact_match/);
assert.match(parityReadback, /read_route: "\/api\/csm-resolution-view"/);
assert.doesNotMatch(parityReadback,
  /OPENAI_API_KEY|fetch\(|\/api\/csm-listing-title/,
  "the receipt verifier itself must remain offline and provider-free");
assert.match(forwardReadback, /provider_calls: 0/);
assert.match(forwardReadback, /full_resolution_view_exact_match: true/);
assert.match(forwardReadback, /stored_title_exact_match: true/);
assert.match(forwardReadback, /owner_execution_receipt_exact_match: true/);
assert.match(forwardReadback, /trace_exact_match: true/);
assert.match(forwardReadback, /support_receipts_exact_match: true/);
assert.doesNotMatch(forwardReadback,
  /OPENAI_API_KEY|fetch\(|\/api\/csm-listing-title/,
  "the version-neutral forward-read verifier must remain offline and provider-free");
assert.match(resolutionViewApi, /The GET is a pure read over stored facts/);
assert.match(resolutionViewApi,
  /const readRecord = dependencies\.readRecord \|\| readCsmResolutionRecord;[\s\S]*?await readRecord\(/,
  "the canonical parity endpoint must stay on the durable read path");
assert.match(packageJson.scripts["test:production"], /production-parity-readback\.test\.mjs/,
  "the persisted parity guard must execute in both CI and protected release gates");
assert.match(packageJson.scripts["test:production"], /production-forward-readback\.test\.mjs/,
  "the rollback-target forward reader guard must execute in protected release gates");
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
const candidateMaterializationStep = workflow.slice(candidateSource,
  workflow.indexOf("Build executor-bound large staged transport fixture", candidateSource));
assert.doesNotMatch(candidateMaterializationStep, /VERCEL_TOKEN|VERCEL_AUTOMATION|protection-bypass/i,
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
assert.match(ciWorkflow,
  /actions\/checkout@v5\s*\n\s*with:\s*\n\s*ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*\n(?:\s*#[^\n]*\n)*\s*fetch-depth: 3/,
  "PR CI must test the exact head while retaining the failed bridge and its parent");
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
assert.match(workflow,
  /import \{\s*EXTERNAL_IDENTITY_RELEASE_CONTRACT\s*\} from '\.\/lib\/listing\/knowledge\/csm-external-identity-support\.mjs'/,
  "the immutable candidate gate must import the checked-out external identity release contract");
assert.match(workflow,
  /JSON\.stringify\(h\.runtime\?\.external_identity\)[\s\S]*JSON\.stringify\(EXTERNAL_IDENTITY_RELEASE_CONTRACT\)/,
  "the immutable candidate gate must reject stale pack, index, resolver or Registry release receipts");
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
assert.doesNotMatch(rollbackStep, /PRODUCTION_RELEASE_CLASS|compatibility-bridge/,
  "automatic rollback must remain identical for ordinary and bridge releases");
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
assert.match(packageJson.scripts["test:csm-thin"],
  /external-identity-rollback-bridge\.test\.mjs/,
  "the v2 forward-reader contract must run in every release gate");
assert.match(packageJson.scripts["test:production"],
  /compatibility-bridge-release\.test\.mjs/,
  "the reduced release class must run in every Production release gate");
assert.match(workflow, /RETIRED_LISTING_EXECUTION_PATH/);
assert.match(workflow, /r\.code!=="missing_asset_id"/);
assert.match(workflow, /--data-binary @-/,
  "production smoke credentials must flow over stdin instead of process arguments");
assert.doesNotMatch(workflow, /--data\s+"\$\(node/,
  "production smoke must not expose the password in curl's process arguments");
assert.match(health, /LYNCA_RELEASE_GIT_SHA\s*\|\|\s*process\.env\.VERCEL_GIT_COMMIT_SHA/);
assert.match(health, /LYNCA_RELEASE_GIT_REF\s*\|\|\s*process\.env\.VERCEL_GIT_COMMIT_REF/);
assert.match(health, /canonical_naming_target:\s*CANONICAL_NAMING_RELEASE_CONTRACT_V2/,
  "health must publish the exact target Canonical Naming release contract");
assert.match(health,
  /verified_original_observation:\s*VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT/,
  "health must publish the exact redacted verified-original receipt");
assert.match(workflow,
  /h\.runtime\?\.canonical_naming_target[\s\S]*?CANONICAL_NAMING_RELEASE_CONTRACT_V2/,
  "the immutable candidate must match the exact target Canonical Naming contract before spend");
assert.match(workflow,
  /h\.runtime\?\.verified_original_observation[\s\S]*?VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT/,
  "the immutable candidate must match the exact redacted verified-original receipt before spend");
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
