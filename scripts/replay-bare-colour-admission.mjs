#!/usr/bin/env node
// COS-49 (Fei, 2026-08-04): "A bare colour remains Recognition evidence. It
// becomes canonical Print Finish only when the current card explicitly names it
// or verified Registry / product taxonomy confirms the colour alone as a
// market-recognized finish."
//
// Today's ladder in `printFinishSuggestion` is:
//
//   parallel_exact  ->  colour + family  ->  COLOUR ALONE  ->  family alone
//
// The third rung is the one the decision removes. The first two are unaffected:
// a name printed on the card is explicit, and "Red Refractor" is not a bare
// colour. Only a lone "Red" with no family is withheld.
//
// This measures the cost, because the colour rung was added on evidence -- 27
// of the 68 cards whose reviewed title carries a colour had no colour anywhere
// in our fields against 9 where we named the wrong one. A decision that costs
// accuracy is still the decision; COS-49 says evidence may open a Decision
// Proposal but never silently override Linear. So: implement, measure, report.
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

const COHORTS = [
  ["150 队列", "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["105 留出", "artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// A bare colour is a resolved print_finish that came from `surface_color` with
// no `parallel_family` and no `parallel_exact`. Reconstructing the condition
// rather than string-matching the rendered finish: "Red" could equally be a
// parallel_exact the card really prints, and those must not be touched.
function bareColourOnly(fields) {
  if (clean(fields.parallel_exact)) return false;
  if (clean(fields.parallel_family)) return false;
  const colour = clean(fields.surface_color);
  if (!colour) return false;
  return clean(fields.print_finish).toLowerCase() === colour.toLowerCase();
}

for (const [label, path, arm] of COHORTS) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    console.log(`${label}: 原料缺失 (${path})`);
    continue;
  }

  const pairs = [];
  let armRows = 0;
  let touched = 0;
  for (const row of rows) {
    if (row?.arm !== arm) continue;
    armRows += 1;
    const reference = clean(row?.reference);
    if (!reference || !row?.fields) continue;
    if (!bareColourOnly(row.fields)) continue;
    touched += 1;

    let keep;
    let withhold;
    try {
      keep = composeFromCanonicalFields(row.fields);
      withhold = composeFromCanonicalFields({ ...row.fields, print_finish: "" });
    } catch { continue; }

    pairs.push({
      keep: scoreWithEquivalence(keep.title, reference),
      withhold: scoreWithEquivalence(withhold.title, reference),
      colour: clean(row.fields.surface_color),
      keep_title: keep.title,
      withhold_title: withhold.title,
      reference
    });
  }

  console.log(`\n${label}: arm=${arm} 命中 ${armRows} 行，裸色卡 ${touched} 张`);
  if (!pairs.length) { console.log(`${label}: 此规则在该队列上无接触面`); continue; }

  for (const scale of ["raw", "equivalent"]) {
    const keep = pairs.map((p) => p.keep[scale].f1);
    const withhold = pairs.map((p) => p.withhold[scale].f1);
    let wins = 0, losses = 0;
    for (let i = 0; i < keep.length; i++) {
      if (withhold[i] > keep[i] + 1e-9) wins += 1;
      else if (keep[i] > withhold[i] + 1e-9) losses += 1;
    }
    const delta = mean(withhold) - mean(keep);
    console.log(
      `${label} [${scale}] n=${pairs.length}  `
      + `扣留=${mean(withhold).toFixed(6)}  保留=${mean(keep).toFixed(6)}  `
      + `Δ=${delta >= 0 ? "+" : ""}${delta.toFixed(6)}  `
      + `扣留${wins}胜/${losses}负  p=${signTest(wins, losses).toFixed(4)}  `
      + `全队列稀释后 Δ=${delta >= 0 ? "+" : ""}${(delta * pairs.length / armRows).toFixed(6)}`
    );
  }

  // Which way each card went, so the aggregate is inspectable rather than
  // trusted. A colour the writer also used is a loss; one they never wrote is
  // a win for withholding.
  const helped = pairs.filter((p) => p.withhold.raw.f1 > p.keep.raw.f1 + 1e-9);
  const hurt = pairs.filter((p) => p.keep.raw.f1 > p.withhold.raw.f1 + 1e-9);
  console.log(`  扣留更好 ${helped.length} 张，保留更好 ${hurt.length} 张，无差别 ${pairs.length - helped.length - hurt.length} 张`);
  for (const p of hurt.slice(0, 3)) {
    console.log(`  [保留更好] 裸色 "${p.colour}" 出现在参考里`);
    console.log(`    参考: ${p.reference}`);
  }
  for (const p of helped.slice(0, 3)) {
    console.log(`  [扣留更好] 裸色 "${p.colour}" 参考里没有`);
    console.log(`    参考: ${p.reference}`);
  }
}
