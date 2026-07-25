// Accept/reject arithmetic for accuracy changes.
//
// Why this exists: two identical-configuration cold-20 runs on 2026-07-25
// scored 0.786539 and 0.764194 -- a 0.0223 spread -- while the change under
// test claimed +0.0267. A single 20-card run therefore cannot separate a real
// improvement from provider nondeterminism, and we shipped a prompt edit based
// on one card that turned out to be a regression.
//
// The rule this encodes: a change is only a positive asset when its effect
// clears the noise floor measured from repeated runs of the *same* build.
// Anything else is "not proven" and reverts, rather than being argued about.

export function mean(values = []) {
  const list = values.filter((value) => Number.isFinite(value));
  if (!list.length) return null;
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

export function median(values = []) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

// Sample standard deviation (n-1): we are estimating run-to-run spread from a
// handful of runs, not describing a fixed population.
export function stdDev(values = []) {
  const list = values.filter((value) => Number.isFinite(value));
  if (list.length < 2) return null;
  const avg = mean(list);
  const variance = list.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (list.length - 1);
  return Math.sqrt(variance);
}

export function standardError(values = []) {
  const sd = stdDev(values);
  const n = values.filter((value) => Number.isFinite(value)).length;
  if (sd === null || n < 2) return null;
  return sd / Math.sqrt(n);
}

export const decisionVerdicts = Object.freeze({
  IMPROVED: "IMPROVED",
  REGRESSED: "REGRESSED",
  NOT_PROVEN: "NOT_PROVEN",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA"
});

/**
 * Compare a candidate build against a baseline using repeated runs of each.
 *
 * `minRuns` defaults to 3 because two runs give a standard deviation with no
 * confidence at all. `sigmaMultiple` defaults to 2: the delta must clear twice
 * the combined standard error before we call it real.
 */
export function evaluateChange({
  baselineScores = [],
  candidateScores = [],
  minRuns = 3,
  sigmaMultiple = 2
} = {}) {
  const baseline = baselineScores.filter((value) => Number.isFinite(value));
  const candidate = candidateScores.filter((value) => Number.isFinite(value));
  if (baseline.length < minRuns || candidate.length < minRuns) {
    return {
      verdict: decisionVerdicts.INSUFFICIENT_DATA,
      reason: `need >=${minRuns} runs per side; have ${baseline.length} baseline / ${candidate.length} candidate`,
      baseline_runs: baseline.length,
      candidate_runs: candidate.length
    };
  }

  const baselineMedian = median(baseline);
  const candidateMedian = median(candidate);
  const delta = candidateMedian - baselineMedian;
  const baselineSe = standardError(baseline) ?? 0;
  const candidateSe = standardError(candidate) ?? 0;
  const combinedSe = Math.sqrt((baselineSe ** 2) + (candidateSe ** 2));
  const threshold = sigmaMultiple * combinedSe;

  const verdict = Math.abs(delta) <= threshold
    ? decisionVerdicts.NOT_PROVEN
    : delta > 0
      ? decisionVerdicts.IMPROVED
      : decisionVerdicts.REGRESSED;

  return {
    verdict,
    // A change that cannot beat the noise floor is reverted, not kept "because
    // the average went up".
    keep: verdict === decisionVerdicts.IMPROVED,
    delta,
    threshold,
    baseline_median: baselineMedian,
    candidate_median: candidateMedian,
    baseline_mean: mean(baseline),
    candidate_mean: mean(candidate),
    baseline_sd: stdDev(baseline),
    candidate_sd: stdDev(candidate),
    combined_standard_error: combinedSe,
    sigma_multiple: sigmaMultiple,
    baseline_runs: baseline.length,
    candidate_runs: candidate.length
  };
}

export function formatDecision(result = {}) {
  if (result.verdict === decisionVerdicts.INSUFFICIENT_DATA) {
    return `INSUFFICIENT_DATA — ${result.reason}`;
  }
  const pct = (value) => (value === null || value === undefined ? "n/a" : value.toFixed(4));
  return [
    `${result.verdict} (keep=${result.keep === true})`,
    `  baseline  median=${pct(result.baseline_median)} mean=${pct(result.baseline_mean)} sd=${pct(result.baseline_sd)} n=${result.baseline_runs}`,
    `  candidate median=${pct(result.candidate_median)} mean=${pct(result.candidate_mean)} sd=${pct(result.candidate_sd)} n=${result.candidate_runs}`,
    `  delta=${pct(result.delta)} must exceed ${pct(result.threshold)} (${result.sigma_multiple}x combined SE)`
  ].join("\n");
}
