#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildHandbookArgs,
  checkIntegration,
  collectSourceFiles,
  loadHandbookLock,
  phaseNeedsLlm,
  runLogged,
} from "./maintenance-harness-handbook.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = loadHandbookLock(repoRoot);

assert.equal(lock.upstream_commit.length, 40);
assert.equal(lock.integration_mode, "PINNED_EXTERNAL_TOOL_NO_VENDORED_SOURCE");
assert.equal(lock.privacy.default_mode, "STATIC_LOCAL_ONLY");
assert.equal(phaseNeedsLlm("1"), false);
assert.equal(phaseNeedsLlm("all"), true);
assert.equal(phaseNeedsLlm("1,2a"), true);

const runtimeFiles = collectSourceFiles(repoRoot, "runtime");
assert.ok(runtimeFiles.includes("api/v4/listing-copilot-title.js"));
assert.ok(runtimeFiles.includes("lib/listing/v4/pipeline/native-recognition-core.mjs"));
assert.ok(runtimeFiles.every((file) => !file.includes("node_modules")));
assert.ok(runtimeFiles.every((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file)));

const fullFiles = collectSourceFiles(repoRoot, "full");
assert.ok(fullFiles.length >= runtimeFiles.length);
assert.ok(fullFiles.some((file) => file.endsWith(".test.mjs")));

const args = buildHandbookArgs({
  lock,
  generatorRoot: "/tmp/pinned-harness-handbook",
  sourceRoot: repoRoot,
  sourceFiles: ["api/v4/listing-copilot-title.js", "lib/listing/v4/pipeline/native-recognition-core.mjs"],
  workDir: "/tmp/lynca-handbook-contract-test",
  phase: "1",
});
assert.equal(args[0], path.join("/tmp/pinned-harness-handbook", lock.generator_entrypoint));
assert.equal(args[args.indexOf("--source-root") + 1], repoRoot);
assert.ok(args.includes("api/v4/listing-copilot-title.js,lib/listing/v4/pipeline/native-recognition-core.mjs"));
assert.equal(args.at(-1), "1");

const integration = checkIntegration(repoRoot);
assert.equal(integration.upstream_commit, lock.upstream_commit);
assert.ok(integration.runtime_source_count > 0);

const unsafeLlmRun = spawnSync(process.execPath, [
  path.join(repoRoot, "scripts", "maintenance-harness-handbook.mjs"),
  "run",
  "--phase", "all",
  "--allow-llm",
], {
  cwd: repoRoot,
  env: { ...process.env, HARNESS_HANDBOOK_ALLOW_LLM: "0" },
  encoding: "utf8",
});
assert.notEqual(unsafeLlmRun.status, 0);
assert.match(unsafeLlmRun.stderr, /HARNESS_HANDBOOK_ALLOW_LLM=1/);

const loggedRunDir = fs.mkdtempSync(path.join(os.tmpdir(), "lynca-handbook-run-"));
const successLog = path.join(loggedRunDir, "success.log");
await runLogged(process.execPath, ["-e", "process.stdout.write('HANDBOOK_OK')"], {
  cwd: repoRoot,
  env: process.env,
  logPath: successLog,
});
assert.equal(fs.readFileSync(successLog, "utf8"), "HANDBOOK_OK");
await assert.rejects(
  runLogged(path.join(loggedRunDir, "missing-command"), [], {
    cwd: repoRoot,
    env: process.env,
    logPath: path.join(loggedRunDir, "failure.log"),
  }),
  /ENOENT|spawn/,
);

console.log("maintenance harness handbook tests passed");
