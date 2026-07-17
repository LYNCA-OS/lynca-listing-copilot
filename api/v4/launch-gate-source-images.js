import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { timingSafeStringEqual } from "../../lib/listing-session.mjs";
import { resolveLaunchGateImageSources } from "../../lib/listing/evaluation/launch-gate-image-access.mjs";
import { createListingImageSignedReadUrl } from "../../lib/listing/storage/supabase-image-storage.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { readJsonPayload, requestPayloadErrorStatus, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import {
  publicTenantAuthError,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

export const config = {
  maxDuration: 120
};

function cleanText(value) {
  return String(value || "").trim();
}

function headerValue(req, name) {
  const lower = String(name || "").toLowerCase();
  const headers = req?.headers;
  const value = typeof headers?.get === "function"
    ? headers.get(lower)
    : headers?.[lower] ?? headers?.[name];
  return cleanText(Array.isArray(value) ? value[0] : value);
}

export function launchGateEvalSecretAuthorized(req, env = process.env) {
  const expected = cleanText(env.LAUNCH_GATE_EVAL_SECRET);
  const supplied = headerValue(req, "x-lynca-launch-gate-secret");
  return Boolean(expected && supplied && timingSafeStringEqual(supplied, expected));
}

function requireLaunchGateTenantAccess(req, options) {
  return requireTenantAccess(req, options);
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

export function createLaunchGateSourceImagesHandler({
  requireAccess = requireLaunchGateTenantAccess,
  evalSecretAuthorized = launchGateEvalSecretAuthorized,
  resolveSources = resolveLaunchGateImageSources,
  signImage = createListingImageSignedReadUrl
} = {}) {
  return async function launchGateSourceImagesHandler(req, res) {
    instrumentProductionRequest(req, res, { api: "/api/v4/launch-gate-source-images" });
    if (req.method !== "POST") {
      sendJson(res, 405, withV4Version({ ok: false, error: "method_not_allowed" }));
      return;
    }
    if (!evalSecretAuthorized(req)) {
      let context;
      try {
        context = await requireAccess(req, { permission: TENANT_PERMISSIONS.CONFIGURE_TENANT });
        bindProductionRequestContext(res, context);
      } catch (error) {
        sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
        return;
      }
    }
    if (!enforceApiRateLimit(req, res, {
      scope: "v4_launch_gate_source_images",
      limit: 10,
      windowMs: 60_000,
      message: "Too many launch-gate image requests. Please wait briefly."
    })) return;

    let payload;
    try {
      payload = await readJsonPayload(req, { maxBytes: 32 * 1024 });
    } catch (error) {
      sendJson(res, requestPayloadErrorStatus(error), withV4Version({
        ok: false,
        error: "invalid_request"
      }));
      return;
    }

    let sources;
    try {
      sources = resolveSources(payload.source_feedback_ids);
    } catch (error) {
      const outOfScope = cleanText(error?.message) === "launch_gate_source_not_allowlisted";
      sendJson(res, outOfScope ? 403 : 400, withV4Version({
        ok: false,
        error: cleanText(error?.message) || "launch_gate_source_invalid",
        missing_count: Number(error?.missingCount || 0)
      }));
      return;
    }

    try {
      const jobs = sources.flatMap((source) => source.images.map((image) => ({ source, image })));
      const signed = await mapWithConcurrency(jobs, 12, async ({ source, image }) => ({
        source_feedback_id: source.source_feedback_id,
        evaluation_cohort: source.evaluation_cohort,
        image_id: image.image_id,
        bucket: image.bucket,
        object_path: image.object_path,
        role: image.role,
        content_sha256: image.content_sha256,
        signed_url: await signImage({
          objectPath: image.object_path,
          bucket: image.bucket,
          env: process.env,
          fetchImpl: globalThis.fetch
        })
      }));
      const bySource = new Map(sources.map((source) => [source.source_feedback_id, {
        source_feedback_id: source.source_feedback_id,
        evaluation_cohort: source.evaluation_cohort,
        images: []
      }]));
      signed.forEach((image) => bySource.get(image.source_feedback_id).images.push(image));
      sendJson(res, 200, withV4Version({
        ok: true,
        source_count: sources.length,
        image_count: signed.length,
        expires_in_seconds: 600,
        sources: [...bySource.values()]
      }));
    } catch (error) {
      sendJson(res, 503, withV4Version({
        ok: false,
        retryable: true,
        error: "launch_gate_image_signing_failed",
        message: cleanText(error?.message).slice(0, 240)
      }));
    }
  };
}

export default createLaunchGateSourceImagesHandler();
