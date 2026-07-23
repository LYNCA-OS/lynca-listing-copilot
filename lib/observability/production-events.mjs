import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { writeV4Row, writeV4Rows } from "../listing/v4/session/supabase-rest.mjs";

const safeToken = /^[a-zA-Z0-9._:-]{1,160}$/;
const sensitivePattern = /(?:authorization|bearer|api[_-]?key|secret|password|cookie|signed[_-]?url|data:image|base64|prompt|response[_-]?body)/i;
const productionEventTypes = new Set([
  "upload_started",
  "job_created",
  "recognition_started",
  "provider_called",
  "recognition_completed",
  "recognition_failed",
  "feedback_saved",
  "export_generated"
]);
let operationalWriteCircuitOpenUntil = 0;

function deployedRuntime(env = process.env) {
  return ["production", "preview"].includes(String(env.VERCEL_ENV || "").trim().toLowerCase());
}

function envFlag(env, key, fallback = false) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

function boundedRate(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function stableSample(requestId, rate) {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const bucket = Number.parseInt(
    crypto.createHash("sha256").update(String(requestId || "missing")).digest("hex").slice(0, 8),
    16
  ) / 0xffffffff;
  return bucket < rate;
}

async function persistOperationalWrite(kind, write, options = {}) {
  const env = options.env || process.env;
  const now = typeof options.now === "function" ? options.now() : Date.now();
  if (now < operationalWriteCircuitOpenUntil) {
    return { saved: false, skipped: true, reason: "operational_write_circuit_open", kind };
  }
  const result = await write();
  if (result?.saved) {
    operationalWriteCircuitOpenUntil = 0;
    return result;
  }
  const circuitMs = Math.max(1_000, Math.min(
    120_000,
    Number.parseInt(String(env.PRODUCTION_OBSERVABILITY_CIRCUIT_MS || "30000"), 10) || 30_000
  ));
  operationalWriteCircuitOpenUntil = now + circuitMs;
  return result;
}

function headerValue(req, name) {
  const value = req?.headers?.[String(name).toLowerCase()] ?? req?.headers?.[name];
  return String(Array.isArray(value) ? value[0] || "" : value || "").trim();
}

function safeIdentifier(value, fallback = null) {
  const normalized = String(value || "").trim();
  return safeToken.test(normalized) ? normalized : fallback;
}

function safeApiPath(req, explicitApi = "") {
  if (explicitApi) return String(explicitApi).split("?")[0].slice(0, 240);
  try {
    return new URL(req?.url || "/", "https://local.invalid").pathname.slice(0, 240);
  } catch {
    return "/";
  }
}

function boundedNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizedMetadata(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) => {
    const normalizedKey = String(key).slice(0, 80);
    if (!normalizedKey || sensitivePattern.test(normalizedKey)) return [];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return [[normalizedKey, sanitizedMetadata(nested, depth + 1)]];
    }
    if (typeof nested === "boolean" || typeof nested === "number" || nested === null) {
      return [[normalizedKey, nested]];
    }
    if (typeof nested === "string" && !sensitivePattern.test(nested)) {
      return [[normalizedKey, nested.slice(0, 240)]];
    }
    return [];
  }));
}

export function requestIdFromRequest(req) {
  return safeIdentifier(headerValue(req, "x-request-id")) || crypto.randomUUID();
}

export function attachRequestId(res, requestId) {
  const normalized = safeIdentifier(requestId) || crypto.randomUUID();
  res?.setHeader?.("x-request-id", normalized);
  return normalized;
}

export function sanitizeOperationalText(value, maxLength = 500) {
  const source = String(value || "");
  if (/data:image|;base64,/i.test(source)) return "[redacted sensitive payload]";
  return source
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted url]")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|pk|sb_secret|sb_publishable)_[a-z0-9_-]{6,}\b/gi, "[redacted credential]")
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, "[redacted jwt]")
    .replace(
      /((?:authorization|api[_-]?key|secret|password|cookie|token|signature|signed[_-]?url)\s*[:=]\s*)[^\s,;"']+/gi,
      "$1[redacted]"
    )
    .slice(0, Math.max(0, Number(maxLength) || 500));
}

export function sanitizeOperationalStack(error) {
  return String(error?.stack || "")
    .split("\n")
    .slice(0, 12)
    .map((line) => {
      const sanitized = sanitizeOperationalText(line, 500);
      return sensitivePattern.test(line) && sanitized === line.slice(0, 500)
        ? "[redacted sensitive stack line]"
        : sanitized;
    })
    .join("\n")
    .slice(0, 4000);
}

export function operationalErrorFingerprint(error, errorType = "") {
  const type = safeIdentifier(errorType || error?.code || error?.name, "UNKNOWN_ERROR");
  const safeFrames = sanitizeOperationalStack(error)
    .split("\n")
    .map((line) => line.replace(/:\d+:\d+/g, ":#: #"))
    .join("\n");
  return crypto.createHash("sha256").update(`${type}\n${safeFrames}`).digest("hex").slice(0, 24);
}

export function buildRequestLogRow({
  requestId,
  context = {},
  req = {},
  api = "",
  statusCode,
  durationMs,
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedRequestId = safeIdentifier(requestId) || crypto.randomUUID();
  return {
    request_id: normalizedRequestId,
    tenant_id: safeIdentifier(context.tenantId || context.tenant_id),
    user_id: safeIdentifier(context.userId || context.user_id),
    method: safeIdentifier(req.method, "UNKNOWN"),
    api: safeApiPath(req, api),
    status_code: boundedNumber(statusCode, 0),
    duration_ms: Math.max(0, boundedNumber(durationMs, 0)),
    metadata: {
      ...(safeIdentifier(context.role) ? { role: safeIdentifier(context.role) } : {}),
      ...(safeIdentifier(context.actorType || context.actor_type) ? { actor_type: safeIdentifier(context.actorType || context.actor_type) } : {})
    },
    timestamp: createdAt
  };
}

export function buildProductionEventRow({
  eventType,
  requestId,
  context = {},
  batchId = null,
  jobId = null,
  sessionId = null,
  durationMs = null,
  modelVersion = null,
  promptVersion = null,
  route = null,
  success = null,
  providerCalls = null,
  inputTokens = null,
  outputTokens = null,
  estimatedCostUsd = null,
  metadata = {},
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedEventType = String(eventType || "").trim().toLowerCase();
  if (!productionEventTypes.has(normalizedEventType)) {
    throw new TypeError(`unsupported production event type: ${normalizedEventType || "missing"}`);
  }
  const tenantId = safeIdentifier(context.tenantId || context.tenant_id);
  if (!tenantId) throw new TypeError("production event tenant_id is required");
  return {
    request_id: safeIdentifier(requestId || context.requestId || context.request_id),
    tenant_id: tenantId,
    user_id: safeIdentifier(context.userId || context.user_id),
    batch_id: safeIdentifier(batchId),
    job_id: safeIdentifier(jobId),
    session_id: safeIdentifier(sessionId),
    event_type: normalizedEventType,
    duration_ms: durationMs === null ? null : Math.max(0, boundedNumber(durationMs, 0)),
    model_version: safeIdentifier(modelVersion),
    prompt_version: safeIdentifier(promptVersion),
    route: safeIdentifier(route),
    success: typeof success === "boolean" ? success : null,
    provider_calls: providerCalls === null ? 0 : Math.max(0, boundedNumber(providerCalls, 0)),
    input_tokens: inputTokens === null ? null : Math.max(0, boundedNumber(inputTokens, 0)),
    output_tokens: outputTokens === null ? null : Math.max(0, boundedNumber(outputTokens, 0)),
    estimated_cost_usd: estimatedCostUsd === null ? null : Math.max(0, boundedNumber(estimatedCostUsd, 0)),
    metadata: sanitizedMetadata(metadata),
    created_at: createdAt
  };
}

export function buildErrorLogRow({
  error,
  errorType = "",
  recoverable = false,
  requestId,
  context = {},
  sessionId = null,
  jobId = null,
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedType = safeIdentifier(errorType || error?.code || error?.name, "UNKNOWN_ERROR");
  return {
    request_id: safeIdentifier(requestId),
    tenant_id: safeIdentifier(context.tenantId || context.tenant_id),
    user_id: safeIdentifier(context.userId || context.user_id),
    session_id: safeIdentifier(sessionId),
    job_id: safeIdentifier(jobId),
    error_type: normalizedType,
    message: sanitizeOperationalText(error?.message || normalizedType, 500),
    stack: sanitizeOperationalStack(error),
    recoverable: recoverable === true,
    metadata: { error_fingerprint: operationalErrorFingerprint(error, normalizedType) },
    created_at: createdAt
  };
}

export async function persistRequestLog(input = {}, options = {}) {
  const env = options.env || process.env;
  const row = buildRequestLogRow(input);
  const successRate = deployedRuntime(env)
    ? boundedRate(env.PRODUCTION_REQUEST_LOG_SUCCESS_SAMPLE_RATE, 0.1)
    : 1;
  if (row.status_code < 400 && !stableSample(row.request_id, successRate)) {
    return { saved: false, skipped: true, reason: "request_log_success_sampled_out" };
  }
  return persistOperationalWrite("request_log", () => writeV4Row({
    table: "request_logs",
    row,
    upsert: true,
    onConflict: "tenant_id,request_id",
    duplicateResolution: "ignore",
    returnRepresentation: false,
    env,
    fetchImpl: options.fetchImpl || globalThis.fetch
  }), options);
}

export async function persistErrorLog(input = {}, options = {}) {
  return persistOperationalWrite("error_log", () => writeV4Row({
    table: "error_logs",
    row: buildErrorLogRow(input),
    upsert: false,
    returnRepresentation: false,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || globalThis.fetch
  }), options);
}

export async function persistProductionEvent(input = {}, options = {}) {
  return persistOperationalWrite("production_event", () => writeV4Row({
    table: "production_events",
    row: buildProductionEventRow(input),
    upsert: false,
    returnRepresentation: false,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || globalThis.fetch
  }), options);
}

export async function persistProductionEvents(inputs = [], options = {}) {
  const rows = (Array.isArray(inputs) ? inputs : []).map((input) => buildProductionEventRow(input));
  return persistOperationalWrite("production_events", () => writeV4Rows({
    table: "production_events",
    rows,
    upsert: false,
    returnRepresentation: false,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || globalThis.fetch
  }), options);
}

export function createRequestTelemetry(req, res, { api = "", now = () => Date.now() } = {}) {
  const requestId = attachRequestId(res, requestIdFromRequest(req));
  const startedAt = now();
  let context = {};
  let finished = false;

  const telemetry = {
    requestId,
    bindContext(nextContext = {}) {
      context = { ...context, ...nextContext, requestId };
      return context;
    },
    async finish({ statusCode = res?.statusCode || 200, env, fetchImpl } = {}) {
      if (finished) return { saved: false, skipped: true, reason: "request_log_already_finished" };
      finished = true;
      return persistRequestLog({
        requestId,
        context,
        req,
        api,
        statusCode,
        durationMs: Math.max(0, now() - startedAt)
      }, { env, fetchImpl });
    },
    async fail(error, { statusCode = res?.statusCode || 500, recoverable = false, errorType = "", sessionId, jobId, env, fetchImpl } = {}) {
      const effectiveEnv = env || process.env;
      const pairRequestLog = !deployedRuntime(effectiveEnv)
        || envFlag(effectiveEnv, "PRODUCTION_ERROR_REQUEST_LOG_ENABLED", false);
      let requestLogPromise;
      if (pairRequestLog) {
        requestLogPromise = telemetry.finish({ statusCode, env: effectiveEnv, fetchImpl });
      } else {
        finished = true;
        requestLogPromise = Promise.resolve({
          saved: false,
          skipped: true,
          reason: "error_log_is_authoritative"
        });
      }
      const [requestLog, errorLog] = await Promise.all([
        requestLogPromise,
        persistErrorLog(
          { error, errorType, recoverable, requestId, context, sessionId, jobId },
          { env: effectiveEnv, fetchImpl }
        )
      ]);
      return { request_log: requestLog, error_log: errorLog };
    }
  };
  return telemetry;
}

export function instrumentProductionRequest(req, res, { api = "" } = {}) {
  const telemetry = createRequestTelemetry(req, res, { api });
  if (req?.headers && typeof req.headers === "object" && typeof req.headers.get !== "function") {
    req.headers["x-request-id"] = telemetry.requestId;
  }
  res.__lyncaProductionTelemetry = telemetry;
  if (typeof res?.end === "function" && res.__lyncaProductionEndWrapped !== true) {
    const originalEnd = res.end.bind(res);
    res.__lyncaProductionEndWrapped = true;
    res.end = (body, ...args) => {
      let payload = {};
      if (typeof body === "string" && body.length <= 64_000) {
        try {
          payload = JSON.parse(body);
        } catch {
          payload = {};
        }
      }
      finishProductionRequest(res, Number(res.statusCode || 200), payload);
      return originalEnd(body, ...args);
    };
  }
  return telemetry;
}

export function bindProductionRequestContext(res, context = {}) {
  return res?.__lyncaProductionTelemetry?.bindContext(context) || context;
}

export function finishProductionRequest(res, statusCode, payload = {}) {
  const telemetry = res?.__lyncaProductionTelemetry;
  if (!telemetry) return null;
  const task = statusCode >= 500
    ? telemetry.fail(Object.assign(
      new Error(String(payload?.message || payload?.error || "request_failed").slice(0, 240)),
      { code: payload?.error_code || payload?.error_type || "REQUEST_FAILED" }
    ), {
      statusCode,
      recoverable: payload?.retryable === true,
      errorType: payload?.error_code || payload?.error_type || "REQUEST_FAILED",
      sessionId: payload?.recognition_session_id || null,
      jobId: payload?.job_id || payload?.job?.job_id || null
    })
    : telemetry.finish({ statusCode });
  try {
    waitUntil(task);
  } catch {
    // Unit tests and non-Vercel runtimes do not expose a request-scoped
    // waitUntil context. The write still runs best-effort in those runtimes.
    task.catch?.(() => {});
  }
  return task;
}
