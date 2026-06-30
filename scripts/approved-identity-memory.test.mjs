import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-copilot-title.js";
import {
  approvedHistoryRecordToEvidenceDocument,
  payloadAssetFingerprint
} from "../lib/listing/memory/approved-identity-memory.mjs";
import {
  listApprovedHistoryRecords,
  listLegacyApprovedTitleFeedbackRecords
} from "../lib/supabase-feedback.mjs";
import {
  parseReviewedTitleFields,
  reviewedTitleRecordToMemoryRecord
} from "../lib/listing/memory/title-field-parser.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_APPROVED_MEMORY_ENABLED = "true";
process.env.DEFAULT_VISION_PROVIDER = "openai_legacy";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_LISTING_MODEL = "gpt-4.1-mini-2025-04-14";

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
}

function makeImage({
  id,
  role,
  objectPath,
  contentSha256
}) {
  return {
    id,
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
    text: async () => JSON.stringify(payload)
  };
}

async function callTitleApi(payload) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionCookie() };

  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };

  const promise = handler(req, res);
  req.emit("data", JSON.stringify(payload));
  req.emit("end");
  await promise;

  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body)
  };
}

const frontSha = "a".repeat(64);
const backSha = "b".repeat(64);
const images = [
  makeImage({
    id: "front",
    role: "front_original",
    objectPath: "listing-assets/2026-06-23/asset-approved/front.jpg",
    contentSha256: frontSha
  }),
  makeImage({
    id: "back",
    role: "back_original",
    objectPath: "listing-assets/2026-06-23/asset-approved/back.jpg",
    contentSha256: backSha
  })
];
const payload = {
  assetId: "asset-approved",
  mode: "single",
  images,
  resolutionMap: {},
  maxTitleLength: 80
};
const { asset_fingerprint: assetFingerprint } = payloadAssetFingerprint(payload);
assert.match(assetFingerprint, /^[0-9a-f]{64}$/);

const approvedRecord = {
  id: "review-approved-fast-path",
  asset_id: "asset-approved",
  analysis_run_id: "analysis-approved",
  asset_fingerprint: assetFingerprint,
  final_title: "历史标题不应直接复用",
  corrected_title: "历史标题不应直接复用",
  fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    serial_number: "31/50",
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  review_outcome: "ACCEPTED_UNCHANGED",
  stable_training_sample: true,
  training_status: "approved_clean",
  reusable_approved_title: true,
  approved_at: "2026-06-23T00:00:00.000Z",
  created_at: "2026-06-23T00:00:00.000Z"
};

const evidenceDocument = approvedHistoryRecordToEvidenceDocument(approvedRecord, { assetFingerprint });
assert.equal(evidenceDocument.evidence.players.sources[0].source_type, "INTERNAL_APPROVED_HISTORY");
assert.equal(evidenceDocument.evidence.serial_number.status, "MANUAL_CONFIRMED");

const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = new URL(String(url));
  const table = requestUrl.pathname.split("/").at(-1);
  fetchCalls.push({
    table,
    url: requestUrl.href,
    method: options.method || "GET"
  });

  if (table === "listing_image_verifications") {
    const objectPath = requestUrl.searchParams.get("object_path")?.replace(/^eq\./, "");
    const image = images.find((item) => item.objectPath === objectPath);
    assert.ok(image, `unexpected verification object path ${objectPath}`);
    return jsonResponse([
      {
        object_path: image.objectPath,
        bucket: image.bucket,
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

  if (table === "listing_reviews") {
    assert.equal(requestUrl.searchParams.get("asset_fingerprint"), `eq.${assetFingerprint}`);
    assert.equal(requestUrl.searchParams.get("limit"), "3");
    return jsonResponse([
      {
        id: approvedRecord.id,
        asset_id: approvedRecord.asset_id,
        analysis_run_id: approvedRecord.analysis_run_id,
        asset_fingerprint: approvedRecord.asset_fingerprint,
        corrected_title: approvedRecord.corrected_title,
        corrected_resolved_fields: approvedRecord.fields,
        review_outcome: approvedRecord.review_outcome,
        stable_training_sample: approvedRecord.stable_training_sample,
        training_status: approvedRecord.training_status,
        reusable_approved_title: approvedRecord.reusable_approved_title,
        approved_at: approvedRecord.approved_at,
        created_at: approvedRecord.created_at
      }
    ]);
  }

  throw new Error(`Unexpected remote call: ${requestUrl.href}`);
};

const response = await callTitleApi(payload);
assert.equal(response.statusCode, 200);
assert.equal(response.body.source, "internal_approved_history");
assert.equal(response.body.provider, "internal_approved_history");
assert.equal(response.body.identity_memory.cache_hit, true);
assert.equal(response.body.identity_memory.asset_fingerprint, assetFingerprint);
assert.equal(response.body.usage.provider_calls, 0);
assert.equal(response.body.usage.estimated_cost_usd, 0);
assert.equal(response.body.usage.retrieval_calls, 0);
assert.equal(response.body.identity_resolution_status, "CONFIRMED");
assert.doesNotMatch(response.body.final_title, /[\u4e00-\u9fff]/);
assert.match(response.body.final_title, /2025 Topps Chrome Cooper Flagg/);
assert.match(response.body.final_title, /\/50/);
assert.doesNotMatch(response.body.final_title, /31\/50/);
assert.equal(response.body.resolved.serial_number, "31/50");
assert.match(response.body.final_title, /PSA 10/);
assert.equal(response.body.evidence.players.sources[0].source_type, "INTERNAL_APPROVED_HISTORY");
assert.equal(response.body.field_states.find((field) => field.field === "players").source_summary[0].source, "INTERNAL_APPROVED_HISTORY");
assert.deepEqual(fetchCalls.map((call) => call.table), [
  "listing_image_verifications",
  "listing_image_verifications",
  "listing_reviews"
]);

const parsedTitle = parseReviewedTitleFields("2025 Topps Chrome Sapphire Shohei Ohtani Variation-Gold 05/50 PSA 9");
assert.equal(parsedTitle.year, "2025");
assert.equal(parsedTitle.product, "Topps Chrome Sapphire");
assert.equal(parsedTitle.surface_color, "Gold");
assert.equal(parsedTitle.parallel, null);
assert.equal(parsedTitle.serial_number, "5/50");
assert.equal(parsedTitle.grade_company, "PSA");
assert.equal(parsedTitle.card_grade, "9");

const parsedCollectorNumber = parseReviewedTitleFields("2025 Topps Chrome Cooper Flagg Next Stop Signatures RC 72/75 Auto #NS-CF");
assert.equal(parsedCollectorNumber.year, "2025");
assert.equal(parsedCollectorNumber.product, "Topps Chrome");
assert.equal(parsedCollectorNumber.collector_number, "NS-CF");
assert.equal(parsedCollectorNumber.serial_number, "72/75");
assert.equal(parsedCollectorNumber.auto, true);

const parsedBeckett = parseReviewedTitleFields("2021-22 Panini Impeccable Cristiano Ronaldo Canvas Creations Auto 91/99 Beckett 8.5");
assert.equal(parsedBeckett.grade_company, "BGS");
assert.equal(parsedBeckett.card_grade, "8.5");
assert.equal(parsedBeckett.auto, true);
assert.equal(parsedBeckett.relic, false);

const memoryRecord = reviewedTitleRecordToMemoryRecord({
  id: "feedback-title-row",
  corrected_title: "2016 Bowman Chrome Juan Soto 1st Bowman Prospect Auto PSA 10"
});
assert.equal(memoryRecord.id, "feedback-title-row");
assert.equal(memoryRecord.reusable_approved_title, false);
assert.equal(memoryRecord.fields.first_bowman, true);
assert.equal(memoryRecord.fields.auto, true);
assert.equal(memoryRecord.fields.grade_company, "PSA");

const fallbackFetchCalls = [];
const fallbackFetch = async (url) => {
  const requestUrl = new URL(String(url));
  const table = requestUrl.pathname.split("/").at(-1);
  fallbackFetchCalls.push({
    table,
    limit: requestUrl.searchParams.get("limit"),
    order: requestUrl.searchParams.get("order")
  });

  if (table === "listing_reviews") {
    return jsonResponse({ message: "relation listing_reviews does not exist" }, 404);
  }

  if (table === "listing_title_feedback") {
    assert.equal(requestUrl.searchParams.get("corrected_title"), "not.is.null");
    return jsonResponse([
      {
        id: "legacy-feedback-ohtani",
        generated_title: "2025 Topps Chrome Sapphire Shohei Ohtani PSA 9",
        corrected_title: "2025 Topps Chrome Sapphire Shohei Ohtani Variation-Gold 05/50 PSA 9",
        front_image_url: "https://supabase.test/storage/v1/object/sign/listing-feedback-images/front.jpg",
        back_image_url: "https://supabase.test/storage/v1/object/sign/listing-feedback-images/back.jpg",
        created_at: "2026-06-22T00:00:00.000Z"
      }
    ]);
  }

  throw new Error(`Unexpected fallback remote call: ${requestUrl.href}`);
};

const fallbackRecords = await listApprovedHistoryRecords({
  env: process.env,
  fetchImpl: fallbackFetch,
  limit: 20
});
assert.deepEqual(fallbackFetchCalls.map((call) => call.table), [
  "listing_reviews",
  "listing_title_feedback"
]);
assert.equal(fallbackRecords.length, 1);
assert.equal(fallbackRecords[0].legacy_feedback, true);
assert.equal(fallbackRecords[0].reusable_approved_title, false);
assert.equal(fallbackRecords[0].fields.product, "Topps Chrome Sapphire");
assert.equal(fallbackRecords[0].fields.surface_color, "Gold");
assert.equal(fallbackRecords[0].fields.parallel, undefined);
assert.equal(fallbackRecords[0].fields.serial_number, "5/50");
assert.equal(fallbackRecords[0].fields.grade_company, "PSA");
assert.equal(fallbackRecords[0].fields.card_grade, "9");

const legacyOnlyRecords = await listLegacyApprovedTitleFeedbackRecords({
  env: process.env,
  fetchImpl: fallbackFetch,
  limit: 2
});
assert.equal(legacyOnlyRecords.length, 1);
assert.equal(legacyOnlyRecords[0].training_status, "legacy_feedback_title_parsed_local");

console.log("approved identity memory tests passed");
