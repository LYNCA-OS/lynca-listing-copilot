#!/usr/bin/env node
// Withhold finish terms that describe BASE APPEARANCE rather than name a parallel.
//
// Mechanism first, data second. A base Refractor is rainbow-sheened and a base
// Panini Prizm is silver, so when the schema demands a surface_color the model
// answers honestly and we print a word the card's variant is not called.
// Likewise "foil", "prismatic", "sparkle" describe how a surface looks; they
// are not names writers use for a parallel.
//
// The measured hit rates agree (rainbow 0/30, silver 1/11, foil 0/7,
// prismatic 0/7, sparkle 0/5, cracked ice 0/3), but a list fitted and scored on
// the same 150 cards proves nothing. So the block list is FIT on one half and
// SCORED on the other, both ways, and the held-out number is the one reported.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const tokens = (v) => new Set(tok(v));
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

// Fit: which finish terms never survive into a reference title?
function fitBlockList(sample, { minUses = 3, maxHitRate = 0.15 } = {}) {
  const stat = {};
  for (const row of sample) {
    const f = row.fields;
    if (String(f.parallel_exact || "").trim()) continue;
    const ref = new Set(tok(row.reference));
    for (const key of ["surface_color", "parallel_family"]) {
      const value = String(f[key] || "").trim().toLowerCase();
      if (!value) continue;
      const slot = (stat[`${key}:${value}`] = stat[`${key}:${value}`] || { n: 0, hit: 0 });
      slot.n++; if (tok(value).every((t) => ref.has(t))) slot.hit++;
    }
  }
  return new Set(Object.entries(stat)
    .filter(([, s]) => s.n >= minUses && s.hit / s.n <= maxHitRate)
    .map(([k]) => k));
}

const applyGate = (fields, block) => {
  if (String(fields.parallel_exact || "").trim()) return fields;
  const out = { ...fields };
  if (block.has(`surface_color:${String(out.surface_color || "").trim().toLowerCase()}`)) out.surface_color = "";
  if (block.has(`parallel_family:${String(out.parallel_family || "").trim().toLowerCase()}`)) out.parallel_family = "";
  // Re-derive the ladder from the surviving layers rather than trusting the
  // stored print_finish, which was computed before anything was withheld.
  const c = String(out.surface_color || "").trim(); const fam = String(out.parallel_family || "").trim();
  out.print_finish = !c ? fam : (!fam || fam.toLowerCase().includes(c.toLowerCase()) ? c : `${c} ${fam}`);
  return out;
};

const base = rows.map((r) => score(r.reference, composeFromCanonicalFields(r.fields).title));
console.log(`n=${rows.length}  基线 F1=${mean(base.map((r) => r.f1)).toFixed(6)}\n`);

// Split-half by a stable parity of position, fit on one side, score the other.
const halves = [rows.filter((_, i) => i % 2 === 0), rows.filter((_, i) => i % 2 === 1)];
let heldOutBase = []; let heldOutGate = []; const lists = [];
for (const [i, fitOn] of halves.entries()) {
  const testOn = halves[1 - i];
  const block = fitBlockList(fitOn);
  lists.push([...block].sort());
  for (const row of testOn) {
    heldOutBase.push(score(row.reference, composeFromCanonicalFields(row.fields).title));
    heldOutGate.push(score(row.reference, composeFromCanonicalFields(applyGate(row.fields, block)).title));
  }
}
const b = mean(heldOutBase.map((r) => r.f1)); const g = mean(heldOutGate.map((r) => r.f1));
const d = heldOutGate.map((r, i) => r.f1 - heldOutBase[i].f1);
const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
console.log("=== 留出验证（在另一半上拟合词表，本半评分）===");
console.log(`基线   F1=${b.toFixed(6)}  R=${mean(heldOutBase.map((r) => r.recall)).toFixed(4)}  P=${mean(heldOutBase.map((r) => r.precision)).toFixed(4)}`);
console.log(`词表门 F1=${g.toFixed(6)}  R=${mean(heldOutGate.map((r) => r.recall)).toFixed(4)}  P=${mean(heldOutGate.map((r) => r.precision)).toFixed(4)}`);
console.log(`Δ=${g - b >= 0 ? "+" : ""}${(g - b).toFixed(6)}  胜/负/平=${w}/${l}/${d.length - w - l}`);
console.log("\n两半各自拟合出的词表:");
for (const [i, list] of lists.entries()) console.log(`  半${i + 1}: ${list.join(", ")}`);

// The two fitted lists agree only on rainbow / foil / prismatic; purple, green,
// silver, holo and sparkle appear on one side and not the other, which is what
// fitting noise looks like at n<10. What ships should be the rule, not the fit:
// base-appearance terms of chrome products, and adjectives that describe how a
// surface looks rather than name a parallel.
const PRINCIPLED = new Set([
  // A base Refractor is rainbow-sheened; a base Panini Prizm is silver.
  "surface_color:rainbow", "surface_color:silver",
  // Appearance adjectives, not parallel names writers use.
  "parallel_family:foil", "parallel_family:prismatic",
  "parallel_family:sparkle", "parallel_family:cracked ice"
]);
const armP = rows.map((r) => score(r.reference, composeFromCanonicalFields(applyGate(r.fields, PRINCIPLED)).title));
const dp = armP.map((r, i) => r.f1 - base[i].f1);
const wp = dp.filter((x) => x > 1e-12).length; const lp = dp.filter((x) => x < -1e-12).length;
const fired = rows.filter((r) => composeFromCanonicalFields(applyGate(r.fields, PRINCIPLED)).title
  !== composeFromCanonicalFields(r.fields).title).length;
console.log("\n=== 按机制写死的词表（全 150 张）===");
console.log(`词表门 F1=${mean(armP.map((r) => r.f1)).toFixed(6)}  R=${mean(armP.map((r) => r.recall)).toFixed(4)}  P=${mean(armP.map((r) => r.precision)).toFixed(4)}`);
console.log(`Δ=${mean(armP.map((r) => r.f1)) - mean(base.map((r) => r.f1)) >= 0 ? "+" : ""}${(mean(armP.map((r) => r.f1)) - mean(base.map((r) => r.f1))).toFixed(6)}  胜/负/平=${wp}/${lp}/${dp.length - wp - lp}  改动了 ${fired} 张`);
for (const [i, row] of rows.entries()) {
  if (dp[i] < -1e-12) console.log(`  负: ${row.asset_id.slice(-8)} "${composeFromCanonicalFields(row.fields).title}" -> "${composeFromCanonicalFields(applyGate(row.fields, PRINCIPLED)).title}"`);
}

// Every loss above is the same shape: blocking a base-appearance FAMILY also
// removed a real parallel COLOUR, because the composer withholds a bare colour
// as ungrounded. That rule was measured when rainbow and silver were still in
// the bare-colour population -- 41 of 114 uses contributing one hit. With those
// withheld the population is different, so the rule is worth re-testing rather
// than inherited.
const surviveBare = (fields, block) => {
  const gated = applyGate(fields, block);
  if (!gated.parallel_family && gated.surface_color) {
    // Promote to parallel_exact: the layer the composer renders verbatim. The
    // colour is the whole finish we are willing to claim, not a fragment of a
    // ladder we no longer have the family for.
    return { ...gated, parallel_exact: gated.surface_color, print_finish: gated.surface_color };
  }
  return gated;
};
const armB = rows.map((r) => score(r.reference, composeFromCanonicalFields(surviveBare(r.fields, PRINCIPLED)).title));
const db = armB.map((r, i) => r.f1 - base[i].f1);
const wb = db.filter((x) => x > 1e-12).length; const lb = db.filter((x) => x < -1e-12).length;
console.log("\n=== 词表门 + 幸存的裸颜色仍然投影 ===");
console.log(`F1=${mean(armB.map((r) => r.f1)).toFixed(6)}  R=${mean(armB.map((r) => r.recall)).toFixed(4)}  P=${mean(armB.map((r) => r.precision)).toFixed(4)}  Δ=+${(mean(armB.map((r) => r.f1)) - mean(base.map((r) => r.f1))).toFixed(6)}  胜/负/平=${wb}/${lb}/${db.length - wb - lb}`);
