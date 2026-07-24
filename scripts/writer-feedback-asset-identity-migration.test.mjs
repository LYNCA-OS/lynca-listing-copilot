import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL(
  "../supabase/migrations/20260724231500_fix_writer_feedback_durable_asset_identity.sql",
  import.meta.url
), "utf8");

assert.match(
  migration,
  /sessions\.tenant_id,[\s\S]*coalesce\(sessions\.user_id,[\s\S]*sessions\.asset_id,[\s\S]*coalesce\(sessions\.client_asset_ref, sessions\.asset_id\)/,
  "feedback persistence must validate the durable listing asset id"
);
assert.doesNotMatch(
  migration,
  /coalesce\(sessions\.stable_asset_id, sessions\.asset_id\)/,
  "stable content identity must not replace feedback asset_id"
);
assert.match(migration, /events\.submission_id = incoming_submission_id/);
assert.doesNotMatch(migration, /events\.submission_id = submission_id/);
assert.match(migration, /from public, anon, authenticated;[\s\S]*to service_role;/);

console.log("writer feedback durable asset identity migration tests passed");
