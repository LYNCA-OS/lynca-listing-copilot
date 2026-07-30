import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  login,
  runCard,
  runTwoSideVisionSensor,
  signSources,
  twoSideVisionSensorVersion,
  workerBatchEndpoint
} from "./run-two-side-vision-sensor.mjs";

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const source = {
  source_feedback_id: "source-one",
  images: [
    { image_id: "front", role: "front_original", signed_url: "https://images.test/front", content_sha256: "a".repeat(64) },
    { image_id: "back", role: "back_original", signed_url: "https://images.test/back", content_sha256: "b".repeat(64) }
  ]
};

test("login and source signing keep credentials scoped to the in-memory transport step", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/login")) {
      return response(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=header.payload.signature; Path=/" });
    }
    return response(200, { ok: true, sources: [source] });
  };
  const cookie = await login({ baseUrl: "https://listing.test", username: "writer", password: "secret", fetchImpl });
  assert.equal(cookie, "lynca_metaverse_session=header.payload.signature");
  const sources = await signSources({ baseUrl: "https://listing.test", cookie, sourceIds: ["source-one"], fetchImpl });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].images[0].signed_url, "https://images.test/front");
  assert.equal(JSON.stringify(sources).includes("secret"), false);
});

test("one card uses valid Worker crop types, request-id binding and one Google annotate call", async () => {
  let now = 100;
  const fetchImpl = async (url, options) => {
    assert.equal(String(url), "https://worker.test/v1/ocr-fields-batch");
    const payload = JSON.parse(options.body);
    assert.equal(payload.requests.length, 2);
    assert.deepEqual(payload.requests.map((item) => item.crop_type), ["player_name", "product_text"]);
    now = 735;
    return response(200, {
      request_count: 2,
      unique_image_download_count: 2,
      decode_count: 2,
      vision_unit_count: 2,
      vision_http_attempt_count: 1,
      google_annotate_request_count: 1,
      attempted_vision_unit_count: 2,
      confirmed_vision_unit_count: 2,
      billing_unknown: false,
      latency_ms: 600,
      auth_mode: "adc",
      results: [
        { request_id: payload.requests[1].request_id, status: "OK", raw_text: "2025 PRODUCT #12" },
        { request_id: payload.requests[0].request_id, status: "OK", raw_text: "PLAYER ONE" }
      ]
    });
  };
  const result = await runCard({
    source,
    workerUrl: "https://worker.test",
    workerToken: "token",
    includeRawOcr: true,
    fetchImpl,
    clock: () => now
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.sensor_latency_ms, 635);
  assert.equal(result.raw_ocr_included, true);
  assert.equal(result.front_text, "PLAYER ONE");
  assert.equal(result.back_text, "2025 PRODUCT #12");
  assert.equal(result.telemetry.full_title_provider_calls, 0);
  assert.equal(result.telemetry.full_title_provider_proof, "DIRECT_VISION_OCR_WORKER_BATCH_ROUTE");
  assert.equal(result.telemetry.listing_cache_layer_entered, false);
  assert.equal(result.telemetry.google_annotate_requests, 1);
  assert.equal(result.telemetry.vision_units, 2);
  assert.equal(JSON.stringify(result).includes("signed_url"), false);
});

test("the real Python Worker contract accepts both frozen crop types", () => {
  const program = [
    "import json, sys",
    "sys.path.insert(0, 'services/recognition-worker')",
    "from app.contracts import validate_ocr_field_request",
    "payloads = json.load(sys.stdin)",
    "print(json.dumps([validate_ocr_field_request(item) for item in payloads]))"
  ].join("; ");
  const payloads = [
    { request_id: "front", image_url: "https://images.test/front", crop_type: "player_name" },
    { request_id: "back", image_url: "https://images.test/back", crop_type: "product_text" }
  ];
  const result = spawnSync("python3", ["-c", program], {
    cwd: process.cwd(),
    input: JSON.stringify(payloads),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [[], []]);
});

test("the Worker endpoint is fixed to HTTPS and rejects credential-bearing bases", () => {
  assert.equal(workerBatchEndpoint("https://worker.test"), "https://worker.test/v1/ocr-fields-batch");
  assert.throws(() => workerBatchEndpoint("http://worker.test"), /worker_url_must_use_https/);
  assert.throws(
    () => workerBatchEndpoint("https://user:pass@worker.test?token=secret"),
    /worker_url_must_not_contain_credentials_query_or_hash/
  );
});

test("missing a side fails closed without spending a Vision unit", async () => {
  const result = await runCard({
    source: { ...source, images: source.images.slice(0, 1) },
    workerUrl: "https://worker.test",
    workerToken: "token",
    fetchImpl: async () => { throw new Error("must not call"); }
  });
  assert.equal(result.status, "INCOMPLETE");
  assert.deepEqual(result.reason_codes, ["BACK_IMAGE_MISSING"]);
  assert.equal(result.telemetry.cloud_run_requests, 0);
});

test("aggregate artifact redacts transport secrets and defaults to no raw OCR persistence", async () => {
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/api/login")) {
      return response(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=header.payload.signature; Path=/" });
    }
    if (String(url).endsWith("/api/v4/launch-gate-source-images")) {
      return response(200, { ok: true, sources: [source] });
    }
    const payload = JSON.parse(options.body);
    return response(200, {
      request_count: 2,
      unique_image_download_count: 2,
      decode_count: 2,
      vision_unit_count: 2,
      vision_http_attempt_count: 1,
      google_annotate_request_count: 1,
      attempted_vision_unit_count: 2,
      confirmed_vision_unit_count: 2,
      billing_unknown: false,
      latency_ms: 50,
      auth_mode: "adc",
      results: [
        { request_id: payload.requests[0].request_id, status: "NO_TEXT", raw_text: "" },
        { request_id: payload.requests[1].request_id, status: "OK", raw_text: "2025 SECRET OCR" }
      ]
    });
  };
  const report = await runTwoSideVisionSensor({
    sourceIds: ["source-one"],
    baseUrl: "https://listing.test",
    username: "writer",
    password: "secret",
    workerUrl: "https://worker.test",
    workerToken: "token",
    fetchImpl
  });
  assert.equal(report.schema_version, twoSideVisionSensorVersion);
  assert.equal(report.full_title_provider_calls, 0);
  assert.equal(report.execution.cloud_run_request_count, 1);
  assert.equal(report.execution.google_annotate_request_count, 1);
  assert.equal(report.execution.google_annotate_request_unknown_count, 0);
  assert.equal(report.source_id_hashes.includes("source-one"), false);
  assert.match(report.prediction_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.raw_ocr_included, false);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("signed_url"), false);
  assert.equal(serialized.includes("https://images.test"), false);
  assert.equal(serialized.includes("SECRET OCR"), false);
  assert.equal(serialized.includes("writer"), false);
  assert.equal(serialized.includes("token"), false);
});

test("unknown Google call and unit ledgers fail closed after a network error", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/login")) {
      return response(200, { ok: true }, { "set-cookie": "lynca_metaverse_session=header.payload.signature; Path=/" });
    }
    if (String(url).endsWith("/api/v4/launch-gate-source-images")) {
      return response(200, { ok: true, sources: [source] });
    }
    throw new TypeError("signed URL must not leak into the artifact");
  };
  const report = await runTwoSideVisionSensor({
    sourceIds: ["source-one"],
    baseUrl: "https://listing.test",
    username: "writer",
    password: "secret",
    workerUrl: "https://worker.test",
    workerToken: "token",
    fetchImpl
  });
  assert.equal(report.completed_count, 0);
  assert.equal(report.execution.google_annotate_request_count, null);
  assert.equal(report.execution.google_annotate_request_unknown_count, 1);
  assert.equal(report.execution.vision_unit_count, null);
  assert.equal(report.execution.vision_unit_unknown_count, 1);
  assert.equal(JSON.stringify(report).includes("signed URL must not leak"), false);
});
