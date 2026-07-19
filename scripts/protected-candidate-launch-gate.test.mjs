#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  PINNED_VERCEL_CLI_VERSION,
  assertProtectedCandidateConfig,
  extractProtectionBypass
} from "./run-protected-candidate-launch-gate.mjs";

assert.equal(PINNED_VERCEL_CLI_VERSION, "54.14.5");
assert.equal(
  extractProtectionBypass("0086: x-vercel-protection-bypass: fixed_candidate_token_123\n"),
  "fixed_candidate_token_123"
);
assert.deepEqual(assertProtectedCandidateConfig([
  "--base-url", "https://candidate-123.vercel.app/",
  "--expected-deployment-id", "dpl_Abc123"
]), {
  baseUrl: "https://candidate-123.vercel.app",
  expectedDeploymentId: "dpl_Abc123"
});
assert.throws(
  () => assertProtectedCandidateConfig([
    "--base-url", "https://listing.lyncafei.team",
    "--expected-deployment-id", "dpl_Abc123"
  ]),
  /immutable \*\.vercel\.app candidate/
);
assert.throws(
  () => assertProtectedCandidateConfig([
    "--base-url", "https://candidate-123.vercel.app",
    "--expected-deployment-id", "latest"
  ]),
  /pin the immutable candidate deployment/
);
assert.throws(
  () => assertProtectedCandidateConfig([
    "--base-url", "https://candidate-123.vercel.app",
    "--expected-deployment-id", "dpl_Abc123",
    "--password", "unsafe"
  ]),
  /credentials through the environment/
);
assert.throws(() => extractProtectionBypass("no bypass here"), /did not provide/);

console.log("protected candidate launch-gate tests passed");
