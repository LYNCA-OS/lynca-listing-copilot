import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  preregister, review, tradeLedger, checkConfounds, instrumentWarnings,
  signTest, STANDING_BAR, MEASURED_DRIFT, PreregistrationError
} from "../lib/listing/evaluation/exploration-review.mjs";

const prereg = (over = {}) => preregister({
  name: "t", hypothesis: "h", mechanism: "m", falsifier: "f", cohort: "c", ...over
});

// A preregistration missing any of the fields that make it one is refused.
// "What would falsify this" is the field that separates an experiment from a
// plan to find supporting evidence, so its absence is an error, not a warning.
for (const field of ["name", "hypothesis", "mechanism", "falsifier", "cohort"]) {
  assert.throws(() => prereg({ [field]: "" }), PreregistrationError,
    `${field} must be required before money is spent`);
  assert.throws(() => prereg({ [field]: "   " }), /preregistration_incomplete/);
}

// A review cannot be improvised. A bar chosen after seeing the result is not
// a bar, so the framework refuses rather than inventing one.
assert.throws(() => review({ controlScores: [1], treatmentScores: [1] }),
  /review_without_preregistration/);

// The trade ledger names the shape, not just the sign. This is the case the
// framework exists for: an arm that gained on the very dimension it targeted
// and still lost, because it bought one right answer for two wrong ones.
{
  const [bought] = tradeLedger([
    { name: "finish", support: 22, control_hits: 11, treatment_hits: 12, control_errors: 3, treatment_errors: 5 }
  ]);
  assert.equal(bought.gained, 1);
  assert.equal(bought.cost, 2);
  assert.equal(bought.verdict, "BOUGHT_TOO_DEAR");
  assert.equal(bought.free, false);

  const [free] = tradeLedger([
    { name: "components", support: 29, control_hits: 25, treatment_hits: 26, control_errors: 6, treatment_errors: 6 }
  ]);
  assert.equal(free.verdict, "FREE");
  assert.equal(free.free, true);
}

// Both arms silently running the same configuration has happened here and
// still produced clean-looking numbers. Served values are read back.
{
  const problems = checkConfounds([{
    control: { served_effort: "low", served_model: "m", image_detail: "high" },
    treatment: { served_effort: "medium", served_model: "m", image_detail: "high" }
  }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /effort differs/);
  assert.deepEqual(checkConfounds([{
    control: { served_effort: "low", served_model: "m", image_detail: "high" },
    treatment: { served_effort: "low", served_model: "m", image_detail: "high" }
  }]), []);
}

// Extreme values are the shape a broken detector produces, and every
// instrument error in this repository announced itself this way.
{
  const w = instrumentWarnings({ touched: { value: 0 }, hit: { value: 5, total: 5 }, pop: { value: 0, total: 0 } });
  assert.ok(w.some((m) => /exactly 0/.test(m)));
  assert.ok(w.some((m) => /exactly 5\/5/.test(m)));
  assert.ok(w.some((m) => /empty denominator/.test(m)));
}

assert.ok(Math.abs(signTest(19, 4) - 0.0026) < 0.0005);
assert.equal(signTest(0, 0), 1);

// The ruler is FIXED, not checked per run. There is exactly one scorer, so
// there is nothing to compare against; what matters is that everything imports
// the same module, and that is asserted structurally below rather than
// re-verified on every exploration.
{
  const modules = await readFile("lib/listing/evaluation/exploration-review.mjs", "utf8");
  assert.doesNotMatch(modules, /rulerBaseline/,
    "the ruler is fixed by there being one of it; a per-run currency check is theatre");
}

// The standing bar, both clauses, and the keepable-parts rule.
{
  const sweep = review({
    prereg: prereg(),
    controlScores: Array(10).fill(0.8),
    treatmentScores: Array(10).fill(0.81)
  });
  assert.equal(sweep.headline.wins, 10);
  assert.equal(sweep.verdict, "SHIP", "10W/0L clears the clean-sweep clause");

  // Negative overall, but one dimension is free and well supported: keep parts.
  const mixed = review({
    prereg: prereg(),
    controlScores: [0.9, 0.9, 0.8], treatmentScores: [0.8, 0.8, 0.9],
    dimensions: [
      { name: "components", support: 29, control_hits: 25, treatment_hits: 26, control_errors: 6, treatment_errors: 6 },
      { name: "finish", support: 21, control_hits: 10, treatment_hits: 11, control_errors: 4, treatment_errors: 6 }
    ]
  });
  assert.equal(mixed.verdict, "REJECT_WHOLE_KEEP_PARTS");
  assert.deepEqual(mixed.keepable.map((d) => d.name), ["components"]);

  // The same free dimension below the support threshold is NOT keepable.
  // Fitting a rule to a +1-of-6 improvement is the mistake this repository
  // has made repeatedly, so the threshold is enforced rather than advised.
  const thin = review({
    prereg: prereg(),
    controlScores: [0.9, 0.9], treatmentScores: [0.8, 0.8],
    dimensions: [{ name: "components", support: 6, control_hits: 3, treatment_hits: 4, control_errors: 1, treatment_errors: 1 }]
  });
  assert.equal(thin.verdict, "REJECT");
  assert.deepEqual(thin.keepable, []);
  assert.deepEqual(thin.keepable_but_unsupported.map((d) => d.name), ["components"]);
}

// An effect smaller than measured run-to-run drift is flagged however its
// p-value reads: it cannot be told apart from the same arm run twice.
{
  const r = review({
    prereg: prereg(),
    controlScores: [0.80, 0.80], treatmentScores: [0.801, 0.801]
  });
  assert.equal(r.below_drift, true);
  assert.ok(MEASURED_DRIFT > 0.005);
}

// A rejection must be recorded somewhere, never silently dropped -- the
// rejected-mechanism list is what stops an idea being re-tried every quarter.
{
  const r = review({ prereg: prereg(), controlScores: [0.9], treatmentScores: [0.8] });
  assert.equal(r.verdict, "REJECT");
  assert.ok(r.record_rejection_in, "a rejection names where it must be written down");
}

// The ceiling travels with the review, so an exploration that captured a
// sliver of its own upside is visible as such rather than as a small win.
{
  const r = review({
    prereg: prereg({ ceiling: 0.04 }),
    controlScores: Array(10).fill(0.8), treatmentScores: Array(10).fill(0.804)
  });
  assert.ok(Math.abs(r.captured_share - 0.1) < 1e-9, "4/40 of the ceiling was captured");
}

assert.equal(STANDING_BAR.clean_sweep.min_wins, 8);
assert.equal(STANDING_BAR.significant.max_p, 0.05);

// The dimensions live in the shared implementation, so the automatic path and
// the manual one cannot disagree about what gets reviewed.
const runner = await readFile("scripts/auto-review-run.mjs", "utf8");
assert.match(runner, /转录 serial/, "transcription is a ledger dimension, not an afterthought");
assert.match(runner, /DIMENSIONS/, "dimensions are computed by the runner, not supplied by the caller");
assert.doesNotMatch(runner, /process\.env\.OPENAI_API_KEY/, "a review must never spend money");

// The review must run WITHOUT anyone remembering to run it. This is the whole
// point: every failure the framework is built from was a review that did not
// happen because nobody thought to do it.
const harness = await readFile("scripts/run-thin-path-eval.mjs", "utf8");
assert.match(harness, /runAutoReview/, "the harness must review its own run when it finishes");
assert.match(harness, /自动复盘未能生成/,
  "a failed review must never lose the run: the artifact is already on disk");

// One implementation, two entry points, so they cannot drift apart.
const manual = await readFile("scripts/review-exploration.mjs", "utf8");
assert.match(manual, /auto-review-run\.mjs/,
  "the manual entry point must reuse the automatic implementation, not copy it");

process.stdout.write("exploration review: ok\n");
