#!/usr/bin/env node
// Map harvested Panini rows onto the catalog_cards shape.
//
//   node scripts/map-panini-harvest.mjs /tmp/panini-a1-2024.json [more...] --out <path>
//   node scripts/map-panini-harvest.mjs ... --sample 20      (print, write nothing)
//
// The harvest is set-grained: a row is one printing of one insert, e.g.
// "2023 Donruss Optic Football - Rated Rookies RPS Autographs Gold" under the
// Optic program. That maps to product + set_or_insert, and the set name is
// where the parallel and rookie wording lives -- the two things the pipeline is
// most often missing.
//
// Set names frequently repeat the year, brand and sport that are already their
// own columns ("2023 Donruss Optic Football - ..."), so that prefix is trimmed;
// keeping it would push duplicated tokens into every title built from this row.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SPORT_BY_ACTIVITY = {
  activity_1: "football",
  activity_7: "golf",
  activity_8: "hockey",
  activity_9: "basketball",
  activity_11: "soccer",
  activity_12: "racing"
};

export function cleanSetName(setName = "", { year = "", brand = "", program = "" } = {}) {
  let text = String(setName).replace(/\s+/g, " ").trim();
  // Drop a leading "<year> <brand> <program> <sport> - " restatement.
  const lead = new RegExp(
    `^\\s*(?:\\d{4}(?:-\\d{2})?\\s+)?(?:${[brand, program].filter(Boolean).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|football|basketball|hockey|soccer|golf|racing|baseball)\\b[\\s-]*`,
    "i"
  );
  let previous;
  do { previous = text; text = text.replace(lead, "").trim(); } while (text !== previous && text);
  return text.replace(/^[-–—\s]+/, "").trim() || String(setName).trim();
}

// "1.Clayton Tune" -> { card_number: "1", player: "Clayton Tune" }
export function splitCardLabel(label = "") {
  const match = String(label).trim().match(/^\s*([A-Za-z]{0,4}-?\d{1,5}[A-Za-z]?)\s*[.)]\s*(.+)$/);
  if (!match) return { card_number: null, player: String(label).trim() || null };
  return { card_number: match[1], player: match[2].trim() || null };
}

// Program names often already carry the brand ("Donruss" / "Clearly Donruss"),
// so joining the two blindly yields "Donruss Clearly Donruss".
export function productName(brand = "", program = "") {
  const b = String(brand).trim();
  const p = String(program).trim();
  if (!b) return p;
  if (!p) return b;
  if (new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(p)) return p;
  return `${b} ${p}`.replace(/\s+/g, " ");
}

export function mapRows(rows = []) {
  return rows.map((row) => {
    const setName = cleanSetName(row.card_set, row);
    return {
      sport: SPORT_BY_ACTIVITY[row.activity] || null,
      season_year: row.year,
      manufacturer: "Panini",
      brand: row.brand,
      product: productName(row.brand, row.program),
      set_or_insert: setName,
      source_set_name: row.card_set,
      program_id: row.program_id,
      card_set_id: row.card_set_id,
      cards: Array.isArray(row.cards) ? row.cards.map((c) => splitCardLabel(c.name)) : []
    };
  });
}

function argValue(argv, name, fallback = "") {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
}

export async function main(argv = process.argv.slice(2)) {
  const sample = Number(argValue(argv, "--sample", "0")) || 0;
  const outPath = argValue(argv, "--out", "");
  // The --out path is itself a .json, so exclude any value that follows a flag.
  const files = argv.filter((a, i) => a.endsWith(".json") && !a.startsWith("--")
    && !String(argv[i - 1] || "").startsWith("--"));

  const rows = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(resolve(file), "utf8"));
    rows.push(...(parsed.rows || []));
  }
  const mapped = mapRows(rows);

  const products = new Set(mapped.map((m) => m.product));
  console.log(`harvested rows ${rows.length} -> mapped ${mapped.length}`);
  console.log(`distinct products: ${products.size}`);

  if (sample) {
    console.log(`\nsample of ${sample}:`);
    for (const row of mapped.slice(0, sample)) {
      console.log(`  ${row.season_year} | ${row.product.padEnd(28)} | ${row.set_or_insert}`);
    }
    return 0;
  }
  if (!outPath) return 0;
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), `${JSON.stringify({
    schema_version: "panini-mapped-v1",
    generated_at: new Date().toISOString(),
    row_count: mapped.length,
    rows: mapped
  })}\n`, "utf8");
  console.log(`wrote ${mapped.length} rows -> ${outPath}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
