import { listingKnowledgeRegistry, resolveKnowledgeEntry } from "../../listing-knowledge-registry.mjs";
import { retrievalProviderIds, retrievalSourceTypes, retrievalTrustTiers } from "./retrieval-contract.mjs";

function queryText(query = {}) {
  return String(query.query || "").replace(/"/g, " ").replace(/\s+/g, " ").trim();
}

function matchesEntry(entry, text) {
  if (!text) return false;
  const lowered = text.toLowerCase();
  return entry.aliases.some((alias) => lowered.includes(alias.toLowerCase()))
    || (entry.codePrefixes || []).some((prefix) => new RegExp(`\\b${prefix}[- ][A-Z0-9]+\\b`, "i").test(text));
}

export function internalRegistryProvider() {
  return {
    id: retrievalProviderIds.INTERNAL_REGISTRY,
    source_type: retrievalSourceTypes.INTERNAL_REGISTRY,
    configured: true,
    enabled: true,
    async search({ query }) {
      const text = queryText(query);
      const direct = resolveKnowledgeEntry(text);
      const entries = direct ? [direct] : listingKnowledgeRegistry.filter((entry) => matchesEntry(entry, text));

      return {
        provider_id: retrievalProviderIds.INTERNAL_REGISTRY,
        candidates: entries.slice(0, 6).map((entry) => ({
          source_url: "internal://listing-knowledge-registry",
          domain: "internal",
          source_type: retrievalSourceTypes.INTERNAL_REGISTRY,
          trust_tier: retrievalTrustTiers.INTERNAL_REGISTRY,
          title: entry.label,
          evidence_excerpt: `Internal registry maps ${entry.aliases.join(", ")} to ${entry.label}.`,
          fields: {
            insert: entry.label,
            checklist_code_prefixes: entry.codePrefixes || []
          },
          matched_fields: ["insert"]
        })),
        unavailable: false
      };
    }
  };
}
