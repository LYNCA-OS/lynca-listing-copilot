#!/usr/bin/env node
// Where is serial actually losing? Two candidate buckets, sized against each
// other before either is worked on.
//
//   padding  5 cards -- we read the numbers right, formatted differently
//   missing 12 cards -- the reference has a serial and we emit nothing
//
// For the missing bucket the question that decides whether it is workable is
// whether the model SAID it could not read it. An honest `unreadable` is a
// recognition limit; silence is a reporting gap, and those need different fixes.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tokens = (v) => new Set(String(v ?? "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (ref, title) => {
  const w = tokens(ref); const g = tokens(title);
  const hits = [...w].filter((t) => g.has(t)).length;
  const recall = w.size ? hits / w.size : 0;
  const precision = g.size ? hits / g.size : 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const parts = (s) => { const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(s).trim()); return m ? [m[1], m[2]] : null; };
const pad = (s) => { const p = parts(s); if (!p) return s;
  return `${p[0].replace(/^0+(?=\d)/, "").padStart(p[1].length, "0")}/${p[1]}`; };


// A grade pair reads exactly like a print run. "PSA 9/10" is a card grade of 9
// with an autograph grade of 10, and counting it as a serial inflated the
// "reference has one, we emit nothing" bucket. Same class of mistake as an
// earlier `\blot\b` that could not match "lotx3": a regex that is right about
// shape and wrong about meaning.
const GRADERS = /(psa|bgs|sgc|cgc|beckett)$/i;
function refSerialTokens(reference) {
  const words = String(reference ?? "").split(/\s+/).filter(Boolean);
  return words.filter((word, index) => /^\d+\/\d+$/.test(word.toLowerCase())
    && !(index > 0 && GRADERS.test(words[index - 1])))
    .map((w) => w.toLowerCase());
}

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, parsed: parseCanonicalFields(r.raw_title).fields }));

const base = rows.map((r) => score(r.reference, composeFromCanonicalFields(r.parsed).title));
const padded = rows.map((r) => score(r.reference,
  composeFromCanonicalFields({ ...r.parsed, serial: pad(r.parsed.serial || "") }).title));
const d = padded.map((v, i) => v - base[i]);
const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
console.log(`A. 补零到分母位宽`);
console.log(`   ΔF1=${mean(padded) - mean(base) >= 0 ? "+" : ""}${(mean(padded) - mean(base)).toFixed(6)}  胜/负=${w}/${l}`);

// The missing bucket, split by whether the model admitted it could not read it.
let flagged = 0, silent = 0; const silentEx = [];
for (const row of rows) {
  const ours = String(row.parsed.serial || "").trim();
  const theirs = refSerialTokens(row.reference);
  if (ours || !theirs.length) continue;
  if ((row.parsed.unreadable || []).includes("serial")) flagged++;
  else { silent++; silentEx.push(`${row.asset_id.slice(-8)} ref=[${theirs}] "${row.reference.slice(0, 80)}"`); }
}
console.log(`\nB. 我们空 / 参考有：${flagged + silent} 张`);
console.log(`   模型标了 unreadable（诚实的识别极限）：${flagged}`);
console.log(`   模型沉默（既没读出也没说读不出）：${silent}`);
for (const e of silentEx.slice(0, 8)) console.log(`     ${e}`);
