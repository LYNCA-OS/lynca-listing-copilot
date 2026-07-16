import { ACTIVE_STATUS, TENANT_ROLE_VALUES } from "./constants.mjs";
import { normalizeTenantRole } from "./permissions.mjs";

const DISABLED_STATUS = "DISABLED";
const allowedStatuses = new Set([ACTIVE_STATUS, DISABLED_STATUS]);
const safeIdentifierPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;
const safeEmailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;

const membershipSelect = [
  "tenant_id",
  "user_id",
  "role",
  "status",
  "disabled_at",
  "created_at",
  "updated_at",
  "user:users!tenant_members_user_id_fkey!inner(id,email,status,disabled_at,auth_user_id)"
].join(",");

const publicErrors = Object.freeze({
  INVALID_MEMBER_REQUEST: { statusCode: 400, message: "Invalid team member request." },
  MEMBER_TARGET_NOT_FOUND: { statusCode: 404, message: "Team member target was not found." },
  MEMBER_NOT_FOUND: { statusCode: 404, message: "Team member was not found." },
  MEMBER_ALREADY_ACTIVE: { statusCode: 409, message: "Team member is already active." },
  MEMBER_STATE_CHANGED: { statusCode: 409, message: "Team member changed; refresh and try again." },
  LAST_ACTIVE_OWNER_REQUIRED: { statusCode: 409, message: "At least one active Owner is required." },
  MEMBER_DIRECTORY_UNAVAILABLE: { statusCode: 503, message: "Team member directory is temporarily unavailable." },
  MEMBER_OWNER_INVARIANT_UNAVAILABLE: { statusCode: 503, message: "Owner safety check failed; refresh before retrying." }
});

export class TenantMemberServiceError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(publicErrors, code) ? code : "MEMBER_DIRECTORY_UNAVAILABLE";
    super(publicErrors[safeCode].message);
    this.name = "TenantMemberServiceError";
    this.code = safeCode;
    this.statusCode = publicErrors[safeCode].statusCode;
  }
}

export function isTenantMemberServiceError(error) {
  return error instanceof TenantMemberServiceError;
}

function cleanText(value, maxLength = 512) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeTenantId(value) {
  const tenantId = cleanText(value, 160);
  if (!safeIdentifierPattern.test(tenantId)) throw new TenantMemberServiceError("INVALID_MEMBER_REQUEST");
  return tenantId;
}

function normalizeUserId(value, { optional = false } = {}) {
  const userId = cleanText(value, 160);
  if (!userId && optional) return "";
  if (!safeIdentifierPattern.test(userId)) throw new TenantMemberServiceError("INVALID_MEMBER_REQUEST");
  return userId;
}

function normalizeEmail(value, { optional = false } = {}) {
  const email = cleanText(value, 320).toLowerCase();
  if (!email && optional) return "";
  if (!email || email.length > 320 || !safeEmailPattern.test(email)) {
    throw new TenantMemberServiceError("INVALID_MEMBER_REQUEST");
  }
  return email;
}

function normalizeStatus(value, { optional = false } = {}) {
  const status = cleanText(value, 40).toUpperCase();
  if (!status && optional) return "";
  if (!allowedStatuses.has(status)) throw new TenantMemberServiceError("INVALID_MEMBER_REQUEST");
  return status;
}

function normalizeRole(value, { optional = false } = {}) {
  const role = normalizeTenantRole(value);
  if (!role && optional && !cleanText(value)) return "";
  if (!role || !TENANT_ROLE_VALUES.includes(role)) throw new TenantMemberServiceError("INVALID_MEMBER_REQUEST");
  return role;
}

function relatedRecord(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value && typeof value === "object" ? value : null;
}

function serviceConfig(env = process.env) {
  const rawUrl = cleanText(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, 2_048).replace(/\/+$/, "");
  const key = cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, 8_192);
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("invalid_protocol");
    if (!key) throw new Error("missing_key");
    return { url: url.origin, key };
  } catch {
    throw new TenantMemberServiceError("MEMBER_DIRECTORY_UNAVAILABLE");
  }
}

function serviceHeaders(key, { prefer = "" } = {}) {
  const headers = {
    apikey: key,
    accept: "application/json",
    "content-type": "application/json"
  };
  // New sb_secret keys are opaque API keys and are not valid Bearer JWTs.
  if (String(key).split(".").length === 3) headers.authorization = `Bearer ${key}`;
  if (prefer) headers.prefer = prefer;
  return headers;
}

function abortAfter(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(15_000, Number(timeoutMs) || 5_000)));
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function readResponseRows(response) {
  const text = await response.text();
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : value ? [value] : [];
  } catch {
    throw new TenantMemberServiceError("MEMBER_DIRECTORY_UNAVAILABLE");
  }
}

async function requestRows({
  table,
  method = "GET",
  select = "*",
  search = {},
  row,
  prefer = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000
} = {}) {
  const config = serviceConfig(env);
  if (typeof fetchImpl !== "function") throw new TenantMemberServiceError("MEMBER_DIRECTORY_UNAVAILABLE");
  const url = new URL(`${config.url}/rest/v1/${table}`);
  if (select) url.searchParams.set("select", select);
  for (const [key, value] of Object.entries(search || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const timeout = abortAfter(timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: serviceHeaders(config.key, { prefer }),
      ...(row === undefined ? {} : { body: JSON.stringify(row) }),
      signal: timeout.signal
    });
  } catch {
    throw new TenantMemberServiceError("MEMBER_DIRECTORY_UNAVAILABLE");
  } finally {
    timeout.cancel();
  }
  if (!response?.ok) {
    if (response?.status === 409) throw new TenantMemberServiceError("MEMBER_STATE_CHANGED");
    throw new TenantMemberServiceError("MEMBER_DIRECTORY_UNAVAILABLE");
  }
  return readResponseRows(response);
}

function publicMember(row, expectedTenantId) {
  const user = relatedRecord(row?.user);
  const tenantId = cleanText(row?.tenant_id, 160);
  const userId = cleanText(row?.user_id, 160);
  const role = normalizeTenantRole(row?.role);
  const status = normalizeStatus(row?.status);
  if (tenantId !== expectedTenantId || !user || !safeIdentifierPattern.test(userId) || !role) {
    throw new TenantMemberServiceError("MEMBER_DIRECTORY_UNAVAILABLE");
  }
  return Object.freeze({
    user_id: userId,
    email: cleanText(user.email, 320).toLowerCase() || null,
    role,
    status,
    auth_linked: Boolean(cleanText(user.auth_user_id, 160)),
    user_status: normalizeStatus(user.status),
    disabled_at: row.disabled_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  });
}

async function membershipRows({ tenantId, userId = "", email = "", limit = 2, ...options } = {}) {
  return requestRows({
    table: "tenant_members",
    select: membershipSelect,
    search: {
      tenant_id: `eq.${tenantId}`,
      ...(userId ? { user_id: `eq.${userId}` } : {}),
      ...(email ? { "user.email": `eq.${email}` } : {}),
      order: "created_at.asc,user_id.asc",
      limit: String(limit)
    },
    ...options
  });
}

async function findMembership({ tenantId, userId = "", email = "", ...options } = {}) {
  const rows = await membershipRows({ tenantId, userId, email, limit: 2, ...options });
  if (rows.length !== 1) return null;
  return { row: rows[0], member: publicMember(rows[0], tenantId) };
}

async function directoryUser({ userId = "", email = "", ...options } = {}) {
  const rows = await requestRows({
    table: "users",
    select: "id,email,status,disabled_at,auth_user_id",
    search: {
      ...(userId ? { id: `eq.${userId}` } : {}),
      ...(email ? { email: `eq.${email}` } : {}),
      status: `eq.${ACTIVE_STATUS}`,
      disabled_at: "is.null",
      auth_user_id: "not.is.null",
      limit: "2"
    },
    ...options
  });
  if (rows.length !== 1) throw new TenantMemberServiceError("MEMBER_TARGET_NOT_FOUND");
  const row = rows[0];
  const normalizedId = normalizeUserId(row.id);
  const normalizedEmail = normalizeEmail(row.email);
  if ((userId && normalizedId !== userId) || (email && normalizedEmail !== email)) {
    throw new TenantMemberServiceError("MEMBER_TARGET_NOT_FOUND");
  }
  return { id: normalizedId, email: normalizedEmail };
}

async function insertMembership({ tenantId, userId, role, now, ...options } = {}) {
  const rows = await requestRows({
    table: "tenant_members",
    method: "POST",
    select: membershipSelect,
    row: {
      tenant_id: tenantId,
      user_id: userId,
      role,
      status: ACTIVE_STATUS,
      disabled_at: null,
      updated_at: now
    },
    prefer: "return=representation",
    ...options
  });
  if (rows.length !== 1) throw new TenantMemberServiceError("MEMBER_STATE_CHANGED");
  return publicMember(rows[0], tenantId);
}

async function patchMembership({ tenantId, current, patch, now, ...options } = {}) {
  const rows = await requestRows({
    table: "tenant_members",
    method: "PATCH",
    select: membershipSelect,
    search: {
      tenant_id: `eq.${tenantId}`,
      user_id: `eq.${current.user_id}`,
      role: `eq.${current.role}`,
      status: `eq.${current.status}`,
      updated_at: `eq.${current.updated_at}`
    },
    row: { ...patch, updated_at: now },
    prefer: "return=representation",
    ...options
  });
  if (rows.length !== 1) throw new TenantMemberServiceError("MEMBER_STATE_CHANGED");
  return publicMember(rows[0], tenantId);
}

async function activeOwnerCount({ tenantId, ...options } = {}) {
  const rows = await requestRows({
    table: "tenant_members",
    select: "tenant_id,user_id,user:users!tenant_members_user_id_fkey!inner(id,status,disabled_at)",
    search: {
      tenant_id: `eq.${tenantId}`,
      role: "eq.OWNER",
      status: `eq.${ACTIVE_STATUS}`,
      disabled_at: "is.null",
      "user.status": `eq.${ACTIVE_STATUS}`,
      "user.disabled_at": "is.null",
      limit: "2"
    },
    ...options
  });
  for (const row of rows) {
    if (cleanText(row?.tenant_id, 160) !== tenantId) {
      throw new TenantMemberServiceError("MEMBER_DIRECTORY_UNAVAILABLE");
    }
  }
  return rows.length;
}

function selector({ userId, email } = {}) {
  const normalizedUserId = normalizeUserId(userId, { optional: true });
  const normalizedEmail = normalizeEmail(email, { optional: true });
  if (!normalizedUserId && !normalizedEmail) throw new TenantMemberServiceError("INVALID_MEMBER_REQUEST");
  return { userId: normalizedUserId, email: normalizedEmail };
}

export async function listTenantMembers({ tenantId, ...options } = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const rows = await membershipRows({ tenantId: normalizedTenantId, limit: 1_000, ...options });
  return Object.freeze(rows.map((row) => publicMember(row, normalizedTenantId)));
}

export async function requireActiveTenantMember({ tenantId, userId, ...options } = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedUserId = normalizeUserId(userId);
  const found = await findMembership({
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    ...options
  });
  const user = relatedRecord(found?.row?.user);
  if (
    !found
    || found.member.status !== ACTIVE_STATUS
    || found.member.disabled_at
    || found.member.user_status !== ACTIVE_STATUS
    || user?.disabled_at
  ) {
    // A missing, cross-tenant, disabled, or disabled-user membership is the
    // same public result. Callers must not learn another tenant's directory.
    throw new TenantMemberServiceError("MEMBER_NOT_FOUND");
  }
  return found.member;
}

export async function addTenantMember({ tenantId, userId, email, role, now = new Date().toISOString(), ...options } = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  // Require the exact email on adds. Accepting an opaque global user id alone
  // would turn this write endpoint into a cross-tenant email lookup oracle.
  const target = {
    userId: normalizeUserId(userId, { optional: true }),
    email: normalizeEmail(email)
  };
  const normalizedRole = normalizeRole(role);
  const user = await directoryUser({ ...target, ...options });
  const existing = await findMembership({ tenantId: normalizedTenantId, userId: user.id, ...options });
  if (existing?.member.status === ACTIVE_STATUS) throw new TenantMemberServiceError("MEMBER_ALREADY_ACTIVE");
  if (!existing) {
    return insertMembership({ tenantId: normalizedTenantId, userId: user.id, role: normalizedRole, now, ...options });
  }
  return patchMembership({
    tenantId: normalizedTenantId,
    current: existing.member,
    patch: { role: normalizedRole, status: ACTIVE_STATUS, disabled_at: null },
    now,
    ...options
  });
}

export async function updateTenantMember({
  tenantId,
  userId,
  email,
  role,
  status,
  now = new Date().toISOString(),
  ...options
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const target = selector({ userId, email });
  const found = await findMembership({ tenantId: normalizedTenantId, ...target, ...options });
  if (!found) throw new TenantMemberServiceError("MEMBER_NOT_FOUND");

  const nextRole = normalizeRole(role, { optional: true }) || found.member.role;
  const nextStatus = normalizeStatus(status, { optional: true }) || found.member.status;
  if (nextStatus === ACTIVE_STATUS && found.member.user_status !== ACTIVE_STATUS) {
    throw new TenantMemberServiceError("MEMBER_TARGET_NOT_FOUND");
  }
  if (nextRole === found.member.role && nextStatus === found.member.status) return found.member;

  const removesActiveOwner = found.member.role === "OWNER"
    && found.member.status === ACTIVE_STATUS
    && (nextRole !== "OWNER" || nextStatus !== ACTIVE_STATUS);
  if (removesActiveOwner) {
    const count = await activeOwnerCount({ tenantId: normalizedTenantId, ...options });
    if (count <= 1) throw new TenantMemberServiceError("LAST_ACTIVE_OWNER_REQUIRED");
  }

  const mutated = await patchMembership({
    tenantId: normalizedTenantId,
    current: found.member,
    patch: {
      role: nextRole,
      status: nextStatus,
      disabled_at: nextStatus === DISABLED_STATUS ? now : null
    },
    now,
    ...options
  });

  if (!removesActiveOwner) return mutated;

  // The pre-check handles normal operation. The post-check detects the
  // two-Owner concurrent-demotion race and uses a versioned compensating write;
  // a database transaction/RPC remains the strict cross-instance guarantee.
  let ownerCount = 0;
  let ownerCheckFailed = false;
  try {
    ownerCount = await activeOwnerCount({ tenantId: normalizedTenantId, ...options });
  } catch {
    ownerCheckFailed = true;
  }
  if (!ownerCheckFailed && ownerCount > 0) return mutated;

  try {
    await patchMembership({
      tenantId: normalizedTenantId,
      current: mutated,
      patch: { role: "OWNER", status: ACTIVE_STATUS, disabled_at: null },
      now: new Date(new Date(now).getTime() + 1).toISOString(),
      ...options
    });
  } catch {
    throw new TenantMemberServiceError("MEMBER_OWNER_INVARIANT_UNAVAILABLE");
  }
  throw new TenantMemberServiceError(ownerCheckFailed
    ? "MEMBER_OWNER_INVARIANT_UNAVAILABLE"
    : "LAST_ACTIVE_OWNER_REQUIRED");
}
