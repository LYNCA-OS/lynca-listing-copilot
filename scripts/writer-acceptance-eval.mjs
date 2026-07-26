#!/usr/bin/env node
// Score a smoke report the way a lister experiences it, not the way a token
// metric does.
//
//   node scripts/writer-acceptance-eval.mjs artifacts/smoke/paired-eval/*-candidate-*.json
//   node scripts/writer-acceptance-eval.mjs report.json --gate
//
// policy_fair_token_recall reads 0.785 on the current build, which sounds close
// to the 0.85 launch gate. Measured as a lister would: zero of 60 titles were
// usable as written, and 40% needed more edits than retyping from scratch. The
// token metric is not wrong, it just answers a different question -- it counts
// how much of the correct title we recovered, not whether what we produced can
// be shipped.
//
// The goal this eval exists to serve is "the lister confirms this is our card,
// then lists it". So it measures three things the token metric hides:
//
//   * ACCEPTANCE -- how many titles need at most k edits. A lister who has to
//     retype is not being helped.
//   * COST-WEIGHTED ERRORS -- a wrong year is one keystroke; a wrong player
//     means starting over. Edit distance prices them identically, a lister does
//     not.
//   * CATASTROPHIC RATE -- titles naming the wrong card. This is the one
//     failure that destroys trust, because the lister may not catch it, and it
//     has never been measured.
//
// Structural words are separated from names by document frequency across the
// reviewed corpus rather than a hand-kept vocabulary: "Chrome" and "Refractor"
// recur across many cards, "Bijan Robinson" does not. A hand-kept list would
// silently rot as new products ship; frequency re-derives itself every run.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RETYPE_EDITS = 7;
// A token on this share of the corpus is describing the product, not a person.
const STRUCTURAL_DF_RATIO = 0.04;
// The ratio alone misreads a small corpus -- one card in four is 25%, which
// would file every player as structural. Requiring a token on several distinct
// cards keeps the rule meaningful whether it is run over twenty cards or two
// thousand.
const STRUCTURAL_DF_FLOOR = 3;

const SERIAL = /^\d{1,4}\/\d{1,4}$/;
const YEAR = /^(?:19|20)\d{2}(?:-\d{2})?$/;
const MARKER = /^(?:rc|auto|autograph|patch|relic|sp|ssp|1st)$/i;

export function tokens(title = "") {
  return String(title)
    .replace(/[^\w/#.-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^#/, "").toLowerCase())
    .filter(Boolean);
}

// Multiset difference: a token needed twice and supplied once is still short.
export function multisetDiff(want = [], have = []) {
  const pool = new Map();
  for (const t of have) pool.set(t, (pool.get(t) || 0) + 1);
  const missing = [];
  for (const t of want) {
    const n = pool.get(t) || 0;
    if (n > 0) pool.set(t, n - 1);
    else missing.push(t);
  }
  const extra = [];
  for (const [t, n] of pool) for (let i = 0; i < n; i += 1) extra.push(t);
  return { missing, extra };
}

export function documentFrequency(titles = []) {
  const df = new Map();
  for (const title of titles) {
    for (const t of new Set(tokens(title))) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

// Cheap to fix vs expensive to fix, from the lister's chair.
export function classifyToken(token, { df = new Map(), corpusSize = 1 } = {}) {
  if (SERIAL.test(token)) return "serial";
  if (YEAR.test(token)) return "year";
  if (MARKER.test(token)) return "marker";
  const seen = df.get(token) || 0;
  const threshold = Math.max(STRUCTURAL_DF_FLOOR, STRUCTURAL_DF_RATIO * Math.max(1, corpusSize));
  return seen >= threshold ? "structural" : "name";
}

export function scoreCard(generated, reviewed, context) {
  const want = tokens(reviewed);
  const have = tokens(generated);
  const { missing, extra } = multisetDiff(want, have);
  const edits = missing.length + extra.length;

  const classes = {};
  for (const token of missing) {
    const c = classifyToken(token, context);
    classes[c] = (classes[c] || 0) + 1;
  }
  return {
    reviewed,
    generated,
    gt_length: want.length,
    edits,
    add: missing.length,
    delete: extra.length,
    missing_classes: classes,
    // A missing name token means the title does not identify this card. That is
    // not a title that needs editing, it is a title that is about something
    // else -- and the lister may ship it without noticing.
    catastrophic: (classes.name || 0) > 0,
    // Everything wrong is cheap to fix: year formatting, a marker, word order.
    cosmetic_only: edits > 0 && !classes.name && !classes.structural && !classes.serial
  };
}

export function summarize(cards = []) {
  const n = cards.length || 1;
  const atMost = (k) => cards.filter((c) => c.edits <= k).length;
  const retype = cards.filter((c) => c.edits >= RETYPE_EDITS || c.edits > c.gt_length / 2).length;
  const classTotals = {};
  for (const card of cards) {
    for (const [k, v] of Object.entries(card.missing_classes)) classTotals[k] = (classTotals[k] || 0) + v;
  }
  return {
    cards: cards.length,
    mean_gt_length: cards.reduce((s, c) => s + c.gt_length, 0) / n,
    mean_edits: cards.reduce((s, c) => s + c.edits, 0) / n,
    accept_0: atMost(0) / n,
    accept_2: atMost(2) / n,
    accept_4: atMost(4) / n,
    retype_rate: retype / n,
    catastrophic_rate: cards.filter((c) => c.catastrophic).length / n,
    cosmetic_only_rate: cards.filter((c) => c.cosmetic_only).length / n,
    missing_by_class: classTotals
  };
}

// The launch bar, stated in lister terms. These are the numbers that decide
// whether the tool saves anyone time, not the token metric.
export const launchGate = {
  accept_2: 0.60,
  retype_rate: 0.10,
  catastrophic_rate: 0.02
};

export function gateVerdict(summary, gate = launchGate) {
  const checks = [
    { name: "accept_2", actual: summary.accept_2, required: gate.accept_2, pass: summary.accept_2 >= gate.accept_2, cmp: ">=" },
    { name: "retype_rate", actual: summary.retype_rate, required: gate.retype_rate, pass: summary.retype_rate <= gate.retype_rate, cmp: "<=" },
    { name: "catastrophic_rate", actual: summary.catastrophic_rate, required: gate.catastrophic_rate, pass: summary.catastrophic_rate <= gate.catastrophic_rate, cmp: "<=" }
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

function pct(value) {
  return `${(100 * value).toFixed(1)}%`;
}

export async function main(argv = process.argv.slice(2)) {
  const files = argv.filter((a) => !a.startsWith("--"));
  const gated = argv.includes("--gate");
  if (!files.length) throw new Error("usage: writer-acceptance-eval.mjs <report.json...> [--gate]");

  const rows = [];
  const latencies = [];
  for (const file of files) {
    const report = JSON.parse(await readFile(resolve(file), "utf8"));
    for (const row of report.results || []) {
      const generated = row.final_title;
      const reviewed = row.reviewed_title;
      if (!generated || !reviewed) continue;
      rows.push({ generated, reviewed });
      if (Number.isFinite(row.time_to_writer_ready_ms)) latencies.push(row.time_to_writer_ready_ms);
    }
  }
  if (!rows.length) throw new Error("no scored rows with both a generated and a reviewed title");

  const df = documentFrequency(rows.map((r) => r.reviewed));
  const context = { df, corpusSize: rows.length };
  const cards = rows.map((r) => scoreCard(r.generated, r.reviewed, context));
  const summary = summarize(cards);

  console.log(`cards ${summary.cards}   mean GT length ${summary.mean_gt_length.toFixed(1)} words   mean edits ${summary.mean_edits.toFixed(1)}\n`);
  console.log(`acceptance`);
  console.log(`  usable as written (0 edits)   ${pct(summary.accept_0)}`);
  console.log(`  <=2 edits                     ${pct(summary.accept_2)}`);
  console.log(`  <=4 edits                     ${pct(summary.accept_4)}`);
  console.log(`  faster to retype              ${pct(summary.retype_rate)}`);
  console.log(`\ntrust`);
  console.log(`  names the wrong card          ${pct(summary.catastrophic_rate)}`);
  console.log(`  wrong only in cheap ways      ${pct(summary.cosmetic_only_rate)}`);
  console.log(`\nmissing tokens by repair cost`);
  for (const [k, v] of Object.entries(summary.missing_by_class).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}`);
  }
  if (latencies.length) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    console.log(`\ntime to a title   p50 ${(at(0.5) / 1000).toFixed(1)}s   p95 ${(at(0.95) / 1000).toFixed(1)}s`);
  }

  const worst = cards.filter((c) => c.catastrophic).slice(0, 5);
  if (worst.length) {
    console.log(`\nwrong card (sample):`);
    for (const c of worst) {
      console.log(`    ours: ${c.generated.slice(0, 88)}`);
      console.log(`    gt  : ${c.reviewed.slice(0, 88)}`);
    }
  }

  if (!gated) return 0;
  const verdict = gateVerdict(summary);
  console.log(`\nlaunch gate: ${verdict.pass ? "PASS" : "FAIL"}`);
  for (const c of verdict.checks) {
    console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.name.padEnd(18)} ${pct(c.actual)} ${c.cmp} ${pct(c.required)}`);
  }
  return verdict.pass ? 0 : 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
}
