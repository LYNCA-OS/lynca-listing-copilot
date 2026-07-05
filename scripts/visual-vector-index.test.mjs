import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertVisualVectorSchema,
  indexVisualVectorDataset
} from "./index-visual-vector-embeddings.mjs";
import { defaultVisualEmbeddingModelRevision } from "../lib/listing/retrieval/vector-model-defaults.mjs";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  RECOGNITION_WORKER_URL: "https://recognition.test",
  RECOGNITION_WORKER_TOKEN: "recognition-token",
  ENABLE_RECOGNITION_WORKER: "true",
  RECOGNITION_WORKER_RUN_VISUAL_EMBEDDINGS: "true",
  VISUAL_VECTOR_DIMENSIONS: "768"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const schemaCalls = [];
await assertVisualVectorSchema({
  env,
  fetchImpl: async (url, options = {}) => {
    schemaCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    return jsonResponse([]);
  }
});
assert.ok(schemaCalls.some((call) => call.url.includes("/rest/v1/card_identities")));
assert.ok(schemaCalls.some((call) => call.url.includes("/rest/v1/card_reference_images")));
assert.ok(schemaCalls.some((call) => call.url.includes("/rest/v1/card_image_embeddings")));
const schemaRpcCall = schemaCalls.find((call) => call.url.includes("/rest/v1/rpc/match_card_image_embeddings"));
assert.equal(schemaRpcCall.body.include_candidate_identities, false);
assert.equal(schemaRpcCall.body.query_embedding.length, 768);

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "visual-vector-index-"));
try {
  const datasetPath = path.join(tmpDir, "dataset.json");
  await writeFile(datasetPath, JSON.stringify({
    items: [
      {
        asset_id: "asset-1",
        source_feedback_id: "feedback-1",
        category: "sports_card",
        images: [
          {
            image_id: "front",
            bucket: "listing-feedback-images",
            object_path: "feedback/front.jpg",
            role: "front_original"
          }
        ],
        source_titles: {
          corrected_title: "2025 Topps Chrome Test Player #1"
        },
        ground_truth: {
          year: null,
          players: []
        }
      }
    ]
  }), "utf8");

  const restCalls = [];
  const fetchImpl = async (url, options = {}) => {
    const request = { url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null };
    restCalls.push(request);
    if (request.method === "POST" && request.url.includes("/rest/v1/card_identities?on_conflict=")) {
      assert.equal(request.body[0].identity_key, "supabase_feedback:feedback-1");
      assert.equal(request.body[0].retrieval_status, "candidate");
      assert.equal(request.body[0].retrieval_enabled, true);
      assert.equal(request.body[0].source_record.corrected_title_is_ground_truth, true);
      assert.equal(request.body[0].source_record.corrected_title_is_reviewed_title_ground_truth, true);
      assert.equal(request.body[0].fields.product, "Topps Chrome");
      assert.equal(request.body[0].fields.collector_number, "1");
      assert.equal(request.body[0].fields.annotation_hint.corrected_title_is_ground_truth, true);
      assert.equal(request.body[0].fields.annotation_hint.corrected_title_is_reviewed_title_ground_truth, true);
      assert.equal(request.body[0].fields.annotation_hint.title_derived_fields_are_ground_truth, false);
      assert.ok(request.body[0].fields.annotation_hint.title_derived_field_names.includes("collector_number"));
      return jsonResponse([{ identity_id: "identity-1" }], 201);
    }
    if (request.method === "POST" && request.url.includes("/rest/v1/card_reference_images?on_conflict=")) {
      assert.equal(request.body[0].identity_id, "identity-1");
      assert.equal(request.body[0].approved_for_retrieval, true);
      assert.equal(request.body[0].metadata.signed_url_persisted, false);
      assert.doesNotMatch(JSON.stringify(request.body[0]), /read-token/);
      return jsonResponse([{ reference_image_id: "reference-1" }], 201);
    }
    if (request.method === "POST" && request.url.includes("/rest/v1/card_image_embeddings?on_conflict=")) {
      assert.equal(request.body[0].reference_image_id, "reference-1");
      assert.equal(request.body[0].embedding_role, "front_global");
      assert.equal(request.body[0].embedding.length, 768);
      return jsonResponse([{ embedding_id: "embedding-1" }], 201);
    }
    return jsonResponse([]);
  };

  const report = await indexVisualVectorDataset({
    datasetPath,
    outPath: "",
    limit: 1,
    concurrency: 1,
    env,
    retrievalStatus: "candidate",
    retrievalEnabled: true,
    createSignedReadUrlImpl: async ({ objectPath, bucket }) => {
      assert.equal(bucket, "listing-feedback-images");
      assert.equal(objectPath, "feedback/front.jpg");
      return "https://supabase.test/storage/v1/object/sign/listing-feedback-images/feedback/front.jpg?token=read-token";
    },
    analyzeImpl: async ({ images, options }) => {
      assert.equal(options.run_visual_embeddings, true);
      assert.equal(options.run_ocr, false);
      assert.equal(images[0].signed_url.includes("read-token"), true);
      return {
        asset_id: "asset-1",
        visual_features: {
          status: "OK",
          features: [{
            image_id: "front",
            role: "front_original",
            embedding_role: "front_global",
            model_id: "google/siglip2-base-patch16-384",
            model_revision: defaultVisualEmbeddingModelRevision,
            preprocessing_version: "card-rectification-v1",
            dimensions: 768,
            status: "OK",
            embedding: [1, ...Array.from({ length: 767 }, () => 0)]
          }]
        }
      };
    },
    fetchImpl,
    now: new Date("2026-06-25T00:00:00.000Z")
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.indexed_items, 1);
  assert.equal(report.summary.embeddings_written, 1);
  assert.ok(restCalls.some((call) => call.url.includes("on_conflict=identity_id%2Cimage_role%2Creference_key")));

  const marketplaceDatasetPath = path.join(tmpDir, "marketplace-title-ignored.json");
  await writeFile(marketplaceDatasetPath, JSON.stringify({
    items: [
      {
        asset_id: "asset-marketplace",
        source_feedback_id: "feedback-marketplace",
        category: "collectible_card",
        canonical_title: "2023 Panini Prizm Tiger Stripe Secret Player PSA 10",
        source_titles: {
          marketplace_title: "2023 Panini Prizm Tiger Stripe Secret Player PSA 10"
        },
        sealed_eval_label_ref: {
          path: "sealed-labels.jsonl",
          key: "sealed-1"
        },
        source_record: {
          source_type: "IMAGE_ONLY_MARKETPLACE_CAPTURE",
          source_provider: "ebay_browse",
          marketplace_title_is_sealed_answer_key: true,
          ebay_answer_key_is_reviewed_ground_truth: false
        },
        images: [
          {
            image_id: "front-marketplace",
            bucket: "listing-feedback-images",
            object_path: "feedback/marketplace-front.jpg",
            role: "front_original"
          }
        ]
      }
    ]
  }), "utf8");
  const marketplaceFetchCalls = [];
  const marketplaceReport = await indexVisualVectorDataset({
    datasetPath: marketplaceDatasetPath,
    outPath: "",
    limit: 1,
    concurrency: 1,
    env,
    retrievalStatus: "candidate",
    retrievalEnabled: false,
    createSignedReadUrlImpl: async () => "https://supabase.test/storage/v1/object/sign/listing-feedback-images/feedback/marketplace-front.jpg?token=read-token",
    analyzeImpl: async () => ({
      asset_id: "asset-marketplace",
      visual_features: {
        status: "OK",
        features: [{
          image_id: "front-marketplace",
          role: "front_original",
          embedding_role: "front_global",
          model_id: "google/siglip2-base-patch16-384",
          model_revision: defaultVisualEmbeddingModelRevision,
          preprocessing_version: "card-rectification-v1",
          dimensions: 768,
          status: "OK",
          embedding: [1, ...Array.from({ length: 767 }, () => 0)]
        }]
      }
    }),
    fetchImpl: async (url, options = {}) => {
      const request = { url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null };
      marketplaceFetchCalls.push(request);
      if (request.method === "POST" && request.url.includes("/rest/v1/card_identities?on_conflict=")) {
        assert.equal(request.body[0].canonical_title, "");
        assert.ok(!request.body[0].fields.product);
        assert.ok(!request.body[0].fields.players?.length);
        assert.equal(request.body[0].fields.annotation_hint.corrected_title_is_ground_truth, false);
        assert.equal(request.body[0].fields.annotation_hint.sealed_marketplace_title_present, true);
        assert.equal(request.body[0].fields.annotation_hint.sealed_eval_label_ref, "sealed-1");
        assert.equal(request.body[0].source_record.sealed_marketplace_title_present, true);
        assert.equal(request.body[0].source_record.ebay_answer_key_is_reviewed_ground_truth, false);
        return jsonResponse([{ identity_id: "identity-marketplace" }], 201);
      }
      if (request.method === "POST" && request.url.includes("/rest/v1/card_reference_images?on_conflict=")) {
        assert.equal(request.body[0].approved_for_retrieval, false);
        assert.equal(request.body[0].reference_status, "candidate");
        assert.equal(request.body[0].metadata.sealed_eval_label_ref, "sealed-1");
        assert.equal(request.body[0].metadata.canonical_title, "");
        return jsonResponse([{ reference_image_id: "reference-marketplace" }], 201);
      }
      if (request.method === "POST" && request.url.includes("/rest/v1/card_image_embeddings?on_conflict=")) {
        return jsonResponse([{ embedding_id: "embedding-marketplace" }], 201);
      }
      return jsonResponse([]);
    },
    now: new Date("2026-06-25T01:00:00.000Z")
  });
  assert.equal(marketplaceReport.ok, true);
  assert.ok(marketplaceFetchCalls.some((call) => call.url.includes("/rest/v1/card_identities")));

  await assert.rejects(
    indexVisualVectorDataset({
      datasetPath,
      outPath: "",
      limit: 1,
      concurrency: 1,
      env,
      createSignedReadUrlImpl: async () => "https://supabase.test/signed?token=read-token",
      analyzeImpl: async () => ({
        asset_id: "asset-1",
        visual_features: {
          status: "UNAVAILABLE",
          reason: "embedding_backend_not_installed",
          features: []
        }
      }),
      fetchImpl: async () => jsonResponse([])
    }),
    /Visual vector indexing completed with 1 failed item/
  );
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("visual vector index tests passed");
