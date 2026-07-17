import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  ACTIVE_STATUS,
  LEGACY_TENANT_ID,
  LEGACY_USER_ID,
  LISTING_SESSION_VERSION,
  PERMISSION_SCOPES,
  ROLE_PERMISSION_MATRIX,
  TENANT_PERMISSIONS,
  TENANT_ROLES,
  TenantAuthError,
  authenticatePassword,
  authenticateSupabasePassword,
  hasTenantPermission,
  listTenantChoicesForAuthUser,
  permissionScopeFor,
  publicTenantAuthError,
  requireTenantAccess,
  requireWorkerContext,
  resolveTenantIdentityForAuthUser,
  supabasePasswordAuthConfig
} from "../lib/tenant/index.mjs";
import {
  cookieName,
  createListingSessionToken,
  createSignedSessionToken,
  readListingSession,
  readSignedSession
} from "../lib/listing-session.mjs";

const secret = "tenant-access-test-session-secret";
const serviceEnv = Object.freeze({
  METAVERSE_AUTH_SECRET: secret,
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_server_only",
  V4_JOB_WORKER_SECRET: "worker-secret"
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function expectCode(fn, code) {
  await assert.rejects(fn, (error) => {
    assert.ok(error instanceof TenantAuthError);
    assert.equal(error.code, code);
    assert.ok(!/password|service.role|upstream detail/i.test(error.message));
    return true;
  });
}

function membershipRow({
  tenantId = "tenant_a",
  userId = "user_a",
  authUserId = "00000000-0000-4000-8000-000000000001",
  role = TENANT_ROLES.OWNER,
  membershipStatus = ACTIVE_STATUS,
  userStatus = ACTIVE_STATUS,
  tenantStatus = ACTIVE_STATUS,
  membershipDisabledAt = null,
  userDisabledAt = null,
  tenantDisabledAt = null,
  sessionVersion = LISTING_SESSION_VERSION
} = {}) {
  return {
    tenant_id: tenantId,
    user_id: userId,
    role,
    status: membershipStatus,
    disabled_at: membershipDisabledAt,
    user: {
      id: userId,
      email: `${userId}@example.test`,
      status: userStatus,
      session_version: sessionVersion,
      disabled_at: userDisabledAt,
      auth_user_id: authUserId
    },
    tenant: {
      id: tenantId,
      name: `Tenant ${tenantId}`,
      plan: "pilot",
      status: tenantStatus,
      disabled_at: tenantDisabledAt
    }
  };
}

function membershipFetch(rowsOrFactory, assertions = () => {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    assertions(url, init);
    assert.equal(url.pathname, "/rest/v1/tenant_members");
    assert.equal(init.headers.apikey, serviceEnv.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(init.headers.authorization, undefined, "opaque sb_secret keys are not JWT bearer tokens");
    const rows = typeof rowsOrFactory === "function" ? rowsOrFactory(url) : rowsOrFactory;
    return jsonResponse(rows);
  };
}

function tenantRequest({
  tenantId = "tenant_a",
  userId = "user_a",
  email = `${userId}@example.test`,
  sessionVersion = LISTING_SESSION_VERSION,
  requestId = "req-tenant-test"
} = {}) {
  const token = createListingSessionToken({ userId, tenantId, email, sessionVersion }, secret);
  return {
    headers: {
      cookie: `${cookieName}=${token}`,
      "x-request-id": requestId
    }
  };
}

// The matrix is explicit, complete, and fail-closed for unknown capabilities.
const allPermissions = Object.values(TENANT_PERMISSIONS);
for (const permission of allPermissions) {
  assert.equal(ROLE_PERMISSION_MATRIX.OWNER[permission], PERMISSION_SCOPES.TENANT);
  assert.equal(hasTenantPermission({ role: TENANT_ROLES.OWNER, userId: "owner" }, permission), true);
}

const managerAllowed = new Set([
  TENANT_PERMISSIONS.VIEW_ALL_WORK,
  TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK,
  TENANT_PERMISSIONS.UPLOAD_ASSET,
  TENANT_PERMISSIONS.CREATE_JOB,
  TENANT_PERMISSIONS.ASSIGN_TASK,
  TENANT_PERMISSIONS.VIEW_TEAM,
  TENANT_PERMISSIONS.RETRY_JOB
]);
for (const permission of allPermissions) {
  assert.equal(
    hasTenantPermission({ role: TENANT_ROLES.MANAGER, userId: "manager" }, permission),
    managerAllowed.has(permission),
    `manager matrix mismatch for ${permission}`
  );
}

const writerAssigned = new Set([
  TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK,
  TENANT_PERMISSIONS.EDIT_TITLE,
  TENANT_PERMISSIONS.SUBMIT_FEEDBACK
]);
for (const permission of allPermissions) {
  assert.equal(
    hasTenantPermission(
      { role: TENANT_ROLES.WRITER, userId: "writer" },
      permission,
      { assignedUserId: "writer" }
    ),
    writerAssigned.has(permission),
    `writer matrix mismatch for ${permission}`
  );
}
assert.equal(permissionScopeFor(TENANT_ROLES.WRITER, TENANT_PERMISSIONS.EDIT_TITLE), PERMISSION_SCOPES.ASSIGNED);
assert.equal(hasTenantPermission(
  { role: TENANT_ROLES.WRITER, userId: "writer" },
  TENANT_PERMISSIONS.EDIT_TITLE,
  { assignedUserId: "someone_else" }
), false);
assert.equal(permissionScopeFor(TENANT_ROLES.OWNER, "UNDECLARED_PERMISSION"), PERMISSION_SCOPES.NONE);

// New sessions carry stable tenant identity claims; old legacy callers keep the
// original `user` claim while being bounded to tenant_legacy/user_legacy.
const newToken = createListingSessionToken({
  userId: "user_a",
  tenantId: "tenant_a",
  email: "USER_A@example.test",
  sessionVersion: 4
}, secret);
const newSession = readSignedSession(newToken, secret);
assert.equal(newSession.user_id, "user_a");
assert.equal(newSession.tenant_id, "tenant_a");
assert.equal(newSession.email, "user_a@example.test");
assert.equal(newSession.session_version, 4);
assert.match(newSession.sid, /^[0-9a-f-]{36}$/i);
assert.equal(readListingSession(newToken, secret)?.tenant_id, "tenant_a");
assert.equal(readSignedSession(`${newToken}.extra-segment`, secret), null);

const legacyToken = createSignedSessionToken({
  user: "metaverse",
  sid: crypto.randomUUID(),
  iat: Date.now(),
  exp: Date.now() + 60_000
}, secret, { env: { METAVERSE_EMAIL: "legacy@example.test" } });
const legacySession = readSignedSession(legacyToken, secret);
assert.equal(legacySession.user, "metaverse");
assert.equal(legacySession.user_id, LEGACY_USER_ID);
assert.equal(legacySession.tenant_id, LEGACY_TENANT_ID);
assert.equal(legacySession.email, "legacy@example.test");
assert.equal(legacySession.session_version, LISTING_SESSION_VERSION);

// Supabase Auth receives the password with a publishable key. The configured
// service role is present in the same env to prove it is never selected.
const authEnv = {
  SUPABASE_URL: "https://project.supabase.co/",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_browser_safe",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_never_for_passwords"
};
let authCalls = 0;
const supabaseIdentity = await authenticateSupabasePassword({
  email: "Person@Example.Test",
  password: "correct horse battery staple"
}, {
  env: authEnv,
  fetchImpl: async (input, init) => {
    authCalls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/auth/v1/token");
    assert.equal(url.searchParams.get("grant_type"), "password");
    assert.equal(init.headers.apikey, authEnv.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(init.headers.authorization, undefined, "opaque publishable keys are not JWT bearer tokens");
    assert.notEqual(init.headers.apikey, authEnv.SUPABASE_SERVICE_ROLE_KEY);
    assert.deepEqual(JSON.parse(init.body), {
      email: "person@example.test",
      password: "correct horse battery staple"
    });
    return jsonResponse({
      access_token: "provider-token-must-not-escape",
      refresh_token: "provider-refresh-must-not-escape",
      user: { id: "auth-user-a", email: "person@example.test" }
    });
  }
});
assert.equal(authCalls, 1);
assert.deepEqual(supabaseIdentity, {
  provider: "supabase",
  authUserId: "auth-user-a",
  email: "person@example.test"
});
assert.equal("accessToken" in supabaseIdentity, false);
assert.equal("refreshToken" in supabaseIdentity, false);

assert.equal(supabasePasswordAuthConfig({
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "same-key",
  SUPABASE_SERVICE_ROLE_KEY: "same-key"
}).configured, false);
await expectCode(() => authenticateSupabasePassword({
  email: "person@example.test",
  password: "not-sent"
}, {
  env: {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "same-key",
    SUPABASE_SERVICE_ROLE_KEY: "same-key"
  },
  fetchImpl: async () => assert.fail("service role must never be used for password auth")
}), "AUTH_CONFIGURATION_ERROR");

await expectCode(() => authenticateSupabasePassword({
  email: "person@example.test",
  password: "wrong"
}, {
  env: authEnv,
  fetchImpl: async () => jsonResponse({ message: "upstream detail: password mismatch" }, 401)
}), "INVALID_CREDENTIALS");

const legacyIdentity = await authenticatePassword({ username: "METAVERSE", password: "case-sensitive" }, {
  env: {
    METAVERSE_USERNAME: "metaverse",
    METAVERSE_PASSWORD: "case-sensitive",
    METAVERSE_EMAIL: "owner@legacy.test"
  },
  fetchImpl: async () => assert.fail("legacy credentials must not be sent to Supabase")
});
assert.deepEqual(legacyIdentity, {
  provider: "legacy",
  authUserId: null,
  userId: LEGACY_USER_ID,
  tenantId: LEGACY_TENANT_ID,
  email: "owner@legacy.test",
  role: TENANT_ROLES.OWNER,
  sessionVersion: LISTING_SESSION_VERSION
});

// AuthContext is reconstructed from the server-side membership relation, not
// from a body tenant id or from an unverified role in the signed payload.
const ownerFetch = membershipFetch([membershipRow()], (url) => {
  assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
  assert.equal(url.searchParams.get("user_id"), "eq.user_a");
  assert.equal(url.searchParams.has("payload.tenant_id"), false);
});
const ownerContext = await requireTenantAccess(tenantRequest(), {
  permission: TENANT_PERMISSIONS.MANAGE_MEMBERS,
  env: serviceEnv,
  fetchImpl: ownerFetch
});
assert.deepEqual({
  requestId: ownerContext.requestId,
  tenantId: ownerContext.tenantId,
  userId: ownerContext.userId,
  role: ownerContext.role,
  tenant: ownerContext.tenant.id,
  user: ownerContext.user.id
}, {
  requestId: "req-tenant-test",
  tenantId: "tenant_a",
  userId: "user_a",
  role: TENANT_ROLES.OWNER,
  tenant: "tenant_a",
  user: "user_a"
});

let transientMembershipCalls = 0;
const recoveredContext = await requireTenantAccess(tenantRequest(), {
  permission: TENANT_PERMISSIONS.UPLOAD_ASSET,
  env: serviceEnv,
  fetchImpl: async () => {
    transientMembershipCalls += 1;
    if (transientMembershipCalls === 1) return jsonResponse({ message: "temporary" }, 503);
    return jsonResponse([membershipRow()]);
  }
});
assert.equal(transientMembershipCalls, 2, "a transient membership outage should receive one bounded retry");
assert.equal(recoveredContext.tenantId, "tenant_a");

await expectCode(() => requireTenantAccess(tenantRequest(), {
  permission: TENANT_PERMISSIONS.VIEW_ALL_WORK,
  resourceTenantId: "tenant_b",
  env: serviceEnv,
  fetchImpl: ownerFetch
}), "ACCESS_DENIED");

const crossTenantFetch = membershipFetch((url) => {
  assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_b");
  assert.equal(url.searchParams.get("user_id"), "eq.user_a");
  return [];
});
await expectCode(() => requireTenantAccess(tenantRequest({ tenantId: "tenant_b" }), {
  permission: TENANT_PERMISSIONS.VIEW_ALL_WORK,
  env: serviceEnv,
  fetchImpl: crossTenantFetch
}), "ACCESS_DENIED");

const managerFetch = membershipFetch([membershipRow({ role: TENANT_ROLES.MANAGER })]);
await requireTenantAccess(tenantRequest(), {
  permission: TENANT_PERMISSIONS.RETRY_JOB,
  env: serviceEnv,
  fetchImpl: managerFetch
});
await expectCode(() => requireTenantAccess(tenantRequest(), {
  permission: TENANT_PERMISSIONS.EXPORT_DATA,
  env: serviceEnv,
  fetchImpl: managerFetch
}), "ACCESS_DENIED");

const writerFetch = membershipFetch([membershipRow({ role: TENANT_ROLES.WRITER })]);
await requireTenantAccess(tenantRequest(), {
  permission: TENANT_PERMISSIONS.EDIT_TITLE,
  assignedUserId: "user_a",
  env: serviceEnv,
  fetchImpl: writerFetch
});
await expectCode(() => requireTenantAccess(tenantRequest(), {
  permission: TENANT_PERMISSIONS.EDIT_TITLE,
  assignedUserId: "user_b",
  env: serviceEnv,
  fetchImpl: writerFetch
}), "ACCESS_DENIED");
await expectCode(() => requireTenantAccess(tenantRequest(), {
  permission: TENANT_PERMISSIONS.CREATE_JOB,
  assignedUserId: "user_a",
  env: serviceEnv,
  fetchImpl: writerFetch
}), "ACCESS_DENIED");

// Disabled tenant/member/user rows and stale session versions all fail closed.
for (const row of [
  membershipRow({ membershipStatus: "DISABLED" }),
  membershipRow({ membershipDisabledAt: "2026-07-15T00:00:00Z" }),
  membershipRow({ userStatus: "DISABLED" }),
  membershipRow({ userDisabledAt: "2026-07-15T00:00:00Z" }),
  membershipRow({ tenantStatus: "DISABLED" }),
  membershipRow({ tenantDisabledAt: "2026-07-15T00:00:00Z" })
]) {
  await expectCode(() => requireTenantAccess(tenantRequest(), {
    env: serviceEnv,
    fetchImpl: membershipFetch([row])
  }), "ACCESS_DENIED");
}
await expectCode(() => requireTenantAccess(tenantRequest({ sessionVersion: 1 }), {
  env: serviceEnv,
  fetchImpl: membershipFetch([membershipRow({ sessionVersion: 2 })])
}), "ACCESS_DENIED");

await expectCode(() => requireTenantAccess(tenantRequest(), {
  env: serviceEnv,
  fetchImpl: async () => jsonResponse({ secret: "upstream detail with password" }, 500)
}), "AUTH_UNAVAILABLE");
const publicError = publicTenantAuthError(new Error("database password=do-not-leak"), { requestId: "req-public" });
assert.deepEqual(publicError, {
  ok: false,
  code: "AUTH_UNAVAILABLE",
  message: "Authentication is temporarily unavailable.",
  request_id: "req-public"
});

// Supabase auth_user_id is translated to the application's user_id only by the
// server-side membership relation before a tenant session is minted.
const authUserUuid = "00000000-0000-4000-8000-000000000001";
const resolvedIdentity = await resolveTenantIdentityForAuthUser({
  authUserId: authUserUuid,
  tenantId: "tenant_a"
}, {
  env: serviceEnv,
  fetchImpl: membershipFetch([membershipRow({ authUserId: authUserUuid })], (url) => {
    assert.equal(url.searchParams.get("user.auth_user_id"), `eq.${authUserUuid}`);
    assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
  })
});
assert.deepEqual(resolvedIdentity, {
  userId: "user_a",
  tenantId: "tenant_a",
  email: "user_a@example.test",
  role: TENANT_ROLES.OWNER,
  sessionVersion: LISTING_SESSION_VERSION
});
const tenantChoices = await listTenantChoicesForAuthUser({ authUserId: authUserUuid }, {
  env: serviceEnv,
  fetchImpl: membershipFetch([
    membershipRow({ tenantId: "tenant_b", authUserId: authUserUuid, role: TENANT_ROLES.WRITER }),
    membershipRow({ tenantId: "tenant_a", authUserId: authUserUuid, role: TENANT_ROLES.MANAGER }),
    membershipRow({ tenantId: "tenant_disabled", authUserId: authUserUuid, tenantStatus: "DISABLED" })
  ], (url) => {
    assert.equal(url.searchParams.get("user.auth_user_id"), `eq.${authUserUuid}`);
    assert.equal(url.searchParams.has("tenant_id"), false);
  })
});
assert.deepEqual(tenantChoices, [
  { tenantId: "tenant_a", name: "Tenant tenant_a", role: TENANT_ROLES.MANAGER },
  { tenantId: "tenant_b", name: "Tenant tenant_b", role: TENANT_ROLES.WRITER }
]);
assert.deepEqual(Object.keys(tenantChoices[0]).sort(), ["name", "role", "tenantId"]);
await expectCode(() => resolveTenantIdentityForAuthUser({ authUserId: authUserUuid }, {
  env: serviceEnv,
  fetchImpl: membershipFetch([
    membershipRow({ tenantId: "tenant_a", authUserId: authUserUuid }),
    membershipRow({ tenantId: "tenant_b", authUserId: authUserUuid })
  ])
}), "TENANT_SELECTION_REQUIRED");

// Worker authentication is independent from user sessions and receives tenant
// identity only from a claimed persisted job.
const workerContext = requireWorkerContext({
  headers: {
    "x-lynca-worker-secret": serviceEnv.V4_JOB_WORKER_SECRET,
    "x-request-id": "req-worker"
  }
}, {
  env: serviceEnv,
  job: {
    id: "job_a",
    tenant_id: "tenant_a",
    assigned_to_user_id: "user_a"
  }
});
assert.deepEqual({
  requestId: workerContext.requestId,
  actorType: workerContext.actorType,
  tenantId: workerContext.tenantId,
  userId: workerContext.userId,
  role: workerContext.role
}, {
  requestId: "req-worker",
  actorType: "WORKER",
  tenantId: "tenant_a",
  userId: "user_a",
  role: "WORKER"
});
assert.throws(() => requireWorkerContext({
  headers: { "x-lynca-worker-secret": "wrong" }
}, {
  env: serviceEnv,
  job: { tenant_id: "tenant_a" }
}), (error) => error instanceof TenantAuthError && error.code === "AUTH_REQUIRED");
assert.throws(() => requireWorkerContext({
  headers: { "x-lynca-worker-secret": serviceEnv.V4_JOB_WORKER_SECRET }
}, {
  env: serviceEnv,
  job: { tenant_id: "" }
}), (error) => error instanceof TenantAuthError && error.code === "ACCESS_DENIED");

console.log("tenant access tests passed");
