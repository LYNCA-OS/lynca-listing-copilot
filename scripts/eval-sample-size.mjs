// How big must an accuracy benchmark be to decide anything?
//
// Measured on 2026-07-25: three identical-configuration runs of the fixed-20
// cold benchmark scored 0.767132, 0.800806 and 0.710539 -- a per-run standard
// deviation of 0.0456 on a 20-card mean. At that spread a single run cannot
// distinguish a 0.02 change from noise, which is how a prompt edit that later
// measured worse got shipped as an improvement.
//
// Two levers reduce the standard error of the estimate:
//   * more cards per run  -- the per-run mean averages more independent cards
//   * more runs           -- averaging repeats of the same configuration
// Both shrink SE as 1/sqrt(n), so this module converts a target detectable
// difference into the (cards, runs) combinations that actually reach it.

// Variance of a per-card score implied by an observed per-run standard
// deviation: the run mean averages `cardsPerRun` independent cards, so the
// per-card sd is sqrt(cardsPerRun) larger than the run-level sd.
export function perCardStdDev(runStdDev, cardsPerRun) {
  if (!(runStdDev > 0) || !(cardsPerRun > 0)) return null;
  return runStdDev * Math.sqrt(cardsPerRun);
}

export function standardErrorFor({ perCardSd, cardsPerRun, runs }) {
  if (!(perCardSd > 0) || !(cardsPerRun > 0) || !(runs > 0)) return null;
  // Total independent card observations across the repeated runs.
  return perCardSd / Math.sqrt(cardsPerRun * runs);
}

/**
 * Smallest number of runs at a given deck size that makes `detectable` clear
 * `sigmaMultiple` standard errors on both sides of a comparison.
 */
export function runsRequired({
  perCardSd,
  cardsPerRun,
  detectable = 0.02,
  sigmaMultiple = 2,
  maxRuns = 200
}) {
  for (let runs = 1; runs <= maxRuns; runs += 1) {
    const se = standardErrorFor({ perCardSd, cardsPerRun, runs });
    // Comparing two arms: each contributes its own error.
    const combined = Math.sqrt(2) * se;
    if (sigmaMultiple * combined <= detectable) return runs;
  }
  return null;
}

export function samplePlan({
  observedRunSd = 0.0456,
  observedCardsPerRun = 20,
  detectable = 0.02,
  sigmaMultiple = 2,
  deckSizes = [20, 50, 100, 200, 400]
} = {}) {
  const perCardSd = perCardStdDev(observedRunSd, observedCardsPerRun);
  return {
    observed_run_sd: observedRunSd,
    observed_cards_per_run: observedCardsPerRun,
    per_card_sd: perCardSd,
    detectable,
    sigma_multiple: sigmaMultiple,
    options: deckSizes.map((cardsPerRun) => {
      const runs = runsRequired({ perCardSd, cardsPerRun, detectable, sigmaMultiple });
      return {
        cards_per_run: cardsPerRun,
        runs_required: runs,
        total_card_evaluations: runs === null ? null : runs * cardsPerRun
      };
    })
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const detectable = Number(process.argv[2] || "0.02");
  const plan = samplePlan({ detectable });
  console.log(`observed per-run sd = ${plan.observed_run_sd} on ${plan.observed_cards_per_run} cards`);
  console.log(`implied per-card sd = ${plan.per_card_sd.toFixed(4)}`);
  console.log(`\nto detect a ${detectable} difference at ${plan.sigma_multiple}x SE (per arm):\n`);
  console.log("  cards/run   runs   total card evaluations");
  for (const option of plan.options) {
    console.log(`  ${String(option.cards_per_run).padStart(9)}   ${String(option.runs_required ?? ">200").padStart(4)}   ${String(option.total_card_evaluations ?? "-").padStart(10)}`);
  }
}
