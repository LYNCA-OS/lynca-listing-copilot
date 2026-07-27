import assert from "node:assert/strict";

import {
  assertWriterReadySessionPersisted,
  minimalWriterReadySessionPatch,
  persistWriterReadySession
} from "../api/v4/listing-copilot-title.js";

const fullPatch = {
  status: "DRAFT_READY",
  final_title: "2025 Panini Prizm Example",
  l2_status: "READY",
  l2_title: "2025 Panini Prizm Example",
  l2_ready_at: "2026-07-26T00:00:00.000Z",
  resolved_fields: { year: "2025", product: "Prizm" },
  field_states: [{ field: "year", value: "2025" }],
  route_plan: { deliberately: "large and noncritical" },
  candidate_control_plane_trace: { deliberately: "large and noncritical" },
  l2_timing: { deliberately: "diagnostic" },
  provider_result_summary: {
    assisted_draft_status: "READY",
    writer_review_required: false,
    noncritical_persistence_status: "DEFERRED",
    huge_diagnostic_packet: { deliberately: "noncritical" }
  }
};

const minimal = minimalWriterReadySessionPatch(fullPatch);
assert.equal(minimal.final_title, fullPatch.final_title);
assert.deepEqual(minimal.resolved_fields, fullPatch.resolved_fields);
assert.equal(minimal.provider_result_summary.assisted_draft_status, "READY");
assert.equal("route_plan" in minimal, false);
assert.equal("candidate_control_plane_trace" in minimal, false);
assert.equal("l2_timing" in minimal, false);
assert.equal("huge_diagnostic_packet" in minimal.provider_result_summary, false);

const calls = [];
const recovered = await persistWriterReadySession({
  sessionId: "session-1",
  patch: fullPatch,
  updateSession: async (args) => {
    calls.push(args);
    return calls.length === 1
      ? { saved: false, error: "v4_supabase_timeout", write_attempts: 3 }
      : { saved: true, write_attempts: 2 };
  }
});
assert.equal(recovered.saved, true);
assert.equal(recovered.persistence_mode, "writer_ready_minimal_fallback");
assert.equal(calls.length, 2);
assert.equal(calls[0].patch, fullPatch);
assert.deepEqual(calls[1].patch, minimal);
assert.equal(calls[1].attempts, 5);

assert.doesNotThrow(() => assertWriterReadySessionPersisted(recovered));
assert.throws(
  () => assertWriterReadySessionPersisted({ saved: false, error: "still_down" }),
  (error) => error.code === "V4_SESSION_STATE_PERSISTENCE_FAILED" && error.retryable === true
);

console.log("v4 writer-ready persistence tests passed");
