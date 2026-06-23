import {
  createEvidenceField,
  normalizeResolvedFields,
  resolvedFieldNames
} from "../evidence/evidence-schema.mjs";

const ignoredFieldNames = new Set([
  "marketplace_item_id",
  "marketplace_id",
  "marketplace_condition",
  "marketplace_price",
  "marketplace_buying_options",
  "checklist_code_prefixes"
]);

const referenceOnlySourceTypes = new Set([
  "MARKETPLACE",
  "OPEN_WEB"
]);

const strongSourceTypes = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_PRODUCT_PAGE",
  "OFFICIAL_GRADING_DATA",
  "STRUCTURED_DATABASE"
]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeComparable).filter(Boolean).sort().join("|");
  }

  return normalizeText(value).toLowerCase();
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function normalizeComparableField(fieldName, value) {
  if (fieldName === "serial_number") return normalizeSerial(value) || normalizeComparable(value);
  if (["grade_company", "brand", "manufacturer"].includes(fieldName)) return normalizeComparable(value).toUpperCase();
  return normalizeComparable(value);
}

function fieldHasValue(fields = {}, fieldName) {
  const value = fields[fieldName];
  if (fieldName === "grade_type") return value && value !== "UNKNOWN";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function valuesEqual(left, right, fieldName = "") {
  return normalizeComparableField(fieldName, left) === normalizeComparableField(fieldName, right);
}

function valuesCompatible(left, right, fieldName = "") {
  const leftKey = normalizeComparableField(fieldName, left);
  const rightKey = normalizeComparableField(fieldName, right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  if (!["year", "product", "set", "subset", "card_type", "insert", "parallel", "variation"].includes(fieldName)) return false;
  return leftKey.includes(rightKey) || rightKey.includes(leftKey);
}

function moreSpecificValue(left, right, fieldName = "") {
  if (!valuesCompatible(left, right, fieldName)) return right;
  return normalizeComparableField(fieldName, right).length >= normalizeComparableField(fieldName, left).length ? right : left;
}

function candidateConfidence(candidate = {}, strong = false) {
  const score = Number(candidate.match_score || 0);
  if (score > 0) return Math.max(strong ? 0.86 : 0.74, Math.min(0.95, score));
  return strong ? 0.9 : 0.74;
}

function sourceFromCandidate(candidate = {}) {
  return {
    source_type: candidate.source_type || "OPEN_WEB",
    source_url: candidate.source_url || "",
    domain: candidate.domain || "",
    title: candidate.title || "",
    evidence_excerpt: candidate.evidence_excerpt || "",
    retrieved_at: candidate.retrieved_at || null,
    trust_tier: Number(candidate.trust_tier || 9)
  };
}

function normalizeCandidateFields(candidate = {}) {
  const rawFields = candidate.fields && typeof candidate.fields === "object"
    ? candidate.fields
    : {};
  const normalized = {};

  Object.entries(rawFields).forEach(([key, value]) => {
    if (ignoredFieldNames.has(key)) return;
    if (value === null || value === undefined || value === "") return;

    const fieldName = key === "player" ? "players" : key;
    if (!resolvedFieldNames.includes(fieldName)) return;

    if (fieldName === "players") {
      normalized.players = Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [normalizeText(value)].filter(Boolean);
      return;
    }

    if (Array.isArray(value)) {
      normalized[fieldName] = value.map(normalizeText).filter(Boolean);
      return;
    }

    if (typeof value === "boolean") {
      if (value) normalized[fieldName] = value;
      return;
    }

    normalized[fieldName] = normalizeText(value);
  });

  return normalizeResolvedFields(normalized);
}

function candidateIsGroundTruthEligible(candidate = {}) {
  if (referenceOnlySourceTypes.has(candidate.source_type)) return false;
  return Number(candidate.trust_tier || 9) <= 5;
}

function candidateIsStrong(candidate = {}) {
  return strongSourceTypes.has(candidate.source_type) || Number(candidate.trust_tier || 9) <= 4;
}

function independentSourceKey(candidate = {}) {
  const domain = normalizeText(candidate.domain).toLowerCase();
  if (domain) return `${candidate.source_type || "UNKNOWN"}|${domain}`;
  if (candidate.source_url) return `${candidate.source_type || "UNKNOWN"}|${candidate.source_url}`;
  return `${candidate.source_type || "UNKNOWN"}|${candidate.candidate_id || candidate.title || "unknown"}`;
}

function appendSource(evidenceField, source) {
  const existing = Array.isArray(evidenceField?.sources) ? evidenceField.sources : [];
  const key = `${source.source_type}|${source.source_url}|${source.title}`;
  const alreadyPresent = existing.some((item) => `${item.source_type}|${item.source_url || ""}|${item.title || ""}` === key);
  return alreadyPresent ? existing : [...existing, source];
}

function currentFieldProtectedFromTrustedOverride(fieldName, existingField = {}) {
  if (!existingField || existingField.status === "MANUAL_CONFIRMED") return existingField?.status === "MANUAL_CONFIRMED";
  const sources = Array.isArray(existingField.sources) ? existingField.sources : [];
  return sources.some((source) => {
    const sourceType = source.source_type || source.source || "";
    if (sourceType === "SLAB_LABEL") return true;
    if (["grade_company", "card_grade", "auto_grade", "grade_type"].includes(fieldName) && /SLAB|GRAD/i.test(sourceType)) return true;
    return false;
  });
}

function trustedCandidateCanOverrideCurrent(fieldName, existingField = {}, candidate = {}) {
  if (!candidateIsStrong(candidate)) return false;
  if (currentFieldProtectedFromTrustedOverride(fieldName, existingField)) return false;
  if (Array.isArray(candidate.conflicting_fields) && candidate.conflicting_fields.length) return false;
  if (Number(candidate.match_score || 0) < 0.62) return false;
  const anchorMatches = (Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [])
    .filter((field) => field && field !== fieldName);
  if (anchorMatches.length < 2) return false;
  return ["INTERNAL_APPROVED_HISTORY", "OFFICIAL_CHECKLIST", "OFFICIAL_PRODUCT_PAGE", "OFFICIAL_GRADING_DATA", "STRUCTURED_DATABASE"].includes(candidate.source_type)
    || Number(candidate.trust_tier || 9) <= 3;
}

function withConflict(existingField, {
  fieldName,
  existingValue,
  candidateValue,
  candidate,
  source
}) {
  const conflicts = [
    ...(Array.isArray(existingField?.conflicts) ? existingField.conflicts : []),
    {
      field: fieldName,
      existing_value: existingValue,
      candidate_value: candidateValue,
      source_type: candidate.source_type,
      source_url: candidate.source_url || "",
      reason: "trusted retrieval candidate conflicts with current resolved field"
    }
  ];

  return createEvidenceField({
    value: existingValue,
    normalizedValue: existingValue,
    status: "CONFLICT",
    confidence: Math.min(Number(existingField?.confidence || 0.5), 0.5),
    candidates: [
      ...(Array.isArray(existingField?.candidates) ? existingField.candidates : []),
      {
        value: candidateValue,
        confidence: candidateConfidence(candidate, candidateIsStrong(candidate))
      }
    ],
    sources: appendSource(existingField, source),
    conflicts,
    unresolvedReason: "trusted_retrieval_conflict"
  });
}

function marketplaceReferenceFields(candidates = []) {
  const references = {};

  candidates.forEach((candidate) => {
    if (!referenceOnlySourceTypes.has(candidate.source_type)) return;
    const fields = normalizeCandidateFields(candidate);
    Object.entries(fields).forEach(([fieldName, value]) => {
      if (!resolvedFieldNames.includes(fieldName) || !fieldHasValue(fields, fieldName)) return;
      if (!references[fieldName]) references[fieldName] = [];
      references[fieldName].push({
        value,
        source_url: candidate.source_url || "",
        title: candidate.title || "",
        source_type: candidate.source_type,
        trust_tier: Number(candidate.trust_tier || 9)
      });
    });
  });

  return references;
}

function trustedCandidateFieldGroups(candidates = []) {
  const groups = {};

  candidates.forEach((candidate) => {
    if (!candidateIsGroundTruthEligible(candidate)) return;
    const fields = normalizeCandidateFields(candidate);

    Object.entries(fields).forEach(([fieldName, value]) => {
      if (!resolvedFieldNames.includes(fieldName) || !fieldHasValue(fields, fieldName)) return;

      const valueKey = normalizeComparable(value);
      groups[fieldName] ||= {};
      groups[fieldName][valueKey] ||= {
        value,
        entries: []
      };
      groups[fieldName][valueKey].entries.push({
        candidate,
        source: sourceFromCandidate(candidate),
        source_key: independentSourceKey(candidate),
        confidence: candidateConfidence(candidate, candidateIsStrong(candidate))
      });
    });
  });

  return groups;
}

function independentEntries(entries = []) {
  const bySource = new Map();
  entries.forEach((entry) => {
    const existing = bySource.get(entry.source_key);
    if (!existing || entry.confidence > existing.confidence) {
      bySource.set(entry.source_key, entry);
    }
  });
  return [...bySource.values()];
}

function closureGroupsForField(groups = {}, fieldName) {
  return Object.values(groups[fieldName] || {})
    .map((group) => ({
      value: group.value,
      entries: independentEntries(group.entries)
    }))
    .filter((group) => group.entries.length > 0);
}

function createIndependentField(group) {
  const confidence = Math.max(...group.entries.map((entry) => entry.confidence), 0.86);
  return createEvidenceField({
    value: group.value,
    normalizedValue: group.value,
    status: "CONFIRMED",
    confidence,
    candidates: group.entries.map((entry) => ({
      value: group.value,
      confidence: entry.confidence
    })),
    sources: group.entries.map((entry) => entry.source)
  });
}

function createIndependentConflictField({
  fieldName,
  existingField,
  existingValue,
  groups
}) {
  const candidateValues = groups.flatMap((group) => group.entries.map((entry) => ({
    value: group.value,
    confidence: entry.confidence
  })));
  const sources = groups.flatMap((group) => group.entries.map((entry) => entry.source));

  return createEvidenceField({
    value: existingValue ?? null,
    normalizedValue: existingValue ?? null,
    status: "CONFLICT",
    confidence: Math.min(Number(existingField?.confidence || 0.5), 0.5),
    candidates: [
      ...(Array.isArray(existingField?.candidates) ? existingField.candidates : []),
      ...candidateValues
    ],
    sources: Array.isArray(existingField?.sources)
      ? [...existingField.sources, ...sources]
      : sources,
    conflicts: [
      ...(Array.isArray(existingField?.conflicts) ? existingField.conflicts : []),
      ...groups.map((group) => ({
        field: fieldName,
        existing_value: existingValue ?? null,
        candidate_value: group.value,
        reason: "independent trusted retrieval candidates disagree"
      }))
    ],
    unresolvedReason: "independent_retrieval_conflict"
  });
}

function applyIndependentCandidateClosure({
  resolved,
  evidence,
  summary,
  candidates
}) {
  let nextResolved = resolved;
  let nextEvidence = evidence;
  let changed = false;
  const groups = trustedCandidateFieldGroups(candidates);

  Object.keys(groups).forEach((fieldName) => {
    const fieldGroups = closureGroupsForField(groups, fieldName);
    const independentGroups = fieldGroups.filter((group) => group.entries.length >= 2);
    if (!independentGroups.length) return;

    const currentValue = nextResolved[fieldName];
    const hasCurrent = fieldHasValue(nextResolved, fieldName);
    const currentEvidence = nextEvidence[fieldName] || null;

    if (!hasCurrent) {
      if (independentGroups.length === 1) {
        const group = independentGroups[0];
        nextResolved = normalizeResolvedFields({
          ...nextResolved,
          [fieldName]: group.value
        });
        nextEvidence = {
          ...nextEvidence,
          [fieldName]: createIndependentField(group)
        };
        summary.verified_fields.push(fieldName);
        summary.independent_closure_fields.push(fieldName);
        changed = true;
        return;
      }

      nextEvidence = {
        ...nextEvidence,
        [fieldName]: createIndependentConflictField({
          fieldName,
          existingField: currentEvidence,
          existingValue: null,
          groups: independentGroups
        })
      };
      summary.conflicting_fields.push(fieldName);
      changed = true;
      return;
    }

    const matchingGroup = independentGroups.find((group) => valuesEqual(currentValue, group.value, fieldName));
    const conflictingGroups = independentGroups.filter((group) => !valuesEqual(currentValue, group.value, fieldName));

    if (conflictingGroups.length) {
      nextEvidence = {
        ...nextEvidence,
        [fieldName]: createIndependentConflictField({
          fieldName,
          existingField: currentEvidence,
          existingValue: currentValue,
          groups: conflictingGroups
        })
      };
      summary.conflicting_fields.push(fieldName);
      changed = true;
      return;
    }

    if (matchingGroup) {
      const confidence = Math.max(
        Number(currentEvidence?.confidence || 0),
        ...matchingGroup.entries.map((entry) => entry.confidence)
      );
      nextEvidence = {
        ...nextEvidence,
        [fieldName]: createEvidenceField({
          value: currentValue,
          normalizedValue: currentValue,
          status: currentEvidence?.status === "MANUAL_CONFIRMED" ? "MANUAL_CONFIRMED" : "CONFIRMED",
          confidence,
          candidates: currentEvidence?.candidates,
          sources: matchingGroup.entries.reduce(
            (sources, entry) => appendSource({ sources }, entry.source),
            currentEvidence?.sources || []
          ),
          conflicts: currentEvidence?.conflicts || []
        })
      };
      summary.verified_fields.push(fieldName);
      summary.independent_closure_fields.push(fieldName);
      changed = true;
    }
  });

  return {
    resolved: nextResolved,
    evidence: nextEvidence,
    changed
  };
}

export function verifyRetrievalCandidates({
  resolved = {},
  evidence = {},
  retrieval = {}
} = {}) {
  let nextResolved = normalizeResolvedFields(resolved);
  let nextEvidence = { ...(evidence || {}) };
  const selected = retrieval.selected_candidate || null;
  const allCandidates = Array.isArray(retrieval.sources) ? retrieval.sources : [];
  const summary = {
    verified_fields: [],
    review_fields: [],
    conflicting_fields: [],
    independent_closure_fields: [],
    ignored_candidates: [],
    market_reference_fields: marketplaceReferenceFields(allCandidates),
    low_margin_conflict: retrieval.low_margin_conflict || null,
    ranking_conflicts: (retrieval.conflicts || []).filter((conflict) => conflict?.type === "LOW_MARGIN_CANDIDATE_CONFLICT")
  };
  let changed = false;

  if (selected && !candidateIsGroundTruthEligible(selected)) {
    summary.ignored_candidates.push({
      candidate_id: selected.candidate_id || null,
      reason: "candidate_source_is_reference_only",
      source_type: selected.source_type || null,
      trust_tier: Number(selected.trust_tier || 9)
    });
  }

  if (selected && candidateIsGroundTruthEligible(selected)) {
    const candidateFields = normalizeCandidateFields(selected);
    const source = sourceFromCandidate(selected);
    const strong = candidateIsStrong(selected);
    const status = strong ? "CONFIRMED" : "REVIEW";
    const confidence = candidateConfidence(selected, strong);

    Object.entries(candidateFields).forEach(([fieldName, candidateValue]) => {
      if (!resolvedFieldNames.includes(fieldName) || !fieldHasValue(candidateFields, fieldName)) return;

      const currentValue = nextResolved[fieldName];
      const hasCurrent = fieldHasValue(nextResolved, fieldName);
      const currentEvidence = nextEvidence[fieldName] || null;

      if (!hasCurrent) {
        nextResolved = normalizeResolvedFields({
          ...nextResolved,
          [fieldName]: candidateValue
        });
        nextEvidence[fieldName] = createEvidenceField({
          value: candidateValue,
          normalizedValue: candidateValue,
          status,
          confidence,
          sources: [source],
          unresolvedReason: status === "REVIEW" ? "retrieval_candidate_requires_review" : null
        });
        summary[status === "CONFIRMED" ? "verified_fields" : "review_fields"].push(fieldName);
        changed = true;
        return;
      }

      if (valuesCompatible(currentValue, candidateValue, fieldName)) {
        const resolvedValue = moreSpecificValue(currentValue, candidateValue, fieldName);
        nextEvidence[fieldName] = createEvidenceField({
          value: resolvedValue,
          normalizedValue: resolvedValue,
          status: currentEvidence?.status === "MANUAL_CONFIRMED" ? "MANUAL_CONFIRMED" : status,
          confidence: Math.max(Number(currentEvidence?.confidence || 0), confidence),
          candidates: [{ value: resolvedValue, confidence }],
          sources: appendSource(currentEvidence, source),
          conflicts: currentEvidence?.conflicts || []
        });
        if (!valuesEqual(currentValue, resolvedValue, fieldName)) {
          nextResolved = normalizeResolvedFields({
            ...nextResolved,
            [fieldName]: resolvedValue
          });
        }
        summary[status === "CONFIRMED" ? "verified_fields" : "review_fields"].push(fieldName);
        changed = true;
        return;
      }

      if (trustedCandidateCanOverrideCurrent(fieldName, currentEvidence, selected)) {
        nextResolved = normalizeResolvedFields({
          ...nextResolved,
          [fieldName]: candidateValue
        });
        nextEvidence[fieldName] = createEvidenceField({
          value: candidateValue,
          normalizedValue: candidateValue,
          status: "CONFIRMED",
          confidence,
          candidates: [{ value: candidateValue, confidence }],
          sources: [source],
          conflicts: [
            ...(Array.isArray(currentEvidence?.conflicts) ? currentEvidence.conflicts : []),
            {
              field: fieldName,
              existing_value: currentValue,
              candidate_value: candidateValue,
              source_type: selected.source_type,
              source_url: selected.source_url || "",
              reason: "trusted_internal_history_override_model_inference",
              resolved: true
            }
          ]
        });
        summary.verified_fields.push(fieldName);
        changed = true;
        return;
      }

      nextEvidence[fieldName] = withConflict(currentEvidence, {
        fieldName,
        existingValue: currentValue,
        candidateValue,
        candidate: selected,
        source
      });
      summary.conflicting_fields.push(fieldName);
      changed = true;
    });
  }

  const independentClosure = applyIndependentCandidateClosure({
    resolved: nextResolved,
    evidence: nextEvidence,
    summary,
    candidates: [selected, ...allCandidates].filter(Boolean)
  });
  nextResolved = independentClosure.resolved;
  nextEvidence = independentClosure.evidence;
  changed = changed || independentClosure.changed;

  return {
    resolved: nextResolved,
    evidence: nextEvidence,
    changed,
    summary: {
      ...summary,
      verified_fields: [...new Set(summary.verified_fields)],
      review_fields: [...new Set(summary.review_fields)],
      conflicting_fields: [...new Set(summary.conflicting_fields)],
      independent_closure_fields: [...new Set(summary.independent_closure_fields)]
    }
  };
}
