import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCommercialReadinessReport,
  formatCommercialReadinessReport
} from "./commercial-readiness-audit.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "lynca-readiness-audit-"));
const emptyDatasetPath = join(tempDir, "empty-golden.json");

await writeFile(emptyDatasetPath, `${JSON.stringify({
  schema_version: "golden-dataset-v1",
  splits: {
    development: [],
    calibration: [],
    held_out_commercial: []
  }
}, null, 2)}\n`);

const emptyReport = await createCommercialReadinessReport({
  datasetPath: emptyDatasetPath,
  env: {}
});

assert.equal(emptyReport.ready, false, "an empty commercial split cannot be ready");
assert.equal(emptyReport.commercial_claim_allowed, false,
  "an empty commercial split cannot authorize a commercial claim");
assert.equal(emptyReport.held_out_commercial_assets, 0);
assert.equal(emptyReport.commercial_acceptance_gate.passed, false);
assert.ok(emptyReport.blockers.includes("commercial_acceptance_gate"));
assert.ok(emptyReport.checks.some((check) => {
  return check.id === "commercial_acceptance_gate" && check.status === "blocked";
}));
assert.ok(emptyReport.checks.some((check) => {
  return check.id === "feedback_retention_switch"
    && check.status === "passed"
    && check.details.enabled === false;
}));
assert.ok(emptyReport.checks.some((check) => {
  return check.id === "approved_memory_switch"
    && check.status === "passed"
    && check.details.enabled === false;
}));
assert.match(formatCommercialReadinessReport(emptyReport), /ready: false/);

const enabledReport = await createCommercialReadinessReport({
  datasetPath: emptyDatasetPath,
  env: {
    LISTING_FEEDBACK_RETENTION_ENABLED: "true",
    LISTING_APPROVED_MEMORY_ENABLED: "true"
  }
});
assert.equal(enabledReport.commercial_claim_allowed, false,
  "turning Founder/ops retention switches on is not commercial evidence");
assert.ok(enabledReport.checks.some((check) => {
  return check.id === "feedback_retention_switch" && check.status === "warning";
}));
assert.ok(enabledReport.blockers.includes("commercial_acceptance_gate"));

const defaultCli = spawnSync(process.execPath, [
  "scripts/commercial-readiness-audit.mjs",
  "--dataset",
  "data/golden-dataset.json"
], { encoding: "utf8" });
assert.notEqual(defaultCli.status, 0,
  "readiness:audit must fail on the default empty commercial split");
assert.match(defaultCli.stdout, /commercial_acceptance_gate/);
assert.match(defaultCli.stdout, /held_out_commercial_assets: 0/);
assert.match(defaultCli.stdout, /commercial_claim_allowed: false/);

const reportPath = join(tempDir, "report.json");
const reportCli = spawnSync(process.execPath, [
  "scripts/commercial-readiness-audit.mjs",
  "--dataset",
  emptyDatasetPath,
  "--report",
  reportPath
], { encoding: "utf8" });
assert.notEqual(reportCli.status, 0);
const written = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(written.commercial_claim_allowed, false);
assert.equal(written.ready, false);

const requireGateCli = spawnSync(process.execPath, [
  "scripts/eval-golden.mjs",
  "--dataset",
  "data/golden-dataset.json",
  "--require-commercial-gate"
], { encoding: "utf8" });
assert.notEqual(requireGateCli.status, 0,
  "eval:golden --require-commercial-gate must fail on an empty commercial split");
assert.match(requireGateCli.stderr, /Commercial acceptance gate did not pass/);

const warningOnlyCli = spawnSync(process.execPath, [
  "scripts/eval-golden.mjs",
  "--dataset",
  "data/golden-dataset.json"
], { encoding: "utf8" });
assert.equal(warningOnlyCli.status, 0,
  "default eval:golden still reports development fixtures and only warns");
assert.match(warningOnlyCli.stdout, /Held-out commercial split is empty/);

console.log("commercial readiness audit tests passed");
