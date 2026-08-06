#!/usr/bin/env node
// Product is a `*` bracket in COS-8, so naming it wrong is naming the wrong
// card. The founder spotted three in the deduction list: Topps Chrome Platinum
// reported as Topps Chrome, Bowman Sapphire and Bowman Draft both reported as
// Bowman Chrome.
//
// The first version of this script built its vocabulary from our product, set
// and manufacturer fields across the cohort, which pulled `rookie`, `gold` and
// `26` in from set names and reported them as missing product words. It also
// compared against the raw fields rather than the rendered title, so the
// category filler the composer strips came back as surplus. Both made the
// output unreadable.
//
// This measures something narrower and checkable instead: the QUALIFIERS that
// distinguish products inside one family. Bowman Sapphire, Bowman Draft and
// Bowman Chrome are three products, and dropping the qualifier does not make
// the answer vaguer -- it makes it a different card.
import { readFileSync } from "node:fs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Words that pick one product out of a family. Deliberately not colours,
// attributes or set names.
const QUALIFIERS = ["sapphire", "platinum", "draft", "update", "heritage", "cosmic",
  "mega", "finest", "chrome", "optic", "prizm", "select", "obsidian", "mosaic",
  "immaculate", "eminence", "contenders", "revolution", "luminaries", "tribute",
  "pristine", "triumphant", "stadium", "flawless", "metal", "wildchrome"];

const rows = readFileSync(process.argv[2] || "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === (process.argv[3] || "thin_canonical_high_pre_copyright") && r.reference && r.title);

const stat = {}; const cases = { 漏掉限定词: [], 多加限定词: [] };
for (const r of rows) {
  const ref = new Set(tok(r.reference)); const got = new Set(tok(r.title));
  for (const q of QUALIFIERS) {
    const inRef = ref.has(q); const inGot = got.has(q);
    if (!inRef && !inGot) continue;
    const s = (stat[q] = stat[q] || { ref: 0, got: 0, hit: 0, miss: 0, extra: 0 });
    if (inRef) s.ref++;
    if (inGot) s.got++;
    if (inRef && inGot) s.hit++;
    else if (inRef) { s.miss++; cases.漏掉限定词.push({ q, ref: r.reference.slice(0, 62), ours: r.title.slice(0, 58) }); }
    else { s.extra++; cases.多加限定词.push({ q, ref: r.reference.slice(0, 62), ours: r.title.slice(0, 58) }); }
  }
}
console.log("产品限定词".padEnd(14) + "写手用  我们发  命中   漏    多发");
const ranked = Object.entries(stat).sort((a, b) => (b[1].miss + b[1].extra) - (a[1].miss + a[1].extra));
for (const [q, s] of ranked) {
  if (!s.miss && !s.extra) continue;
  console.log(`${q.padEnd(14)} ${String(s.ref).padStart(4)} ${String(s.got).padStart(7)} ${String(s.hit).padStart(6)} ${String(s.miss).padStart(5)} ${String(s.extra).padStart(7)}`);
}
const miss = Object.values(stat).reduce((n, s) => n + s.miss, 0);
const extra = Object.values(stat).reduce((n, s) => n + s.extra, 0);
console.log(`\n合计：漏掉 ${miss} 次，多发 ${extra} 次\n`);
for (const [k, list] of Object.entries(cases)) {
  console.log(`--- ${k} 样例 ---`);
  for (const c of list.slice(0, 5)) console.log(`  [${c.q}] 写手: ${c.ref}\n           我们: ${c.ours}`);
}
