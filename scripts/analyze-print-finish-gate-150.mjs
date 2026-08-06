#!/usr/bin/env node
// print_finish is a coin flip (ablation: +0.0023 to delete, 36 wins / 35
// losses). A field that is 50% right is not a seeing problem -- it is a gating
// problem, and the gate only exists if correctness separates by provenance.
//
// This asks whether the three layers we already store predict correctness:
//   parallel_exact  -- the name was printed on the card
//   colour + family -- two independent observations agreeing
//   bare colour     -- currently withheld from the title
import { readFileSync } from "node:fs";

const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.fields && r.reference);

const layerOf = (f) => {
  if (String(f.parallel_exact || "").trim()) return "parallel_exact";
  const c = String(f.surface_color || "").trim(); const fam = String(f.parallel_family || "").trim();
  if (c && fam) return "colour+family";
  if (fam) return "family_only";
  if (c) return "colour_only";
  return "none";
};

const stats = {};
for (const row of rows) {
  const f = row.fields;
  const layer = layerOf(f);
  const value = String(f.print_finish || "").trim();
  if (!value) continue;
  const ref = tokens(row.reference);
  const emitted = [...tokens(value)];
  const hit = emitted.filter((t) => ref.has(t)).length;
  const flagged = (f.low_confidence || []).some((n) =>
    ["print_finish", "surface_color", "parallel_family", "parallel_exact"].includes(n));
  for (const key of [layer, `${layer}${flagged ? " [flagged]" : " [clean]"}`]) {
    stats[key] = stats[key] || { cards: 0, tokens: 0, hits: 0, allHit: 0, noneHit: 0 };
    const s = stats[key];
    s.cards++; s.tokens += emitted.length; s.hits += hit;
    if (hit === emitted.length) s.allHit++;
    if (hit === 0) s.noneHit++;
  }
}
console.log(`有 print_finish 的卡：${Object.values(stats).length ? "" : ""}${rows.filter((r) => String(r.fields.print_finish || "").trim()).length}/${rows.length}\n`);
console.log("层".padEnd(26) + "卡数  词次  命中  词精度   全中   全错");
for (const [key, s] of Object.entries(stats).sort((a, b) => b[1].cards - a[1].cards)) {
  console.log(`${key.padEnd(26)}${String(s.cards).padStart(4)}${String(s.tokens).padStart(6)}${String(s.hits).padStart(6)}   ${(s.hits / s.tokens).toFixed(3)}   ${String(s.allHit).padStart(4)}   ${String(s.noneHit).padStart(4)}`);
}
