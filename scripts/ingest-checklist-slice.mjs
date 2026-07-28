#!/usr/bin/env node
// Ingest a bounded slice of the harvested manufacturer checklist into the
// catalog, tagged so the whole slice can be removed in one command.
//
//   node scripts/ingest-checklist-slice.mjs --product "Panini Phoenix" --years 2023,2024,2025
//   node scripts/ingest-checklist-slice.mjs ... --apply
//   node scripts/ingest-checklist-slice.mjs --undo --cohort <name> --apply
//
// The catalog holds zero rows for the products the unseen-product benchmark
// draws from, which is why moving retrieval earlier regressed 11.75 points: a
// correctly-read player and card number went to an index without the answer,
// came back with the nearest wrong product, and anchored the model to it.
// Completeness has to come before authority.
//
// This ingests one slice so that claim can be tested at a size that is
// reversible, rather than loading 2.26M rows to find out.
//
// Three schema facts shape the write order, and getting them wrong fails at the
// first row:
//   * catalog_cards.product_id and source_id are both NOT NULL.
//   * the catalog_cards_source_graph_guard trigger requires the product's
//     source_id to equal the card's, and if set_id is present, the set's
//     source_id and product_id to match too. So: source, then products, then
//     sets, then cards.
//   * inserts fire a statement-level snapshot trigger, so fewer, larger batches
//     cost less than many small ones.
//
// The database lost forty minutes to connection exhaustion on 2026-07-26, so
// concurrency stays at one, batches are bounded, and any non-2xx aborts rather
// than retrying into a wall.

import { readFileSync, readdirSync } from "node:fs";
import crypto from "node:crypto";

import { mapRows } from "./map-panini-harvest.mjs";

const HARVEST_DIR = "/tmp/panini-cards";
const SUPABASE = "https://osrrujmpxxiefppjfgpd.supabase.co";
const BATCH = 500;
const SETTLE_MS = 120;
// A single ingest should never be able to take the database down on its own.
// Anything larger is a decision, not a default.
const MAX_UNATTENDED_WRITE_BYTES = 200e6;

// Measured, not guessed: catalog_cards is the table being written, so its own
// total size over its own row count is the right per-row figure, indexes and
// toast included.
async function estimateWriteBytes(key, rowCount) {
  const response = await fetch(
    `${SUPABASE}/rest/v1/rpc/exec_sql`,
    { method: "POST", headers: headers(key), body: JSON.stringify({}) }
  ).catch(() => null);
  // No generic SQL endpoint over PostgREST; fall back to a count and the
  // bytes-per-row observed when the table was last inspected (204 MB /
  // 147,936 rows). Conservative by design -- a low estimate is what caused the
  // outage.
  const OBSERVED_BYTES_PER_ROW = 204e6 / 147936;
  let bytesPerRow = OBSERVED_BYTES_PER_ROW;
  if (response?.ok) {
    try {
      const body = await response.json();
      const measured = Number(body?.bytes_per_row);
      if (Number.isFinite(measured) && measured > 0) bytesPerRow = measured;
    } catch { /* keep the observed figure */ }
  }
  return { bytes: rowCount * bytesPerRow, bytesPerRow };
}

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// The manufacturer appends a season to the product name; a lister does not
// write it and it must not fragment the product identity.
export const bareProduct = (value) => cleanText(value)
  .replace(/\(\s*\d{2}\s*-\s*\d{2}\s*\)/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export function canonicalTitle({ season_year, product, set_or_insert, player, card_number }) {
  const set = cleanText(set_or_insert);
  return [
    cleanText(season_year),
    bareProduct(product),
    set && set.toLowerCase() !== "base" ? set : "",
    cleanText(player),
    card_number ? `#${cleanText(card_number)}` : ""
  ].filter(Boolean).join(" ");
}

export function selectSlice(rows = [], { product = "", years = [] } = {}) {
  const wantProduct = bareProduct(product).toLowerCase();
  const wantYears = new Set(years.map((y) => cleanText(y)));
  return rows.filter((row) => bareProduct(row.product).toLowerCase() === wantProduct
    && (!wantYears.size || wantYears.has(cleanText(row.season_year))));
}

export function chunk(items = [], size = BATCH) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function post(key, table, rows, { onConflict = "", returning = "representation" } = {}) {
  const query = onConflict ? `?on_conflict=${onConflict}` : "";
  const response = await fetch(`${SUPABASE}/rest/v1/${table}${query}`, {
    method: "POST",
    headers: headers(key, {
      Prefer: `return=${returning}${onConflict ? ",resolution=merge-duplicates" : ""}`
    }),
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`${table} insert http_${response.status}: ${(await response.text()).slice(0, 240)}`);
  return returning === "representation" ? response.json() : [];
}

async function del(key, table, filter) {
  const response = await fetch(`${SUPABASE}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: headers(key, { Prefer: "return=minimal" })
  });
  if (!response.ok) throw new Error(`${table} delete http_${response.status}: ${(await response.text()).slice(0, 200)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function undo(key, cohort) {
  // Cards first: the source-graph guard exists to stop a product outliving the
  // cards that point at it with a different source.
  await del(key, "catalog_cards", `metadata->>ingest_cohort=eq.${encodeURIComponent(cohort)}`);
  await del(key, "catalog_sets", `metadata->>ingest_cohort=eq.${encodeURIComponent(cohort)}`);
  await del(key, "catalog_products", `metadata->>ingest_cohort=eq.${encodeURIComponent(cohort)}`);
  await del(key, "catalog_sources", `source_name=eq.${encodeURIComponent(cohort)}`);
  console.log(`removed everything tagged ${cohort}`);
}

export async function main(argv = process.argv.slice(2)) {
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const apply = argv.includes("--apply");
  const cohort = cleanText(argValue(argv, "--cohort", "checklist_slice_v1"));

  if (argv.includes("--undo")) {
    if (!apply) { console.log(`dry run: would remove everything tagged ${cohort}`); return 0; }
    await undo(key, cohort);
    return 0;
  }

  const product = cleanText(argValue(argv, "--product", ""));
  const years = cleanText(argValue(argv, "--years", "")).split(",").map(cleanText).filter(Boolean);
  if (!product) throw new Error("--product is required");

  const harvested = [];
  for (const file of readdirSync(HARVEST_DIR).filter((name) => name.endsWith(".json"))) {
    harvested.push(...mapRows(JSON.parse(readFileSync(`${HARVEST_DIR}/${file}`, "utf8")).rows));
  }
  const slice = selectSlice(harvested, { product, years });
  const cardCount = slice.reduce((sum, row) => sum + (row.cards?.length || 0), 0);
  console.log(`slice: ${slice.length} sets / ${cardCount.toLocaleString()} cards  (${product} ${years.join(",") || "all years"})`);

  // This script filled the volume on 2026-07-27 at roughly 60,000 of 82,825
  // rows and left Postgres unable to write pg_wal for sixteen hours. It knew
  // how many rows it was about to write and never asked whether they would
  // fit. Estimate the write from the target table's own bytes-per-row and
  // refuse unless it fits with room to spare.
  const estimate = await estimateWriteBytes(key, cardCount);
  console.log(`  estimated write: ${(estimate.bytes / 1e6).toFixed(0)} MB`
    + ` at ${estimate.bytesPerRow.toFixed(0)} bytes/row (measured on catalog_cards)`);
  if (!argv.includes("--force") && estimate.bytes > MAX_UNATTENDED_WRITE_BYTES) {
    throw new Error(
      `refusing: estimated ${(estimate.bytes / 1e6).toFixed(0)} MB exceeds the `
      + `${(MAX_UNATTENDED_WRITE_BYTES / 1e6).toFixed(0)} MB ceiling. Split the slice, `
      + "or pass --force having checked free disk in the dashboard."
    );
  }

  if (!apply) { console.log("dry run: nothing written"); return 0; }

  // 1. one source for the whole cohort. These tables carry only a primary key,
  // so there is no ON CONFLICT target to upsert against -- look first, and
  // reuse, which also makes a re-run after an interruption idempotent.
  const existing = await fetch(
    `${SUPABASE}/rest/v1/catalog_sources?select=id&source_name=eq.${encodeURIComponent(cohort)}&limit=1`,
    { headers: headers(key) }
  ).then((r) => r.json());
  const source = existing[0] || (await post(key, "catalog_sources", [{
    source_name: cohort,
    source_url: `https://support.paniniamerica.net/replacement-card-selection#${cohort}`,
    source_type: "PANINI_OFFICIAL_CHECKLIST",
    source_status: "OFFICIAL_CHECKLIST_RAW"
  }]))[0];
  const sourceId = source.id;
  console.log(`  source ${sourceId}`);

  // 2. products under that source, 3. sets under those products
  const byProduct = new Map();
  for (const row of slice) {
    const k = `${row.season_year}|${bareProduct(row.product)}`;
    if (!byProduct.has(k)) byProduct.set(k, { season_year: row.season_year, product: bareProduct(row.product), sport: row.sport, sets: [] });
    byProduct.get(k).sets.push(row);
  }
  const productRows = [...byProduct.values()].map((p) => ({
    source_id: sourceId,
    sport: p.sport || "football",
    season_year: p.season_year,
    manufacturer: "Panini",
    product: p.product,
    metadata: { ingest_cohort: cohort }
  }));
  const products = await post(key, "catalog_products", productRows);
  const productId = new Map(products.map((p) => [`${p.season_year}|${p.product}`, p.id]));
  console.log(`  products ${products.length}`);

  // 4. cards
  let written = 0;
  const cardRows = [];
  for (const entry of byProduct.values()) {
    const pid = productId.get(`${entry.season_year}|${entry.product}`);
    if (!pid) continue;
    for (const row of entry.sets) {
      for (const card of row.cards || []) {
        if (!card.player) continue;
        const identity = {
          season_year: row.season_year,
          product: entry.product,
          set_or_insert: row.set_or_insert,
          player: card.player,
          card_number: card.card_number
        };
        cardRows.push({
          product_id: pid,
          source_id: sourceId,
          sport: entry.sport || "football",
          season_year: row.season_year,
          manufacturer: "Panini",
          product: entry.product,
          set_or_insert: row.set_or_insert,
          players: [card.player],
          card_number: card.card_number,
          canonical_title: canonicalTitle(identity),
          source_status: "OFFICIAL_CHECKLIST_RAW",
          review_status: "REVIEW_REQUIRED",
          metadata: { ingest_cohort: cohort, panini_card_set_id: row.card_set_id }
        });
      }
    }
  }
  const batches = chunk(cardRows, BATCH);
  for (const [index, batch] of batches.entries()) {
    await post(key, "catalog_cards", batch, { returning: "minimal" });
    written += batch.length;
    if (index % 20 === 0) process.stderr.write(`  cards ${written}/${cardRows.length}\r`);
    await sleep(SETTLE_MS);
  }
  console.log(`\n  cards ${written}`);
  console.log(`  undo: node scripts/ingest-checklist-slice.mjs --undo --cohort ${cohort} --apply`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
