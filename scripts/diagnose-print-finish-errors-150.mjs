#!/usr/bin/env node
// WHY is colour+family wrong 69% of the time?
//
// "Improve it" is not a plan until the error is decomposed. A colour+family
// finish can fail four separable ways, and they need different fixes:
//   colour wrong        -- the model misread the surface
//   family wrong        -- the model misnamed the finish family
//   both individually attested but the reference names something else
//   the reference names no finish at all -- nothing was wrong, we volunteered
import { readFileSync } from "node:fs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const rows = readFileSync(process.argv[2]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === "thin_canonical_high" && r.fields && r.reference);

// Finish vocabulary, used ONLY to ask "does the reference name any finish at
// all" -- not to score. Drawn from the schema enums plus the parallel names
// seen in reference titles.
const COLOURS = ["gold","silver","blue","red","green","orange","purple","pink","black","white",
  "yellow","bronze","teal","aqua","violet","magenta","copper","rainbow"];
const FAMILIES = ["refractor","refractors","prizm","holo","holofoil","foil","xfractor","cracked",
  "ice","wave","shimmer","sparkle","speckle","mojo","pulsar","lava","disco","mosaic","optic",
  "chrome","sapphire","atomic","scope","hyper","laser","velocity","reactive","geometric","checker",
  "checkered","superfractor","autograph","parallel","die","cut","glitter","sheen","burst"];

const buckets = {}; const samples = {};
const note = (key, detail) => {
  buckets[key] = (buckets[key] || 0) + 1;
  (samples[key] = samples[key] || []).push(detail);
};

for (const row of rows) {
  const f = row.fields;
  const colour = String(f.surface_color || "").trim();
  const family = String(f.parallel_family || "").trim();
  if (String(f.parallel_exact || "").trim() || !colour || !family) continue;

  const ref = new Set(tok(row.reference));
  const colourHit = tok(colour).every((t) => ref.has(t));
  const familyHit = tok(family).every((t) => ref.has(t));
  const refHasColour = COLOURS.some((c) => ref.has(c));
  const refHasFamily = FAMILIES.some((c) => ref.has(c));
  const detail = `${row.asset_id.slice(-8)} 我们="${colour} ${family}" ref="${row.reference}"`;

  if (colourHit && familyHit) note("1_全对", detail);
  else if (!refHasColour && !refHasFamily) note("2_ref完全没提工艺（我们多说了）", detail);
  else if (colourHit && !familyHit) note(refHasFamily ? "3_颜色对家族错" : "4_颜色对但ref没家族", detail);
  else if (!colourHit && familyHit) note(refHasColour ? "5_家族对颜色错" : "6_家族对但ref没颜色", detail);
  else note(refHasColour || refHasFamily ? "7_两个都错(ref有工艺)" : "8_两个都错", detail);
}

const total = Object.values(buckets).reduce((a, b) => a + b, 0);
console.log(`colour+family 卡数 ${total}\n`);
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(30)} ${String(v).padStart(3)}  ${(v / total * 100).toFixed(0)}%`);
}
for (const [k, list] of Object.entries(samples).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n--- ${k} ---`);
  for (const d of list.slice(0, 6)) console.log("  " + d);
}
