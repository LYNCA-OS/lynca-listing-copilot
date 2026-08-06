#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EXPECTED_ROOT = "/Users/paidaxin/lynca-cloud-sim-preview/experiments/vercel-capacity-probe";
assert.equal(resolve(process.cwd()), EXPECTED_ROOT, "cloud_sim_checkout_mismatch");

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
assert.equal(branch, "codex/cloud-sim-preview", "cloud_sim_branch_mismatch");

const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
assert.match(remote, /LYNCA-OS\/lynca-listing-copilot(?:\.git)?$/, "cloud_sim_remote_mismatch");

const [project, vercel, endpoint] = await Promise.all([
  readFile(".vercel/project.json", "utf8").then(JSON.parse),
  readFile("vercel.json", "utf8").then(JSON.parse),
  readFile("api/accuracy.js", "utf8")
]);
assert.equal(project.projectName, "lynca-capacity-lab", "cloud_sim_vercel_project_mismatch");
assert.deepEqual(vercel.regions, ["sin1"], "cloud_sim_region_mismatch");
assert.deepEqual(vercel.functions?.["api/accuracy.js"]?.regions, ["sin1"], "cloud_sim_function_region_mismatch");
assert.match(endpoint, /env\.VERCEL_ENV !== "preview"/, "cloud_sim_preview_guard_missing");
assert.match(endpoint, /env\.VERCEL_REGION !== "sin1"/, "cloud_sim_sin1_guard_missing");
assert.doesNotMatch(
  endpoint,
  /@google-cloud|run\.app|vector[-_/ ]?(?:search|store|retriev)|\bocr\b|web_search/i,
  "cloud_sim_forbidden_stage_detected"
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  checkout: EXPECTED_ROOT,
  branch,
  vercel_project: project.projectName,
  environment: "preview_only",
  region: "sin1",
  production_mutation: false
})}\n`);
