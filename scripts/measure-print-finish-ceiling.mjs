#!/usr/bin/env node
// What is the ABSOLUTE ceiling of the world-model / enumerator line of work?
//
// The enumerator and the world-knowledge layer both exist to resolve one thing
// the model cannot always name from the image: the parallel / print finish.
// Before asking how to expand them, the question worth answering is how much
// F1 a PERFECT answer for that field would be worth. That number is an upper
// bound no amount of expansion can beat, and it costs nothing to compute --
// substitute the reference's own finish tokens into our fields and re-score.
//
// Three arms per card, same ruler, same composer:
//
//   actual    what we ship today
//   oracle    print_finish replaced by the finish words the reference uses
//   removed   print_finish emptied
//
// oracle - actual is the ceiling. actual - removed is what the field is worth
// TODAY, which says whether the current implementation is already earning.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { scoreWithEquivalence, FINISH_VOCABULARY } from "../lib/listing/evaluation/semantic-equivalence.mjs";

const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const lnFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const signTest = (w, l) => {
  const n = w + l; if (!n) return 1;
  let p = 0;
  for (let k = Math.max(w, l); k <= n; k++) p += Math.exp(lnFact(n) - lnFact(k) - lnFact(n - k) - n * Math.log(2));
  return Math.min(1, 2 * p);
};

const COHORTS = [
  ["150 队列", "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["105 留出", "artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
];

// Colour words and finish-family words, taken from the equivalence layer's own
// vocabulary rather than restated here, so the oracle cannot be tuned by
// widening a private list.
const FINISH_WORDS = new Set([
  ...FINISH_VOCABULARY,
  "gold", "silver", "red", "blue", "green", "orange", "purple", "black", "pink",
  "yellow", "teal", "aqua", "bronze", "platinum", "sapphire", "ruby", "emerald",
  "jade", "violet", "white", "rainbow", "atomic", "mojo", "pulsar", "wave",
  "shimmer", "sparkle", "speckle", "geometric", "interstellar", "crystal"
].map((w) => w.toLowerCase()));

/** The finish words the reviewed title actually uses, in its own order. */
function oracleFinish(reference) {
  const words = String(reference).split(/\s+/).filter(Boolean);
  const kept = [];
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/[^a-z-]/g, "");
    if (word && FINISH_WORDS.has(word) && !kept.some((k) => k.toLowerCase() === word)) {
      kept.push(raw.replace(/[^A-Za-z-]/g, ""));
    }
  }
  return kept.join(" ");
}

for (const [label, path, arm] of COHORTS) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { console.log(`${label}: 原料缺失`); continue; }

  const actual = [], oracle = [], removed = [];
  let n = 0, cardsWithFinishInReference = 0, weAlreadyHaveIt = 0;
  for (const row of rows) {
    if (row?.arm !== arm || !row?.fields || !row?.reference) continue;
    n += 1;
    const reference = String(row.reference);
    const truth = oracleFinish(reference);
    if (truth) cardsWithFinishInReference += 1;

    const a = composeFromCanonicalFields(row.fields).title;
    const o = composeFromCanonicalFields({ ...row.fields, print_finish: truth, parallel_exact: truth }).title;
    const r = composeFromCanonicalFields({ ...row.fields, print_finish: "", parallel_exact: "", surface_color: "", parallel_family: "" }).title;

    if (truth && a.toLowerCase().includes(truth.toLowerCase())) weAlreadyHaveIt += 1;

    actual.push(scoreWithEquivalence(a, reference));
    oracle.push(scoreWithEquivalence(o, reference));
    removed.push(scoreWithEquivalence(r, reference));
  }
  if (!n) { console.log(`${label}: arm 未命中`); continue; }

  console.log(`\n══ ${label}  n=${n} ══`);
  console.log(`   参考标题带工艺词的卡: ${cardsWithFinishInReference} 张 (${(100 * cardsWithFinishInReference / n).toFixed(1)}%)`);
  console.log(`   其中我们已经写对的:   ${weAlreadyHaveIt} 张`);

  for (const scale of ["raw", "equivalent"]) {
    const A = actual.map((s) => s[scale].f1);
    const O = oracle.map((s) => s[scale].f1);
    const R = removed.map((s) => s[scale].f1);
    const winsO = A.map((v, i) => O[i] > v + 1e-9).filter(Boolean).length;
    const lossO = A.map((v, i) => v > O[i] + 1e-9).filter(Boolean).length;
    console.log(
      `   [${scale}] 现状=${mean(A).toFixed(6)}  完美工艺=${mean(O).toFixed(6)}  `
      + `天花板 Δ=+${(mean(O) - mean(A)).toFixed(6)}  (${winsO}胜/${lossO}负, p=${signTest(winsO, lossO).toFixed(4)})`
    );
    console.log(
      `   [${scale}] 整个字段拿掉=${mean(R).toFixed(6)}  `
      + `→ 该字段今天净值 Δ=${(mean(A) - mean(R)) >= 0 ? "+" : ""}${(mean(A) - mean(R)).toFixed(6)}`
    );
  }
}

console.log(`
读法：
  「天花板 Δ」= 就算世界模型/枚举器把工艺字段做到 100% 正确，最多能涨这么多。
    任何扩大投入的收益都必须落在这个数以内，而且实际只能拿到其中一部分。
  「该字段今天净值」= 现在这个字段是在赚还是在赔。若接近 0 或为负，
    说明问题不在「知道得不够多」，而在「写出来会掉分」。
`);
