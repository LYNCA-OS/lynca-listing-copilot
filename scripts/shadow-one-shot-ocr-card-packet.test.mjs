#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShadowOneShotOcrCardPacket,
  executeShadowOneShotOcrCardPacket
} from "../lib/listing/evaluation/shadow-one-shot-ocr-card-packet.mjs";
import { preingestionBundleVersion } from "../lib/listing/preingestion/preingestion-bundle.mjs";

const tenantId = "tenant_one_shot";
const assetId = "asset_11111111-1111-4111-8111-111111111111";
const bundleId = "33333333-3333-4333-8333-333333333333";

function image(side, hashCharacter) {
  return {
    image_id: side,
    role: `${side}_original`,
    object_path: `tenants/${tenantId}/listing-assets/2026-07-30/${assetId}/${side}.jpg`,
    content_sha256: hashCharacter.repeat(64)
  };
}

function crop(role, side, region, box) {
  return {
    source_image_id: side,
    source_region: region,
    role,
    crop_region: box,
    crop_metadata: {
      crop_id: `${assetId}__${side}__${region}__field-crop-v1`,
      source_image_id: side,
      source_side: side,
      source_region: region,
      source_object_path: `tenants/${tenantId}/listing-assets/2026-07-30/${assetId}/${side}.jpg`,
      source_content_sha256: (side === "front" ? "a" : "b").repeat(64),
      crop_role: role,
      transform_version: "field-crop-v1",
      pixel_bounds: box
    }
  };
}

function fixtureBundle() {
  return {
    tenant_id: tenantId,
    asset_id: assetId,
    bundle_id: bundleId,
    bundle_version: preingestionBundleVersion,
    images: [image("front", "a"), image("back", "b")],
    derived_images: [],
    crop_plan: [
      crop("subject_crop", "front", "subject_name", { x: 80, y: 620, width: 720, height: 240 }),
      crop("year_product_crop", "back", "year_product", { x: 40, y: 40, width: 820, height: 260 }),
      crop("card_code_crop", "back", "collector_number", { x: 460, y: 1260, width: 380, height: 220 })
    ],
    evidence_patches: []
  };
}

function batchTelemetry(extra = {}) {
  return {
    batch_request_count: 3,
    batch_unique_image_download_count: 2,
    batch_decode_count: 2,
    batch_vision_unit_count: 3,
    batch_vision_http_attempt_count: 1,
    batch_google_annotate_request_count: 1,
    batch_attempted_vision_unit_count: 3,
    batch_confirmed_vision_unit_count: 3,
    batch_billing_unknown: false,
    batch_latency_ms: 870,
    batch_auth_mode: "adc",
    worker_attempt_count: 1,
    ...extra
  };
}

function resultFor(request, field, value, extra = {}) {
  return {
    request_id: request.request_id,
    status: "OK",
    worker_status: "OK",
    confidence: 0.98,
    text_candidates: [{ text: String(value), confidence: 0.98 }],
    evidence_patch: {
      crop_type: request.crop_type,
      raw_text: String(value),
      evidence: { [field]: { value } }
    },
    ...batchTelemetry(),
    ...extra
  };
}

function successfulClient(capture = {}) {
  return {
    configured: true,
    async verifyCrops(requests) {
      capture.calls = Number(capture.calls || 0) + 1;
      capture.requests = requests;
      return requests.map((request) => {
        if (request.crop_type === "subject_crop") return resultFor(request, "players", "Test Player");
        if (request.crop_type === "year_product_crop") return resultFor(request, "product", "Panini Prizm");
        return resultFor(request, "collector_number", "17");
      });
    }
  };
}

function deterministicClock() {
  const values = [0, 20, 900];
  return () => values.shift() ?? 900;
}

test("the packet selects one canonical front subject and two canonical back views", () => {
  const packet = buildShadowOneShotOcrCardPacket({ bundle: fixtureBundle() });
  assert.equal(packet.status, "READY");
  assert.equal(packet.jobs.length, 3);
  assert.deepEqual(packet.jobs.map((entry) => entry.source.crop_role), [
    "subject_crop",
    "year_product_crop",
    "card_code_crop"
  ]);
  assert.deepEqual(packet.source_images.map((entry) => entry.side), ["back", "front"]);
  assert.equal(packet.production_effect, "NONE");
  assert.equal(packet.title_effect, "NONE");
  assert.equal(packet.provider_calls, 0);
  assert.match(packet.bundle_generation_fingerprint, /^[0-9a-f]{64}$/);
  assert.match(packet.detail_revision, /^[0-9a-f]{64}$/);
});

test("missing back views fail closed without signing or OCR", async () => {
  const bundle = fixtureBundle();
  bundle.images = bundle.images.filter((entry) => entry.image_id === "front");
  bundle.crop_plan = bundle.crop_plan.filter((entry) => entry.source_image_id === "front");
  let signed = 0;
  let called = 0;
  const result = await executeShadowOneShotOcrCardPacket({
    bundle,
    client: { verifyCrops: async () => { called += 1; return []; } },
    signedReadUrlFor: async () => { signed += 1; return "https://images.test/front"; }
  });
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.telemetry.cloud_run_request_count, 0);
  assert.equal(signed, 0);
  assert.equal(called, 0);
  assert.ok(result.reason_codes.includes("ROLE_NOT_SCHEDULED:year_product_crop:back"));
  assert.ok(result.reason_codes.includes("ROLE_NOT_SCHEDULED:card_code_crop:back"));
});

test("three crops use one batch call and sign each unique source only once", async () => {
  const capture = {};
  const signedPaths = [];
  const result = await executeShadowOneShotOcrCardPacket({
    bundle: fixtureBundle(),
    client: successfulClient(capture),
    signedReadUrlFor: async (path) => {
      signedPaths.push(path);
      return `https://images.test/${path.endsWith("front.jpg") ? "front" : "back"}`;
    },
    clock: deterministicClock()
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(capture.calls, 1);
  assert.equal(capture.requests.length, 3);
  assert.equal(new Set(capture.requests.map((request) => request.image_url)).size, 2);
  assert.equal(new Set(signedPaths).size, 2);
  assert.equal(result.telemetry.signed_url_request_count, 2);
  assert.equal(result.telemetry.cloud_run_request_count, 1);
  assert.equal(result.telemetry.google_annotate_request_count, 1);
  assert.equal(result.telemetry.vision_http_attempt_count, 1);
  assert.equal(result.telemetry.vision_unit_count, 3);
  assert.equal(result.telemetry.attempted_vision_unit_count, 3);
  assert.equal(result.telemetry.confirmed_vision_unit_count, 3);
  assert.equal(result.telemetry.billing_unknown, false);
  assert.equal(result.telemetry.decode_count, 2);
  assert.deepEqual(result.evidence.map((entry) => entry.state), ["VALUE", "VALUE", "VALUE"]);
  assert.deepEqual(result.evidence_patches.map((patch) => patch.field), [
    "players",
    "product",
    "collector_number"
  ]);
  assert.equal("title" in result, false);
  assert.equal("sem" in result, false);
  assert.equal("resolved_fields" in result, false);
});

test("a field emitted from the wrong crop role is blocked rather than applied", async () => {
  const client = successfulClient();
  const original = client.verifyCrops;
  client.verifyCrops = async (requests) => {
    const results = await original(requests);
    results[2] = resultFor(requests[2], "players", "Wrong Role Player");
    return results;
  };
  const result = await executeShadowOneShotOcrCardPacket({
    bundle: fixtureBundle(),
    client,
    signedReadUrlFor: async (path) => `https://images.test/${path}`
  });
  assert.equal(result.status, "INCOMPLETE");
  assert.ok(result.reason_codes.includes("ROLE_FIELD_LEAK:players:card_code_crop"));
  assert.equal(result.evidence[2].state, "UNKNOWN");
  assert.equal(result.evidence_patches.some((patch) => patch.field === "players" && patch.crop_id === result.evidence[2].crop_id), false);
});

test("missing payload-level telemetry cannot masquerade as one-shot", async () => {
  const client = successfulClient();
  const original = client.verifyCrops;
  client.verifyCrops = async (requests) => (await original(requests)).map((result) => {
    const stripped = { ...result };
    for (const field of Object.keys(batchTelemetry())) delete stripped[field];
    return stripped;
  });
  const result = await executeShadowOneShotOcrCardPacket({
    bundle: fixtureBundle(),
    client,
    signedReadUrlFor: async (path) => `https://images.test/${path}`
  });
  assert.equal(result.status, "MIXED_REVISION_NON_ONE_SHOT");
  assert.ok(result.reason_codes.includes("BATCH_REQUEST_COUNT_UNPROVEN"));
  assert.ok(result.reason_codes.includes("GOOGLE_ANNOTATE_REQUEST_COUNT_UNPROVEN"));
});

test("telemetry missing from only one item cannot masquerade as one-shot", async () => {
  const client = successfulClient();
  const original = client.verifyCrops;
  client.verifyCrops = async (requests) => {
    const results = await original(requests);
    delete results[1].batch_request_count;
    delete results[1].batch_latency_ms;
    delete results[1].batch_auth_mode;
    delete results[1].worker_attempt_count;
    return results;
  };
  const result = await executeShadowOneShotOcrCardPacket({
    bundle: fixtureBundle(),
    client,
    signedReadUrlFor: async (path) => `https://images.test/${path}`
  });
  assert.equal(result.status, "MIXED_REVISION_NON_ONE_SHOT");
  assert.ok(result.reason_codes.includes("BATCH_REQUEST_COUNT_UNPROVEN"));
  assert.ok(result.reason_codes.includes("BATCH_LATENCY_UNPROVEN"));
  assert.ok(result.reason_codes.includes("BATCH_AUTH_MODE_UNPROVEN"));
  assert.ok(result.reason_codes.includes("WORKER_ATTEMPT_COUNT_NOT_ONE"));
});

test("stale crop path and hash fail closed against the canonical bundle image", () => {
  const bundle = fixtureBundle();
  const stale = bundle.crop_plan.find((entry) => entry.role === "year_product_crop");
  stale.crop_metadata.source_object_path = `tenants/${tenantId}/listing-assets/2026-07-29/${assetId}/back.jpg`;
  stale.crop_metadata.source_content_sha256 = "c".repeat(64);
  const packet = buildShadowOneShotOcrCardPacket({ bundle });
  assert.equal(packet.status, "INCOMPLETE");
  assert.ok(packet.reason_codes.includes("SOURCE_PATH_MISMATCH:year_product_crop"));
  assert.ok(packet.reason_codes.includes("SOURCE_HASH_MISMATCH:year_product_crop"));
});

test("stale crop side and image id fail closed against the canonical bundle image", () => {
  const bundle = fixtureBundle();
  const stale = bundle.crop_plan.find((entry) => entry.role === "card_code_crop");
  stale.crop_metadata.source_side = "front";
  stale.crop_metadata.source_image_id = "front";
  const packet = buildShadowOneShotOcrCardPacket({ bundle });
  assert.equal(packet.status, "INCOMPLETE");
  assert.ok(packet.reason_codes.includes("SOURCE_SIDE_MISMATCH:card_code_crop"));
  assert.ok(packet.reason_codes.includes("SOURCE_IMAGE_ID_MISMATCH:card_code_crop"));
});

test("one unavailable field becomes UNKNOWN without a second batch request", async () => {
  const capture = {};
  const client = successfulClient(capture);
  const original = client.verifyCrops;
  client.verifyCrops = async (requests) => {
    const results = await original(requests);
    results[1] = {
      request_id: requests[1].request_id,
      status: "UNAVAILABLE",
      worker_status: "UNAVAILABLE",
      ...batchTelemetry()
    };
    return results;
  };
  const result = await executeShadowOneShotOcrCardPacket({
    bundle: fixtureBundle(),
    client,
    signedReadUrlFor: async (path) => `https://images.test/${path}`
  });
  assert.equal(capture.calls, 1);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.evidence[1].state, "UNKNOWN");
  assert.deepEqual(result.evidence[1].reason_codes, ["NORMALIZATION_OR_WORKER_UNAVAILABLE"]);
  assert.equal(result.evidence[0].state, "VALUE");
  assert.equal(result.evidence[2].state, "VALUE");
});
