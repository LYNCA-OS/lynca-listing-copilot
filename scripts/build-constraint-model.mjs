#!/usr/bin/env node
// Turn the card-level harvest into constraints: facts about what cannot exist.
//
//   node scripts/build-constraint-model.mjs --out data/catalog/constraints.json
//
// The harvest holds 2,292,135 cards and was gathered to answer "which card is
// this". That job is largely a detour for day-one recognition: the card itself
// carries its year, product, player and number, the checklist is a second copy,
// and mirroring every manufacturer's every card is an unbounded operational
// burden that still leaves an uncovered manufacturer unnameable.
//
// The job that cannot be replaced is the opposite one -- deciding whether what
// was read is a thing that exists. On the unseen benchmark the pipeline emitted
// "2021 Panini Contours JALYN DANIELS": invented year, invented product,
// invented player, stated without hesitation. Nine of seventeen cards named a
// product line published by nobody.
//
// And that job needs three orders of magnitude less data. Refuting an
// impossible combination needs the shape of what exists, not its contents:
//
//   2,292,135 cards  ->  20,005 players with the years they appear in
//                        30,593 set names with the years they exist in
//                           216 product lines with their sports
//                           280 product-years with their card-number ranges
//
// Under a megabyte, and it ages slowly: a few dozen new products a year against
// millions of new cards. So this is where the memory should live.
//
// Each constraint answers one question, and answers it only in the negative --
// a combination absent from the model is refutable, a combination present is
// merely not refuted. Nothing here asserts an identity.

import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { mapRows } from "./map-panini-harvest.mjs";

const PANINI_DIR = "/tmp/panini-cards";
const TOPPS_DIR = "/tmp/topps-cards";

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const norm = (value) => cleanText(value).toLowerCase();
export const bareProduct = (value) => cleanText(value)
  .replace(/\(\s*\d{2}\s*-\s*\d{2}\s*\)/g, " ")
  .replace(/\s+/g, " ")
  .trim();

// A season may be "2025" or "2025-26"; both start in the same year, and the
// start year is what a claimed year has to agree with.
export function seasonStartYear(value) {
  const match = cleanText(value).match(/^((?:19|20)\d{2})/);
  return match ? Number(match[1]) : null;
}

function loadAll() {
  const rows = [];
  try {
    for (const file of readdirSync(PANINI_DIR).filter((n) => n.endsWith(".json"))) {
      rows.push(...mapRows(JSON.parse(readFileSync(`${PANINI_DIR}/${file}`, "utf8")).rows));
    }
  } catch { /* harvest absent */ }
  try {
    for (const file of readdirSync(TOPPS_DIR).filter((n) => n.endsWith(".json"))) {
      rows.push(...(JSON.parse(readFileSync(`${TOPPS_DIR}/${file}`, "utf8")).rows || []));
    }
  } catch { /* harvest absent */ }
  return rows;
}

export function deriveConstraints(rows = []) {
  const playerYears = new Map();
  const playerTeams = new Map();
  const setYears = new Map();
  const productYears = new Map();
  const productSports = new Map();
  const numberRange = new Map();

  for (const row of rows) {
    const product = bareProduct(row.product);
    const year = seasonStartYear(row.season_year);
    const set = norm(row.set_or_insert);

    if (product && year) {
      if (!productYears.has(product)) productYears.set(product, new Set());
      productYears.get(product).add(year);
    }
    if (product && row.sport) {
      if (!productSports.has(product)) productSports.set(product, new Set());
      productSports.get(product).add(norm(row.sport));
    }
    if (set && year) {
      if (!setYears.has(set)) setYears.set(set, new Set());
      setYears.get(set).add(year);
    }

    for (const card of row.cards || []) {
      const player = norm(card.player);
      if (player && year) {
        if (!playerYears.has(player)) playerYears.set(player, new Set());
        playerYears.get(player).add(year);
      }
      // Topps states the team on the card's own line; Panini does not. A player
      // with a known team set is one more thing a claim can contradict.
      if (player && card.team) {
        if (!playerTeams.has(player)) playerTeams.set(player, new Set());
        playerTeams.get(player).add(norm(card.team));
      }
      const number = cleanText(card.card_number);
      if (product && year && /^\d+$/.test(number)) {
        const key = `${year}|${product}`;
        const current = numberRange.get(key) || [Infinity, -Infinity];
        numberRange.set(key, [Math.min(current[0], Number(number)), Math.max(current[1], Number(number))]);
      }
    }
  }

  const spread = (map) => Object.fromEntries([...map].map(([k, v]) => [k, [...v].sort()]));
  return {
    player_years: spread(playerYears),
    player_teams: spread(playerTeams),
    set_years: spread(setYears),
    product_years: spread(productYears),
    product_sports: spread(productSports),
    product_year_number_range: Object.fromEntries(numberRange)
  };
}

export const refutations = Object.freeze({
  PLAYER_UNKNOWN: "player_unknown",
  PLAYER_YEAR: "player_not_in_that_year",
  PRODUCT_UNKNOWN: "product_unknown",
  PRODUCT_YEAR: "product_not_in_that_year",
  SET_UNKNOWN: "set_unknown",
  SET_YEAR: "set_not_in_that_year",
  NUMBER_RANGE: "card_number_outside_published_range"
});

// Refute, never confirm. A claim the model cannot refute is not thereby true --
// it is merely not contradicted, which is all a constraint can say. And a
// manufacturer absent from the harvest yields no refutations at all, because
// treating our own missing coverage as evidence against is the error that has
// already cost two reverted changes.
export function refute(claim = {}, model = null, { coveredManufacturers = ["panini", "donruss", "topps", "bowman", "score", "prizm", "optic"] } = {}) {
  if (!model) return { refutations: [], checked: false, reason: "no_model" };
  const product = bareProduct(claim.product);
  const covered = coveredManufacturers.some((name) => norm(product).includes(name)
    || norm(claim.manufacturer).includes(name));
  if (!covered) return { refutations: [], checked: false, reason: "manufacturer_not_in_model" };

  const year = seasonStartYear(claim.year || claim.season_year);
  const player = norm(Array.isArray(claim.players) ? claim.players[0] : claim.player || claim.players);
  const set = norm(claim.set_or_insert || claim.set);
  const found = [];

  if (product) {
    const years = model.product_years[product];
    if (!years) found.push({ code: refutations.PRODUCT_UNKNOWN, value: product });
    else if (year && !years.includes(year)) {
      found.push({ code: refutations.PRODUCT_YEAR, value: `${year} ${product}`, published: years });
    }
  }
  if (player) {
    const years = model.player_years[player];
    if (!years) found.push({ code: refutations.PLAYER_UNKNOWN, value: player });
    else if (year && !years.includes(year)) {
      found.push({ code: refutations.PLAYER_YEAR, value: `${year} ${player}`, published: years });
    }
  }
  if (set) {
    const years = model.set_years[set];
    if (!years) found.push({ code: refutations.SET_UNKNOWN, value: set });
    else if (year && !years.includes(year)) {
      found.push({ code: refutations.SET_YEAR, value: `${year} ${set}`, published: years });
    }
  }
  const number = cleanText(claim.card_number);
  if (product && year && /^\d+$/.test(number)) {
    const range = model.product_year_number_range[`${year}|${product}`];
    if (range && (Number(number) < range[0] || Number(number) > range[1])) {
      found.push({ code: refutations.NUMBER_RANGE, value: number, published: range });
    }
  }
  return { refutations: found, checked: true };
}

export async function main(argv = process.argv.slice(2)) {
  const outPath = argValue(argv, "--out", "data/catalog/constraints.json");
  const rows = loadAll();
  const model = deriveConstraints(rows);

  const cards = rows.reduce((sum, row) => sum + (row.cards?.length || 0), 0);
  const sizes = Object.entries(model).map(([k, v]) => [k, Object.keys(v).length]);
  console.log(`source cards ${cards.toLocaleString()} -> constraints:`);
  for (const [key, count] of sizes) console.log(`  ${key.padEnd(28)} ${count.toLocaleString()}`);

  const payload = {
    schema_version: "constraint-model-v1",
    generated_at: new Date().toISOString(),
    source_card_count: cards,
    ...model
  };
  const json = `${JSON.stringify(payload)}\n`;
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), json, "utf8");
  console.log(`\n${(json.length / 1e6).toFixed(2)} MB from ${(cards / 1e6).toFixed(2)}M cards -> ${outPath}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
