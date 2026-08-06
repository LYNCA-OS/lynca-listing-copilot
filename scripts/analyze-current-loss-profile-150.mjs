#!/usr/bin/env node
// Where is the CURRENT pipeline losing, by earliest boundary?
//
// Grinding one field at a time found ~+0.002 in serial. Before spending more
// there, decompose every missing and every surplus token against the pipeline
// as it runs today, so the next target is chosen from the whole surface rather
// than from whichever field was most recently interesting.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { buildTitleClaims } from "../lib/listing/thin/title-claim-lineage.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference);

const missing = { never_observed: 0, in_canonical_not_in_title: 0 };
const missingByField = {}; const surplusByBracket = {};
const examples = {};
let missTotal = 0, surplusTotal = 0;

for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const composed = composeFromCanonicalFields(fields);
  const emitted = new Set(tok(composed.title));
  const want = tok(row.reference);

  // Everything the canonical object holds, as tokens, with the field it is in.
  const canonicalWords = new Map();
  for (const [field, value] of Object.entries(fields)) {
    if (["grammar", "unreadable", "low_confidence", "withheld_finish_terms"].includes(field)) continue;
    for (const word of tok(Array.isArray(value) ? value.join(" ") : value)) {
      if (!canonicalWords.has(word)) canonicalWords.set(word, field);
    }
  }

  for (const word of new Set(want)) {
    if (emitted.has(word)) continue;
    missTotal++;
    if (canonicalWords.has(word)) {
      missing.in_canonical_not_in_title++;
      const field = canonicalWords.get(word);
      missingByField[field] = (missingByField[field] || 0) + 1;
      (examples[`title:${field}`] = examples[`title:${field}`] || []).push(`${row.asset_id.slice(-8)} "${word}"`);
    } else {
      missing.never_observed++;
    }
  }

  // Surplus, attributed to the bracket that emitted it -- possible only because
  // spans are traceable.
  const claims = buildTitleClaims(fields, composed).claims;
  const wanted = new Set(want);
  for (const claim of claims) {
    for (const word of new Set(tok(claim.text))) {
      if (wanted.has(word)) continue;
      surplusTotal++;
      surplusByBracket[claim.bracket] = (surplusByBracket[claim.bracket] || 0) + 1;
    }
  }
}

console.log(`n=${rows.length}\n=== 缺失 ${missTotal} 词次 ===`);
console.log(`  从未观察到（识别缺口）      ${missing.never_observed}  ${(missing.never_observed / missTotal * 100).toFixed(0)}%`);
console.log(`  canonical 有但标题没发       ${missing.in_canonical_not_in_title}  ${(missing.in_canonical_not_in_title / missTotal * 100).toFixed(0)}%`);
console.log("\n  「有但没发」按字段：");
for (const [k, v] of Object.entries(missingByField).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${k.padEnd(22)} ${String(v).padStart(3)}   例: ${(examples[`title:${k}`] || []).slice(0, 3).map((e) => e.split(" ")[1]).join(" ")}`);
}
console.log(`\n=== 多发 ${surplusTotal} 词次（参考没有），按 bracket ===`);
for (const [k, v] of Object.entries(surplusByBracket).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(3)}  ${(v / surplusTotal * 100).toFixed(0)}%`);
}
