import { createHash } from "node:crypto";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const VISION_URL_MAX_BATCH_SIZE = 500;
export const TEXT_CONTROL_MAX_BATCH_SIZE = 1_000;
const CONTROL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["control"],
  properties: { control: { type: "string", enum: ["ok"] } }
});

function boundedInteger(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function safeNetworkError(error) {
  const cause = error?.cause || {};
  const text = String(cause.message || error?.message || "network_error")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240);
  return {
    name: String(cause.name || error?.name || "Error").slice(0, 80),
    code: String(cause.code || "UNKNOWN").slice(0, 80),
    message: text
  };
}

function safeProviderError(value, fallback) {
  return String(value || fallback)
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240);
}

function visionInputError(code) {
  return Object.assign(new Error(code), { statusCode: 400 });
}

async function mapConcurrent(items, concurrency, mapper) {
  let cursor = 0;
  const results = new Array(items.length);
  const workers = Array.from(
    { length: Math.min(items.length, Math.max(1, concurrency)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function controlRequest({ model, effort, index, imageUrls = [], requestTemplate = null }) {
  if (requestTemplate) {
    return {
      ...requestTemplate,
      input: [{
        role: "user",
        content: [
          ...requestTemplate.input[0].content,
          ...imageUrls.map((imageUrl) => ({
            type: "input_image",
            image_url: imageUrl,
            detail: "high"
          }))
        ]
      }]
    };
  }
  return {
    model,
    reasoning: { effort },
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: imageUrls.length
            ? `Vision URL capacity control ${index}. Use the attached image input and return the required JSON value.`
            : `Network capacity control ${index}. Return the required JSON value.`
        },
        ...imageUrls.map((imageUrl) => ({
          type: "input_image",
          image_url: imageUrl,
          detail: "high"
        }))
      ]
    }],
    text: {
      format: {
        type: "json_schema",
        name: "hosted_capacity_control",
        strict: true,
        schema: CONTROL_SCHEMA
      }
    }
  };
}

function canonicalTemplateError(code) {
  return Object.assign(new Error(code), { statusCode: 400 });
}

function normalizeCanonicalRequestTemplate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw canonicalTemplateError("canonical_request_template_required");
  }
  const prompt = value.input?.[0]?.content?.[0];
  const format = value.text?.format;
  if (value.model !== "gpt-5.6-luna" || value.reasoning?.effort !== "none") {
    throw canonicalTemplateError("canonical_request_template_model_invalid");
  }
  if (!Number.isInteger(value.max_output_tokens)
    || value.max_output_tokens < 1
    || value.max_output_tokens > 4096) {
    throw canonicalTemplateError("canonical_request_template_output_limit_invalid");
  }
  if (!Array.isArray(value.input) || value.input.length !== 1
    || value.input[0]?.role !== "user"
    || !Array.isArray(value.input[0]?.content)
    || value.input[0].content.length !== 1
    || prompt?.type !== "input_text"
    || typeof prompt.text !== "string"
    || !prompt.text.trim()
    || prompt.text.length > 20_000) {
    throw canonicalTemplateError("canonical_request_template_prompt_invalid");
  }
  if (format?.type !== "json_schema"
    || format.name !== "canonical_card_fields"
    || format.strict !== true
    || !format.schema
    || typeof format.schema !== "object"
    || Array.isArray(format.schema)
    || JSON.stringify(format.schema).length > 30_000) {
    throw canonicalTemplateError("canonical_request_template_schema_invalid");
  }
  return {
    model: "gpt-5.6-luna",
    max_output_tokens: value.max_output_tokens,
    reasoning: { effort: "none" },
    text: {
      format: {
        type: "json_schema",
        name: "canonical_card_fields",
        strict: true,
        schema: format.schema
      }
    },
    input: [{ role: "user", content: [{ type: "input_text", text: prompt.text }] }]
  };
}

function templateSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeVisionAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) throw visionInputError("vision_assets_required");
  if (assets.length > VISION_URL_MAX_BATCH_SIZE) throw visionInputError("vision_assets_limit_exceeded");
  return assets.map((asset, index) => {
    const assetId = typeof asset?.asset_id === "string" ? asset.asset_id.trim() : "";
    if (!assetId) throw visionInputError(`vision_asset_id_required_at_${index + 1}`);
    if (!Array.isArray(asset.image_urls) || asset.image_urls.length === 0) {
      throw visionInputError(`vision_image_urls_required_at_${index + 1}`);
    }
    if (asset.image_urls.length > 2) throw visionInputError(`vision_image_urls_limit_exceeded_at_${index + 1}`);
    const imageUrls = asset.image_urls.map((value) => {
      if (typeof value !== "string" || !value.trim()) {
        throw visionInputError(`vision_image_url_invalid_at_${index + 1}`);
      }
      try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== "https:") throw new Error("invalid_protocol");
        return parsed.href;
      } catch {
        throw visionInputError(`vision_image_url_invalid_at_${index + 1}`);
      }
    });
    return { index: index + 1, asset_id: assetId, image_urls: imageUrls };
  });
}

function controlReport({
  rows, wallMs, evidenceScope, imageInput, model, effort, concurrency,
  requestKind = "control", requestTemplateSha256 = null
}) {
  const succeeded = rows.filter((row) => row.ok);
  const latencies = rows.map((row) => row.latency_ms);
  const networkErrors = rows.filter((row) => row.network_error);
  return {
    schema_version: "lynca-hosted-capacity-probe-v1",
    evidence_scope: evidenceScope,
    image_input: imageInput,
    production_recommendation: false,
    model,
    effort,
    request_kind: requestKind,
    request_template_sha256: requestTemplateSha256,
    tasks: rows.length,
    concurrency,
    wall_ms: Math.round(wallMs),
    throughput_per_minute: wallMs > 0 ? Number((succeeded.length * 60_000 / wallMs).toFixed(4)) : null,
    succeeded_count: succeeded.length,
    failed_count: rows.length - succeeded.length,
    failure_rate: Number(((rows.length - succeeded.length) / rows.length).toFixed(6)),
    latency_p50_ms: percentile(latencies, 0.5),
    latency_p95_ms: percentile(latencies, 0.95),
    latency_max_ms: latencies.length ? Math.max(...latencies) : null,
    input_tokens: succeeded.reduce((sum, row) => sum + (Number(row.input_tokens) || 0), 0),
    cached_input_tokens: succeeded.reduce((sum, row) => sum + (Number(row.cached_input_tokens) || 0), 0),
    uncached_input_tokens: succeeded.reduce((sum, row) => (
      sum + Math.max(0, (Number(row.input_tokens) || 0) - (Number(row.cached_input_tokens) || 0))
    ), 0),
    output_tokens: succeeded.reduce((sum, row) => sum + (Number(row.output_tokens) || 0), 0),
    minimum_request_remaining: Math.min(...succeeded.map((row) => Number(row.request_remaining)).filter(Number.isFinite)),
    minimum_token_remaining: Math.min(...succeeded.map((row) => Number(row.token_remaining)).filter(Number.isFinite)),
    network_errors: {
      count: networkErrors.length,
      by_code: Object.fromEntries(Object.entries(networkErrors.reduce((counts, row) => {
        const key = row.network_error.code || "UNKNOWN";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {})).sort())
    },
    rows
  };
}

async function runHostedControl({
  apiKey,
  items,
  concurrency,
  model,
  effort,
  timeoutMs,
  fetchImpl,
  now,
  evidenceScope,
  imageInput,
  requestKind = "control",
  requestTemplate = null,
  redactProviderErrors = false
}) {
  if (!apiKey) throw new Error("openai_api_key_unconfigured");
  const startedAt = now();
  const rows = await mapConcurrent(items, concurrency, async (item) => {
    const requestStartedAt = now();
    const identity = {
      index: item.index,
      ...(item.asset_id ? { asset_id: item.asset_id } : {})
    };
    try {
      const response = await fetchImpl(OPENAI_RESPONSES_URL, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(controlRequest({
          model, effort, index: item.index, imageUrls: item.image_urls, requestTemplate
        }))
      });
      const body = await response.json().catch(() => ({}));
      const fallbackError = response.ok ? null : `provider_http_${response.status}`;
      const providerError = body.error?.message || fallbackError;
      return {
        ...identity,
        ok: response.ok && !body.error,
        status: response.status,
        latency_ms: Math.round(now() - requestStartedAt),
        served_model: body.model || null,
        input_tokens: body.usage?.input_tokens ?? null,
        cached_input_tokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
        output_tokens: body.usage?.output_tokens ?? null,
        request_limit: response.headers.get("x-ratelimit-limit-requests"),
        request_remaining: response.headers.get("x-ratelimit-remaining-requests"),
        token_limit: response.headers.get("x-ratelimit-limit-tokens"),
        token_remaining: response.headers.get("x-ratelimit-remaining-tokens"),
        error: redactProviderErrors && providerError
          ? safeProviderError(providerError, fallbackError)
          : providerError,
        network_error: null
      };
    } catch (error) {
      const networkError = safeNetworkError(error);
      return {
        ...identity,
        ok: false,
        status: null,
        latency_ms: Math.round(now() - requestStartedAt),
        served_model: null,
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        request_limit: null,
        request_remaining: null,
        token_limit: null,
        token_remaining: null,
        error: redactProviderErrors
          ? safeProviderError(error?.name, "network_error")
          : String(error?.name || "network_error").slice(0, 80),
        network_error: redactProviderErrors
          ? Object.fromEntries(Object.entries(networkError).map(([key, value]) => [key, safeProviderError(value, "UNKNOWN")]))
          : networkError
      };
    }
  });
  return controlReport({
    rows,
    wallMs: Math.max(0, now() - startedAt),
    evidenceScope,
    imageInput,
    model,
    effort,
    concurrency,
    requestKind,
    requestTemplateSha256: requestTemplate ? templateSha256(requestTemplate) : null
  });
}

export async function runHostedCanonicalVisionControl({
  apiKey,
  assets,
  requestTemplate,
  concurrency = 2,
  timeoutMs = 120_000,
  fetchImpl = globalThis.fetch,
  now = () => performance.now()
} = {}) {
  const items = normalizeVisionAssets(assets);
  const normalizedTemplate = normalizeCanonicalRequestTemplate(requestTemplate);
  return runHostedControl({
    apiKey,
    items,
    concurrency: boundedInteger(concurrency, 2, { max: VISION_URL_MAX_BATCH_SIZE }),
    model: "gpt-5.6-luna",
    effort: "none",
    timeoutMs: boundedInteger(timeoutMs, 120_000, { min: 1_000, max: 120_000 }),
    fetchImpl,
    now,
    evidenceScope: "VERCEL_TO_OPENAI_CANONICAL_VISION_CAPACITY",
    imageInput: true,
    requestKind: "canonical_card_fields",
    requestTemplate: normalizedTemplate,
    redactProviderErrors: true
  });
}

export async function runHostedTextControl({
  apiKey,
  tasks = 100,
  concurrency = 2,
  model = "gpt-5.6-luna",
  effort = "none",
  timeoutMs = 120_000,
  fetchImpl = globalThis.fetch,
  now = () => performance.now()
} = {}) {
  const effectiveTasks = boundedInteger(tasks, 100, { max: TEXT_CONTROL_MAX_BATCH_SIZE });
  const effectiveConcurrency = boundedInteger(concurrency, 2, { max: TEXT_CONTROL_MAX_BATCH_SIZE });
  const effectiveTimeout = boundedInteger(timeoutMs, 120_000, { min: 1_000, max: 120_000 });
  return runHostedControl({
    apiKey,
    items: Array.from({ length: effectiveTasks }, (_, index) => ({ index: index + 1 })),
    concurrency: effectiveConcurrency,
    model,
    effort,
    timeoutMs: effectiveTimeout,
    fetchImpl,
    now,
    evidenceScope: "VERCEL_TO_OPENAI_TEXT_CONTROL_ONLY",
    imageInput: false
  });
}

export async function runHostedVisionUrlControl({
  apiKey,
  assets,
  concurrency = 2,
  timeoutMs = 120_000,
  fetchImpl = globalThis.fetch,
  now = () => performance.now()
} = {}) {
  const items = normalizeVisionAssets(assets);
  return runHostedControl({
    apiKey,
    items,
    concurrency: boundedInteger(concurrency, 2, { max: VISION_URL_MAX_BATCH_SIZE }),
    model: "gpt-5.6-luna",
    effort: "none",
    timeoutMs: boundedInteger(timeoutMs, 120_000, { min: 1_000, max: 120_000 }),
    fetchImpl,
    now,
    evidenceScope: "VERCEL_TO_OPENAI_VISION_URL_CONTROL",
    imageInput: true,
    redactProviderErrors: true
  });
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(String(req.body || "{}"));
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      probe: "lynca-vercel-capacity-probe",
      region: process.env.VERCEL_REGION || "unknown",
      openai_configured: Boolean(process.env.OPENAI_API_KEY)
    });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  try {
    const body = readBody(req);
    const report = body.mode === "vision_canonical"
      ? await runHostedCanonicalVisionControl({
        apiKey: process.env.OPENAI_API_KEY,
        assets: body.assets,
        requestTemplate: body.request_template,
        concurrency: body.concurrency,
        timeoutMs: body.timeout_ms
      })
      : body.mode === "vision_url"
        ? await runHostedVisionUrlControl({
        apiKey: process.env.OPENAI_API_KEY,
        assets: body.assets,
        concurrency: body.concurrency,
        timeoutMs: body.timeout_ms
      })
        : await runHostedTextControl({
        apiKey: process.env.OPENAI_API_KEY,
        tasks: body.tasks,
        concurrency: body.concurrency,
        model: body.model || "gpt-5.6-luna",
        effort: body.effort || "none",
        timeoutMs: body.timeout_ms
      });
    return res.status(200).json({
      ok: report.failed_count === 0,
      region: process.env.VERCEL_REGION || "unknown",
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
      ...report
    });
  } catch (error) {
    const statusCode = error?.statusCode === 400 ? 400 : 500;
    return res.status(statusCode).json({ ok: false, error: String(error?.message || "probe_failed").slice(0, 160) });
  }
}
