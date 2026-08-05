#!/usr/bin/env node
// Before cropping for the finish, ask what the finish failures actually ARE.
//
// The research report's ROI-crop direction survived its card_number half being
// worthless, and the obvious rescue was to aim the crop at the finish instead:
// it has the largest field ceiling at +0.036. This is the check that should
// come before that experiment, and it does not support it.
//
// A crop can only help where the model SAW something and judged it wrong. It
// cannot help where the answer is the product line's name for its parallels,
// which is not printed on the card at all -- that is knowledge, and permission
// to use it was already measured at -0.0092.
//
// So the ceiling is split by failure mode, and the croppable half is what a
// crop experiment could at most win.
import { readFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { scoreWithEquivalence } from "../lib/listing/evaluation/semantic-equivalence.mjs";
import { CANONICAL_FIELDS_SCHEMA } from "../lib/listing/thin/canonical-fields.mjs";
import { MEASURED_DRIFT } from "../lib/listing/evaluation/exploration-review.mjs";

const FAMILIES = CANONICAL_FIELDS_SCHEMA.properties.parallel_family.enum
  .filter(Boolean).map((f) => f.toLowerCase());
const ENUM = new Set(FAMILIES);
const EXTRA = ["crystallized", "interstellar", "pandora", "lava"];
const VOCAB = [...new Set([...FAMILIES, ...EXTRA])];

const tokenise = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const COHORTS = [
  ["150 队列", "artifacts/thin-path-eval/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_pre_copyright"],
  ["105 留出", "artifacts/finish-alignment-105/thin-path-gpt-5.6-luna.jsonl", "thin_canonical_high_effort_low"]
];

const summary = [];
for (const [label, path, arm] of COHORTS) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((r) => r.arm === arm && r.fields && r.reference);
  } catch { console.log(`${label}: 原料缺失`); continue; }

  const base = [], fixWrong = [], fixSilent = [];
  let wrong = 0, silent = 0, right = 0, outsideEnum = 0;
  for (const row of rows) {
    const b = scoreWithEquivalence(
      composeFromCanonicalFields(row.fields).title, row.reference
    ).equivalent.f1;
    base.push(b);
    const want = VOCAB.filter((v) => tokenise(row.reference).has(v));
    if (!want.length) { fixWrong.push(b); fixSilent.push(b); continue; }
    const said = `${row.fields.parallel_family || ""} ${row.fields.parallel_exact || ""}`.toLowerCase().trim();
    if (want.some((w) => said.includes(w))) { right += 1; fixWrong.push(b); fixSilent.push(b); continue; }

    const truth = want.join(" ");
    const patched = scoreWithEquivalence(composeFromCanonicalFields({
      ...row.fields, parallel_family: truth,
      print_finish: `${row.fields.surface_color || ""} ${truth}`.trim()
    }).title, row.reference).equivalent.f1;

    if (said) {
      wrong += 1;
      if (!want.every((w) => ENUM.has(w))) outsideEnum += 1;
      fixWrong.push(patched); fixSilent.push(b);
    } else {
      silent += 1;
      fixWrong.push(b); fixSilent.push(patched);
    }
  }

  const croppable = mean(fixWrong) - mean(base);
  const knowledge = mean(fixSilent) - mean(base);
  summary.push(croppable);
  console.log(`\n══ ${label}  n=${rows.length}  现状 ${mean(base).toFixed(6)} ══`);
  console.log(`   参考含工艺族词: ${right + wrong + silent} 张（说对 ${right}）`);
  console.log(`   说了但说错 ${String(wrong).padStart(3)} 张 → 天花板 +${croppable.toFixed(6)}   ← 裁剪最多能碰到`);
  console.log(`   完全没说   ${String(silent).padStart(3)} 张 → 天花板 +${knowledge.toFixed(6)}   ← 产品线知识，裁剪无用`);
  console.log(`   说错里真值不在枚举内: ${outsideEnum} / ${wrong}`);
}

const avg = mean(summary);
console.log(`
裁剪路线判定：可碰到部分的天花板均值 +${avg.toFixed(6)}，实测漂移 ${MEASURED_DRIFT}。`);
console.log(avg < MEASURED_DRIFT
  ? "  → 低于漂移。即使裁剪做到完美也无法与同臂跑两次区分，不应付费实验。"
  : "  → 高于漂移，可以设计实验。");
console.log(`  两队列分别为 ${summary.map((v) => `+${v.toFixed(6)}`).join(" 和 ")}；差距越大，越说明是在拟合单个队列。`);
