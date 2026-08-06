#!/usr/bin/env node
// Zero-provider-cost re-test of the two eBay profile suppressions.
//
// Both were measured positive ONCE, on a much earlier configuration:
//   card_number         F1 0.7285 -> 0.7655
//   search_optimization F1 0.7602 -> 0.7879
//
// Since then the canonical schema, DROP_ORDER (COS-8/COS-9) and the composed
// output all changed, and the bare/canonical complementarity audit found 18
// word-occurrences of search_optimization that the reference writer DID want
// and our title does not carry. A suppression measured under one composition
// is not evidence about a different one, so this recomposes the SAME stored
// fields under four profiles and rescores. No provider calls.

import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { MARKETPLACE_PROFILES } from "../lib/listing/thin/marketplace-composer-rules.mjs";

const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / (values.length || 1);

const path = process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const rows = readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.fields && r.reference);

const original = MARKETPLACE_PROFILES.ebay.suppress;
const ARMS = {
  current: original,
  no_so_suppression: { ...original, search_optimization: [] },
  no_cardnum_suppression: { ...original, card_number: [] },
  neither: { card_number: [], search_optimization: [] }
};

// The module profile is frozen, and rightly so -- a replay that mutates the
// shipped policy would leave it mutated for whatever ran next. The composer
// takes a profile override, so each arm gets its own object.
const results = {};
for (const [name, suppress] of Object.entries(ARMS)) {
  const profile = { ...MARKETPLACE_PROFILES.ebay, suppress };
  results[name] = rows.map((row) => {
    const composed = composeFromCanonicalFields(row.fields, { profile });
    return { asset: row.asset_id, title: composed.title, over80: composed.title.length > 80,
      ...score(row.reference, composed.title) };
  });
}

const base = results.current;
console.log(`n=${rows.length}\n`);
for (const [name, arm] of Object.entries(results)) {
  const f1 = mean(arm.map((r) => r.f1));
  const line = `${name.padEnd(24)} F1=${f1.toFixed(6)} R=${mean(arm.map((r) => r.recall)).toFixed(4)} P=${mean(arm.map((r) => r.precision)).toFixed(4)} over80=${arm.filter((r) => r.over80).length}`;
  if (name === "current") { console.log(line); continue; }
  const deltas = arm.map((r, i) => r.f1 - base[i].f1);
  const wins = deltas.filter((d) => d > 1e-12).length;
  const losses = deltas.filter((d) => d < -1e-12).length;
  console.log(`${line}  Δ=${(f1 - mean(base.map((r) => r.f1))).toFixed(6)} W/L/T=${wins}/${losses}/${deltas.length - wins - losses}`);
}
