#!/usr/bin/env node
// A parallel names two things at once, and we are not asking for both.
//
// "Gold Refractor" is a colour and a treatment. Saying Gold identifies the
// card; saying Refractor identifies the card; the writer's phrase happens to
// carry both. The current bar demands the full phrase, which is a harder
// question than the product needs answered right now.
//
// The rule measured here is deliberately one-sided. A NON-EMPTY SUBSET of the
// writer's finish phrase is satisfied -- so Gold against "Gold Refractor"
// counts, and so does Refractor. A term the writer does not have is still
// wrong: Green against "Gold Refractor" stays a precision loss, because that
// is a misreading rather than a coarser reading. Forgiving that too would make
// the metric unable to see the difference.
import { readFileSync } from "node:fs";

const FINISH_VOCAB = new Set(["refractor", "refractors", "prizm", "prizms", "holo", "foil", "sapphire",
  "mojo", "wave", "raywave", "xfractor", "shimmer", "sparkle", "sparkles", "pulsar", "geometric", "hyper",
  "shock", "velocity", "disco", "scope", "marble", "cracked", "ice", "prismatic", "lucky", "speckle",
  "reptilian", "crystallized", "mosaic", "pixel", "burst", "rainbow", "gold", "silver", "red", "blue",
  "green", "orange", "purple", "pink", "black", "yellow", "teal", "bronze", "platinum", "emerald",
  "white", "aqua", "violet", "magenta", "copper"]);

const tok = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean);
const f1 = (want, got) => {
  const hits = [...want].filter((t) => got.has(t)).length;
  const r = want.size ? hits / want.size : 0; const p = got.size ? hits / got.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const rows = readFileSync(process.argv[2] || "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.arm === (process.argv[3] || "thin_canonical_high_pre_copyright") && r.reference);

const base = rows.map((r) => f1(new Set(tok(r.reference)), new Set(tok(r.title || ""))));
console.log(`n=${rows.length}  当前 F1=${mean(base).toFixed(6)}\n`);

let satisfied = 0, empty = 0, wrong = 0;
const arm = rows.map((r) => {
  const want = new Set(tok(r.reference)); const got = new Set(tok(r.title || ""));
  const wantFinish = [...want].filter((t) => FINISH_VOCAB.has(t));
  const gotFinish = [...got].filter((t) => FINISH_VOCAB.has(t));
  if (!wantFinish.length) return f1(want, got);
  const overlap = gotFinish.filter((t) => want.has(t));
  const invented = gotFinish.filter((t) => !want.has(t));
  if (!overlap.length) { if (!gotFinish.length) empty++; else wrong++; return f1(want, got); }
  // A non-empty subset satisfies the finish. Drop the writer's remaining finish
  // words from what we are asked for; anything we invented stays chargeable.
  satisfied++;
  const pruned = new Set([...want].filter((t) => !(FINISH_VOCAB.has(t) && !got.has(t))));
  return f1(pruned, got);
});
const d = arm.map((v, i) => v - base[i]);
console.log(`参考含工艺词的卡里：`);
console.log(`  我们发出其中至少一个（判为满足）  ${satisfied}`);
console.log(`  我们发出了别的工艺词（仍算错）    ${wrong}`);
console.log(`  我们工艺层全空（仍算错）          ${empty}`);
console.log(`\n部分工艺信用  F1=${mean(arm).toFixed(6)}  Δ=+${(mean(arm) - mean(base)).toFixed(6)}  受影响 ${d.filter((x) => Math.abs(x) > 1e-12).length} 张`);
