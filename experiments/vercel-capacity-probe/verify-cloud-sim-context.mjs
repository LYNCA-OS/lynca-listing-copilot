#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import accuracyHandler from "./api/accuracy.js";
import { ARM_REQUEST_SPECS, FROZEN_REQUEST_CONTRACTS } from "./request-contract.mjs";
import { buildResidualCompactV4Inputs } from "./build-residual-compact-v4-inputs.mjs";
import { buildAssetsOnlyManifestFromDataset } from "./materialize-residual-v3-payload.mjs";

const labRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = execFileSync("git", ["-C", labRoot, "rev-parse", "--show-toplevel"],
  { encoding: "utf8" }).trim();
assert.equal(resolve(repositoryRoot, "experiments/vercel-capacity-probe"), labRoot,
  "cloud_sim_checkout_layout_mismatch");

const branch = execFileSync("git", ["-C", repositoryRoot, "branch", "--show-current"],
  { encoding: "utf8" }).trim();
const requireDeployContext = process.argv.includes("--require-link");
if (requireDeployContext) {
  assert.match(branch, /^codex\//, "cloud_sim_experiment_branch_required");
  assert.notEqual(branch, "main", "cloud_sim_main_branch_not_allowed");
}

const remote = execFileSync("git", ["-C", repositoryRoot, "remote", "get-url", "origin"],
  { encoding: "utf8" }).trim();
assert.match(remote, /LYNCA-OS\/lynca-listing-copilot(?:\.git)?$/, "cloud_sim_remote_mismatch");

const [activeContext, vercel, endpoint] = await Promise.all([
  readFile(resolve(repositoryRoot, "docs/operations/active-service-context.json"), "utf8").then(JSON.parse),
  readFile(resolve(labRoot, "vercel.json"), "utf8").then(JSON.parse),
  readFile(resolve(labRoot, "api/accuracy.js"), "utf8")
]);
const canonicalProject = activeContext?.vercel?.capacity_lab;
const canonicalOrgId = activeContext?.vercel?.scope?.id;
assert.equal(canonicalProject?.project, "lynca-capacity-lab", "cloud_sim_context_project_mismatch");
assert.equal(canonicalProject?.project_id, "prj_OnBhU4kHtWuOBCs3iGoYZsYfaWbg",
  "cloud_sim_context_project_id_mismatch");
assert.equal(canonicalOrgId, "team_il17GLcdGsr5fows3jsKwMoA",
  "cloud_sim_context_org_id_mismatch");
assert.equal(canonicalProject?.deployment_target, "preview", "cloud_sim_context_target_mismatch");

let project = null;
try { project = JSON.parse(await readFile(resolve(labRoot, ".vercel/project.json"), "utf8")); }
catch (error) {
  if (error?.code !== "ENOENT" || requireDeployContext) {
    throw new Error(error?.code === "ENOENT" ? "cloud_sim_vercel_link_required" : error.message);
  }
}
if (project) {
  assert.equal(project.projectName, canonicalProject.project, "cloud_sim_vercel_project_mismatch");
  assert.equal(project.projectId, canonicalProject.project_id,
  "cloud_sim_vercel_project_id_mismatch");
  assert.equal(project.orgId, canonicalOrgId,
  "cloud_sim_vercel_org_id_mismatch");
}
assert.deepEqual(vercel.regions, ["sin1"], "cloud_sim_region_mismatch");
assert.deepEqual(vercel.functions?.["api/accuracy.js"]?.regions, ["sin1"], "cloud_sim_function_region_mismatch");
assert.deepEqual(vercel.functions?.["api/control.js"]?.regions, ["syd1"],
  "cloud_sim_legacy_control_region_mismatch");
assert.match(endpoint, /env\.VERCEL_ENV !== "preview"/, "cloud_sim_preview_guard_missing");
assert.match(endpoint, /env\.VERCEL_REGION !== "sin1"/, "cloud_sim_sin1_guard_missing");
assert.doesNotMatch(
  endpoint,
  /@google-cloud|run\.app|vector[-_/ ]?(?:search|store|retriev)|\bocr\b|web_search/i,
  "cloud_sim_forbidden_stage_detected"
);

const environmentKeys = ["VERCEL_ENV", "VERCEL_REGION", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID",
  "LYNCA_CLOUD_SIM_ENABLED", "LYNCA_CLOUD_SIM_STORAGE_HOST", "LYNCA_CLOUD_SIM_RUN_TOKEN",
  "OPENAI_API_KEY", "LYNCA_RELEASE_GIT_SHA"];
const environmentBefore = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
Object.assign(process.env, { VERCEL_ENV: "preview", VERCEL_REGION: "sin1",
  VERCEL_URL: "local-contract-check.vercel.app", VERCEL_DEPLOYMENT_ID: "local-contract-check",
  LYNCA_CLOUD_SIM_ENABLED: "true", LYNCA_CLOUD_SIM_STORAGE_HOST: "irpgnhkslrsiucybkufc.supabase.co",
  LYNCA_CLOUD_SIM_RUN_TOKEN: "local-contract-check", OPENAI_API_KEY: "local-contract-check",
  LYNCA_RELEASE_GIT_SHA: "a".repeat(40) });
let readiness;
try {
  await accuracyHandler({ method: "GET" }, { setHeader() {}, end(body) { readiness = JSON.parse(body); } });
} finally {
  for (const [key, value] of Object.entries(environmentBefore)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
assert.equal(readiness?.ready, true, "cloud_sim_accuracy_readiness_failed");
assert.equal(readiness?.environment, "preview", "cloud_sim_accuracy_environment_mismatch");
assert.equal(readiness?.region, "sin1", "cloud_sim_accuracy_readiness_region_mismatch");
assert.equal(readiness?.release_git_sha, "a".repeat(40),
  "cloud_sim_accuracy_release_git_sha_mismatch");
assert.equal(readiness?.schema_version, "lynca-cloud-accuracy-readiness-v2",
  "cloud_sim_accuracy_readiness_schema_mismatch");
assert.equal(readiness?.reasoning_effort, null, "cloud_sim_accuracy_global_effort_must_be_null");
assert.equal(readiness?.reasoning_effort_mode, "per_arm", "cloud_sim_accuracy_effort_mode_mismatch");
assert.deepEqual(readiness?.arm_request_specs, ARM_REQUEST_SPECS,
  "cloud_sim_accuracy_arm_contract_mismatch");
assert.deepEqual(readiness?.frozen_request_contracts, FROZEN_REQUEST_CONTRACTS,
  "cloud_sim_accuracy_frozen_contract_mismatch");
assert.equal(readiness?.production_calls_allowed, false, "cloud_sim_production_boundary_missing");
assert.equal(readiness?.max_batch_size, 1, "cloud_sim_batch_cap_mismatch");
assert.equal(readiness?.max_concurrency, 1, "cloud_sim_concurrency_cap_mismatch");

let physicalDataVerified = false;
if (process.argv.includes("--require-data")) {
  const prereg = JSON.parse(await readFile(resolve(repositoryRoot,
    "experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json"), "utf8"));
  const evalRoot = resolve(process.env.LYNCA_EVAL_ROOT || "/Users/paidaxin/lynca-eval-root");
  const datasetBody = await readFile(resolve(evalRoot, prereg.analysis_inputs.dataset_path));
  const datasetSha = createHash("sha256").update(datasetBody).digest("hex");
  assert.equal(datasetSha, prereg.analysis_inputs.dataset_sha256,
    "cloud_sim_physical_dataset_fingerprint_mismatch");
  assert.equal(buildAssetsOnlyManifestFromDataset({ dataset: JSON.parse(datasetBody), prereg }).assets.length,
    35, "cloud_sim_physical_pairing_mismatch");
  const compactPrereg = JSON.parse(await readFile(resolve(repositoryRoot,
    "experiments/accuracy/model-residual-compact-v4-cloud-prereg.json"), "utf8"));
  const compact = buildResidualCompactV4Inputs({ datasetBody, prereg: compactPrereg,
    v3Prereg: prereg });
  assert.equal(compact.manifest.assets.length, 70, "cloud_sim_compact_v4_physical_pairing_mismatch");
  assert.equal(compact.labelRefReceipt.sealed_label_bytes_read, false,
    "cloud_sim_compact_v4_label_boundary_mismatch");
  physicalDataVerified = true;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  checkout: repositoryRoot,
  branch,
  vercel_project: canonicalProject.project,
  local_link_verified: Boolean(project),
  physical_data_verified: physicalDataVerified,
  environment: "preview_only",
  region: "sin1",
  production_mutation: false
})}\n`);
