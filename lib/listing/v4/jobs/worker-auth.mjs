import crypto from "node:crypto";
import {
  configuredInternalServiceSecret,
  internalServiceAuthSummary,
  internalServiceSecretHeader,
  isInternalServiceRequest,
  isInternalServiceSecretConfigured
} from "../../../internal-service-auth.mjs";

export const workerSecretHeader = internalServiceSecretHeader;

export function configuredWorkerSecret(env = process.env) {
  return configuredInternalServiceSecret(env);
}

function headerValue(req, name) {
  const headers = req?.headers;
  const value = typeof headers?.get === "function"
    ? headers.get(name)
    : headers?.[name] ?? headers?.[String(name).toLowerCase()];
  return String(Array.isArray(value) ? value[0] || "" : value || "").trim();
}

function constantTimeEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isV4WorkerSecretConfigured(env = process.env) {
  return isInternalServiceSecretConfigured(env);
}

export function isV4WorkerRequest(req, env = process.env) {
  return isInternalServiceRequest(req, env);
}

export function configuredV4CronSecret(env = process.env) {
  return String(env.CRON_SECRET || env.V4_JOB_PUMP_CRON_SECRET || "").trim();
}

export function isV4CronRequest(req, env = process.env) {
  const expected = configuredV4CronSecret(env);
  if (!expected) return false;
  return constantTimeEquals(headerValue(req, "authorization"), `Bearer ${expected}`);
}

export function workerAuthSummary(req, env = process.env) {
  return internalServiceAuthSummary(req, env);
}
