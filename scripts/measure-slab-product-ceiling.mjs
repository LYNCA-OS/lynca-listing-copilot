#!/usr/bin/env node
// What is reading the slab's product line actually worth?
//
// A PSA label opens with the product: "2025 BOWMAN DRAFT S/E". We took the
// third line ("CHROME PROSPECT AU-ORANGE") and returned Bowman Chrome. The
// question is whether fixing that pays for a paid run, so this measures the
// CEILING with an oracle -- hand us every product word the writer used, on
// graded cards only, and see where the score lands. Nothing below is
// shippable; it is the most the mechanism could ever return.
import { readFileSync } from "node:fs";
import { scoreWithEquivalence } from "../lib/listing/evaluation/semantic-equivalence.mjs";

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

// Product-line vocabulary: the words that name a product, not a player, a
// colour, a serial or a grade.
const PRODUCT_WORDS = new Set(["chrome", "bowman", "topps", "panini", "prizm", "donruss", "optic",
  "select", "obsidian", "mosaic", "revolution", "immaculate", "eminence", "contenders", "finest",
  "sapphire", "draft", "platinum", "update", "heritage", "cosmic", "mega", "stadium", "flawless",
  "metal", "leaf", "fleer", "ultra", "skybox", "luminaries", "tribute", "pristine", "triumphant",
  "wildchrome", "edition", "prospect", "prospects", "series", "deck", "upper"]);

const rows = readFileSync(process.argv[2] || "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === (process.argv[3] || "thin_canonical_high_pre_copyright") && r.reference && r.title);

const graded = (r) => /\b(psa|bgs|sgc|cgc|beckett)\b/i.test(r.reference);
const base = rows.map((r) => scoreWithEquivalence(r.reference, r.title).equivalent.f1);

// Oracle: append the product words the writer used and we did not.
const oracle = (r, only) => {
  if (only && !only(r)) return scoreWithEquivalence(r.reference, r.title).equivalent.f1;
  const have = new Set(tok(r.title));
  const add = [...new Set(tok(r.reference))].filter((w) => PRODUCT_WORDS.has(w) && !have.has(w));
  if (!add.length) return scoreWithEquivalence(r.reference, r.title).equivalent.f1;
  return scoreWithEquivalence(r.reference, `${r.title} ${add.join(" ")}`).equivalent.f1;
};

const report = (label, only) => {
  const arm = rows.map((r) => oracle(r, only));
  const affected = arm.filter((v, i) => Math.abs(v - base[i]) > 1e-12).length;
  console.log(`${label.padEnd(28)} F1=${mean(arm).toFixed(6)}  Δ=+${(mean(arm) - mean(base)).toFixed(6)}  影响 ${affected} 张`);
};
console.log(`n=${rows.length}   已评级 ${rows.filter(graded).length} 张   当前 F1=${mean(base).toFixed(6)}\n`);
console.log("oracle 上限（直接把参考的产品词补给我们）：");
report("  只修已评级卡", graded);
report("  已评级 + 裸卡全修", null);

// How much of the graded/raw gap the graded-only fix would close.
const g = rows.map((r, i) => ({ r, i })).filter((x) => graded(x.r));
const raw = rows.map((r, i) => ({ r, i })).filter((x) => !graded(x.r));
const gBase = mean(g.map((x) => base[x.i]));
const rBase = mean(raw.map((x) => base[x.i]));
const gOracle = mean(g.map((x) => oracle(x.r, graded)));
console.log(`\n已评级 ${gBase.toFixed(4)} -> ${gOracle.toFixed(4)}   裸卡 ${rBase.toFixed(4)}（不动）`);
console.log(`两者差距 ${(gBase - rBase).toFixed(4)} -> ${(gOracle - rBase).toFixed(4)}  （修已评级卡会拉大差距，不是缩小）`);
