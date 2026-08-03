#!/usr/bin/env node
// How much of the measured loss is the ruler failing to know two words mean
// the same thing?
//
// Auto and Autograph are the same fact. The composer emits Auto because that
// is what writers overwhelmingly publish -- rendering both scored -0.009 with
// 7 wins to 47 losses, so the output is right. What remains is a metric that
// counts a correct answer as wrong whenever the writer happened to type the
// other form.
//
// An earlier version of this check reported zero effect. It normalised the
// REFERENCE on both sides of the comparison, so the baseline already held the
// benefit being measured. Both sides are normalised together here, or neither.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { compressAutograph } from "../lib/listing/thin/marketplace-composer-rules.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const f1 = (ref, title) => {
  const w = new Set(tok(ref)); const g = new Set(tok(title));
  const hits = [...w].filter((t) => g.has(t)).length;
  const r = w.size ? hits / w.size : 0; const p = g.size ? hits / g.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

// Synonym classes the writer and the composer both use, collapsed to one form
// on BOTH sides. This changes no output -- it only asks what the score would be
// if the metric knew what we know.
const CLASSES = [
  [/\b(?:autographs?|autographed|autos?)\b/gi, "auto"],
  [/\b(?:rookies?|rc)\b/gi, "rc"],
  [/\b(?:refractors?)\b/gi, "refractor"],
  [/\b(?:prizms?)\b/gi, "prizm"],
  [/\b(?:relics?|memorabilia)\b/gi, "relic"],
  [/\b(?:patches|patch)\b/gi, "patch"],
  [/\b(?:signatures?|sigs?)\b/gi, "auto"]
];
const normalize = (text) => CLASSES.reduce((s, [re, to]) => s.replace(re, to), String(text ?? ""));

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, title: composeFromCanonicalFields(parseCanonicalFields(r.raw_title).fields).title }));

const raw = rows.map((r) => f1(r.reference, r.title));
console.log(`n=${rows.length}\n当前尺子（逐字比对）        F1=${mean(raw).toFixed(6)}`);

// One class at a time, so the credit is attributable.
const only = (idx) => rows.map((r) => {
  const [re, to] = CLASSES[idx];
  return f1(String(r.reference).replace(re, to), String(r.title).replace(re, to));
});
const names = ["auto/autograph", "rookie/rc", "refractor 单复数", "prizm 单复数", "relic/memorabilia", "patch 单复数", "signature/auto"];
console.log(`\n逐个同义类，双边归一化后的增量：`);
for (let i = 0; i < CLASSES.length; i++) {
  const v = only(i);
  const d = mean(v) - mean(raw);
  const changed = v.filter((x, j) => Math.abs(x - raw[j]) > 1e-12).length;
  if (Math.abs(d) < 1e-9) continue;
  console.log(`  ${names[i].padEnd(20)} Δ=${d >= 0 ? "+" : ""}${d.toFixed(6)}  影响 ${changed} 张`);
}
const all = rows.map((r) => f1(normalize(r.reference), normalize(r.title)));
console.log(`\n全部同义类合并              F1=${mean(all).toFixed(6)}  Δ=+${(mean(all) - mean(raw)).toFixed(6)}`);
console.log(`\n这不改变任何输出。它衡量的是：如果尺子知道我们已经知道的事，分数会高多少。`);
