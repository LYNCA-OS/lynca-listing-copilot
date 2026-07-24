import { waitUntil } from "@vercel/functions";
import { trustedInternalServiceOrigin } from "../v4/jobs/internal-service-origin.mjs";
import { configuredWorkerSecret, workerSecretHeader } from "../v4/jobs/worker-auth.mjs";

function boundedInteger(value, fallback, { min = 1, max = 8 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function deploymentProtectionHeaders(env = process.env) {
  const secret = String(env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

export async function invokeTrustedPreingestionOcrWorker({
  tenantId = "",
  assetId = "",
  bundleId = "",
  limit = 3,
  includeDetail = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12_000
} = {}) {
  const origin = trustedInternalServiceOrigin(env);
  const secret = configuredWorkerSecret(env);
  if (!origin || !secret || typeof fetchImpl !== "function") {
    return {
      invoked: false,
      ok: false,
      error: !origin ? "trusted_internal_origin_missing" : !secret ? "worker_secret_missing" : "fetch_missing"
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedInteger(timeoutMs, 12_000, { min: 1_000, max: 60_000 }));
  try {
    const response = await fetchImpl(`${origin}/api/v4/listing-preingest-worker`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [workerSecretHeader]: secret,
        ...deploymentProtectionHeaders(env),
        "user-agent": "lynca-preingestion-ocr-wake",
        "x-forwarded-for": "preingestion-ocr-wake"
      },
      body: JSON.stringify({
        tenant_id: String(tenantId || "").trim(),
        // Keep explicit detail work bound to the current immutable asset
        // generation. A tenant-wide sweep can spend the whole wake budget on
        // unrelated historical backlog and starve the writer's current card.
        asset_id: String(assetId || "").trim(),
        bundle_id: String(bundleId || "").trim(),
        limit: boundedInteger(limit, includeDetail ? 8 : 3),
        anchor_only: includeDetail !== true,
        include_detail: includeDetail === true
      }),
      signal: controller.signal
    });
    return {
      invoked: true,
      ok: response?.ok === true,
      status: response?.status ?? null,
      error: response?.ok === true ? null : `ocr_wake_http_${response?.status ?? "unknown"}`
    };
  } catch (error) {
    return {
      invoked: true,
      ok: false,
      status: null,
      error: error?.name === "AbortError" ? "ocr_wake_timeout" : String(error?.message || "ocr_wake_failed")
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function scheduleTrustedPreingestionOcrWake(options = {}) {
  const completion = invokeTrustedPreingestionOcrWorker(options).then((diagnostic) => {
    const method = diagnostic.ok ? "log" : "warn";
    options.logger?.[method]?.("[preingestion_ocr_wake]", JSON.stringify(diagnostic));
    return diagnostic;
  });
  try {
    (options.defer || waitUntil)(completion);
  } catch {
    completion.catch(() => {});
  }
  return { triggered: true, completion };
}
