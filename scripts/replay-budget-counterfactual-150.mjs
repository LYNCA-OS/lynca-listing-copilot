#!/usr/bin/env node
// Is the 80-character budget, not recognition, the binding constraint?
//
// Un-suppressing search_optimization lowered RECALL (0.7435 -> 0.7327). Adding
// a bracket cannot remove tokens it did not own, so the loss came from the
// budget evicting something else. That makes the budget a live suspect, and
// the question worth answering is how much of the gap to 0.90 is "we never saw
// it" versus "we saw it and could not fit it".
//
// Two counterfactuals, both zero-cost on stored fields:
//   * unlimited budget   -- the ceiling if length were free
//   * SO at lowest drop priority -- keep the team only when there is room,
//     instead of a blanket suppression that never lets it compete
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { MARKETPLACE_PROFILES } from "../lib/listing/thin/marketplace-composer-rules.mjs";

const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((t) => got.has(t)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.fields && r.reference);

const ebay = MARKETPLACE_PROFILES.ebay;
const ARMS = {
  current: {},
  budget_120: { limit: 120 },
  budget_unlimited: { limit: 100000 },
  so_kept_unlimited: { limit: 100000, profile: { ...ebay, suppress: { ...ebay.suppress, search_optimization: [] } } }
};

const out = {};
for (const [name, opts] of Object.entries(ARMS)) {
  out[name] = rows.map((row) => {
    const composed = composeFromCanonicalFields(row.fields, opts);
    return { len: composed.title.length, ...score(row.reference, composed.title) };
  });
}
const base = mean(out.current.map((r) => r.f1));
console.log(`n=${rows.length}\n`);
for (const [name, arm] of Object.entries(out)) {
  const f1 = mean(arm.map((r) => r.f1));
  console.log(`${name.padEnd(20)} F1=${f1.toFixed(6)} R=${mean(arm.map((r) => r.recall)).toFixed(4)} P=${mean(arm.map((r) => r.precision)).toFixed(4)} 中位长度=${arm.map((r) => r.len).sort((a, b) => a - b)[Math.floor(arm.length / 2)]}  Δ=${(f1 - base).toFixed(6)}`);
}
