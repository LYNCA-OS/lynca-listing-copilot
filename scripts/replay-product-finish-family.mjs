#!/usr/bin/env node
// Can the finish FAMILY be recovered from the product line?
//
// The headroom decomposition said 83% of the loss is tokens in no resolved
// field. Reading the biggest one -- `refractor`, missing on 30 cards -- showed
// something narrower than "we cannot see it": on all 30 the finish fields held
// SOMETHING. We resolved the colour and lost the family.
//
//   resolved  "Gold"          reference  "Gold Refractor"
//   resolved  "Orange"        reference  "Orange Refractor"
//   resolved  "Purple Wave"   reference  "Purple Raywave Refractor"
//
// The family word is a property of the PRODUCT LINE, not of the individual
// card: a Topps Chrome parallel is a Refractor, a Panini Prizm parallel is a
// Prizm. That is a table with a dozen rows, and it is exactly what COS-49 means
// by "verified Registry / product taxonomy confirms" -- the reopening the
// bare-colour rule names and that `taxonomyConfirmsColour` was built for.
//
// This measures it before anything is wired. Paired, same cards, same ruler,
// and applied ONLY where we already resolved a colour and no family: inventing
// a family where we saw no finish at all would be fabrication.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { scoreWithEquivalence } from "../lib/listing/evaluation/semantic-equivalence.mjs";

const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const lnFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const signTest = (w, l) => {
  const n = w + l; if (!n) return 1;
  let p = 0;
  for (let k = Math.max(w, l); k <= n; k++) p += Math.exp(lnFact(n) - lnFact(k) - lnFact(n - k) - n * Math.log(2));
  return Math.min(1, 2 * p);
};

// Product line -> the family word its parallels are called. Deliberately small
// and deliberately conservative: only lines where the market name is
// unambiguous. A line that is not here contributes nothing rather than a guess.
const PRODUCT_FINISH_FAMILY = Object.freeze([
  [/\bprizm\b/i, "Prizm"],
  [/\bchrome\b/i, "Refractor"],
  [/\bfinest\b/i, "Refractor"],
  [/\bmosaic\b/i, "Mosaic"],
  [/\boptic\b/i, "Holo"],
  [/\bselect\b/i, "Prizm"]
]);

function familyForProduct(fields) {
  const haystack = [fields.product, fields.set, fields.manufacturer].map((v) => String(v || "")).join(" ");
  for (const [pattern, family] of PRODUCT_FINISH_FAMILY) {
    if (pattern.test(haystack)) return family;
  }
  return "";
}

const COHORTS = [
  ["150 队列", "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["105 留出", "artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
];

for (const [label, path, arm] of COHORTS) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { console.log(`${label}: 原料缺失`); continue; }

  const before = [], after = [];
  let n = 0, touched = 0, agreed = 0, disagreed = 0;
  const examples = [];

  for (const row of rows) {
    if (row?.arm !== arm || !row?.fields || !row?.reference) continue;
    n += 1;
    const fields = row.fields;
    const reference = String(row.reference);
    const a = composeFromCanonicalFields(fields).title;

    const colour = String(fields.surface_color || "").trim();
    const family = String(fields.parallel_family || "").trim();
    const exact = String(fields.parallel_exact || "").trim();
    const candidate = familyForProduct(fields);

    // Only where a colour was resolved, no family was, nothing was printed on
    // the card, and the product line names a family. Everything else untouched.
    let patched = fields;
    if (colour && !family && !exact && candidate) {
      touched += 1;
      patched = { ...fields, parallel_family: candidate, print_finish: `${colour} ${candidate}` };
      if (new RegExp(`\\b${candidate}`, "i").test(reference)) agreed += 1; else disagreed += 1;
      if (examples.length < 6) {
        examples.push({ colour, candidate, reference: reference.slice(0, 78) });
      }
    }
    const b = composeFromCanonicalFields(patched).title;

    before.push(scoreWithEquivalence(a, reference).equivalent.f1);
    after.push(scoreWithEquivalence(b, reference).equivalent.f1);
  }
  if (!n) { console.log(`${label}: arm 未命中`); continue; }

  let wins = 0, losses = 0;
  for (let i = 0; i < before.length; i++) {
    if (after[i] > before[i] + 1e-9) wins += 1;
    else if (before[i] > after[i] + 1e-9) losses += 1;
  }
  const delta = mean(after) - mean(before);
  console.log(`\n══ ${label}  n=${n} ══`);
  console.log(`   触发的卡: ${touched} 张 (${(100 * touched / n).toFixed(1)}%)`);
  console.log(`   其中族名出现在参考里: ${agreed}  未出现: ${disagreed}  → 命中率 ${(100 * agreed / (touched || 1)).toFixed(1)}%`);
  console.log(`   现状=${mean(before).toFixed(6)}  补族名=${mean(after).toFixed(6)}  `
    + `Δ=${delta >= 0 ? "+" : ""}${delta.toFixed(6)}  ${wins}胜/${losses}负  p=${signTest(wins, losses).toFixed(4)}`);
  for (const e of examples) console.log(`     "${e.colour}" +"${e.candidate}"  ← ${e.reference}`);
}
