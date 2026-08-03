#!/usr/bin/env node
// What ARE the tokens the model never observed?
//
// "83% of the loss was never observed" is true and useless as a direction. The
// attack depends entirely on what those words are: a product line the model has
// no way to know is a knowledge problem, small print on the card is an
// attention problem, and a parallel name is a judgement problem. Three
// different fixes, and only one of them is worth buying.
//
// Each missing token is attributed to the reference field it most plausibly
// belongs to, by checking which of OUR fields on OTHER cards ever carries that
// same word. A word we emit as `set` on some other card is set vocabulary here
// too, whatever this card's title happens to call it.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields }));

// Vocabulary we demonstrably know, learned from what we emit across the cohort.
const FIELDS = ["year", "manufacturer", "product", "set", "card_name", "subjects",
  "team", "card_number", "serial", "attributes", "release_variant",
  "surface_color", "parallel_family", "parallel_exact", "descriptive_rarity"];
const vocab = new Map();
for (const row of rows) {
  for (const f of FIELDS) {
    const v = row.fields[f];
    for (const w of tok(Array.isArray(v) ? v.join(" ") : v)) {
      if (!vocab.has(w)) vocab.set(w, new Set());
      vocab.get(w).add(f);
    }
  }
  for (const t of row.fields.withheld_finish_terms || []) {
    for (const w of tok(t.value)) {
      if (!vocab.has(w)) vocab.set(w, new Set());
      vocab.get(w).add("withheld_finish");
    }
  }
}

const bucket = {}; const examples = {};
let total = 0;
const GRADER = /^(psa|bgs|sgc|cgc|beckett|gem|mt|mint|auth)$/;
for (const row of rows) {
  const emitted = new Set(tok(composeFromCanonicalFields(row.fields).title));
  const everywhere = new Set();
  for (const f of FIELDS) {
    const v = row.fields[f];
    for (const w of tok(Array.isArray(v) ? v.join(" ") : v)) everywhere.add(w);
  }
  for (const t of row.fields.withheld_finish_terms || []) for (const w of tok(t.value)) everywhere.add(w);

  for (const w of new Set(tok(row.reference))) {
    if (emitted.has(w) || everywhere.has(w)) continue;   // observed somewhere
    total++;
    let key;
    if (/^\d+\/\d+$/.test(w)) key = "serial 编号";
    else if (GRADER.test(w)) key = "评级词";
    else if (/^\d+$/.test(w)) key = "纯数字（卡号/编号）";
    else if (vocab.has(w)) key = `已知词汇: ${[...vocab.get(w)].sort().join("/")}`;
    else key = "全新词（整批 150 张里我们从未发出过）";
    bucket[key] = (bucket[key] || 0) + 1;
    (examples[key] = examples[key] || []).push(w);
  }
}
console.log(`「从未观察到」的词次: ${total}\n`);
const rank = Object.entries(bucket).sort((a, b) => b[1] - a[1]);
for (const [k, n] of rank.slice(0, 12)) {
  const ex = [...new Set(examples[k])].slice(0, 6).join(", ");
  console.log(`${String(n).padStart(3)}  ${(n / total * 100).toFixed(0).padStart(2)}%  ${k}`);
  console.log(`            例: ${ex}`);
}
const known = rank.filter(([k]) => k.startsWith("已知词汇")).reduce((s, [, n]) => s + n, 0);
const fresh = bucket["全新词（整批 150 张里我们从未发出过）"] || 0;
console.log(`\n汇总：`);
console.log(`  属于我们已掌握的词汇类别（在别的卡上发出过）  ${known}  ${(known / total * 100).toFixed(0)}%`);
console.log(`  整批从未发出过的全新词                        ${fresh}  ${(fresh / total * 100).toFixed(0)}%`);
