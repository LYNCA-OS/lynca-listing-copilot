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
import {
  composeMarketplaceTitle,
  MARKETPLACE_PROFILES
} from "./marketplace-composer-rules.mjs";
import { parseCanonicalFields } from "./canonical-fields.mjs";
import { composeFromCanonicalFields } from "./canonical-composer.mjs";
import {
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3,
  composeLyncaStandardNameForProfile
} from "./canonical-naming-adapter.mjs";
import { activeStandardWriterProjection } from "./csm-projection-activation.mjs";
import {
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V2
} from "./csm-persistence.mjs";
import { buildAccuracyLossLedger } from "./accuracy-loss-ledger.mjs";
import { resolveCsmProviderAdapter } from "./csm-provider-adapter.mjs";
import { CSM_ACTIVE_MODEL_PROFILE } from "./csm-model-profile.mjs";
import {
  SET_CARD_NAME_RELATION_CONTRACT_VERSION,
  validateSetCardNameRelationReceipt
} from "./set-card-name-contract.mjs";
import {
  providerReasoningEffortReceipt,
  providerResponseAttestation,
  providerUsageReceipt
} from "./provider-response-attestation.mjs";
import {
  LOT_PUBLICATION_FAILURE,
  lotPublicationFailureCode
} from "./lot-terminal-contract.mjs";

export const THIN_TITLE_MAX_LENGTH = 80;

export { LOT_PUBLICATION_FAILURE };

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
export function finishCanonicalFields(fields, {
  limit,
  exactParallelColorCompaction,
  verifiedExternalIdentity = false,
  fieldDefects = []
} = {}) {
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

  for (const key of ["components", "search_optimization"]) {
    // `search_optimization` is a new CNL lane. The dormant bridge must not add
    // an empty key to legacy v2 fields that never carried it; exact own-key
    // presence is part of the public response contract.
    if (key === "search_optimization"
        && !Object.prototype.hasOwnProperty.call(fields, key)) continue;
    cleaned[key] = (Array.isArray(fields[key]) ? fields[key] : [])
      .map((value) => {
        const result = sanitizeListingTitle(value);
        if (result.title !== value) sanitised = true;
        return result.title;
      })
      .filter(Boolean);
  }

  const composed = composeActiveCanonicalFields(cleaned, {
    limit,
    exactParallelColorCompaction,
    verifiedExternalIdentity
  });
  const lotFailureCode = lotPublicationFailureCode({
    quantityUnresolved: composed.lot_quantity_unresolved,
    singleCard: composed.lot_single_card
  });
  return {
    title: composed.title,
    fields: cleaned,
    field_defects: [...fieldDefects],
    sanitised,
    truncated: composed.truncated,
    grammar: composed.grammar,
    brackets: composed.brackets,
    bracket_text: composed.bracket_text,
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
    canonical_naming_trace: composed.canonical_naming_trace || null,
    canonical_naming_publishable: composed.canonical_naming_publishable !== false,
    canonical_naming_failure_code: composed.canonical_naming_failure_code || null,
    lot_quantity_unresolved: Boolean(composed.lot_quantity_unresolved),
    lot_single_card: Boolean(composed.lot_single_card),
    lot_unshared_attributes: [...(composed.lot_unshared_attributes || [])],
    publication_coverage: composed.publication_coverage || null,
    lot_publishable: lotFailureCode == null,
    lot_publication_failure_code: lotFailureCode,
    composer_version: composed.composer_version,
    marketplace_profile_version: composed.marketplace_profile_version,
    length: composed.length
  };
}

/**
 * Select the active executable projection for already-clean canonical fields.
 * Historical replay never calls this router; it dispatches by stored version.
 */
export function composeActiveCanonicalFields(fields, {
  limit,
  exactParallelColorCompaction,
  verifiedExternalIdentity = false
} = {}) {
  const standard = !verifiedExternalIdentity
    && String(fields?.grammar || "standard").toLowerCase() === "standard";
  if (standard) {
    const active = activeStandardWriterProjection();
    const canonicalContract = [
      CANONICAL_NAMING_RELEASE_CONTRACT_V1,
      CANONICAL_NAMING_RELEASE_CONTRACT_V2,
      CANONICAL_NAMING_RELEASE_CONTRACT_V3
    ].find((contract) => (
      active.composer_version === contract.composer_version
        && active.marketplace_profile_version === contract.marketplace_profile_version
    ));
    if (canonicalContract) {
      return composeLyncaStandardNameForProfile(fields, {
        marketplaceProfileVersion: canonicalContract.marketplace_profile_version,
        publicationCoverage: true,
        ...(limit === undefined ? {} : { limit })
      });
    }
    if (active.composer_version !== THIN_COMPOSER_VERSION_V2
        || active.marketplace_profile_version !== EBAY_PROFILE_VERSION) {
      throw new TypeError("unsupported_active_standard_writer_projection");
    }
    const options = {};
    if (limit !== undefined) options.limit = limit;
    if (exactParallelColorCompaction !== undefined) {
      options.features = {
        exact_parallel_color_compaction: exactParallelColorCompaction
      };
    }
    const composed = composeFromCanonicalFields(fields, options);
    return {
      ...composed,
      composer_version: active.composer_version,
      marketplace_profile_version: active.marketplace_profile_version,
      canonical_naming_trace: null,
      canonical_naming_publishable: true,
      canonical_naming_failure_code: null
    };
  }

  const composeOptions = {
    features: {
      durable_lot_terminal_shared_only: true,
      publication_coverage: true
    }
  };
  if (limit !== undefined) composeOptions.limit = limit;
  if (verifiedExternalIdentity) {
    composeOptions.profile = MARKETPLACE_PROFILES.ebayVerifiedExternalIdentity;
  }
  if (exactParallelColorCompaction !== undefined || verifiedExternalIdentity) {
    if (exactParallelColorCompaction !== undefined) {
      composeOptions.features.exact_parallel_color_compaction = exactParallelColorCompaction;
    }
    if (verifiedExternalIdentity) {
      composeOptions.features.verified_external_identity_title = true;
      composeOptions.features.verified_external_identity_priority_v2 = true;
    }
  }
  const composed = composeFromCanonicalFields(fields, composeOptions);
  return {
    ...composed,
    composer_version: THIN_COMPOSER_VERSION_V2,
    marketplace_profile_version: EBAY_PROFILE_VERSION,
    canonical_naming_trace: null,
    canonical_naming_publishable: true,
    canonical_naming_failure_code: null
  };
}

export function finishCanonicalTitle(payload, options = {}) {
  const { fields, defects } = parseCanonicalFields(payload);
  return {
    ...finishCanonicalFields(fields, { ...options, fieldDefects: defects }),
    raw_length: String(payload ?? "").length
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

function providerBusinessFailure(providerError) {
  const classification = [
    providerError?.code,
    providerError?.type,
    providerError?.message
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /(?:content|policy|safety|moderation|invalid|auth|permission|billing|quota|rate.?limit|unsupported|not.?found|context.?length)/.test(
    classification
  );
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
  error.response = {
    status,
    headers: response?.headers,
    ...(body?.usage && typeof body.usage === "object" ? { usage: body.usage } : {})
  };
  error.provider_attempt_started = true;
  error.returned_http_response = true;
  error.response_body_complete = true;
  error.provider_output_present = Boolean(
    String(body?.output_text || "").trim()
      || (Array.isArray(body?.output) && body.output.length > 0)
  );
  error.provider_contract_failure = false;
  error.provider_business_failure = providerBusinessFailure(providerError);
  error.definitive_response = true;
  error.provider_request_id = providerHeader(response, "x-request-id");
  error.provider_client_request_id = String(providerClientRequestId || "").trim() || null;
  error.provider_error_code = String(providerError.code || "").trim().slice(0, 160) || null;
  error.provider_error_type = String(providerError.type || "").trim().slice(0, 160) || null;
  error.provider_error_param = String(providerError.param || "").trim().slice(0, 160) || null;
  error.provider_ms = Number.isFinite(Number(providerMs)) ? Math.max(0, Number(providerMs)) : null;
  // A returned HTTP error is a definitive provider response, not a lost
  // post-send receipt. The dispatcher uses these facts only for its exact 502
  // policy; 429/500/503/504 and socket/Abort failures never auto-resubmit.
  error.safe_to_retry = !error.provider_business_failure
    && (status === 429 || [500, 502, 503, 504].includes(status));
  error.retryable = error.safe_to_retry;
  return error;
}

function canonicalProviderContractFailure(response, detail, {
  providerClientRequestId = null,
  providerMs = null,
  cause = null,
  ambiguous = false
} = {}) {
  const returnedStatus = Number(response?.status);
  const status = Number.isInteger(returnedStatus) && returnedStatus >= 400
    ? returnedStatus
    : 502;
  const error = new Error(`canonical_path_provider_contract_failed: ${detail}`);
  error.name = "CanonicalProviderError";
  // This is an upstream response contract failure, not a bad card request.
  error.status = status;
  error.statusCode = status;
  error.response = { status, headers: response?.headers };
  error.provider_attempt_started = true;
  error.provider_request_id = providerHeader(response, "x-request-id");
  error.provider_client_request_id = String(providerClientRequestId || "").trim() || null;
  error.provider_error_code = String(detail || "invalid_response").slice(0, 160);
  error.provider_error_type = "provider_response_contract_error";
  error.provider_ms = Number.isFinite(Number(providerMs)) ? Math.max(0, Number(providerMs)) : null;
  error.ambiguous = ambiguous === true;
  error.returned_http_response = true;
  error.response_body_complete = !error.ambiguous;
  error.provider_output_present = false;
  error.provider_contract_failure = true;
  error.provider_business_failure = false;
  // A complete but malformed response is definitive and must not buy another
  // model call. A body transport loss is ambiguous and is reconciled through
  // the durable authority instead.
  error.definitive_response = !error.ambiguous;
  error.retryable = false;
  if (cause) error.cause = cause;
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
  imageUrls,
  compiledRequest = null,
  model = CSM_ACTIVE_MODEL_PROFILE.model,
  effort = CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
  imageDetail = CSM_ACTIVE_MODEL_PROFILE.image_detail,
  maxOutputTokens = CSM_ACTIVE_MODEL_PROFILE.max_output_tokens,
  provider = CSM_ACTIVE_MODEL_PROFILE.provider,
  providerClientRequestId = null,
  resolveObservation = null,
  callProvider
}) {
  const startedAt = Date.now();
  const providerAdapter = resolveCsmProviderAdapter(provider);
  let providerRequest;
  if (compiledRequest === null) {
    providerRequest = providerAdapter.buildRequest({
      imageUrls, model, effort, imageDetail, maxOutputTokens
    });
  } else {
    const wire = compiledRequest?.wire_request;
    const imageDetails = wire?.input?.[0]?.content
      ?.filter((part) => part?.type === "input_image")
      .map((part) => part.detail) || [];
    if (!wire || typeof wire !== "object"
        || compiledRequest.provider !== provider
        || compiledRequest.adapter_id !== providerAdapter.contract.id
        || compiledRequest.request_builder_version
          !== providerAdapter.contract.request_builder_version
        || compiledRequest.model !== model
        || compiledRequest.requested_effort !== effort
        || compiledRequest.image_detail !== imageDetail
        || compiledRequest.max_output_tokens !== maxOutputTokens
        || compiledRequest.sampling_parameters !== "omit"
        || wire.model !== model
        || wire?.reasoning?.effort !== effort
        || wire.max_output_tokens !== maxOutputTokens
        || imageDetails.some((detail) => detail !== imageDetail)
        || ["temperature", "top_p", "seed"].some((key) => Object.hasOwn(wire, key))) {
      throw new TypeError("compiled_provider_request_mismatch");
    }
    providerRequest = wire;
  }
  const response = await callProvider(providerRequest);
  let body;
  try {
    body = await response.json();
  } catch (error) {
    if (!response.ok) {
      if (error?.name !== "SyntaxError") {
        throw canonicalProviderContractFailure(response, "error_body_read_incomplete", {
          providerClientRequestId,
          providerMs: Date.now() - startedAt,
          cause: error,
          ambiguous: true
        });
      }
      throw canonicalProviderFailure(response, {}, {
        providerClientRequestId,
        providerMs: Date.now() - startedAt
      });
    }
    throw canonicalProviderContractFailure(response, "invalid_json", {
      providerClientRequestId,
      providerMs: Date.now() - startedAt,
      cause: error,
      ambiguous: error?.name !== "SyntaxError"
    });
  }
  if (!response.ok || body?.error) {
    throw canonicalProviderFailure(response, body, {
      providerClientRequestId,
      providerMs: Date.now() - startedAt
    });
  }
  let parsedProviderResponse;
  try {
    parsedProviderResponse = providerAdapter.parseResponse(body, {
      request: providerRequest
    });
  } catch (error) {
    throw canonicalProviderContractFailure(response, error?.message || "provider_output_audit_failed", {
      providerClientRequestId,
      providerMs: Date.now() - startedAt,
      cause: error
    });
  }
  if (!parsedProviderResponse.ok) {
    throw canonicalProviderContractFailure(response, parsedProviderResponse.failure_code, {
      providerClientRequestId,
      providerMs: Date.now() - startedAt
    });
  }
  const rawProviderOutput = parsedProviderResponse.raw_output;
  if (!rawProviderOutput.trim()) {
    throw canonicalProviderContractFailure(response, "structured_output_missing", {
      providerClientRequestId,
      providerMs: Date.now() - startedAt
    });
  }
  const observation = finishCanonicalTitle(rawProviderOutput);
  const relationReceipt = parsedProviderResponse.receipt?.set_card_name_relation_receipt;
  let finished = observation;
  if (typeof resolveObservation === "function") {
    try {
      finished = resolveObservation(observation);
    } catch (error) {
      throw canonicalProviderContractFailure(response, "post_observation_resolution_failed", {
        providerClientRequestId,
        providerMs: Date.now() - startedAt,
        cause: error
      });
    }
  }
  if (!finished || typeof finished !== "object" || Array.isArray(finished)) {
    throw canonicalProviderContractFailure(response, "post_observation_resolution_invalid", {
      providerClientRequestId,
      providerMs: Date.now() - startedAt
    });
  }
  if (relationReceipt) {
    const cleanedRelationReceipt = {
      schema_version: SET_CARD_NAME_RELATION_CONTRACT_VERSION,
      set: finished.fields?.set ? {
        predicate: relationReceipt.set?.predicate,
        value: finished.fields.set
      } : null,
      card_name: finished.fields?.card_name ? {
        predicate: relationReceipt.card_name?.predicate,
        value: finished.fields.card_name
      } : null
    };
    validateSetCardNameRelationReceipt(cleanedRelationReceipt, finished.fields);
    parsedProviderResponse.receipt.set_card_name_relation_receipt = cleanedRelationReceipt;
  }
  if (finished.canonical_naming_publishable === false) {
    throw canonicalProviderContractFailure(
      response,
      finished.canonical_naming_failure_code || "canonical_naming_not_publishable",
      {
        providerClientRequestId,
        providerMs: Date.now() - startedAt
      }
    );
  }
  if (!finished.title.trim()) {
    throw canonicalProviderContractFailure(response, "usable_title_missing", {
      providerClientRequestId,
      providerMs: Date.now() - startedAt
    });
  }
  const accuracyLossLedger = buildAccuracyLossLedger({ rawProviderOutput, result: finished });
  return {
    ...finished,
    accuracy_loss_ledger: accuracyLossLedger,
    provider,
    model,
    requested_model: model,
    ...parsedProviderResponse.receipt,
    image_detail: imageDetail,
    requested_effort: effort,
    latency_ms: Date.now() - startedAt,
    provider_http_status: Number(response.status || 0) || null,
    provider_response_id: String(body?.id || "").trim() || null,
    provider_request_id: providerHeader(response, "x-request-id"),
    provider_client_request_id: String(providerClientRequestId || "").trim() || null
  };
}

export async function runThinListingPath({ imageUrls, model, effort = "none", callProvider }) {
  const startedAt = Date.now();
  const response = await callProvider(buildThinTitleRequest({ imageUrls, model, effort }));
  const body = await response.json();
  if (!response.ok || body?.error) {
    throw new Error(`thin_path_provider_failed: ${body?.error?.message || `provider_status_${response.status}`}`);
  }
  const responseReceipt = providerResponseAttestation(body);
  if ((responseReceipt.provider_response_status_attested
      && responseReceipt.provider_response_status !== "completed")
      || responseReceipt.provider_response_incomplete) {
    throw new Error("thin_path_provider_contract_failed: provider_response_incomplete");
  }
  // The provider echoes the effort it actually ran. Trusting the requested
  // value has already produced a paired evaluation in which both arms silently
  // ran the same configuration and still reported clean-looking numbers.
  const finished = finishThinTitle(extractProviderTitle(body));
  const effortReceipt = providerReasoningEffortReceipt(body);
  const usageReceipt = providerUsageReceipt(body);
  return {
    ...finished,
    provider: "openai",
    model,
    requested_model: model,
    ...responseReceipt,
    requested_effort: effort,
    ...effortReceipt,
    latency_ms: Date.now() - startedAt,
    ...usageReceipt,
    provider_http_status: Number(response.status || 0) || null
  };
}
