import { vectorRetrievalConfig } from "./vector-feature-flags.mjs";

const embedEndpointPath = "/v1/embed-images";

function cleanText(value) {
  return String(value || "").trim();
}

function imageUrl(image = {}) {
  return cleanText(image.signedUrl || image.signed_url || image.url || image.imageUrl || image.image_url?.url);
}

function imageId(image = {}, index = 0) {
  return cleanText(image.image_id || image.id || image.assetImageId || image.asset_image_id) || `image_${index + 1}`;
}

function normalizedRole(image = {}, index = 0) {
  const text = cleanText(image.role || image.storageRole || image.storage_role || image.captureRole || image.capture_role).toLowerCase();
  if (text.includes("back")) return "back_global";
  if (text.includes("front")) return "front_global";
  return index === 0 ? "front_global" : "back_global";
}

function contentSha256(image = {}) {
  return cleanText(image.contentSha256 || image.content_sha256 || image.sha256 || image.contentHash || image.content_hash).toLowerCase();
}

function primaryFrontBack(images = []) {
  const primary = (Array.isArray(images) ? images : [])
    .filter((image) => !(image.derived === true || image.cropMetadata || image.crop_metadata || image.cropPlan || image.crop_plan))
    .slice(0, 2);
  const source = primary.length ? primary : (Array.isArray(images) ? images.slice(0, 2) : []);
  return source.map((image, index) => ({
    image_id: imageId(image, index),
    role: normalizedRole(image, index),
    signed_url: imageUrl(image),
    ...(contentSha256(image) ? { content_sha256: contentSha256(image) } : {})
  })).filter((image) => image.signed_url);
}

function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unavailable(reason, details = {}) {
  return {
    status: "VECTOR_RETRIEVAL_UNAVAILABLE",
    reason,
    features: [],
    ...details
  };
}

export async function embedImagesWithVectorWorker({
  images = [],
  requestId = "",
  env = process.env,
  options = {},
  fetchImpl = globalThis.fetch
} = {}) {
  const config = vectorRetrievalConfig(env, options);
  if (!config.workerUrl || !config.workerToken) {
    return unavailable("vector_worker_not_configured");
  }
  if (typeof fetchImpl !== "function") {
    return unavailable("fetch_unavailable");
  }

  const requestImages = primaryFrontBack(images);
  if (!requestImages.length) {
    return unavailable("vector_worker_requires_signed_front_back_images");
  }

  const body = {
    request_id: requestId || `vector_query_${Date.now()}`,
    images: requestImages,
    model_id: config.modelId,
    model_revision: config.modelRevision,
    preprocessing_version: config.preprocessingVersion
  };

  try {
    const response = await fetchWithTimeout(fetchImpl, `${config.workerUrl}${embedEndpointPath}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.workerToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }, config.queryTimeoutMs);

    const payload = await readJson(response);
    if (!response.ok) {
      return {
        status: "VECTOR_RETRIEVAL_ERROR",
        reason: `vector_worker_http_${response.status}`,
        features: [],
        error_detail: payload?.detail?.errors ? "contract_errors" : payload?.detail || null
      };
    }

    if (!payload || payload.status !== "completed") {
      return unavailable(payload?.reason || "vector_worker_unavailable", {
        worker_status: payload?.status || null
      });
    }

    const features = (Array.isArray(payload.embeddings) ? payload.embeddings : [])
      .filter((item) => Array.isArray(item.embedding) && item.embedding.length > 0)
      .map((item) => ({
        status: "OK",
        source: "vector_worker",
        image_id: item.image_id || "",
        role: item.role || "",
        image_role: item.role || "",
        embedding_role: item.role || "",
        model_id: payload.model_id || config.modelId,
        model_revision: payload.model_revision || config.modelRevision,
        preprocessing_version: payload.preprocessing_version || config.preprocessingVersion,
        dimensions: Number(item.dimensions || item.embedding.length),
        embedding: item.embedding.map(Number),
        content_sha256: item.content_sha256 || null,
        cache_hit: item.cache_hit === true
      }));

    return {
      status: features.length ? "OK" : "VECTOR_RETRIEVAL_UNAVAILABLE",
      reason: features.length ? "" : "vector_worker_empty_embeddings",
      source: "vector_worker",
      latency_ms: Number(payload.latency_ms || 0),
      model_id: payload.model_id || config.modelId,
      model_revision: payload.model_revision || config.modelRevision,
      preprocessing_version: payload.preprocessing_version || config.preprocessingVersion,
      features
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        status: "VECTOR_RETRIEVAL_TIMEOUT",
        reason: "vector_worker_timeout",
        features: []
      };
    }
    return {
      status: "VECTOR_RETRIEVAL_ERROR",
      reason: "vector_worker_error",
      features: []
    };
  }
}
