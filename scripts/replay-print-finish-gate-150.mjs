#!/usr/bin/env node
// Gate print_finish by provenance layer, not by model confidence.
//
// Layer-conditioned token precision on 150 stored observations:
//   parallel_exact  0.750 (15 cards, 0 fully wrong)
//   family_only     1.000 (2 cards)
//   colour+family   0.313 (72 cards, 34 fully wrong)
//   colour_only     0.250 (44 cards, 33 fully wrong)
//
// The model's own low_confidence flag does NOT separate these (clean 0.316 vs
// flagged 0.286), so the usable signal is where the value came from: a name
// printed on the card versus a colour the model inferred.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tokens = (v) => new Set(String(v ?? "").normalize("NFD")
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

const clearFinish = (f) => ({ ...f, print_finish: "", parallel_exact: "", surface_color: "", parallel_family: "" });
const ARMS = {
  current: (f) => f,
  drop_all_finish: (f) => clearFinish(f),
  keep_exact_only: (f) => (String(f.parallel_exact || "").trim() ? f : clearFinish(f)),
  keep_exact_and_family: (f) => (String(f.parallel_exact || "").trim()
    || (!String(f.surface_color || "").trim() && String(f.parallel_family || "").trim()) ? f : clearFinish(f)),
  drop_colour_only: (f) => (String(f.parallel_exact || "").trim() || String(f.parallel_family || "").trim() ? f : clearFinish(f))
};

const base = rows.map((r) => score(r.reference, composeFromCanonicalFields(r.fields).title));
const baseF1 = mean(base.map((r) => r.f1));
console.log(`n=${rows.length}  基线 F1=${baseF1.toFixed(6)}\n`);
for (const [name, fn] of Object.entries(ARMS)) {
  const arm = rows.map((r) => score(r.reference, composeFromCanonicalFields(fn(r.fields)).title));
  const f1 = mean(arm.map((r) => r.f1));
  const d = arm.map((r, i) => r.f1 - base[i].f1);
  const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
  console.log(`${name.padEnd(24)} F1=${f1.toFixed(6)} R=${mean(arm.map((r) => r.recall)).toFixed(4)} P=${mean(arm.map((r) => r.precision)).toFixed(4)}  Δ=${f1 - baseF1 >= 0 ? "+" : ""}${(f1 - baseF1).toFixed(6)}  胜/负/平=${w}/${l}/${d.length - w - l}`);
}
