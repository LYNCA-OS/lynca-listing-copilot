import {
  defaultVisualEmbeddingDimensions,
  defaultVisualEmbeddingModelId,
  defaultVisualEmbeddingModelRevision,
  defaultVisualEmbeddingPreprocessingVersion
} from "./vector-model-defaults.mjs";

function cleanText(value) {
  return String(value || "").trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function normalizeConfig(env = process.env) {
  return {
    url: cleanText(env.SUPABASE_URL).replace(/\/+$/, ""),
    serviceRoleKey: cleanText(env.SUPABASE_SERVICE_ROLE_KEY),
    modelId: cleanText(env.VISUAL_VECTOR_MODEL_ID || env.VISUAL_EMBEDDING_MODEL_ID) || defaultVisualEmbeddingModelId,
    modelRevision: cleanText(env.VISUAL_VECTOR_MODEL_REVISION || env.VISUAL_EMBEDDING_MODEL_REVISION) || defaultVisualEmbeddingModelRevision,
    preprocessingVersion: cleanText(env.VISUAL_VECTOR_PREPROCESSING_VERSION || env.VISUAL_EMBEDDING_PREPROCESSING_VERSION) || defaultVisualEmbeddingPreprocessingVersion,
    dimensions: positiveInteger(env.VISUAL_VECTOR_DIMENSIONS || env.VISUAL_EMBEDDING_DIMENSIONS, defaultVisualEmbeddingDimensions),
    timeoutMs: positiveInteger(env.STORED_VISUAL_FEATURE_LOOKUP_TIMEOUT_MS || env.VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS, 3000)
  };
}

function storageObjectPath(image = {}) {
  return cleanText(image.object_path || image.objectPath || image.storageObjectPath);
}

function imageRole(image = {}) {
  return cleanText(image.role || image.image_role || image.capture_angle || image.captureAngle);
}

function encodeEq(value = "") {
  return encodeURIComponent(value);
}

function parseEmbedding(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  const text = cleanText(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return text
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter(Number.isFinite);
  }
}

async function fetchJsonWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`supabase_stored_visual_feature_lookup_${response.status}:${text.slice(0, 100)}`);
    }
    return text ? JSON.parse(text) : [];
  } finally {
    clearTimeout(timer);
  }
}

function headers(config) {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`
  };
}

async function findReferenceImages({ image, config, fetchImpl }) {
  const objectPath = storageObjectPath(image);
  if (!objectPath) return [];
  const endpoint = `${config.url}/rest/v1/card_reference_images`
    + `?select=reference_image_id,identity_id,image_role,object_path,metadata`
    + `&object_path=eq.${encodeEq(objectPath)}`
    + `&approved_for_retrieval=eq.true`
    + `&limit=5`;
  const rows = await fetchJsonWithTimeout(fetchImpl, endpoint, {
    headers: headers(config)
  }, config.timeoutMs);
  const preferredRole = imageRole(image);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.reference_image_id)
    .sort((left, right) => {
      if (!preferredRole) return 0;
      const leftMatch = cleanText(left.image_role) === preferredRole ? 0 : 1;
      const rightMatch = cleanText(right.image_role) === preferredRole ? 0 : 1;
      return leftMatch - rightMatch;
    });
}

async function findEmbedding({ reference, config, fetchImpl }) {
  const endpoint = `${config.url}/rest/v1/card_image_embeddings`
    + `?select=embedding_id,reference_image_id,identity_id,embedding_role,model_id,model_revision,preprocessing_version,dimensions,embedding,metadata`
    + `&reference_image_id=eq.${encodeEq(reference.reference_image_id)}`
    + `&model_id=eq.${encodeEq(config.modelId)}`
    + `&model_revision=eq.${encodeEq(config.modelRevision)}`
    + `&preprocessing_version=eq.${encodeEq(config.preprocessingVersion)}`
    + `&limit=5`;
  const rows = await fetchJsonWithTimeout(fetchImpl, endpoint, {
    headers: headers(config)
  }, config.timeoutMs);
  return (Array.isArray(rows) ? rows : []).find((row) => row?.embedding);
}

function featureFromRows({ image, reference, embedding, config }) {
  const vector = parseEmbedding(embedding.embedding);
  if (vector.length !== config.dimensions) return null;
  return {
    status: "OK",
    source: "supabase_stored_visual_embedding",
    image_id: image.image_id || image.id || reference.metadata?.image_id || reference.reference_image_id,
    role: image.role || reference.image_role || "",
    image_role: reference.image_role || "",
    object_path: reference.object_path || storageObjectPath(image),
    reference_image_id: reference.reference_image_id,
    identity_id: reference.identity_id || embedding.identity_id || "",
    embedding_id: embedding.embedding_id || "",
    embedding_role: embedding.embedding_role || "",
    model_id: embedding.model_id || config.modelId,
    model_revision: embedding.model_revision || config.modelRevision,
    preprocessing_version: embedding.preprocessing_version || config.preprocessingVersion,
    dimensions: Number(embedding.dimensions || config.dimensions),
    embedding: vector
  };
}

export function hasUsableVisualFeatures(visualFeatures = {}) {
  const features = Array.isArray(visualFeatures)
    ? visualFeatures
    : Array.isArray(visualFeatures?.features)
      ? visualFeatures.features
      : [];
  return features.some((feature) => Array.isArray(feature?.embedding) && feature.embedding.length > 0);
}

export async function lookupStoredVisualFeaturesForImages({
  images = [],
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = normalizeConfig(env);
  if (!config.url || !config.serviceRoleKey) {
    return {
      status: "UNAVAILABLE",
      reason: "supabase_service_role_not_configured",
      features: []
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      status: "UNAVAILABLE",
      reason: "fetch_unavailable",
      features: []
    };
  }

  const features = [];
  const errors = [];
  for (const image of Array.isArray(images) ? images : []) {
    try {
      const references = await findReferenceImages({ image, config, fetchImpl });
      const reference = references[0];
      if (!reference) continue;
      const embedding = await findEmbedding({ reference, config, fetchImpl });
      if (!embedding) continue;
      const feature = featureFromRows({ image, reference, embedding, config });
      if (feature) features.push(feature);
    } catch (error) {
      errors.push(error.message || "stored_visual_feature_lookup_error");
    }
  }

  return {
    status: features.length ? "OK" : "UNAVAILABLE",
    reason: features.length ? "" : errors[0] || "stored_visual_features_not_found",
    source: "supabase_stored_visual_embedding",
    features
  };
}
