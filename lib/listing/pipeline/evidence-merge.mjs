// Evidence field merging — extracted from the v2 monolith (R1).
// Copied verbatim; behavior must stay bit-identical.
import { createEvidenceField } from "../evidence/evidence-schema.mjs";

export function hasEvidenceValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

export function evidenceFieldCandidatesWithSources(field = {}) {
  const baseSources = Array.isArray(field.sources) ? field.sources : [];
  const candidates = Array.isArray(field.candidates) && field.candidates.length
    ? field.candidates
    : hasEvidenceValue(field.value)
      ? [{ value: field.value, confidence: field.confidence }]
      : [];

  return candidates
    .filter((candidate) => hasEvidenceValue(candidate?.value))
    .map((candidate) => ({
      value: candidate.value,
      confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : Number(field.confidence || 0),
      sources: Array.isArray(candidate.sources) && candidate.sources.length ? candidate.sources : baseSources
    }));
}

export function evidenceCandidateKey(value) {
  const text = Array.isArray(value) ? value.join(" / ") : value;
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function mergeEvidenceField(fieldName, fields = []) {
  const candidateMap = new Map();
  const conflicts = [];

  fields.forEach((field) => {
    conflicts.push(...(Array.isArray(field?.conflicts) ? field.conflicts : []));
    evidenceFieldCandidatesWithSources(field).forEach((candidate) => {
      const key = evidenceCandidateKey(candidate.value);
      const existing = candidateMap.get(key);
      if (!existing) {
        candidateMap.set(key, {
          value: candidate.value,
          confidence: candidate.confidence,
          sources: [...candidate.sources]
        });
        return;
      }

      existing.confidence = Math.max(existing.confidence, candidate.confidence);
      existing.sources.push(...candidate.sources);
    });
  });

  const candidates = [...candidateMap.values()]
    .map((candidate) => ({
      ...candidate,
      sources: candidate.sources.filter(Boolean)
    }))
    .sort((left, right) => right.confidence - left.confidence);
  const top = candidates[0] || null;
  const distinctValueCount = new Set(candidates.map((candidate) => evidenceCandidateKey(candidate.value))).size;
  const mergedConflicts = [
    ...conflicts,
    ...(distinctValueCount > 1 ? [{
      field: fieldName,
      conflict_type: "MULTI_SOURCE_VALUE_CONFLICT",
      conflicting_values: candidates.map((candidate) => candidate.value),
      severity: "MEDIUM",
      reason: "Recognition and provider evidence produced competing values for this field."
    }] : [])
  ];

  return createEvidenceField({
    value: top?.value ?? null,
    normalizedValue: top?.value ?? null,
    status: mergedConflicts.length ? "CONFLICT" : top?.confidence >= 0.86 ? "CONFIRMED" : "REVIEW",
    confidence: top?.confidence ?? 0,
    candidates,
    sources: candidates.flatMap((candidate) => candidate.sources || []),
    conflicts: mergedConflicts
  });
}
