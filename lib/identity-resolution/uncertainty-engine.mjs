import { clamp01 } from "./types.mjs";

function severityWeight(severity) {
  if (severity === "HIGH") return 1;
  if (severity === "MEDIUM") return 0.65;
  if (severity === "LOW") return 0.3;
  return 0.2;
}

function normalizedEntropy(candidates = []) {
  const valid = candidates.filter((candidate) => candidate.constraint_result?.valid !== false);
  if (!valid.length) return 1;
  if (valid.length === 1) return 0;

  const weights = valid.map((candidate) => Math.max(0.001, Number(candidate.score || 0)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!total) return 1;

  const entropy = weights.reduce((sum, value) => {
    const probability = value / total;
    return sum - probability * Math.log(probability);
  }, 0);

  return clamp01(entropy / Math.log(valid.length));
}

function evidenceDispersion(candidates = []) {
  if (!candidates.length) return 1;

  const values = new Set(candidates.map((candidate) => candidate.key).filter(Boolean));
  const sources = new Set(candidates.flatMap((candidate) => candidate.evidence_items || []).map((item) => item.source));
  const validCount = candidates.filter((candidate) => candidate.constraint_result?.valid !== false).length;
  const invalidCount = candidates.length - validCount;

  const valueDispersion = values.size <= 1 ? 0 : Math.min(1, (values.size - 1) / 3);
  const sourceDispersion = sources.size <= 1 ? 0 : Math.min(1, (sources.size - 1) / 4);
  const invalidDispersion = candidates.length ? invalidCount / candidates.length : 0;

  return clamp01((valueDispersion * 0.55) + (sourceDispersion * 0.25) + (invalidDispersion * 0.2));
}

function conflictIntensity(conflicts = []) {
  if (!conflicts.length) return 0;
  const maxSeverity = Math.max(...conflicts.map((conflict) => severityWeight(conflict.severity)));
  const unresolved = conflicts.some((conflict) => conflict.resolved !== true) ? 0.2 : 0;
  const volume = Math.min(0.2, conflicts.length * 0.05);
  return clamp01(maxSeverity + unresolved + volume);
}

export function calculateFieldUncertainty({
  candidates = [],
  conflicts = [],
  selected = null,
  options = {}
} = {}) {
  const entropy = normalizedEntropy(candidates);
  const intensity = conflictIntensity(conflicts);
  const dispersion = evidenceDispersion(candidates);
  const selectedConfidence = selected ? clamp01(selected.score) : 0;
  const missingValuePenalty = selected ? 0 : 0.25;
  const lowConfidencePenalty = selected ? clamp01(1 - selectedConfidence) * 0.15 : 0;
  const score = clamp01(
    (entropy * 0.36)
    + (intensity * 0.34)
    + (dispersion * 0.2)
    + missingValuePenalty
    + lowConfidencePenalty
  );
  const highConflictHighUncertainty = intensity >= (options.abstainConflictIntensityThreshold ?? 0.75)
    && entropy >= (options.abstainEntropyThreshold ?? 0.55);

  return {
    entropy: Number(entropy.toFixed(4)),
    conflict_intensity: Number(intensity.toFixed(4)),
    evidence_dispersion: Number(dispersion.toFixed(4)),
    uncertainty_score: Number(score.toFixed(4)),
    high_conflict_high_uncertainty: highConflictHighUncertainty
  };
}
