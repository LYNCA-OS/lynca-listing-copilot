import { isOfficialCatalogSourceType } from "./catalog-contract.mjs";

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedText(value = "") {
  return cleanText(value).toLowerCase();
}

export function canonicalOfficialSourceUrl(value = "") {
  try {
    const url = new URL(cleanText(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) return "";
    return url.href;
  } catch {
    return "";
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function requiredRecordIdentity(record = {}) {
  return JSON.stringify([
    cleanText(record.card_number),
    cleanText(record.checklist_code),
    cleanText(record.external_id),
    cleanText(record.subject),
    cleanText(record.card_name),
    cleanText(record.product),
    cleanText(record.set_or_insert),
    cleanText(record.parallel_exact),
    cleanText(record.rarity),
    cleanText(record.official_card_type)
  ]);
}

function issue(code, details = {}) {
  return { code, ...details };
}

export function validateOfficialCatalogManifestSet(entries = [], {
  providerProfiles = {}
} = {}) {
  const errors = [];
  const providers = new Map();
  const sourceUrls = new Map();
  const sourceNames = new Map();
  let sourceCount = 0;

  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(issue("official_manifest_set_empty"));
  }

  for (const [manifestIndex, entry] of (entries || []).entries()) {
    const file = cleanText(entry?.file || `manifest-${manifestIndex + 1}`);
    const manifest = entry?.manifest || entry || {};
    const provider = normalizedText(manifest.provider);
    const profile = providerProfiles[provider];
    const sources = Array.isArray(manifest.sources) ? manifest.sources : [];

    if (!provider) errors.push(issue("official_manifest_provider_required", { file }));
    if (provider && providers.has(provider)) {
      errors.push(issue("official_manifest_provider_duplicate", {
        provider,
        file,
        conflicting_file: providers.get(provider)
      }));
    } else if (provider) {
      providers.set(provider, file);
    }
    if (!profile) errors.push(issue("official_manifest_provider_profile_missing", { provider, file }));
    if (sources.length === 0) errors.push(issue("official_manifest_sources_required", { provider, file }));

    for (const [sourceIndex, source] of sources.entries()) {
      sourceCount += 1;
      const location = { provider, file, source_index: sourceIndex };
      const sourceName = cleanText(source.source_name);
      const sourceType = cleanText(source.source_type).toUpperCase();
      const sourceUrl = canonicalOfficialSourceUrl(source.source_url);
      const minimumCardCount = positiveInteger(source.minimum_card_count);
      const minimumPromotionCount = positiveInteger(
        source.minimum_promotion_candidate_count ?? source.minimum_card_count
      );
      const maximumReviewCount = nonNegativeInteger(source.maximum_review_required_count ?? 0);
      const requiredRecords = Array.isArray(source.required_records) ? source.required_records : [];

      if (!sourceName) errors.push(issue("official_manifest_source_name_required", location));
      if (!sourceUrl) errors.push(issue("official_manifest_source_url_invalid", { ...location, source_url: source.source_url || null }));
      if (!sourceType || !isOfficialCatalogSourceType(sourceType)) {
        errors.push(issue("official_manifest_source_type_not_official", { ...location, source_type: sourceType || null }));
      }
      const supportedSourceTypes = (profile?.manifest_source_types || [profile?.source_type])
        .filter(Boolean)
        .map((value) => String(value).toUpperCase());
      if (profile && !supportedSourceTypes.includes(sourceType)) {
        errors.push(issue("official_manifest_provider_source_type_mismatch", {
          ...location,
          source_type: sourceType || null,
          expected_source_types: supportedSourceTypes
        }));
      }
      if (!cleanText(source.category)) errors.push(issue("official_manifest_category_required", location));
      if (minimumCardCount === null) errors.push(issue("official_manifest_minimum_card_count_invalid", location));
      if (minimumPromotionCount === null) errors.push(issue("official_manifest_minimum_promotion_count_invalid", location));
      if (minimumCardCount !== null && minimumPromotionCount !== null && minimumPromotionCount > minimumCardCount) {
        errors.push(issue("official_manifest_minimum_promotion_exceeds_card_count", location));
      }
      if (maximumReviewCount === null) errors.push(issue("official_manifest_maximum_review_count_invalid", location));
      if (requiredRecords.length === 0) errors.push(issue("official_manifest_required_records_missing", location));

      if (sourceUrl) {
        const previous = sourceUrls.get(sourceUrl);
        if (previous) {
          errors.push(issue("official_manifest_source_url_duplicate", {
            ...location,
            source_url: sourceUrl,
            conflicting_file: previous.file,
            conflicting_source_index: previous.source_index
          }));
        } else {
          sourceUrls.set(sourceUrl, { file, source_index: sourceIndex });
        }
      }

      const sourceNameKey = `${provider}:${normalizedText(sourceName)}`;
      if (sourceName) {
        const previous = sourceNames.get(sourceNameKey);
        if (previous) {
          errors.push(issue("official_manifest_source_name_duplicate", {
            ...location,
            source_name: sourceName,
            conflicting_file: previous.file,
            conflicting_source_index: previous.source_index
          }));
        } else {
          sourceNames.set(sourceNameKey, { file, source_index: sourceIndex });
        }
      }

      const recordIdentities = new Set();
      for (const [recordIndex, record] of requiredRecords.entries()) {
        const anchor = cleanText(record.card_number || record.checklist_code || record.external_id);
        const identity = normalizedText(requiredRecordIdentity(record));
        if (!anchor) {
          errors.push(issue("official_manifest_required_record_identity_missing", {
            ...location,
            record_index: recordIndex
          }));
        } else if (recordIdentities.has(identity)) {
          errors.push(issue("official_manifest_required_record_identity_duplicate", {
            ...location,
            record_index: recordIndex,
            identity
          }));
        } else {
          recordIdentities.add(identity);
        }
      }
    }
  }

  return {
    schema_version: "official-catalog-manifest-set-contract-v1",
    valid: errors.length === 0,
    error_count: errors.length,
    manifest_count: Array.isArray(entries) ? entries.length : 0,
    provider_count: providers.size,
    source_count: sourceCount,
    errors
  };
}
