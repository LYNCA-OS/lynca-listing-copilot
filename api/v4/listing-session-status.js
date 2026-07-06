import { getSessionFromRequest } from "../../lib/listing-session.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readV4Rows, isV4SupabaseConfigured } from "../../lib/listing/v4/session/supabase-rest.mjs";
import { readV4SessionStatus } from "../../lib/listing/v4/session/session-store.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

function queryParam(req, name) {
  const url = new URL(req.url || "/", "https://local.test");
  return String(url.searchParams.get(name) || "").trim();
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
    session: status.session,
    related_counts: counts,
    error: status.error
  }));
}
