#!/usr/bin/env node

// Scores the paired CSM-context run on BOTH metrics side by side, because
// either one alone misleads:
//
//   token F1        -- what the writer-facing title looks like
//   typed-field     -- the founder's own gold fields under acceptance policy v2
//
// The first cannot tell verbosity from fabrication. The second cannot see
// title-level quality at all. Reporting one without the other is how the
// gamma-53 run concluded "no mechanism signal" for two arms that turned out to
// behave completely differently.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGoldIndex, buildEquivalenceIndex, scoreCase, summarize
} from "../csm-typed-field-score.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSMDATA = "/Users/paidaxin/lynca-csmdata";

const tokens = (v) => String(v || "").toLowerCase().match(/[a-z0-9]+(?:[./-][a-z0-9]+)*/g) || [];
function f1(reference, candidate) {
  const expected = tokens(reference); const actual = tokens(candidate);
  const remaining = new Map();
  for (const t of expected) remaining.set(t, (remaining.get(t) || 0) + 1);
  let matches = 0;
  for (const t of actual) { const c = remaining.get(t) || 0; if (c > 0) { matches += 1; remaining.set(t, c - 1); } }
  const p = actual.length ? matches / actual.length : 0;
  const r = expected.length ? matches / expected.length : 0;
  return p + r ? 2 * p * r / (p + r) : 0;
}
function signTest(wins, losses) {
  const n = wins + losses;
  if (!n) return 1;
  const choose = (N, k) => { let v = 1; for (let i = 1; i <= k; i += 1) v = v * (N - k + i) / i; return v; };
  let sum = 0;
  for (let i = 0; i <= Math.min(wins, losses); i += 1) sum += choose(n, i);
  return Math.min(1, 2 * sum / (2 ** n));
}
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

const gold = buildGoldIndex(JSON.parse(await readFile(`${CSMDATA}/golden/founder-golden-projection.json`, "utf8")));
const equivalence = buildEquivalenceIndex(
  JSON.parse(await readFile(`${CSMDATA}/policy/semantic-equivalence-decisions-v1.json`, "utf8")));
const rows = (await readFile(resolve(HERE, "results/raw-results.jsonl"), "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const byKey = new Map(rows.map((row) => [`${row.asset}::${row.arm}`, row]));
const assets = [...new Set(rows.map((row) => row.asset))]
  .filter((a) => byKey.has(`${a}::control`) && byKey.has(`${a}::treatment`) && gold.has(a))
  .sort();

const typed = { control: [], treatment: [] };
const titleF1 = { control: [], treatment: [] };
const latency = { control: [], treatment: [] };
const over80 = { control: 0, treatment: 0 };
for (const asset of assets) {
  const g = gold.get(asset);
  for (const arm of ["control", "treatment"]) {
    const row = byKey.get(`${asset}::${arm}`);
    typed[arm].push(scoreCase({ gold: g, runtimeFields: row.fields || {}, equivalence, caseId: asset }));
    titleF1[arm].push(f1(g.answer, row.title));
    latency[arm].push(row.latency_ms);
    if ((row.title || "").length > 80) over80[arm] += 1;
  }
}

const deltas = assets.map((_, i) => titleF1.treatment[i] - titleF1.control[i]);
const f1Wins = deltas.filter((d) => d > 1e-9).length;
const f1Losses = deltas.filter((d) => d < -1e-9).length;
let passFixed = 0; let passBroke = 0;
for (let i = 0; i < assets.length; i += 1) {
  if (typed.treatment[i].passed && !typed.control[i].passed) passFixed += 1;
  if (typed.control[i].passed && !typed.treatment[i].passed) passBroke += 1;
}

const report = {
  schema: "csm-source-context-score-v1",
  cards: assets.length,
  arms: { control: "shipped 15-clause summary prompt", treatment: "+ CSM Canonical Naming Layer criteria (verbatim, fixtures excluded)" },
  gold: "LYNCA-OS/csmdata founder-golden-projection under acceptance-policy-v2",
  title_f1: {
    control_mean: mean(titleF1.control),
    treatment_mean: mean(titleF1.treatment),
    paired_mean_delta: mean(deltas),
    wins: f1Wins, losses: f1Losses, ties: assets.length - f1Wins - f1Losses,
    sign_p: signTest(f1Wins, f1Losses)
  },
  typed_field: {
    control: summarize(typed.control),
    treatment: summarize(typed.treatment),
    pass_fixed_by_treatment: passFixed,
    pass_broken_by_treatment: passBroke,
    sign_p: signTest(passFixed, passBroke)
  },
  latency_p50_ms: { control: median(latency.control), treatment: median(latency.treatment) },
  over_80_chars: over80
};

await writeFile(resolve(HERE, "results/score-report.json"), `${JSON.stringify(report, null, 1)}\n`);

const t = report.typed_field;
console.log(`cards: ${report.cards}\n`);
console.log("                        control    treatment");
console.log(`  title token F1        ${report.title_f1.control_mean.toFixed(4)}     ${report.title_f1.treatment_mean.toFixed(4)}`);
console.log(`  typed PASS RATE       ${(t.control.pass_rate * 100).toFixed(1)}%      ${(t.treatment.pass_rate * 100).toFixed(1)}%`);
console.log(`  FABRICATED cases      ${String(t.control.fabricated_cases).padEnd(9)}${t.treatment.fabricated_cases}`);
console.log(`  p50 latency           ${report.latency_p50_ms.control}ms    ${report.latency_p50_ms.treatment}ms`);
console.log(`  over 80 chars         ${String(report.over_80_chars.control).padEnd(9)}${report.over_80_chars.treatment}`);
console.log(`\n  title F1 paired delta ${report.title_f1.paired_mean_delta >= 0 ? "+" : ""}${report.title_f1.paired_mean_delta.toFixed(4)}`);
console.log(`    ${report.title_f1.wins}W / ${report.title_f1.losses}L / ${report.title_f1.ties}T   sign p=${report.title_f1.sign_p.toFixed(4)}`);
console.log(`  typed pass flips      fixed ${t.pass_fixed_by_treatment}, broke ${t.pass_broken_by_treatment}   sign p=${t.sign_p.toFixed(4)}`);
const gate = (p, d) => (p <= 0.05 && d >= 0.02 ? "MECHANISM_SIGNAL" : "NO_MECHANISM_SIGNAL");
console.log(`\n  decision (repo gate: delta>=0.02 AND p<=0.05): ${gate(report.title_f1.sign_p, report.title_f1.paired_mean_delta)}`);
