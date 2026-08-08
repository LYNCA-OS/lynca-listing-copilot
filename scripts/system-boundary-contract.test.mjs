#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const frontend = await readFile("app/listing-copilot.js", "utf8");
const sdkEntry = await readFile("lib/listing/client/listing-copilot-sdk.mjs", "utf8");
const clientSdk = await readFile("app/listing-copilot-sdk.mjs", "utf8");
const clientSdkModule = await import("../app/listing-copilot-sdk.mjs");

const localImports = [...frontend.matchAll(/from\s+["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((specifier) => specifier.startsWith("."));
// The boundary is that the browser bundle reaches no further than its OWN
// directory: it may compose sibling modules under `app/`, and it may not walk
// into `lib/` or anywhere else the server owns.
//
// This used to be a frozen list of two specifiers, which is a snapshot rather
// than the rule. Every legitimate app-local module added since broke it --
// `asset-single-flight.mjs` (COS-51) and `csm-glass-box.mjs` (COS-42) are both
// siblings of exactly the kind already allowed, and both were reported as
// boundary violations. A gate that fails on the behaviour it permits stops
// being read.
//
// It now states the rule. Adding another `app/` module is free; reaching for
// `../lib/anything.mjs` fails, which is the thing worth catching.
const appSiblings = new Set((await readdir("app")).filter((name) => name.endsWith(".mjs")));
for (const specifier of localImports) {
  assert.match(specifier, /^\.\/[a-z0-9-]+\.mjs$/,
    `the frontend may only import app-local siblings, not ${specifier}`);
  assert.ok(appSiblings.has(specifier.slice(2)),
    `${specifier} is not a module under app/`);
}
assert.ok(localImports.includes("./listing-copilot-sdk.mjs"),
  "the SDK boundary itself must stay in place");

const sdkImportList = frontend.match(
  /import\s*\{([^}]*)\}\s*from\s*["']\.\/listing-copilot-sdk\.mjs["'];/
)?.[1]
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean)
  .sort();
assert.deepEqual(Object.keys(clientSdkModule).sort(), sdkImportList,
  "the public SDK must expose exactly the browser's live surface and no retired contracts");

for (const forbidden of [
  "provider_options",
  "providerOptions",
  "force_l2_only",
  "create_l1_job",
  "create_l2_job",
  "disable_fast_scout_l1",
  "v4_force_l2_direct"
]) {
  assert.equal(frontend.includes(forbidden), false, `frontend must not own ${forbidden}`);
}

for (const activeModule of [
  "quality-gate.mjs",
  "crop-planner.mjs",
  "batch-recognition-intent.mjs",
  "bounded-fetch.mjs",
  "upload-phases.mjs",
  "upload-recovery-policy.mjs"
]) {
  assert.match(sdkEntry, new RegExp(activeModule.replace(".", "\\.")),
    `the browser SDK entry must retain ${activeModule}`);
}

for (const retiredSurface of [
  "recognition-request.mjs",
  "queuedStatusPollDelay",
  "groupClientResultsByJobId",
  "assetLifecycleStates",
  "/api/v4/listing-job"
]) {
  assert.equal(clientSdk.includes(retiredSurface), false,
    `the public browser SDK must not retain ${retiredSurface}`);
}

console.log("System boundary contract tests passed");
