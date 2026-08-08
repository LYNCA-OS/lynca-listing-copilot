import { timingSafeEqual } from "node:crypto";

import {
  ARM_REQUEST_SPECS,
  FROZEN_REQUEST_CONTRACTS,
  IMAGE_DETAIL,
  MODEL,
  REASONING_EFFORT as EFFORT,
  requestForAsset,
  requestIdentity,
  sha256
} from "../request-contract.mjs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const FROZEN_STORAGE_HOST = "irpgnhkslrsiucybkufc.supabase.co";
const MAX_BATCH_SIZE = 1;
const MAX_CONCURRENCY = 1;
const DEFAULT_TIMEOUT_MS = 120_000;
const ALLOWED_ARMS = new Set([
  "canonical_high",
  "canonical_residual_v1_high",
  "control_a",
  "control_b",
  "residual_c"
]);

const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clone = (value) => JSON.parse(JSON.stringify(value));

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error("integer_out_of_range");
  return parsed;
}

function percentile(values, fraction) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function safeError(error) {
  const cause = error?.cause || {};
  return {
    name: String(cause.name || error?.name || "Error").slice(0, 80),
    code: String(cause.code || "UNKNOWN").slice(0, 80),
    message: String(cause.message || error?.message || "network_error")
      .replace(/https?:\/\/\S+/gi, "[redacted-url]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .slice(0, 240)
  };
}

function normalizedHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (host !== FROZEN_STORAGE_HOST) {
    throw new Error("allowed_storage_host_invalid");
  }
  return host;
}

function normalizedAssets(value, allowedStorageHost) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH_SIZE) {
    throw new Error("assets_batch_size_invalid");
  }
  const seen = new Set();
  return value.map((asset, assetIndex) => {
    if (!plainObject(asset)
      || Object.keys(asset).sort().join("\0") !== ["asset_id", "image_set_sha256", "image_urls"].sort().join("\0")) {
      throw new Error(`asset_shape_invalid_at_${assetIndex + 1}`);
    }
    const assetId = String(asset?.asset_id || "").trim();
    if (!assetId || assetId.length > 160 || seen.has(assetId)) {
      throw new Error(`asset_id_invalid_at_${assetIndex + 1}`);
    }
    seen.add(assetId);
    const imageSetSha256 = String(asset?.image_set_sha256 || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(imageSetSha256)) {
      throw new Error(`image_set_sha256_invalid_at_${assetIndex + 1}`);
    }
    if (!Array.isArray(asset.image_urls)
        || asset.image_urls.length < 1 || asset.image_urls.length > 2) {
      throw new Error(`image_urls_invalid_at_${assetIndex + 1}`);
    }
    const imageUrls = asset.image_urls.map((raw, imageIndex) => {
      let parsed;
      try {
        parsed = new URL(String(raw || ""));
      } catch {
        throw new Error(`image_url_invalid_at_${assetIndex + 1}_${imageIndex + 1}`);
      }
      if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== allowedStorageHost
          || !parsed.pathname.startsWith("/storage/v1/object/sign/")) {
        throw new Error(`image_url_not_allowed_at_${assetIndex + 1}_${imageIndex + 1}`);
      }
      return parsed.href;
    });
    return { asset_id: assetId, image_set_sha256: imageSetSha256, image_urls: imageUrls };
  });
}

function contractIdentity(value) {
  return requestIdentity(requestForAsset(value, [
    "https://contract.invalid/front",
    "https://contract.invalid/back"
  ]));
}

function normalizedTemplate(value, armId, frozenContracts = FROZEN_REQUEST_CONTRACTS) {
  const armSpec = ARM_REQUEST_SPECS[armId];
  if (!armSpec || !plainObject(value) || value.model !== MODEL || value.reasoning?.effort !== armSpec.effort) {
    throw new Error("request_template_model_invalid");
  }
  if (value.max_output_tokens !== armSpec.max_output_tokens) {
    throw new Error("request_template_output_limit_invalid");
  }
  const input = value.input;
  const content = input?.[0]?.content;
  const prompt = content?.[0];
  if (!Array.isArray(input) || input.length !== 1 || input[0]?.role !== "user"
      || !Array.isArray(content) || content.length !== 1
      || prompt?.type !== "input_text" || typeof prompt.text !== "string"
      || !prompt.text.trim() || prompt.text.length > 24_000) {
    throw new Error("request_template_prompt_invalid");
  }
  const format = value.text?.format;
  if (format?.type !== "json_schema" || format.strict !== true
      || format.name !== armSpec.format_name
      || !plainObject(format.schema) || JSON.stringify(format.schema).length > 36_000) {
    throw new Error("request_template_schema_invalid");
  }
  for (const property of ["residual_evidence", "residual_visible_evidence"]) {
    const present = Object.hasOwn(format.schema.properties || {}, property)
      && (format.schema.required || []).includes(property);
    if (present !== (armSpec.residual_property === property)) {
      throw new Error("request_template_residual_contract_invalid");
    }
  }
  const normalized = clone(value);
  const actual = contractIdentity(normalized);
  const expected = frozenContracts[armId];
  if (!expected
      || actual.normalized_request_sha256 !== expected.normalized_request_sha256
      || actual.normalized_request_bytes !== expected.normalized_request_bytes
      || actual.wire_sha256 !== expected.contract_wire_sha256
      || actual.wire_bytes !== expected.contract_wire_bytes) {
    throw new Error("request_template_not_frozen");
  }
  return normalized;
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function requirePreviewRuntime(env) {
  if (env.VERCEL_ENV !== "preview") throw new Error("preview_environment_required");
  if (env.VERCEL_REGION !== "sin1") throw new Error("sin1_runtime_required");
  if (String(env.LYNCA_CLOUD_SIM_ENABLED || "").trim().toLowerCase() !== "true") {
    throw new Error("cloud_sim_disabled");
  }
  if (!String(env.OPENAI_API_KEY || "").trim()) throw new Error("openai_api_key_unconfigured");
  if (!String(env.LYNCA_CLOUD_SIM_RUN_TOKEN || "").trim()) throw new Error("cloud_sim_run_token_unconfigured");
  return normalizedHost(env.LYNCA_CLOUD_SIM_STORAGE_HOST);
}

function requireRunToken(req, env) {
  if (!equalSecret(req.headers["x-lynca-cloud-sim-token"], env.LYNCA_CLOUD_SIM_RUN_TOKEN)) {
    throw Object.assign(new Error("cloud_sim_unauthorized"), { statusCode: 401 });
  }
}

async function mapConcurrent(items, concurrency, mapper) {
  let cursor = 0;
  const rows = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      rows[index] = await mapper(items[index], index);
    }
  }));
  return rows;
}

function normalizedPayload(body, env, { frozenContracts = FROZEN_REQUEST_CONTRACTS } = {}) {
  const allowedBodyKeys = new Set(["arm_id", "run_id", "request_template", "assets",
    "dry_run", "concurrency", "timeout_ms"]);
  if (!plainObject(body) || Object.keys(body).some((key) => !allowedBodyKeys.has(key))) {
    throw new Error("request_body_shape_invalid");
  }
  const armId = String(body?.arm_id || "").trim();
  if (!ALLOWED_ARMS.has(armId)) throw new Error("arm_id_invalid");
  const runId = String(body?.run_id || "").trim();
  if (!/^[a-zA-Z0-9._-]{8,120}$/.test(runId)) throw new Error("run_id_invalid");
  const allowedStorageHost = requirePreviewRuntime(env);
  const requestTemplate = normalizedTemplate(body.request_template, armId, frozenContracts);
  const assets = normalizedAssets(body.assets, allowedStorageHost);
  return {
    armId,
    runId,
    allowedStorageHost,
    requestTemplate,
    effort: ARM_REQUEST_SPECS[armId].effort,
    maxOutputTokens: ARM_REQUEST_SPECS[armId].max_output_tokens,
    assets,
    dryRun: body.dry_run === true,
    concurrency: boundedInteger(body.concurrency, 1, { max: MAX_CONCURRENCY }),
    timeoutMs: boundedInteger(body.timeout_ms, DEFAULT_TIMEOUT_MS, { min: 1_000, max: DEFAULT_TIMEOUT_MS })
  };
}

function payloadIdentity(payload) {
  const templateBody = JSON.stringify(payload.requestTemplate);
  const assetsIdentity = payload.assets.map((asset) => ({
    asset_id: asset.asset_id,
    image_set_sha256: asset.image_set_sha256,
    image_url_sha256: asset.image_urls.map((url) => sha256(url))
  }));
  const firstRequest = requestIdentity(requestForAsset(
    payload.requestTemplate, payload.assets[0].image_urls
  ));
  const contractRequest = requestIdentity(requestForAsset(payload.requestTemplate, [
    "https://contract.invalid/front",
    "https://contract.invalid/back"
  ]));
  return {
    request_template_sha256: sha256(templateBody),
    request_template_bytes: Buffer.byteLength(templateBody),
    cohort_payload_sha256: sha256(JSON.stringify(assetsIdentity)),
    sample_normalized_request_sha256: firstRequest.normalized_request_sha256,
    sample_normalized_request_bytes: firstRequest.normalized_request_bytes,
    sample_wire_sha256: firstRequest.wire_sha256,
    sample_wire_bytes: firstRequest.wire_bytes,
    contract_normalized_request_sha256: contractRequest.normalized_request_sha256,
    contract_normalized_request_bytes: contractRequest.normalized_request_bytes,
    contract_wire_sha256: contractRequest.wire_sha256,
    contract_wire_bytes: contractRequest.wire_bytes
  };
}

function structuredOutput(parsed, armId) {
  const texts = (Array.isArray(parsed?.output) ? parsed.output : []).flatMap((item) => (
    Array.isArray(item?.content) ? item.content : []
  )).filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text);
  if (texts.length !== 1) return { ok: false, raw: null, parsed: null, error: "output_text_count_invalid" };
  let value;
  try { value = JSON.parse(texts[0]); } catch {
    return { ok: false, raw: texts[0], parsed: null, error: "structured_output_invalid_json" };
  }
  if (!plainObject(value)) {
    return { ok: false, raw: texts[0], parsed: value, error: "structured_output_not_object" };
  }
  const expected = ARM_REQUEST_SPECS[armId]?.residual_property;
  for (const property of ["residual_evidence", "residual_visible_evidence"]) {
    if (Object.hasOwn(value, property) !== (expected === property)) {
      return { ok: false, raw: texts[0], parsed: value, error: "structured_output_arm_mismatch" };
    }
  }
  return { ok: true, raw: texts[0], parsed: value, error: null };
}

function providerServedEffort(parsed) {
  const top = typeof parsed?.reasoning_effort === "string" ? parsed.reasoning_effort : null;
  const nested = typeof parsed?.reasoning?.effort === "string" ? parsed.reasoning.effort : null;
  if (top && nested && top !== nested) return null;
  return top || nested || null;
}

async function runAccuracyArm(payload, { env, fetchImpl = globalThis.fetch, now = () => performance.now() }) {
  const identity = payloadIdentity(payload);
  if (payload.dryRun) {
    return {
      ok: true,
      schema_version: "lynca-cloud-accuracy-arm-v1",
      evidence_scope: "DRY_RUN_NO_PROVIDER_CALL",
      provider_calls: 0,
      provider_retries: 0,
      run_id: payload.runId,
      arm_id: payload.armId,
      model: MODEL,
      reasoning_effort: payload.effort,
      requested_effort: payload.effort,
      image_detail: IMAGE_DETAIL,
      tasks: payload.assets.length,
      concurrency: payload.concurrency,
      storage_host: payload.allowedStorageHost,
      ...identity
    };
  }

  const startedAt = now();
  const rows = await mapConcurrent(payload.assets, payload.concurrency, async (asset, index) => {
    const requestStartedAt = now();
    const request = requestForAsset(payload.requestTemplate, asset.image_urls);
    const requestContract = requestIdentity(request);
    const requestBody = JSON.stringify(request);
    try {
      const response = await fetchImpl(OPENAI_RESPONSES_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(payload.timeoutMs),
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json"
        },
        body: requestBody
      });
      const raw = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      const structured = structuredOutput(parsed, payload.armId);
      const servedEffort = providerServedEffort(parsed);
      const responseOk = response.ok && !parsed?.error
        && parsed?.status === "completed" && !parsed?.incomplete_details
        && parsed?.model === MODEL && servedEffort === payload.effort && structured.ok;
      const completedOffsetMs = Math.round(now() - startedAt);
      return {
        index: index + 1,
        asset_id: asset.asset_id,
        image_set_sha256: asset.image_set_sha256,
        ok: responseOk,
        status: response.status,
        latency_ms: Math.round(now() - requestStartedAt),
        completed_offset_ms: completedOffsetMs,
        normalized_request_sha256: requestContract.normalized_request_sha256,
        normalized_request_bytes: requestContract.normalized_request_bytes,
        request_wire_sha256: requestContract.wire_sha256,
        request_wire_bytes: requestContract.wire_bytes,
        provider_response_raw: raw,
        provider_response_sha256: sha256(raw),
        provider_response_id: parsed?.id || null,
        provider_status: parsed?.status || null,
        incomplete_details: parsed?.incomplete_details || null,
        served_model: parsed?.model || null,
        requested_effort: payload.effort,
        served_effort: servedEffort,
        structured_output: structured.parsed,
        structured_output_raw_sha256: structured.raw === null ? null : sha256(structured.raw),
        structured_output_error: structured.error,
        input_tokens: parsed?.usage?.input_tokens ?? null,
        cached_input_tokens: parsed?.usage?.input_tokens_details?.cached_tokens ?? 0,
        output_tokens: parsed?.usage?.output_tokens ?? null,
        request_limit: response.headers.get("x-ratelimit-limit-requests"),
        request_remaining: response.headers.get("x-ratelimit-remaining-requests"),
        token_limit: response.headers.get("x-ratelimit-limit-tokens"),
        token_remaining: response.headers.get("x-ratelimit-remaining-tokens"),
        network_error: null
      };
    } catch (error) {
      return {
        index: index + 1,
        asset_id: asset.asset_id,
        image_set_sha256: asset.image_set_sha256,
        ok: false,
        status: null,
        latency_ms: Math.round(now() - requestStartedAt),
        completed_offset_ms: Math.round(now() - startedAt),
        normalized_request_sha256: requestContract.normalized_request_sha256,
        normalized_request_bytes: requestContract.normalized_request_bytes,
        request_wire_sha256: requestContract.wire_sha256,
        request_wire_bytes: requestContract.wire_bytes,
        provider_response_raw: null,
        provider_response_sha256: null,
        provider_response_id: null,
        provider_status: null,
        incomplete_details: null,
        served_model: null,
        requested_effort: payload.effort,
        served_effort: null,
        structured_output: null,
        structured_output_raw_sha256: null,
        structured_output_error: "provider_transport_error",
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        request_limit: null,
        request_remaining: null,
        token_limit: null,
        token_remaining: null,
        network_error: safeError(error)
      };
    }
  });
  const wallMs = Math.round(now() - startedAt);
  const succeeded = rows.filter((row) => row.ok);
  const latencies = rows.map((row) => row.latency_ms);
  return {
    ok: succeeded.length === rows.length,
    schema_version: "lynca-cloud-accuracy-arm-v1",
    evidence_scope: "VERCEL_SIN1_TO_OPENAI_CANONICAL_VISION_RAW_CHECKPOINT",
    production_recommendation: false,
    provider_calls: rows.length,
    provider_retries: 0,
    run_id: payload.runId,
    arm_id: payload.armId,
    model: MODEL,
    reasoning_effort: payload.effort,
    requested_effort: payload.effort,
    image_detail: IMAGE_DETAIL,
    storage_host: payload.allowedStorageHost,
    tasks: rows.length,
    concurrency: payload.concurrency,
    wall_ms: wallMs,
    first_title_ms: succeeded.length
      ? Math.min(...succeeded.map((row) => row.completed_offset_ms))
      : null,
    throughput_per_minute: wallMs > 0
      ? Number((succeeded.length * 60_000 / wallMs).toFixed(4))
      : null,
    succeeded_count: succeeded.length,
    failed_count: rows.length - succeeded.length,
    latency_p50_ms: percentile(latencies, 0.50),
    latency_p95_ms: percentile(latencies, 0.95),
    latency_p99_ms: percentile(latencies, 0.99),
    latency_max_ms: latencies.length ? Math.max(...latencies) : null,
    input_tokens: succeeded.reduce((sum, row) => sum + (Number(row.input_tokens) || 0), 0),
    cached_input_tokens: succeeded.reduce((sum, row) => sum + (Number(row.cached_input_tokens) || 0), 0),
    output_tokens: succeeded.reduce((sum, row) => sum + (Number(row.output_tokens) || 0), 0),
    ...identity,
    rows
  };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (plainObject(req.body)) return req.body;
  try { return JSON.parse(String(req.body || "{}")); } catch { return {}; }
}

export { payloadIdentity, requestForAsset, runAccuracyArm, normalizedPayload };

export default async function handler(req, res) {
  if (req.method === "GET") {
    let ready = true;
    let reason = null;
    try { requirePreviewRuntime(process.env); } catch (error) {
      ready = false;
      reason = String(error?.message || "not_ready");
    }
    return sendJson(res, 200, {
      ok: true,
      ready,
      reason,
      schema_version: "lynca-cloud-accuracy-readiness-v2",
      environment: process.env.VERCEL_ENV || null,
      region: process.env.VERCEL_REGION || null,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
      deployment_hostname: process.env.VERCEL_URL || null,
      model: MODEL,
      reasoning_effort: null,
      reasoning_effort_mode: "per_arm",
      image_detail: IMAGE_DETAIL,
      arm_request_specs: ARM_REQUEST_SPECS,
      frozen_request_contracts: FROZEN_REQUEST_CONTRACTS,
      openai_configured: Boolean(String(process.env.OPENAI_API_KEY || "").trim()),
      run_token_configured: Boolean(String(process.env.LYNCA_CLOUD_SIM_RUN_TOKEN || "").trim()),
      storage_host_configured: Boolean(String(process.env.LYNCA_CLOUD_SIM_STORAGE_HOST || "").trim()),
      production_calls_allowed: false,
      cloud_run_calls: 0,
      vector_calls: 0,
      ocr_calls: 0,
      max_batch_size: MAX_BATCH_SIZE,
      max_concurrency: MAX_CONCURRENCY
    });
  }
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  try {
    requireRunToken(req, process.env);
    const payload = normalizedPayload(readBody(req), process.env);
    const report = await runAccuracyArm(payload, { env: process.env });
    return sendJson(res, 200, {
      ...report,
      environment: process.env.VERCEL_ENV || null,
      region: process.env.VERCEL_REGION || null,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
      deployment_hostname: process.env.VERCEL_URL || null
    });
  } catch (error) {
    const status = Number(error?.statusCode) === 401 ? 401 : 400;
    return sendJson(res, status, {
      ok: false,
      error: String(error?.message || "accuracy_probe_failed").slice(0, 160),
      provider_calls: 0
    });
  }
}
