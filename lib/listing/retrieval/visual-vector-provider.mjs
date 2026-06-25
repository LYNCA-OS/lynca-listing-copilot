import { retrievalProviderIds, retrievalSourceTypes, retrievalTrustTiers, retrievalUnavailable } from "./retrieval-contract.mjs";
import { parseReviewedTitleFields } from "../memory/title-field-parser.mjs";
import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";

const defaultModelId = "google/siglip2-base-patch16-384";
const defaultModelRevision = "main";
const defaultPreprocessingVersion = "card-rectification-v1";
const defaultDimensions = 768;

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
  return {
    enabled: truthy(env.ENABLE_VISUAL_VECTOR_RETRIEVAL, true),
    url: cleanText(env.SUPABASE_URL).replace(/\/+$/, ""),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY),
    modelId: cleanText(env.VISUAL_VECTOR_MODEL_ID || env.VISUAL_EMBEDDING_MODEL_ID) || defaultModelId,
    modelRevision: cleanText(env.VISUAL_VECTOR_MODEL_REVISION || env.VISUAL_EMBEDDING_MODEL_REVISION) || defaultModelRevision,
    preprocessingVersion: cleanText(env.VISUAL_VECTOR_PREPROCESSING_VERSION || env.VISUAL_EMBEDDING_PREPROCESSING_VERSION) || defaultPreprocessingVersion,
    dimensions: positiveInteger(env.VISUAL_VECTOR_DIMENSIONS || env.VISUAL_EMBEDDING_DIMENSIONS, defaultDimensions),
    matchCount: positiveInteger(env.VISUAL_VECTOR_MATCH_COUNT, 10),
    matchThreshold: Number.isFinite(Number(env.VISUAL_VECTOR_MATCH_THRESHOLD))
      ? Number(env.VISUAL_VECTOR_MATCH_THRESHOLD)
      : 0,
    includeCandidateIdentities: truthy(env.VISUAL_VECTOR_INCLUDE_CANDIDATES, false),
    timeoutMs: positiveInteger(env.VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS, 3000)
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

function candidatesFromRows(rows = [], query = {}) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const similarities = normalizedRows.map(rowSimilarity);

  return normalizedRows.map((row, index) => {
    const rawFields = safeJson(row.fields) || {};
    const similarity = similarities[index] || 0;
    const nextSimilarity = similarities[index + 1] || 0;
    const title = cleanText(row.canonical_title) || titleFromFields(rawFields);
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
      candidate_identity_id: row.identity_id || null,
      reference_image_id: row.reference_image_id || null,
      embedding_id: row.embedding_id || null,
      image_role: row.image_role || "",
      embedding_role: embeddingRole,
      model_id: modelId,
      model_revision: modelRevision,
      preprocessing_version: preprocessingVersion,
      reference_metadata: safeJson(row.reference_metadata) || {},
      embedding_metadata: safeJson(row.embedding_metadata) || {},
      field_derivation: {
        source: storedFieldNames.length ? "stored_fields_plus_title_parser" : "canonical_title_parser",
        stored_field_names: storedFieldNames,
        title_derived_field_names: parsedFieldNames,
        title_derived_fields_are_ground_truth: false
      }
    };
  });
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
        return {
          provider_id: retrievalProviderIds.VISUAL_VECTOR,
          candidates: candidatesFromRows(rows, {
            ...query,
            model_id: modelId,
            model_revision: modelRevision,
            preprocessing_version: preprocessingVersion
          })
        };
      } catch (error) {
        if (error?.name === "AbortError") return unavailable("visual_vector_retrieval_timeout");
        return unavailable("visual_vector_retrieval_error");
      }
    }
  };
}
