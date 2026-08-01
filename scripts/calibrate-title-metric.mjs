#!/usr/bin/env node
// Which ruler is right? Judge blind on the cards where the rulers disagree --
// then score the RULERS.
//
//   scripts/calibrate-title-metric.mjs --build --checkpoint <jsonl>
//   scripts/calibrate-title-metric.mjs --score --checkpoint <jsonl>
//
// This exists because of a specific failure, not as ceremony. The first
// CSM-grounded metric on this project was written by the author of the arm it
// then favoured, after that arm had been seen to lose, and it contained a bug
// that inflated exactly that arm by 5.2pp. A second one inverted CSM's own
// keep-list order in the direction that flattered the same arm. Both looked
// principled the whole time; both were caught by hand-reading 20 cards.
//
// First calibration round, 20 contested cards judged clause-by-clause against
// the contract:
//
//   token_recall  74%      <- the bag-of-words metric everything was meant to replace
//   csm_quality   58%
//   csm_fields    29%
//   csm_brackets  17%
//
// Three of the four hand-built metrics lost to the crude one. That result is
// the reason this file exists and the reason no metric here is allowed to
// certify itself.
//
// WHO JUDGES MATTERS. Those 20 labels were filled in by the same author as the
// metrics, reading the contract. That is better than the metrics grading
// themselves and still not independent. A round judged by someone else is worth
// more than a bigger round judged by me.
//
// Blindness is not decoration: arms are labelled A and B, the order is decided
// by a hash of the asset id so a rebuild cannot reshuffle a part-filled ballot,
// and the key is written to a separate file.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { scoreCsmFields } from "../lib/listing/thin/csm-field-metric.mjs";
import { scoreSemQuality } from "../lib/listing/thin/csm-sem-score.mjs";

const argValue = (argv, name, fallback = "") => {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
};

function stableFlip(assetId) {
  let hash = 0;
  for (const character of String(assetId)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 2 === 0;
}

/**
 * Each ruler reduced to "which arm does it prefer". The question is not whose
 * number is bigger but whose ORDERING matches a careful reading of the
 * contract, and the arms are close enough that the ordering is the decision.
 */
const METRICS = {
  token_recall: (a, b) => a.score - b.score,
  f1: (a, b) => a.f1 - b.f1,
  precision: (a, b) => a.precision - b.precision,
  csm_fields: (a, b) => (scoreCsmFields(a.reference, a.title).score ?? 0)
    - (scoreCsmFields(b.reference, b.title).score ?? 0),
  // CSM's own SEM validator. The only ruler here whose fields, weights and
  // rules were all written before this comparison existed and by someone with
  // no stake in it.
  csm_sem: (a, b) => scoreSemQuality(a.title).confidence - scoreSemQuality(b.title).confidence
};

function loadArms(checkpointPath, armA, armB) {
  const rows = readFileSync(checkpointPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const a = new Map(rows.filter((row) => row.arm === armA).map((row) => [row.asset_id, row]));
  const b = new Map(rows.filter((row) => row.arm === armB).map((row) => [row.asset_id, row]));
  return [...a.keys()].filter((id) => b.has(id)).map((id) => ({ id, a: a.get(id), b: b.get(id) }));
}

function build(argv) {
  const checkpoint = argValue(argv, "--checkpoint");
  const armA = argValue(argv, "--arm-a", "thin_budgeted");
  const armB = argValue(argv, "--arm-b", "thin_canonical");
  const out = argValue(argv, "--out", "artifacts/metric-calibration");
  const limit = Number(argValue(argv, "--limit", "20")) || 20;

  mkdirSync(out, { recursive: true });
  const pairs = loadArms(checkpoint, armA, armB);

  // Only cards where the rulers disagree. Where they agree a label teaches
  // nothing about which ruler to keep, and spending a person's attention there
  // is how a calibration set ends up too small on the part that matters.
  const contested = pairs.filter(({ a, b }) => {
    const votes = Object.values(METRICS).map((metric) => Math.sign(metric(a, b)));
    return new Set(votes.filter(Boolean)).size > 1;
  });

  const chosen = contested.slice(0, limit);
  const ballot = [];
  const key = [];
  chosen.forEach(({ id, a, b }, index) => {
    const flip = stableFlip(id);
    const [left, right] = flip ? [b, a] : [a, b];
    key.push({ n: index + 1, asset_id: id, A: flip ? armB : armA, B: flip ? armA : armB });
    ballot.push([
      `--- ${index + 1} ---`,
      `参考:  ${a.reference}`,
      `A:     ${left.title}`,
      `B:     ${right.title}`,
      `判断 (A / B / 平): `,
      ""
    ].join("\n"));
  });

  const ballotPath = resolve(out, "ballot.txt");
  writeFileSync(ballotPath, [
    "对每张卡，只回答一个问题：作为 eBay 标题，A 和 B 哪个更好？",
    "参考标题是人工审核过的真值，也是我们想要的输出。",
    "在每张卡的「判断」后面写 A、B 或 平，然后保存。",
    "",
    ...ballot
  ].join("\n"), "utf8");
  writeFileSync(resolve(out, "key.json"), `${JSON.stringify(key, null, 2)}\n`, "utf8");

  process.stdout.write(`${pairs.length} 张配对中，${contested.length} 张存在尺子分歧，取前 ${chosen.length} 张\n${ballotPath}\n`);
  return { contested: contested.length, chosen: chosen.length };
}

function score(argv) {
  const checkpoint = argValue(argv, "--checkpoint");
  const out = argValue(argv, "--out", "artifacts/metric-calibration");
  const ballotPath = resolve(out, "ballot.txt");
  const keyPath = resolve(out, "key.json");
  if (!existsSync(ballotPath) || !existsSync(keyPath)) throw new Error("先跑 --build 并填完 ballot.txt");

  const key = JSON.parse(readFileSync(keyPath, "utf8"));
  const text = readFileSync(ballotPath, "utf8");
  const verdicts = new Map();
  for (const block of text.split(/--- (\d+) ---/).slice(1)) {
    if (/^\d+$/.test(block)) { verdicts.set(Number(block), null); continue; }
    const last = [...verdicts.keys()].pop();
    const match = block.match(/判断 \(A \/ B \/ 平\):\s*([AB平])/);
    if (match) verdicts.set(last, match[1]);
  }

  const armA = argValue(argv, "--arm-a", "thin_budgeted");
  const pairs = new Map(loadArms(checkpoint, armA, argValue(argv, "--arm-b", "thin_canonical"))
    .map((pair) => [pair.id, pair]));

  const tally = Object.fromEntries(Object.keys(METRICS).map((name) => [name, { agree: 0, disagree: 0 }]));
  let labelled = 0;
  for (const entry of key) {
    const verdict = verdicts.get(entry.n);
    if (!verdict || verdict === "平") continue;
    const pair = pairs.get(entry.asset_id);
    if (!pair) continue;
    labelled += 1;
    const humanPickedA = (verdict === "A" ? entry.A : entry.B) === armA;
    for (const [name, metric] of Object.entries(METRICS)) {
      const delta = metric(pair.a, pair.b);
      if (!delta) continue;
      tally[name][(delta > 0) === humanPickedA ? "agree" : "disagree"] += 1;
    }
  }

  process.stdout.write(`\n判定了 ${labelled} 张（平局不计）\n\n尺子            同意  不同意   一致率\n`);
  for (const [name, counts] of Object.entries(tally)) {
    const total = counts.agree + counts.disagree;
    process.stdout.write(
      `${name.padEnd(15)} ${String(counts.agree).padStart(4)}  ${String(counts.disagree).padStart(6)}   `
      + `${total ? `${(100 * counts.agree / total).toFixed(0)}%` : "-"}\n`
    );
  }
  process.stdout.write(
    "\n注意：样本是「尺子分歧卡」，不是随机样本，所以一致率不是绝对准确率，只用于在几把尺子之间排序。\n"
    + "判卷人是谁比样本量更重要——由尺子作者判卷的一致率，只比尺子自评好一点。\n"
  );
  return tally;
}

export async function main(argv = process.argv.slice(2)) {
  return argv.includes("--score") ? score(argv) : build(argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`calibrate failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
