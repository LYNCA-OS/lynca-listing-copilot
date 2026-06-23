import { retrievalProviderIds } from "./retrieval-contract.mjs";
import { reviewedTitleRecordToMemoryRecord } from "../memory/title-field-parser.mjs";

function hasValue(value, fieldName = "") {
  if (fieldName === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function compactFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([fieldName, value]) => hasValue(value, fieldName))
  );
}

function memoryFieldsForRecord(record = {}) {
  const parsed = reviewedTitleRecordToMemoryRecord(record).fields || {};
  return {
    ...compactFields(parsed),
    ...compactFields(record.fields || {})
  };
}

function memoryRecordForSearch(record = {}) {
  return {
    ...record,
    fields: memoryFieldsForRecord(record)
  };
}

export function internalMemoryProvider({
  approvedRecords = [],
  loadApprovedRecords = null
} = {}) {
  return {
    id: retrievalProviderIds.INTERNAL_MEMORY,
    configured: true,
    enabled: true,
    async search({ query }) {
      let loadedRecords = [];
      if (typeof loadApprovedRecords === "function") {
        try {
          loadedRecords = await loadApprovedRecords({ query });
        } catch (error) {
          return {
            provider_id: retrievalProviderIds.INTERNAL_MEMORY,
            unavailable: true,
            reason: error?.message || "approved history retrieval failed",
            candidates: []
          };
        }
      }

      const text = String(query?.query || "").toLowerCase();
      const records = [...approvedRecords, ...loadedRecords].map(memoryRecordForSearch).filter((record) => {
        const haystack = [
          record.title,
          record.final_title,
          ...Object.values(record.fields || {})
        ].filter(Boolean).join(" ").toLowerCase();
        return text.split(/\s+/).filter((part) => part.length > 2).some((part) => haystack.includes(part.replace(/"/g, "")));
      });

      return {
        provider_id: retrievalProviderIds.INTERNAL_MEMORY,
        candidates: records.slice(0, 8).map((record, index) => ({
          candidate_id: record.id || `internal_memory_${index + 1}`,
          source_url: record.id ? `internal://approved-history/${record.id}` : "internal://approved-history",
          domain: "internal-approved-history",
          source_type: "INTERNAL_APPROVED_HISTORY",
          trust_tier: 3,
          title: record.final_title || record.title || "",
          evidence_excerpt: [
            "Previously approved internal listing record.",
            record.legacy_feedback ? "legacy corrected feedback title parsed into fields" : "",
            record.review_outcome ? `review outcome ${record.review_outcome}` : "",
            record.training_status ? `training status ${record.training_status}` : "",
            record.stable_training_sample ? "stable cleaned sample" : "",
            record.approved_at ? `approved at ${record.approved_at}` : ""
          ].filter(Boolean).join(" "),
          fields: record.fields || {},
          asset_fingerprint: record.asset_fingerprint || "",
          reusable_approved_title: record.reusable_approved_title === true,
          matched_fields: Object.keys(record.fields || {})
        })),
        unavailable: false
      };
    }
  };
}
