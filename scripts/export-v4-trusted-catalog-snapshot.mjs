#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1] || fallback;
  const prefix = `${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unquote(value = "") {
  const trimmed = String(value).trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/\\"/g, '"');
  return trimmed;
}

async function envFromFile(path) {
  if (!path || !existsSync(path)) return {};
  const parsed = {};
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    parsed[key] = unquote(trimmed.slice(separator + 1));
  }
  return parsed;
}

function pageSize(argv) {
  const value = Number(argValue(argv, "--page-size", "1000"));
  return Number.isFinite(value) && value > 0 ? Math.min(5000, Math.trunc(value)) : 1000;
}

async function fetchPage({ url, key, offset, limit, fetchImpl = globalThis.fetch }) {
  const select = [
    "id",
    "sport",
    "season_year",
    "manufacturer",
    "product",
    "set_or_insert",
    "subset",
    "players",
    "card_number",
    "checklist_code",
    "official_card_type",
    "observable_components",
    "surface_color",
    "serial_denominator",
    "source_status",
    "review_status",
    "metadata",
    "source:catalog_sources!catalog_cards_source_id_fkey(id,source_type,source_status,source_trust,source_scope,source_name,source_metadata)"
  ].join(",");
  const endpoint = new URL(`${url.replace(/\/+$/, "")}/rest/v1/catalog_cards`);
  endpoint.searchParams.set("select", select);
  endpoint.searchParams.set("order", "id.asc");
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("offset", String(offset));
  const response = await fetchImpl(endpoint, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json"
    }
  });
  if (!response.ok) {
    const detail = cleanText(await response.text()).slice(0, 300);
    throw new Error(`catalog snapshot page failed at offset ${offset}: HTTP ${response.status} ${detail}`);
  }
  return response.json();
}

export async function exportTrustedCatalogSnapshot({
  url,
  serviceRoleKey,
  limit = 1000,
  fetchImpl = globalThis.fetch,
  now = () => new Date()
} = {}) {
  if (!cleanText(url)) throw new Error("SUPABASE_URL is required");
  if (!cleanText(serviceRoleKey)) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const cards = [];
  for (let offset = 0; ; offset += limit) {
    const page = await fetchPage({ url, key: serviceRoleKey, offset, limit, fetchImpl });
    cards.push(...page);
    if (page.length < limit) break;
  }
  return {
    schema_version: "v4-trusted-catalog-snapshot-v1",
    generated_at: now().toISOString(),
    source: {
      table: "catalog_cards",
      access: "server_only_read_only",
      canonical_titles_exported: false
    },
    summary: {
      card_count: cards.length,
      official_count: cards.filter((card) => /OFFICIAL_CHECKLIST/.test(card.source?.source_type || "")).length,
      independent_writer_count: cards.filter((card) => card.source?.source_metadata?.writer_title_batch_id).length,
      reviewed_feedback_count: cards.filter((card) => card.review_status === "REVIEWED_INTERNAL").length
    },
    cards
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const envFile = resolve(argValue(argv, "--env-file", ".env.vercel.production.local"));
  const fileEnv = await envFromFile(envFile);
  const runtime = { ...fileEnv, ...Object.fromEntries(Object.entries(env).filter(([, value]) => cleanText(value))) };
  const output = resolve(argValue(argv, "--out", "data/eval/v4-chain-oracle/trusted-catalog-snapshot.json"));
  const snapshot = await exportTrustedCatalogSnapshot({
    url: argValue(argv, "--url", runtime.SUPABASE_URL || runtime.NEXT_PUBLIC_SUPABASE_URL),
    serviceRoleKey: runtime.SUPABASE_SERVICE_ROLE_KEY || runtime.SUPABASE_SECRET_KEY,
    limit: pageSize(argv)
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...snapshot.summary }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 2;
  });
}
