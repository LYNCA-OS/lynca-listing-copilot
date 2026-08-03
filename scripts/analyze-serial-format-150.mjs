#!/usr/bin/env node
// Two separable serial defects, measured before either is implemented.
//
// A. Zero-padding. Writers pad the numerator to the denominator's digit width
//    (027/150, 05/99, 08/25). The scorer keeps "/" inside a token, so a padding
//    difference costs a full token on BOTH precision and recall while the
//    reading is perfectly correct.
//
// B. Impossible values. A numerator larger than its denominator cannot be a
//    print run, and we emit some.
//
// The padding rule is only worth anything if it does not break the serials that
// already match, so it is applied to every card and checked against the exact
// matches too -- not just the five it was derived from.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";

const tok = (v) => String(v ?? "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const parts = (s) => { const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(s).trim()); return m ? [m[1], m[2]] : null; };
const padToDenominator = (s) => {
  const p = parts(s); if (!p) return s;
  const [num, den] = p;
  const bare = num.replace(/^0+(?=\d)/, "");
  return `${bare.padStart(den.length, "0")}/${den}`;
};

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference);

let gained = 0, broken = 0, unchangedOk = 0, impossible = 0, impossibleList = [];
let refPadded = 0, refUnpadded = 0;
for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const ours = String(fields.serial || "").trim();
  const refTokens = tok(row.reference).filter((t) => /^\d+\/\d+$/.test(t));
  const p = parts(ours);
  if (p && Number(p[0].replace(/^0+(?=\d)/, "")) > Number(p[1].replace(/^0+(?=\d)/, ""))) {
    impossible++; impossibleList.push(`${row.asset_id.slice(-8)} ${ours}`);
  }
  // What convention does the WRITER use, independent of us?
  for (const t of refTokens) {
    const tp = parts(t); if (!tp) continue;
    (tp[0].length === tp[1].length ? () => refPadded++ : () => refUnpadded++)();
  }
  if (!ours || !refTokens.length) continue;
  const before = refTokens.includes(ours);
  const after = refTokens.includes(padToDenominator(ours));
  if (!before && after) gained++;
  else if (before && !after) { broken++; console.log(`  破坏: ${ours} -> ${padToDenominator(ours)}  ref=[${refTokens}]`); }
  else if (before && after) unchangedOk++;
}
console.log(`\nA. 补零到分母位数`);
console.log(`   新命中 ${gained} 张，破坏 ${broken} 张，原本就对且仍对 ${unchangedOk} 张`);
console.log(`\n   写手自己的习惯：分子分母等位数 ${refPadded} 个 token，不等位数 ${refUnpadded} 个`);
console.log(`\nB. 分子 > 分母（不可能的印量）：${impossible} 张`);
for (const d of impossibleList) console.log(`   ${d}`);
