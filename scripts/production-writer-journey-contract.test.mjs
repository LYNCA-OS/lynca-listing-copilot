import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [login, index, app, spec, workflow, releaseWorkflow, packageText] = await Promise.all([
  readFile(new URL("../app/login.html", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8"),
  readFile(new URL("../e2e/production-writer-journey.spec.mjs", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/production-writer-journey.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy-production.yml", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);
const packageJson = JSON.parse(packageText);

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
assert.match(spec, /test\.setTimeout\(25 \* 60 \* 1000\)/,
  "four sequential live cases must fit inside the bounded journey budget");
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
assert.match(spec, /writer-journey-cases-v3/);
assert.match(spec, /hasExactKeys\(manifest, \[/,
  "the live manifest root must reject undeclared fields such as a leaked expected title");
assert.match(spec, /WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT/);
assert.match(spec, /parity\.source_asset_id !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT\.source_asset_id/);
assert.match(spec, /parity\.files\.some\(\(file, index\) =>/);
assert.match(spec, /WRITER_JOURNEY_CASES_MANIFEST/);
assert.match(spec, /WRITER_JOURNEY_LARGE_FIXTURE_RECEIPT/);
assert.match(spec, /production-writer-journey-evidence-v5/);
assert.match(spec, /"NON_TCG", "TCG", "EXTERNAL_IDENTITY", "LARGE_STAGED_TRANSPORT"/);
assert.match(spec, /CODEX_PARITY_EXPECTED_TITLE/);
assert.match(spec, /codexParityTitleMatches/);
assert.match(spec, /CODEX_PARITY_MISMATCH/);
assert.match(spec, /externalIdentityParityProof/);
assert.match(spec, /EXTERNAL_IDENTITY_SUPPORT_MISMATCH/);
assert.match(spec, /entry\.files\[0\]\?\.role !== "front_original"/);
assert.match(spec, /entry\.files\[1\]\?\.role !== "back_original"/);
assert.match(spec, /resolution_view_schema/);
assert.match(spec, /csm_owner_versions/);
assert.match(spec, /VERSION_RESOLVER_MISMATCH/);
assert.match(spec, /VERSION_COMPOSER_MISMATCH/);
assert.match(spec, /LIVE_EXECUTION_RECEIPT_MISMATCH/);
assert.match(spec, /ROUTE_COVERAGE_MISMATCH/);
const ordinaryRouteVerifier = spec.match(
  /function validateOrdinaryIngestRequest[\s\S]+?(?=\nfunction normalRouteCoverageReceipt)/
)?.[0] || "";
assert.ok(ordinaryRouteVerifier, "the ordinary ingest request verifier must exist");
assert.match(ordinaryRouteVerifier, /url\.pathname === stagedRecognitionPath/);
assert.match(ordinaryRouteVerifier, /metadata\?\.recognitionInputOnly !== true/);
assert.match(ordinaryRouteVerifier, /!Object\.prototype\.hasOwnProperty\.call\(metadata \|\| \{\}, "originalImages"\)/);
assert.match(ordinaryRouteVerifier, /!Object\.prototype\.hasOwnProperty\.call\(image \|\| \{\}, "sourceImageId"\)/);
const normalRouteVerifier = spec.match(
  /function normalRouteCoverageReceipt[\s\S]+?(?=\nfunction validateSourceCasesManifest)/
)?.[0] || "";
assert.ok(normalRouteVerifier, "the three-lane route coverage verifier must exist");
assert.match(normalRouteVerifier, /payload\?\.recognition_input === "original_inline"/);
assert.match(normalRouteVerifier, /ORDINARY_INGEST_ORIGINAL_INLINE/);
assert.match(normalRouteVerifier, /DIRECT_AFTER_ABORTED_ORDINARY_INGEST/);
assert.match(normalRouteVerifier, /abortedIngest\?\.response_observed === false/);
assert.match(normalRouteVerifier, /direct\?\.recognition_route === "\/api\/csm-listing-title"/);
assert.match(spec, /normalTransport\.active_case_id = sourceCase\.case_id/);
assert.match(spec, /const recognitionPosts = \[\]/);
assert.match(spec, /if \(activeCaseId === "TCG"\)/);
assert.match(spec, /if \(activeCaseId !== "TCG" && caseAttempts\.length !== 1\)/);
assert.match(spec, /attempt\.aborted_before_network = true;\s*await route\.abort\("blockedbyclient"\)/);
assert.match(spec, /normalTransport\.attempts\.filter\(\(entry\) => entry\.aborted_before_network === true\)\.length === 1/);
assert.match(spec, /normalTransport\.attempts\.filter\(\(entry\) => entry\.aborted_before_network === true\)[\s\S]*?entry\.response_observed === false/);
assert.match(spec,
  /normalTransport\.attempts\.filter\(\(entry\) => \([\s\S]*?entry\.recognition_route === "\/api\/csm-listing-title"[\s\S]*?\)\.length !== 1/,
  "a duplicate direct POST in the active normal case must be aborted before network use");
assert.match(spec,
  /if \(recognitionPost\) \{\s*normalTransport\.violation \|\|=[\s\S]*?route\.abort\("blockedbyclient"\)/,
  "a late recognition POST after the active normal case must fail closed");
assert.match(spec, /providerResponseReceiptHashes\.length === 4/);
assert.match(spec, /evidence\.cases\.every\(\(entry\) => entry\.provider_attempt_number === 1[\s\S]*?entry\.provider_retry_count === 0/);
assert.match(spec, /entry\.execution_receipt\?\.execution_origin === "FRESH_CURRENT"/,
  "the final seal must reject replayed, historical, or ambiguous provider results");
assert.match(spec, /offline ordinary route coverage rejects an abort that could reach the provider @offline/);
assert.match(spec, /const expectedEstimatedTokensPerAttempt = 6_500/,
  "the live authority reservation must match the active 6500-token profile exactly");
assert.match(spec, /const serverStageRoundingToleranceMs = 4/,
  "server stage containment may use only the explicit four-millisecond rounding tolerance");
const providerAuthorityReceiptVerifier = spec.match(
  /const providerAuthorityReceiptEvidenceKeys[\s\S]+?(?=\nfunction durableOwnerExecutionReadbackProof)/
)?.[0] || "";
assert.ok(providerAuthorityReceiptVerifier,
  "the authoritative provider-attempt receipt verifier must exist");
for (const field of [
  "schema_version", "operation_key_sha256", "attempt", "attempt_class",
  "estimated_tokens", "claim_code", "settle_code", "operation_status"
]) {
  assert.match(providerAuthorityReceiptVerifier, new RegExp(`"${field}"`));
}
assert.match(providerAuthorityReceiptVerifier,
  /validateCsmProviderAuthorityReceipt\(payload\?\.provider_authority_receipt, \{\s*attempt: 1/,
  "the journey must use the runtime authority validator for the first physical attempt");
assert.match(providerAuthorityReceiptVerifier,
  /hasExactKeys\(receipt, providerAuthorityReceiptEvidenceKeys\)/,
  "the sanitized authority receipt must retain the exact public projection only");
assert.match(providerAuthorityReceiptVerifier,
  /receipt\.schema_version === "csm-provider-authority-receipt-v1"/);
assert.match(providerAuthorityReceiptVerifier, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(receipt\.operation_key_sha256\)/);
assert.match(providerAuthorityReceiptVerifier, /receipt\.attempt === 1/);
assert.match(providerAuthorityReceiptVerifier, /receipt\.attempt_class === "fresh"/);
assert.match(providerAuthorityReceiptVerifier,
  /receipt\.estimated_tokens === expectedEstimatedTokensPerAttempt/);
assert.match(providerAuthorityReceiptVerifier, /receipt\.operation_status === "SUCCEEDED"/);
assert.match(providerAuthorityReceiptVerifier,
  /payload\?\.recognition_session_id[\s\S]*?=== `csmsess_\$\{receipt\.operation_key_sha256\.slice\(0, 40\)\}`/,
  "the database authority operation must bind to the externally observed recognition session");
assert.match(providerAuthorityReceiptVerifier,
  /!Object\.prototype\.hasOwnProperty\.call\(owner, "provider_authority_receipt"\)/,
  "the database authority receipt is HTTP-only and must not masquerade as owner state");
const durableOwnerReadbackVerifier = spec.match(
  /function durableOwnerExecutionReadbackProof[\s\S]+?(?=\nfunction liveServerStageReceipt)/
)?.[0] || "";
assert.ok(durableOwnerReadbackVerifier, "the durable owner receipt readback verifier must exist");
assert.match(durableOwnerReadbackVerifier, /resolutionView\?\.owner_execution_receipt/);
assert.match(durableOwnerReadbackVerifier, /hasExactKeys\(readback, \["version", "sha256"\]\)/);
assert.match(durableOwnerReadbackVerifier,
  /readback\.version === CSM_OWNER_EXECUTION_RECEIPT_VERSION/);
assert.match(durableOwnerReadbackVerifier,
  /readback\.sha256 === executionReceipt\?\.owner_execution_receipt_sha256/);
assert.match(durableOwnerReadbackVerifier, /durable_read_after_write: true/);
const externalIdentityVerifier = spec.match(
  /function externalIdentityParityProof[\s\S]+?(?=\nfunction liveServerStageReceipt)/
)?.[0] || "";
assert.ok(externalIdentityVerifier, "the exact external identity readback verifier must exist");
for (const field of [
  "registry_release", "match_basis", "resolver_version", "conflict_policy_version", "composer_version",
  "marketplace_profile_version", "resolution_contract_sha256", "pack", "index", "record_id",
  "supported_fields", "field_decisions", "sources"
]) {
  assert.match(externalIdentityVerifier, new RegExp(field));
}
assert.match(externalIdentityVerifier, /support\?\.record_id === "tcdb-2551-hr14"/);
assert.match(externalIdentityVerifier, /support\?\.match_basis === "VERIFIED_ORIGINAL_SET"/);
assert.match(externalIdentityVerifier, /support\?\.field_decisions\?\.card_number\?\.action === "FILL"/);
assert.match(externalIdentityVerifier,
  /!Object\.prototype\.hasOwnProperty\.call\(support, "original_set_sha256"\)/);
assert.match(externalIdentityVerifier, /actualSources\.length === expectedSources\.length/);
assert.match(externalIdentityVerifier, /EXTERNAL_IDENTITY_SUPPORT_PACK\.sources/);
assert.match(externalIdentityVerifier, /source_count: actualSources\.length/);
assert.match(spec, /codex_parity_exact_match: true/);
assert.match(spec, /parityCaseEvidence\?\.codex_parity_exact_match === true/);
assert.match(spec, /\.glass-box-external-sources a/);
assert.doesNotMatch(spec, /codex_parity_title\s*:/,
  "the exact target title must never enter uploaded evidence");
const publicPayloadBoundary = spec.match(
  /function publicRecognitionPayloadBoundary[\s\S]+?(?=\nfunction liveExecutionReceiptProof)/
)?.[0] || "";
assert.ok(publicPayloadBoundary, "every live route must verify the public recognition projection");
for (const forbidden of [
  "external_identity_support", "csm_persistence_checkpoint", "accuracy_loss_ledger",
  "observed_fields", "resolution_contract", "original_set_sha256", "source_ref"
]) {
  assert.match(publicPayloadBoundary, new RegExp(forbidden));
}
assert.match(publicPayloadBoundary, /hasExactKeys\(payload\.csm_rows, \["output", "resolution"\]\)/);
assert.match(publicPayloadBoundary, /hasExactKeys\(payload\.csm_persistence, \["atomic", "ok", "session"\]\)/);
const executionReceiptVerifier = spec.match(
  /function liveExecutionReceiptProof[\s\S]+?(?=\nfunction assertNoPrivateFixtureKeys)/
)?.[0] || "";
assert.ok(executionReceiptVerifier, "the live execution receipt verifier must exist");
assert.match(executionReceiptVerifier, /publicRecognitionPayloadBoundary\(payload, code\)/);
assert.match(executionReceiptVerifier, /payload\?\.execution_origin === "FRESH_CURRENT"/);
assert.match(executionReceiptVerifier,
  /!Object\.prototype\.hasOwnProperty\.call\(owner, "execution_origin"\)/,
  "execution origin is request provenance and must not be inherited from the session patch");
for (const field of [
  "model_profile_id",
  "optimization_pack_id",
  "optimization_pack_sha256",
  "provider_adapter_version",
  "request_builder_version",
  "response_parser_version",
  "transport_profile_id",
  "transport_profile_sha256",
  "execution_contract_sha256",
  "max_output_tokens"
]) {
  assert.match(executionReceiptVerifier, new RegExp(`${field}:`));
}
assert.match(executionReceiptVerifier, /payload\?\.\[key\] === expected && owner\?\.\[key\] === expected/,
  "every executable version must match the response's atomically saved session patch candidate");
assert.match(executionReceiptVerifier, /validateCsmModelExecutionContract\(payload\?\.execution_contract/);
assert.match(executionReceiptVerifier, /validateCsmModelExecutionContract\(owner\?\.execution_contract/);
assert.match(executionReceiptVerifier,
  /expectedExecutionContractSha256ByTransportLaneAndImageCount\[laneVersion\]\?\.\[String\(imageCount\)\]/);
assert.match(executionReceiptVerifier, /CSM_RECOGNITION_TRANSPORT_PROFILES\.includes\(transportProfile\)/,
  "a live receipt must bind one registered transport lane");
assert.match(executionReceiptVerifier, /sha256CsmRecognitionTransportReceipt\(transportProfile\)/,
  "the sanitized receipt must carry the exact transport profile hash");
assert.match(spec, /const expectedMaxOutputTokens = 8192/);
assert.match(executionReceiptVerifier, /provider_response_status_attested === true[\s\S]*?provider_response_status === "completed"/);
assert.match(executionReceiptVerifier, /owner\?\.provider_response_status === "completed"/);
assert.match(executionReceiptVerifier, /owner\?\.provider_response_id === providerResponseId/);
assert.match(executionReceiptVerifier, /Number\.isSafeInteger\(payload\?\.\[key\]\)/);
assert.match(executionReceiptVerifier, /payload\.input_tokens > 0[\s\S]*?payload\.output_tokens > 0[\s\S]*?payload\.total_tokens > 0/);
assert.match(executionReceiptVerifier, /owner\?\.provider_attempt_number === 1/);
assert.match(executionReceiptVerifier, /owner\?\.provider_retry_count === 0/);
assert.match(executionReceiptVerifier, /computeCsmOwnerExecutionReceiptSha256\(owner\)/,
  "the response owner receipt must self-verify before the separate durable readback");
assert.match(executionReceiptVerifier,
  /computedOwnerExecutionReceiptSha256 === ownerExecutionReceiptSha256/);
assert.match(executionReceiptVerifier, /providerAuthorityReceiptProof\(payload, owner, code\)/);
assert.match(executionReceiptVerifier, /payload\?\.served_model === null && owner\?\.served_model === null/,
  "unattested served model must remain an honest null in both receipts");
assert.match(executionReceiptVerifier, /payload\?\.served_effort === null && owner\?\.reasoning_effort === null/,
  "unattested served effort must remain an honest null in both receipts");
const executionEvidenceLiteral = executionReceiptVerifier.match(
  /const proof = \{[\s\S]+?\n  \};/
)?.[0] || "";
assert.ok(executionEvidenceLiteral, "the sanitized execution evidence literal must exist");
assert.match(executionEvidenceLiteral, /provider_response_id_present: true/);
assert.match(executionEvidenceLiteral, /provider_response_id_sha256: sha256\(providerResponseId\)/);
assert.match(executionEvidenceLiteral, /execution_origin: "FRESH_CURRENT"/);
assert.match(executionEvidenceLiteral,
  /owner_execution_receipt_version: ownerExecutionReceiptVersion/);
assert.match(executionEvidenceLiteral,
  /owner_execution_receipt_sha256: ownerExecutionReceiptSha256/);
assert.match(executionEvidenceLiteral,
  /provider_authority_receipt: providerAuthorityReceipt/);
assert.match(executionEvidenceLiteral, /server_stages_ms: liveServerStageReceipt\(payload, code\)/);
assert.match(executionEvidenceLiteral, /response_session_patch_fields_match: true/);
assert.doesNotMatch(executionEvidenceLiteral, /\bprovider_response_id\s*:/,
  "the raw provider response id must not enter the uploaded evidence");
assert.doesNotMatch(executionEvidenceLiteral, /\bexecution_contract\s*:/,
  "the embedded request contract must be proven by hash, not copied into evidence");
assert.doesNotMatch(executionEvidenceLiteral, /estimated_tokens/,
  "the reservation may enter evidence only through the validated nested authority receipt");
const serverStageVerifier = spec.match(
  /const requiredServerStageNames[\s\S]+?(?=\nfunction warmupResponseReceipt)/
)?.[0] || "";
assert.ok(serverStageVerifier, "the server-stage receipt verifier must exist");
for (const stage of [
  "authority_enqueue_ms", "authority_claim_ms", "authority_settle_ms",
  "authority_dispatch_ms", "provider_ms", "csm_persistence_ms", "request_total_ms"
]) {
  assert.match(serverStageVerifier, new RegExp(`"${stage}"`));
}
assert.match(serverStageVerifier,
  /typeof value === "number" && Number\.isFinite\(value\) && value >= 0/);
assert.match(serverStageVerifier,
  /receipt\.request_total_ms >= receipt\[name\]/);
assert.match(serverStageVerifier,
  /receipt\.authority_dispatch_ms >= receipt\.provider_ms/);
assert.match(serverStageVerifier,
  /"authority_enqueue_ms", "authority_claim_ms", "provider_ms", "authority_settle_ms"/);
assert.match(serverStageVerifier,
  /receipt\.authority_dispatch_ms \+ serverStageRoundingToleranceMs[\s\S]*?>= authoritySequentialMs/,
  "the dispatch wall must contain enqueue, claim, provider, and settle sequential work");
assert.match(serverStageVerifier,
  /receipt\.request_total_ms[\s\S]*?>= receipt\.authority_dispatch_ms \+ receipt\.csm_persistence_ms/);
assert.match(spec, /value\.latency_stages_ms\.authority_enqueue_ms = -1/,
  "offline counterexamples must reject a negative server stage");
assert.match(spec, /delete value\.latency_stages_ms\.request_total_ms/,
  "offline counterexamples must reject an absent required server stage");
assert.match(spec, /value\.latency_stages_ms\.authority_claim_ms = 20/,
  "offline counterexamples must reject sequential authority work larger than dispatch");
assert.match(spec,
  /stagedServerStages\.request_total_ms \+ serverStageRoundingToleranceMs[\s\S]*?< stagedServerStages\.authority_dispatch_ms[\s\S]*?\+ stagedOriginalSyncMs[\s\S]*?\+ stagedServerStages\.csm_persistence_ms/,
  "the large request wall must contain dispatch, original synchronization, and persistence");
assert.match(spec, /staged_original_sync_ms: 20/,
  "offline counterexamples must reject an impossible large staged timeline");
assert.equal([...spec.matchAll(/execution_receipt: executionReceipt/g)].length, 2,
  "normal and staged cases must both persist the sanitized live receipt proof");
assert.equal([
  ...spec.matchAll(/owner_execution_readback: (?:ownerExecutionReadback|largeOwnerExecutionReadback)/g)
].length, 2,
"normal and staged cases must both persist a separately verified database readback receipt");
assert.match(spec, /imageCount: sourceCase\.image_count/,
  "each normal case must verify the exact image-count execution contract");
assert.match(spec, /providerResponseReceiptHashes[\s\S]*?new Set\(providerResponseReceiptHashes\)\.size === evidence\.cases\.length/,
  "all four cases must carry distinct provider response receipts");
assert.match(spec, /!offlineExecutionArtifact\.includes\(offlineProviderResponseId\)/);
assert.match(spec, /!offlineExecutionArtifact\.includes\('\"provider_response_id\":'\)/);
assert.match(spec, /!offlineExecutionArtifact\.includes\('\"execution_contract\":'\)/);
assert.match(spec, /attestedExecutionProof\.served_model_attested === true[\s\S]*?attestedExecutionProof\.served_effort_attested === true/,
  "offline fixtures must exercise both attested and honest-null served receipts");
assert.match(spec,
  /offlineOwnerReadback\.durable_read_after_write === true/,
  "the offline contract must exercise a successful durable owner receipt readback");
assert.match(spec,
  /durableOwnerExecutionReadbackProof\(offlineExecutionProof, \{[\s\S]*?owner_execution_receipt:/,
  "the readback proof must consume the resolution-view projection, not the write response object");
for (const drift of [
  /delete value\.provider_authority_receipt/,
  /value\.provider_authority_receipt\.estimated_tokens = 6_499/,
  /value\.provider_authority_receipt\.attempt_class = "retry"/,
  /value\.provider_authority_receipt\.operation_status = "FAILED"/,
  /value\.recognition_session_id = `csmsess_\$\{"b"\.repeat\(40\)\}`/,
  /value\.csm_owner_versions\.owner_execution_receipt_sha256 = "0"\.repeat\(64\)/
]) {
  assert.match(spec, drift, `missing authority or owner receipt drift counterexample: ${drift}`);
}
assert.match(spec, /receiptDriftMutators/);
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
assert.match(spec, /!parityArtifact\.includes\(CODEX_PARITY_EXPECTED_TITLE\)/,
  "the Codex parity answer may be compared in memory but never uploaded as evidence");
assert.match(spec, /error_code = errorCode/);
assert.match(spec, /evidence\.failed_case_id = liveFailureCaseIds\.has\(failureCaseId\)/);
assert.match(spec, /evidence\.failed_phase = liveFailurePhases\.has\(failurePhase\)/);
assert.match(spec, /await Promise\.allSettled\(\[\.\.\.pendingPageWaits\]\)/,
  "teardown must own pending page waits instead of emitting a secondary target-closed failure");
assert.doesNotMatch(spec, /evidence\.error\s*=/);
assert.doesNotMatch(spec, /String\(error\?\.message \|\| error\)/);
assert.match(spec, /PRIVATE EXPECTED TITLE/,
  "the offline counterexample must prove unsafe matcher text is not serialized");
assert.match(spec, /cookieDomainMatches/);
assert.match(spec, /cookiePathMatches/);
assert.match(spec, /canonicalProductionOrigin = "https:\/\/listing\.lyncafei\.team"/);
assert.match(spec,
  /cookieHeaderForUrl\(cookieState, `\$\{canonicalProductionOrigin\}\/api\/health`/,
  "offline cookie scope checks must stay canonical when the live target is an immutable candidate");
assert.match(spec, /\^\[a-z0-9-\]\+\\\.vercel\\\.app\$/,
  "an unpromoted release target must be an exact Vercel candidate hostname");
assert.match(spec, /function candidateStorageStateBoundToTarget/);
assert.match(spec, /String\(cookie\?\.domain \|\| ""\)\.toLowerCase\(\) === url\.hostname/,
  "candidate authorization cookies must not be usable by sibling or canonical domains");
assert.match(spec, /domain: "\.vercel\.app"/,
  "the offline counterexample must reject a broad Vercel cookie domain");
assert.match(spec, /serviceWorkers: "block"/,
  "service workers must not bypass the pre-spend staged request gate");
assert.doesNotMatch(spec, /\bapiPaths\b/,
  "an unused path accumulator is not production participation evidence");
assert.match(spec, /function healthRecognitionTransportContractMatches/,
  "the live journey must bind every deployed transport profile before upload");
assert.match(spec, /runtime\?\.recognition_transport_profiles\?\.\[lane\]/);
assert.match(spec,
  /runtime\?\.execution_contract_sha256_by_transport_lane_and_image_count\?\.\[lane\]\?\.\["1"\]/);
assert.match(spec, /healthRecognitionTransportContractMatches\(health\?\.runtime\)/);
assert.match(spec, /function healthExternalIdentityContractMatches/);
assert.match(spec, /runtime\?\.external_identity/);
assert.match(spec, /healthExternalIdentityContractMatches\(health\?\.runtime\)/);
assert.match(spec, /healthExternalIdentityContractMatches\(finalHealth\?\.runtime\)/);
assert.match(spec,
  /const expectedProviderAdapterContract = resolveCsmProviderAdapter\(\s*CSM_ACTIVE_MODEL_PROFILE\.provider\s*\)\.contract/,
  "the journey must verify the adapter resolved by the active model profile");
assert.match(spec, /const expectedProviderAdapterVersion = expectedProviderAdapterContract\.id/);
assert.match(spec, /health\?\.runtime\?\.provider_adapter_version === expectedProviderAdapterVersion/);
assert.doesNotMatch(spec, /CSM_OPENAI_RESPONSES_ADAPTER_VERSION/,
  "the journey must remain portable across registered provider adapters");
assert.match(spec, /journeyContext\.route\("\*\*\/api\/csm-listing-title\*\*"/);
assert.match(spec, /pathname === "\/api\/csm-listing-title" && method === "GET"[\s\S]*?warmupTransport\.requests\.push/,
  "GET warmup must be tracked separately from recognition POSTs");
assert.match(spec, /activeCaseId && method === "POST"/,
  "only POST requests may count as normal recognition attempts");
assert.match(spec, /method !== "POST" \|\| pathname !== stagedRecognitionPath/,
  "only staged POST requests may enter the large recognition gate");
assert.match(spec, /function warmupResponseReceipt[\s\S]*?responses\.length >= 1/,
  "at least one real warmup response must be sealed");
assert.match(spec, /entry\.response_status >= 100[\s\S]*?entry\.response_status <= 599/);
assert.match(spec, /evidence\.stages\.warmup = warmupResponseReceipt\(warmupTransport\.requests\)/);
assert.match(spec, /route\.abort\("blockedbyclient"\)/,
  "an invalid staged request must be stopped before it reaches the provider boundary");
assert.match(spec, /url\.pathname !== stagedRecognitionPath/);
assert.match(spec, /request\.postDataBuffer\(\)/);
assert.match(spec, /x-lynca-ingest-metadata/);
assert.match(spec, /recognitionInputOnly !== true/);
assert.match(spec, /client_original_upload_elapsed_at_dispatch_ms/);
assert.match(spec, /Object\.prototype\.hasOwnProperty\.call\(timing, "client_original_upload_ms"\)/);
assert.match(spec, /metadata\.contentSha256 !== expected\.content_sha256/);
assert.match(spec, /payload\?\.relay_timing\?\.browser_body_bytes !== expected\.bytes/);
assert.match(spec, /payload\?\.asset_id !== assetId/);
assert.match(spec, /payload\?\.upload\?\.image_id !== imageId/);
assert.match(spec, /external_storage_puts === 0/,
  "the large fixture must use two relays rather than a signed-Storage fallback");
assert.match(spec, /validateLargeRecoveryAuthorization/);
assert.match(spec, /recoveryAuthorization\?\.allows_second_request !== true/);
assert.match(spec, /metadata\.resumeOnly !== recoveryAuthorization\.resume_only/);
assert.match(spec, /const recognitionOutcome = await Promise\.race/,
  "a blocked pre-spend request must fail immediately instead of waiting for the success timeout");
const largeResponseWait = spec.match(
  /const largeRecognitionResponsePromise = ownPageWait\(journeyPage\.waitForResponse[\s\S]+?\), \{ timeout: 6 \* 60 \* 1000 \}\)\);/
)?.[0] || "";
assert.ok(largeResponseWait, "the large response wait must exist");
assert.doesNotMatch(largeResponseWait, /response\.ok\(\)/,
  "the first staged error response must fail immediately, not be ignored while awaiting a later success");
assert.match(spec, /largeRecognitionResponse\.status\(\) === 200 && largeRecognitionResponse\.ok\(\)/);
assert.match(spec, /requestIndex !== 0/,
  "the live staged journey must reject any recovery request after the first response");
assert.match(spec, /largeTransport\.ingest_requests\.length === 1[\s\S]*?largeTransport\.ingest_responses\.length === 1/);
assert.match(spec, /journeyContext\.route\("\*\*\/api\/listing-image-upload-relay"/);
assert.match(spec, /largeTransport\.relay_requests\.length >= 2[\s\S]*?route\.abort\("blockedbyclient"\)/,
  "a third relay request must fail before network use");
assert.match(spec, /started_count: relayStarted[\s\S]*?completed_count: relayCompleted[\s\S]*?incomplete_count: relayStarted - relayCompleted/);
assert.match(spec, /relayTimelineSnapshot\.started_count < 1/);
assert.match(spec, /relayTimelineSnapshot\.incomplete_count < 1/);
assert.match(spec, /relay\.durable_response_sequence < recognitionResponseSequence/,
  "both durable relay responses must precede the successful recognition response");
assert.match(spec, /relay_durable_before_recognition_response: true/);
assert.match(spec, /largeTransport\.recognition_response_events\.length === 1/);
assert.match(spec, /largeTransport\.relay_requests\.length === 2/);
assert.match(spec, /largeTransport\.relay_requests\.every\(\(entry\) => entry\.response_observed === true\)/);
const largeIngestRequestVerifier = spec.match(
  /function validateLargeIngestRequest[\s\S]+?(?=\nfunction validateOrdinaryIngestRequest)/
)?.[0] || "";
assert.ok(largeIngestRequestVerifier, "the large staged request verifier must exist");
assert.doesNotMatch(largeIngestRequestVerifier, /imageDetail/,
  "the WJ pre-spend gate must not require the retired client image-detail knob");
const ingestFastPath = app.match(
  /async function requestCsmIngestFastPath[\s\S]+?(?=\nfunction |\nasync function )/
)?.[0] || "";
assert.ok(ingestFastPath, "the production staged ingest client must exist");
assert.doesNotMatch(ingestFastPath, /imageDetail/,
  "the production client must not regain a model-owned transport knob");
const offlineIngestMetadata = spec.match(
  /const ingestMetadata = \{[\s\S]+?(?=\n  const ingestBody)/
)?.[0] || "";
assert.ok(offlineIngestMetadata, "the offline staged metadata fixture must exist");
assert.doesNotMatch(offlineIngestMetadata, /imageDetail/,
  "the offline fixture must match the metadata emitted by Production");
assert.match(spec, /function recognitionPostSeal/);
assert.match(spec, /recognitionPosts\.length === 5/);
assert.match(spec, /continued\.length === 4/);
assert.match(spec, /aborted\.length === 1/);
assert.match(spec, /new Set\(continued\.map\(\(entry\) => entry\.recognition_session_id\)\)\.size === 4/);
assert.match(spec, /evidenceCases\.every\(\(caseEvidence\) => continued\.filter/);
assert.match(spec, /caseEvidence\.recognition_session_id === entry\.recognition_session_id/);
assert.match(spec,
  /caseEvidence\.execution_receipt\?\.provider_response_id_sha256[\s\S]*?=== entry\.provider_response_id_sha256/,
  "every network-continued recognition POST must bind to one sanitized evidence receipt");
assert.match(spec, /relayAssetIds\.size !== 1 \|\| !relayAssetIds\.has\(payload\?\.asset_id\)/);
assert.match(spec, /relay\?\.image_id === original\?\.image_id/,
  "relay bytes must bind to the exact role and image id used by recognition");
assert.match(spec, /immutable_manifest_sha256/,
  "an authorized recovery must preserve the exact original, derived, and body manifest");
assert.match(spec, /firstRequest && metadata\.resumeOnly !== false/,
  "the first staged request must never enter through a resume-only shape");
assert.match(spec, /owner\?\.reasoning_effort_attested === payload\.served_effort_attested/,
  "top-level and durable effort attestation must agree");
assert.match(spec, /largeTransport\.phase_complete = true/);
assert.match(spec, /await journeyContext\.close\(\);\s*journeyContext = null;/,
  "the browser context must close before the final late-request seal is accepted");
assert.match(spec, /ingest_requests\.length === largeTransport\.ingest_responses\.length/);
assert.match(spec, /ownerSession\?\.role === "OWNER"/,
  "synthetic Production feedback must stop before provider use unless the actor is OWNER");
assert.match(spec, /feedback_data_use === "ADMIN_TEST_ONLY"/);
assert.match(spec, /training_eligible === false/);
assert.match(spec, /production_promotion_eligible === false/);
assert.match(spec, /case_id: "LARGE_STAGED_TRANSPORT"/);
assert.match(spec, /transport_only: true/);
assert.match(spec, /fixture_receipt_sha256/);
assert.doesNotMatch(spec, /largeFixture\.receipt\.(?:source|originals|derived)/,
  "the uploaded live evidence must not copy fixture bytes, paths, or per-image hashes");
assert.doesNotMatch(spec, /getByTestId\("writer-persistence-status"\).*toBeVisible/);
assert.match(spec, /deployment_id/);
assert.match(spec, /evidence\.final_seal = \{/);
assert.match(spec,
  /const providerAuthorityOperationHashes = evidence\.cases\.map/);
assert.match(spec,
  /new Set\(providerAuthorityOperationHashes\)\.size === evidence\.cases\.length/,
  "all four cases must bind distinct database authority operations");
assert.match(spec,
  /entry\.recognition_session_id === `csmsess_\$\{[\s\S]*?operation_key_sha256\.slice\(0, 40\)/,
  "the final seal must recompute the session binding instead of trusting a boolean");
const finalCaseReceiptSealStart = spec.indexOf(
  "requireInvariant(evidence.cases.every((entry) => (\n      hasExactKeys(entry.execution_receipt?.server_stages_ms"
);
const finalCaseReceiptSealEnd = spec.indexOf(
  "    verifierErrorCodes.LIVE_EXECUTION_RECEIPT_MISMATCH);",
  finalCaseReceiptSealStart
);
assert.ok(finalCaseReceiptSealStart >= 0 && finalCaseReceiptSealEnd > finalCaseReceiptSealStart,
  "the final per-case execution receipt seal must exist");
const finalCaseReceiptSeal = spec.slice(finalCaseReceiptSealStart, finalCaseReceiptSealEnd);
assert.match(finalCaseReceiptSeal,
  /hasExactKeys\([\s\S]*?provider_authority_receipt,[\s\S]*?providerAuthorityReceiptEvidenceKeys/,
  "all four cases must retain the exact authority receipt projection");
assert.match(finalCaseReceiptSeal, /provider_authority_receipt\.schema_version[\s\S]*?csm-provider-authority-receipt-v1/);
assert.match(finalCaseReceiptSeal,
  /provider_authority_receipt\?\.estimated_tokens[\s\S]*?expectedEstimatedTokensPerAttempt/);
assert.match(finalCaseReceiptSeal, /provider_authority_receipt\?\.attempt === 1/);
assert.match(finalCaseReceiptSeal, /provider_authority_receipt\?\.attempt_class === "fresh"/);
assert.match(finalCaseReceiptSeal, /provider_authority_receipt\?\.operation_status === "SUCCEEDED"/);
assert.match(finalCaseReceiptSeal, /owner_execution_readback\?\.durable_read_after_write === true/);
assert.match(finalCaseReceiptSeal,
  /owner_execution_readback\?\.sha256[\s\S]*?owner_execution_receipt_sha256/,
  "all four cases must match the database readback hash to the response owner receipt");
for (const field of [
  "provider_case_count: 4",
  "fresh_current_case_count: 4",
  "distinct_provider_authority_operations: true",
  "complete_server_stage_receipts: true",
  "exact_authority_token_reservation: expectedEstimatedTokensPerAttempt",
  "durable_owner_execution_readback_count: 4",
  "codex_parity_exact_match_count: 1",
  "verified_original_set_match_count: 1",
  "warmup_real_response_observed: true",
  "staged_overlap_observed: true",
  "staged_relays_durable_before_recognition_response: true",
  "...recognitionPostReceipt"
]) {
  assert.ok(spec.includes(field), `final seal missing ${field}`);
}
const initialHealthVerifier = spec.match(
  /requireInvariant\(health\?\.ready === true[\s\S]+?verifierErrorCodes\.RUNTIME_CONTRACT_MISMATCH\);/
)?.[0] || "";
assert.ok(initialHealthVerifier, "the initial runtime health verifier must exist");
assert.match(initialHealthVerifier, /retired_capabilities_disabled === true/);
assert.doesNotMatch(spec,
  /cloud_run_calls|vector_calls|generic_ocr_calls/,
  "hard-coded retired call counters are not dynamic Production execution evidence");
assert.match(spec, /WRITER_JOURNEY_INITIAL_STORAGE_STATE/,
  "a storage state may be used only after cookies are matched to the exact journey URL");
assert.match(spec, /deployment\?\.environment[\s\S]*?\.toBe\("production"\)/,
  "ordinary Preview must not masquerade as a production-target candidate");
assert.equal([...spec.matchAll(/baseURL: baseUrl/g)].length, 2, "both browser contexts must use the normalized production base URL");
assert.doesNotMatch(spec, /\{\s*baseURL\s*[,}]/, "undefined baseURL shorthand must never reach production E2E");
for (const id of ["request_ids", "asset_ids", "batch_ids", "job_ids", "session_ids"]) {
  assert.match(spec, new RegExp(id));
}
assert.doesNotMatch(spec, /launch_ready\s*=/i);
assert.doesNotMatch(spec, /update.*launch_ready/i);
assert.doesNotMatch(workflow,
  /workflow_run|environment:\s*production|METAVERSE_USERNAME|METAVERSE_PASSWORD|SUPABASE_SERVICE_ROLE_KEY/,
  "the PR workflow must remain an offline contract gate without Production credentials");
assert.match(releaseWorkflow, /METAVERSE_USERNAME: \$\{\{ secrets\.METAVERSE_USERNAME \}\}/);
assert.match(releaseWorkflow, /METAVERSE_PASSWORD: \$\{\{ secrets\.METAVERSE_PASSWORD \}\}/);
assert.match(releaseWorkflow,
  /name: Run real candidate Writer Journey before production promotion[\s\S]*?METAVERSE_USERNAME:[\s\S]*?METAVERSE_PASSWORD:/,
  "writer credentials must be scoped to the live browser step, not npm install or Storage materialization");
assert.equal([...releaseWorkflow.matchAll(/METAVERSE_USERNAME: \$\{\{ secrets\.METAVERSE_USERNAME \}\}/g)].length, 2,
  "credentials are limited to the candidate journey and post-promotion auth smoke");
assert.equal([...releaseWorkflow.matchAll(/METAVERSE_PASSWORD: \$\{\{ secrets\.METAVERSE_PASSWORD \}\}/g)].length, 2,
  "credentials are limited to the candidate journey and post-promotion auth smoke");
assert.match(releaseWorkflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
assert.match(releaseWorkflow, /materialize-writer-journey-source\.mjs/);
assert.match(releaseWorkflow, /WRITER_JOURNEY_CASES_MANIFEST=%s\\n/);
assert.match(releaseWorkflow, /Build executor-bound large staged transport fixture/);
assert.match(releaseWorkflow, /build-large-internal-writer-fixture\.mjs/);
assert.match(releaseWorkflow, /install -d -m 700 "\$fixture_parent"/);
assert.match(releaseWorkflow, /WRITER_JOURNEY_LARGE_FIXTURE_RECEIPT=%s\\n/);
assert.match(releaseWorkflow, /writer-journey-cases-v3\.json/);
assert.match(releaseWorkflow, /writer-journey-large-source-v2\.json/);
assert.match(releaseWorkflow, /Materialize fixed NON_TCG TCG and exact parity cases/);
assert.match(releaseWorkflow, /manifest\.schema_version !== 'writer-journey-cases-v3'/);
assert.match(releaseWorkflow, /parity\.source_asset_id !== contract\.source_asset_id/);
assert.match(releaseWorkflow, /flag: 'wx', mode: 0o600/,
  "the large-builder subset must be a newly created owner-only file");
assert.match(releaseWorkflow, /WRITER_JOURNEY_LARGE_SOURCE_MANIFEST=%s\\n/);
assert.match(workflow, /--grep @offline/);
for (const fixturePath of [
  "scripts/build-large-internal-writer-fixture.mjs",
  "scripts/build-large-internal-writer-fixture.contract.test.mjs",
  "scripts/build-large-internal-writer-fixture.browser.test.mjs"
]) {
  assert.ok(workflow.includes(`- "${fixturePath}"`), `${fixturePath} must trigger the PR gate`);
}
for (const releaseContractPath of [
  "scripts/production-release-boundaries.test.mjs",
  "scripts/vercel-protected-health.test.mjs",
  "scripts/vercel-production-rollback-receipt.mjs",
  "scripts/vercel-production-rollback-receipt.test.mjs"
]) {
  assert.ok(workflow.includes(`- "${releaseContractPath}"`),
    `${releaseContractPath} must trigger the offline PR release contract`);
}
const contractJob = workflow.match(/\n  contract:\n[\s\S]+$/)?.[0] || "";
assert.ok(contractJob, "the PR contract job must exist");
const contractNpmCi = contractJob.indexOf("- run: npm ci");
const contractChromiumInstall = contractJob.indexOf(
  "- run: npx playwright install --with-deps chromium"
);
const fixtureContractGate = contractJob.indexOf(
  "- run: npm run test:large-internal-writer-fixture:contract"
);
const fixtureBrowserCommand = "- run: npm run test:large-internal-writer-fixture:browser";
const fixtureBrowserGate = contractJob.indexOf(
  fixtureBrowserCommand
);
assert.ok(contractNpmCi >= 0
  && contractChromiumInstall > contractNpmCi
  && fixtureContractGate > contractChromiumInstall
  && fixtureBrowserGate > fixtureContractGate,
  "the PR contract job must use the lockfile-selected Chromium for the same-executor fixture gate");
assert.equal(contractJob.split(fixtureBrowserCommand).length - 1, 1,
  "the PR contract job must run the browser gate exactly once");
assert.match(contractJob,
  /node scripts\/production-release-boundaries\.test\.mjs && node scripts\/vercel-protected-health\.test\.mjs && node scripts\/vercel-production-rollback-receipt\.test\.mjs/,
  "the PR gate must verify candidate authorization and rollback without Production credentials");
assert.doesNotMatch(workflow, /LARGE_FIXTURE_TEST_CHROMIUM_EXECUTABLE/,
  "standard CI must not replace the Playwright-selected executor");
const candidateJourney = releaseWorkflow.indexOf(
  "Run real candidate Writer Journey before production promotion"
);
const promotion = releaseWorkflow.indexOf(
  "Promote the verified immutable deployment to production"
);
assert.ok(candidateJourney >= 0 && promotion > candidateJourney,
  "the paid Writer Journey must gate promotion of the same immutable candidate");
assert.match(releaseWorkflow, /WRITER_JOURNEY_BASE_URL=%s\\n' "\$DEPLOYMENT_URL"/);
assert.match(releaseWorkflow, /WRITER_JOURNEY_EXPECTED_SHA=%s\\n' "\$DISPATCH_SHA"/);
assert.match(releaseWorkflow, /WRITER_JOURNEY_INITIAL_STORAGE_STATE=%s\\n/);
assert.match(releaseWorkflow, /--storage-state "\$candidate_storage_state"/);
assert.match(releaseWorkflow, /name: Destroy candidate browser authorization\n\s*if: always\(\)/);
assert.doesNotMatch(releaseWorkflow.slice(promotion),
  /npm run test:e2e:production-writer-journey|OPENAI_API_KEY/,
  "post-promotion checks must add no provider attempt");
assert.doesNotMatch(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /LAUNCH_GATE_EVAL_SECRET/);
assert.doesNotMatch(spec, /launch-gate-source-images/);
assert.match(spec, /expect\(health\?\.deployment\?\.git_commit_sha[\s\S]*?\.toBe\(expectedSha\)/);
assert.match(spec, /expect\(finalHealth\?\.deployment\?\.git_commit_sha[\s\S]*?\.toBe\(expectedSha\)/);
assert.doesNotMatch(spec, /recordHar|\.tracing\.|failure\.png|journey\.har/);
assert.doesNotMatch(workflow, /test-results\/production-writer-journey/);
assert.match(packageJson.scripts["test:e2e:production-writer-journey"], /--grep-invert @offline/,
  "the paid candidate command must run only the live journey, never its offline counterexamples");
assert.doesNotMatch(releaseWorkflow,
  /VERCEL_AUTOMATION_BYPASS_SECRET|x-vercel-protection-bypass|x-vercel-set-bypass-cookie/,
  "the bypass value must never enter workflow YAML, logs, or a global browser header");

console.log("production writer journey contract tests passed");
