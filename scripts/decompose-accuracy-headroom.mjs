#!/usr/bin/env node
// Where is the remaining accuracy, and can anything ADDED reach it?
//
// The question this answers is not "how well do we do" but "what KIND of loss
// is left", because the two kinds have opposite cures:
//
//   RECOGNITION loss  a reference token appears in no field we resolved.
//                     We never knew it. More knowledge could help.
//
//   COMPOSITION loss  a reference token IS in a field we resolved, and did not
//                     reach the title -- dropped for the 80-character budget,
//                     suppressed by the marketplace profile, or filtered.
//                     We already knew it. No amount of world knowledge helps;
//                     this is a Composer/budget decision.
//
//   PRECISION loss    we emitted a token the reference does not have. Adding
//                     knowledge makes this WORSE, not better.
//
// Three oracles bound the whole space:
//
//   perfect_recall     every missing reference token appended (ignoring budget)
//   perfect_precision  every non-reference token removed
//   both               the arithmetic ceiling of this ruler
//
// A large composition share means the binding constraint is 80 characters and
// the answer is triage, not knowledge. A large recognition share means there is
// real headroom for a better reader. A large precision share means the system
// already says too much.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { scoreWithEquivalence, equivalenceTokens } from "../lib/listing/evaluation/semantic-equivalence.mjs";

const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : "—");

const COHORTS = [
  ["150 队列", "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["105 留出", "artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
];

const tokenise = (text) => new Set(
  String(text || "").toLowerCase().split(/[^a-z0-9/#-]+/).filter((t) => t && t.length > 1)
);

/** Every token present anywhere in the resolved fields, however nested. */
function fieldTokens(fields) {
  const out = new Set();
  const walk = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (typeof value === "object") { Object.values(value).forEach(walk); return; }
    for (const token of tokenise(value)) out.add(token);
  };
  walk(fields);
  return out;
}

for (const [label, path, arm] of COHORTS) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { console.log(`${label}: 原料缺失`); continue; }

  const actual = [], recallOracle = [], precisionOracle = [], bothOracle = [];
  let n = 0;
  let missTotal = 0, missKnown = 0, missUnknown = 0, extraTotal = 0;
  const knownMissByLength = [];

  for (const row of rows) {
    if (row?.arm !== arm || !row?.fields || !row?.reference) continue;
    n += 1;
    const reference = String(row.reference);
    const composed = composeFromCanonicalFields(row.fields);
    const ours = composed.title;

    const refTokens = tokenise(reference);
    const ourTokens = tokenise(ours);
    const known = fieldTokens(row.fields);

    const missing = [...refTokens].filter((t) => !ourTokens.has(t));
    const extra = [...ourTokens].filter((t) => !refTokens.has(t));
    // A token counts as KNOWN only if we resolved it into a field. Anything
    // else we genuinely never had.
    const missingKnown = missing.filter((t) => known.has(t));

    missTotal += missing.length;
    missKnown += missingKnown.length;
    missUnknown += missing.length - missingKnown.length;
    extraTotal += extra.length;
    if (missingKnown.length) knownMissByLength.push({ length: ours.length, tokens: missingKnown, ours, reference });

    // Oracles are string-level: the point is the arithmetic bound, not a title
    // anyone would ship. Budget deliberately ignored.
    const withRecall = `${ours} ${missing.join(" ")}`.trim();
    const withPrecision = [...ourTokens].filter((t) => refTokens.has(t)).join(" ");
    const withBoth = [...refTokens].join(" ");

    actual.push(scoreWithEquivalence(ours, reference).equivalent.f1);
    recallOracle.push(scoreWithEquivalence(withRecall, reference).equivalent.f1);
    precisionOracle.push(scoreWithEquivalence(withPrecision, reference).equivalent.f1);
    bothOracle.push(scoreWithEquivalence(withBoth, reference).equivalent.f1);
  }
  if (!n) { console.log(`${label}: arm 未命中`); continue; }

  console.log(`\n══════ ${label}   n=${n} ══════`);
  console.log(`现状 F1(equivalent) = ${mean(actual).toFixed(6)}\n`);
  console.log(`  完美召回(补齐所有漏词)  = ${mean(recallOracle).toFixed(6)}   Δ=+${(mean(recallOracle) - mean(actual)).toFixed(6)}`);
  console.log(`  完美精度(删掉所有多词)  = ${mean(precisionOracle).toFixed(6)}   Δ=+${(mean(precisionOracle) - mean(actual)).toFixed(6)}`);
  console.log(`  两者皆完美(尺子上限)    = ${mean(bothOracle).toFixed(6)}   Δ=+${(mean(bothOracle) - mean(actual)).toFixed(6)}`);

  console.log(`\n漏词归因（共 ${missTotal} 个，${(missTotal / n).toFixed(2)} 个/张）：`);
  console.log(`  已识别但没写出来（组装/预算损失）: ${missKnown}  ${pct(missKnown, missTotal)}  ← 加知识没用`);
  console.log(`  根本没识别到（识别损失）        : ${missUnknown}  ${pct(missUnknown, missTotal)}  ← 只有这部分能靠"加东西"`);
  console.log(`多余词（精度损失）: ${extraTotal} 个，${(extraTotal / n).toFixed(2)} 个/张  ← 加知识会让它更糟`);

  const overBudget = knownMissByLength.filter((c) => c.length >= 76).length;
  console.log(`\n组装损失里，标题已用到 76+ 字符的: ${overBudget} / ${knownMissByLength.length} 张 (${pct(overBudget, knownMissByLength.length)})`);
  console.log(`  → 若占比高，80 字预算就是真正的约束；若低，是优先级排序而非空间不够`);
}

console.log(`
判读：
  「识别损失」占比 = 更好的读图/更多知识最多能碰到的那部分。
  「组装损失」占比 = 我们已经知道、却选择不写。解法是 Composer 优先级或预算，
    与世界模型无关。
  「精度损失」= 说得太多。任何"补充知识"的方案都会推高这一项。
`);
