import crypto from "node:crypto";
import { getSessionFromRequest, timingSafeStringEqual } from "../listing-session.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "../listing/v4/jobs/worker-auth.mjs";
import { ACTOR_TYPES, ACTIVE_STATUS, WORKER_ROLE } from "./constants.mjs";
import { TenantAuthError } from "./errors.mjs";
import { normalizeTenantRole, requirePermission } from "./permissions.mjs";

const membershipSelect = [
  "tenant_id",
  "user_id",
  "role",
  "status",
  "disabled_at",
  "user:users!tenant_members_user_id_fkey!inner(id,email,status,session_version,disabled_at,auth_user_id)",
  "tenant:tenants!tenant_members_tenant_id_fkey!inner(id,name,plan,status,disabled_at)"
].join(",");
const transientMembershipStatuses = new Set([408, 425, 429]);

function cleanText(value, maxLength = 512) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizedStatus(value) {
  return cleanText(value, 40).toUpperCase();
}

function headerValue(req, name) {
  const lower = String(name || "").toLowerCase();
  const headers = req?.headers;
  const value = typeof headers?.get === "function"
    ? headers.get(lower)
    : headers?.[lower] ?? headers?.[name];
  return cleanText(Array.isArray(value) ? value[0] : value, 1_024);
}

export function requestIdFrom(req) {
  const supplied = headerValue(req, "x-request-id");
  return supplied && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

function serviceConfig(env = process.env) {
  const url = cleanText(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, 2_048).replace(/\/+$/, "");
  const key = cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, 8_192);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return { url: "", key: "" };
    }
    return { url: parsed.origin, key };
  } catch {
    return { url: "", key: "" };
  }
}

function abortAfter(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs) || 5_000));
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function serviceHeaders(key) {
  const headers = { apikey: key, accept: "application/json" };
  // sb_secret keys are opaque and must not be sent as Bearer JWTs. Legacy
  // service_role keys are JWTs and keep the compatibility header.
  if (String(key).split(".").length === 3) headers.authorization = `Bearer ${key}`;
  return headers;
}

async function fetchMembershipRows(filters, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
  limit = 2
} = {}) {
  const config = serviceConfig(env);
  if (!config.url || !config.key || typeof fetchImpl !== "function") {
    throw new TenantAuthError("AUTH_CONFIGURATION_ERROR");
  }

  const url = new URL(`${config.url}/rest/v1/tenant_members`);
  url.searchParams.set("select", membershipSelect);
  url.searchParams.set("limit", String(Math.max(1, Math.min(100, Number(limit) || 2))));
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const timeout = abortAfter(timeoutMs);
    let response = null;
    let rows = null;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: serviceHeaders(config.key),
        signal: timeout.signal
      });
      if (response?.ok) {
        const parsed = await response.json();
        if (Array.isArray(parsed)) rows = parsed;
      }
    } catch {
      response = null;
    } finally {
      timeout.cancel();
    }

    if (rows) return rows;
    const status = Number(response?.status || 0);
    const retryable = !response || response.ok || transientMembershipStatuses.has(status) || status >= 500;
    if (!retryable || attempt === maxAttempts - 1) throw new TenantAuthError("AUTH_UNAVAILABLE");
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 125 : 400));
  }
  throw new TenantAuthError("AUTH_UNAVAILABLE");
}

function relatedRecord(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value && typeof value === "object" ? value : null;
}

function isActiveRecord(record) {
  return Boolean(record && normalizedStatus(record.status) === ACTIVE_STATUS && !record.disabled_at);
}

function validatedMembership(row, {
  expectedTenantId = "",
  expectedUserId = "",
  expectedAuthUserId = "",
  sessionVersion
} = {}) {
  const user = relatedRecord(row?.user);
  const tenant = relatedRecord(row?.tenant);
  const role = normalizeTenantRole(row?.role);
  const tenantId = cleanText(row?.tenant_id, 160);
  const userId = cleanText(row?.user_id, 160);
  const storedSessionVersion = Number(user?.session_version);

  if (!row || !role || !isActiveRecord(row) || !isActiveRecord(user) || !isActiveRecord(tenant)) return null;
  if (!tenantId || !userId || tenantId !== cleanText(tenant?.id, 160) || userId !== cleanText(user?.id, 160)) return null;
  if (expectedTenantId && tenantId !== expectedTenantId) return null;
  if (expectedUserId && userId !== expectedUserId) return null;
  if (expectedAuthUserId && cleanText(user?.auth_user_id, 160) !== expectedAuthUserId) return null;
  if (!Number.isSafeInteger(storedSessionVersion) || storedSessionVersion < 1) return null;
  if (sessionVersion !== undefined && Number(sessionVersion) !== storedSessionVersion) return null;

  return { row, user, tenant, role, tenantId, userId, sessionVersion: storedSessionVersion };
}

function buildUserContext(membership, requestId) {
  const { user, tenant, role, tenantId, userId, sessionVersion } = membership;
  return Object.freeze({
    requestId,
    actorType: ACTOR_TYPES.USER,
    tenantId,
    userId,
    email: cleanText(user.email, 320).toLowerCase(),
    role,
    sessionVersion,
    tenant: Object.freeze({
      id: tenantId,
      name: cleanText(tenant.name, 320),
      plan: cleanText(tenant.plan, 80)
    }),
    user: Object.freeze({
      id: userId,
      email: cleanText(user.email, 320).toLowerCase()
    })
  });
}

export async function listTenantChoicesForAuthUser({ authUserId } = {}, options = {}) {
  const normalizedAuthUserId = cleanText(authUserId, 160);
  if (!normalizedAuthUserId) throw new TenantAuthError("ACCESS_DENIED");

  const rows = await fetchMembershipRows({
    "user.auth_user_id": `eq.${normalizedAuthUserId}`,
    status: `eq.${ACTIVE_STATUS}`,
    disabled_at: "is.null",
    "user.status": `eq.${ACTIVE_STATUS}`,
    "user.disabled_at": "is.null",
    "tenant.status": `eq.${ACTIVE_STATUS}`,
    "tenant.disabled_at": "is.null"
  }, { ...options, limit: 100 });

  const choices = rows
    .map((row) => validatedMembership(row, { expectedAuthUserId: normalizedAuthUserId }))
    .filter(Boolean)
    .map((membership) => Object.freeze({
      tenantId: membership.tenantId,
      name: cleanText(membership.tenant.name, 320),
      role: membership.role
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.tenantId.localeCompare(right.tenantId));
  return Object.freeze(choices);
}

export async function resolveTenantIdentityForAuthUser({ authUserId, tenantId } = {}, options = {}) {
  const normalizedAuthUserId = cleanText(authUserId, 160);
  const normalizedTenantId = cleanText(tenantId, 160);
  if (!normalizedAuthUserId) throw new TenantAuthError("ACCESS_DENIED");

  const rows = await fetchMembershipRows({
    "user.auth_user_id": `eq.${normalizedAuthUserId}`,
    ...(normalizedTenantId ? { tenant_id: `eq.${normalizedTenantId}` } : {}),
    status: `eq.${ACTIVE_STATUS}`,
    disabled_at: "is.null",
    "user.status": `eq.${ACTIVE_STATUS}`,
    "user.disabled_at": "is.null",
    "tenant.status": `eq.${ACTIVE_STATUS}`,
    "tenant.disabled_at": "is.null"
  }, options);

  const memberships = rows
    .map((row) => validatedMembership(row, {
      expectedTenantId: normalizedTenantId,
      expectedAuthUserId: normalizedAuthUserId
    }))
    .filter(Boolean);
  if (memberships.length === 0) throw new TenantAuthError("ACCESS_DENIED");
  if (memberships.length !== 1) throw new TenantAuthError("TENANT_SELECTION_REQUIRED");

  const membership = memberships[0];
  return Object.freeze({
    userId: membership.userId,
    tenantId: membership.tenantId,
    email: cleanText(membership.user.email, 320).toLowerCase(),
    role: membership.role,
    sessionVersion: membership.sessionVersion
  });
}

export async function resolveTenantIdentityForPrincipal({ tenantId, userId } = {}, options = {}) {
  const normalizedTenantId = cleanText(tenantId, 160);
  const normalizedUserId = cleanText(userId, 160);
  if (!normalizedTenantId || !normalizedUserId) throw new TenantAuthError("ACCESS_DENIED");

  const rows = await fetchMembershipRows({
    tenant_id: `eq.${normalizedTenantId}`,
    user_id: `eq.${normalizedUserId}`,
    status: `eq.${ACTIVE_STATUS}`,
    disabled_at: "is.null",
    "user.status": `eq.${ACTIVE_STATUS}`,
    "user.disabled_at": "is.null",
    "tenant.status": `eq.${ACTIVE_STATUS}`,
    "tenant.disabled_at": "is.null"
  }, options);
  if (rows.length !== 1) throw new TenantAuthError("ACCESS_DENIED");
  const membership = validatedMembership(rows[0], {
    expectedTenantId: normalizedTenantId,
    expectedUserId: normalizedUserId
  });
  if (!membership) throw new TenantAuthError("ACCESS_DENIED");

  return Object.freeze({
    userId: membership.userId,
    tenantId: membership.tenantId,
    email: cleanText(membership.user.email, 320).toLowerCase(),
    role: membership.role,
    sessionVersion: membership.sessionVersion
  });
}

export async function requireTenantAccess(req, {
  permission,
  resourceTenantId,
  assignedUserId,
  assigneeUserId,
  assignment,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000
} = {}) {
  const requestId = requestIdFrom(req);
  const session = getSessionFromRequest(req, env);
  const tenantId = cleanText(session?.tenant_id, 160);
  const userId = cleanText(session?.user_id, 160);
  if (!session || !tenantId || !userId) {
    throw new TenantAuthError("AUTH_REQUIRED", { requestId });
  }

  let rows;
  try {
    rows = await fetchMembershipRows({
      tenant_id: `eq.${tenantId}`,
      user_id: `eq.${userId}`
    }, { env, fetchImpl, timeoutMs });
  } catch (error) {
    if (error instanceof TenantAuthError) error.requestId = requestId;
    throw error;
  }

  if (rows.length !== 1) throw new TenantAuthError("ACCESS_DENIED", { requestId });
  const membership = validatedMembership(rows[0], {
    expectedTenantId: tenantId,
    expectedUserId: userId,
    sessionVersion: session.session_version
  });
  if (!membership) throw new TenantAuthError("ACCESS_DENIED", { requestId });

  const context = buildUserContext(membership, requestId);
  const persistedResourceTenantId = cleanText(resourceTenantId, 160);
  if (persistedResourceTenantId && persistedResourceTenantId !== context.tenantId) {
    throw new TenantAuthError("ACCESS_DENIED", { requestId });
  }
  if (permission) {
    requirePermission(context, permission, { assignedUserId, assigneeUserId, assignment });
  }
  return context;
}

export function requireWorkerContext(req, { job, env = process.env } = {}) {
  const requestId = requestIdFrom(req);
  const expected = configuredWorkerSecret(env);
  const supplied = headerValue(req, workerSecretHeader);
  if (!expected || !supplied || !timingSafeStringEqual(supplied, expected)) {
    throw new TenantAuthError("AUTH_REQUIRED", { requestId });
  }

  // `job` must be the persisted row fetched by the worker claim, never a fresh
  // request payload. This keeps tenant choice out of the worker credential.
  const tenantId = cleanText(job?.tenant_id, 160);
  if (!tenantId) throw new TenantAuthError("ACCESS_DENIED", { requestId });
  const userId = cleanText(
    job?.assigned_to_user_id || job?.assigned_user_id || job?.created_by_user_id || job?.user_id,
    160
  ) || null;

  return Object.freeze({
    requestId,
    actorType: ACTOR_TYPES.WORKER,
    tenantId,
    userId,
    email: null,
    role: WORKER_ROLE,
    sessionVersion: null,
    tenant: Object.freeze({ id: tenantId, name: "", plan: "" }),
    user: userId ? Object.freeze({ id: userId, email: null }) : null
  });
}

export { workerSecretHeader };
