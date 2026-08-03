#!/usr/bin/env node
// How high can any model score against this writer, using only data we hold?
//
// A second writer would measure agreement directly, but the confirmed library
// has exactly one operator (`metaverse`, 358 rows, all corrected, 2026-06-21 to
// 06-29 -- verified, not assumed). What it does hold, and what had gone unused,
// is BOTH sides of every edit: the system's draft and the writer's final. The
// writer's own keep/drop behaviour bounds what any predictor can achieve, and
// the tokens they ADD bound what recognition must supply on its own.
import { readFileSync } from "node:fs";

const tok = (v) => String(v ?? "").split(/[^A-Za-z0-9/']+/).filter(Boolean).map((t) => t.toLowerCase());
const f1 = (a, b) => {
  const w = new Set(tok(a)); const g = new Set(tok(b));
  const hits = [...w].filter((t) => g.has(t)).length;
  const r = w.size ? hits / w.size : 0; const p = g.size ? hits / g.size : 0;
  return r + p ? 2 * r * p / (r + p) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

const rows = JSON.parse(readFileSync(process.argv[2] || "/tmp/wf/feedback.json", "utf8"));

// 1. What the June pipeline scored against this writer.
console.log(`n=${rows.length}`);
console.log(`当时系统草稿 vs 写手定稿  F1=${mean(rows.map((r) => f1(r.corrected_title, r.generated_title))).toFixed(4)}\n`);

// 2. Where the writer's final tokens come from.
let fromDraft = 0, added = 0, draftDropped = 0;
for (const r of rows) {
  const draft = new Set(tok(r.generated_title));
  const final = new Set(tok(r.corrected_title));
  for (const t of final) (draft.has(t) ? fromDraft++ : added++);
  for (const t of draft) if (!final.has(t)) draftDropped++;
}
const finalTotal = fromDraft + added;
console.log(`写手定稿的词从哪来：`);
console.log(`  草稿里已有、被保留   ${String(fromDraft).padStart(5)}  ${(fromDraft / finalTotal * 100).toFixed(1)}%`);
console.log(`  草稿没有、写手补上   ${String(added).padStart(5)}  ${(added / finalTotal * 100).toFixed(1)}%   <- 识别必须自己拿到的部分`);
console.log(`  草稿有、被写手删掉   ${String(draftDropped).padStart(5)}\n`);

// 3. The ceiling. For each term the writer decides on, an oracle that always
//    makes their majority choice is wrong at rate min(p, 1-p). Terms seen fewer
//    than `MIN` times are excluded: a 1-of-1 decision looks perfectly
//    predictable and is not evidence of anything.
const MIN = 8;
const keep = new Map(); const drop = new Map();
for (const r of rows) {
  const draft = new Set(tok(r.generated_title)); const final = new Set(tok(r.corrected_title));
  for (const t of draft) {
    const m = final.has(t) ? keep : drop;
    m.set(t, (m.get(t) || 0) + 1);
  }
}
let decided = 0, coinflip = 0, occDecided = 0, occWrong = 0;
for (const t of new Set([...keep.keys(), ...drop.keys()])) {
  const k = keep.get(t) || 0; const d = drop.get(t) || 0;
  if (k + d < MIN) continue;
  const p = k / (k + d);
  if (p >= 0.75 || p <= 0.25) decided++; else coinflip++;
  occDecided += k + d; occWrong += Math.min(k, d);
}
console.log(`写手对高频词（出现 >=${MIN} 次）的决断力：`);
console.log(`  态度明确（保留率 >=75% 或 <=25%）  ${decided} 个词`);
console.log(`  摇摆不定（25%-75%）              ${coinflip} 个词`);
console.log(`  完美预测者仍会判错的比例          ${(occWrong / occDecided * 100).toFixed(1)}%  （${occWrong}/${occDecided} 次决策）`);
console.log(`\n据此，写手自身的不一致给任何模型留下的上限约 ${(1 - occWrong / occDecided).toFixed(3)}。`);
console.log(`这不是 F1 上限本身——它只覆盖草稿里出现过的词，不含写手自己补上的 ${(added / finalTotal * 100).toFixed(0)}%。`);
