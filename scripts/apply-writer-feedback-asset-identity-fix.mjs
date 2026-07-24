import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = String(process.env.POSTGRES_URL_NON_POOLING || "").trim();
if (!connectionString) throw new Error("POSTGRES_URL_NON_POOLING is required");

const migrationUrl = new URL(
  "../supabase/migrations/20260724231500_fix_writer_feedback_durable_asset_identity.sql",
  import.meta.url
);
const sql = await readFile(migrationUrl, "utf8");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext('lynca:writer-feedback-asset-identity-v1'))");
  await client.query(sql);
  const verification = await client.query(`
    select pg_get_functiondef(
      'public.persist_v4_writer_feedback_transaction(text,text,text,text,jsonb,jsonb)'::regprocedure
    ) as definition
  `);
  const definition = String(verification.rows[0]?.definition || "");
  assert.match(definition, /sessions\.asset_id/);
  assert.doesNotMatch(definition, /coalesce\(sessions\.stable_asset_id, sessions\.asset_id\)/);
  await client.query("commit");
  console.log(JSON.stringify({
    ok: true,
    migration: "20260724231500_fix_writer_feedback_durable_asset_identity",
    durable_asset_identity_verified: true
  }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
