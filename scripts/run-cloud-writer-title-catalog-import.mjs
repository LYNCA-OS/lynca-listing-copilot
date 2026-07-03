#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1] || fallback;
  const prefix = `${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberArg(argv, name, fallback) {
  const number = Number(argValue(argv, name, ""));
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function unquoteEnvValue(value = "") {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1).replace(/\\"/g, "\"");
  return trimmed;
}

async function readEnvFile(path = "") {
  const resolved = resolve(path || "");
  if (!path || !existsSync(resolved)) return {};
  const text = await readFile(resolved, "utf8");
  const parsed = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    parsed[key] = unquoteEnvValue(trimmed.slice(separator + 1));
  });
  return parsed;
}

async function runtimeEnv(argv = process.argv.slice(2), env = process.env) {
  if (hasFlag(argv, "--no-env-file")) return { ...env };
  const envPath = argValue(argv, "--env-file", env.CATALOG_IMPORT_ENV_FILE || ".env.vercel.production.local");
  return { ...(await readEnvFile(envPath)), ...env };
}

function baseUrlValue(argv = [], env = {}) {
  return cleanText(
    argValue(argv, "--base-url", "")
    || env.CLOUD_LISTING_BASE_URL
    || env.LISTING_COPILOT_BASE_URL
    || env.NEXT_PUBLIC_APP_URL
    || "https://listing.lyncafei.team"
  ).replace(/\/+$/, "");
}

function protectionHeaders(env = {}) {
  const secret = cleanText(env.VERCEL_AUTOMATION_BYPASS_SECRET);
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

function cookieFromSetCookie(headers) {
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return raw
    .map((entry) => String(entry || "").split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function login({ baseUrl, env, fetchImpl = globalThis.fetch } = {}) {
  const username = cleanText(env.METAVERSE_USERNAME || "metaverse");
  const password = cleanText(env.METAVERSE_PASSWORD || "mtv");
  const response = await fetchImpl(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...protectionHeaders(env)
    },
    body: JSON.stringify({ username, password })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`login_failed_http_${response.status}: ${text.slice(0, 180)}`);
  }
  const cookie = cookieFromSetCookie(response.headers);
  if (!cookie) throw new Error("login_failed_no_session_cookie");
  return cookie;
}

async function postImportChunk({
  baseUrl,
  cookie = "",
  env = {},
  body = {},
  fetchImpl = globalThis.fetch
} = {}) {
  const internalToken = cleanText(env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || argValue(process.argv.slice(2), "--auth-token", ""));
  const headers = {
    "content-type": "application/json",
    ...protectionHeaders(env),
    ...(cookie ? { cookie } : {}),
    ...(internalToken ? { authorization: `Bearer ${internalToken}` } : {})
  };
  const response = await fetchImpl(`${baseUrl}/api/admin-import-writer-title-catalog-seed`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok || !data?.ok) {
    throw new Error(`import_chunk_failed_http_${response.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

export async function runCloudWriterTitleCatalogImport({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const mergedEnv = await runtimeEnv(argv, env);
  const baseUrl = baseUrlValue(argv, mergedEnv);
  const limit = Math.max(1, Math.min(1000, numberArg(argv, "--limit", 500)));
  const startOffset = Math.max(0, numberArg(argv, "--offset", 0));
  const maxChunks = Math.max(1, numberArg(argv, "--max-chunks", 1000));
  const dryRun = hasFlag(argv, "--dry-run");
  const batchId = cleanText(argValue(argv, "--batch-id", "writer_ebay_upload_20260703"));
  const inputPath = cleanText(argValue(argv, "--input-path", ""));
  const useLogin = !cleanText(mergedEnv.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || argValue(argv, "--auth-token", ""));
  const cookie = useLogin ? await login({ baseUrl, env: mergedEnv, fetchImpl }) : "";

  const chunks = [];
  let offset = startOffset;
  for (let index = 0; index < maxChunks; index += 1) {
    const chunk = await postImportChunk({
      baseUrl,
      cookie,
      env: mergedEnv,
      fetchImpl,
      body: {
        offset,
        limit,
        batch_id: batchId,
        ...(inputPath ? { input_path: inputPath } : {}),
        apply: !dryRun
      }
    });
    chunks.push({
      offset,
      count: chunk.selected_chunk?.count || 0,
      done: Boolean(chunk.selected_chunk?.done),
      inserted_card_count: chunk.apply?.inserted_card_count || 0,
      skipped_existing_source_count: chunk.apply?.skipped_existing_source_count || 0,
      mode: chunk.mode
    });
    process.stdout.write(`${JSON.stringify(chunks[chunks.length - 1])}\n`);
    offset = Number(chunk.selected_chunk?.next_offset || offset + limit);
    if (chunk.selected_chunk?.done || !chunk.selected_chunk?.count) break;
  }

  return {
    ok: true,
    base_url: baseUrl,
    dry_run: dryRun,
    chunk_limit: limit,
    chunks,
    totals: {
      chunks: chunks.length,
      selected_rows: chunks.reduce((sum, item) => sum + item.count, 0),
      inserted_cards: chunks.reduce((sum, item) => sum + item.inserted_card_count, 0),
      skipped_existing_sources: chunks.reduce((sum, item) => sum + item.skipped_existing_source_count, 0),
      done: chunks[chunks.length - 1]?.done || false
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCloudWriterTitleCatalogImport().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
