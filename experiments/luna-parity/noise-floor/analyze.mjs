#!/usr/bin/env node

// How much does this runtime disagree with itself?
//
// 48 cards, five byte-identical requests each. Nothing varies: same
// instructions, same schema, same images, same model, same effort. Any spread
// here is the instrument's own noise, and it bounds what any experiment run on
// this harness can possibly detect.
//
// This exists because five paired experiments all returned NO_MECHANISM_SIGNAL
// with effects between -0.0095 and +0.0233, and the second-look run left an
// accidental control behind showing ~0.05 of pure resampling spread. If that
// holds, those five verdicts say nothing about the changes -- only about the
// measurement.
//
// The model cannot be pinned down: the shipped optimization pack records
// `sampling_parameters: "omit"` because Luna rejects temperature/top_p/seed.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGoldIndex, buildEquivalenceIndex, scoreCase
} from "../csm-typed-field-score.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSMDATA = "/Users/paidaxin/lynca-csmdata";

const tokens = (v) => String(v || "").toLowerCase().match(/[a-z0-9]+(?:[./-][a-z0-9]+)*/g) || [];
function f1(reference, candidate) {
  const expected = tokens(reference); const actual = tokens(candidate);
  const remaining = new Map();
  for (const t of expected) remaining.set(t, (remaining.get(t) || 0) + 1);
  let matches = 0;
  for (const t of actual) { const c = remaining.get(t) || 0; if (c > 0) { matches += 1; remaining.set(t, c - 1); } }
  const p = actual.length ? matches / actual.length : 0;
  const r = expected.length ? matches / expected.length : 0;
  return p + r ? 2 * p * r / (p + r) : 0;
}
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));

const gold = buildGoldIndex(JSON.parse(await readFile(`${CSMDATA}/golden/founder-golden-projection.json`, "utf8")));
const equivalence = buildEquivalenceIndex(
  JSON.parse(await readFile(`${CSMDATA}/policy/semantic-equivalence-decisions-v1.json`, "utf8")));
const rows = (await readFile(resolve(HERE, "results/raw-results.jsonl"), "utf8"))
  .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

const byCard = new Map();
for (const row of rows) {
  if (row.error) continue;
  if (!byCard.has(row.asset)) byCard.set(row.asset, []);
  byCard.get(row.asset).push(row);
}
const cards = [...byCard.keys()].filter((a) => byCard.get(a).length >= 5 && gold.has(a)).sort();

// ── instrument noise ────────────────────────────────────────────────────────
const perCardSd = []; const distinct = []; let fabricationVaried = 0; let stable = 0;
// ── field-level stability: which fields are the noise coming from? ──────────
const FIELDS = ["year", "manufacturer", "product", "subject", "card_number",
  "card_name", "print_finish", "numerical_rarity", "release_variant"];
const fieldFlips = Object.fromEntries(FIELDS.map((f) => [f, 0]));
// ── majority vote: does agreement across repeats beat a single sample? ──────
const singleF1 = []; const voteF1 = [];
let voteFabricated = 0; let singleFabricated = 0;

const norm = (v) => (Array.isArray(v) ? v.join("|") : String(v ?? "")).toLowerCase().trim();

for (const asset of cards) {
  const g = gold.get(asset);
  const reps = byCard.get(asset).slice(0, 5);
  const scores = reps.map((r) => f1(g.answer, r.title));
  perCardSd.push(sd(scores));
  const titles = new Set(reps.map((r) => r.title));
  distinct.push(titles.size);
  if (titles.size === 1) stable += 1;

  const fab = reps.map((r) => scoreCase({ gold: g, runtimeFields: r.fields || {}, equivalence, caseId: asset }).fabricated);
  if (new Set(fab).size > 1) fabricationVaried += 1;
  singleFabricated += fab[0] ? 1 : 0;

  for (const field of FIELDS) {
    const key = { subject: "subjects", numerical_rarity: "serial" }[field] || field;
    if (new Set(reps.map((r) => norm(r.fields?.[key]))).size > 1) fieldFlips[field] += 1;
  }

  // Majority vote per field: keep only what most repeats agree on. A value that
  // appears once in five is, by definition, not well-supported evidence.
  const voted = {};
  for (const key of Object.keys(reps[0].fields || {})) {
    const counts = new Map();
    for (const r of reps) {
      const v = norm(r.fields?.[key]);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n >= 3 && best !== "") {
      voted[key] = reps.find((r) => norm(r.fields?.[key]) === best).fields[key];
    }
  }
  singleF1.push(scores[0]);
  voteF1.push(mean(scores)); // per-card expected single-sample score
  if (scoreCase({ gold: g, runtimeFields: voted, equivalence, caseId: asset }).fabricated) voteFabricated += 1;
}

const n = cards.length;
const S = mean(perCardSd);
const repeatsFor = (effect) => Math.ceil(((2 * 1.96 * S) / effect) ** 2);

console.log(`cards with 5 clean repeats: ${n}\n`);
console.log("INSTRUMENT NOISE (nothing varied between repeats)");
console.log(`  mean per-card SD of F1:        ${S.toFixed(4)}`);
console.log(`  mean distinct titles per card: ${mean(distinct).toFixed(2)} of 5`);
console.log(`  identical all five times:      ${stable}/${n}  (${(100 * stable / n).toFixed(0)}%)`);
console.log(`  fabrication state varied:      ${fabricationVaried}/${n}  (${(100 * fabricationVaried / n).toFixed(0)}%)`);
console.log(`\nWHERE THE NOISE COMES FROM (cards whose field changed across repeats)`);
for (const f of FIELDS) {
  const pct = (100 * fieldFlips[f] / n).toFixed(0).padStart(3);
  console.log(`  ${f.padEnd(18)} ${String(fieldFlips[f]).padStart(2)}/${n}  ${pct}%  ${"#".repeat(Math.round(fieldFlips[f] / 2))}`);
}
console.log(`\nWHAT THIS COSTS`);
console.log(`  repeats per card to resolve +0.02: ~${repeatsFor(0.02)}`);
console.log(`  repeats per card to resolve +0.05: ~${repeatsFor(0.05)}`);
console.log(`\nMAJORITY VOTE (keep only fields >=3 of 5 repeats agree on)`);
console.log(`  fabricated cards, single sample:   ${singleFabricated}/${n}`);
console.log(`  fabricated cards, majority vote:   ${voteFabricated}/${n}`);
console.log(`\nGATE (2026-08-19 execution brief)`);
console.log(`  title-level delta>=0.02 p<=0.05 is not reachable with 1 sample (need ~${repeatsFor(0.02)})`);
console.log("  report accuracy only with fabrication; manufacturer/subject/release_variant may be single-sample");
console.log("  print_finish and product require repeats; do not ship prompt tweaks on a 50-card sign test");
