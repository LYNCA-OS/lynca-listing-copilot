#!/usr/bin/env node
// Learn which finish terms writers actually publish, from writer titles we have
// never fitted anything on.
//
// The shipped admission gate blocks six terms I picked by hand after looking at
// the 150-card run. That is fitting on the test set with extra steps, and it
// generalises only as far as my guesses. The founder pointed out the obvious
// alternative: the confirmed library already contains the writers' own colour
// and parallel vocabulary, so the list should be read out of it.
//
// Split: 255 sealed labels, 150 used in the confirmatory run, 105 never touched.
// The decision boundary comes entirely from the 105. The 150 are only scored.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const set = (v) => new Set(tok(v));
const f1 = (ref, title) => {
  const w = set(ref); const g = set(title);
  const hits = [...w].filter((t) => g.has(t)).length;
  const r = w.size ? hits / w.size : 0; const p = g.size ? hits / g.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const holdout = JSON.parse(readFileSync(process.argv[3] || "/tmp/holdout_titles.json", "utf8"));
const published = new Set(holdout.flatMap((t) => tok(t)));

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields }));

// Every finish-layer value our model proposes, and whether the held-out writers
// ever published that word.
const proposals = new Map();
for (const row of rows) {
  for (const layer of ["surface_color", "parallel_family", "parallel_exact"]) {
    for (const w of tok(row.fields[layer])) {
      const rec = proposals.get(w) || { word: w, layer, proposed: 0, inHoldout: published.has(w) };
      rec.proposed++; proposals.set(w, rec);
    }
  }
  for (const t of row.fields.withheld_finish_terms || []) {
    for (const w of tok(t.value)) {
      const rec = proposals.get(w) || { word: w, layer: t.layer, proposed: 0, inHoldout: published.has(w) };
      rec.proposed++; rec.withheld = true; proposals.set(w, rec);
    }
  }
}
const never = [...proposals.values()].filter((p) => !p.inHoldout).sort((a, b) => b.proposed - a.proposed);
const ok = [...proposals.values()].filter((p) => p.inHoldout).sort((a, b) => b.proposed - a.proposed);
console.log(`我们提出过的工艺词 ${proposals.size} 个`);
console.log(`  105 张留出集里写手用过的: ${ok.length}`);
console.log(`  写手从未用过的:           ${never.length}`);
console.log(`\n写手从未发布过、而我们提得最多的（这才是该拦的）：`);
for (const p of never.slice(0, 14)) {
  console.log(`  ${p.word.padEnd(16)} 提出 ${String(p.proposed).padStart(3)} 次${p.withheld ? "  [现行词表已拦]" : ""}`);
}

// Arm: admit a finish word only if the held-out writers published it.
const BLOCK = new Set(never.map((p) => p.word));
const filterLayer = (v) => {
  if (Array.isArray(v)) return v.filter((x) => tok(x).some((w) => !BLOCK.has(w)));
  return tok(v).some((w) => !BLOCK.has(w)) ? v : "";
};
const base = rows.map((r) => f1(r.reference, composeFromCanonicalFields(r.fields).title));
const arm = rows.map((r) => f1(r.reference, composeFromCanonicalFields({
  ...r.fields,
  surface_color: filterLayer(r.fields.surface_color),
  parallel_family: filterLayer(r.fields.parallel_family),
  parallel_exact: filterLayer(r.fields.parallel_exact)
}).title));
const d = arm.map((v, i) => v - base[i]);
const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
console.log(`\n基线（含现行手挑词表） F1=${mean(base).toFixed(6)}`);
console.log(`留出集学到的词表       F1=${mean(arm).toFixed(6)}  Δ=${mean(arm) - mean(base) >= 0 ? "+" : ""}${(mean(arm) - mean(base)).toFixed(6)}  胜/负=${w}/${l}`);

// A term absent from 105 titles is not thereby a term writers reject. A
// parallel appearing on 1% of cards has a ~35% chance of showing up at all in
// that many, so absence is only evidence once we have proposed the word often
// enough for the silence to mean something. Xfractor and Mojo are real Topps
// and Panini parallel names that the unguarded rule would block on one or two
// sightings each.
console.log(`\n加频次门槛后（提出 N 次以上且留出集从未出现才拦）：`);
for (const min of [2, 3, 5, 8]) {
  const block = new Set(never.filter((p) => p.proposed >= min).map((p) => p.word));
  const flt = (v) => Array.isArray(v)
    ? v.filter((x) => tok(x).some((w) => !block.has(w)))
    : (tok(v).some((w) => !block.has(w)) ? v : "");
  const a = rows.map((r) => f1(r.reference, composeFromCanonicalFields({
    ...r.fields, surface_color: flt(r.fields.surface_color),
    parallel_family: flt(r.fields.parallel_family), parallel_exact: flt(r.fields.parallel_exact)
  }).title));
  const dd = a.map((v, i) => v - base[i]);
  console.log(`  N>=${min}: 拦 ${block.size} 个词 [${[...block].join(",")}]  F1=${mean(a).toFixed(6)}  Δ=${mean(a) - mean(base) >= 0 ? "+" : ""}${(mean(a) - mean(base)).toFixed(6)}  胜/负=${dd.filter((x) => x > 1e-12).length}/${dd.filter((x) => x < -1e-12).length}`);
}
