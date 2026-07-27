#!/usr/bin/env node
// Build a benchmark of cards from product lines our catalog does not know.
//
//   node scripts/build-unseen-product-benchmark.mjs --products 4 --per-product 6 \
//     --out artifacts/smoke/unseen-products.json
//
// Every accuracy number this project has comes from cold20 and reviewed-200,
// which are drawn from cards our listers already handled -- familiar products,
// present in the catalog. That measures how well we do on ground we have
// already covered. It cannot measure the thing we actually want, which is
// naming a card from a product that shipped this week.
//
// Of 219 manufacturer product-years harvested from Panini, 139 are absent from
// catalog_cards, covering 1,038,840 cards. Those are the ones to draw from.
//
// GROUND TRUTH comes from the manufacturer checklist, not from our catalog and
// not from the seller. Using our catalog would be circular -- it is the thing
// under test. Using the eBay title would measure agreement with one seller's
// habits rather than correctness: sellers abbreviate, omit, and disagree with
// each other. The checklist states year, product, set, card number and player
// authoritatively, because it is the document the card was printed from.
//
// So the benchmark scores IDENTITY FIELDS, not a rendered string. Whether the
// renderer then arranges them well is a separate, already-measured question;
// this asks only whether the system knows which card it is holding.
//
// Images come from live eBay listings, matched back to a checklist row by
// player and card number. A listing that cannot be matched confidently is
// dropped rather than guessed at -- a benchmark with invented ground truth is
// worse than no benchmark.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { mapRows } from "./map-panini-harvest.mjs";

const HARVEST_DIR = "/tmp/panini-cards";
const SUPABASE = "https://osrrujmpxxiefppjfgpd.supabase.co";
const DEFAULT_BASE = "https://listing.lyncafei.team";

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// The manufacturer appends a season to the product name; a lister does not
// write it, and it must not make a known product look unknown.
export const normalizeProduct = (value) => cleanText(value)
  .toLowerCase()
  .replace(/\(\s*\d{2}\s*-\s*\d{2}\s*\)/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export function loadHarvest(dir = HARVEST_DIR) {
  const rows = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    rows.push(...mapRows(JSON.parse(readFileSync(`${dir}/${file}`, "utf8")).rows));
  }
  return rows;
}

async function knownProducts(key) {
  const known = new Set();
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${SUPABASE}/rest/v1/catalog_cards?select=product&limit=1000&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!response.ok) throw new Error(`catalog read http_${response.status}`);
    const page = await response.json();
    for (const row of page) known.add(normalizeProduct(row.product));
    if (page.length < 1000) break;
  }
  return known;
}

export function unseenProductLines(harvest = [], known = new Set()) {
  const byProduct = new Map();
  for (const row of harvest) {
    if (known.has(normalizeProduct(row.product))) continue;
    const key = `${row.season_year}|${row.product}|${row.sport}`;
    const entry = byProduct.get(key) || { season_year: row.season_year, product: row.product, sport: row.sport, cards: 0, rows: [] };
    entry.cards += row.cards?.length || 0;
    entry.rows.push(row);
    byProduct.set(key, entry);
  }
  return [...byProduct.values()].sort((left, right) => right.cards - left.cards);
}

// A listing matches a checklist row when the player name appears and, if the
// listing prints a card number, that number agrees. Anything looser invents
// ground truth.
export function matchListingToChecklist(title = "", line = {}) {
  const haystack = ` ${cleanText(title).toLowerCase().replace(/[^a-z0-9#/ ]+/g, " ").replace(/\s+/g, " ")} `;
  const listingNumbers = new Set([...haystack.matchAll(/#\s*([a-z]{0,4}-?\d{1,5})\b/g)].map((m) => m[1]));
  for (const row of line.rows || []) {
    for (const card of row.cards || []) {
      const player = cleanText(card.player).toLowerCase();
      if (!player || player.split(" ").length < 2) continue;
      if (!haystack.includes(` ${player} `)) continue;
      const number = cleanText(card.card_number).toLowerCase();
      if (listingNumbers.size && number && !listingNumbers.has(number)) continue;
      return {
        season_year: line.season_year,
        product: line.product,
        sport: line.sport,
        set_or_insert: row.set_or_insert,
        card_number: card.card_number,
        player: card.player,
        card_number_confirmed_by_listing: listingNumbers.has(number)
      };
    }
  }
  return null;
}

async function login(baseUrl, env) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: env.METAVERSE_USERNAME, password: env.METAVERSE_PASSWORD })
  });
  const cookie = cleanText(response.headers.get("set-cookie")).split(";")[0];
  if (!cookie) throw new Error(`login failed http_${response.status}`);
  return cookie;
}

async function listingsFor(baseUrl, cookie, query, limit) {
  const url = `${baseUrl}/api/ebay-card-listings?q=${encodeURIComponent(query)}&limit=${limit}`;
  const response = await fetch(url, { headers: { cookie } });
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body.listings) ? body.listings : [];
}

export async function main(argv = process.argv.slice(2)) {
  const key = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const baseUrl = cleanText(argValue(argv, "--base-url", DEFAULT_BASE));
  const productCount = Number(argValue(argv, "--products", "4")) || 4;
  const perProduct = Number(argValue(argv, "--per-product", "6")) || 6;
  const outPath = argValue(argv, "--out", "");

  process.stderr.write("reading harvest and catalog...\n");
  const harvest = loadHarvest();
  const known = await knownProducts(key);
  const unseen = unseenProductLines(harvest, known);
  process.stderr.write(`  unseen product-years: ${unseen.length}\n`);

  const cookie = await login(baseUrl, process.env);
  const cards = [];
  const perLine = [];

  for (const line of unseen.slice(0, productCount)) {
    const query = `${line.season_year} ${line.product}`.replace(/\(\s*\d{2}\s*-\s*\d{2}\s*\)/g, "").replace(/\s+/g, " ").trim();
    const listings = await listingsFor(baseUrl, cookie, query, Math.max(20, perProduct * 6));
    let matched = 0;
    for (const listing of listings) {
      if (matched >= perProduct) break;
      const truth = matchListingToChecklist(listing.title, line);
      if (!truth) continue;
      const images = (listing.image_urls || []).filter(Boolean);
      if (!images.length) continue;
      cards.push({
        source: "ebay_browse",
        item_id: listing.item_id,
        listing_title: listing.title,
        image_urls: images,
        identity_ground_truth: truth
      });
      matched += 1;
    }
    perLine.push({ query, listings: listings.length, matched });
    process.stderr.write(`  ${query.padEnd(40)} listings ${String(listings.length).padStart(3)}  matched ${matched}\n`);
  }

  console.log(`\nunseen-product benchmark: ${cards.length} cards from ${perLine.length} product lines`);
  console.log(`  match rate: ${perLine.reduce((s, l) => s + l.matched, 0)}/${perLine.reduce((s, l) => s + l.listings, 0)} listings usable`);
  for (const card of cards.slice(0, 6)) {
    const t = card.identity_ground_truth;
    console.log(`    ${t.season_year} ${t.product} | ${t.set_or_insert} | #${t.card_number} ${t.player}`);
  }

  if (outPath) {
    await mkdir(dirname(resolve(outPath)), { recursive: true });
    await writeFile(resolve(outPath), `${JSON.stringify({
      schema_version: "unseen-product-benchmark-v1",
      generated_at: new Date().toISOString(),
      note: "ground truth is the manufacturer checklist, not our catalog and not the seller title",
      product_lines: perLine,
      cards
    }, null, 2)}\n`, "utf8");
    console.log(`\n  wrote ${cards.length} cards -> ${outPath}`);
  }
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
