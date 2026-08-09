// GET  /api/csm-resolution-view?asset_id=...  -> CsmResolutionView
// POST /api/csm-resolution-view                -> CsmResolutionReview
//
// COS-42 stage 1 and 2. The application asks this endpoint for one composed
// read model and posts one structured review to it; it never joins the CSM
// persistence graph itself, and nothing here changes the generated title or
// the production execution chain.
//
// The GET is a pure read over stored facts. It re-runs no provider call, so an
// operator inspecting a card cannot accidentally spend money or see an
// explanation of a title that was never produced.

import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { instrumentProductionRequest, bindProductionRequestContext } from "../lib/observability/production-events.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  composeCanonicalFieldsForStoredOutput,
  replayFromRows
} from "../lib/listing/thin/csm-replay.mjs";
import { buildCsmResolutionView, CSM_RESOLUTION_VIEW_VERSION } from "../lib/listing/csm/resolution-view.mjs";
import {
  buildCsmResolutionReview, CSM_RESOLUTION_REVIEW_VERSION
} from "../lib/listing/csm/resolution-review.mjs";
import { readCsmResolutionRecord, appendCsmResolutionReview } from "../lib/listing/thin/csm-supabase-writer.mjs";
import { THIN_COMPOSER_VERSION, THIN_RESOLVER_VERSION } from "../lib/listing/thin/csm-persistence.mjs";
import { publicCsmOwnerExecutionReceipt } from "../lib/listing/thin/csm-owner-execution-receipt.mjs";
import { publicTenantAuthError, requireTenantAccess, TENANT_PERMISSIONS } from "../lib/tenant/index.mjs";
import { readJsonPayload, sendJson } from "../lib/listing/v4/session/http-handler-utils.mjs";

/**
 * Compose the read model for one stored run.
 *
 * The stored canonical payload is re-parsed and re-composed rather than read
 * from a rendered string, so every bracket's disposition comes from the same
 * deterministic path the run used. Recomposing with a DIFFERENT composer
 * version would explain a title the operator never saw, so the version travels
 * with the response and the caller can detect the mismatch.
 */
export function composeResolutionView(record) {
  // Replay from the stored ROWS, not from `structured_output` directly.
  //
  // `structured_output` is the CSM emit shape -- `sem`, `print_finish_layers`,
  // `composition_grammar` -- and `parseCanonicalFields` expects the flat
  // canonical object. Handing one to the other returned a near-empty result, so
  // an operator opening a card that resolved perfectly well saw a blank trace.
  // `replayFromRows` is the reverse mapping the replay verifier already uses;
  // reimplementing it here would be a second copy free to drift from the one
  // that guards persistence.
  let fields;
  let composed;
  let composerVersion;
  let composeCorrectedTitle;
  if (record.replay_rows) {
    const replayed = replayFromRows(record.replay_rows);
    fields = replayed.fields;
    composed = replayed.composed;
    composerVersion = record.replay_rows.output?.composer_version;
    composeCorrectedTitle = (correctedFields) =>
      composeCanonicalFieldsForStoredOutput(correctedFields, record.replay_rows.output).title;
  } else {
    // Compatibility for injected/legacy flat records that predate the stored
    // replay bundle. They can only be interpreted as the current contract;
    // claiming an older version without its executable row identity would be
    // an unauditable guess.
    if (record.composer_version && record.composer_version !== THIN_COMPOSER_VERSION) {
      throw Object.assign(new Error("csm_resolution_replay_rows_required"), { statusCode: 409 });
    }
    fields = parseCanonicalFields(record.canonical_payload).fields;
    composed = composeFromCanonicalFields(fields);
    composerVersion = THIN_COMPOSER_VERSION;
    composeCorrectedTitle = (correctedFields) => composeFromCanonicalFields(correctedFields).title;
  }
  return {
    view: buildCsmResolutionView({
      fields,
      composed,
      assetId: record.asset_id,
      recognitionSessionId: record.recognition_session_id,
      resolverVersion: record.resolver_version || THIN_RESOLVER_VERSION
    }),
    fields,
    composed,
    composer_version: composerVersion,
    compose_corrected_title: composeCorrectedTitle
  };
}

export async function handleResolutionViewRequest({
  tenantId, assetId, dependencies = {}, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const readRecord = dependencies.readRecord || readCsmResolutionRecord;
  const record = await readRecord({ tenantId, assetId, env, fetchImpl });
  if (!record) {
    throw Object.assign(new Error("csm_resolution_not_found"), { statusCode: 404 });
  }
  const { view, composed, composer_version: composerVersion } = composeResolutionView(record);
  // If the stored title and the recomposed one disagree, the explanation does
  // not describe what shipped. Say so rather than presenting it as the trace.
  const storedTitle = String(record.output_title || "").trim();
  const drift = storedTitle && storedTitle !== composed.title;
  const ownerExecutionReceipt = publicCsmOwnerExecutionReceipt(record.owner_execution_receipt);
  return {
    ...view,
    // This is the only owner-execution projection exposed by the read route.
    // Raw provider/request ids and the full stored execution contract remain
    // server-side; the hash is independently recomputed from the DB value.
    owner_execution_receipt: ownerExecutionReceipt,
    composer: {
      ...view.composer,
      composer_version: composerVersion,
      stored_title: storedTitle || null,
      recomposed_matches_stored: !drift,
      // An operator must not be told a bracket was dropped for budget when the
      // shipped title was produced by different code.
      trace_reliable: !drift
    }
  };
}

export async function handleResolutionReviewRequest({
  tenantId, reviewerId, payload = {}, dependencies = {}, env = process.env, fetchImpl = globalThis.fetch
} = {}) {
  const readRecord = dependencies.readRecord || readCsmResolutionRecord;
  const appendReview = dependencies.appendReview || appendCsmResolutionReview;
  const assetId = String(payload.asset_id || "").trim();
  if (!assetId) throw Object.assign(new Error("asset_id_required"), { statusCode: 400 });

  const record = await readRecord({ tenantId, assetId, env, fetchImpl });
  if (!record) throw Object.assign(new Error("csm_resolution_not_found"), { statusCode: 404 });
  const {
    fields,
    composed,
    composer_version: composerVersion,
    compose_corrected_title: composeCorrectedTitle
  } = composeResolutionView(record);

  const review = buildCsmResolutionReview({
    provenance: {
      asset_id: assetId,
      recognition_session_id: record.recognition_session_id,
      resolution_id: record.resolution_id,
      output_id: record.output_id,
      resolver_version: record.resolver_version || THIN_RESOLVER_VERSION,
      composer_version: composerVersion,
      view_version: CSM_RESOLUTION_VIEW_VERSION,
      reviewer_id: reviewerId,
      tenant_id: tenantId
    },
    verdict: payload.verdict,
    corrections: Array.isArray(payload.corrections) ? payload.corrections : [],
    originalFields: fields,
    originalTitle: String(record.output_title || composed.title).trim(),
    // The ONLY way a corrected title comes into existence. A title in the
    // payload is ignored: parsing a reviewer's string back into fields is the
    // one thing this contract exists to prevent.
    recomposeTitle: composeCorrectedTitle,
    reviewedAt: new Date().toISOString(),
    note: String(payload.note || "")
  });

  await appendReview({ tenantId, review, env, fetchImpl });
  return review;
}

export default async function handler(request, response) {
  instrumentProductionRequest(request, response, { api: "/api/csm-resolution-view" });
  bindProductionRequestContext(response, { route: "csm-resolution-view" });
    if (!["GET", "POST"].includes(request.method)) {
      return sendJson(response, 405, { error: "method_not_allowed" });
    }
    if (!enforceApiRateLimit(request, response, {
      scope: "csm_resolution_view",
      limit: 60,
      windowMs: 60_000,
      message: "Too many resolution view requests. Please try again shortly."
    })) return;

    let access;
    try {
      access = await requireTenantAccess(request, {
        // COS-42: reviewing canonical fields is a trusted reviewer/admin act,
        // not the writer workflow. WRITE_LISTING and READ_LISTING were not even
        // real constants -- they read as undefined, so the check asked for a
        // permission nobody has or everybody has depending on how the tenant
        // layer treats undefined. Named permissions now, and the write side is
        // one writers do not hold.
        permission: request.method === "POST"
          ? TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS
          : TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK
      });
      bindProductionRequestContext(response, access);
    } catch (error) {
      return sendJson(response, error?.statusCode || 503, publicTenantAuthError(error));
    }

    try {
      if (request.method === "GET") {
        const url = new URL(request.url, "http://localhost");
        const assetId = String(url.searchParams.get("asset_id") || "").trim();
        if (!assetId) return sendJson(response, 400, { error: "asset_id_required" });
        const view = await handleResolutionViewRequest({ tenantId: access.tenantId, assetId });
        return sendJson(response, 200, view);
      }
      const payload = await readJsonPayload(request);
      const review = await handleResolutionReviewRequest({
        tenantId: access.tenantId,
        reviewerId: access.userId,
        payload
      });
      return sendJson(response, 201, {
        schema_version: CSM_RESOLUTION_REVIEW_VERSION,
        revision_sha256: review.revision_sha256,
        corrected_title: review.corrected_title,
        verdict: review.verdict
      });
    } catch (error) {
      const status = error?.statusCode || 500;
      return sendJson(response, status, { error: String(error?.message || "internal_error") });
    }
}
