#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  PINNED_VERCEL_CLI_VERSION,
  acquireProtectionBypass,
  assertCredentialEnvironment,
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
assert.equal(assertCredentialEnvironment({
  METAVERSE_USERNAME: "admin",
  METAVERSE_PASSWORD: "secret"
}), true);
assert.throws(
  () => assertCredentialEnvironment({ METAVERSE_USERNAME: "admin" }),
  /must be injected through the process environment/
);

{
  const calls = [];
  let curlAttempts = 0;
  const bypass = await acquireProtectionBypass({
    baseUrl: "https://candidate-123.vercel.app",
    execFileImpl: async (_bin, args) => {
      calls.push(args);
      if (args[0] === "--version") return { stdout: "Vercel CLI 54.14.5", stderr: "" };
      curlAttempts += 1;
      if (curlAttempts === 1) {
        const error = new Error("transient curl failure");
        error.stderr = "curl: (35) Recv failure: Connection reset by peer";
        throw error;
      }
      const tracePath = args[args.indexOf("--trace-ascii") + 1];
      const outputPath = args[args.indexOf("--output") + 1];
      const { writeFile } = await import("node:fs/promises");
      await writeFile(tracePath, "x-vercel-protection-bypass: fixed_candidate_token_123\n");
      await writeFile(outputPath, "{}");
      return { stdout: "", stderr: "" };
    }
  });
  assert.equal(bypass, "fixed_candidate_token_123");
  assert.ok(calls[1].includes("--yes"), "non-interactive protected replay must never prompt");
  assert.equal(curlAttempts, 2, "transient protection transport failure should retry once");
}

console.log("protected candidate launch-gate tests passed");
