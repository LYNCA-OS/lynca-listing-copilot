import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { isV4WorkerRequest } from "../lib/listing/v4/jobs/worker-auth.mjs";

const migrationPath = join(process.cwd(), "supabase/migrations/20260708100324_sem_definition_canonical_v25.sql");

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
          and table_name = 'sem_definitions'
      ) as sem_definitions_table,
      exists (
        select 1
        from public.sem_definitions
        where id = 'lynca_sem_canonical_v1'
          and version = 'linear-cos-10-23-v25'
          and upper(status) = 'CANONICAL'
      ) as sem_definition_row,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v4_writer_feedback_events'
          and column_name = 'sem_standard_version'
      ) as writer_feedback_sem_column,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v4_learning_events'
          and column_name = 'semantic_learning_status'
      ) as learning_status_column,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v4_learning_events'
          and column_name = 'semantic_truth'
      ) as semantic_truth_column
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
    const sql = await readFile(migrationPath, "utf8");
    await client.connect();
    await client.query(sql);
    const verification = await verify(client);
    const ok = Boolean(
      verification.sem_definitions_table
      && verification.sem_definition_row
      && verification.writer_feedback_sem_column
      && verification.learning_status_column
      && verification.semantic_truth_column
    );
    sendJson(res, ok ? 200 : 500, {
      ok,
      migration: "20260708100324_sem_definition_canonical_v25",
      verification
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      migration: "20260708100324_sem_definition_canonical_v25",
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
