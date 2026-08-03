#!/usr/bin/env node
// Per-field ablation against the CURRENT parser, re-parsing raw responses.
//
// The earlier ablation read pre-parsed `fields` from the checkpoint, which were
// parsed before the finish admission layer existed. Picking the next target
// from those numbers would be choosing against a pipeline that no longer runs.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tokens = (v) => new Set(String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (ref, title) => {
  const w = tokens(ref); const g = tokens(title);
  const hits = [...w].filter((t) => g.has(t)).length;
  const recall = w.size ? hits / w.size : 0;
  const precision = g.size ? hits / g.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, parsed: parseCanonicalFields(r.raw_title).fields }));

const blank = (v) => (Array.isArray(v) ? [] : "");
const GROUPS = {
  print_finish: ["print_finish", "parallel_exact", "surface_color", "parallel_family"],
  card_name: ["card_name"], manufacturer: ["manufacturer"], product: ["product"],
  set: ["set"], year: ["year"], serial: ["serial"], card_number: ["card_number"],
  grade: ["grade"], descriptive_rarity: ["descriptive_rarity"],
  release_variant: ["release_variant"], components: ["components", "attributes"],
  subjects: ["subjects"], language: ["language"], ip: ["ip"], team: ["team"]
};

const base = rows.map((r) => score(r.reference, composeFromCanonicalFields(r.parsed).title));
const baseF1 = mean(base.map((r) => r.f1));
console.log(`n=${rows.length}  当前基线 F1=${baseF1.toFixed(6)}  R=${mean(base.map((r) => r.recall)).toFixed(4)}  P=${mean(base.map((r) => r.precision)).toFixed(4)}\n`);
console.log("去掉该字段后（Δ>0 = 净负资产）\n");
const out = [];
for (const [name, keys] of Object.entries(GROUPS)) {
  const arm = rows.map((row) => {
    const f = { ...row.parsed };
    for (const k of keys) if (k in f) f[k] = blank(f[k]);
    return score(row.reference, composeFromCanonicalFields(f).title);
  });
  const d = arm.map((r, i) => r.f1 - base[i].f1);
  out.push({ name, d: mean(arm.map((r) => r.f1)) - baseF1,
    w: d.filter((x) => x > 1e-12).length, l: d.filter((x) => x < -1e-12).length });
}
for (const r of out.sort((a, b) => b.d - a.d)) {
  console.log(`${r.name.padEnd(20)} ΔF1=${r.d >= 0 ? "+" : ""}${r.d.toFixed(6)}  去掉后 胜/负=${r.w}/${r.l}`);
}
