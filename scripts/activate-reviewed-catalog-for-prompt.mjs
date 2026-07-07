#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildReviewedCatalogActivationReport
} from "../lib/listing/catalog/reviewed-catalog-activation.mjs";

const defaultOut = "data/catalog/reviewed-catalog-activation/reviewed-catalog-activation-report.json";

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

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

async function runtimeEnv(argv = [], env = process.env) {
  if (hasFlag(argv, "--no-env-file")) return { ...env };
  const envFile = argValue(argv, "--env-file", env.CATALOG_ACTIVATION_ENV_FILE || ".env.vercel.production.local");
  const fileEnv = await readEnvFile(envFile);
  const nonEmptyEnv = Object.fromEntries(Object.entries(env || {}).filter(([, value]) => cleanText(value) !== ""));
  return { ...fileEnv, ...nonEmptyEnv };
}

function supabaseConfig(env = {}) {
  return {
    url: cleanText(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, ""),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY)
  };
}

function supabaseHeaders(serviceRoleKey, prefer = "") {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...(prefer ? { prefer } : {})
  };
}

async function supabaseRequest({ env, path, method = "GET", body, prefer = "", fetchImpl = globalThis.fetch } = {}) {
  const config = supabaseConfig(env);
  if (!config.url || !config.serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const response = await fetchImpl(`${config.url}${path}`, {
    method,
    headers: supabaseHeaders(config.serviceRoleKey, prefer),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`Supabase request failed ${method} ${path}: HTTP ${response.status} ${String(text).slice(0, 240)}`);
  }
  return data;
}

async function fetchAll({ env, table, select, filter = "", limit = 1000, fetchImpl } = {}) {
  const rows = [];
  let offset = 0;
  while (true) {
    const path = `/rest/v1/${table}?select=${encodeURIComponent(select)}${filter ? `&${filter}` : ""}&limit=${limit}&offset=${offset}`;
    const page = await supabaseRequest({ env, path, fetchImpl });
    const list = Array.isArray(page) ? page : [];
    rows.push(...list);
    if (list.length < limit) break;
    offset += limit;
  }
  return rows;
}

const reviewedCatalogFilter = [
  "metadata->>prompt_safe_internal_writer_title=eq.true",
  "review_status=neq.REVIEWED_INTERNAL"
].join("&");

async function fetchActivationInputs({ env, limit, fetchImpl } = {}) {
  const catalogCards = await fetchAll({
    env,
    table: "catalog_cards",
    select: "id,source_status,review_status,metadata,canonical_title,product,season_year,players,card_number,checklist_code",
    filter: "metadata->>prompt_safe_internal_writer_title=eq.true",
    limit,
    fetchImpl
  });
  const gapRows = await fetchAll({
    env,
    table: "catalog_gap_queue",
    select: "gap_id,asset_id,status,promotion_status,ai_draft_title,writer_final_title,writer_confirmed_fields,metadata,created_at",
    filter: "order=created_at.desc",
    limit,
    fetchImpl
  });
  return { catalogCards, gapRows };
}

async function applyReviewedCatalogActivation({ env, fetchImpl } = {}) {
  await supabaseRequest({
    env,
    path: `/rest/v1/catalog_cards?${reviewedCatalogFilter}`,
    method: "PATCH",
    body: { review_status: "REVIEWED_INTERNAL" },
    prefer: "return=minimal",
    fetchImpl
  });
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export async function activateReviewedCatalogForPrompt({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  const apply = hasFlag(argv, "--apply");
  const limit = numberArg(argv, "--limit", 1000);
  const out = argValue(argv, "--out", defaultOut);
  const resolvedEnv = await runtimeEnv(argv, env);
  const before = await fetchActivationInputs({ env: resolvedEnv, limit, fetchImpl });
  const dryRunReport = buildReviewedCatalogActivationReport({ ...before, applied: false, now });

  if (apply && dryRunReport.catalog.needs_update_count > 0) {
    await applyReviewedCatalogActivation({ env: resolvedEnv, fetchImpl });
  }

  const after = apply
    ? await fetchActivationInputs({ env: resolvedEnv, limit, fetchImpl })
    : before;
  const report = buildReviewedCatalogActivationReport({ ...after, applied: apply, now });
  report.before = {
    catalog_needs_update_count: dryRunReport.catalog.needs_update_count,
    gap_promotable_count: dryRunReport.gaps.promotable_count,
    ai_draft_only_blocked_count: dryRunReport.gaps.ai_draft_only_blocked_count
  };
  await writeJson(out, report);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  activateReviewedCatalogForPrompt().then((report) => {
    process.stdout.write(`${JSON.stringify({
      status: "OK",
      applied: report.applied,
      catalog: report.catalog,
      gaps: report.gaps,
      before: report.before,
      out: argValue(process.argv.slice(2), "--out", defaultOut)
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
