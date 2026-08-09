import { timingSafeEqual } from "node:crypto";

import {
  LUNA_EXPLICIT_CACHE_POLICY,
  normalizeCachePreviewIdentity,
  preflightReceiptSha256,
  sha256,
  validateLunaExplicitCacheScreenRequests
} from "../luna-explicit-cache-wire-contract.mjs";
import {
  assertLunaExplicitCachePreregisteredContract,
  LUNA_EXPLICIT_CACHE_PREREGISTRATION
} from "../luna-explicit-cache-prereg.mjs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
// Three fail-closed sequential calls must fit inside the 300s Preview function.
const DEFAULT_TIMEOUT_MS = 80_000;
const MINIMUM_CACHEABLE_PREFIX_TOKENS = 1024;
const DURABLE_SINGLE_USE_AUTHORITY_AVAILABLE = false;

const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

function equalSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function previewRuntimeIdentity(env) {
  if (env.VERCEL_ENV !== "preview") throw new Error("preview_environment_required");
  if (env.VERCEL_REGION !== "sin1") throw new Error("sin1_runtime_required");
  return normalizeCachePreviewIdentity({
    environment: env.VERCEL_ENV,
    region: env.VERCEL_REGION,
    deployment_id: env.VERCEL_DEPLOYMENT_ID,
    deployment_hostname: env.VERCEL_URL,
    release_git_sha: env.VERCEL_GIT_COMMIT_SHA
  });
}

function requirePreviewRuntime(env) {
  const identity = previewRuntimeIdentity(env);
  if (String(env.LYNCA_CLOUD_SIM_ENABLED || "").trim().toLowerCase() !== "true") {
    throw new Error("cloud_sim_disabled");
  }
  if (!String(env.OPENAI_API_KEY || "").trim()) throw new Error("openai_api_key_unconfigured");
  if (!String(env.LYNCA_CLOUD_SIM_RUN_TOKEN || "").trim()) {
    throw new Error("cloud_sim_run_token_unconfigured");
  }
  return identity;
}

function requireRunToken(req, env) {
  if (!equalSecret(req.headers["x-lynca-cloud-sim-token"], env.LYNCA_CLOUD_SIM_RUN_TOKEN)) {
    throw Object.assign(new Error("cloud_sim_unauthorized"), { statusCode: 401 });
  }
}

function usageInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function servedEffort(body) {
  const direct = typeof body?.reasoning_effort === "string"
    ? body.reasoning_effort.trim().toLowerCase() || null
    : null;
  const nested = typeof body?.reasoning?.effort === "string"
    ? body.reasoning.effort.trim().toLowerCase() || null
    : null;
  if (direct && nested && direct !== nested) return null;
  return direct || nested;
}

function safeTransportError(error) {
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

export function normalizedPromptCachePayload(body, env) {
  if (!plainObject(body)) throw new Error("body_invalid");
  const runtimeIdentity = requirePreviewRuntime(env);
  if (Object.hasOwn(body, "execution_authorized")
      && typeof body.execution_authorized !== "boolean") {
    throw new Error("execution_authorized_must_be_boolean");
  }
  const executionAuthorized = body.execution_authorized === true;
  const plan = validateLunaExplicitCacheScreenRequests(body.run_id, body.steps);
  assertLunaExplicitCachePreregisteredContract(plan.contract);
  const preflightReceipt = preflightReceiptSha256(plan, runtimeIdentity);
  const suppliedPreflight = body.preflight_receipt_sha256 === undefined
    ? null
    : String(body.preflight_receipt_sha256 || "").trim().toLowerCase();
  const suppliedIdentity = body.preview_identity === undefined
    ? null
    : normalizeCachePreviewIdentity(body.preview_identity);
  if (executionAuthorized
      && JSON.stringify(suppliedIdentity) !== JSON.stringify(runtimeIdentity)) {
    throw new Error("paid_execution_preview_identity_mismatch");
  }
  if (executionAuthorized && suppliedPreflight !== preflightReceipt) {
    throw new Error("paid_execution_preflight_receipt_mismatch");
  }
  if (!executionAuthorized && (suppliedPreflight !== null || suppliedIdentity !== null)) {
    throw new Error("preflight_receipt_not_allowed_without_execution");
  }
  return Object.freeze({
    executionAuthorized,
    plan,
    preflightReceipt,
    runtimeIdentity,
    timeoutMs: DEFAULT_TIMEOUT_MS
  });
}

function publicStepContract(step) {
  return {
    id: step.id,
    fixture_id: step.fixture_id,
    gate: step.gate,
    ...step.receipt
  };
}

function baseReport(payload, { durableSingleUseAuthorityAvailable = false } = {}) {
  return {
    schema_version: "lynca-luna-explicit-cache-screen-v1",
    preregistration_id: LUNA_EXPLICIT_CACHE_PREREGISTRATION.id,
    evidence_scope: LUNA_EXPLICIT_CACHE_PREREGISTRATION.evidence_scope,
    production_recommendation: false,
    accuracy_claim_allowed: false,
    promotion_evidence_allowed: false,
    durable_single_use_authority_available: durableSingleUseAuthorityAvailable,
    execution_authorized: payload.executionAuthorized,
    run_id: payload.plan.run_id,
    provider: LUNA_EXPLICIT_CACHE_POLICY.provider,
    model: payload.plan.contract.model,
    reasoning_effort: payload.plan.contract.reasoning_effort,
    image_detail: payload.plan.contract.image_detail,
    max_output_tokens: payload.plan.contract.max_output_tokens,
    cache_policy_id: LUNA_EXPLICIT_CACHE_POLICY.id,
    cache_policy_sha256: payload.plan.contract.cache_policy_sha256,
    cache_key_sha256: payload.plan.cache_key_sha256,
    cache_key_strategy: LUNA_EXPLICIT_CACHE_POLICY.key_strategy,
    cold_cache_pollution_policy: "NONZERO_CACHED_TOKENS_STOP",
    cache_key_in_semantic_identity: false,
    cache_policy_receipt_separate_from_semantic_identity: true,
    production_semantic_contract_preregistered: true,
    semantic_contract_sha256: payload.plan.contract.semantic_contract_sha256,
    stable_prefix_sha256: payload.plan.contract.stable_prefix_sha256,
    preflight_receipt_sha256: payload.preflightReceipt,
    provider_retries: 0,
    retry: false,
    retry_allowed: false,
    latency_is_directional_only: true,
    ...payload.runtimeIdentity,
    steps: payload.plan.steps.map(publicStepContract)
  };
}

function preflightReport(payload) {
  return {
    ok: true,
    state: "PREFLIGHT_READY_NO_PROVIDER_CALL",
    decision: "NOT_EXECUTED",
    provider_calls: 0,
    provider_failures: 0,
    request_failures: 0,
    ...baseReport(payload)
  };
}

function durableAuthorityHoldReport(payload) {
  return {
    ok: false,
    state: "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED",
    decision: "HOLD",
    provider_calls: 0,
    provider_failures: 0,
    request_failures: 0,
    rows: [],
    ...baseReport(payload)
  };
}

function gateReceipt(step, row) {
  if (!row.request_ok) return { passed: false, reason: "provider_request_failed" };
  if (row.cached_tokens === null || row.cache_write_tokens === null) {
    return { passed: false, reason: "cache_usage_receipt_missing" };
  }
  if (step.gate === "cold_write") {
    if (row.cached_tokens !== 0) return { passed: false, reason: "cold_request_was_not_cold" };
    if (row.cache_write_tokens < MINIMUM_CACHEABLE_PREFIX_TOKENS) {
      return { passed: false, reason: "stable_prefix_not_cacheable" };
    }
    return { passed: true, reason: "cold_write_proven" };
  }
  if (row.cache_write_tokens !== 0) {
    return { passed: false, reason: "warm_request_rewrote_cache" };
  }
  if (row.cached_tokens < MINIMUM_CACHEABLE_PREFIX_TOKENS) {
    return {
      passed: false,
      reason: step.gate === "cross_card_read"
        ? "cross_card_cache_read_not_proven"
        : "same_card_cache_read_not_proven"
    };
  }
  return {
    passed: true,
    reason: step.gate === "cross_card_read"
      ? "cross_card_read_proven"
      : "same_card_read_proven"
  };
}

async function invokeProvider(step, { env, fetchImpl, now, timeoutMs }) {
  const startedAt = now();
  const body = JSON.stringify(step.request);
  try {
    const response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body
    });
    const raw = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    const effort = servedEffort(parsed);
    const inputTokens = usageInteger(parsed?.usage?.input_tokens);
    const cachedTokens = usageInteger(parsed?.usage?.input_tokens_details?.cached_tokens);
    const cacheWriteTokens = usageInteger(
      parsed?.usage?.input_tokens_details?.cache_write_tokens
    );
    const outputTokens = usageInteger(parsed?.usage?.output_tokens);
    const servedModel = typeof parsed?.model === "string" ? parsed.model : null;
    const requestOk = response.ok && !parsed?.error
      && parsed?.status === "completed" && !parsed?.incomplete_details
      && servedModel === step.receipt.model
      && (effort === null || effort === step.receipt.reasoning_effort)
      && inputTokens !== null;
    return {
      step_id: step.id,
      fixture_id: step.fixture_id,
      request_ok: requestOk,
      http_status: response.status,
      latency_ms: Math.max(0, Math.round(now() - startedAt)),
      provider_response_id: typeof parsed?.id === "string" ? parsed.id : null,
      provider_response_sha256: sha256(raw),
      provider_status: typeof parsed?.status === "string" ? parsed.status : null,
      incomplete_details: parsed?.incomplete_details || null,
      served_model: servedModel,
      served_effort: effort,
      input_tokens: inputTokens,
      cached_tokens: cachedTokens,
      cache_write_tokens: cacheWriteTokens,
      output_tokens: outputTokens,
      semantic_request_sha256: step.receipt.semantic_request_sha256,
      transport_request_sha256: step.receipt.transport_request_sha256,
      cache_policy_id: step.receipt.cache_policy_id,
      cache_key_sha256: step.receipt.cache_key_sha256,
      network_error: null,
      transport_outcome_ambiguous: false
    };
  } catch (error) {
    return {
      step_id: step.id,
      fixture_id: step.fixture_id,
      request_ok: false,
      http_status: null,
      latency_ms: Math.max(0, Math.round(now() - startedAt)),
      provider_response_id: null,
      provider_response_sha256: null,
      provider_status: null,
      incomplete_details: null,
      served_model: null,
      served_effort: null,
      input_tokens: null,
      cached_tokens: null,
      cache_write_tokens: null,
      output_tokens: null,
      semantic_request_sha256: step.receipt.semantic_request_sha256,
      transport_request_sha256: step.receipt.transport_request_sha256,
      cache_policy_id: step.receipt.cache_policy_id,
      cache_key_sha256: step.receipt.cache_key_sha256,
      network_error: safeTransportError(error),
      transport_outcome_ambiguous: true
    };
  }
}

export async function runLunaExplicitCacheScreen(payload, {
  env,
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
  singleUseAuthority = null
} = {}) {
  if (!payload.executionAuthorized) return preflightReport(payload);
  if (singleUseAuthority?.durable !== true
      || typeof singleUseAuthority.claim !== "function") {
    return durableAuthorityHoldReport(payload);
  }
  const claim = await singleUseAuthority.claim({
    run_id: payload.plan.run_id,
    preflight_receipt_sha256: payload.preflightReceipt,
    preview_identity: payload.runtimeIdentity
  });
  if (claim?.granted !== true) return durableAuthorityHoldReport(payload);
  const rows = [];
  for (const step of payload.plan.steps) {
    const row = await invokeProvider(step, {
      env,
      fetchImpl,
      now,
      timeoutMs: payload.timeoutMs
    });
    if (row.transport_outcome_ambiguous) {
      rows.push({
        ...row,
        gate: { passed: false, reason: "provider_transport_outcome_ambiguous" }
      });
      return {
        ok: false,
        state: "AMBIGUOUS_PROVIDER_OUTCOME",
        decision: "HOLD",
        provider_calls: rows.length,
        provider_calls_known: rows.length,
        provider_failures: 1,
        request_failures: 1,
        cached_tokens: rows.reduce((sum, receipt) => sum + (receipt.cached_tokens || 0), 0),
        cache_write_tokens: rows.reduce(
          (sum, receipt) => sum + (receipt.cache_write_tokens || 0),
          0
        ),
        ...baseReport(payload, { durableSingleUseAuthorityAvailable: true }),
        rows
      };
    }
    const gate = gateReceipt(step, row);
    rows.push({ ...row, gate });
    if (!gate.passed) break;
  }
  const passed = rows.length === payload.plan.steps.length
    && rows.every((row) => row.request_ok && row.gate.passed);
  return {
    ok: passed,
    state: passed ? "PASS_CACHE_TRANSPORT_CANDIDATE" : "STOPPED",
    decision: passed ? "PASS_CANDIDATE_NOT_PRODUCTION" : "STOP",
    provider_calls: rows.length,
    provider_failures: rows.filter((row) => !row.request_ok).length,
    request_failures: rows.filter((row) => !row.request_ok).length,
    cached_tokens: rows.reduce((sum, row) => sum + (row.cached_tokens || 0), 0),
    cache_write_tokens: rows.reduce((sum, row) => sum + (row.cache_write_tokens || 0), 0),
    ...baseReport(payload, { durableSingleUseAuthorityAvailable: true }),
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

export default async function handler(req, res) {
  if (req.method === "GET") {
    let ready = true;
    let reason = null;
    let identity = null;
    try { identity = requirePreviewRuntime(process.env); } catch (error) {
      ready = false;
      reason = String(error?.message || "not_ready");
    }
    return sendJson(res, 200, {
      ok: true,
      ready,
      preflight_ready: ready,
      paid_execution_ready: false,
      reason,
      schema_version: "lynca-luna-explicit-cache-readiness-v1",
      environment: identity?.environment || process.env.VERCEL_ENV || null,
      region: identity?.region || process.env.VERCEL_REGION || null,
      deployment_id: identity?.deployment_id || null,
      deployment_hostname: identity?.deployment_hostname || null,
      release_git_sha: identity?.release_git_sha || null,
      model: LUNA_EXPLICIT_CACHE_POLICY.model,
      cache_policy_id: LUNA_EXPLICIT_CACHE_POLICY.id,
      openai_configured: Boolean(String(process.env.OPENAI_API_KEY || "").trim()),
      run_token_configured: Boolean(String(process.env.LYNCA_CLOUD_SIM_RUN_TOKEN || "").trim()),
      execution_authorized_by_default: false,
      durable_single_use_authority_available: DURABLE_SINGLE_USE_AUTHORITY_AVAILABLE,
      paid_execution_state: "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED",
      production_calls_allowed: false,
      provider_calls: 0
    });
  }
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  try {
    requireRunToken(req, process.env);
    const payload = normalizedPromptCachePayload(readBody(req), process.env);
    const report = await runLunaExplicitCacheScreen(payload, { env: process.env });
    return sendJson(res, 200, report);
  } catch (error) {
    const status = Number(error?.statusCode) === 401 ? 401 : 400;
    return sendJson(res, status, {
      ok: false,
      error: String(error?.message || "prompt_cache_screen_failed").slice(0, 160),
      execution_authorized: false,
      provider_calls: 0
    });
  }
}
