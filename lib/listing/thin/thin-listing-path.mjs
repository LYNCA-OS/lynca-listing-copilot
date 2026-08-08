// The thin path: one model call, then deterministic composition. Nothing else.
//
// This replaces the recognition pipeline for title writing, on measurement.
// Same 255 sealed cards, same reference titles, same scorer, paired per card:
//
//   bare model      0.8334   3.1s     26 output tokens
//   thin pipeline   0.743    5.8s    553 output tokens
//   fat pipeline    0.759    9.5s   1247 output tokens
//
//   bare wins 147, pipeline wins 32, ties 76. Sign test p < 0.00001.
//
// The pipeline was not a smaller improvement than hoped. It was negative, and
// widening the sample from 50 to 255 made it more negative. So what remains is
// the model call plus the two things the model provably cannot do for itself:
// foreign-script spam on 16/255 titles, and the eBay 80-character cap, which
// 155/255 titles broke while token recall said nothing.

import { sanitizeListingTitle } from "./sanitize-listing-title.mjs";
import { composeMarketplaceTitle } from "./marketplace-composer-rules.mjs";
import { buildCanonicalFieldsRequest, extractCanonicalPayload, parseCanonicalFields } from "./canonical-fields.mjs";
import { composeFromCanonicalFields } from "./canonical-composer.mjs";
import { buildAccuracyLossLedger } from "./accuracy-loss-ledger.mjs";

export const THIN_TITLE_MAX_LENGTH = 80;

// Asking for the limit is worth more than enforcing it. Blind truncation to 80
// costs 0.97pp (0.8334 -> 0.8237) because it drops whatever happens to be last;
// the model, told the budget up front, drops what matters least instead.
export const THIN_TITLE_PROMPT = "Write the eBay listing title for this sports trading card. "
  + `Use at most ${THIN_TITLE_MAX_LENGTH} characters -- if it will not fit, drop the least valuable detail, not the card's identity. `
  + "Reply with the title only -- no explanation, no quotes, no label.";

export function enforceTitleLengthLimit(title, limit = THIN_TITLE_MAX_LENGTH) {
  const text = String(title ?? "");
  if (text.length <= limit) return { title: text, truncated: false };
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return { title: (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim(), truncated: true };
}

/**
 * Everything between the provider's answer and a listable title, for the string
 * arm. Pure and separately exported so it can be replayed over stored output
 * without spending a call -- which is how every rule in it was measured.
 */
export function finishThinTitle(rawTitle, { limit = THIN_TITLE_MAX_LENGTH, compose = true } = {}) {
  const sanitised = sanitizeListingTitle(rawTitle);
  const composed = compose
    ? composeMarketplaceTitle(sanitised.title, { limit })
    : { ...enforceTitleLengthLimit(sanitised.title, limit), applied: [] };
  return {
    title: composed.title,
    sanitised: sanitised.changed,
    stripped_tail: sanitised.strippedTail,
    truncated: composed.truncated,
    composer_rules: composed.applied,
    raw_length: String(rawTitle ?? "").length,
    length: composed.title.length
  };
}

/**
 * The canonical-fields variant: the model returns a semantic object and the
 * Composer writes the string.
 */
export function finishCanonicalTitle(payload, { limit } = {}) {
  const { fields, defects } = parseCanonicalFields(payload);

  // Cleanup runs per field, not on the composed title. The foreign-script tails
  // attach to whatever the model wrote last; with fields there are a dozen
  // "lasts", and stripping after composition would let a contaminated field
  // consume budget and evict a real bracket before anyone noticed.
  let sanitised = false;
  const cleaned = { ...fields };
  for (const key of ["year", "manufacturer", "product", "set", "card_name", "release_variant",
    "print_finish", "descriptive_rarity", "card_number", "serial", "grade", "team"]) {
    const result = sanitizeListingTitle(cleaned[key]);
    if (result.title !== cleaned[key]) sanitised = true;
    cleaned[key] = result.title;
  }
  if (cleaned.grading_info) {
    cleaned.grading_info = Object.fromEntries(Object.entries(cleaned.grading_info).map(([key, value]) => {
      if (key === "grade_type") return [key, value];
      const result = sanitizeListingTitle(value);
      if (result.title !== value) sanitised = true;
      return [key, result.title];
    }));
  }
  cleaned.subjects = fields.subjects.map((subject) => {
    const result = sanitizeListingTitle(subject);
    if (result.title !== subject) sanitised = true;
    return result.title;
  }).filter(Boolean);

  const composed = composeFromCanonicalFields(cleaned, limit === undefined ? {} : { limit });
  return {
    title: composed.title,
    fields: cleaned,
    field_defects: defects,
    sanitised,
    truncated: composed.truncated,
    grammar: composed.grammar,
    brackets: composed.brackets,
    dropped_brackets: composed.dropped,
    suppressed_brackets: composed.suppressed,
    restored_brackets: composed.restored,
    empty_fields: composed.empty_fields,
    // The two the CSM composition receipt reads directly. They were computed by
    // the Composer but never exposed here, so the receipt recorded `undefined`
    // for both and no reader could tell an empty input from an unrecorded one.
    input_empty_fields: composed.input_empty_fields,
    character_budget: composed.character_budget,
    unreadable_fields: composed.unreadable,
    low_confidence_fields: composed.low_confidence,
    inferred_parent: composed.inferred_parent,
    normalization_reasons: composed.normalization_reasons,
    raw_length: String(payload ?? "").length,
    length: composed.length
  };
}

export function buildThinTitleRequest({ imageUrls = [], model, effort = "none", maxOutputTokens = 4096 }) {
  return {
    model,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: THIN_TITLE_PROMPT },
        ...imageUrls.map((url) => ({ type: "input_image", image_url: url, detail: "high" }))
      ]
    }]
  };
}

export function extractProviderTitle(body = {}) {
  if (body.output_text) return String(body.output_text).trim();
  const parts = Array.isArray(body.output) ? body.output : [];
  return parts
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text).filter(Boolean).join(" ").trim();
}

function providerHeader(response, name) {
  return String(response?.headers?.get?.(name) || "").trim() || null;
}

function canonicalProviderFailure(response, body, {
  providerClientRequestId = null,
  providerMs = null
} = {}) {
  const status = Number(response?.status || 0) || null;
  const providerError = body?.error && typeof body.error === "object" ? body.error : {};
  const error = new Error(
    `canonical_path_provider_failed: ${providerError.message || (status ? `provider_status_${status}` : "invalid_response")}`
  );
  error.name = "CanonicalProviderError";
  error.status = status;
  error.statusCode = status;
  error.response = { status, headers: response?.headers };
  error.provider_attempt_started = true;
  error.provider_request_id = providerHeader(response, "x-request-id");
  error.provider_client_request_id = String(providerClientRequestId || "").trim() || null;
  error.provider_error_code = String(providerError.code || "").trim().slice(0, 160) || null;
  error.provider_error_type = String(providerError.type || "").trim().slice(0, 160) || null;
  error.provider_error_param = String(providerError.param || "").trim().slice(0, 160) || null;
  error.provider_ms = Number.isFinite(Number(providerMs)) ? Math.max(0, Number(providerMs)) : null;
  // A returned HTTP error is a definitive provider response, not a lost
  // post-send receipt. 429 and transient 5xx responses may therefore retry;
  // socket loss and AbortSignal timeouts remain ambiguous in the authority.
  error.safe_to_retry = status === 429 || [500, 502, 503, 504].includes(status);
  error.retryable = error.safe_to_retry;
  return error;
}

/**
 * `callProvider` is injected rather than built here: the probe that produced
 * every number above talks to the provider directly, and a version that could
 * only reach it through our own deployment would put our auth, our proxy and
 * our deployment protection in front of the thing being measured -- all of
 * which have already failed a run for reasons unrelated to the card.
 */
export async function runCanonicalListingPath({
  imageUrls, model, effort = "low", imageDetail = "high", providerClientRequestId = null,
  callProvider
}) {
  const startedAt = Date.now();
  const response = await callProvider(buildCanonicalFieldsRequest({ imageUrls, model, effort, imageDetail }));
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok || body?.error) {
    throw canonicalProviderFailure(response, body, {
      providerClientRequestId,
      providerMs: Date.now() - startedAt
    });
  }
  const rawProviderOutput = extractCanonicalPayload(body);
  const finished = finishCanonicalTitle(rawProviderOutput);
  const accuracyLossLedger = buildAccuracyLossLedger({ rawProviderOutput, result: finished });
  return {
    ...finished,
    accuracy_loss_ledger: accuracyLossLedger,
    model,
    image_detail: imageDetail,
    requested_effort: effort,
    served_effort: body?.reasoning?.effort ?? effort,
    latency_ms: Date.now() - startedAt,
    input_tokens: body?.usage?.input_tokens ?? null,
    output_tokens: body?.usage?.output_tokens ?? null,
    provider_response_id: String(body?.id || "").trim() || null,
    provider_request_id: providerHeader(response, "x-request-id"),
    provider_client_request_id: String(providerClientRequestId || "").trim() || null,
    provider_rate_limit: {
      request_limit: providerHeader(response, "x-ratelimit-limit-requests"),
      request_remaining: providerHeader(response, "x-ratelimit-remaining-requests"),
      token_limit: providerHeader(response, "x-ratelimit-limit-tokens"),
      token_remaining: providerHeader(response, "x-ratelimit-remaining-tokens")
    }
  };
}

export async function runThinListingPath({ imageUrls, model, effort = "none", callProvider }) {
  const startedAt = Date.now();
  const response = await callProvider(buildThinTitleRequest({ imageUrls, model, effort }));
  const body = await response.json();
  if (!response.ok || body?.error) {
    throw new Error(`thin_path_provider_failed: ${body?.error?.message || `provider_status_${response.status}`}`);
  }
  // The provider echoes the effort it actually ran. Trusting the requested
  // value has already produced a paired evaluation in which both arms silently
  // ran the same configuration and still reported clean-looking numbers.
  const finished = finishThinTitle(extractProviderTitle(body));
  return {
    ...finished,
    model,
    requested_effort: effort,
    served_effort: body?.reasoning?.effort ?? effort,
    latency_ms: Date.now() - startedAt,
    input_tokens: body?.usage?.input_tokens ?? null,
    output_tokens: body?.usage?.output_tokens ?? null
  };
}
