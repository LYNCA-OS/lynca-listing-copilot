import { normalizeRetrievalCandidates } from "./candidate-normalizer.mjs";
import { rankRetrievalCandidates } from "./candidate-matcher.mjs";
import { rankHybridRetrievalCandidates } from "./hybrid-reranker.mjs";
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

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

async function mapWithConcurrency(items = [], limit = 1, worker) {
  const source = Array.from(items || []);
  const results = new Array(source.length);
  const workerCount = Math.max(1, Math.min(positiveInteger(limit, 1), source.length || 1));
  let cursor = 0;

  async function runWorker() {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
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
      retrievalProviderIds.CATALOG,
      retrievalProviderIds.VISUAL_VECTOR,
      retrievalProviderIds.POSTGRES_HYBRID
    ].includes(query.provider_id);
  }
  return true;
}

function queryIsCacheable(query = {}) {
  return query.cacheable !== false && !Array.isArray(query.embedding);
}

function internalQueryConcurrency(env = process.env, queryCount = 0) {
  if (!envFlag(env.ENABLE_INTERNAL_RETRIEVAL_QUERY_CONCURRENCY, true)) return 1;
  return Math.max(1, Math.min(positiveInteger(env.RETRIEVAL_INTERNAL_QUERY_CONCURRENCY, 4), queryCount || 1));
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

function catalogRetrievalMetrics({
  queries = [],
  candidates = [],
  rankedCandidates = [],
  selectedCandidate = null
} = {}) {
  const isOfficialChecklistSource = (sourceType = "") => /(?:_OFFICIAL_CHECKLIST|_OFFICIAL_CARDLIST|_OFFICIAL_CARD_DATABASE|_OFFICIAL_DATABASE|OFFICIAL_CARD_SEARCH)$/i.test(String(sourceType || ""));
  const isOfficialReleaseSource = (sourceType = "") => /(?:_OFFICIAL_RELEASE|OFFICIAL_RELEASE_PAGE|OFFICIAL_DIGITAL_LIBRARY)$/i.test(String(sourceType || ""));
  const isCommunitySource = (sourceType = "") => /_COMMUNITY_API$/i.test(String(sourceType || ""));
  const catalogQueryCount = queries.filter((query) => query.provider_id === retrievalProviderIds.CATALOG).length;
  const catalogCandidates = rankedCandidates.filter((candidate) => candidate.provider_id === retrievalProviderIds.CATALOG);
  const vectorCandidates = rankedCandidates.filter((candidate) => candidate.source_type === retrievalSourceTypes.VISUAL_VECTOR || candidate.provider_id === retrievalProviderIds.VISUAL_VECTOR);
  const rawVectorCandidates = candidates.filter((candidate) => candidate.source_type === retrievalSourceTypes.VISUAL_VECTOR || candidate.provider_id === retrievalProviderIds.VISUAL_VECTOR);
  const sourceBreakdown = catalogCandidates.reduce((acc, candidate) => {
    const sourceType = candidate.reference_metadata?.source_type || "UNKNOWN";
    if (sourceType === "INTERNAL_CORRECTED_TITLE") acc.source_breakdown_internal_corrected_title += 1;
    if (sourceType === "TOPPS_OFFICIAL_CHECKLIST") acc.source_breakdown_topps_official += 1;
    if (sourceType === "PANINI_OFFICIAL_CHECKLIST") acc.source_breakdown_panini_official += 1;
    if (sourceType === "UPPER_DECK_OFFICIAL_CHECKLIST") acc.source_breakdown_upper_deck_official += 1;
    if (sourceType === "LEAF_OFFICIAL_CHECKLIST" || sourceType === "LEAF_OFFICIAL_RELEASE") acc.source_breakdown_leaf_official += 1;
    if (sourceType === "FUTERA_OFFICIAL_CHECKLIST") acc.source_breakdown_futera_official += 1;
    if (/^BANDAI_/i.test(sourceType)) acc.source_breakdown_bandai_official += 1;
    if (/^POKEMON_/i.test(sourceType)) acc.source_breakdown_pokemon += 1;
    if (/YUGIOH|YGOPRO/i.test(sourceType)) acc.source_breakdown_yugioh += 1;
    if (isCommunitySource(sourceType)) acc.source_breakdown_community_api += 1;
    if (isOfficialChecklistSource(sourceType)) acc.source_breakdown_official_checklist += 1;
    if (isOfficialReleaseSource(sourceType)) acc.source_breakdown_official_release += 1;
    return acc;
  }, {
    source_breakdown_internal_corrected_title: 0,
    source_breakdown_topps_official: 0,
    source_breakdown_panini_official: 0,
    source_breakdown_upper_deck_official: 0,
    source_breakdown_leaf_official: 0,
    source_breakdown_futera_official: 0,
    source_breakdown_bandai_official: 0,
    source_breakdown_pokemon: 0,
    source_breakdown_yugioh: 0,
    source_breakdown_community_api: 0,
    source_breakdown_official_checklist: 0,
    source_breakdown_official_release: 0
  });

  return {
    catalog_lookup_used_count: catalogQueryCount,
    catalog_lookup_no_match_count: catalogQueryCount && !catalogCandidates.length ? 1 : 0,
    catalog_candidate_count: catalogCandidates.length,
    catalog_candidate_selected_count: selectedCandidate?.provider_id === retrievalProviderIds.CATALOG ? 1 : 0,
    catalog_candidate_blocked_by_conflict_count: catalogCandidates.filter((candidate) => candidate.conflicting_fields?.length).length,
    catalog_field_support_count: catalogCandidates.reduce((sum, candidate) => sum + (candidate.supporting_fields?.length || 0), 0),
    catalog_recovery_count: 0,
    catalog_regression_count: 0,
    ...sourceBreakdown,
    vector_raw_candidate_count: rawVectorCandidates.length,
    vector_prompt_candidate_count: vectorCandidates.filter((candidate) => !candidate.conflicting_fields?.length && candidate.reference_metadata?.retrieval_status === "approved").length
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
  sourcePolicy = defaultSourcePolicy(env),
  hardNegatives = []
} = {}) {
  const normalizedMode = normalizeRetrievalMode(mode);
  const registry = providerRegistry || createRetrievalProviderRegistry({ env });
  const activeSourcePolicy = sourcePolicy || defaultSourcePolicy(env);
  const allowOwsFallback = envFlag(env.ENABLE_OPENAI_WEB_SEARCH_FALLBACK, true);
  const hybridEnabled = envFlag(env.ENABLE_ADVANCED_RETRIEVAL, false) || envFlag(env.ENABLE_HYBRID_RETRIEVAL, false);
  const rrfK = nonNegativeInteger(env.ADVANCED_RETRIEVAL_RRF_K, 60) || 60;
  const lowMarginThreshold = Number.isFinite(Number(env.ADVANCED_RETRIEVAL_LOW_MARGIN))
    ? Number(env.ADVANCED_RETRIEVAL_LOW_MARGIN)
    : 0.03;
  const maxOfficialFollowups = envFlag(env.ENABLE_RETRIEVAL_OFFICIAL_FOLLOWUP, true)
    ? nonNegativeInteger(env.RETRIEVAL_OFFICIAL_FOLLOWUP_MAX, 3)
    : 0;
  const queries = planRetrievalQueries({
    resolved,
    missingFields,
    weakFields,
    visualEmbeddings,
    includeExternal: normalizedMode !== retrievalModes.INTERNAL_ONLY,
    includeHybrid: hybridEnabled,
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
  const queryExecutionConcurrency = normalizedMode === retrievalModes.INTERNAL_ONLY
    ? internalQueryConcurrency(env, executableQueries.length)
    : 1;

  async function runInternalQuery(query) {
    const provider = registry.get(query.provider_id);
    const startedAt = Date.now();
    const result = {
      candidates: [],
      providers_used: [],
      unavailable: [],
      trace: []
    };

    if (!provider) {
      result.unavailable.push({ provider_id: query.provider_id, reason: "provider_not_registered" });
      result.trace.push(createRetrievalTraceEntry({
        query,
        providerId: query.provider_id,
        status: "unavailable",
        startedAt,
        reason: "provider_not_registered"
      }));
      return result;
    }

    const cacheable = queryIsCacheable(query);
    const cached = cacheable ? cache?.get(query) : null;
    if (cached) {
      result.providers_used.push(...(cached.providers_used || [query.provider_id]));
      result.candidates.push(...cached.candidates);
      result.trace.push(createRetrievalTraceEntry({
        query,
        providerId: query.provider_id,
        status: "cached",
        startedAt,
        candidateCount: cached.candidates.length,
        cacheHit: true
      }));
      return result;
    }

    try {
      const response = await provider.search({ query, resolved, sourcePolicy: activeSourcePolicy });
      result.providers_used.push(provider.id || query.provider_id);

      if (response.unavailable) {
        result.unavailable.push({
          provider_id: provider.id || query.provider_id,
          reason: response.reason || "provider_unavailable"
        });
        result.trace.push(createRetrievalTraceEntry({
          query,
          providerId: provider.id || query.provider_id,
          status: "unavailable",
          startedAt,
          reason: response.reason || "provider_unavailable"
        }));
        return result;
      }

      const directCandidates = normalizeRetrievalCandidates(response.candidates || [], {
        query,
        policy: activeSourcePolicy
      });
      result.trace.push(createRetrievalTraceEntry({
        query,
        providerId: provider.id || query.provider_id,
        status: "ok",
        startedAt,
        endedAt: Date.now(),
        candidateCount: directCandidates.length,
        metadata: response.metadata || null
      }));
      result.candidates.push(...directCandidates);

      if (cacheable) {
        cache?.set(query, {
          candidates: directCandidates,
          providers_used: [provider.id || query.provider_id]
        });
      }
      return result;
    } catch (error) {
      result.unavailable.push({
        provider_id: provider.id || query.provider_id,
        reason: error.code || "provider_error"
      });
      result.trace.push(createRetrievalTraceEntry({
        query,
        providerId: provider.id || query.provider_id,
        status: "error",
        startedAt,
        error
      }));
      return result;
    }
  }

  if (queryExecutionConcurrency > 1 && executableQueries.length > 1) {
    const queryResults = await mapWithConcurrency(executableQueries, queryExecutionConcurrency, runInternalQuery);
    for (const result of queryResults) {
      providersUsed.push(...result.providers_used);
      unavailable.push(...result.unavailable);
      trace.push(...result.trace);
      allCandidates.push(...result.candidates);
    }
  } else {
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
        candidateCount: directCandidates.length,
        metadata: response.metadata || null
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
  }

  const ranked = hybridEnabled
    ? rankHybridRetrievalCandidates(allCandidates, resolved, {
      rrfK,
      lowMarginThreshold,
      hardNegatives
    })
    : rankRetrievalCandidates(allCandidates, resolved);
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
    hybrid_ranker: ranked.hybrid_ranker || null,
    open_set_decision: ranked.open_set_decision || null,
    open_set_reason: ranked.open_set_reason || null,
    retrieval_metrics: ranked.retrieval_metrics || null,
    catalog_retrieval_metrics: catalogRetrievalMetrics({
      queries: executableQueries,
      candidates: allCandidates,
      rankedCandidates: ranked.candidates,
      selectedCandidate: ranked.selected_candidate
    }),
    query_execution: {
      mode: queryExecutionConcurrency > 1 && executableQueries.length > 1 ? "parallel_internal" : "sequential",
      concurrency: queryExecutionConcurrency,
      query_count: executableQueries.length
    },
    channels: ranked.channels || null,
    conflicts: ranked.low_margin_conflict
      ? [ranked.low_margin_conflict, ...candidateConflicts]
      : candidateConflicts,
    unavailable,
    trace
  };
}
