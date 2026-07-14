import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { cookieName, parseCookies, readSignedSession } from "../lib/listing-session.mjs";

export const config = {
  maxDuration: 300
};

const migrationName = "20260714174210_expose_catalog_source_feedback_for_self_exclusion";
const migrationPath = join(process.cwd(), `supabase/migrations/${migrationName}.sql`);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function bearerToken(req) {
  return cleanText(req.headers?.authorization || req.headers?.Authorization)
    .replace(/^Bearer\s+/i, "")
    .trim();
}

function adminAuth(req, env = process.env) {
  const expected = cleanText(env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const token = bearerToken(req);
  if (expected && token && token === expected) return { ok: true, mode: "internal_token" };

  const cookies = parseCookies(req.headers?.cookie);
  if (readSignedSession(cookies[cookieName], env.METAVERSE_AUTH_SECRET)) {
    return { ok: true, mode: "session" };
  }
  return { ok: false, mode: "" };
}

function dbUrl(env = process.env) {
  return cleanText(env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL);
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
      to_regprocedure(
        'public.search_catalog_candidates_with_source(text,text,text,text,text,text,text,integer)'
      ) is not null as rpc_exists,
      has_function_privilege(
        'service_role',
        'public.search_catalog_candidates_with_source(text,text,text,text,text,text,text,integer)',
        'EXECUTE'
      ) as service_role_can_execute,
      not has_function_privilege(
        'anon',
        'public.search_catalog_candidates_with_source(text,text,text,text,text,text,text,integer)',
        'EXECUTE'
      ) as anon_blocked,
      not has_function_privilege(
        'authenticated',
        'public.search_catalog_candidates_with_source(text,text,text,text,text,text,text,integer)',
        'EXECUTE'
      ) as authenticated_blocked
  `);
  return result.rows[0] || {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const auth = adminAuth(req);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const connectionString = dbUrl(process.env);
  if (!connectionString) {
    sendJson(res, 503, { ok: false, error: "postgres_url_not_configured" });
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
    const ok = Object.values(verification).every(Boolean);
    sendJson(res, ok ? 200 : 500, {
      ok,
      auth_mode: auth.mode,
      migration: migrationName,
      verification
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      migration: migrationName,
      error: "migration_failed",
      message: cleanText(error?.message || error).slice(0, 500)
    });
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore close errors after the migration result has been returned.
    }
  }
}
