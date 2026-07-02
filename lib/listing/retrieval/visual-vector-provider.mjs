import { retrievalProviderIds, retrievalSourceTypes, retrievalTrustTiers, retrievalUnavailable } from "./retrieval-contract.mjs";
import { parseReviewedTitleFields } from "../memory/title-field-parser.mjs";
import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import {
  defaultVisualEmbeddingDimensions,
  defaultVisualEmbeddingModelId,
  defaultVisualEmbeddingModelRevision,
  defaultVisualEmbeddingPreprocessingVersion
} from "./vector-model-defaults.mjs";

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeSupabaseConfig(env = process.env) {
  const mode = cleanText(env.VECTOR_RETRIEVAL_MODE || "off").toLowerCase();
  const newVectorEnabled = truthy(env.ENABLE_VECTOR_RETRIEVAL, false) && mode !== "off";
  const legacyVectorEnabled = env.ENABLE_VISUAL_VECTOR_RETRIEVAL !== undefined
    ? truthy(env.ENABLE_VISUAL_VECTOR_RETRIEVAL, false)
    : false;
  return {
    enabled: newVectorEnabled || legacyVectorEnabled,
    url: cleanText(env.SUPABASE_URL).replace(/\/+$/, ""),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY),
    modelId: cleanText(env.VECTOR_EMBEDDING_MODEL || env.VISUAL_VECTOR_MODEL_ID || env.VISUAL_EMBEDDING_MODEL_ID) || defaultVisualEmbeddingModelId,
    modelRevision: cleanText(env.VECTOR_EMBEDDING_MODEL_REVISION || env.VISUAL_VECTOR_MODEL_REVISION || env.VISUAL_EMBEDDING_MODEL_REVISION) || defaultVisualEmbeddingModelRevision,
    preprocessingVersion: cleanText(env.VECTOR_PREPROCESSING_VERSION || env.VISUAL_VECTOR_PREPROCESSING_VERSION || env.VISUAL_EMBEDDING_PREPROCESSING_VERSION) || defaultVisualEmbeddingPreprocessingVersion,
    dimensions: positiveInteger(env.VISUAL_VECTOR_DIMENSIONS || env.VISUAL_EMBEDDING_DIMENSIONS, defaultVisualEmbeddingDimensions),
    matchCount: positiveInteger(env.VECTOR_RETRIEVAL_INTERNAL_TOP_N || env.VISUAL_VECTOR_MATCH_COUNT, 30),
    matchThreshold: Number.isFinite(Number(env.VISUAL_VECTOR_MATCH_THRESHOLD))
      ? Number(env.VISUAL_VECTOR_MATCH_THRESHOLD)
      : 0,
    includeCandidateIdentities: truthy(env.VISUAL_VECTOR_INCLUDE_CANDIDATES, false),
    correctedTitleAsTemporaryGt: truthy(env.VECTOR_CORRECTED_TITLE_AS_TEMPORARY_GT || env.VECTOR_EVAL_CORRECTED_TITLE_AS_GT, false),
    timeoutMs: positiveInteger(env.VECTOR_QUERY_TIMEOUT_MS || env.VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS, 30000)
  };
}

function finiteEmbedding(value) {
  if (!Array.isArray(value) || !value.length) return [];
  const vector = value.map(Number);
  return vector.every((number) => Number.isFinite(number)) ? vector : [];
}

function safeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function titleFromFields(fields = {}) {
  const subject = Array.isArray(fields.players)
    ? fields.players.join(" ")
    : fields.player || fields.character || "";
  return [
    fields.year,
    fields.manufacturer || fields.brand,
    fields.product || fields.set,
    subject,
    fields.card_type,
    fields.parallel_exact || fields.parallel_family || fields.parallel || fields.surface_color,
    fields.collector_number ? `#${fields.collector_number}` : "",
    fields.serial_number
  ].filter(Boolean).join(" ");
}

function hasValue(value, fieldName = "") {
  if (fieldName === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function compactFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([fieldName, value]) => hasValue(value, fieldName))
  );
}

function candidateFieldsForRow(row = {}, title = "") {
  const stored = compactFields(normalizeResolvedFields(safeJson(row.fields) || {}));
  const parsed = compactFields(parseReviewedTitleFields(title));
  return {
    ...parsed,
    ...stored
  };
}

function rowSimilarity(row = {}) {
  const similarity = Number(row.similarity);
  return Number.isFinite(similarity) ? Math.max(0, Math.min(1, similarity)) : 0;
}

function rowStatusRejected(row = {}, referenceMetadata = {}) {
  const status = cleanText(row.retrieval_status || row.reference_status || referenceMetadata.retrieval_status || referenceMetadata.reference_status)
    .toLowerCase();
  return ["rejected", "blocked", "disabled", "deprecated"].includes(status);
}

function rowTitle(row = {}, referenceMetadata = {}, rawFields = {}) {
  return cleanText(row.canonical_title)
    || cleanText(row.corrected_title)
    || cleanText(referenceMetadata.canonical_title)
    || cleanText(referenceMetadata.corrected_title)
    || titleFromFields(rawFields);
}

function correctedTitleTemporaryGroundTruth(row = {}, referenceMetadata = {}, title = "", query = {}) {
  if (query.corrected_title_as_temporary_gt !== true) return false;
  if (!cleanText(title)) return false;
  if (rowStatusRejected(row, referenceMetadata)) return false;
  return Boolean(
    cleanText(row.canonical_title)
      || cleanText(row.corrected_title)
      || cleanText(referenceMetadata.canonical_title)
      || cleanText(referenceMetadata.corrected_title)
  );
}

function candidatesFromRows(rows = [], query = {}) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const similarities = normalizedRows.map(rowSimilarity);

  return normalizedRows.map((row, index) => {
    const rawFields = safeJson(row.fields) || {};
    const referenceMetadata = safeJson(row.reference_metadata) || {};
    const embeddingMetadata = safeJson(row.embedding_metadata) || {};
    const similarity = similarities[index] || 0;
    const nextSimilarity = similarities[index + 1] || 0;
    const title = rowTitle(row, referenceMetadata, rawFields);
    const temporaryGt = correctedTitleTemporaryGroundTruth(row, referenceMetadata, title, query);
    const fields = candidateFieldsForRow(row, title);
    const parsedFieldNames = Object.keys(compactFields(parseReviewedTitleFields(title)));
    const storedFieldNames = Object.keys(compactFields(normalizeResolvedFields(rawFields)));
    const embeddingRole = cleanText(row.embedding_role || query.embedding_role);
    const modelId = cleanText(row.model_id || query.model_id);
    const modelRevision = cleanText(row.model_revision || query.model_revision);
    const preprocessingVersion = cleanText(row.preprocessing_version || query.preprocessing_version);

    return {
      candidate_id: row.identity_id ? `visual_vector_${row.identity_id}_${index + 1}` : `visual_vector_candidate_${index + 1}`,
      source_url: row.identity_id ? `supabase://card-identities/${row.identity_id}` : "",
      domain: "supabase-vector",
      source_type: retrievalSourceTypes.VISUAL_VECTOR,
      trust_tier: retrievalTrustTiers.VISUAL_CANDIDATE,
      title,
      evidence_excerpt: [
        "visual candidate recall",
        embeddingRole,
        modelId,
        `similarity=${similarity.toFixed(4)}`
      ].filter(Boolean).join(" | "),
      fields,
      matched_fields: ["visual_vector"],
      match_score: similarity,
      visual_similarity: similarity,
      visual_distance: Number.isFinite(Number(row.distance)) ? Number(row.distance) : null,
      visual_margin_to_next: Number((similarity - nextSimilarity).toFixed(4)),
      source_trust: temporaryGt ? "APPROVED_REFERENCE" : "",
      candidate_identity_id: row.identity_id || null,
      reference_image_id: row.reference_image_id || null,
      embedding_id: row.embedding_id || null,
      image_role: row.image_role || "",
      embedding_role: embeddingRole,
      model_id: modelId,
      model_revision: modelRevision,
      preprocessing_version: preprocessingVersion,
      reference_metadata: {
        ...referenceMetadata,
        retrieval_status: cleanText(row.retrieval_status || referenceMetadata.retrieval_status || ""),
        reference_status: cleanText(row.reference_status || referenceMetadata.reference_status || ""),
        corrected_title_as_temporary_gt: temporaryGt,
        corrected_title_is_reviewed_title_ground_truth: temporaryGt || referenceMetadata.corrected_title_is_reviewed_title_ground_truth === true,
        ebay_answer_key_is_reviewed_ground_truth: false,
        temporary_ground_truth_source: temporaryGt ? "corrected_title" : ""
      },
      embedding_metadata: embeddingMetadata,
      field_derivation: {
        source: storedFieldNames.length ? "stored_fields_plus_title_parser" : "canonical_title_parser",
        stored_field_names: storedFieldNames,
        title_derived_field_names: parsedFieldNames,
        title_derived_fields_are_ground_truth: false,
        corrected_title_used_as_field_ground_truth: false,
        corrected_title_is_reviewed_title_ground_truth: temporaryGt || referenceMetadata.corrected_title_is_reviewed_title_ground_truth === true,
        corrected_title_as_temporary_gt: temporaryGt,
        ebay_answer_key_is_reviewed_ground_truth: false,
        temporary_ground_truth_source: temporaryGt ? "corrected_title" : ""
      }
    };
  });
}

function metadataValue(row = {}, key) {
  const referenceMetadata = safeJson(row.reference_metadata) || {};
  const embeddingMetadata = safeJson(row.embedding_metadata) || {};
  return cleanText(row[key] || referenceMetadata[key] || embeddingMetadata[key]);
}

function hammingDistance(left = "", right = "") {
  const a = cleanText(left).toLowerCase();
  const b = cleanText(right).toLowerCase();
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) distance += 1;
  }
  return distance;
}

function rowMatchesExcludedValue(row = {}, query = {}, metadataKey, queryKeys = []) {
  const value = metadataValue(row, metadataKey);
  if (!value) return false;
  return queryKeys.some((key) => {
    const raw = query[key];
    const values = Array.isArray(raw) ? raw : [raw];
    return values.map(cleanText).filter(Boolean).includes(value);
  });
}

function rowIsSelfExcluded(row = {}, query = {}) {
  if (rowMatchesExcludedValue(row, query, "asset_id", ["asset_id", "exclude_asset_ids"])) return true;
  if (rowMatchesExcludedValue(row, query, "source_feedback_id", ["source_feedback_id", "exclude_source_feedback_ids"])) return true;
  if (rowMatchesExcludedValue(row, query, "physical_card_id", ["physical_card_id", "exclude_physical_card_ids"])) return true;
  if (rowMatchesExcludedValue(row, query, "physical_instance_group_id", ["physical_instance_group_id", "exclude_physical_instance_group_ids"])) return true;
  if (rowMatchesExcludedValue(row, query, "content_sha256", ["content_sha256", "exclude_content_sha256"])) return true;

  const queryPHash = cleanText(query.perceptual_hash || query.phash);
  const rowPHash = metadataValue(row, "perceptual_hash") || metadataValue(row, "phash");
  if (queryPHash && rowPHash && hammingDistance(queryPHash, rowPHash) <= 4) return true;

  const excludedReferenceIds = Array.isArray(query.exclude_reference_image_ids) ? query.exclude_reference_image_ids.map(cleanText) : [];
  if (excludedReferenceIds.includes(cleanText(row.reference_image_id))) return true;

  const excludedIdentityIds = Array.isArray(query.exclude_identity_ids) ? query.exclude_identity_ids.map(cleanText) : [];
  if (excludedIdentityIds.includes(cleanText(row.identity_id))) return true;

  return false;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function readResponseJson(response) {
  const text = await readResponseText(response);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unavailable(reason) {
  return retrievalUnavailable(retrievalProviderIds.VISUAL_VECTOR, reason);
}

export function visualVectorProvider({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = normalizeSupabaseConfig(env);

  return {
    id: retrievalProviderIds.VISUAL_VECTOR,
    async search({ query = {}, resolved = {} } = {}) {
      if (!config.enabled) return unavailable("visual_vector_retrieval_disabled");
      if (!config.url || !config.serviceRoleKey) return unavailable("supabase_service_role_not_configured");
      if (typeof fetchImpl !== "function") return unavailable("fetch_unavailable");

      const embedding = finiteEmbedding(query.embedding);
      if (!embedding.length) return unavailable("visual_embedding_missing");
      if (embedding.length !== config.dimensions) {
        return unavailable(`visual_embedding_dimensions_mismatch:${embedding.length}:expected_${config.dimensions}`);
      }

      const modelId = cleanText(query.model_id) || config.modelId;
      const modelRevision = cleanText(query.model_revision) || config.modelRevision;
      const preprocessingVersion = cleanText(query.preprocessing_version) || config.preprocessingVersion;
      const embeddingRole = cleanText(query.embedding_role);
      const category = cleanText(resolved.category || resolved.sport || resolved.card_category);
      const endpoint = `${config.url}/rest/v1/rpc/match_card_image_embeddings`;

      try {
        const response = await fetchWithTimeout(fetchImpl, endpoint, {
          method: "POST",
          headers: {
            apikey: config.serviceRoleKey,
            authorization: `Bearer ${config.serviceRoleKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            query_embedding: embedding,
            match_model_id: modelId,
            match_model_revision: modelRevision,
            match_embedding_role: embeddingRole || null,
            match_category: category || null,
            match_count: config.matchCount,
            match_threshold: config.matchThreshold,
            include_candidate_identities: config.includeCandidateIdentities
          })
        }, config.timeoutMs);

        if (!response.ok) {
          const message = await readResponseText(response);
          return unavailable(`supabase_visual_vector_rpc_${response.status}:${message.slice(0, 80)}`);
        }

        const rows = await readResponseJson(response);
        const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => !rowIsSelfExcluded(row, query));
        return {
          provider_id: retrievalProviderIds.VISUAL_VECTOR,
          candidates: candidatesFromRows(filteredRows, {
            ...query,
            model_id: modelId,
            model_revision: modelRevision,
            preprocessing_version: preprocessingVersion,
            include_candidate_identities: config.includeCandidateIdentities,
            corrected_title_as_temporary_gt: config.correctedTitleAsTemporaryGt
          })
        };
      } catch (error) {
        if (error?.name === "AbortError") return unavailable("visual_vector_retrieval_timeout");
        return unavailable("visual_vector_retrieval_error");
      }
    }
  };
}
