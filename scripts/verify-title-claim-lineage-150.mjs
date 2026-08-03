#!/usr/bin/env node
// Does every title span trace to a canonical claim on the same card?
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { buildTitleClaims } from "../lib/listing/thin/title-claim-lineage.mjs";

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title);

const kinds = {}; const examples = {};
let cards = 0, claims = 0, clean = 0, repeated = 0;
for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const composed = composeFromCanonicalFields(fields);
  const result = buildTitleClaims(fields, composed);
  cards++; claims += result.claims.length;
  if (result.verified) clean++;
  // Cards where a word appears more than once -- the case indexOf would break.
  const words = composed.title.toLowerCase().split(/\s+/).filter(Boolean);
  if (new Set(words).size !== words.length) repeated++;
  for (const p of result.problems) {
    kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    (examples[p.kind] = examples[p.kind] || []).push(`${row.asset_id.slice(-8)} [${p.bracket}] "${p.text ?? p.expected}"`);
  }
}
console.log(`卡 ${cards}  claim ${claims}  完全干净的卡 ${clean}/${cards}`);
console.log(`标题内有重复词的卡 ${repeated}（indexOf 定位会在这些卡上归错）\n`);
if (!Object.keys(kinds).length) console.log("✓ 无任何问题");
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(32)} ${v}`);
  for (const e of examples[k].slice(0, 4)) console.log(`    ${e}`);
  if (examples[k].length > 4) console.log(`    …其余 ${examples[k].length - 4} 条`);
}
