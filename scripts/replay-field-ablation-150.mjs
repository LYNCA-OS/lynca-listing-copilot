#!/usr/bin/env node
// Per-field ablation: is each bracket we emit actually net-positive?
//
// The budget is not binding (median title 63c against an 80c limit) and every
// attempt to raise recall has cost more precision than it bought. That points
// at a selection frontier rather than a recognition ceiling -- so the question
// is which brackets pay for themselves and which are net-negative under the
// scorer we are actually judged by.
//
// One arm per field, each blanking exactly that field on stored observations
// and recomposing. Zero provider calls.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

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

const blank = (value) => (Array.isArray(value) ? [] : "");
// print_finish is three layers plus the ladder's output; blanking only the
// output would let the composer re-derive it from the layers.
const GROUPS = {
  print_finish: ["print_finish", "parallel_exact", "surface_color", "parallel_family"],
  card_name: ["card_name"], manufacturer: ["manufacturer"], product: ["product"],
  set: ["set"], year: ["year"], serial: ["serial"], card_number: ["card_number"],
  grade: ["grade"], descriptive_rarity: ["descriptive_rarity"],
  release_variant: ["release_variant"], components: ["components", "attributes"],
  subjects: ["subjects"], language: ["language"], ip: ["ip"]
};

const base = rows.map((r) => score(r.reference, composeFromCanonicalFields(r.fields).title));
const baseF1 = mean(base.map((r) => r.f1));
console.log(`n=${rows.length}  基线 F1=${baseF1.toFixed(6)}  R=${mean(base.map((r) => r.recall)).toFixed(4)}  P=${mean(base.map((r) => r.precision)).toFixed(4)}\n`);
console.log("去掉该字段后的变化（Δ>0 表示这个字段是净负资产）\n");
const out = [];
for (const [name, keys] of Object.entries(GROUPS)) {
  const arm = rows.map((row) => {
    const fields = { ...row.fields };
    for (const key of keys) if (key in fields) fields[key] = blank(fields[key]);
    return score(row.reference, composeFromCanonicalFields(fields).title);
  });
  const f1 = mean(arm.map((r) => r.f1));
  const deltas = arm.map((r, i) => r.f1 - base[i].f1);
  out.push({ name, d: f1 - baseF1,
    dr: mean(arm.map((r) => r.recall)) - mean(base.map((r) => r.recall)),
    dp: mean(arm.map((r) => r.precision)) - mean(base.map((r) => r.precision)),
    w: deltas.filter((x) => x > 1e-12).length, l: deltas.filter((x) => x < -1e-12).length });
}
for (const r of out.sort((a, b) => b.d - a.d)) {
  console.log(`${r.name.padEnd(20)} ΔF1=${r.d >= 0 ? "+" : ""}${r.d.toFixed(6)}  ΔR=${r.dr >= 0 ? "+" : ""}${r.dr.toFixed(4)}  ΔP=${r.dp >= 0 ? "+" : ""}${r.dp.toFixed(4)}  去掉后 胜/负=${r.w}/${r.l}`);
}
