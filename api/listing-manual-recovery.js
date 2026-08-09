// POST /api/listing-manual-recovery -> durable acknowledgement for a card whose
// recognition failed. COS-51.
//
// The writer wheel advances only after a recovery action is durably
// acknowledged, so this endpoint is the thing standing between an operator and
// a stuck batch. It deliberately does NOT accept a recognition session: a card
// that has one belongs to the AI feedback path, which checks things this one
// cannot.

import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { instrumentProductionRequest, bindProductionRequestContext } from "../lib/observability/production-events.mjs";
import {
  buildManualRecoveryRecord,
  manualRecoveryRecordMatches,
  MANUAL_RECOVERY_SCHEMA_VERSION
} from "../lib/listing/recovery/manual-recovery-record.mjs";
import { readSupabaseRows, writeSupabaseRow } from "../lib/supabase-rest.mjs";
import { requireTenantListingAsset } from "../lib/tenant/assets.mjs";
import {
  isTenantAuthError,
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../lib/tenant/index.mjs";
import { readJsonPayload, sendJson } from "../lib/listing/v4/session/http-handler-utils.mjs";

export const MANUAL_RECOVERY_TABLE = "listing_manual_recovery_records";

export async function authorizeManualRecoveryAssetAccess({
  access, payload = {}, dependencies = {}, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const readAsset = dependencies.readAsset || requireTenantListingAsset;
  const asset = await readAsset({
    tenantId: access?.tenantId,
    assetId: payload.asset_id || payload.assetId,
    requireDurable: true,
    env,
    fetchImpl
  });
  // The owner comes only from the durable asset root. A request payload may
  // name an asset but can never name its own assignee. Tenant Owners retain
  // their explicit tenant-wide scope; assigned-scope roles must match.
  requirePermission(access, TENANT_PERMISSIONS.SUBMIT_FEEDBACK, {
    assignedUserId: asset?.row?.owner_user_id
  });
  return asset;
}

const publicManualRecoveryErrors = Object.freeze({
  manual_recovery_client_occurred_at_required: [400, "manual_recovery_request_invalid", "Invalid manual recovery request."],
  invalid_manual_recovery_submission_id: [400, "manual_recovery_request_invalid", "Invalid manual recovery request."],
  invalid_recorded_at: [400, "manual_recovery_request_invalid", "Invalid manual recovery request."],
  manual_recovery_rejects_recognition_session: [400, "manual_recovery_request_invalid", "Invalid manual recovery request."],
  manual_title_required: [400, "manual_recovery_request_invalid", "Invalid manual recovery request."],
  invalid_manual_recovery_source: [400, "manual_recovery_request_invalid", "Invalid manual recovery request."],
  listing_asset_not_found: [404, "manual_recovery_asset_not_found", "The listing asset was not found."],
  manual_recovery_submission_conflict: [409, "manual_recovery_submission_conflict", "This recovery submission conflicts with its saved payload."],
  manual_recovery_not_persisted: [503, "manual_recovery_temporarily_unavailable", "Manual recovery is temporarily unavailable."]
});

export function publicManualRecoveryError(error) {
  const key = String(error?.message || "");
  const [status, code, message] = publicManualRecoveryErrors[key]
    || (error instanceof TypeError || Number(error?.statusCode) === 400
      ? [400, "manual_recovery_request_invalid", "Invalid manual recovery request."]
      : [503, "manual_recovery_temporarily_unavailable", "Manual recovery is temporarily unavailable."]);
  return {
    status,
    body: {
      ok: false,
      code,
      message,
      retryable: status >= 500
    }
  };
}

export async function handleManualRecoveryRequest({
  tenantId, operatorId, payload = {}, dependencies = {}, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const assertAsset = dependencies.assertAsset || requireTenantListingAsset;
  const insertRow = dependencies.insertRow || writeSupabaseRow;
  const readRows = dependencies.readRows || readSupabaseRows;
  const clientOccurredAt = payload.client_occurred_at || payload.clientOccurredAt;
  if (!String(clientOccurredAt || "").trim()) {
    throw Object.assign(new Error("manual_recovery_client_occurred_at_required"), { statusCode: 400 });
  }

  const record = buildManualRecoveryRecord({
    submissionId: payload.manual_recovery_submission_id || payload.manualRecoverySubmissionId,
    tenantId,
    assetId: payload.asset_id || payload.assetId,
    clientAssetRef: payload.client_asset_ref || payload.clientAssetRef,
    operatorId,
    manualTitle: payload.manual_title ?? payload.manualTitle,
    source: payload.source,
    failureCode: payload.failure_code || payload.failureCode,
    failureStage: payload.failure_stage || payload.failureStage,
    recordedAt: clientOccurredAt,
    // Passed through so the contract can REFUSE it rather than ignore it.
    recognitionSessionId: payload.recognition_session_id || payload.recognitionSessionId
  });

  // The asset must be a real durable asset in this tenant. Without this the
  // endpoint would accept an arbitrary string and manufacture an audit trail
  // for a card that does not exist.
  await assertAsset({
    tenantId,
    assetId: record.asset_id,
    requireDurable: true,
    env,
    fetchImpl
  });

  // `writeSupabaseRow` reports failure in its return value rather than by
  // throwing. Treating a falsy `saved` as success would acknowledge a
  // transaction that was never written -- and the writer queue advances on this
  // acknowledgement, so the operator would lose the card AND the title.
  const inserted = await insertRow({
    table: MANUAL_RECOVERY_TABLE,
    row: record,
    upsert: false,
    env,
    fetchImpl
  });

  let persisted = inserted?.row || null;
  let replayed = false;
  // A duplicate UUID and a transport loss after commit both surface as a
  // failed/empty INSERT receipt. The append-only table intentionally forbids
  // ON CONFLICT through its rules, so both cases use tenant-scoped readback.
  if (!inserted?.saved || !persisted) {
    const existing = await readRows({
      table: MANUAL_RECOVERY_TABLE,
      select: "id,schema_version,tenant_id,asset_id,client_asset_ref,failure_code,failure_stage,source,manual_title,operator_id,recorded_at,training_eligible,semantic_truth,canonical_fields_approved",
      search: {
        id: `eq.${record.id}`,
        tenant_id: `eq.${record.tenant_id}`,
        operator_id: `eq.${record.operator_id}`,
        limit: "2"
      },
      env,
      fetchImpl
    });
    if (existing?.ok === true && existing.rows?.length === 1) {
      persisted = existing.rows[0];
      replayed = true;
    }
  }

  if (persisted && !manualRecoveryRecordMatches(persisted, record)) {
    throw Object.assign(new Error("manual_recovery_submission_conflict"), {
      statusCode: 409,
      retryable: false
    });
  }
  if (!persisted) {
    throw Object.assign(new Error("manual_recovery_not_persisted"), {
      statusCode: 503,
      retryable: true,
      cause: inserted?.error || null
    });
  }

  return { record: persisted, inserted: persisted, replayed };
}

export default async function handler(request, response) {
  instrumentProductionRequest(request, response, { api: "/api/listing-manual-recovery" });
  bindProductionRequestContext(response, { route: "listing-manual-recovery" });
    if (request.method !== "POST") return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
    if (!enforceApiRateLimit(request, response, {
      scope: "listing_manual_recovery",
      limit: 60,
      windowMs: 60_000,
      message: "Too many manual recovery requests. Please try again shortly."
    })) return;

    let access;
    try {
      // A writer's own permission. Recording a workaround for a card you were
      // assigned is part of writing, not a reviewer act -- and gating it behind
      // a reviewer permission would rebuild the deadlock in a different shape.
      // Authenticate first. Assignment authority is read from the durable
      // asset only after the JSON body supplies the asset id.
      access = await requireTenantAccess(request);
      bindProductionRequestContext(response, access);
    } catch (error) {
      const status = isTenantAuthError(error) ? error.statusCode : 503;
      return sendJson(response, status, publicTenantAuthError(error));
    }

    try {
      const payload = await readJsonPayload(request);
      let ownedAsset;
      try {
        ownedAsset = await authorizeManualRecoveryAssetAccess({ access, payload });
      } catch (error) {
        if (isTenantAuthError(error)) {
          return sendJson(response, error.statusCode, publicTenantAuthError(error));
        }
        throw error;
      }
      const { record, replayed } = await handleManualRecoveryRequest({
        tenantId: access.tenantId,
        operatorId: access.userId,
        payload,
        dependencies: { assertAsset: async () => ownedAsset }
      });
      return sendJson(response, 201, {
        ok: true,
        schema_version: MANUAL_RECOVERY_SCHEMA_VERSION,
        asset_id: record.asset_id,
        source: record.source,
        manual_recovery_submission_id: record.id,
        manual_title: record.manual_title,
        recorded_at: record.recorded_at,
        training_eligible: false,
        semantic_truth: false,
        replayed
      });
    } catch (error) {
      const publicError = publicManualRecoveryError(error);
      console.error(JSON.stringify({
        event: "manual_recovery_failed",
        status: publicError.status,
        code: publicError.body.code,
        internal_error: String(error?.message || "internal_error").slice(0, 240)
      }));
      return sendJson(response, publicError.status, publicError.body);
    }
}
