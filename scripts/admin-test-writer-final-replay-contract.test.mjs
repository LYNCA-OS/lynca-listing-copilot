import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyV4AdminTestFeedbackIsolation } from "../lib/listing/v4/session/session-store.mjs";

const [migration, feedbackApi, sessionStore, journey] = await Promise.all([
  readFile(new URL(
    "../supabase/migrations/20260730120000_admin_test_writer_final_replay_isolation_v1.sql",
    import.meta.url
  ), "utf8"),
  readFile(new URL("../api/v4/listing-feedback.js", import.meta.url), "utf8"),
  readFile(new URL("../lib/listing/v4/session/session-store.mjs", import.meta.url), "utf8"),
  readFile(new URL("../e2e/production-writer-journey.spec.mjs", import.meta.url), "utf8")
]);

assert.match(migration, /update public\.listing_writer_final_replay replay[\s\S]*replay_status = 'tombstoned'[\s\S]*ADMIN_TEST_ONLY/);
assert.match(migration, /create or replace function public\.sync_writer_final_replay_from_session\(\)[\s\S]*feedback_dataset_disposition is distinct from 'OBSERVE_ONLY'[\s\S]*return new;[\s\S]*insert into public\.listing_writer_final_replay/);
assert.match(migration, /create or replace function public\.verify_v4_admin_test_feedback_isolation/);
assert.match(migration, /security definer[\s\S]*set search_path = ''/);
assert.match(migration, /revoke all on function public\.verify_v4_admin_test_feedback_isolation\(text, text, text\)[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.verify_v4_admin_test_feedback_isolation\(text, text, text\)[\s\S]*to service_role/);
assert.match(migration, /active_admin_replay_for_image_count = 0/);

assert.match(sessionStore, /fn: "verify_v4_admin_test_feedback_isolation"/);
assert.match(sessionStore, /p_session_id: String\(sessionId\)/);
assert.match(sessionStore, /p_tenant_id: String\(tenantId\)/);
assert.match(sessionStore, /p_feedback_event_id: String\(feedbackEventId\)/);
assert.match(feedbackApi, /context\.role === TENANT_ROLES\.OWNER[\s\S]*verifyV4AdminTestFeedbackIsolation/);
assert.match(feedbackApi, /admin_test_persistence_proof: adminTestPersistenceProof/);
assert.match(journey, /adminTestProof\?\.verified[\s\S]*PostgreSQL must prove the administrator edit stayed outside replay authority/);
assert.match(journey, /active_writer_final_replay_source_count/);
assert.match(journey, /active_admin_test_replay_for_image_count/);

const calls = [];
const verification = await verifyV4AdminTestFeedbackIsolation({
  sessionId: "session_admin_test",
  tenantId: "tenant_test",
  feedbackEventId: "feedback_admin_test",
  env: {
    SUPABASE_URL: "https://admin-replay-proof.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test"
  },
  fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body || "{}") });
    return new Response(JSON.stringify([{
      proof_version: "admin-test-feedback-isolation-proof-v1",
      verified: true,
      feedback_event_verified: true,
      learning_event_verified: true,
      session_projection_verified: true,
      image_generation_hash_verified: true,
      writer_final_replay_excluded: true,
      replay_source_count: 0,
      active_writer_final_replay_source_count: 0,
      active_admin_test_replay_for_image_count: 0
    }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});

assert.equal(verification.verified, true);
assert.equal(verification.proof.writer_final_replay_excluded, true);
assert.equal(calls.length, 1);
assert.ok(calls[0].url.endsWith("/rest/v1/rpc/verify_v4_admin_test_feedback_isolation"));
assert.deepEqual(calls[0].body, {
  p_session_id: "session_admin_test",
  p_tenant_id: "tenant_test",
  p_feedback_event_id: "feedback_admin_test"
});

const missingIdentity = await verifyV4AdminTestFeedbackIsolation({});
assert.deepEqual(missingIdentity, {
  verified: false,
  proof: null,
  error: "missing_admin_test_feedback_proof_identity"
});

console.log("admin-test writer-final replay contract tests passed");
