import { normalizeResolvedFields } from "../listing/evidence/evidence-schema.mjs";
import { clamp01, identityFieldNames, mergeIdentityResolutionOptions, sourceRank } from "./types.mjs";
import {
  canonicalValueKey,
  isMissingValue,
  normalizeEvidenceItem,
  normalizeFieldValue,
  normalizeResolvedHint,
  normalizeSource,
  normalizeText,
  sourceIsMarketplace,
  sourceIsOcr,
  sourceIsRegistry,
  sourceIsRetrieval,
  sourceIsSlab
} from "./normalizer.mjs";

function fieldHasResolvedValue(fields = {}, fieldName) {
  const value = fields[fieldName];
  if (fieldName === "grade_type") return value && value !== "UNKNOWN";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return !isMissingValue(value);
}

function evidenceItemsFromResolvedHint(resolvedHint = {}, options = {}) {
  if (!options.includeResolvedHint) return [];
  const fields = normalizeResolvedHint(resolvedHint);

  return identityFieldNames
    .filter((field) => fieldHasResolvedValue(fields, field))
    .map((field) => normalizeEvidenceItem({
      field,
      value: fields[field],
      source: "AGNES_INFERENCE",
      confidence: options.resolvedHintConfidence,
      metadata: {
        retrieval_source: "resolved_hint"
      }
    }))
    .filter(Boolean);
}

function candidateFields(candidate = {}) {
  const raw = candidate.fields && typeof candidate.fields === "object"
    ? candidate.fields
    : candidate.resolved && typeof candidate.resolved === "object"
      ? candidate.resolved
      : {};
  return normalizeResolvedFields(raw);
}

function evidenceItemsFromRetrievalCandidates(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .flatMap((candidate) => {
      const fields = candidateFields(candidate);
      const confidence = clamp01(candidate.match_score ?? candidate.confidence, 0.65);
      const source = normalizeSource(candidate.source || candidate.source_type || "MARKETPLACE");

      return identityFieldNames
        .filter((field) => fieldHasResolvedValue(fields, field))
        .map((field) => normalizeEvidenceItem({
          field,
          value: fields[field],
          source,
          confidence,
          metadata: {
            retrieval_source: candidate.provider_id || candidate.source_url || candidate.candidate_id || candidate.title || "",
            source_url: candidate.source_url || "",
            title: candidate.title || "",
            trust_tier: candidate.trust_tier ?? null
          }
        }));
    })
    .filter(Boolean);
}

function registryRecordFields(record = {}) {
  if (record.fields && typeof record.fields === "object") return normalizeResolvedFields(record.fields);
  if (record.resolved && typeof record.resolved === "object") return normalizeResolvedFields(record.resolved);
  return normalizeResolvedFields(record);
}

function evidenceItemsFromRegistryRecords(records = []) {
  const list = Array.isArray(records) ? records : records && typeof records === "object" ? [records] : [];

  return list
    .flatMap((record) => {
      const fields = registryRecordFields(record);
      const confidence = clamp01(record.confidence, 0.9);
      const source = normalizeSource(record.source || record.source_type || "STRUCTURED_DATABASE");

      return identityFieldNames
        .filter((field) => fieldHasResolvedValue(fields, field))
        .map((field) => normalizeEvidenceItem({
          field,
          value: fields[field],
          source,
          confidence,
          metadata: {
            retrieval_source: record.registry_id || record.source_url || record.id || "registry_record"
          }
        }));
    })
    .filter(Boolean);
}

export function buildEvidenceItems({
  evidenceItems = [],
  resolvedHint = {},
  retrievalCandidates = [],
  registryRecords = [],
  options = {}
} = {}) {
  const mergedOptions = mergeIdentityResolutionOptions(options);
  const explicitEvidence = (Array.isArray(evidenceItems) ? evidenceItems : [])
    .map(normalizeEvidenceItem)
    .filter(Boolean);

  return [
    ...explicitEvidence,
    ...evidenceItemsFromResolvedHint(resolvedHint, mergedOptions),
    ...evidenceItemsFromRetrievalCandidates(retrievalCandidates),
    ...evidenceItemsFromRegistryRecords(registryRecords)
  ];
}

function sourceSummary(items = []) {
  const counts = {};
  items.forEach((item) => {
    counts[item.source] = (counts[item.source] || 0) + 1;
  });
  return counts;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function canonicalizeIdentityEvidence(input = {}) {
  const evidenceItems = buildEvidenceItems(input);

  return {
    schema_version: "identity_evidence_v1",
    evidence_items: evidenceItems,
    item_count: evidenceItems.length,
    field_names: unique(evidenceItems.map((item) => item.field)),
    source_counts: sourceSummary(evidenceItems)
  };
}

function groupMetrics(items = []) {
  const sources = [...new Set(items.map((item) => item.source))];
  const ocrItems = items.filter((item) => sourceIsOcr(item.source));
  const sourceCounts = sourceSummary(items);
  const glareScores = items
    .map((item) => Number(item.metadata?.glare_score ?? item.metadata?.glare_occlusion ?? 0))
    .filter((value) => Number.isFinite(value));
  const blurScores = items
    .map((item) => Number(item.metadata?.blur_score ?? 0))
    .filter((value) => Number.isFinite(value));

  return {
    sources,
    source_counts: sourceCounts,
    best_source: sources.sort((left, right) => sourceRank(left) - sourceRank(right))[0] || "VISUAL_GUESS",
    best_source_rank: Math.min(...sources.map(sourceRank), 10),
    max_confidence: Math.max(...items.map((item) => item.confidence), 0),
    average_confidence: items.reduce((sum, item) => sum + item.confidence, 0) / Math.max(items.length, 1),
    has_ocr: ocrItems.length > 0,
    has_slab: items.some((item) => sourceIsSlab(item.source)),
    has_registry: items.some((item) => sourceIsRegistry(item.source)),
    has_retrieval: items.some((item) => sourceIsRetrieval(item.source)),
    marketplace_only: items.length > 0 && items.every((item) => sourceIsMarketplace(item.source)),
    ocr_sources: [...new Set(ocrItems.map((item) => item.source))],
    max_glare_score: Math.max(...glareScores, 0),
    max_blur_score: Math.max(...blurScores, 0)
  };
}

export function aggregateEvidence(evidenceItems = []) {
  const normalizedItems = (Array.isArray(evidenceItems) ? evidenceItems : [])
    .map(normalizeEvidenceItem)
    .filter(Boolean);
  const fields = {};

  normalizedItems.forEach((item) => {
    const value = normalizeFieldValue(item.field, item.value);
    if (isMissingValue(value)) return;
    const key = canonicalValueKey(item.field, value);
    if (!key) return;

    fields[item.field] ||= {};
    fields[item.field][key] ||= {
      field: item.field,
      value,
      key,
      evidence_items: []
    };
    fields[item.field][key].evidence_items.push(item);
  });

  Object.values(fields).forEach((groups) => {
    Object.values(groups).forEach((group) => {
      Object.assign(group, groupMetrics(group.evidence_items));
      group.display_value = Array.isArray(group.value) ? group.value.join(" / ") : normalizeText(group.value);
    });
  });

  return {
    evidence_items: normalizedItems,
    fields,
    field_names: Object.keys(fields)
  };
}
