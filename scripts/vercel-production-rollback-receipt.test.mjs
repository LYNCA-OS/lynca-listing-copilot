#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureVercelProductionRollbackReceipt,
  verifyCanonicalVercelProductionDeployment,
  verifyCanonicalVercelProductionReceipt,
  verifySavedVercelProductionDeployment
} from "./vercel-production-rollback-receipt.mjs";

const token = "vercel_token_for_rollback_tests_123456";
const bypass = "automation_bypass_for_tests_123456";
const teamId = "team_rollbackReceiptTests";
const projectId = "prj_rollbackReceiptTests";
const oldId = "dpl_oldProductionReceipt123";
const oldHostname = "lynca-listing-copilot-old123.vercel.app";
const oldOrigin = `https://${oldHostname}`;
const oldSha = "1234567890abcdef1234567890abcdef12345678";
const candidateId = "dpl_candidateProductionReceipt456";
const candidateHostname = "lynca-listing-copilot-candidate456.vercel.app";
const candidateOrigin = `https://${candidateHostname}`;
const canonicalOrigin = "https://listing.lyncafei.team";
const env = {
  VERCEL_TOKEN: token,
  VERCEL_ORG_ID: teamId,
  VERCEL_PROJECT_ID: projectId
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function alias({
  id = oldId,
  hostname = oldHostname,
  aliasProjectId = projectId
} = {}) {
  return {
    alias: "listing.lyncafei.team",
    deploymentId: id,
    projectId: aliasProjectId,
    uid: "alias_production",
    deployment: { id, url: hostname }
  };
}

function deployment(overrides = {}) {
  return {
    id: oldId,
    projectId,
    ownerId: teamId,
    url: oldHostname,
    readyState: "READY",
    target: "production",
    ...overrides
  };
}

function health(sha = oldSha) {
  return {
    ready: true,
    deployment: {
      git_commit_sha: sha,
      environment: "production"
    }
  };
}

function mockFetch({
  aliases = [alias(), alias()],
  deploymentValue = deployment(),
  exactHealth = health(),
  canonicalHealth = health()
} = {}) {
  const calls = [];
  let aliasIndex = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init, headers: new Headers(init.headers) });
    if (url.origin === "https://api.vercel.com") {
      if (url.pathname.startsWith("/v4/aliases/")) {
        return json(aliases[Math.min(aliasIndex++, aliases.length - 1)]);
      }
      if (url.pathname.startsWith("/v13/deployments/")) return json(deploymentValue);
      if (url.pathname === `/v9/projects/${projectId}`) {
        return json({
          id: projectId,
          accountId: teamId,
          protectionBypass: { [bypass]: { scope: "automation-bypass" } }
        });
      }
      throw new Error(`unexpected Vercel API call: ${url.pathname}`);
    }
    if (url.origin === oldOrigin && url.pathname === "/api/health") return json(exactHealth);
    if (url.origin === canonicalOrigin && url.pathname === "/api/health") {
      return json(canonicalHealth);
    }
    throw new Error(`unexpected request: ${url}`);
  };
  return { calls, fetchImpl };
}

function assertCredentialBoundaries(calls) {
  assert.ok(calls.length > 0);
  for (const { url, headers } of calls) {
    const authorization = headers.get("authorization");
    const protectionBypass = headers.get("x-vercel-protection-bypass");
    if (url.origin === "https://api.vercel.com") {
      assert.equal(authorization, `Bearer ${token}`);
      assert.equal(protectionBypass, null,
        "the deployment bypass must never be sent to the Vercel control API");
    } else if (url.origin === oldOrigin) {
      assert.equal(authorization, null,
        "the Vercel access token must never be sent to an application deployment");
      assert.equal(protectionBypass, bypass);
    } else if (url.origin === canonicalOrigin) {
      assert.equal(authorization, null);
      assert.equal(protectionBypass, null,
        "the candidate-only bypass must never be sent to the canonical domain");
    }
    assert.notEqual(url.hostname, "supabase.co");
  }
}

const temp = await mkdtemp(join(tmpdir(), "lynca-vercel-rollback-receipt-"));
try {
  const receiptPath = join(temp, "rollback.json");
  const captureMock = mockFetch();
  const receipt = await captureVercelProductionRollbackReceipt({
    env,
    fetchImpl: captureMock.fetchImpl,
    outputPath: receiptPath,
    now: () => new Date("2026-08-09T12:00:00.000Z")
  });
  assert.deepEqual(receipt, {
    schema_version: "vercel-production-rollback-receipt-v1",
    canonical_origin: canonicalOrigin,
    team_id: teamId,
    project_id: projectId,
    deployment_id: oldId,
    deployment_url: oldOrigin,
    git_sha: oldSha,
    ready_state: "READY",
    target: "production",
    captured_at: "2026-08-09T12:00:00.000Z"
  });
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
  const serialized = await readFile(receiptPath, "utf8");
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(bypass), false);
  assertCredentialBoundaries(captureMock.calls);

  const savedMock = mockFetch({ aliases: [] });
  await verifySavedVercelProductionDeployment({
    env,
    fetchImpl: savedMock.fetchImpl,
    receiptPath
  });
  assertCredentialBoundaries(savedMock.calls);

  const canonicalMock = mockFetch();
  await verifyCanonicalVercelProductionReceipt({
    env,
    fetchImpl: canonicalMock.fetchImpl,
    receiptPath
  });
  assertCredentialBoundaries(canonicalMock.calls);

  const candidateCanonicalMock = mockFetch({
    aliases: [
      alias({ id: candidateId, hostname: candidateHostname }),
      alias({ id: candidateId, hostname: candidateHostname })
    ],
    deploymentValue: deployment({
      id: candidateId,
      url: candidateHostname
    })
  });
  assert.deepEqual(
    await verifyCanonicalVercelProductionDeployment({
      env,
      fetchImpl: candidateCanonicalMock.fetchImpl,
      deploymentUrl: candidateOrigin
    }),
    { deployment_id: candidateId, deployment_url: candidateOrigin }
  );
  assertCredentialBoundaries(candidateCanonicalMock.calls);

  await assert.rejects(
    verifyCanonicalVercelProductionDeployment({
      env,
      fetchImpl: mockFetch().fetchImpl,
      deploymentUrl: candidateOrigin
    }),
    /canonical_alias_not_expected_deployment/,
    "rollback authorization must fail when another control plane owns the canonical alias"
  );

  await assert.rejects(
    verifyCanonicalVercelProductionDeployment({
      env,
      fetchImpl: mockFetch({
        aliases: [
          alias({ id: candidateId, hostname: candidateHostname }),
          alias({ id: "dpl_externalProduction789", hostname: "external-production789.vercel.app" })
        ],
        deploymentValue: deployment({ id: candidateId, url: candidateHostname })
      }).fetchImpl,
      deploymentUrl: candidateOrigin
    }),
    /canonical_alias_changed_during_verification/,
    "rollback authorization must fail if canonical changes during its own verification"
  );

  const driftPath = join(temp, "alias-drift.json");
  const driftMock = mockFetch({
    aliases: [alias(), alias({
      id: "dpl_concurrentProduction456",
      hostname: "lynca-listing-copilot-concurrent456.vercel.app"
    })]
  });
  await assert.rejects(
    captureVercelProductionRollbackReceipt({
      env,
      fetchImpl: driftMock.fetchImpl,
      outputPath: driftPath
    }),
    /canonical_alias_changed_during_capture/
  );
  await assert.rejects(stat(driftPath), /ENOENT/,
    "an unstable canonical alias must never produce a rollback receipt");

  for (const [name, override] of [
    ["wrong team", { ownerId: "team_foreign" }],
    ["wrong project", { projectId: "prj_foreign" }],
    ["not ready", { readyState: "ERROR" }],
    ["not production", { target: null }]
  ]) {
    const invalidPath = join(temp, `${name.replaceAll(" ", "-")}.json`);
    await assert.rejects(
      captureVercelProductionRollbackReceipt({
        env,
        fetchImpl: mockFetch({ deploymentValue: deployment(override) }).fetchImpl,
        outputPath: invalidPath
      }),
      /deployment_identity_mismatch/,
      name
    );
    await assert.rejects(stat(invalidPath), /ENOENT/);
  }

  const shaMismatchPath = join(temp, "sha-mismatch.json");
  await assert.rejects(
    captureVercelProductionRollbackReceipt({
      env,
      fetchImpl: mockFetch({
        canonicalHealth: health("abcdef1234567890abcdef1234567890abcdef12")
      }).fetchImpl,
      outputPath: shaMismatchPath
    }),
    /health_identity_mismatch/
  );

  const badDomainPath = join(temp, "bad-domain.json");
  await writeFile(badDomainPath, JSON.stringify({
    ...receipt,
    deployment_url: "https://attacker.example"
  }), { mode: 0o600 });
  await assert.rejects(
    verifySavedVercelProductionDeployment({
      env,
      fetchImpl: mockFetch().fetchImpl,
      receiptPath: badDomainPath
    }),
    /invalid_deployment_url/
  );

  const secretFieldPath = join(temp, "secret-field.json");
  await writeFile(secretFieldPath, JSON.stringify({
    ...receipt,
    vercel_token: token
  }), { mode: 0o600 });
  await assert.rejects(
    verifySavedVercelProductionDeployment({
      env,
      fetchImpl: mockFetch().fetchImpl,
      receiptPath: secretFieldPath
    }),
    /shape_invalid/,
    "unexpected secret-bearing fields must be rejected instead of retained"
  );

  const permissivePath = join(temp, "permissive.json");
  await writeFile(permissivePath, serialized, { mode: 0o600 });
  await chmod(permissivePath, 0o644);
  await assert.rejects(
    verifySavedVercelProductionDeployment({
      env,
      fetchImpl: mockFetch().fetchImpl,
      receiptPath: permissivePath
    }),
    /permissions_invalid/
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("vercel production rollback receipt tests passed");
