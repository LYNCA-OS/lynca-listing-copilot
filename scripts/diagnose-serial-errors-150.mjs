#!/usr/bin/env node
// serial is now the weakest bracket (-0.0098, 25 wins / 45 losses on removal)
// and it is a critical-error field, so a wrong one costs more than the metric
// shows. Decompose HOW it is wrong before proposing anything.
//
// The scorer keeps "/" inside a token, so "05/50" and "5/50" are DIFFERENT
// tokens -- a zero-padding difference costs a full token on both precision and
// recall while the reading is perfectly correct. That is separable from a
// genuine misread and needs a different fix, so it is counted separately.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);

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
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference);

const strip = (s) => s.replace(/^0+(?=\d)/, "");
const parts = (s) => { const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(s).trim()); return m ? [m[1], m[2]] : null; };
// Any x/y in the reference is a candidate serial; the writer's own token is truth.
const refSerials = (ref) => refSerialTokens(ref);

const b = {}; const ex = {};
const note = (k, d) => { b[k] = (b[k] || 0) + 1; (ex[k] = ex[k] || []).push(d); };
let haveSerial = 0;

for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const ours = String(fields.serial || "").trim();
  const theirs = refSerials(row.reference);
  const unreadable = (fields.unreadable || []).includes("serial");
  const detail = `${row.asset_id.slice(-8)} 我们="${ours || "(空)"}" ref=[${theirs.join(",")}] "${row.reference}"`;

  if (!ours && !theirs.length) continue;
  if (!ours) { note(theirs.length ? "1_我们空_ref有" : "x", detail); continue; }
  haveSerial++;
  if (!theirs.length) { note(unreadable ? "2_我们有_ref无(已标unreadable)" : "3_我们有_ref无(未标记)", detail); continue; }
  if (theirs.includes(ours)) { note("4_完全一致", detail); continue; }
  // Same numbers, different zero padding -- a tokenisation loss, not a misread.
  const op = parts(ours);
  const padOnly = op && theirs.some((t) => { const tp = parts(t);
    return tp && strip(tp[0]) === strip(op[0]) && strip(tp[1]) === strip(op[1]); });
  if (padOnly) { note("5_数字对_补零不同", detail); continue; }
  const denomOnly = op && theirs.some((t) => { const tp = parts(t); return tp && strip(tp[1]) === strip(op[1]); });
  const numerOnly = op && theirs.some((t) => { const tp = parts(t); return tp && strip(tp[0]) === strip(op[0]); });
  note(denomOnly ? "6_分母对_分子错" : numerOnly ? "7_分子对_分母错" : "8_两个都错", detail);
}

const total = Object.values(b).reduce((a, c) => a + c, 0);
console.log(`有 serial 的卡 ${haveSerial}/${rows.length}，涉及 serial 的卡 ${total}\n`);
for (const [k, v] of Object.entries(b).sort((a, c) => c[1] - a[1])) {
  console.log(`${k.padEnd(30)} ${String(v).padStart(3)}  ${(v / total * 100).toFixed(0)}%`);
}
for (const [k, list] of Object.entries(ex).sort((a, c) => c[1].length - a[1].length)) {
  if (k === "4_完全一致" || k === "x") continue;
  console.log(`\n--- ${k} ---`);
  for (const d of list.slice(0, 5)) console.log("  " + d.slice(0, 150));
}
