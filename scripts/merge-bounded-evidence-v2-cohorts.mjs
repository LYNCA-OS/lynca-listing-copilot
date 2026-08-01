#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  currentReplaySourceHashes,
  validateReplayArtifacts
} from "./replay-bounded-evidence-v2-checkpoint.mjs";
import { CONFIRMATORY_SELECTION_SALT } from "./build-bounded-evidence-v2-cohorts.mjs";

const ARM = "thin_canonical_bounded_evidence_v2_high";
const EVAL_VERSION = "bounded-evidence-v2";
const MODEL = "gpt-5.6-luna";
const EFFORT = "none";
const IMAGE_DETAIL = "high";
const COHORT_COUNTS = Object.freeze({
  screen50: 50,
  audited100: 100,
  development150: 150,
  mechanism6: 6,
  confirmatory50: 50,
  reserve55: 55
});
const COHORT_ROLES = Object.freeze({
  screen50: "development_screen",
  audited100: "audited_development",
  development150: "development_population",
  mechanism6: "mechanism_probe_known_wins",
  confirmatory50: "confirmatory_validation",
  reserve55: "confirmatory_reserve"
});
const valueFor = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jsonlRows = (body) => body.split("\n").filter(Boolean).map(JSON.parse);
const sameSet = (left, right) => left.length === right.length
  && left.every((value) => new Set(right).has(value));

function assertStringIdArray(name, value, expectedCount) {
  if (!Array.isArray(value)
      || value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error(`${name}_must_be_json_string_array`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${name}_duplicate_asset_ids`);
  if (value.length !== expectedCount) {
    throw new Error(`${name}_count_mismatch:${value.length}/${expectedCount}`);
  }
}

export function validateCohortBundle({ manifest, bodies }) {
  if (manifest?.schema_version !== "bounded-evidence-v2-cohort-manifest-v2") {
    throw new Error("cohort_manifest_schema_invalid");
  }
  const cohorts = {};
  const hashes = {};
  for (const [name, expectedCount] of Object.entries(COHORT_COUNTS)) {
    const entry = manifest?.cohorts?.[name];
    const body = bodies?.[name];
    if (!entry || typeof entry.file !== "string" || !entry.file.trim()) {
      throw new Error(`${name}_manifest_entry_invalid`);
    }
    if (Number(entry.count) !== expectedCount) {
      throw new Error(`${name}_manifest_count_mismatch:${entry.count}/${expectedCount}`);
    }
    if (entry.selection_role !== COHORT_ROLES[name]
        || typeof entry.selection_method !== "string" || !entry.selection_method.trim()) {
      throw new Error(`${name}_selection_provenance_invalid`);
    }
    if (["confirmatory50", "reserve55"].includes(name)
        && entry.selection_salt !== CONFIRMATORY_SELECTION_SALT) {
      throw new Error(`${name}_selection_salt_invalid`);
    }
    if (typeof body !== "string") throw new Error(`${name}_body_missing`);
    const actualHash = sha256(body);
    if (entry.asset_ids_sha256 !== actualHash) {
      throw new Error(`${name}_manifest_hash_mismatch`);
    }
    const ids = JSON.parse(body);
    assertStringIdArray(name, ids, expectedCount);
    cohorts[name] = ids;
    hashes[name] = actualHash;
  }
  if (manifest?.relationship?.canonical_v3 !== COHORT_COUNTS.development150
      || manifest?.relationship?.audited_overlap !== COHORT_COUNTS.audited100
      || manifest?.relationship?.development_screen !== COHORT_COUNTS.screen50
      || manifest?.relationship?.outside_canonical_v3 !== 105
      || manifest?.relationship?.confirmatory_validation !== COHORT_COUNTS.confirmatory50
      || manifest?.relationship?.confirmatory_reserve !== COHORT_COUNTS.reserve55
      || manifest?.relationship?.product_mechanism_probe !== COHORT_COUNTS.mechanism6) {
    throw new Error("cohort_manifest_relationship_invalid");
  }
  if (cohorts.screen50.some((id) => new Set(cohorts.audited100).has(id))) {
    throw new Error("cohort_manifest_overlap");
  }
  if (!sameSet([...cohorts.screen50, ...cohorts.audited100], cohorts.development150)) {
    throw new Error("cohort_manifest_union_invalid");
  }
  if (cohorts.confirmatory50.some((id) => new Set(cohorts.development150).has(id))) {
    throw new Error("confirmatory50_development_overlap");
  }
  if (cohorts.reserve55.some((id) => new Set(cohorts.development150).has(id))
      || cohorts.reserve55.some((id) => new Set(cohorts.confirmatory50).has(id))) {
    throw new Error("confirmatory_reserve_overlap");
  }
  if (cohorts.mechanism6.some((id) => !new Set(cohorts.development150).has(id))) {
    throw new Error("mechanism6_outside_development");
  }
  return { cohorts: Object.freeze(cohorts), hashes: Object.freeze(hashes) };
}

function validateStage(
  name, rows, manifest, expectedIds, expectedAssetIdsSha256, expectedSelectionRole
) {
  if (manifest?.schema_version !== "thin-path-eval-run-manifest-v2"
      || manifest?.contract?.schema_version !== "thin-path-eval-run-contract-v2") {
    throw new Error(`${name}_manifest_schema_invalid`);
  }
  if (manifest.fingerprint !== sha256(JSON.stringify(manifest.contract))) {
    throw new Error(`${name}_manifest_fingerprint_invalid`);
  }
  const arms = manifest?.contract?.arms || [];
  const arm = arms[0];
  if (arms.length !== 1 || arm?.key !== ARM
      || arm?.fixed_image_detail !== IMAGE_DETAIL
      || arm?.eval_version !== EVAL_VERSION
      || arm?.response_schema_name !== "canonical_card_fields_bounded_evidence_v2"
      || !/^[0-9a-f]{64}$/.test(String(arm?.response_schema_sha256 || ""))
      || !/^[0-9a-f]{64}$/.test(String(arm?.prompt_sha256 || ""))) {
    throw new Error(`${name}_manifest_not_evidence_v2_only`);
  }
  if (manifest.contract.model !== MODEL || manifest.contract.effort !== EFFORT
      || manifest.contract.image_detail !== IMAGE_DETAIL) {
    throw new Error(`${name}_manifest_runtime_mismatch`);
  }
  if (manifest.contract.asset_ids_sha256 !== expectedAssetIdsSha256) {
    throw new Error(`${name}_manifest_asset_ids_hash_mismatch`);
  }
  if (manifest.contract.cohort?.selection_role !== expectedSelectionRole) {
    throw new Error(`${name}_manifest_selection_role_mismatch`);
  }
  if (Number(manifest.max_requested_limit) !== expectedIds.length) {
    throw new Error(`${name}_manifest_limit_mismatch`);
  }
  if (manifest.max_requested_asset_ids_sha256 !== sha256(JSON.stringify(expectedIds))) {
    throw new Error(`${name}_manifest_selected_cohort_mismatch`);
  }
  const ids = rows.map(({ asset_id }) => asset_id);
  if (new Set(ids).size !== ids.length) throw new Error(`${name}_duplicate_asset_ids`);
  if (!sameSet(ids, expectedIds)) throw new Error(`${name}_cohort_mismatch`);
  if (rows.some(({ arm }) => arm !== ARM)) throw new Error(`${name}_unexpected_arm`);
  if (rows.some((row) => row.arm_eval_version !== EVAL_VERSION
      || row.model !== MODEL
      || row.requested_effort !== EFFORT
      || row.served_effort !== EFFORT
      || row.image_detail !== IMAGE_DETAIL
      || row.production_promoted !== false
      || !/^[0-9a-f]{64}$/.test(String(row.request_sha256 || ""))
      || !/^[0-9a-f]{64}$/.test(String(row.image_set_sha256 || "")))) {
    throw new Error(`${name}_row_contract_mismatch`);
  }
  if (rows.some(({ run_fingerprint }) => run_fingerprint !== manifest.fingerprint)) {
    throw new Error(`${name}_row_fingerprint_mismatch`);
  }
}

export function mergeBoundedEvidenceV2Cohorts({
  stageARows,
  stageAManifest,
  stageAReplayManifest,
  stageCRows,
  stageCManifest,
  stageCReplayManifest,
  cohorts,
  cohortHashes
}) {
  if (!stageAReplayManifest || !stageCReplayManifest) {
    throw new Error("stage_replay_receipts_required");
  }
  if (stageAReplayManifest.contract?.resolver_version
        !== stageCReplayManifest.contract?.resolver_version
      || JSON.stringify(stageAReplayManifest.contract?.source_sha256)
        !== JSON.stringify(stageCReplayManifest.contract?.source_sha256)) {
    throw new Error("stage_replay_resolver_drift");
  }
  validateStage(
    "stage_a", stageARows, stageAManifest, cohorts.screen50, cohortHashes?.screen50,
    COHORT_ROLES.screen50
  );
  validateStage(
    "stage_c", stageCRows, stageCManifest, cohorts.audited100, cohortHashes?.audited100,
    COHORT_ROLES.audited100
  );
  const stableContract = (manifest) => ({
    model: manifest.contract.model,
    effort: manifest.contract.effort,
    image_detail: manifest.contract.image_detail,
    arms: manifest.contract.arms,
    dataset_sha256: manifest.contract.dataset_sha256,
    sealed_labels_sha256: manifest.contract.sealed_labels_sha256,
    source_sha256: manifest.contract.source_sha256,
    execution: manifest.contract.execution
  });
  if (JSON.stringify(stableContract(stageAManifest)) !== JSON.stringify(stableContract(stageCManifest))) {
    throw new Error("stage_contract_drift");
  }
  const byId = new Map([...stageARows, ...stageCRows].map((row) => [row.asset_id, row]));
  if (byId.size !== cohorts.development150.length
      || !sameSet([...byId.keys()], cohorts.development150)) {
    throw new Error("merged_development150_cohort_mismatch");
  }
  return cohorts.development150.map((id) => byId.get(id));
}

async function main(argv = process.argv.slice(2)) {
  const required = [
    "--cohort-manifest", "--stage-a", "--stage-a-manifest",
    "--stage-a-replay-manifest", "--stage-a-replay-input",
    "--stage-c", "--stage-c-manifest",
    "--stage-c-replay-manifest", "--stage-c-replay-input", "--out"
  ];
  for (const flag of required) if (!valueFor(argv, flag)) throw new Error(`${flag} is required`);
  const cohortManifestPath = resolve(valueFor(argv, "--cohort-manifest"));
  const cohortDir = dirname(cohortManifestPath);
  const cohortManifestBody = await readFile(cohortManifestPath, "utf8");
  const cohortManifest = JSON.parse(cohortManifestBody);
  const readCohortBody = async (name) => readFile(
    resolve(cohortDir, cohortManifest?.cohorts?.[name]?.file || ""), "utf8"
  );
  const [
    screen50Body, audited100Body, development150Body, mechanism6Body,
    confirmatory50Body, reserve55Body,
    stageABody, stageAManifestBody, stageAReplayManifestBody, stageAReplayInputBody,
    stageCBody, stageCManifestBody, stageCReplayManifestBody, stageCReplayInputBody
  ] = await Promise.all([
    readCohortBody("screen50"), readCohortBody("audited100"),
    readCohortBody("development150"), readCohortBody("mechanism6"),
    readCohortBody("confirmatory50"), readCohortBody("reserve55"),
    readFile(resolve(valueFor(argv, "--stage-a")), "utf8"),
    readFile(resolve(valueFor(argv, "--stage-a-manifest")), "utf8"),
    readFile(resolve(valueFor(argv, "--stage-a-replay-manifest")), "utf8"),
    readFile(resolve(valueFor(argv, "--stage-a-replay-input")), "utf8"),
    readFile(resolve(valueFor(argv, "--stage-c")), "utf8"),
    readFile(resolve(valueFor(argv, "--stage-c-manifest")), "utf8"),
    readFile(resolve(valueFor(argv, "--stage-c-replay-manifest")), "utf8"),
    readFile(resolve(valueFor(argv, "--stage-c-replay-input")), "utf8")
  ]);
  const stageAManifest = JSON.parse(stageAManifestBody);
  const stageCManifest = JSON.parse(stageCManifestBody);
  const stageAReplayManifest = JSON.parse(stageAReplayManifestBody);
  const stageCReplayManifest = JSON.parse(stageCReplayManifestBody);
  const cohortBundle = validateCohortBundle({
    manifest: cohortManifest,
    bodies: {
      screen50: screen50Body,
      audited100: audited100Body,
      development150: development150Body,
      mechanism6: mechanism6Body,
      confirmatory50: confirmatory50Body,
      reserve55: reserve55Body
    }
  });
  const evalRoot = valueFor(argv, "--eval-root") || "/Users/paidaxin/lynca-eval-root";
  const scorerPath = resolve(evalRoot, "scripts/evaluate-cloud-listing-api.mjs");
  const [{ policyFairTokenRecall }, expectedReplaySources] = await Promise.all([
    import(scorerPath),
    currentReplaySourceHashes({ scorerPath })
  ]);
  validateReplayArtifacts({
    replayBody: stageABody,
    replayManifest: stageAReplayManifest,
    inputCheckpointBody: stageAReplayInputBody,
    parentRunManifestBody: stageAManifestBody,
    expectedSourceHashes: expectedReplaySources,
    scoreTokenRecall: policyFairTokenRecall
  });
  validateReplayArtifacts({
    replayBody: stageCBody,
    replayManifest: stageCReplayManifest,
    inputCheckpointBody: stageCReplayInputBody,
    parentRunManifestBody: stageCManifestBody,
    expectedSourceHashes: expectedReplaySources,
    scoreTokenRecall: policyFairTokenRecall
  });
  const merged = mergeBoundedEvidenceV2Cohorts({
    stageARows: jsonlRows(stageABody), stageAManifest, stageAReplayManifest,
    stageCRows: jsonlRows(stageCBody), stageCManifest, stageCReplayManifest,
    cohorts: cohortBundle.cohorts,
    cohortHashes: cohortBundle.hashes
  });
  const outPath = resolve(valueFor(argv, "--out"));
  await mkdir(dirname(outPath), { recursive: true });
  const mergedBody = `${merged.map(JSON.stringify).join("\n")}\n`;
  await writeFile(outPath, mergedBody);
  await writeFile(`${outPath}.manifest.json`, `${JSON.stringify({
    schema_version: "bounded-evidence-v2-merge-manifest-v2",
    arm: ARM,
    selection_role: "development_union_only",
    claim_boundary: "screen50_informed_hypothesis_selection_and_is_not_confirmatory",
    rows: merged.length,
    output_sha256: sha256(mergedBody),
    cohort_manifest_sha256: sha256(cohortManifestBody),
    cohort_asset_ids_sha256: cohortBundle.hashes,
    source_run_fingerprints: {
      stage_a_development_screen50: stageAManifest.fingerprint,
      stage_c_audited100: stageCManifest.fingerprint
    },
    source_replay_fingerprints: {
      stage_a_development_screen50: stageAReplayManifest.replay_fingerprint,
      stage_c_audited100: stageCReplayManifest.replay_fingerprint
    },
    resolver_version: stageAReplayManifest.contract.resolver_version,
    merge_method: "explicit_manifest_union_not_checkpoint_resume"
  }, null, 2)}\n`);
  process.stdout.write(`merged ${merged.length} bounded-evidence-v2 development rows (not confirmatory)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
