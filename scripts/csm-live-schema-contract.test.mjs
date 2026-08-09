// Every column name the persistence layer sends to PostgREST must exist.
//
// COS-51's Supabase audit found `readCsmResolutionRecord` selecting four
// columns that do not exist on `csm_marketplace_outputs` -- `asset_id`,
// `canonical_payload`, `identity_resolution_id`, `resolver_version`. The Glass
// Box read therefore answered 400 for every card in production.
//
// Two existing kinds of test could not catch it:
//
//   * unit tests stub the function that talks to the database, and a stub
//     cannot have the wrong column names;
//   * the migration ledger does not describe tables that predate its baseline
//     (`v4_recognition_sessions.tenant_id` is in the live database and in no
//     migration here), so checking code against the ledger produces false
//     failures on exactly the tables this read depends on.
//
// So the check runs against a snapshot of what the live database actually has,
// captured from the production project and committed alongside. Refresh it with
// the query at the bottom of this file whenever the schema changes; a stale
// snapshot fails loudly here rather than quietly in production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SNAPSHOT_PATH = "docs/operations/csm-live-schema-snapshot-2026-08-05.json";
const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
const live = snapshot.tables;

// What the code actually names, per table. Stated explicitly rather than parsed
// out of the source: the point is to write the contract down, and a parser
// clever enough to extract it would be one more thing that can be wrong.
const CONTRACT = {
  csm_marketplace_outputs: [
    "id", "tenant_id", "recognition_session_id", "resolution_id",
    "structured_output", "title", "composer_version", "marketplace",
    "marketplace_profile_version", "contract_version", "created_at"
  ],
  csm_identity_resolutions: [
    "id", "resolver_version", "conflict_policy_version", "registry_release_id",
    "grammar", "contract_version", "revision", "tenant_id"
  ],
  v4_recognition_sessions: [
    "id", "asset_id", "tenant_id", "created_at", "csm_owner_versions"
  ],
  listing_manual_recovery_records: [
    "schema_version", "tenant_id", "asset_id", "client_asset_ref",
    "failure_code", "failure_stage", "source", "manual_title", "operator_id",
    "recorded_at", "training_eligible", "semantic_truth", "canonical_fields_approved"
  ],
  csm_resolution_reviews: [
    "schema_version", "tenant_id", "asset_id", "recognition_session_id",
    "resolution_id", "output_id", "resolver_version", "composer_version",
    "view_version", "reviewer_id", "verdict", "corrections", "original_fields",
    "original_title", "corrected_fields", "corrected_title",
    "excluded_from_metrics", "note", "revision_sha256", "reviewed_at"
  ]
};

let checked = 0;
for (const [table, wanted] of Object.entries(CONTRACT)) {
  const actual = new Set(live[table] || []);
  assert.ok(actual.size > 0, `${table} is missing from ${SNAPSHOT_PATH}; refresh the snapshot`);
  for (const column of wanted) {
    checked += 1;
    assert.ok(actual.has(column),
      `${table}.${column} is named in code but absent from the live schema -- this is a production 400`);
  }
}

// The exact names that caused the outage must stay out of the read path.
const writer = await readFile("lib/listing/thin/csm-supabase-writer.mjs", "utf8");
const read = writer.slice(
  writer.indexOf("export async function readCsmResolutionRecord"),
  writer.indexOf("export async function appendCsmResolutionReview")
);
assert.ok(read.length > 0, "the Glass Box read must remain present");
for (const dead of ["canonical_payload", "identity_resolution_id"]) {
  assert.ok(!read.includes(`"${dead}"`),
    `"${dead}" is not a column on csm_marketplace_outputs and must not be selected from it`);
}
// `asset_id` is on the session, not the output; the read must go through it.
assert.match(read, /v4_recognition_sessions/,
  "asset_id lives on the recognition session, so the read must resolve the asset through it");
assert.match(read, /structured_output/, "the canonical payload column is structured_output");

// The two tables this branch created must be in the snapshot, which is only
// true if the migrations were actually applied to production.
for (const table of ["csm_resolution_reviews", "listing_manual_recovery_records"]) {
  assert.ok((live[table] || []).length > 0,
    `${table} is not in the live snapshot -- its migration has not been applied`);
}

process.stdout.write(`csm live schema contract: ok (${checked} column names verified against the live snapshot)\n`);

// Refresh query:
//
//   select json_object_agg(table_name, cols order by table_name)
//   from (
//     select table_name, json_agg(column_name order by ordinal_position) as cols
//     from information_schema.columns
//     where table_schema = 'public' and table_name in (...)
//     group by table_name
//   ) t;
