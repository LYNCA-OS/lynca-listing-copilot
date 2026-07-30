import { normalizeDurableListingAssetId } from "../../tenant/assets.mjs";
import { patchV4Row, readV4Rows } from "../v4/session/supabase-rest.mjs";
import {
  normalizeWriterIntakeOperatorId,
  normalizeWriterIntakeTenantId
} from "./writer-intake-contract.mjs";

export const writerIntakeProjectionEvents = Object.freeze({
  ASSET_FINALIZED: "ASSET_FINALIZED",
  L2_READY: "L2_READY",
  WRITER_COMPLETED: "WRITER_COMPLETED"
});

const itemTable = "v4_writer_intake_items";
const finalJobType = "FINAL_ASSISTED_TITLE";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function dependencies(options = {}) {
  return {
    readRows: options.readRows || readV4Rows,
    patchRow: options.patchRow || patchV4Row,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    now: options.now || (() => new Date()),
    logger: options.logger || console
  };
}

function normalizedId(value, code, { required = true } = {}) {
  const id = String(value || "").trim();
  if (!id && !required) return null;
  if (!idPattern.test(id)) throw new TypeError(code);
  return id;
}

function normalizedEvent(value) {
  const event = String(value || "").trim().toUpperCase();
  if (!Object.values(writerIntakeProjectionEvents).includes(event)) {
    throw new TypeError("invalid_writer_intake_projection_event");
  }
  return event;
}

function validIso(value) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function exactItemSearch(identity) {
  return {
    tenant_id: `eq.${identity.tenantId}`,
    operator_id: `eq.${identity.operatorId}`,
    asset_id: `eq.${identity.assetId}`,
    recognition_session_id: `eq.${identity.recognitionSessionId}`,
    ...(identity.queueJobId ? { queue_job_id: `eq.${identity.queueJobId}` } : {}),
    limit: "2"
  };
}

function exactItemMatch(identity) {
  return {
    tenant_id: `eq.${identity.tenantId}`,
    operator_id: `eq.${identity.operatorId}`,
    asset_id: `eq.${identity.assetId}`,
    queue_job_id: `eq.${identity.queueJobId}`,
    recognition_session_id: `eq.${identity.recognitionSessionId}`
  };
}

async function readExactlyOne({ table, select, search, missingReason, ambiguousReason }, deps) {
  const result = await deps.readRows({
    table,
    select,
    search: { ...search, limit: "2" },
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (!result?.ok) return { ok: false, reason_code: `${missingReason}_READ_FAILED`, row: null };
  if (result.rows.length === 0) return { ok: false, reason_code: missingReason, row: null };
  if (result.rows.length !== 1) return { ok: false, reason_code: ambiguousReason, row: null };
  return { ok: true, reason_code: null, row: result.rows[0] };
}

async function readIntakeItem(identity, deps) {
  const found = await readExactlyOne({
    table: itemTable,
    select: "id,tenant_id,operator_id,batch_id,asset_id,queue_job_id,recognition_session_id,status,durability_status,asset_durable_at,writer_ready_at,writer_completed_at,updated_at",
    search: exactItemSearch(identity),
    missingReason: "NO_MATCHING_INTAKE_ITEM",
    ambiguousReason: "AMBIGUOUS_INTAKE_ITEM"
  }, deps);
  if (!found.ok) return found;
  const queueJobId = normalizedId(found.row.queue_job_id, "writer_intake_projection_job_missing");
  if (identity.queueJobId && queueJobId !== identity.queueJobId) {
    return { ok: false, reason_code: "INTAKE_JOB_IDENTITY_MISMATCH", row: null };
  }
  return { ok: true, reason_code: null, row: found.row, queueJobId };
}

async function readFinalizedAsset(identity, deps) {
  const found = await readExactlyOne({
    table: "listing_assets",
    select: "id,tenant_id,image_set_state,image_set_sha256,image_set_finalized_at",
    search: {
      tenant_id: `eq.${identity.tenantId}`,
      id: `eq.${identity.assetId}`
    },
    missingReason: "CANONICAL_ASSET_NOT_FOUND",
    ambiguousReason: "CANONICAL_ASSET_AMBIGUOUS"
  }, deps);
  if (!found.ok) return found;
  if (
    found.row.image_set_state !== "FINALIZED"
    || !/^[0-9a-f]{64}$/.test(String(found.row.image_set_sha256 || ""))
    || !validIso(found.row.image_set_finalized_at)
  ) {
    return { ok: false, reason_code: "CANONICAL_ASSET_NOT_FINALIZED", row: found.row };
  }
  return found;
}

async function readL2Job(identity, deps) {
  const found = await readExactlyOne({
    table: "v4_recognition_jobs",
    select: "id,tenant_id,operator_id,asset_id,recognition_session_id,job_type,status,completed_at",
    search: {
      tenant_id: `eq.${identity.tenantId}`,
      operator_id: `eq.${identity.operatorId}`,
      asset_id: `eq.${identity.assetId}`,
      recognition_session_id: `eq.${identity.recognitionSessionId}`,
      id: `eq.${identity.queueJobId}`,
      job_type: `eq.${finalJobType}`
    },
    missingReason: "CANONICAL_L2_JOB_NOT_FOUND",
    ambiguousReason: "CANONICAL_L2_JOB_AMBIGUOUS"
  }, deps);
  if (!found.ok) return found;
  if (found.row.status !== "L2_READY" || !validIso(found.row.completed_at)) {
    return { ok: false, reason_code: "CANONICAL_L2_JOB_NOT_READY", row: found.row };
  }
  return found;
}

async function readWriterDecision(identity, { feedbackAction, feedbackEventId }, deps) {
  const expectedStatus = feedbackAction === "ACCEPT" ? "ACCEPTED" : "EDITED";
  const session = await readExactlyOne({
    table: "v4_recognition_sessions",
    select: "id,tenant_id,operator_id,asset_id,status,writer_feedback_event_id",
    search: {
      tenant_id: `eq.${identity.tenantId}`,
      operator_id: `eq.${identity.operatorId}`,
      asset_id: `eq.${identity.assetId}`,
      id: `eq.${identity.recognitionSessionId}`,
      status: `eq.${expectedStatus}`,
      writer_feedback_event_id: `eq.${feedbackEventId}`
    },
    missingReason: "CANONICAL_WRITER_DECISION_NOT_FOUND",
    ambiguousReason: "CANONICAL_WRITER_DECISION_AMBIGUOUS"
  }, deps);
  if (!session.ok) return session;
  const event = await readExactlyOne({
    table: "v4_writer_feedback_events",
    select: "id,tenant_id,recognition_session_id,asset_id,action,received_at",
    search: {
      id: `eq.${feedbackEventId}`,
      tenant_id: `eq.${identity.tenantId}`,
      recognition_session_id: `eq.${identity.recognitionSessionId}`,
      asset_id: `eq.${identity.assetId}`,
      action: `eq.${feedbackAction}`
    },
    missingReason: "CANONICAL_WRITER_FEEDBACK_EVENT_NOT_FOUND",
    ambiguousReason: "CANONICAL_WRITER_FEEDBACK_EVENT_AMBIGUOUS"
  }, deps);
  if (!event.ok) return event;
  if (!validIso(event.row.received_at)) {
    return { ok: false, reason_code: "CANONICAL_WRITER_FEEDBACK_CLOCK_MISSING", row: event.row };
  }
  return { ok: true, reason_code: null, row: event.row, session: session.row };
}

async function readPersistedWriterDecisionIfPresent(identity, deps) {
  const session = await readExactlyOne({
    table: "v4_recognition_sessions",
    select: "id,tenant_id,operator_id,asset_id,status,writer_feedback_event_id",
    search: {
      tenant_id: `eq.${identity.tenantId}`,
      operator_id: `eq.${identity.operatorId}`,
      asset_id: `eq.${identity.assetId}`,
      id: `eq.${identity.recognitionSessionId}`
    },
    missingReason: "CANONICAL_WRITER_SESSION_NOT_FOUND",
    ambiguousReason: "CANONICAL_WRITER_SESSION_AMBIGUOUS"
  }, deps);
  if (!session.ok) return session;
  const row = session.row;
  if (!["ACCEPTED", "EDITED"].includes(String(row.status || ""))) {
    return { ok: true, present: false, reason_code: "CANONICAL_WRITER_DECISION_NOT_COMMITTED", row };
  }
  let feedbackEventId;
  try {
    feedbackEventId = normalizedId(row.writer_feedback_event_id, "invalid_persisted_writer_feedback_event");
  } catch {
    return { ok: false, present: false, reason_code: "CANONICAL_WRITER_FEEDBACK_EVENT_ID_INVALID", row };
  }
  const decision = await readWriterDecision(identity, {
    feedbackAction: row.status === "ACCEPTED" ? "ACCEPT" : "EDIT",
    feedbackEventId
  }, deps);
  return decision.ok ? { ...decision, present: true } : { ...decision, present: false };
}

async function rereadItem(identity, deps) {
  const found = await readIntakeItem(identity, deps);
  return found.ok ? found.row : null;
}

async function writeClockOnce({ row, identity, field, timestamp, patch = {}, expectedStatus = null }, deps) {
  if (validIso(row[field])) {
    return { ok: true, projected: false, idempotent: true, row, reason_code: `${field.toUpperCase()}_ALREADY_SET` };
  }
  const match = {
    ...exactItemMatch(identity),
    [field]: "is.null",
    ...(expectedStatus ? { status: `eq.${expectedStatus}` } : {})
  };
  const saved = await deps.patchRow({
    table: itemTable,
    id: row.id,
    patch: {
      [field]: timestamp,
      ...patch,
      updated_at: deps.now().toISOString()
    },
    match,
    requireMatch: true,
    env: deps.env,
    fetchImpl: deps.fetchImpl
  });
  if (saved?.saved) {
    return {
      ok: true,
      projected: true,
      idempotent: false,
      reason_code: `${field.toUpperCase()}_PROJECTED`,
      row: saved.row || { ...row, [field]: timestamp, ...patch }
    };
  }
  const winner = await rereadItem(identity, deps);
  if (validIso(winner?.[field])) {
    return {
      ok: true,
      projected: false,
      idempotent: true,
      reason_code: `${field.toUpperCase()}_RACE_RECONCILED`,
      row: winner
    };
  }
  return {
    ok: false,
    projected: false,
    idempotent: false,
    reason_code: `${field.toUpperCase()}_WRITE_FAILED`,
    error: saved?.error || "row_not_matched",
    row: winner || row
  };
}

function emit(result, deps) {
  const payload = {
    event: "writer_intake_projection",
    projection_event: result.projection_event || null,
    outcome: result.ok ? (result.projected ? "PROJECTED" : "SKIPPED") : "FAILED",
    reason_code: result.reason_code || null,
    tenant_id: result.tenant_id || null,
    operator_id: result.operator_id || null,
    asset_id: result.asset_id || null,
    queue_job_id: result.queue_job_id || null,
    recognition_session_id: result.recognition_session_id || null,
    intake_item_id: result.intake_item_id || null,
    transitions: (Array.isArray(result.transitions) ? result.transitions : []).map((transition) => ({
      field: transition.field || null,
      projected: transition.projected === true,
      idempotent: transition.idempotent === true,
      reason_code: transition.reason_code || null
    })),
    error: result.error || null
  };
  const method = result.ok ? "info" : "warn";
  deps.logger?.[method]?.(JSON.stringify(payload));
}

function baseResult(event, identity = {}) {
  return {
    ok: false,
    projected: false,
    idempotent: false,
    projection_event: event || null,
    reason_code: null,
    tenant_id: identity.tenantId || null,
    operator_id: identity.operatorId || null,
    asset_id: identity.assetId || null,
    queue_job_id: identity.queueJobId || null,
    recognition_session_id: identity.recognitionSessionId || null,
    intake_item_id: null,
    transitions: []
  };
}

// This is an operational projection only. Canonical asset, job, session, and
// feedback owners commit first; this function never throws back into them and
// never accepts a browser-supplied lifecycle status or timestamp.
export async function projectWriterIntakeCanonicalEvent({
  event,
  tenantId,
  operatorId,
  assetId,
  queueJobId = null,
  recognitionSessionId,
  feedbackAction = null,
  feedbackEventId = null
} = {}, options = {}) {
  const deps = dependencies(options);
  let projectionEvent = null;
  let identity = {};
  try {
    projectionEvent = normalizedEvent(event);
    identity = {
      tenantId: normalizeWriterIntakeTenantId(tenantId),
      operatorId: normalizeWriterIntakeOperatorId(operatorId),
      assetId: String(assetId || "").trim() || null,
      queueJobId: normalizedId(queueJobId, "invalid_writer_intake_projection_job_id", { required: false }),
      recognitionSessionId: normalizedId(recognitionSessionId, "invalid_writer_intake_projection_session_id")
    };
    try {
      identity.assetId = normalizeDurableListingAssetId(identity.assetId);
    } catch {
      const skipped = {
        ...baseResult(projectionEvent, identity),
        ok: true,
        idempotent: true,
        reason_code: "NON_DURABLE_ASSET_NOT_IN_INTAKE_SCOPE"
      };
      emit(skipped, deps);
      return skipped;
    }
    const result = baseResult(projectionEvent, identity);
    const intake = await readIntakeItem(identity, deps);
    if (!intake.ok) {
      result.ok = intake.reason_code === "NO_MATCHING_INTAKE_ITEM";
      result.idempotent = result.ok;
      result.reason_code = intake.reason_code;
      emit(result, deps);
      return result;
    }
    identity.queueJobId = intake.queueJobId;
    result.queue_job_id = intake.queueJobId;
    result.intake_item_id = intake.row.id;
    let row = intake.row;

    const asset = await readFinalizedAsset(identity, deps);
    if (!asset.ok) {
      result.reason_code = asset.reason_code;
      emit(result, deps);
      return result;
    }

    let job = null;
    if (projectionEvent !== writerIntakeProjectionEvents.ASSET_FINALIZED) {
      job = await readL2Job(identity, deps);
      if (!job.ok) {
        result.reason_code = job.reason_code;
        emit(result, deps);
        return result;
      }
    }

    let writerDecision = null;
    if (projectionEvent === writerIntakeProjectionEvents.WRITER_COMPLETED) {
      const action = String(feedbackAction || "").trim().toUpperCase();
      const eventId = normalizedId(feedbackEventId, "invalid_writer_intake_projection_feedback_event_id");
      if (!["ACCEPT", "EDIT"].includes(action)) throw new TypeError("invalid_writer_intake_projection_feedback_action");
      writerDecision = await readWriterDecision(identity, {
        feedbackAction: action,
        feedbackEventId: eventId
      }, deps);
      if (!writerDecision.ok) {
        result.reason_code = writerDecision.reason_code;
        emit(result, deps);
        return result;
      }
    } else if (projectionEvent === writerIntakeProjectionEvents.L2_READY) {
      // Feedback may commit in the narrow interval after the session becomes
      // writer-ready but before the queue row reaches L2_READY. The queue
      // owner catches up only from the already-persisted canonical decision.
      const persistedDecision = await readPersistedWriterDecisionIfPresent(identity, deps);
      if (!persistedDecision.ok) {
        result.reason_code = persistedDecision.reason_code;
        emit(result, deps);
        return result;
      }
      writerDecision = persistedDecision.present === true ? persistedDecision : null;
    }

    const assetClock = asset.row.image_set_finalized_at;
    const durable = await writeClockOnce({
      row,
      identity,
      field: "asset_durable_at",
      timestamp: assetClock,
      patch: { durability_status: "DURABLE" }
    }, deps);
    result.transitions.push({ field: "asset_durable_at", ...durable, row: undefined });
    if (!durable.ok) {
      result.reason_code = durable.reason_code;
      emit(result, deps);
      return result;
    }
    row = durable.row;

    if (job) {
      if (!validIso(row.writer_ready_at) && row.status !== "QUEUE_ADMITTED") {
        result.reason_code = "WRITER_READY_STATE_CONFLICT";
        emit(result, deps);
        return result;
      }
      const ready = await writeClockOnce({
        row,
        identity,
        field: "writer_ready_at",
        timestamp: job.row.completed_at,
        patch: { status: "WRITER_TITLE_READY" },
        expectedStatus: row.status === "QUEUE_ADMITTED" ? "QUEUE_ADMITTED" : null
      }, deps);
      result.transitions.push({ field: "writer_ready_at", ...ready, row: undefined });
      if (!ready.ok) {
        result.reason_code = ready.reason_code;
        emit(result, deps);
        return result;
      }
      row = ready.row;
    }

    if (writerDecision) {
      if (!validIso(row.writer_completed_at) && row.status !== "WRITER_TITLE_READY") {
        result.reason_code = "WRITER_COMPLETED_STATE_CONFLICT";
        emit(result, deps);
        return result;
      }
      const completed = await writeClockOnce({
        row,
        identity,
        field: "writer_completed_at",
        timestamp: writerDecision.row.received_at,
        patch: { status: "WRITER_COMPLETED" },
        expectedStatus: row.status === "WRITER_TITLE_READY" ? "WRITER_TITLE_READY" : null
      }, deps);
      result.transitions.push({ field: "writer_completed_at", ...completed, row: undefined });
      if (!completed.ok) {
        result.reason_code = completed.reason_code;
        emit(result, deps);
        return result;
      }
    }

    result.ok = true;
    result.projected = result.transitions.some((transition) => transition.projected === true);
    result.idempotent = !result.projected;
    result.reason_code = result.projected ? "CANONICAL_EVENT_PROJECTED" : "CANONICAL_EVENT_ALREADY_PROJECTED";
    emit(result, deps);
    return result;
  } catch (error) {
    const result = {
      ...baseResult(projectionEvent, identity),
      reason_code: "WRITER_INTAKE_PROJECTION_FAILED",
      error: String(error?.message || error || "unknown_error").slice(0, 240)
    };
    emit(result, deps);
    return result;
  }
}

// The feedback event is append-only canonical truth. Repair accepts only its
// immutable identities, re-reads the owning session, and derives action,
// operator and asset from canonical rows before invoking the idempotent clock
// projection. Transient failures remain observable and can be retried by the
// same feedback request or a later status poll without rewriting feedback.
export async function reconcileWriterIntakeCanonicalFeedbackEvent({
  tenantId,
  recognitionSessionId,
  feedbackEventId
} = {}, options = {}) {
  const deps = dependencies(options);
  let tenant_id = null;
  let session_id = null;
  let event_id = null;
  try {
    tenant_id = normalizeWriterIntakeTenantId(tenantId);
    session_id = normalizedId(recognitionSessionId, "invalid_writer_intake_feedback_session_id");
    event_id = normalizedId(feedbackEventId, "invalid_writer_intake_feedback_event_id");
    const session = await readExactlyOne({
      table: "v4_recognition_sessions",
      select: "id,tenant_id,operator_id,asset_id,status,writer_feedback_event_id",
      search: {
        tenant_id: `eq.${tenant_id}`,
        id: `eq.${session_id}`,
        writer_feedback_event_id: `eq.${event_id}`
      },
      missingReason: "CANONICAL_WRITER_DECISION_NOT_FOUND",
      ambiguousReason: "CANONICAL_WRITER_DECISION_AMBIGUOUS"
    }, deps);
    if (!session.ok) {
      return {
        ok: false,
        projected: false,
        idempotent: false,
        reason_code: session.reason_code,
        recognition_session_id: session_id,
        feedback_event_id: event_id
      };
    }
    const action = session.row.status === "ACCEPTED"
      ? "ACCEPT"
      : session.row.status === "EDITED"
        ? "EDIT"
        : null;
    if (!action) {
      return {
        ok: false,
        projected: false,
        idempotent: false,
        reason_code: "CANONICAL_WRITER_DECISION_STATUS_INVALID",
        recognition_session_id: session_id,
        feedback_event_id: event_id
      };
    }
    return projectWriterIntakeCanonicalEvent({
      event: writerIntakeProjectionEvents.WRITER_COMPLETED,
      tenantId: tenant_id,
      operatorId: session.row.operator_id,
      assetId: session.row.asset_id,
      recognitionSessionId: session_id,
      feedbackAction: action,
      feedbackEventId: event_id
    }, options);
  } catch (error) {
    return {
      ok: false,
      projected: false,
      idempotent: false,
      reason_code: "WRITER_INTAKE_FEEDBACK_RECONCILIATION_FAILED",
      recognition_session_id: session_id,
      feedback_event_id: event_id,
      error: String(error?.message || error || "unknown_error").slice(0, 240)
    };
  }
}
