import v2ListingHandler from "../listing-copilot-title.js";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import { planV4RecognitionRoute } from "../../lib/listing/v4/route-planner/route-planner.mjs";
import { adaptV2ResultToV4, buildV4PersistenceRows } from "../../lib/listing/v4/result-adapter.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { providerOptionsForV4ProgressiveL1 } from "../../lib/listing/v4/stages/title-stages.mjs";
import {
  createV4RecognitionSession,
  createV4SessionId,
  persistV4CandidateTrace,
  persistV4CatalogGap,
  persistV4FieldEvidence,
  persistV4QualityLedger,
  updateV4RecognitionSession
} from "../../lib/listing/v4/session/session-store.mjs";
import { v4SessionStatuses } from "../../lib/listing/v4/session/status.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  if (!getSessionFromRequest(req)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_title",
    limit: 120,
    windowMs: 60_000,
    message: "Too many V4 title generation requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  const sessionId = payload.recognition_session_id || createV4SessionId();
  const routePlan = planV4RecognitionRoute(payload, process.env);
  const progressiveProviderOptions = providerOptionsForV4ProgressiveL1({ payload, routePlan });
  const createResult = await createV4RecognitionSession({
    sessionId,
    payload,
    routePlan,
    operatorId: operatorIdFromRequest(req)
  });
  await updateV4RecognitionSession({
    sessionId,
    patch: { status: v4SessionStatuses.OBSERVING }
  });

  const v2Payload = {
    ...payload,
    provider_options: progressiveProviderOptions,
    providerOptions: progressiveProviderOptions,
    recognition_session_id: sessionId,
    v4_request: true,
    v4_route_plan: routePlan,
    v4_title_stage_target: progressiveProviderOptions.v4_title_stage_target
  };
  const v2Response = await callJsonHandler(v2ListingHandler, {
    method: "POST",
    headers: req.headers,
    payload: v2Payload
  });

  if (v2Response.statusCode < 200 || v2Response.statusCode >= 300 || !v2Response.body) {
    await updateV4RecognitionSession({
      sessionId,
      patch: {
        status: v4SessionStatuses.FAILED,
        failure_reason: `v2_handler_failed_${v2Response.statusCode}`
      }
    });
    sendJson(res, v2Response.statusCode || 500, withV4Version({
      ok: false,
      recognition_session_id: sessionId,
      message: v2Response.body?.message || "V4 recognition failed before provider result.",
      v4_persistence: { create_session: createResult.persistence.recognition_session }
    }));
    return;
  }

  const rows = buildV4PersistenceRows({ sessionId, result: v2Response.body, payload: v2Payload });
  const fieldEvidence = await persistV4FieldEvidence({ sessionId, rows: rows.fieldEvidenceRows });
  const candidateTrace = await persistV4CandidateTrace({ sessionId, trace: rows.candidateTrace });
  const catalogPromptCount = Number(rows.candidateTrace.catalog_activation_funnel?.prompt_candidate_count || 0);
  const catalogGap = catalogPromptCount === 0
    ? await persistV4CatalogGap({
      gap: {
        id: `${sessionId}_catalog_gap`,
        recognition_session_id: sessionId,
        asset_id: v2Payload.asset_id || v2Payload.assetId || null,
        observed_fields: v2Response.body.resolved_fields || v2Response.body.fields || {},
        candidate_snapshot: {
          candidate_activation_funnel: rows.candidateTrace.candidate_activation_funnel,
          catalog_activation_funnel: rows.candidateTrace.catalog_activation_funnel,
          vector_activation_funnel: rows.candidateTrace.vector_activation_funnel
        },
        draft_title: v2Response.body.final_title || v2Response.body.rendered_title || v2Response.body.title || null
      }
    })
    : { saved: false, skipped: true, reason: "catalog_prompt_candidate_available" };
  const status = v2Response.body.confidence === "FAILED" ? v4SessionStatuses.FAILED : v4SessionStatuses.DRAFT_READY;
  const sessionUpdate = await updateV4RecognitionSession({
    sessionId,
    patch: {
      status,
      final_title: v2Response.body.final_title || v2Response.body.rendered_title || v2Response.body.title || null,
      resolved_fields: v2Response.body.resolved_fields || v2Response.body.fields || {},
      field_states: rows.fieldEvidenceRows,
      route: routePlan.route,
      route_plan: routePlan,
      candidate_control_plane_trace: rows.candidateTrace,
      provider_result_summary: {
        provider: v2Response.body.provider || null,
        confidence: v2Response.body.confidence || null,
        provider_error_type: v2Response.body.provider_error_type || v2Response.body.provider_error_code || null
      }
    }
  });
  const partialPersistence = {
    create_session: createResult.persistence.recognition_session,
    update_session: sessionUpdate,
    field_evidence: fieldEvidence,
    candidate_trace: candidateTrace,
    catalog_gap: catalogGap
  };
  const ledger = await persistV4QualityLedger({
    ledger: {
      ...adaptV2ResultToV4({
        sessionId,
        result: v2Response.body,
        payload: v2Payload,
        routePlan,
        persistence: partialPersistence
      }).provider_result,
      id: `${sessionId}_quality`,
      recognition_session_id: sessionId,
      route: routePlan.route,
      status,
      route_plan: routePlan,
      persistence_summary: partialPersistence
    }
  });
  const persistence = { ...partialPersistence, quality_ledger: ledger };
  const v4Response = adaptV2ResultToV4({
    sessionId,
    result: v2Response.body,
    payload: v2Payload,
    routePlan,
    persistence
  });

  sendJson(res, 200, v4Response);
}
