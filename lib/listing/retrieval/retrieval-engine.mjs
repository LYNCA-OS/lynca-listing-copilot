import { normalizeRetrievalCandidates } from "./candidate-normalizer.mjs";
import { rankRetrievalCandidates } from "./candidate-matcher.mjs";
import { createRetrievalProviderRegistry } from "./retrieval-provider-registry.mjs";
import { defaultRetrievalCache } from "./retrieval-cache.mjs";
import {
  normalizeRetrievalMode,
  retrievalProviderIds,
  retrievalModes,
  retrievalQueryFamilies,
  retrievalSourceTypes
} from "./retrieval-contract.mjs";
import { createRetrievalTraceEntry } from "./retrieval-trace.mjs";
import { planRetrievalQueries } from "./query-planner.mjs";
import { classifySourceUrl, defaultSourcePolicy } from "./source-policy.mjs";

const officialFollowupSourceTypes = new Set([
  retrievalSourceTypes.OFFICIAL_CHECKLIST,
  retrievalSourceTypes.OFFICIAL_PRODUCT_PAGE,
  retrievalSourceTypes.OFFICIAL_GRADING_DATA,
  retrievalSourceTypes.STRUCTURED_DATABASE
]);

const discoveryProviderIds = new Set([
  retrievalProviderIds.BRAVE_SEARCH,
  retrievalProviderIds.OPENAI_WEB_SEARCH
]);

function envFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function candidateSourceUrl(candidate = {}) {
  const sourceUrl = candidate.source_url || candidate.url || candidate.link || candidate.href || "";
  try {
    const url = new URL(sourceUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function shouldRunQuery(query, {
  mode
}) {
  if (mode === retrievalModes.INTERNAL_ONLY) {
    return [
      retrievalProviderIds.INTERNAL_MEMORY,
      retrievalProviderIds.INTERNAL_REGISTRY,
      retrievalProviderIds.VISUAL_VECTOR
    ].includes(query.provider_id);
  }
  return true;
}

function queryIsCacheable(query = {}) {
  return query.cacheable !== false && !Array.isArray(query.embedding);
}

function shouldRunOfficialFollowups(query, {
  mode,
  maxFollowups
}) {
  return mode !== retrievalModes.INTERNAL_ONLY
    && maxFollowups > 0
    && discoveryProviderIds.has(query.provider_id);
}

function officialFollowupTarget(candidate, {
  sourcePolicy,
  followedSourceUrls
}) {
  const sourceUrl = candidateSourceUrl(candidate);
  if (!sourceUrl || followedSourceUrls.has(sourceUrl)) return null;

  const classification = classifySourceUrl(sourceUrl, { policy: sourcePolicy });
  if (classification.blocked || !officialFollowupSourceTypes.has(classification.source_type)) {
    return null;
  }

  return {
    sourceUrl,
    classification
  };
}

async function fetchOfficialFollowups({
  candidates,
  baseQuery,
  resolved,
  registry,
  sourcePolicy,
  followedSourceUrls,
  remainingFollowups,
  trace,
  unavailable
}) {
  if (remainingFollowups <= 0 || !candidates.length) {
    return {
      candidates: [],
      providers_used: [],
      attempted: 0
    };
  }

  const targets = [];
  for (const candidate of candidates) {
    if (targets.length >= remainingFollowups) break;
    const target = officialFollowupTarget(candidate, {
      sourcePolicy,
      followedSourceUrls
    });
    if (!target) continue;
    followedSourceUrls.add(target.sourceUrl);
    targets.push(target);
  }

  if (!targets.length) {
    return {
      candidates: [],
      providers_used: [],
      attempted: 0
    };
  }

  const provider = registry.get(retrievalProviderIds.OFFICIAL_SOURCE);
  const providersUsed = [];
  const followupCandidates = [];

  if (!provider) {
    for (const [index, target] of targets.entries()) {
      const followupQuery = createOfficialFollowupQuery(baseQuery, target.sourceUrl, index);
      unavailable.push({
        provider_id: retrievalProviderIds.OFFICIAL_SOURCE,
        reason: "provider_not_registered"
      });
      trace.push(createRetrievalTraceEntry({
        query: followupQuery,
        providerId: retrievalProviderIds.OFFICIAL_SOURCE,
        status: "unavailable",
        startedAt: Date.now(),
        reason: "provider_not_registered"
      }));
    }

    return {
      candidates: [],
      providers_used: providersUsed,
      attempted: targets.length
    };
  }

  for (const [index, target] of targets.entries()) {
    const followupQuery = createOfficialFollowupQuery(baseQuery, target.sourceUrl, index);
    const startedAt = Date.now();

    try {
      const response = await provider.search({
        query: followupQuery,
        resolved,
        sourcePolicy
      });
      const providerId = provider.id || retrievalProviderIds.OFFICIAL_SOURCE;
      providersUsed.push(providerId);

      if (response.unavailable) {
        unavailable.push({
          provider_id: providerId,
          reason: response.reason || "provider_unavailable"
        });
        trace.push(createRetrievalTraceEntry({
          query: followupQuery,
          providerId,
          status: "unavailable",
          startedAt,
          reason: response.reason || "provider_unavailable"
        }));
        continue;
      }

      const normalized = normalizeRetrievalCandidates(response.candidates || [], {
        query: followupQuery,
        policy: sourcePolicy
      });
      followupCandidates.push(...normalized);
      trace.push(createRetrievalTraceEntry({
        query: followupQuery,
        providerId,
        status: "ok",
        startedAt,
        candidateCount: normalized.length
      }));
    } catch (error) {
      const providerId = provider.id || retrievalProviderIds.OFFICIAL_SOURCE;
      providersUsed.push(providerId);
      unavailable.push({
        provider_id: providerId,
        reason: error.code || "provider_error"
      });
      trace.push(createRetrievalTraceEntry({
        query: followupQuery,
        providerId,
        status: "error",
        startedAt,
        error
      }));
    }
  }

  return {
    candidates: followupCandidates,
    providers_used: providersUsed,
    attempted: targets.length
  };
}

function createOfficialFollowupQuery(baseQuery = {}, sourceUrl, index) {
  return {
    query_id: `${baseQuery.query_id || "query"}_official_followup_${index + 1}`,
    family: retrievalQueryFamilies.OFFICIAL_SOURCES,
    provider_id: retrievalProviderIds.OFFICIAL_SOURCE,
    query: sourceUrl,
    source_url: sourceUrl,
    parent_query_id: baseQuery.query_id || null,
    parent_provider_id: baseQuery.provider_id || null
  };
}

export async function runRetrieval({
  resolved = {},
  missingFields = [],
  weakFields = [],
  visualEmbeddings = [],
  mode = retrievalModes.AUTO,
  allowedFamilies = null,
  maxQueries = null,
  env = process.env,
  providerRegistry = null,
  cache = defaultRetrievalCache,
  sourcePolicy = defaultSourcePolicy(env)
} = {}) {
  const normalizedMode = normalizeRetrievalMode(mode);
  const registry = providerRegistry || createRetrievalProviderRegistry({ env });
  const activeSourcePolicy = sourcePolicy || defaultSourcePolicy(env);
  const allowOwsFallback = envFlag(env.ENABLE_OPENAI_WEB_SEARCH_FALLBACK, true);
  const maxOfficialFollowups = envFlag(env.ENABLE_RETRIEVAL_OFFICIAL_FOLLOWUP, true)
    ? nonNegativeInteger(env.RETRIEVAL_OFFICIAL_FOLLOWUP_MAX, 3)
    : 0;
  const queries = planRetrievalQueries({
    resolved,
    missingFields,
    weakFields,
    visualEmbeddings,
    includeExternal: normalizedMode !== retrievalModes.INTERNAL_ONLY,
    allowOwsFallback
  });
  const providersUsed = [];
  const unavailable = [];
  const trace = [];
  const allCandidates = [];
  const followedSourceUrls = new Set();
  let officialFollowupsAttempted = 0;
  const allowedFamilySet = Array.isArray(allowedFamilies) && allowedFamilies.length
    ? new Set(allowedFamilies)
    : null;
  const queryLimit = Number.isFinite(Number(maxQueries)) && Number(maxQueries) > 0
    ? Number(maxQueries)
    : null;
  const executableQueries = queries
    .filter((query) => !allowedFamilySet || allowedFamilySet.has(query.family))
    .filter((query) => shouldRunQuery(query, { mode: normalizedMode }))
    .slice(0, queryLimit || undefined);

  for (const query of executableQueries) {
    const provider = registry.get(query.provider_id);
    const startedAt = Date.now();
    if (!provider) {
      unavailable.push({ provider_id: query.provider_id, reason: "provider_not_registered" });
      trace.push(createRetrievalTraceEntry({
        query,
        providerId: query.provider_id,
        status: "unavailable",
        startedAt,
        reason: "provider_not_registered"
      }));
      continue;
    }

    const cacheable = queryIsCacheable(query);
    const cached = cacheable ? cache?.get(query) : null;
    if (cached) {
      providersUsed.push(...(cached.providers_used || [query.provider_id]));
      allCandidates.push(...cached.candidates);
      trace.push(createRetrievalTraceEntry({
        query,
        providerId: query.provider_id,
        status: "cached",
        startedAt,
        candidateCount: cached.candidates.length,
        cacheHit: true
      }));
      continue;
    }

    try {
      const response = await provider.search({ query, resolved, sourcePolicy: activeSourcePolicy });
      providersUsed.push(provider.id || query.provider_id);

      if (response.unavailable) {
        unavailable.push({
          provider_id: provider.id || query.provider_id,
          reason: response.reason || "provider_unavailable"
        });
        trace.push(createRetrievalTraceEntry({
          query,
          providerId: provider.id || query.provider_id,
          status: "unavailable",
          startedAt,
          reason: response.reason || "provider_unavailable"
        }));
        continue;
      }

      const directCandidates = normalizeRetrievalCandidates(response.candidates || [], {
        query,
        policy: activeSourcePolicy
      });
      const providerEndedAt = Date.now();
      trace.push(createRetrievalTraceEntry({
        query,
        providerId: provider.id || query.provider_id,
        status: "ok",
        startedAt,
        endedAt: providerEndedAt,
        candidateCount: directCandidates.length
      }));

      const followup = shouldRunOfficialFollowups(query, {
        mode: normalizedMode,
        maxFollowups: maxOfficialFollowups
      })
        ? await fetchOfficialFollowups({
          candidates: response.candidates || [],
          baseQuery: query,
          resolved,
          registry,
          sourcePolicy: activeSourcePolicy,
          followedSourceUrls,
          remainingFollowups: maxOfficialFollowups - officialFollowupsAttempted,
          trace,
          unavailable
        })
        : {
          candidates: [],
          providers_used: [],
          attempted: 0
        };

      officialFollowupsAttempted += followup.attempted;
      providersUsed.push(...followup.providers_used);
      const candidates = [...directCandidates, ...followup.candidates];
      if (cacheable) {
        cache?.set(query, {
          candidates,
          providers_used: [provider.id || query.provider_id, ...followup.providers_used]
        });
      }
      allCandidates.push(...candidates);
    } catch (error) {
      unavailable.push({
        provider_id: provider.id || query.provider_id,
        reason: error.code || "provider_error"
      });
      trace.push(createRetrievalTraceEntry({
        query,
        providerId: provider.id || query.provider_id,
        status: "error",
        startedAt,
        error
      }));
    }
  }

  const ranked = rankRetrievalCandidates(allCandidates, resolved);
  const candidateConflicts = ranked.candidates
    .filter((candidate) => candidate.conflicting_fields.length)
    .map((candidate) => ({
      candidate_id: candidate.candidate_id,
      fields: candidate.conflicting_fields
    }));

  return {
    mode: normalizedMode,
    providers_used: [...new Set(providersUsed)],
    queries: executableQueries,
    sources: ranked.candidates,
    selected_candidate: ranked.selected_candidate,
    candidate_margin: ranked.candidate_margin,
    candidate_selection_threshold: ranked.candidate_selection_threshold,
    low_margin_conflict: ranked.low_margin_conflict,
    conflicts: ranked.low_margin_conflict
      ? [ranked.low_margin_conflict, ...candidateConflicts]
      : candidateConflicts,
    unavailable,
    trace
  };
}
