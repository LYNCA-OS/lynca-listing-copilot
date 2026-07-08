import { getSessionFromRequest } from "../../lib/listing-session.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readV4Rows, isV4SupabaseConfigured } from "../../lib/listing/v4/session/supabase-rest.mjs";
import { readV4SessionStatus } from "../../lib/listing/v4/session/session-store.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function queryParam(req, name) {
  const url = new URL(req.url || "/", "https://local.test");
  return String(url.searchParams.get(name) || "").trim();
}

function writerSafeSession(session = null) {
  if (!session || typeof session !== "object") return session;
  const l2Ready = session.status !== "FAILED" && session.l2_status === "READY" && (session.l2_title || session.final_title);
  return {
    ...session,
    l1_title: "",
    final_title: l2Ready ? (session.final_title || session.l2_title || "") : "",
    writer_status: l2Ready ? "ASSISTED_READY" : (session.failure_reason ? "FAILED" : "GENERATING"),
    writer_display_title: l2Ready ? (session.l2_title || session.final_title || "") : null,
    current_best_title: l2Ready ? (session.l2_title || session.final_title || "") : "",
    can_writer_start: Boolean(l2Ready),
    is_final: Boolean(l2Ready),
    title_stage: l2Ready ? "L2_ASSISTED_DRAFT" : "PENDING"
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!getSessionFromRequest(req)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
    return;
  }

  const sessionId = queryParam(req, "recognition_session_id") || queryParam(req, "session_id");
  if (!sessionId) {
    sendJson(res, 400, withV4Version({ ok: false, message: "recognition_session_id is required." }));
    return;
  }
  const status = await readV4SessionStatus({ sessionId });
  const counts = {};
  if (isV4SupabaseConfigured(process.env)) {
    const tables = {
      field_evidence: "v4_field_evidence",
      candidate_traces: "v4_candidate_traces",
      feedback_events: "v4_writer_feedback_events",
      learning_events: "v4_learning_events",
      quality_ledger: "v4_production_quality_ledger"
    };
    for (const [key, table] of Object.entries(tables)) {
      const rows = await readV4Rows({
        table,
        select: "id",
        search: { recognition_session_id: `eq.${sessionId}` }
      });
      counts[key] = rows.ok ? rows.rows.length : null;
    }
  }
  sendJson(res, status.ok ? 200 : 500, withV4Version({
    ok: status.ok,
    recognition_session_id: sessionId,
    session: writerSafeSession(status.session),
    related_counts: counts,
    error: status.error
  }));
}
