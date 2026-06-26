import assert from "node:assert/strict";
import {
  hasUsableVisualFeatures,
  lookupStoredVisualFeaturesForImages
} from "../lib/listing/retrieval/stored-visual-features.mjs";
import { defaultVisualEmbeddingModelRevision } from "../lib/listing/retrieval/vector-model-defaults.mjs";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

const embedding = Array.from({ length: 768 }, (_, index) => Number((index / 1000).toFixed(6)));
const requests = [];
const fetchImpl = async (url) => {
  requests.push(url);
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/card_reference_images")) {
    assert.equal(parsed.searchParams.get("object_path"), "eq.feedback/front.jpg");
    return jsonResponse(200, [{
      reference_image_id: "ref-1",
      identity_id: "identity-1",
      image_role: "front_original",
      object_path: "feedback/front.jpg",
      metadata: {
        image_id: "front-meta"
      }
    }]);
  }
  if (parsed.pathname.endsWith("/card_image_embeddings")) {
    assert.equal(parsed.searchParams.get("reference_image_id"), "eq.ref-1");
    return jsonResponse(200, [{
      embedding_id: "embedding-1",
      reference_image_id: "ref-1",
      identity_id: "identity-1",
      embedding_role: "front_global",
      model_id: "google/siglip2-base-patch16-384",
      model_revision: defaultVisualEmbeddingModelRevision,
      preprocessing_version: "card-rectification-v1",
      dimensions: 768,
      embedding: JSON.stringify(embedding),
      metadata: {}
    }]);
  }
  throw new Error(`unexpected URL: ${url}`);
};

const features = await lookupStoredVisualFeaturesForImages({
  images: [{
    image_id: "front",
    object_path: "feedback/front.jpg",
    role: "front_original"
  }],
  env: {
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
    VISUAL_VECTOR_MODEL_ID: "google/siglip2-base-patch16-384",
    VISUAL_VECTOR_MODEL_REVISION: defaultVisualEmbeddingModelRevision,
    VISUAL_VECTOR_PREPROCESSING_VERSION: "card-rectification-v1",
    VISUAL_VECTOR_DIMENSIONS: "768"
  },
  fetchImpl
});

assert.equal(features.status, "OK");
assert.equal(features.features.length, 1);
assert.equal(features.features[0].source, "supabase_stored_visual_embedding");
assert.equal(features.features[0].embedding.length, 768);
assert.equal(features.features[0].embedding_role, "front_global");
assert.equal(hasUsableVisualFeatures(features), true);
assert.equal(requests.length, 2);

const unavailable = await lookupStoredVisualFeaturesForImages({
  images: [{ object_path: "feedback/front.jpg" }],
  env: {},
  fetchImpl
});
assert.equal(unavailable.status, "UNAVAILABLE");
assert.equal(unavailable.reason, "supabase_service_role_not_configured");
assert.equal(hasUsableVisualFeatures(unavailable), false);

console.log("stored visual feature tests passed");
