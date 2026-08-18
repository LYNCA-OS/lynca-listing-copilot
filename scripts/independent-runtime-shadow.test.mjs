import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LISTING_INDEPENDENT_RUNTIME_SHADOW_ALLOW_PROVIDER,
  LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED,
  LYNCA_RUNTIME_PINNED_SHA,
  applyShadowReceiptWithoutMutatingWriter,
  assertShadowDidNotInfluenceWriter,
  classifyIndependentIdentifyOutput,
  decideIndependentRuntimeShadowEnablement,
  independentRuntimeShadowAllowsProvider,
  listingIndependentRuntimeShadowEnabled,
  resolveIndependentRuntimeCheckout,
  runIndependentRuntimeShadow,
  spawnIndependentIdentifyProcess
} from "../lib/listing/evaluation/independent-runtime-shadow.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stubCli = resolve(repoRoot, "scripts/fixtures/independent-runtime-identify-stub.mjs");
const work = mkdtempSync(resolve(repoRoot, "scripts/fixtures/shadow-test-"));
const frontFixture = resolve(work, "front.bin");
const backFixture = resolve(work, "back.bin");
writeFileSync(frontFixture, "front-bytes");
writeFileSync(backFixture, "back-bytes");

try {
  const writerResult = Object.freeze({
    ok: true,
    title: "writer-visible-title",
    recognition_session_id: "sess-1",
    message: "unchanged"
  });

  assert.equal(listingIndependentRuntimeShadowEnabled({}), false, "shadow defaults off");
  assert.equal(listingIndependentRuntimeShadowEnabled({
    [LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED]: "true"
  }), true, "explicit non-production true enables the harness");
  assert.equal(listingIndependentRuntimeShadowEnabled({
    [LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED]: "true",
    NODE_ENV: "production"
  }), false, "production NODE_ENV refuses even when the flag is true");
  assert.equal(listingIndependentRuntimeShadowEnabled({
    [LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED]: "true",
    VERCEL_ENV: "production"
  }), false, "production VERCEL_ENV refuses even when the flag is true");
  assert.equal(listingIndependentRuntimeShadowEnabled({
    [LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED]: "1"
  }), false, "truthy-but-not-true values stay off");

  assert.equal(independentRuntimeShadowAllowsProvider({
    [LISTING_INDEPENDENT_RUNTIME_SHADOW_ALLOW_PROVIDER]: "true",
    CI: "true"
  }), false, "CI never allows unpaid provider calls");

  const disabled = await runIndependentRuntimeShadow({
    frontPath: frontFixture,
    backPath: backFixture,
    env: {}
  });
  assert.equal(disabled.ran, false);
  assert.equal(disabled.skip_code, "shadow_disabled");
  assert.equal(disabled.writer_influence, false);
  const afterDisabled = applyShadowReceiptWithoutMutatingWriter(writerResult, disabled);
  assertShadowDidNotInfluenceWriter(writerResult, afterDisabled, disabled);
  assert.equal(afterDisabled.title, "writer-visible-title");

  const productionBlocked = await runIndependentRuntimeShadow({
    frontPath: frontFixture,
    backPath: backFixture,
    env: {
      [LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED]: "true",
      NODE_ENV: "production"
    }
  });
  assert.equal(productionBlocked.skip_code, "shadow_forbidden_in_production");
  assert.equal(productionBlocked.ran, false);

  const ciProvider = await runIndependentRuntimeShadow({
    frontPath: frontFixture,
    backPath: backFixture,
    env: {
      [LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED]: "true",
      CI: "true",
      [LISTING_INDEPENDENT_RUNTIME_SHADOW_ALLOW_PROVIDER]: "true"
    }
  });
  assert.equal(ciProvider.failure_code, "shadow_provider_forbidden_in_ci");
  assert.equal(ciProvider.ran, false);

  const missingCheckout = await runIndependentRuntimeShadow({
    frontPath: frontFixture,
    backPath: backFixture,
    env: {
      [LISTING_INDEPENDENT_RUNTIME_SHADOW_ENABLED]: "true",
      NODE_ENV: "test"
    }
  });
  assert.equal(missingCheckout.failure_code, "runtime_checkout_absent");
  assert.equal(Array.isArray(missingCheckout), false, "missing checkout is a receipt, not an empty array");
  assert.equal(missingCheckout.ok, false);

  await assert.rejects(
    () => resolveIndependentRuntimeCheckout({ checkoutPath: repoRoot }),
    (error) => error.code === "runtime_checkout_is_listing_copilot",
    "this repository cannot pose as lynca-runtime"
  );

  await assert.rejects(
    () => resolveIndependentRuntimeCheckout({ checkoutPath: "/tmp/lynca-runtime-scratch" }),
    (error) => error.code === "runtime_checkout_ephemeral_tmp"
  );

  const otherPackageDir = resolve(work, "not-runtime");
  mkdirSync(otherPackageDir);
  writeFileSync(resolve(otherPackageDir, "package.json"), JSON.stringify({ name: "not-lynca-runtime" }));
  await assert.rejects(
    () => resolveIndependentRuntimeCheckout({ checkoutPath: otherPackageDir }),
    (error) => error.code === "runtime_checkout_not_lynca_runtime"
  );

  assert.equal(classifyIndependentIdentifyOutput({
    exit_code: 0,
    stdout: "",
    timed_out: false
  }), "runtime_output_empty", "empty stdout is a failure, never a successful empty runtime");

  const stubOk = await spawnIndependentIdentifyProcess({
    cliPath: stubCli,
    frontPath: frontFixture,
    backPath: backFixture,
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
    timeoutMs: 5_000,
    allowProvider: false
  });
  assert.equal(stubOk.exit_code, 0);
  assert.match(stubOk.stdout, /independent-runtime-identify-stub-v1/);
  assert.doesNotMatch(stubOk.stdout, /lib\/listing\/thin/);

  const stubEmpty = await spawnIndependentIdentifyProcess({
    cliPath: stubCli,
    frontPath: frontFixture,
    backPath: backFixture,
    cwd: repoRoot,
    env: { PATH: process.env.PATH, INDEPENDENT_RUNTIME_STUB_EMPTY: "true" },
    timeoutMs: 5_000,
    allowProvider: false
  });
  assert.equal(stubEmpty.exit_code, 0);
  assert.equal(classifyIndependentIdentifyOutput(stubEmpty), "runtime_output_empty");

  const enabledMissingCheckoutWriter = applyShadowReceiptWithoutMutatingWriter(
    writerResult,
    missingCheckout
  );
  assertShadowDidNotInfluenceWriter(writerResult, enabledMissingCheckoutWriter, missingCheckout);

  assert.equal(decideIndependentRuntimeShadowEnablement({}).skip_code, "shadow_disabled");
  assert.equal(LYNCA_RUNTIME_PINNED_SHA, "8a75ff73aef9953e143a851d97977b33b35631bf");
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("independent-runtime-shadow.test.mjs passed");
