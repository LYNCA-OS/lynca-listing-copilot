import assert from "node:assert/strict";
import { perCardStdDev, runsRequired, samplePlan, standardErrorFor } from "./eval-sample-size.mjs";

// A run mean over 20 cards has sd = per-card sd / sqrt(20); invert that.
assert.ok(Math.abs(perCardStdDev(0.0456, 20) - 0.2039) < 0.001);
assert.equal(perCardStdDev(0, 20), null);

// More cards and more runs both shrink the standard error.
const se20 = standardErrorFor({ perCardSd: 0.2039, cardsPerRun: 20, runs: 3 });
const se100 = standardErrorFor({ perCardSd: 0.2039, cardsPerRun: 100, runs: 3 });
assert.ok(se100 < se20);

// The measured reality: 20 cards cannot decide a 0.02 change in a few runs.
assert.ok(runsRequired({ perCardSd: 0.2039, cardsPerRun: 20, detectable: 0.02 }) > 20);
// A bigger deck needs far fewer repeats for the same power.
assert.ok(runsRequired({ perCardSd: 0.2039, cardsPerRun: 200, detectable: 0.02 }) <= 6);
// Total work is roughly conserved -- the deck/run split is a scheduling choice.
const plan = samplePlan({ detectable: 0.02 });
const totals = plan.options.map((o) => o.total_card_evaluations).filter(Boolean);
assert.ok(Math.max(...totals) / Math.min(...totals) < 2);

console.log("eval sample size tests passed");
