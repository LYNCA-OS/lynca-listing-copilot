#!/usr/bin/env node
// COS-49 names `Lot*N` as the one merchant-facing quantity marker, retiring the
// interim `Lot*N`. The decision is Fei's and does not need a number to stand.
// This supplies one anyway, because the change is cheap to measure and a
// decision that also happens to score better is worth knowing about -- and a
// decision that scores WORSE is worth knowing about before a demo.
//
// Paired on the same cards with the same ruler; the ONLY difference between the
// two arms is the marker string, patched after composition. Nothing else in the
// pipeline moves, so any delta is attributable to the form alone.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { scoreWithEquivalence } from "../lib/listing/evaluation/semantic-equivalence.mjs";

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

for (const [label, path, arm] of COHORTS) {
  let rows;
  try {
    rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    console.log(`${label}: 原料缺失 (${path})`);
    continue;
  }

  const lotPairs = [];
  let lotCards = 0;
  let armRows = 0;
  for (const row of rows) {
    if (row?.arm !== arm) continue;
    armRows += 1;
    const reference = String(row?.reference || "").trim();
    if (!reference || !row?.fields) continue;

    let composed;
    try {
      composed = composeFromCanonicalFields(row.fields);
    } catch { continue; }

    // Only lot titles can move. Scoring the other 95% would bury a real effect
    // under cards the change cannot touch, which is how a per-bracket edit gets
    // reported as "no measurable difference".
    if (!/^Lot\*\d+\b/.test(composed.title)) continue;
    lotCards += 1;

    const withX = composed.title;
    const withStar = composed.title.replace(/^Lot\*(\d+)\b/, "Lot*$1");
    lotPairs.push({
      x: scoreWithEquivalence(withX, reference),
      star: scoreWithEquivalence(withStar, reference),
      title_x: withX,
      reference
    });
  }

  // Report the denominator before the verdict. "No lot cards" is a real finding
  // only if the arm was found at all; a zero from a mis-keyed arm name looks
  // exactly the same and has bitten this codebase before.
  console.log(`${label}: arm=${arm} 命中 ${armRows} 行，其中 lot 卡 ${lotCards} 张`);
  if (!lotCards) {
    console.log(`${label}: 此改动在该队列上无接触面`);
    continue;
  }

  for (const scale of ["raw", "equivalent"]) {
    const x = lotPairs.map((p) => p[scale === "raw" ? "x" : "x"][scale].f1);
    const star = lotPairs.map((p) => p.star[scale].f1);
    let wins = 0, losses = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] > star[i] + 1e-9) wins += 1;
      else if (star[i] > x[i] + 1e-9) losses += 1;
    }
    const delta = mean(x) - mean(star);
    console.log(
      `${label} [${scale}] n=${lotCards} lot 卡  `
      + `Lot*=${mean(x).toFixed(6)}  Lot*=${mean(star).toFixed(6)}  `
      + `Δ=${delta >= 0 ? "+" : ""}${delta.toFixed(6)}  `
      + `${wins}W/${losses}L  p=${signTest(wins, losses).toFixed(4)}`
    );
  }
  // Cohort-wide: the non-lot cards are byte-identical in both arms, so the
  // whole-cohort delta is the lot delta diluted by how rare lots are. Both
  // numbers matter -- the first says how good the change is, the second says
  // how much of the headline number it can move.
  for (const scale of ["raw", "equivalent"]) {
    const lotDelta = mean(lotPairs.map((p) => p.x[scale].f1 - p.star[scale].f1));
    console.log(
      `${label} [${scale}] 全队列稀释后 Δ=+${(lotDelta * lotCards / armRows).toFixed(6)} `
      + `(${lotCards}/${armRows} 张卡有接触面)`
    );
  }
  for (const pair of lotPairs.slice(0, 4)) {
    console.log(`    我方: ${pair.title_x}`);
    console.log(`    参考: ${pair.reference}`);
  }
}
