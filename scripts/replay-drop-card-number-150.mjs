#!/usr/bin/env node
// Writers almost never publish the checklist code. Across both cohorts, 255
// reference titles carry a `#` three times while we emit one eight times --
// and the cost is not the surplus token. It is the budget: on one card `#168`
// sits in a title that lost both `Disney` and `Sparkle`, two words the writer
// did keep.
//
// COS-8 already ranks Card Number tertiary and drops it first, so this asks a
// narrower question: whether it should be offered to the eBay profile at all.
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

for (const [label, path, arm] of [
  ["150 队列", "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["105 留出", "artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
]) {
  const rows = readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.arm === arm && r.reference && r.raw_title)
    .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields }));
  const base = rows.map((r) => scoreWithEquivalence(r.reference, composeFromCanonicalFields(r.fields).title).equivalent.f1);
  let fired = 0;
  const arm2 = rows.map((r) => {
    if (!String(r.fields.card_number || "").trim()) return scoreWithEquivalence(r.reference, composeFromCanonicalFields(r.fields).title).equivalent.f1;
    fired++;
    // The observation survives in the canonical object; only the eBay rendering
    // stops offering it, so identity resolution downstream is unaffected.
    return scoreWithEquivalence(r.reference, composeFromCanonicalFields({ ...r.fields, card_number: "" }).title).equivalent.f1;
  });
  const d = arm2.map((v, i) => v - base[i]);
  const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
  console.log(`${label}  n=${rows.length}  ${mean(base).toFixed(6)} → ${mean(arm2).toFixed(6)}  Δ=${mean(arm2) - mean(base) >= 0 ? "+" : ""}${(mean(arm2) - mean(base)).toFixed(6)}  ${w}胜${l}负  p=${signTest(w, l).toFixed(4)}  （${fired} 张持有卡号）`);
}
