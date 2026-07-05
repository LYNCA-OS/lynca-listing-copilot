import { retrievalProviderIds } from "./retrieval-contract.mjs";
import { extractOfficialSourceFields } from "./official-source-field-extractor.mjs";
import { fetchRetrievalSource } from "./source-fetcher.mjs";

function directSourceUrl(query = {}) {
  const candidate = query.source_url || query.url || query.href || query.query || "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function officialSourceProvider({
  fetchImpl = globalThis.fetch
} = {}) {
  return {
    id: retrievalProviderIds.OFFICIAL_SOURCE,
    configured: true,
    enabled: true,
    async search({ query = {}, resolved = {}, sourcePolicy } = {}) {
      const sourceUrl = directSourceUrl(query);
      if (!sourceUrl) {
        return {
          provider_id: retrievalProviderIds.OFFICIAL_SOURCE,
          unavailable: true,
          reason: "official_source_provider_requires_direct_source_url",
          candidates: []
        };
      }

      const source = await fetchRetrievalSource({
        sourceUrl,
        fetchImpl,
        policy: sourcePolicy
      });

      return {
        provider_id: retrievalProviderIds.OFFICIAL_SOURCE,
        unavailable: false,
        candidates: [
          {
            source_url: source.source_url,
            domain: source.domain,
            source_type: source.source_type,
            trust_tier: source.trust_tier,
            title: source.text.slice(0, 140),
            evidence_excerpt: source.text.slice(0, 700),
            fields: extractOfficialSourceFields({
              text: source.text,
              resolved
            }),
            prompt_injection_signals: source.prompt_injection_signals,
            fetched_at: source.fetched_at
          }
        ]
      };
    }
  };
}
