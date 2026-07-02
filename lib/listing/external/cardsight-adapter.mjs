import { readFile } from "node:fs/promises";
import {
  allowedUsageForTrust,
  forbiddenUsageForTrust,
  externalMatchLevels,
  normalizeExternalCandidate,
  sourceTrustValues
} from "./external-candidate-contract.mjs";

export const cardsightProviderId = "cardsight";
export const cardsightSourceTrust = sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY;

export const cardsightAllowedUsage = Object.freeze(allowedUsageForTrust(cardsightSourceTrust));
export const cardsightForbiddenUsage = Object.freeze(forbiddenUsageForTrust(cardsightSourceTrust));

const defaultBaseUrl = "https://api.cardsight.ai";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function boundedTake(value) {
  return Math.max(1, Math.min(20, positiveInteger(value, 5)));
}

function apiKeyFromEnv(env = process.env) {
  return cleanText(env.CARDSIGHTAI_API_KEY || env.CARDSIGHT_API_KEY);
}

function baseUrlFromEnv(env = process.env) {
  return cleanText(env.CARDSIGHTAI_BASE_URL || env.CARDSIGHT_BASE_URL || defaultBaseUrl).replace(/\/+$/, "");
}

function timeoutMsFromEnv(env = process.env) {
  return positiveInteger(env.CARDSIGHTAI_TIMEOUT_MS || env.CARDSIGHT_TIMEOUT_MS, 30000);
}

function createCardsightError(message, code, status = null) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function cardsightErrorCode(status) {
  if (status === 408) return "cardsight_timeout";
  if (status === 429) return "cardsight_rate_limited";
  if (status === 401 || status === 403) return "cardsight_unauthorized";
  if (status >= 500) return "cardsight_server_error";
  return "cardsight_api_error";
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 30000) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller ? controller.signal : options.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createCardsightError("CardSight request timed out", "cardsight_timeout");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw_text: text };
  }
}

function appendQuery(url, params = {}) {
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
}

function cardObjectFromDetection(detection = {}) {
  return detection.card && typeof detection.card === "object" && !Array.isArray(detection.card)
    ? detection.card
    : {};
}

function matchLevelFromCard(card = {}) {
  if (cleanText(card.id)) return externalMatchLevels.EXACT_CARD;
  if (cleanText(card.setId || card.set_id)) return externalMatchLevels.SET_LEVEL;
  if (cleanText(card.releaseId || card.release_id)) return externalMatchLevels.PRODUCT_LEVEL;
  return externalMatchLevels.NO_MATCH;
}

function normalizeParallel(parallel = {}) {
  if (!parallel || typeof parallel !== "object" || Array.isArray(parallel)) return null;
  const numberedTo = parallel.numberedTo ?? parallel.numbered_to ?? parallel.numbered_to_value ?? null;
  const output = {
    id: cleanText(parallel.id || parallel.parallelId || parallel.parallel_id),
    name: cleanText(parallel.name || parallel.parallelName || parallel.parallel_name),
    description: cleanText(parallel.description),
    is_partial: parallel.isPartial ?? parallel.is_partial ?? null,
    numbered_to: numberedTo === null || numberedTo === undefined || numberedTo === "" ? null : Number(numberedTo)
  };
  return Object.values(output).some((value) => value !== null && value !== "") ? output : null;
}

function normalizeGrading(grading = {}) {
  if (!grading || typeof grading !== "object" || Array.isArray(grading)) return null;
  const output = {
    company: cleanText(grading.company || grading.companyName || grading.gradingCompany || grading.grading_company),
    grade: cleanText(grading.grade || grading.value || grading.gradeValue || grading.grade_value),
    qualifier: cleanText(grading.qualifier),
    condition: cleanText(grading.condition),
    cert_number_present: Boolean(grading.certNumber || grading.cert_number || grading.certificateNumber || grading.certificate_number),
    confidence: cleanText(grading.confidence)
  };
  return Object.values(output).some((value) => value !== null && value !== "" && value !== false) ? output : null;
}

function fieldsFromCard(card = {}) {
  const name = cleanText(card.name || card.cardName || card.subject || card.player);
  const parallel = normalizeParallel(card.parallel);
  const number = cleanText(card.number || card.cardNumber || card.collectorNumber || card.collector_number);
  return {
    year: cleanText(card.year),
    manufacturer: cleanText(card.manufacturer),
    brand: cleanText(card.manufacturer || card.brand),
    release: cleanText(card.releaseName || card.release_name),
    product: cleanText(card.releaseName || card.release_name || card.product),
    set: cleanText(card.setName || card.set_name),
    insert: cleanText(card.insertName || card.insert_name),
    card_name: name,
    players: name ? [name] : [],
    team: cleanText(card.team || card.teamName || card.team_name),
    card_number: number,
    collector_number: number,
    parallel_candidate: parallel || null,
    serial_denominator: parallel?.numbered_to ? cleanText(parallel.numbered_to) : "",
    observable_components: []
  };
}

function compactFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.values(value).some((item) => item !== null && item !== "");
    return value !== null && value !== undefined && cleanText(value) !== "";
  }));
}

function normalizeDetectionCandidate(detection = {}, index = 0, {
  mode = "identify_image",
  segment = ""
} = {}) {
  const card = cardObjectFromDetection(detection);
  const matchLevel = matchLevelFromCard(card);
  const grading = normalizeGrading(detection.grading);
  const fields = compactFields(fieldsFromCard(card));
  return normalizeExternalCandidate({
    provider_id: cardsightProviderId,
    source_type: cardsightSourceTrust,
    source_trust: cardsightSourceTrust,
    used_as_truth: false,
    match_level: matchLevel,
    confidence: cleanText(detection.confidence),
    rank: index + 1,
    external_card_id: cleanText(card.id),
    external_set_id: cleanText(card.setId || card.set_id),
    external_release_id: cleanText(card.releaseId || card.release_id),
    external_segment_id: cleanText(card.segmentId || card.segment_id),
    title: [
      fields.year,
      fields.manufacturer,
      fields.product,
      fields.set,
      fields.card_name,
      fields.collector_number ? `#${fields.collector_number}` : ""
    ].filter(Boolean).join(" "),
    fields,
    parallel_candidate: fields.parallel_candidate || null,
    grading_candidate: grading,
    allowed_usage: [...cardsightAllowedUsage],
    forbidden_usage: [...cardsightForbiddenUsage],
    source_trace: {
      segment
    },
    mode,
    segment,
    raw_card: card
  }, { providerId: cardsightProviderId, sourceTrust: cardsightSourceTrust, rank: index + 1, mode });
}

function resultArray(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.cards)) return payload.cards;
  if (Array.isArray(payload.detections)) return payload.detections;
  if (Array.isArray(payload.data?.results)) return payload.data.results;
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  if (Array.isArray(payload.data?.cards)) return payload.data.cards;
  return [];
}

function normalizeCatalogCandidate(item = {}, index = 0, {
  query = "",
  segment = ""
} = {}) {
  const card = item.card && typeof item.card === "object" ? item.card : item;
  const fields = compactFields(fieldsFromCard(card));
  const matchLevel = cleanText(card.id)
    ? externalMatchLevels.EXACT_CARD
    : cleanText(card.setId || card.set_id)
      ? externalMatchLevels.SET_LEVEL
      : externalMatchLevels.UNKNOWN;
  return normalizeExternalCandidate({
    provider_id: cardsightProviderId,
    source_type: cardsightSourceTrust,
    source_trust: cardsightSourceTrust,
    used_as_truth: false,
    match_level: matchLevel,
    confidence: cleanText(item.confidence || item.score || item.matchConfidence),
    rank: index + 1,
    external_card_id: cleanText(card.id),
    external_set_id: cleanText(card.setId || card.set_id),
    external_release_id: cleanText(card.releaseId || card.release_id),
    external_segment_id: cleanText(card.segmentId || card.segment_id),
    title: cleanText(item.title || item.name || [
      fields.year,
      fields.manufacturer,
      fields.product,
      fields.set,
      fields.card_name,
      fields.collector_number ? `#${fields.collector_number}` : ""
    ].filter(Boolean).join(" ")),
    fields,
    parallel_candidate: fields.parallel_candidate || normalizeParallel(item.parallel),
    grading_candidate: null,
    allowed_usage: [...cardsightAllowedUsage],
    forbidden_usage: [...cardsightForbiddenUsage],
    source_trace: {
      query,
      segment
    },
    mode: "catalog_search",
    query,
    segment,
    raw_card: card
  }, { providerId: cardsightProviderId, sourceTrust: cardsightSourceTrust, rank: index + 1, mode: "catalog_search" });
}

function unavailable(reason, code = "cardsight_unavailable") {
  return {
    provider_id: cardsightProviderId,
    unavailable: true,
    reason,
    code,
    candidates: []
  };
}

async function imageToBlob(image) {
  if (image instanceof Blob) return image;
  if (image instanceof ArrayBuffer) return new Blob([image]);
  if (ArrayBuffer.isView(image)) return new Blob([image]);
  if (typeof image === "string") {
    const bytes = await readFile(image);
    return new Blob([bytes]);
  }
  if (image?.local_path) {
    const bytes = await readFile(image.local_path);
    return new Blob([bytes]);
  }
  if (image?.arrayBuffer && typeof image.arrayBuffer === "function") {
    return new Blob([await image.arrayBuffer()]);
  }
  throw createCardsightError("CardSight image input must be a Blob, ArrayBuffer, typed array, local path, or object with local_path.", "cardsight_invalid_image_input");
}

function searchQueryFromFields(fields = {}) {
  const players = Array.isArray(fields.players) ? fields.players.join(" ") : cleanText(fields.player || fields.subject);
  return [
    fields.year,
    fields.manufacturer || fields.brand,
    fields.product || fields.release,
    fields.set,
    players,
    fields.card_name,
    fields.collector_number || fields.checklist_code,
    fields.surface_color
  ].map(cleanText).filter(Boolean).join(" ");
}

export function normalizeCardsightIdentifyResponse(payload = {}, {
  segment = ""
} = {}) {
  const detections = resultArray(payload);
  return {
    provider_id: cardsightProviderId,
    source_trust: cardsightSourceTrust,
    request_id: cleanText(payload.requestId || payload.request_id || payload.data?.requestId),
    processing_time_ms: Number(payload.processingTime ?? payload.processing_time ?? payload.data?.processingTime ?? 0) || null,
    candidates: detections.map((detection, index) => normalizeDetectionCandidate(detection, index, { segment })),
    raw_match_counts: {
      exact_card: detections.filter((detection) => matchLevelFromCard(cardObjectFromDetection(detection)) === "exact_card").length,
      set_level: detections.filter((detection) => matchLevelFromCard(cardObjectFromDetection(detection)) === "set_level").length,
      no_match: detections.filter((detection) => matchLevelFromCard(cardObjectFromDetection(detection)) === "no_match").length
    },
    messages: Array.isArray(payload.messages) ? payload.messages : Array.isArray(payload.data?.messages) ? payload.data.messages : []
  };
}

export function normalizeCardsightCatalogSearchResponse(payload = {}, {
  query = "",
  segment = ""
} = {}) {
  const rows = resultArray(payload);
  return {
    provider_id: cardsightProviderId,
    source_trust: cardsightSourceTrust,
    query,
    candidates: rows.map((item, index) => normalizeCatalogCandidate(item, index, { query, segment }))
  };
}

export function createCardsightAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const apiKey = apiKeyFromEnv(env);
  const baseUrl = baseUrlFromEnv(env);
  const timeoutMs = timeoutMsFromEnv(env);
  const configured = Boolean(apiKey);

  async function cardsightFetch(path, {
    method = "GET",
    body = null,
    headers = {}
  } = {}) {
    if (!configured) return unavailable("CARDSIGHTAI_API_KEY is not configured.", "cardsight_missing_api_key");
    if (!fetchImpl) return unavailable("fetch is unavailable.", "cardsight_fetch_unavailable");
    const response = await fetchWithTimeout(fetchImpl, `${baseUrl}${path}`, {
      method,
      headers: {
        "X-API-Key": apiKey,
        accept: "application/json",
        ...headers
      },
      body
    }, timeoutMs);
    const payload = await parseResponse(response);
    if (!response.ok) {
      throw createCardsightError(
        cleanText(payload.message || payload.error || `CardSight request failed: ${response.status}`),
        cardsightErrorCode(response.status),
        response.status
      );
    }
    return payload;
  }

  return {
    id: cardsightProviderId,
    configured,
    base_url: baseUrl,
    async identifyImage({
      image,
      segment = env.CARDSIGHTAI_SEGMENT || env.CARDSIGHT_SEGMENT || "basketball"
    } = {}) {
      if (!configured) return unavailable("CARDSIGHTAI_API_KEY is not configured.", "cardsight_missing_api_key");
      const formData = new FormData();
      const blob = await imageToBlob(image);
      formData.append("image", blob, "card-image");
      const encodedSegment = encodeURIComponent(cleanText(segment) || "basketball");
      const payload = await cardsightFetch(`/v1/identify/card/${encodedSegment}`, {
        method: "POST",
        body: formData,
        headers: {}
      });
      return normalizeCardsightIdentifyResponse(payload, { segment });
    },
    async searchCatalog({
      observedFields = {},
      queryText = "",
      segment = env.CARDSIGHTAI_SEGMENT || env.CARDSIGHT_SEGMENT || "basketball",
      take = env.CARDSIGHTAI_SEARCH_TAKE || 5
    } = {}) {
      if (!configured) return unavailable("CARDSIGHTAI_API_KEY is not configured.", "cardsight_missing_api_key");
      const query = cleanText(queryText || searchQueryFromFields(observedFields));
      if (!query) {
        return unavailable("CardSight catalog search requires queryText or observed fields.", "cardsight_empty_query");
      }
      const url = new URL(`${baseUrl}/v1/catalog/search`);
      appendQuery(url, {
        q: query,
        take: boundedTake(take),
        segment: cleanText(segment)
      });
      const payload = await cardsightFetch(`${url.pathname}${url.search}`);
      return normalizeCardsightCatalogSearchResponse(payload, { query, segment });
    },
    async searchByObservedFields(args = {}) {
      return this.searchCatalog(args);
    },
    async getCard(cardId) {
      const id = cleanText(cardId);
      if (!configured) return unavailable("CARDSIGHTAI_API_KEY is not configured.", "cardsight_missing_api_key");
      if (!id) return unavailable("CardSight card id is required.", "cardsight_empty_card_id");
      const payload = await cardsightFetch(`/v1/catalog/cards/${encodeURIComponent(id)}`);
      return {
        provider_id: cardsightProviderId,
        source_trust: cardsightSourceTrust,
        candidate: normalizeCatalogCandidate(payload.card || payload.data || payload, 0, { query: id })
      };
    },
    async getParallels(cardId) {
      const id = cleanText(cardId);
      if (!configured) return unavailable("CARDSIGHTAI_API_KEY is not configured.", "cardsight_missing_api_key");
      if (!id) return unavailable("CardSight card id is required.", "cardsight_empty_card_id");
      const payload = await cardsightFetch(`/v1/catalog/cards/${encodeURIComponent(id)}`);
      const card = payload.card || payload.data || payload;
      const parallels = [
        normalizeParallel(card.parallel),
        ...(Array.isArray(card.parallels) ? card.parallels.map(normalizeParallel) : [])
      ].filter(Boolean);
      return {
        provider_id: cardsightProviderId,
        source_trust: cardsightSourceTrust,
        parallels
      };
    },
    async getPricing() {
      return unavailable("CardSight pricing is not enabled in Catalog Cold-Start Flywheel v0.", "cardsight_pricing_disabled");
    }
  };
}
