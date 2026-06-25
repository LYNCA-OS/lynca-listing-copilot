import { GoogleGenAI } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { defaultProviderModels, imageUrlForProvider, providerModelConfig, visionProviderIds } from "./provider-contract.mjs";
import {
  ProviderError,
  providerHttpError,
  providerInputUnsupported,
  providerResponseFormatError,
  providerSchemaError,
  providerUnavailable,
  safeProviderErrorMessage
} from "./provider-errors.mjs";
import { parseProviderMessagePayload, validateProviderEvidencePayload } from "./provider-response-normalizer.mjs";
import { normalizeProviderUsage } from "./provider-usage.mjs";

const provider = visionProviderIds.GEMINI;
const recognizedStatuses = new Set(["CONFIRMED", "RESOLVED", "ABSTAIN"]);
export const geminiFormatErrorTypes = Object.freeze({
  JSON_SYNTAX_INVALID: "JSON_SYNTAX_INVALID",
  SCHEMA_INVALID: "SCHEMA_INVALID",
  EMPTY_OR_BLOCKED: "EMPTY_OR_BLOCKED",
  PROVIDER_ERROR: "PROVIDER_ERROR"
});
const legacyFieldNames = Object.freeze([
  "category",
  "standardness",
  "route",
  "multi_card",
  "card_count",
  "lot_type",
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "players",
  "player",
  "character",
  "team",
  "artist",
  "card_type",
  "insert",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "card_number",
  "checklist_code",
  "attributes",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "sketch",
  "redemption",
  "one_of_one",
  "grade_company",
  "grade",
  "card_grade",
  "auto_grade",
  "grade_type"
]);
const schemaFieldNames = Object.freeze([
  "category",
  "standardness",
  "multi_card",
  "card_count",
  "lot_type",
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "players",
  "character",
  "artist",
  "team",
  "card_type",
  "insert",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "attributes",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "sketch",
  "redemption",
  "one_of_one",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);
const structuredFieldEvidenceNames = Object.freeze([
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "players",
  "subject",
  "character",
  "team",
  "card_type",
  "insert",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "one_of_one"
]);
const highResolutionRegions = new Set([
  "serial_number",
  "collector_number",
  "checklist_code",
  "grade_label",
  "year_product",
  "subject_name",
  "subject_slot_1",
  "subject_slot_2",
  "subject_slot_3",
  "card_type",
  "parallel_surface",
  "parallel",
  "autograph",
  "patch_relic"
]);
const maxGeminiImages = 8;

const geminiExtractionGuide = [
  "Gemini extraction guide:",
  "You are only extracting visible card evidence. You are not the final truth solver and you are not the title renderer.",
  "Fill every field that is directly readable or visually clear. Missing serial, grade, or exact parallel must not erase visible year, product, set, or players.",
  "If a field is uncertain, leave only that field empty and add a precise unresolved note. Keep other visible fields populated.",
  "Every fields.* value must be only the canonical value for that field. Never put explanations, notes, evidence descriptions, or full title text inside fields.*.",
  "If a slab label is visible, read the slab label first. Map readable slab label text directly into year, product, players, collector_number/checklist_code, grade_company, card_grade, grade_type, insert, variation, and auto.",
  "The upper slab label often contains more reliable identity than the card art. Zoom your attention to that label before reading the full card.",
  "Never return only a year when a slab label also contains product, person, grade, or card number.",
  "Slab mapping example: PSA label text '2018 TOPPS CHROME / SHOHEI OHTANI / 1983 TOPPS / #83T-6 / GEM MT 10' means year '2018', product 'Topps Chrome', players ['Shohei Ohtani'], insert '1983 Topps', collector_number '83T-6', grade_company 'PSA', card_grade '10', grade_type 'CARD_ONLY', rc true when RC logo or rookie text is visible.",
  "Slab mapping example: PSA label text '2020 CONTENDERS / ANTHONY EDWARDS / VARIATION-AUTOGRAPH / #105 / GEM MT 10' means year '2020', product 'Contenders', players ['Anthony Edwards'], variation 'Variation Autograph', auto true, collector_number '105', grade_company 'PSA', card_grade '10', grade_type 'CARD_ONLY'.",
  "If you leave any core field empty while readable label/card text exists, add a short unresolved note naming the missing field and image region. Do not transcribe long text, legal/copyright lines, or repeated boilerplate.",
  "recognition_status meaning:",
  "- CONFIRMED: year/product/subject are directly visible or strongly supported and no critical conflict is visible.",
  "- RESOLVED: core identity is visible, but at least one non-blocking field needs review.",
  "- ABSTAIN: product or subject is unreadable, multiple cards are mixed, image quality prevents core identity, or critical fields conflict.",
  "Prefer field evidence over title prose. Do not generate title, model_title_suggestion, or reason; deterministic code will render and explain from fields.",
  "For product, include the card product family such as Panini Prizm, Topps Chrome, Topps Sapphire, Bowman Chrome, Donruss Optic, Select, Mosaic, Immaculate, National Treasures, etc.",
  "For set/subset/insert, preserve visible insert or subset text such as Club Legends, Rookie Ticket, Spotlight, Kaboom, Color Blast, Downtown, Prizm Break, or Power Chords.",
  "For players, return only athlete/person/character names visible on the card or slab. Never put copyright, legal, trademark, design, brand elements, manufacturer boilerplate, or sentence fragments in players.",
  "For year, preserve season formats exactly when visible, e.g. 2025-26. Do not convert season years to one-year shorthand.",
  "For serial_number, return only complete visible stamped serials like 29/199, 01/10, or 1/1. If any digit is unclear, leave serial_number empty.",
  "For parallel, use exact wording only when printed/slab/checklist evidence or an unmistakable card-design color/pattern is visible; otherwise use surface_color or leave parallel empty.",
  "For every non-empty high-risk field, also fill field_evidence using the same provider-agnostic evidence contract as GPT.",
  "field_evidence keys must use field names such as year, product, players, card_type, parallel_exact, surface_color, serial_number, collector_number, checklist_code, grade, rc, and auto.",
  "Use canonical fields only: players not player, collector_number/checklist_code not card_number, card_grade not grade.",
  "Each field_evidence entry should be compact: include only value, source_type/source_region when useful, one short raw_text or visible_text snippet, direct_observation/directly_observed, confidence, and review_required.",
  "Do not dump OCR lines into field_evidence. Keep field_evidence to the few fields that support non-empty high-risk values, normally 4-8 entries.",
  "Use the same modular extraction order for every model: Year -> Franchise/Brand -> Product/Set -> Subject -> Card Type -> Variant/Parallel/Rarity -> Number/Serial/Grade.",
  "Keep module boundaries strict: player names never go in product/set, serial numbers never go in grade, grade labels never go in checklist_code, and color-only observations should be surface_color unless exact parallel wording is directly visible.",
  "field_evidence.year.support_type must be SLAB_LABEL, CARD_BACK_PRINTED_TEXT, CARD_FRONT_PRINTED_TEXT, VISION_ONLY, or NONE.",
  "field_evidence.grade must only be filled from a readable slab label. Do not structure grade from a loose visual guess.",
  "field_evidence.rc.value may be true only when RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, or slab/card text is visible.",
  "field_evidence.auto.value may be true only when Auto/Autograph/Signature/Signed text or an actual signature is visible.",
  "Set confidence LOW only when core identity is missing or contradicted. Missing serial alone should not force LOW if year/product/player are visible."
].join("\n");

function numberFromEnv(env, key, fallback = undefined) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function geminiConfigFromEnv(env = process.env) {
  const model = providerModelConfig(provider, env.GEMINI_MODEL);

  return {
    apiKey: env.GEMINI_API_KEY || "",
    model: model.model_id || defaultProviderModels[provider],
    modelAllowed: model.allowed,
    timeoutMs: numberFromEnv(env, "GEMINI_TIMEOUT_MS", 35000),
    maxOutputTokens: numberFromEnv(env, "GEMINI_MAX_OUTPUT_TOKENS", 4096),
    truncationRetryMaxOutputTokens: numberFromEnv(env, "GEMINI_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS", 8192),
    maxRetries: numberFromEnv(env, "GEMINI_MAX_RETRIES", 0),
    retryBaseDelayMs: numberFromEnv(env, "GEMINI_RETRY_BASE_DELAY_MS", 1500),
    formatRepairMaxOutputTokens: numberFromEnv(
      env,
      "GEMINI_FORMAT_REPAIR_MAX_OUTPUT_TOKENS",
      numberFromEnv(env, "GEMINI_MAX_OUTPUT_TOKENS", 4096)
    ),
    textRepairEnabled: env.GEMINI_TEXT_FORMAT_REPAIR_ENABLED !== "0",
    temperature: numberFromEnv(env, "GEMINI_TEMPERATURE", 0),
    apiVersion: String(env.GEMINI_API_VERSION || "").trim()
  };
}

export function createGeminiClient({ apiKey }) {
  return new GoogleGenAI({ apiKey });
}

function scalarFieldSchema(fieldName) {
  if (fieldName === "multi_card"
    || fieldName === "rc"
    || fieldName === "first_bowman"
    || fieldName === "ssp"
    || fieldName === "case_hit"
    || fieldName === "auto"
    || fieldName === "patch"
    || fieldName === "relic"
    || fieldName === "sketch"
    || fieldName === "redemption"
    || fieldName === "one_of_one") {
    return { type: "boolean" };
  }

  if (fieldName === "card_count") {
    return {
      type: "integer",
      minimum: 1
    };
  }

  if (fieldName === "players" || fieldName === "attributes") {
    return {
      type: "array",
      maxItems: fieldName === "players" ? 6 : 8,
      items: { type: "string", maxLength: 80 }
    };
  }

  if (fieldName === "grade_type") {
    return {
      type: "string",
      enum: ["CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN", ""]
    };
  }

  return {
    type: "string",
    maxLength: 160
  };
}

function geminiStructuredFieldEvidenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    maxProperties: 12,
    properties: {
      value: {
        type: "string",
        maxLength: 160
      },
      grade_company: {
        type: "string",
        maxLength: 32
      },
      card_grade: {
        type: "string",
        maxLength: 32
      },
      auto_grade: {
        type: "string",
        maxLength: 32
      },
      grade_type: {
        type: "string",
        enum: ["CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN", ""]
      },
      support_type: {
        type: "string",
        enum: [
          "SLAB_LABEL",
          "CARD_BACK_PRINTED_TEXT",
          "CARD_FRONT_PRINTED_TEXT",
          "VISIBLE_SIGNATURE",
          "VISION_ONLY",
          "STRUCTURED_DATABASE",
          "OFFICIAL_CHECKLIST",
          "NONE",
          ""
        ]
      },
      evidence_type: {
        type: "string",
        enum: [
          "SLAB_LABEL",
          "CARD_BACK_PRINTED_TEXT",
          "CARD_FRONT_PRINTED_TEXT",
          "VISIBLE_SIGNATURE",
          "VISION_ONLY",
          "STRUCTURED_DATABASE",
          "OFFICIAL_CHECKLIST",
          "NONE",
          ""
        ]
      },
      evidence_kind: {
        type: "string",
        enum: [
          "YEAR_TEXT",
          "COPYRIGHT_YEAR",
          "SEASON_YEAR",
          "GRADE_LABEL",
          "PRODUCT_TEXT",
          "SUBJECT_TEXT",
          "CARD_TYPE_TEXT",
          "SERIAL_STAMP",
          "CARD_NUMBER_TEXT",
          "CHECKLIST_CODE_TEXT",
          "PARALLEL_TEXT",
          "SURFACE_COLOR",
          "RC_LOGO",
          "ROOKIE_TEXT",
          "ROOKIE_TICKET",
          "RATED_ROOKIE",
          "AUTO_TEXT",
          "SIGNATURE",
          "NONE",
          ""
        ]
      },
      visible_text: { type: "string", maxLength: 160 },
      raw_text: { type: "string", maxLength: 160 },
      source_type: { type: "string", maxLength: 64 },
      source_image_id: { type: "string", maxLength: 64 },
      source_region: { type: "string", maxLength: 64 },
      region: { type: "string", maxLength: 64 },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1
      },
      review_required: { type: "boolean" },
      visible_marker: { type: "boolean" },
      signature_visible: { type: "boolean" },
      text_visible: { type: "boolean" },
      direct_observation: { type: "boolean" },
      directly_observed: { type: "boolean" },
      uncertain_characters: {
        type: "array",
        maxItems: 6,
        items: { type: "string", maxLength: 8 }
      },
      unresolved_reason: { type: "string", maxLength: 160 }
    }
  };
}

function geminiFieldEvidenceSchema() {
  const entry = geminiStructuredFieldEvidenceSchema();
  return {
    type: "object",
    maxProperties: 12,
    additionalProperties: entry
  };
}

export function geminiProviderResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      recognition_status: {
        type: "string",
        enum: ["CONFIRMED", "RESOLVED", "ABSTAIN"]
      },
      error_type: {
        type: "string",
        enum: ["", "UNCERTAIN_FIELD", "MULTI_CARD", "UNREADABLE_IMAGE", "SCHEMA_UNCERTAIN", "SAFETY_BLOCKED"]
      },
      fields: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(schemaFieldNames.map((fieldName) => [
          fieldName,
          scalarFieldSchema(fieldName)
        ]))
      },
      field_evidence: geminiFieldEvidenceSchema(),
      unresolved: {
        type: "array",
        maxItems: 8,
        items: { type: "string", maxLength: 160 }
      }
    },
    required: ["recognition_status", "fields", "unresolved"]
  };
}

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1] || "image/jpeg",
    data: match[2]
  };
}

function inferImageMimeType(image = {}, url = "") {
  const explicit = image.mimeType || image.mime_type || image.contentType || image.content_type;
  if (explicit) return String(explicit);

  const name = `${image.name || ""} ${url || ""}`.toLowerCase();
  if (/\.(?:png)(?:$|[?#])/.test(name)) return "image/png";
  if (/\.(?:webp)(?:$|[?#])/.test(name)) return "image/webp";
  if (/\.(?:gif)(?:$|[?#])/.test(name)) return "image/gif";
  return "image/jpeg";
}

function sideLabelForImage(image = {}, index) {
  const raw = String(image.side || image.role || image.captureRole || image.capture_role || "").trim().toLowerCase();
  if (raw.includes("back")) return "back";
  if (raw.includes("front")) return "front";
  return index === 0 ? "front_or_primary" : "back_or_secondary";
}

function cropMetadataForImage(image = {}) {
  return image.cropMetadata || image.crop_metadata || image.cropPlan?.crop_metadata || image.crop_plan?.crop_metadata || null;
}

function regionForImage(image = {}) {
  const metadata = cropMetadataForImage(image);
  return String(
    image.sourceRegion
    || image.source_region
    || metadata?.source_region
    || image.storageRole
    || image.storage_role
    || image.role
    || ""
  ).trim().toLowerCase();
}

function resolutionForGeminiImage(image = {}) {
  const explicit = String(image.geminiResolution || image.gemini_resolution || image.resolution || "").trim().toLowerCase();
  if (["low", "medium", "high", "ultra_high"].includes(explicit)) return explicit;
  const region = regionForImage(image);
  if (image.derived === true || cropMetadataForImage(image)) return "high";
  if ([...highResolutionRegions].some((item) => region === item || region.includes(item))) return "high";
  const side = sideLabelForImage(image, 0);
  if (side === "front" || side === "back") return "high";
  return "";
}

function validateGeminiImages(images = []) {
  if (!Array.isArray(images) || images.length < 1) {
    throw providerInputUnsupported(provider, "Gemini requires at least one card image.");
  }

  if (images.length > maxGeminiImages) {
    throw providerInputUnsupported(provider, `Gemini initial recognition accepts at most ${maxGeminiImages} images including front, back, and targeted field crops.`);
  }

  return images.map((image, index) => {
    const dataUrl = image?.dataUrl || image?.data_url || "";
    const parsedDataUrl = parseDataUrl(dataUrl);
    const resolution = resolutionForGeminiImage(image);
    if (parsedDataUrl) {
      return {
        label: sideLabelForImage(image, index),
        content: {
          type: "image",
          data: parsedDataUrl.data,
          mime_type: parsedDataUrl.mimeType,
          ...(resolution ? { resolution } : {})
        }
      };
    }

    const uri = imageUrlForProvider(image);
    if (uri) {
      return {
        label: sideLabelForImage(image, index),
        content: {
          type: "image",
          uri,
          mime_type: inferImageMimeType(image, uri),
          ...(resolution ? { resolution } : {})
        }
      };
    }

    throw providerInputUnsupported(provider, `Gemini image ${index + 1} has no data URL or image URL.`);
  });
}

export function buildGeminiInteractionRequest({
  prompt,
  images,
  model,
  temperature,
  maxOutputTokens,
  apiVersion = ""
}) {
  const imageBlocks = validateGeminiImages(images);
  const input = [
    {
      type: "text",
      text: [
        geminiExtractionGuide,
        "",
        "Task-specific prompt:",
        prompt,
        "",
        "Gemini provider contract:",
        "Return one JSON object matching the supplied response_format schema.",
        "Only return fields, field_evidence, unresolved, recognition_status, and optional error_type.",
        "Do not use ABSTAIN as a reason to omit other fields that are visible.",
        "Do not generate title, model_title_suggestion, route, reason, or repeated title phrases.",
        "Use canonical fields only: players not player, collector_number/checklist_code not card_number, card_grade not grade.",
        "Keep JSON compact. Do not include long OCR dumps, legal text, copyright text, or duplicate evidence.",
        "Do not invent missing year, player, serial, grade, product, or exact parallel values.",
        "If ABSTAIN, keep only uncertain fields empty and list every uncertain field in unresolved."
      ].join("\n")
    },
    ...imageBlocks.flatMap((image, index) => [
      {
        type: "text",
        text: `Image ${index + 1}: ${image.label}. Use this side label only as capture context.`
      },
      image.content
    ])
  ];

  return {
    ...(apiVersion ? { api_version: apiVersion } : {}),
    model,
    store: false,
    input,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: geminiProviderResponseSchema()
    },
    generation_config: {
      temperature,
      max_output_tokens: maxOutputTokens
    }
  };
}

export function buildGeminiFormatRepairRequest({
  rawContent,
  model,
  maxOutputTokens,
  apiVersion = ""
}) {
  return {
    ...(apiVersion ? { api_version: apiVersion } : {}),
    model,
    store: false,
    input: [
      {
        type: "text",
        text: [
          "You repair malformed JSON from a previous Gemini card-recognition response.",
          "Return exactly one JSON object matching response_format.",
          "Do not add, remove, reinterpret, or improve card identity values.",
          "Only fix JSON syntax, field types, and missing empty schema scaffolding.",
          "Allowed empty scaffolding: empty strings, empty arrays, null values.",
          "No images are provided in this repair request.",
          "",
          "Original Gemini text:",
          String(rawContent || "").slice(0, 20000)
        ].join("\n")
      }
    ],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: geminiProviderResponseSchema()
    },
    generation_config: {
      temperature: 0,
      max_output_tokens: maxOutputTokens
    }
  };
}

export function geminiVisibleTextResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      confidence: {
        type: "string",
        enum: ["HIGH", "MEDIUM", "LOW", "FAILED"]
      },
      visible_text_lines: {
        type: "array",
        maxItems: 24,
        items: { type: "string", maxLength: 120 }
      },
      unresolved: {
        type: "array",
        maxItems: 8,
        items: { type: "string" }
      }
    },
    required: ["confidence", "visible_text_lines", "unresolved"]
  };
}

export function buildGeminiVisibleTextRequest({
  prompt,
  images,
  model,
  temperature,
  maxOutputTokens,
  apiVersion = ""
}) {
  const imageBlocks = validateGeminiImages(images);
  return {
    ...(apiVersion ? { api_version: apiVersion } : {}),
    model,
    store: false,
    input: [
      {
        type: "text",
        text: [
          "Transcribe visible printed card or slab text lines only.",
          "Do not infer card identity. Do not write a listing title.",
          "If a PSA/BGS/SGC/CGC label is visible, transcribe each label line separately before card art text.",
          "Keep exact words, numbers, # codes, grades, and line order when readable.",
          "If a line is unreadable, omit it and add a short unresolved note.",
          "",
          prompt || ""
        ].join("\n")
      },
      ...imageBlocks.flatMap((image, index) => [
        {
          type: "text",
          text: `Image ${index + 1}: ${image.label}.`
        },
        image.content
      ])
    ],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: geminiVisibleTextResponseSchema()
    },
    generation_config: {
      temperature,
      max_output_tokens: maxOutputTokens
    }
  };
}

function extractInteractionText(interaction = {}) {
  if (typeof interaction.output_text === "string") return interaction.output_text;
  if (Array.isArray(interaction.steps)) {
    const textParts = [];
    let collecting = false;
    outer: for (let index = interaction.steps.length - 1; index >= 0; index -= 1) {
      const step = interaction.steps[index];
      if (step?.type === "user_input") break;
      if (step?.type !== "model_output" || !Array.isArray(step.content)) {
        if (collecting) break;
        continue;
      }
      for (let contentIndex = step.content.length - 1; contentIndex >= 0; contentIndex -= 1) {
        const item = step.content[contentIndex];
        if (item?.type === "text") {
          collecting = true;
          textParts.push(item.text || "");
        } else if (collecting) {
          break outer;
        }
      }
    }
    const output = textParts.reverse().join("").trim();
    if (output) return output;
  }
  const chunks = [];
  const visit = (value, depth = 0) => {
    if (depth > 7 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.trim()) chunks.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    if (typeof value.text === "string") chunks.push(value.text);
    visit(value.output, depth + 1);
    visit(value.outputs, depth + 1);
    visit(value.content, depth + 1);
    visit(value.contents, depth + 1);
    visit(value.parts, depth + 1);
  };
  visit(interaction.steps || []);
  return chunks.join("\n");
}

function normalizeRecognitionStatus(parsed = {}) {
  const status = String(parsed.recognition_status || "").trim().toUpperCase();
  if (!recognizedStatuses.has(status)) {
    throw providerSchemaError(provider, "Gemini response must include recognition_status CONFIRMED, RESOLVED, or ABSTAIN.");
  }
  return status;
}

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripExplanationTail(value) {
  return collapseWhitespace(value)
    .split(/\b(?:Note:|Reason:|Explanation:|Evidence:|The card|This card|Card back|Card front|Back text|Front text|Based on|Despite|Because|It appears|It looks|I can|I cannot)\b/i)[0]
    .split(/\s+\((?:back|front|card|copyright|season)\b/i)[0]
    .split(/[.;]\s+/)[0]
    .trim();
}

function stripRepeatedPhrases(value) {
  const text = collapseWhitespace(value);
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const seen = new Set();
  const deduped = sentences.filter((sentence) => {
    const key = sentence.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.join(" ").trim();
}

function fieldLooksExplanatory(value) {
  const text = collapseWhitespace(value);
  if (!text) return false;
  if (text.length > 90 && /\b(?:note|reason|states?|stated|visible|copyright|provided|based on|despite|because|unclear|uncertain|appears|looks|release)\b/i.test(text)) {
    return true;
  }
  return text.length > 120 || (/[.!?]/.test(text) && text.length > 70);
}

function firstYearFromText(value) {
  const text = collapseWhitespace(value);
  const matches = [...text.matchAll(/\b(?:19|20)\d{2}(?:[-/]\d{2})?\b/g)].map((match) => match[0].replace("/", "-"));
  if (!matches.length) return "";
  return matches.find((year) => /-\d{2}$/.test(year)) || matches[0];
}

function firstSerialFromText(value) {
  const text = collapseWhitespace(value);
  const match = text.match(/\b(?:0?\d{1,4}|1)\s*\/\s*(?:0?\d{1,4}|1)\b/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

function firstGradeFromText(value) {
  const text = collapseWhitespace(value);
  const labelMatch = text.match(/\b(?:GEM\s*MT|MINT|NM-MT|MT|BGS|PSA|SGC|CGC|GRADE|AUTO\s+GRADE|AUTOGRAPH\s+GRADE)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|AUTHENTIC)\b/i);
  if (labelMatch) return labelMatch[1].toUpperCase();
  const match = text.match(/\b(?:10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|AUTHENTIC)\b/i);
  return match ? match[0].toUpperCase() : "";
}

function cleanGradeValue(value) {
  const text = collapseWhitespace(value).toUpperCase();
  if (!text || /\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(text)) return "";
  const grade = firstGradeFromText(text);
  if (!grade) return "";
  return /^(?:10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|AUTHENTIC)$/.test(grade) ? grade : "";
}

function cleanGradeCompany(value) {
  const text = collapseWhitespace(value).toUpperCase();
  const match = text.match(/\b(PSA|BGS|SGC|CGC|TAG|ISA|HGA|CSG)\b/);
  return match ? match[1] : "";
}

function firstChecklistCodeFromText(value) {
  const text = collapseWhitespace(value);
  const matches = [...text.matchAll(/\b[A-Z]{1,8}-[A-Z0-9]{1,12}\b/g)]
    .map((match) => match[0].replace(/\s+/, "-").toUpperCase())
    .filter((candidate) => !invalidChecklistCode(candidate));
  return matches[0] || "";
}

function firstCollectorNumberFromText(value) {
  const text = collapseWhitespace(value);
  const match = text.match(/#\s*([A-Z0-9-]{1,16})\b/i);
  const candidate = match ? match[1].toUpperCase() : "";
  return invalidChecklistCode(candidate) ? "" : candidate;
}

function invalidChecklistCode(value) {
  const text = collapseWhitespace(value).toUpperCase();
  if (!text) return true;
  if (/^(?:NM-MT|GEM-MT|GEM|MINT|MT|AUTHENTIC|AUTO|AUTOGRAPH|SIGNATURE)$/.test(text)) return true;
  if (/^(?:PSA|BGS|SGC|CGC|TAG|ISA|HGA|CSG)$/.test(text)) return true;
  if (/^(?:PSA|BGS|SGC|CGC|TAG|ISA|HGA|CSG)[-\s]?(?:10|9\.5|9|8\.5|8|AUTHENTIC)$/.test(text)) return true;
  if (/^(?:GAME|PLAYER|MATCH|EVENT|RACE|FIGHT|SCREEN|PHOTO|PIECE|PATCH|JERSEY|MEMORABILIA)-(?:USED|WORN|ISSUED|MATERIAL|RELIC)$/.test(text)) return true;
  if (/^(?:GAME|PLAYER)-USED$/.test(text)) return true;
  return false;
}

function cleanCodeLikeValue(value, maxLength = 30) {
  const text = compactFieldValue(value, { maxLength });
  if (!text) return "";
  const normalized = text.replace(/\s+/g, "").replace(/^#/, "");
  return invalidChecklistCode(normalized) ? "" : normalized.toUpperCase();
}

const productFamilyPatterns = Object.freeze([
  /\bPanini\s+Prizm(?:\s+(?:FIFA\s+Soccer|Football|Basketball|Baseball))?\b/i,
  /\bPanini\s+Select\b/i,
  /\bPanini\s+Mosaic\b/i,
  /\b(?:Panini\s+)?Contenders(?:\s+Optic)?\b/i,
  /\bPanini\s+Black(?:\s+Football)?\b/i,
  /\bPanini\s+Donruss\s+Optic(?:\s+Football)?\b/i,
  /\bDonruss\s+Optic(?:\s+Football)?\b/i,
  /\bDonruss\s+Optic\b/i,
  /\bPanini\s+National\s+Treasures\b/i,
  /\bNational\s+Treasures\b/i,
  /\bPanini\s+Immaculate\b/i,
  /\bPanini\s+Impeccable\b/i,
  /\bPanini\s+Absolute(?:\s+Memorabilia)?\b/i,
  /\bPanini\s+Flawless\b/i,
  /\bPanini\s+Chronicles\b/i,
  /\bPanini\s+Hoops(?:\s+Basketball)?\b/i,
  /\bNBA\s+Hoops\b/i,
  /\bTopps\s+Chrome\s+UEFA(?:\s+(?:Club\s+Competitions|Champions\s+League))?\b/i,
  /\bTopps\s+(?:Star\s+Wars\s+)?Chrome\s+Black\b/i,
  /\bTopps\s+Chrome(?:\s+Sapphire)?(?:\s+Update)?\b/i,
  /\bTopps\s+Sapphire\b/i,
  /\bTopps\s+Finest\b/i,
  /\bTopps\s+Heritage(?:\s+High\s+Number)?\b/i,
  /\bTopps\s+Stadium\s+Club(?:\s+Chrome)?\b/i,
  /\bTopps\s+Cosmic\s+Chrome\b/i,
  /\bBowman\s+Chrome(?:\s+Draft)?\b/i,
  /\bBowman\s+Draft\b/i,
  /\bTopps\s+Triple\s+Threads\b/i,
  /\bTriple\s+Threads\b/i,
  /\bUpper\s+Deck\b/i,
  /\bUpper\s+Deck\s+(?:NFL\s+)?Draft\s+Edition\b/i,
  /\bO-Pee-Chee(?:\s+Platinum)?\b/i,
  /\bFleer\s+Ultra\b/i,
  /\bFleer\s+Legacy\b/i,
  /\bFleer\s+Greats(?:\s+of\s+the\s+Game)?\b/i,
  /\bGreats\s+of\s+the\s+Game\b/i,
  /\bSkybox\b/i,
  /\bCardsmiths\s+Street\s+Fighter\s+Alpha\b/i,
  /\bStreet\s+Fighter\s+Alpha\b/i,
  /\bPokemon\b|\bPokémon\b/i
]);
const productIssuerPattern = /\b(?:Panini|Topps|Bowman|Donruss|Upper Deck|Fleer|Skybox|Leaf|Score)\b[\w&'./ -]{0,90}/i;

function cleanProductCandidate(value) {
  let text = stripExplanationTail(value)
    .replace(/\b(?:19|20)\d{2}(?:[-/]\d{2})?\b/g, " ")
    .replace(/\b(Panini|Topps|Bowman|Donruss)\s*[-–]\s*/gi, "$1 ")
    .replace(/\b(?:copyright|season|release|back|front|text|stated|states|provided|listed|below|block)\b.*$/i, " ")
    .replace(/\s*[-,:]\s*$/g, " ");
  text = collapseWhitespace(text).replace(/^[,;:-]+|[,;:-]+$/g, "").trim();
  if (!text || text.length > 90) return "";
  if (/[a-z]/.test(text)) return text.replace(/\bFifa\b/g, "FIFA").replace(/\bNba\b/g, "NBA");
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((part) => {
      if (part === "fifa") return "FIFA";
      if (part === "nba") return "NBA";
      if (part === "mlb") return "MLB";
      return part ? part[0].toUpperCase() + part.slice(1) : "";
    })
    .join(" ")
    .trim();
}

function productMatchFromText(value) {
  const text = collapseWhitespace(value);
  for (const pattern of productFamilyPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        value: cleanProductCandidate(match[0]),
        index: match.index ?? -1,
        end: (match.index ?? 0) + match[0].length
      };
    }
  }
  const match = text.match(productIssuerPattern);
  return match
    ? {
      value: cleanProductCandidate(match[0]),
      index: match.index ?? -1,
      end: (match.index ?? 0) + match[0].length
    }
    : null;
}

function productFromText(value) {
  return productMatchFromText(value)?.value || "";
}

const genericProductTokens = new Set([
  "absolute",
  "black",
  "chrome",
  "contenders",
  "draft",
  "finest",
  "greats",
  "heritage",
  "hoops",
  "impeccable",
  "impeccable soccer",
  "legacy",
  "mosaic",
  "optic",
  "prizm",
  "sapphire",
  "select",
  "stadium club",
  "triple threads"
]);

function productSpecificityScore(value) {
  const text = collapseWhitespace(value).toLowerCase();
  if (!text) return 0;
  let score = text.split(/\s+/).filter(Boolean).length;
  if (/\b(?:panini|topps|bowman|donruss|upper deck|fleer|cardsmiths)\b/i.test(text)) score += 2;
  if (/\b(?:fifa|uefa|football|basketball|baseball|soccer|chrome|sapphire|draft|heritage|high number|memorabilia|greats of the game)\b/i.test(text)) score += 1;
  return score;
}

function shouldPreferRicherProduct(currentValue, candidateValue) {
  const current = cleanProductCandidate(currentValue);
  const candidate = cleanProductCandidate(candidateValue);
  if (!candidate) return false;
  if (!current) return true;
  const currentKey = current.toLowerCase();
  const candidateKey = candidate.toLowerCase();
  if (currentKey === candidateKey) return false;
  if (genericProductTokens.has(currentKey) && candidateKey.includes(currentKey)) return true;
  if (candidateKey.endsWith(` ${currentKey}`) || candidateKey.includes(` ${currentKey} `)) return true;
  return productSpecificityScore(candidate) >= productSpecificityScore(current) + 2
    && candidateKey.includes(currentKey.split(/\s+/).at(-1) || currentKey);
}

function insertFromText(value) {
  const text = collapseWhitespace(value);
  const patterns = [
    /\bRookie\s+Ticket\b/i,
    /\bRated\s+Rookie\b/i,
    /\bNext\s+Stop\s+Signatures\b/i,
    /\bCanvas\s+Creations(?:\s+Autos?)?\b/i,
    /\bHoopla(?:\s+(?:Signatures|Material\s+Signatures))?\b/i,
    /\bSignature\s+Shots\b/i,
    /\bMetallic\s+Marks\b/i,
    /\bAll\s+Kings\b/i,
    /\bThrough\s+(?:the\s+)?Years\b/i,
    /\bHistoric\s+Ties(?:\s+Triple)?\b/i,
    /\bClub\s+Legends\b/i,
    /\bGusto\b/i,
    /\bPrizm\s+Break\b/i,
    /\bPower\s+Chords\b/i,
    /\b1983\s+Topps\b/i,
    /\bChrome\s+Prospect\s+Autograph\b/i,
    /\bProspect\s+Autograph\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return cleanProductCandidate(match[0]);
  }
  return "";
}

function cardTypeFromText(value) {
  const text = collapseWhitespace(value);
  if (/\b(?:patch|jersey|relic|memorabilia|material|game-used|player-worn|game-worn)\b/i.test(text)) {
    if (/\b(?:auto|autograph|signature|signed)\b/i.test(text)) return "Auto Relic";
    return "Relic";
  }
  if (/\b(?:auto|autograph|signature|signed)\b/i.test(text)) return "Autograph";
  if (/\b(?:insert|case hit|ssp|short print)\b/i.test(text)) return "Insert";
  return "";
}

const parallelPatterns = Object.freeze([
  /\bViolet\s+Speckle\s+Refractor\b/i,
  /\bBlue\s+Hyper\s+Prizm\b/i,
  /\bRed\s+Sparkle\b/i,
  /\bDark\s+Blue\s+Bordered\b/i,
  /\bFirst\s+Day\s+Issue\b/i,
  /\bSparkles?\s+Refractor\b/i,
  /\bGold\s+Refractor\b/i,
  /\bRed\s+Refractor\b/i,
  /\bGreen\s+Refractor\b/i,
  /\bPurple\s+Refractor\b/i,
  /\bPurple\s+Wave\b/i,
  /\bPurple\s+Shimmer\b/i,
  /\bOrange\s+Refractor\b/i,
  /\bBlack\s+Refractor\b/i,
  /\bHolo\s+Prizm\b/i,
  /\bSilver\s+Prizm\b/i
]);

function parallelFromText(value) {
  const text = collapseWhitespace(value);
  for (const pattern of parallelPatterns) {
    const match = text.match(pattern);
    if (match) return cleanProductCandidate(match[0]);
  }
  return "";
}

function surfaceColorFromParallel(value) {
  const text = collapseWhitespace(value);
  const match = text.match(/\b(Gold|Red|Blue|Green|Purple|Orange|Black|Silver|White|Yellow|Violet|Sapphire)\b/i);
  return match ? cleanProductCandidate(match[1]) : "";
}

function compactFieldValue(value, {
  maxLength = 80,
  allowSentence = false
} = {}) {
  let text = stripExplanationTail(stripRepeatedPhrases(value));
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!text) return "";
  if (!allowSentence && fieldLooksExplanatory(text)) return "";
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function cleanNameList(value) {
  const values = Array.isArray(value)
    ? value
    : collapseWhitespace(value)
      ? collapseWhitespace(value).split(/\s*[/,;]\s*/)
      : [];
  return values
    .map((item) => cleanPersonCandidate(item))
    .filter((item) => item && !fieldLooksExplanatory(item))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 6);
}

function cleanPersonCandidate(value) {
  let text = compactFieldValue(value, { maxLength: 80 })
    .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b.*$/i, "")
    .replace(/\b(?:PSA|BGS|SGC|CGC|GEM\s*MT|MINT|NM-MT|AUTHENTIC)\b.*$/i, "")
    .replace(/^(?:Basketball|Baseball|Football|Soccer|Hockey|FIFA|NBA|MLB|NFL|NHL|Gusto|Club\s+Legends|Rookie\s+Ticket|Next\s+Stop\s+Signatures|Canvas\s+Creations|Hoopla(?:\s+Material\s+Signatures)?|Material\s+Signatures|Variation[-\s]*Autograph)\s*,?\s+/i, "")
    .replace(/[, ]+\b(?:Next\s+Stop\s+Signatures|Club\s+Legends|Rookie\s+Ticket|Canvas\s+Creations|Hoopla(?:\s+Material\s+Signatures)?|Material\s+Signatures|Variation[-\s]*Autograph)\b.*$/i, "")
    .replace(/\s+\b(?:Gold|Red|Blue|Green|Purple|Orange|Black|Silver|White|Yellow|Sapphire|Refractor|Prizm|Wave|Shimmer|Mojo|Cracked\s+Ice|Geometric|Variation|Auto|Autograph|Signatures?|Rookie|RC)\b.*$/i, "")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  text = collapseWhitespace(text);
  if (isInvalidPersonName(text)) return "";
  return titleCaseName(text);
}

function titleCaseName(value) {
  const text = collapseWhitespace(value);
  if (!text) return "";
  if (/[a-z]/.test(text)) return text;
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part
      .split("-")
      .map((chunk) => chunk ? chunk[0].toUpperCase() + chunk.slice(1) : "")
      .join("-"))
    .join(" ");
}

function isInvalidPersonName(value) {
  const text = collapseWhitespace(value);
  const productCandidate = productFromText(text);
  return !text
    || /\b(?:copyright|trademark|legal|rights?|brand\s+elements?|designs?|trad(?:e)?|manufacturer|boilerplate|year|season|release|card|label|front|back|text|product|unknown|unreadable|unclear|visible|player|athlete|subject)\b/i.test(text)
    || /^visible[_\s-]*text$/i.test(text)
    || /^#?[A-Z0-9]{1,8}-[A-Z0-9]{1,12}$/i.test(text)
    || /^(?:Rated|Rookie|Refractor|Prizm|Holo|Hyper|Speckle|Sparkle|Wave|Shimmer|Mojo|Silver|Gold|Red|Blue|Green|Purple|Orange|Black|White|Yellow|Violet|Sapphire)(?:\s+(?:Rated|Rookie|Refractor|Prizm|Holo|Hyper|Speckle|Sparkle|Wave|Shimmer|Mojo|Silver|Gold|Red|Blue|Green|Purple|Orange|Black|White|Yellow|Violet|Sapphire))*$/i.test(text)
    || /^(?:Autos?|Autographs?|Certified|Topps\s+Certified|Club\s+Legends|Historic\s+Ties(?:\s+Triple)?|Rookie\s+Ticket|Next\s+Stop\s+Signatures|Canvas\s+Creations(?:\s+Autos?)?|Hoopla|Material\s+Signatures|Variation[-\s]*Autograph|1983\s+Topps|Gem\s*Mt|Mint|Jersey|Patch|Relic|Material|Memorabilia|Prizm|Topps\s+Chrome|Panini)$/i.test(text)
    || (productCandidate && productCandidate.toLowerCase() === cleanProductCandidate(text).toLowerCase())
    || /^(?:FC|AFC|CF|SC)\b/i.test(text)
    || /\b(?:FC|AFC|CF|SC|Barcelona|Angels|Yankees|Dodgers|Lakers|Celtics|Warriors|Bulls|Chiefs|Patriots|Cowboys)\b/i.test(text)
    || /^(?:Basketball|Baseball|Football|Soccer|Hockey|FIFA|NBA|MLB|NFL|NHL)$/i.test(text)
    || /\d/.test(text);
}

function playerFromLabelText(value) {
  const text = collapseWhitespace(value);
  const productMatch = productMatchFromText(text);
  if (!productMatch) return "";
  const afterProduct = text.slice(productMatch.end);
  const candidate = afterProduct
    .split(/\b(?:Club\s+Legends|1983\s+Topps|Variation|Autograph|Auto|Rookie|Ticket|Gem\s+Mt|Gem|Mint|PSA|BGS|SGC|CGC|Topps|Panini|Bowman|Donruss|Contenders|Prizm|Chrome)\b|#|\b(?:19|20)\d{2}\b|\b\d{1,4}\s*\/\s*\d{1,4}\b/i)[0];
  const name = compactFieldValue(candidate, { maxLength: 80 }).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  if (isInvalidPersonName(name) || /\b(?:topps|panini|bowman|chrome|prizm|contenders|gem|mint)\b/i.test(name)) return "";
  return titleCaseName(name);
}

function yearBeforeProductFromText(value) {
  const text = collapseWhitespace(value);
  const productMatch = productMatchFromText(text);
  if (!productMatch || productMatch.index < 0) return "";
  const beforeProduct = text.slice(0, productMatch.index);
  const matches = [...beforeProduct.matchAll(/\b(?:19|20)\d{2}(?:[-/]\d{2})?\b/g)].map((match) => match[0].replace("/", "-"));
  return matches.at(-1) || "";
}

function slabFactsFromText(value) {
  const text = collapseWhitespace(value);
  if (!text) return {};
  const product = productFromText(text);
  const collectorNumber = firstCollectorNumberFromText(text);
  const gradeCompany = text.match(/\b(PSA|BGS|SGC|CGC|TAG|ISA|HGA)\b/i)?.[1]?.toUpperCase() || "";
  const grade = text.match(/\b(?:GEM\s*MT|MINT|NM-MT|MT)\s*(10|9\.5|9|8\.5|8|7\.5|7)\b/i)?.[1] || "";
  const insert = text.match(/\b1983\s+Topps\b/i)
    ? "1983 Topps"
    : text.match(/\bClub\s+Legends\b/i)
      ? "Club Legends"
      : "";
  const variation = text.match(/\bVariation[-\s]*Autograph\b/i)
    ? "Variation Autograph"
    : text.match(/\bVariation\b/i)
      ? "Variation"
      : "";
  return {
    year: yearBeforeProductFromText(text) || firstYearFromText(text),
    product,
    players: playerFromLabelText(text) ? [playerFromLabelText(text)] : [],
    collector_number: collectorNumber,
    card_number: collectorNumber,
    checklist_code: firstChecklistCodeFromText(text),
    grade_company: gradeCompany,
    card_grade: grade,
    grade: grade,
    grade_type: grade ? "CARD_ONLY" : "",
    insert,
    variation,
    auto: /\b(?:autograph|auto)\b/i.test(text),
    rc: /\b(?:RC|Rookie\s+Ticket|Rookie\s+Card|Rated\s+Rookie|Rookie)\b/i.test(text)
  };
}

const compactStringFieldMaxLength = Object.freeze({
  category: 40,
  standardness: 40,
  route: 40,
  lot_type: 60,
  year: 16,
  manufacturer: 50,
  brand: 50,
  product: 90,
  set: 90,
  subset: 80,
  player: 80,
  character: 80,
  team: 70,
  artist: 80,
  card_type: 70,
  insert: 80,
  surface_color: 40,
  parallel_family: 60,
  parallel_exact: 80,
  parallel: 80,
  variation: 80,
  serial_number: 20,
  collector_number: 30,
  card_number: 30,
  checklist_code: 30,
  grade_company: 20,
  grade: 20,
  card_grade: 20,
  auto_grade: 20
});

function rawGeminiEvidenceText(parsed = {}) {
  const fields = parsed.fields && typeof parsed.fields === "object" && !Array.isArray(parsed.fields)
    ? parsed.fields
    : {};
  const fieldEvidence = parsed.field_evidence && typeof parsed.field_evidence === "object" && !Array.isArray(parsed.field_evidence)
    ? parsed.field_evidence
    : {};
  const fieldValues = Object.values(fields).flatMap((value) => Array.isArray(value) ? value : [value]);
  const fieldEvidenceValues = Object.values(fieldEvidence).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    return [entry.value, entry.grade_company, entry.card_grade, entry.auto_grade, entry.grade_type, entry.support_type, entry.evidence_kind, entry.visible_text, entry.raw_text];
  });
  return [
    parsed.title,
    parsed.model_title_suggestion,
    parsed.reason,
    ...(Array.isArray(parsed.unresolved) ? parsed.unresolved : []),
    ...fieldValues,
    ...fieldEvidenceValues
  ]
    .map((value) => collapseWhitespace(value))
    .filter(Boolean)
    .join(" | ");
}

function rawGeminiFieldEvidenceText(parsed = {}) {
  return rawGeminiEvidenceText({
    ...parsed,
    title: "",
    model_title_suggestion: ""
  });
}

function sanitizeGeminiFields(fields = {}, parsed = {}) {
  const normalizedFields = {};
  const evidenceText = rawGeminiEvidenceText(parsed);
  const fieldEvidenceText = rawGeminiFieldEvidenceText(parsed);

  Object.entries(fields).forEach(([fieldName, value]) => {
    if (!legacyFieldNames.includes(fieldName)) return;
    if (booleanFieldNames.has(fieldName) || fieldName === "card_count" || fieldName === "grade_type") {
      normalizedFields[fieldName] = value;
      return;
    }
    if (fieldName === "players" || fieldName === "attributes") {
      const cleaned = cleanNameList(value);
      normalizedFields[fieldName] = fieldName === "players"
        ? cleaned.filter((item) => !isInvalidPersonName(item))
        : cleaned;
      return;
    }
    if (fieldName === "player") {
      normalizedFields.player = cleanPersonCandidate(value);
      return;
    }

    if (fieldName === "year") {
      normalizedFields.year = firstYearFromText(value);
      return;
    }
    if (fieldName === "serial_number") {
      normalizedFields.serial_number = firstSerialFromText(value);
      return;
    }
    if (fieldName === "product") {
      normalizedFields.product = productFromText(value) || cleanProductCandidate(value);
      return;
    }
    if (fieldName === "checklist_code") {
      normalizedFields.checklist_code = cleanCodeLikeValue(value, compactStringFieldMaxLength.checklist_code) || firstChecklistCodeFromText(value);
      return;
    }
    if (fieldName === "card_number" || fieldName === "collector_number") {
      normalizedFields[fieldName] = cleanCodeLikeValue(value, compactStringFieldMaxLength[fieldName]);
      return;
    }
    if (fieldName === "grade_company") {
      normalizedFields.grade_company = cleanGradeCompany(value);
      return;
    }
    if (fieldName === "grade" || fieldName === "card_grade" || fieldName === "auto_grade") {
      normalizedFields[fieldName] = cleanGradeValue(value);
      return;
    }

    normalizedFields[fieldName] = compactFieldValue(value, {
      maxLength: compactStringFieldMaxLength[fieldName] || 80
    });
  });

  const slabFacts = slabFactsFromText(evidenceText);
  if (!normalizedFields.year) normalizedFields.year = slabFacts.year || firstYearFromText(evidenceText);
  if (normalizedFields.year && /-\d{2}$/.test(normalizedFields.year) && slabFacts.year && !/-\d{2}$/.test(slabFacts.year)) {
    normalizedFields.year = slabFacts.year;
  }
  if (!normalizedFields.serial_number) normalizedFields.serial_number = firstSerialFromText(evidenceText);
  const evidenceProduct = slabFacts.product || productFromText(evidenceText);
  if (shouldPreferRicherProduct(normalizedFields.product, evidenceProduct)) normalizedFields.product = evidenceProduct;
  ["year", "product", "collector_number", "card_number", "checklist_code", "grade_company", "grade", "card_grade", "grade_type", "insert", "variation"].forEach((fieldName) => {
    if (!normalizedFields[fieldName] && slabFacts[fieldName]) normalizedFields[fieldName] = slabFacts[fieldName];
  });
  if (!normalizedFields.grade_company) normalizedFields.grade_company = cleanGradeCompany(fieldEvidenceText);
  if (!normalizedFields.card_grade) normalizedFields.card_grade = cleanGradeValue(fieldEvidenceText);
  if (!normalizedFields.grade && normalizedFields.card_grade) normalizedFields.grade = normalizedFields.card_grade;
  if (!normalizedFields.insert) normalizedFields.insert = insertFromText(fieldEvidenceText) || insertFromText(evidenceText);
  if (!normalizedFields.card_type) normalizedFields.card_type = cardTypeFromText(fieldEvidenceText) || cardTypeFromText(evidenceText);
  if (!normalizedFields.parallel_exact && !normalizedFields.parallel) {
    const exactParallel = parallelFromText(fieldEvidenceText);
    if (exactParallel) {
      normalizedFields.parallel_exact = exactParallel;
      normalizedFields.parallel = exactParallel;
    }
  }
  if (!normalizedFields.surface_color) {
    normalizedFields.surface_color = surfaceColorFromParallel(normalizedFields.parallel_exact || normalizedFields.parallel || fieldEvidenceText);
  }
  if (!normalizedFields.auto && slabFacts.auto) normalizedFields.auto = true;
  if (!normalizedFields.rc && slabFacts.rc) normalizedFields.rc = true;
  if (!normalizedFields.auto && /\b(?:Auto|Autograph|Autographed|Signed|Signature)\b/i.test(fieldEvidenceText)) normalizedFields.auto = true;
  if (!normalizedFields.rc && /\b(?:\bRC\b|Rookie\s+Ticket|Rookie\s+Card|Rated\s+Rookie)\b/i.test(fieldEvidenceText)) normalizedFields.rc = true;
  const structuredRcText = [
    normalizedFields.insert,
    normalizedFields.subset,
    normalizedFields.card_type,
    normalizedFields.variation,
    ...(Array.isArray(normalizedFields.attributes) ? normalizedFields.attributes : [])
  ].filter(Boolean).join(" ");
  if (normalizedFields.rc && !/\b(?:RC|Rookie\s+Ticket|Rookie\s+Card|Rated\s+Rookie|Rookie)\b/i.test(structuredRcText)) {
    normalizedFields.rc = false;
  }
  if (normalizedFields.auto && !/\b(?:Auto|Autograph|Autographed|Signed|Signature)\b/i.test(fieldEvidenceText)) {
    normalizedFields.auto = false;
  }
  if (!normalizedFields.checklist_code) normalizedFields.checklist_code = firstChecklistCodeFromText(evidenceText);
  if (!normalizedFields.collector_number) normalizedFields.collector_number = firstCollectorNumberFromText(evidenceText);
  if (normalizedFields.checklist_code && invalidChecklistCode(normalizedFields.checklist_code)) normalizedFields.checklist_code = "";
  if (normalizedFields.collector_number && invalidChecklistCode(normalizedFields.collector_number)) normalizedFields.collector_number = "";
  if (normalizedFields.card_number && invalidChecklistCode(normalizedFields.card_number)) normalizedFields.card_number = "";
  if (!normalizedFields.card_number && normalizedFields.collector_number) normalizedFields.card_number = normalizedFields.collector_number;
  if (normalizedFields.grade_type && normalizedFields.grade_type !== "UNKNOWN") {
    const hasCardGrade = Boolean(normalizedFields.card_grade || normalizedFields.grade);
    const hasAutoGrade = Boolean(normalizedFields.auto_grade);
    const hasGradeCompany = Boolean(normalizedFields.grade_company);
    if (!hasGradeCompany && !hasCardGrade && !hasAutoGrade) {
      normalizedFields.grade_type = "UNKNOWN";
    } else if (normalizedFields.grade_type === "AUTO_ONLY" && !hasAutoGrade) {
      normalizedFields.grade_type = hasCardGrade ? "CARD_ONLY" : "UNKNOWN";
    } else if (normalizedFields.grade_type === "CARD_AND_AUTO" && !hasAutoGrade) {
      normalizedFields.grade_type = hasCardGrade ? "CARD_ONLY" : "UNKNOWN";
    }
  }
  if (!Array.isArray(normalizedFields.players) || !normalizedFields.players.length) {
    const playerNames = cleanNameList(fields.player);
    if (playerNames.length) normalizedFields.players = playerNames;
    else if (slabFacts.players?.length) normalizedFields.players = slabFacts.players;
  }
  if (!normalizedFields.player && Array.isArray(normalizedFields.players) && normalizedFields.players.length) {
    normalizedFields.player = normalizedFields.players.join(" / ");
  }
  if (!Array.isArray(normalizedFields.players)) normalizedFields.players = [];

  return Object.fromEntries(Object.entries(normalizedFields).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return true;
    return value !== undefined && value !== null && value !== "";
  }));
}

function sanitizeGeminiUnresolved(unresolved = []) {
  return (Array.isArray(unresolved) ? unresolved : [])
    .map((item) => compactFieldValue(item, { allowSentence: true }))
    .filter(Boolean)
    .slice(0, 16);
}

function normalizeParsedPayload(parsed = {}) {
  const recognitionStatus = normalizeRecognitionStatus(parsed);
  const sourceFields = parsed.fields && typeof parsed.fields === "object" && !Array.isArray(parsed.fields)
    ? parsed.fields
    : {};
  const normalized = {
    ...parsed,
    title: "",
    model_title_suggestion: "",
    recognition_status: recognitionStatus,
    fields: sanitizeGeminiFields(sourceFields, parsed),
    unresolved: sanitizeGeminiUnresolved(parsed.unresolved)
  };

  if (recognitionStatus === "ABSTAIN") {
    normalized.confidence = normalized.confidence === "FAILED" ? "FAILED" : "LOW";
    if (!normalized.unresolved.length) {
      normalized.unresolved = ["Gemini abstained because critical identity evidence was uncertain."];
    }
  }

  return validateProviderEvidencePayload(provider, normalized);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function schemaError(path, message) {
  return { path, message };
}

const topLevelGeminiFields = new Set([
  ...Object.keys(geminiProviderResponseSchema().properties),
  // Backward-compatible parser only. The response_format schema no longer asks
  // the model to produce these verbose fields on the first pass.
  "title",
  "model_title_suggestion",
  "confidence",
  "route",
  "reason"
]);
const booleanFieldNames = new Set([
  "multi_card",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "sketch",
  "redemption",
  "one_of_one"
]);

function validateStrictGeminiPayload(payload = {}) {
  const errors = [];
  if (!isPlainObject(payload)) {
    throw providerSchemaError(provider, "Gemini response must be a JSON object.", [
      schemaError("payload", "Response is not an object.")
    ]);
  }

  Object.keys(payload).forEach((key) => {
    if (!topLevelGeminiFields.has(key)) {
      errors.push(schemaError(key, "Unknown top-level field."));
    }
  });

  ["recognition_status", "fields", "unresolved"].forEach((key) => {
    if (!(key in payload)) errors.push(schemaError(key, "Missing required field."));
  });

  if ("title" in payload && typeof payload.title !== "string") errors.push(schemaError("title", "Field must be a string."));
  if ("model_title_suggestion" in payload && typeof payload.model_title_suggestion !== "string") {
    errors.push(schemaError("model_title_suggestion", "Field must be a string."));
  }
  if ("confidence" in payload && !["HIGH", "MEDIUM", "LOW", "FAILED"].includes(payload.confidence)) {
    errors.push(schemaError("confidence", "Invalid confidence enum."));
  }
  if ("recognition_status" in payload && !recognizedStatuses.has(payload.recognition_status)) {
    errors.push(schemaError("recognition_status", "Invalid recognition_status enum."));
  }
  if ("route" in payload && !["FAST_PATH_CANDIDATE", "NEEDS_REVIEW", "MULTI_CARD", "ABSTAIN", ""].includes(payload.route)) {
    errors.push(schemaError("route", "Invalid route enum."));
  }
  if ("error_type" in payload && !["", "UNCERTAIN_FIELD", "MULTI_CARD", "UNREADABLE_IMAGE", "SCHEMA_UNCERTAIN", "SAFETY_BLOCKED"].includes(payload.error_type)) {
    errors.push(schemaError("error_type", "Invalid error_type enum."));
  }
  if ("reason" in payload && typeof payload.reason !== "string") errors.push(schemaError("reason", "Field must be a string."));

  if (!isPlainObject(payload.fields)) {
    errors.push(schemaError("fields", "Field must be an object."));
  } else {
    Object.entries(payload.fields).forEach(([fieldName, value]) => {
      if (!legacyFieldNames.includes(fieldName)) {
        errors.push(schemaError(`fields.${fieldName}`, "Unknown provider field."));
        return;
      }
      if (booleanFieldNames.has(fieldName) && typeof value !== "boolean") {
        errors.push(schemaError(`fields.${fieldName}`, "Field must be boolean."));
        return;
      }
      if (fieldName === "card_count" && value !== null && (!Number.isInteger(value) || value < 1)) {
        errors.push(schemaError("fields.card_count", "Field must be a positive integer or null."));
        return;
      }
      if ((fieldName === "players" || fieldName === "attributes")
        && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
        errors.push(schemaError(`fields.${fieldName}`, "Field must be an array of strings."));
        return;
      }
      if (fieldName === "grade_type" && !["CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN", ""].includes(value)) {
        errors.push(schemaError("fields.grade_type", "Invalid grade_type enum."));
        return;
      }
      if (!booleanFieldNames.has(fieldName)
        && fieldName !== "card_count"
        && fieldName !== "players"
        && fieldName !== "attributes"
        && fieldName !== "grade_type"
        && value !== null
        && !["string", "number"].includes(typeof value)) {
        errors.push(schemaError(`fields.${fieldName}`, "Field must be string, number, or null."));
      }
    });
  }

  if (!Array.isArray(payload.unresolved) || payload.unresolved.some((item) => typeof item !== "string")) {
    errors.push(schemaError("unresolved", "Field must be an array of strings."));
  }

  if ("field_evidence" in payload) {
    if (!isPlainObject(payload.field_evidence)) {
      errors.push(schemaError("field_evidence", "Field must be an object."));
    } else {
      const allowedKeys = new Set(structuredFieldEvidenceNames);
      Object.entries(payload.field_evidence).forEach(([fieldName, entry]) => {
        if (!allowedKeys.has(fieldName)) {
          errors.push(schemaError(`field_evidence.${fieldName}`, "Unknown structured field evidence key."));
          return;
        }
        if (!isPlainObject(entry)) {
          errors.push(schemaError(`field_evidence.${fieldName}`, "Structured field evidence must be an object."));
          return;
        }
        if ("confidence" in entry && entry.confidence !== null && (!Number.isFinite(Number(entry.confidence)) || Number(entry.confidence) < 0 || Number(entry.confidence) > 1)) {
          errors.push(schemaError(`field_evidence.${fieldName}.confidence`, "Confidence must be between 0 and 1."));
        }
        ["review_required", "visible_marker", "signature_visible", "text_visible", "direct_observation", "directly_observed"].forEach((key) => {
          if (key in entry && typeof entry[key] !== "boolean") {
            errors.push(schemaError(`field_evidence.${fieldName}.${key}`, "Field must be boolean."));
          }
        });
      });
    }
  }

  if (errors.length) {
    throw providerSchemaError(provider, "Gemini response did not match the provider JSON schema.", errors);
  }
}

function coerceString(value) {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : String(value);
}

function coerceBoolean(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined || value === "") return false;
  return /^(true|yes|1)$/i.test(String(value).trim());
}

function scaffoldGeminiPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const fields = isPlainObject(source.fields) ? source.fields : {};
  const fieldEvidence = isPlainObject(source.field_evidence) ? source.field_evidence : {};
  const normalizedFields = {};
  const normalizedFieldEvidence = {};

  Object.entries(fields).forEach(([fieldName, value]) => {
    if (!legacyFieldNames.includes(fieldName)) return;
    if (booleanFieldNames.has(fieldName)) {
      normalizedFields[fieldName] = coerceBoolean(value);
      return;
    }
    if (fieldName === "card_count") {
      const number = Number(value);
      normalizedFields[fieldName] = Number.isInteger(number) && number >= 1 ? number : null;
      return;
    }
    if (fieldName === "players" || fieldName === "attributes") {
      normalizedFields[fieldName] = Array.isArray(value)
        ? value.map((item) => coerceString(item).trim()).filter(Boolean)
        : coerceString(value).trim()
          ? [coerceString(value).trim()]
          : [];
      return;
    }
    if (fieldName === "grade_type") {
      const gradeType = coerceString(value).trim().toUpperCase();
      normalizedFields[fieldName] = ["CARD_ONLY", "AUTO_ONLY", "CARD_AND_AUTO", "AUTHENTIC", "ALTERED", "UNKNOWN", ""].includes(gradeType)
        ? gradeType
        : "UNKNOWN";
      return;
    }
    normalizedFields[fieldName] = value === undefined ? null : value;
  });

  const status = coerceString(source.recognition_status).trim().toUpperCase();
  const errorType = coerceString(source.error_type).trim().toUpperCase();
  const allowedEvidenceKeys = new Set(structuredFieldEvidenceNames);
  Object.entries(fieldEvidence).forEach(([fieldName, entry]) => {
    if (!allowedEvidenceKeys.has(fieldName) || !isPlainObject(entry)) return;
    normalizedFieldEvidence[fieldName] = { ...entry };
    if ("confidence" in normalizedFieldEvidence[fieldName]) {
      const confidence = Number(normalizedFieldEvidence[fieldName].confidence);
      normalizedFieldEvidence[fieldName].confidence = Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : null;
    }
    ["review_required", "visible_marker", "signature_visible", "text_visible", "direct_observation", "directly_observed"].forEach((key) => {
      if (key in normalizedFieldEvidence[fieldName]) {
        normalizedFieldEvidence[fieldName][key] = coerceBoolean(normalizedFieldEvidence[fieldName][key]);
      }
    });
  });

  return {
    recognition_status: recognizedStatuses.has(status) ? status : "ABSTAIN",
    ...(source.error_type !== undefined ? { error_type: ["UNCERTAIN_FIELD", "MULTI_CARD", "UNREADABLE_IMAGE", "SCHEMA_UNCERTAIN", "SAFETY_BLOCKED", ""].includes(errorType) ? errorType : "SCHEMA_UNCERTAIN" } : {}),
    fields: normalizedFields,
    ...(Object.keys(normalizedFieldEvidence).length ? { field_evidence: normalizedFieldEvidence } : {}),
    unresolved: Array.isArray(source.unresolved)
      ? source.unresolved.map((item) => coerceString(item).trim()).filter(Boolean)
      : []
  };
}

function geminiFormatError(formatErrorType, reason, details = {}) {
  return providerResponseFormatError(provider, reason, {
    ...details,
    format_error_type: formatErrorType
  });
}

function parseAndValidateGeminiContent(content, {
  parseSource = "content"
} = {}) {
  if (!String(content || "").trim()) {
    throw geminiFormatError(geminiFormatErrorTypes.EMPTY_OR_BLOCKED, "Gemini returned empty or blocked content.", {
      parse_source: parseSource
    });
  }

  let parsedMessage;
  try {
    parsedMessage = parseProviderMessagePayload({ content });
  } catch (error) {
    throw geminiFormatError(geminiFormatErrorTypes.JSON_SYNTAX_INVALID, "Gemini content was not valid JSON.", {
      parse_source: parseSource,
      original_code: error?.code || null,
      message: error?.details?.message || error?.message || "invalid_json"
    });
  }

  try {
    validateStrictGeminiPayload(parsedMessage.parsed);
    return {
      parsed: normalizeParsedPayload(parsedMessage.parsed),
      parse_source: parseSource === "content" ? parsedMessage.parse_source : parseSource
    };
  } catch (error) {
    if (error instanceof ProviderError && error.code === "schema_validation_failed") {
      throw geminiFormatError(geminiFormatErrorTypes.SCHEMA_INVALID, "Gemini JSON failed provider schema validation.", {
        parse_source: parseSource,
        schema_errors: error.details || []
      });
    }
    throw error;
  }
}

function extractJsonCandidateForRepair(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  if (start >= 0) return text.slice(start);
  return text;
}

function localJsonRepair(content) {
  const repairedText = jsonrepair(extractJsonCandidateForRepair(content));
  const repairedPayload = JSON.parse(repairedText);
  if (!isPlainObject(repairedPayload)) {
    throw new Error("jsonrepair did not recover a JSON object.");
  }
  const scaffolded = scaffoldGeminiPayload(repairedPayload);
  validateStrictGeminiPayload(scaffolded);
  return normalizeParsedPayload(scaffolded);
}

function canonicalForGuard(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function valueAppearsInRaw(value, rawContent) {
  const raw = canonicalForGuard(rawContent);
  const direct = canonicalForGuard(value);
  if (!direct) return true;
  return raw.includes(direct) || raw.includes(canonicalForGuard(JSON.stringify(value)));
}

function assertTextRepairPreservedValues(repaired = {}, rawContent = "") {
  const fields = repaired.fields && typeof repaired.fields === "object" ? repaired.fields : {};
  const fieldEvidence = repaired.field_evidence && typeof repaired.field_evidence === "object" ? repaired.field_evidence : {};
  const newValues = [];
  Object.entries(fields).forEach(([fieldName, value]) => {
    if (Array.isArray(value)) {
      value.filter((item) => String(item || "").trim()).forEach((item) => newValues.push([fieldName, item]));
      return;
    }
    if (value === true) {
      newValues.push([fieldName, fieldName]);
      return;
    }
    if (value === null || value === undefined || value === false || value === "") return;
    newValues.push([fieldName, value]);
  });
  Object.entries(fieldEvidence).forEach(([fieldName, entry]) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    ["value", "grade_company", "card_grade", "auto_grade", "grade_type", "visible_text"].forEach((key) => {
      const value = entry[key];
      if (value === null || value === undefined || value === false || value === "") return;
      if (value === true) {
        newValues.push([`${fieldName}.${key}`, fieldName]);
        return;
      }
      newValues.push([`${fieldName}.${key}`, value]);
    });
  });

  const introduced = newValues.filter(([, value]) => !valueAppearsInRaw(value, rawContent));
  if (introduced.length) {
    throw geminiFormatError(geminiFormatErrorTypes.SCHEMA_INVALID, "Gemini text repair introduced identity values absent from the original response.", {
      introduced_values: introduced.map(([field, value]) => ({ field, value: String(value) })).slice(0, 8)
    });
  }
}

function normalizedUsageForCall({
  interaction,
  modelId,
  latencyMs,
  imageCount,
  providerCalls = 1,
  env
}) {
  return normalizeProviderUsage({
    provider,
    modelId,
    rawUsage: interaction?.usage,
    latencyMs,
    imageCount,
    providerCalls,
    env
  });
}

function usageMetric(usage = {}, keys = []) {
  for (const key of keys) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function firstCandidateFinishReason(interaction = {}) {
  const candidates = [
    ...(Array.isArray(interaction.candidates) ? interaction.candidates : []),
    ...(Array.isArray(interaction.response?.candidates) ? interaction.response.candidates : [])
  ];
  for (const candidate of candidates) {
    const reason = candidate?.finishReason || candidate?.finish_reason;
    if (reason) return String(reason);
  }
  return "";
}

function geminiTokenDiagnostics(interaction = {}, outputCap = 0) {
  const usage = interaction.usage || interaction.usageMetadata || interaction.usage_metadata || {};
  const promptTokenCount = usageMetric(usage, ["prompt_token_count", "promptTokenCount", "total_input_tokens", "input_tokens", "prompt_tokens"]) || 0;
  const candidatesTokenCount = usageMetric(usage, ["candidates_token_count", "candidatesTokenCount", "total_output_tokens", "output_tokens", "completion_tokens"]) || 0;
  const totalTokenCount = usageMetric(usage, ["total_token_count", "totalTokenCount", "total_tokens"])
    ?? (promptTokenCount || candidatesTokenCount ? promptTokenCount + candidatesTokenCount : 0);
  const cap = Number(outputCap);
  return {
    prompt_token_count: promptTokenCount,
    candidates_token_count: candidatesTokenCount,
    total_token_count: totalTokenCount,
    finish_reason: firstCandidateFinishReason(interaction) || String(interaction.finish_reason || interaction.finishReason || interaction.status || "").trim(),
    output_cap: Number.isFinite(cap) && cap > 0 ? cap : null,
    output_utilization: Number.isFinite(cap) && cap > 0
      ? Number((candidatesTokenCount / cap).toFixed(6))
      : null
  };
}

function geminiLooksTokenTruncated(interaction = {}, content = "", outputCap = 0) {
  const diagnostics = geminiTokenDiagnostics(interaction, outputCap);
  if (/MAX[_\s-]*TOKENS|TOKEN[_\s-]*LIMIT|LENGTH|TRUNC/i.test(diagnostics.finish_reason)) return true;
  return /incomplete/i.test(diagnostics.finish_reason)
    && diagnostics.output_utilization !== null
    && diagnostics.output_utilization >= 0.98;
}

function geminiLooksEmptyOrBlocked(interaction = {}, content = "") {
  return !String(content || "").trim()
    || /blocked|safety|empty/i.test(String(interaction.status || interaction.finish_reason || interaction.finishReason || ""));
}

function sumNullableNumbers(values = []) {
  let seen = false;
  const total = values.reduce((sum, value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return sum;
    seen = true;
    return sum + number;
  }, 0);
  return seen ? total : null;
}

function mergeProviderUsages(usages = []) {
  const valid = usages.filter(Boolean);
  if (!valid.length) return null;
  return {
    ...valid[0],
    provider_calls: valid.reduce((sum, usage) => sum + Number(usage.provider_calls || 0), 0),
    retrieval_calls: valid.reduce((sum, usage) => sum + Number(usage.retrieval_calls || 0), 0),
    latency_ms: valid.reduce((sum, usage) => sum + Number(usage.latency_ms || 0), 0),
    estimated_cost_usd: Number(valid.reduce((sum, usage) => sum + Number(usage.estimated_cost_usd || 0), 0).toFixed(6)),
    cost_configured: valid.some((usage) => usage.cost_configured === true),
    input_tokens: sumNullableNumbers(valid.map((usage) => usage.input_tokens)),
    output_tokens: sumNullableNumbers(valid.map((usage) => usage.output_tokens)),
    prompt_tokens: sumNullableNumbers(valid.map((usage) => usage.prompt_tokens)),
    completion_tokens: sumNullableNumbers(valid.map((usage) => usage.completion_tokens)),
    total_tokens: sumNullableNumbers(valid.map((usage) => usage.total_tokens)),
    image_count: valid.reduce((sum, usage) => sum + Number(usage.image_count || 0), 0)
  };
}

function modelIdFromInteraction(interaction = {}, fallback) {
  const model = interaction.model;
  if (typeof model === "string" && model) return model;
  if (model && typeof model === "object") {
    return model.id || model.name || model.model || fallback;
  }
  return fallback;
}

function statusFromError(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.code,
    error?.response?.status,
    error?.cause?.status
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 100) return number;
  }
  return null;
}

function errorDetailText(error) {
  return [
    error?.message,
    error?.body,
    error?.error,
    error?.cause?.message
  ]
    .map((value) => {
      if (value === undefined || value === null) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    })
    .filter(Boolean)
    .join("\n");
}

function providerErrorFromGemini(error) {
  if (error instanceof ProviderError) return error;

  const status = statusFromError(error);
  const detailText = errorDetailText(error);
  if (/not available in your current location|available-regions/i.test(detailText)) {
    return new ProviderError("Gemini API is not available from the current network location.", {
      provider,
      code: "location_unavailable",
      status: status || 400,
      retryable: true,
      details: {
        upstream_status: status || 400
      }
    });
  }
  if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(detailText)) {
    return new ProviderError("Gemini API key is invalid for the Interactions API.", {
      provider,
      code: "auth_error",
      status: status || 400,
      retryable: false
    });
  }

  if (status) {
    return providerHttpError(provider, status, safeProviderErrorMessage({ message: detailText || error.message }));
  }

  const message = safeProviderErrorMessage({ message: detailText || error.message });
  if (error?.name === "AbortError" || /timeout|timed out|deadline/i.test(message)) {
    return new ProviderError("Gemini request timed out.", {
      provider,
      code: "timeout",
      retryable: true
    });
  }

  return new ProviderError(message, {
    provider,
    code: "network_error",
    retryable: false
  });
}

function wait(ms, signal = null) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!delay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abort);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    const abort = () => {
      cleanup();
      reject(signal.reason || new Error("Operation aborted."));
    };
    if (!signal) return;
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function geminiRequestDebugSummary(request = {}) {
  const input = Array.isArray(request.input) ? request.input : [];
  const images = input.filter((item) => item?.type === "image");
  const schemaText = request.response_format?.schema
    ? JSON.stringify(request.response_format.schema)
    : "";
  return {
    model: request.model || null,
    api_version: request.api_version || null,
    input_count: input.length,
    image_count: images.length,
    inline_image_count: images.filter((image) => Boolean(image.data)).length,
    uri_image_count: images.filter((image) => Boolean(image.uri)).length,
    image_mime_types: [...new Set(images.map((image) => image.mime_type).filter(Boolean))].slice(0, 8),
    response_format_type: request.response_format?.type || null,
    response_format_mime_type: request.response_format?.mime_type || null,
    schema_bytes: schemaText.length,
    schema_has_any_of: schemaText.includes("\"anyOf\""),
    schema_has_one_of: schemaText.includes("\"oneOf\""),
    schema_has_all_of: schemaText.includes("\"allOf\""),
    schema_has_max_length: schemaText.includes("\"maxLength\""),
    generation_config_keys: Object.keys(request.generation_config || {}).sort()
  };
}

async function createGeminiInteractionWithRetries(client, request, config, {
  signal = null
} = {}) {
  const maxRetries = Math.max(0, Math.trunc(Number(config.maxRetries) || 0));
  const baseDelay = Math.max(0, Number(config.retryBaseDelayMs) || 0);
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    const attemptController = new AbortController();
    const onAbort = () => attemptController.abort(signal?.reason || new Error("Operation aborted."));
    const timeout = setTimeout(() => {
      const error = new Error(`Gemini request timed out after ${config.timeoutMs}ms.`);
      error.name = "AbortError";
      attemptController.abort(error);
    }, Math.max(1, Number(config.timeoutMs) || 25000));
    let cleanedUp = false;
    const cleanupAttempt = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const interactionPromise = client.interactions.create(request, {
        timeout_ms: config.timeoutMs,
        signal: attemptController.signal,
        retries: { strategy: "none" },
        retry_codes: []
      });
      const timeoutPromise = new Promise((_, reject) => {
        attemptController.signal.addEventListener("abort", () => {
          reject(attemptController.signal.reason || new Error("Gemini request aborted."));
        }, { once: true });
      });
      const interaction = await Promise.race([interactionPromise, timeoutPromise]);
      return {
        interaction,
        retry_attempts: attempt
      };
    } catch (error) {
      cleanupAttempt();
      const providerError = providerErrorFromGemini(error);
      providerError.details = {
        ...(providerError.details || {}),
        request_summary: geminiRequestDebugSummary(request)
      };
      lastError = providerError;
      if (!providerError.retryable || attempt >= maxRetries) break;
      attempt += 1;
      await wait(baseDelay * attempt, signal);
    } finally {
      cleanupAttempt();
    }
  }

  throw lastError;
}

function parseVisibleTextPayload(content = "") {
  if (!String(content || "").trim()) {
    throw geminiFormatError(geminiFormatErrorTypes.EMPTY_OR_BLOCKED, "Gemini visible-text response was empty.");
  }
  let parsed;
  try {
    parsed = JSON.parse(extractJsonCandidateForRepair(content));
  } catch {
    parsed = JSON.parse(jsonrepair(extractJsonCandidateForRepair(content)));
  }
  if (!isPlainObject(parsed)) {
    throw geminiFormatError(geminiFormatErrorTypes.JSON_SYNTAX_INVALID, "Gemini visible-text response did not contain a JSON object.");
  }
  const confidence = String(parsed.confidence || "").trim().toUpperCase();
  const visibleTextLines = (Array.isArray(parsed.visible_text_lines) ? parsed.visible_text_lines : [])
    .map((line) => compactFieldValue(line, { allowSentence: true }))
    .filter(Boolean)
    .slice(0, 32);
  const unresolved = (Array.isArray(parsed.unresolved) ? parsed.unresolved : [])
    .map((line) => compactFieldValue(line, { allowSentence: true }))
    .filter(Boolean)
    .slice(0, 8);
  return {
    confidence: ["HIGH", "MEDIUM", "LOW", "FAILED"].includes(confidence) ? confidence : "LOW",
    visible_text_lines: visibleTextLines,
    unresolved
  };
}

export function geminiFieldsFromVisibleText(lines = []) {
  const cleanedLines = (Array.isArray(lines) ? lines : [lines])
    .map((line) => collapseWhitespace(line))
    .map((line) => line.replace(/^visible[_\s-]*text\s*:?\s*/i, "").trim())
    .filter(Boolean);
  const visibleText = cleanedLines
    .join(" | ");
  const facts = slabFactsFromText(visibleText);
  const fields = sanitizeGeminiFields(facts, {
    title: "",
    model_title_suggestion: "",
    reason: "",
    fields: facts,
    unresolved: visibleText ? [`visible_text: ${visibleText}`] : []
  });
  const linePlayers = cleanedLines
    .flatMap((line) => cleanNameList(line))
    .filter((line) => line && line.split(/\s+/).length >= 1 && line.split(/\s+/).length <= 5)
    .filter((line, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === line.toLowerCase()) === index)
    .slice(0, 8);
  const currentPlayers = Array.isArray(fields.players) ? fields.players : [];
  if (linePlayers.length && (!currentPlayers.length || currentPlayers.some((player) => /[|]/.test(player)) || linePlayers.length > currentPlayers.length)) {
    fields.players = linePlayers;
    fields.player = linePlayers.join(" / ");
  }
  if (!fields.insert) fields.insert = insertFromText(visibleText);
  if (!fields.card_type) fields.card_type = cardTypeFromText(visibleText);
  if (!fields.parallel_exact && !fields.parallel) {
    const exactParallel = parallelFromText(visibleText);
    if (exactParallel) {
      fields.parallel_exact = exactParallel;
      fields.parallel = exactParallel;
    }
  }
  if (!fields.surface_color) fields.surface_color = surfaceColorFromParallel(fields.parallel_exact || fields.parallel || visibleText);
  if (!fields.auto && /\b(?:Auto|Autograph|Autographed|Signed|Signature)\b/i.test(visibleText)) fields.auto = true;
  if (!fields.rc && /\b(?:\bRC\b|Rookie\s+Ticket|Rookie\s+Card|Rated\s+Rookie)\b/i.test(visibleText)) fields.rc = true;
  if (fields.auto && !fields.card_type) fields.card_type = "Autograph";
  return fields;
}

export async function transcribeVisibleCardTextWithGemini({
  images,
  prompt = "",
  env = process.env,
  signal = null,
  clientFactory = createGeminiClient
}) {
  const config = geminiConfigFromEnv(env);
  if (!config.apiKey) {
    throw providerUnavailable(provider, "GEMINI_API_KEY is not configured.");
  }
  if (!config.modelAllowed) {
    throw providerUnavailable(provider, "GEMINI_MODEL must be a Gemini model id such as gemini-3.1-flash-lite.");
  }
  if (typeof clientFactory !== "function") {
    throw providerUnavailable(provider, "Gemini client factory is not available.");
  }

  const startedAt = Date.now();
  const request = buildGeminiVisibleTextRequest({
    prompt,
    images,
    model: config.model,
    temperature: 0,
    maxOutputTokens: numberFromEnv(env, "GEMINI_VISIBLE_TEXT_MAX_OUTPUT_TOKENS", Number(config.maxOutputTokens || 4096)),
    apiVersion: config.apiVersion
  });

  try {
    const client = clientFactory({ apiKey: config.apiKey });
    const call = await createGeminiInteractionWithRetries(client, request, config, { signal });
    const interaction = call.interaction;
    const latencyMs = Date.now() - startedAt;
    const content = extractInteractionText(interaction);
    const visibleTextPayload = parseVisibleTextPayload(content);
    const fields = geminiFieldsFromVisibleText(visibleTextPayload.visible_text_lines);
    const recognitionStatus = fields.product || fields.players?.length ? "RESOLVED" : "ABSTAIN";
    const parsed = normalizeParsedPayload({
      title: "",
      model_title_suggestion: "",
      confidence: visibleTextPayload.confidence === "FAILED"
        ? "FAILED"
        : recognitionStatus === "ABSTAIN"
          ? "LOW"
          : visibleTextPayload.confidence,
      recognition_status: recognitionStatus,
      route: recognitionStatus === "ABSTAIN" ? "ABSTAIN" : "NEEDS_REVIEW",
      fields,
      unresolved: [
        ...visibleTextPayload.visible_text_lines.map((line) => `visible_text: ${line}`),
        ...visibleTextPayload.unresolved
      ].slice(0, 16)
    });
    const modelId = modelIdFromInteraction(interaction, config.model);
    return {
      provider,
      model_id: modelId,
      response_id: interaction.id || null,
      parsed,
      recognition_status: parsed.recognition_status,
      parse_source: "visible_text",
      visible_text_lines: visibleTextPayload.visible_text_lines,
      native_schema_valid: true,
      format_repair_attempted: false,
      local_json_repair_success: false,
      text_repair_success: false,
      retry_attempts: call.retry_attempts,
      latency_ms: latencyMs,
      usage: normalizedUsageForCall({
        interaction,
        modelId,
        latencyMs,
        imageCount: images.length,
        env
      })
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw providerErrorFromGemini(error);
  }
}

export async function analyzeCardEvidenceWithGemini({
  images,
  prompt,
  env = process.env,
  signal = null,
  clientFactory = createGeminiClient
}) {
  const config = geminiConfigFromEnv(env);
  if (!config.apiKey) {
    throw providerUnavailable(provider, "GEMINI_API_KEY is not configured.");
  }

  if (!config.modelAllowed) {
    throw providerUnavailable(provider, "GEMINI_MODEL must be a Gemini model id such as gemini-3.1-flash-lite.");
  }

  if (typeof clientFactory !== "function") {
    throw providerUnavailable(provider, "Gemini client factory is not available.");
  }

  const startedAt = Date.now();
  const buildRequest = (maxOutputTokens) => buildGeminiInteractionRequest({
    prompt,
    images,
    model: config.model,
    temperature: config.temperature,
    maxOutputTokens,
    apiVersion: config.apiVersion
  });
  const request = buildRequest(config.maxOutputTokens);

  try {
    const client = clientFactory({ apiKey: config.apiKey });
    const initialCall = await createGeminiInteractionWithRetries(client, request, config, {
      signal
    });
    const initialLatencyMs = Date.now() - startedAt;
    let interaction = initialCall.interaction;
    let content = extractInteractionText(interaction);
    let modelId = modelIdFromInteraction(interaction, config.model);
    const initialTokenDiagnostics = geminiTokenDiagnostics(interaction, config.maxOutputTokens);
    const usageReports = [
      normalizedUsageForCall({
        interaction,
        modelId,
        latencyMs: initialLatencyMs,
        imageCount: images.length,
        env
      })
    ];
    let tokenDiagnostics = initialTokenDiagnostics;
    let truncationRetryAttempted = false;
    let truncationRetryAttempts = 0;
    let emptyRetryAttempted = false;
    let emptyRetryAttempts = 0;

    if (geminiLooksTokenTruncated(interaction, content, config.maxOutputTokens)) {
      const retryCap = Math.max(Number(config.truncationRetryMaxOutputTokens || 0), Number(config.maxOutputTokens || 0));
      if (retryCap <= Number(config.maxOutputTokens || 0)) {
        throw geminiFormatError(geminiFormatErrorTypes.JSON_SYNTAX_INVALID, "Gemini response was truncated at the configured output cap.", {
          token_diagnostics: initialTokenDiagnostics
        });
      }
      truncationRetryAttempted = true;
      truncationRetryAttempts = 1;
      const retryStartedAt = Date.now();
      const retryRequest = buildRequest(retryCap);
      const retryCall = await createGeminiInteractionWithRetries(client, retryRequest, config, {
        signal
      });
      interaction = retryCall.interaction;
      content = extractInteractionText(interaction);
      modelId = modelIdFromInteraction(interaction, config.model);
      const retryLatencyMs = Date.now() - retryStartedAt;
      usageReports.push(normalizedUsageForCall({
        interaction,
        modelId,
        latencyMs: retryLatencyMs,
        imageCount: images.length,
        env
      }));
      tokenDiagnostics = geminiTokenDiagnostics(interaction, retryCap);
      if (geminiLooksTokenTruncated(interaction, content, retryCap)) {
        throw geminiFormatError(geminiFormatErrorTypes.JSON_SYNTAX_INVALID, "Gemini response was still truncated after one higher-cap retry.", {
          token_diagnostics: tokenDiagnostics,
          initial_token_diagnostics: initialTokenDiagnostics,
          truncation_retry_attempted: true,
          truncation_retry_attempts: truncationRetryAttempts
        });
      }
    }

    if (geminiLooksEmptyOrBlocked(interaction, content)) {
      emptyRetryAttempted = true;
      emptyRetryAttempts = 1;
      const emptyRetryStartedAt = Date.now();
      const emptyRetryCall = await createGeminiInteractionWithRetries(client, buildRequest(config.maxOutputTokens), config, {
        signal
      });
      interaction = emptyRetryCall.interaction;
      content = extractInteractionText(interaction);
      modelId = modelIdFromInteraction(interaction, config.model);
      const emptyRetryLatencyMs = Date.now() - emptyRetryStartedAt;
      usageReports.push(normalizedUsageForCall({
        interaction,
        modelId,
        latencyMs: emptyRetryLatencyMs,
        imageCount: images.length,
        env
      }));
      tokenDiagnostics = geminiTokenDiagnostics(interaction, config.maxOutputTokens);
      if (geminiLooksEmptyOrBlocked(interaction, content)) {
        throw geminiFormatError(geminiFormatErrorTypes.EMPTY_OR_BLOCKED, "Gemini returned empty or blocked content after one retry.", {
          token_diagnostics: tokenDiagnostics,
          initial_token_diagnostics: initialTokenDiagnostics,
          truncation_retry_attempted: truncationRetryAttempted,
          truncation_retry_attempts: truncationRetryAttempts,
          empty_retry_attempted: emptyRetryAttempted,
          empty_retry_attempts: emptyRetryAttempts,
          format_repair_attempted: false,
          local_json_repair_success: false,
          text_repair_success: false,
          native_schema_valid: false
        });
      }
    }
    const repairState = {
      format_error_type: null,
      format_repair_attempted: false,
      local_json_repair_success: false,
      text_repair_success: false,
      native_schema_valid: false
    };
    let parsed;
    let parseSource = "content";
    let repairInteraction = null;

    try {
      const nativeParsed = parseAndValidateGeminiContent(content, { parseSource: "content" });
      parsed = nativeParsed.parsed;
      parseSource = nativeParsed.parse_source;
      repairState.native_schema_valid = true;
    } catch (formatError) {
      if (!(formatError instanceof ProviderError) || formatError.code !== "response_format_invalid") {
        throw formatError;
      }

      repairState.format_error_type = formatError.details?.format_error_type || geminiFormatErrorTypes.PROVIDER_ERROR;
      if (geminiLooksTokenTruncated(interaction, content, tokenDiagnostics.output_cap || config.maxOutputTokens)) {
        throw geminiFormatError(geminiFormatErrorTypes.JSON_SYNTAX_INVALID, "Gemini response looked truncated before JSON repair.", {
          ...(formatError.details || {}),
          token_diagnostics: tokenDiagnostics,
          initial_token_diagnostics: truncationRetryAttempted ? initialTokenDiagnostics : null,
          truncation_retry_attempted: truncationRetryAttempted,
          truncation_retry_attempts: truncationRetryAttempts,
          ...repairState
        });
      }
      if (repairState.format_error_type === geminiFormatErrorTypes.EMPTY_OR_BLOCKED
        || repairState.format_error_type === geminiFormatErrorTypes.PROVIDER_ERROR) {
        throw geminiFormatError(repairState.format_error_type, formatError.message, {
          ...(formatError.details || {}),
          token_diagnostics: tokenDiagnostics,
          initial_token_diagnostics: truncationRetryAttempted || emptyRetryAttempted ? initialTokenDiagnostics : null,
          truncation_retry_attempted: truncationRetryAttempted,
          truncation_retry_attempts: truncationRetryAttempts,
          empty_retry_attempted: emptyRetryAttempted,
          empty_retry_attempts: emptyRetryAttempts,
          ...repairState
        });
      }

      repairState.format_repair_attempted = true;

      try {
        parsed = localJsonRepair(content);
        parseSource = "jsonrepair";
        repairState.local_json_repair_success = true;
      } catch (localRepairError) {
        if (!config.textRepairEnabled) {
          throw geminiFormatError(repairState.format_error_type, "Gemini JSON repair failed and text repair is disabled.", {
            ...(formatError.details || {}),
            local_repair_error: safeProviderErrorMessage(localRepairError),
            ...repairState
          });
        }

        const repairStartedAt = Date.now();
        const repairRequest = buildGeminiFormatRepairRequest({
          rawContent: content,
          model: config.model,
          maxOutputTokens: config.formatRepairMaxOutputTokens,
          apiVersion: config.apiVersion
        });
        const repairCall = await createGeminiInteractionWithRetries(client, repairRequest, config, {
          signal
        });
        repairInteraction = repairCall.interaction;
        const repairLatencyMs = Date.now() - repairStartedAt;
        const repairModelId = modelIdFromInteraction(repairInteraction, config.model);
        usageReports.push(normalizedUsageForCall({
          interaction: repairInteraction,
          modelId: repairModelId,
          latencyMs: repairLatencyMs,
          imageCount: 0,
          env
        }));
        const repairedContent = extractInteractionText(repairInteraction);
        if (!repairedContent.trim()) {
          throw geminiFormatError(geminiFormatErrorTypes.EMPTY_OR_BLOCKED, "Gemini text repair returned empty content.", {
            ...(formatError.details || {}),
            local_repair_error: safeProviderErrorMessage(localRepairError),
            ...repairState
          });
        }
        let repairedPayload;
        try {
          repairedPayload = parseProviderMessagePayload({ content: repairedContent }).parsed;
        } catch (textParseError) {
          throw geminiFormatError(geminiFormatErrorTypes.JSON_SYNTAX_INVALID, "Gemini text repair did not return valid JSON.", {
            ...(formatError.details || {}),
            local_repair_error: safeProviderErrorMessage(localRepairError),
            text_repair_error: safeProviderErrorMessage(textParseError),
            ...repairState
          });
        }
        const scaffolded = scaffoldGeminiPayload(repairedPayload);
        assertTextRepairPreservedValues(scaffolded, content);
        try {
          validateStrictGeminiPayload(scaffolded);
          parsed = normalizeParsedPayload(scaffolded);
          parseSource = "text_format_repair";
          repairState.text_repair_success = true;
        } catch (textSchemaError) {
          throw geminiFormatError(geminiFormatErrorTypes.SCHEMA_INVALID, "Gemini text repair failed schema validation.", {
            ...(formatError.details || {}),
            local_repair_error: safeProviderErrorMessage(localRepairError),
            text_repair_error: safeProviderErrorMessage(textSchemaError),
            ...repairState
          });
        }
      }
    }

    return {
      provider,
      model_id: modelId,
      response_id: interaction.id || null,
      finish_reason: repairInteraction?.status || interaction.status || null,
      recognition_status: parsed.recognition_status,
      error_type: parsed.error_type || null,
      usage: mergeProviderUsages(usageReports),
      latency_ms: usageReports.reduce((sum, usage) => sum + Number(usage?.latency_ms || 0), 0),
      parse_source: parseSource,
      format_error_type: repairState.format_error_type,
      format_repair_attempted: repairState.format_repair_attempted,
      local_json_repair_success: repairState.local_json_repair_success,
      text_repair_success: repairState.text_repair_success,
      native_schema_valid: repairState.native_schema_valid,
      retry_attempts: initialCall.retry_attempts,
      token_diagnostics: tokenDiagnostics,
      initial_token_diagnostics: truncationRetryAttempted || emptyRetryAttempted ? initialTokenDiagnostics : null,
      truncation_retry_attempted: truncationRetryAttempted,
      truncation_retry_attempts: truncationRetryAttempts,
      empty_retry_attempted: emptyRetryAttempted,
      empty_retry_attempts: emptyRetryAttempts,
      content,
      tool_calls: [],
      parsed
    };
  } catch (error) {
    throw providerErrorFromGemini(error);
  }
}
