#!/usr/bin/env node
// Derive product schemas from the harvested manufacturer checklists.
//
//   node scripts/build-product-schemas.mjs --out data/catalog/product-schemas.json
//
// constraint-engine.mjs already implements the checks -- allowedCardTypes,
// allowedChecklistCodes, parallelSerialTaxonomyCompatibility -- and every call
// site passes `productSchemas: []`. The machinery evaluates over an empty set
// and therefore constrains nothing. This produces the missing input.
//
// It matters because the observed failure on unseen products is not a reading
// failure, it is an impossible-combination failure. Measured on the seventeen
// unseen cards: player names were right and set names were often right, while
// product lines were wrong -- "2021 Panini Contours JALYN DANIELS" for a card
// that is 2025 Panini Phoenix Contours Jaxson Dart. The model picked the
// nearest product from its training prior and invented a year to match.
//
// The harvest can refute those directly. Across 2.26M cards and 185
// product-years:
//
//   2021 + "Contours"        does not exist
//   2023 + "Fire Fabrics"    exists only in Panini Phoenix
//   2023 + "Fade To Black"   exists only in Panini Phoenix
//
// The last two are the interesting ones. The model READ those set names
// correctly on the benchmark and still named the wrong product. A set name that
// resolves to exactly one product line is a stronger identity signal than
// anything the model can infer, and it needs no retrieval call at all -- just a
// table and a lookup.
//
// So the schema carries two things: what a product is allowed to contain, and
// the inverse index from a set name to the products that actually contain it.

import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { mapRows } from "./map-panini-harvest.mjs";

const HARVEST_DIR = "/tmp/panini-cards";

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const bareProduct = (value) => cleanText(value)
  .replace(/\(\s*\d{2}\s*-\s*\d{2}\s*\)/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const normalizeSet = (value) => cleanText(value).toLowerCase();

export function loadHarvest(dir = HARVEST_DIR) {
  const rows = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    rows.push(...mapRows(JSON.parse(readFileSync(`${dir}/${file}`, "utf8")).rows));
  }
  return rows;
}

export function buildSchemas(rows = []) {
  const products = new Map();
  // set name -> the product-years that actually contain it
  const setIndex = new Map();

  for (const row of rows) {
    const product = bareProduct(row.product);
    const key = `${row.season_year}|${product}`;
    const entry = products.get(key) || {
      season_year: row.season_year,
      product,
      sport: row.sport,
      sets: new Set(),
      card_numbers: new Set()
    };
    const set = cleanText(row.set_or_insert);
    if (set) entry.sets.add(set);
    for (const card of row.cards || []) {
      if (card.card_number) entry.card_numbers.add(cleanText(card.card_number));
    }
    products.set(key, entry);

    if (set) {
      const bucket = setIndex.get(normalizeSet(set)) || new Set();
      bucket.add(key);
      setIndex.set(normalizeSet(set), bucket);
    }
  }

  const schemas = [...products.values()].map((entry) => ({
    season_year: entry.season_year,
    product: entry.product,
    sport: entry.sport,
    set_count: entry.sets.size,
    card_number_count: entry.card_numbers.size,
    sets: [...entry.sets].sort(),
    card_numbers: [...entry.card_numbers].sort()
  })).sort((left, right) => (left.product + left.season_year).localeCompare(right.product + right.season_year));

  // Only the discriminating entries are worth carrying: a set name found in one
  // product line identifies it outright, and that is the whole value here.
  const setToProducts = {};
  for (const [set, keys] of setIndex) setToProducts[set] = [...keys].sort();

  return { schemas, setToProducts };
}

export function discriminatingSets(setToProducts = {}) {
  return Object.entries(setToProducts).filter(([, keys]) => keys.length === 1);
}

// Does a (year, set) pair exist anywhere in what the manufacturers published?
export function combinationExists(setToProducts = {}, { season_year = "", set = "" } = {}) {
  const keys = setToProducts[normalizeSet(set)];
  if (!keys) return false;
  return keys.some((key) => key.split("|")[0] === cleanText(season_year));
}

export async function main(argv = process.argv.slice(2)) {
  const outPath = argValue(argv, "--out", "data/catalog/product-schemas.json");
  const rows = loadHarvest();
  const { schemas, setToProducts } = buildSchemas(rows);
  const unique = discriminatingSets(setToProducts);

  console.log(`product-years        ${schemas.length}`);
  console.log(`distinct set names   ${Object.keys(setToProducts).length}`);
  console.log(`  identifying exactly one product-year   ${unique.length}  (${(100 * unique.length / Object.keys(setToProducts).length).toFixed(1)}%)`);

  console.log(`\nthe combinations the model invented on the unseen benchmark:`);
  for (const [year, set] of [["2021", "Contours"], ["2025", "Contours"], ["2023", "Fire Fabrics"], ["2023", "Fade To Black"]]) {
    const exists = combinationExists(setToProducts, { season_year: year, set });
    const owners = (setToProducts[normalizeSet(set)] || []).filter((k) => k.startsWith(`${year}|`));
    console.log(`  ${year} + "${set}"`.padEnd(30), exists ? `-> ${owners.map((k) => k.split("|")[1]).join(", ")}` : "does not exist");
  }

  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), `${JSON.stringify({
    schema_version: "product-schemas-v1",
    generated_at: new Date().toISOString(),
    source: "panini checklist harvest",
    product_year_count: schemas.length,
    set_name_count: Object.keys(setToProducts).length,
    discriminating_set_count: unique.length,
    schemas,
    set_to_products: setToProducts
  })}\n`, "utf8");
  console.log(`\nwrote -> ${outPath}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
