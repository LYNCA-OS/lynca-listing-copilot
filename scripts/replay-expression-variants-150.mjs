#!/usr/bin/env node
// Expression variants for tokens we already hold.
//
// `rookie` goes missing 16 times and `autograph` 6, and in nearly every case
// the slot is not empty -- we hold the fact and render it with the other name.
// We emit RC where the writer wrote Rookie, Auto or Signature where they wrote
// Autograph. That is not recognition; it is which synonym the composer picks,
// and it is settled by measurement rather than by preference.
//
// Each variant costs precision when the writer used only our form, so the sign
// test over paired cards decides, not the token count that motivated it.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const f1 = (ref, title) => {
  const w = new Set(tok(ref)); const g = new Set(tok(title));
  const hits = [...w].filter((t) => g.has(t)).length;
  const r = w.size ? hits / w.size : 0; const p = g.size ? hits / g.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const lnFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const signTest = (w, l) => {
  const n = w + l; if (!n) return 1;
  let p = 0;
  for (let k = Math.max(w, l); k <= n; k++) p += Math.exp(lnFact(n) - lnFact(k) - lnFact(n - k) - n * Math.log(2));
  return Math.min(1, 2 * p);
};

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields }));

const base = rows.map((r) => f1(r.reference, composeFromCanonicalFields(r.fields).title));
console.log(`n=${rows.length}  基线 F1=${mean(base).toFixed(6)}\n`);

const rewriteTitle = {
  "RC -> Rookie RC": (t) => t.replace(/\bRC\b/g, "Rookie RC"),
  "RC -> Rookie": (t) => t.replace(/\bRC\b/g, "Rookie"),
  "Auto -> Auto Autograph": (t) => t.replace(/\bAuto\b(?!graph)/g, "Auto Autograph"),
  "Signature -> Autograph": (t) => t.replace(/\bSignatures?\b/g, (m) => (m.endsWith("s") ? "Autographs" : "Autograph")),
  "两者合并 RC+Auto": (t) => t.replace(/\bRC\b/g, "Rookie RC").replace(/\bAuto\b(?!graph)/g, "Auto Autograph")
};

for (const [name, fn] of Object.entries(rewriteTitle)) {
  let fired = 0;
  const arm = rows.map((r) => {
    const t0 = composeFromCanonicalFields(r.fields).title;
    const t1 = fn(t0);
    if (t1 !== t0) fired++;
    return f1(r.reference, t1);
  });
  const d = arm.map((v, i) => v - base[i]);
  const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
  console.log(`${name.padEnd(24)} 触发 ${String(fired).padStart(3)} 张  Δ=${mean(arm) - mean(base) >= 0 ? "+" : ""}${(mean(arm) - mean(base)).toFixed(6)}  胜/负=${w}/${l}  p=${signTest(w, l).toFixed(4)}`);
}
