import {
  isSupabaseFeedbackConfigured,
  listApprovedHistoryRecords,
  listingApprovedMemoryEnabled
} from "../../supabase-feedback.mjs";
import { braveSearchProvider } from "./brave-search-provider.mjs";
import { ebayBrowseProvider } from "./ebay-browse-provider.mjs";
import { internalMemoryProvider } from "./internal-memory-provider.mjs";
import { internalRegistryProvider } from "./internal-registry-provider.mjs";
import { officialSourceProvider } from "./official-source-provider.mjs";
import { openAiWebSearchProvider } from "./openai-web-search-provider.mjs";
import { isKnownRetrievalProviderId, normalizeRetrievalProviderId, retrievalProviderIds } from "./retrieval-contract.mjs";
import { visualVectorProvider } from "./visual-vector-provider.mjs";

function safeOverrideProviders(overrides = {}) {
  return Object.fromEntries(
    Object.entries(overrides)
      .filter(([providerId, provider]) => isKnownRetrievalProviderId(providerId) && provider && typeof provider.search === "function")
      .map(([providerId, provider]) => {
        const normalizedProviderId = normalizeRetrievalProviderId(providerId);
        return [normalizedProviderId, { ...provider, id: normalizedProviderId }];
      })
  );
}

export function createRetrievalProviderRegistry({
  env = process.env,
  fetchImpl = globalThis.fetch,
  approvedRecords = [],
  approvedRecordsLoader = null,
  overrides = {}
} = {}) {
  const loadApprovedRecords = approvedRecordsLoader || (
    listingApprovedMemoryEnabled(env) && isSupabaseFeedbackConfigured(env)
      ? () => listApprovedHistoryRecords({
        env,
        fetchImpl,
        limit: env.INTERNAL_APPROVED_HISTORY_LIMIT
      })
      : null
  );
  const providers = {
    [retrievalProviderIds.INTERNAL_MEMORY]: internalMemoryProvider({ approvedRecords, loadApprovedRecords }),
    [retrievalProviderIds.INTERNAL_REGISTRY]: internalRegistryProvider(),
    [retrievalProviderIds.VISUAL_VECTOR]: visualVectorProvider({ env, fetchImpl }),
    [retrievalProviderIds.OFFICIAL_SOURCE]: officialSourceProvider({ fetchImpl }),
    [retrievalProviderIds.BRAVE_SEARCH]: braveSearchProvider({ env, fetchImpl }),
    [retrievalProviderIds.EBAY_BROWSE]: ebayBrowseProvider({ env, fetchImpl }),
    [retrievalProviderIds.OPENAI_WEB_SEARCH]: openAiWebSearchProvider({ env, fetchImpl }),
    ...safeOverrideProviders(overrides)
  };

  return {
    providers,
    get(providerId) {
      if (!isKnownRetrievalProviderId(providerId)) return null;
      return providers[normalizeRetrievalProviderId(providerId)] || null;
    },
    list() {
      return Object.values(providers);
    }
  };
}
