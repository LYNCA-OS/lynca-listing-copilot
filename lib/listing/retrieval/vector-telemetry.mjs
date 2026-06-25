const queryLogsTable = "vector_query_logs";
const retrievalRunsTable = "vector_retrieval_runs";
const retrievalCandidatesTable = "vector_retrieval_candidates";
const defaultEmbeddingDimensions = 768;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeBaseUrl(value) {
  return cleanText(value).replace(/\/+$/, "");
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function configured(env = process.env) {
  return Boolean(normalizeBaseUrl(env.SUPABASE_URL) && cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY));
}

function configFromEnv(env = process.env) {
  return {
    url: normalizeBaseUrl(env.SUPABASE_URL),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY),
    enabled: boolValue(env.VECTOR_QUERY_LOG_ENABLED, true)
  };
}

function supabaseHeaders(config = {}, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function supabaseInsertRows({
  config,
  table,
  rows,
  fetchImpl = globalThis.fetch
}) {
  if (!rows.length) return [];
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const response = await fetchImpl(`${config.url}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseHeaders(config, { prefer: "return=representation" }),
    body: JSON.stringify(rows)
  });
  const payload = await readResponseJson(response);
  if (!response.ok) {
    const message = payload?.message || payload?.error || JSON.stringify(payload || {}).slice(0, 180);
    throw new Error(`Supabase ${table} insert failed: HTTP ${response.status} ${message}`);
  }
  return Array.isArray(payload) ? payload : [];
}

function safeUuid(value) {
  const text = cleanText(value);
  return uuidPattern.test(text) ? text : null;
}

function normalizeImageRole(role = "") {
  const text = cleanText(role).toLowerCase();
  if (text.includes("back")) return "back_global";
  if (text.includes("front")) return "front_global";
  if (text.includes("subject")) return "subject_layout";
  if (text.includes("parallel") || text.includes("surface")) return "parallel_surface";
  return "full_card_global";
}

function embeddingDimensions(feature = {}) {
  return finiteNumber(feature.dimensions || feature.embedding_dimensions || feature.embedding?.length, defaultEmbeddingDimensions) || defaultEmbeddingDimensions;
}

function normalizedEmbedding(feature = {}) {
  return Array.isArray(feature.embedding)
    ? feature.embedding.map(Number).filter((value) => Number.isFinite(value))
    : [];
}

function featureRows({
  visualFeatures = {},
  context = {},
  retrievalConfig = {}
} = {}) {
  const features = Array.isArray(visualFeatures.features) ? visualFeatures.features : [];
  return features
    .map((feature) => {
      const embedding = normalizedEmbedding(feature);
      if (!embedding.length) return null;
      return {
        analysis_run_id: context.analysisRunId || context.analysis_run_id || null,
        asset_id: context.assetId || context.asset_id || null,
        source_feedback_id: context.sourceFeedbackId || context.source_feedback_id || null,
        physical_card_id: context.physicalCardId || context.physical_card_id || null,
        physical_instance_group_id: context.physicalInstanceGroupId || context.physical_instance_group_id || null,
        image_id: cleanText(feature.image_id || feature.imageId) || null,
        image_role: normalizeImageRole(feature.embedding_role || feature.image_role || feature.role),
        content_sha256: cleanText(feature.content_sha256 || feature.contentSha256).toLowerCase() || null,
        perceptual_hash: cleanText(feature.perceptual_hash || feature.phash || feature.p_hash) || null,
        model_id: cleanText(feature.model_id || retrievalConfig.modelId) || "unknown",
        model_revision: cleanText(feature.model_revision || retrievalConfig.modelRevision) || "unknown",
        preprocessing_version: cleanText(feature.preprocessing_version || retrievalConfig.preprocessingVersion) || "unknown",
        embedding_dimensions: embeddingDimensions(feature),
        normalization_method: "l2",
        embedding,
        searchable: false,
        status: "QUERY_ONLY",
        quality_score: finiteNumber(feature.quality_score, null),
        latency_ms: Math.max(0, Math.trunc(finiteNumber(feature.latency_ms || visualFeatures.latency_ms, 0) || 0)),
        metadata: {
          source: cleanText(feature.source || visualFeatures.source) || "query_embedding",
          cache_hit: feature.cache_hit === true,
          signed_url_persisted: false,
          worker_status: visualFeatures.status || null
        }
      };
    })
    .filter(Boolean);
}

function retrievalStatus(packet = {}) {
  const statusCode = cleanText(packet.vector_retrieval?.status_code);
  if (statusCode) return statusCode;
  const status = cleanText(packet.vector_retrieval?.status).toUpperCase();
  if (status === "COMPLETED") return "VECTOR_RETRIEVAL_COMPLETED";
  if (status === "NO_CONFIDENT_MATCH") return "VECTOR_NO_CONFIDENT_MATCH";
  if (status === "TIMEOUT") return "VECTOR_RETRIEVAL_TIMEOUT";
  if (status === "ERROR") return "VECTOR_RETRIEVAL_ERROR";
  return "VECTOR_RETRIEVAL_UNAVAILABLE";
}

function unavailableReason(packet = {}) {
  const unavailable = Array.isArray(packet.vector_retrieval?.unavailable) ? packet.vector_retrieval.unavailable : [];
  return unavailable.map((item) => cleanText(item.reason)).filter(Boolean).join("; ") || null;
}

function sanitizeCandidateFields(fields = {}) {
  const blocked = new Set([
    "serial_number",
    "grade",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type",
    "cert_number",
    "cert",
    "certificate_number",
    "title",
    "seller_title",
    "corrected_title",
    "model_title_suggestion"
  ]);
  return Object.fromEntries(
    Object.entries(fields || {})
      .filter(([key, value]) => !blocked.has(key) && value !== undefined)
  );
}

function candidateRows({
  retrievalRunId,
  packet = {}
} = {}) {
  const candidates = Array.isArray(packet.vector_retrieval?.candidates) ? packet.vector_retrieval.candidates : [];
  return candidates.map((candidate, index) => ({
    retrieval_run_id: retrievalRunId,
    rank: Math.max(1, Math.trunc(finiteNumber(candidate.rank, index + 1) || index + 1)),
    ...(safeUuid(candidate.candidate_identity_id) ? { candidate_identity_id: safeUuid(candidate.candidate_identity_id) } : {}),
    ...(safeUuid(candidate.reference_image_id) ? { reference_image_id: safeUuid(candidate.reference_image_id) } : {}),
    ...(safeUuid(candidate.embedding_id) ? { embedding_id: safeUuid(candidate.embedding_id) } : {}),
    similarity: finiteNumber(candidate.similarity, null),
    combined_score: finiteNumber(candidate.combined_score, null),
    top1_top2_margin: finiteNumber(candidate.top1_top2_margin, null),
    reference_count: Math.max(1, Math.trunc(finiteNumber(candidate.reference_count, 1) || 1)),
    candidate_fields: sanitizeCandidateFields(candidate.fields || {})
  }));
}

export async function recordVectorRetrievalTelemetry({
  visualFeatures = {},
  packet = {},
  mode = "shadow",
  retrievalConfig = {},
  context = {},
  retrievalLatencyMs = 0,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = configFromEnv(env);
  if (!config.enabled) return { saved: false, reason: "vector_query_log_disabled" };
  if (!configured(env)) return { saved: false, reason: "supabase_not_configured" };

  try {
    const queryRows = featureRows({ visualFeatures, context, retrievalConfig });
    const queryLogRows = await supabaseInsertRows({
      config,
      table: queryLogsTable,
      rows: queryRows,
      fetchImpl
    });
    const queryLogId = queryLogRows[0]?.query_log_id || null;
    const [run] = await supabaseInsertRows({
      config,
      table: retrievalRunsTable,
      rows: [{
        analysis_run_id: context.analysisRunId || context.analysis_run_id || null,
        query_log_id: queryLogId,
        index_snapshot_id: safeUuid(retrievalConfig.indexSnapshotId || retrievalConfig.index_snapshot_id),
        mode: ["shadow", "assist", "eval"].includes(mode) ? mode : "shadow",
        status: retrievalStatus(packet),
        top_k: Math.max(1, Math.trunc(finiteNumber(retrievalConfig.topK, 10) || 10)),
        internal_top_n: Math.max(1, Math.trunc(finiteNumber(retrievalConfig.internalTopN, 30) || 30)),
        latency_ms: Math.max(0, Math.trunc(finiteNumber(retrievalLatencyMs, 0) || 0)),
        unavailable_reason: unavailableReason(packet),
        metadata: {
          query_log_count: queryLogRows.length,
          candidate_count: Array.isArray(packet.vector_retrieval?.candidates) ? packet.vector_retrieval.candidates.length : 0,
          prompt_assist_possible: Array.isArray(packet.vector_retrieval?.candidates) && packet.vector_retrieval.candidates.length > 0
        }
      }],
      fetchImpl
    });
    const retrievalRunId = run?.retrieval_run_id || null;
    const candidates = retrievalRunId ? candidateRows({ retrievalRunId, packet }) : [];
    const candidateRowsSaved = await supabaseInsertRows({
      config,
      table: retrievalCandidatesTable,
      rows: candidates,
      fetchImpl
    });
    return {
      saved: true,
      query_log_count: queryLogRows.length,
      retrieval_run_id: retrievalRunId,
      candidate_count: candidateRowsSaved.length
    };
  } catch (error) {
    return {
      saved: false,
      reason: "vector_telemetry_write_failed",
      error: cleanText(error?.message).slice(0, 240)
    };
  }
}
