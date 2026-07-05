export const sourceTrustValues = Object.freeze({
  REVIEWED_INTERNAL: "REVIEWED_INTERNAL",
  OFFICIAL_CHECKLIST: "OFFICIAL_CHECKLIST",
  INTERNAL_VERIFIED_TITLE: "INTERNAL_VERIFIED_TITLE",
  LICENSED_EXTERNAL_DIRECTORY: "LICENSED_EXTERNAL_DIRECTORY",
  EXTERNAL_DIRECTORY_WEAK: "EXTERNAL_DIRECTORY_WEAK",
  MARKETPLACE_CLUSTER: "MARKETPLACE_CLUSTER",
  MARKETPLACE_RAW: "MARKETPLACE_RAW",
  VISUAL_ONLY: "VISUAL_ONLY"
});

export const sourceTrustLadder = Object.freeze([
  sourceTrustValues.REVIEWED_INTERNAL,
  sourceTrustValues.OFFICIAL_CHECKLIST,
  sourceTrustValues.INTERNAL_VERIFIED_TITLE,
  sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY,
  sourceTrustValues.EXTERNAL_DIRECTORY_WEAK,
  sourceTrustValues.MARKETPLACE_CLUSTER,
  sourceTrustValues.MARKETPLACE_RAW,
  sourceTrustValues.VISUAL_ONLY
]);

export const allowedUsageValues = Object.freeze({
  CANDIDATE_GENERATION: "candidate_generation",
  LEGALITY_CHECK: "legality_check",
  ALIAS_LEARNING: "alias_learning",
  RERANKER_FEATURE: "reranker_feature",
  WRITER_REFERENCE: "writer_reference",
  PROMPT_ASSIST_ALLOWED: "prompt_assist_allowed",
  FIELD_AUTO_APPLY_ALLOWED: "field_auto_apply_allowed"
});

export const forbiddenUsageValues = Object.freeze({
  DIRECT_TITLE_RENDERING: "direct_title_rendering",
  REVIEWED_INTERNAL_PROMOTION_WITHOUT_REVIEW: "reviewed_internal_promotion_without_review",
  SERIAL_NUMERATOR_COPY: "serial_numerator_copy",
  GRADE_CERT_COPY: "grade_cert_copy",
  EXACT_PARALLEL_AUTO_PUBLISH: "exact_parallel_auto_publish"
});

export const externalMatchLevels = Object.freeze({
  EXACT_CARD: "exact_card",
  SET_LEVEL: "set_level",
  PRODUCT_LEVEL: "product_level",
  NO_MATCH: "no_match",
  UNKNOWN: "unknown"
});

const usageProfiles = Object.freeze({
  [sourceTrustValues.REVIEWED_INTERNAL]: [
    allowedUsageValues.CANDIDATE_GENERATION,
    allowedUsageValues.LEGALITY_CHECK,
    allowedUsageValues.ALIAS_LEARNING,
    allowedUsageValues.RERANKER_FEATURE,
    allowedUsageValues.WRITER_REFERENCE,
    allowedUsageValues.PROMPT_ASSIST_ALLOWED,
    allowedUsageValues.FIELD_AUTO_APPLY_ALLOWED
  ],
  [sourceTrustValues.OFFICIAL_CHECKLIST]: [
    allowedUsageValues.CANDIDATE_GENERATION,
    allowedUsageValues.LEGALITY_CHECK,
    allowedUsageValues.ALIAS_LEARNING,
    allowedUsageValues.RERANKER_FEATURE,
    allowedUsageValues.WRITER_REFERENCE,
    allowedUsageValues.PROMPT_ASSIST_ALLOWED,
    allowedUsageValues.FIELD_AUTO_APPLY_ALLOWED
  ],
  [sourceTrustValues.INTERNAL_VERIFIED_TITLE]: [
    allowedUsageValues.CANDIDATE_GENERATION,
    allowedUsageValues.LEGALITY_CHECK,
    allowedUsageValues.ALIAS_LEARNING,
    allowedUsageValues.RERANKER_FEATURE,
    allowedUsageValues.WRITER_REFERENCE,
    allowedUsageValues.PROMPT_ASSIST_ALLOWED,
    allowedUsageValues.FIELD_AUTO_APPLY_ALLOWED
  ],
  [sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY]: [
    allowedUsageValues.CANDIDATE_GENERATION,
    allowedUsageValues.LEGALITY_CHECK,
    allowedUsageValues.ALIAS_LEARNING,
    allowedUsageValues.RERANKER_FEATURE,
    allowedUsageValues.WRITER_REFERENCE,
    allowedUsageValues.PROMPT_ASSIST_ALLOWED
  ],
  [sourceTrustValues.EXTERNAL_DIRECTORY_WEAK]: [
    allowedUsageValues.CANDIDATE_GENERATION,
    allowedUsageValues.LEGALITY_CHECK,
    allowedUsageValues.RERANKER_FEATURE,
    allowedUsageValues.WRITER_REFERENCE
  ],
  [sourceTrustValues.MARKETPLACE_CLUSTER]: [
    allowedUsageValues.CANDIDATE_GENERATION,
    allowedUsageValues.RERANKER_FEATURE,
    allowedUsageValues.WRITER_REFERENCE
  ],
  [sourceTrustValues.MARKETPLACE_RAW]: [
    allowedUsageValues.RERANKER_FEATURE,
    allowedUsageValues.WRITER_REFERENCE
  ],
  [sourceTrustValues.VISUAL_ONLY]: [
    allowedUsageValues.CANDIDATE_GENERATION,
    allowedUsageValues.RERANKER_FEATURE,
    allowedUsageValues.WRITER_REFERENCE
  ]
});

const forbiddenProfiles = Object.freeze({
  [sourceTrustValues.REVIEWED_INTERNAL]: [
    forbiddenUsageValues.DIRECT_TITLE_RENDERING,
    forbiddenUsageValues.SERIAL_NUMERATOR_COPY,
    forbiddenUsageValues.GRADE_CERT_COPY
  ],
  [sourceTrustValues.OFFICIAL_CHECKLIST]: [
    forbiddenUsageValues.DIRECT_TITLE_RENDERING,
    forbiddenUsageValues.SERIAL_NUMERATOR_COPY,
    forbiddenUsageValues.GRADE_CERT_COPY
  ],
  [sourceTrustValues.INTERNAL_VERIFIED_TITLE]: [
    forbiddenUsageValues.DIRECT_TITLE_RENDERING,
    forbiddenUsageValues.SERIAL_NUMERATOR_COPY,
    forbiddenUsageValues.GRADE_CERT_COPY
  ]
});

const defaultForbiddenUsage = Object.freeze([
  forbiddenUsageValues.DIRECT_TITLE_RENDERING,
  forbiddenUsageValues.REVIEWED_INTERNAL_PROMOTION_WITHOUT_REVIEW,
  forbiddenUsageValues.SERIAL_NUMERATOR_COPY,
  forbiddenUsageValues.GRADE_CERT_COPY,
  forbiddenUsageValues.EXACT_PARALLEL_AUTO_PUBLISH
]);

const allowedUsageSet = new Set(Object.values(allowedUsageValues));
const forbiddenUsageSet = new Set(Object.values(forbiddenUsageValues));
const physicalInstanceFieldSet = new Set([
  "serial_number",
  "serial_numerator",
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "cert_number",
  "certificate_number"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

export function normalizeSourceTrust(value, fallback = sourceTrustValues.EXTERNAL_DIRECTORY_WEAK) {
  const normalized = cleanText(value).toUpperCase();
  return sourceTrustLadder.includes(normalized) ? normalized : fallback;
}

export function allowedUsageForTrust(sourceTrust) {
  return [...(usageProfiles[normalizeSourceTrust(sourceTrust)] || [])];
}

export function forbiddenUsageForTrust(sourceTrust) {
  const trust = normalizeSourceTrust(sourceTrust);
  return [...(forbiddenProfiles[trust] || defaultForbiddenUsage)];
}

export function sourceTrustRank(sourceTrust) {
  const index = sourceTrustLadder.indexOf(normalizeSourceTrust(sourceTrust));
  return index >= 0 ? sourceTrustLadder.length - index : 0;
}

export function isExternalDirectoryTrust(sourceTrust) {
  if (!cleanText(sourceTrust)) return false;
  return [
    sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY,
    sourceTrustValues.EXTERNAL_DIRECTORY_WEAK
  ].includes(normalizeSourceTrust(sourceTrust));
}

export function isMarketplaceTrust(sourceTrust) {
  if (!cleanText(sourceTrust)) return false;
  return [
    sourceTrustValues.MARKETPLACE_CLUSTER,
    sourceTrustValues.MARKETPLACE_RAW
  ].includes(normalizeSourceTrust(sourceTrust));
}

export function normalizeMatchLevel(value) {
  const normalized = cleanText(value).toLowerCase();
  return Object.values(externalMatchLevels).includes(normalized)
    ? normalized
    : externalMatchLevels.UNKNOWN;
}

function sanitizeParallelCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const numberedTo = value.numbered_to ?? value.numberedTo ?? null;
  const candidate = {
    id: cleanText(value.id || value.parallel_id || value.parallelId),
    name: cleanText(value.name || value.parallel_name || value.parallelName),
    family: cleanText(value.family || value.parallel_family),
    surface_color: cleanText(value.surface_color),
    description: cleanText(value.description),
    numbered_to: numberedTo === null || numberedTo === undefined || numberedTo === "" ? null : cleanText(numberedTo)
  };
  return Object.values(candidate).some((item) => item !== null && item !== "") ? candidate : null;
}

export function sanitizeExternalCandidateFields(fields = {}) {
  const input = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  const output = {};
  Object.entries(input).forEach(([key, value]) => {
    if (physicalInstanceFieldSet.has(key)) return;
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "string" && cleanText(value) === "") return;
    output[key] = value;
  });

  const cardNumber = output.card_number || output.collector_number || output.number;
  if (cardNumber) {
    output.card_number = cleanText(cardNumber);
    output.collector_number = output.collector_number || cleanText(cardNumber);
  }

  const release = output.release || output.product;
  if (release) output.release = cleanText(release);
  if (output.product) output.product = cleanText(output.product);
  if (output.set_or_insert && !output.insert) output.insert = output.set_or_insert;
  if (output.set && !output.insert) output.insert = output.set;

  const parallel = sanitizeParallelCandidate(output.parallel_candidate || output.parallel);
  if (parallel) {
    output.parallel_candidate = parallel;
    delete output.parallel;
  }

  return output;
}

export function externalCandidateStableId(candidate = {}) {
  return cleanText(
    candidate.candidate_id
    || candidate.external_card_id
    || candidate.external_set_id
    || candidate.external_release_id
    || candidate.source_trace?.source_url
    || candidate.title
  );
}

export function normalizeExternalCandidate(candidate = {}, {
  providerId = "",
  sourceTrust = sourceTrustValues.EXTERNAL_DIRECTORY_WEAK,
  rank = 1,
  mode = "",
  defaultAllowedUsage = null,
  defaultForbiddenUsageOverride = null
} = {}) {
  const trust = normalizeSourceTrust(candidate.source_trust || candidate.source_type || sourceTrust);
  const fields = sanitizeExternalCandidateFields(candidate.fields || {});
  const parallelCandidate = sanitizeParallelCandidate(candidate.parallel_candidate || fields.parallel_candidate);
  const allowed = unique([
    ...(defaultAllowedUsage || allowedUsageForTrust(trust)),
    ...normalizeArray(candidate.allowed_usage)
  ]).filter((item) => allowedUsageSet.has(item));
  const forbidden = unique([
    ...(defaultForbiddenUsageOverride || forbiddenUsageForTrust(trust)),
    ...normalizeArray(candidate.forbidden_usage)
  ]).filter((item) => forbiddenUsageSet.has(item));

  return {
    provider_id: cleanText(candidate.provider_id || providerId),
    source_trust: trust,
    source_type: trust,
    used_as_truth: false,
    match_level: normalizeMatchLevel(candidate.match_level),
    confidence: cleanText(candidate.confidence),
    rank: Number.isFinite(Number(candidate.rank)) ? Number(candidate.rank) : rank,
    candidate_id: externalCandidateStableId(candidate),
    external_card_id: cleanText(candidate.external_card_id),
    external_set_id: cleanText(candidate.external_set_id),
    external_release_id: cleanText(candidate.external_release_id),
    title: cleanText(candidate.title || candidate.reference_title),
    fields,
    parallel_candidate: parallelCandidate,
    grading_candidate: candidate.grading_candidate || null,
    allowed_usage: allowed,
    forbidden_usage: forbidden,
    source_trace: candidate.source_trace || {},
    latency_ms: Number.isFinite(Number(candidate.latency_ms)) ? Number(candidate.latency_ms) : null,
    cost_estimate: candidate.cost_estimate ?? null,
    mode: cleanText(candidate.mode || mode),
    raw_card: candidate.raw_card || null
  };
}

export function forbiddenUsageViolations(candidate = {}) {
  const normalized = normalizeExternalCandidate(candidate, {
    providerId: candidate.provider_id || "external"
  });
  const violations = [];
  normalized.allowed_usage.forEach((usage) => {
    if (normalized.forbidden_usage.includes(usage)) violations.push(`usage_conflict:${usage}`);
  });
  Object.keys(candidate.fields || {}).forEach((field) => {
    if (physicalInstanceFieldSet.has(field)) violations.push(`physical_instance_field:${field}`);
  });
  if (candidate.used_as_truth === true) violations.push("external_candidate_used_as_truth");
  if (normalized.source_trust !== sourceTrustValues.REVIEWED_INTERNAL
    && candidate.review_status === sourceTrustValues.REVIEWED_INTERNAL) {
    violations.push("external_candidate_marked_reviewed_internal");
  }
  return unique(violations);
}

function unavailable(providerId, reason, code = "external_provider_unavailable") {
  return {
    provider_id: providerId,
    unavailable: true,
    reason,
    code,
    candidates: []
  };
}

export function createUnavailableExternalCandidateProvider({
  providerId = "external_unavailable",
  reason = "External candidate provider is not configured."
} = {}) {
  return {
    id: providerId,
    configured: false,
    async searchByObservedFields() {
      return unavailable(providerId, reason);
    },
    async identifyImage() {
      return unavailable(providerId, reason);
    },
    async getCard() {
      return unavailable(providerId, reason);
    },
    async getParallels() {
      return unavailable(providerId, reason);
    }
  };
}

export function createMockExternalCandidateProvider({
  providerId = "mock_external_directory",
  sourceTrust = sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY,
  candidates = [],
  latencyMs = 0
} = {}) {
  const normalizedCandidates = candidates.map((candidate, index) => normalizeExternalCandidate(candidate, {
    providerId,
    sourceTrust,
    rank: index + 1,
    mode: candidate.mode || "mock"
  }));

  async function resultFor(mode) {
    return {
      provider_id: providerId,
      source_trust: normalizeSourceTrust(sourceTrust),
      latency_ms: latencyMs,
      candidates: normalizedCandidates.map((candidate) => ({
        ...candidate,
        mode: candidate.mode || mode,
        latency_ms: candidate.latency_ms ?? latencyMs
      }))
    };
  }

  return {
    id: providerId,
    configured: true,
    async searchByObservedFields() {
      return resultFor("catalog_search");
    },
    async identifyImage() {
      return resultFor("identify_image");
    },
    async getCard(cardId) {
      return {
        provider_id: providerId,
        source_trust: normalizeSourceTrust(sourceTrust),
        candidate: normalizedCandidates.find((candidate) => candidate.external_card_id === cardId || candidate.candidate_id === cardId) || null
      };
    },
    async getParallels(cardId) {
      const candidate = normalizedCandidates.find((row) => row.external_card_id === cardId || row.candidate_id === cardId);
      return {
        provider_id: providerId,
        source_trust: normalizeSourceTrust(sourceTrust),
        parallels: candidate?.parallel_candidate ? [candidate.parallel_candidate] : []
      };
    }
  };
}
