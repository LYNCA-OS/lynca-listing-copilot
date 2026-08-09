import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizedPromptCachePayload,
  runLunaExplicitCacheScreen
} from "./api/prompt-cache.js";
import { runLunaExplicitCacheCloudScreen } from "./run-luna-explicit-cache-screen.mjs";

const directory = await mkdtemp(join(tmpdir(), "lynca-cache-screen-runner-"));
const deployment = "https://luna-cache-preview.example.vercel.app";
const runId = "runner-cache-screen-20260809";
const env = {
  VERCEL_ENV: "preview",
  VERCEL_REGION: "sin1",
  VERCEL_DEPLOYMENT_ID: "dpl_test_cache_screen",
  VERCEL_URL: new URL(deployment).hostname,
  VERCEL_GIT_COMMIT_SHA: "1".repeat(40),
  LYNCA_CLOUD_SIM_ENABLED: "true",
  LYNCA_CLOUD_SIM_RUN_TOKEN: "test-run-token",
  OPENAI_API_KEY: "cloud-only-test-key"
};

function singleUseAuthority() {
  let claimed = false;
  return {
    durable: true,
    async claim() {
      if (claimed) return { granted: false };
      claimed = true;
      return { granted: true };
    }
  };
}

function providerResponse(index) {
  return new Response(JSON.stringify({
    id: `resp-runner-${index}`,
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    incomplete_details: null,
    usage: {
      input_tokens: 5000,
      input_tokens_details: {
        cached_tokens: index === 1 ? 0 : 2048,
        cache_write_tokens: index === 1 ? 2048 : 0
      },
      output_tokens: 50
    }
  }), { status: 200 });
}

function endpointInvoker({ authority = singleUseAuthority(), provider = null } = {}) {
  const calls = [];
  let providerCalls = 0;
  const invoke = async ({ apiPath, deployment: target, runToken, body }) => {
    calls.push({ apiPath, target, runToken, body });
    assert.equal(apiPath, "/api/prompt-cache");
    assert.equal(target, deployment);
    assert.equal(runToken, "local-keychain-token");
    assert.equal(Array.isArray(body.steps), true);
    assert.equal(body.steps.length, 3);
    const payload = normalizedPromptCachePayload(body, env);
    const report = await runLunaExplicitCacheScreen(payload, {
      env,
      singleUseAuthority: authority,
      fetchImpl: async () => {
        providerCalls += 1;
        if (provider) return provider(providerCalls);
        return providerResponse(providerCalls);
      }
    });
    return report;
  };
  return { calls, invoke, providerCalls: () => providerCalls };
}

const preflightPath = join(directory, "preflight.json");
const preflightEndpoint = endpointInvoker();
const preflight = await runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: preflightPath,
  runId,
  executionAuthorized: false,
  runToken: "local-keychain-token",
  invoke: preflightEndpoint.invoke
});
assert.equal(preflight.state, "PREFLIGHT_READY_NO_PROVIDER_CALL");
assert.equal(preflight.provider_calls, 0);
assert.equal(preflightEndpoint.providerCalls(), 0);
assert.equal(preflightEndpoint.calls.length, 1);
assert.equal(preflightEndpoint.calls[0].body.execution_authorized, false);
assert.equal(JSON.stringify(preflight).includes("data:image"), false);
if (process.platform !== "win32") {
  assert.equal((await stat(preflightPath)).mode & 0o777, 0o600);
}

const paidPath = join(directory, "paid.json");
const paidEndpoint = endpointInvoker();
const paid = await runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: paidPath,
  preflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: paidEndpoint.invoke
});
assert.equal(paid.state, "PASS_CACHE_TRANSPORT_CANDIDATE");
assert.equal(paid.provider_calls, 3);
assert.equal(paidEndpoint.providerCalls(), 3);
assert.equal(paidEndpoint.calls.length, 1);
assert.equal(paidEndpoint.calls[0].body.execution_authorized, true);
assert.equal(paidEndpoint.calls[0].body.preflight_receipt_sha256,
  preflight.preflight_receipt_sha256);
assert.deepEqual(paidEndpoint.calls[0].body.preview_identity, {
  environment: "preview",
  region: "sin1",
  deployment_id: env.VERCEL_DEPLOYMENT_ID,
  deployment_hostname: env.VERCEL_URL,
  release_git_sha: env.VERCEL_GIT_COMMIT_SHA
});
assert.equal(JSON.stringify(JSON.parse(await readFile(paidPath, "utf8"))).includes("data:image"), false);

const resumed = await runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: paidPath,
  preflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: async () => { throw new Error("completed_checkpoint_must_not_invoke"); }
});
assert.equal(resumed.state, "PASS_CACHE_TRANSPORT_CANDIDATE");

const holdPath = join(directory, "hold.json");
const holdEndpoint = endpointInvoker({ authority: null });
const hold = await runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: holdPath,
  preflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: holdEndpoint.invoke
});
assert.equal(hold.state, "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED");
assert.equal(hold.provider_calls, 0);
assert.equal(holdEndpoint.providerCalls(), 0);
assert.equal(JSON.parse(await readFile(holdPath, "utf8")).retry_allowed, false);

await assert.rejects(() => runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: preflightPath,
  preflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: async () => { throw new Error("must_not_invoke"); }
}), /paid_output_path_contains_preflight/);

const tamperedPreflightPath = join(directory, "tampered-preflight.json");
await writeFile(tamperedPreflightPath, JSON.stringify({
  ...preflight,
  preflight_receipt_sha256: "a".repeat(64)
}));
await assert.rejects(() => runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: join(directory, "tampered-paid.json"),
  preflightPath: tamperedPreflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: async () => { throw new Error("must_not_invoke"); }
}), /prompt_cache_preflight_invalid/);

const providerAmbiguousPath = join(directory, "provider-ambiguous.json");
const providerAmbiguousEndpoint = endpointInvoker({
  provider: async () => {
    throw Object.assign(new Error("provider_fetch_aborted"), { name: "TimeoutError" });
  }
});
const providerAmbiguous = await runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: providerAmbiguousPath,
  preflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: providerAmbiguousEndpoint.invoke
});
assert.equal(providerAmbiguous.state, "AMBIGUOUS_PROVIDER_OUTCOME");
assert.equal(providerAmbiguous.provider_calls, 1);
assert.equal(providerAmbiguous.provider_calls_known, 1);
assert.equal(providerAmbiguous.retry, false);
assert.equal(providerAmbiguous.retry_allowed, false);
assert.equal(providerAmbiguousEndpoint.providerCalls(), 1);
assert.equal(JSON.parse(await readFile(providerAmbiguousPath, "utf8")).state,
  "AMBIGUOUS_PROVIDER_OUTCOME");

await assert.rejects(() => runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: providerAmbiguousPath,
  preflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: async () => { throw new Error("provider_ambiguity_must_not_retry"); }
}), /prompt_cache_checkpoint_ambiguous_no_retry/);

const ambiguousPath = join(directory, "ambiguous.json");
let ambiguousInvocations = 0;
await assert.rejects(() => runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: ambiguousPath,
  preflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: async () => {
    ambiguousInvocations += 1;
    throw new Error("preview_transport_ambiguous:test");
  }
}), /preview_transport_ambiguous/);
assert.equal(ambiguousInvocations, 1);
const ambiguous = JSON.parse(await readFile(ambiguousPath, "utf8"));
assert.equal(ambiguous.state, "AMBIGUOUS_PROVIDER_OUTCOME");
assert.equal(ambiguous.retry, false);
assert.equal(ambiguous.retry_allowed, false);
assert.equal(ambiguous.provider_calls_known, null);

await assert.rejects(() => runLunaExplicitCacheCloudScreen({
  deployment,
  outPath: ambiguousPath,
  preflightPath,
  runId,
  executionAuthorized: true,
  runToken: "local-keychain-token",
  invoke: async () => {
    ambiguousInvocations += 1;
    throw new Error("ambiguous_checkpoint_must_not_retry");
  }
}), /prompt_cache_checkpoint_ambiguous_no_retry/);
assert.equal(ambiguousInvocations, 1);

process.stdout.write("luna explicit prompt-cache cloud runner tests passed\n");
