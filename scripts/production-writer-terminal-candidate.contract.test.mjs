import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [spec, packageJson, workflow] = await Promise.all([
  readFile(new URL("../e2e/production-writer-terminal-candidate.spec.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../.github/workflows/production-writer-journey.yml", import.meta.url), "utf8")
]);

assert.match(spec, /@candidate authenticated 10 \+ 20 Writer Terminal journey/);
assert.match(spec, /createListingSessionToken/);
assert.match(spec, /tenant_acceptance_cos64/);
assert.match(spec, /acceptance-cos64@listing\.lynca\.test/);
assert.match(spec, /role: "OWNER"/,
  "the isolated acceptance principal must fail fast unless it is an active Owner");
for (const permission of ["CREATE_JOB", "SUBMIT_FEEDBACK", "EXPORT_DATA"]) {
  assert.match(spec, new RegExp(`${permission}: "TENANT"`),
    `${permission} must be confirmed before any paid recognition call`);
}
assert.doesNotMatch(spec, /METAVERSE_USERNAME|METAVERSE_PASSWORD|login-password|login-username/,
  "candidate acceptance must not read an operator password");
assert.match(spec, /WRITER_TERMINAL_INITIAL_STORAGE_STATE/,
  "a protected Vercel candidate must keep its candidate-bound bypass cookie");
assert.match(spec, /mode & 0o777\) !== 0o600/,
  "candidate bypass state must be private before the browser reads it");
assert.match(spec, /context\.request\.get\("\/api\/session"/);
assert.match(spec, /authenticated: true/);
assert.match(spec, /CSM_PRODUCTION_SUPABASE_PROJECT_REF/);
assert.match(spec, /resolveTenantIdentityForPrincipal/);
assert.match(spec, /acceptance tenant is not pristine/,
  "paid dispatch must fail before the first call when prior acceptance state remains");
assert.match(spec, /session_version: principal\.sessionVersion/);

assert.match(spec, /manifest\.case_count !== 53/);
assert.match(spec, /projection\.summary\?\.total !== 53/);
assert.match(spec, /PRIMARY_FOR_GAMMA_53_EBAY_COMPOSER/);
for (const digest of [
  "ecb0088b5c2aa1780992fe994cfab9007b57d9961f07031e0c03ad6aad9d9b56",
  "4613d62ed5306ac4c4cc8531274b8035213d8d2bff3f3a73332f7fa96188822c",
  "b95ed769a9a306fd15b67a3e95e0209ad9202c28558b7d6b0feed7e342352f5a"
]) assert.match(spec, new RegExp(digest), "Gamma authority must be content-addressed before dispatch");
assert.match(spec, /manifestSha256 !== pinnedGammaManifestSha256/);
assert.match(spec, /projectionSha256 !== pinnedFounderProjectionSha256/);
assert.match(spec, /manifest\.collection_sha256 !== pinnedGammaCollectionSha256/);
assert.match(spec, /FOUNDER_APPROVED_OVER80_REPLACEMENT/);
assert.match(spec, /reviewedReplacements\.length !== 6/);
assert.match(spec, /fixtureSize - reviewedReplacements\.length/);
assert.match(spec, /reviewed_replacements_covered: fixture\.reviewed_replacements_covered/,
  "all six founder-reviewed replacements must enter the real 30-card journey");
assert.match(spec, /sourceCase\.images\[0\]\?\.role !== "FRONT"/);
assert.match(spec, /sourceCase\.images\[1\]\?\.role !== "BACK"/);
assert.match(spec, /sha256\(buffer\) !== image\.sha256/);
assert.match(spec, /expect\(firstTurn\)\.toHaveLength\(20\)/);
assert.match(spec, /expect\(secondTurn\)\.toHaveLength\(40\)/);
assert.match(spec, /waitForDirectory\(page, \{ assets: 10, results: 10 \}\)/);
assert.match(spec, /waitForDirectory\(page, \{ assets: 30, results: 30 \}\)/);
assert.match(spec, /firstTurnState\.assetIndexes\)\.toEqual\(orderedAssetIndexes\(10\)\)/);
assert.match(spec, /secondTurnState\.resultIndexes\)\.toEqual\(orderedAssetIndexes\(30\)\)/);
assert.match(spec, /cards\.map\(\(card\) => Number\(card\.dataset\.terminalAsset\)\)/);

assert.match(spec, /route\.abort\("connectionfailed"\)/,
  "the controlled failure must happen before a provider request");
assert.match(spec, /code: "ACCEPTANCE_FORCED_ONCE"/);
assert.match(spec, /data-retry-recognition/);
assert.match(spec, /ui_submission_count: 2/);
assert.doesNotMatch(spec, /attempt_count: 2/,
  "a UI retry must not be mislabeled as two provider attempts");
assert.match(spec, /provider_response_id_sha256: sha256\(providerResponseId\)/);
assert.match(spec, /new Set\(dedupedRecognitions\.map\(\(row\) => row\.provider_response_id_sha256\)\)\.size/);
assert.match(spec, /unique_provider_responses: 30/,
  "thirty cards must prove thirty independent provider responses");
assert.match(spec, /assetIndexById\.set\(durableAssetId, assetIndex\)/,
  "direct retry receipts must remain bound to their original directory index");
assert.match(spec, /provider_attempt_number: 1/);
assert.match(spec, /provider_retry_count: 0/);
assert.match(spec, /data-save-title/);
assert.match(spec, /data-reject-title/);
assert.match(spec, /all 30 titles matched; this run cannot prove the durable EDIT path/,
  "an unchanged ACCEPT must not be reported as durable edit evidence");
assert.match(spec, /entry\.expected_title === operationalTitle\(entry\.expected_title\)/,
  "the operational edit must not silently rewrite founder-preserved whitespace");
assert.match(spec, /new Set\(\["EDIT", "REJECT"\]\)/,
  "the authenticated journey must persist one real edit and one rejection");
assert.doesNotMatch(spec, /"CORRECT"/,
  "candidate readback must not invent an unsupported feedback action");
assert.match(spec, /data-workspace-mode="standard"/);
assert.match(spec, /data-workspace-mode="writer"/);
assert.match(spec, /listing-export-workbook/);
assert.match(spec, /workbook\.xlsx\.load/);
assert.match(spec, /exportRequestBytes\)\.toBeLessThanOrEqual\(4_000_000\)/,
  "the real 58-image JSON request must remain below the measured API body ceiling");
assert.match(spec, /expect\(exportImages\)\.toHaveLength\(58\)/);
assert.match(spec, /image\.originalType === "image\/webp"/);
assert.match(spec, /data:image\\\/jpeg;base64/,
  "Gamma WebP originals must carry browser-produced JPEG workbook display bytes");
assert.match(spec, /expect\(workbookMedia\)\.toHaveLength\(58\)/);
assert.match(spec, /entry\.extension === "jpeg"/);
assert.match(spec, /expect\(workbookPackage\.media\)\.toHaveLength\(58\)/);
assert.match(spec, /contentTypes\)\.not\.toMatch\(\/image\\\/webp\/i\)/);
assert.match(spec, /display_derivative_count: 58/);
assert.match(spec, /not\.toMatch\(\/embedDataUrl\|embed_data_url\|data:image\/i\)/,
  "request-scoped JPEG bytes must not be persisted in export item image_refs");
assert.match(spec, /rowCount\)\.toBe\(30\)/,
  "one header plus twenty-nine eligible cards must be present");
assert.match(spec, /exportRequestBody\.rows\.map\(\(row\) => Number\(row\.asset_index\)\)/);
assert.match(spec, /workbookRows\.map\(\(row\) => row\.asset_index\)/);
assert.match(spec, /itemRows\.map\(\(row\) => Number\(row\.asset_index\)\)/);
assert.match(spec, /toEqual\(expectedRequestRows\)/,
  "the export request must preserve every card-title-session tuple");
assert.match(spec, /toEqual\(expectedDurableRows\)/,
  "the workbook and durable items must preserve every normalized title tuple");
assert.match(spec, /expectedImageHashesByIndex/,
  "front/back image hashes must stay bound to each card across request and durable projection");
assert.match(spec, /status: "EDITED"/);
assert.match(spec, /status: "REJECTED"/);
assert.match(spec, /provider_result_summary\?\.csm_owner_versions\?\.owner_execution_receipt_sha256/);
assert.match(spec, /file_size_bytes: workbookBytes\.byteLength/,
  "the READY batch must bind the exact downloaded workbook bytes");
assert.match(spec, /display_derivative_count: 58/,
  "all Gamma WebP images must be represented by compatible display derivatives");
assert.match(spec, /operational_only_never_training/);
assert.match(spec, /requires_independent_persisted_review_event/);
assert.match(spec, /v4_writer_export_batches/);
assert.match(spec, /v4_writer_export_items/);
assert.match(spec, /v4_writer_feedback_events/);
assert.match(spec, /v4_recognition_sessions/);
assert.match(spec, /rejectedAssetIndex\)\)\.toBe\(false\)/);
assert.match(spec, /global_accuracy_claim: null/,
  "a 30-card runtime journey must not masquerade as a global accuracy claim");

assert.match(spec, /download_url_retained: false/);
assert.match(spec, /\[url-redacted\]/);
assert.match(spec, /\[redacted\]/);
assert.doesNotMatch(spec, /evidence\.[^\n]*download_url\s*=/,
  "signed download URLs must not be copied into evidence");
assert.match(spec, /retained_evidence/);
assert.match(spec, /PRESERVE_IMMUTABLE_SYNTHETIC_ACCEPTANCE_TENANT/);
assert.match(spec, /database_cleanup_permitted: false/,
  "append-only Production evidence must not promise an impossible cascade delete");
assert.match(spec, /discovery_window/);
assert.match(spec, /appendUnique\(evidence\.retained_evidence\.recognition_session_ids/,
  "recognition evidence ids must be sealed as each response is captured");
assert.match(spec, /Promise\.allSettled\(\[\.\.\.captureTasks\]\)/,
  "failure evidence must await in-flight response capture before sealing retained ids");
assert.match(spec, /storage_prefix: `tenants\/\$\{tenantId\}\//);

assert.equal(
  packageJson.scripts["check:e2e:writer-terminal-candidate"],
  "node --check e2e/production-writer-terminal-candidate.spec.mjs && node --check scripts/production-writer-terminal-candidate.contract.test.mjs"
);
assert.equal(
  packageJson.scripts["test:e2e:writer-terminal-candidate:contract"],
  "node scripts/production-writer-terminal-candidate.contract.test.mjs"
);
assert.match(packageJson.scripts["test:e2e:writer-terminal-candidate"], /--grep @candidate/);
assert.match(packageJson.scripts["test:e2e:writer-terminal-candidate:chrome"], /--project=chrome/);
assert.match(workflow, /npm run check:e2e:writer-terminal-candidate/);
assert.match(workflow, /npm run test:e2e:writer-terminal-candidate:contract/);
assert.doesNotMatch(workflow, /npm run test:e2e:writer-terminal-candidate(?:\s|$)/,
  "ordinary PR CI must not spend provider calls or mutate the acceptance tenant");

process.stdout.write("production Writer Terminal candidate contract: ok\n");
