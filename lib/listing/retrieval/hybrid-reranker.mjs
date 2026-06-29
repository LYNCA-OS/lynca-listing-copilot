import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import {
  retrievalProviderIds,
  retrievalQueryFamilies,
  retrievalSourceTypes,
  retrievalTrustTiers
} from "./retrieval-contract.mjs";

export const hybridChannelIds = Object.freeze({
  FRONT_IMAGE_VECTOR: "front_image_vector",
  BACK_IMAGE_VECTOR: "back_image_vector",
  OCR_EXACT_CODE: "ocr_exact_code",
  POSTGRES_FULL_TEXT: "postgres_full_text",
  STRUCTURED_METADATA: "structured_metadata",
  APPROVED_MEMORY: "approved_memory",
  OFFICIAL_REGISTRY: "official_registry",
  MARKETPLACE_REFERENCE: "marketplace_reference",
  OPEN_WEB: "open_web",
  UNKNOWN: "unknown"
});

export const openSetDecisions = Object.freeze({
  EXACT_CANDIDATE: "EXACT_CANDIDATE",
  NONE_OF_THE_ABOVE: "NONE_OF_THE_ABOVE",
  LOW_MARGIN_MATCH: "LOW_MARGIN_MATCH",
  NO_EXACT_MATCH: "NO_EXACT_MATCH",
  FAMILY_ONLY_MATCH: "FAMILY_ONLY_MATCH"
});

const defaultRrfK = 60;
const defaultLowMarginThreshold = 0.03;
const hardNegativePenalty = 0.18;
const familyOnlyFields = new Set(["year", "brand", "manufacturer", "product", "set", "players", "character"]);
const exactAnchorFields = new Set(["checklist_code", "collector_number", "parallel_exact", "serial_denominator"]);
const identitySupportFields = new Set(["year", "brand", "manufacturer", "product", "set", "players", "subjects", "character", "surface_color"]);
const trustedConstraintSourceTypes = new Set([
  retrievalSourceTypes.INTERNAL_APPROVED_HISTORY,
  retrievalSourceTypes.INTERNAL_REGISTRY,
  retrievalSourceTypes.OFFICIAL_CHECKLIST,
  retrievalSourceTypes.OFFICIAL_PRODUCT_PAGE,
  retrievalSourceTypes.STRUCTURED_DATABASE
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactObject(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined && cleanText(value) !== "";
    })
  );
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedNumber(value, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return Math.max(0, Math.min(1, number));
}

function round(value, digits = 4) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function arrayValues(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  return text ? [text] : [];
}

function subjectValues(fields = {}) {
  const normalized = normalizeResolvedFields(fields);
  return [
    ...arrayValues(normalized.players),
    ...arrayValues(normalized.player),
    ...arrayValues(normalized.character)
  ].filter(Boolean);
}

function serialDenominator(value) {
  return cleanText(value).match(/\/\s*0*(\d{1,4})\b/)?.[1] || "";
}

function normalizeCollector(value) {
  return cleanText(value)
    .replace(/^#\s*/, "")
    .toUpperCase();
}

function normalizeComparable(field, value) {
  if (field === "serial_denominator") return serialDenominator(value) || normalizeText(value);
  if (field === "collector_number" || field === "checklist_code") return normalizeCollector(value);
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).sort().join("|");
  return normalizeText(value);
}

function textCompatible(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return "missing";
  if (a === b) return "match";
  if (a.includes(b) || b.includes(a)) return "partial";
  return "conflict";
}

function subjectCompatibility(queryFields = {}, candidateFields = {}) {
  const querySubjects = subjectValues(queryFields).map(normalizeText).filter(Boolean);
  const candidateSubjects = subjectValues(candidateFields).map(normalizeText).filter(Boolean);
  if (!querySubjects.length || !candidateSubjects.length) {
    return {
      status: "missing",
      score: 0,
      conflict: false,
      subject_count_compatible: true
    };
  }
  const matchedCount = querySubjects.filter((subject) => candidateSubjects.some((candidate) => candidate === subject || candidate.includes(subject) || subject.includes(candidate))).length;
  const subjectCountCompatible = querySubjects.length === candidateSubjects.length;
  if (matchedCount === querySubjects.length && subjectCountCompatible) {
    return {
      status: "match",
      score: 0.14,
      conflict: false,
      subject_count_compatible: true
    };
  }
  if (matchedCount > 0) {
    return {
      status: "partial",
      score: 0.05,
      conflict: !subjectCountCompatible,
      subject_count_compatible: subjectCountCompatible
    };
  }
  return {
    status: "conflict",
    score: -0.16,
    conflict: true,
    subject_count_compatible: subjectCountCompatible
  };
}

function fieldMatch(queryFields = {}, candidateFields = {}, field, {
  weight = 0.08,
  partialWeight = 0.03,
  conflictPenalty = 0.12
} = {}) {
  const queryValue = normalizeComparable(field, queryFields[field]);
  const candidateValue = normalizeComparable(field, candidateFields[field]);
  if (!queryValue || !candidateValue) {
    return {
      status: "missing",
      score: 0,
      conflict: false
    };
  }
  if (queryValue === candidateValue) {
    return {
      status: "match",
      score: weight,
      conflict: false
    };
  }
  if (["product", "set", "card_type", "parallel_exact", "parallel", "surface_color"].includes(field) && (queryValue.includes(candidateValue) || candidateValue.includes(queryValue))) {
    return {
      status: "partial",
      score: partialWeight,
      conflict: false
    };
  }
  return {
    status: "conflict",
    score: -conflictPenalty,
    conflict: true
  };
}

function candidateIdentityKey(candidate = {}) {
  const candidateFields = normalizeResolvedFields(candidate.fields || {});
  const identityKey = cleanText(candidate.candidate_identity_id || candidate.identity_id || candidate.card_identity_id);
  if (identityKey) return identityKey;
  const fields = compactObject({
    year: candidateFields.year,
    product: candidateFields.product || candidateFields.set,
    subjects: subjectValues(candidateFields).join("|"),
    collector_number: candidateFields.collector_number,
    checklist_code: candidateFields.checklist_code,
    parallel_exact: candidateFields.parallel_exact || candidateFields.parallel
  });
  return Object.keys(fields).length ? JSON.stringify(fields) : cleanText(candidate.candidate_id || candidate.source_url);
}

function candidateChannel(candidate = {}) {
  const explicit = cleanText(candidate.channel_id);
  if (explicit && Object.values(hybridChannelIds).includes(explicit)) return explicit;

  const providerId = cleanText(candidate.provider_id || candidate.retrieval_provider_id);
  const queryFamily = cleanText(candidate.query_family || candidate.family);
  const sourceType = cleanText(candidate.source_type).toUpperCase();
  const embeddingRole = cleanText(candidate.embedding_role || candidate.image_role).toLowerCase();

  if (providerId === retrievalProviderIds.VISUAL_VECTOR || sourceType === retrievalSourceTypes.VISUAL_VECTOR) {
    if (embeddingRole.includes("back")) return hybridChannelIds.BACK_IMAGE_VECTOR;
    return hybridChannelIds.FRONT_IMAGE_VECTOR;
  }
  if (queryFamily === retrievalQueryFamilies.EXACT_CHECKLIST_CODE) return hybridChannelIds.OCR_EXACT_CODE;
  if (queryFamily === retrievalQueryFamilies.POSTGRES_HYBRID || providerId === retrievalProviderIds.POSTGRES_HYBRID) {
    return sourceType === retrievalSourceTypes.STRUCTURED_DATABASE
      ? hybridChannelIds.STRUCTURED_METADATA
      : hybridChannelIds.POSTGRES_FULL_TEXT;
  }
  if (providerId === retrievalProviderIds.CATALOG
    || queryFamily === retrievalQueryFamilies.CATALOG_EXACT_CODE
    || queryFamily === retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT
    || queryFamily === retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR
    || queryFamily === retrievalQueryFamilies.CATALOG_SET_SUBJECT) {
    return sourceType === retrievalSourceTypes.OFFICIAL_CHECKLIST
      ? hybridChannelIds.OFFICIAL_REGISTRY
      : hybridChannelIds.STRUCTURED_METADATA;
  }
  if (providerId === retrievalProviderIds.INTERNAL_MEMORY || sourceType === retrievalSourceTypes.INTERNAL_APPROVED_HISTORY) return hybridChannelIds.APPROVED_MEMORY;
  if (providerId === retrievalProviderIds.INTERNAL_REGISTRY || sourceType === retrievalSourceTypes.INTERNAL_REGISTRY) return hybridChannelIds.STRUCTURED_METADATA;
  if (sourceType === retrievalSourceTypes.OFFICIAL_CHECKLIST || sourceType === retrievalSourceTypes.OFFICIAL_PRODUCT_PAGE || sourceType === retrievalSourceTypes.STRUCTURED_DATABASE) {
    return hybridChannelIds.OFFICIAL_REGISTRY;
  }
  if (sourceType === retrievalSourceTypes.MARKETPLACE || providerId === retrievalProviderIds.EBAY_BROWSE) return hybridChannelIds.MARKETPLACE_REFERENCE;
  if (sourceType === retrievalSourceTypes.OPEN_WEB) return hybridChannelIds.OPEN_WEB;
  return hybridChannelIds.UNKNOWN;
}

function rawCandidateScore(candidate = {}) {
  if (Number.isFinite(Number(candidate.visual_similarity))) return boundedNumber(candidate.visual_similarity);
  if (Number.isFinite(Number(candidate.match_score))) return boundedNumber(candidate.match_score);
  if (Number.isFinite(Number(candidate.normalized_score))) return boundedNumber(candidate.normalized_score);
  if (Number.isFinite(Number(candidate.raw_score))) return boundedNumber(candidate.raw_score);
  return 0;
}

function normalizeChannelRows(candidates = []) {
  const byChannel = new Map();
  candidates.forEach((candidate, index) => {
    const channelId = candidateChannel(candidate);
    const row = {
      candidate,
      provider: cleanText(candidate.provider_id || candidate.retrieval_provider_id || candidate.source_type || channelId),
      rank: finiteNumber(candidate.channel_rank || candidate.rank || index + 1, index + 1),
      raw_score: rawCandidateScore(candidate),
      normalized_score: boundedNumber(candidate.normalized_score ?? candidate.match_score ?? candidate.visual_similarity),
      candidate_identity_id: candidateIdentityKey(candidate),
      supporting_fields: Array.isArray(candidate.supporting_fields)
        ? candidate.supporting_fields
        : Array.isArray(candidate.matched_fields)
          ? candidate.matched_fields
          : []
    };
    if (!byChannel.has(channelId)) byChannel.set(channelId, []);
    byChannel.get(channelId).push(row);
  });

  const normalized = new Map();
  byChannel.forEach((rows, channelId) => {
    const sorted = [...rows].sort((left, right) => {
      return right.normalized_score - left.normalized_score || left.rank - right.rank;
    });
    normalized.set(channelId, sorted.map((row, index) => ({
      ...row,
      rank: index + 1
    })));
  });
  return normalized;
}

export function reciprocalRankFusion(channelRankings = new Map(), {
  k = defaultRrfK
} = {}) {
  const rankingMap = channelRankings instanceof Map
    ? channelRankings
    : new Map(Object.entries(channelRankings || {}));
  const fused = new Map();

  rankingMap.forEach((rows, channelId) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const identityId = cleanText(row.candidate_identity_id || candidateIdentityKey(row.candidate));
      if (!identityId) return;
      if (!fused.has(identityId)) {
        fused.set(identityId, {
          candidate_identity_id: identityId,
          rank_fusion_score: 0,
          channels: [],
          channel_support: {},
          candidates: []
        });
      }
      const entry = fused.get(identityId);
      const rank = Math.max(1, finiteNumber(row.rank, entry.candidates.length + 1));
      const contribution = 1 / (k + rank);
      entry.rank_fusion_score += contribution;
      entry.channels.push(channelId);
      entry.channel_support[channelId] = {
        provider: row.provider || channelId,
        rank,
        raw_score: row.raw_score ?? null,
        normalized_score: row.normalized_score ?? null,
        candidate_identity_id: identityId,
        supporting_fields: row.supporting_fields || []
      };
      if (row.candidate) entry.candidates.push(row.candidate);
    });
  });

  return [...fused.values()].sort((left, right) => right.rank_fusion_score - left.rank_fusion_score);
}

function sourceTrustScore(group = {}) {
  const bestTier = Math.min(...group.candidates.map((candidate) => finiteNumber(candidate.trust_tier, retrievalTrustTiers.OPEN_WEB)), retrievalTrustTiers.OPEN_WEB);
  return Math.max(0, (10 - bestTier) * 0.012);
}

function maxRoleSimilarity(candidates = [], roleIncludes) {
  return candidates.reduce((best, candidate) => {
    const role = cleanText(candidate.embedding_role || candidate.image_role).toLowerCase();
    if (!role.includes(roleIncludes)) return best;
    return Math.max(best, rawCandidateScore(candidate));
  }, 0);
}

function referenceCount(group = {}) {
  const ids = new Set();
  group.candidates.forEach((candidate) => {
    const id = cleanText(candidate.reference_image_id || candidate.embedding_id || candidate.source_url || candidate.candidate_id);
    if (id) ids.add(id);
  });
  return Math.max(1, ids.size || group.candidates.length);
}

function mergedFields(group = {}) {
  return group.candidates.reduce((fields, candidate) => ({
    ...normalizeResolvedFields(candidate.fields || {}),
    ...fields
  }), {});
}

function collectConflicts(queryFields = {}, candidateFields = {}) {
  const conflicts = [];
  const checks = [
    ["year", 0.18],
    ["product", 0.14],
    ["set", 0.1],
    ["collector_number", 0.18],
    ["checklist_code", 0.2],
    ["parallel_exact", 0.12]
  ];
  checks.forEach(([field, penalty]) => {
    const match = fieldMatch(queryFields, candidateFields, field, { conflictPenalty: penalty });
    if (match.conflict) conflicts.push(field);
  });
  const subject = subjectCompatibility(queryFields, candidateFields);
  if (subject.conflict) conflicts.push("subjects");

  const queryDenom = serialDenominator(queryFields.serial_number);
  const candidateDenom = serialDenominator(candidateFields.serial_number);
  if (queryDenom && candidateDenom && queryDenom !== candidateDenom) conflicts.push("serial_denominator");

  return [...new Set(conflicts)].sort();
}

function directEvidenceFeatures(queryFields = {}, candidateFields = {}) {
  const supportingFields = [];
  let fieldMatchScore = 0;
  let conflictPenalty = 0;

  const addResult = (result) => {
    if (result.score >= 0) fieldMatchScore += result.score;
    else conflictPenalty += Math.abs(result.score);
  };

  const checklist = fieldMatch(queryFields, candidateFields, "checklist_code", { weight: 0.24, conflictPenalty: 0.22 });
  if (checklist.status === "match") supportingFields.push("checklist_code");
  addResult(checklist);

  const collector = fieldMatch(queryFields, candidateFields, "collector_number", { weight: 0.14, conflictPenalty: 0.16 });
  if (collector.status === "match") supportingFields.push("collector_number");
  addResult(collector);

  const subject = subjectCompatibility(queryFields, candidateFields);
  if (subject.status === "match") supportingFields.push("subjects");
  if (subject.status === "partial") supportingFields.push("subjects_partial");
  addResult(subject);

  const year = fieldMatch(queryFields, candidateFields, "year", { weight: 0.1, conflictPenalty: 0.16 });
  if (year.status === "match") supportingFields.push("year");
  addResult(year);

  ["product", "set", "card_type", "parallel_exact", "parallel"].forEach((field) => {
    const result = fieldMatch(queryFields, candidateFields, field, { weight: field === "parallel_exact" ? 0.08 : 0.09, partialWeight: 0.03, conflictPenalty: 0.12 });
    if (result.status === "match") supportingFields.push(field);
    if (result.status === "partial") supportingFields.push(`${field}_partial`);
    addResult(result);
  });

  const queryDenom = serialDenominator(queryFields.serial_number);
  const candidateDenom = serialDenominator(candidateFields.serial_number);
  if (queryDenom && candidateDenom) {
    if (queryDenom === candidateDenom) {
      fieldMatchScore += 0.08;
      supportingFields.push("serial_denominator");
    } else {
      conflictPenalty += 0.16;
    }
  }

  return {
    score: fieldMatchScore - conflictPenalty,
    field_match_score: fieldMatchScore,
    conflict_penalty: conflictPenalty,
    supporting_fields: [...new Set(supportingFields)],
    subject_count_compatible: subject.subject_count_compatible
  };
}

function groupHasTrustedConstraintSource(group = {}) {
  return group.candidates.some((candidate) => {
    const sourceType = cleanText(candidate.source_type).toUpperCase();
    if (trustedConstraintSourceTypes.has(sourceType)) return true;
    const providerId = cleanText(candidate.provider_id || candidate.retrieval_provider_id);
    if ([retrievalProviderIds.CATALOG, retrievalProviderIds.POSTGRES_HYBRID, retrievalProviderIds.INTERNAL_MEMORY, retrievalProviderIds.INTERNAL_REGISTRY].includes(providerId)) return true;
    return Number(candidate.trust_tier || retrievalTrustTiers.OPEN_WEB) <= retrievalTrustTiers.STRUCTURED;
  });
}

function hasExactIdentitySupport(supportingFields = []) {
  const support = new Set(supportingFields);
  const exactSupport = [...support].some((field) => exactAnchorFields.has(field));
  const identitySupport = [...support].some((field) => identitySupportFields.has(field) || field === "trigram");
  return exactSupport && identitySupport;
}

function hardNegativeMatch(group = {}, hardNegatives = []) {
  const identityId = group.candidate_identity_id;
  return hardNegatives.find((negative) => {
    const wrongId = cleanText(negative.wrong_candidate_identity_id || negative.identity_id);
    return wrongId && wrongId === identityId;
  }) || null;
}

function structuredRerank(group = {}, queryFields = {}, hardNegatives = []) {
  const candidateFields = mergedFields(group);
  const conflicts = collectConflicts(queryFields, candidateFields);
  const features = directEvidenceFeatures(queryFields, candidateFields);
  const frontSimilarity = maxRoleSimilarity(group.candidates, "front");
  const backSimilarity = maxRoleSimilarity(group.candidates, "back");
  const bestSimilarity = Math.max(...group.candidates.map(rawCandidateScore), 0);
  const refs = referenceCount(group);
  const hardNegative = hardNegativeMatch(group, hardNegatives);
  const visualScore = Math.min(0.22, bestSimilarity * 0.16 + (frontSimilarity && backSimilarity ? 0.04 : 0));
  const referenceScore = Math.min(0.06, Math.max(0, (refs - 1) * 0.018));
  const trustScore = sourceTrustScore(group);
  const rrfScore = Math.min(0.2, group.rank_fusion_score * 5.5);
  const evidenceStrengthScore = Math.min(0.45, rrfScore + visualScore + referenceScore + trustScore);
  const hardPenalty = hardNegative ? hardNegativePenalty : 0;
  const directConflictPenalty = conflicts.length * 0.12;
  const score = Math.max(0, Math.min(1, features.field_match_score + evidenceStrengthScore - features.conflict_penalty - directConflictPenalty - hardPenalty));
  const hardConstraintEligible = groupHasTrustedConstraintSource(group)
    && hasExactIdentitySupport(features.supporting_fields)
    && conflicts.length === 0
    && features.field_match_score >= 0.2;

  return {
    ...group,
    candidate: group.candidates[0] || {},
    fields: candidateFields,
    front_similarity: frontSimilarity || null,
    back_similarity: backSimilarity || null,
    front_back_identity_agreement: Boolean(frontSimilarity && backSimilarity),
    reference_count: refs,
    supporting_fields: features.supporting_fields,
    subject_count_compatible: features.subject_count_compatible,
    conflicting_fields: conflicts,
    direct_evidence_conflicts: conflicts,
    field_match_score: round(features.field_match_score),
    evidence_strength_score: round(evidenceStrengthScore),
    conflict_penalty_score: round(features.conflict_penalty + directConflictPenalty + hardPenalty),
    candidate_selection_score: round(score),
    hard_constraint_eligible: hardConstraintEligible,
    hard_negative: hardNegative ? {
      error_type: hardNegative.error_type || "hard_negative",
      margin: hardNegative.margin ?? null,
      conflicting_fields: hardNegative.conflicting_fields || []
    } : null,
    source_trust_score: round(trustScore),
    rerank_score: round(score)
  };
}

function topScore(candidates = [], field) {
  return candidates.length ? finiteNumber(candidates[0][field], 0) : 0;
}

function openSetDecision(candidates = [], {
  lowMarginThreshold = defaultLowMarginThreshold
} = {}) {
  if (!candidates.length) {
    return {
      decision: openSetDecisions.NONE_OF_THE_ABOVE,
      reason: "no_retrieval_candidates"
    };
  }
  const top = candidates[0];
  const second = candidates[1] || null;
  const margin = Math.max(0, finiteNumber(top.rerank_score) - finiteNumber(second?.rerank_score));
  if (top.conflicting_fields?.length) {
    return {
      decision: openSetDecisions.NO_EXACT_MATCH,
      reason: "top_candidate_has_direct_evidence_conflicts"
    };
  }
  const support = new Set(top.supporting_fields || []);
  const exactSupport = [...support].some((field) => exactAnchorFields.has(field));
  const onlyFamilySupport = [...support].length > 0 && [...support].every((field) => familyOnlyFields.has(field));
  const visualOnly = top.channels.every((channel) => [hybridChannelIds.FRONT_IMAGE_VECTOR, hybridChannelIds.BACK_IMAGE_VECTOR].includes(channel));
  if (top.hard_constraint_eligible === true) {
    return {
      decision: openSetDecisions.EXACT_CANDIDATE,
      reason: second && margin < lowMarginThreshold
        ? "catalog_hard_constraint_exact_anchor_overrode_low_margin"
        : "catalog_hard_constraint_exact_anchor"
    };
  }
  if (second && margin < lowMarginThreshold) {
    return {
      decision: openSetDecisions.LOW_MARGIN_MATCH,
      reason: "top_candidate_margin_below_threshold"
    };
  }
  if (!exactSupport && (onlyFamilySupport || visualOnly)) {
    return {
      decision: openSetDecisions.FAMILY_ONLY_MATCH,
      reason: visualOnly ? "visual_only_family_match" : "family_fields_without_exact_anchor"
    };
  }
  return {
    decision: openSetDecisions.EXACT_CANDIDATE,
    reason: "top_candidate_has_sufficient_margin_and_no_direct_conflict"
  };
}

export function extractQueryExpansionFields({ resolved = {}, evidence = {} } = {}) {
  const fields = normalizeResolvedFields({
    ...(evidence?.fields || {}),
    ...(resolved || {})
  });
  return compactObject({
    subject: subjectValues(fields).join(" "),
    product_candidate: [fields.year, fields.brand || fields.manufacturer, fields.product || fields.set].filter(Boolean).join(" "),
    collector_number: fields.collector_number,
    checklist_code: fields.checklist_code,
    serial_denominator: serialDenominator(fields.serial_number),
    year: fields.year
  });
}

export function rankHybridRetrievalCandidates(candidates = [], resolved = {}, {
  rrfK = defaultRrfK,
  lowMarginThreshold = defaultLowMarginThreshold,
  hardNegatives = []
} = {}) {
  const channelRankings = normalizeChannelRows(candidates);
  const fused = reciprocalRankFusion(channelRankings, { k: rrfK });
  const queryFields = normalizeResolvedFields(resolved);
  const rankedCandidates = fused
    .map((group) => structuredRerank(group, queryFields, hardNegatives))
    .sort((left, right) => finiteNumber(right.rerank_score) - finiteNumber(left.rerank_score) || finiteNumber(right.rank_fusion_score) - finiteNumber(left.rank_fusion_score));
  const decision = openSetDecision(rankedCandidates, { lowMarginThreshold });
  const top = rankedCandidates[0] || null;
  const second = rankedCandidates[1] || null;
  const candidateMargin = top ? Math.max(0, finiteNumber(top.rerank_score) - finiteNumber(second?.rerank_score)) : 0;
  const topSimilarity = topScore(rankedCandidates, "front_similarity") || topScore(rankedCandidates, "back_similarity");
  const secondSimilarity = second ? Math.max(finiteNumber(second.front_similarity), finiteNumber(second.back_similarity)) : 0;

  const candidatesWithSelection = rankedCandidates.map((candidate, index) => ({
    ...candidate.candidate,
    ...candidate,
    selected: index === 0 && decision.decision === openSetDecisions.EXACT_CANDIDATE,
    rejection_reason: index === 0 && decision.decision !== openSetDecisions.EXACT_CANDIDATE
      ? decision.reason
      : index === 0
        ? null
        : "lower_hybrid_rerank_score",
    match_score: finiteNumber(candidate.rerank_score),
    matched_fields: [...new Set([...(candidate.candidate?.matched_fields || []), ...candidate.supporting_fields])],
    conflicting_fields: [...new Set([...(candidate.candidate?.conflicting_fields || []), ...candidate.conflicting_fields])],
    channel_support: candidate.channel_support,
    field_match_score: candidate.field_match_score,
    evidence_strength_score: candidate.evidence_strength_score,
    conflict_penalty_score: candidate.conflict_penalty_score,
    candidate_selection_score: candidate.candidate_selection_score,
    hard_constraint_eligible: candidate.hard_constraint_eligible === true
  }));

  const metrics = {
    top1_similarity: round(topSimilarity),
    top2_similarity: round(secondSimilarity),
    top1_top2_margin: round(Math.max(0, topSimilarity - secondSimilarity)),
    front_back_identity_agreement: Boolean(top?.front_back_identity_agreement),
    reference_count: top?.reference_count || 0,
    field_conflict_count: top?.conflicting_fields?.length || 0,
    rrf_k: rrfK,
    low_margin_threshold: lowMarginThreshold
  };

  return {
    candidates: candidatesWithSelection,
    selected_candidate: decision.decision === openSetDecisions.EXACT_CANDIDATE ? candidatesWithSelection[0] || null : null,
    candidate_margin: round(candidateMargin),
    candidate_selection_threshold: lowMarginThreshold,
    low_margin_conflict: decision.decision === openSetDecisions.LOW_MARGIN_MATCH ? {
      type: "LOW_MARGIN_CANDIDATE_CONFLICT",
      reason: decision.reason,
      candidate_margin: round(candidateMargin),
      threshold: lowMarginThreshold,
      candidate_ids: [top?.candidate_identity_id, second?.candidate_identity_id].filter(Boolean)
    } : null,
    open_set_decision: decision.decision,
    open_set_reason: decision.reason,
    retrieval_metrics: metrics,
    channels: Object.fromEntries([...channelRankings.entries()].map(([channelId, rows]) => [
      channelId,
      rows.map((row) => ({
        provider: row.provider,
        rank: row.rank,
        raw_score: row.raw_score,
        normalized_score: row.normalized_score,
        candidate_identity_id: row.candidate_identity_id,
        supporting_fields: row.supporting_fields
      }))
    ])),
    hybrid_ranker: {
      algorithm: "reciprocal_rank_fusion_plus_structured_rerank",
      raw_scores_combined: false,
      stage1_channel_count: channelRankings.size,
      stage2_identity_count: rankedCandidates.length
    }
  };
}
