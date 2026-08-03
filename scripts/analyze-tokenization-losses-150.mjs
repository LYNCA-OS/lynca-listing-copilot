#!/usr/bin/env node
// How much of the loss is TOKENISATION rather than recognition?
//
// Three shapes seen in card_name, all on correct readings:
//   compound   we emit "Rain Drops", the writer writes "Raindrops"
//   plural     we emit "Relic",      the writer writes "Relics"
//   typo       the writer wrote "Advantge"; we are right and lose anyway
//
// The scorer is the production gate's and is not ours to change, so the only
// question worth asking is how many reference tokens we could recover by
// emitting the writer's form instead. This measures the ceiling of that class
// before anything is built.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const singular = (w) => (/(ss|us|is)$/.test(w) ? w : w.replace(/s$/, ""));
// Levenshtein <= 1, for the writer-typo case.
function near(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference);

const kinds = { compound_we_split: 0, compound_we_joined: 0, plural: 0, typo_near_miss: 0, unexplained: 0 };
const ex = {};
let missing = 0;
for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const emitted = tok(composeFromCanonicalFields(fields).title);
  const set = new Set(emitted);
  for (const word of new Set(tok(row.reference))) {
    if (set.has(word)) continue;
    missing++;
    // The writer joined two words we emitted separately.
    const joined = emitted.some((a, i) => i + 1 < emitted.length && a + emitted[i + 1] === word);
    // The writer split a word we emitted joined.
    const splitFrom = emitted.some((a) => a.startsWith(word) && a.length > word.length && set.size);
    const plural = emitted.some((a) => a !== word && singular(a) === singular(word));
    const typo = emitted.some((a) => a.length > 3 && near(a, word));
    const key = joined ? "compound_we_split" : splitFrom ? "compound_we_joined"
      : plural ? "plural" : typo ? "typo_near_miss" : "unexplained";
    kinds[key]++;
    if (key !== "unexplained") {
      (ex[key] = ex[key] || []).push(`${row.asset_id.slice(-8)} ref="${word}" 我们发出=[${emitted.filter((a) => near(a, word) || singular(a) === singular(word) || word.startsWith(a)).slice(0, 3)}]`);
    }
  }
}
console.log(`缺失 ${missing} 词次\n`);
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(22)} ${String(v).padStart(3)}  ${(v / missing * 100).toFixed(1)}%`);
}
const recoverable = missing - kinds.unexplained;
console.log(`\n分词类可回收上限：${recoverable} 词次（${(recoverable / missing * 100).toFixed(1)}%）`);
for (const [k, list] of Object.entries(ex)) {
  console.log(`\n--- ${k} ---`);
  for (const e of list.slice(0, 6)) console.log("  " + e);
}
