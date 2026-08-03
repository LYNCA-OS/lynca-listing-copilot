#!/usr/bin/env node
// Does hierarchy cost us anything under the CURRENT ruler?
//
// The intuition is that scoring "Refractor" against a card the writer called a
// "Gold Refractor" punishes a true generalisation. Under token overlap it may
// not: we earn the `refractor` token and lose `gold`, and losing `gold` is
// correct because we did not identify the colour. Partial credit may already be
// doing the work a hierarchy would.
//
// So this measures the opposite of the usual arm. Instead of changing output,
// it hands the scorer a hierarchy -- full credit whenever our finish is an
// ancestor of the writer's -- and asks what that is worth. If the answer is
// near zero, the hierarchy is not a gap in this ruler and belongs only to the
// claim-level one, where a generalisation is judged true or false with nothing
// in between.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const f1set = (w, g) => {
  const hits = [...w].filter((t) => g.has(t)).length;
  const r = w.size ? hits / w.size : 0; const p = g.size ? hits / g.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const FAMILIES = ["refractor", "prizm", "holo", "foil", "wave"];
const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => {
    const fields = parseCanonicalFields(r.raw_title).fields;
    return { ...r, fields, title: composeFromCanonicalFields(fields).title };
  });

const base = rows.map((r) => f1set(new Set(tok(r.reference)), new Set(tok(r.title))));
console.log(`n=${rows.length}  当前 F1=${mean(base).toFixed(6)}\n`);

// Ancestor credit: when we emit a family word the reference also carries, forgive
// the reference's qualifier that we did not produce.
let forgiven = 0;
const arm = rows.map((r) => {
  const want = new Set(tok(r.reference)); const got = new Set(tok(r.title));
  const fam = FAMILIES.filter((f) => want.has(f) && got.has(f));
  if (!fam.length) return f1set(want, got);
  // Words adjacent to the family in the reference that we did not emit are the
  // leaf qualifiers this generalisation covers.
  const refWords = tok(r.reference);
  const pruned = new Set(want);
  let cut = 0;
  for (const f of fam) {
    const i = refWords.indexOf(f);
    for (const j of [i - 1, i - 2]) {
      const w = refWords[j];
      if (w && !got.has(w) && !/^\d/.test(w)) { pruned.delete(w); cut++; }
    }
  }
  if (cut) forgiven++;
  return f1set(pruned, got);
});
const d = arm.map((v, i) => v - base[i]);
console.log(`给「上位概念」全额信用（宽恕未认出的限定词）`);
console.log(`  触发 ${forgiven} 张  F1=${mean(arm).toFixed(6)}  Δ=+${(mean(arm) - mean(base)).toFixed(6)}`);
console.log(`  受影响卡数 ${d.filter((x) => Math.abs(x) > 1e-12).length}`);
console.log(`\n对照：同义类归一化 Δ=+0.010985（同一批卡）`);
