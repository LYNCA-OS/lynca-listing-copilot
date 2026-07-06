import assert from "node:assert/strict";
import { adaptV2ResultToV4, buildV4PersistenceRows } from "../lib/listing/v4/result-adapter.mjs";
import { buildV4FeedbackArtifacts } from "../lib/listing/v4/feedback/feedback-loop.mjs";
import { planV4RecognitionRoute } from "../lib/listing/v4/route-planner/route-planner.mjs";
import {
  checkV4Tables,
  createV4RecognitionSession,
  persistV4CandidateTrace,
  persistV4FieldEvidence,
  persistV4LearningEvent,
  updateV4RecognitionSession
} from "../lib/listing/v4/session/session-store.mjs";

const route = planV4RecognitionRoute({
  preingestion_bundle_id: "bundle-1",
  initial_evidence: {
    collector_number: "PAU"
  },
  images: [{ role: "front" }, { role: "back" }]
}, {
  VECTOR_INDEX_READY: "true"
});
assert.equal(route.route, "EXACT_ANCHOR_FAST_LANE");

const v2Result = {
  title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5",
  final_title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5",
  confidence: "HIGH",
  provider: "openai",
  resolved_fields: {
    year: "2024-25",
    manufacturer: "Panini",
    product: "Immaculate",
    players: ["Anthony Edwards"],
    card_name: "Patch Auto",
    collector_number: "PAU",
    serial_number: "2/3",
    grade_company: "BGS",
    card_grade: "8.5"
  },
  candidate_application_trace: {
    applied_field_count: 3,
    blocked_field_count: 1,
    per_field: {
      product: { applied: true }
    }
  },
  candidate_activation_funnel: {
    raw_candidate_count: 5,
    prompt_candidate_count: 2
  },
  catalog_activation_funnel: {
    prompt_candidate_count: 1
  },
  vector_activation_funnel: {
    prompt_candidate_count: 1
  },
  provider_token_diagnostics: {
    input_tokens: 1000,
    output_tokens: 500,
    total_tokens: 1500
  }
};

const v4 = adaptV2ResultToV4({
  sessionId: "v4sess-test",
  result: v2Result,
  payload: { preingestion_bundle_id: "bundle-1" },
  routePlan: route
});
assert.equal(v4.v4_schema_version, "v4-recognition-session-v1");
assert.equal(v4.recognition_session_id, "v4sess-test");
assert.equal(v4.writer_draft.user_edit_mode, "one_line_title_only");
assert.equal(v4.writer_draft.structured_fields_visible, false);
assert.equal(v4.resolved_fields.print_run_number, "2/3");
assert.equal(v4.resolved_fields.print_run_denominator, "3");
assert.equal(v4.field_states.product.display_status, "NORMAL");
assert.equal(v4.candidate_control_plane_trace.prompt_candidate_count, 2);
assert.equal(v4.catalog_activation_funnel.prompt_candidate_count, 1);

const rows = buildV4PersistenceRows({ sessionId: "v4sess-test", result: v2Result, payload: {} });
assert.ok(rows.fieldEvidenceRows.some((row) => row.field_name === "serial" && row.field_value === "2/3"));
assert.equal(rows.candidateTrace.applied_field_count, 3);

const artifacts = buildV4FeedbackArtifacts({
  sessionId: "v4sess-test",
  action: "EDIT",
  aiTitle: v4.final_title,
  writerTitle: "2024-25 Panini Immaculate Anthony Edwards Patch Auto 2/3 BGS 8.5 Timberwolves",
  resultPayload: v4
});
assert.equal(artifacts.status, "EDITED");
assert.equal(artifacts.feedbackEvent.correction_type, "EDIT");
assert.ok(artifacts.feedbackEvent.title_diff.added.includes("timberwolves"));
assert.equal(artifacts.learningEvent.training_eligible, true);

const writes = [];
const reads = [];
const fakeFetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  if (init.method === "POST" || init.method === "PATCH") {
    writes.push({
      table: parsed.pathname.split("/").pop(),
      method: init.method,
      body: JSON.parse(init.body)
    });
    return {
      ok: true,
      status: init.method === "PATCH" ? 200 : 201,
      text: async () => JSON.stringify(Array.isArray(JSON.parse(init.body)) ? JSON.parse(init.body) : [JSON.parse(init.body)])
    };
  }
  reads.push(parsed.pathname.split("/").pop());
  return { ok: true, status: 200, text: async () => "[]" };
};
const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role"
};
await createV4RecognitionSession({
  sessionId: "v4sess-test",
  payload: { asset_id: "asset-1" },
  routePlan: route,
  env,
  fetchImpl: fakeFetch
});
await updateV4RecognitionSession({
  sessionId: "v4sess-test",
  patch: { status: "DRAFT_READY" },
  env,
  fetchImpl: fakeFetch
});
await persistV4FieldEvidence({
  sessionId: "v4sess-test",
  rows: rows.fieldEvidenceRows,
  env,
  fetchImpl: fakeFetch
});
await persistV4CandidateTrace({
  sessionId: "v4sess-test",
  trace: rows.candidateTrace,
  env,
  fetchImpl: fakeFetch
});
await persistV4LearningEvent({
  event: artifacts.learningEvent,
  env,
  fetchImpl: fakeFetch
});
const health = await checkV4Tables({ env, fetchImpl: fakeFetch });
assert.equal(health.configured, true);
assert.ok(writes.some((write) => write.table === "v4_recognition_sessions"));
assert.ok(writes.some((write) => write.table === "v4_field_evidence"));
assert.ok(writes.some((write) => write.table === "v4_candidate_traces"));
assert.ok(writes.some((write) => write.table === "v4_learning_events"));
assert.ok(reads.includes("v4_production_quality_ledger"));

console.log("v4 spine tests passed");
