#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  mergeBoundedEvidenceV2Cohorts,
  validateCohortBundle
} from "./merge-bounded-evidence-v2-cohorts.mjs";

const arm = "thin_canonical_bounded_evidence_v2_high";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const commonContract = {
  schema_version: "thin-path-eval-run-contract-v2",
  model: "gpt-5.6-luna", effort: "none", image_detail: "high",
  execution: {
    concurrency: 120,
    request_timeout_ms: 120000,
    max_attempts: 3,
    retry_policy: "bounded-provider-retry-v1"
  },
  arms: [{
    key: arm,
    fixed_image_detail: "high",
    eval_version: "bounded-evidence-v2",
    response_schema_name: "canonical_card_fields_bounded_evidence_v2",
    response_schema_sha256: "a".repeat(64),
    prompt_sha256: "b".repeat(64)
  }],
  dataset_sha256: "dataset", sealed_labels_sha256: "labels", source_sha256: { harness: "source" }
};
const cohorts = {
  screen50: Array.from({ length: 50 }, (_, index) => `h${index}`),
  audited100: Array.from({ length: 100 }, (_, index) => `a${index}`),
  development150: Array.from({ length: 150 }, (_, index) => index % 3 === 0
    ? `h${index / 3}`
    : `a${index - Math.floor(index / 3) - 1}`),
  mechanism6: Array.from({ length: 6 }, (_, index) => `a${index}`),
  confirmatory50: Array.from({ length: 50 }, (_, index) => `c${index}`),
  reserve55: Array.from({ length: 55 }, (_, index) => `r${index}`)
};
const bodies = Object.fromEntries(Object.entries(cohorts).map(([name, ids]) => [
  name, `${JSON.stringify(ids, null, 2)}\n`
]));
const cohortHashes = Object.fromEntries(Object.entries(bodies).map(([name, body]) => [name, sha256(body)]));
const cohortManifest = {
  schema_version: "bounded-evidence-v2-cohort-manifest-v2",
  relationship: {
    canonical_v3: 150, audited_overlap: 100, development_screen: 50,
    outside_canonical_v3: 105, confirmatory_validation: 50, confirmatory_reserve: 55,
    product_mechanism_probe: 6
  },
  cohorts: {
    screen50: { file: "screen.json", count: 50, asset_ids_sha256: cohortHashes.screen50,
      selection_role: "development_screen", selection_method: "used_screen" },
    audited100: { file: "audited.json", count: 100, asset_ids_sha256: cohortHashes.audited100,
      selection_role: "audited_development", selection_method: "audited" },
    development150: { file: "development.json", count: 150, asset_ids_sha256: cohortHashes.development150,
      selection_role: "development_population", selection_method: "ordered" },
    mechanism6: { file: "mechanism.json", count: 6, asset_ids_sha256: cohortHashes.mechanism6,
      selection_role: "mechanism_probe_known_wins", selection_method: "known_wins" },
    confirmatory50: { file: "confirmatory.json", count: 50, asset_ids_sha256: cohortHashes.confirmatory50,
      selection_role: "confirmatory_validation", selection_method: "fixed_outside",
      selection_salt: "bounded-evidence-v2-confirmatory-2026-08-01-v1" },
    reserve55: { file: "reserve.json", count: 55, asset_ids_sha256: cohortHashes.reserve55,
      selection_role: "confirmatory_reserve", selection_method: "fixed_reserve",
      selection_salt: "bounded-evidence-v2-confirmatory-2026-08-01-v1" }
  }
};
assert.deepEqual(validateCohortBundle({ manifest: cohortManifest, bodies }).cohorts, cohorts);

const manifestFor = (assetIdsSha256, selectedIds, selectionRole) => {
  const contract = {
    ...commonContract,
    cohort: { selection_role: selectionRole },
    asset_ids_sha256: assetIdsSha256
  };
  return {
    schema_version: "thin-path-eval-run-manifest-v2",
    fingerprint: sha256(JSON.stringify(contract)),
    contract,
    max_requested_limit: selectedIds.length,
    max_requested_asset_ids_sha256: sha256(JSON.stringify(selectedIds))
  };
};
const manifestA = manifestFor(cohortHashes.screen50, cohorts.screen50, "development_screen");
const manifestC = manifestFor(cohortHashes.audited100, cohorts.audited100, "audited_development");
const replaySource = { resolver: "e".repeat(64) };
const replayManifestA = {
  replay_fingerprint: "f".repeat(64),
  contract: { resolver_version: "bounded-evidence-v2", source_sha256: replaySource }
};
const replayManifestC = {
  replay_fingerprint: "0".repeat(64),
  contract: { resolver_version: "bounded-evidence-v2", source_sha256: replaySource }
};
const rows = (ids, fingerprint) => ids.map((asset_id) => ({
  asset_id,
  arm,
  run_fingerprint: fingerprint,
  arm_eval_version: "bounded-evidence-v2",
  model: "gpt-5.6-luna",
  requested_effort: "none",
  served_effort: "none",
  image_detail: "high",
  production_promoted: false,
  request_sha256: "c".repeat(64),
  image_set_sha256: "d".repeat(64)
}));
const merged = mergeBoundedEvidenceV2Cohorts({
  stageARows: rows(cohorts.screen50, manifestA.fingerprint), stageAManifest: manifestA,
  stageAReplayManifest: replayManifestA,
  stageCRows: rows(cohorts.audited100, manifestC.fingerprint), stageCManifest: manifestC,
  stageCReplayManifest: replayManifestC,
  cohorts, cohortHashes
});
assert.deepEqual(merged.map(({ asset_id }) => asset_id), cohorts.development150);

assert.throws(() => mergeBoundedEvidenceV2Cohorts({
  stageARows: rows(cohorts.screen50, "wrong"), stageAManifest: manifestA,
  stageAReplayManifest: replayManifestA,
  stageCRows: rows(cohorts.audited100, manifestC.fingerprint), stageCManifest: manifestC,
  stageCReplayManifest: replayManifestC,
  cohorts, cohortHashes
}), /stage_a_row_fingerprint_mismatch/);

assert.throws(() => mergeBoundedEvidenceV2Cohorts({
  stageARows: rows(cohorts.screen50, manifestA.fingerprint), stageAManifest: manifestA,
  stageAReplayManifest: replayManifestA,
  stageCRows: rows([...cohorts.audited100.slice(0, -1), "other"], manifestC.fingerprint), stageCManifest: manifestC,
  stageCReplayManifest: replayManifestC,
  cohorts, cohortHashes
}), /stage_c_cohort_mismatch/);

assert.throws(() => mergeBoundedEvidenceV2Cohorts({
  stageARows: rows(cohorts.screen50, manifestA.fingerprint), stageAManifest: manifestA,
  stageAReplayManifest: replayManifestA,
  stageCRows: rows(cohorts.audited100, manifestC.fingerprint),
  stageCManifest: manifestFor(
    cohortHashes.audited100, cohorts.audited100, "audited_development"
  ),
  stageCReplayManifest: replayManifestC,
  cohorts, cohortHashes: { ...cohortHashes, audited100: "wrong" }
}), /stage_c_manifest_asset_ids_hash_mismatch/);

assert.throws(() => validateCohortBundle({
  manifest: {
    ...cohortManifest,
    cohorts: { ...cohortManifest.cohorts, screen50: { ...cohortManifest.cohorts.screen50, count: 49 } }
  },
  bodies
}), /screen50_manifest_count_mismatch/);

assert.throws(() => validateCohortBundle({
  manifest: cohortManifest,
  bodies: { ...bodies, audited100: `${bodies.audited100} ` }
}), /audited100_manifest_hash_mismatch/);

const driftedContract = {
  ...manifestC.contract,
  image_detail: "original"
};
const driftedManifest = {
  ...manifestC,
  contract: driftedContract,
  fingerprint: sha256(JSON.stringify(driftedContract))
};
assert.throws(() => mergeBoundedEvidenceV2Cohorts({
  stageARows: rows(cohorts.screen50, manifestA.fingerprint), stageAManifest: manifestA,
  stageAReplayManifest: replayManifestA,
  stageCRows: rows(cohorts.audited100, driftedManifest.fingerprint), stageCManifest: driftedManifest,
  stageCReplayManifest: replayManifestC,
  cohorts, cohortHashes
}), /stage_c_manifest_runtime_mismatch/);

assert.throws(() => mergeBoundedEvidenceV2Cohorts({
  stageARows: rows(cohorts.screen50, manifestA.fingerprint), stageAManifest: manifestA,
  stageAReplayManifest: replayManifestA,
  stageCRows: rows(cohorts.audited100, manifestC.fingerprint), stageCManifest: manifestC,
  stageCReplayManifest: {
    ...replayManifestC,
    contract: { ...replayManifestC.contract, source_sha256: { resolver: "1".repeat(64) } }
  },
  cohorts, cohortHashes
}), /stage_replay_resolver_drift/);

console.log("bounded evidence v2 merge tests passed");
