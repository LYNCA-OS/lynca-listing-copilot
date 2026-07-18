import assert from "node:assert/strict";
import { runListingRecognitionCore } from "../api/listing-copilot-title.js";
import {
  recognitionResponseToEvidenceDocument
} from "../lib/listing/recognition/recognition-evidence-normalizer.mjs";
import { withRecognitionEvidence } from "../lib/listing/pipeline/result-decoration.mjs";
import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_APPROVED_MEMORY_ENABLED = "false";
process.env.LISTING_IDENTITY_INFLIGHT_DEDUP_ENABLED = "false";
process.env.ENABLE_RECOGNITION_WORKER = "true";
process.env.RECOGNITION_WORKER_URL = "https://recognition.internal";
process.env.RECOGNITION_WORKER_TOKEN = "worker-token";
process.env.DEFAULT_VISION_PROVIDER = "openai_legacy";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_LISTING_MODEL = "gpt-4.1-mini-2025-04-14";

const tenantId = "tenant-recognition";
const userId = "user-recognition";
const assetId = "asset_44444444-4444-4444-8444-444444444444";

function makeImage({
  id,
  role,
  objectPath,
  contentSha256
}) {
  return {
    id,
    assetId,
    storageRole: role,
    objectPath,
    bucket: "listing-card-images",
    originalType: "image/jpeg",
    originalSize: 12345,
    originalWidth: 900,
    originalHeight: 1260,
    contentSha256,
    storageVerified: true
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload
  };
}

async function callTitleApi(payload) {
  return runListingRecognitionCore({
    payload: { ...payload, tenant_id: tenantId }
  });
}

const frontSha = "c".repeat(64);
const backSha = "d".repeat(64);
const images = [
  makeImage({
    id: "front",
    role: "front_original",
    objectPath: `tenants/${tenantId}/listing-assets/2026-06-23/${assetId}/front.jpg`,
    contentSha256: frontSha
  }),
  makeImage({
    id: "back",
    role: "back_original",
    objectPath: `tenants/${tenantId}/listing-assets/2026-06-23/${assetId}/back.jpg`,
    contentSha256: backSha
  })
];

const recognitionPayload = {
  asset_id: assetId,
  rectification: {},
  image_quality: {},
  regions: [],
  ocr_evidence: {
    status: "OK",
    items: [
      { text: "2024 Topps Chrome Shohei Ohtani Gold Refractor 31 / 50", confidence: 0.97, image_id: "front", role: "front_original", observed_text: "2024 Topps Chrome Shohei Ohtani Gold Refractor 31 / 50" },
      { text: "31/50", confidence: 0.94, image_id: "back", role: "back_original", observed_text: "31/50" },
      {
        text: "PSA 10",
        confidence: 0.93,
        image_id: "front",
        role: "grade_label_crop",
        observed_text: "PSA 10"
      }
    ]
  },
  evidence_fusion: {
    status: "OK",
    items: [
      { field: "year", value: "2024", confidence: 0.8148, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "2024 Topps Chrome Shohei Ohtani Gold Refractor 31 / 50" },
      { field: "year", value: "2024", confidence: 0.91, image_id: "back", role: "back_original", source_type: "CARD_BACK", observed_text: "2024 Topps Chrome" },
      { field: "product", value: "Topps Chrome", confidence: 0.96, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Topps Chrome" },
      { field: "subject", value: "Shohei Ohtani", confidence: 0.96, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Shohei Ohtani" },
      { field: "parallel", value: "Gold Refractor", confidence: 0.92, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Gold Refractor" },
      { field: "serial_number", value: "31/50", confidence: 0.95, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "31 / 50" },
      { field: "serial_number", value: "31/50", confidence: 0.94, image_id: "back", role: "back_original", source_type: "CARD_BACK", observed_text: "31/50" },
      {
        field: "grade_label",
        value: "PSA 10",
        confidence: 0.93,
        image_id: "front",
        role: "grade_label_crop",
        source_type: "SLAB_LABEL",
        observed_text: "PSA 10",
        parsed_fields: {
          grade_company: "PSA",
          card_grade: "10",
          grade_type: "CARD_ONLY"
        }
      }
    ],
    resolved_fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Shohei Ohtani"],
      parallel: "Gold Refractor",
      serial_number: "31/50",
      grade_company: "PSA",
      card_grade: "10",
      grade_type: "CARD_ONLY"
    },
    field_candidates: {},
    conflicts: []
  },
  visual_features: {},
  processing: {
    pipeline_version: "recognition-worker-contract-v1",
    model_versions: { ocr: "mock" },
    latency_ms: 19
  }
};

const evidenceDocument = recognitionResponseToEvidenceDocument(recognitionPayload, { images });
assert.equal(evidenceDocument.evidence.serial_number.candidates[0].sources[0].source_type, "CARD_FRONT");
assert.equal(evidenceDocument.evidence.grade_company.candidates[0].sources[0].source_type, "SLAB_LABEL");

const multiCardRecognitionPayload = {
  ...recognitionPayload,
  multi_card_detection: {
    status: "OK",
    multi_card: true,
    card_count_estimate: 2,
    card_count_confirmed: true,
    confidence: 0.88,
    image_id: "front",
    role: "front_original",
    images: [
      {
        image_id: "front",
        role: "front_original",
        candidates: [
          { bbox: [20, 20, 300, 410], confidence: 0.89 },
          { bbox: [360, 24, 640, 414], confidence: 0.87 }
        ]
      }
    ]
  }
};
const multiCardEvidenceDocument = recognitionResponseToEvidenceDocument(multiCardRecognitionPayload, { images });
assert.equal(multiCardEvidenceDocument.resolved.multi_card, true);
assert.equal(multiCardEvidenceDocument.resolved.card_count, 2);
assert.equal(multiCardEvidenceDocument.evidence.multi_card.candidates[0].sources[0].source_type, "MULTI_CARD_DETECTOR");
const multiCardGated = applyIdentityResolutionGate({
  title: "",
  final_title: "",
  fields: {},
  resolved: multiCardEvidenceDocument.resolved,
  evidence: multiCardEvidenceDocument.evidence,
  unresolved: multiCardEvidenceDocument.unresolved,
  provider: "recognition_worker",
  source: "recognition_worker",
  reason: "Recognition worker detected multiple cards in the same image.",
  route: "RECOGNITION_WORKER_PREFLIGHT"
}, { providerId: "recognition_worker" });
assert.equal(multiCardGated.identity_resolution_status, "RESOLVED");
assert.match(multiCardGated.final_title, /^Lot x2\b/);
assert.equal(multiCardGated.publication_gate?.writer_review_ready, true);
assert.equal(multiCardGated.publication_gate?.workflow_route, "DEEP_REVIEW");
assert.ok(multiCardGated.unresolved.includes("multi-card lot requires writer review"));

const unconfirmedLotCountDocument = recognitionResponseToEvidenceDocument({
  ...recognitionPayload,
  multi_card_detection: {
    status: "OK",
    multi_card: true,
    card_count_estimate: 3,
    card_count_confirmed: false,
    confidence: 0.94,
    image_id: "front",
    role: "front_original"
  }
}, { images });
assert.equal(unconfirmedLotCountDocument.resolved.multi_card, false, "unconfirmed rectangle detections must not become identity evidence");
assert.equal(unconfirmedLotCountDocument.resolved.card_count, null, "detector lower bounds must not become exact lot quantities");
assert.equal(unconfirmedLotCountDocument.resolved.lot_type, null);
assert.equal(unconfirmedLotCountDocument.evidence.multi_card, undefined);
assert.equal(unconfirmedLotCountDocument.recognition.multi_card_detection.detected, true);
assert.equal(unconfirmedLotCountDocument.recognition.multi_card_detection.card_count_confirmed, false);
assert.equal(unconfirmedLotCountDocument.recognition.multi_card_detection.admitted_as_identity_evidence, false);
assert.equal(
  unconfirmedLotCountDocument.resolution_trace[0].output.multi_card_evidence_admitted,
  false
);

const independentlyCorroboratedLot = withRecognitionEvidence({
  title: "",
  fields: {
    players: ["Kendry Chourio", "Marek Houston", "Aiva Arquette"],
    multi_card: false,
    card_count: null,
    lot_type: null
  },
  resolved: {
    players: ["Kendry Chourio", "Marek Houston", "Aiva Arquette"],
    multi_card: false,
    card_count: null,
    lot_type: null
  },
  evidence: {},
  unresolved: ["multi_card"],
  provider_field_rejections: [{
    field: "multi_card",
    reason: "separate_physical_cards_not_directly_observed",
    value: { multi_card: true, card_count: 10, lot_type: "multi_card_lot" },
    rejected_evidence: {
      card_count: {
        value: 10,
        source_type: "VISION_ONLY",
        source_image_id: "front",
        source_region: "multi_card_layout",
        evidence_kind: "PHYSICAL_CARD_COUNT",
        visible_text: "10 separate cards",
        directly_observed: true,
        direct_observation: true,
        review_required: true
      }
    }
  }]
}, unconfirmedLotCountDocument, { maxTitleLength: 80 });
assert.notEqual(independentlyCorroboratedLot.resolved.multi_card, true);
assert.equal(independentlyCorroboratedLot.resolved.card_count ?? null, null);
assert.equal(independentlyCorroboratedLot.evidence.card_count, undefined);
assert.doesNotMatch(independentlyCorroboratedLot.rendered_title, /^Lot\b/);
assert.ok(independentlyCorroboratedLot.unresolved.includes("multi_card"));

const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = new URL(String(url));
  fetchCalls.push({
    host: requestUrl.host,
    pathname: requestUrl.pathname,
    method: options.method || "GET"
  });

  if (requestUrl.host === "supabase.test" && requestUrl.pathname.endsWith("/listing_image_verifications")) {
    const objectPath = requestUrl.searchParams.get("object_path")?.replace(/^eq\./, "");
    const image = images.find((item) => item.objectPath === objectPath);
    assert.ok(image, `unexpected verification object path ${objectPath}`);
    return jsonResponse([
      {
        tenant_id: tenantId,
        object_path: image.objectPath,
        bucket: image.bucket,
        asset_id: assetId,
        content_type: image.originalType,
        size: image.originalSize,
        width: image.originalWidth,
        height: image.originalHeight,
        content_sha256: image.contentSha256,
        object_verified: true,
        content_hash_verified: true,
        dimension_source: "upload",
        verified_at: "2026-06-23T00:00:00.000Z",
        updated_at: "2026-06-23T00:00:00.000Z"
      }
    ]);
  }

  if (requestUrl.host === "supabase.test" && requestUrl.pathname.includes("/storage/v1/object/sign/")) {
    const objectPath = decodeURIComponent(requestUrl.pathname.split("/listing-card-images/")[1] || "");
    assert.ok(images.some((image) => image.objectPath === objectPath), `unexpected signed URL path ${objectPath}`);
    return jsonResponse({
      signedURL: `/object/sign/listing-card-images/${objectPath}?token=read`
    });
  }

  if (requestUrl.host === "recognition.internal" && requestUrl.pathname === "/v1/analyze-card-images") {
    const body = JSON.parse(options.body);
    assert.equal(body.asset_id, assetId);
    assert.equal(body.images.length, 2);
    assert.ok(body.images.every((image) => image.signed_url.includes("token=read")));
    assert.equal(body.options.run_ocr, true);
    assert.equal(body.options.run_visual_embeddings, true);
    return jsonResponse(recognitionPayload);
  }

  throw new Error(`Unexpected remote call: ${requestUrl.href}`);
};

const response = await callTitleApi({
  assetId,
  mode: "single",
  images,
  resolutionMap: {},
  maxTitleLength: 80
});

assert.equal(response.statusCode, 200);
assert.equal(response.body.source, "recognition_worker");
assert.equal(response.body.provider, "recognition_worker");
assert.equal(response.body.identity_resolution_status, "CONFIRMED");
assert.equal(response.body.usage.provider_calls, 0);
assert.equal(response.body.usage.recognition_worker_calls, 1);
assert.equal(response.body.usage.estimated_cost_usd, 0);
assert.doesNotMatch(response.body.final_title, /[\u4e00-\u9fff]/);
assert.match(response.body.final_title, /2024 Topps Chrome/);
assert.match(response.body.final_title, /Shohei Ohtani/);
assert.match(response.body.final_title, /\bGold\b/);
assert.doesNotMatch(response.body.final_title, /Gold\s+Refractor/);
assert.match(response.body.final_title, /31\/50/);
assert.doesNotMatch(response.body.final_title, /#\/50/);
assert.equal(response.body.resolved.serial_number, "31/50");
assert.match(response.body.final_title, /PSA 10/);
assert.ok(response.body.field_states.find((field) => field.field === "serial_number").supporting_sources.some((source) => source.source === "CARD_FRONT_PRINTED_TEXT"));
assert.ok(!fetchCalls.some((call) => call.host.includes("legacy-removed-provider.example")));
assert.deepEqual(fetchCalls.map((call) => call.host), [
  "supabase.test",
  "supabase.test",
  "supabase.test",
  "supabase.test",
  "recognition.internal"
]);

console.log("recognition preflight api tests passed");
