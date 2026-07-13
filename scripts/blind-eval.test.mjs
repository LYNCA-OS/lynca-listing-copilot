import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertBlindInputRow,
  assertOpaqueImageFilename,
  assertSellerListing,
  classifyBlindEvaluationListing,
  filterBlindEvaluationListings,
  isSealedProductListing,
  blindEvalRunPaths,
  comparePredictionToTitle,
  defaultBlindEvalDir,
  imageDescriptorFromBytes,
  prepareBlindDataset,
  readJsonl,
  recognitionOutputFromCloudData,
  runBlindRecognition,
  scoreBlindEval,
  titleWeakLabelFromTitle,
  writeJsonl
} from "../lib/listing/evaluation/blind-eval.mjs";

assert.equal(isSealedProductListing({ title: "2023-24 Topps Chrome Factory Sealed 5 Hobby Box Case" }), true);
assert.equal(isSealedProductListing({ title: "2023 Panini Prizm Victor Wembanyama Case Hit SSP" }), false);
assert.equal(isSealedProductListing({ title: "2024 Topps Chrome Shohei Ohtani Refractor PSA 10" }), false);
assert.deepEqual(
  classifyBlindEvaluationListing({ title: "2025 Topps Chrome Football Pick Your Base #1-200 - Buy More & Save" }),
  { eligible: false, reason: "buyer_choice_listing" }
);
assert.deepEqual(
  classifyBlindEvaluationListing({ title: "2024 Topps Chrome Shohei Ohtani Refractor PSA 10" }),
  { eligible: true, reason: "specific_card_listing" }
);
assert.equal(classifyBlindEvaluationListing({
  title: "2024 Pokemon Pikachu Holo",
  item_group_href: "https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group"
}).reason, "variation_group_listing");
for (const title of [
  "NBA Basketball Pack - 10 Cards - 1 Guaranteed Auto or #'d Card in Every Pack!",
  "NBA Mystery Pack",
  "PANINI 2026 FIFA World Cup Stickers Set de 14 Stickers",
  "10 Cards Diamond Pack With 3 Numbered or Autos"
]) {
  assert.equal(classifyBlindEvaluationListing({ title }).eligible, false, title);
}
const evaluationListingFilter = filterBlindEvaluationListings([
  { item_id: "pick", title: "2026 Panini FIFA Stickers - YOU PICK - #ARG1 - #PAN20" },
  { item_id: "supply", title: "(30) TALL Sports Card Dividers with NBA Teams Labels" },
  { item_id: "card", title: "2024 Topps Chrome Shohei Ohtani Refractor PSA 10" }
]);
assert.deepEqual(evaluationListingFilter.listings.map((listing) => listing.item_id), ["card"]);
assert.equal(evaluationListingFilter.discarded_count, 2);

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

function headers(values = {}) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name) {
      return normalized[String(name || "").toLowerCase()] || "";
    },
    getSetCookie() {
      return normalized["set-cookie"] ? [normalized["set-cookie"]] : [];
    }
  };
}

function jsonResponse(status, body, extraHeaders = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers({ "content-type": "application/json", ...extraHeaders }),
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)).buffer
  };
}

function bytesResponse(status, bytes, extraHeaders = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(extraHeaders),
    text: async () => bytes.toString("utf8"),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

function cloudFetchRecorder({
  titleResponder,
  uploadAlreadyExists = false,
  expectedProviderOptions = {}
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/listing-image-upload-url") {
      const body = JSON.parse(init.body);
      if (uploadAlreadyExists) {
        return jsonResponse(400, {
          ok: false,
          message: "Supabase signed upload URL failed: 400 The resource already exists"
        });
      }
      return jsonResponse(200, {
        ok: true,
        upload: {
          object_path: `listing-assets/test/${body.imageId}.png`,
          bucket: "listing-feedback-images",
          content_type: body.contentType,
          signed_upload_url: `https://storage.test/upload/${body.imageId}`
        }
      });
    }
    if (path === "/api/listing-image-verify-existing") {
      const body = JSON.parse(init.body);
      return jsonResponse(200, {
        ok: true,
        verification: {
          bucket: "listing-feedback-images",
          object_path: body.objectPath,
          verification_token: `verified-existing-${body.imageId}`,
          content_type: "image/png",
          size: tinyPng.length,
          width: 1,
          height: 1,
          content_sha256: crypto.createHash("sha256").update(tinyPng).digest("hex")
        }
      });
    }
    if (url.startsWith("https://storage.test/upload/")) {
      return bytesResponse(200, Buffer.from("ok"));
    }
    if (path === "/api/listing-image-verify-upload") {
      const body = JSON.parse(init.body);
      return jsonResponse(200, {
        ok: true,
        verification: {
          bucket: "listing-feedback-images",
          object_path: body.objectPath,
          verification_token: `verified-${body.imageId}`,
          content_type: body.contentType,
          size: body.size,
          width: body.width,
          height: body.height,
          content_sha256: body.contentSha256
        }
      });
    }
    if (path === "/api/listing-copilot-title") {
      const body = JSON.parse(init.body);
      assert.equal(body.catalog_observation_hint, null);
      assert.equal(body.category, undefined);
      const serialized = JSON.stringify(body);
      assert.doesNotMatch(serialized, /seller|item_web_url|item_id|corrected title value/i);
      assert.equal(body.provider_eval_mode, "openai_vector");
      assert.equal(body.provider_options.enable_catalog_assist, true);
      assert.equal(body.provider_options.enable_vector_assist, true);
      assert.equal(body.provider_options.enable_query_visual_embeddings, true);
      assert.equal(body.provider_options.enable_vector_retrieval, true);
      assert.equal(body.provider_options.vector_retrieval_mode, "assist");
      assert.equal(body.provider_options.enable_vector_lazy_mode, expectedProviderOptions.enable_vector_lazy_mode ?? true);
      assert.equal(body.provider_options.force_vector_assist, expectedProviderOptions.force_vector_assist ?? false);
      assert.equal(body.provider_options.vector_index_ready, expectedProviderOptions.vector_index_ready);
      assert.equal(body.provider_options.corrected_title_as_temporary_gt, false);
      assert.equal(body.provider_options.send_corrected_title_hint_to_cloud, false);
      return jsonResponse(200, titleResponder?.(body) || {
        final_title: "2025 Topps Chrome Test Player Gold 12/50 PSA 10",
        confidence: "HIGH",
        model_id: "gpt-4.1-mini",
        resolved: {
          year: "2025",
          manufacturer: "Topps",
          product: "Topps Chrome",
          players: ["Test Player"],
          surface_color: "Gold",
          serial_number: "12/50",
          grade_company: "PSA",
          card_grade: "10"
        },
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30
        },
        catalog_anchor_plan: {
          version: "catalog_anchor_plan_v1",
          phase: "provider_observation_catalog_lookup",
          anchors: [{ field: "subject", value: "Test Player", strength: "identity" }],
          retrieval_lanes: ["CATALOG_YEAR_PRODUCT_SUBJECT"],
          eligibility_snapshot: {
            raw_candidate_count: 1,
            approved_candidate_count: 1,
            conflict_blocked_count: 0,
            prompt_candidate_count: 1,
            prompt_candidate_ids: ["identity-test-player"]
          }
        }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { calls, fetchImpl };
}

async function withTempDir(callback) {
  const dir = await mkdtemp(join(tmpdir(), "lynca-blind-eval-test-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

assert.throws(
  () => assertBlindInputRow({
    case_id: "case-1",
    image_paths: ["artifacts/blind_eval/images/case-1_img_0.jpg"],
    title: "2025 Topps Chrome Test Player"
  }),
  /forbidden answer-key keys/
);

assert.throws(
  () => assertBlindInputRow({
    case_id: "case-1",
    image_paths: ["artifacts/blind_eval/images/case-1_img_0.jpg"],
    raw_listing_metadata: {}
  }),
  /forbidden answer-key keys|non-blind keys/
);

assert.doesNotThrow(() => assertBlindInputRow({
  case_id: "opaque-case",
  image_paths: ["artifacts/blind_eval/images/opaque-case_img_0.jpg"]
}));

assert.throws(
  () => assertOpaqueImageFilename("artifacts/blind_eval/images/victor-wembanyama-front.jpg", "2025 Topps Chrome Victor Wembanyama Gold"),
  /leaks title token/
);

assert.throws(
  () => assertSellerListing({
    seller: "other",
    item_id: "1",
    title: "Test",
    item_web_url: "https://example.test",
    image_urls: ["https://images.test/a.jpg"]
  }),
  /Rejected non-dcsports87 listing/
);

assert.deepEqual(imageDescriptorFromBytes(tinyPng).contentType, "image/png");

await withTempDir(async (dir) => {
  const blindDir = join(dir, "blind");
  const paths = blindEvalRunPaths({ outDir: blindDir, runId: "run-a" });
  const fetchImpl = async (url, init = {}) => {
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-dcsports87-listings") {
      return jsonResponse(200, {
        ok: true,
        seller: "dcsports87",
        marketplace_id: "EBAY_US",
        listings: [{
          seller: "dcsports87",
          item_id: "item-1",
          item_web_url: "https://www.ebay.com/itm/item-1",
          title: "2025 Topps Chrome Test Player Gold 12/50 PSA 10",
          image_urls: ["https://i.ebayimg.test/image-1.jpg"],
          condition: "Used",
          price: { value: "1.00", currency: "USD" }
        }]
      });
    }
    if (url === "https://i.ebayimg.test/image-1.jpg") {
      return bytesResponse(200, tinyPng, { "content-type": "image/png" });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: blindDir,
    runId: "run-a",
    limit: 2,
    allowPartial: true,
    fetchImpl
  });
  assert.equal(result.listing_count, 1);
  assert.equal(result.requested_listing_count, 2);
  assert.equal(result.partial_dataset, true);
  assert.equal(result.layout_version, "strict_blind_eval_v2");
  assert.equal(result.ground_truth_policy.seller_titles_are_ground_truth, false);
  assert.equal(result.ground_truth_policy.reviewed_title_ground_truth_source, "supabase_listing_title_feedback_corrected_title_only");
  const blindRows = await readJsonl(paths.blind_inputs_path);
  assert.deepEqual(Object.keys(blindRows[0]), ["case_id", "image_paths"]);
  assert.match(blindRows[0].image_paths[0], /_img_0\.jpg$/);
  assert.doesNotMatch(basename(blindRows[0].image_paths[0]), /test|player|topps|chrome|gold/i);
});

await withTempDir(async (dir) => {
  let listingsRequest = null;
  const fetchImpl = async (url) => {
    const parsed = /^https?:/i.test(url) ? new URL(url) : null;
    const path = parsed ? parsed.pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-seller-listings") {
      listingsRequest = parsed;
      return jsonResponse(200, {
        ok: true,
        seller: "the-poke-store",
        marketplace_id: "EBAY_US",
        listings: [{
          seller: "the-poke-store",
          item_id: "alternate-seller-item",
          item_web_url: "https://www.ebay.com/itm/alternate-seller-item",
          title: "Pokemon Pikachu Holo PSA 10",
          image_urls: ["https://i.ebayimg.test/alternate.jpg"]
        }]
      });
    }
    if (url === "https://i.ebayimg.test/alternate.jpg") {
      return bytesResponse(200, tinyPng, { "content-type": "image/png" });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: dir,
    runId: "alternate-seller-run",
    expectedSeller: "The-Poke-Store",
    limit: 1,
    fetchImpl
  });
  assert.equal(result.seller, "the-poke-store");
  assert.equal(result.listings_endpoint, "/api/ebay-seller-listings");
  assert.equal(listingsRequest.searchParams.get("seller"), "the-poke-store");
  const answers = await readJsonl(blindEvalRunPaths({ outDir: dir, runId: "alternate-seller-run" }).answer_key_path);
  assert.equal(answers[0].seller, "the-poke-store");
});

await withTempDir(async (dir) => {
  let listingsRequest = null;
  const fetchImpl = async (url, init = {}) => {
    const parsed = /^https?:/i.test(url) ? new URL(url) : null;
    const path = parsed ? parsed.pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-dcsports87-listings") {
      listingsRequest = parsed;
      return jsonResponse(200, {
        ok: true,
        seller: "dcsports87",
        marketplace_id: "EBAY_US",
        query: "card",
        sports_only: true,
        listings: [{
          seller: "dcsports87",
          item_id: "pokemon-item",
          item_web_url: "https://www.ebay.com/itm/pokemon-item",
          title: "Pokemon Charizard Holo PSA 10",
          image_urls: ["https://i.ebayimg.test/pokemon.jpg"]
        }, {
          seller: "dcsports87",
          item_id: "box-item",
          item_web_url: "https://www.ebay.com/itm/box-item",
          title: "2023-24 Panini Crown Royale NBA Basketball Factory Sealed Hobby Box",
          image_urls: ["https://i.ebayimg.test/box.jpg"]
        }, {
          seller: "dcsports87",
          item_id: "sports-item",
          item_web_url: "https://www.ebay.com/itm/sports-item",
          title: "2025 Topps Chrome Basketball Test Player Gold Case Hit 12/50 PSA 10",
          image_urls: ["https://i.ebayimg.test/sports.jpg"]
        }]
      });
    }
    if (url === "https://i.ebayimg.test/sports.jpg") {
      return bytesResponse(200, tinyPng, { "content-type": "image/png" });
    }
    if (url === "https://i.ebayimg.test/pokemon.jpg") throw new Error("non-sports listing image should not be downloaded");
    if (url === "https://i.ebayimg.test/box.jpg") throw new Error("sealed box listing image should not be downloaded");
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: dir,
    runId: "sports-run",
    limit: 1,
    query: "card",
    sportsOnly: true,
    categoryIds: "212",
    fetchImpl
  });
  const paths = blindEvalRunPaths({ outDir: dir, runId: "sports-run" });
  const blindRows = await readJsonl(paths.blind_inputs_path);
  const answers = await readJsonl(paths.answer_key_path);
  assert.equal(listingsRequest.searchParams.get("sports_only"), "1");
  assert.equal(listingsRequest.searchParams.get("category_ids"), "212");
  assert.equal(result.sports_only, true);
  assert.equal(result.local_sports_filtered_count, 2);
  assert.equal(answers[0].item_id, "sports-item");
  assert.deepEqual(Object.keys(blindRows[0]), ["case_id", "image_paths"]);
});

await withTempDir(async (dir) => {
  const priorAnswerKey = join(dir, "prior-answer-key.jsonl");
  await writeJsonl(priorAnswerKey, [{ case_id: "old", item_id: "item-1", title: "Old title" }]);
  const fetchImpl = async (url, init = {}) => {
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-dcsports87-listings") {
      return jsonResponse(200, {
        ok: true,
        seller: "dcsports87",
        marketplace_id: "EBAY_US",
        listings: [{
          seller: "dcsports87",
          item_id: "item-1",
          item_web_url: "https://www.ebay.com/itm/item-1",
          title: "Excluded title",
          image_urls: ["https://i.ebayimg.test/excluded.jpg"]
        }, {
          seller: "dcsports87",
          item_id: "item-2",
          item_web_url: "https://www.ebay.com/itm/item-2",
          title: "2025 Topps Chrome Test Player Gold 12/50 PSA 10",
          image_urls: ["https://i.ebayimg.test/image-2.jpg"]
        }]
      });
    }
    if (url === "https://i.ebayimg.test/image-2.jpg") return bytesResponse(200, tinyPng, { "content-type": "image/png" });
    if (url === "https://i.ebayimg.test/excluded.jpg") throw new Error("excluded listing image should not be downloaded");
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: dir,
    runId: "exclude-run",
    limit: 1,
    excludeAnswerKeyPaths: [priorAnswerKey],
    evaluationSampleMode: "FRESH_GENERALIZATION",
    fetchImpl
  });
  const answers = await readJsonl(blindEvalRunPaths({ outDir: dir, runId: "exclude-run" }).answer_key_path);
  assert.equal(result.excluded_item_count, 1);
  assert.equal(result.evaluation_sample_policy.mode, "FRESH_GENERALIZATION");
  assert.equal(result.evaluation_sample_policy.novelty_verified, true);
  assert.equal(result.evaluation_sample_policy.prior_history_overlap_count, 0);
  assert.equal(answers[0].item_id, "item-2");
});

await withTempDir(async (dir) => {
  const fetchImpl = async (url, init = {}) => {
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-dcsports87-listings") {
      return jsonResponse(200, {
        ok: true,
        seller: "dcsports87",
        marketplace_id: "EBAY_US",
        listings: [{
          seller: "dcsports87",
          item_id: "bad-image",
          item_web_url: "https://www.ebay.com/itm/bad-image",
          title: "2025 Topps Chrome Bad Image Card",
          image_urls: ["https://i.ebayimg.test/missing.jpg"]
        }, {
          seller: "dcsports87",
          item_id: "good-image",
          item_web_url: "https://www.ebay.com/itm/good-image",
          title: "2025 Topps Chrome Good Image Card",
          image_urls: ["https://i.ebayimg.test/good.jpg"]
        }]
      });
    }
    if (url === "https://i.ebayimg.test/missing.jpg") return bytesResponse(404, Buffer.from("missing"));
    if (url === "https://i.ebayimg.test/good.jpg") return bytesResponse(200, tinyPng, { "content-type": "image/png" });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: dir,
    runId: "skip-bad-image",
    limit: 1,
    fetchImpl
  });
  const answers = await readJsonl(blindEvalRunPaths({ outDir: dir, runId: "skip-bad-image" }).answer_key_path);
  assert.equal(result.image_download_skipped_count, 1);
  assert.equal(answers[0].item_id, "good-image");
});


await withTempDir(async (dir) => {
  const largePng = tinyPng;
  const fetchImpl = async (url, init = {}) => {
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-dcsports87-listings") {
      return jsonResponse(200, {
        ok: true,
        seller: "dcsports87",
        marketplace_id: "EBAY_US",
        listings: [{
          seller: "dcsports87",
          item_id: "highres-item",
          item_web_url: "https://www.ebay.com/itm/highres-item",
          title: "2025 Topps Chrome High Resolution Card",
          image_urls: ["https://i.ebayimg.test/images/g/card/s-l225.jpg"]
        }]
      });
    }
    if (url === "https://i.ebayimg.test/images/g/card/s-l225.jpg") return bytesResponse(404, Buffer.from("missing"));
    if (url === "https://i.ebayimg.test/images/g/card/s-l1600.jpg") return bytesResponse(200, largePng, { "content-type": "image/png" });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: dir,
    runId: "highres-image",
    limit: 1,
    fetchImpl
  });
  assert.equal(result.downloaded_image_quality_summary.upgraded_count, 1);
  assert.equal(result.downloaded_image_quality_samples[0].upgraded, true);
});

await withTempDir(async (dir) => {
  const inputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions.jsonl");
  const imagePath = join(dir, "opaque_img_0.jpg");
  await writeFile(imagePath, tinyPng);
  await writeJsonl(inputPath, [{
    case_id: "case-a",
    image_paths: [imagePath]
  }]);
  const { calls, fetchImpl } = cloudFetchRecorder();
  const result = await runBlindRecognition({
    inputPath,
    outputPath,
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    fetchImpl
  });
  assert.equal(result.prediction_count, 1);
  assert.match(result.predictions_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.predictions[0].c_group_diagnostics.catalog_anchor_plan.version, "catalog_anchor_plan_v1");
  assert.equal(result.predictions[0].c_group_diagnostics.catalog_anchor_plan.eligibility_snapshot.prompt_candidate_count, 1);
  assert.ok(calls.some((call) => new URL(call.url).pathname === "/api/listing-copilot-title"));
  const hashText = await readFile(join(dir, "predictions.sha256"), "utf8");
  assert.match(hashText, /^[a-f0-9]{64}\s+predictions\.jsonl/);
});

await withTempDir(async (dir) => {
  const inputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions.jsonl");
  const imagePath = join(dir, "opaque_img_0.jpg");
  await writeFile(imagePath, tinyPng);
  await writeJsonl(inputPath, [{
    case_id: "case-vector-ready",
    image_paths: [imagePath]
  }]);
  let titlePayload = null;
  const { fetchImpl } = cloudFetchRecorder({
    expectedProviderOptions: {
      enable_vector_lazy_mode: false,
      force_vector_assist: true,
      vector_index_ready: true
    },
    titleResponder: (body) => {
      titlePayload = body;
      return {
        final_title: "2025 Topps Chrome Test Player Gold #/50 PSA 10",
        confidence: "HIGH",
        model_id: "gpt-4.1-mini",
        resolved: {
          year: "2025",
          manufacturer: "Topps",
          product: "Topps Chrome",
          players: ["Test Player"],
          surface_color: "Gold",
          serial_number: "12/50",
          grade_company: "PSA",
          card_grade: "10"
        }
      };
    }
  });
  await runBlindRecognition({
    inputPath,
    outputPath,
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    env: {
      BLIND_EVAL_FORCE_VECTOR_ASSIST: "true",
      BLIND_EVAL_VECTOR_INDEX_READY: "true",
      BLIND_EVAL_REQUIRE_VECTOR_INDEX_READY: "true"
    },
    fetchImpl
  });
  assert.equal(titlePayload.provider_options.force_vector_assist, true);
  assert.equal(titlePayload.provider_options.enable_vector_lazy_mode, false);
  assert.equal(titlePayload.provider_options.vector_index_ready, true);
  assert.equal(titlePayload.provider_options.eval_flags.FORCE_VECTOR_ASSIST, true);
  assert.equal(titlePayload.provider_options.eval_flags.VECTOR_INDEX_READY, true);
});

await withTempDir(async (dir) => {
  const inputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions.jsonl");
  const imagePath = join(dir, "opaque_img_0.jpg");
  await writeFile(imagePath, tinyPng);
  await writeJsonl(inputPath, [{
    case_id: "case-vector-not-ready",
    image_paths: [imagePath]
  }]);
  await assert.rejects(
    () => runBlindRecognition({
      inputPath,
      outputPath,
      baseUrl: "https://listing.test",
      username: "metaverse",
      password: "mtv",
      env: {
        BLIND_EVAL_REQUIRE_VECTOR_INDEX_READY: "true"
      },
      fetchImpl: async () => {
        throw new Error("recognition should fail before network calls");
      }
    }),
    /VECTOR_INDEX_READY/
  );
});

await withTempDir(async (dir) => {
  const inputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions.jsonl");
  const imagePath = join(dir, "opaque_img_0.jpg");
  await writeFile(imagePath, tinyPng);
  await writeJsonl(inputPath, [{
    case_id: "case-anchor-pass-shadow",
    image_paths: [imagePath]
  }]);
  const { fetchImpl } = cloudFetchRecorder({
    titleResponder: () => ({
      final_title: "2025 Topps Chrome Test Player Gold #/50 PSA 10",
      confidence: "HIGH",
      model_id: "gpt-4.1-mini",
      resolved: {
        year: "2025",
        manufacturer: "Topps",
        product: "Topps Chrome",
        players: ["Test Player"],
        surface_color: "Gold",
        serial_number: "12/50",
        grade_company: "PSA",
        card_grade: "10"
      },
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30
      },
      catalog_assist_eligibility: {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        conflict_blocked_count: 0,
        prompt_candidate_count: 0,
        prompt_candidate_ids: []
      },
      catalog_candidate_packet: {
        vector_retrieval: {
          candidates: [{
            candidate_id: "anchor-pass-shadow-only",
            candidate_identity_id: "identity-shadow-only",
            source_trust: "APPROVED_REFERENCE",
            reference_title: "2025 Topps Chrome Test Player Gold",
            matched_fields: ["year", "players"],
            supporting_fields: ["year", "players"],
            conflicting_fields: [],
            anchor_agreement: {
              agreed: ["year", "subjects"],
              contradicted: [],
              exact_code_match: false,
              prompt_hard_filter_applicable: true,
              prompt_hard_filter_pass: true
            },
            fields: {
              year: "2025",
              product: "Topps Chrome",
              players: ["Test Player"]
            }
          }]
        }
      }
    })
  });
  const result = await runBlindRecognition({
    inputPath,
    outputPath,
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    fetchImpl
  });
  const debugRow = result.predictions[0].c_group_diagnostics.catalog_candidate_debug[0];
  assert.equal(debugRow.anchor_agreement.prompt_hard_filter_pass, true);
  assert.equal(debugRow.prompt_admitted, false, "debug output must not treat anchor-pass shadow candidates as prompt-admitted");
  assert.equal(result.predictions[0].c_group_diagnostics.catalog_assist_eligibility.prompt_candidate_count, 0);
});


await withTempDir(async (dir) => {
  const largePng = tinyPng;
  const fetchImpl = async (url, init = {}) => {
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-dcsports87-listings") {
      return jsonResponse(200, {
        ok: true,
        seller: "dcsports87",
        marketplace_id: "EBAY_US",
        listings: [{
          seller: "dcsports87",
          item_id: "highres-item",
          item_web_url: "https://www.ebay.com/itm/highres-item",
          title: "2025 Topps Chrome High Resolution Card",
          image_urls: ["https://i.ebayimg.test/images/g/card/s-l225.jpg"]
        }]
      });
    }
    if (url === "https://i.ebayimg.test/images/g/card/s-l225.jpg") return bytesResponse(404, Buffer.from("missing"));
    if (url === "https://i.ebayimg.test/images/g/card/s-l1600.jpg") return bytesResponse(200, largePng, { "content-type": "image/png" });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: dir,
    runId: "highres-image",
    limit: 1,
    fetchImpl
  });
  assert.equal(result.downloaded_image_quality_summary.upgraded_count, 1);
  assert.equal(result.downloaded_image_quality_samples[0].upgraded, true);
});

await withTempDir(async (dir) => {
  const inputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions.jsonl");
  const imagePath = join(dir, "opaque_img_0.jpg");
  await writeFile(imagePath, tinyPng);
  await writeJsonl(inputPath, [{
    case_id: "case-retry",
    image_paths: [imagePath]
  }]);
  let titleAttempts = 0;
  const { calls, fetchImpl } = cloudFetchRecorder({
    titleResponder: () => {
      titleAttempts += 1;
      if (titleAttempts === 1) {
        return {
          confidence: "FAILED",
          provider_error_code: "timeout",
          reason: "provider timed out"
        };
      }
      return {
        final_title: "2025 Topps Chrome Test Player Gold 12/50 PSA 10",
        confidence: "HIGH",
        model_id: "gpt-4.1-mini",
        resolved: {
          year: "2025",
          manufacturer: "Topps",
          product: "Topps Chrome",
          players: ["Test Player"],
          surface_color: "Gold",
          serial_number: "12/50",
          grade_company: "PSA",
          card_grade: "10"
        }
      };
    }
  });
  const result = await runBlindRecognition({
    inputPath,
    outputPath,
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    env: { BLIND_EVAL_RECOGNITION_ATTEMPTS: "2" },
    fetchImpl
  });
  assert.equal(titleAttempts, 2);
  assert.equal(result.predictions[0].recognition_output.title, "2025 Topps Chrome Test Player Gold 12/50 PSA 10");
  assert.equal(result.predictions[0].timing.blind_recognition_attempts, 2);
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/listing-copilot-title").length, 2);
});


await withTempDir(async (dir) => {
  const largePng = tinyPng;
  const fetchImpl = async (url, init = {}) => {
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-dcsports87-listings") {
      return jsonResponse(200, {
        ok: true,
        seller: "dcsports87",
        marketplace_id: "EBAY_US",
        listings: [{
          seller: "dcsports87",
          item_id: "highres-item",
          item_web_url: "https://www.ebay.com/itm/highres-item",
          title: "2025 Topps Chrome High Resolution Card",
          image_urls: ["https://i.ebayimg.test/images/g/card/s-l225.jpg"]
        }]
      });
    }
    if (url === "https://i.ebayimg.test/images/g/card/s-l225.jpg") return bytesResponse(404, Buffer.from("missing"));
    if (url === "https://i.ebayimg.test/images/g/card/s-l1600.jpg") return bytesResponse(200, largePng, { "content-type": "image/png" });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: dir,
    runId: "highres-image",
    limit: 1,
    fetchImpl
  });
  assert.equal(result.downloaded_image_quality_summary.upgraded_count, 1);
  assert.equal(result.downloaded_image_quality_samples[0].upgraded, true);
});

await withTempDir(async (dir) => {
  const inputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions.jsonl");
  const imagePath = join(dir, "opaque_img_0.jpg");
  await writeFile(imagePath, tinyPng);
  await writeJsonl(inputPath, [{
    case_id: "case-existing-upload",
    image_paths: [imagePath]
  }]);
  const { calls, fetchImpl } = cloudFetchRecorder({ uploadAlreadyExists: true });
  const result = await runBlindRecognition({
    inputPath,
    outputPath,
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    fetchImpl
  });
  assert.equal(result.prediction_count, 1);
  assert.equal(calls.some((call) => new URL(call.url).pathname === "/api/listing-image-verify-existing"), true);
  assert.equal(calls.some((call) => String(call.url).startsWith("https://storage.test/upload/")), false);
});


await withTempDir(async (dir) => {
  const largePng = tinyPng;
  const fetchImpl = async (url, init = {}) => {
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=test; Path=/" });
    }
    if (path === "/api/ebay-dcsports87-listings") {
      return jsonResponse(200, {
        ok: true,
        seller: "dcsports87",
        marketplace_id: "EBAY_US",
        listings: [{
          seller: "dcsports87",
          item_id: "highres-item",
          item_web_url: "https://www.ebay.com/itm/highres-item",
          title: "2025 Topps Chrome High Resolution Card",
          image_urls: ["https://i.ebayimg.test/images/g/card/s-l225.jpg"]
        }]
      });
    }
    if (url === "https://i.ebayimg.test/images/g/card/s-l225.jpg") return bytesResponse(404, Buffer.from("missing"));
    if (url === "https://i.ebayimg.test/images/g/card/s-l1600.jpg") return bytesResponse(200, largePng, { "content-type": "image/png" });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await prepareBlindDataset({
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    outDir: dir,
    runId: "highres-image",
    limit: 1,
    fetchImpl
  });
  assert.equal(result.downloaded_image_quality_summary.upgraded_count, 1);
  assert.equal(result.downloaded_image_quality_samples[0].upgraded, true);
});

await withTempDir(async (dir) => {
  const inputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions", "predictions.jsonl");
  const doneImage = join(dir, "done_img_0.jpg");
  const nextImage = join(dir, "next_img_0.jpg");
  await writeFile(doneImage, tinyPng);
  await writeFile(nextImage, tinyPng);
  await writeJsonl(inputPath, [{
    case_id: "case-done",
    image_paths: [doneImage]
  }, {
    case_id: "case-next",
    image_paths: [nextImage]
  }]);
  await writeJsonl(outputPath, [{
    case_id: "case-done",
    recognition_output: {
      title: "Existing Prediction"
    },
    timing: {
      blind_recognition_attempts: 1
    }
  }]);
  const progressEvents = [];
  const { calls, fetchImpl } = cloudFetchRecorder();
  const result = await runBlindRecognition({
    inputPath,
    outputPath,
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    fetchImpl,
    onProgress: (event) => progressEvents.push(event)
  });
  assert.equal(result.prediction_count, 2);
  assert.equal(result.predictions[0].case_id, "case-done");
  assert.equal(result.predictions[0].recognition_output.title, "Existing Prediction");
  assert.equal(result.predictions[1].case_id, "case-next");
  assert.equal(progressEvents[0].skipped, true);
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/listing-copilot-title").length, 1);
});

await withTempDir(async (dir) => {
  const inputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions", "predictions.jsonl");
  const imageA = join(dir, "a_img_0.jpg");
  const imageB = join(dir, "b_img_0.jpg");
  const imageC = join(dir, "c_img_0.jpg");
  await writeFile(imageA, tinyPng);
  await writeFile(imageB, tinyPng);
  await writeFile(imageC, tinyPng);
  await writeJsonl(inputPath, [{
    case_id: "case-a",
    image_paths: [imageA]
  }, {
    case_id: "case-b",
    image_paths: [imageB]
  }, {
    case_id: "case-c",
    image_paths: [imageC]
  }]);
  const { calls, fetchImpl } = cloudFetchRecorder({
    titleResponder: (body) => ({
      final_title: `2025 Topps Chrome ${body.assetId} Gold`,
      confidence: "HIGH",
      model_id: "gpt-4.1-mini",
      resolved: {
        year: "2025",
        manufacturer: "Topps",
        product: "Topps Chrome",
        players: [body.assetId],
        surface_color: "Gold"
      }
    })
  });
  const progressEvents = [];
  const result = await runBlindRecognition({
    inputPath,
    outputPath,
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    limit: 2,
    concurrency: 2,
    resume: false,
    fetchImpl,
    onProgress: (event) => progressEvents.push(event)
  });
  assert.equal(result.configured_limit, 2);
  assert.equal(result.configured_concurrency, 2);
  assert.equal(result.prediction_count, 2);
  assert.deepEqual(result.predictions.map((prediction) => prediction.case_id), ["case-a", "case-b"]);
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/listing-copilot-title").length, 2);
  assert.equal(progressEvents.filter((event) => !event.skipped).length, 2);
});

await withTempDir(async (dir) => {
  const root = join(dir, "run-root");
  const inferenceBundle = join(root, "inference_bundle");
  await writeJsonl(join(inferenceBundle, "blind_inputs.jsonl"), [{
    case_id: "case-a",
    image_paths: ["opaque.jpg"]
  }]);
  await writeJsonl(join(root, "answer_key.jsonl"), [{ case_id: "case-a", item_id: "item-a" }]);
  await assert.rejects(
    () => runBlindRecognition({
      inputPath: root,
      outputPath: join(root, "predictions", "predictions.jsonl"),
      baseUrl: "https://listing.test",
      username: "metaverse",
      password: "mtv",
      fetchImpl: async () => {
        throw new Error("recognition should fail before network calls");
      }
    }),
    /contains answer_key\.jsonl/
  );
});

await withTempDir(async (dir) => {
  const inputDir = join(dir, "inference_bundle");
  const outputPath = join(dir, "predictions", "predictions.jsonl");
  const imagePath = join(inputDir, "opaque_img_0.jpg");
  await mkdir(inputDir, { recursive: true });
  await writeFile(imagePath, tinyPng);
  await writeJsonl(join(inputDir, "blind_inputs.jsonl"), [{
    case_id: "case-tiger",
    image_paths: [imagePath]
  }]);
  const { fetchImpl } = cloudFetchRecorder({
    titleResponder: () => ({
      final_title: "2018 Panini Choice Prizm Tiger Stripes Jalen Brunson RC #250 PSA 9",
      confidence: "HIGH",
      model_id: "gpt-4.1-mini",
      resolved: {
        year: "2018",
        manufacturer: "Panini",
        product: "Prizm",
        players: ["Jalen Brunson"],
        collector_number: "250",
        rc: true,
        grade_company: "PSA",
        card_grade: "9"
      }
    })
  });
  const result = await runBlindRecognition({
    inputPath: inputDir,
    outputPath,
    baseUrl: "https://listing.test",
    username: "metaverse",
    password: "mtv",
    fetchImpl
  });
  const output = result.predictions[0].recognition_output;
  assert.equal(output.raw_prediction_text, "2018 Panini Choice Prizm Tiger Stripes Jalen Brunson RC #250 PSA 9");
  assert.equal(output.parallel, "Tiger Stripe");
  assert.equal(output.set, "Prizm Choice");
  assert.ok(output.self_consistency_warnings.some((warning) => (
    warning.type === "STRUCTURED_FIELD_MISSING_FROM_RAW_PREDICTION"
    && warning.field === "parallel"
    && warning.raw_evidence === "Tiger Stripes"
  )));
});

const tigerAliasFromRawPrediction = recognitionOutputFromCloudData({
  final_title: "2018 Panini Choice Tiger Jalen Brunson RC #250 PSA 9",
  resolved: {
    year: "2018",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Jalen Brunson"],
    collector_number: "250",
    rc: true,
    grade_company: "PSA",
    card_grade: "9"
  }
});
assert.equal(tigerAliasFromRawPrediction.parallel, "Tiger Stripe");
assert.ok(tigerAliasFromRawPrediction.self_consistency_warnings.some((warning) => (
  warning.type === "STRUCTURED_FIELD_MISSING_FROM_RAW_PREDICTION"
  && warning.field === "parallel"
  && warning.raw_evidence === "Choice Tiger"
)));

const choiceTigerStripeAlias = recognitionOutputFromCloudData({
  final_title: "2018 Panini Prizm Choice Tiger Stripe Jalen Brunson RC #250 PSA 9",
  resolved: {
    year: "2018",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Jalen Brunson"],
    collector_number: "250",
    rc: true,
    grade_company: "PSA",
    card_grade: "9"
  }
});
assert.equal(choiceTigerStripeAlias.parallel, "Tiger Stripe");
assert.equal(choiceTigerStripeAlias.set, "Prizm Choice");

await withTempDir(async (dir) => {
  const badInputPath = join(dir, "blind_inputs.jsonl");
  const outputPath = join(dir, "predictions.jsonl");
  await writeJsonl(badInputPath, [{
    case_id: "case-a",
    image_paths: ["opaque.jpg"],
    seller: "dcsports87"
  }]);
  await assert.rejects(
    () => runBlindRecognition({
      inputPath: badInputPath,
      outputPath,
      baseUrl: "https://listing.test",
      username: "metaverse",
      password: "mtv",
      fetchImpl: async () => {
        throw new Error("recognition should fail before network calls");
      }
    }),
    /forbidden answer-key keys/
  );
});

const weakLabel = titleWeakLabelFromTitle("2025 Topps Chrome Test Player Gold 12/50 PSA 10");
assert.equal(weakLabel.year, "2025");
assert.equal(weakLabel.parallel, "Gold");
assert.equal(weakLabel.surface_color, "Gold");
assert.equal(weakLabel.serial_number, "12/50");
assert.equal(weakLabel.grade, "10");

const tcgWeakLabel = titleWeakLabelFromTitle("2023 Yu-Gi-Oh Adidas Collaboration Dark Magician Promo #ADC1-EN001 PSA 10");
assert.equal(tcgWeakLabel.player, "Dark Magician");
assert.equal(tcgWeakLabel.card_number, "ADC1-EN001");
assert.equal(tcgWeakLabel.grade, "10");

const ohtaniWeakLabel = titleWeakLabelFromTitle("2018 Panini National Treasures Shohei Ohtani Rookie Patch Auto Holo Gold RC #/25");
assert.equal(ohtaniWeakLabel.player, "Shohei Ohtani");
assert.equal(ohtaniWeakLabel.serial_number, "");
assert.equal(ohtaniWeakLabel.serial_denominator, "25");

const bgsDualGradeLabel = titleWeakLabelFromTitle("2018-19 Court Kings Trae Young Heir Apparent Sapphire RC Auto #/25 BGS 10/10");
assert.equal(bgsDualGradeLabel.player, "Trae Young");
assert.equal(bgsDualGradeLabel.serial_number, "");
assert.equal(bgsDualGradeLabel.serial_denominator, "25");
assert.equal(bgsDualGradeLabel.grade, "10");

const bgsAutoGradeOnlyLabel = titleWeakLabelFromTitle("2018-19 Prizm Trae Young Rookie Prizms Silver Auto RC #RS-TYG Hawks BGS 9/10");
assert.equal(bgsAutoGradeOnlyLabel.player, "Trae Young");
assert.equal(bgsAutoGradeOnlyLabel.serial_number, "");
assert.equal(bgsAutoGradeOnlyLabel.serial_denominator, "");
assert.equal(bgsAutoGradeOnlyLabel.grade, "9");

const scored = comparePredictionToTitle({
  case_id: "case-1",
  recognition_status: "CONFIRMED",
  recognition_output: {
    player: "Test Player",
    players: ["Test Player"],
    year: "2025",
    brand: "Topps",
    set: "Topps Chrome",
    card_number: "",
    parallel: "Gold",
    rookie: false,
    autograph: false,
    relic: false,
    serial_number: "12/50",
    grade_company: "PSA",
    grade: "10"
  }
}, {
  case_id: "case-1",
  title: "2025 Topps Chrome Test Player Gold 12/50 PSA 10",
  item_id: "item-1",
  item_web_url: "https://www.ebay.com/itm/item-1"
});
assert.equal(scored.field_comparison.year, "MATCH");
assert.equal(scored.field_comparison.card_number, "MISSING_TITLE");
assert.equal(scored.narrow_diagnostic_comparison.core_identity, "MATCH");
assert.equal(scored.narrow_diagnostic_comparison.surface_color, "MATCH");
assert.equal(scored.narrow_diagnostic_comparison.serial_denominator, "MATCH");
assert.equal(scored.overall_status, "PASS");

const currySubject = comparePredictionToTitle({
  case_id: "case-curry",
  recognition_status: "CONFIRMED",
  recognition_output: {
    player: "Stephen Curry",
    players: ["Stephen Curry"],
    year: "2023",
    brand: "Panini",
    set: "Prizm",
    parallel: "Green",
    rookie: false,
    autograph: false,
    relic: false
  }
}, {
  case_id: "case-curry",
  title: "2023-24 Panini Prizm Stephen Curry Prizm Green Shimmer FOTL #/5 Warriors PSA 10",
  item_id: "item-curry",
  item_web_url: "https://www.ebay.com/itm/item-curry"
});
assert.equal(currySubject.field_comparison.player, "MATCH");

const mahomesSubject = comparePredictionToTitle({
  case_id: "case-mahomes",
  recognition_status: "CONFIRMED",
  recognition_output: {
    player: "Patrick Mahomes II",
    players: ["Patrick Mahomes II"],
    year: "2017",
    brand: "Panini",
    set: "Origins",
    rookie: true,
    autograph: true,
    relic: false,
    grade_company: "PSA",
    grade: "9"
  }
}, {
  case_id: "case-mahomes",
  title: "2017 Panini Origins Patrick Mahomes II Rookie Auto Turquoise RC #/10 PSA 9 10",
  item_id: "item-mahomes",
  item_web_url: "https://www.ebay.com/itm/item-mahomes"
});
assert.equal(mahomesSubject.field_comparison.player, "MATCH");

const peleSubject = comparePredictionToTitle({
  case_id: "case-pele",
  recognition_status: "CONFIRMED",
  recognition_output: {
    player: "Pelé",
    players: ["Pelé"],
    year: "2022",
    brand: "Panini",
    set: "Prizm",
    parallel: "Gold",
    rookie: false,
    autograph: true,
    relic: false,
    grade_company: "PSA",
    grade: "9"
  }
}, {
  case_id: "case-pele",
  title: "2022-23 Panini Prizm World Cup Pele Signatures Breakaway Gold Auto #/2 PSA 9",
  item_id: "item-pele",
  item_web_url: "https://www.ebay.com/itm/item-pele"
});
assert.equal(peleSubject.field_comparison.player, "MATCH");

const seasonYear = comparePredictionToTitle({
  case_id: "case-season",
  recognition_status: "CONFIRMED",
  recognition_output: {
    player: "Jalen Brunson",
    players: ["Jalen Brunson"],
    year: "2018",
    brand: "Panini",
    set: "Prizm",
    card_number: "250",
    rookie: true,
    autograph: false,
    relic: false,
    grade_company: "PSA",
    grade: "9"
  }
}, {
  case_id: "case-season",
  title: "2018-19 Panini Prizm Jalen Brunson RC SP Prizm Choice Tiger Stripe #250 PSA 9",
  item_id: "item-season",
  item_web_url: "https://www.ebay.com/itm/item-season"
});
assert.equal(seasonYear.field_comparison.year, "MATCH");
assert.equal(seasonYear.field_comparison.set, "MATCH");
assert.equal(seasonYear.field_comparison.parallel, "MISSING_MODEL");
assert.equal(seasonYear.narrow_diagnostic_comparison.core_identity, "MATCH");
assert.equal(seasonYear.narrow_diagnostic_comparison.surface_color, "UNCERTAIN");

const multiSubject = comparePredictionToTitle({
  case_id: "case-dual",
  recognition_status: "CONFIRMED",
  recognition_output: {
    player: "Ken Griffey Jr. / Mickey Mantle",
    players: ["Ken Griffey Jr.", "Mickey Mantle"],
    year: "1994",
    brand: "Upper Deck",
    set: "Upper Deck All-Time Greats",
    rookie: false,
    autograph: true,
    relic: false,
    grade_company: "BGS",
    grade: "8"
  }
}, {
  case_id: "case-dual",
  title: "1994 Upper Deck Mickey Mantle Ken Griffey Jr Dual Auto BGS Authentic 8 Autograph",
  item_id: "item-dual",
  item_web_url: "https://www.ebay.com/itm/item-dual"
});
assert.equal(multiSubject.field_comparison.player, "MATCH");
assert.equal(multiSubject.field_comparison.set, "UNCERTAIN");
assert.equal(multiSubject.field_comparison.grade, "MATCH");

const uncertain = comparePredictionToTitle({
  case_id: "case-2",
  recognition_status: "CONFIRMED",
  recognition_output: { title: "Mystery output" }
}, {
  case_id: "case-2",
  title: "Mystery Card Lot",
  item_id: "item-2",
  item_web_url: "https://www.ebay.com/itm/item-2"
});
assert.equal(uncertain.field_comparison.player, "MISSING_MODEL");

await withTempDir(async (dir) => {
  const predictionsPath = join(dir, "predictions", "predictions.jsonl");
  const answerKeyPath = join(dir, "sealed_answers", "answer_key.jsonl");
  await writeJsonl(predictionsPath, [{
    case_id: "case-1",
    recognition_status: "CONFIRMED",
    recognition_output: {
      title: "2025 Topps Chrome Test Player Gold 12/50 PSA 10",
      player: "Test Player",
      players: ["Test Player"],
      year: "2025",
      brand: "Topps",
      set: "Topps Chrome",
      parallel: "Gold",
      rookie: false,
      autograph: false,
      relic: false,
      serial_number: "12/50",
      grade_company: "PSA",
      grade: "10"
    },
    timing: {
      total_ms: 1234,
      provider_total_ms: 1000,
      catalog_retrieval_ms: 111,
      vector_retrieval_ms: 22,
      evidence_completion_ms: 333
    },
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
      provider_calls: 1,
      retrieval_calls: 3,
      estimated_cost_usd: 0.001
    },
    c_group_diagnostics: {
      catalog_prompt_assist_used: true,
      vector_prompt_assist_used: true,
      catalog_assist_eligibility: {
        raw_candidate_count: 4,
        approved_candidate_count: 2,
        conflict_blocked_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["catalog-1"],
        field_support_count: 3,
        field_support_fields: ["year", "product"]
      },
      vector_assist_eligibility: {
        raw_candidate_count: 5,
        approved_candidate_count: 1,
        conflict_blocked_count: 2,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["vector-1"],
        field_support_count: 2,
        field_support_fields: ["surface_color"]
      },
      catalog_candidate_debug: [{
        candidate_id: "catalog-1",
        source_trust: "APPROVED_REFERENCE",
        reference_title: "2025 Topps Chrome Test Player Gold",
        matched_fields: ["year", "product"],
        conflicting_fields: [],
        prompt_admitted: true
      }],
      vector_candidate_debug: [{
        candidate_id: "vector-1",
        source_trust: "APPROVED_REFERENCE",
        reference_title: "2025 Topps Chrome Test Player Gold",
        matched_fields: ["surface_color"],
        conflicting_fields: [],
        prompt_admitted: true
      }]
    }
  }]);
  const hash = crypto.createHash("sha256").update(await readFile(predictionsPath)).digest("hex");
  await writeFile(join(dir, "predictions", "predictions.sha256"), `${hash}  predictions.jsonl\n`);
  await writeJsonl(answerKeyPath, [{
    case_id: "case-1",
    seller: "dcsports87",
    item_id: "item-1",
    item_web_url: "https://www.ebay.com/itm/item-1",
    title: "2025 Topps Chrome Test Player Gold 12/50 PSA 10"
  }]);
  const summary = await scoreBlindEval({
    predictionsPath,
    answerKeyPath,
    outputPath: join(dir, "scored_results.jsonl"),
    summaryPath: join(dir, "summary.json")
  });
  assert.equal(summary.prediction_hash_verified, true);
  assert.equal(summary.total, 1);
  assert.equal(summary.overall_counts.PASS, 1);
  assert.equal(summary.narrow_diagnostic_counts.core_identity.MATCH, 1);
  assert.equal(summary.narrow_diagnostic_counts.surface_color.MATCH, 1);
  assert.equal(summary.narrow_diagnostic_counts.serial_denominator.MATCH, 1);
  assert.equal(summary.c_group_diagnostics.usage_totals.input_tokens, 100);
  assert.equal(summary.c_group_diagnostics.usage_totals.output_tokens, 25);
  assert.equal(summary.c_group_diagnostics.per_card_latency_ms.p50, 1234);
  assert.equal(summary.c_group_diagnostics.catalog.prompt_candidate_count, 1);
  assert.equal(summary.c_group_diagnostics.vector.prompt_candidate_count, 1);
  assert.equal(summary.c_group_diagnostics.catalog.prompt_candidate_ids[0], "catalog-1");
  assert.equal(summary.c_group_diagnostics.vector.prompt_candidate_ids[0], "vector-1");
  assert.equal(summary.per_card_decision_trace[0].predicted_title, "2025 Topps Chrome Test Player Gold 12/50 PSA 10");
  assert.equal(summary.per_card_decision_trace[0].catalog_candidate_debug[0].candidate_id, "catalog-1");
});

assert.ok(defaultBlindEvalDir.includes("blind_eval"));
console.log("blind eval tests passed");
