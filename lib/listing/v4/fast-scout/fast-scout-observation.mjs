import crypto from "node:crypto";
import { createEvidenceField, createVisionSource, normalizeResolvedFields } from "../../evidence/evidence-schema.mjs";
import { expandPrintRunFields } from "../../print-run/print-run-fields.mjs";
import { renderListingPresentation } from "../../renderer/listing-renderer.mjs";
import { createListingImageSignedReadUrl, verifyListingImageVerificationToken } from "../../storage/supabase-image-storage.mjs";
import { readListingImageVerificationRecord } from "../../storage/storage-verification-store.mjs";
import { defaultProviderModels, providerModelConfig, visionProviderIds } from "../../providers/provider-contract.mjs";
import { normalizeProviderUsage } from "../../providers/provider-usage.mjs";
import { persistV4FastScoutCache, readV4FastScoutCache } from "../session/session-store.mjs";

const endpoint = "https://api.openai.com/v1/responses";
const scoutProvider = visionProviderIds.OPENAI_LEGACY;
const fastScoutCache = new Map();
const fastScoutCacheTtlMs = 10 * 60 * 1000;

const scoutFieldNames = Object.freeze([
  "subject",
  "players",
  "character",
  "year",
  "manufacturer",
  "product_family",
  "set",
  "card_name",
  "release_variant",
  "print_finish",
  "surface_color",
  "print_run_number",
  "print_run_denominator",
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "team",
  "language",
  "observable_components",
  "rc",
  "auto",
  "patch",
  "relic",
  "jersey",
  "one_of_one",
  "unsafe_fields_omitted"
]);

const scoutArrayFields = new Set(["players", "observable_components", "unsafe_fields_omitted"]);
const scoutBooleanFields = new Set(["rc", "auto", "patch", "relic", "jersey", "one_of_one"]);
const directPrintedFields = new Set([
  "year",
  "card_name",
  "collector_number",
  "checklist_code",
  "card_number",
  "tcg_card_number",
  "print_run_number",
  "print_run_numerator",
  "print_run_denominator",
  "numbered_to",
  "serial_number",
  "serial_denominator",
  "numerical_rarity"
]);
const slabPrintedFields = new Set(["grade_company", "card_grade", "auto_grade", "grade_type"]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "boolean") return value === true;
  return cleanText(value) !== "" && cleanText(value).toUpperCase() !== "UNKNOWN";
}

function fieldSchema(field) {
  if (scoutArrayFields.has(field)) return { type: "array", items: { type: "string" } };
  if (scoutBooleanFields.has(field)) return { type: ["boolean", "null"] };
  return { type: ["string", "null"] };
}

export function v4FastScoutResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      recognition_status: { type: "string", enum: ["CONFIRMED", "RESOLVED", "ABSTAIN"] },
      fast_scout_fields: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(scoutFieldNames.map((field) => [field, fieldSchema(field)])),
        required: [...scoutFieldNames]
      },
      fast_scout_confidence: { type: "number" },
      fast_scout_review_fields: { type: "array", items: { type: "string" } },
      unresolved: { type: "array", items: { type: "string" } },
      evidence_notes: { type: "array", items: { type: "string" } }
    },
    required: [
      "recognition_status",
      "fast_scout_fields",
      "fast_scout_confidence",
      "fast_scout_review_fields",
      "unresolved",
      "evidence_notes"
    ]
  };
}

function openAiFastScoutConfig(env = process.env) {
  const model = providerModelConfig(scoutProvider, env.OPENAI_FAST_SCOUT_MODEL || env.OPENAI_LISTING_MODEL);
  return {
    apiKey: env.OPENAI_API_KEY || "",
    model: model.model_id || defaultProviderModels[scoutProvider],
    modelAllowed: model.allowed,
    maxOutputTokens: Number(env.OPENAI_FAST_SCOUT_MAX_OUTPUT_TOKENS || 700),
    imageDetail: cleanText(env.OPENAI_FAST_SCOUT_IMAGE_DETAIL || "low").toLowerCase(),
    maxImages: Math.max(1, Math.min(2, positiveInteger(env.OPENAI_FAST_SCOUT_MAX_IMAGES, 1)))
  };
}

function parseResponsesText(data = {}) {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

function responseDiagnostics(data = {}, outputCap = 0) {
  const usage = data.usage || {};
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const cap = Number(outputCap);
  return {
    input_tokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0,
    output_tokens: outputTokens,
    total_tokens: Number(usage.total_tokens || 0) || null,
    response_status: cleanText(data.status),
    incomplete_reason: cleanText(data.incomplete_details?.reason || data.incomplete_reason),
    output_cap: Number.isFinite(cap) && cap > 0 ? cap : null,
    output_utilization: Number.isFinite(cap) && cap > 0 ? Number((outputTokens / cap).toFixed(6)) : null
  };
}

function storageMetadataForImage(image = {}) {
  return {
    objectPath: image.objectPath || image.object_path || image.storagePath || image.storage_path,
    bucket: image.bucket || image.storage_bucket,
    contentType: image.originalType || image.original_type || image.contentType || image.content_type || image.type,
    size: image.originalSize || image.original_size || image.size,
    width: image.originalWidth || image.original_width || image.width,
    height: image.originalHeight || image.original_height || image.height,
    token: image.storageVerificationToken
      || image.storage_verification_token
      || image.verificationToken
      || image.verification_token,
    contentSha256: image.contentSha256 || image.content_sha256 || ""
  };
}

function imageIsDerived(image = {}) {
  const role = cleanText(image.role || image.captureRole || image.capture_role).toLowerCase();
  const kind = cleanText(image.kind || image.image_kind || image.crop_type).toLowerCase();
  return /crop|serial|slab|year|grade|model_ready|derived|readability/.test(`${role} ${kind}`);
}

function imageRoleText(image = {}) {
  return cleanText([
    image.role,
    image.captureRole,
    image.capture_role,
    image.kind,
    image.image_kind,
    image.crop_type,
    image.side
  ].filter(Boolean).join(" ")).toLowerCase();
}

function isLocalCropImage(image = {}) {
  return /crop|serial|grade|slab_label|label|year_product|product_crop|player_name|multi_subject/i.test(imageRoleText(image));
}

export function selectFastScoutImages(images = [], { maxImages = 1 } = {}) {
  const input = Array.isArray(images) ? images : [];
  const limit = Math.max(1, Math.min(2, positiveInteger(maxImages, 1)));
  const modelReady = input.filter((image) => /model_ready|readability/i.test(imageRoleText(image)) && !isLocalCropImage(image));
  const primary = input.filter((image) => !imageIsDerived(image));
  const selected = modelReady.length ? modelReady : primary.length ? primary : input;
  return selected.slice(0, limit);
}

async function assertVerifiedStorageImage(image = {}, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const metadata = storageMetadataForImage(image);
  if (!metadata.objectPath) throw new Error("Fast scout image is missing verified object path.");
  if (!(image.storageVerified === true || image.storage_verified === true)) {
    throw new Error("Fast scout image storage reference has not been verified.");
  }
  if (metadata.token) {
    try {
      verifyListingImageVerificationToken({
        token: metadata.token,
        objectPath: metadata.objectPath,
        bucket: metadata.bucket,
        contentType: metadata.contentType,
        size: metadata.size,
        width: metadata.width,
        height: metadata.height,
        env
      });
      return metadata;
    } catch (error) {
      if (!/expired/i.test(String(error.message || ""))) throw error;
    }
  }
  const durableRecord = await readListingImageVerificationRecord({
    objectPath: metadata.objectPath,
    bucket: metadata.bucket,
    contentType: metadata.contentType,
    size: metadata.size,
    width: metadata.width,
    height: metadata.height,
    env,
    fetchImpl
  });
  if (!durableRecord.verified) throw new Error("Fast scout image has no current verification record.");
  return metadata;
}

function addTiming(timing = null, field, startedAt) {
  if (!timing || !field || !startedAt) return;
  timing[field] = Number(timing[field] || 0) + (Date.now() - startedAt);
}

async function signedScoutImages(images = [], {
  env = process.env,
  fetchImpl = globalThis.fetch,
  maxImages = 1,
  timing = null
} = {}) {
  const selected = selectFastScoutImages(images, { maxImages });
  if (!selected.length) throw new Error("Fast scout requires at least one verified image.");
  const signed = [];
  for (const image of selected) {
    const verifyStartedAt = Date.now();
    const metadata = await assertVerifiedStorageImage(image, { env, fetchImpl });
    addTiming(timing, "image_verify_ms", verifyStartedAt);
    let signedUrl = image.signedUrl || image.signed_url;
    if (!signedUrl) {
      const signedStartedAt = Date.now();
      signedUrl = await createListingImageSignedReadUrl({
        objectPath: metadata.objectPath,
        bucket: metadata.bucket,
        env,
        fetchImpl
      });
      addTiming(timing, "signed_url_ms", signedStartedAt);
    }
    signed.push({
      image_id: image.image_id || image.id || "",
      role: image.role || image.capture_role || "",
      width: Number(metadata.width || image.width || 0) || null,
      height: Number(metadata.height || image.height || 0) || null,
      object_path: metadata.objectPath,
      content_sha256: cleanText(metadata.contentSha256),
      signed_url: signedUrl
    });
  }
  return signed;
}

function fastScoutPrompt({ payload = {}, imageSummary = [] } = {}) {
  return [
    "You are LYNCA V4 FAST_SCOUT_OBSERVATION.",
    "Return compact JSON only. Use only the supplied current card images.",
    "This is not full identity research. Do not use marketplace titles, external knowledge, vector candidates, or catalog guesses.",
    "Read only narrow visible facts for a writer-safe first draft.",
    "Treat supplied images as unordered same-card images. Do not decide, swap, or report front/back side labels.",
    "Allowed fields: subject/player/character, visible year, manufacturer/product family, set/card name if printed, card/checklist/collector number if visible, print run if visible, slab grade if visible, observable components, surface color.",
    "Do not infer exact_parallel, SSP, case hit, or official_card_type. Put those names in unsafe_fields_omitted or unresolved if uncertain.",
    "Surface color can be Gold/Purple/Red/Blue/Green/Silver/Black/Orange when visually obvious. Do not upgrade color into Refractor/Wave/Shimmer/Mojo/Prizm/Sparkle/Holo unless the exact word is printed.",
    "Print run values like 2/3, 14/99, 1/1 are numerical rarity. Keep full numerator only when visibly read from this current card or slab.",
    "Grade can be returned only from visible slab label. Do not copy grade/cert from any reference.",
    "If unsure, leave field null/empty and add it to fast_scout_review_fields.",
    "Runtime max title length downstream: " + String(payload.maxTitleLength || 80),
    "Image summary:",
    JSON.stringify(imageSummary.map((image) => ({
      image_id: image.image_id,
      role: image.role,
      width: image.width,
      height: image.height
    })))
  ].join("\n");
}

function normalizeScoutFields(fields = {}) {
  const components = Array.isArray(fields.observable_components) ? fields.observable_components : [];
  const printRunFields = expandPrintRunFields({
    print_run_number: fields.print_run_number,
    print_run_denominator: fields.print_run_denominator
  });
  const players = Array.isArray(fields.players) && fields.players.length
    ? fields.players
    : hasValue(fields.subject)
      ? [fields.subject]
      : [];
  const raw = {
    players,
    character: fields.character,
    year: fields.year,
    manufacturer: fields.manufacturer,
    brand: fields.manufacturer,
    product: fields.product_family,
    set: fields.set,
    card_name: fields.card_name,
    variation: fields.release_variant,
    parallel_family: fields.print_finish,
    surface_color: fields.surface_color,
    collector_number: fields.collector_number || fields.checklist_code || null,
    checklist_code: fields.checklist_code || null,
    card_number: fields.collector_number || fields.tcg_card_number || null,
    tcg_card_number: fields.tcg_card_number || null,
    grade_company: fields.grade_company,
    card_grade: fields.card_grade,
    auto_grade: fields.auto_grade,
    grade_type: fields.grade_type,
    team: fields.team,
    language: fields.language,
    observable_components: components,
    rc: fields.rc === true || components.includes("rc"),
    auto: fields.auto === true || components.includes("auto"),
    patch: fields.patch === true || components.includes("patch"),
    relic: fields.relic === true || components.includes("relic"),
    jersey: fields.jersey === true || components.includes("jersey"),
    one_of_one: fields.one_of_one === true || printRunFields.one_of_one === true,
    ...printRunFields
  };
  return normalizeResolvedFields(raw);
}

function evidenceForResolved(resolved = {}, {
  imageId = "",
  confidence = 0.7,
  reviewFields = []
} = {}) {
  const reviewSet = new Set((reviewFields || []).map((field) => cleanText(field).toLowerCase()).filter(Boolean));
  const evidence = {};
  Object.entries(resolved).forEach(([field, value]) => {
    if (!hasValue(value)) return;
    const normalizedField = field === "players" ? "subject" : field;
    const review = reviewSet.has(field) || reviewSet.has(normalizedField);
    const sourceType = slabPrintedFields.has(field)
      ? "SLAB_LABEL"
      : directPrintedFields.has(field)
        ? "CARD_FRONT"
        : "VISION_MODEL";
    const directCurrentImageField = directPrintedFields.has(field) || slabPrintedFields.has(field);
    evidence[field] = createEvidenceField({
      value,
      normalizedValue: value,
      confidence: review ? Math.min(confidence, 0.62) : confidence,
      status: review ? "REVIEW" : (directCurrentImageField || confidence >= 0.82) ? "CONFIRMED" : "REVIEW",
      sources: [createVisionSource({
        sourceType,
        imageId,
        region: "fast_scout_observation",
        observedText: Array.isArray(value) ? value.join(" / ") : String(value ?? ""),
        sourceInferenceMethod: "v4_fast_scout"
      })]
    });
  });
  return evidence;
}

export function buildFastScoutListingResult({
  parsed = {},
  payload = {},
  signedImages = [],
  latencyMs = null,
  usage = null,
  modelId = null,
  tokenDiagnostics = null,
  imageAccessTiming = {}
} = {}) {
  const fields = parsed.fast_scout_fields || {};
  const confidence = Math.max(0, Math.min(1, Number(parsed.fast_scout_confidence || 0.68)));
  const reviewFields = [
    ...(Array.isArray(parsed.fast_scout_review_fields) ? parsed.fast_scout_review_fields : []),
    ...(Array.isArray(fields.unsafe_fields_omitted) ? fields.unsafe_fields_omitted : [])
  ];
  const resolved = normalizeScoutFields(fields);
  const evidence = evidenceForResolved(resolved, {
    imageId: signedImages[0]?.image_id || "",
    confidence,
    reviewFields
  });
  const presentation = renderListingPresentation({
    resolved,
    evidence,
    maxLength: payload.maxTitleLength || 80,
    trustResolvedPrintRunWithoutEvidence: false
  });
  const title = cleanText(presentation.rendered_title);
  const unresolved = [
    ...(Array.isArray(parsed.unresolved) ? parsed.unresolved : []),
    ...reviewFields
  ].map(cleanText).filter(Boolean).slice(0, 16);
  return {
    title,
    final_title: title,
    rendered_title: title,
    model_title_suggestion: title,
    confidence: title ? "MEDIUM" : "FAILED",
    confidence_score: confidence,
    reason: title
      ? "V4 fast scout produced a writer-safe draft from current visible evidence; full assist continues in background."
      : "V4 fast scout could not produce a safe draft.",
    fields: resolved,
    resolved,
    resolved_fields: resolved,
    evidence,
    normalized_evidence: evidence,
    raw_provider_fields: fields,
    raw_observed_fields: fields,
    unresolved,
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy,
    title_render_source: "v4_fast_scout_renderer",
    provider: "openai_fast_scout",
    provider_id: "openai_fast_scout",
    model_id: modelId,
    provider_model: modelId,
    provider_latency_ms: latencyMs,
    fast_scout: {
      status: title ? "READY" : "FAILED",
      fields,
      confidence,
      review_fields: reviewFields,
      latency_ms: latencyMs,
      signed_url_ms: Number(imageAccessTiming.signed_url_ms || 0),
      image_verify_ms: Number(imageAccessTiming.image_verify_ms || 0),
      image_detail: null,
      input_image_count: signedImages.length,
      input_images: signedImages.map((image) => ({
        image_id: image.image_id,
        role: image.role,
        width: image.width,
        height: image.height,
        object_path: image.object_path
      }))
    },
    timing: {
      total_ms: latencyMs,
      fast_scout_latency_ms: latencyMs,
      signed_url_ms: Number(imageAccessTiming.signed_url_ms || 0),
      image_verify_ms: Number(imageAccessTiming.image_verify_ms || 0),
      provider_total_ms: null,
      resolver_ms: null,
      renderer_ms: null
    },
    provider_token_diagnostics: tokenDiagnostics,
    usage
  };
}

function cacheKeyFor({ signedImages = [], config = {} } = {}) {
  const imagePart = signedImages
    .map((image) => image.content_sha256 || image.object_path || image.image_id)
    .filter(Boolean)
    .join("|");
  return `${config.model}|${config.imageDetail}|${config.maxImages}|${imagePart}`;
}

function cacheIdFor(cacheKey = "") {
  const digest = crypto.createHash("sha256").update(cacheKey).digest("hex");
  return `v4scout_${digest}`;
}

function imageHashFor(signedImages = []) {
  const image = signedImages[0] || {};
  return image.content_sha256 || image.object_path || image.image_id || "";
}

function cacheExpiresAt() {
  return new Date(Date.now() + fastScoutCacheTtlMs).toISOString();
}

function cacheResult(result = {}, {
  cacheHit = false,
  cacheStatus = "MISS",
  prewarmerUsed = false,
  blockingCallUsed = true,
  cacheId = null
} = {}) {
  return {
    ...result,
    fast_scout: {
      ...(result.fast_scout || {}),
      cache_hit: cacheHit,
      cache_status: cacheStatus,
      cache_id: cacheId,
      prewarmer_used: prewarmerUsed,
      blocking_call_used: blockingCallUsed
    }
  };
}

async function persistScoutCacheResult({
  cacheId,
  result = {},
  signedImages = [],
  config = {},
  payload = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!cacheId || !result?.fast_scout) return { saved: false, error: "missing_fast_scout_cache_payload" };
  const firstImage = signedImages[0] || {};
  return persistV4FastScoutCache({
    cache: {
      id: cacheId,
      scout_id: cacheId,
      asset_id: payload.asset_id || payload.assetId || null,
      image_hash: imageHashFor(signedImages),
      image_role: firstImage.role || null,
      model_id: result.model_id || result.provider_model || config.model || null,
      model_revision: config.model || null,
      scout_fields: result.fast_scout.fields || {},
      review_fields: result.fast_scout.review_fields || [],
      confidence: result.fast_scout.confidence ?? result.confidence_score ?? null,
      route_hint: {
        title: result.final_title || result.title || "",
        unresolved: result.unresolved || []
      },
      status: result.fast_scout.status || (result.final_title ? "READY" : "FAILED"),
      error_message: result.confidence === "FAILED" ? result.reason || null : null,
      result_payload: result,
      expires_at: cacheExpiresAt()
    },
    env,
    fetchImpl
  });
}

function persistentCacheUsable(row = null) {
  if (!row || row.status !== "READY" || !row.result_payload) return false;
  if (!row.expires_at) return true;
  return Date.parse(row.expires_at) > Date.now();
}

async function readPersistentCacheWithBudget({
  cacheId,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const timeoutMs = Math.max(50, Math.min(2000, Number(env.V4_FAST_SCOUT_CACHE_READ_TIMEOUT_MS || 700)));
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, row: null, error: "fast_scout_cache_read_timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([
      readV4FastScoutCache({ cacheId, env, fetchImpl }),
      timeout
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runV4FastScoutObservation({
  payload = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  cacheWriteMode = "background"
} = {}) {
  const config = openAiFastScoutConfig(env);
  if (!config.apiKey) throw new Error("OPENAI_API_KEY is not configured for V4 fast scout.");
  if (!config.modelAllowed) throw new Error("OPENAI_FAST_SCOUT_MODEL/OPENAI_LISTING_MODEL is not allowed.");
  const imageAccessTiming = { image_verify_ms: 0, signed_url_ms: 0 };
  const signedImages = await signedScoutImages(payload.images || [], {
    env,
    fetchImpl,
    maxImages: config.maxImages,
    timing: imageAccessTiming
  });
  const cacheKey = cacheKeyFor({ signedImages, config });
  const cacheId = cacheIdFor(cacheKey);
  const cached = fastScoutCache.get(cacheKey);
  if (cached && Date.now() - cached.saved_at < fastScoutCacheTtlMs) {
    return cacheResult(cached.result, {
      cacheHit: true,
      cacheStatus: "HIT_MEMORY",
      prewarmerUsed: Boolean(cached.prewarmer_used),
      blockingCallUsed: false,
      cacheId
    });
  }

  const persistent = await readPersistentCacheWithBudget({ cacheId, env, fetchImpl });
  if (persistent.ok && persistentCacheUsable(persistent.row)) {
    const result = cacheResult(persistent.row.result_payload, {
      cacheHit: true,
      cacheStatus: "HIT_PERSISTENT",
      prewarmerUsed: true,
      blockingCallUsed: false,
      cacheId
    });
    fastScoutCache.set(cacheKey, { saved_at: Date.now(), result, prewarmer_used: true });
    return result;
  }

  const startedAt = Date.now();
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: fastScoutPrompt({ payload, imageSummary: signedImages }) },
          ...signedImages.map((image) => ({
            type: "input_image",
            image_url: image.signed_url,
            detail: config.imageDetail === "high" ? "high" : "low"
          }))
        ]
      }],
      max_output_tokens: config.maxOutputTokens,
      temperature: 0,
      text: {
        format: {
          type: "json_schema",
          name: "v4_fast_scout_observation",
          strict: true,
          schema: v4FastScoutResponseSchema()
        }
      }
    })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI fast scout failed: HTTP ${response.status} ${message.slice(0, 180)}`);
  }
  const data = await response.json();
  const text = parseResponsesText(data);
  const parsed = JSON.parse(text);
  const latencyMs = Date.now() - startedAt;
  const tokenDiagnostics = responseDiagnostics(data, config.maxOutputTokens);
  const result = buildFastScoutListingResult({
    parsed,
    payload,
    signedImages,
    latencyMs,
    modelId: data.model || config.model,
    tokenDiagnostics,
    imageAccessTiming,
    usage: normalizeProviderUsage({
      provider: scoutProvider,
      modelId: data.model || config.model,
      rawUsage: data.usage,
      latencyMs,
      imageCount: signedImages.length,
      env
    })
  });
  result.fast_scout.image_detail = config.imageDetail === "high" ? "high" : "low";
  const finalResult = cacheResult(result, {
    cacheHit: false,
    cacheStatus: persistent.ok ? "MISS" : "READ_ERROR",
    prewarmerUsed: false,
    blockingCallUsed: true,
    cacheId
  });
  fastScoutCache.set(cacheKey, { saved_at: Date.now(), result: finalResult, prewarmer_used: cacheWriteMode === "await" });
  const writePromise = persistScoutCacheResult({
    cacheId,
    result: finalResult,
    signedImages,
    config,
    payload,
    env,
    fetchImpl
  }).catch((error) => {
    console.error("[v4-fast-scout] cache persistence failed", error);
    return { saved: false, error: String(error?.message || error || "") };
  });
  if (cacheWriteMode === "await") await writePromise;
  return finalResult;
}
