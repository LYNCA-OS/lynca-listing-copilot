import assert from "node:assert/strict";
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

{
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
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
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url,
    "https://api.vercel.com/v9/projects/prj_test456?teamId=team_test123");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${env.VERCEL_TOKEN}`);
  assert.equal(calls[1].url, `${env.DEPLOYMENT_URL}/api/health`);
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(calls[1].init.headers["x-vercel-protection-bypass"], "existing-bypass-token-123456");
}

{
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return jsonResponse({
        id: env.VERCEL_PROJECT_ID,
        accountId: env.VERCEL_ORG_ID,
        protectionBypass: {}
      });
    }
    if (calls.length === 2) {
      return jsonResponse({
        protectionBypass: { "created-bypass-token-1234567": { scope: "automation-bypass" } }
      });
    }
    return jsonResponse({ ready: true });
  };
  await fetchVercelProtectedHealth({ env, fetchImpl });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url,
    "https://api.vercel.com/v1/projects/prj_test456/protection-bypass?teamId=team_test123");
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(calls[1].init.body, "{}");
  assert.equal(calls[2].init.headers["x-vercel-protection-bypass"], "created-bypass-token-1234567");
}

await assert.rejects(
  fetchVercelProtectedHealth({
    env,
    fetchImpl: async () => jsonResponse({ id: "prj_wrong", accountId: env.VERCEL_ORG_ID })
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
