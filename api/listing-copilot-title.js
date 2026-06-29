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
import { completeEvidence } from "../lib/listing/orchestration/evidence-completion-orchestrator.mjs";
import { createIdentityConvergenceRetriever } from "../lib/listing/orchestration/identity-convergence-retriever.mjs";
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

const cookieName = "lynca_metaverse_session";
const maxFallbackTitleLength = 80;
const maxPayloadImages = 10;
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

function envFlag(env, key, fallback = true) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

function providerOptionsFromPayload(payload = {}) {
  const options = payload.provider_options || payload.providerOptions || {};
  return options && typeof options === "object" && !Array.isArray(options) ? options : {};
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
  return {
    ...result,
    timing: finalizeTiming(timingContext, result)
  };
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
    sportsTitleShouldRecoverSerial(fields, title) ? normalizeSerialText(fields.serial_number) : null,
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
  const serial = normalizeSerialText(fields.serial_number || "");
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
  return Boolean(fields.serial_number && rawIncludes(normalizeSerialText(title), normalizeSerialText(fields.serial_number)));
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

  if (fields.serial_number && !titleText.includes(searchable(fields.serial_number))) {
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
    titleIncludesSerial(rawTitle, fields) ? normalizeSerialText(fields.serial_number) : null,
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
    "Use this shared field module order: Year -> Franchise/Brand -> Product/Set -> Subject -> Card Type -> Variant/Parallel/Rarity -> Number/Serial/Grade.",
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
    "- Core/high-risk evidence fields include year, product, set, players, official_card_type, observable_components, insert, surface_color, parallel_exact, serial_number, collector_number, checklist_code, grade, rc, auto, patch, relic, jersey, sketch, and redemption.",
    "- official_card_type must stay empty unless official wording is printed on the card/slab or supplied by trusted catalog/reviewed input. Never infer Base from visual context.",
    "- observable_components may include only directly visible components: auto, patch, relic, jersey, rc, sketch, redemption.",
    "- year: include field_evidence.year with value, support_type, visible_text, confidence, and review_required. Use support_type SLAB_LABEL, CARD_BACK_PRINTED_TEXT, CARD_FRONT_PRINTED_TEXT, VISION_ONLY, or NONE.",
    "- grade: include field_evidence.grade only when a slab label directly shows grade. Fill grade_company, card_grade, auto_grade, grade_type, support_type SLAB_LABEL, visible_text, confidence, review_required false. If grade is only guessed, leave grade fields empty.",
    "- rc: fields.rc may be true only with a visible RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, or slab/card text. Also include field_evidence.rc with value true, support_type, evidence_kind, visible_text, visible_marker, confidence.",
    "- auto: fields.auto may be true only with visible Auto/Autograph/Signature/Signed text or an actual visible signature. Also include field_evidence.auto with value true, support_type, evidence_kind, visible_text, signature_visible or text_visible, confidence.",
    "- If year is visible but only from visual model reading, still return fields.year and field_evidence.year.support_type VISION_ONLY; Gate will leave it for writer review.",
    "If readable slab/card text exists but you leave year, product, or players empty, add a short unresolved note naming the missing field and image region. Do not transcribe long text, legal lines, copyright lines, or repeated boilerplate.",
    "Serial rule: every digit must be readable; otherwise serial_number must be empty.",
    "Parallel/color rule: first-version output is color-first. Put visible Gold/Purple/Red/Blue/Green/Silver/Black/Orange only in surface_color. Leave parallel_exact empty unless exact wording is printed/slab/catalog-supported; do not infer Refractor/Wave/Shimmer/Mojo/Prizm/Sparkle/Holo from appearance alone.",
    "Multi-card rule: if more than one card or a lot is visible, set multi_card true and do not merge identities.",
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
      players: [],
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
      multi_card: false
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
    "If the image contains multiple cards or a card lot, set fields.multi_card true, include fields.card_count when visible, describe fields.lot_type, and do not merge identities across cards.",
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
  const calibrationBase = preTitleAudit || {
    confidence: publicResult.confidence,
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
  if (status === "approved") return true;
  const evalCorrectedTitleGt = optionFlag(providerOptions, "corrected_title_as_temporary_gt", false) === true;
  return evalCorrectedTitleGt
    && candidate.field_derivation?.corrected_title_used === true
    && String(candidate.reference_metadata?.source_status || "").toUpperCase() === "AUTO_PARSED_FROM_VERIFIED_TITLE";
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

  const allowedFamilies = catalogRetrievalFamilies();
  const retrieval = await timeAsync(timingContext, "catalog_retrieval_ms", () => runRetrieval({
    resolved: resolvedForRetrieval || {},
    visualEmbeddings: [],
    mode: retrievalModes.INTERNAL_ONLY,
    allowedFamilies,
    maxQueries: allowedFamilies.length,
    env
  }));
  const packet = buildVectorCandidatePacket(retrieval, {
    limit: 5,
    queryFields: resolvedForRetrieval || {}
  });
  const assistEligibility = vectorCandidatePacketAssistEligibility(packet);
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  return {
    retrieval,
    packet,
    assistPacket,
    catalog_assist_eligibility: assistEligibility,
    promptPacket: assistEligibility.prompt_candidate_count > 0
  };
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
  return {
    ...result,
    catalog_retrieval: context.retrieval || null,
    catalog_candidate_packet: context.packet,
    catalog_assist_packet: context.assistPacket || null,
    catalog_prompt_assist_used: context.promptPacket === true,
    catalog_assist_eligibility: context.catalog_assist_eligibility || null
  };
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
  return summaries.flatMap((summary) => Array.isArray(summary.sources) ? summary.sources : []);
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

function retrievalSourceMatchedFields(source = {}) {
  return [...new Set([
    ...(Array.isArray(source.matched_fields) ? source.matched_fields : []),
    ...(Array.isArray(source.supporting_fields) ? source.supporting_fields : [])
  ].map((field) => String(field || "").toLowerCase()).filter(Boolean))];
}

function retrievalSourceHasStrongTitleSupport(source = {}) {
  const matched = new Set(retrievalSourceMatchedFields(source));
  const exactEvidence = ["collector_number", "checklist_code", "card_number", "serial_number"].some((field) => matched.has(field));
  if (exactEvidence) {
    return ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
      .some((field) => matched.has(field));
  }
  const identityEvidenceCount = ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
    .filter((field) => matched.has(field)).length;
  return identityEvidenceCount >= 3 && Number(source.match_score || source.normalized_score || 0) >= 0.35;
}

function retrievalSourceHasExactIdentityAnchor(source = {}) {
  const matched = new Set(retrievalSourceMatchedFields(source));
  const exactEvidence = ["collector_number", "checklist_code", "card_number", "serial_number"].some((field) => matched.has(field));
  const identityEvidence = ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
    .some((field) => matched.has(field));
  return exactEvidence && identityEvidence;
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
  const exactAnchor = retrievalSourceHasExactIdentityAnchor(source);
  if (sourceFields.year && normalizedCurrent.year && !yearsCompatibleForTitleAssist(sourceFields.year, normalizedCurrent.year)) return false;
  if (!exactAnchor && sourceFields.brand && normalizedCurrent.brand && !compatibleTextField(sourceFields.brand, normalizedCurrent.brand)) return false;
  if (!exactAnchor && sourceFields.product && normalizedCurrent.product && !compatibleTextField(sourceFields.product, normalizedCurrent.product)) return false;

  const sourceSubjects = currentSubjectTokens(sourceFields);
  const currentSubjects = currentSubjectTokens(normalizedCurrent);
  if (sourceSubjects.length && currentSubjects.length && !sourceSubjects.some((left) => currentSubjects.some((right) => compatibleTextField(left, right)))) {
    return false;
  }

  const currentDenominator = serialDenominatorForTitleAssist(normalizedCurrent.serial_number || currentTitle);
  const sourceDenominator = serialDenominatorForTitleAssist(sourceFields.serial_number || source.title);
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

function appendCurrentInstanceTerms(title, currentFields = {}, currentTitle = "") {
  let output = String(title || "").replace(/\s+/g, " ").trim();
  const serial = normalizeSerialText(currentFields.serial_number || "");
  if (/\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(serial) && !titleIncludesSerial(output, { serial_number: serial })) {
    output = `${output} ${serial}`.trim();
  }
  const grade = gradeTokenFromCurrentTitle(currentTitle);
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
  const currentFields = result.resolved || result.resolved_fields || result.fields || {};
  const currentTitle = result.final_title || result.title || result.rendered_title || "";
  return retrievalSourcesFromCompletion(completion)
    .filter((source) => source.selected === true)
    .filter((source) => source.title || source.reference_title)
    .filter(retrievalSourceIsTrustedTitleAssist)
    .filter((source) => !retrievalSourceHasDirectConflict(source))
    .filter(retrievalSourceHasStrongTitleSupport)
    .filter((source) => retrievalSourceCompatibleWithCurrent(source, currentFields, currentTitle))
    .sort((left, right) => {
      const leftExact = retrievalSourceMatchedFields(left).some((field) => /collector_number|checklist_code|card_number|serial_number/.test(field)) ? 1 : 0;
      const rightExact = retrievalSourceMatchedFields(right).some((field) => /collector_number|checklist_code|card_number|serial_number/.test(field)) ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      const leftOverlap = overlapTokenCount(left.title || left.reference_title, currentTitle);
      const rightOverlap = overlapTokenCount(right.title || right.reference_title, currentTitle);
      if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;
      return Number(right.match_score || right.normalized_score || 0) - Number(left.match_score || left.normalized_score || 0);
    })[0] || null;
}

function applySafeRetrievalTitleAssist(draft = {}, result = {}, completion = {}, payload = {}) {
  const source = bestRetrievalTitleAssistSource(completion, result);
  if (!source) return draft;
  const currentFields = draft.resolved || draft.resolved_fields || draft.fields || result.resolved || result.fields || {};
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
      ...draft,
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
        ...(draft.fast_path || {}),
        assist_shadow_only: true,
        assist_shadow_retrieval_only: true,
        reason: "assist_shadow_no_prompt_safe_candidates"
      }
    };
  }
  addTiming(timingContext, "retrieval_ms", Number(completion.retrieval?.latency_ms || completion.retrieval?.retrieval_time_ms || 0));
  const assistedDraft = applySafeRetrievalTitleAssist(draft, result, completion, payload);

  return {
    ...assistedDraft,
    route: assistedDraft.route || "ASSIST_SHADOW_WRITER_DRAFT",
    route_reason: assistedDraft.retrieval_title_assist?.used
      ? "No prompt-safe catalog or vector candidates were available; selected approved retrieval evidence was used only as a stripped title scaffold without copying reference serial, grade, or cert values."
      : "No prompt-safe catalog or vector candidates were available; retrieval ran only for telemetry and did not alter the GPT draft.",
    retrieval: completion.retrieval || assistedDraft.retrieval,
    completion_state: {
      ...(completion.state || {}),
      shadow_only: true
    },
    completion_trace: [
      ...(Array.isArray(assistedDraft.completion_trace) ? assistedDraft.completion_trace : []),
      ...(Array.isArray(completion.resolution_trace) ? completion.resolution_trace : [])
    ],
    resolution_trace: [
      ...(Array.isArray(assistedDraft.resolution_trace) ? assistedDraft.resolution_trace : []),
      ...(Array.isArray(completion.resolution_trace) ? completion.resolution_trace : [])
    ],
    usage: mergeUsage(assistedDraft.usage, completion.usage, {
      providerCalls: result.provider ? 1 : 0
    }),
    fast_path: {
      ...(assistedDraft.fast_path || {}),
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

async function createOpenAiTitle(payload, selection, {
  recognitionEvidenceDocument = null,
  signedImages: reusableSignedImages = null,
  timingContext = null,
  visualFeatures = {}
} = {}) {
  const providerOptions = providerOptionsFromPayload(payload);
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const signedImages = Array.isArray(reusableSignedImages) && reusableSignedImages.length
    ? reusableSignedImages
    : await imagesWithSignedReadUrls(payload.images || [], timingContext);
  const baseInitialPayload = primaryPayloadForProvider({
    ...payload,
    images: signedImages
  });
  const resolvedForRetrieval = resolvedForRetrievalFromPayload(payload, providerOptions, recognitionEvidenceDocument);
  const catalogContext = await prepareCatalogCandidateContext({
    resolvedForRetrieval,
    providerOptions,
    timingContext
  });
  const vectorContext = await prepareVectorCandidateContext({
    initialPayload: baseInitialPayload,
    signedImages,
    visualFeatures,
    resolvedForRetrieval,
    providerOptions,
    timingContext
  });
  const promptCandidatePacket = vectorContext.promptPacket
    ? vectorContext.assistPacket
    : catalogContext.promptPacket
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
  if (fastPathResult) return fastPathResult;
  if (assistShadowOnly) {
    return withEvidenceCompletionShadow(mergedResult, initialPayload, {
      timingContext,
      visualFeatures: vectorContext.visualFeatures,
      providerOptions,
      providerId: visionProviderIds.OPENAI_LEGACY
    });
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
  if (singleModelResult) return singleModelResult;

  return withEvidenceCompletion(mergedResult, initialPayload, { timingContext, visualFeatures: vectorContext.visualFeatures, providerOptions });
}

function requestedProviderFromPayload(payload = {}) {
  return payload.provider || payload.provider_id || payload.visionProvider || payload.vision_provider || "";
}

function explicitEmergencyFromPayload(payload = {}) {
  return payload.explicitEmergency === true || payload.explicit_emergency === true;
}

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
  const primaryImages = explicitPrimaryImagesFromImages(payloadImages);
  if (payloadImages.length < 1 || payloadImages.length > maxPayloadImages || primaryImages.length < 1 || primaryImages.length > 2) {
    sendJson(res, 400, { ok: false, message: "Expected one or two primary card images, with optional bounded derived crop images." });
    return;
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
