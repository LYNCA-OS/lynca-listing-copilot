#!/usr/bin/env node
// The +0.121 gap between graded and raw cards has to live in specific fields.
// A slab label states year, product, set, subject, card number and grade; if
// those are exactly the fields that collapse on raw cards, then the raw card's
// equivalent source -- the copyright line on the back -- is what we are not
// reading, and that is a different problem from "the model cannot see".
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields,
    graded: /\b(psa|bgs|sgc|cgc|beckett)\b/i.test(r.reference) }));

// Per field: of the tokens this field contributes, how many are in the reference?
const FIELDS = ["year", "manufacturer", "product", "set", "card_name", "subjects",
  "card_number", "serial", "print_finish", "descriptive_rarity", "release_variant"];
const stat = {};
for (const row of rows) {
  const ref = new Set(tok(row.reference));
  for (const f of FIELDS) {
    const v = row.fields[f];
    const words = tok(Array.isArray(v) ? v.join(" ") : v);
    if (!words.length) continue;
    const key = `${f}|${row.graded ? "graded" : "raw"}`;
    stat[key] = stat[key] || { n: 0, words: 0, hits: 0 };
    stat[key].n++; stat[key].words += words.length;
    stat[key].hits += words.filter((w) => ref.has(w)).length;
  }
}
console.log("字段".padEnd(20) + "已评级(卡/词精度)".padEnd(22) + "裸卡(卡/词精度)".padEnd(20) + "差");
const out = [];
for (const f of FIELDS) {
  const g = stat[`${f}|graded`]; const r = stat[`${f}|raw`];
  if (!g || !r) continue;
  const gp = g.hits / g.words; const rp = r.hits / r.words;
  out.push({ f, gp, rp, d: gp - rp, gn: g.n, rn: r.n });
}
for (const o of out.sort((a, b) => b.d - a.d)) {
  console.log(o.f.padEnd(20)
    + `${o.gn} 张 ${o.gp.toFixed(3)}`.padEnd(22)
    + `${o.rn} 张 ${o.rp.toFixed(3)}`.padEnd(20)
    + `${o.d >= 0 ? "+" : ""}${o.d.toFixed(3)}`);
}
