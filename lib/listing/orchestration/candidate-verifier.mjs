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
  "OPEN_WEB",
  "VISUAL_VECTOR"
]);

const listingReferenceFieldSourceTypes = new Set([
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

const visualVectorStructuredAnchorFields = Object.freeze([
  "year",
  "product",
  "set",
  "players",
  "character",
  "serial_number",
  "collector_number",
  "checklist_code",
  "grade_company",
  "card_grade",
  "parallel_exact",
  "parallel"
]);

const visualVectorConsensusOverrideFields = new Set([
  "year",
  "product",
  "set",
  "insert",
  "card_type",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "parallel",
  "variation",
  "collector_number",
  "checklist_code",
  "rc",
  "first_bowman",
  "auto",
  "patch",
  "relic"
]);

const visualVectorNeverCopyFields = new Set([
  "serial_number",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
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

function isVisualVectorCandidate(candidate = {}) {
  return String(candidate.source_type || candidate.source || "").trim().toUpperCase() === "VISUAL_VECTOR"
    || (Array.isArray(candidate.matched_fields) && candidate.matched_fields.includes("visual_vector"));
}

function structuredVisualAnchorCount(candidate = {}) {
  const fields = normalizeCandidateFields(candidate);
  return visualVectorStructuredAnchorFields
    .filter((fieldName) => fieldHasValue(fields, fieldName))
    .length;
}

function visualSimilarity(candidate = {}) {
  const direct = Number(candidate.visual_similarity);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(1, direct));
  const score = Number(candidate.match_score);
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

function visualMargin(candidate = {}) {
  const margin = Number(candidate.visual_margin_to_next);
  return Number.isFinite(margin) ? Math.max(0, margin) : 0;
}

function visualVectorExactMatch(candidate = {}) {
  return visualSimilarity(candidate) >= 0.985 && visualMargin(candidate) >= 0.12;
}

function visualVectorCandidateEligible(candidate = {}) {
  if (!isVisualVectorCandidate(candidate)) return false;
  if (structuredVisualAnchorCount(candidate) < 2) return false;
  return visualSimilarity(candidate) >= 0.72 || Number(candidate.match_score || 0) >= 0.45;
}

function normalizedArray(value) {
  return Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [normalizeText(value)].filter(Boolean);
}

function subjectSubset(current = [], candidate = []) {
  const currentValues = normalizedArray(current);
  const candidateValues = normalizedArray(candidate);
  if (!currentValues.length || !candidateValues.length) return false;
  return currentValues.every((value) => candidateValues.some((candidateValue) => valuesCompatible(value, candidateValue, "players")));
}

function unionSubjects(current = [], candidate = []) {
  const values = [];
  [...normalizedArray(current), ...normalizedArray(candidate)].forEach((value) => {
    if (!value) return;
    if (values.some((existing) => valuesEqual(existing, value, "players") || valuesCompatible(existing, value, "players"))) return;
    values.push(value);
  });
  return values;
}

function anchorMatchCount(candidate = {}, resolved = {}, excludedField = "") {
  const fields = normalizeCandidateFields(candidate);
  return [
    "players",
    "character",
    "product",
    "set",
    "collector_number",
    "checklist_code",
    "serial_number",
    "parallel",
    "parallel_exact",
    "grade_company",
    "card_grade"
  ].filter((fieldName) => {
    if (fieldName === excludedField) return false;
    if (!fieldHasValue(fields, fieldName) || !fieldHasValue(resolved, fieldName)) return false;
    if (fieldName === "players") return subjectSubset(resolved.players, fields.players);
    return valuesCompatible(resolved[fieldName], fields[fieldName], fieldName);
  }).length;
}

function visualVectorConfidence(candidate = {}, anchorCount = 0) {
  if (visualVectorExactMatch(candidate)) {
    return Math.min(0.86, Number((0.82 + Math.min(anchorCount, 4) * 0.01).toFixed(4)));
  }
  const base = Math.max(0.48, Math.min(0.72, visualSimilarity(candidate) * 0.72));
  return Math.min(0.78, Number((base + Math.min(anchorCount, 4) * 0.035).toFixed(4)));
}

function visualVectorSource(candidate = {}, {
  fieldName = "",
  consensus = false
} = {}) {
  const exactMemoryHit = visualVectorExactMatch(candidate);
  return {
    ...sourceFromCandidate(candidate),
    source_type: exactMemoryHit ? "STRUCTURED_DATABASE" : "VISUAL_GUESS",
    original_source_type: "VISUAL_VECTOR",
    evidence_kind: exactMemoryHit
      ? "visual_vector_exact_identity_memory"
      : consensus ? "visual_vector_field_consensus" : "visual_vector_candidate_support",
    direct_observation: false,
    field_name: fieldName,
    visual_similarity: visualSimilarity(candidate),
    visual_margin_to_next: visualMargin(candidate),
    field_derivation: candidate.field_derivation || null
  };
}

function groupedVisualFieldValues(candidates = [], resolved = {}) {
  const groups = {};

  candidates.forEach((candidate) => {
    const fields = normalizeCandidateFields(candidate);
    Object.entries(fields).forEach(([fieldName, value]) => {
      if (!resolvedFieldNames.includes(fieldName) || !fieldHasValue(fields, fieldName)) return;
      if (visualVectorNeverCopyFields.has(fieldName)) return;
      const anchors = anchorMatchCount(candidate, resolved, fieldName);
      if (anchors < 2 && fieldName !== "players" && !(visualVectorExactMatch(candidate) && anchors >= 1)) return;
      const key = normalizeComparableField(fieldName, value);
      if (!key) return;
      groups[fieldName] ||= {};
      groups[fieldName][key] ||= {
        fieldName,
        value,
        key,
        entries: []
      };
      groups[fieldName][key].entries.push({
        candidate,
        anchors,
        confidence: visualVectorConfidence(candidate, anchors)
      });
    });
  });

  return groups;
}

function strongestVisualGroup(groups = {}) {
  return Object.values(groups)
    .map((group) => ({
      ...group,
      entry_count: group.entries.length,
      max_similarity: Math.max(...group.entries.map((entry) => visualSimilarity(entry.candidate)), 0),
      max_margin: Math.max(...group.entries.map((entry) => visualMargin(entry.candidate)), 0),
      max_anchor_count: Math.max(...group.entries.map((entry) => entry.anchors), 0),
      confidence: Math.max(...group.entries.map((entry) => entry.confidence), 0)
    }))
    .sort((left, right) => {
      return right.entry_count - left.entry_count
        || right.max_anchor_count - left.max_anchor_count
        || right.max_similarity - left.max_similarity
        || right.max_margin - left.max_margin;
    })[0] || null;
}

function visualGroupIsStrong(group = null) {
  if (!group) return false;
  if (group.entry_count >= 2 && group.max_anchor_count >= 2 && group.max_similarity >= 0.78) return true;
  if (group.max_similarity >= 0.985 && group.max_margin >= 0.12 && group.max_anchor_count >= 1) return true;
  return group.max_similarity >= 0.9 && group.max_margin >= 0.08 && group.max_anchor_count >= 2;
}

function visualVectorCanOverrideConflict(fieldName, group = null, currentEvidence = null) {
  if (!visualVectorConsensusOverrideFields.has(fieldName)) return false;
  if (!group) return false;
  if (group.entry_count >= 2) return true;
  if (["brand", "product", "set"].includes(fieldName)) return false;
  if (fieldName === "year") return !yearEvidenceHasStrongDirectSupport(currentEvidence);
  return true;
}

function yearEvidenceHasStrongDirectSupport(evidenceField = null) {
  const sources = Array.isArray(evidenceField?.sources) ? evidenceField.sources : [];
  return sources.some((source) => {
    const sourceType = source.source_type || source.source || "";
    if (!["SLAB_LABEL", "CARD_BACK", "CARD_FRONT", "CARD_BACK_PRINTED_TEXT", "CARD_FRONT_PRINTED_TEXT"].includes(sourceType)) return false;
    if (source.evidence_kind === "YEAR_CONTEXT_TEXT") return false;
    return true;
  });
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

function markConflictsResolved(conflicts = [], {
  reason,
  selectedValue,
  sourceType,
  sourceUrl
} = {}) {
  return (Array.isArray(conflicts) ? conflicts : []).map((conflict) => ({
    ...conflict,
    resolved: true,
    resolution: conflict.resolution || reason,
    selected_value: conflict.selected_value ?? selectedValue,
    resolving_source_type: sourceType || conflict.resolving_source_type || null,
    resolving_source_url: sourceUrl || conflict.resolving_source_url || ""
  }));
}

function marketplaceReferenceFields(candidates = []) {
  const references = {};

  candidates.forEach((candidate) => {
    if (!listingReferenceFieldSourceTypes.has(candidate.source_type)) return;
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
          conflicts: markConflictsResolved(currentEvidence?.conflicts, {
            reason: "independent_retrieval_candidates_confirmed_current_value",
            selectedValue: currentValue,
            sourceType: matchingGroup.entries[0]?.candidate?.source_type,
            sourceUrl: matchingGroup.entries[0]?.candidate?.source_url || ""
          })
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

function appendVisualCandidateSupport(existingField, {
  fieldName,
  value,
  group
}) {
  const entries = group.entries || [];
  const sources = entries.map((entry) => visualVectorSource(entry.candidate, {
    fieldName,
    consensus: entries.length >= 2
  }));
  const candidates = entries.map((entry) => ({
    value,
    confidence: entry.confidence,
    source_type: "VISUAL_VECTOR",
    candidate_id: entry.candidate.candidate_id || null
  }));

  return createEvidenceField({
    value,
    normalizedValue: value,
    status: existingField?.status === "MANUAL_CONFIRMED" ? "MANUAL_CONFIRMED" : existingField?.status || "REVIEW",
    confidence: Math.max(Number(existingField?.confidence || 0), group.confidence || 0),
    candidates: [
      ...(Array.isArray(existingField?.candidates) ? existingField.candidates : []),
      ...candidates
    ],
    sources: sources.reduce(
      (items, source) => appendSource({ sources: items }, source),
      existingField?.sources || []
    ),
    conflicts: existingField?.conflicts,
    unresolvedReason: existingField?.unresolved_reason || existingField?.unresolvedReason || "visual_vector_candidate_support_requires_review"
  });
}

function createVisualVectorConflictField(existingField, {
  fieldName,
  existingValue,
  group
}) {
  const sources = group.entries.map((entry) => visualVectorSource(entry.candidate, {
    fieldName,
    consensus: group.entries.length >= 2
  }));

  return createEvidenceField({
    value: existingValue ?? null,
    normalizedValue: existingValue ?? null,
    status: "CONFLICT",
    confidence: Math.min(Number(existingField?.confidence || 0.55), 0.58),
    candidates: [
      ...(Array.isArray(existingField?.candidates) ? existingField.candidates : []),
      ...group.entries.map((entry) => ({
        value: group.value,
        confidence: entry.confidence,
        source_type: "VISUAL_VECTOR",
        candidate_id: entry.candidate.candidate_id || null
      }))
    ],
    sources: sources.reduce(
      (items, source) => appendSource({ sources: items }, source),
      existingField?.sources || []
    ),
    conflicts: [
      ...(Array.isArray(existingField?.conflicts) ? existingField.conflicts : []),
      {
        field: fieldName,
        existing_value: existingValue ?? null,
        candidate_value: group.value,
        source_type: "VISUAL_VECTOR",
        reason: "visual_vector_candidate_consensus_conflicts_with_current_field",
        candidate_ids: group.entries.map((entry) => entry.candidate.candidate_id || null).filter(Boolean)
      }
    ],
    unresolvedReason: "visual_vector_candidate_conflict"
  });
}

function applyVisualVectorFieldEvidence({
  resolved,
  evidence,
  summary,
  candidates
}) {
  let nextResolved = resolved;
  let nextEvidence = evidence;
  let changed = false;
  const visualCandidates = candidates
    .filter(visualVectorCandidateEligible)
    .sort((left, right) => visualSimilarity(right) - visualSimilarity(left))
    .slice(0, 8);

  summary.visual_vector = {
    candidate_count: candidates.filter(isVisualVectorCandidate).length,
    eligible_candidate_count: visualCandidates.length,
    supported_fields: [],
    consensus_fields: [],
    conflict_fields: [],
    ignored_fields: []
  };

  if (!visualCandidates.length) return { resolved: nextResolved, evidence: nextEvidence, changed };

  const groupsByField = groupedVisualFieldValues(visualCandidates, nextResolved);

  Object.entries(groupsByField).forEach(([fieldName, groups]) => {
    const group = strongestVisualGroup(groups);
    const strongEnough = fieldName === "players"
      ? Boolean(group && group.max_similarity >= 0.84 && subjectSubset(nextResolved.players, group.value))
      : visualGroupIsStrong(group);
    if (!group || !strongEnough) {
      summary.visual_vector.ignored_fields.push({
        field: fieldName,
        reason: "no_strong_visual_vector_field_consensus"
      });
      return;
    }

    const currentValue = nextResolved[fieldName];
    const hasCurrent = fieldHasValue(nextResolved, fieldName);
    const currentEvidence = nextEvidence[fieldName] || null;

    if (fieldName === "players" && hasCurrent && subjectSubset(nextResolved.players, group.value)) {
      const mergedPlayers = unionSubjects(nextResolved.players, group.value);
      if (mergedPlayers.length > normalizedArray(nextResolved.players).length) {
        nextResolved = normalizeResolvedFields({
          ...nextResolved,
          players: mergedPlayers
        });
        nextEvidence = {
          ...nextEvidence,
          players: appendVisualCandidateSupport(currentEvidence, {
            fieldName: "players",
            value: mergedPlayers,
            group
          })
        };
        summary.visual_vector.supported_fields.push("players");
        summary.visual_vector.consensus_fields.push("players");
        changed = true;
      }
      return;
    }

    if (!hasCurrent) {
      if (!visualVectorConsensusOverrideFields.has(fieldName)) {
        summary.visual_vector.ignored_fields.push({
          field: fieldName,
          reason: "visual_vector_field_not_publishable_without_direct_evidence"
        });
        return;
      }

      nextResolved = normalizeResolvedFields({
        ...nextResolved,
        [fieldName]: group.value
      });
      nextEvidence = {
        ...nextEvidence,
        [fieldName]: appendVisualCandidateSupport(currentEvidence, {
          fieldName,
          value: group.value,
          group
        })
      };
      summary.visual_vector.supported_fields.push(fieldName);
      summary.visual_vector.consensus_fields.push(fieldName);
      changed = true;
      return;
    }

    if (valuesCompatible(currentValue, group.value, fieldName)) {
      const value = moreSpecificValue(currentValue, group.value, fieldName);
      if (!valuesEqual(currentValue, value, fieldName)) {
        nextResolved = normalizeResolvedFields({
          ...nextResolved,
          [fieldName]: value
        });
      }
      nextEvidence = {
        ...nextEvidence,
        [fieldName]: appendVisualCandidateSupport(currentEvidence, {
          fieldName,
          value,
          group
        })
      };
      summary.visual_vector.supported_fields.push(fieldName);
      changed = true;
      return;
    }

    if (visualVectorCanOverrideConflict(fieldName, group, currentEvidence)) {
      nextResolved = normalizeResolvedFields({
        ...nextResolved,
        [fieldName]: group.value
      });
      nextEvidence = {
        ...nextEvidence,
        [fieldName]: createEvidenceField({
          value: group.value,
          normalizedValue: group.value,
          status: "REVIEW",
          confidence: Math.max(0.62, group.confidence || 0),
          candidates: [
            ...(Array.isArray(currentEvidence?.candidates) ? currentEvidence.candidates : []),
            { value: currentValue, confidence: Number(currentEvidence?.confidence || 0.5) },
            ...group.entries.map((entry) => ({
              value: group.value,
              confidence: entry.confidence,
              source_type: "VISUAL_VECTOR",
              candidate_id: entry.candidate.candidate_id || null
            }))
          ],
          sources: group.entries.reduce(
            (sources, entry) => appendSource({ sources }, visualVectorSource(entry.candidate, {
              fieldName,
              consensus: true
            })),
            currentEvidence?.sources || []
          ),
          conflicts: [
            ...(Array.isArray(currentEvidence?.conflicts) ? currentEvidence.conflicts : []),
            {
              field: fieldName,
              existing_value: currentValue,
              candidate_value: group.value,
              source_type: "VISUAL_VECTOR",
              reason: "visual_vector_candidate_consensus_corrected_single_source_field",
              resolved: true
            }
          ],
          unresolvedReason: "visual_vector_consensus_requires_writer_review"
        })
      };
      summary.visual_vector.supported_fields.push(fieldName);
      summary.visual_vector.consensus_fields.push(fieldName);
      summary.visual_vector.conflict_fields.push(fieldName);
      changed = true;
      return;
    }

    nextEvidence = {
      ...nextEvidence,
      [fieldName]: createVisualVectorConflictField(currentEvidence, {
        fieldName,
        existingValue: currentValue,
        group
      })
    };
    summary.visual_vector.conflict_fields.push(fieldName);
    changed = true;
  });

  summary.visual_vector.supported_fields = [...new Set(summary.visual_vector.supported_fields)];
  summary.visual_vector.consensus_fields = [...new Set(summary.visual_vector.consensus_fields)];
  summary.visual_vector.conflict_fields = [...new Set(summary.visual_vector.conflict_fields)];

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
          conflicts: markConflictsResolved(currentEvidence?.conflicts, {
            reason: "trusted_retrieval_candidate_confirmed_current_value",
            selectedValue: resolvedValue,
            sourceType: selected.source_type,
            sourceUrl: selected.source_url || ""
          })
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

  const visualVectorEvidence = applyVisualVectorFieldEvidence({
    resolved: nextResolved,
    evidence: nextEvidence,
    summary,
    candidates: allCandidates
  });
  nextResolved = visualVectorEvidence.resolved;
  nextEvidence = visualVectorEvidence.evidence;
  changed = changed || visualVectorEvidence.changed;

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
