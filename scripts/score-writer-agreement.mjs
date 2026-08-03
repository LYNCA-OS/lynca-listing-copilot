#!/usr/bin/env node
// Score writer-vs-writer agreement, and read the metric's ceiling off it.
//
//   node scripts/score-writer-agreement.mjs artifacts/writer-b-packet/worksheet.csv
//
// Three numbers on the same cards, under the SAME scorer the production gate
// uses (deduplicated token precision/recall, harmonic mean, macro-averaged):
//
//   F1(A, B)       two humans against each other -- the ceiling
//   F1(system, A)  what we report today
//   F1(system, B)  the same system judged by the other writer
//
// How to read the result:
//
//   F1(A,B) well below 0.90  -- the gate is asking for agreement humans do not
//                               reach with each other. The target is an artifact
//                               of scoring against one writer, and the ruler has
//                               to change before the number means anything.
//   F1(A,B) around 0.90+     -- writers really do converge, the gate is fair,
//                               and our gap is a real recognition gap.
//   F1(system,B) >> F1(system,A) -- we are not weak, we are tuned to A's taste.
//
// The interval is bootstrapped over cards rather than assumed normal: per-card
// F1 is bounded and skewed, and n is small on purpose.

import { readFileSync } from "node:fs";

const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (left, right) => {
  const a = tokens(left); const b = tokens(right);
  const hits = [...a].filter((t) => b.has(t)).length;
  const recall = a.size ? hits / a.size : 0;
  const precision = b.size ? hits / b.size : 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);

// Deterministic bootstrap: the resample index comes from a counter-seeded LCG,
// so the reported interval is reproducible from the same worksheet.
function bootstrapCI(values, rounds = 10000) {
  let seed = 20260803;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const means = [];
  for (let round = 0; round < rounds; round++) {
    let total = 0;
    for (let i = 0; i < values.length; i++) total += values[Math.floor(next() * values.length)];
    means.push(total / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(rounds * 0.025)], means[Math.floor(rounds * 0.975)]];
}

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const worksheetPath = process.argv[2] || "artifacts/writer-b-packet/worksheet.csv";
const cohortPath = process.argv[3]
  || "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";

const csv = parseCsv(readFileSync(worksheetPath, "utf8"));
const header = csv[0].map((h) => h.trim());
const idAt = header.indexOf("asset_id");
const titleAt = header.indexOf("writer_b_title");
if (idAt < 0 || titleAt < 0) throw new Error("worksheet_needs_asset_id_and_writer_b_title_columns");

const writerB = new Map();
let skipped = 0;
for (const row of csv.slice(1)) {
  const title = (row[titleAt] || "").trim();
  if (!title) continue;
  if (title.toUpperCase() === "SKIP") { skipped++; continue; }
  writerB.set((row[idAt] || "").trim(), title);
}

const cohort = new Map(readFileSync(cohortPath, "utf8").split(/\n+/).filter(Boolean)
  .map((line) => JSON.parse(line)).filter((r) => r.arm === "thin_canonical_high")
  .map((r) => [r.asset_id, r]));

const ab = []; const sa = []; const sb = []; const over80 = [];
for (const [assetId, titleB] of writerB) {
  const row = cohort.get(assetId);
  if (!row) continue;
  ab.push(score(row.reference, titleB));
  sa.push(score(row.reference, row.title));
  sb.push(score(titleB, row.title));
  if (titleB.length > 80) over80.push(assetId);
}
if (!ab.length) throw new Error("no_scored_cards -- asset ids do not match the cohort");

const report = (label, values) => {
  const [lo, hi] = bootstrapCI(values);
  console.log(`${label.padEnd(22)} ${mean(values).toFixed(4)}   95% CI [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
};
console.log(`已评分 ${ab.length} 张（写手跳过 ${skipped} 张）\n`);
report("F1(写手A, 写手B)", ab);
report("F1(系统, 写手A)", sa);
report("F1(系统, 写手B)", sb);

const [lo, hi] = bootstrapCI(ab);
console.log();
if (hi < 0.90) {
  console.log(`判定：两个写手之间的一致性上界 ${hi.toFixed(4)} 已经低于 0.90。`);
  console.log("对着单个写手的标题要求 F1 >= 0.90，是在要求超过人类互相之间的一致程度。");
  console.log("这个门槛不是识别能力问题，尺子必须先换。");
} else if (lo > 0.90) {
  console.log(`判定：写手一致性下界 ${lo.toFixed(4)} 高于 0.90，门槛公平，差距是真实识别差距。`);
} else {
  console.log(`判定：区间 [${lo.toFixed(4)}, ${hi.toFixed(4)}] 跨过 0.90，样本量不足以定论。`);
  console.log(`当前 n=${ab.length}；把样本加到 100 可把半宽压到约 ±0.028。`);
}
if (mean(sb) - mean(sa) > 0.02) {
  console.log(`\n注意：系统对写手B 的得分比对写手A 高 ${(mean(sb) - mean(sa)).toFixed(4)}，`);
  console.log("说明当前分数里有一部分是拟合了写手A 的个人偏好，不是通用准确率。");
}
if (over80.length) console.log(`\n写手B 有 ${over80.length} 条标题超过 80 字符——写手自己也不总是守这条。`);
