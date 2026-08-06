// The model, with nothing of ours in front of it.
//
// Every score this project has is a score for the whole pipeline: preingestion,
// OCR, retrieval, the catalog, the constraint enumerator, the normalizers, a
// 900-token output schema, and a model somewhere in the middle. When that
// number stops moving -- as it has, with six reasoning efforts landing inside
// 1.5pp of each other -- the pipeline cannot tell you whether the ceiling is
// the model or itself. Nothing downstream of the provider call can, because
// they all share the same upstream.
//
// So this route answers one question and refuses to do anything else: given the
// same images and the same scoring, what does the model produce on its own?
//
//   below the bare number  -> our pipeline is destroying signal the model had
//   at the bare number     -> the pipeline is neutral; the model is the ceiling
//   above the bare number  -> the pipeline earns its keep, and the ceiling is
//                             the model plus whatever we add
//
// It is deliberately not a recognition path. It reads nothing, writes nothing,
// caches nothing, and is gated behind the same launch-gate secret as the other
// algorithm controls -- a route that calls a paid provider on request must not
// be reachable by anyone who happens to find the URL.

import { listingEvaluationRequestAuthorization } from "./listing-job-enqueue.js";
import { requireTenantAccess } from "../../lib/tenant/index.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import {
  allowedProviderModels,
  defaultProviderModels,
  visionProviderIds
} from "../../lib/listing/providers/provider-contract.mjs";
import {
  openAiResponsesModelControls
} from "../../lib/listing/providers/openai-responses-request.mjs";

const provider = visionProviderIds.OPENAI_LEGACY;

// One instruction, no schema, no field list, no evidence contract.
//
// The point is to measure the model rather than our prompt engineering, so this
// says what a person would say and stops. Adding structure here would make the
// comparison meaningless in the direction that flatters us: a bare call that
// underperforms because it was asked badly proves nothing about the pipeline.
const barePrompt = "Write the eBay listing title for this sports trading card. "
  + "Reply with the title only -- no explanation, no quotes, no label.";

function cleanText(value) {
  return String(value ?? "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  let context;
  try {
    context = await requireTenantAccess(req);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), { ok: false, message: "Authentication failed." });
    return;
  }

  // Same gate as the other algorithm controls. This route picks a model and an
  // effort per request and spends provider money doing it, which is exactly the
  // authority that gate exists to hold.
  const authorization = listingEvaluationRequestAuthorization(req, context, process.env);
  if (!authorization.authorized) {
    sendJson(res, 403, { ok: false, message: "Not authorized for evaluation controls." });
    return;
  }

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, message: "Invalid JSON payload." });
    return;
  }

  const imageUrls = (Array.isArray(payload?.image_urls) ? payload.image_urls : [])
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 2);
  if (!imageUrls.length) {
    sendJson(res, 400, { ok: false, message: "image_urls is required." });
    return;
  }

  const model = cleanText(payload?.model) || defaultProviderModels[provider];
  if (!(allowedProviderModels[provider] || []).includes(model)) {
    sendJson(res, 400, { ok: false, message: "Model is not in the provider whitelist.", model });
    return;
  }

  const apiKey = cleanText(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_1);
  if (!apiKey) {
    sendJson(res, 503, { ok: false, message: "OPENAI_API_KEY is not configured." });
    return;
  }

  const controls = openAiResponsesModelControls(model, {
    env: process.env,
    effortOverride: cleanText(payload?.reasoning_effort)
  });
  const imageDetail = ["low", "high", "auto"].includes(cleanText(payload?.image_detail).toLowerCase())
    ? cleanText(payload.image_detail).toLowerCase()
    : "high";

  const startedAt = Date.now();
  let response;
  let body;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_output_tokens: Number(payload?.max_output_tokens) || 4096,
        ...controls,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: cleanText(payload?.prompt) || barePrompt },
            ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: imageDetail }))
          ]
        }]
      })
    });
    body = await response.json();
  } catch (error) {
    sendJson(res, 502, { ok: false, message: `Provider request failed: ${error?.message || error}` });
    return;
  }
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    sendJson(res, 502, {
      ok: false,
      message: "Provider rejected the request.",
      model,
      // Passed through rather than summarised: the two failures that cost the
      // most time today were both legible in this string and invisible
      // everywhere else.
      provider_error: body?.error || null,
      reasoning_effort: controls.reasoning?.effort ?? null
    });
    return;
  }

  const title = cleanText(
    body?.output_text
    ?? (Array.isArray(body?.output)
      ? body.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .map((part) => part?.text)
        .filter(Boolean)
        .join(" ")
      : "")
  );

  sendJson(res, 200, {
    ok: true,
    title,
    model,
    // What was sent after clamping, not what was asked for.
    reasoning_effort: controls.reasoning?.effort ?? null,
    image_detail: imageDetail,
    latency_ms: latencyMs,
    input_tokens: body?.usage?.input_tokens ?? null,
    output_tokens: body?.usage?.output_tokens ?? null,
    reasoning_tokens: body?.usage?.output_tokens_details?.reasoning_tokens ?? null,
    finish_reason: body?.status || null
  });
}
