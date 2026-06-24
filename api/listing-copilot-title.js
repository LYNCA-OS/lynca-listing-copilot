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
import { analyzeCardEvidenceWithAgnes } from "../lib/listing/providers/agnes-provider.mjs";
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
import { completionActions } from "../lib/listing/orchestration/next-best-action.mjs";
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
  brand: null,
  product: null,
  multi_card: false,
  card_count: null,
  lot_type: null,
  set: null,
  subset: null,
  insert: null,
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
  return /^(true|yes|y|1|rc|rc logo|rookie|rookie card|rookie logo|rookie ticket|rated rookie|1st bowman|first bowman|auto|autograph|ssp|case hit|patch|relic|sketch|redemption|1\/1)$/i.test(normalizeStringOrNull(value) || "");
}

function normalizeStringOrNull(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizePositiveIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function normalizeFields(fields = {}) {
  const cardCount = normalizePositiveIntegerOrNull(fields.card_count ?? fields.cardCount);
  const players = Array.isArray(fields.players)
    ? fields.players.map(normalizeStringOrNull).filter(Boolean)
    : [];
  const normalized = {
    year: normalizeStringOrNull(fields.year),
    brand: normalizeStringOrNull(fields.brand),
    product: normalizeStringOrNull(fields.product),
    multi_card: normalizeBoolean(fields.multi_card ?? fields.multiCard) || Number(cardCount || 0) > 1,
    card_count: cardCount,
    lot_type: normalizeStringOrNull(fields.lot_type ?? fields.lotType),
    set: normalizeStringOrNull(fields.set),
    subset: normalizeStringOrNull(normalizeRookieMarker(fields.subset)),
    insert: normalizeStringOrNull(fields.insert),
    parallel: normalizeStringOrNull(fields.parallel),
    variation: normalizeStringOrNull(fields.variation),
    player: normalizeStringOrNull(fields.player) || players.join(" / ") || null,
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
    rc: normalizeBoolean(fields.rc),
    first_bowman: normalizeBoolean(fields.first_bowman),
    ssp: normalizeBoolean(fields.ssp),
    case_hit: normalizeBoolean(fields.case_hit),
    auto: normalizeBoolean(fields.auto),
    relic: normalizeBoolean(fields.relic),
    patch: normalizeBoolean(fields.patch),
    sketch: normalizeBoolean(fields.sketch),
    redemption: normalizeBoolean(fields.redemption),
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
  }

  if (/duo logoman|dual rookie logoman/i.test(`${normalized.insert || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Duo Logoman Autographs";
    normalized.auto = true;
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
    "visible",
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
  if (!textMentionsAny(combined, ["visual", "visible", "looks", "appears", "inferred", "likely", "guess"]) && hasComplexVisualParallelRisk(fields.parallel)) {
    return !hasStrongEvidence(reasonText);
  }
  return textMentionsAny(combined, ["visual", "visible", "looks", "appears", "inferred", "likely", "guess"])
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

function auditMissingReviewFields(title, fields) {
  const titleText = searchable(title);
  const missing = [];

  if (fields.parallel && !titleIncludes(titleText, fields.parallel)) {
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

  const missingReviewFields = auditMissingReviewFields(title, fields);
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
    images: primaryImagesFromImages(payload.images || [])
  };
}

const focusedRegionsByAction = Object.freeze({
  [completionActions.CROP_AND_READ_SUBJECT]: ["subject_name"],
  [completionActions.CROP_AND_READ_SERIAL]: ["serial_number"],
  [completionActions.CROP_AND_READ_CARD_CODE]: ["collector_number", "checklist_code"],
  [completionActions.CROP_AND_READ_GRADE_LABEL]: ["grade_label"],
  [completionActions.CROP_AND_READ_YEAR_PRODUCT]: ["year_product"],
  [completionActions.CROP_AND_READ_PARALLEL]: ["parallel", "variation", "color"]
});

function focusedImagesForAction(images = [], action, focusFields = []) {
  const targetRegions = new Set([
    ...(focusedRegionsByAction[action] || []),
    ...focusFields
  ]);
  const derivedMatches = derivedImagesFromImages(images).filter((image) => {
    const sourceRegion = image.sourceRegion || image.source_region || "";
    const storageRole = image.storageRole || image.storage_role || "";
    return targetRegions.has(sourceRegion)
      || targetRegions.has(storageRole)
      || [...targetRegions].some((field) => storageRole.includes(field.replace(/_number$|_code$/, "")));
  });

  if (derivedMatches.length) return derivedMatches.slice(0, 2);
  return primaryImagesFromImages(images).slice(0, 2);
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
      return metadata.objectPath;
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

  return metadata.objectPath;
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

function focusedRereadPrompt({
  action,
  focusFields = [],
  resolved = {}
} = {}) {
  return [
    "You are performing a focused reread for LYNCA Listing Copilot.",
    "Use only the supplied card image or crop. Do not infer facts from style, marketplace wording, or memory.",
    "If the image contains multiple cards or a card lot, set multi_card true, include card_count when visible, and do not merge fields from different cards.",
    "For RC, return true when a readable RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, slab text, or card-code-backed rookie marker is visible.",
    "For parallel and variation, return a value when printed card text, slab label, card code/checklist clue, or a high-confidence intentional card-design color/pattern is visible.",
    "When returning a visual card-design color/parallel, use concise marketplace-safe wording such as Gold Refractor, Purple, Blue Prizm, Green Wave, Silver Prizm, or Red Ice. Do not use background, sleeve, glare, lighting, or generic foil shine.",
    "If color or foil is only a weak visual impression, leave parallel/variation empty and add an unresolved note such as visual-only parallel requires operator review.",
    `Action: ${action || "focused_reread"}.`,
    `Focus fields: ${focusFields.join(", ") || "unresolved critical fields"}.`,
    "Return only valid JSON with this shape:",
    JSON.stringify({
      title: "",
      confidence: "HIGH | MEDIUM | LOW | FAILED",
      fields: {
        multi_card: false,
        card_count: null,
        lot_type: null,
        ...Object.fromEntries(focusFields.map((field) => [field, ""]))
      },
      unresolved: []
    }),
    "If a focus field is unreadable, leave it empty and explain that field in unresolved.",
    "Current resolved context for disambiguation only:",
    JSON.stringify(resolved)
  ].join("\n");
}

function fastInitialRecognitionPrompt(payload, maxTitleLength) {
  return [
    "You are the first-pass card evidence reader for LYNCA Listing Copilot.",
    "Use only the supplied card/slab images. Do not use marketplace wording, memory, or outside knowledge.",
    "Return compact valid JSON only. Do not write Markdown.",
    "Goal: extract grounded identity evidence; deterministic code will render the English title.",
    "Leave any unreadable or uncertain high-risk field empty.",
    "Serial rule: every digit must be readable; otherwise serial_number must be empty.",
    "Parallel/color rule: use printed/slab/checklist evidence or unmistakable intentional card-design color only; weak visual color stays empty.",
    "Multi-card rule: if more than one card or a lot is visible, set multi_card true and do not merge identities.",
    `Runtime title limit downstream: ${maxTitleLength} characters.`,
    "Return this shape:",
    JSON.stringify({
      title: "",
      confidence: "HIGH | MEDIUM | LOW | FAILED",
      route: "FAST_PATH_CANDIDATE | NEEDS_REVIEW | MULTI_CARD",
      fields: {
        multi_card: false,
        card_count: null,
        lot_type: null,
        year: "",
        manufacturer: "",
        product: "",
        set: "",
        players: [],
        card_type: "",
        insert: "",
        parallel: "",
        serial_number: "",
        collector_number: "",
        checklist_code: "",
        grade_company: "",
        card_grade: "",
        auto_grade: "",
        grade_type: "",
        rc: false,
        first_bowman: false,
        ssp: false,
        case_hit: false,
        auto: false,
        patch: false,
        relic: false
      },
      unresolved: []
    }),
    "Asset context:",
    JSON.stringify({
      assetId: payload.assetId || null,
      mode: payload.mode || null,
      imageCount: payload.images.length,
      fileNames: payload.images.map((image) => image.name).filter(Boolean).slice(0, 2)
    })
  ].join("\n");
}

async function buildListingPrompt(payload, maxTitleLength) {
  const intelligencePrompt = await loadPrompt();

  return [
    intelligencePrompt,
    `Runtime title limit: ${maxTitleLength} characters.`,
    "Return only valid JSON. Do not wrap the response in Markdown.",
    "If the image contains multiple cards or a card lot, set fields.multi_card true, include fields.card_count when visible, describe fields.lot_type, and do not merge identities across cards.",
    "Do not infer RC, 1st Bowman, SSP, case hit, parallel, or variation from seller style or generic foil color. Use RC only for readable RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, slab text, or card-code-backed rookie marker. For parallel/variation, use printed text, slab/checklist support, or clearly intentional high-confidence card-design color/pattern only; weak visual color impressions must stay empty with uncertainty in unresolved.",
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
    JSON.stringify({
      title: "",
      confidence: "HIGH | MEDIUM | LOW | FAILED",
      reason: "",
      fields: defaultFields,
      unresolved: []
    })
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
    source,
    _pre_title_audit: preTitleAudit
  };
}

function withEvidenceCompatibility(result, providerPayload, payload) {
  const { _pre_title_audit: preTitleAudit, ...publicResult } = result;
  const payloadForEvidence = {
    ...providerPayload,
    title: providerPayload.title || result.model_title_suggestion || result.title,
    confidence: preTitleAudit?.confidence || providerPayload.confidence || publicResult.confidence,
    fields: publicResult.fields,
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
    resolved: evidenceDocument.resolved,
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy,
    resolution_trace: evidenceDocument.resolution_trace || [],
    model_title_suggestion: evidenceDocument.model_title_suggestion,
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
    usage: providerResult.usage || null,
    explicit_emergency: Boolean(selection?.explicit_emergency)
  };
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
    resolved,
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy
  };
}

function retrievalCandidatesForIdentity(completion = {}) {
  const retrieval = completion.retrieval || {};
  return retrieval.selected_candidate ? [retrieval.selected_candidate] : [];
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

function createAgnesFocusedRereadRunner({
  images = [],
  maxTitleLength = maxFallbackTitleLength,
  env = process.env,
  timingContext = null
} = {}) {
  return async ({ action, focusFields = [], resolved = {} } = {}) => {
    const rereadImages = focusedImagesForAction(images, action, focusFields);
    if (!rereadImages.length) {
      return {
        provider_id: visionProviderIds.AGNES,
        model_id: defaultProviderModels[visionProviderIds.AGNES],
        resolved: {},
        evidence: {},
        unresolved: ["focused reread image unavailable"]
      };
    }

    const providerResult = await timeAsync(timingContext, "focused_reread_ms", () => runTimedProviderCall(
      visionProviderIds.AGNES,
      timingContext,
      () => analyzeCardEvidenceWithAgnes({
        images: rereadImages,
        prompt: focusedRereadPrompt({ action, focusFields, resolved }),
        env
      })
    ));
    const normalized = normalizeAiResult(providerResult.parsed, maxTitleLength, visionProviderIds.AGNES);
    const evidenceDocument = providerPayloadToEvidenceDocument({
      ...providerResult.parsed,
      title: providerResult.parsed.title || normalized.model_title_suggestion || "",
      confidence: normalized.confidence,
      fields: normalized.fields,
      unresolved: Array.isArray(providerResult.parsed.unresolved)
        ? providerResult.parsed.unresolved
        : normalized.unresolved
    }, {
      images: rereadImages
    });

    return {
      provider_id: providerResult.provider || visionProviderIds.AGNES,
      model_id: providerResult.model_id || defaultProviderModels[visionProviderIds.AGNES],
      response_id: providerResult.response_id || null,
      finish_reason: providerResult.finish_reason || null,
      parse_source: providerResult.parse_source || null,
      usage: providerResult.usage || null,
      evidence_document: evidenceDocument,
      resolved: evidenceDocument.resolved,
      evidence: evidenceDocument.evidence,
      unresolved: evidenceDocument.unresolved || []
    };
  };
}

function textIncludesAny(value, terms = []) {
  const text = searchable(value);
  return terms.some((term) => text.includes(searchable(term)));
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function cascadeSecondaryVerifierEnv(env = process.env, verificationFields = []) {
  return {
    ...env,
    AGNES_TIMEOUT_MS: env.AGNES_SECONDARY_TIMEOUT_MS || env.AGNES_FOCUSED_TIMEOUT_MS || "12000",
    AGNES_MAX_RETRIES: env.AGNES_SECONDARY_MAX_RETRIES || "0",
    ENABLE_PARALLEL_FOCUSED_REREADS: "1",
    ENABLE_PARALLEL_AGNES_FOCUSED_REREADS: "1",
    CASCADE_SECONDARY_VERIFICATION_FIELDS: verificationFields.join(","),
    MAX_PARALLEL_FOCUSED_REREADS: env.CASCADE_MAX_PARALLEL_FOCUSED_REREADS || "2",
    MAX_AGNES_CALLS_PER_ASSET: env.CASCADE_MAX_AGNES_CALLS_PER_ASSET || "2",
    MAX_RESOLUTION_TIME_MS: env.CASCADE_MAX_RESOLUTION_TIME_MS || "16000"
  };
}

function cascadeSecondaryVerificationFields(result = {}) {
  const resolved = result.resolved || {};
  const unresolvedText = [
    result.reason,
    result.route_reason,
    ...(Array.isArray(result.unresolved) ? result.unresolved : [])
  ].filter(Boolean).join(" ");
  const fields = new Set();

  if (resolved.multi_card || Number(resolved.card_count || 0) > 1) return [];

  if (hasEvidenceValue(resolved.serial_number)
    || textIncludesAny(unresolvedText, ["serial", "serial number", "numbered", "denominator"])) {
    fields.add("serial_number");
  }

  if (hasEvidenceValue(resolved.parallel)
    || hasEvidenceValue(resolved.parallel_exact)
    || hasEvidenceValue(resolved.parallel_family)
    || hasEvidenceValue(resolved.surface_color)
    || hasEvidenceValue(resolved.variation)
    || textIncludesAny(unresolvedText, ["parallel", "color", "wave", "shimmer", "mojo", "sapphire", "geometric", "refractor"])) {
    fields.add("parallel");
  }

  if (!hasEvidenceValue(resolved.year)
    || !hasEvidenceValue(resolved.product)
    || textIncludesAny(unresolvedText, ["year", "season", "copyright", "product"])) {
    fields.add("year_product");
  }

  if (textIncludesAny(unresolvedText, ["grade", "slab", "label"])) {
    fields.add("grade_label");
  }

  if (textIncludesAny(unresolvedText, ["collector number", "checklist", "card number", "code"])) {
    fields.add("card_code");
  }

  return [...fields];
}

function cascadeVerificationUnresolvedNotes(fields = []) {
  const notesByField = {
    serial_number: "serial number requires secondary verifier focused reread",
    parallel: "parallel color requires secondary verifier focused reread",
    year_product: "year product requires secondary verifier focused reread",
    grade_label: "grade label requires secondary verifier focused reread",
    card_code: "card number checklist code requires secondary verifier focused reread"
  };

  return fields.map((field) => notesByField[field]).filter(Boolean);
}

function withCascadePolicy(result = {}, verificationFields = [], {
  secondaryAvailable = true,
  secondaryDisabledReason = null
} = {}) {
  return {
    ...result,
    provider: visionProviderIds.CASCADE_FAST,
    source: visionProviderIds.OPENAI_LEGACY,
    identity_provider_id: "primary_fast_vision",
    provider_label: providerLabels[visionProviderIds.CASCADE_FAST],
    model_id: `${result.model_id || defaultProviderModels[visionProviderIds.OPENAI_LEGACY]} + ${defaultProviderModels[visionProviderIds.AGNES]}`,
    cascade: {
      enabled: true,
      role: "PRIMARY_FAST_VISION",
      primary_provider_id: visionProviderIds.OPENAI_LEGACY,
      secondary_provider_id: visionProviderIds.AGNES,
      secondary_verification_available: secondaryAvailable,
      secondary_disabled_reason: secondaryDisabledReason,
      secondary_verification_required_fields: verificationFields,
      secondary_verification_required: verificationFields.length > 0
    },
    fast_vision_policy: {
      role: "PRIMARY_FAST_VISION",
      allow_single_source_publish: true,
      secondary_verification_required_fields: verificationFields
    },
    unresolved: uniqueValues([
      ...(Array.isArray(result.unresolved) ? result.unresolved : []),
      ...cascadeVerificationUnresolvedNotes(verificationFields),
      ...(verificationFields.length && !secondaryAvailable
        ? [`secondary verifier unavailable: ${secondaryDisabledReason || "agnes_not_configured"}`]
        : [])
    ])
  };
}

async function withEvidenceCompletion(result, payload, {
  runFocusedVisionImpl = null,
  env = process.env,
  timingContext = null
} = {}) {
  const retrievalMode = payload.retrievalMode || payload.retrieval_mode || process.env.RETRIEVAL_MODE;
  const completion = await timeAsync(timingContext, "evidence_completion_ms", () => completeEvidence({
    resolved: result.resolved,
    evidence: result.evidence,
    captureQuality: result.capture_quality || captureQualityForPayload(payload),
    unresolved: result.unresolved,
    retrievalMode,
    env,
    runFocusedVisionImpl
  }));
  addTiming(timingContext, "retrieval_ms", Number(completion.retrieval?.latency_ms || completion.retrieval?.retrieval_time_ms || 0));
  addTiming(timingContext, "focused_reread_ms", Number(completion.usage?.provider_calls || 0) > 0 ? Number(completion.usage?.latency_ms || 0) : 0);
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
    retrievalCandidates: retrievalCandidatesForIdentity(completion),
    retrieveEvidence: createIdentityConvergenceRetriever({
      retrievalMode
    }),
    convergenceOptions: {
      maxIterations: 1
    }
  }));
}

async function imagesWithSignedReadUrls(images = [], timingContext = null) {
  return timeAsync(timingContext, "signed_url_ms", () => mapWithConcurrency(images, signedUrlConcurrency, async (image) => {
    const objectPath = await assertVerifiedStorageImage(image);
    if (!objectPath) return image;

    return {
      ...image,
      signedUrl: await createListingImageSignedReadUrl({ objectPath }),
      signed_url: undefined
    };
  }));
}

async function createRecognitionIdentityPreflight(payload, {
  timingContext = null
} = {}) {
  const config = recognitionWorkerConfig();
  if (!config.enabled || !config.configured) {
    return {
      result: null,
      evidenceDocument: null,
      response: null,
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
        run_visual_embeddings: false,
        run_candidate_verification: false
      }
    }));
    const evidenceDocument = recognitionResponseToEvidenceDocument(response, {
      images: signedImages
    });

    if (!hasRecognitionEvidence(evidenceDocument)) {
      return {
        result: null,
        evidenceDocument,
        response
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
      route_reason: "Attempted local OCR/slab identity resolution before the vision cascade.",
      recognition_preflight: evidenceDocument.recognition || null,
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
      gated
    };
  } catch (error) {
    return {
      result: null,
      evidenceDocument: null,
      error: safeRecognitionError(error)
    };
  }
}

async function createAgnesTitle(payload, selection, {
  recognitionEvidenceDocument = null,
  timingContext = null
} = {}) {
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const signedImages = await imagesWithSignedReadUrls(payload.images, timingContext);
  const initialPayload = {
    ...payload,
    images: primaryImagesFromImages(signedImages)
  };
  const prompt = await buildInitialProviderPrompt(initialPayload, maxTitleLength);
  const providerResult = await runTimedProviderCall(visionProviderIds.AGNES, timingContext, () => analyzeCardEvidenceWithAgnes({
    images: initialPayload.images,
    prompt
  }));

  const providerResultWithEvidence = timeSync(timingContext, "renderer_ms", () => withProviderMetadata(
      withEvidenceCompatibility(
        withRequestMetadata(normalizeAiResult(providerResult.parsed, maxTitleLength, visionProviderIds.AGNES), initialPayload),
        providerResult.parsed,
        initialPayload
      ),
      providerResult,
      selection
    ));
  const mergedResult = withRecognitionEvidence(providerResultWithEvidence, recognitionEvidenceDocument, initialPayload);
  const fastPathResult = timeSync(timingContext, "resolver_ms", () => tryProviderFastPath(mergedResult, initialPayload, visionProviderIds.AGNES));
  if (fastPathResult) return fastPathResult;

  return withEvidenceCompletion(mergedResult, {
    ...payload,
    images: signedImages
  }, {
    runFocusedVisionImpl: createAgnesFocusedRereadRunner({
      images: signedImages,
      maxTitleLength,
      timingContext
    }),
    timingContext
  });
}

async function createOpenAiTitle(payload, selection, {
  recognitionEvidenceDocument = null,
  timingContext = null
} = {}) {
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const signedImages = await imagesWithSignedReadUrls(payload.images || [], timingContext);
  const initialPayload = primaryPayloadForProvider({
    ...payload,
    images: signedImages
  });
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
  const mergedResult = withRecognitionEvidence(providerResultWithEvidence, recognitionEvidenceDocument, initialPayload);
  const fastPathResult = timeSync(timingContext, "resolver_ms", () => tryProviderFastPath(mergedResult, initialPayload, visionProviderIds.OPENAI_LEGACY));
  if (fastPathResult) return fastPathResult;

  return withEvidenceCompletion(mergedResult, initialPayload, { timingContext });
}

async function createCascadeFastTitle(payload, selection, {
  recognitionEvidenceDocument = null,
  timingContext = null
} = {}) {
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const signedImages = await imagesWithSignedReadUrls(payload.images || [], timingContext);
  const initialPayload = primaryPayloadForProvider({
    ...payload,
    images: signedImages
  });
  const prompt = await buildInitialProviderPrompt(initialPayload, maxTitleLength);
  const primaryResult = await runTimedProviderCall(visionProviderIds.OPENAI_LEGACY, timingContext, () => analyzeCardEvidenceWithOpenAiEmergency({
    images: initialPayload.images,
    prompt
  }));

  const primaryWithEvidence = timeSync(timingContext, "renderer_ms", () => withProviderMetadata(
      withEvidenceCompatibility(
        withRequestMetadata(normalizeAiResult(primaryResult.parsed, maxTitleLength, visionProviderIds.OPENAI_LEGACY), initialPayload),
        primaryResult.parsed,
        initialPayload
      ),
      primaryResult,
      {
        ...selection,
        provider_id: visionProviderIds.OPENAI_LEGACY,
        explicit_emergency: false
      }
    ));
  const mergedResult = withRecognitionEvidence(primaryWithEvidence, recognitionEvidenceDocument, initialPayload);
  const verificationFields = cascadeSecondaryVerificationFields(mergedResult);
  const secondaryAvailable = selection.provider?.secondary_configured === true;
  const cascadeResult = withCascadePolicy(mergedResult, verificationFields, {
    secondaryAvailable,
    secondaryDisabledReason: selection.provider?.secondary_disabled_reason || null
  });
  const secondaryEnv = cascadeSecondaryVerifierEnv(process.env, verificationFields);

  return withEvidenceCompletion(cascadeResult, {
    ...payload,
    images: signedImages
  }, {
    runFocusedVisionImpl: verificationFields.length && secondaryAvailable
      ? createAgnesFocusedRereadRunner({
          images: signedImages,
          maxTitleLength,
          env: secondaryEnv,
          timingContext
        })
      : null,
    env: secondaryEnv,
    timingContext
  });
}

function requestedProviderFromPayload(payload = {}) {
  return payload.provider || payload.provider_id || payload.visionProvider || payload.vision_provider || "";
}

function explicitEmergencyFromPayload(payload = {}) {
  return payload.explicitEmergency === true || payload.explicit_emergency === true;
}

async function createProviderTitle(payload, {
  recognitionEvidenceDocument = null,
  timingContext = null
} = {}) {
  const requestedProvider = requestedProviderFromPayload(payload);
  const explicitEmergency = explicitEmergencyFromPayload(payload);
  const primaryImages = primaryImagesFromImages(payload.images || []);

  if (!requestedProvider && !process.env.AGNES_API_KEY && !process.env.OPENAI_API_KEY) {
    return fallbackResult(payload);
  }

  const selection = selectVisionProvider({
    requestedProvider,
    explicitEmergency,
    images: primaryImages
  });

  if (selection.provider_id === visionProviderIds.CASCADE_FAST) {
    return createCascadeFastTitle(payload, selection, { recognitionEvidenceDocument, timingContext });
  }

  if (selection.provider_id === visionProviderIds.AGNES) {
    return createAgnesTitle(payload, selection, { recognitionEvidenceDocument, timingContext });
  }

  return createOpenAiTitle(payload, selection, { recognitionEvidenceDocument, timingContext });
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
        const recognitionPreflight = await createRecognitionIdentityPreflight(payload, { timingContext });
        if (recognitionPreflight.result) {
          return timeAsync(timingContext, "identity_cache_write_ms", () => withIdentityCacheWrite(recognitionPreflight.result, payload));
        }

        const providerResult = await createProviderTitle(payload, {
          recognitionEvidenceDocument: recognitionPreflight.evidenceDocument,
          timingContext
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
      provider_error_code: error.code || "api_error"
    }, timingContext));
  }
}
