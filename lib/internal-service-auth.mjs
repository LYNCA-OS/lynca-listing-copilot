import crypto from "node:crypto";

export const internalServiceSecretHeader = "x-lynca-worker-secret";

// V4_JOB_WORKER_SECRET remains a deployment-compatibility fallback until the
// retired worker environment is removed. Product code owns the neutral
// internal-service contract exposed by this module.
export function configuredInternalServiceSecret(env = process.env) {
  return String(
    env.V4_JOB_WORKER_SECRET
      || env.LYNCA_INTERNAL_SERVICE_SECRET
      || env.LYNCA_WORKER_SECRET
      || env.VERCEL_AUTOMATION_BYPASS_SECRET
      || ""
  ).trim();
}

function requestHeader(req, name) {
  const headers = req?.headers;
  const value = typeof headers?.get === "function"
    ? headers.get(name)
    : headers?.[name] ?? headers?.[String(name).toLowerCase()];
  return String(Array.isArray(value) ? value[0] || "" : value || "").trim();
}

export function timingSafeSecretEqual(left, right) {
  const first = Buffer.from(String(left || ""));
  const second = Buffer.from(String(right || ""));
  return first.length > 0
    && first.length === second.length
    && crypto.timingSafeEqual(first, second);
}

export function isInternalServiceSecretConfigured(env = process.env) {
  return Boolean(configuredInternalServiceSecret(env));
}

export function isInternalServiceRequest(req, env = process.env) {
  const expected = configuredInternalServiceSecret(env);
  return Boolean(expected)
    && timingSafeSecretEqual(requestHeader(req, internalServiceSecretHeader), expected);
}

export function internalServiceAuthSummary(req, env = process.env) {
  return {
    configured: isInternalServiceSecretConfigured(env),
    authorized: isInternalServiceRequest(req, env),
    header: internalServiceSecretHeader
  };
}
