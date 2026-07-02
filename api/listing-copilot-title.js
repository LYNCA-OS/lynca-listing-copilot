import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import {
  hasComplexVisualParallelRisk,
  highValueInsertTerms,
  registryPromptSummary,
  resolveKnowledgeEntry,
  resolveKnowledgeFromFields
} from "../lib/listing-knowledge-registry.mjs";
import { analyzeCardEvidenceWithOpenAiEmergency } from "../lib/listing/providers/openai-emergency-provider.mjs";
import { runWithProviderConcurrency } from "../lib/listing/providers/provider-concurrency.mjs";
import { defaultProviderModels, providerLabels, providerMetadata, visionProviderIds } from "../lib/listing/providers/provider-contract.mjs";
import { safeProviderErrorMessage } from "../lib/listing/providers/provider-errors.mjs";
import { selectVisionProvider } from "../lib/listing/providers/provider-registry.mjs";
import {
  createListingImageSignedReadUrl,
  verifyListingImageVerificationToken
} from "../lib/listing/storage/supabase-image-storage.mjs";
import { readListingImageVerificationRecord } from "../lib/listing/storage/storage-verification-store.mjs";
import { defaultCaptureProfileId, summarizeAssetImageQuality } from "../lib/listing/image-quality/quality-gate.mjs";
import { evaluatePreProviderRescanGate } from "../lib/listing/image-quality/pre-provider-rescan-gate.mjs";
import { createEvidenceField } from "../lib/listing/evidence/evidence-schema.mjs";
import { providerPayloadToEvidenceDocument, resolvedFieldsToLegacyFields } from "../lib/listing/evidence/provider-evidence-normalizer.mjs";
import { renderListingPresentation } from "../lib/listing/renderer/listing-renderer.mjs";
import { serialLimitText } from "../lib/listing/renderer/title-cleanup.mjs";
import { completeEvidence } from "../lib/listing/orchestration/evidence-completion-orchestrator.mjs";
import { createIdentityConvergenceRetriever } from "../lib/listing/orchestration/identity-convergence-retriever.mjs";
import { attachFieldTaskOrchestration } from "../lib/listing/orchestration/field-task-orchestrator.mjs";
import {
  applyIdentityResolutionGate,
  applyIdentityResolutionGateWithConvergence
} from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { identityStatuses } from "../lib/identity-resolution/types.mjs";
import {
  isSupabaseFeedbackConfigured,
  listApprovedHistoryRecords,
  listingApprovedMemoryEnabled
} from "../lib/supabase-feedback.mjs";
import {
  approvedHistoryRecordToListingResult,
  approvedIdentityMemorySource,
  lookupApprovedIdentityMemory
} from "../lib/listing/memory/approved-identity-memory.mjs";
import { analyzeCardImagesWithRecognitionWorker } from "../lib/listing/recognition/recognition-client.mjs";
import { recognitionRequestedFields } from "../lib/listing/recognition/recognition-contract.mjs";
import { safeRecognitionError } from "../lib/listing/recognition/recognition-errors.mjs";
import { recognitionWorkerConfig } from "../lib/listing/recognition/recognition-feature-flags.mjs";
import {
  hasRecognitionEvidence,
  recognitionResponseToEvidenceDocument
} from "../lib/listing/recognition/recognition-evidence-normalizer.mjs";
import {
  buildIdentityResultCacheKey,
  identityResultCacheReadEnabled,
  identityResultCacheRecordToListingResult,
  identityResultCacheWriteEnabled,
  readIdentityResultCacheRecord,
  saveIdentityResultCacheRecord
} from "../lib/listing/cache/identity-result-cache.mjs";
import {
  identityInFlightCoalescingEnabled,
  runWithInFlightIdentityRequest
} from "../lib/listing/cache/inflight-identity-request.mjs";
import {
  hasUsableVisualFeatures,
  lookupStoredVisualFeaturesForImages
} from "../lib/listing/retrieval/stored-visual-features.mjs";
import { runRetrieval } from "../lib/listing/retrieval/retrieval-engine.mjs";
import { retrievalModes, retrievalQueryFamilies } from "../lib/listing/retrieval/retrieval-contract.mjs";
import {
  buildVectorCandidateAssistPacket,
  buildVectorCandidatePacket,
  vectorCandidatePacketAssistEligibility
} from "../lib/listing/retrieval/vector-candidate-packet.mjs";
import { vectorRetrievalActive, vectorRetrievalConfig, vectorRetrievalModes } from "../lib/listing/retrieval/vector-feature-flags.mjs";
import { embedImagesWithVectorWorker } from "../lib/listing/retrieval/vector-worker-client.mjs";
import { recordVectorRetrievalTelemetry } from "../lib/listing/retrieval/vector-telemetry.mjs";
import { applyColdStartSafeDraftPolicy } from "../lib/listing/cold-start/cold-start-policy.mjs";
import { safeSurfaceColor } from "../lib/listing/parallel-policy.mjs";

const cookieName = "lynca_metaverse_session";
const maxFallbackTitleLength = 85;
// Accept optional bounded derived crop images while keeping provider input capped.
const defaultMaxPayloadImages = 14;
const signedUrlConcurrency = 4;
const promptRoot = join(process.cwd(), "prompts");
const promptFiles = [
  "listing-intelligence-v1.md",
  "examples/sports.md",
  "examples/pokemon.md",
  "examples/marvel.md",
  "examples/sketch.md",
  "examples/redemption.md"
];
let promptCache;
const catalogCandidateContextCache = new Map();
const defaultCatalogCacheTtlMs = 10 * 60 * 1000;
const defaultCatalogCacheMaxEntries = 500;
const defaultCatalogFastLaneBudgetMs = 120;

function envFlag(env, key, fallback = true) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

function positiveIntegerFromEnv(env, key, fallback) {
  const value = normalizePositiveIntegerOrNull(env?.[key]);
  return value === null ? fallback : value;
}

function configuredMaxPayloadImages(env = process.env) {
  return Math.max(2, normalizePositiveIntegerOrNull(env.LISTING_MAX_PAYLOAD_IMAGES) || defaultMaxPayloadImages);
}

function defaultProviderOptionsFromEnv(env = process.env) {
  const vectorAssistDefault = envFlag(env, "ENABLE_VECTOR_ASSIST_DEFAULT", true);
  const catalogAssistDefault = envFlag(env, "ENABLE_CATALOG_ASSIST_DEFAULT", true);
  return {
    single_model_fast: envFlag(env, "ENABLE_SINGLE_MODEL_FAST_PATH", false),
    enable_evidence_completion: envFlag(env, "ENABLE_EVIDENCE_COMPLETION", true),
    enable_catalog_assist: catalogAssistDefault,
    enable_vector_assist: vectorAssistDefault,
    enable_stored_visual_features: vectorAssistDefault,
    enable_query_visual_embeddings: vectorAssistDefault,
    enable_vector_retrieval: vectorAssistDefault,
    vector_retrieval_mode: vectorAssistDefault ? "assist" : "off",
    enable_advanced_retrieval: vectorAssistDefault,
    enable_hybrid_retrieval: vectorAssistDefault,
    cold_start_blind: envFlag(env, "ENABLE_COLD_START_BLIND_DEFAULT", false),
    enable_ephemeral_external_retrieval: envFlag(env, "ENABLE_EPHEMERAL_EXTERNAL_RETRIEVAL_DEFAULT", false),
    enable_gpt_failure_fallback: false,
    enable_gpt_provider_failure_fallback: false,
    enable_gpt_critical_verifier: false
  };
}

function providerOptionsFromPayload(payload = {}, env = process.env) {
  const options = payload.provider_options || payload.providerOptions || {};
  const explicitOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  return {
    ...defaultProviderOptionsFromEnv(env),
    ...explicitOptions
  };
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).replace(/\s+/g, " ").trim() !== "" && value !== "UNKNOWN";
}

function meaningfulObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.values(value).some(valuePresent);
}

function evalCatalogObservationHint(payload = {}, providerOptions = {}) {
  const evalMode = String(payload.provider_eval_mode || payload.providerEvalMode || "").trim();
  if (!evalMode) return {};
  if (optionFlag(providerOptions, "corrected_title_as_temporary_gt", false) !== true) return {};
  const hint = payload.catalog_observation_hint || payload.catalogObservationHint;
  return meaningfulObject(hint) ? hint : {};
}

function resolvedForRetrievalFromPayload(payload = {}, providerOptions = {}, recognitionEvidenceDocument = null) {
  const candidates = [
    recognitionEvidenceDocument?.resolved,
    evalCatalogObservationHint(payload, providerOptions),
    payload.resolved,
    payload.resolvedHint,
    payload.resolved_hint
  ];
  return candidates.find(meaningfulObject) || {};
}

function optionFlag(options, key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(options, key)) return fallback;
  const raw = options[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

function singleModelFastPathEnabled(env = process.env, options = {}) {
  return optionFlag(options, "single_model_fast", envFlag(env, "ENABLE_SINGLE_MODEL_FAST_PATH", false));
}

function evidenceCompletionEnabled(env = process.env, options = {}) {
  if (singleModelFastPathEnabled(env, options)) return false;
  return optionFlag(options, "enable_evidence_completion", envFlag(env, "ENABLE_EVIDENCE_COMPLETION", true));
}

function storedVisualFeatureLookupEnabled(env = process.env, options = {}) {
  if (vectorRetrievalActive(env, options)) return true;
  if (Object.prototype.hasOwnProperty.call(options, "enable_stored_visual_features")) {
    return optionFlag(options, "enable_stored_visual_features", false);
  }
  return envFlag(env, "ENABLE_STORED_VISUAL_FEATURE_LOOKUP", false);
}

function queryVisualVectorPreflightEnabled(env = process.env, options = {}) {
  if (vectorRetrievalActive(env, options)) return true;
  if (Object.prototype.hasOwnProperty.call(options, "enable_query_visual_embeddings")) {
    return optionFlag(options, "enable_query_visual_embeddings", false);
  }
  return envFlag(env, "ENABLE_QUERY_VISUAL_VECTOR_PREFLIGHT", false);
}

function nowMs() {
  return Date.now();
}

function emptyTiming() {
  return {
    client_image_prepare_ms: null,
    client_upload_ms: null,
    client_request_prepare_ms: null,
    client_api_roundtrip_ms: null,
    server_queue_ms: 0,
    provider_connect_ms: null,
    provider_first_token_ms: null,
    provider_total_ms: 0,
    approved_memory_lookup_ms: 0,
    identity_cache_lookup_ms: 0,
    memory_lookup_ms: 0,
    signed_url_ms: 0,
    image_quality_check_ms: 0,
    recognition_preflight_ms: 0,
    stored_visual_feature_lookup_ms: 0,
    catalog_retrieval_ms: 0,
    catalog_cache_ms: 0,
    vector_embedding_ms: 0,
    vector_retrieval_ms: 0,
    evidence_completion_ms: 0,
    retrieval_ms: 0,
    focused_reread_ms: 0,
    resolver_ms: 0,
    renderer_ms: 0,
    identity_cache_write_ms: 0,
    total_ms: 0
  };
}

function createTimingContext(payload = {}) {
  const timing = emptyTiming();
  const clientTiming = payload.clientTiming || payload.client_timing || {};
  [
    "client_image_prepare_ms",
    "client_upload_ms",
    "client_request_prepare_ms",
    "client_api_roundtrip_ms"
  ].forEach((key) => {
    const value = Number(clientTiming[key]);
    timing[key] = Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  });
  return {
    started_at_ms: nowMs(),
    timing
  };
}

function addTiming(timingContext, key, elapsedMs) {
  if (!timingContext?.timing || !key) return;
  const value = Number(elapsedMs);
  if (!Number.isFinite(value) || value < 0) return;
  timingContext.timing[key] = Math.round(Number(timingContext.timing[key] || 0) + value);
  if (key === "approved_memory_lookup_ms" || key === "identity_cache_lookup_ms") {
    timingContext.timing.memory_lookup_ms = Math.round(
      Number(timingContext.timing.approved_memory_lookup_ms || 0)
      + Number(timingContext.timing.identity_cache_lookup_ms || 0)
    );
  }
}

async function timeAsync(timingContext, key, work) {
  const startedAt = nowMs();
  try {
    return await work();
  } finally {
    addTiming(timingContext, key, nowMs() - startedAt);
  }
}

function timeSync(timingContext, key, work) {
  const startedAt = nowMs();
  try {
    return work();
  } finally {
    addTiming(timingContext, key, nowMs() - startedAt);
  }
}

function finalizeTiming(timingContext, result = {}) {
  const timing = {
    ...emptyTiming(),
    ...(timingContext?.timing || {})
  };
  timing.total_ms = Math.max(0, Math.round(nowMs() - Number(timingContext?.started_at_ms || nowMs())));
  timing.server_queue_ms = Math.max(0, Math.round(
    Number(timing.server_queue_ms || 0)
    + Number(result.identity_inflight?.coalesced ? result.identity_inflight.wait_ms : 0)
  ));

  const usageLatency = Number(result.usage?.latency_ms);
  if (!timing.provider_total_ms && Number.isFinite(usageLatency) && usageLatency > 0) {
    timing.provider_total_ms = Math.round(usageLatency);
  }

  return timing;
}

function withTiming(result = {}, timingContext) {
  const timedResult = {
    ...result,
    timing: finalizeTiming(timingContext, result)
  };
  return attachFieldTaskOrchestration(timedResult, { timing: timedResult.timing });
}

async function mapWithConcurrency(items, limit, worker) {
  const source = Array.from(items || []);
  const results = new Array(source.length);
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, source.length || 1));
  let cursor = 0;

  async function runWorker() {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

const defaultFields = {
  year: null,
  manufacturer: null,
  brand: null,
  product: null,
  multi_card: false,
  card_count: null,
  lot_type: null,
  set: null,
  subset: null,
  language: null,
  card_type: null,
  official_card_type: null,
  observable_components: [],
  insert: null,
  surface_color: null,
  parallel_family: null,
  parallel_exact: null,
  parallel: null,
  variation: null,
  player: null,
  players: [],
  character: null,
  card_name: null,
  artist: null,
  team: null,
  card_number: null,
  collector_number: null,
  checklist_code: null,
  serial_number: null,
  grade_company: null,
  grade: null,
  card_grade: null,
  auto_grade: null,
  grade_type: "UNKNOWN",
  rc: false,
  first_bowman: false,
  ssp: false,
  case_hit: false,
  auto: false,
  relic: false,
  patch: false,
  jersey: false,
  sketch: false,
  redemption: false,
  one_of_one: false
};
const backgroundTerms = [
  "Metaverse Cards",
  "LYNCA",
  "CardLadder",
  "eBay UI",
  "table mat",
  "watermark",
  "seller branding"
];
const backgroundTermPatterns = backgroundTerms.map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"));
const highValueInsertPatterns = highValueInsertTerms.map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return ["", ""];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key, value]) => key && value)
  );
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function isValidSession(cookie, secret) {
  if (!cookie || !secret) return false;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || signature !== sign(payload, secret)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function normalizeTitle(title, maxLength) {
  const normalized = String(title || "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
}

function normalizeRookieMarker(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return /^(?:RC|Rookie|Rookie Card|Rated Rookie)$/i.test(normalized) ? "RC" : normalized;
}

function normalizeSerialText(value) {
  return String(value || "")
    .replace(/\b(?:Serial|Numbered)\s*#?\s*(\d{1,4}\s*\/\s*\d{1,4})\b/gi, "$1")
    .replace(/#(\d{1,4})\s*\/\s*(\d{1,4})\b/g, "$1/$2")
    .replace(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g, "$1/$2")
    .replace(/\s+/g, " ")
    .trim();
}

function serialLimitForTitle(value, fields = {}) {
  return serialLimitText(value, { oneOfOne: fields.one_of_one });
}

function stripChecklistCardNumbers(title, fields = {}) {
  let cleaned = String(title || "");
  const serial = normalizeSerialText(fields.serial_number || "");

  cleaned = cleaned.replace(/#(?!(?:\d{1,4}\s*\/\s*\d{1,4})\b)[A-Z]{1,8}[- ][A-Z0-9]{1,12}\b/gi, " ");
  cleaned = cleaned.replace(/\b(?:TCAR|PRP|SR|DRL)[- ][A-Z0-9]{1,12}\b/gi, " ");

  const cardNumber = String(fields.card_number || "").replace(/^#/, "").trim();
  if (cardNumber && cardNumber !== serial && !/^\d{1,4}\s*\/\s*\d{1,4}$/.test(cardNumber)) {
    cleaned = stripLiteralPhrase(cleaned, `#${cardNumber}`);
    cleaned = stripLiteralPhrase(cleaned, cardNumber);
  }

  return normalizeSerialText(cleaned).replace(/\s+/g, " ").trim();
}

function cleanupTitleWording(title, maxLength) {
  const cleaned = suppressDuplicateAutoTerms(normalizeGradeDisplay(normalizeSerialText(title)
    .replace(/\b(Topps|Panini|Upper Deck|Bowman|Fleer|Donruss)\s+\1\b/gi, "$1")
    .replace(/\bTopps\s+Chrome\s+Autograph\s+Card\b/gi, "Topps Chrome Auto")
    .replace(/\bChrome\s+Autograph\s+Card\b/gi, "Chrome Auto")
    .replace(/\bChrome\s+Autograph\b/gi, "Chrome Auto")
    .replace(/\b(?:Certified\s+)?(?:On[- ]?card\s+|Sticker\s+)?Autograph\b/gi, "Auto")
    .replace(/\bDual\s+Auto\b/gi, "Dual Auto")
    .replace(/\bTriple\s+Auto\b/gi, "Triple Auto")
    .replace(/\bOne\s+of\s+One\b/gi, "1/1")
    .replace(/\bOne\b(?=\s*$)/gi, "1/1")
    .replace(/\bRated\s+Rookie\b/gi, "RC")
    .replace(/\bRookie\s+Card\b/gi, "RC")
    .replace(/\bRookie\s+RC\s+Card\b/gi, "RC")
    .replace(/\bRookie\s+RC\b/gi, "RC")
    .replace(/\bRC\s+Card\b/gi, "RC")
    .replace(/\bRookie\b(?!\s+(?:Refresh|Auto))/gi, "RC")
    .replace(/\bAutograph\s+Auto\b/gi, "Auto")
    .replace(/\bRefractor\s+Parallel\b/gi, "Refractor")
    .replace(/\bCard\s+Card\b/gi, "Card")
    .replace(/\bRC\s+RC\b/gi, "RC")
    .replace(/\bTopps\s+Chrome\s+Chrome\s+Auto\b/gi, "Topps Chrome Auto")
    .replace(/\bChrome\s+Chrome\s+Auto\b/gi, "Chrome Auto")
    .replace(/\bAuto\s+Auto\b/gi, "Auto")
    .replace(/\s+/g, " ")
    .trim()));

  return normalizeTitle(cleaned, maxLength);
}

function normalizeGradeDisplay(title) {
  return foldLooseAutoGrade(normalizeBgsGradeDisplay(normalizePsaGradeDisplay(title)));
}

function normalizePsaGradeDisplay(title) {
  return String(title || "")
    .replace(/\bPSA\s+(AUTH|AUTHENTIC)\s+Auto\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA Auth/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(\d+(?:\.\d+)?)\s+(?:GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)?\s*Auto\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(\d+(?:\.\d+)?)\s+(?:GEM\s+MINT|MINT|NM-MT|NM|EX-MT|EX)\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+Auto\s+(AUTH|AUTHENTIC|\d+(?:\.\d+)?)\b/gi, (_, autoGrade) => {
      return `PSA AUTO ${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\bPSA\s+(AUTH|AUTHENTIC)\b/gi, "PSA Auth")
    .replace(/\bPSA\s+AUTO\s+(AUTH|AUTHENTIC)\b/gi, "PSA AUTO Auth");
}

function normalizeBgsGradeDisplay(title) {
  return String(title || "")
    .replace(/\b(?:Gem\s+Mint\s+|Mint\s+)?Beckett\s+(Altered|Authentic|Auth|\d+(?:\.\d+)?)\s+BGS\s+\1\s+Auto\s+(\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `BGS ${normalizeBgsGradeToken(cardGrade)}/${normalizeBgsGradeToken(autoGrade)}`;
    })
    .replace(/\b(?:Gem\s+Mint\s+|Mint\s+)?Beckett\s+(Altered|Authentic|Auth|\d+(?:\.\d+)?)\s+BGS\s+\1\b/gi, (_, cardGrade) => {
      return `BGS ${normalizeBgsGradeToken(cardGrade)}`;
    })
    .replace(/\bBGS\s+(Altered|Authentic|Auth|\d+(?:\.\d+)?)\s+Auto\s+(\d+(?:\.\d+)?)\b/gi, (_, cardGrade, autoGrade) => {
      return `BGS ${normalizeBgsGradeToken(cardGrade)}/${normalizeBgsGradeToken(autoGrade)}`;
    })
    .replace(/\bBGS\s+Auto\s+(\d+(?:\.\d+)?)\b/gi, (_, autoGrade) => {
      return `BGS AUTO ${normalizeBgsGradeToken(autoGrade)}`;
    })
    .replace(/\bBGS\s+(Authentic|Auth)\b/gi, "BGS Auth")
    .replace(/\bBGS\s+Altered\b/gi, "BGS Altered");
}

function foldLooseAutoGrade(title) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();

  const gradeValuePattern = "(?:10|9(?:\\.5)?|8(?:\\.5)?|7(?:\\.5)?|6(?:\\.5)?|5(?:\\.5)?|4(?:\\.5)?|3(?:\\.5)?|2(?:\\.5)?|1(?:\\.5)?)";
  const psaLooseAutoGradePattern = new RegExp(`\\bPSA\\s+(?:\\d+(?:\\.\\d+)?\\s+)?(MINT|GEM\\s+MINT|NM-MT|NM|EX-MT|EX|AUTH|AUTHENTIC|ALTERED)?\\s*(${gradeValuePattern}|AUTH|AUTHENTIC|ALTERED)\\b(?=[\\s\\S]*\\b(?:PSA\\/DNA\\s+Cert\\s+)?(?:Autograph|Auto|AUTO)\\s+(AUTH|AUTHENTIC|${gradeValuePattern})\\b)`, "gi");
  const psaDescriptorGradePattern = new RegExp(`\\bPSA\\s+(?:${gradeValuePattern}\\s+)?(?:MINT|GEM\\s+MINT|NM-MT|NM|EX-MT|EX)\\s+(${gradeValuePattern})\\b(?=[\\s\\S]*\\b(?:PSA\\/DNA\\s+Cert\\s+)?(?:Autograph|Auto|AUTO)\\s+(AUTH|AUTHENTIC|${gradeValuePattern})\\b)`, "gi");
  const bgsLooseAutoGradePattern = new RegExp(`\\bBGS\\s+(?:\\d+(?:\\.\\d+)?\\s+)?(?:GEM\\s+MINT|MINT|NM-MT|NM|EX-MT|EX|AUTHENTIC|AUTH|ALTERED)?\\s*(${gradeValuePattern}|AUTHENTIC|AUTH|ALTERED)\\b(?=[\\s\\S]*\\b(?:Autograph|Auto|AUTO)\\s+(${gradeValuePattern})\\b)`, "gi");
  const bgsLeadingAutoGradePattern = new RegExp(`\\b(?:Autograph|Auto|AUTO)\\s+(${gradeValuePattern})\\s+BGS\\s+(?:GEM\\s+MINT|MINT|NM-MT|NM|EX-MT|EX|AUTHENTIC|AUTH|ALTERED)?\\s*(${gradeValuePattern}|AUTHENTIC|AUTH|ALTERED)\\b`, "gi");

  cleaned = cleaned.replace(
    psaDescriptorGradePattern,
    (_, cardGrade, autoGrade) => `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`
  );

  cleaned = cleaned.replace(
    psaLooseAutoGradePattern,
    (_, _descriptor, cardGrade, autoGrade) => `PSA ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`
  );

  cleaned = cleaned.replace(
    bgsLooseAutoGradePattern,
    (_, cardGrade, autoGrade) => `BGS ${normalizeBgsGradeToken(cardGrade)}/${normalizeBgsGradeToken(autoGrade)}`
  );

  cleaned = cleaned.replace(
    bgsLeadingAutoGradePattern,
    (_, autoGrade, cardGrade) => `BGS ${normalizeBgsGradeToken(cardGrade)}/${normalizeBgsGradeToken(autoGrade)}`
  );

  if (/\b(?:PSA|BGS)\s+(?:Auth|\d+(?:\.\d+)?)\/(?:Auth|\d+(?:\.\d+)?)\b/i.test(cleaned)) {
    cleaned = cleaned.replace(new RegExp(`\\b(?:PSA\\/DNA\\s+Cert\\s+)?(?:Autograph|Auto|AUTO)\\s+(AUTH|AUTHENTIC|${gradeValuePattern})\\b`, "gi"), " ");
  }

  return cleaned
    .replace(/\b(?:Gem\s+Mint|Mint|Authentic|Altered)\s+(?=BGS\s+(?:Altered|Auth|\d+(?:\.\d+)?(?:\/(?:Auth|\d+(?:\.\d+)?))?))/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePsaGradeToken(value) {
  const token = String(value || "").trim();
  return /^(?:AUTH|AUTHENTIC)$/i.test(token) ? "Auth" : token;
}

function normalizeBgsGradeToken(value) {
  const token = String(value || "").trim();
  if (/^Authentic$/i.test(token)) return "Auth";
  if (/^Auth$/i.test(token)) return "Auth";
  if (/^Altered$/i.test(token)) return "Altered";
  return token;
}

function suppressDuplicateAutoTerms(title) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const protectedAutoPhrases = [
    "Chrome Rookie Auto",
    "Chrome Auto",
    "Dual Signatures Auto",
    "PSA AUTO",
    "BGS AUTO"
  ];
  const placeholder = "__AUTO__";

  protectedAutoPhrases.forEach((phrase) => {
    cleaned = cleaned.replace(new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi"), phrase.replace(/\bAuto\b/i, placeholder));
  });

  const autoMatches = cleaned.match(/\bAuto\b/gi) || [];
  const hasProtectedAuto = cleaned.includes(placeholder);
  if (autoMatches.length <= 1 && !hasProtectedAuto) return cleaned;
  if (autoMatches.length <= 1 && !/\b(?:RC|Rookie)\s+Auto\b/i.test(cleaned)) {
    return cleaned
      .replace(new RegExp(placeholder, "g"), "Auto")
      .replace(/\b(PSA|BGS)\s+Auto\b/g, (_, company) => `${company} AUTO`);
  }
  if (autoMatches.length === 0) {
    return cleaned.replace(new RegExp(placeholder, "g"), "Auto");
  }

  if (hasProtectedAuto) {
    cleaned = cleaned
      .replace(/\bRC\s+Auto\b/gi, "RC")
      .replace(/\bRookie\s+Auto\b/gi, "Rookie")
      .replace(/\bAuto\b/gi, " ");
  } else {
    let seenAuto = false;
    cleaned = cleaned.replace(/\bAuto\b/gi, (match) => {
      if (seenAuto) return " ";
      seenAuto = true;
      return match;
    });
  }

  cleaned = cleaned
    .replace(new RegExp(placeholder, "g"), "Auto")
    .replace(/\b(PSA|BGS)\s+Auto\b/g, (_, company) => `${company} AUTO`)
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

function moveLeadingGradeToEnd(title, maxLength) {
  const normalized = cleanupTitleWording(title, maxLength);
  const leadingGrade = normalized.match(/^(PSA|BGS|CGC)\s+(?:GEM\s+MINT\s+|MINT\s+|PRISTINE\s+)?(\d+(?:\.\d+)?)\s+(.+)$/i);
  if (leadingGrade) {
    const [, company, grade, rest] = leadingGrade;
    return cleanupTitleWording(`${rest} ${company.toUpperCase()} ${grade}`, maxLength);
  }

  const gradePattern = /\b(?:PSA\s+(?:AUTO\s+)?(?:Auth\/(?:Auth|\d+(?:\.\d+)?)|\d+(?:\.\d+)?\/(?:Auth|\d+(?:\.\d+)?)|Auth|\d+(?:\.\d+)?)|BGS\s+(?:AUTO\s+)?(?:\d+(?:\.\d+)?\/(?:Auth|\d+(?:\.\d+)?)|Altered|Auth|\d+(?:\.\d+)?)|CGC\s+(?:Auth|\d+(?:\.\d+)?))\b/gi;
  const gradeMatches = [...normalized.matchAll(gradePattern)];
  if (gradeMatches.length === 0) return normalized;

  const grade = gradeMatches.at(-1)[0].replace(/\bPSA\s+AUTO\b/i, "PSA AUTO");
  const withoutGrade = normalized.replace(gradePattern, " ").replace(/\s+/g, " ").trim();
  if (!withoutGrade) return cleanupTitleWording(grade, maxLength);

  return cleanupTitleWording(`${withoutGrade} ${grade}`, maxLength);
}

function applySportsTitleGrammar(title, fields, maxLength) {
  if (!fields.player) return cleanupTitleWording(title, maxLength);

  let cleaned = cleanupTitleWording(positionSportsProductName(ensureSportsProductName(title, fields), fields), maxLength * 2);
  const cardType = resolveProtectedCardType(cleaned, fields);
  if (!cardType || !rawIncludes(cleaned, fields.player)) {
    return finalizeSportsTitle(cleaned, fields, maxLength);
  }

  const withoutCardType = stripLiteralPhrase(cleaned, cardType);
  const playerPattern = new RegExp(fields.player.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  cleaned = withoutCardType.replace(playerPattern, (match) => `${match} ${cardType}`);

  return finalizeSportsTitle(cleaned, fields, maxLength);
}

function finalizeSportsTitle(title, fields, maxLength) {
  const requiredTerms = [
    sportsTitleShouldRecoverSerial(fields, title) ? serialLimitForTitle(fields.serial_number, fields) : null,
    sportsTitleNeedsRc(fields, title) ? "RC" : null
  ].filter(Boolean);
  let cleaned = ensureSportsRcMarker(cleanupTitleWording(title, maxLength * 2), fields);

  if (requiredTerms.length > 0) {
    cleaned = fitRequiredTitleTerms(cleaned, requiredTerms, fields, maxLength);
  }

  return normalizeTitle(cleanupTitleWording(cleaned, maxLength * 2), maxLength);
}

function ensureSportsProductName(title, fields) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const brand = String(fields.brand || "").trim();
  const product = String(fields.product || "").trim();
  if (!product) return cleaned;

  const productName = sportsProductDisplayName(brand, product);
  if (brand && productName) {
    cleaned = cleaned.replace(
      new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      productName
    );
  }

  if (productName && !rawIncludes(cleaned, productName) && rawIncludes(cleaned, product)) {
    cleaned = cleaned.replace(new RegExp(`\\b${product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), productName);
  }

  const productCore = (brand
    ? product.replace(new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ")
    : product)
    .replace(/\bCollection\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (productName && productCore && !rawIncludes(cleaned, productName) && rawIncludes(cleaned, productCore)) {
    cleaned = cleaned.replace(new RegExp(`\\b${productCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), productName);
  }

  if (productName && productCore && productName !== productCore && rawIncludes(cleaned, productName)) {
    cleaned = dedupeRecoveredProductCore(cleaned, productName, productCore);
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

function positionSportsProductName(title, fields) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const productName = sportsProductDisplayName(fields.brand, fields.product);
  if (!productName || !rawIncludes(cleaned, productName)) return cleaned;

  cleaned = stripLiteralPhrase(cleaned, productName);
  const year = String(fields.year || "").trim();
  if (year && rawIncludes(cleaned, year)) {
    return cleaned.replace(new RegExp(`\\b${year.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), `${year} ${productName}`)
      .replace(/\s+/g, " ")
      .trim();
  }

  return `${productName} ${cleaned}`.replace(/\s+/g, " ").trim();
}

function dedupeRecoveredProductCore(title, productName, productCore) {
  const escapedCore = productCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedProduct = productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const productPattern = new RegExp(`\\b${escapedProduct}\\b`, "i");
  const corePattern = new RegExp(`\\b${escapedCore}\\b`, "gi");
  const productMatch = productPattern.exec(title);
  if (!productMatch) return title;

  return title.replace(corePattern, (match, offset) => {
    const insideProduct = offset >= productMatch.index && offset < productMatch.index + productMatch[0].length;
    return insideProduct ? match : " ";
  }).replace(/\s+/g, " ").trim();
}

function sportsProductDisplayName(brand, product) {
  const normalizedBrand = String(brand || "").trim();
  const normalizedProduct = String(product || "").replace(/\s+/g, " ").trim();
  if (!normalizedProduct) return normalizedProduct;

  if (/^Panini\s+Immaculate\s+Collection$/i.test(`${normalizedBrand} ${normalizedProduct}`) || /^Immaculate\s+Collection$/i.test(normalizedProduct)) {
    return "Panini Immaculate";
  }

  return normalizedBrand && !rawIncludes(normalizedProduct, normalizedBrand)
    ? `${normalizedBrand} ${normalizedProduct}`
    : normalizedProduct;
}

function ensureSportsRcMarker(title, fields) {
  let cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const needsRc = sportsTitleNeedsRc(fields, cleaned);

  if (!needsRc || /\bRC\b/i.test(cleaned)) return cleaned;

  const gradePattern = /\b(?:PSA\s+(?:AUTO\s+)?(?:Auth\/(?:Auth|\d+(?:\.\d+)?)|\d+(?:\.\d+)?\/(?:Auth|\d+(?:\.\d+)?)|Auth|\d+(?:\.\d+)?)|BGS\s+(?:AUTO\s+)?(?:\d+(?:\.\d+)?\/(?:Auth|\d+(?:\.\d+)?)|Altered|Auth|\d+(?:\.\d+)?)|CGC\s+(?:Auth|\d+(?:\.\d+)?))\b$/i;
  const grade = cleaned.match(gradePattern)?.[0];
  if (!grade) return `${cleaned} RC`.replace(/\s+/g, " ").trim();

  cleaned = cleaned.slice(0, -grade.length).trim();
  return `${cleaned} RC ${grade}`.replace(/\s+/g, " ").trim();
}

function sportsTitleNeedsRc(fields, title) {
  return /\bRC\b/i.test(String(fields.subset || ""))
    || /Chrome Rookie Auto/i.test(`${fields.insert || ""} ${title || ""}`);
}

function sportsTitleShouldRecoverSerial(fields, title) {
  if (!fields.serial_number) return false;
  if (titleIncludesSerial(title, fields)) return true;
  const combined = `${fields.insert || ""} ${fields.product || ""} ${title || ""}`;
  return /Chrome Rookie Auto|Chrome Auto|Dual Signatures|Duo Logoman Autographs|Star Swatch Signatures|Immaculate|Flawless|Prizm/i.test(combined);
}

function repairOrphanAutoGradeSuffix(title, fields, maxLength) {
  const serial = serialLimitForTitle(fields.serial_number || "", fields);
  if (/^\/\d+(?:\.\d+)?$/.test(serial)) return title;

  const repaired = String(title || "")
    .replace(/\s+\/(Auth|\d+(?:\.\d+)?)\s+(PSA|BGS)\s+(Auth|\d+(?:\.\d+)?)\b/gi, (_, autoGrade, company, cardGrade) => {
      return ` ${company.toUpperCase()} ${normalizePsaGradeToken(cardGrade)}/${normalizePsaGradeToken(autoGrade)}`;
    })
    .replace(/\s+/g, " ")
    .trim();

  return normalizeTitle(repaired, maxLength);
}

function resolveProtectedCardType(title, fields) {
  const protectedTypes = [
    "Chrome Rookie Auto",
    "Chrome Auto",
    "Dual Signatures Auto",
    "Dual Signatures",
    "Duo Logoman Autographs",
    "Star Swatch Signatures"
  ];
  const explicitInsert = protectedTypes.find((term) => rawIncludes(fields.insert, term));
  if (explicitInsert) return explicitInsert;
  return protectedTypes.find((term) => rawIncludes(title, term));
}

function stripBackgroundTerms(value) {
  return backgroundTermPatterns.reduce(
    (text, pattern) => text.replace(pattern, " "),
    String(value || "")
  ).replace(/\s+/g, " ").trim();
}

function stripLiteralPhrase(value, phrase) {
  const text = String(value || "");
  const needle = String(phrase || "").trim();
  if (!needle) return text;

  return text
    .replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rawIncludes(value, needle) {
  return String(value || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

function titleIncludesSerial(title, fields) {
  const serial = normalizeSerialText(fields.serial_number);
  const limit = serialLimitForTitle(fields.serial_number, fields);
  const normalizedTitle = normalizeSerialText(title);
  return Boolean(serial && rawIncludes(normalizedTitle, serial))
    || Boolean(limit && rawIncludes(normalizedTitle, limit));
}

function ensureTitleTerm(title, term) {
  if (!term || rawIncludes(title, term)) return title;
  return `${title} ${term}`.replace(/\s+/g, " ").trim();
}

function ensureTitleTerms(title, terms) {
  return terms.reduce((currentTitle, term) => ensureTitleTerm(currentTitle, term), title);
}

function compactLowPriorityTitleTerms(title, fields, maxLength) {
  if (String(title || "").length <= maxLength) return title;

  const lowPriorityTerms = [
    fields.team,
    fields.position,
    "NBA",
    "NFL",
    "MLB",
    "NHL",
    "UFC",
    "Golden State Warriors",
    "Oklahoma City Thunder",
    "Thunder",
    "Jersey No.",
    "Collection",
    "RC Card",
    "Card"
  ].filter(Boolean);

  return lowPriorityTerms.reduce(
    (currentTitle, term) => stripLiteralPhrase(currentTitle, term),
    title
  ).replace(/\s+/g, " ").trim();
}

function fitRequiredTitleTerms(title, requiredTerms, fields, maxLength) {
  let currentTitle = ensureTitleTerms(title, requiredTerms);
  let normalizedTitle = normalizeTitle(currentTitle, maxLength);

  if (requiredTerms.every((term) => rawIncludes(normalizedTitle, term))) {
    return currentTitle;
  }

  const removableTerms = [
    fields.team,
    fields.brand,
    fields.product,
    "Golden State Warriors",
    "Oklahoma City Thunder",
    "Thunder",
    "Immaculate Collection",
    "Collection",
    "Jersey No.",
    "RC Card",
    "Card"
  ].filter(Boolean);

  for (const term of removableTerms) {
    currentTitle = stripLiteralPhrase(currentTitle, term);
    currentTitle = ensureTitleTerms(currentTitle, requiredTerms);
    normalizedTitle = normalizeTitle(currentTitle, maxLength);

    if (requiredTerms.every((requiredTerm) => rawIncludes(normalizedTitle, requiredTerm))) {
      return currentTitle;
    }
  }

  return currentTitle;
}

function containsBackgroundTerm(value) {
  return backgroundTermPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(value || ""));
  });
}

function extractHighValueInsert(value) {
  const text = String(value || "");
  const index = highValueInsertPatterns.findIndex((pattern) => pattern.test(text));
  return index === -1 ? null : highValueInsertTerms[index];
}

function compactFileName(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolutionHints(resolutionMap) {
  return Object.entries(resolutionMap || {})
    .map(([code, label]) => `${code}: ${label}`)
    .join("\n");
}

function findResolutionLabel(text, resolutionMap) {
  const upperText = text.toUpperCase();
  const match = Object.entries(resolutionMap || {}).find(([code]) => upperText.includes(code.toUpperCase()));
  return match ? match : [];
}

async function loadPrompt() {
  if (promptCache) return promptCache;

  const sections = await Promise.all(promptFiles.map(async (file) => {
    const content = await readFile(join(promptRoot, file), "utf8");
    return `--- ${file} ---\n${content.trim()}`;
  }));

  promptCache = sections.join("\n\n");
  return promptCache;
}

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined || value === "") return false;
  return /^(true|yes|y|1|rc|rc logo|rookie|rookie card|rookie logo|rookie ticket|rated rookie|1st bowman|first bowman|auto|autograph|ssp|case hit|patch|relic|jersey|sketch|redemption|1\/1)$/i.test(normalizeStringOrNull(value) || "");
}

function normalizeObservableComponents(value) {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).filter(([, enabled]) => enabled === true).map(([component]) => component)
      : String(value || "").split(/[,\s/]+/);
  const aliases = {
    autograph: "auto",
    autographs: "auto",
    signature: "auto",
    signatures: "auto",
    signed: "auto",
    memorabilia: "relic",
    swatch: "relic",
    logoman: "relic",
    rookie: "rc",
    rookie_card: "rc",
    rookie_ticket: "rc",
    rated_rookie: "rc"
  };
  const allowed = new Set(["auto", "patch", "relic", "jersey", "rc", "sketch", "redemption"]);
  return [...new Set(raw
    .map((item) => String(item || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .map((item) => aliases[item] || item)
    .filter((item) => allowed.has(item)))];
}

function normalizeStringOrNull(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function cleanPlayerNameForFields(value) {
  let text = normalizeStringOrNull(value);
  if (!text) return null;
  text = text
    .replace(/^visible[_\s-]*text\s*:?\s*/i, "")
    .replace(/\bvisible[_\s-]*text\b.*$/i, "")
    .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b.*$/i, "")
    .replace(/\b(?:PSA|BGS|SGC|CGC|GEM\s*MT|MINT|AUTHENTIC)\b.*$/i, "")
    .replace(/\s+\b(?:Gold|Red|Blue|Green|Purple|Orange|Black|Silver|White|Yellow|Sapphire|Refractor|Prizm|Wave|Shimmer|Mojo|Cracked\s+Ice|Geometric|Variation|Auto|Autograph|Signatures?|Rookie|RC)\b.*$/i, "")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (/[|]/.test(text)) return null;
  if (/\/.+/.test(text)) return null;
  if (/\b(?:visible|copyright|trademark|legal|rights?|brand\s+elements?|designs?|trad(?:e)?|manufacturer|boilerplate|year|season|release|card|label|front|back|text|product|unknown|unreadable|unclear|athlete|subject)\b/i.test(text)) return null;
  if (/^(?:Autos?|Autographs?|Certified|Topps\s+Certified|Club\s+Legends|Historic\s+Ties(?:\s+Triple)?|Rookie\s+Ticket|Next\s+Stop\s+Signatures|Canvas\s+Creations(?:\s+Autos?)?|Hoopla|Material\s+Signatures|Variation[-\s]*Autograph|1983\s+Topps|Gem\s*Mt|Mint)$/i.test(text)) return null;
  if (/\b(?:Topps|Panini|Bowman|Donruss|Prizm|Finest|Chrome|Sapphire|Impeccable|Contenders|Absolute|Memorabilia|Triple\s+Threads|Certified)\b/i.test(text)) return null;
  if (/^(?:FC|AFC|CF|SC)\b/i.test(text) || /\b(?:FC|AFC|CF|SC|Barcelona|Angels|Yankees|Dodgers|Lakers|Celtics|Warriors|Bulls|Chiefs|Patriots|Cowboys)\b/i.test(text)) return null;
  if (/\d/.test(text)) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  return text;
}

function cleanProductNameForFields(value) {
  const text = normalizeStringOrNull(value);
  if (!text) return null;
  const normalized = text
    .replace(/\b(Panini|Topps|Bowman|Donruss)\s*[-–]\s*/gi, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
  const lower = normalized.toLowerCase();
  const exact = new Map([
    ["topps chrome", "Topps Chrome"],
    ["topps finest", "Topps Finest"],
    ["topps sapphire", "Topps Sapphire"],
    ["panini prizm", "Panini Prizm"],
    ["panini prizm fifa soccer", "Panini Prizm FIFA Soccer"],
    ["panini impeccable", "Panini Impeccable"],
    ["panini contenders", "Panini Contenders"],
    ["panini absolute memorabilia", "Panini Absolute Memorabilia"],
    ["topps triple threads", "Topps Triple Threads"]
  ]);
  return exact.get(lower) || normalized;
}

function normalizePlayerListForFields(fields = {}) {
  const rawPlayers = Array.isArray(fields.players) ? fields.players : [];
  const fallbackPlayers = rawPlayers.length
    ? []
    : String(fields.player || "")
      .split(/\s*\/\s*/)
      .filter(Boolean);
  const players = [...rawPlayers, ...fallbackPlayers]
    .map(cleanPlayerNameForFields)
    .filter(Boolean)
    .filter((player, index, list) => list.findIndex((item) => item.toLowerCase() === player.toLowerCase()) === index);
  return players;
}

function normalizePositiveIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function normalizeFields(fields = {}) {
  const cardCount = normalizePositiveIntegerOrNull(fields.card_count ?? fields.cardCount);
  const players = normalizePlayerListForFields(fields);
  const rawInsertText = normalizeStringOrNull(fields.insert);
  const observableComponents = normalizeObservableComponents(fields.observable_components || fields.observableComponents);
  const normalized = {
    year: normalizeStringOrNull(fields.year),
    manufacturer: normalizeStringOrNull(fields.manufacturer || fields.maker),
    brand: normalizeStringOrNull(fields.brand || fields.manufacturer || fields.maker),
    product: cleanProductNameForFields(fields.product || fields.product_or_set || fields.productOrSet),
    multi_card: normalizeBoolean(fields.multi_card ?? fields.multiCard) || Number(cardCount || 0) > 1,
    card_count: cardCount,
    lot_type: normalizeStringOrNull(fields.lot_type ?? fields.lotType),
    set: normalizeStringOrNull(fields.set),
    subset: normalizeStringOrNull(normalizeRookieMarker(fields.subset)),
    language: normalizeStringOrNull(fields.language),
    card_type: normalizeStringOrNull(fields.card_type || fields.cardType || fields.type),
    official_card_type: normalizeStringOrNull(fields.official_card_type || fields.officialCardType),
    observable_components: observableComponents,
    insert: rawInsertText,
    surface_color: normalizeStringOrNull(fields.surface_color || fields.surfaceColor || fields.color),
    parallel_family: normalizeStringOrNull(fields.parallel_family || fields.parallelFamily),
    parallel_exact: normalizeStringOrNull(fields.parallel_exact || fields.parallelExact || fields.exact_parallel || fields.exactParallel || fields.variant_or_parallel || fields.variantOrParallel),
    parallel: normalizeStringOrNull(fields.parallel),
    variation: normalizeStringOrNull(fields.variation),
    player: players.join(" / ") || cleanPlayerNameForFields(fields.player) || null,
    players,
    character: normalizeStringOrNull(fields.character),
    card_name: normalizeStringOrNull(fields.card_name || fields.cardName || fields.name),
    artist: normalizeStringOrNull(fields.artist),
    team: normalizeStringOrNull(fields.team),
    card_number: normalizeStringOrNull(fields.card_number),
    collector_number: normalizeStringOrNull(fields.collector_number),
    checklist_code: normalizeStringOrNull(fields.checklist_code),
    serial_number: normalizeStringOrNull(fields.serial_number),
    grade_company: normalizeStringOrNull(fields.grade_company),
    grade: normalizeStringOrNull(fields.grade || fields.card_grade),
    card_grade: normalizeStringOrNull(fields.card_grade || fields.grade),
    auto_grade: normalizeStringOrNull(fields.auto_grade),
    grade_type: normalizeStringOrNull(fields.grade_type) || "UNKNOWN",
    rc: normalizeBoolean(fields.rc) || observableComponents.includes("rc"),
    first_bowman: normalizeBoolean(fields.first_bowman),
    ssp: normalizeBoolean(fields.ssp),
    case_hit: normalizeBoolean(fields.case_hit),
    auto: normalizeBoolean(fields.auto) || observableComponents.includes("auto"),
    relic: normalizeBoolean(fields.relic) || observableComponents.includes("relic"),
    patch: normalizeBoolean(fields.patch) || observableComponents.includes("patch"),
    jersey: normalizeBoolean(fields.jersey) || observableComponents.includes("jersey"),
    sketch: normalizeBoolean(fields.sketch) || observableComponents.includes("sketch"),
    redemption: normalizeBoolean(fields.redemption) || observableComponents.includes("redemption"),
    one_of_one: normalizeBoolean(fields.one_of_one)
  };

  Object.keys(normalized).forEach((key) => {
    if (typeof normalized[key] === "string" && containsBackgroundTerm(normalized[key])) {
      normalized[key] = null;
    }
  });

  const explicitInsertEntry = resolveKnowledgeEntry(normalized.insert);
  if (explicitInsertEntry) {
    normalized.insert = explicitInsertEntry.label;
  }

  const registryInsert = resolveKnowledgeFromFields(normalized);
  if (registryInsert && !normalized.insert) {
    normalized.insert = registryInsert.label;
  }

  if (/^TCAR[- ]/i.test(normalized.card_number || "")) {
    normalized.insert = "Chrome Rookie Auto";
    normalized.auto = true;
  }

  if (/^SR[- ]/i.test(normalized.card_number || "")) {
    normalized.insert = "Star Swatch Signatures";
  }

  if (/cosmic chrome/i.test(`${normalized.brand || ""} ${normalized.product || ""} ${normalized.set || ""}`)) {
    normalized.product = "Topps Cosmic Chrome";
    if (normalized.brand && /topps/i.test(normalized.brand)) normalized.brand = "Topps";
  }

  if (/red propulsion/i.test(`${normalized.insert || ""} ${normalized.parallel || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Red Propulsion";
    normalized.parallel = null;
  }

  if (/dual signatures/i.test(`${normalized.insert || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Dual Signatures";
    normalized.auto = true;
  }

  if (/jersey\s+no\.?/i.test(rawInsertText || "")) {
    normalized.card_number = null;
    normalized.collector_number = null;
  }

  if (/duo logoman|dual rookie logoman/i.test(`${normalized.insert || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Duo Logoman Autographs";
    normalized.auto = true;
  }

  if (!normalized.observable_components.length) {
    ["auto", "patch", "relic", "jersey", "rc", "sketch", "redemption"].forEach((component) => {
      if (normalized[component]) normalized.observable_components.push(component);
    });
  }

  const parallelInsert = resolveKnowledgeEntry(normalized.parallel) || (
    extractHighValueInsert(normalized.parallel)
      ? { label: extractHighValueInsert(normalized.parallel) }
      : null
  );
  if (parallelInsert && normalized.insert === parallelInsert.label) {
    normalized.parallel = null;
  }

  return normalized;
}

function normalizeUnresolved(unresolved, fields = {}) {
  const candidates = Array.isArray(unresolved)
    ? unresolved
    : Array.isArray(fields.unresolvedFields)
      ? fields.unresolvedFields
      : [];

  return candidates
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function searchable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleIncludes(titleText, value) {
  const normalizedValue = searchable(value);
  if (!normalizedValue) return true;
  const parts = normalizedValue
    .split(" ")
    .filter((part) => part && part !== "/")
    .filter(Boolean);

  return parts.every((part) => titleText.includes(part));
}

function subjectIncluded(titleText, value) {
  if (!value) return true;
  if (titleIncludes(titleText, value)) return true;

  const parts = searchable(value)
    .split(" ")
    .filter((part) => part && part !== "/");
  const meaningfulParts = parts.filter((part) => part.length > 2);
  const lastPart = meaningfulParts.at(-1);

  return Boolean(lastPart && titleText.includes(lastPart));
}

function titleIncludesAny(titleText, values) {
  return values.some((value) => titleText.includes(value));
}

function commerciallyRequiresCardNumber(fields) {
  if (!fields.card_number) return false;
  if (resolveKnowledgeEntry(fields.card_number)) return false;
  if (/^(?:TCAR|PRP|SR|DRL)[- ]/i.test(String(fields.card_number))) return false;
  return false;
}

function gradeIncluded(titleText, grade) {
  if (!grade) return true;
  if (titleIncludes(titleText, grade)) return true;

  const numericGrade = String(grade).match(/\b\d+(?:\.\d+)?\b/);
  return Boolean(numericGrade && titleText.includes(numericGrade[0]));
}

function yearConflict(titleText, fieldYear) {
  if (!fieldYear) return false;
  const titleYears = titleText.match(/\b20\d{2}(?:-\d{2})?\b/g) || [];
  return titleYears.length > 0 && !titleYears.some((year) => year === fieldYear || year.startsWith(`${fieldYear}-`));
}

function textMentionsAny(text, words) {
  return words.some((word) => text.includes(word));
}

function hasStrongEvidence(reasonText) {
  if (textMentionsAny(reasonText, [
    "not label-backed",
    "not label backed",
    "no label",
    "without label",
    "not supported by label",
    "not confirmed"
  ])) {
    return false;
  }

  return textMentionsAny(reasonText, [
    "psa",
    "bgs",
    "beckett",
    "cgc",
    "label",
    "card text",
    "back text",
    "back-side",
    "back side",
    "reverse text",
    "printed",
    "states",
    "explicit"
  ]);
}

function auditParallelText(fields = {}) {
  return searchable([
    fields.parallel_exact,
    fields.parallel,
    fields.variation,
    fields.surface_color,
    fields.parallel_family
  ].filter(Boolean).join(" "));
}

function hasVisuallyGuessedParallel(fields, reasonText, unresolved) {
  const parallelText = auditParallelText(fields);
  if (!parallelText) return false;

  const combined = `${parallelText} ${reasonText} ${searchable(unresolved.join(" "))}`;
  return textMentionsAny(combined, [
    "visual",
    "looks",
    "appears",
    "inferred",
    "likely",
    "guess",
    "guessed",
    "uncertain",
    "not text supported",
    "not text-supported",
    "foil alone"
  ]) && !hasStrongEvidence(reasonText);
}

function hasUncertainty(reasonText, unresolved) {
  const unresolvedText = searchable(unresolved.join(" "));
  const combined = `${reasonText} ${unresolvedText}`;
  return textMentionsAny(combined, [
    "uncertain",
    "unsure",
    "likely",
    "inferred",
    "visual-only",
    "visual only",
    "appears",
    "seems",
    "possible",
    "may be",
    "review",
    "unclear",
    "ambiguous",
    "partial",
    "partially",
    "incomplete",
    "guess",
    "guessed",
    "not confirmed",
    "unresolved"
  ]);
}

function hasVisualOnlyParallelRisk(fields, reasonText, unresolved) {
  const parallelText = auditParallelText(fields);
  const combined = `${parallelText} ${reasonText} ${searchable(unresolved.join(" "))}`;
  const patternTerms = [
    "wave",
    "shimmer",
    "pattern",
    "foil",
    "refractor",
    "disco",
    "pulsar",
    "prizm",
    "parallel"
  ];

  if (!textMentionsAny(combined, patternTerms)) return false;
  if (!textMentionsAny(combined, ["visual", "looks", "appears", "inferred", "likely", "guess"]) && hasComplexVisualParallelRisk(fields.parallel)) {
    return !hasStrongEvidence(reasonText);
  }
  return textMentionsAny(combined, ["visual", "looks", "appears", "inferred", "likely", "guess"])
    && !hasStrongEvidence(reasonText);
}

function hasParallelReviewRequest(fields, reasonText, unresolved) {
  const parallelText = auditParallelText(fields);
  if (!parallelText) return false;

  const reviewText = searchable(unresolved.join(" "));
  const combined = `${parallelText} ${reasonText} ${reviewText}`;
  if (textMentionsAny(combined, [
    "exact parallel requires operator review",
    "exact parallel requires review",
    "visual-only parallel requires operator review",
    "visual only parallel requires operator review",
    "parallel requires operator review",
    "parallel requires review",
    "parallel require review",
    "parallel uncertain",
    "uncertain parallel",
    "exact geometric parallel requires review"
  ])) {
    return true;
  }

  const isParallelLike = textMentionsAny(combined, [
    "parallel",
    "variation",
    "color",
    "foil",
    "pattern",
    "geometric",
    "wave",
    "shimmer",
    "refractor",
    "prizm"
  ]);
  const asksReview = textMentionsAny(combined, [
    "operator review",
    "requires review",
    "manual review",
    "needs review",
    "unconfirmed",
    "not confirmed",
    "uncertain"
  ]);

  return isParallelLike && asksReview;
}

function suppressReviewOnlyParallelFields(fields, reason, unresolved = []) {
  const reasonText = searchable(reason);
  if (!hasParallelReviewRequest(fields, reasonText, unresolved)
    && !hasVisualOnlyParallelRisk(fields, reasonText, unresolved)
    && !hasVisuallyGuessedParallel(fields, reasonText, unresolved)) {
    return fields;
  }

  const suppressed = { ...fields };
  [
    "surface_color",
    "parallel_family",
    "parallel_exact",
    "parallel",
    "variation"
  ].forEach((field) => {
    if (suppressed[field] !== undefined) suppressed[field] = null;
  });
  return suppressed;
}

function narrowSurfaceColorFromOpenSetParallel(fields = {}) {
  const explicitColor = safeSurfaceColor(fields.surface_color);
  if (explicitColor && !openSetSurfaceColorPatternContaminated(fields)) return explicitColor;

  for (const value of [
    fields.parallel_exact,
    fields.parallel,
    fields.variation,
    fields.parallel_family
  ]) {
    const text = String(value || "");
    if (!text) continue;
    if (/\btiger\s+stripe\b/i.test(text)) continue;
    const color = safeSurfaceColor(text);
    if (color) return color;
  }
  return "";
}

const directParallelEvidenceSources = new Set([
  "SLAB_LABEL",
  "CARD_BACK_PRINTED_TEXT",
  "CARD_FRONT_PRINTED_TEXT",
  "CARD_BACK",
  "CARD_FRONT",
  "OFFICIAL_CHECKLIST",
  "OFFICIAL_REGISTRY",
  "STRUCTURED_DATABASE",
  "INTERNAL_APPROVED_HISTORY"
]);

function sourceName(value = {}) {
  return String(value.source || value.source_type || value.original_source || "").toUpperCase();
}

function sourceHasExplicitDirectEvidence(value = {}) {
  const metadata = value.metadata || {};
  return value.direct_observation === true
    || value.directly_observed === true
    || value.text_visible === true
    || value.visible_marker === true
    || metadata.direct_observation === true
    || metadata.directly_observed === true
    || metadata.text_visible === true
    || metadata.visible_marker === true;
}

function evidenceNodeHasDirectParallelSupport(node = {}) {
  const sources = [
    ...(Array.isArray(node.sources) ? node.sources : []),
    ...(Array.isArray(node.supporting_sources) ? node.supporting_sources : [])
  ];
  if (sources.some((source) => directParallelEvidenceSources.has(sourceName(source)) && sourceHasExplicitDirectEvidence(source))) return true;

  const candidates = Array.isArray(node.candidates) ? node.candidates : [];
  return candidates.some((candidate) => {
    return [
      ...(Array.isArray(candidate.sources) ? candidate.sources : []),
      ...(Array.isArray(candidate.supporting_sources) ? candidate.supporting_sources : [])
    ].some((source) => directParallelEvidenceSources.has(sourceName(source)) && sourceHasExplicitDirectEvidence(source));
  });
}

function resultHasDirectParallelSupport(result = {}) {
  const parallelFields = ["surface_color", "parallel_family", "parallel_exact", "parallel", "variation"];
  const evidence = result.evidence || result.normalized_evidence || {};
  if (parallelFields.some((field) => evidenceNodeHasDirectParallelSupport(evidence[field]))) return true;

  const fieldStates = Array.isArray(result.field_states) ? result.field_states : [];
  return fieldStates.some((fieldState) => {
    return parallelFields.includes(fieldState.field) && evidenceNodeHasDirectParallelSupport(fieldState);
  });
}

function openSetSurfaceColorPatternContaminated(fields = {}) {
  const combined = searchable([
    fields.insert,
    fields.card_type,
    fields.official_card_type,
    fields.subset,
    fields.parallel_exact,
    fields.parallel,
    fields.variation
  ].filter(Boolean).join(" "));
  return textMentionsAny(combined, [
    "tiger",
    "zebra",
    "snakeskin",
    "snake skin",
    "elephant",
    "leopard",
    "animal print"
  ]);
}

function stripOpenSetUnsupportedParallelTerms(value) {
  const original = normalizeStringOrNull(value);
  if (!original) return null;
  const originalSearchable = searchable(original);
  const hasUnsupportedParallelTerm = textMentionsAny(originalSearchable, [
    "cracked ice",
    "disco",
    "geometric",
    "hyper",
    "lava",
    "mojo",
    "prism",
    "prizm",
    "refractor",
    "sapphire",
    "shimmer",
    "sparkle",
    "speckle",
    "tiger",
    "velocity",
    "vinyl",
    "wave",
    "x-fractor",
    "xfractor"
  ]);
  if (!hasUnsupportedParallelTerm) return original;

  const stripped = original
    .replace(/\b(?:Cracked\s+Ice|Tiger\s+Stripes?|Tiger|X[-\s]?Fractor|Refractor|Sapphire|Shimmer|Sparkles?|Speckle|Geometric|Velocity|Prizms?|Prism|Mojo|Disco|Pulsar|Hyper|Lava|Vinyl|Wave)\b/gi, " ")
    .replace(/\b(?:Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || null;
}

function stripOpenSetUnsupportedTitleTerms(value) {
  const original = normalizeStringOrNull(value);
  if (!original) return "";
  const protectedPhrases = [];
  let text = original.replace(/\b(?:Topps|Bowman)\s+Chrome\s+Sapphire(?:\s+Edition)?\b|\bPanini\s+Prizm(?:\s+FIFA(?:\s+Soccer)?)?\b/gi, (match) => {
    const token = `__LYNCA_PRODUCT_${protectedPhrases.length}__`;
    protectedPhrases.push({ token, value: match });
    return token;
  });
  const animalPattern = /\b(?:Tiger|Zebra|Snakeskin|Snake\s+Skin|Elephant|Leopard|Animal\s+Print)\b/i.test(text);
  text = text
    .replace(/\b(?:Cracked\s+Ice|Tiger\s+Stripes?|Tiger|X[-\s]?Fractor|Refractor|Sapphire|Shimmer|Sparkles?|Speckle|Geometric|Velocity|Prizms?|Prism|Mojo|Disco|Pulsar|Hyper|Lava|Vinyl|Wave)\b/gi, " ");
  if (animalPattern) {
    text = text.replace(/\b(?:Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/gi, " ");
  }
  text = text
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+\/\s+/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
  for (const phrase of protectedPhrases) {
    text = text.replace(phrase.token, phrase.value);
  }
  return text.replace(/\s+/g, " ").trim();
}

function exactParallelFieldsPresent(fields = {}) {
  return [
    fields.parallel_exact,
    fields.parallel_family,
    fields.parallel,
    fields.variation
  ].some((value) => {
    return valuePresent(value) && stripOpenSetUnsupportedParallelTerms(value) !== normalizeStringOrNull(value);
  });
}

function openSetUnsupportedParallelPresentationPresent(fields = {}) {
  return [
    fields.insert,
    fields.card_type,
    fields.official_card_type,
    fields.subset
  ].some((value) => stripOpenSetUnsupportedParallelTerms(value) !== normalizeStringOrNull(value));
}

function openSetAssistShadowGuardReason(result = {}) {
  const fastPath = result.fast_path || {};
  const reasonText = searchable([
    result.route_reason,
    fastPath.reason,
    result.completion_state?.open_set_reason,
    result.open_set_reason
  ].filter(Boolean).join(" "));
  if (fastPath.assist_shadow_only === true) return "assist_shadow_no_prompt_safe_candidates";
  if (reasonText.includes("assist shadow no prompt safe candidates")) return "assist_shadow_no_prompt_safe_candidates";
  if (reasonText.includes("no prompt safe catalog or vector candidates")) return "assist_shadow_no_prompt_safe_candidates";
  return "";
}

function applyOpenSetAssistShadowPresentationGuard(result = {}, payload = {}) {
  const guardReason = openSetAssistShadowGuardReason(result);
  if (!guardReason) return result;

  const legacyFields = {
    ...(result.fields || {})
  };
  const resolvedFields = {
    ...(result.resolved || result.resolved_fields || {})
  };
  const mergedFields = {
    ...resolvedFields,
    ...legacyFields
  };
  const hadExactParallel = exactParallelFieldsPresent(mergedFields);
  const hadUnsupportedPresentationParallel = openSetUnsupportedParallelPresentationPresent(mergedFields);
  const preservedSurfaceColor = narrowSurfaceColorFromOpenSetParallel(mergedFields);
  if (resultHasDirectParallelSupport(result)) {
    return {
      ...result,
      open_set_presentation_guard: {
        used: false,
        reason: guardReason,
        action: "direct_parallel_evidence_preserved"
      }
    };
  }
  const currentTitle = result.rendered_title || result.final_title || result.title || "";
  const titleAfterOpenSetStrip = stripOpenSetUnsupportedTitleTerms(currentTitle);
  const hadUnsupportedTitleParallel = Boolean(titleAfterOpenSetStrip && titleAfterOpenSetStrip !== normalizeStringOrNull(currentTitle));
  if (!hadExactParallel && !hadUnsupportedPresentationParallel && !hadUnsupportedTitleParallel && !preservedSurfaceColor) {
    return {
      ...result,
      open_set_presentation_guard: {
        used: false,
        reason: guardReason,
        action: "no_parallel_fields_present"
      }
    };
  }

  const guardedLegacyFields = {
    ...legacyFields,
    insert: stripOpenSetUnsupportedParallelTerms(legacyFields.insert),
    card_type: stripOpenSetUnsupportedParallelTerms(legacyFields.card_type),
    official_card_type: stripOpenSetUnsupportedParallelTerms(legacyFields.official_card_type),
    subset: stripOpenSetUnsupportedParallelTerms(legacyFields.subset),
    surface_color: preservedSurfaceColor || null,
    parallel_family: null,
    parallel_exact: null,
    parallel: null,
    variation: null
  };
  const guardedResolvedFields = {
    ...resolvedFields,
    insert: stripOpenSetUnsupportedParallelTerms(resolvedFields.insert),
    card_type: stripOpenSetUnsupportedParallelTerms(resolvedFields.card_type),
    official_card_type: stripOpenSetUnsupportedParallelTerms(resolvedFields.official_card_type),
    subset: stripOpenSetUnsupportedParallelTerms(resolvedFields.subset),
    surface_color: preservedSurfaceColor || null,
    parallel_family: null,
    parallel_exact: null,
    parallel: null,
    variation: null
  };
  const presentation = renderListingPresentation({
    resolved: guardedResolvedFields,
    evidence: result.evidence || result.normalized_evidence || {},
    maxLength: payload.maxTitleLength || maxFallbackTitleLength
  });
  const renderedTitle = stripOpenSetUnsupportedTitleTerms(
    presentation.rendered_title || result.rendered_title || result.final_title || result.title || ""
  );
  const unresolved = uniqueValues([
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    hadExactParallel || hadUnsupportedPresentationParallel || hadUnsupportedTitleParallel ? "open-set exact parallel requires catalog or writer review" : null,
    preservedSurfaceColor ? "surface color retained as narrow observable value" : null
  ]);

  return {
    ...result,
    title: renderedTitle,
    final_title: renderedTitle,
    rendered_title: renderedTitle,
    model_title_suggestion: renderedTitle,
    title_render_source: "open_set_narrow_parallel_guard",
    fields: guardedLegacyFields,
    resolved: guardedResolvedFields,
    resolved_fields: guardedResolvedFields,
    evidence_fields: {
      ...(result.evidence_fields || {}),
      surface_color: preservedSurfaceColor || null,
      parallel_family: null,
      parallel_exact: null,
      parallel: null,
      variation: null
    },
    unresolved,
    open_set_presentation_guard: {
      used: true,
      reason: guardReason,
      action: "downgraded_exact_parallel_to_surface_color",
      removed_fields: [
        "parallel_exact",
        "parallel_family",
        "parallel",
        "variation"
      ],
      preserved_surface_color: preservedSurfaceColor || null
    },
    rendered_fields: {
      ...(result.rendered_fields || {}),
      ...guardedLegacyFields,
      title: renderedTitle,
      rendered_title: renderedTitle,
      modules: presentation.modules,
      module_order: presentation.module_order,
      title_render_source: "open_set_narrow_parallel_guard",
      fields: guardedLegacyFields
    },
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer || result.renderer,
    renderer_version: presentation.renderer_version || result.renderer_version,
    title_length_policy: presentation.title_length_policy || result.title_length_policy
  };
}

function auditMissingHighValueFields(title, fields) {
  const titleText = searchable(title);
  const missing = [];

  if (fields.player && !subjectIncluded(titleText, fields.player)) {
    missing.push("player");
  }

  if (fields.character && !subjectIncluded(titleText, fields.character)) {
    missing.push("character");
  }

  if (fields.year && (!titleText.includes(fields.year) || yearConflict(titleText, fields.year))) {
    missing.push("year");
  }

  if (fields.serial_number && !titleIncludesSerial(title, fields)) {
    missing.push("serial");
  }

  const cardNumberRegistryEntry = resolveKnowledgeEntry(fields.card_number);
  if (
    commerciallyRequiresCardNumber(fields)
    && !titleIncludes(titleText, fields.card_number)
    && !(cardNumberRegistryEntry && titleIncludes(titleText, cardNumberRegistryEntry.label))
  ) {
    missing.push("card number");
  }

  if (fields.auto && !titleIncludesAny(titleText, ["auto", "autograph", "signed"])) {
    missing.push("auto");
  }

  if (fields.relic && !titleIncludesAny(titleText, ["relic", "memorabilia"])) {
    missing.push("relic");
  }

  if (fields.patch && !titleText.includes("patch")) {
    missing.push("patch");
  }

  if (fields.sketch && !titleText.includes("sketch")) {
    missing.push("sketch");
  }

  if (fields.redemption && !titleText.includes("redemption")) {
    missing.push("redemption");
  }

  if (fields.one_of_one && !titleIncludesAny(titleText, ["1/1", "01/01", "001/001", "one of one"])) {
    missing.push("1/1");
  }

  if (fields.grade_company && !titleIncludes(titleText, fields.grade_company)) {
    missing.push("grade company");
  }

  if (fields.grade && !gradeIncluded(titleText, fields.grade)) {
    missing.push("grade");
  }

  if (fields.subset && /\b(rookie|rc|1st bowman|1st)\b/i.test(fields.subset) && !titleIncludes(titleText, fields.subset)) {
    missing.push("rookie/1st");
  }

  return missing;
}

function parallelRequiresTitlePresence(fields = {}, reasonText = "", unresolved = []) {
  const parallelText = auditParallelText(fields);
  if (!parallelText) return false;
  if (hasParallelReviewRequest(fields, reasonText, unresolved)
    || hasVisualOnlyParallelRisk(fields, reasonText, unresolved)
    || hasVisuallyGuessedParallel(fields, reasonText, unresolved)) {
    return false;
  }
  if (fields.parallel_exact || fields.parallel_family) return true;
  return textMentionsAny(reasonText, [
    "printed parallel",
    "parallel printed",
    "card text supports parallel",
    "front card text supports parallel",
    "back text supports parallel",
    "slab label supports parallel",
    "label supports parallel",
    "registry supports parallel",
    "checklist supports parallel",
    "official checklist supports parallel"
  ]);
}

function auditMissingReviewFields(title, fields, reasonText = "", unresolved = []) {
  const titleText = searchable(title);
  const missing = [];

  if (parallelRequiresTitlePresence(fields, reasonText, unresolved)
    && ![fields.parallel_exact, fields.parallel_family, fields.parallel, fields.variation, fields.surface_color]
      .filter(Boolean)
      .some((value) => titleIncludes(titleText, value))) {
    missing.push("parallel");
  }

  if (fields.insert && !titleIncludes(titleText, fields.insert)) {
    missing.push("insert");
  }

  return missing;
}

function calibrateConfidence({ title, confidence, reason, fields, unresolved }) {
  if (confidence === "FAILED") return { confidence, reason, unresolved };

  const reasonText = searchable(reason);
  const missingHighValueFields = auditMissingHighValueFields(title, fields);
  const calibratedUnresolved = [...unresolved];
  missingHighValueFields.forEach((field) => {
    const label = `title missing ${field}`;
    if (!calibratedUnresolved.includes(label)) calibratedUnresolved.push(label);
  });

  const lowTriggers = missingHighValueFields.length > 0
    || yearConflict(searchable(title), fields.year)
    || textMentionsAny(`${reasonText} ${searchable(unresolved.join(" "))}`, [
      "wrong year",
      "year mismatch",
      "wrong serial",
      "serial mismatch",
      "missing auto",
      "missing serial",
      "missing grade",
      "missing player",
      "missing character",
      "missing card number",
      "missing 1/1",
      "missing rookie",
      "missing 1st bowman",
      "contradicts title"
    ]);

  if (lowTriggers) {
    return {
      confidence: "LOW",
      reason: appendCalibrationReason(reason, "Confidence downgraded: high-value fields require manual correction."),
      unresolved: calibratedUnresolved.slice(0, 12)
    };
  }

  if (confidence !== "HIGH") {
    return { confidence, reason, unresolved: calibratedUnresolved };
  }

  const missingReviewFields = auditMissingReviewFields(title, fields, reasonText, calibratedUnresolved);
  missingReviewFields.forEach((field) => {
    const label = `title missing ${field}`;
    if (!calibratedUnresolved.includes(label)) calibratedUnresolved.push(label);
  });

  const highAllowed = hasStrongEvidence(reasonText)
    && calibratedUnresolved.length === 0
    && !hasUncertainty(reasonText, calibratedUnresolved)
    && !hasVisualOnlyParallelRisk(fields, reasonText, calibratedUnresolved)
    && !hasVisuallyGuessedParallel(fields, reasonText, calibratedUnresolved);

  if (highAllowed) {
    return { confidence, reason, unresolved: calibratedUnresolved };
  }

  const reviewLabel = "operator review required";
  if (!calibratedUnresolved.includes(reviewLabel)) calibratedUnresolved.push(reviewLabel);

  return {
    confidence: "MEDIUM",
    reason: appendCalibrationReason(reason, "Confidence downgraded: core identity fields may be usable, but listing readiness requires operator review."),
    unresolved: calibratedUnresolved.slice(0, 12)
  };
}

function appendCalibrationReason(reason, calibrationReason) {
  const base = String(reason || "").trim();
  const combined = base ? `${base} ${calibrationReason}` : calibrationReason;
  return combined.slice(0, 520);
}

function sanitizeResultText(result, fields, confidence, unresolved, maxTitleLength) {
  const hadBackgroundContamination = [
    result.title,
    result.reason,
    ...Object.values(result.fields || {})
  ].some((value) => typeof value === "string" && containsBackgroundTerm(value));

  const highValueInsert = resolveKnowledgeEntry(fields.insert)?.label || extractHighValueInsert(fields.insert);
  const rawTitle = stripChecklistCardNumbers(stripBackgroundTerms(result.title), fields)
    .replace(/\bBase\b/gi, fields.insert || fields.parallel ? " " : "Base")
    .replace(/\s+/g, " ")
    .trim();
  const requiredTitleTerms = [
    fields.product && !rawIncludes(rawTitle, fields.product) ? fields.product : null,
    fields.product === "Topps Cosmic Chrome" ? "Cosmic Chrome" : null,
    highValueInsert,
    fields.parallel === "Platinum" ? "Platinum" : null,
    titleIncludesSerial(rawTitle, fields) ? serialLimitForTitle(fields.serial_number, fields) : null,
    fields.one_of_one ? "1/1" : null,
    fields.grade_company && fields.grade ? `${fields.grade_company} ${String(fields.grade).match(/\d+(?:\.\d+)?/)?.[0] || fields.grade}` : null,
    fields.grade_company && /auto/i.test(String(result.title || "")) && /auto\s*10/i.test(String(result.title || "")) ? "Auto 10" : null
  ].filter(Boolean);
  let strippedTitle = rawTitle;

  if (fields.product === "Topps Cosmic Chrome") {
    strippedTitle = strippedTitle
      .replace(/\bTopps\s+Chrome\s+Cosmic\b/gi, "Topps Cosmic Chrome")
      .replace(/\bTopps\s+Chrome\b/gi, "Topps Cosmic Chrome");
  }

  if (fields.year && yearConflict(searchable(strippedTitle), fields.year)) {
    strippedTitle = strippedTitle.replace(/\b20\d{2}(?:-\d{2})?\b/, fields.year);
  }

  if (fields.one_of_one) {
    strippedTitle = strippedTitle
      .replace(/\bOne\s+of\s+One\b/gi, "1/1")
      .replace(/\bOne\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (highValueInsert === "Red Propulsion") {
    strippedTitle = strippedTitle.replace(/\bPropulsion\b/gi, "Red Propulsion");
  }

  if (highValueInsert === "Dual Signatures") {
    strippedTitle = strippedTitle.replace(/\bDual\b(?!\s+Signatures\b)/gi, "Dual Signatures");
    strippedTitle = strippedTitle.replace(/\bDual\s+Signatures\b(?!\s+Auto\b)/gi, "Dual Signatures Auto");
  }

  if (highValueInsert === "Duo Logoman Autographs") {
    strippedTitle = strippedTitle.replace(/\bDual\s+Auto\b|\bDual\b/gi, "Duo Logoman Autographs");
  }

  if (highValueInsert === "Star Swatch Signatures") {
    strippedTitle = strippedTitle.replace(/\bPatch\s+Auto\b/gi, "Star Swatch Signatures");
  }

  const repairedTitle = fitRequiredTitleTerms(
    compactLowPriorityTitleTerms(strippedTitle, fields, maxTitleLength),
    requiredTitleTerms,
    fields,
    maxTitleLength
  );
  const repairedHighValueInsert = Boolean(highValueInsert && !rawIncludes(strippedTitle, highValueInsert));
  const title = applySportsTitleGrammar(repairedTitle, fields, maxTitleLength);
  let reason = stripBackgroundTerms(result.reason);
  let guardedConfidence = confidence;
  const guardedUnresolved = [...unresolved];

  if (repairedHighValueInsert) {
    reason = appendCalibrationReason(reason, "High-value insert term preserved from structured evidence.");
  }

  const illustratorGuard = applyIllustratorMetadataGuard({
    title,
    reason: hadBackgroundContamination
      ? appendCalibrationReason(reason, "Background branding ignored.")
      : reason,
    fields,
    confidence: guardedConfidence,
    unresolved: guardedUnresolved,
    maxTitleLength
  });

  return {
    ...illustratorGuard,
    hadBackgroundContamination
  };
}

function applyIllustratorMetadataGuard({ title, reason, fields, confidence, unresolved, maxTitleLength }) {
  if (!fields.artist || fields.sketch) {
    return { title, reason, confidence, unresolved };
  }

  const artistInTitle = rawIncludes(title, fields.artist);
  const identity = fields.character || fields.player;
  const likelyPokemonTrainer = [
    title,
    reason,
    fields.brand,
    fields.product,
    fields.set,
    fields.subset,
    fields.insert
  ].some((value) => /pokemon|pokémon|trainer|supporter|tcg|支援者|训练家|訓練家|寶可夢|宝可梦/i.test(String(value || "")));

  if (!artistInTitle && !likelyPokemonTrainer) {
    return { title, reason, confidence, unresolved };
  }

  let guardedTitle = artistInTitle ? stripLiteralPhrase(title, fields.artist) : title;
  if (likelyPokemonTrainer && !fields.year) {
    guardedTitle = guardedTitle.replace(/\b20\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
  }

  if (identity && !rawIncludes(guardedTitle, identity)) {
    guardedTitle = `${identity} ${guardedTitle}`.replace(/\s+/g, " ").trim();
  }

  guardedTitle = ensureTitleTerm(guardedTitle, fields.card_number);
  guardedTitle = ensureTitleTerm(guardedTitle, fields.subset);
  guardedTitle = ensureTitleTerm(guardedTitle, fields.set);

  const guardedUnresolved = [...unresolved];
  if (!guardedUnresolved.includes("illustrator metadata only")) {
    guardedUnresolved.push("illustrator metadata only");
  }

  return {
    title: normalizeTitle(guardedTitle, maxTitleLength),
    confidence: confidence === "HIGH" ? "MEDIUM" : confidence,
    reason: appendCalibrationReason(reason, identity
      ? "Illustrator is metadata only."
      : "Illustrator is metadata only; localized trainer identity requires operator review."),
    unresolved: guardedUnresolved
  };
}

function fallbackBaseResult(payload) {
  const firstImage = payload.images?.[0] || {};
  const sourceName = compactFileName(firstImage.name);
  const [code, resolvedLabel] = findResolutionLabel(firstImage.name, payload.resolutionMap);
  const titleParts = [sourceName];

  if (resolvedLabel && !sourceName.toLowerCase().includes(String(resolvedLabel).toLowerCase())) {
    titleParts.push(resolvedLabel);
  }

  const title = normalizeTitle(titleParts.filter(Boolean).join(" "), payload.maxTitleLength || maxFallbackTitleLength);

  const result = {
    title,
    confidence: title ? "MEDIUM" : "FAILED",
    reason: title
      ? "Fallback result from filename because no vision provider is configured."
      : "No usable filename or AI configuration.",
    fields: {
      ...defaultFields,
      insert: resolvedLabel || null,
      card_number: code || null
    },
    unresolved: ["image identification", "market wording"],
    capture_profile_id: payload.captureProfileId || defaultCaptureProfileId,
    capture_quality: captureQualityForPayload(payload),
    source: "fallback"
  };

  return withEvidenceCompatibility(result, result, payload);
}

async function fallbackResult(payload) {
  const primaryPayload = primaryPayloadForProvider(payload);
  return withEvidenceCompletion(fallbackBaseResult(primaryPayload), primaryPayload);
}

function captureQualityForPayload(payload = {}) {
  return payload.captureQuality || payload.capture_quality || summarizeAssetImageQuality(payload.images || []);
}

function createPreProviderRescanResult(payload = {}) {
  const captureQuality = captureQualityForPayload(payload);
  const decision = evaluatePreProviderRescanGate({ captureQuality });
  if (!decision.blocked) return null;

  const blockingRegions = Array.isArray(decision.blocking_regions) ? decision.blocking_regions : [];
  const result = withRequestMetadata({
    title: "",
    final_title: "",
    rendered_title: "",
    model_title_suggestion: "",
    title_render_source: "pre_provider_rescan_gate",
    confidence: "LOW",
    reason: "Image quality gate requires a targeted rescan before recognition or provider inference.",
    fields: defaultFields,
    resolved: {},
    evidence: {},
    unresolved: [
      `targeted rescan required: ${blockingRegions.join(", ") || "identity critical region"} occluded`
    ],
    source: "image_quality_gate",
    provider: "image_quality_gate",
    route: "TARGETED_RESCAN_REQUIRED",
    route_reason: "Identity-critical image region is occluded before any paid provider call.",
    capture_quality: captureQuality,
    pre_provider_rescan_gate: decision,
    usage: {
      provider_calls: 0,
      retrieval_calls: 0,
      recognition_worker_calls: 0,
      latency_ms: 0,
      estimated_cost_usd: 0,
      resolution_rounds: 0
    },
    resolution_trace: [
      {
        phase: "pre_provider_rescan_gate",
        step: "evaluate_capture_quality",
        input: {
          route: captureQuality.route || captureQuality.glare_route || null,
          occluded_regions: decision.occluded_regions || []
        },
        output: {
          blocked: true,
          blocking_regions: blockingRegions
        },
        decision: "request_targeted_rescan_before_provider",
        created_at: new Date().toISOString()
      }
    ]
  }, payload);

  return applyIdentityResolutionGate(result, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId: "image_quality_gate"
  });
}

function storageRoleIsDerived(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  if (!normalized) return false;
  return !["front_original", "back_original", "front", "back", "primary"].includes(normalized);
}

function imageIsDerived(image = {}) {
  const role = image.storageRole || image.storage_role || "";
  return Boolean(image.derived || image.sourceRegion || image.source_region || storageRoleIsDerived(role));
}

function primaryImagesFromImages(images = []) {
  const primary = images.filter((image) => !imageIsDerived(image));
  return primary.length ? primary : images.slice(0, 2);
}

function providerImagesFromImages(images = [], {
  maxDerived = 6
} = {}) {
  const primaryImages = primaryImagesFromImages(images).slice(0, 2);
  const primarySet = new Set(primaryImages);
  const derivedImages = derivedImagesFromImages(images)
    .filter((image) => !primarySet.has(image))
    .slice(0, Math.max(0, Number(maxDerived) || 0));
  return [...primaryImages, ...derivedImages];
}

function explicitPrimaryImagesFromImages(images = []) {
  return images.filter((image) => !imageIsDerived(image));
}

function boundedPayloadImagesFromImages(images = [], {
  maxImages = defaultMaxPayloadImages
} = {}) {
  const payloadImages = Array.isArray(images) ? images : [];
  if (!payloadImages.length) {
    return {
      ok: false,
      reason: "empty"
    };
  }

  const primaryImages = explicitPrimaryImagesFromImages(payloadImages);
  if (!primaryImages.length) {
    return {
      ok: false,
      reason: "primary_images_missing"
    };
  }
  if (primaryImages.length > 2) {
    return {
      ok: false,
      reason: "too_many_primary_images",
      primary_image_count: primaryImages.length
    };
  }

  const primarySet = new Set(primaryImages);
  const derivedImages = derivedImagesFromImages(payloadImages)
    .filter((image) => !primarySet.has(image));
  const maxDerived = Math.max(0, Math.max(2, Number(maxImages) || defaultMaxPayloadImages) - primaryImages.length);
  const currentBatchImages = [
    ...primaryImages,
    ...derivedImages.slice(0, maxDerived)
  ];

  return {
    ok: true,
    images: currentBatchImages,
    primary_image_count: primaryImages.length,
    derived_image_count: derivedImages.length,
    deferred_image_count: Math.max(0, payloadImages.length - currentBatchImages.length)
  };
}

async function verifyApprovedMemoryImages({ payload = {} } = {}) {
  const primaryImages = explicitPrimaryImagesFromImages(payload.images || []);
  if (!primaryImages.length) return { ok: false, reason: "primary_images_missing" };

  for (const image of primaryImages) {
    const metadata = storageMetadataForImage(image);
    if (!metadata.objectPath) return { ok: false, reason: "verified_storage_path_required" };
    await assertVerifiedStorageImage(image);
  }

  return { ok: true };
}

async function createApprovedMemoryTitle(payload) {
  if (!listingApprovedMemoryEnabled() || !isSupabaseFeedbackConfigured()) return null;

  const startedAt = Date.now();
  let lookup;
  try {
    lookup = await lookupApprovedIdentityMemory({
      payload,
      enabled: true,
      loadApprovedRecords: ({ assetFingerprint, limit }) => listApprovedHistoryRecords({
        assetFingerprint,
        limit
      }),
      verifyImages: verifyApprovedMemoryImages
    });
  } catch {
    return null;
  }

  if (!lookup.hit) return null;

  const baseResult = approvedHistoryRecordToListingResult({
    record: lookup.record,
    payload,
    assetFingerprint: lookup.asset_fingerprint,
    imagePaths: lookup.image_paths,
    latencyMs: Date.now() - startedAt
  });

  return applyIdentityResolutionGate(baseResult, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId: approvedIdentityMemorySource
  });
}

async function createIdentityCacheTitle(payload) {
  if (!identityResultCacheReadEnabled() || !isSupabaseFeedbackConfigured()) return null;

  const startedAt = Date.now();
  const key = buildIdentityResultCacheKey(payload);
  if (!key.ok) return null;

  try {
    const verified = await verifyIdentityCacheImages(payload);
    if (!verified.ok) return null;

    const lookup = await readIdentityResultCacheRecord({
      cacheKey: key.cache_key
    });
    if (!lookup.hit) return null;

    return identityResultCacheRecordToListingResult({
      record: lookup.record,
      payload,
      latencyMs: Date.now() - startedAt
    });
  } catch {
    return null;
  }
}

async function withIdentityCacheWrite(result, payload) {
  if (!identityResultCacheWriteEnabled() || !isSupabaseFeedbackConfigured()) {
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: result.identity_cache?.cache_hit === true,
        write_attempted: false,
        write_saved: false,
        write_reason: "identity_cache_write_disabled"
      }
    };
  }

  const key = buildIdentityResultCacheKey(payload);
  if (!key.ok) {
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: result.identity_cache?.cache_hit === true,
        write_attempted: false,
        write_saved: false,
        write_reason: key.reason
      }
    };
  }

  try {
    const verified = await verifyIdentityCacheImages(payload);
    if (!verified.ok) {
      return {
        ...result,
        identity_cache: {
          ...(result.identity_cache || {}),
          cache_hit: result.identity_cache?.cache_hit === true,
          cache_key: key.cache_key,
          write_attempted: false,
          write_saved: false,
          write_reason: verified.reason
        }
      };
    }

    const saved = await saveIdentityResultCacheRecord({
      result,
      payload,
      cacheKey: key.cache_key,
      imageFingerprints: key.image_fingerprints
    });
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: result.identity_cache?.cache_hit === true,
        cache_key: key.cache_key,
        write_attempted: true,
        write_saved: saved.saved === true,
        write_reason: saved.reason || null
      }
    };
  } catch {
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: result.identity_cache?.cache_hit === true,
        cache_key: key.cache_key,
        write_attempted: true,
        write_saved: false,
        write_reason: "identity_cache_write_failed"
      }
    };
  }
}

async function createIdentityInFlightKey(payload) {
  if (!identityInFlightCoalescingEnabled()) return null;
  if (!isSupabaseFeedbackConfigured()) return null;

  const key = buildIdentityResultCacheKey(payload);
  if (!key.ok) return null;

  try {
    const verified = await verifyIdentityCacheImages(payload);
    return verified.ok ? key.cache_key : null;
  } catch {
    return null;
  }
}

function derivedImagesFromImages(images = []) {
  return images.filter(imageIsDerived);
}

function primaryPayloadForProvider(payload = {}) {
  return {
    ...payload,
    images: providerImagesFromImages(payload.images || [], {
      maxDerived: Number(process.env.PROVIDER_MAX_FIELD_CROPS || process.env.FIELD_MAX_CROPS_PER_ASSET || 6)
    })
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
      || image.verification_token
  };
}

async function assertVerifiedStorageImage(image = {}) {
  const metadata = storageMetadataForImage(image);
  if (!metadata.objectPath) return null;

  if (!(image.storageVerified === true || image.storage_verified === true)) {
    throw new Error("Listing image storage reference has not been verified.");
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
        height: metadata.height
      });
      return metadata;
    } catch (error) {
      if (!/expired/i.test(String(error.message || ""))) {
        throw error;
      }
    }
  }

  const durableRecord = await readListingImageVerificationRecord({
    objectPath: metadata.objectPath,
    bucket: metadata.bucket,
    contentType: metadata.contentType,
    size: metadata.size,
    width: metadata.width,
    height: metadata.height
  });
  if (!durableRecord.verified) {
    throw new Error("Listing image storage reference has no current server verification record.");
  }

  return metadata;
}

async function verifyIdentityCacheImages(payload = {}) {
  const primaryImages = explicitPrimaryImagesFromImages(payload.images || []);
  if (!primaryImages.length) return { ok: false, reason: "primary_images_missing" };

  for (const image of primaryImages) {
    const metadata = storageMetadataForImage(image);
    const contentSha256 = String(image.contentSha256 || image.content_sha256 || "").trim().toLowerCase();
    if (!metadata.objectPath || !contentSha256) return { ok: false, reason: "verified_content_hash_required" };
    if (!(image.storageVerified === true || image.storage_verified === true)) {
      return { ok: false, reason: "verified_storage_required" };
    }

    const durableRecord = await readListingImageVerificationRecord({
      objectPath: metadata.objectPath,
      bucket: metadata.bucket,
      contentType: metadata.contentType,
      size: metadata.size,
      width: metadata.width,
      height: metadata.height
    });
    if (!durableRecord.verified) return { ok: false, reason: durableRecord.reason || "verification_record_missing" };
    const storedHash = String(durableRecord.record?.content_sha256 || "").trim().toLowerCase();
    if (!storedHash || storedHash !== contentSha256 || durableRecord.record?.content_hash_verified !== true) {
      return { ok: false, reason: "content_hash_verification_mismatch" };
    }
  }

  return { ok: true };
}

function fastInitialRecognitionPrompt(payload, maxTitleLength) {
  const vectorPacket = payload.vectorCandidatePacket || payload.vector_candidate_packet || null;
  return [
    "You are the first-pass card evidence reader for LYNCA Listing Copilot.",
    "Use only the supplied card/slab images. Do not use marketplace wording, memory, or outside knowledge.",
    "Return compact valid JSON only. Do not write Markdown.",
    "Goal: extract grounded identity evidence; deterministic code will render the English title.",
    "Fill every directly visible core field. Missing serial, grade, or exact parallel must not erase visible year, product, set, or players.",
    "Leave only unreadable or uncertain high-risk fields empty.",
    "Use these downstream title modules: Standard Card Grammar = Year -> normalized Manufacturer/Product/Set -> Subject -> Card Name -> Release Variant -> Print Finish -> Numerical Rarity -> Descriptive Rarity -> Card Number -> Search Optimization -> Grading Info. TCG keeps its separate grammar. Deterministic code renders and compresses the final English title.",
    "Sports card_name rule: if the front/back prints a named card title or segment such as Best Performance, Club Legends, Gusto, Power Partnership, Canvas Creations, Rookie Ticket, or Next Stop Signatures, put the literal card name in fields.card_name when it is the card's named segment; use insert only for formal insert/set identity when that is the better structured field. Renderer places card_name after Subject.",
    "Do not cross module boundaries: serial numbers are not grades, grade-label words are not checklist codes, product names are not player names, and visual color alone is surface_color rather than exact parallel.",
    "If a card has front and back images, combine them into one identity when they are the same card.",
    "Slab label rule: if a PSA/BGS/SGC/CGC label is visible, read it first and map label lines directly into year, product, players, collector_number/checklist_code, grade_company, card_grade, grade_type, insert, variation, and auto.",
    "Never return only a year when the slab label also contains readable product, player, grade, or card number.",
    "Example slab mapping: 2018 TOPPS CHROME / SHOHEI OHTANI / 1983 TOPPS / #83T-6 / GEM MT 10 => year 2018, product Topps Chrome, players [Shohei Ohtani], insert 1983 Topps, collector_number 83T-6, grade_company PSA, card_grade 10.",
    "Example slab mapping: 2020 CONTENDERS / ANTHONY EDWARDS / VARIATION-AUTOGRAPH / #105 / GEM MT 10 => year 2020, product Contenders, players [Anthony Edwards], variation Variation Autograph, auto true, collector_number 105, grade_company PSA, card_grade 10.",
    "Structured high-risk field evidence contract:",
    "- field_evidence is provider-agnostic and must be used by GPT outputs.",
    "- Keep field_evidence compact. Only include short evidence for non-empty high-risk fields or fields that may need writer review.",
    "- Do not dump OCR lines, legal text, copyright text, or repeated boilerplate into field_evidence.",
    "- Each evidence entry should include value, support_type/source_type, short visible_text/raw_text when useful, confidence, review_required, and direct_observation/directly_observed.",
    "- Core/high-risk evidence fields include year, product, set, language, players, character, card_name, official_card_type, observable_components, insert, surface_color, parallel_exact, serial_number, collector_number, checklist_code, grade, rc, auto, patch, relic, jersey, sketch, and redemption.",
    "- official_card_type must stay empty unless official wording is printed on the card/slab or supplied by trusted catalog/reviewed input. Never infer Base from visual context.",
    "- observable_components may include only directly visible components: auto, patch, relic, jersey, rc, sketch, redemption.",
    "- year: include field_evidence.year with value, support_type, visible_text, confidence, and review_required. Use support_type SLAB_LABEL, CARD_BACK_PRINTED_TEXT, CARD_FRONT_PRINTED_TEXT, VISION_ONLY, or NONE.",
    "- grade: include field_evidence.grade only when a slab label directly shows grade. Fill grade_company, card_grade, auto_grade, grade_type, support_type SLAB_LABEL, visible_text, confidence, review_required false. If grade is only guessed, leave grade fields empty.",
    "- rc: fields.rc may be true only with a visible RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, or slab/card text. Also include field_evidence.rc with value true, support_type, evidence_kind, visible_text, visible_marker, confidence.",
    "- auto: fields.auto may be true only with visible Auto/Autograph/Signature/Signed text or an actual visible signature. Also include field_evidence.auto with value true, support_type, evidence_kind, visible_text, signature_visible or text_visible, confidence.",
    "- If year is visible but only from visual model reading, still return fields.year and field_evidence.year.support_type VISION_ONLY; Gate will leave it for writer review.",
    "If readable slab/card text exists but you leave year, product, or players empty, add a short unresolved note naming the missing field and image region. Do not transcribe long text, legal lines, copyright lines, or repeated boilerplate.",
    "Serial rule: every digit must be readable; otherwise serial_number must be empty. Deterministic title rendering will remove the instance numerator and publish only the serial limit such as /50; do not move serial_number into collector_number or checklist_code.",
    "Parallel/color rule: first-version output is color-first. Put visible Gold/Purple/Red/Blue/Green/Silver/Black/Orange only in surface_color. Leave parallel_exact empty unless exact wording is printed/slab/catalog-supported; do not infer Refractor/Wave/Shimmer/Mojo/Prizm/Sparkle/Holo from appearance alone.",
    "Sapphire discipline: Topps Chrome Sapphire or Bowman Chrome Sapphire is a product/set phrase when visibly attached to the Chrome product line; keep the full phrase in product or set. Non-product Sapphire such as Heir Apparent Sapphire is exact parallel/taxonomy wording and must stay out of final fields unless catalog/printed label evidence directly supports it.",
    "Open-set taxonomy rule: without prompt-safe catalog/vector candidates, do not put Tiger, Zebra, Sapphire, Refractor, Wave, Shimmer, Mojo, Prizm, Sparkle, Holo, or similar optical pattern words in insert/card_type/parallel fields; leave them unresolved for writer/catalog confirmation.",
    "Multi-card rule: multi_card/card_count refer to separate physical cards in the photo, not the number of players or names printed on one card. A single card with two or more subjects must keep multi_card false and put every subject in players[]. Only set multi_card true when multiple separate card rectangles, slabs, or lot items are visible; then do not merge identities.",
    "recognition_status rule: use CONFIRMED when core identity is visible with no critical conflict; RESOLVED when core identity is visible but some non-core field needs review; ABSTAIN only when product/subject is unreadable, multiple cards are mixed, image quality blocks core identity, or critical fields conflict.",
    `Runtime title limit downstream: ${maxTitleLength} characters.`,
    "Return this shape:",
    JSON.stringify(providerMinimalOutputShape({ includeVectorDecision: Boolean(vectorPacket) })),
    vectorCandidatePromptSection(vectorPacket),
    "Asset context:",
    JSON.stringify({
      assetId: payload.assetId || null,
      mode: payload.mode || null,
      imageCount: payload.images.length,
      fileNames: payload.images.map((image) => image.name).filter(Boolean).slice(0, 2)
    })
  ].join("\n");
}

function providerMinimalOutputShape({
  includeVectorDecision = false
} = {}) {
  const shape = {
    recognition_status: "CONFIRMED | RESOLVED | ABSTAIN",
    fields: {
      year: "",
      manufacturer: "",
      brand: "",
      product: "",
      set: "",
      language: "",
      players: [],
      card_name: "",
      card_type: "",
      official_card_type: "",
      observable_components: [],
      insert: "",
      surface_color: "",
      parallel_exact: "",
      serial_number: "",
      collector_number: "",
      checklist_code: "",
      grade_company: "",
      card_grade: "",
      auto_grade: "",
      grade_type: "",
      rc: false,
      auto: false,
      multi_card: false,
      card_count: null,
      lot_type: ""
    },
    field_evidence: {
      year: {
        value: "",
        support_type: "SLAB_LABEL | CARD_BACK_PRINTED_TEXT | CARD_FRONT_PRINTED_TEXT | VISION_ONLY | NONE",
        visible_text: "",
        review_required: true
      },
      serial_number: {
        value: "",
        source_region: "serial_number",
        visible_text: "",
        review_required: true
      },
      grade: {
        grade_company: "",
        card_grade: "",
        auto_grade: "",
        grade_type: "",
        support_type: "SLAB_LABEL | NONE",
        source_region: "grade_label",
        visible_text: "",
        review_required: false
      },
      rc: {
        value: false,
        support_type: "SLAB_LABEL | CARD_FRONT_PRINTED_TEXT | CARD_BACK_PRINTED_TEXT | VISION_ONLY | NONE",
        visible_text: "",
        review_required: true
      },
      auto: {
        value: false,
        support_type: "SLAB_LABEL | CARD_FRONT_PRINTED_TEXT | CARD_BACK_PRINTED_TEXT | VISIBLE_SIGNATURE | VISION_ONLY | NONE",
        visible_text: "",
        review_required: true
      }
    },
    unresolved: []
  };
  if (includeVectorDecision) {
    shape.vector_candidate_decision = {
      selected_candidate_id: null,
      decision: "SELECTED | PARTIAL_SUPPORT | REJECTED_ALL | NOT_AVAILABLE",
      supported_fields: [],
      rejected_fields: [],
      conflicts: []
    };
  }
  return shape;
}

function vectorCandidatePromptSection(packet = null) {
  if (!packet?.vector_retrieval) return "";
  const compactPacket = JSON.stringify(packet);
  return [
    "Vector Candidate Packet:",
    compactPacket,
    "Vector candidate policy:",
    "- Treat vector candidates as hypotheses only, never as ground truth.",
    "- First read the current uploaded front/back images and crops.",
    "- You may select one candidate, partially use field support, reject all candidates, or return NOT_AVAILABLE.",
    "- Reject any candidate field that conflicts with current card/slab printed text, current serial, current collector/checklist code, current grade label, or current subject count.",
    "- Serial numerator and grade must come only from the current card/slab image, never from a reference candidate.",
    "- Exact parallel requires current image evidence, printed/slab text, product taxonomy, or clear denominator compatibility; visual color alone is surface_color.",
    "- Do not auto-fill unseen fields from a candidate. Leave uncertain fields empty and put the field name in unresolved.",
    "- Populate vector_candidate_decision with supported_fields, rejected_fields, and conflicts. Use NOT_AVAILABLE when the packet has no candidates."
  ].join("\n");
}

async function buildListingPrompt(payload, maxTitleLength) {
  const intelligencePrompt = await loadPrompt();
  const vectorPacket = payload.vectorCandidatePacket || payload.vector_candidate_packet || null;

  return [
    intelligencePrompt,
    `Runtime title limit: ${maxTitleLength} characters.`,
    "Return only valid JSON. Do not wrap the response in Markdown.",
    "Multi-card rule: fields.card_count is the count of separate physical cards, not the count of players. A single multi-subject card must have fields.multi_card false and all visible subjects in fields.players. Only set fields.multi_card true when multiple separate card rectangles, slabs, or lot items are visible; then include fields.card_count when visible, describe fields.lot_type, and do not merge identities across cards.",
    "Do not infer RC, 1st Bowman, SSP, case hit, parallel, or variation from seller style or generic foil color. Use RC only for readable RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, slab text, or card-code-backed rookie marker. For parallel/variation, use printed text, slab/checklist support, or clearly intentional high-confidence card-design color/pattern only; weak visual color impressions must stay empty with uncertainty in unresolved.",
    "Return compact provider-agnostic field_evidence only for high-risk or review-sensitive fields. Do not use provider confidence prose as fact evidence.",
    "Resolution hints:",
    resolutionHints(payload.resolutionMap) || "None",
    registryPromptSummary(),
    "Asset context:",
    JSON.stringify({
      assetId: payload.assetId || null,
      mode: payload.mode || null,
      imageCount: payload.images.length,
      fileNames: payload.images.map((image) => image.name)
    }),
    "Capture quality:",
    JSON.stringify(captureQualityForPayload(payload)),
    "Required JSON shape:",
    JSON.stringify(providerMinimalOutputShape({ includeVectorDecision: Boolean(vectorPacket) })),
    vectorCandidatePromptSection(vectorPacket),
  ].join("\n");
}

async function buildInitialProviderPrompt(payload, maxTitleLength) {
  if (envFlag(process.env, "ENABLE_FAST_INITIAL_PROVIDER_PROMPT", true)) {
    return fastInitialRecognitionPrompt(payload, maxTitleLength);
  }

  return buildListingPrompt(payload, maxTitleLength);
}

function normalizeAiResult(result, maxTitleLength, source = "openai") {
  const confidenceMap = {
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    UNSURE: "MEDIUM",
    LOW: "LOW",
    FAILED: "FAILED"
  };
  const confidence = confidenceMap[String(result.confidence || "").toUpperCase()] || "MEDIUM";
  const fields = normalizeFields(result.fields);
  const unresolved = normalizeUnresolved(result.unresolved, result.fields);
  const sanitized = sanitizeResultText(result, fields, confidence, unresolved, maxTitleLength);
  const title = repairOrphanAutoGradeSuffix(moveLeadingGradeToEnd(sanitized.title, maxTitleLength), fields, maxTitleLength);
  const preTitleAudit = {
    confidence: sanitized.confidence,
    reason: sanitized.reason.slice(0, 520),
    unresolved: sanitized.hadBackgroundContamination
      ? [...sanitized.unresolved, "background branding ignored"]
      : sanitized.unresolved
  };
  const calibrated = calibrateConfidence({
    title,
    confidence: preTitleAudit.confidence,
    reason: preTitleAudit.reason,
    fields,
    unresolved: preTitleAudit.unresolved
  });
  const presentationFields = suppressReviewOnlyParallelFields(fields, calibrated.reason, calibrated.unresolved);

  return {
    title,
    model_title_suggestion: title,
    confidence: calibrated.confidence,
    reason: calibrated.reason,
    fields: presentationFields,
    unresolved: calibrated.unresolved,
    vector_candidate_decision: result.vector_candidate_decision || null,
    source,
    _normalized_evidence_fields: fields,
    _pre_title_audit: preTitleAudit
  };
}

function withEvidenceCompatibility(result, providerPayload, payload) {
  const {
    _pre_title_audit: preTitleAudit,
    _normalized_evidence_fields: normalizedEvidenceFields,
    ...publicResult
  } = result;
  const evidenceFields = {
    ...(normalizedEvidenceFields || providerPayload.fields || publicResult.fields || {})
  };
  if (normalizedEvidenceFields && publicResult.fields) {
    [
      "surface_color",
      "parallel_family",
      "parallel_exact",
      "parallel",
      "variation"
    ].forEach((field) => {
      if (publicResult.fields[field] === null && evidenceFields[field] !== null && evidenceFields[field] !== undefined) {
        evidenceFields[field] = null;
      }
    });
  }
  const payloadForEvidence = {
    ...providerPayload,
    title: providerPayload.title || result.model_title_suggestion || result.title,
    confidence: preTitleAudit?.confidence || providerPayload.confidence || publicResult.confidence,
    fields: evidenceFields,
    unresolved: Array.isArray(providerPayload.unresolved) ? providerPayload.unresolved : publicResult.unresolved
  };
  const evidenceDocument = providerPayloadToEvidenceDocument(payloadForEvidence, {
    images: payload.images || []
  });
  const normalizedLegacyFields = resolvedFieldsToLegacyFields(evidenceDocument.resolved);
  const fields = {
    ...publicResult.fields,
    ...Object.fromEntries(Object.entries(normalizedLegacyFields).filter(([, value]) => value !== null && value !== undefined))
  };
  const presentation = renderListingPresentation({
    resolved: evidenceDocument.resolved,
    evidence: evidenceDocument.evidence,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength
  });
  const renderedTitle = presentation.rendered_title || "";
  const finalTitle = renderedTitle || publicResult.title || "";
  const titleMissingRiskFields = new Set([
    "serial",
    "serial_number",
    "card_number",
    "collector_number",
    "checklist_code",
    "grade",
    "grade_company",
    "card_grade",
    "auto_grade",
    "player",
    "players",
    "character",
    "auto",
    "rc",
    "one_of_one"
  ]);
  const initialTitleMissingFields = Array.isArray(publicResult.unresolved)
    ? publicResult.unresolved
      .map((item) => String(item || "").match(/^title missing\s+(.+)$/i)?.[1])
      .filter(Boolean)
    : [];
  const initialTitleMissingRisk = publicResult.confidence === "LOW"
    && initialTitleMissingFields.some((field) => titleMissingRiskFields.has(field));
  const rendererCanSafelyRecalibrate = publicResult.confidence === "LOW"
    && initialTitleMissingFields.length > 0
    && !initialTitleMissingRisk;
  const calibrationBase = {
    confidence: initialTitleMissingRisk
      ? "MEDIUM"
      : rendererCanSafelyRecalibrate
        ? preTitleAudit?.confidence || publicResult.confidence
        : publicResult.confidence,
    reason: publicResult.reason,
    unresolved: publicResult.unresolved || []
  };
  const finalCalibration = renderedTitle
    ? calibrateConfidence({
      title: finalTitle,
      confidence: calibrationBase.confidence,
      reason: calibrationBase.reason,
      fields,
      unresolved: calibrationBase.unresolved.filter((item) => !/^title missing /i.test(String(item || "")))
    })
    : {
      confidence: publicResult.confidence,
      reason: publicResult.reason,
      unresolved: publicResult.unresolved || []
    };

  return {
    ...publicResult,
    title: finalTitle,
    final_title: finalTitle,
    rendered_title: renderedTitle,
    title_override: null,
    title_render_source: renderedTitle ? "deterministic_renderer" : "legacy_fallback",
    fields,
    confidence: finalCalibration.confidence,
    reason: finalCalibration.reason,
    unresolved: finalCalibration.unresolved,
    evidence: evidenceDocument.evidence,
    raw_provider_fields: providerPayload.fields || publicResult.fields || null,
    normalized_evidence: evidenceDocument.evidence,
    resolved: evidenceDocument.resolved,
    resolved_fields: evidenceDocument.resolved,
    rendered_fields: {
      ...fields,
      title: finalTitle,
      rendered_title: renderedTitle,
      modules: presentation.modules,
      module_order: presentation.module_order,
      title_render_source: renderedTitle ? "deterministic_renderer" : "legacy_fallback",
      fields
    },
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy,
    resolution_trace: evidenceDocument.resolution_trace || [],
    model_title_suggestion: evidenceDocument.model_title_suggestion,
    evidence_fields: evidenceFields,
    raw_observed_fields: normalizedEvidenceFields || providerPayload.fields || null,
    evidence_schema_version: evidenceDocument.schema_version
  };
}

function hasEvidenceValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function evidenceFieldCandidatesWithSources(field = {}) {
  const baseSources = Array.isArray(field.sources) ? field.sources : [];
  const candidates = Array.isArray(field.candidates) && field.candidates.length
    ? field.candidates
    : hasEvidenceValue(field.value)
      ? [{ value: field.value, confidence: field.confidence }]
      : [];

  return candidates
    .filter((candidate) => hasEvidenceValue(candidate?.value))
    .map((candidate) => ({
      value: candidate.value,
      confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : Number(field.confidence || 0),
      sources: Array.isArray(candidate.sources) && candidate.sources.length ? candidate.sources : baseSources
    }));
}

function evidenceCandidateKey(value) {
  const text = Array.isArray(value) ? value.join(" / ") : value;
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function mergeEvidenceField(fieldName, fields = []) {
  const candidateMap = new Map();
  const conflicts = [];

  fields.forEach((field) => {
    conflicts.push(...(Array.isArray(field?.conflicts) ? field.conflicts : []));
    evidenceFieldCandidatesWithSources(field).forEach((candidate) => {
      const key = evidenceCandidateKey(candidate.value);
      const existing = candidateMap.get(key);
      if (!existing) {
        candidateMap.set(key, {
          value: candidate.value,
          confidence: candidate.confidence,
          sources: [...candidate.sources]
        });
        return;
      }

      existing.confidence = Math.max(existing.confidence, candidate.confidence);
      existing.sources.push(...candidate.sources);
    });
  });

  const candidates = [...candidateMap.values()]
    .map((candidate) => ({
      ...candidate,
      sources: candidate.sources.filter(Boolean)
    }))
    .sort((left, right) => right.confidence - left.confidence);
  const top = candidates[0] || null;
  const distinctValueCount = new Set(candidates.map((candidate) => evidenceCandidateKey(candidate.value))).size;
  const mergedConflicts = [
    ...conflicts,
    ...(distinctValueCount > 1 ? [{
      field: fieldName,
      conflict_type: "MULTI_SOURCE_VALUE_CONFLICT",
      conflicting_values: candidates.map((candidate) => candidate.value),
      severity: "MEDIUM",
      reason: "Recognition and provider evidence produced competing values for this field."
    }] : [])
  ];

  return createEvidenceField({
    value: top?.value ?? null,
    normalizedValue: top?.value ?? null,
    status: mergedConflicts.length ? "CONFLICT" : top?.confidence >= 0.86 ? "CONFIRMED" : "REVIEW",
    confidence: top?.confidence ?? 0,
    candidates,
    sources: candidates.flatMap((candidate) => candidate.sources || []),
    conflicts: mergedConflicts
  });
}

function mergeEvidenceMaps(...maps) {
  const fieldNames = new Set();
  maps.forEach((map) => {
    Object.keys(map || {}).forEach((field) => fieldNames.add(field));
  });

  const evidence = {};
  fieldNames.forEach((field) => {
    const fields = maps.map((map) => map?.[field]).filter(Boolean);
    evidence[field] = fields.length === 1 ? fields[0] : mergeEvidenceField(field, fields);
  });
  return evidence;
}

function mergeResolvedFields(...resolvedDocuments) {
  const merged = {};
  resolvedDocuments.forEach((resolved) => {
    Object.entries(resolved || {}).forEach(([field, value]) => {
      if (!hasEvidenceValue(value)) return;
      merged[field] = value;
    });
  });
  return merged;
}

function withRecognitionEvidence(result, recognitionEvidenceDocument = null, payload = {}) {
  if (!hasRecognitionEvidence(recognitionEvidenceDocument)) return result;

  const evidence = mergeEvidenceMaps(recognitionEvidenceDocument.evidence, result.evidence);
  const resolved = mergeResolvedFields(recognitionEvidenceDocument.resolved, result.resolved);
  const presentation = renderListingPresentation({
    resolved,
    evidence,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength
  });

  return {
    ...result,
    evidence,
    resolved,
    rendered_title: presentation.rendered_title || result.rendered_title || "",
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy,
    recognition_preflight: recognitionEvidenceDocument.recognition || null,
    unresolved: [
      ...(Array.isArray(result.unresolved) ? result.unresolved : []),
      ...(Array.isArray(recognitionEvidenceDocument.unresolved) ? recognitionEvidenceDocument.unresolved : [])
    ].slice(0, 16),
    resolution_trace: [
      ...(Array.isArray(recognitionEvidenceDocument.resolution_trace) ? recognitionEvidenceDocument.resolution_trace : []),
      ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : [])
    ]
  };
}

function withProviderMetadata(result, providerResult, selection) {
  const providerId = providerResult.provider || selection?.provider_id || result.source;

  return {
    ...result,
    ...providerMetadata({
      provider: providerId,
      modelId: providerResult.model_id || selection?.model_id
    }),
    source: providerId,
    provider_response_id: providerResult.response_id || null,
    provider_finish_reason: providerResult.finish_reason || null,
    provider_parse_source: providerResult.parse_source || null,
    provider_latency_ms: providerResult.latency_ms ?? null,
    provider_recognition_status: providerResult.recognition_status || providerResult.parsed?.recognition_status || null,
    provider_error_type: providerResult.error_type || providerResult.parsed?.error_type || null,
    provider_token_diagnostics: providerResult.token_diagnostics || null,
    provider_initial_token_diagnostics: providerResult.initial_token_diagnostics || null,
    provider_truncation_retry_attempted: providerResult.truncation_retry_attempted === true,
    provider_truncation_retry_attempts: Number(providerResult.truncation_retry_attempts || 0),
    format_error_type: providerResult.format_error_type || null,
    format_repair_attempted: providerResult.format_repair_attempted === true,
    local_json_repair_success: providerResult.local_json_repair_success === true,
    text_repair_success: providerResult.text_repair_success === true,
    native_schema_valid: providerResult.native_schema_valid === true,
    fallback_provider_id: providerResult.fallback_provider_id || null,
    fallback_reason: providerResult.fallback_reason || null,
    usage: providerResult.usage || null,
    explicit_emergency: Boolean(selection?.explicit_emergency)
  };
}

function safeProviderDiagnostics(details = {}) {
  if (!details || typeof details !== "object") return undefined;
  const allowedKeys = [
    "format_error_type",
    "format_repair_attempted",
    "local_json_repair_success",
    "text_repair_success",
    "native_schema_valid",
    "token_diagnostics",
    "initial_token_diagnostics",
    "truncation_retry_attempted",
    "truncation_retry_attempts",
    "empty_retry_attempted",
    "empty_retry_attempts",
    "request_summary",
    "schema_errors",
    "local_repair_error",
    "text_repair_error"
  ];
  const output = {};
  allowedKeys.forEach((key) => {
    if (details[key] !== undefined) output[key] = details[key];
  });
  return Object.keys(output).length ? output : undefined;
}

function withRequestMetadata(result, payload) {
  return {
    ...result,
    asset_id: payload.assetId || payload.asset_id || `asset_${crypto.randomUUID()}`,
    analysis_run_id: payload.analysisRunId || payload.analysis_run_id || `analysis_${crypto.randomUUID()}`,
    capture_profile_id: payload.captureProfileId || payload.capture_profile_id || defaultCaptureProfileId,
    capture_quality: captureQualityForPayload(payload)
  };
}

function mergeUsage(providerUsage, completionUsage, {
  providerCalls = 0
} = {}) {
  const base = providerUsage && typeof providerUsage === "object" && !Array.isArray(providerUsage)
    ? providerUsage
    : {};
  const baseProviderCalls = Number.isFinite(Number(base.provider_calls))
    ? Number(base.provider_calls)
    : providerCalls;

  return {
    ...base,
    provider_calls: baseProviderCalls + Number(completionUsage?.provider_calls || 0),
    retrieval_calls: Number(base.retrieval_calls || 0) + Number(completionUsage?.retrieval_calls || 0),
    latency_ms: Number(base.latency_ms || 0) + Number(completionUsage?.latency_ms || 0),
    estimated_cost_usd: Number(base.estimated_cost_usd || 0) + Number(completionUsage?.estimated_cost_usd || 0),
    resolution_rounds: Number(base.resolution_rounds || 0) + Number(completionUsage?.resolution_rounds || 0)
  };
}

async function runTimedProviderCall(providerId, timingContext, work) {
  const queued = await runWithProviderConcurrency({
    providerId,
    work: () => timeAsync(timingContext, "provider_total_ms", work)
  });
  addTiming(timingContext, "server_queue_ms", queued.queue_ms);
  return queued.result;
}

function withCompletedEvidencePresentation(result, completion, payload) {
  const resolved = completion.resolved || result.resolved;
  const evidence = completion.evidence || result.evidence;
  if (!resolved || !evidence) return result;

  const presentation = renderListingPresentation({
    resolved,
    evidence,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength
  });
  const normalizedLegacyFields = resolvedFieldsToLegacyFields(resolved);
  const fields = {
    ...result.fields,
    ...Object.fromEntries(Object.entries(normalizedLegacyFields).filter(([, value]) => value !== null && value !== undefined))
  };
  const renderedTitle = presentation.rendered_title || "";
  const finalTitle = result.title_override || renderedTitle || result.final_title || result.title || "";

  return {
    ...result,
    title: finalTitle,
    final_title: finalTitle,
    rendered_title: renderedTitle,
    title_render_source: renderedTitle ? "deterministic_renderer" : result.title_render_source,
    fields,
    evidence,
    normalized_evidence: evidence,
    resolved,
    resolved_fields: resolved,
    rendered_fields: {
      ...fields,
      title: finalTitle,
      rendered_title: renderedTitle,
      modules: presentation.modules,
      module_order: presentation.module_order,
      title_render_source: renderedTitle ? "deterministic_renderer" : result.title_render_source,
      fields
    },
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy
  };
}

function candidateConflictFields(candidate = {}) {
  return [
    ...(Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : []),
    ...(Array.isArray(candidate.direct_evidence_conflicts) ? candidate.direct_evidence_conflicts : []),
    ...(Array.isArray(candidate.conflicts) ? candidate.conflicts : [])
  ].map((conflict) => typeof conflict === "string" ? conflict : conflict?.field || conflict?.field_name || "").filter(Boolean);
}

function retrievalCandidateApprovedForIdentity(candidate = {}, providerOptions = {}) {
  if (!candidate || candidateConflictFields(candidate).length) return false;
  const status = String(
    candidate.reference_metadata?.retrieval_status
    || candidate.retrieval_status
    || candidate.reference_status
    || ""
  ).trim().toLowerCase();
  if (/^(approved|reviewed|verified)$/.test(status)) return true;
  const evalCorrectedTitleGt = optionFlag(providerOptions, "corrected_title_as_temporary_gt", false) === true;
  const sourceStatus = String(candidate.reference_metadata?.source_status || "").toUpperCase();
  return evalCorrectedTitleGt
    && (
      candidate.field_derivation?.corrected_title_used === true
      || candidate.field_derivation?.corrected_title_as_temporary_gt === true
      || candidate.reference_metadata?.corrected_title_as_temporary_gt === true
      || sourceStatus === "AUTO_PARSED_FROM_VERIFIED_TITLE"
    );
}

function retrievalCandidatesForIdentity(completion = {}, providerOptions = {}) {
  const retrieval = completion.retrieval || {};
  const sources = Array.isArray(retrieval.sources) ? retrieval.sources : [];
  const selectedId = retrieval.selected_candidate?.candidate_id || "";
  const selected = retrieval.selected_candidate && retrievalCandidateApprovedForIdentity(retrieval.selected_candidate, providerOptions)
    ? [{ ...retrieval.selected_candidate, selected: true, identity_evidence_eligible: true }]
    : [];
  const topCandidates = sources
    .filter((candidate) => candidate && candidate.candidate_id !== selectedId)
    .filter((candidate) => retrievalCandidateApprovedForIdentity(candidate, providerOptions))
    .filter((candidate) => {
      const sourceType = String(candidate.source_type || "").toUpperCase();
      const score = Number(candidate.match_score || 0);
      if (sourceType === "VISUAL_VECTOR") return score >= 0.38 || Number(candidate.visual_similarity || 0) >= 0.72;
      return score >= 0.28 || Number(candidate.trust_tier || 9) <= 5;
    })
    .slice(0, 8)
    .map((candidate) => ({
      ...candidate,
      selected: candidate.selected === true,
      identity_evidence_eligible: candidate.identity_evidence_eligible === true
    }));
  const seen = new Set();
  return [...selected, ...topCandidates].filter((candidate) => {
    const key = candidate.candidate_id || candidate.source_url || JSON.stringify(candidate.fields || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function conflictSeverity(conflict = {}) {
  return String(conflict.severity || "").trim().toUpperCase();
}

function hasBlockingIdentityConflict(result = {}) {
  const conflicts = [
    ...(Array.isArray(result.conflict_map) ? result.conflict_map : []),
    ...(Array.isArray(result.identity_resolution?.conflict_map) ? result.identity_resolution.conflict_map : [])
  ];
  return conflicts.some((conflict) => {
    if (conflict.resolved === true) return false;
    return ["MEDIUM", "HIGH", "CRITICAL"].includes(conflictSeverity(conflict));
  });
}

function fastPathEligible(result = {}) {
  const fastVisionResolved = result.fast_vision_policy?.role === "PRIMARY_FAST_VISION"
    && result.fast_vision_policy?.allow_single_source_publish === true
    && result.identity_resolution_status === identityStatuses.RESOLVED;
  return (result.identity_resolution_status === identityStatuses.CONFIRMED || fastVisionResolved)
    && Boolean(result.final_title || result.title)
    && !hasBlockingIdentityConflict(result);
}

function providerSignalFastPathEligible(result = {}) {
  const confidence = String(result.confidence || "").trim().toUpperCase();
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
  const reasonText = searchable(result.reason || result.route_reason || "");
  if (confidence !== "HIGH") return false;
  if (hasUncertainty(reasonText, unresolved)) return false;
  return true;
}

function tryProviderFastPath(result, payload, providerId) {
  if (!envFlag(process.env, "ENABLE_LISTING_FAST_PATH", true)) return null;
  const providerOptions = providerOptionsFromPayload(payload);
  if (evidenceCompletionEnabled(process.env, providerOptions)
    && (optionFlag(providerOptions, "enable_catalog_assist", false) === true
      || optionFlag(providerOptions, "enable_vector_assist", false) === true)) {
    return null;
  }
  if (!providerSignalFastPathEligible(result)) return null;

  const gated = applyIdentityResolutionGate(result, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId
  });
  if (!fastPathEligible(gated)) return null;

  return {
    ...gated,
    route: "FAST_PATH_PROVIDER_CONFIRMED",
    route_reason: "Initial provider evidence resolved the required card identity fields without blocking conflicts.",
    retrieval: result.retrieval || {
      skipped: true,
      reason: "fast_path_provider_confirmed"
    },
    completion_trace: Array.isArray(result.completion_trace)
      ? result.completion_trace
      : Array.isArray(result.resolution_trace)
        ? result.resolution_trace
        : [],
    fast_path: {
      enabled: true,
      used: true,
      skipped_evidence_completion: true,
      skipped_focused_reread: true,
      skipped_retrieval: true
    },
    usage: mergeUsage(result.usage, null, {
      providerCalls: result.provider ? 1 : 0
    })
  };
}

function singleModelDraftPath(result, payload, providerId, {
  reason = "single_model_fast_path",
  allowWhenEvidenceCompletion = false,
  assistShadowOnly = false
} = {}) {
  const providerOptions = providerOptionsFromPayload(payload);
  if (evidenceCompletionEnabled(process.env, providerOptions) && !allowWhenEvidenceCompletion) return null;

  const gated = applyIdentityResolutionGate(result, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId
  });

  return {
    ...gated,
    route: gated.route || result.route || "SINGLE_MODEL_WRITER_DRAFT",
    route_reason: gated.route_reason || "Single-model fast path produced a writer-review draft without retrieval or focused rereads.",
    retrieval: result.retrieval || {
      skipped: true,
      reason
    },
    completion_trace: Array.isArray(result.completion_trace)
      ? result.completion_trace
      : Array.isArray(result.resolution_trace)
        ? result.resolution_trace
        : [],
    fast_path: {
      ...(result.fast_path || {}),
      enabled: true,
      used: result.fast_path?.used === true,
      single_model_fast: true,
      assist_shadow_only: assistShadowOnly,
      skipped_evidence_completion: true,
      skipped_focused_reread: true,
      skipped_retrieval: true,
      reason
    },
    usage: mergeUsage(result.usage, null, {
      providerCalls: result.provider ? 1 : 0
    })
  };
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function withPrimaryFastVisionPolicy(result = {}, {
  primaryProviderId
} = {}) {
  return {
    ...result,
    identity_provider_id: "primary_fast_vision",
    fast_vision_policy: {
      role: "PRIMARY_FAST_VISION",
      primary_provider_id: primaryProviderId || result.provider || result.source || null,
      allow_single_source_publish: true
    },
    unresolved: uniqueValues([
      ...(Array.isArray(result.unresolved) ? result.unresolved : [])
    ])
  };
}

function mergeVisualFeaturePayloads(...payloads) {
  const features = payloads.flatMap((payload) => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.features)) return payload.features;
    return [];
  }).filter((feature) => Array.isArray(feature?.embedding) && feature.embedding.length > 0);
  if (!features.length) return {};
  return {
    status: "OK",
    features
  };
}

function withVisualFeatures(result = {}, visualFeatures = {}) {
  const merged = mergeVisualFeaturePayloads(result.visual_features, result.recognition_preflight?.visual_features, visualFeatures);
  if (!hasUsableVisualFeatures(merged)) return result;
  return {
    ...result,
    visual_features: merged,
    visual_feature_summary: {
      source: visualFeatures?.source || result.visual_feature_summary?.source || "provider_or_recognition",
      feature_count: merged.features.length,
      embedding_roles: [...new Set(merged.features.map((feature) => feature.embedding_role).filter(Boolean))]
    }
  };
}

function visualFeaturesForRetrieval(result = {}, fallbackVisualFeatures = {}) {
  if (hasUsableVisualFeatures(fallbackVisualFeatures)) return fallbackVisualFeatures;
  if (result.visual_features && typeof result.visual_features === "object") return result.visual_features;
  if (result.recognition_preflight?.visual_features && typeof result.recognition_preflight.visual_features === "object") {
    return result.recognition_preflight.visual_features;
  }
  if (result.recognition?.visual_features && typeof result.recognition.visual_features === "object") {
    return result.recognition.visual_features;
  }
  return [];
}

function emptyVectorCandidatePacket(reason = "vector_retrieval_disabled") {
  return {
    vector_retrieval: {
      status: "UNAVAILABLE",
      status_code: "VECTOR_RETRIEVAL_UNAVAILABLE",
      instruction: "These are hypotheses, not ground truth. Verify every field against the current card images.",
      candidates: [],
      unavailable: [{ provider_id: "visual_vector", reason }]
    }
  };
}

function vectorRetrievalEnv(env = process.env, config = vectorRetrievalConfig(env)) {
  return {
    ...env,
    ENABLE_VISUAL_VECTOR_RETRIEVAL: "true",
    VECTOR_RETRIEVAL_MODE: config.mode,
    ENABLE_VECTOR_RETRIEVAL: "true",
    VISUAL_VECTOR_MODEL_ID: config.modelId,
    VISUAL_VECTOR_MODEL_REVISION: config.modelRevision,
    VISUAL_VECTOR_PREPROCESSING_VERSION: config.preprocessingVersion,
    VISUAL_VECTOR_MATCH_COUNT: String(config.internalTopN),
    VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS: String(config.queryTimeoutMs),
    VECTOR_RETRIEVAL_INTERNAL_TOP_N: String(config.internalTopN),
    VECTOR_QUERY_TIMEOUT_MS: String(config.queryTimeoutMs),
    ENABLE_ADVANCED_RETRIEVAL: config.advancedRetrievalEnabled ? "true" : "false",
    ENABLE_HYBRID_RETRIEVAL: config.hybridRetrievalEnabled ? "true" : "false",
    VECTOR_CORRECTED_TITLE_AS_TEMPORARY_GT: config.correctedTitleAsTemporaryGt ? "true" : "false",
    VECTOR_EVAL_CORRECTED_TITLE_AS_GT: config.correctedTitleAsTemporaryGt ? "true" : "false",
    ADVANCED_RETRIEVAL_STAGE1_TOP_N: String(config.advancedStage1TopN),
    ADVANCED_RETRIEVAL_RRF_K: String(config.rrfK),
    ADVANCED_RETRIEVAL_LOW_MARGIN: String(config.lowMarginThreshold),
    POSTGRES_HYBRID_RETRIEVAL_TOP_N: String(config.advancedStage1TopN)
  };
}

function retrievalEnvForProviderOptions(env = process.env, providerOptions = {}) {
  const config = vectorRetrievalConfig(env, providerOptions);
  return config.enabled ? vectorRetrievalEnv(env, config) : env;
}

function retrievalFamiliesForProviderOptions(env = process.env, providerOptions = {}) {
  const catalogAssist = optionFlag(providerOptions, "enable_catalog_assist", false);
  const vectorAssist = optionFlag(providerOptions, "enable_vector_assist", false);
  const config = vectorRetrievalConfig(env, providerOptions);
  const families = [];
  if (catalogAssist) {
    families.push(
      retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY,
      retrievalQueryFamilies.INTERNAL_REGISTRY,
      retrievalQueryFamilies.CATALOG_EXACT_CODE,
      retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT,
      retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR,
      retrievalQueryFamilies.CATALOG_SET_SUBJECT
    );
  }
  if (config.enabled && vectorAssist) {
    families.push(retrievalQueryFamilies.VISUAL_VECTOR);
    if (config.hybridRetrievalEnabled) families.push(retrievalQueryFamilies.POSTGRES_HYBRID);
  }
  return families.length ? [...new Set(families)] : null;
}

function catalogRetrievalFamilies() {
  return [
    retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY,
    retrievalQueryFamilies.INTERNAL_REGISTRY,
    retrievalQueryFamilies.CATALOG_EXACT_CODE,
    retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT,
    retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR,
    retrievalQueryFamilies.CATALOG_SET_SUBJECT
  ];
}

function catalogRetrievalEnv(env = process.env, providerOptions = {}) {
  const providerMode = String(providerOptions.provider_mode || providerOptions.providerMode || providerOptions.eval_mode || providerOptions.evalMode || "").replace(/\s+/g, " ").trim();
  const evalTemporaryGtAllowed = Boolean(providerMode);
  const correctedTitleAsTemporaryGt = evalTemporaryGtAllowed
    && optionFlag(providerOptions, "corrected_title_as_temporary_gt", false);
  return {
    ...env,
    CATALOG_EVAL_CORRECTED_TITLE_AS_GT: correctedTitleAsTemporaryGt ? "true" : env.CATALOG_EVAL_CORRECTED_TITLE_AS_GT,
    CATALOG_CORRECTED_TITLE_AS_TEMPORARY_GT: correctedTitleAsTemporaryGt ? "true" : env.CATALOG_CORRECTED_TITLE_AS_TEMPORARY_GT
  };
}

function vectorRetrievalUnavailablePacket(status, reason) {
  const statusCode = status === "VECTOR_RETRIEVAL_TIMEOUT"
    ? "VECTOR_RETRIEVAL_TIMEOUT"
    : status === "VECTOR_RETRIEVAL_ERROR"
      ? "VECTOR_RETRIEVAL_ERROR"
      : "VECTOR_RETRIEVAL_UNAVAILABLE";
  return {
    vector_retrieval: {
      status: statusCode.replace(/^VECTOR_RETRIEVAL_/, "") || "UNAVAILABLE",
      status_code: statusCode,
      instruction: "These are hypotheses, not ground truth. Verify every field against the current card images.",
      candidates: [],
      unavailable: [{ provider_id: "visual_vector", reason }]
    }
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function catalogCacheEnabled(env = process.env, providerOptions = {}) {
  return optionFlag(providerOptions, "enable_catalog_cache", envFlag(env, "ENABLE_CATALOG_LOOKUP_CACHE", true));
}

function catalogCacheTtlMs(env = process.env) {
  return Math.max(1_000, positiveIntegerFromEnv(env, "CATALOG_LOOKUP_CACHE_TTL_MS", defaultCatalogCacheTtlMs));
}

function catalogCacheMaxEntries(env = process.env) {
  return Math.max(10, positiveIntegerFromEnv(env, "CATALOG_LOOKUP_CACHE_MAX_ENTRIES", defaultCatalogCacheMaxEntries));
}

function catalogFastLaneBudgetMs(env = process.env, providerOptions = {}) {
  const optionValue = normalizePositiveIntegerOrNull(providerOptions.catalog_fast_lane_budget_ms ?? providerOptions.catalogFastLaneBudgetMs);
  return Math.max(0, optionValue ?? positiveIntegerFromEnv(env, "CATALOG_FAST_LANE_BUDGET_MS", defaultCatalogFastLaneBudgetMs));
}

function catalogCandidateContextCacheKey({ resolvedForRetrieval = {}, providerOptions = {}, env = process.env } = {}) {
  const normalized = normalizeFields(resolvedForRetrieval || {});
  const serialDenominator = normalizeSerialText(normalized.serial_number || "").match(/\/\s*0*(\d{1,4})\b/)?.[1] || "";
  const players = Array.isArray(normalized.players)
    ? normalized.players
    : [normalized.player, normalized.subject].map((value) => normalizeText(value)).filter(Boolean);
  const keyPayload = {
    revision: env.CATALOG_LOOKUP_CACHE_REVISION || "v2",
    source_trust_policy_version: env.CATALOG_SOURCE_TRUST_POLICY_VERSION || "approved-reference-v1",
    fields: {
      year: normalized.year || "",
      manufacturer: normalized.manufacturer || normalized.brand || "",
      brand: normalized.brand || normalized.manufacturer || "",
      product: normalized.product || "",
      set: normalized.set || normalized.set_name || "",
      players,
      player: normalized.player || "",
      subject: normalized.subject || "",
      character: normalized.character || "",
      collector_number: normalized.collector_number || "",
      checklist_code: normalized.checklist_code || "",
      serial_denominator: normalized.expected_serial_denominator || serialDenominator
    },
    options: {
      corrected_title_as_temporary_gt: optionFlag(providerOptions, "corrected_title_as_temporary_gt", false),
      enable_catalog_assist: optionFlag(providerOptions, "enable_catalog_assist", false),
      cloud_eval_blind_to_corrected_title_hint: optionFlag(providerOptions, "cloud_eval_blind_to_corrected_title_hint", true),
      provider_mode: providerOptions.provider_mode || providerOptions.providerMode || providerOptions.eval_mode || providerOptions.evalMode || ""
    }
  };
  return crypto.createHash("sha256").update(stableJson(keyPayload)).digest("hex");
}

function pruneCatalogCandidateContextCache(maxEntries, now = Date.now()) {
  for (const [key, entry] of catalogCandidateContextCache.entries()) {
    if (!entry || entry.expires_at_ms <= now) catalogCandidateContextCache.delete(key);
  }
  while (catalogCandidateContextCache.size > maxEntries) {
    const oldestKey = catalogCandidateContextCache.keys().next().value;
    if (!oldestKey) break;
    catalogCandidateContextCache.delete(oldestKey);
  }
}

function promptCandidatesFromContext(context = {}) {
  return Array.isArray(context.assistPacket?.vector_retrieval?.candidates)
    ? context.assistPacket.vector_retrieval.candidates
    : [];
}

function supportFieldSet(candidate = {}) {
  return new Set([
    ...(Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : []),
    ...(Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [])
  ].map((field) => String(field || "").trim().toLowerCase()).filter(Boolean));
}

function fieldHasValue(fields = {}, ...keys) {
  return keys.some((key) => valuePresent(fields?.[key]));
}

function catalogCandidateHasStrongAnchor(candidate = {}, queryFields = {}) {
  const fields = candidate.fields && typeof candidate.fields === "object" ? candidate.fields : {};
  const support = supportFieldSet(candidate);
  const conflicts = Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : [];
  if (String(candidate.source_trust || "").toUpperCase() !== "APPROVED_REFERENCE") return false;
  if (conflicts.length) return false;

  const hasExactCode = support.has("collector_number")
    || support.has("card_number")
    || support.has("checklist_code")
    || fieldHasValue(fields, "collector_number", "checklist_code");
  const hasSerialDenominator = support.has("serial_denominator")
    || support.has("serial_number")
    || fieldHasValue(fields, "expected_serial_denominator");
  const hasSubject = support.has("subjects")
    || support.has("players")
    || support.has("subject")
    || fieldHasValue(fields, "subjects", "players", "player", "subject");
  const hasProductOrYear = support.has("product")
    || support.has("product_partial")
    || support.has("set")
    || support.has("year")
    || fieldHasValue(fields, "product", "set", "year")
    || fieldHasValue(queryFields, "product", "set", "year");

  return (hasExactCode && (hasSubject || hasProductOrYear))
    || (hasSerialDenominator && hasSubject && hasProductOrYear);
}

function catalogStrongCandidateForVectorLazy(context = {}, queryFields = {}) {
  if (context.promptPacket !== true) return null;
  const eligibility = context.catalog_assist_eligibility || {};
  if (Number(eligibility.prompt_candidate_count || 0) !== 1) return null;
  const candidates = promptCandidatesFromContext(context);
  const candidate = candidates[0] || null;
  return candidate && catalogCandidateHasStrongAnchor(candidate, queryFields) ? candidate : null;
}

const exactAnchorForbiddenCopyFields = Object.freeze([
  "serial_number",
  "serial_numerator",
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "cert_number",
  "certification_number"
]);

function expectedExactAnchorSavedMs(env = process.env, providerOptions = {}) {
  const raw = providerOptions.exact_anchor_expected_saved_ms ?? env.EXACT_ANCHOR_FAST_LANE_EXPECTED_SAVED_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function buildExactAnchorFastLaneShadow({
  catalogContext = {},
  resolvedForRetrieval = {},
  providerOptions = {},
  env = process.env,
  lazyDecision = null
} = {}) {
  const candidate = catalogStrongCandidateForVectorLazy(catalogContext, resolvedForRetrieval);
  const skipDecision = lazyDecision || shouldSkipVectorForCatalogContext({
    catalogContext,
    resolvedForRetrieval,
    providerOptions,
    env
  });
  if (!candidate) {
    return {
      exact_anchor_fast_lane_eligible: false,
      exact_anchor_candidate_id: "",
      exact_anchor_candidate_identity_id: "",
      exact_anchor_reason: skipDecision?.reason || "no_strong_catalog_anchor",
      would_skip_vector: false,
      would_use_title_scaffold: false,
      forbidden_to_copy_fields: [...exactAnchorForbiddenCopyFields],
      expected_saved_ms: null
    };
  }

  return {
    exact_anchor_fast_lane_eligible: true,
    exact_anchor_candidate_id: candidate.candidate_id || candidate.candidate_identity_id || "",
    exact_anchor_candidate_identity_id: candidate.candidate_identity_id || "",
    exact_anchor_reason: "approved_reference_strong_catalog_anchor",
    would_skip_vector: skipDecision?.skip === true,
    would_use_title_scaffold: true,
    forbidden_to_copy_fields: [...exactAnchorForbiddenCopyFields],
    expected_saved_ms: expectedExactAnchorSavedMs(env, providerOptions)
  };
}

function shouldSkipVectorForCatalogContext({
  catalogContext = {},
  resolvedForRetrieval = {},
  providerOptions = {},
  env = process.env
} = {}) {
  if (optionFlag(providerOptions, "enable_vector_lazy_mode", envFlag(env, "ENABLE_VECTOR_LAZY_MODE", true)) !== true) {
    return { skip: false, reason: "vector_lazy_disabled" };
  }
  if (optionFlag(providerOptions, "enable_vector_assist", false) !== true) {
    return { skip: false, reason: "vector_assist_disabled" };
  }
  if (optionFlag(providerOptions, "force_vector_assist", false) === true) {
    return { skip: false, reason: "force_vector_assist" };
  }
  const candidate = catalogStrongCandidateForVectorLazy(catalogContext, resolvedForRetrieval);
  if (!candidate) return { skip: false, reason: "no_strong_catalog_anchor" };
  return {
    skip: true,
    reason: "strong_catalog_anchor",
    candidate_id: candidate.candidate_id || candidate.candidate_identity_id || "",
    candidate_identity_id: candidate.candidate_identity_id || ""
  };
}

function skippedVectorCandidateContext({
  reason = "vector_lazy_catalog_anchor",
  visualFeatures = {},
  env = process.env,
  providerOptions = {},
  skip = {}
} = {}) {
  const config = vectorRetrievalConfig(env, providerOptions);
  const packet = emptyVectorCandidatePacket(reason);
  return {
    mode: config.mode,
    visualFeatures,
    packet,
    assistPacket: packet,
    retrieval: null,
    worker: null,
    telemetry: null,
    vector_assist_eligibility: vectorCandidatePacketAssistEligibility(packet),
    promptPacket: false,
    skipped: true,
    skip_reason: reason,
    vector_lazy_skip: {
      skipped: true,
      reason,
      catalog_candidate_id: skip.candidate_id || "",
      catalog_candidate_identity_id: skip.candidate_identity_id || ""
    }
  };
}

function waitForPromiseWithin(promise, timeoutMs) {
  if (timeoutMs <= 0) {
    return Promise.resolve({ settled: false, value: null });
  }
  let timeout;
  return Promise.race([
    promise.then(
      (value) => ({ settled: true, value }),
      (error) => {
        throw error;
      }
    ),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ settled: false, value: null }), timeoutMs);
    })
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function prepareCatalogCandidateContext({
  resolvedForRetrieval = {},
  providerOptions = {},
  timingContext = null,
  env = process.env
} = {}) {
  if (optionFlag(providerOptions, "enable_catalog_assist", false) !== true) {
    const packet = emptyVectorCandidatePacket("catalog_assist_disabled");
    return {
      retrieval: null,
      packet,
      assistPacket: packet,
      catalog_assist_eligibility: vectorCandidatePacketAssistEligibility(packet),
      promptPacket: false
    };
  }

  const cacheEnabled = catalogCacheEnabled(env, providerOptions);
  const cacheKey = cacheEnabled
    ? catalogCandidateContextCacheKey({ resolvedForRetrieval, providerOptions, env })
    : "";
  const cacheStartedAt = Date.now();
  if (cacheEnabled && cacheKey) {
    const cached = catalogCandidateContextCache.get(cacheKey);
    if (cached && cached.expires_at_ms > cacheStartedAt) {
      addTiming(timingContext, "catalog_cache_ms", Date.now() - cacheStartedAt);
      return {
        ...cached.context,
        catalog_cache_hit: true
      };
    }
  }

  const allowedFamilies = catalogRetrievalFamilies();
  const retrieval = await timeAsync(timingContext, "catalog_retrieval_ms", () => runRetrieval({
    resolved: resolvedForRetrieval || {},
    visualEmbeddings: [],
    mode: retrievalModes.INTERNAL_ONLY,
    allowedFamilies,
    maxQueries: allowedFamilies.length,
    env: catalogRetrievalEnv(env, providerOptions)
  }));
  const packet = buildVectorCandidatePacket(retrieval, {
    limit: 5,
    queryFields: resolvedForRetrieval || {}
  });
  const assistEligibility = vectorCandidatePacketAssistEligibility(packet);
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  const context = {
    retrieval,
    packet,
    assistPacket,
    catalog_assist_eligibility: assistEligibility,
    promptPacket: assistEligibility.prompt_candidate_count > 0,
    catalog_cache_hit: false
  };
  if (cacheEnabled && cacheKey) {
    catalogCandidateContextCache.set(cacheKey, {
      expires_at_ms: Date.now() + catalogCacheTtlMs(env),
      context
    });
    pruneCatalogCandidateContextCache(catalogCacheMaxEntries(env));
  }
  return context;
}

function vectorTelemetryContext(payload = {}) {
  return {
    analysisRunId: payload.analysisRunId || payload.analysis_run_id || null,
    assetId: payload.assetId || payload.asset_id || null,
    sourceFeedbackId: payload.sourceFeedbackId || payload.source_feedback_id || null,
    physicalCardId: payload.physicalCardId || payload.physical_card_id || null,
    physicalInstanceGroupId: payload.physicalInstanceGroupId || payload.physical_instance_group_id || null
  };
}

async function prepareVectorCandidateContext({
  initialPayload,
  signedImages,
  visualFeatures = {},
  resolvedForRetrieval = {},
  providerOptions = {},
  timingContext = null,
  env = process.env
} = {}) {
  const config = vectorRetrievalConfig(env, providerOptions);
  if (!config.enabled) {
    return {
      mode: vectorRetrievalModes.OFF,
      visualFeatures,
      packet: emptyVectorCandidatePacket("vector_retrieval_disabled"),
      assistPacket: emptyVectorCandidatePacket("vector_retrieval_disabled"),
      retrieval: null,
      promptPacket: false
    };
  }

  let activeVisualFeatures = visualFeatures;
  let workerResult = null;
  if (!hasUsableVisualFeatures(activeVisualFeatures)) {
    workerResult = await timeAsync(timingContext, "vector_embedding_ms", () => embedImagesWithVectorWorker({
      images: signedImages || initialPayload.images || [],
      requestId: `${initialPayload.assetId || initialPayload.asset_id || "asset"}_vector_query`,
      env,
      options: providerOptions
    }));
    if (hasUsableVisualFeatures(workerResult)) {
      activeVisualFeatures = workerResult;
    }
  }

  if (!hasUsableVisualFeatures(activeVisualFeatures)) {
    const status = workerResult?.status || "VECTOR_RETRIEVAL_UNAVAILABLE";
    const packet = vectorRetrievalUnavailablePacket(status, workerResult?.reason || "visual_embedding_missing");
    const telemetry = await recordVectorRetrievalTelemetry({
      visualFeatures: activeVisualFeatures || {},
      packet,
      mode: config.mode,
      retrievalConfig: config,
      context: vectorTelemetryContext(initialPayload),
      env
    });
    return {
      mode: config.mode,
      visualFeatures: activeVisualFeatures,
      packet,
      assistPacket: emptyVectorCandidatePacket(workerResult?.reason || "visual_embedding_missing"),
      retrieval: null,
      worker: workerResult,
      telemetry,
      promptPacket: false
    };
  }

  const retrievalStartedAt = Date.now();
  const allowedFamilies = retrievalFamiliesForProviderOptions(env, providerOptions)
    || (config.hybridRetrievalEnabled
      ? [
        retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY,
        retrievalQueryFamilies.INTERNAL_REGISTRY,
        retrievalQueryFamilies.VISUAL_VECTOR,
        retrievalQueryFamilies.POSTGRES_HYBRID
      ]
      : [retrievalQueryFamilies.VISUAL_VECTOR]);
  const retrieval = await timeAsync(timingContext, "vector_retrieval_ms", () => runRetrieval({
    resolved: resolvedForRetrieval || {},
    visualEmbeddings: activeVisualFeatures,
    mode: retrievalModes.INTERNAL_ONLY,
    allowedFamilies,
    maxQueries: config.hybridRetrievalEnabled ? Math.max(4, allowedFamilies.length + 2) : 2,
    env: vectorRetrievalEnv(env, config)
  }));
  const packet = buildVectorCandidatePacket(retrieval, {
    limit: config.gptCandidateLimit,
    queryFields: resolvedForRetrieval || {}
  });
  const assistEligibility = vectorCandidatePacketAssistEligibility(packet);
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  const telemetry = await recordVectorRetrievalTelemetry({
    visualFeatures: activeVisualFeatures,
    packet,
    mode: config.mode,
    retrievalConfig: config,
    context: vectorTelemetryContext(initialPayload),
    retrievalLatencyMs: Date.now() - retrievalStartedAt,
    env
  });
  return {
    mode: config.mode,
    visualFeatures: activeVisualFeatures,
    packet,
    assistPacket,
    retrieval,
    worker: workerResult,
    telemetry,
    vector_assist_eligibility: assistEligibility,
    promptPacket: config.mode === vectorRetrievalModes.ASSIST && assistEligibility.prompt_candidate_count > 0
  };
}

function withVectorCandidateContext(result = {}, context = {}) {
  if (!context || !context.packet) return result;
  return {
    ...result,
    vector_retrieval_mode: context.mode || null,
    vector_retrieval: context.retrieval || null,
    vector_candidate_packet: context.packet,
    vector_assist_packet: context.assistPacket || null,
    vector_prompt_assist_used: context.promptPacket === true,
    vector_assist_eligibility: context.vector_assist_eligibility || null,
    vector_lazy_skip: context.vector_lazy_skip || null,
    vector_telemetry: context.telemetry || null,
    vector_worker: context.worker
      ? {
        status: context.worker.status || null,
        reason: context.worker.reason || "",
        latency_ms: context.worker.latency_ms ?? null,
        feature_count: Array.isArray(context.worker.features) ? context.worker.features.length : 0
      }
      : null
  };
}

function withCatalogCandidateContext(result = {}, context = {}) {
  if (!context || !context.packet) return result;
  const exactAnchorFastLane = context.exact_anchor_fast_lane_shadow || null;
  return {
    ...result,
    catalog_retrieval: context.retrieval || null,
    catalog_candidate_packet: context.packet,
    catalog_assist_packet: context.assistPacket || null,
    catalog_prompt_assist_used: context.promptPacket === true,
    catalog_assist_eligibility: context.catalog_assist_eligibility || null,
    catalog_cache_hit: context.catalog_cache_hit === true,
    exact_anchor_fast_lane_shadow: exactAnchorFastLane,
    exact_anchor_fast_lane_eligible: exactAnchorFastLane?.exact_anchor_fast_lane_eligible === true,
    exact_anchor_candidate_id: exactAnchorFastLane?.exact_anchor_candidate_id || "",
    exact_anchor_reason: exactAnchorFastLane?.exact_anchor_reason || null,
    would_skip_vector: exactAnchorFastLane?.would_skip_vector === true,
    would_use_title_scaffold: exactAnchorFastLane?.would_use_title_scaffold === true,
    forbidden_to_copy_fields: Array.isArray(exactAnchorFastLane?.forbidden_to_copy_fields)
      ? exactAnchorFastLane.forbidden_to_copy_fields
      : [],
    expected_saved_ms: exactAnchorFastLane?.expected_saved_ms ?? null
  };
}

function numericEligibilityValue(eligibility = {}, key = "") {
  const value = Number(eligibility?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function promptCandidateIdsFromEligibility(...eligibilities) {
  return [...new Set(eligibilities.flatMap((eligibility) => (
    Array.isArray(eligibility?.prompt_candidate_ids)
      ? eligibility.prompt_candidate_ids
      : []
  )).map((id) => String(id || "").trim()).filter(Boolean))];
}

function packetOpenSetSignal(packet = {}) {
  const retrieval = packet?.vector_retrieval || {};
  return {
    status: retrieval.status || null,
    status_code: retrieval.status_code || null,
    decision: retrieval.open_set_decision || null,
    reason: retrieval.open_set_reason || null
  };
}

function buildOpenSetReadiness(result = {}, {
  catalogContext = {},
  vectorContext = {},
  providerOptions = {}
} = {}) {
  const catalogEligibility = result.catalog_assist_eligibility
    || catalogContext.catalog_assist_eligibility
    || catalogContext.assistPacket?.vector_retrieval?.assist_filter
    || {};
  const vectorEligibility = result.vector_assist_eligibility
    || vectorContext.vector_assist_eligibility
    || vectorContext.assistPacket?.vector_retrieval?.assist_filter
    || {};
  const catalogSignal = packetOpenSetSignal(result.catalog_candidate_packet || catalogContext.packet);
  const vectorSignal = packetOpenSetSignal(result.vector_candidate_packet || vectorContext.packet);
  const catalogPromptCount = numericEligibilityValue(catalogEligibility, "prompt_candidate_count");
  const vectorPromptCount = numericEligibilityValue(vectorEligibility, "prompt_candidate_count");
  const promptCandidateCount = catalogPromptCount + vectorPromptCount;
  const rawCandidateCount = numericEligibilityValue(catalogEligibility, "raw_candidate_count")
    + numericEligibilityValue(vectorEligibility, "raw_candidate_count");
  const approvedCandidateCount = numericEligibilityValue(catalogEligibility, "approved_candidate_count")
    + numericEligibilityValue(vectorEligibility, "approved_candidate_count");
  const conflictBlockedCount = numericEligibilityValue(catalogEligibility, "conflict_blocked_count")
    + numericEligibilityValue(vectorEligibility, "conflict_blocked_count");
  const assistEnabled = optionFlag(providerOptions, "enable_catalog_assist", false) === true
    || optionFlag(providerOptions, "enable_vector_assist", false) === true;
  const reasons = [...new Set([
    catalogEligibility.reason,
    vectorEligibility.reason,
    catalogSignal.reason,
    vectorSignal.reason
  ].map((reason) => String(reason || "").trim()).filter(Boolean))];
  const unavailable = [catalogSignal, vectorSignal].some((signal) => /UNAVAILABLE|TIMEOUT|ERROR/i.test(`${signal.status || ""} ${signal.status_code || ""}`));
  const openSetDecision = vectorSignal.decision || catalogSignal.decision || null;
  const openSetReason = vectorSignal.reason || catalogSignal.reason || null;

  let status = "ASSIST_DISABLED";
  let releasePolicy = "single_model_writer_review";
  if (assistEnabled && promptCandidateCount > 0) {
    status = "KNOWN_CATALOG_ASSISTED";
    releasePolicy = "writer_quick_review_with_catalog_assist";
  } else if (assistEnabled && conflictBlockedCount > 0 && approvedCandidateCount > 0) {
    status = "APPROVED_CANDIDATE_CONFLICT_REVIEW";
    releasePolicy = "writer_review_catalog_conflict";
  } else if (assistEnabled && /LOW_MARGIN/i.test(`${openSetDecision} ${reasons.join(" ")}`)) {
    status = "LOW_MARGIN_SIMILAR_ONLY";
    releasePolicy = "evidence_backed_writer_review_catalog_gap";
  } else if (assistEnabled && /NONE_OF_THE_ABOVE|NO_EXACT_MATCH|FAMILY_ONLY_MATCH/i.test(`${openSetDecision} ${reasons.join(" ")}`)) {
    status = "OPEN_SET_NO_EXACT_MATCH";
    releasePolicy = "evidence_backed_writer_review_catalog_gap";
  } else if (assistEnabled && unavailable && rawCandidateCount === 0) {
    status = "RETRIEVAL_UNAVAILABLE";
    releasePolicy = "provider_draft_without_catalog";
  } else if (assistEnabled && rawCandidateCount > 0 && approvedCandidateCount === 0) {
    status = "REFERENCE_CANDIDATES_ONLY";
    releasePolicy = "evidence_backed_writer_review_catalog_gap";
  } else if (assistEnabled) {
    status = "EVIDENCE_BACKED_NO_CATALOG";
    releasePolicy = "evidence_backed_writer_review_catalog_gap";
  }

  return {
    status,
    release_policy: releasePolicy,
    assist_enabled: assistEnabled,
    known_catalog_candidate_available: promptCandidateCount > 0,
    prompt_safe_candidate_count: promptCandidateCount,
    prompt_candidate_ids: promptCandidateIdsFromEligibility(catalogEligibility, vectorEligibility),
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: approvedCandidateCount,
    conflict_blocked_count: conflictBlockedCount,
    catalog: {
      ...catalogSignal,
      eligibility: catalogEligibility
    },
    vector: {
      ...vectorSignal,
      eligibility: vectorEligibility
    },
    open_set_decision: openSetDecision,
    open_set_reason: openSetReason,
    catalog_gap_queue_candidate: assistEnabled && promptCandidateCount === 0,
    fail_closed_candidate: assistEnabled && promptCandidateCount === 0 && (rawCandidateCount > 0 || approvedCandidateCount > 0 || conflictBlockedCount > 0),
    unknown_card_ready: assistEnabled
      && promptCandidateCount === 0
      && result.confidence !== "FAILED"
      && !result.provider_error_code
      && !result.provider_error_type,
    reasons
  };
}

function withOpenSetReadiness(result = {}, context = {}) {
  if (!result || typeof result !== "object") return result;
  const openSetReadiness = buildOpenSetReadiness(result, context);
  return applyColdStartSafeDraftPolicy({
    ...result,
    open_set_readiness: openSetReadiness
  }, {
    providerOptions: context.providerOptions || {},
    mode: context.mode || result.provider_eval_mode || "",
    openSetReadiness,
    maxLength: context.maxLength || maxFallbackTitleLength
  });
}

async function withEvidenceCompletion(result, payload, {
  runFocusedVisionImpl = null,
  env = process.env,
  timingContext = null,
  visualFeatures = {},
  providerOptions = {}
} = {}) {
  const retrievalMode = payload.retrievalMode || payload.retrieval_mode || process.env.RETRIEVAL_MODE;
  const retrievalEnv = retrievalEnvForProviderOptions(env, providerOptions);
  const allowedFamilies = retrievalFamiliesForProviderOptions(env, providerOptions);
  const completion = await timeAsync(timingContext, "evidence_completion_ms", () => completeEvidence({
    resolved: result.resolved,
    evidence: result.evidence,
    captureQuality: result.capture_quality || captureQualityForPayload(payload),
    unresolved: result.unresolved,
    visualEmbeddings: optionFlag(providerOptions, "enable_vector_assist", false)
      ? visualFeaturesForRetrieval(result, visualFeatures)
      : [],
    retrievalMode,
    allowedFamilies: allowedFamilies || undefined,
    maxQueries: allowedFamilies ? Math.max(4, allowedFamilies.length) : undefined,
    env: retrievalEnv,
    runFocusedVisionImpl
  }));
  addTiming(timingContext, "retrieval_ms", Number(completion.retrieval?.latency_ms || completion.retrieval?.retrieval_time_ms || 0));
  const resolutionTrace = [
    ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : []),
    ...completion.resolution_trace
  ];
  const completedResult = withCompletedEvidencePresentation(result, completion, payload);
  const route = completion.route || completedResult.route || completedResult.resolved?.route;
  const output = {
    ...completedResult,
    route,
    route_reason: completion.route_reason,
    retrieval: completion.retrieval,
    completion_state: completion.state,
    completion_trace: completion.resolution_trace,
    resolution_trace: resolutionTrace,
    usage: mergeUsage(result.usage, completion.usage, {
      providerCalls: result.provider ? 1 : 0
    })
  };

  return timeAsync(timingContext, "resolver_ms", () => applyIdentityResolutionGateWithConvergence(output, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId: output.identity_provider_id || output.provider || output.source,
    retrievalCandidates: retrievalCandidatesForIdentity(completion, providerOptions),
    retrieveEvidence: createIdentityConvergenceRetriever({
      retrievalMode,
      env: retrievalEnv,
      allowedFamilies: allowedFamilies || undefined,
      maxQueries: allowedFamilies ? Math.max(4, allowedFamilies.length) : undefined
    }),
    convergenceOptions: {
      maxIterations: 1
    }
  }));
}

function retrievalSourcesFromCompletion(completion = {}) {
  const summaries = [
    completion.retrieval,
    completion.catalog_retrieval,
    completion.vector_retrieval
  ].filter((summary) => summary && typeof summary === "object" && !Array.isArray(summary));
  return summaries.flatMap((summary, summaryIndex) => [
    summary.selected_candidate
      ? {
        ...summary.selected_candidate,
        __title_assist_selected_candidate: true,
        __title_assist_source_index: -1,
        __title_assist_summary_index: summaryIndex
      }
      : null,
    ...(Array.isArray(summary.sources) ? summary.sources.map((source, sourceIndex) => ({
      ...source,
      __title_assist_selected_candidate: false,
      __title_assist_source_index: sourceIndex,
      __title_assist_summary_index: summaryIndex
    })) : [])
  ].filter((source) => source && typeof source === "object"));
}

function retrievalSourceConflictFields(source = {}) {
  const explicit = [
    source.conflicting_fields,
    source.direct_evidence_conflicts,
    source.conflicts
  ].flatMap((value) => Array.isArray(value) ? value : []);
  return [...new Set(explicit.map((field) => normalizeStringOrNull(
    typeof field === "string" ? field : field?.field || field?.field_name || field?.name || field?.conflicting_field
  )).filter(Boolean))];
}

function retrievalSourceHasDirectConflict(source = {}) {
  if (retrievalSourceConflictFields(source).length) return true;
  return Number(source.field_conflict_count || source.direct_evidence_conflict_count || 0) > 0;
}

const titleAssistGenericTokens = new Set([
  "the",
  "and",
  "with",
  "card",
  "cards",
  "base",
  "rookie",
  "rc",
  "auto",
  "autograph",
  "refractor",
  "parallel",
  "black",
  "white",
  "gold",
  "silver",
  "blue",
  "red",
  "green",
  "orange",
  "purple",
  "bronze",
  "pink",
  "mini",
  "common"
]);

const titleAssistManufacturerTokens = new Set([
  "topps",
  "panini",
  "upper",
  "deck",
  "bowman",
  "wizards",
  "konami"
]);

const titleAssistSubjectStopTokens = new Set([
  "de",
  "da",
  "del",
  "la",
  "le",
  "van",
  "von",
  "jr",
  "sr",
  "ii",
  "iii",
  "iv"
]);

function meaningfulTitleAssistTokens(value, {
  includeManufacturer = true
} = {}) {
  return searchable(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !titleAssistGenericTokens.has(token))
    .filter((token) => includeManufacturer || !titleAssistManufacturerTokens.has(token));
}

function meaningfulSubjectTitleAssistTokens(value) {
  return meaningfulTitleAssistTokens(value, { includeManufacturer: false })
    .filter((token) => token.length >= 3)
    .filter((token) => !titleAssistSubjectStopTokens.has(token));
}

function nonEmptyCompatibleTextField(left, right) {
  const leftValue = searchable(left);
  const rightValue = searchable(right);
  return Boolean(leftValue && rightValue && (
    leftValue === rightValue
    || leftValue.includes(rightValue)
    || rightValue.includes(leftValue)
  ));
}

function tokenCompatibleTextField(left, right, {
  includeManufacturer = true
} = {}) {
  if (nonEmptyCompatibleTextField(left, right)) return true;
  const leftTokens = meaningfulTitleAssistTokens(left, { includeManufacturer });
  const rightTokens = meaningfulTitleAssistTokens(right, { includeManufacturer });
  if (!leftTokens.length || !rightTokens.length) return false;
  return leftTokens.some((leftToken) => rightTokens.some((rightToken) => (
    leftToken === rightToken
    || (leftToken.length >= 4 && rightToken.includes(leftToken))
    || (rightToken.length >= 4 && leftToken.includes(rightToken))
  )));
}

function titleAssistIdentityTextCompatible(left, right) {
  const leftValue = searchable(left);
  const rightValue = searchable(right);
  if (!leftValue || !rightValue) return true;
  return tokenCompatibleTextField(leftValue, rightValue, { includeManufacturer: false });
}

function titleAssistProductTextCompatible(left, right) {
  const leftValue = searchable(left);
  const rightValue = searchable(right);
  if (!leftValue || !rightValue) return true;
  if (titleAssistIdentityTextCompatible(leftValue, rightValue)) return true;
  const compactLeft = leftValue.replace(/\s+/g, "");
  const compactRight = rightValue.replace(/\s+/g, "");
  if (compactLeft.length >= 8 && compactRight.length >= 8
    && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))) {
    return true;
  }
  if ((leftValue.includes("pokemon") || leftValue.includes("pokémon") || rightValue.includes("pokemon") || rightValue.includes("pokémon"))
    && tokenCompatibleTextField(leftValue, rightValue, { includeManufacturer: true })) {
    return true;
  }
  return false;
}

function subjectTextsForTitleAssist(fields = {}) {
  const normalized = normalizeFields(fields || {});
  return [
    ...currentSubjectTokens(normalized),
    normalized.character,
    normalized.artist
  ].filter(Boolean);
}

function subjectTextCompatibleForTitleAssist(left, right) {
  if (nonEmptyCompatibleTextField(left, right)) return true;
  const leftTokens = meaningfulSubjectTitleAssistTokens(left);
  const rightTokens = meaningfulSubjectTitleAssistTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return overlap >= Math.min(2, leftTokens.length, rightTokens.length);
}

function looseSubjectTokenOverlapWithCurrent(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  const sourceSubjects = subjectTextsForTitleAssist(sourceFields);
  const currentSubjects = subjectTextsForTitleAssist(normalizedCurrent);
  if (!sourceSubjects.length || !currentSubjects.length) return false;
  const sourceTokens = new Set(sourceSubjects.flatMap((subject) => meaningfulSubjectTitleAssistTokens(subject)));
  const currentTokens = new Set(currentSubjects.flatMap((subject) => meaningfulSubjectTitleAssistTokens(subject)));
  return [...currentTokens].some((token) => token.length >= 5 && sourceTokens.has(token));
}

function titleSubjectOverlapWithCurrent(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  const sourceSubjects = subjectTextsForTitleAssist(sourceFields);
  const currentSubjects = subjectTextsForTitleAssist(normalizedCurrent);
  const sourceText = [
    source.title,
    source.reference_title,
    ...sourceSubjects
  ].filter(Boolean).join(" ");
  const currentText = [
    currentTitle,
    ...currentSubjects
  ].filter(Boolean).join(" ");

  if (sourceSubjects.length && currentSubjects.length) {
    return sourceSubjects.some((sourceSubject) => currentSubjects.some((currentSubject) => (
      subjectTextCompatibleForTitleAssist(sourceSubject, currentSubject)
    )));
  }

  if (currentSubjects.length && sourceText) {
    const sourceTokens = new Set(meaningfulSubjectTitleAssistTokens(sourceText));
    return currentSubjects.some((currentSubject) => meaningfulSubjectTitleAssistTokens(currentSubject)
      .some((token) => sourceTokens.has(token)));
  }

  if (sourceSubjects.length && currentText) {
    const currentTokens = new Set(meaningfulSubjectTitleAssistTokens(currentText));
    return sourceSubjects.some((sourceSubject) => meaningfulSubjectTitleAssistTokens(sourceSubject)
      .some((token) => currentTokens.has(token)));
  }

  return false;
}

function serialDenominatorCompatibleForTitleAssist(source = {}, currentFields = {}, currentTitle = "") {
  const currentDenominator = serialDenominatorForTitleAssist(currentFields.serial_number || currentTitle);
  const sourceFields = normalizeFields(source.fields || {});
  const sourceDenominator = serialDenominatorForTitleAssist(sourceFields.serial_number || source.title || source.reference_title);
  return Boolean(currentDenominator && sourceDenominator && currentDenominator === sourceDenominator);
}

function currentYearLooksLikeWeakSeasonContext(value = "") {
  const text = String(value || "").trim();
  if (/^\d{2}\s*[-/]\s*\d{2}$/.test(text)) return true;
  if (/^\d{4}\s*\/\s*\d{2}$/.test(text)) return true;
  return false;
}

function sourceCanSoftenYearConflict(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  if (!currentYearLooksLikeWeakSeasonContext(normalizedCurrent.year)) return false;
  const subjectCompatible = titleSubjectOverlapWithCurrent(source, currentFields, currentTitle)
    || looseSubjectTokenOverlapWithCurrent(source, currentFields, currentTitle);
  if (!subjectCompatible) return false;
  const sourceProduct = sourceFields.product || source.title || source.reference_title;
  const currentProduct = normalizedCurrent.product || currentTitle;
  return titleAssistProductTextCompatible(sourceProduct, currentProduct)
    || titleAssistProductTextCompatible(sourceProduct, currentTitle);
}

function retrievalSourceHasBlockingTitleConflict(source = {}, currentFields = {}, currentTitle = "") {
  const conflicts = retrievalSourceConflictFields(source);
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  if (!conflicts.length) return Number(source.field_conflict_count || source.direct_evidence_conflict_count || 0) > 0;
  const blocking = conflicts.filter((field) => {
    if (field === "year") {
      if (yearsCompatibleForTitleAssist(sourceFields.year, normalizedCurrent.year)) return false;
      return !sourceCanSoftenYearConflict(source, currentFields, currentTitle);
    }
    if (field === "brand" || field === "manufacturer") {
      const sourceValue = sourceFields[field] || sourceFields.brand || sourceFields.manufacturer || source.title || source.reference_title;
      const currentValue = normalizedCurrent[field] || normalizedCurrent.brand || normalizedCurrent.manufacturer || currentTitle;
      return !titleAssistIdentityTextCompatible(sourceValue, currentValue)
        && !titleAssistProductTextCompatible(sourceValue, currentTitle);
    }
    if (field === "product" || field === "set" || field === "insert") {
      const sourceValue = sourceFields[field] || source.title || source.reference_title;
      const currentValue = normalizedCurrent[field] || normalizedCurrent.product || currentTitle;
      if (field === "product") {
        return !titleAssistProductTextCompatible(sourceValue, currentValue)
          && !titleAssistProductTextCompatible(sourceValue, currentTitle);
      }
      if (titleAssistIdentityTextCompatible(sourceValue, currentValue)) return false;
      const sourceProduct = sourceFields.product || source.title || source.reference_title;
      const currentProduct = normalizedCurrent.product || currentTitle;
      const subjectCompatible = titleSubjectOverlapWithCurrent(source, currentFields, currentTitle)
        || looseSubjectTokenOverlapWithCurrent(source, currentFields, currentTitle);
      return !(subjectCompatible && (
        titleAssistProductTextCompatible(sourceProduct, currentProduct)
        || titleAssistProductTextCompatible(sourceProduct, currentTitle)
      ));
    }
    if (field === "collector_number" || field === "checklist_code") {
      const sourceValue = sourceFields[field] || source.title || source.reference_title;
      const currentValue = normalizedCurrent[field] || currentTitle;
      return !compatibleTextField(sourceValue, currentValue);
    }
    if (/^(players|subjects|subject|character)$/.test(field)) {
      return !titleSubjectOverlapWithCurrent(source, currentFields, currentTitle);
    }
    if (field === "serial_number") {
      return !serialDenominatorCompatibleForTitleAssist(source, currentFields, currentTitle);
    }
    return true;
  });
  return blocking.length > 0;
}

function approvedRetrievalStatus(source = {}) {
  return /approved|reviewed|verified/i.test(`${source.reference_metadata?.retrieval_status || ""} ${source.reference_metadata?.reference_status || ""} ${source.retrieval_status || ""} ${source.source_trust || ""}`);
}

function retrievalSourceIsTrustedTitleAssist(source = {}) {
  const providerId = String(source.provider_id || source.source_provider || "").toLowerCase();
  const sourceType = String(source.source_type || "").toUpperCase();
  if (sourceType === "VISUAL_VECTOR" || providerId === "visual_vector") return false;
  if (sourceType === "MARKETPLACE") return false;
  if (providerId === "catalog" || providerId === "postgres_hybrid") return approvedRetrievalStatus(source)
    || /INTERNAL_APPROVED_HISTORY|STRUCTURED_DATABASE|OFFICIAL_CHECKLIST|OFFICIAL_REGISTRY/.test(sourceType);
  return /INTERNAL_APPROVED_HISTORY|APPROVED_MEMORY|OFFICIAL_CHECKLIST|OFFICIAL_REGISTRY/.test(sourceType);
}

function retrievalSourceIsCatalogLike(source = {}) {
  return /catalog|structured_database|official|approved|registry/i.test(`${source.provider_id || ""} ${source.source_provider || ""} ${source.source_type || ""} ${source.source_url || ""}`);
}

function retrievalSourceMatchedFields(source = {}) {
  return [...new Set([
    ...(Array.isArray(source.matched_fields) ? source.matched_fields : []),
    ...(Array.isArray(source.supporting_fields) ? source.supporting_fields : [])
  ].map((field) => String(field || "").toLowerCase()).filter(Boolean))];
}

function retrievalSourceEffectiveMatchedFields(source = {}, currentFields = {}, currentTitle = "") {
  const matched = new Set(retrievalSourceMatchedFields(source));
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  if (titleSubjectOverlapWithCurrent(source, currentFields, currentTitle)) {
    matched.add("subjects");
  }
  if (sourceFields.year && normalizedCurrent.year
    && (yearsCompatibleForTitleAssist(sourceFields.year, normalizedCurrent.year)
      || sourceCanSoftenYearConflict(source, currentFields, currentTitle))) {
    matched.add("year");
  }
  if (sourceFields.product && (normalizedCurrent.product || currentTitle)
    && (titleAssistProductTextCompatible(sourceFields.product, normalizedCurrent.product)
      || titleAssistProductTextCompatible(sourceFields.product, currentTitle))) {
    matched.add("product");
  }
  const sourceBrand = sourceFields.brand || sourceFields.manufacturer;
  const currentBrand = normalizedCurrent.brand || normalizedCurrent.manufacturer;
  if (sourceBrand && (currentBrand || currentTitle)
    && (titleAssistIdentityTextCompatible(sourceBrand, currentBrand)
      || titleAssistProductTextCompatible(sourceBrand, currentTitle))) {
    matched.add("brand");
  }
  if (serialDenominatorCompatibleForTitleAssist(source, currentFields, currentTitle)) {
    matched.add("serial_denominator");
  }
  if (sourceFields.collector_number && (normalizedCurrent.collector_number || currentTitle)
    && compatibleTextField(sourceFields.collector_number, normalizedCurrent.collector_number || currentTitle)) {
    matched.add("collector_number");
  }
  if (sourceFields.checklist_code && (normalizedCurrent.checklist_code || currentTitle)
    && compatibleTextField(sourceFields.checklist_code, normalizedCurrent.checklist_code || currentTitle)) {
    matched.add("checklist_code");
  }
  return matched;
}

function retrievalSourceHasStrongTitleSupport(source = {}, currentFields = {}, currentTitle = "") {
  const matched = retrievalSourceEffectiveMatchedFields(source, currentFields, currentTitle);
  const exactEvidence = ["collector_number", "checklist_code", "card_number", "serial_number", "serial_denominator"].some((field) => matched.has(field));
  if (exactEvidence) {
    return ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
      .some((field) => matched.has(field));
  }
  const identityEvidenceCount = ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
    .filter((field) => matched.has(field)).length;
  if (Number(source.__title_assist_source_index) === 0 && identityEvidenceCount >= 3 && Number(source.match_score || source.normalized_score || 0) >= 0.25) {
    return true;
  }
  return identityEvidenceCount >= 3 && Number(source.match_score || source.normalized_score || 0) >= 0.35;
}

function retrievalSourceHasExactIdentityAnchor(source = {}, currentFields = {}, currentTitle = "") {
  const matched = retrievalSourceEffectiveMatchedFields(source, currentFields, currentTitle);
  const exactEvidence = ["collector_number", "checklist_code", "card_number", "serial_number", "serial_denominator"].some((field) => matched.has(field));
  const identityEvidence = ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
    .some((field) => matched.has(field));
  return exactEvidence && identityEvidence;
}

function retrievalSourceHasHardIdentityAnchor(source = {}, currentFields = {}, currentTitle = "") {
  const matched = retrievalSourceEffectiveMatchedFields(source, currentFields, currentTitle);
  const exactEvidence = ["checklist_code", "serial_number", "serial_denominator"].some((field) => matched.has(field));
  const identityEvidence = ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
    .some((field) => matched.has(field));
  return exactEvidence && identityEvidence;
}

function retrievalSourceCanEnterTitleAssistLane(source = {}, currentFields = {}, currentTitle = "") {
  const selectedLane = source.selected === true || source.__title_assist_selected_candidate === true;
  const sourceIndex = Number(source.__title_assist_source_index);
  const topRankedLane = sourceIndex === 0;
  if (!retrievalSourceIsTrustedTitleAssist(source)) return false;
  if (retrievalSourceHasBlockingTitleConflict(source, currentFields, currentTitle)) return false;
  if (!retrievalSourceCompatibleWithCurrent(source, currentFields, currentTitle)) return false;
  const matched = retrievalSourceEffectiveMatchedFields(source, currentFields, currentTitle);
  const sourceSubjects = subjectTextsForTitleAssist(source.fields || {});
  const currentSubjects = subjectTextsForTitleAssist(currentFields || {});
  const exactAnchor = retrievalSourceHasExactIdentityAnchor(source, currentFields, currentTitle);
  const subjectSupport = titleSubjectOverlapWithCurrent(source, currentFields, currentTitle)
    || (exactAnchor && looseSubjectTokenOverlapWithCurrent(source, currentFields, currentTitle));
  const identitySupportCount = ["product", "set", "year", "brand", "manufacturer", "surface_color", "trigram", "collector_number", "checklist_code", "serial_denominator"]
    .filter((field) => matched.has(field)).length;
  const score = Number(source.match_score || source.normalized_score || source.raw_score || 0);
  const lowerRankedCatalogLane = sourceIndex > 0
    && sourceIndex <= 12
    && retrievalSourceIsCatalogLike(source)
    && subjectSupport
    && (exactAnchor || identitySupportCount >= 3)
    && score >= 0.38;
  const lowerRankedExactCatalogLane = sourceIndex > 0
    && sourceIndex <= 12
    && retrievalSourceIsCatalogLike(source)
    && subjectSupport
    && retrievalSourceHasHardIdentityAnchor(source, currentFields, currentTitle)
    && identitySupportCount >= 3
    && score >= 0.34;
  if (!selectedLane && !topRankedLane && !lowerRankedCatalogLane && !lowerRankedExactCatalogLane) return false;
  if (!subjectSupport && (sourceSubjects.length || currentSubjects.length)) return false;
  if (!subjectSupport && !exactAnchor) return false;
  if (!selectedLane && score < 0.25) return false;
  return (exactAnchor || identitySupportCount >= 2) && (selectedLane || score >= 0.25);
}

function overlapTokenCount(left, right) {
  const leftTokens = new Set(searchable(left).split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(searchable(right).split(" ").filter((token) => token.length > 1));
  return [...leftTokens].filter((token) => rightTokens.has(token)).length;
}

function compatibleTextField(left, right) {
  const leftValue = searchable(left);
  const rightValue = searchable(right);
  return !leftValue || !rightValue || leftValue === rightValue || leftValue.includes(rightValue) || rightValue.includes(leftValue);
}

function currentSubjectTokens(fields = {}) {
  const normalized = normalizeFields(fields || {});
  return Array.isArray(normalized.players) && normalized.players.length
    ? normalized.players
    : normalized.player
      ? [normalized.player]
      : [];
}

function retrievalSourceCompatibleWithCurrent(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  const subjectOverlap = titleSubjectOverlapWithCurrent(source, currentFields, currentTitle);
  if (sourceFields.year && normalizedCurrent.year && !yearsCompatibleForTitleAssist(sourceFields.year, normalizedCurrent.year)
    && !sourceCanSoftenYearConflict(source, currentFields, currentTitle)) return false;
  if (sourceFields.brand && normalizedCurrent.brand && !titleAssistIdentityTextCompatible(sourceFields.brand, normalizedCurrent.brand) && !titleAssistProductTextCompatible(sourceFields.brand, currentTitle)) return false;
  if (sourceFields.manufacturer && normalizedCurrent.manufacturer && !titleAssistIdentityTextCompatible(sourceFields.manufacturer, normalizedCurrent.manufacturer) && !titleAssistProductTextCompatible(sourceFields.manufacturer, currentTitle)) return false;
  if (sourceFields.product && normalizedCurrent.product && !titleAssistProductTextCompatible(sourceFields.product, normalizedCurrent.product) && !titleAssistProductTextCompatible(sourceFields.product, currentTitle)) return false;

  const sourceSubjects = currentSubjectTokens(sourceFields);
  const currentSubjects = currentSubjectTokens(normalizedCurrent);
  if (sourceSubjects.length && currentSubjects.length && !subjectOverlap && !looseSubjectTokenOverlapWithCurrent(source, currentFields, currentTitle)) {
    return false;
  }

  const currentDenominator = serialDenominatorForTitleAssist(normalizedCurrent.serial_number || currentTitle);
  const sourceDenominator = serialDenominatorForTitleAssist(sourceFields.serial_number || source.title);
  if (!currentDenominator && sourceDenominator) return false;
  if (currentDenominator && sourceDenominator && currentDenominator !== sourceDenominator) return false;
  return true;
}

function yearsCompatibleForTitleAssist(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  const leftYears = [...leftText.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  const rightYears = [...rightText.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  if (!leftYears.length || !rightYears.length) return compatibleTextField(left, right);
  return leftYears.some((year) => rightYears.includes(year) || rightYears.includes(year + 1) || rightYears.includes(year - 1));
}

function serialDenominatorForTitleAssist(value) {
  return normalizeSerialText(value).match(/\/\s*0*(\d{1,4})\b/)?.[1] || null;
}

function stripReferenceInstanceOnlyTerms(title) {
  return String(title || "")
    .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g, " ")
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s+(?:GEM\s*(?:MT|MINT)\s+|MINT\s+|AUTO\s+)?(?:AUTH(?:ENTIC)?|\d+(?:\.\d+)?)(?:\s*\/\s*(?:AUTH(?:ENTIC)?|\d+(?:\.\d+)?))?\b/gi, " ")
    .replace(/\bCert(?:ificate)?\s*#?\s*[A-Z0-9-]+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gradeTokenFromCurrentTitle(title) {
  return String(title || "").match(/\b(?:PSA|BGS|SGC|CGC)\s+(?:AUTO\s+)?(?:AUTH(?:ENTIC)?|\d+(?:\.\d+)?)(?:\s*\/\s*(?:AUTH(?:ENTIC)?|\d+(?:\.\d+)?))?\b/i)?.[0] || "";
}

function titleAssistFieldValuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).replace(/\s+/g, " ").trim() !== "" && value !== "UNKNOWN";
}

function mergeCurrentFieldsForTitleAssist(...fieldSets) {
  const merged = {};
  fieldSets.forEach((fields) => {
    const normalized = normalizeFields(fields || {});
    Object.entries(normalized).forEach(([field, value]) => {
      if (!titleAssistFieldValuePresent(value)) return;
      merged[field] = value;
    });
  });
  return merged;
}

function gradeTokenFromCurrentFields(fields = {}) {
  const normalized = normalizeFields(fields || {});
  const company = normalizeStringOrNull(normalized.grade_company);
  const grade = normalizeStringOrNull(normalized.card_grade || normalized.grade);
  if (!company || !grade) return "";
  return `${company} ${grade}`.replace(/\s+/g, " ").trim();
}

function appendCurrentInstanceTerms(title, currentFields = {}, currentTitle = "") {
  let output = String(title || "").replace(/\s+/g, " ").trim();
  const serial = normalizeSerialText(currentFields.serial_number || "");
  const serialLimit = serialLimitForTitle(serial, currentFields);
  if ((/\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(serial) || /^\/\d{1,4}\b/.test(serialLimit))
    && serialLimit
    && !titleIncludesSerial(output, { ...currentFields, serial_number: serial })) {
    output = `${output} ${serialLimit}`.trim();
  }
  const grade = gradeTokenFromCurrentFields(currentFields) || gradeTokenFromCurrentTitle(currentTitle);
  if (grade && !rawIncludes(output, grade)) output = `${output} ${grade}`.trim();
  const collector = normalizeStringOrNull(currentFields.collector_number || currentFields.card_number);
  if (collector && !rawIncludes(output, collector)) output = `${output} #${collector}`.trim();
  return output.replace(/\s+/g, " ").trim();
}

function escapeTitleAssistRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTitlePreservingSuffix(title, suffix, maxLength) {
  const suffixValue = String(suffix || "").replace(/\s+/g, " ").trim();
  const normalized = String(title || "").replace(/\s+/g, " ").trim();
  if (!suffixValue || normalized.length <= maxLength) return normalizeTitle(normalized, maxLength);
  const plain = normalizeTitle(normalized, maxLength);
  if (rawIncludes(plain, suffixValue)) return plain;
  const withoutSuffix = normalized
    .replace(new RegExp(`\\b${escapeTitleAssistRegExp(suffixValue)}\\b`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
  const prefixMaxLength = Math.max(0, maxLength - suffixValue.length - 1);
  const prefix = normalizeTitle(withoutSuffix, prefixMaxLength);
  return `${prefix} ${suffixValue}`.replace(/\s+/g, " ").trim();
}

function bestRetrievalTitleAssistSource(completion = {}, result = {}) {
  const currentFields = mergeCurrentFieldsForTitleAssist(
    result.fields,
    result.raw_provider_fields,
    result.resolved,
    result.resolved_fields
  );
  const currentTitle = result.final_title || result.title || result.rendered_title || "";
  return retrievalSourcesFromCompletion(completion)
    .filter((source) => retrievalSourceCanEnterTitleAssistLane(source, currentFields, currentTitle))
    .filter((source) => source.title || source.reference_title)
    .filter(retrievalSourceIsTrustedTitleAssist)
    .filter((source) => !retrievalSourceHasBlockingTitleConflict(source, currentFields, currentTitle))
    .filter((source) => retrievalSourceHasStrongTitleSupport(source, currentFields, currentTitle))
    .filter((source) => retrievalSourceCompatibleWithCurrent(source, currentFields, currentTitle))
    .sort((left, right) => {
      const leftMatched = retrievalSourceEffectiveMatchedFields(left, currentFields, currentTitle);
      const rightMatched = retrievalSourceEffectiveMatchedFields(right, currentFields, currentTitle);
      const leftCatalog = retrievalSourceIsCatalogLike(left) ? 1 : 0;
      const rightCatalog = retrievalSourceIsCatalogLike(right) ? 1 : 0;
      if (leftCatalog !== rightCatalog) return rightCatalog - leftCatalog;
      const leftExact = [...leftMatched].some((field) => /collector_number|checklist_code|card_number|serial_number/.test(field)) ? 1 : 0;
      const rightExact = [...rightMatched].some((field) => /collector_number|checklist_code|card_number|serial_number/.test(field)) ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      const leftSupport = leftMatched.size;
      const rightSupport = rightMatched.size;
      if (leftSupport !== rightSupport) return rightSupport - leftSupport;
      const leftOverlap = overlapTokenCount(left.title || left.reference_title, currentTitle);
      const rightOverlap = overlapTokenCount(right.title || right.reference_title, currentTitle);
      if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;
      return Number(right.match_score || right.normalized_score || 0) - Number(left.match_score || left.normalized_score || 0);
    })[0] || null;
}

function applySafeRetrievalTitleAssist(draft = {}, result = {}, completion = {}, payload = {}) {
  const source = bestRetrievalTitleAssistSource(completion, result);
  if (!source) return draft;
  const currentFields = mergeCurrentFieldsForTitleAssist(
    result.fields,
    result.raw_provider_fields,
    result.resolved,
    result.resolved_fields,
    draft.fields,
    draft.raw_provider_fields,
    draft.resolved,
    draft.resolved_fields
  );
  const currentTitle = draft.final_title || draft.title || result.final_title || result.title || "";
  const candidateTitle = stripReferenceInstanceOnlyTerms(source.title || source.reference_title || "");
  if (!candidateTitle) return draft;
  const titleWithCurrentInstanceTerms = appendCurrentInstanceTerms(candidateTitle, currentFields, currentTitle);
  const currentSerial = normalizeSerialText(currentFields.serial_number || "");
  const assistedTitle = /\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(currentSerial)
    ? normalizeTitlePreservingSuffix(titleWithCurrentInstanceTerms, currentSerial, payload.maxTitleLength || maxFallbackTitleLength)
    : normalizeTitle(titleWithCurrentInstanceTerms, payload.maxTitleLength || maxFallbackTitleLength);
  if (!assistedTitle || assistedTitle === currentTitle) return draft;

  return {
    ...draft,
    title: assistedTitle,
    final_title: assistedTitle,
    rendered_title: assistedTitle,
    title_render_source: "safe_retrieval_title_assist",
    retrieval_title_assist: {
      used: true,
      mode: "selected_approved_candidate_title_scaffold",
      source_url: source.source_url || "",
      provider_id: source.provider_id || source.source_provider || "",
      candidate_identity_id: source.candidate_identity_id || "",
      matched_fields: retrievalSourceMatchedFields(source),
      stripped_reference_instance_terms: true
    },
    rendered_fields: {
      ...(draft.rendered_fields || {}),
      title: assistedTitle,
      rendered_title: assistedTitle,
      title_render_source: "safe_retrieval_title_assist"
    }
  };
}

async function withEvidenceCompletionShadow(result, payload, {
  env = process.env,
  timingContext = null,
  visualFeatures = {},
  providerOptions = {},
  providerId = result.identity_provider_id || result.provider || result.source
} = {}) {
  const draft = singleModelDraftPath(result, payload, providerId, {
    reason: "assist_shadow_no_prompt_safe_candidates",
    allowWhenEvidenceCompletion: true,
    assistShadowOnly: true
  });
  if (!draft) return null;
  const guardedDraft = applyOpenSetAssistShadowPresentationGuard(draft, payload);

  const retrievalMode = payload.retrievalMode || payload.retrieval_mode || process.env.RETRIEVAL_MODE;
  const retrievalEnv = retrievalEnvForProviderOptions(env, providerOptions);
  const allowedFamilies = retrievalFamiliesForProviderOptions(env, providerOptions);
  let completion;
  try {
    completion = await timeAsync(timingContext, "evidence_completion_ms", () => completeEvidence({
      resolved: result.resolved,
      evidence: result.evidence,
      captureQuality: result.capture_quality || captureQualityForPayload(payload),
      unresolved: result.unresolved,
      visualEmbeddings: optionFlag(providerOptions, "enable_vector_assist", false)
        ? visualFeaturesForRetrieval(result, visualFeatures)
        : [],
      retrievalMode,
      allowedFamilies: allowedFamilies || undefined,
      maxQueries: allowedFamilies ? Math.max(4, allowedFamilies.length) : undefined,
      env: retrievalEnv
    }));
  } catch (error) {
    return {
      ...guardedDraft,
      route_reason: "No prompt-safe catalog or vector candidates were available; retrieval telemetry failed and did not alter the GPT draft.",
      retrieval: {
        skipped: true,
        reason: "assist_shadow_retrieval_failed",
        error: safeRecognitionError(error)
      },
      completion_state: {
        shadow_only: true,
        error_type: "RETRIEVAL_TELEMETRY_ERROR"
      },
      fast_path: {
        ...(guardedDraft.fast_path || {}),
        assist_shadow_only: true,
        assist_shadow_retrieval_only: true,
        reason: "assist_shadow_no_prompt_safe_candidates"
      }
    };
  }
  addTiming(timingContext, "retrieval_ms", Number(completion.retrieval?.latency_ms || completion.retrieval?.retrieval_time_ms || 0));
  const assistedDraft = applySafeRetrievalTitleAssist(guardedDraft, result, completion, payload);
  const finalAssistedDraft = applyOpenSetAssistShadowPresentationGuard(assistedDraft, payload);

  return {
    ...finalAssistedDraft,
    route: finalAssistedDraft.route || "ASSIST_SHADOW_WRITER_DRAFT",
    route_reason: finalAssistedDraft.retrieval_title_assist?.used
      ? "No prompt-safe catalog or vector candidates were available; selected approved retrieval evidence was used only as a stripped title scaffold without copying reference serial, grade, or cert values."
      : "No prompt-safe catalog or vector candidates were available; retrieval ran only for telemetry and did not alter the GPT draft.",
    retrieval: completion.retrieval || finalAssistedDraft.retrieval,
    completion_state: {
      ...(completion.state || {}),
      shadow_only: true
    },
    completion_trace: [
      ...(Array.isArray(finalAssistedDraft.completion_trace) ? finalAssistedDraft.completion_trace : []),
      ...(Array.isArray(completion.resolution_trace) ? completion.resolution_trace : [])
    ],
    resolution_trace: [
      ...(Array.isArray(finalAssistedDraft.resolution_trace) ? finalAssistedDraft.resolution_trace : []),
      ...(Array.isArray(completion.resolution_trace) ? completion.resolution_trace : [])
    ],
    usage: mergeUsage(finalAssistedDraft.usage, completion.usage, {
      providerCalls: result.provider ? 1 : 0
    }),
    fast_path: {
      ...(finalAssistedDraft.fast_path || {}),
      assist_shadow_only: true,
      assist_shadow_retrieval_only: true,
      reason: "assist_shadow_no_prompt_safe_candidates"
    }
  };
}

async function imagesWithSignedReadUrls(images = [], timingContext = null) {
  return timeAsync(timingContext, "signed_url_ms", () => mapWithConcurrency(images, signedUrlConcurrency, async (image) => {
    const metadata = await assertVerifiedStorageImage(image);
    if (!metadata?.objectPath) return image;

    return {
      ...image,
      signedUrl: await createListingImageSignedReadUrl({
        objectPath: metadata.objectPath,
        bucket: metadata.bucket
      }),
      signed_url: undefined
    };
  }));
}

async function createRecognitionIdentityPreflight(payload, {
  timingContext = null,
  providerOptions = {}
} = {}) {
  const config = recognitionWorkerConfig();
  if (!config.enabled || !config.configured) {
    return {
      result: null,
      evidenceDocument: null,
      response: null,
      signedImages: null,
      skipped: true,
      reason: config.reason || "recognition_worker_not_configured"
    };
  }

  const primaryImages = explicitPrimaryImagesFromImages(payload.images || []);
  const verifiedStorageReady = primaryImages.length > 0 && primaryImages.every((image) => {
    const metadata = storageMetadataForImage(image);
    return Boolean(metadata.objectPath && (image.storageVerified === true || image.storage_verified === true));
  });
  if (!verifiedStorageReady) {
    return {
      result: null,
      evidenceDocument: null,
      response: null,
      signedImages: null,
      skipped: true,
      reason: "recognition_preflight_requires_verified_storage_images"
    };
  }

  try {
    const signedImages = await imagesWithSignedReadUrls(payload.images || [], timingContext);
    const signedPrimaryImages = primaryImagesFromImages(signedImages);
    const response = await timeAsync(timingContext, "recognition_preflight_ms", () => analyzeCardImagesWithRecognitionWorker({
      assetId: payload.assetId || payload.asset_id || `asset_${crypto.randomUUID()}`,
      captureProfileId: payload.captureProfileId || payload.capture_profile_id || defaultCaptureProfileId,
      images: signedPrimaryImages,
      requestedFields: [...recognitionRequestedFields],
      options: {
        run_ocr: true,
        run_visual_embeddings: queryVisualVectorPreflightEnabled(process.env, providerOptions)
      }
    }));
    const evidenceDocument = recognitionResponseToEvidenceDocument(response, {
      images: signedImages
    });

    if (!hasRecognitionEvidence(evidenceDocument)) {
      return {
        result: null,
        evidenceDocument,
        response,
        signedImages
      };
    }

    const baseResult = withRequestMetadata({
      title: "",
      final_title: "",
      rendered_title: "",
      model_title_suggestion: "",
      title_render_source: "recognition_worker_identity_preflight",
      confidence: "LOW",
      reason: "Recognition worker produced grounded OCR evidence before vision provider selection.",
      fields: resolvedFieldsToLegacyFields(evidenceDocument.resolved),
      resolved: evidenceDocument.resolved,
      evidence: evidenceDocument.evidence,
      unresolved: evidenceDocument.unresolved || [],
      source: "recognition_worker",
      provider: "recognition_worker",
      route: "RECOGNITION_WORKER_PREFLIGHT",
      route_reason: "Attempted local OCR/slab identity resolution before the selected vision provider.",
      recognition_preflight: evidenceDocument.recognition || null,
      visual_features: response.visual_features || {},
      usage: {
        provider_calls: 0,
        retrieval_calls: 0,
        recognition_worker_calls: response.unavailable ? 0 : 1,
        latency_ms: Number(response.processing?.latency_ms || 0),
        estimated_cost_usd: 0,
        resolution_rounds: 0
      },
      resolution_trace: evidenceDocument.resolution_trace || [],
      evidence_schema_version: evidenceDocument.schema_version
    }, payload);
    const gated = applyIdentityResolutionGate(baseResult, {
      maxLength: payload.maxTitleLength || maxFallbackTitleLength,
      providerId: "recognition_worker"
    });

    return {
      result: gated.identity_resolution_status === identityStatuses.ABSTAIN ? null : gated,
      evidenceDocument,
      response,
      gated,
      signedImages
    };
  } catch (error) {
    return {
      result: null,
      evidenceDocument: null,
      signedImages: null,
      error: safeRecognitionError(error)
    };
  }
}

function shouldDeferVectorUntilProviderObservation({
  catalogContext = null,
  lazyDecision = {},
  providerOptions = {},
  env = process.env
} = {}) {
  if (optionFlag(providerOptions, "enable_vector_lazy_mode", envFlag(env, "ENABLE_VECTOR_LAZY_MODE", true)) !== true) return false;
  if (optionFlag(providerOptions, "enable_vector_assist", false) !== true) return false;
  if (optionFlag(providerOptions, "force_vector_assist", false) === true) return false;
  if (lazyDecision.skip === true) return false;
  return catalogContext?.promptPacket !== true;
}

function retrievalFieldsFromProviderObservation(result = {}, fallback = {}) {
  return mergeCurrentFieldsForTitleAssist(
    fallback,
    result.fields,
    result.raw_provider_fields,
    result.resolved,
    result.resolved_fields
  );
}

function withoutAutomaticVectorAssist(providerOptions = {}) {
  return {
    ...providerOptions,
    enable_vector_assist: false,
    enable_query_visual_embeddings: false,
    enable_vector_retrieval: false,
    enable_stored_visual_features: false,
    vector_retrieval_mode: "off"
  };
}

async function createOpenAiTitle(payload, selection, {
  recognitionEvidenceDocument = null,
  signedImages: reusableSignedImages = null,
  timingContext = null,
  visualFeatures = {}
} = {}) {
  const providerOptions = providerOptionsFromPayload(payload);
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const openSetContext = {
    providerOptions,
    mode: payload.provider_eval_mode || payload.eval_mode || payload.mode || "",
    maxLength: maxTitleLength
  };
  const resolvedForRetrieval = resolvedForRetrievalFromPayload(payload, providerOptions, recognitionEvidenceDocument);
  const signedImagesPromise = Array.isArray(reusableSignedImages) && reusableSignedImages.length
    ? reusableSignedImages
    : imagesWithSignedReadUrls(payload.images || [], timingContext);
  const catalogContextPromise = prepareCatalogCandidateContext({
    resolvedForRetrieval,
    providerOptions,
    timingContext
  });

  let signedImages;
  try {
    signedImages = await signedImagesPromise;
  } catch (error) {
    await catalogContextPromise.catch(() => null);
    throw error;
  }

  const baseInitialPayload = primaryPayloadForProvider({
    ...payload,
    images: signedImages
  });
  const earlyCatalog = await waitForPromiseWithin(
    catalogContextPromise,
    catalogFastLaneBudgetMs(process.env, providerOptions)
  );
  let catalogContext = earlyCatalog.settled ? earlyCatalog.value : null;
  const lazyDecision = catalogContext
    ? shouldSkipVectorForCatalogContext({
      catalogContext,
      resolvedForRetrieval,
      providerOptions,
      env: process.env
    })
    : { skip: false, reason: "catalog_fast_lane_budget_elapsed" };
  if (catalogContext) {
    catalogContext = {
      ...catalogContext,
      exact_anchor_fast_lane_shadow: buildExactAnchorFastLaneShadow({
        catalogContext,
        resolvedForRetrieval,
        providerOptions,
        env: process.env,
        lazyDecision
      })
    };
  }
  const deferVectorUntilProviderObservation = shouldDeferVectorUntilProviderObservation({
    catalogContext,
    lazyDecision,
    providerOptions,
    env: process.env
  });
  const vectorContextPromise = lazyDecision.skip
    ? Promise.resolve(skippedVectorCandidateContext({
      reason: "vector_lazy_strong_catalog_anchor",
      visualFeatures,
      env: process.env,
      providerOptions,
      skip: lazyDecision
    }))
    : deferVectorUntilProviderObservation
      ? null
      : prepareVectorCandidateContext({
      initialPayload: baseInitialPayload,
      signedImages,
      visualFeatures,
      resolvedForRetrieval,
      providerOptions,
      timingContext
    });
  let vectorContext = null;
  if (deferVectorUntilProviderObservation) {
    catalogContext = catalogContext || null;
  } else {
    const [finalCatalogContext, earlyVectorContext] = await Promise.all([
      catalogContext ? Promise.resolve(catalogContext) : catalogContextPromise,
      vectorContextPromise
    ]);
    catalogContext = finalCatalogContext;
    vectorContext = earlyVectorContext;
  }
  const strongCatalogCandidate = catalogStrongCandidateForVectorLazy(catalogContext || {}, resolvedForRetrieval);
  const promptCandidatePacket = strongCatalogCandidate && catalogContext.promptPacket
    ? catalogContext.assistPacket
    : vectorContext?.promptPacket
      ? vectorContext.assistPacket
      : catalogContext?.promptPacket
        ? catalogContext.assistPacket
        : null;
  const assistEnabled = optionFlag(providerOptions, "enable_catalog_assist", false) === true
    || optionFlag(providerOptions, "enable_vector_assist", false) === true;
  const assistShadowOnly = assistEnabled && !promptCandidatePacket;
  const initialPayload = {
    ...baseInitialPayload
  };
  if (promptCandidatePacket) initialPayload.vectorCandidatePacket = promptCandidatePacket;
  const prompt = await buildInitialProviderPrompt(initialPayload, maxTitleLength);
  const providerResult = await runTimedProviderCall(visionProviderIds.OPENAI_LEGACY, timingContext, () => analyzeCardEvidenceWithOpenAiEmergency({
    images: initialPayload.images,
    prompt
  }));

  const providerResultWithEvidence = timeSync(timingContext, "renderer_ms", () => withProviderMetadata(
      withEvidenceCompatibility(
        withRequestMetadata(normalizeAiResult(providerResult.parsed, maxTitleLength, visionProviderIds.OPENAI_LEGACY), initialPayload),
        providerResult.parsed,
        initialPayload
      ),
      providerResult,
      selection
    ));
  if (deferVectorUntilProviderObservation) {
    const providerResolvedForRetrieval = retrievalFieldsFromProviderObservation(providerResultWithEvidence, resolvedForRetrieval);
    const lateCatalogContext = await prepareCatalogCandidateContext({
      resolvedForRetrieval: providerResolvedForRetrieval,
      providerOptions,
      timingContext
    }).catch(() => null);
    const lateStrongCatalogCandidate = lateCatalogContext
      ? catalogStrongCandidateForVectorLazy(lateCatalogContext, providerResolvedForRetrieval)
      : null;
    if (lateStrongCatalogCandidate) {
      const lateLazyDecision = {
        skip: true,
        reason: "strong_catalog_anchor",
        candidate_id: lateStrongCatalogCandidate.candidate_id || lateStrongCatalogCandidate.candidate_identity_id || "",
        candidate_identity_id: lateStrongCatalogCandidate.candidate_identity_id || ""
      };
      catalogContext = {
        ...lateCatalogContext,
        promptPacket: false,
        catalog_exact_anchor_after_provider_observation: true,
        exact_anchor_fast_lane_shadow: buildExactAnchorFastLaneShadow({
          catalogContext: lateCatalogContext,
          resolvedForRetrieval: providerResolvedForRetrieval,
          providerOptions,
          env: process.env,
          lazyDecision: lateLazyDecision
        })
      };
      vectorContext = skippedVectorCandidateContext({
        reason: "vector_lazy_provider_catalog_anchor",
        visualFeatures,
        env: process.env,
        providerOptions,
        skip: lateLazyDecision
      });
    } else {
      catalogContext = lateCatalogContext || catalogContext || await catalogContextPromise.catch(() => null);
      vectorContext = await prepareVectorCandidateContext({
        initialPayload: baseInitialPayload,
        signedImages,
        visualFeatures,
        resolvedForRetrieval: providerResolvedForRetrieval,
        providerOptions,
        timingContext
      });
    }
  }
  if (!catalogContext) catalogContext = await catalogContextPromise.catch(() => null);
  if (catalogContext && !catalogContext.exact_anchor_fast_lane_shadow) {
    catalogContext = {
      ...catalogContext,
      exact_anchor_fast_lane_shadow: buildExactAnchorFastLaneShadow({
        catalogContext,
        resolvedForRetrieval,
        providerOptions,
        env: process.env
      })
    };
  }
  if (!vectorContext) {
    vectorContext = await prepareVectorCandidateContext({
      initialPayload: baseInitialPayload,
      signedImages,
      visualFeatures,
      resolvedForRetrieval,
      providerOptions,
      timingContext
    });
  }
  const mergedResult = withVisualFeatures(
    withVectorCandidateContext(
      withCatalogCandidateContext(
        withRecognitionEvidence(providerResultWithEvidence, recognitionEvidenceDocument, initialPayload),
        catalogContext
      ),
      vectorContext
    ),
    vectorContext.visualFeatures
  );
  const fastPathResult = timeSync(timingContext, "resolver_ms", () => tryProviderFastPath(mergedResult, initialPayload, visionProviderIds.OPENAI_LEGACY));
  if (fastPathResult) return withOpenSetReadiness(fastPathResult, { ...openSetContext, catalogContext, vectorContext });
  if (assistShadowOnly) {
    const shadowProviderOptions = vectorContext.vector_lazy_skip?.skipped === true
      ? withoutAutomaticVectorAssist(providerOptions)
      : providerOptions;
    const shadowResult = await withEvidenceCompletionShadow(mergedResult, initialPayload, {
      timingContext,
      visualFeatures: vectorContext.visualFeatures,
      providerOptions: shadowProviderOptions,
      providerId: visionProviderIds.OPENAI_LEGACY
    });
    return withOpenSetReadiness(shadowResult, { ...openSetContext, catalogContext, vectorContext });
  }
  const singleModelResult = timeSync(timingContext, "resolver_ms", () => singleModelDraftPath(
    mergedResult,
    initialPayload,
    visionProviderIds.OPENAI_LEGACY,
    {
      reason: assistShadowOnly
        ? "assist_shadow_no_prompt_safe_candidates"
        : "single_model_fast_path",
      allowWhenEvidenceCompletion: assistShadowOnly,
      assistShadowOnly
    }
  ));
  if (singleModelResult) return withOpenSetReadiness(singleModelResult, { ...openSetContext, catalogContext, vectorContext });

  const completedResult = await withEvidenceCompletion(mergedResult, initialPayload, { timingContext, visualFeatures: vectorContext.visualFeatures, providerOptions });
  return withOpenSetReadiness(completedResult, { ...openSetContext, catalogContext, vectorContext });
}

function requestedProviderFromPayload(payload = {}) {
  return payload.provider || payload.provider_id || payload.visionProvider || payload.vision_provider || "";
}

function explicitEmergencyFromPayload(payload = {}) {
  return payload.explicitEmergency === true || payload.explicit_emergency === true;
}

export const __listingCopilotTitleTestHooks = {
  applyOpenSetAssistShadowPresentationGuard,
  boundedPayloadImagesFromImages,
  buildExactAnchorFastLaneShadow,
  catalogCandidateHasStrongAnchor,
  catalogStrongCandidateForVectorLazy,
  configuredMaxPayloadImages,
  narrowSurfaceColorFromOpenSetParallel,
  openSetAssistShadowGuardReason,
  shouldSkipVectorForCatalogContext
};

async function createProviderTitle(payload, {
  recognitionEvidenceDocument = null,
  signedImages = null,
  timingContext = null,
  visualFeatures = {}
} = {}) {
  const requestedProvider = requestedProviderFromPayload(payload);
  const explicitEmergency = explicitEmergencyFromPayload(payload);
  const primaryImages = primaryImagesFromImages(payload.images || []);

  if (!requestedProvider && !process.env.OPENAI_API_KEY) {
    return fallbackResult(payload);
  }

  const selection = selectVisionProvider({
    requestedProvider,
    explicitEmergency,
    images: primaryImages
  });

  return createOpenAiTitle(payload, selection, { recognitionEvidenceDocument, signedImages, timingContext, visualFeatures });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const authenticated = isValidSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET);

  if (!authenticated) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_title",
    limit: 30,
    windowMs: 60_000,
    message: "Too many title generation requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  const payloadImages = Array.isArray(payload.images) ? payload.images : [];
  const maxPayloadImages = configuredMaxPayloadImages(process.env);
  const imageBatch = boundedPayloadImagesFromImages(payloadImages, { maxImages: maxPayloadImages });
  if (!imageBatch.ok) {
    sendJson(res, 400, {
      ok: false,
      code: "invalid_image_payload",
      message: imageBatch.reason === "too_many_primary_images"
        ? "系统无法判断这组图片属于同一张卡还是多张卡，请使用单图或正反面配对模式重新上传。"
        : "系统没有读到可用于识别的卡片原图，请重新上传正面或正反面图片。"
    });
    return;
  }
  payload.images = imageBatch.images;
  if (imageBatch.deferred_image_count > 0) {
    payload.deferred_image_count = imageBatch.deferred_image_count;
    payload.image_batching = {
      mode: "bounded_current_batch",
      deferred_image_count: imageBatch.deferred_image_count
    };
  }

  const timingContext = createTimingContext(payload);

  try {
    const preProviderRescanResult = timeSync(timingContext, "image_quality_check_ms", () => createPreProviderRescanResult(payload));
    const [approvedMemoryResult, identityCacheResult] = await Promise.all([
      timeAsync(timingContext, "approved_memory_lookup_ms", () => createApprovedMemoryTitle(payload)),
      timeAsync(timingContext, "identity_cache_lookup_ms", () => createIdentityCacheTitle(payload))
    ]);

    if (approvedMemoryResult) {
      sendJson(res, 200, withTiming(approvedMemoryResult, timingContext));
      return;
    }

    if (identityCacheResult) {
      sendJson(res, 200, withTiming(identityCacheResult, timingContext));
      return;
    }

    if (preProviderRescanResult) {
      sendJson(res, 200, withTiming(preProviderRescanResult, timingContext));
      return;
    }

    const inFlightCacheKey = await createIdentityInFlightKey(payload);
    const result = await runWithInFlightIdentityRequest({
      cacheKey: inFlightCacheKey,
      run: async () => {
        const providerOptions = providerOptionsFromPayload(payload);
        const recognitionPreflight = await createRecognitionIdentityPreflight(payload, {
          timingContext,
          providerOptions
        });
        if (recognitionPreflight.result) {
          return timeAsync(timingContext, "identity_cache_write_ms", () => withIdentityCacheWrite(recognitionPreflight.result, payload));
        }
        const recognitionVisualFeatures = recognitionPreflight.response?.visual_features
          || recognitionPreflight.evidenceDocument?.recognition?.visual_features
          || {};
        const storedVisualFeatures = evidenceCompletionEnabled(process.env, providerOptions)
          && storedVisualFeatureLookupEnabled(process.env, providerOptions)
          && !hasUsableVisualFeatures(recognitionVisualFeatures)
          ? await timeAsync(timingContext, "stored_visual_feature_lookup_ms", () => lookupStoredVisualFeaturesForImages({
            images: payload.images || [],
            env: process.env
          }))
          : {};
        const visualFeatures = hasUsableVisualFeatures(recognitionVisualFeatures)
          ? recognitionVisualFeatures
          : storedVisualFeatures;

        const providerResult = await createProviderTitle(payload, {
          recognitionEvidenceDocument: recognitionPreflight.evidenceDocument,
          signedImages: recognitionPreflight.signedImages,
          timingContext,
          visualFeatures
        });

        return timeAsync(timingContext, "identity_cache_write_ms", () => withIdentityCacheWrite(providerResult, payload));
      }
    });

    sendJson(res, 200, withTiming(result, timingContext));
  } catch (error) {
    const message = safeProviderErrorMessage(error);

    sendJson(res, 200, withTiming({
      title: "",
      confidence: "FAILED",
      reason: message,
      fields: defaultFields,
      unresolved: ["api"],
      capture_profile_id: payload.captureProfileId || payload.capture_profile_id || defaultCaptureProfileId,
      capture_quality: captureQualityForPayload(payload),
      source: "error",
      provider: error.provider || requestedProviderFromPayload(payload) || null,
      provider_error_code: error.code || "api_error",
      provider_error_type: error.code || "api_error",
      provider_error_details: safeProviderDiagnostics(error.details),
      provider_token_diagnostics: error.details?.token_diagnostics || null,
      provider_initial_token_diagnostics: error.details?.initial_token_diagnostics || null,
      provider_truncation_retry_attempted: error.details?.truncation_retry_attempted === true,
      provider_truncation_retry_attempts: Number(error.details?.truncation_retry_attempts || 0)
    }, timingContext));
  }
}
