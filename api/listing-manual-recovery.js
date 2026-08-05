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
  MANUAL_RECOVERY_SCHEMA_VERSION
} from "../lib/listing/recovery/manual-recovery-record.mjs";
import { writeSupabaseRow } from "../lib/supabase-rest.mjs";
import { requireTenantListingAsset } from "../lib/tenant/assets.mjs";
import { publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";
import { readJsonPayload, sendJson } from "../lib/listing/v4/session/http-handler-utils.mjs";

export const MANUAL_RECOVERY_TABLE = "listing_manual_recovery_records";

export async function handleManualRecoveryRequest({
  tenantId, operatorId, payload = {}, dependencies = {}, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const assertAsset = dependencies.assertAsset || requireTenantListingAsset;
  const insertRow = dependencies.insertRow || writeSupabaseRow;

  const record = buildManualRecoveryRecord({
    tenantId,
    assetId: payload.asset_id || payload.assetId,
    clientAssetRef: payload.client_asset_ref || payload.clientAssetRef,
    operatorId,
    manualTitle: payload.manual_title ?? payload.manualTitle,
    source: payload.source,
    failureCode: payload.failure_code || payload.failureCode,
    failureStage: payload.failure_stage || payload.failureStage,
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
  if (!inserted?.saved) {
    throw Object.assign(new Error("manual_recovery_not_persisted"), {
      statusCode: 503,
      retryable: true,
      cause: inserted?.error || null
    });
  }

  return { record, inserted: inserted.row || null };
}

export default async function handler(request, response) {
  const context = bindProductionRequestContext(request, { route: "listing-manual-recovery" });
  return instrumentProductionRequest(context, async () => {
    if (request.method !== "POST") return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
    const limited = await enforceApiRateLimit(request, response, { route: "listing-manual-recovery" });
    if (limited) return limited;

    let access;
    try {
      // A writer's own permission. Recording a workaround for a card you were
      // assigned is part of writing, not a reviewer act -- and gating it behind
      // a reviewer permission would rebuild the deadlock in a different shape.
      access = await requireTenantAccess(request, { permission: TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK });
    } catch (error) {
      return publicTenantAuthError(response, error);
    }

    try {
      const payload = await readJsonPayload(request);
      const { record } = await handleManualRecoveryRequest({
        tenantId: access.tenantId,
        operatorId: access.userId,
        payload
      });
      return sendJson(response, 201, {
        ok: true,
        schema_version: MANUAL_RECOVERY_SCHEMA_VERSION,
        asset_id: record.asset_id,
        source: record.source,
        manual_title: record.manual_title,
        recorded_at: record.recorded_at,
        training_eligible: false,
        semantic_truth: false
      });
    } catch (error) {
      const status = error?.statusCode || 500;
      return sendJson(response, status, {
        ok: false,
        error: String(error?.message || "internal_error").slice(0, 240)
      });
    }
  });
}
