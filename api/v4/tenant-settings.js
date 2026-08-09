import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { patchV4Row, readV4Rows } from "../../lib/listing/v4/session/supabase-rest.mjs";
import {
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

async function readTenant({ tenantId, env = process.env, fetchImpl = globalThis.fetch }) {
  const result = await readV4Rows({
    table: "tenants",
    select: "id,name,plan,status,created_at,updated_at",
    search: { id: `eq.${tenantId}`, limit: "1" },
    env,
    fetchImpl
  });
  if (!result.ok) throw new Error("tenant_settings_read_failed");
  return result.rows[0] || null;
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/tenant-settings" });
  if (req.method !== "GET" && req.method !== "PATCH") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req, { permission: TENANT_PERMISSIONS.CONFIGURE_TENANT });
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
    return;
  }

  if (req.method === "GET") {
    try {
      const tenant = await readTenant({ tenantId: context.tenantId });
      sendJson(res, tenant ? 200 : 404, withV4Version({ ok: Boolean(tenant), tenant }));
    } catch {
      sendJson(res, 503, withV4Version({ ok: false, retryable: true, message: "Tenant configuration is unavailable." }));
    }
    return;
  }

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  let patch;
  try {
    if (payload.settings !== undefined) throw new TypeError("unsupported_tenant_setting");
    patch = {};
    if (payload.name !== undefined) {
      const name = String(payload.name).replace(/\s+/g, " ").trim();
      if (!name || name.length > 120) throw new TypeError("invalid_tenant_name");
      patch.name = name;
    }
    if (!Object.keys(patch).length) throw new TypeError("empty_tenant_profile_patch");
  } catch (error) {
    sendJson(res, 400, withV4Version({ ok: false, error_code: String(error?.message || "invalid_tenant_profile") }));
    return;
  }

  try {
    const saved = await patchV4Row({
      table: "tenants",
      id: context.tenantId,
      patch: { ...patch, updated_at: new Date().toISOString() },
      requireMatch: true
    });
    if (!saved.saved || !saved.row) {
      sendJson(res, 503, withV4Version({ ok: false, retryable: true, message: "Tenant configuration was not saved." }));
      return;
    }
    sendJson(res, 200, withV4Version({ ok: true, tenant: saved.row }));
  } catch {
    sendJson(res, 503, withV4Version({ ok: false, retryable: true, message: "Tenant configuration was not saved." }));
  }
}
