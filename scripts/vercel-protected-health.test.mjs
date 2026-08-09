import assert from "node:assert/strict";
import { mkdtemp, readFile, rmdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchVercelProtectedHealth } from "./fetch-vercel-protected-health.mjs";

const env = {
  VERCEL_TOKEN: "test_vercel_token_1234567890",
  VERCEL_ORG_ID: "team_test123",
  VERCEL_PROJECT_ID: "prj_test456",
  DEPLOYMENT_URL: "https://lynca-test-team.vercel.app"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function deploymentIdentity(overrides = {}) {
  return {
    projectId: env.VERCEL_PROJECT_ID,
    ownerId: env.VERCEL_ORG_ID,
    url: new URL(env.DEPLOYMENT_URL).hostname,
    readyState: "READY",
    ...overrides
  };
}

{
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return jsonResponse(deploymentIdentity());
    if (calls.length === 2) {
      return jsonResponse({
        id: env.VERCEL_PROJECT_ID,
        accountId: env.VERCEL_ORG_ID,
        protectionBypass: { "existing-bypass-token-123456": { scope: "automation-bypass" } }
      });
    }
    return jsonResponse({ ready: true, deployment: { git_commit_sha: "abc" } });
  };
  const health = await fetchVercelProtectedHealth({ env, fetchImpl });
  assert.equal(health.ready, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url,
    "https://api.vercel.com/v13/deployments/lynca-test-team.vercel.app?teamId=team_test123");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${env.VERCEL_TOKEN}`);
  assert.equal(calls[1].url,
    "https://api.vercel.com/v9/projects/prj_test456?teamId=team_test123");
  assert.equal(calls[2].url, `${env.DEPLOYMENT_URL}/api/health`);
  assert.equal(calls[2].init.redirect, "error");
  assert.equal(calls[2].init.headers["x-vercel-protection-bypass"], "existing-bypass-token-123456");
}

{
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return jsonResponse(deploymentIdentity());
    if (calls.length === 2) {
      return jsonResponse({
        id: env.VERCEL_PROJECT_ID,
        accountId: env.VERCEL_ORG_ID,
        protectionBypass: {}
      });
    }
    if (calls.length === 3) {
      return jsonResponse({
        protectionBypass: { "created-bypass-token-1234567": { scope: "automation-bypass" } }
      });
    }
    return jsonResponse({ ready: true });
  };
  await fetchVercelProtectedHealth({ env, fetchImpl });
  assert.equal(calls.length, 4);
  assert.equal(calls[2].url,
    "https://api.vercel.com/v1/projects/prj_test456/protection-bypass?teamId=team_test123");
  assert.equal(calls[2].init.method, "PATCH");
  assert.equal(calls[2].init.body, "{}");
  assert.equal(calls[3].init.headers["x-vercel-protection-bypass"], "created-bypass-token-1234567");
}

{
  const calls = [];
  const bypass = "existing-bypass-token-123456";
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lynca-vercel-state-"));
  const storageStatePath = join(temporaryDirectory, "candidate-storage-state.json");
  try {
    const health = await fetchVercelProtectedHealth({
      env,
      storageStatePath,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) return jsonResponse(deploymentIdentity());
        if (calls.length === 2) {
          return jsonResponse({
            id: env.VERCEL_PROJECT_ID,
            accountId: env.VERCEL_ORG_ID,
            protectionBypass: { [bypass]: { scope: "automation-bypass" } }
          });
        }
        if (calls.length === 3) {
          return jsonResponse({ ready: true, deployment: { git_commit_sha: "abc" } });
        }
        return new Response(null, {
          status: 307,
          headers: {
            location: "/api/health",
            "set-cookie": "__vercel_live_token=candidate-cookie; Domain=.vercel.app; Path=/; HttpOnly; Secure; SameSite=Lax"
          }
        });
      }
    });
    const state = JSON.parse(await readFile(storageStatePath, "utf8"));
    assert.equal(health.ready, true);
    assert.equal(calls.length, 4);
    assert.deepEqual(state.origins, []);
    assert.equal(state.cookies.length, 1);
    assert.equal(state.cookies[0].domain, new URL(env.DEPLOYMENT_URL).hostname,
      "a broad Set-Cookie Domain must be narrowed to the verified candidate hostname");
    assert.equal(state.cookies[0].path, "/");
    assert.equal(state.cookies[0].secure, true);
    assert.equal((await stat(storageStatePath)).mode & 0o077, 0);
    assert.ok(!JSON.stringify(health).includes(bypass));
    assert.ok(!JSON.stringify(state).includes(bypass));
    assert.equal(calls[0].init.headers["x-vercel-protection-bypass"], undefined);
    assert.equal(calls[1].init.headers["x-vercel-protection-bypass"], undefined);
    assert.equal(calls[2].url, `${env.DEPLOYMENT_URL}/api/health`);
    assert.equal(calls[3].url, `${env.DEPLOYMENT_URL}/api/health`);
    assert.equal(calls[3].init.redirect, "manual");
    assert.equal(calls[3].init.headers["x-vercel-set-bypass-cookie"], "true");
    assert.ok(calls.slice(2).every(({ url }) => new URL(url).origin === env.DEPLOYMENT_URL));
  } finally {
    await unlink(storageStatePath).catch(() => {});
    await rmdir(temporaryDirectory);
  }
}

{
  const calls = [];
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lynca-vercel-redirect-"));
  const storageStatePath = join(temporaryDirectory, "candidate-storage-state.json");
  try {
    await assert.rejects(fetchVercelProtectedHealth({
      env,
      storageStatePath,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) return jsonResponse(deploymentIdentity());
        if (calls.length === 2) {
          return jsonResponse({
            id: env.VERCEL_PROJECT_ID,
            accountId: env.VERCEL_ORG_ID,
            protectionBypass: {
              "existing-bypass-token-123456": { scope: "automation-bypass" }
            }
          });
        }
        if (calls.length === 3) return jsonResponse({ ready: true });
        return new Response(null, {
          status: 307,
          headers: {
            location: "https://project.supabase.co/rest/v1/",
            "set-cookie": "__vercel_live_token=must-not-follow; Path=/; Secure"
          }
        });
      }
    }), /cookie_redirect_origin_mismatch/);
    assert.equal(calls.length, 4,
      "a cross-origin cookie redirect must fail before any Supabase request can receive the bypass header");
    assert.ok(calls.every(({ url }) => !String(url).includes("supabase.co")));
  } finally {
    await unlink(storageStatePath).catch(() => {});
    await rmdir(temporaryDirectory);
  }
}

for (const identity of [
  deploymentIdentity({ projectId: "prj_attacker", url: "evil.vercel.app" }),
  deploymentIdentity({ ownerId: "team_attacker", url: "evil.vercel.app" }),
  deploymentIdentity({ url: "other.vercel.app" }),
  deploymentIdentity({ readyState: "BUILDING", url: "evil.vercel.app" }),
  { url: "evil.vercel.app", readyState: "READY" }
]) {
  const calls = [];
  await assert.rejects(
    fetchVercelProtectedHealth({
      env: { ...env, DEPLOYMENT_URL: "https://evil.vercel.app" },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse(identity);
      }
    }),
    /deployment_identity_mismatch/
  );
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes("/v9/projects/"));
  assert.equal(calls[0].init.headers.authorization, `Bearer ${env.VERCEL_TOKEN}`);
  assert.equal(calls[0].init.headers["x-vercel-protection-bypass"], undefined);
}

await assert.rejects(
  fetchVercelProtectedHealth({
    env,
    fetchImpl: async (url) => String(url).includes("/v13/deployments/")
      ? jsonResponse(deploymentIdentity())
      : jsonResponse({ id: "prj_wrong", accountId: env.VERCEL_ORG_ID })
  }),
  /project_identity_mismatch/
);

await assert.rejects(
  fetchVercelProtectedHealth({
    env: { ...env, DEPLOYMENT_URL: "https://example.com" },
    fetchImpl: async () => { throw new Error("must_not_fetch"); }
  }),
  /invalid_deployment_url/
);

await assert.rejects(
  fetchVercelProtectedHealth({
    env,
    fetchImpl: async () => jsonResponse({}, 302)
  }),
  /api_failed_302/
);

console.log("Vercel protected health tests passed");
