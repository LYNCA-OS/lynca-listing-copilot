import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { isV4WorkerRequest } from "../lib/listing/v4/jobs/worker-auth.mjs";

const migrationPaths = [
  "supabase/migrations/20260707122154_v4_production_job_queue.sql",
  "supabase/migrations/20260707133128_v4_queue_interactive_background_lanes.sql"
].map((path) => join(process.cwd(), path));

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function dbUrl(env = process.env) {
  return String(env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || "").trim();
}

function connectionStringForPg(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("ssl");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function verify(client) {
  const result = await client.query(`
    select
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'v4_recognition_jobs'
      ) as jobs_table,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'claim_v4_recognition_jobs'
          and p.pronargs = 5
      ) as claim_rpc
      ,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v4_recognition_jobs'
          and column_name = 'lane'
      ) as lane_column,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v4_recognition_sessions'
          and column_name = 'l1_title'
      ) as l1_session_column
  `);
  return result.rows[0] || {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }
  if (!isV4WorkerRequest(req, process.env)) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return;
  }
  const connectionString = dbUrl(process.env);
  if (!connectionString) {
    sendJson(res, 503, { ok: false, message: "Postgres URL is not configured." });
    return;
  }

  const client = new pg.Client({
    connectionString: connectionStringForPg(connectionString),
    ssl: { rejectUnauthorized: false }
  });
  try {
    const sql = (await Promise.all(migrationPaths.map((path) => readFile(path, "utf8")))).join("\n\n");
    await client.connect();
    await client.query(sql);
    const verification = await verify(client);
    const ok = Boolean(verification.jobs_table && verification.claim_rpc && verification.lane_column && verification.l1_session_column);
    sendJson(res, ok ? 200 : 500, {
      ok,
      migration: "v4_production_job_queue_all",
      verification
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      migration: "v4_production_job_queue_all",
      message: String(error?.message || error || "migration_failed").slice(0, 500)
    });
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
}
