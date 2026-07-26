#!/usr/bin/env node
// Estimate benchmark noise from reports that already exist -- no provider calls.
//
//   node scripts/eval-noise-from-reports.mjs <report.json> [more.json ...]
//
// Comparing run means throws away most of the information in a run and mixes
// two very different sources of variation:
//
//   between-card : cards differ in difficulty. With a fixed deck this is
//                  identical on both sides of a comparison and cancels, but it
//                  dominates the spread of a run mean, so it inflates any
//                  noise estimate built from run means.
//   within-card  : the same card scored twice differs because the provider is
//                  nondeterministic. This is the only noise a fixed-deck
//                  before/after comparison actually has to beat.
//
// Pairing per card removes the between-card term, so a paired design needs far
// fewer samples than comparing means -- and both quantities can be read off
// stored reports for free.

import { readFile } from "node:fs/promises";

const scoreOf = (row) => row?.final_scoring?.policy_fair_token_recall
  ?? row?.final_scoring?.fair_token_recall ?? null;
const keyOf = (row) => row?.sealed_label_key || row?.asset_id || null;

export function sd(values = []) {
  const list = values.filter((value) => Number.isFinite(value));
  if (list.length < 2) return null;
  const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
  return Math.sqrt(list.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (list.length - 1));
}

export function scoresByCard(report = {}) {
  const map = new Map();
  for (const row of report.results || []) {
    const key = keyOf(row);
    const score = scoreOf(row);
    if (key && Number.isFinite(score)) map.set(key, score);
  }
  return map;
}

/**
 * Within-card (test-retest) sd, pooled across every pair of runs of the same
 * configuration. For each card the differences across repeats estimate 2x the
 * within-card variance, so the pooled sd divides it back out.
 */
export function withinCardSd(runs = []) {
  const diffs = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      for (const [key, left] of runs[i]) {
        const right = runs[j].get(key);
        if (Number.isFinite(right)) diffs.push(left - right);
      }
    }
  }
  if (diffs.length < 2) return { sd: null, pairs: diffs.length };
  // sd of a difference of two independent draws = sqrt(2) * per-observation sd
  const diffSd = sd(diffs);
  return { sd: diffSd === null ? null : diffSd / Math.SQRT2, pairs: diffs.length };
}

export function betweenCardSd(runs = []) {
  // Average each card over its repeats first, so provider noise does not leak
  // into the difficulty spread.
  const perCard = new Map();
  for (const run of runs) {
    for (const [key, score] of run) {
      const entry = perCard.get(key) || [];
      entry.push(score);
      perCard.set(key, entry);
    }
  }
  const means = [...perCard.values()].map((list) => list.reduce((a, b) => a + b, 0) / list.length);
  return { sd: sd(means), cards: means.length };
}

/** Cards needed for a paired before/after comparison at a target sensitivity. */
export function pairedCardsRequired(withinSd, detectable = 0.02, sigmaMultiple = 2) {
  if (!(withinSd > 0)) return null;
  // Paired difference per card has sd = sqrt(2) * withinSd.
  const diffSd = Math.SQRT2 * withinSd;
  // Need sigmaMultiple * diffSd / sqrt(n) <= detectable.
  return Math.ceil(((sigmaMultiple * diffSd) / detectable) ** 2);
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length) {
    console.error("Usage: eval-noise-from-reports.mjs <report.json> [more.json ...]");
    return 1;
  }
  const runs = [];
  for (const path of argv) {
    const report = JSON.parse(await readFile(path, "utf8"));
    const map = scoresByCard(report);
    if (map.size) runs.push(map);
    console.log(`  ${path.split("/").pop().padEnd(28)} cards=${map.size}`);
  }
  if (runs.length < 2) {
    console.error("\nNeed at least two reports of the same configuration.");
    return 1;
  }

  const within = withinCardSd(runs);
  const between = betweenCardSd(runs);
  const runMeans = runs.map((run) => [...run.values()].reduce((a, b) => a + b, 0) / run.size);

  console.log(`\nrun means            : ${runMeans.map((value) => value.toFixed(4)).join(", ")}`);
  console.log(`run-mean sd          : ${sd(runMeans)?.toFixed(4) ?? "n/a"}   <- what comparing means fights`);
  console.log(`between-card sd      : ${between.sd?.toFixed(4) ?? "n/a"} over ${between.cards} cards`);
  console.log(`within-card sd       : ${within.sd?.toFixed(4) ?? "n/a"} from ${within.pairs} repeat pairs  <- the real noise`);

  for (const detectable of [0.01, 0.02, 0.03, 0.05]) {
    const cards = pairedCardsRequired(within.sd, detectable);
    console.log(`  paired cards to detect ${detectable.toFixed(2)}: ${cards ?? "n/a"}`);
  }
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
