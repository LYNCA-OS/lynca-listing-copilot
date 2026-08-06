#!/usr/bin/env node
// The model reports the colour and drops the family.
//
// On 25 of 150 cards the reference says "Gold Refractor" and we emit "Gold";
// "Purple Raywave Refractor" and we emit "Purple | Wave". The finish layer is
// never empty in those cases -- parallel_family is being filled with the
// distinctive MODIFIER (Wave, Geometric) while the family word itself is
// dropped. That is a schema ambiguity, not a recognition failure: for "Purple
// Raywave Refractor" both Raywave and Refractor are defensible readings of
// "family", and the model picks the one the writer never keeps alone.
//
// The family is implied by the product -- a Chrome product's parallels are
// Refractors, a Prizm product's are Prizms -- so it can be restored
// deterministically and tested at zero cost before any prompt is bought.
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

// Which family a product's parallels belong to. Chrome stock throws
// refractions; Prizm stock is a prizm. These are the two the cohort contains.
const FAMILY_BY_PRODUCT = [
  [/\bchrome\b|\bfinest\b|\bsapphire\b/i, "Refractor"],
  [/\bprizm\b|\bselect\b|\bmosaic\b/i, "Prizm"]
];
const familyFor = (fields) => {
  const hay = [fields.product, fields.set, fields.manufacturer].filter(Boolean).join(" ");
  for (const [re, fam] of FAMILY_BY_PRODUCT) if (re.test(hay)) return fam;
  return "";
};

const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.raw_title && r.reference)
  .map((r) => ({ ...r, fields: parseCanonicalFields(r.raw_title).fields }));

const ladder = (f) => {
  const exact = String(f.parallel_exact || "").trim();
  if (exact) return exact;
  const c = String(f.surface_color || "").trim();
  const fam = String(f.parallel_family || "").trim();
  if (!c) return fam;
  if (!fam || fam.toLowerCase().includes(c.toLowerCase())) return c;
  return `${c} ${fam}`;
};

const base = rows.map((r) => f1(r.reference, composeFromCanonicalFields(r.fields).title));
console.log(`n=${rows.length}  基线 F1=${mean(base).toFixed(6)}\n`);

const arms = {
  // Append the product's family when the finish layer has content but no family word.
  append_when_missing: (f) => {
    const fam = familyFor(f);
    if (!fam) return f;
    const have = tok([f.surface_color, f.parallel_family, f.parallel_exact].filter(Boolean).join(" "));
    if (!have.length || have.includes(fam.toLowerCase())) return f;
    const out = { ...f, parallel_family: [String(f.parallel_family || "").trim(), fam].filter(Boolean).join(" ") };
    out.print_finish = ladder(out);
    return out;
  },
  // Same, but only when the model gave a colour -- the case actually observed.
  append_only_with_colour: (f) => {
    const fam = familyFor(f);
    if (!fam || !String(f.surface_color || "").trim()) return f;
    const have = tok([f.surface_color, f.parallel_family, f.parallel_exact].filter(Boolean).join(" "));
    if (have.includes(fam.toLowerCase())) return f;
    const out = { ...f, parallel_family: [String(f.parallel_family || "").trim(), fam].filter(Boolean).join(" ") };
    out.print_finish = ladder(out);
    return out;
  }
};

for (const [name, fn] of Object.entries(arms)) {
  let fired = 0;
  const arm = rows.map((r) => {
    const next = fn(r.fields);
    if (next !== r.fields) fired++;
    return f1(r.reference, composeFromCanonicalFields(next).title);
  });
  const d = arm.map((v, i) => v - base[i]);
  const w = d.filter((x) => x > 1e-12).length; const l = d.filter((x) => x < -1e-12).length;
  console.log(`${name.padEnd(24)} 触发 ${String(fired).padStart(3)} 张  F1=${mean(arm).toFixed(6)}  Δ=${mean(arm) - mean(base) >= 0 ? "+" : ""}${(mean(arm) - mean(base)).toFixed(6)}  胜/负=${w}/${l}  p=${signTest(w, l).toFixed(4)}`);
}
