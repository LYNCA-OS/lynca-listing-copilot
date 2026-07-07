import crypto from "node:crypto";

export const workerSecretHeader = "x-lynca-worker-secret";

function configuredWorkerSecret(env = process.env) {
  return String(env.V4_JOB_WORKER_SECRET || env.LYNCA_WORKER_SECRET || env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();
}

function headerValue(req, name) {
  return String(req?.headers?.[name] || req?.headers?.[String(name).toLowerCase()] || "").trim();
}

function constantTimeEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isV4WorkerSecretConfigured(env = process.env) {
  return Boolean(configuredWorkerSecret(env));
}

export function isV4WorkerRequest(req, env = process.env) {
  const expected = configuredWorkerSecret(env);
  if (!expected) return false;
  return constantTimeEquals(headerValue(req, workerSecretHeader), expected);
}

export function workerAuthSummary(req, env = process.env) {
  return {
    configured: isV4WorkerSecretConfigured(env),
    authorized: isV4WorkerRequest(req, env),
    header: workerSecretHeader
  };
}
