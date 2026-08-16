#!/usr/bin/env node
// Mint the next production release pin.
//
// Every field of a pin is derivable: the version and the base contract come
// from the previous pin, the parent from origin/main, the changed paths from
// the working tree, the failure identity from the last failed deploy run, and
// the contract hash from the entry itself. Hand-writing them cost three
// releases in two days -- v83 recovered a pin that was simply forgotten, and
// v84 and v85 were transcribed by hand, one of them corrupting 733 unrelated
// symbols with a careless global replace.
//
// This prints the entry. It does not edit the table: the pin is a claim about
// what ships, and a human pastes it and says so in the commit message.
//
// Usage:
//   node scripts/mint-release-pin.mjs --slug <kebab-slug> [options]
//
//   --slug              required; names the descriptor and marker
//   --rollback <sha>    production sha to roll back to; defaults to the
//                       previous pin's rollback target
//   --failed-run <id>   the run this release repairs; defaults to the newest
//                       failed deploy-production run
//   --runtime-changed   set runtime_behavior_changed true (default false)
//   --paths a,b,c       changed paths; defaults to the working tree diff
//                       against origin/main

import { execFileSync } from "node:child_process";

import {
  PRODUCTION_RELEASE_PIN_TABLE,
  productionReleasePinRuntimeContractSha256
} from "./compatibility-bridge-release.mjs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

function fail(message) {
  process.stderr.write(`mint-release-pin: ${message}\n`);
  process.exit(1);
}

const slug = flag("slug");
if (typeof slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  fail("--slug is required and must be kebab-case");
}

const previous = [...PRODUCTION_RELEASE_PIN_TABLE]
  .sort((a, b) => a.pin_version - b.pin_version)
  .at(-1);
if (!previous) fail("the pin table is empty; there is nothing to chain from");

const pinVersion = previous.pin_version + 1;
const parentGitSha = git("rev-parse", "origin/main");
const parentTreeSha = git("rev-parse", "origin/main^{tree}");

// The changed paths are the release's own diff. A pin must always carry both
// selector files, because the pin itself lives in them (the v74 lesson).
const changedPaths = (() => {
  const explicit = flag("paths");
  // Tracked changes and new files both ship. The first run of this script
  // omitted itself, because `git diff` does not see an untracked file -- the
  // exact class of silent omission the script exists to prevent.
  const values = typeof explicit === "string"
    ? explicit.split(",").map((value) => value.trim()).filter(Boolean)
    : [
      ...git("diff", "--name-only", "origin/main").split("\n"),
      ...git("ls-files", "--others", "--exclude-standard").split("\n")
    ].filter(Boolean);
  return [...new Set([
    ...values,
    "scripts/compatibility-bridge-release.mjs",
    "scripts/compatibility-bridge-release.test.mjs"
  ])].sort();
})();
if (changedPaths.length < 2) fail("no changed paths against origin/main");

// The failure this release repairs. Recorded, not judged: the pin says which
// run it answers, and the run's own evidence says why it failed.
const failedRun = (() => {
  const explicit = flag("failed-run");
  if (typeof explicit === "string") return explicit;
  try {
    const runs = JSON.parse(execFileSync("gh", [
      "run", "list", "--workflow=deploy-production.yml", "--limit", "10",
      "--json", "databaseId,conclusion"
    ], { encoding: "utf8" }));
    return String(runs.find((run) => run.conclusion === "failure")?.databaseId || "");
  } catch {
    return "";
  }
})();
if (!failedRun) fail("could not determine the failed run; pass --failed-run");

const failure = (() => {
  try {
    const evidence = JSON.parse(execFileSync("gh", [
      "api", `repos/{owner}/{repo}/actions/runs/${failedRun}`
    ], { encoding: "utf8" }));
    void evidence;
  } catch { /* the run metadata is not required for the fields below */ }
  return {
    failure_code: String(flag("failure-code", previous.failure_code)),
    failed_case_id: String(flag("failed-case", previous.failed_case_id)),
    failed_phase: String(flag("failed-phase", previous.failed_phase))
  };
})();

const entry = {
  pin_version: pinVersion,
  selection_schema_version: `production-release-selection-v${pinVersion}`,
  rollback_lineage_schema_version:
    `production-release-rollback-lineage-receipt-v${pinVersion + 1}`,
  descriptor_id: `listing-copilot-${slug}-v${pinVersion}-v1`,
  marker: `${slug}-v${pinVersion}-v1`,
  parent_git_sha: parentGitSha,
  parent_tree_sha: parentTreeSha,
  failed_run_id: failedRun,
  ...failure,
  rollback_git_sha: String(flag("rollback", previous.rollback_git_sha)),
  rollback_tree_sha: "",
  base_selection_schema_version: previous.selection_schema_version,
  base_runtime_contract_sha256: previous.runtime_contract_sha256,
  runtime_behavior_changed: flag("runtime-changed") === true,
  runtime_contract_sha256: "",
  changed_paths: changedPaths
};
entry.rollback_tree_sha = entry.rollback_git_sha === previous.rollback_git_sha
  ? previous.rollback_tree_sha
  : git("rev-parse", `${entry.rollback_git_sha}^{tree}`);
entry.runtime_contract_sha256 = productionReleasePinRuntimeContractSha256(entry);

const render = (value) => JSON.stringify(value);
process.stdout.write(`  Object.freeze({
    pin_version: ${entry.pin_version},
    selection_schema_version: ${render(entry.selection_schema_version)},
    rollback_lineage_schema_version: ${render(entry.rollback_lineage_schema_version)},
    descriptor_id:
      ${render(entry.descriptor_id)},
    marker: ${render(entry.marker)},
    parent_git_sha: ${render(entry.parent_git_sha)},
    parent_tree_sha: ${render(entry.parent_tree_sha)},
    failed_run_id: ${render(entry.failed_run_id)},
    failure_code: ${render(entry.failure_code)},
    failed_case_id: ${render(entry.failed_case_id)},
    failed_phase: ${render(entry.failed_phase)},
    rollback_git_sha: ${render(entry.rollback_git_sha)},
    rollback_tree_sha: ${render(entry.rollback_tree_sha)},
    base_selection_schema_version: ${render(entry.base_selection_schema_version)},
    base_runtime_contract_sha256:
      ${render(entry.base_runtime_contract_sha256)},
    runtime_behavior_changed: ${entry.runtime_behavior_changed},
    runtime_contract_sha256: ${render(entry.runtime_contract_sha256)},
    changed_paths: Object.freeze([
${entry.changed_paths.map((value) => `      ${render(value)}`).join(",\n")}
    ])
  })
`);
process.stderr.write(
  `\nPaste this into PRODUCTION_RELEASE_PIN_TABLE in `
  + `scripts/compatibility-bridge-release.mjs, then run npm run test:release.\n`
  + `The pin claims this release repairs run ${entry.failed_run_id} and that `
  + `production must be at ${entry.rollback_git_sha}. Say so in the commit.\n`
);
