const publicMessages = Object.freeze({
  AUTH_REQUIRED: "Authentication required.",
  INVALID_CREDENTIALS: "Invalid credentials.",
  TENANT_SELECTION_REQUIRED: "A tenant selection is required.",
  ACCESS_DENIED: "Access denied.",
  AUTH_RATE_LIMITED: "Authentication is temporarily rate limited.",
  AUTH_UNAVAILABLE: "Authentication is temporarily unavailable.",
  AUTH_CONFIGURATION_ERROR: "Authentication is not configured."
});

const httpStatuses = Object.freeze({
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  TENANT_SELECTION_REQUIRED: 409,
  ACCESS_DENIED: 403,
  AUTH_RATE_LIMITED: 429,
  AUTH_UNAVAILABLE: 503,
  AUTH_CONFIGURATION_ERROR: 500
});

export class TenantAuthError extends Error {
  constructor(code, { requestId = null } = {}) {
    const safeCode = Object.hasOwn(publicMessages, code) ? code : "ACCESS_DENIED";
    super(publicMessages[safeCode]);
    this.name = "TenantAuthError";
    this.code = safeCode;
    this.statusCode = httpStatuses[safeCode];
    this.requestId = requestId || null;
  }
}

export function isTenantAuthError(error) {
  return error instanceof TenantAuthError;
}

export function publicTenantAuthError(error, { requestId = null } = {}) {
  const safe = isTenantAuthError(error)
    ? error
    : new TenantAuthError("AUTH_UNAVAILABLE", { requestId });
  return {
    ok: false,
    code: safe.code,
    message: safe.message,
    ...(safe.requestId || requestId ? { request_id: safe.requestId || requestId } : {})
  };
}
