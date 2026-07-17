import { TENANT_ROLES, TENANT_ROLE_VALUES } from "./constants.mjs";
import { TenantAuthError } from "./errors.mjs";

export const TENANT_PERMISSIONS = Object.freeze({
  MANAGE_MEMBERS: "MANAGE_MEMBERS",
  CONFIGURE_TENANT: "CONFIGURE_TENANT",
  VIEW_ALL_WORK: "VIEW_ALL_WORK",
  VIEW_ASSIGNED_TASK: "VIEW_ASSIGNED_TASK",
  UPLOAD_ASSET: "UPLOAD_ASSET",
  CREATE_JOB: "CREATE_JOB",
  ASSIGN_TASK: "ASSIGN_TASK",
  VIEW_TEAM: "VIEW_TEAM",
  RETRY_JOB: "RETRY_JOB",
  EDIT_TITLE: "EDIT_TITLE",
  SUBMIT_FEEDBACK: "SUBMIT_FEEDBACK",
  EXPORT_DATA: "EXPORT_DATA",
  VIEW_COST: "VIEW_COST"
});

export const PERMISSION_SCOPES = Object.freeze({
  NONE: "NONE",
  ASSIGNED: "ASSIGNED",
  TENANT: "TENANT"
});

const N = PERMISSION_SCOPES.NONE;
const A = PERMISSION_SCOPES.ASSIGNED;
const T = PERMISSION_SCOPES.TENANT;

// Every permission is deliberately enumerated. Unknown permissions fail closed,
// including for an Owner, so adding a capability requires an explicit decision.
export const ROLE_PERMISSION_MATRIX = Object.freeze({
  [TENANT_ROLES.OWNER]: Object.freeze({
    [TENANT_PERMISSIONS.MANAGE_MEMBERS]: T,
    [TENANT_PERMISSIONS.CONFIGURE_TENANT]: T,
    [TENANT_PERMISSIONS.VIEW_ALL_WORK]: T,
    [TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK]: T,
    [TENANT_PERMISSIONS.UPLOAD_ASSET]: T,
    [TENANT_PERMISSIONS.CREATE_JOB]: T,
    [TENANT_PERMISSIONS.ASSIGN_TASK]: T,
    [TENANT_PERMISSIONS.VIEW_TEAM]: T,
    [TENANT_PERMISSIONS.RETRY_JOB]: T,
    [TENANT_PERMISSIONS.EDIT_TITLE]: T,
    [TENANT_PERMISSIONS.SUBMIT_FEEDBACK]: T,
    [TENANT_PERMISSIONS.EXPORT_DATA]: T,
    [TENANT_PERMISSIONS.VIEW_COST]: T
  }),
  [TENANT_ROLES.MANAGER]: Object.freeze({
    [TENANT_PERMISSIONS.MANAGE_MEMBERS]: N,
    [TENANT_PERMISSIONS.CONFIGURE_TENANT]: N,
    [TENANT_PERMISSIONS.VIEW_ALL_WORK]: T,
    [TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK]: T,
    [TENANT_PERMISSIONS.UPLOAD_ASSET]: T,
    [TENANT_PERMISSIONS.CREATE_JOB]: T,
    [TENANT_PERMISSIONS.ASSIGN_TASK]: T,
    [TENANT_PERMISSIONS.VIEW_TEAM]: T,
    [TENANT_PERMISSIONS.RETRY_JOB]: T,
    [TENANT_PERMISSIONS.EDIT_TITLE]: N,
    [TENANT_PERMISSIONS.SUBMIT_FEEDBACK]: N,
    [TENANT_PERMISSIONS.EXPORT_DATA]: N,
    [TENANT_PERMISSIONS.VIEW_COST]: N
  }),
  [TENANT_ROLES.WRITER]: Object.freeze({
    [TENANT_PERMISSIONS.MANAGE_MEMBERS]: N,
    [TENANT_PERMISSIONS.CONFIGURE_TENANT]: N,
    [TENANT_PERMISSIONS.VIEW_ALL_WORK]: N,
    [TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK]: A,
    [TENANT_PERMISSIONS.UPLOAD_ASSET]: N,
    [TENANT_PERMISSIONS.CREATE_JOB]: N,
    [TENANT_PERMISSIONS.ASSIGN_TASK]: N,
    [TENANT_PERMISSIONS.VIEW_TEAM]: N,
    [TENANT_PERMISSIONS.RETRY_JOB]: A,
    [TENANT_PERMISSIONS.EDIT_TITLE]: A,
    [TENANT_PERMISSIONS.SUBMIT_FEEDBACK]: A,
    [TENANT_PERMISSIONS.EXPORT_DATA]: N,
    [TENANT_PERMISSIONS.VIEW_COST]: N
  })
});

export function normalizeTenantRole(value) {
  const role = String(value || "").trim().toUpperCase();
  return TENANT_ROLE_VALUES.includes(role) ? role : null;
}

export function permissionScopeFor(role, permission) {
  const normalizedRole = normalizeTenantRole(role);
  if (!normalizedRole || !Object.values(TENANT_PERMISSIONS).includes(permission)) return N;
  return ROLE_PERMISSION_MATRIX[normalizedRole]?.[permission] || N;
}

function assignedUserIdFrom(options = {}) {
  return String(
    options.assignedUserId ||
      options.assigneeUserId ||
      options.assignment?.assignedUserId ||
      options.assignment?.assigneeUserId ||
      ""
  ).trim();
}

export function hasTenantPermission(context, permission, options = {}) {
  const scope = permissionScopeFor(context?.role, permission);
  if (scope === T) return true;
  if (scope !== A) return false;
  const assignedUserId = assignedUserIdFrom(options);
  return Boolean(assignedUserId && assignedUserId === String(context?.userId || ""));
}

export function requirePermission(context, permission, options = {}) {
  if (!hasTenantPermission(context, permission, options)) {
    throw new TenantAuthError("ACCESS_DENIED", { requestId: context?.requestId });
  }
  return context;
}
