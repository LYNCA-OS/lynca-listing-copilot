#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const frontend = await readFile("app/listing-copilot.js", "utf8");
const enqueueApi = await readFile("api/v4/listing-job-enqueue.js", "utf8");
const statusApi = await readFile("api/v4/listing-job-status.js", "utf8");
const clientSdk = await readFile("app/listing-copilot-sdk.mjs", "utf8");

const localImports = [...frontend.matchAll(/from\s+["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((specifier) => specifier.startsWith("."));
assert.deepEqual(localImports.sort(), [
  "./listing-copilot-sdk.mjs",
  "./writer-wheel-mode.mjs"
]);

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

assert.match(clientSdk, /recognition-request\.mjs/);
assert.match(enqueueApi, /bindRecognitionProfileToPayload/);
assert.match(statusApi, /buildWriterViewModel/);
assert.match(statusApi, /writer_view_model:/);

console.log("System boundary contract tests passed");
