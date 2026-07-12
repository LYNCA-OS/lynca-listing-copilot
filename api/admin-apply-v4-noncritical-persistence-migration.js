import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { isV4WorkerRequest } from "../lib/listing/v4/jobs/worker-auth.mjs";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260712072310_atomic_v4_noncritical_persistence.sql"
);
const functionSignature = "persist_v4_noncritical_artifacts(text,jsonb,jsonb,jsonb,jsonb)";

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
      p.oid::regprocedure::text = $1 as function_exists,
      p.prosecdef as security_definer,
      not has_function_privilege('anon', p.oid, 'EXECUTE') as anon_blocked,
      not has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_blocked,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_allowed
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'persist_v4_noncritical_artifacts'
  `, [functionSignature]);
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
    const ok = [
      verification.function_exists,
      verification.security_definer,
      verification.anon_blocked,
      verification.authenticated_blocked,
      verification.service_role_allowed
    ].every((value) => value === true);
    sendJson(res, ok ? 200 : 500, {
      ok,
      migration: "20260712072310_atomic_v4_noncritical_persistence",
      verification
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      migration: "20260712072310_atomic_v4_noncritical_persistence",
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
