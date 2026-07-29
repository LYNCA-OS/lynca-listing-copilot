#!/usr/bin/env node
// Mine the parallel ladder from our own verified output, not from a
// manufacturer checklist.
//
//   node scripts/build-parallel-ladder.mjs --out data/catalog/parallel-ladder.json
//
// `catalog_parallels` has the exactly right columns -- parallel_family,
// parallel_exact, surface_color, expected_serial_denominator -- and zero rows.
// It has never been populated because nothing ever produced a value to write:
// the `parallel` field is filled on 39 of 4,527 production cards.
//
// The obvious source is a manufacturer checklist. That is the wrong source, and
// not because it is hard to get: a checklist makes naming wait until somebody
// else publishes, which is the opposite of naming a card on the day it exists.
//
// Our own output is the right source, and the reason is measurable. Across
// 3,345 pairs of the same asset recognised twice within one hour:
//
//   parallel_exact agreed      93.4%   (93.9% when both runs named one)
//   serial_denominator agreed  93.8%
//   surface_color agreed       72.4%
//   whole identity agreed      50.3%   <- for contrast
//
// The two fields this ladder is built from are the *most* stable things the
// pipeline produces. Mining them does not propagate the instability that makes
// identity caching unsafe, because that instability lives in the product, set
// and card-number fields instead.
//
// The ladder maps (product, serial denominator) -> the manufacturer's proper
// name. 89.7% of those keys resolve to exactly one name. On production it fills
// 289 of 2,160 cards (13.4%) that have a product and a print run but no proper
// name -- 228 of them from keys observed more than once.
//
// A key seen once is one observation, not a rule, so `--min-observations`
// defaults to 2. Passing 1 admits the singletons and is a deliberate choice.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => cleanText(value).toLowerCase();

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

/**
 * @param {Array<{product, serial_denominator, parallel_exact, surface_color, parallel_family}>} rows
 */
export function deriveLadder(rows = [], { minObservations = 2 } = {}) {
  const counts = new Map();
  for (const row of rows) {
    const product = norm(row.product);
    const denominator = cleanText(row.serial_denominator);
    const name = cleanText(row.parallel_exact);
    if (!product || !denominator || !name) continue;
    const key = `${product}|${denominator}`;
    if (!counts.has(key)) counts.set(key, new Map());
    const names = counts.get(key);
    const entry = names.get(norm(name)) || {
      parallel_exact: name,
      surface_color: cleanText(row.surface_color) || null,
      parallel_family: cleanText(row.parallel_family) || null,
      observations: 0
    };
    entry.observations += 1;
    names.set(norm(name), entry);
  }

  const ladder = {};
  const rejected = [];
  for (const [key, names] of counts) {
    const entries = [...names.values()].sort((a, b) => b.observations - a.observations);
    // Two different names for one print run is not a ladder rung, it is a
    // disagreement, and a disagreement must never be resolved by taking the
    // more frequent one -- that is how a wrong name becomes canonical.
    if (entries.length > 1) {
      rejected.push({ key, reason: "several_names_for_one_print_run", names: entries.map((e) => e.parallel_exact) });
      continue;
    }
    const [entry] = entries;
    if (entry.observations < minObservations) {
      rejected.push({ key, reason: "seen_only_once", names: [entry.parallel_exact] });
      continue;
    }
    const [product, denominator] = key.split("|");
    ladder[key] = {
      product,
      expected_serial_denominator: denominator,
      parallel_exact: entry.parallel_exact,
      surface_color: entry.surface_color,
      parallel_family: entry.parallel_family,
      observations: entry.observations,
      source: "OWN_VERIFIED_OUTPUT"
    };
  }
  return { ladder, rejected };
}

/**
 * The manufacturer's proper name for this print run, when the ladder knows one.
 *
 * Returns null rather than guessing. A card whose ladder rung is unknown still
 * gets the descriptive form from composeParallel -- "Silver /75" -- which is
 * correct and sellable, so there is never a reason to invent a proper noun.
 */
export function lookupParallel(claim = {}, ladder = null) {
  if (!ladder) return null;
  const product = norm(claim.product);
  const denominator = cleanText(claim.serial_denominator ?? claim.numbered_to);
  if (!product || !denominator) return null;
  return ladder[`${product}|${denominator}`] ?? null;
}

export async function main(argv = process.argv.slice(2)) {
  const outPath = argValue(argv, "--out", "data/catalog/parallel-ladder.json");
  const minObservations = Number(argValue(argv, "--min-observations", "2")) || 2;
  const inPath = argValue(argv, "--in", "");
  if (!inPath) throw new Error("--in <rows.json> is required (export from v4_recognition_sessions)");

  const { readFile } = await import("node:fs/promises");
  const rows = JSON.parse(await readFile(resolve(inPath), "utf8"));
  const { ladder, rejected } = deriveLadder(rows, { minObservations });

  const keys = Object.keys(ladder);
  console.log(`source rows ${rows.length.toLocaleString()}`);
  console.log(`  ladder rungs      ${keys.length}`);
  console.log(`  rejected          ${rejected.length}`);
  for (const reason of ["several_names_for_one_print_run", "seen_only_once"]) {
    console.log(`    ${reason.padEnd(34)} ${rejected.filter((r) => r.reason === reason).length}`);
  }

  const payload = {
    schema_version: "parallel-ladder-v1",
    generated_at: new Date().toISOString(),
    min_observations: minObservations,
    source: "OWN_VERIFIED_OUTPUT",
    rung_count: keys.length,
    ladder
  };
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`\n-> ${outPath}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
