import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { patchV4Row, readV4Rows } from "../../lib/listing/v4/session/supabase-rest.mjs";
import {
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

const allowedSettingKeys = new Set([
  "default_export_format",
  "require_writer_review",
  "recognition_mode",
  "timezone"
]);

function validatedSettings(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid_tenant_settings");
  const entries = Object.entries(value);
  if (entries.some(([key]) => !allowedSettingKeys.has(key))) throw new TypeError("unsupported_tenant_setting");
  const settings = {};
  if (value.default_export_format !== undefined) {
    const format = String(value.default_export_format).trim().toLowerCase();
    if (!["xlsx", "csv"].includes(format)) throw new TypeError("invalid_default_export_format");
    settings.default_export_format = format;
  }
  if (value.require_writer_review !== undefined) {
    if (typeof value.require_writer_review !== "boolean") throw new TypeError("invalid_require_writer_review");
    settings.require_writer_review = value.require_writer_review;
  }
  if (value.recognition_mode !== undefined) {
    const mode = String(value.recognition_mode).trim().toLowerCase();
    if (!["balanced", "accuracy"].includes(mode)) throw new TypeError("invalid_recognition_mode");
    settings.recognition_mode = mode;
  }
  if (value.timezone !== undefined) {
    const timezone = String(value.timezone).trim();
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timezone) || timezone.length > 80) {
      throw new TypeError("invalid_timezone");
    }
    settings.timezone = timezone;
  }
  return settings;
}

async function readTenant({ tenantId, env = process.env, fetchImpl = globalThis.fetch }) {
  const result = await readV4Rows({
    table: "tenants",
    select: "id,name,plan,status,settings,created_at,updated_at",
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
    patch = {};
    if (payload.name !== undefined) {
      const name = String(payload.name).replace(/\s+/g, " ").trim();
      if (!name || name.length > 120) throw new TypeError("invalid_tenant_name");
      patch.name = name;
    }
    const settings = validatedSettings(payload.settings);
    if (settings !== undefined) patch.settings = settings;
    if (!Object.keys(patch).length) throw new TypeError("empty_tenant_settings_patch");
  } catch (error) {
    sendJson(res, 400, withV4Version({ ok: false, error_code: String(error?.message || "invalid_tenant_settings") }));
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
