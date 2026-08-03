#!/usr/bin/env node
// `Prizm` is Panini's name for the parallels of the Prizm product line, not a
// word for anything prismatic. The model uses it as a generic finish: on
// Donruss Optic where the writer wrote Lucky Hyper, on Mosaic where they wrote
// Choice, on Obsidian where they wrote nothing. Nine precision losses, all the
// same shape.
//
// The schema invites it. `parallel_family` offers Prizm in a flat enum with no
// statement that it belongs to one product family, so any prismatic surface can
// reach for it. Constraining the term to its own family is testable offline
// before any prompt is bought.
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

// Product families whose parallels are legitimately called Prizm.
const PRIZM_FAMILY = /\b(prizm|select|national treasures)\b/i;
const ladder = (f) => {
  const exact = String(f.parallel_exact || "").trim();
  if (exact) return exact;
  const c = String(f.surface_color || "").trim();
  const fam = String(f.parallel_family || "").trim();
  if (!c) return fam;
  if (!fam || fam.toLowerCase().includes(c.toLowerCase())) return c;
  return `${c} ${fam}`;
};

const rows = readFileSync(process.argv[2] || "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === (process.argv[3] || "thin_canonical_high_pre_copyright") && r.reference && r.raw_title)
  .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields }));

const base = rows.map((r) => f1(r.reference, composeFromCanonicalFields(r.fields).title));
console.log(`n=${rows.length}  基线 F1=${mean(base).toFixed(6)}\n`);

let fired = 0;
const arm = rows.map((r) => {
  const fam = String(r.fields.parallel_family || "").trim();
  const hay = [r.fields.product, r.fields.set, r.fields.manufacturer].filter(Boolean).join(" ");
  if (!/^prizm$/i.test(fam) || PRIZM_FAMILY.test(hay)) return f1(r.reference, composeFromCanonicalFields(r.fields).title);
  fired++;
  const out = { ...r.fields, parallel_family: "" };
  out.print_finish = ladder(out);
  return f1(r.reference, composeFromCanonicalFields(out).title);
});
const d = arm.map((v, i) => v - base[i]);
const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
console.log(`把 Prizm 限制在 Prizm 产品族内`);
console.log(`  触发 ${fired} 张  F1=${mean(arm).toFixed(6)}  Δ=${mean(arm) - mean(base) >= 0 ? "+" : ""}${(mean(arm) - mean(base)).toFixed(6)}  胜/负=${w}/${l}  p=${signTest(w, l).toFixed(4)}`);
