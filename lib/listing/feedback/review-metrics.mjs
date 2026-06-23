import { reviewOutcomes } from "./review-records.mjs";

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row) || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function rate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

export function summarizeReviewMetrics(reviews = []) {
  const rows = Array.isArray(reviews) ? reviews : [];
  const total = rows.length;
  const byOutcome = countBy(rows, (row) => row.review_outcome);
  const correctedFields = rows.filter((row) => row.review_outcome === reviewOutcomes.CORRECTED_FIELDS);
  const titleOnly = rows.filter((row) => row.review_outcome === reviewOutcomes.TITLE_ONLY_OVERRIDE);
  const acceptedUnchanged = rows.filter((row) => row.review_outcome === reviewOutcomes.ACCEPTED_UNCHANGED);
  const fieldCorrectionCounts = {};

  correctedFields.forEach((row) => {
    (row.field_changes || []).forEach((change) => {
      fieldCorrectionCounts[change.field] = (fieldCorrectionCounts[change.field] || 0) + 1;
    });
  });

  const reviewDurations = rows
    .map((row) => Number(row.review_duration_ms))
    .filter((value) => Number.isFinite(value));
  const averageReviewDurationMs = reviewDurations.length
    ? reviewDurations.reduce((sum, value) => sum + value, 0) / reviewDurations.length
    : null;

  return {
    total_reviews: total,
    by_outcome: byOutcome,
    accepted_unchanged_rate: rate(acceptedUnchanged.length, total),
    field_correction_rate: rate(correctedFields.length, total),
    title_only_override_rate: rate(titleOnly.length, total),
    average_review_duration_ms: averageReviewDurationMs,
    field_correction_counts: fieldCorrectionCounts
  };
}
