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
assert.doesNotMatch(spec, /METAVERSE_USERNAME|METAVERSE_PASSWORD|login-password|login-username/,
  "candidate acceptance must not read an operator password");
assert.match(spec, /WRITER_TERMINAL_INITIAL_STORAGE_STATE/,
  "a protected Vercel candidate must keep its candidate-bound bypass cookie");
assert.match(spec, /context\.request\.get\("\/api\/session"/);
assert.match(spec, /authenticated: true/);

assert.match(spec, /manifest\.case_count !== 53/);
assert.match(spec, /projection\.summary\?\.total !== 53/);
assert.match(spec, /PRIMARY_FOR_GAMMA_53_EBAY_COMPOSER/);
assert.match(spec, /projection\.cases\.slice\(0, fixtureSize\)/,
  "the first 30 cases are selected in founder title-authority order");
assert.match(spec, /sourceCase\.images\[0\]\?\.role !== "FRONT"/);
assert.match(spec, /sourceCase\.images\[1\]\?\.role !== "BACK"/);
assert.match(spec, /sha256\(buffer\) !== image\.sha256/);
assert.match(spec, /expect\(firstTurn\)\.toHaveLength\(20\)/);
assert.match(spec, /expect\(secondTurn\)\.toHaveLength\(40\)/);
assert.match(spec, /waitForDirectory\(page, \{ assets: 10, results: 10 \}\)/);
assert.match(spec, /waitForDirectory\(page, \{ assets: 30, results: 30 \}\)/);

assert.match(spec, /route\.abort\("connectionfailed"\)/,
  "the controlled failure must happen before a provider request");
assert.match(spec, /code: "ACCEPTANCE_FORCED_ONCE"/);
assert.match(spec, /data-retry-recognition/);
assert.match(spec, /data-save-title/);
assert.match(spec, /data-reject-title/);
assert.match(spec, /data-workspace-mode="standard"/);
assert.match(spec, /data-workspace-mode="writer"/);
assert.match(spec, /listing-export-workbook/);
assert.match(spec, /workbook\.xlsx\.load/);
assert.match(spec, /rowCount\)\.toBe\(30\)/,
  "one header plus twenty-nine eligible cards must be present");
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
assert.match(spec, /cleanup_targets/);
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
