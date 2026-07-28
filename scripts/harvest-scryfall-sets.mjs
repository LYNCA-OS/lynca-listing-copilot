#!/usr/bin/env node
// Harvest Magic: The Gathering sets from Scryfall.
//
//   node scripts/harvest-scryfall-sets.mjs --match "final fantasy"
//   node scripts/harvest-scryfall-sets.mjs --since 2025-01-01
//
// Our own trade history puts MTG Final Fantasy at 854 listings -- third behind
// Topps Chrome and Bowman Chrome, ahead of Panini -- and the catalog holds
// nothing for it. Meanwhile Final Fantasy is only 1,346 cards across seven
// sets, so the density of value per harvested card is far higher here than in
// the 2.26M Panini cards gathered so far.
//
// Scryfall is a community API and `catalog_sources.source_type` already
// reserves SCRYFALL_COMMUNITY_API for it, which is the right trust tier: it is
// not the publisher. Wizards' own Gatherer is the official source
// (WOTC_GATHERER_OFFICIAL_DATABASE) and would be the upgrade path if a card's
// identity is ever contested.
//
// Written to the same shape as the Panini and Topps harvests so
// build-product-schemas.mjs and build-constraint-model.mjs consume it
// unchanged. A TCG "set" maps to product; the collector number maps to the card
// number; there is no player, so the card name takes that slot -- which is what
// the constraint model keys on and what a lister writes in the title.
//
// Rate limit: Scryfall asks for 50-100ms between requests. Honoured, and the
// bulk pagination is 175 cards per page, so a 600-card set is four calls.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const API = "https://api.scryfall.com";
const DEFAULT_OUT = "/tmp/mtg-cards";
const POLITE_MS = 120;

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "lynca-listing-copilot/1.0" },
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  await sleep(POLITE_MS);
  return response.json();
}

export function selectSets(sets = [], { match = "", since = "", types = ["expansion", "core", "commander", "masters", "draft_innovation"] } = {}) {
  const needle = cleanText(match).toLowerCase();
  return sets.filter((set) => {
    if (needle && !cleanText(set.name).toLowerCase().includes(needle)) return false;
    if (since && cleanText(set.released_at) < since) return false;
    if (!needle && types.length && !types.includes(set.set_type)) return false;
    return Number(set.card_count || 0) > 0;
  });
}

// A TCG card has no player. The card name is what identifies it and what a
// lister writes, so it occupies the player slot the constraint model reads.
export function toHarvestShape(cards = [], set = {}) {
  return [{
    sport: "tcg",
    season_year: cleanText(set.released_at).slice(0, 4),
    manufacturer: "Wizards of the Coast",
    brand: "Magic: The Gathering",
    product: cleanText(set.name),
    set_or_insert: cleanText(set.name),
    cards: cards.map((card) => ({
      card_number: cleanText(card.collector_number),
      player: cleanText(card.name),
      team: null,
      rarity: cleanText(card.rarity) || null
    }))
  }];
}

export async function main(argv = process.argv.slice(2)) {
  const outDir = argValue(argv, "--out-dir", DEFAULT_OUT);
  const match = argValue(argv, "--match", "");
  const since = argValue(argv, "--since", "");

  const index = await get(`${API}/sets`);
  const sets = selectSets(index.data || [], { match, since });
  console.log(`sets to harvest: ${sets.length}\n`);
  await mkdir(resolve(outDir), { recursive: true });

  let total = 0;
  const failures = [];
  for (const set of sets) {
    try {
      const cards = [];
      let url = `${API}/cards/search?q=${encodeURIComponent(`set:${set.code}`)}&unique=prints&order=set`;
      for (;;) {
        const page = await get(url);
        cards.push(...(page.data || []));
        if (!page.has_more || !page.next_page) break;
        url = page.next_page;
      }
      const shaped = toHarvestShape(cards, set);
      total += cards.length;
      await writeFile(resolve(outDir, `${set.code}.json`), `${JSON.stringify({
        schema_version: "scryfall-harvest-v1",
        generated_at: new Date().toISOString(),
        set_code: set.code,
        set_name: set.name,
        released_at: set.released_at,
        card_count: cards.length,
        rows: shaped
      })}\n`, "utf8");
      console.log(`  ${String(cards.length).padStart(5)} cards  ${set.code.padEnd(6)} ${set.name.slice(0, 42)}`);
    } catch (error) {
      failures.push({ set: set.code, reason: String(error?.message || error).slice(0, 60) });
      console.log(`  FAILED         ${set.code.padEnd(6)} ${set.name.slice(0, 42)}`);
    }
  }

  console.log(`\ntotal ${total.toLocaleString()} cards from ${sets.length - failures.length}/${sets.length} sets -> ${outDir}`);
  for (const failure of failures) console.log(`  failed: ${failure.set} -- ${failure.reason}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
