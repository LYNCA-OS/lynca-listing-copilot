#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const twoSideVisionSensorVersion = "two-side-vision-sensor-v2";

function cleanText(value) {
  return String(value ?? "").trim();
}

function int(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function quantile(values, probability) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * probability) - 1));
  return sorted[index];
}

function cookieFromResponse(response) {
  return cleanText(response.headers.get("set-cookie")).split(";", 1)[0];
}

function sideForRole(role = "") {
  const normalized = cleanText(role).toLowerCase();
  if (normalized.includes("front") || normalized === "image_1_original") return "front";
  if (normalized.includes("back") || normalized === "image_2_original") return "back";
  return "";
}

function sensorImage(image = {}) {
  return {
    image_id: cleanText(image.image_id) || null,
    role: cleanText(image.role) || null,
    content_sha256: cleanText(image.content_sha256) || null,
    signed_url: cleanText(image.signed_url)
  };
}

async function jsonResponse(response, code) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${code}:non_json:${response.status}`);
  }
  // Upstream error bodies can contain signed URLs or provider details. The
  // evaluation artifact needs a stable reason code, not the raw response.
  if (!response.ok) throw new Error(`${code}:http_${response.status}`);
  return payload;
}

function errorKind(error) {
  const name = cleanText(error?.name).replace(/[^A-Za-z0-9_]/g, "_");
  return name || "UNKNOWN";
}

export function workerBatchEndpoint(workerUrl) {
  const url = new URL(cleanText(workerUrl));
  if (url.protocol !== "https:") throw new Error("worker_url_must_use_https");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("worker_url_must_not_contain_credentials_query_or_hash");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/ocr-fields-batch`;
  return url.toString();
}

export async function login({ baseUrl, username, password, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  await jsonResponse(response, "login_failed");
  const cookie = cookieFromResponse(response);
  if (!/^lynca_metaverse_session=[A-Za-z0-9._~-]+$/.test(cookie)) throw new Error("login_cookie_missing");
  return cookie;
}

export async function signSources({ baseUrl, cookie, sourceIds, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/v4/launch-gate-source-images`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ source_feedback_ids: sourceIds })
  });
  const payload = await jsonResponse(response, "source_sign_failed");
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  if (sources.length !== sourceIds.length) throw new Error(`source_sign_count_mismatch:${sources.length}:${sourceIds.length}`);
  return sources;
}

export async function runCard({
  source,
  workerUrl,
  workerToken,
  includeRawOcr = false,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now()
}) {
  const images = (Array.isArray(source.images) ? source.images : []).map(sensorImage);
  const front = images.find((image) => sideForRole(image.role) === "front");
  const back = images.find((image) => sideForRole(image.role) === "back");
  const sourceIdHash = sha256(cleanText(source.source_feedback_id));
  if (!front || !back) {
    return {
      source_id_hash: sourceIdHash,
      status: "INCOMPLETE",
      reason_codes: [!front ? "FRONT_IMAGE_MISSING" : null, !back ? "BACK_IMAGE_MISSING" : null].filter(Boolean),
      sensor_latency_ms: null,
      raw_ocr_included: false,
      telemetry: {
        full_title_provider_calls: 0,
        full_title_provider_proof: "DIRECT_VISION_OCR_WORKER_BATCH_ROUTE",
        listing_cache_layer_entered: false,
        cloud_run_requests: 0,
        google_annotate_requests: 0,
        vision_units: 0
      }
    };
  }

  const frontRequestId = `front-${sourceIdHash.slice(0, 20)}`;
  const backRequestId = `back-${sourceIdHash.slice(0, 20)}`;
  const requests = [
    {
      request_id: frontRequestId,
      image_url: front.signed_url,
      crop_type: "player_name",
      metadata: { image_id: front.image_id, side: "front", source_id_hash: sourceIdHash }
    },
    {
      request_id: backRequestId,
      image_url: back.signed_url,
      crop_type: "product_text",
      metadata: { image_id: back.image_id, side: "back", source_id_hash: sourceIdHash }
    }
  ];
  const batchEndpoint = workerBatchEndpoint(workerUrl);
  const startedAt = clock();
  let response;
  try {
    response = await fetchImpl(batchEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(workerToken ? { authorization: `Bearer ${workerToken}` } : {})
      },
      body: JSON.stringify({ requests })
    });
  } catch (error) {
    return {
      source_id_hash: sourceIdHash,
      status: "UNAVAILABLE",
      reason_codes: [`NETWORK_ERROR:${errorKind(error)}`],
      sensor_latency_ms: Math.max(0, clock() - startedAt),
      raw_ocr_included: false,
      telemetry: {
        full_title_provider_calls: 0,
        full_title_provider_proof: "DIRECT_VISION_OCR_WORKER_BATCH_ROUTE",
        listing_cache_layer_entered: false,
        cloud_run_requests: 1,
        google_annotate_requests: null,
        vision_units: null
      }
    };
  }
  const completedAt = clock();
  let payload;
  try {
    payload = await jsonResponse(response, "vision_batch_failed");
  } catch (error) {
    return {
      source_id_hash: sourceIdHash,
      status: "UNAVAILABLE",
      reason_codes: [cleanText(error?.message || "VISION_BATCH_FAILED")],
      sensor_latency_ms: Math.max(0, completedAt - startedAt),
      raw_ocr_included: false,
      telemetry: {
        full_title_provider_calls: 0,
        full_title_provider_proof: "DIRECT_VISION_OCR_WORKER_BATCH_ROUTE",
        listing_cache_layer_entered: false,
        cloud_run_requests: 1,
        google_annotate_requests: null,
        vision_units: null
      }
    };
  }
  const results = Array.isArray(payload.results) ? payload.results : [];
  const resultsById = new Map();
  let duplicateRequestId = false;
  for (const result of results) {
    const requestId = cleanText(result?.request_id);
    if (!requestId || resultsById.has(requestId)) duplicateRequestId = true;
    else resultsById.set(requestId, result);
  }
  const frontResult = resultsById.get(frontRequestId) || {};
  const backResult = resultsById.get(backRequestId) || {};
  const proofReasons = [];
  if (Number(payload.request_count) !== 2) proofReasons.push("REQUEST_COUNT_NOT_TWO");
  if (Number(payload.unique_image_download_count) !== 2) proofReasons.push("UNIQUE_IMAGE_DOWNLOAD_COUNT_NOT_TWO");
  if (Number(payload.decode_count) !== 2) proofReasons.push("DECODE_COUNT_NOT_TWO");
  if (Number(payload.vision_unit_count) !== 2) proofReasons.push("VISION_UNIT_COUNT_NOT_TWO");
  if (Number(payload.vision_http_attempt_count) !== 1) proofReasons.push("VISION_HTTP_ATTEMPT_COUNT_NOT_ONE");
  if (Number(payload.google_annotate_request_count) !== 1) proofReasons.push("GOOGLE_ANNOTATE_REQUEST_COUNT_NOT_ONE");
  if (Number(payload.attempted_vision_unit_count) !== 2) proofReasons.push("ATTEMPTED_VISION_UNIT_COUNT_NOT_TWO");
  if (Number(payload.confirmed_vision_unit_count) !== 2) proofReasons.push("CONFIRMED_VISION_UNIT_COUNT_NOT_TWO");
  if (payload.billing_unknown !== false) proofReasons.push("VISION_BILLING_STATE_UNPROVEN");
  if (results.length !== 2) proofReasons.push("RESULT_COUNT_NOT_TWO");
  if (duplicateRequestId) proofReasons.push("RESULT_REQUEST_ID_DUPLICATE_OR_MISSING");
  if (!resultsById.has(frontRequestId)) proofReasons.push("FRONT_RESULT_REQUEST_ID_MISSING");
  if (!resultsById.has(backRequestId)) proofReasons.push("BACK_RESULT_REQUEST_ID_MISSING");
  const resultUnavailable = results.some((result) => !["OK", "NO_TEXT"].includes(cleanText(result.status).toUpperCase()));
  if (resultUnavailable) proofReasons.push("RESULT_UNAVAILABLE");
  return {
    source_id_hash: sourceIdHash,
    status: proofReasons.length ? "INCOMPLETE" : "COMPLETE",
    reason_codes: proofReasons.length ? proofReasons : ["TWO_SIDE_VISION_COMPLETE"],
    sensor_latency_ms: Math.max(0, completedAt - startedAt),
    raw_ocr_included: includeRawOcr,
    ...(includeRawOcr ? {
      front_text: cleanText(frontResult.raw_text),
      back_text: cleanText(backResult.raw_text)
    } : {}),
    telemetry: {
      full_title_provider_calls: 0,
      full_title_provider_proof: "DIRECT_VISION_OCR_WORKER_BATCH_ROUTE",
      listing_cache_layer_entered: false,
      cloud_run_requests: 1,
      google_annotate_requests: numericOrNull(payload.google_annotate_request_count),
      vision_http_attempts: numericOrNull(payload.vision_http_attempt_count),
      vision_units: numericOrNull(payload.vision_unit_count),
      attempted_vision_units: numericOrNull(payload.attempted_vision_unit_count),
      confirmed_vision_units: numericOrNull(payload.confirmed_vision_unit_count),
      billing_unknown: payload.billing_unknown,
      worker_latency_ms: numericOrNull(payload.latency_ms),
      auth_mode: cleanText(payload.auth_mode) || null,
      front_status: cleanText(frontResult.status).toUpperCase() || null,
      back_status: cleanText(backResult.status).toUpperCase() || null
    }
  };
}

function sumKnown(rows, telemetryField) {
  const values = rows.map((row) => row?.telemetry?.[telemetryField]);
  const numericValues = values.map(numericOrNull);
  const unknownCount = numericValues.filter((value) => value === null).length;
  return {
    value: unknownCount === 0
      ? numericValues.reduce((sum, value) => sum + value, 0)
      : null,
    unknown_count: unknownCount
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

export async function runTwoSideVisionSensor({
  sourceIds,
  baseUrl,
  username,
  password,
  workerUrl,
  workerToken,
  concurrency = 2,
  includeRawOcr = false,
  fetchImpl = globalThis.fetch
}) {
  const uniqueSourceIds = [...new Set(sourceIds.map(cleanText).filter(Boolean))];
  const cookie = await login({ baseUrl, username, password, fetchImpl });
  const sources = await signSources({ baseUrl, cookie, sourceIds: uniqueSourceIds, fetchImpl });
  const byId = new Map(sources.map((source) => [cleanText(source.source_feedback_id), source]));
  const startedAt = Date.now();
  const rows = await mapWithConcurrency(uniqueSourceIds, concurrency, async (sourceId) => {
    const source = byId.get(sourceId);
    if (!source) throw new Error(`signed_source_missing:${sha256(sourceId)}`);
    return runCard({ source, workerUrl, workerToken, includeRawOcr, fetchImpl });
  });
  const completedAt = Date.now();
  const complete = rows.filter((row) => row.status === "COMPLETE");
  const googleAnnotateLedger = sumKnown(rows, "google_annotate_requests");
  const visionUnitLedger = sumKnown(rows, "vision_units");
  const artifact = {
    schema_version: twoSideVisionSensorVersion,
    evaluation_mode: "DEVELOPMENT_SENSOR_ONLY",
    production_effect: "NONE",
    title_effect: "NONE",
    full_title_provider_calls: 0,
    full_title_provider_proof: "DIRECT_VISION_OCR_WORKER_BATCH_ROUTE",
    listing_cache_layer_entered: false,
    listing_identity_cache_read: false,
    listing_identity_cache_write: false,
    raw_ocr_included: includeRawOcr,
    source_id_hashes: uniqueSourceIds.map((id) => sha256(id)),
    source_ids_sha256: sha256(uniqueSourceIds),
    row_count: rows.length,
    completed_count: complete.length,
    execution: {
      concurrency,
      wall_ms: completedAt - startedAt,
      cloud_run_request_count: rows.reduce((sum, row) => sum + Number(row.telemetry.cloud_run_requests || 0), 0),
      google_annotate_request_count: googleAnnotateLedger.value,
      google_annotate_request_unknown_count: googleAnnotateLedger.unknown_count,
      vision_unit_count: visionUnitLedger.value,
      vision_unit_unknown_count: visionUnitLedger.unknown_count,
      latency_p50_ms: quantile(complete.map((row) => row.sensor_latency_ms), 0.5),
      latency_p95_ms: quantile(complete.map((row) => row.sensor_latency_ms), 0.95),
      latency_max_ms: quantile(complete.map((row) => row.sensor_latency_ms), 1)
    },
    rows
  };
  return { ...artifact, prediction_sha256: sha256(artifact) };
}

async function main() {
  const argv = process.argv.slice(2);
  const idsPath = path.resolve(arg(argv, "--ids"));
  const outputPath = path.resolve(arg(argv, "--out"));
  const baseUrl = cleanText(arg(argv, "--base-url", process.env.LISTING_BASE_URL || "https://listing.lyncafei.team"));
  const workerUrl = cleanText(arg(argv, "--worker-url", process.env.VISION_OCR_WORKER_URL));
  const username = cleanText(process.env.METAVERSE_USERNAME);
  const password = cleanText(process.env.METAVERSE_PASSWORD);
  const workerToken = cleanText(process.env.RECOGNITION_WORKER_TOKEN);
  const concurrency = int(arg(argv, "--concurrency", "2"), 2);
  const includeRawOcr = argv.includes("--include-raw-ocr");
  if (!cleanText(arg(argv, "--ids")) || !cleanText(arg(argv, "--out"))) {
    throw new Error("usage: --ids <json> --out <json> [--base-url <url>] [--worker-url <url>] [--concurrency 2] [--include-raw-ocr]");
  }
  if (!baseUrl || !workerUrl || !username || !password || !workerToken) {
    throw new Error("METAVERSE_USERNAME, METAVERSE_PASSWORD, RECOGNITION_WORKER_TOKEN and VISION_OCR_WORKER_URL are required");
  }
  const input = JSON.parse(await fs.readFile(idsPath, "utf8"));
  const sourceIds = Array.isArray(input) ? input : input.source_feedback_ids;
  if (!Array.isArray(sourceIds) || !sourceIds.length) throw new Error("source_feedback_ids are required");
  const result = await runTwoSideVisionSensor({
    sourceIds,
    baseUrl,
    username,
    password,
    workerUrl,
    workerToken,
    concurrency,
    includeRawOcr
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    schema_version: result.schema_version,
    row_count: result.row_count,
    completed_count: result.completed_count,
    prediction_sha256: result.prediction_sha256,
    execution: result.execution
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(cleanText(error?.message || error));
    process.exitCode = 1;
  });
}
