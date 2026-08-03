#!/usr/bin/env node
// Three admission rules for finish vocabulary, compared against an UNGATED
// baseline.
//
// A previous version of this comparison filtered on top of the shipped pipeline
// and reported a null result. It was null by construction: the shipped gate had
// already moved those words into withheld_finish_terms, so the arm was
// re-filtering an empty field. The baseline here restores the withheld terms
// first, so all three rules are measured against what the model actually
// proposed.
//
//   none       every finish term the model proposed
//   handpicked the six words I chose after reading the 150-card run
//   learned    words the 105 held-out writer titles never publish, requiring
//              N proposals before absence counts as evidence
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const f1 = (ref, title) => {
  const w = new Set(tok(ref)); const g = new Set(tok(title));
  const hits = [...w].filter((t) => g.has(t)).length;
  const r = w.size ? hits / w.size : 0; const p = g.size ? hits / g.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
// CSM's degradation order: exact if printed, else colour + family.
const ladder = (f) => {
  const exact = String(f.parallel_exact || "").trim();
  if (exact) return exact;
  const c = String(f.surface_color || "").trim();
  const fam = String(f.parallel_family || "").trim();
  if (!c) return fam;
  if (!fam || fam.toLowerCase().includes(c.toLowerCase())) return c;
  return `${c} ${fam}`;
};

const published = new Set(JSON.parse(readFileSync("/tmp/holdout_titles.json", "utf8")).flatMap((t) => tok(t)));

const rows = readFileSync("artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => {
    const fields = parseCanonicalFields(r.raw_title).fields;
    // Restore what the shipped gate withheld, to get the model's raw proposal.
    // Restoring the layer is not enough. The parser recomputes print_finish
    // from the SURVIVING layers after withholding, and the composer reads
    // print_finish -- so putting surface_color back while leaving the gated
    // print_finish in place produces a baseline that is still gated. An earlier
    // version of this script did exactly that and reported a null result.
    const restored = { ...fields };
    for (const t of fields.withheld_finish_terms || []) {
      if (!restored[t.layer]) restored[t.layer] = t.value;
    }
    restored.print_finish = ladder(restored);
    return { ...r, fields, restored };
  });

const proposalCount = new Map();
for (const row of rows) {
  for (const layer of ["surface_color", "parallel_family", "parallel_exact"]) {
    for (const w of tok(row.restored[layer])) proposalCount.set(w, (proposalCount.get(w) || 0) + 1);
  }
}
const learnedBlock = (min) => new Set([...proposalCount]
  .filter(([w, n]) => n >= min && !published.has(w)).map(([w]) => w));
const HANDPICKED = new Set(["rainbow", "silver", "foil", "prismatic", "sparkle", "cracked", "ice"]);

const apply = (fields, block) => {
  const flt = (v) => Array.isArray(v)
    ? v.filter((x) => tok(x).some((w) => !block.has(w)))
    : (tok(v).some((w) => !block.has(w)) ? v : "");
  const out = { ...fields,
    surface_color: flt(fields.surface_color),
    parallel_family: flt(fields.parallel_family),
    parallel_exact: flt(fields.parallel_exact) };
  out.print_finish = ladder(out);
  return composeFromCanonicalFields(out).title;
};

const base = rows.map((r) => f1(r.reference, composeFromCanonicalFields(r.restored).title));
console.log(`n=${rows.length}   无门基线 F1=${mean(base).toFixed(6)}\n`);
const report = (name, block) => {
  const a = rows.map((r) => f1(r.reference, apply(r.restored, block)));
  const d = a.map((v, i) => v - base[i]);
  console.log(`${name.padEnd(26)} 拦 ${String(block.size).padStart(2)} 词  F1=${mean(a).toFixed(6)}  Δ=${mean(a) - mean(base) >= 0 ? "+" : ""}${(mean(a) - mean(base)).toFixed(6)}  胜/负=${d.filter((x) => x > 1e-12).length}/${d.filter((x) => x < -1e-12).length}`);
};
report("手挑六词（现行上线）", HANDPICKED);
for (const min of [1, 2, 3, 5, 8]) report(`留出集学习 N>=${min}`, learnedBlock(min));
console.log(`\nN>=5 拦的词: ${[...learnedBlock(5)].join(", ")}`);
console.log(`手挑拦的词: ${[...HANDPICKED].join(", ")}`);
