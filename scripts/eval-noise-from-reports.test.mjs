import assert from "node:assert/strict";
import { betweenCardSd, pairedCardsRequired, sd, withinCardSd } from "./eval-noise-from-reports.mjs";

assert.equal(sd([1]), null, "one sample cannot estimate spread");
assert.ok(Math.abs(sd([1, 2, 3]) - 1) < 1e-9);

// Same card, same score every repeat: no provider noise, only difficulty spread.
const stable = [
  new Map([["a", 0.9], ["b", 0.5]]),
  new Map([["a", 0.9], ["b", 0.5]])
];
assert.equal(withinCardSd(stable).sd, 0);
assert.ok(betweenCardSd(stable).sd > 0.2, "difficulty spread survives averaging");

// A deck of identical-difficulty cards that still swing between repeats: the
// difficulty term vanishes and only provider noise remains. This is the case
// that comparing run means cannot see. Averaging needs enough repeats to cancel
// -- with only two, residual noise leaks into the per-card means.
const noisy = [
  new Map([["a", 0.6], ["b", 0.6]]),
  new Map([["a", 0.8], ["b", 0.4]]),
  new Map([["a", 0.4], ["b", 0.8]])
];
assert.equal(betweenCardSd(noisy).sd, 0);
assert.ok(withinCardSd(noisy).sd > 0.1);

// Sensitivity scales as the square of the ratio, so halving the detectable
// difference costs four times the cards.
const coarse = pairedCardsRequired(0.1338, 0.04);
const fine = pairedCardsRequired(0.1338, 0.02);
assert.ok(fine / coarse > 3.5 && fine / coarse < 4.5);
assert.equal(pairedCardsRequired(0, 0.02), null);

console.log("eval noise decomposition tests passed");
