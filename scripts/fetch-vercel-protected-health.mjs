import { open, stat } from "node:fs/promises";
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
  return { hostname: url.hostname, origin: url.origin };
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

export async function vercelApiJson(fetchImpl, {
  token,
  teamId,
  pathname,
  method = "GET",
  body
}) {
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

async function verifyDeploymentIdentity(fetchImpl, {
  token,
  teamId,
  projectId,
  hostname
}) {
  const deployment = await vercelApiJson(fetchImpl, {
    token,
    teamId,
    pathname: `/v13/deployments/${encodeURIComponent(hostname)}`
  });
  if (deployment?.projectId !== projectId
    || deployment?.ownerId !== teamId
    || deployment?.url !== hostname
    || deployment?.readyState !== "READY") {
    throw new Error("vercel_protected_health_deployment_identity_mismatch");
  }
}

function setCookieValues(headers) {
  if (typeof headers?.getSetCookie === "function") return headers.getSetCookie();
  const value = headers?.get?.("set-cookie");
  return value ? [value] : [];
}

function candidateCookie(raw, hostname) {
  const [pair, ...attributes] = String(raw || "").split(";");
  const separator = pair.indexOf("=");
  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (separator < 1
    || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
    || !value
    || /[\u0000-\u001f\u007f;]/.test(value)) {
    throw new Error("vercel_protected_health_bypass_cookie_invalid");
  }
  const flags = new Map(attributes.map((part) => {
    const index = part.indexOf("=");
    const key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase();
    return [key, index < 0 ? true : part.slice(index + 1).trim()];
  }));
  const path = String(flags.get("path") || "/");
  if (path !== "/") {
    throw new Error("vercel_protected_health_bypass_cookie_path_invalid");
  }
  let expires = -1;
  const maxAge = Number(flags.get("max-age"));
  if (Number.isFinite(maxAge) && maxAge > 0) {
    expires = Math.floor(Date.now() / 1000) + maxAge;
  } else if (typeof flags.get("expires") === "string") {
    const parsed = Date.parse(flags.get("expires"));
    if (Number.isFinite(parsed)) expires = Math.floor(parsed / 1000);
  }
  const rawSameSite = String(flags.get("samesite") || "lax").toLowerCase();
  const sameSite = rawSameSite === "strict"
    ? "Strict"
    : rawSameSite === "none" ? "None" : "Lax";
  return {
    name,
    value,
    domain: hostname,
    path: "/",
    expires,
    httpOnly: flags.has("httponly"),
    secure: true,
    sameSite
  };
}

async function materializeCandidateStorageState(fetchImpl, {
  bypass,
  hostname,
  origin,
  outputPath
}) {
  const response = await fetchImpl(`${origin}/api/health`, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "x-vercel-protection-bypass": bypass,
      "x-vercel-set-bypass-cookie": "true"
    }
  });
  if (!response?.ok && !(response?.status >= 300 && response?.status < 400)) {
    throw new Error(`vercel_protected_health_cookie_exchange_failed_${Number(response?.status) || "unknown"}`);
  }
  const location = response.headers?.get?.("location");
  if (location && new URL(location, origin).origin !== origin) {
    throw new Error("vercel_protected_health_cookie_redirect_origin_mismatch");
  }
  const cookies = setCookieValues(response.headers).map((value) => candidateCookie(value, hostname));
  if (!cookies.length || new Set(cookies.map(({ name }) => name)).size !== cookies.length) {
    throw new Error("vercel_protected_health_bypass_cookie_unavailable");
  }
  const state = `${JSON.stringify({ cookies, origins: [] })}\n`;
  const file = await open(outputPath, "wx", 0o600);
  try {
    await file.writeFile(state, "utf8");
  } finally {
    await file.close();
  }
  if ((await stat(outputPath)).mode & 0o077) {
    throw new Error("vercel_protected_health_storage_state_permissions_invalid");
  }
}

export async function fetchVercelProtectedHealth({
  env = process.env,
  fetchImpl = fetch,
  storageStatePath = ""
} = {}) {
  const token = required(env, "VERCEL_TOKEN", /^\S{20,}$/);
  const teamId = required(env, "VERCEL_ORG_ID", /^team_[A-Za-z0-9]+$/);
  const projectId = required(env, "VERCEL_PROJECT_ID", /^prj_[A-Za-z0-9]+$/);
  const { hostname, origin } = deploymentOrigin(required(env, "DEPLOYMENT_URL"));
  await verifyDeploymentIdentity(fetchImpl, { token, teamId, projectId, hostname });
  const bypass = await resolveAutomationBypass(fetchImpl, { token, teamId, projectId });
  const response = await fetchImpl(`${origin}/api/health`, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "x-vercel-protection-bypass": bypass }
  });
  const health = await readJsonResponse(response, "vercel_protected_health_request_failed");
  if (storageStatePath) {
    await materializeCandidateStorageState(fetchImpl, {
      bypass,
      hostname,
      origin,
      outputPath: storageStatePath
    });
  }
  return health;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--storage-state");
  const storageStatePath = index < 0 ? "" : String(process.argv[index + 1] || "").trim();
  if ((index >= 0 && !storageStatePath)
    || process.argv.some((value, position) => position > 1
      && value !== "--storage-state"
      && position !== index + 1)) {
    throw new Error("vercel_protected_health_invalid_arguments");
  }
  const health = await fetchVercelProtectedHealth({ storageStatePath });
  process.stdout.write(`${JSON.stringify(health)}\n`);
}
