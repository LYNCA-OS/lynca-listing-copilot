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

function sourceTrust(candidate = {}) {
  const status = cleanText(candidate.reference_metadata?.reference_status || candidate.reference_metadata?.retrieval_status).toUpperCase();
  if (status === "APPROVED" || status === "REVIEWED") return "APPROVED_REFERENCE";
  const sourceType = cleanText(candidate.source_type).toUpperCase();
  if (sourceType === "VISUAL_VECTOR") return "APPROVED_REFERENCE";
  return "REFERENCE_CANDIDATE";
}

function candidateIdentityKey(candidate = {}) {
  return cleanText(candidate.candidate_identity_id)
    || cleanText(candidate.identity_id)
    || cleanText(candidate.candidate_id)
    || cleanText(candidate.source_url)
    || JSON.stringify(sanitizedCandidateFields(candidate.fields || {}));
}

function candidateRole(candidate = {}) {
  const role = cleanText(candidate.embedding_role || candidate.image_role || "");
  if (role.includes("back")) return "back";
  if (role.includes("front")) return "front";
  return "unknown";
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
        similarities: [],
        ranks: []
      });
    }
    const group = groups.get(key);
    group.candidates.push(candidate);
    group.referenceIds.add(cleanText(candidate.reference_image_id || candidate.source_url || candidate.candidate_id));
    group.embeddingIds.add(cleanText(candidate.embedding_id || candidate.candidate_id));
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

export function buildVectorCandidatePacket(retrieval = {}, {
  limit = 5
} = {}) {
  const sources = Array.isArray(retrieval.sources) ? retrieval.sources : [];
  const vectorSources = sources.filter((candidate) => cleanText(candidate.source_type).toUpperCase() === "VISUAL_VECTOR");
  const status = vectorSources.length
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
      front_similarity: roundScore(group.front_similarity),
      back_similarity: roundScore(group.back_similarity),
      front_rank: Number.isFinite(group.front_rank) ? group.front_rank : null,
      back_rank: Number.isFinite(group.back_rank) ? group.back_rank : null,
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
      instruction: "These are hypotheses, not ground truth. Verify every field against the current card images.",
      candidates,
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
