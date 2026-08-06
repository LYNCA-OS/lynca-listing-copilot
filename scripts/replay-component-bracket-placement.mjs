#!/usr/bin/env node
// COS-41 asks where [Visible Components] belongs, and the issue notes the two
// readings differ in outcome without saying by how much. This measures it.
//
//   A. after [Numerical Rarity]  -- keep-list items outranking the checklist
//      code, the year and the manufacturer. What feat/thin-path does, marked
//      in code as an inference rather than the contract.
//   B. folded into [Search Optimization] -- what resolvedFieldsToSemSuggestion
//      does. On eBay that bracket is suppressed before the budget is consulted,
//      so this reading removes Auto and RC from every eBay title.
//
// The contract decision is Fei's. This only supplies the number it is missing.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
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

for (const [label, path, arm] of COHORTS) {
  const rows = readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.arm === arm && r.reference && r.raw_title)
    .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields }));

  const a = rows.map((r) => scoreWithEquivalence(r.reference, composeFromCanonicalFields(r.fields).title).equivalent.f1);
  // Reading B: the components stop being their own bracket and join the team in
  // search_optimization, which the eBay profile suppresses.
  let held = 0;
  const b = rows.map((r) => {
    const comps = r.fields.components || [];
    if (!comps.length) return scoreWithEquivalence(r.reference, composeFromCanonicalFields(r.fields).title).equivalent.f1;
    held++;
    const moved = { ...r.fields, components: [], team: [r.fields.team, ...comps].filter(Boolean).join(" ") };
    return scoreWithEquivalence(r.reference, composeFromCanonicalFields(moved).title).equivalent.f1;
  });
  const d = b.map((v, i) => v - a[i]);
  const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
  console.log(`${label}  n=${rows.length}  持有组件 ${held} 张`);
  console.log(`  A 自有 bracket（现状）  F1=${mean(a).toFixed(6)}`);
  console.log(`  B 折入 search_optimization F1=${mean(b).toFixed(6)}  Δ=${mean(b) - mean(a) >= 0 ? "+" : ""}${(mean(b) - mean(a)).toFixed(6)}  ${w}胜${l}负  p=${signTest(w, l).toFixed(4)}\n`);
}
