import crypto from "node:crypto";
import { TENANT_ROLE_VALUES } from "./constants.mjs";
import { readV4Rows, patchV4Row, writeV4Row } from "../listing/v4/session/supabase-rest.mjs";
import { addTenantMember, isTenantMemberServiceError } from "./members.mjs";

export const TENANT_INVITATION_STATUSES = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED"
});

export const TENANT_INVITATION_DURATIONS = Object.freeze([
  { value: "1m", label: "1 个月", months: 1 },
  { value: "3m", label: "3 个月", months: 3 },
  { value: "6m", label: "6 个月", months: 6 },
  { value: "1y", label: "1 年", months: 12 },
  { value: "permanent", label: "永久", months: 0 }
]);

const validStatuses = Object.freeze(new Set(Object.values(TENANT_INVITATION_STATUSES)));
const validDurations = Object.freeze(new Map(TENANT_INVITATION_DURATIONS.map((entry) => [entry.value, entry])));
const validRoleValues = new Set(TENANT_ROLE_VALUES);

const publicErrors = Object.freeze({
  INVALID_INVITATION_REQUEST: { statusCode: 400, message: "Invalid invitation request." },
  INVITATION_PENDING_EXISTS: { statusCode: 409, message: "A pending invitation already exists for this email." },
  INVITATION_STORAGE_UNAVAILABLE: { statusCode: 503, message: "Invitation service is temporarily unavailable." },
  INVITATION_TOKEN_NOT_FOUND: { statusCode: 404, message: "Invitation token was not found." },
  INVITATION_EXPIRED: { statusCode: 410, message: "Invitation has expired." },
  INVITATION_REVOKED: { statusCode: 410, message: "Invitation has been revoked." },
  INVITATION_EMAIL_MISMATCH: { statusCode: 403, message: "This invitation was issued to a different email." },
  INVITATION_ALREADY_ACCEPTED: { statusCode: 409, message: "Invitation already accepted." },
  INVITATION_TARGET_NOT_READY: { statusCode: 404, message: "Invited user has not been provisioned yet." },
  INVITATION_STORAGE_MISMATCH: { statusCode: 409, message: "Invitation data changed during acceptance." }
});

export class TenantInvitationServiceError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(publicErrors, code) ? code : "INVITATION_STORAGE_UNAVAILABLE";
    super(publicErrors[safeCode].message);
    this.name = "TenantInvitationServiceError";
    this.code = safeCode;
    this.statusCode = publicErrors[safeCode].statusCode;
  }
}

export function isTenantInvitationServiceError(error) {
  return error instanceof TenantInvitationServiceError;
}

const safeTextPattern = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;
const safeEmailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;
const safeInviteTokenPattern = /^[a-f0-9]{48}$/i;

function cleanText(value, maxLength = 512) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeTenantId(value) {
  const tenantId = cleanText(value, 160);
  if (!safeTextPattern.test(tenantId)) throw new TenantInvitationServiceError("INVALID_INVITATION_REQUEST");
  return tenantId;
}

function normalizeUserId(value) {
  const userId = cleanText(value, 160);
  if (!safeTextPattern.test(userId)) throw new TenantInvitationServiceError("INVALID_INVITATION_REQUEST");
  return userId;
}

function normalizeEmail(value) {
  const email = cleanText(value, 320).toLowerCase();
  if (!email || email.length > 320 || !safeEmailPattern.test(email)) {
    throw new TenantInvitationServiceError("INVALID_INVITATION_REQUEST");
  }
  return email;
}

function normalizeRole(value) {
  const role = cleanText(value, 40).toUpperCase();
  if (!validRoleValues.has(role)) throw new TenantInvitationServiceError("INVALID_INVITATION_REQUEST");
  return role;
}

function normalizeInviteToken(value) {
  const token = cleanText(value, 160).toLowerCase();
  if (!safeInviteTokenPattern.test(token)) throw new TenantInvitationServiceError("INVALID_INVITATION_REQUEST");
  return token;
}

function normalizeDuration(value) {
  const duration = cleanText(value, 24).toLowerCase().replace(/\s+/g, "");
  if (!validDurations.has(duration)) throw new TenantInvitationServiceError("INVALID_INVITATION_REQUEST");
  return duration;
}

function normalizeStatus(value, { optional = false } = {}) {
  const status = cleanText(value, 40).toUpperCase();
  if (!status && optional) return "";
  if (!validStatuses.has(status)) throw new TenantInvitationServiceError("INVALID_INVITATION_REQUEST");
  return status;
}

function normalizeLimit(value, { defaultValue = 50, maxValue = 200 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  const clamped = Math.floor(parsed);
  if (clamped < 1) return 1;
  if (clamped > maxValue) return maxValue;
  return clamped;
}

function addMonths(baseDate, months) {
  const date = new Date(baseDate);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function invitationExpired(invitation, now = new Date()) {
  const expiresAt = invitation?.expires_at ? new Date(String(invitation.expires_at)) : null;
  return Boolean(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime());
}

function publicInvitation(row) {
  const rawStatus = cleanText(row?.status, 40).toUpperCase();
  const status = validStatuses.has(rawStatus) ? rawStatus : TENANT_INVITATION_STATUSES.PENDING;
  const normalizedRole = TENANT_ROLE_VALUES.includes(cleanText(row?.role, 40).toUpperCase())
    ? cleanText(row.role, 40).toUpperCase()
    : TENANT_ROLE_VALUES[2];
  const now = new Date();
  const expiresAt = row?.expires_at || null;
  const effectiveStatus = status === TENANT_INVITATION_STATUSES.PENDING && invitationExpired(row, now)
    ? TENANT_INVITATION_STATUSES.EXPIRED
    : status;

  return Object.freeze({
    id: cleanText(row?.id, 160),
    tenant_id: cleanText(row?.tenant_id, 160),
    inviter_user_id: cleanText(row?.inviter_user_id, 160),
    email: cleanText(row?.email, 320).toLowerCase(),
    role: normalizedRole,
    status: effectiveStatus,
    expires_at: expiresAt,
    accepted_at: row?.accepted_at || null,
    revoked_at: row?.revoked_at || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    is_expired: effectiveStatus === TENANT_INVITATION_STATUSES.EXPIRED
  });
}

function secureToken(sizeBytes = 24) {
  return crypto.randomBytes(sizeBytes).toString("hex");
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function invitationExpiresAt(durationKey, baseDate = new Date()) {
  const definition = validDurations.get(durationKey) || validDurations.get("permanent");
  if (definition.months <= 0) return null;
  return nowIso(addMonths(baseDate, definition.months));
}

async function readInvitationRowByToken({
  token,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedToken = normalizeInviteToken(token);
  const rows = await readV4Rows({
    table: "tenant_invitations",
    select: "id,tenant_id,inviter_user_id,email,role,status,expires_at,accepted_at,revoked_at,created_at,updated_at,token_hash",
    search: {
      token_hash: `eq.${tokenHash(normalizedToken)}`,
      limit: "1"
    },
    env,
    fetchImpl
  });
  if (!rows?.ok) throw new TenantInvitationServiceError("INVITATION_STORAGE_UNAVAILABLE");
  if (!rows.rows || rows.rows.length !== 1) throw new TenantInvitationServiceError("INVITATION_TOKEN_NOT_FOUND");
  return rows.rows[0];
}

function invitationClaimStatus(row, now = new Date()) {
  const status = cleanText(row?.status, 40).toUpperCase() || TENANT_INVITATION_STATUSES.PENDING;
  if (!validStatuses.has(status)) throw new TenantInvitationServiceError("INVITATION_STORAGE_MISMATCH");

  if (status === TENANT_INVITATION_STATUSES.PENDING && invitationExpired(row, now)) {
    return TENANT_INVITATION_STATUSES.EXPIRED;
  }
  return status;
}

function mapTenantMemberError(error) {
  if (!isTenantMemberServiceError(error)) throw error;
  if (error.code === "MEMBER_TARGET_NOT_FOUND" || error.code === "MEMBER_NOT_FOUND") {
    throw new TenantInvitationServiceError("INVITATION_TARGET_NOT_READY");
  }
  if (error.code === "MEMBER_ALREADY_ACTIVE") {
    return null;
  }
  throw new TenantInvitationServiceError("INVITATION_STORAGE_UNAVAILABLE");
}

async function claimMembershipForEmail({ tenantId, email, role, env, fetchImpl }) {
  try {
    await addTenantMember({
      tenantId,
      email,
      role,
      env,
      fetchImpl
    });
    return;
  } catch (error) {
    mapTenantMemberError(error);
  }
}

async function readTenantInvitationsRows({
  tenantId,
  email = "",
  status = "",
  limit = 50,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const rows = await readV4Rows({
    table: "tenant_invitations",
    select: "id,tenant_id,inviter_user_id,email,role,status,expires_at,accepted_at,revoked_at,created_at,updated_at",
    search: {
      tenant_id: `eq.${tenantId}`,
      ...(status ? { status: `eq.${status}` } : {}),
      ...(email ? { email: `eq.${email}` } : {}),
      order: "created_at.desc,id.desc",
      limit: String(limit)
    },
    env,
    fetchImpl
  });
  if (!rows?.ok) throw new TenantInvitationServiceError("INVITATION_STORAGE_UNAVAILABLE");
  return rows.rows || [];
}

async function revokePendingInvitations({ tenantId, email, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const pending = await readTenantInvitationsRows({
    tenantId,
    email,
    status: TENANT_INVITATION_STATUSES.PENDING,
    limit: 50,
    env,
    fetchImpl
  });
  if (!pending.length) return 0;

  const now = nowIso();
  const updated = await Promise.all(pending.map((row) => patchV4Row({
    table: "tenant_invitations",
    id: cleanText(row.id, 160),
    patch: {
      status: TENANT_INVITATION_STATUSES.REVOKED,
      revoked_at: now,
      updated_at: now
    },
    env,
    fetchImpl
  })));
  return updated.filter((entry) => entry.saved).length;
}

export async function listTenantInvitations({
  tenantId,
  email,
  status,
  limit = 50,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedEmail = email ? normalizeEmail(email) : "";
  const normalizedStatus = status ? normalizeStatus(status) : "";
  const maxResults = normalizeLimit(limit);

  const rows = await readTenantInvitationsRows({
    tenantId: normalizedTenantId,
    email: normalizedEmail,
    status: normalizedStatus,
    limit: maxResults,
    env,
    fetchImpl
  });

  const now = new Date();
  const toExpire = rows.filter((row) => (
    cleanText(row?.status, 40).toUpperCase() === TENANT_INVITATION_STATUSES.PENDING
    && cleanText(row?.id, 160)
    && invitationExpired(row, now)
  ));

  if (toExpire.length) {
    const toExpireIds = toExpire.map((row) => cleanText(row.id, 160));
    await Promise.all(toExpireIds.map((id) => patchV4Row({
      table: "tenant_invitations",
      id,
      patch: {
        status: TENANT_INVITATION_STATUSES.EXPIRED,
        updated_at: nowIso(now)
      },
      env,
      fetchImpl
    })));
  }

  return Object.freeze(rows.map((row) => publicInvitation(row)));
}

export async function claimTenantInvitation({
  token,
  email,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  const nowTime = nowIso(now instanceof Date ? now : new Date(now));
  const normalizedEmail = normalizeEmail(email);
  const row = await readInvitationRowByToken({ token, env, fetchImpl });
  const status = invitationClaimStatus(row, new Date(nowTime));

  if (cleanText(row?.email, 320).toLowerCase() !== normalizedEmail) {
    throw new TenantInvitationServiceError("INVITATION_EMAIL_MISMATCH");
  }
  if (status === TENANT_INVITATION_STATUSES.REVOKED) {
    throw new TenantInvitationServiceError("INVITATION_REVOKED");
  }
  if (status === TENANT_INVITATION_STATUSES.EXPIRED) {
    const expiredPatch = await patchV4Row({
      table: "tenant_invitations",
      id: cleanText(row.id, 160),
      patch: {
        status: TENANT_INVITATION_STATUSES.EXPIRED,
        updated_at: nowTime
      },
      env,
      fetchImpl
    });
    if (!expiredPatch?.saved) throw new TenantInvitationServiceError("INVITATION_STORAGE_UNAVAILABLE");
    throw new TenantInvitationServiceError("INVITATION_EXPIRED");
  }
  if (status === TENANT_INVITATION_STATUSES.ACCEPTED) {
    return Object.freeze({
      invitation: publicInvitation(row),
      tenantId: cleanText(row?.tenant_id, 160)
    });
  }
  if (status !== TENANT_INVITATION_STATUSES.PENDING) {
    throw new TenantInvitationServiceError("INVITATION_STORAGE_MISMATCH");
  }

  const normalizedTenantId = normalizeTenantId(row.tenant_id);
  const normalizedRole = normalizeRole(row.role);

  await claimMembershipForEmail({
    tenantId: normalizedTenantId,
    email: normalizedEmail,
    role: normalizedRole,
    env,
    fetchImpl
  });

  const acceptedPatch = await patchV4Row({
    table: "tenant_invitations",
    id: cleanText(row.id, 160),
    patch: {
      status: TENANT_INVITATION_STATUSES.ACCEPTED,
      accepted_at: nowTime,
      revoked_at: null,
      updated_at: nowTime
    },
    env,
    fetchImpl
  });
  if (!acceptedPatch?.saved) throw new TenantInvitationServiceError("INVITATION_STORAGE_UNAVAILABLE");

  return Object.freeze({
    invitation: publicInvitation({
      ...row,
      status: TENANT_INVITATION_STATUSES.ACCEPTED,
      accepted_at: nowTime,
      revoked_at: null,
      updated_at: nowTime
    }),
    tenantId: normalizedTenantId
  });
}

export async function createTenantInvitation({
  tenantId,
  inviterUserId,
  email,
  role,
  duration = "permanent",
  resend = false,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedInviterUserId = normalizeUserId(inviterUserId);
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = normalizeRole(role);
  const normalizedDuration = normalizeDuration(duration);

  if (!resend) {
    const pending = await listTenantInvitations({
      tenantId: normalizedTenantId,
      email: normalizedEmail,
      status: TENANT_INVITATION_STATUSES.PENDING,
      limit: 1,
      env,
      fetchImpl
    });
    if (pending.length) throw new TenantInvitationServiceError("INVITATION_PENDING_EXISTS");
  } else {
    await revokePendingInvitations({
      tenantId: normalizedTenantId,
      email: normalizedEmail,
      env,
      fetchImpl
    });
  }

  const token = secureToken();
  const createdAt = nowIso();
  const expiresAt = invitationExpiresAt(normalizedDuration);
  const write = await writeV4Row({
    table: "tenant_invitations",
    row: {
      tenant_id: normalizedTenantId,
      inviter_user_id: normalizedInviterUserId,
      email: normalizedEmail,
      role: normalizedRole,
      status: TENANT_INVITATION_STATUSES.PENDING,
      token_hash: tokenHash(token),
      expires_at: expiresAt,
      created_at: createdAt,
      updated_at: createdAt
    },
    env,
    fetchImpl
  });

  if (!write.saved || !write.row) {
    throw new TenantInvitationServiceError("INVITATION_STORAGE_UNAVAILABLE");
  }

  return {
    invitation: publicInvitation(write.row),
    token,
    expires_at: expiresAt
  };
}
