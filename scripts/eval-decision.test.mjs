import assert from "node:assert/strict";
import {
  decisionVerdicts,
  evaluateChange,
  median,
  stdDev,
  standardError
} from "./eval-decision.mjs";

assert.equal(median([1, 2, 3]), 2);
assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(stdDev([5]), null, "one run cannot estimate spread");
assert.ok(Math.abs(stdDev([0.786539, 0.764194]) - 0.0158) < 0.001);

// Fewer than three runs a side is not a decision, it is a guess.
assert.equal(
  evaluateChange({ baselineScores: [0.76, 0.78], candidateScores: [0.79, 0.80] }).verdict,
  decisionVerdicts.INSUFFICIENT_DATA
);

// The exact trap hit on 2026-07-25: identical-configuration cold-20 runs came
// back 0.786539 and 0.764194, so the run-to-run spread is ~0.022 -- wider than
// the +0.0267 the change claimed once you account for both sides. A delta of
// that size against this much noise is not evidence.
const noisy = evaluateChange({
  baselineScores: [0.7598, 0.7865, 0.7642],
  candidateScores: [0.7788, 0.7642, 0.7901]
});
assert.equal(noisy.verdict, decisionVerdicts.NOT_PROVEN);
assert.equal(noisy.keep, false);

// A change that clearly clears the noise floor is accepted.
const real = evaluateChange({
  baselineScores: [0.760, 0.762, 0.761],
  candidateScores: [0.840, 0.845, 0.842]
});
assert.equal(real.verdict, decisionVerdicts.IMPROVED);
assert.equal(real.keep, true);

// A real regression is named as one, not left ambiguous.
const worse = evaluateChange({
  baselineScores: [0.840, 0.845, 0.842],
  candidateScores: [0.760, 0.762, 0.761]
});
assert.equal(worse.verdict, decisionVerdicts.REGRESSED);
assert.equal(worse.keep, false);

// Raising the sigma multiple only ever makes the gate stricter: the same small
// delta that clears 2x must fail a demanding multiple, never the reverse.
const marginalArgs = {
  baselineScores: [0.760, 0.762, 0.761],
  candidateScores: [0.766, 0.769, 0.767]
};
assert.equal(evaluateChange({ ...marginalArgs, sigmaMultiple: 2 }).verdict, decisionVerdicts.IMPROVED);
assert.equal(evaluateChange({ ...marginalArgs, sigmaMultiple: 8 }).verdict, decisionVerdicts.NOT_PROVEN);

assert.ok(standardError([0.76, 0.77, 0.78]) < stdDev([0.76, 0.77, 0.78]));

console.log("eval decision tests passed");
