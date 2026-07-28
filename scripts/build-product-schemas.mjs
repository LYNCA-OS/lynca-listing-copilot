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

const PANINI_DIR = "/tmp/panini-cards";
const TOPPS_DIR = "/tmp/topps-cards";

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

export function loadHarvest(dir = PANINI_DIR) {
  const rows = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    rows.push(...mapRows(JSON.parse(readFileSync(`${dir}/${file}`, "utf8")).rows));
  }
  return rows;
}

// The Topps harvester already writes the shape mapRows produces, one file per
// product rather than per shard, so it only needs flattening.
export function loadToppsHarvest(dir = TOPPS_DIR) {
  const rows = [];
  let files = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return rows;
  }
  for (const file of files) {
    const doc = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
    rows.push(...(doc.rows || []));
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

  // The consumer contract is not free-form. constraint-engine.mjs reads
  // `collector_numbers`/`checklist_codes` for allowedChecklistCodes and
  // `card_types` for allowedCardTypes, and matches a schema to an identity on
  // `product` alone -- it never looks at the year. An earlier version of this
  // file emitted `card_numbers` and `sets`, which the engine silently ignored:
  // the same dead wiring as passing `[]`, only harder to notice.
  //
  // So schemas are keyed by product across years, and carry the names the
  // engine actually reads. season_years is kept alongside for callers that do
  // care about the year, since the pair (year, set) is what refutes a
  // fabricated combination like "2021 Contours".
  const byProductOnly = new Map();
  for (const entry of products.values()) {
    const existing = byProductOnly.get(entry.product) || {
      product: entry.product,
      sport: entry.sport,
      season_years: new Set(),
      sets: new Set(),
      collector_numbers: new Set()
    };
    existing.season_years.add(entry.season_year);
    for (const set of entry.sets) existing.sets.add(set);
    for (const number of entry.card_numbers) existing.collector_numbers.add(number);
    byProductOnly.set(entry.product, existing);
  }
  const schemas = [...byProductOnly.values()].map((entry) => ({
    product: entry.product,
    sport: entry.sport,
    season_years: [...entry.season_years].sort(),
    // `card_types` is what allowedCardTypes reads. A manufacturer set name is
    // the closest published equivalent of a card type, and leaving it empty
    // would make that rule vacuous rather than absent.
    card_types: [...entry.sets].sort(),
    collector_numbers: [...entry.collector_numbers].sort(),
    set_count: entry.sets.size,
    collector_number_count: entry.collector_numbers.size
  })).sort((left, right) => left.product.localeCompare(right.product));

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
  // Topps joins the set-name index and the schemas, and deliberately does NOT
  // join entity-existence's covered manufacturers. We hold 66 of Topps' ~883
  // published sources -- roughly 7.5% -- so treating absence from this index as
  // fabrication would flag the great majority of real Topps products. That is
  // the "absent coverage as evidence against" error that has already cost two
  // reverted changes; the guard in entity-existence.mjs stays at ["panini"].
  //
  // The inverse index carries no such risk: a set name that is not present
  // simply returns nothing, and accuses no one. And it is worth more here than
  // for Panini -- 86.6% of Topps set names identify exactly one product-year
  // against Panini's 59.9%, because Topps names inserts distinctively where
  // Panini reuses "Base Gold" across products.
  const rows = [...loadHarvest(), ...loadToppsHarvest()];
  const { schemas, setToProducts } = buildSchemas(rows);
  const unique = discriminatingSets(setToProducts);

  console.log(`product lines        ${schemas.length}`);
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
