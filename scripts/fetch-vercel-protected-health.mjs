import { pathToFileURL } from "node:url";

const VERCEL_API_ORIGIN = "https://api.vercel.com";
const REQUEST_TIMEOUT_MS = 30_000;

function required(env, name, pattern) {
  const value = String(env?.[name] || "").trim();
  if (!value || (pattern && !pattern.test(value))) {
    throw new Error(`vercel_protected_health_invalid_${name.toLowerCase()}`);
  }
  return value;
}

function deploymentOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:"
    || url.origin !== raw
    || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)) {
    throw new Error("vercel_protected_health_invalid_deployment_url");
  }
  return url.origin;
}

function scopedApiUrl(pathname, teamId) {
  const url = new URL(pathname, VERCEL_API_ORIGIN);
  url.searchParams.set("teamId", teamId);
  return url;
}

async function readJsonResponse(response, errorCode) {
  if (!response?.ok) {
    throw new Error(`${errorCode}_${Number(response?.status) || "unknown"}`);
  }
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new Error(`${errorCode}_invalid_json`);
  }
}

async function vercelApiJson(fetchImpl, { token, teamId, pathname, method = "GET", body }) {
  const response = await fetchImpl(scopedApiUrl(pathname, teamId), {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body })
  });
  return readJsonResponse(response, "vercel_protected_health_api_failed");
}

function automationBypass(protectionBypass) {
  if (!protectionBypass || typeof protectionBypass !== "object" || Array.isArray(protectionBypass)) {
    return null;
  }
  for (const [token, metadata] of Object.entries(protectionBypass)) {
    if (metadata?.scope === "automation-bypass"
      && token.length >= 20
      && !/\s/.test(token)) {
      return token;
    }
  }
  return null;
}

async function resolveAutomationBypass(fetchImpl, { token, teamId, projectId }) {
  const pathname = `/v9/projects/${encodeURIComponent(projectId)}`;
  const project = await vercelApiJson(fetchImpl, { token, teamId, pathname });
  if (project?.id !== projectId || project?.accountId !== teamId) {
    throw new Error("vercel_protected_health_project_identity_mismatch");
  }
  const existing = automationBypass(project.protectionBypass);
  if (existing) return existing;

  const updated = await vercelApiJson(fetchImpl, {
    token,
    teamId,
    pathname: `/v1/projects/${encodeURIComponent(projectId)}/protection-bypass`,
    method: "PATCH",
    body: "{}"
  });
  const created = automationBypass(updated?.protectionBypass);
  if (!created) {
    throw new Error("vercel_protected_health_bypass_unavailable");
  }
  return created;
}

export async function fetchVercelProtectedHealth({ env = process.env, fetchImpl = fetch } = {}) {
  const token = required(env, "VERCEL_TOKEN", /^\S{20,}$/);
  const teamId = required(env, "VERCEL_ORG_ID", /^team_[A-Za-z0-9]+$/);
  const projectId = required(env, "VERCEL_PROJECT_ID", /^prj_[A-Za-z0-9]+$/);
  const origin = deploymentOrigin(required(env, "DEPLOYMENT_URL"));
  const bypass = await resolveAutomationBypass(fetchImpl, { token, teamId, projectId });
  const response = await fetchImpl(`${origin}/api/health`, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "x-vercel-protection-bypass": bypass }
  });
  return readJsonResponse(response, "vercel_protected_health_request_failed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const health = await fetchVercelProtectedHealth();
  process.stdout.write(`${JSON.stringify(health)}\n`);
}
