import assert from "node:assert/strict";
import {
  projectWriterIntakeCanonicalEvent,
  reconcileWriterIntakeCanonicalFeedbackEvent,
  writerIntakeProjectionEvents
} from "../lib/listing/intake/writer-intake-projection.mjs";

const tenantId = "tenant_projection";
const operatorId = "writer-1";
const assetId = "asset_11111111-1111-4111-8111-111111111111";
const queueJobId = "v4job_projection";
const recognitionSessionId = "v4sess_projection";
const feedbackEventId = "v4feedback_projection";

function eqValue(value) {
  const text = String(value || "");
  return text.startsWith("eq.") ? text.slice(3) : null;
}

function harness({ finalized = true, jobStatus = "L2_READY", sessionStatus = "WRITER_REVIEW" } = {}) {
  const rows = {
    v4_writer_intake_items: [{
      id: "intake_item_11111111111111111111111111111111",
      tenant_id: tenantId,
      operator_id: operatorId,
      batch_id: "intake_11111111111111111111111111111111",
      asset_id: assetId,
      queue_job_id: queueJobId,
      recognition_session_id: recognitionSessionId,
      status: "QUEUE_ADMITTED",
      durability_status: "PENDING",
      asset_durable_at: null,
      writer_ready_at: null,
      writer_completed_at: null,
      updated_at: "2026-07-30T00:00:00.000Z"
    }],
    listing_assets: [{
      id: assetId,
      tenant_id: tenantId,
      image_set_state: finalized ? "FINALIZED" : "INCOMPLETE",
      image_set_sha256: finalized ? "a".repeat(64) : null,
      image_set_finalized_at: finalized ? "2026-07-30T00:00:01.000Z" : null
    }],
    v4_recognition_jobs: [{
      id: queueJobId,
      tenant_id: tenantId,
      operator_id: operatorId,
      asset_id: assetId,
      recognition_session_id: recognitionSessionId,
      job_type: "FINAL_ASSISTED_TITLE",
      status: jobStatus,
      completed_at: jobStatus === "L2_READY" ? "2026-07-30T00:00:03.000Z" : null
    }],
    v4_recognition_sessions: [{
      id: recognitionSessionId,
      tenant_id: tenantId,
      operator_id: operatorId,
      asset_id: assetId,
      status: sessionStatus,
      writer_feedback_event_id: feedbackEventId,
      updated_at: "2026-07-30T00:00:07.000Z"
    }],
    v4_writer_feedback_events: [{
      id: feedbackEventId,
      tenant_id: tenantId,
      recognition_session_id: recognitionSessionId,
      asset_id: assetId,
      action: sessionStatus === "EDITED" ? "EDIT" : "ACCEPT",
      received_at: "2026-07-30T00:00:06.000Z"
    }]
  };
  const logs = [];
  const matches = (row, search = {}) => Object.entries(search).every(([key, value]) => {
    if (["limit", "order"].includes(key)) return true;
    if (value === "is.null") return row[key] === null || row[key] === undefined;
    const expected = eqValue(value);
    return expected === null || String(row[key] ?? "") === expected;
  });
  return {
    rows,
    logs,
    options: {
      now: () => new Date("2026-07-30T00:00:09.000Z"),
      logger: {
        info: (line) => logs.push(JSON.parse(line)),
        warn: (line) => logs.push(JSON.parse(line))
      },
      readRows: async ({ table, search }) => ({
        ok: true,
        rows: (rows[table] || []).filter((row) => matches(row, search))
      }),
      patchRow: async ({ table, id, patch, match }) => {
        const row = (rows[table] || []).find((entry) => entry.id === id && matches(entry, match));
        if (!row) return { saved: false, row: null, error: "row_not_matched" };
        Object.assign(row, patch);
        return { saved: true, row: { ...row }, error: null };
      }
    }
  };
}

function identity(event, extra = {}) {
  return {
    event,
    tenantId,
    operatorId,
    assetId,
    queueJobId,
    recognitionSessionId,
    ...extra
  };
}

{
  const state = harness();
  const first = await projectWriterIntakeCanonicalEvent(identity(writerIntakeProjectionEvents.L2_READY), state.options);
  assert.equal(first.ok, true);
  assert.equal(first.projected, true);
  assert.equal(state.rows.v4_writer_intake_items[0].asset_durable_at, "2026-07-30T00:00:01.000Z");
  assert.equal(state.rows.v4_writer_intake_items[0].writer_ready_at, "2026-07-30T00:00:03.000Z");
  assert.equal(state.rows.v4_writer_intake_items[0].status, "WRITER_TITLE_READY");

  const second = await projectWriterIntakeCanonicalEvent(identity(writerIntakeProjectionEvents.L2_READY), state.options);
  assert.equal(second.ok, true);
  assert.equal(second.projected, false);
  assert.equal(second.idempotent, true);
  assert.equal(state.rows.v4_writer_intake_items[0].writer_ready_at, "2026-07-30T00:00:03.000Z");
}

{
  const state = harness({ sessionStatus: "ACCEPTED" });
  const caughtUp = await projectWriterIntakeCanonicalEvent(identity(writerIntakeProjectionEvents.L2_READY), state.options);
  assert.equal(caughtUp.ok, true);
  assert.equal(
    state.rows.v4_writer_intake_items[0].writer_completed_at,
    "2026-07-30T00:00:06.000Z",
    "L2 completion must catch up feedback that committed before the queue terminal write"
  );
  assert.equal(state.rows.v4_writer_intake_items[0].status, "WRITER_COMPLETED");
}

{
  const state = harness();
  const mismatch = await projectWriterIntakeCanonicalEvent({
    ...identity(writerIntakeProjectionEvents.L2_READY),
    operatorId: "writer-2"
  }, state.options);
  assert.equal(mismatch.ok, true);
  assert.equal(mismatch.projected, false);
  assert.equal(mismatch.reason_code, "NO_MATCHING_INTAKE_ITEM");
  assert.equal(state.rows.v4_writer_intake_items[0].writer_ready_at, null);
}

{
  const state = harness({ sessionStatus: "ACCEPTED" });
  const completed = await projectWriterIntakeCanonicalEvent(identity(
    writerIntakeProjectionEvents.WRITER_COMPLETED,
    { feedbackAction: "ACCEPT", feedbackEventId }
  ), state.options);
  assert.equal(completed.ok, true);
  assert.equal(state.rows.v4_writer_intake_items[0].writer_ready_at, "2026-07-30T00:00:03.000Z");
  assert.equal(state.rows.v4_writer_intake_items[0].writer_completed_at, "2026-07-30T00:00:06.000Z");
  assert.equal(state.rows.v4_writer_intake_items[0].status, "WRITER_COMPLETED");

  const replay = await projectWriterIntakeCanonicalEvent(identity(
    writerIntakeProjectionEvents.WRITER_COMPLETED,
    { feedbackAction: "ACCEPT", feedbackEventId }
  ), state.options);
  assert.equal(replay.ok, true);
  assert.equal(replay.projected, false);
  assert.equal(state.rows.v4_writer_intake_items[0].writer_completed_at, "2026-07-30T00:00:06.000Z");
}

{
  const state = harness({ finalized: false });
  const blocked = await projectWriterIntakeCanonicalEvent(identity(writerIntakeProjectionEvents.L2_READY), state.options);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason_code, "CANONICAL_ASSET_NOT_FINALIZED");
  assert.equal(state.rows.v4_writer_intake_items[0].asset_durable_at, null);
}

{
  const state = harness({ sessionStatus: "EDITED" });
  const edited = await projectWriterIntakeCanonicalEvent(identity(
    writerIntakeProjectionEvents.WRITER_COMPLETED,
    { feedbackAction: "EDIT", feedbackEventId }
  ), state.options);
  assert.equal(edited.ok, true);
  assert.equal(state.rows.v4_writer_intake_items[0].writer_completed_at, "2026-07-30T00:00:06.000Z");
}

{
  const state = harness({ sessionStatus: "ACCEPTED" });
  state.rows.v4_writer_feedback_events[0].asset_id = "asset_22222222-2222-4222-8222-222222222222";
  const blocked = await projectWriterIntakeCanonicalEvent(identity(
    writerIntakeProjectionEvents.WRITER_COMPLETED,
    { feedbackAction: "ACCEPT", feedbackEventId }
  ), state.options);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason_code, "CANONICAL_WRITER_FEEDBACK_EVENT_NOT_FOUND");
  assert.equal(state.rows.v4_writer_intake_items[0].writer_completed_at, null);
}

{
  const state = harness({ sessionStatus: "ACCEPTED" });
  const originalRead = state.options.readRows;
  state.options.readRows = async (input) => input.table === "v4_writer_feedback_events"
    ? { ok: false, rows: [], error: "temporary" }
    : originalRead(input);
  const failed = await projectWriterIntakeCanonicalEvent(identity(writerIntakeProjectionEvents.L2_READY), state.options);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason_code, "CANONICAL_WRITER_FEEDBACK_EVENT_NOT_FOUND_READ_FAILED");
}

{
  const state = harness({ sessionStatus: "EDITED" });
  const repaired = await reconcileWriterIntakeCanonicalFeedbackEvent({
    tenantId,
    recognitionSessionId,
    feedbackEventId
  }, state.options);
  assert.equal(repaired.ok, true);
  assert.equal(state.rows.v4_writer_intake_items[0].writer_completed_at, "2026-07-30T00:00:06.000Z");
  const replay = await reconcileWriterIntakeCanonicalFeedbackEvent({
    tenantId,
    recognitionSessionId,
    feedbackEventId
  }, state.options);
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
}

{
  const state = harness();
  state.options.readRows = async () => ({ ok: false, rows: [], error: "temporary" });
  const failed = await projectWriterIntakeCanonicalEvent(identity(writerIntakeProjectionEvents.L2_READY), state.options);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason_code, "NO_MATCHING_INTAKE_ITEM_READ_FAILED");
  assert.equal(state.logs.at(-1).outcome, "FAILED");
}

console.log("writer-intake-projection: ok");
