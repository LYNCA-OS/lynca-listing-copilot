import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";

const vectorStatus = Object.freeze({
  COMPLETED: "COMPLETED",
  NO_CONFIDENT_MATCH: "NO_CONFIDENT_MATCH",
  UNAVAILABLE: "UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  ERROR: "ERROR"
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundScore(value) {
  const number = finiteNumber(value, null);
  return number === null ? null : Number(number.toFixed(4));
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function serialDenominator(value) {
  return cleanText(value).match(/\/\s*0*(\d{1,4})\b/)?.[1] || null;
}

function cleanUpper(value) {
  return cleanText(value).toUpperCase();
}

function cleanCompare(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareTokens(value) {
  return cleanCompare(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function referenceStatus(candidate = {}) {
  return cleanUpper(candidate.reference_metadata?.reference_status
    || candidate.reference_metadata?.retrieval_status
    || candidate.retrieval_status
    || candidate.status);
}

function candidateSourceType(candidate = {}) {
  return cleanUpper(candidate.source_type
    || candidate.reference_metadata?.source_type
    || candidate.provider_id
    || candidate.source_provider);
}

const trustedReferenceStatuses = new Set([
  "APPROVED",
  "REVIEWED",
  "VERIFIED",
  "REGISTRY",
  "OFFICIAL",
  "OFFICIAL_CHECKLIST"
]);

const trustedReferenceSources = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "APPROVED_MEMORY",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_REGISTRY",
  "REGISTRY",
  "STRUCTURED_REGISTRY"
]);

function subjectList(fields = {}) {
  const normalized = normalizeResolvedFields(fields);
  return Array.isArray(normalized.players) && normalized.players.length
    ? normalized.players
    : normalized.character
      ? [normalized.character]
      : [];
}

function sanitizedCandidateFields(fields = {}) {
  const normalized = normalizeResolvedFields(fields || {});
  const output = {
    year: normalized.year,
    manufacturer: normalized.manufacturer || normalized.brand,
    brand: normalized.brand || normalized.manufacturer,
    product: normalized.product || normalized.set,
    set: normalized.set,
    subset: normalized.subset,
    subjects: subjectList(normalized),
    card_type: normalized.card_type,
    insert: normalized.insert,
    surface_color: normalized.surface_color,
    parallel_family: normalized.parallel_family,
    parallel_exact: normalized.parallel_exact || normalized.parallel,
    collector_number: normalized.collector_number,
    checklist_code: normalized.checklist_code,
    expected_serial_denominator: serialDenominator(normalized.serial_number)
  };

  return Object.fromEntries(
    Object.entries(output).filter(([, value]) => hasValue(value))
  );
}

function sanitizedReferenceTitle(candidate = {}) {
  const title = cleanText(candidate.reference_title || candidate.title);
  if (!title) return "";
  return cleanText(title
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s+(?:Gem\s+Mint\s+)?(?:Auto\s+)?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\bCert(?:ificate)?\s*#?\s*[A-Z0-9-]+\b/gi, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\s+#\s+/g, " #")
  );
}

function sourceTrust(candidate = {}) {
  const existingTrust = cleanUpper(candidate.source_trust);
  if (existingTrust === "APPROVED_REFERENCE") return "APPROVED_REFERENCE";
  const status = referenceStatus(candidate);
  if (trustedReferenceStatuses.has(status)) return "APPROVED_REFERENCE";
  const sourceType = candidateSourceType(candidate);
  if (trustedReferenceSources.has(sourceType)) return "APPROVED_REFERENCE";
  return "REFERENCE_CANDIDATE";
}

function candidateIdentityKey(candidate = {}) {
  return cleanText(candidate.candidate_identity_id)
    || cleanText(candidate.identity_id)
    || cleanText(candidate.candidate_id)
    || cleanText(candidate.source_url)
    || JSON.stringify(sanitizedCandidateFields(candidate.fields || {}));
}

export function candidateConflictFields(candidate = {}) {
  const explicit = [
    candidate.conflicting_fields,
    candidate.direct_evidence_conflicts,
    candidate.conflicts
  ].flatMap((value) => Array.isArray(value) ? value : []);
  return [...new Set(explicit.map((field) => cleanText(
    typeof field === "string" ? field : field?.field || field?.field_name || field?.name || field?.conflicting_field
  )).filter(Boolean))];
}

function candidateHasDirectConflict(candidate = {}) {
  if (candidateConflictFields(candidate).length) return true;
  const conflictCount = finiteNumber(candidate.field_conflict_count ?? candidate.direct_evidence_conflict_count, 0) || 0;
  return conflictCount > 0;
}

function promptCandidateId(candidate = {}) {
  return cleanText(candidate.candidate_identity_id)
    || cleanText(candidate.identity_id)
    || cleanText(candidate.candidate_id)
    || cleanText(candidate.source_url);
}

function isAssistApprovedCandidate(candidate = {}) {
  return sourceTrust(candidate) === "APPROVED_REFERENCE";
}

function isPromptAssistCandidate(candidate = {}) {
  return isAssistApprovedCandidate(candidate) && !candidateHasDirectConflict(candidate);
}

function candidateRole(candidate = {}) {
  const role = cleanText(candidate.embedding_role || candidate.image_role || "");
  if (role.includes("back")) return "back";
  if (role.includes("front")) return "front";
  return "unknown";
}

function expandYearParts(value) {
  const text = cleanCompare(value);
  const years = new Set();
  const fullYears = text.match(/\b(?:19|20)\d{2}\b/g) || [];
  fullYears.forEach((year) => years.add(Number(year)));
  for (const match of text.matchAll(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2})\b/g)) {
    const start = Number(match[1]);
    const endCentury = Math.floor(start / 100) * 100;
    let end = endCentury + Number(match[2]);
    if (end < start) end += 100;
    for (let year = start; year <= Math.min(end, start + 2); year += 1) years.add(year);
  }
  return [...years];
}

function yearsCompatible(left, right) {
  const leftYears = expandYearParts(left);
  const rightYears = expandYearParts(right);
  if (!leftYears.length || !rightYears.length) return cleanCompare(left) === cleanCompare(right);
  return leftYears.some((year) => rightYears.includes(year));
}

const productNoiseTokens = new Set([
  "card",
  "cards",
  "the",
  "edition"
]);

function productSignificantTokens(value) {
  return compareTokens(value)
    .filter((token) => !productNoiseTokens.has(token));
}

function tokenSetCompatible(leftTokens, rightTokens, { allowNumericExtra = false } = {}) {
  if (!leftTokens.length || !rightTokens.length) return true;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const leftOnly = [...left].filter((token) => !right.has(token));
  const rightOnly = [...right].filter((token) => !left.has(token));
  if (!leftOnly.length && !rightOnly.length) return true;
  const extra = leftOnly.length ? leftOnly : rightOnly;
  return allowNumericExtra && extra.length > 0 && extra.every((token) => /^\d+$/.test(token));
}

function productCompatible(left, right) {
  const leftTokens = productSignificantTokens(left);
  const rightTokens = productSignificantTokens(right);
  if (!leftTokens.length || !rightTokens.length) return true;
  return tokenSetCompatible(leftTokens, rightTokens, { allowNumericExtra: true });
}

function valueCompatible(left, right) {
  const leftValue = cleanCompare(left);
  const rightValue = cleanCompare(right);
  return !leftValue || !rightValue || leftValue === rightValue || leftValue.includes(rightValue) || rightValue.includes(leftValue);
}

function subjectCompatible(leftSubjects = [], rightSubjects = []) {
  const left = leftSubjects.map(cleanCompare).filter(Boolean);
  const right = rightSubjects.map(cleanCompare).filter(Boolean);
  if (!left.length || !right.length) return true;
  return left.some((leftName) => right.some((rightName) => (
    leftName === rightName
    || leftName.includes(rightName)
    || rightName.includes(leftName)
    || tokenSetCompatible(compareTokens(leftName), compareTokens(rightName), { allowNumericExtra: false })
  )));
}

function addQueryConflict(conflicts, field) {
  if (!conflicts.includes(field)) conflicts.push(field);
}

function queryCandidateConflictFields(queryFields = {}, candidateFields = {}) {
  const conflicts = [];
  if (queryFields.year && candidateFields.year && !yearsCompatible(queryFields.year, candidateFields.year)) {
    addQueryConflict(conflicts, "year");
  }

  const queryBrand = queryFields.manufacturer || queryFields.brand;
  const candidateBrand = candidateFields.manufacturer || candidateFields.brand;
  if (queryBrand && candidateBrand && !valueCompatible(queryBrand, candidateBrand)) {
    addQueryConflict(conflicts, "manufacturer");
  }

  if (queryFields.product && candidateFields.product && !productCompatible(queryFields.product, candidateFields.product)) {
    addQueryConflict(conflicts, "product");
  }

  if (queryFields.set && candidateFields.set && !productCompatible(queryFields.set, candidateFields.set)) {
    addQueryConflict(conflicts, "set");
  }

  if (!subjectCompatible(queryFields.subjects || [], candidateFields.subjects || [])) {
    addQueryConflict(conflicts, "players");
  }

  if (queryFields.collector_number && candidateFields.collector_number && !valueCompatible(queryFields.collector_number, candidateFields.collector_number)) {
    addQueryConflict(conflicts, "collector_number");
  }

  if (queryFields.checklist_code && candidateFields.checklist_code && !valueCompatible(queryFields.checklist_code, candidateFields.checklist_code)) {
    addQueryConflict(conflicts, "checklist_code");
  }

  if (queryFields.expected_serial_denominator && candidateFields.expected_serial_denominator
    && cleanCompare(queryFields.expected_serial_denominator) !== cleanCompare(candidateFields.expected_serial_denominator)) {
    addQueryConflict(conflicts, "serial_number");
  }

  if (queryFields.surface_color && candidateFields.surface_color && !valueCompatible(queryFields.surface_color, candidateFields.surface_color)) {
    addQueryConflict(conflicts, "surface_color");
  }

  return conflicts;
}

function groupCandidates(candidates = []) {
  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const fields = sanitizedCandidateFields(candidate.fields || {});
    if (!Object.keys(fields).length) return;
    const key = candidateIdentityKey(candidate);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        candidate,
        candidates: [],
        fields,
        referenceIds: new Set(),
        embeddingIds: new Set(),
        conflictingFields: new Set(),
        similarities: [],
        ranks: []
      });
    }
    const group = groups.get(key);
    group.candidates.push(candidate);
    group.referenceIds.add(cleanText(candidate.reference_image_id || candidate.source_url || candidate.candidate_id));
    group.embeddingIds.add(cleanText(candidate.embedding_id || candidate.candidate_id));
    candidateConflictFields(candidate).forEach((field) => group.conflictingFields.add(field));
    group.similarities.push(finiteNumber(candidate.visual_similarity ?? candidate.match_score, 0) || 0);
    group.ranks.push(index + 1);
    const role = candidateRole(candidate);
    const similarity = finiteNumber(candidate.visual_similarity ?? candidate.match_score, null);
    if (role === "front") {
      group.front_similarity = Math.max(finiteNumber(group.front_similarity, 0) || 0, similarity || 0);
      group.front_rank = Math.min(finiteNumber(group.front_rank, Number.POSITIVE_INFINITY), index + 1);
    } else if (role === "back") {
      group.back_similarity = Math.max(finiteNumber(group.back_similarity, 0) || 0, similarity || 0);
      group.back_rank = Math.min(finiteNumber(group.back_rank, Number.POSITIVE_INFINITY), index + 1);
    }
    group.fields = {
      ...fields,
      ...group.fields
    };
  });

  return [...groups.values()];
}

function combinedScore(group = {}) {
  const bestSimilarity = Math.max(...group.similarities, 0);
  const avgSimilarity = group.similarities.length
    ? group.similarities.reduce((sum, value) => sum + value, 0) / group.similarities.length
    : 0;
  const multiViewBoost = group.front_similarity && group.back_similarity ? 0.035 : 0;
  const referenceBoost = Math.min(0.04, Math.max(0, (group.referenceIds.size - 1) * 0.015));
  return Math.min(1, bestSimilarity * 0.72 + avgSimilarity * 0.24 + multiViewBoost + referenceBoost);
}

function top1Top2Margin(scores = [], index = 0) {
  const current = scores[index] || 0;
  const next = index === 0 ? scores[1] || 0 : scores[0] || 0;
  return Math.max(0, current - next);
}

function unavailableStatus(retrieval = {}) {
  const reasons = Array.isArray(retrieval.unavailable) ? retrieval.unavailable : [];
  const text = reasons.map((item) => item.reason || "").join(" ");
  if (/timeout/i.test(text)) return vectorStatus.TIMEOUT;
  if (reasons.length) return vectorStatus.UNAVAILABLE;
  return vectorStatus.UNAVAILABLE;
}

function hybridCandidates(retrieval = {}) {
  if (!retrieval.hybrid_ranker) return [];
  return Array.isArray(retrieval.sources) ? retrieval.sources : [];
}

function channelSupport(candidate = {}) {
  const support = candidate.channel_support && typeof candidate.channel_support === "object"
    ? candidate.channel_support
    : {};
  return Object.fromEntries(
    Object.entries(support).map(([channelId, row]) => [channelId, {
      provider: row.provider || channelId,
      rank: finiteNumber(row.rank, null),
      raw_score: finiteNumber(row.raw_score, null),
      normalized_score: roundScore(row.normalized_score),
      supporting_fields: Array.isArray(row.supporting_fields) ? row.supporting_fields : []
    }])
  );
}

function buildHybridCandidateRows(retrieval = {}, { limit = 5, queryFields = {} } = {}) {
  const sources = hybridCandidates(retrieval);
  return sources.slice(0, Math.max(1, Number(limit) || 5)).map((candidate, index) => {
    const fields = sanitizedCandidateFields(candidate.fields || {});
    const conflicts = [
      ...candidateConflictFields(candidate),
      ...queryCandidateConflictFields(queryFields, fields)
    ];
    return {
    rank: index + 1,
    candidate_id: candidate.candidate_id || `hybrid_candidate_${index + 1}`,
    candidate_identity_id: candidate.candidate_identity_id || null,
    rerank_score: roundScore(candidate.rerank_score ?? candidate.match_score),
    rank_fusion_score: roundScore(candidate.rank_fusion_score),
    top1_top2_margin: index === 0 ? roundScore(retrieval.candidate_margin) : null,
    reference_count: finiteNumber(candidate.reference_count, 1),
    source_trust: sourceTrust(candidate),
    front_similarity: roundScore(candidate.front_similarity),
    back_similarity: roundScore(candidate.back_similarity),
    front_back_identity_agreement: Boolean(candidate.front_back_identity_agreement),
    supporting_fields: Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : [],
    conflicting_fields: [...new Set(conflicts)],
    reference_title: sanitizedReferenceTitle(candidate),
    channel_support: channelSupport(candidate),
    fields
  };
  });
}

export function buildVectorCandidatePacket(retrieval = {}, {
  limit = 5,
  queryFields = {}
} = {}) {
  const queryCandidateFields = sanitizedCandidateFields(queryFields || {});
  const hybridRows = buildHybridCandidateRows(retrieval, { limit, queryFields: queryCandidateFields });
  const sources = Array.isArray(retrieval.sources) ? retrieval.sources : [];
  const vectorSources = sources.filter((candidate) => cleanText(candidate.source_type).toUpperCase() === "VISUAL_VECTOR");
  const status = hybridRows.length || vectorSources.length
    ? vectorStatus.COMPLETED
    : Array.isArray(retrieval.unavailable) && retrieval.unavailable.length
      ? unavailableStatus(retrieval)
      : vectorStatus.NO_CONFIDENT_MATCH;
  const groups = groupCandidates(vectorSources)
    .map((group) => ({
      ...group,
      combined_score: combinedScore(group)
    }))
    .sort((left, right) => right.combined_score - left.combined_score);
  const scores = groups.map((group) => group.combined_score);
  const candidates = groups.slice(0, Math.max(1, Number(limit) || 5)).map((group, index) => {
    const candidate = group.candidate || {};
    return {
      rank: index + 1,
      candidate_id: candidate.candidate_id || `vector_candidate_${index + 1}`,
      candidate_identity_id: candidate.candidate_identity_id || null,
      similarity: roundScore(Math.max(...group.similarities, 0)),
      combined_score: roundScore(group.combined_score),
      top1_top2_margin: roundScore(top1Top2Margin(scores, index)),
      reference_count: Math.max(1, group.referenceIds.size || group.embeddingIds.size || group.candidates.length),
      source_trust: sourceTrust(candidate),
      reference_title: sanitizedReferenceTitle(candidate),
      front_similarity: roundScore(group.front_similarity),
      back_similarity: roundScore(group.back_similarity),
      front_rank: Number.isFinite(group.front_rank) ? group.front_rank : null,
      back_rank: Number.isFinite(group.back_rank) ? group.back_rank : null,
      conflicting_fields: [...new Set([
        ...group.conflictingFields,
        ...queryCandidateConflictFields(queryCandidateFields, group.fields)
      ])],
      fields: group.fields
    };
  });

  return {
    vector_retrieval: {
      status,
      status_code: status === vectorStatus.COMPLETED
        ? "VECTOR_RETRIEVAL_COMPLETED"
        : status === vectorStatus.NO_CONFIDENT_MATCH
          ? "VECTOR_NO_CONFIDENT_MATCH"
          : status === vectorStatus.TIMEOUT
            ? "VECTOR_RETRIEVAL_TIMEOUT"
            : status === vectorStatus.ERROR
              ? "VECTOR_RETRIEVAL_ERROR"
              : "VECTOR_RETRIEVAL_UNAVAILABLE",
      retrieval_strategy: hybridRows.length ? "hybrid_rrf_structured_rerank" : "visual_vector_late_fusion",
      open_set_decision: retrieval.open_set_decision || null,
      open_set_reason: retrieval.open_set_reason || null,
      metrics: retrieval.retrieval_metrics || null,
      instruction: "These are hypotheses, not ground truth. Verify every field against the current card images.",
      candidates: hybridRows.length ? hybridRows : candidates,
      unavailable: Array.isArray(retrieval.unavailable) ? retrieval.unavailable.map((item) => ({
        provider_id: item.provider_id || "",
        reason: item.reason || ""
      })) : []
    }
  };
}

export function vectorCandidatePacketHasCandidates(packet = {}) {
  return Array.isArray(packet.vector_retrieval?.candidates) && packet.vector_retrieval.candidates.length > 0;
}

export function vectorCandidatePacketAssistEligibility(packet = {}) {
  const retrieval = packet.vector_retrieval || {};
  const candidates = Array.isArray(retrieval.candidates) ? retrieval.candidates : [];
  const rawCandidateCount = candidates.length;
  const approved = candidates.filter(isAssistApprovedCandidate);
  const promptCandidates = approved.filter((candidate) => !candidateHasDirectConflict(candidate));
  const blocked = approved.filter(candidateHasDirectConflict);
  const promptCandidateIds = promptCandidates.map(promptCandidateId).filter(Boolean);
  if (!candidates.length) {
    return {
      eligible: false,
      reason: "no_identity_candidates",
      raw_candidate_count: 0,
      approved_candidate_count: 0,
      conflict_blocked_count: 0,
      prompt_candidate_count: 0,
      prompt_candidate_ids: [],
      eligible_candidate_count: 0,
      blocked_candidate_count: 0
    };
  }

  if (promptCandidates.length) {
    return {
      eligible: true,
      reason: "approved_identity_candidate_available",
      raw_candidate_count: rawCandidateCount,
      approved_candidate_count: approved.length,
      conflict_blocked_count: blocked.length,
      prompt_candidate_count: promptCandidates.length,
      prompt_candidate_ids: promptCandidateIds,
      eligible_candidate_count: promptCandidates.length,
      blocked_candidate_count: blocked.length
    };
  }
  if (approved.length && blocked.length === approved.length) {
    return {
      eligible: false,
      reason: "approved_identity_candidate_direct_conflict",
      raw_candidate_count: rawCandidateCount,
      approved_candidate_count: approved.length,
      conflict_blocked_count: blocked.length,
      prompt_candidate_count: 0,
      prompt_candidate_ids: [],
      eligible_candidate_count: 0,
      blocked_candidate_count: blocked.length
    };
  }
  return {
    eligible: false,
    reason: "no_approved_identity_candidate",
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: 0,
    conflict_blocked_count: 0,
    prompt_candidate_count: 0,
    prompt_candidate_ids: [],
    eligible_candidate_count: 0,
    blocked_candidate_count: 0
  };
}

export function buildVectorCandidateAssistPacket(packet = {}) {
  const retrieval = packet.vector_retrieval || {};
  const candidates = Array.isArray(retrieval.candidates) ? retrieval.candidates : [];
  const promptCandidates = candidates.filter(isPromptAssistCandidate).map((candidate, index) => ({
    ...candidate,
    rank: index + 1
  }));
  const eligibility = vectorCandidatePacketAssistEligibility(packet);
  const status = promptCandidates.length ? vectorStatus.COMPLETED : vectorStatus.NO_CONFIDENT_MATCH;
  return {
    vector_retrieval: {
      ...retrieval,
      status,
      status_code: promptCandidates.length
        ? "VECTOR_ASSIST_APPROVED_REFERENCES_AVAILABLE"
        : "VECTOR_ASSIST_NO_APPROVED_PROMPT_CANDIDATES",
      retrieval_strategy: `${retrieval.retrieval_strategy || "vector_retrieval"}_approved_prompt_filter`,
      instruction: "Only APPROVED_REFERENCE candidates without direct conflicts are included. These remain hypotheses and must be verified against the current card images.",
      candidates: promptCandidates,
      assist_filter: eligibility,
      unavailable: Array.isArray(retrieval.unavailable) ? retrieval.unavailable : []
    }
  };
}

export function vectorCandidatePacketHasAssistEligibleCandidates(packet = {}) {
  return vectorCandidatePacketAssistEligibility(packet).prompt_candidate_count > 0;
}
