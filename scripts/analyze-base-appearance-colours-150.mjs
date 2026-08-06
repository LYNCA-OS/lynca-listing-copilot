#!/usr/bin/env node
// Is the model reporting the BASE appearance of a chrome product as if it were
// a parallel colour?
//
// A base Refractor is rainbow-sheened; a base Panini Prizm is silver. The model
// is asked for the surface colour and answers honestly -- but the writer names
// only the parallel, so "Rainbow Refractor" and "Silver Prizm" are our words,
// not the card's. This counts each colour's hit rate against the reference.
import { readFileSync } from "node:fs";
const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.fields && r.reference);

const colour = {}; const family = {};
for (const row of rows) {
  const f = row.fields;
  if (String(f.parallel_exact || "").trim()) continue;
  const ref = new Set(tok(row.reference));
  const c = String(f.surface_color || "").trim().toLowerCase();
  const fam = String(f.parallel_family || "").trim().toLowerCase();
  if (c) {
    colour[c] = colour[c] || { n: 0, hit: 0 };
    colour[c].n++; if (tok(c).every((t) => ref.has(t))) colour[c].hit++;
  }
  if (fam) {
    family[fam] = family[fam] || { n: 0, hit: 0 };
    family[fam].n++; if (tok(fam).every((t) => ref.has(t))) family[fam].hit++;
  }
}
const show = (label, map) => {
  console.log(`\n=== ${label} ===`);
  for (const [k, v] of Object.entries(map).sort((a, b) => b[1].n - a[1].n)) {
    if (v.n < 2) continue;
    const bar = v.hit / v.n >= 0.5 ? "  ✓" : (v.hit === 0 ? "  ✗ 全错" : "");
    console.log(`${k.padEnd(14)} ${String(v.n).padStart(3)} 次  命中 ${String(v.hit).padStart(2)}  ${(v.hit / v.n).toFixed(2)}${bar}`);
  }
};
show("surface_color 命中率（无 parallel_exact 时）", colour);
show("parallel_family 命中率", family);
