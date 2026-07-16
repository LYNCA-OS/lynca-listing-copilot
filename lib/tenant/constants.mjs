export const TENANT_ROLES = Object.freeze({
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  WRITER: "WRITER"
});

export const TENANT_ROLE_VALUES = Object.freeze(Object.values(TENANT_ROLES));

export const ACTIVE_STATUS = "ACTIVE";
export const LISTING_SESSION_VERSION = 1;

export const LEGACY_TENANT_ID = "tenant_legacy";
export const LEGACY_USER_ID = "user_legacy";

export const ACTOR_TYPES = Object.freeze({
  USER: "USER",
  WORKER: "WORKER"
});

export const WORKER_ROLE = "WORKER";
