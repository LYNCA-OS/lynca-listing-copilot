#!/usr/bin/env node
// Score how tradeable a catalog slice is, using live eBay listings.
//
//   node scripts/probe-market-demand.mjs --level product --out /tmp/demand-products.json
//   node scripts/probe-market-demand.mjs --level set --product "Donruss Optic" --limit 200
//
// Most of a manufacturer's checklist never trades. Ingesting all of it costs
// catalog size and retrieval noise for cards no writer will ever list, so the
// question "is this worth having in the catalog" needs an answer that is not
// our own sourcing history -- that history only shows what we happened to buy,
// not what the market wants.
//
// eBay's Browse API answers the cheap half of it. One query returns
// total_reported, the number of active listings matching it, plus a price
// sample. A slice with no active listings is not tradeable; a slice with
// thousands is liquid.
//
// This measures SUPPLY, not demand: active listings are what sellers posted,
// not what buyers bought. A slice can be thick with listings that never sell.
// Sold comps need eBay's Marketplace Insights API, which is a separate grant.
// So treat a low count as strong evidence against, and a high count as weak
// evidence for -- the asymmetry is the useful part, since the goal is to
// exclude the dead 65% rather than to rank the live remainder.
//
// Calls go through the deployed app because the eBay credentials live in the
// production environment and are not readable locally.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_BASE = "https://listing.lyncafei.team";
const CONCURRENCY = 4;
const SAMPLE_LIMIT = 20;

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function priceStats(listings = []) {
  const amounts = listings
    .map((item) => Number(cleanText(item.price).split(" ")[0]))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!amounts.length) return { count: 0, median: null, p25: null, p75: null };
  const at = (q) => amounts[Math.min(amounts.length - 1, Math.floor(q * amounts.length))];
  return { count: amounts.length, median: at(0.5), p25: at(0.25), p75: at(0.75) };
}

// A slice earns admission on liquidity first and price second: a thousand
// listings of two-dollar commons is a slice writers still will not list.
export function demandTier({ totalReported = 0, median = null } = {}) {
  if (!totalReported) return "T2_no_market";
  if (totalReported < 50) return "T2_illiquid";
  if (median !== null && median < 5) return "T1_low_value";
  if (totalReported >= 500 && median !== null && median >= 15) return "T0_liquid";
  return "T1_marginal";
}

async function login(base, username, password) {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const cookie = cleanText(response.headers.get("set-cookie")).split(";")[0];
  if (!cookie) throw new Error(`login failed HTTP ${response.status}`);
  return cookie;
}

async function probe(base, cookie, query) {
  const url = `${base}/api/ebay-card-listings?q=${encodeURIComponent(query)}&limit=${SAMPLE_LIMIT}`;
  const response = await fetch(url, { headers: { cookie } });
  if (!response.ok) return { query, error: `http_${response.status}` };
  const body = await response.json();
  const stats = priceStats(body.listings || []);
  const totalReported = Number(body.total_reported || 0);
  return {
    query,
    total_reported: totalReported,
    sampled: stats.count,
    median_price: stats.median,
    p25_price: stats.p25,
    p75_price: stats.p75,
    tier: demandTier({ totalReported, median: stats.median })
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await worker(items[index], index);
    }
  }));
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const base = cleanText(argValue(argv, "--base-url", DEFAULT_BASE));
  const queriesPath = argValue(argv, "--queries", "");
  const outPath = argValue(argv, "--out", "");
  const limit = Number(argValue(argv, "--limit", "0")) || 0;

  const username = cleanText(process.env.METAVERSE_USERNAME);
  const password = cleanText(process.env.METAVERSE_PASSWORD);
  if (!username || !password) throw new Error("METAVERSE_USERNAME and METAVERSE_PASSWORD are required");

  const inline = argv.filter((a, i) => i > 0 && argv[i - 1] === "--query");
  let queries = inline;
  if (queriesPath) {
    const { readFile } = await import("node:fs/promises");
    queries = JSON.parse(await readFile(resolve(queriesPath), "utf8"));
  }
  if (!queries.length) throw new Error("--queries <file.json> or --query <text> is required");
  if (limit) queries = queries.slice(0, limit);

  const cookie = await login(base, username, password);
  process.stderr.write(`probing ${queries.length} queries\n`);

  let done = 0;
  const rows = await mapWithConcurrency(queries, CONCURRENCY, async (query) => {
    const row = await probe(base, cookie, query);
    done += 1;
    if (done % 25 === 0) process.stderr.write(`  ${done}/${queries.length}\r`);
    return row;
  });

  const byTier = {};
  for (const row of rows) byTier[row.tier || "error"] = (byTier[row.tier || "error"] || 0) + 1;

  console.log(`\nprobed ${rows.length} queries`);
  for (const [tier, n] of Object.entries(byTier).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tier.padEnd(16)} ${String(n).padStart(4)}`);
  }

  const liquid = rows.filter((r) => r.tier === "T0_liquid").sort((a, b) => b.total_reported - a.total_reported);
  console.log(`\nmost liquid:`);
  for (const row of liquid.slice(0, 15)) {
    console.log(`  ${String(row.total_reported).padStart(8)} listings  median $${String(row.median_price).padStart(7)}  ${row.query}`);
  }
  const dead = rows.filter((r) => r.tier === "T2_no_market" || r.tier === "T2_illiquid");
  if (dead.length) {
    console.log(`\nno market (sample):`);
    for (const row of dead.slice(0, 10)) console.log(`  ${String(row.total_reported).padStart(8)} listings  ${row.query}`);
  }

  if (outPath) {
    await mkdir(dirname(resolve(outPath)), { recursive: true });
    await writeFile(resolve(outPath), `${JSON.stringify({
      schema_version: "market-demand-probe-v1",
      generated_at: new Date().toISOString(),
      base_url: base,
      note: "total_reported counts ACTIVE listings (supply), not sold comps (demand)",
      rows
    })}\n`, "utf8");
    console.log(`\nwrote ${rows.length} rows -> ${outPath}`);
  }
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
