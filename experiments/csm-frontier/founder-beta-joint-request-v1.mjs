import {
  canonicalSemanticStateJson,
  COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1,
  sha256SemanticState,
  validateCollectibleSemanticStateV1
} from "./collectible-semantic-state-v1.mjs";
import {
  FRONTIER_MODEL_CSM_EVALUATION_PROFILE,
  FRONTIER_MODEL_CSM_EXECUTION_MODE_FOUNDER_BETA,
  validateFrontierModelCsmEnvelope
} from "./frontier-model-csm-harness-v1.mjs";
import {
  CARD_NAME_PREDICATE,
  CURRENT_CARD_CONCEPT,
  CURRENT_CARD_VALUE,
  SET_CARD_NAME_DEFINITIONS,
  SET_MEMBERSHIP_PREDICATE,
  validateSetCardNameRelationsV1
} from "./set-card-name-contract-v1.mjs";

export const FOUNDER_BETA_JOINT_REQUEST_VERSION = "founder-beta-joint-request-v1";
export const FOUNDER_BETA_WEB_RECEIPT_VERSION = "founder-beta-web-receipt-v1";

const MAX_WEB_SOURCES = 20;
const MAX_WEB_TOOL_CALLS = 2;
const WEB_SEARCH_INCLUDE = Object.freeze(["web_search_call.action.sources"]);
const CURRENT_COPY_FIELDS = new Set([
  "card_number",
  "serial",
  "grading_info",
  "print_finish",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "special_stamp"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

function safeHttpsUrl(value) {
  let url;
  try { url = new URL(clean(value)); }
  catch { throw new TypeError("founder_beta_web_url_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port
      || clean(value).length > 2_048) {
    throw new TypeError("founder_beta_web_url_unsafe");
  }
  return url;
}

function returnedUrlIdentity(value) {
  const url = safeHttpsUrl(value);
  url.hash = "";
  return url.toString();
}

function sanitizeHttpsUrl(value) {
  const url = safeHttpsUrl(value);
  return `${url.origin}${url.pathname}`;
}

function unique(values) {
  return [...new Set(values)];
}

function providerOutputText(body) {
  if (typeof body?.output_text === "string" && body.output_text.trim()) {
    return body.output_text.trim();
  }
  return (Array.isArray(body?.output) ? body.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("")
    .trim();
}

function validateProviderExecutionProfile(body) {
  if (body?.model !== FRONTIER_MODEL_CSM_EVALUATION_PROFILE.model) {
    throw new TypeError("founder_beta_provider_model_mismatch");
  }
  if (body?.reasoning?.effort !== FRONTIER_MODEL_CSM_EVALUATION_PROFILE.reasoning_effort) {
    throw new TypeError("founder_beta_provider_reasoning_effort_mismatch");
  }
}

function searchQueries(action = {}) {
  if (clean(action.type).toLowerCase() !== "search") return [];
  const values = [
    action.query,
    ...(Array.isArray(action.queries) ? action.queries : [])
  ].map(clean).filter(Boolean);
  if (values.some((value) => value.length > 500)) {
    throw new TypeError("founder_beta_web_query_too_long");
  }
  return values;
}

function actionUrl(action = {}) {
  const type = clean(action.type).toLowerCase();
  if (type !== "open_page" && type !== "find_in_page") return null;
  if (!clean(action.url)) throw new TypeError("founder_beta_web_action_url_missing");
  return action.url;
}

function providerWebTrace(body) {
  const output = Array.isArray(body?.output) ? body.output : [];
  const calls = output.filter((item) => item?.type === "web_search_call");
  if (calls.length > MAX_WEB_TOOL_CALLS) {
    throw new TypeError("founder_beta_web_call_budget_exceeded");
  }
  const actionTypes = new Set(["search", "open_page", "find_in_page"]);
  for (const call of calls) {
    if (call?.status !== "completed") {
      throw new TypeError("founder_beta_web_call_incomplete");
    }
    if (!actionTypes.has(clean(call?.action?.type).toLowerCase())) {
      throw new TypeError("founder_beta_web_action_unsupported");
    }
  }
  const queries = unique(calls.flatMap((item) => searchQueries(item.action)));
  const rawUrls = [];
  for (const call of calls) {
    for (const source of Array.isArray(call?.action?.sources) ? call.action.sources : []) {
      if (source?.url) rawUrls.push(source.url);
    }
    const url = actionUrl(call.action);
    if (url) rawUrls.push(url);
  }
  for (const item of output) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        if (annotation?.url) rawUrls.push(annotation.url);
      }
    }
  }
  if (rawUrls.length > MAX_WEB_SOURCES) {
    throw new TypeError("founder_beta_web_source_budget_exceeded");
  }
  const urlIdentities = unique(rawUrls.map(returnedUrlIdentity));
  const urls = unique(rawUrls.map(sanitizeHttpsUrl)).sort();
  if (!calls.length && urls.length) {
    throw new TypeError("founder_beta_web_sources_without_call");
  }
  return { calls, queries, urlIdentities, urls };
}

function normalizeSourceRefs(state, { inputSourceIds, returnedUrlIdentities }) {
  const input = new Set(inputSourceIds);
  const returned = new Set(returnedUrlIdentities);
  const clone = JSON.parse(JSON.stringify(state));
  const normalize = (sourceId) => {
    if (input.has(sourceId)) return sourceId;
    if (!String(sourceId).includes("://")) return sourceId;
    if (!returned.has(returnedUrlIdentity(sourceId))) {
      throw new TypeError("founder_beta_web_url_not_returned");
    }
    return sanitizeHttpsUrl(sourceId);
  };
  for (const collection of [clone.facts, clone.relationships, clone.uncertainties]) {
    for (const row of Array.isArray(collection) ? collection : []) {
      if (Array.isArray(row.source_ids)) row.source_ids = unique(row.source_ids.map(normalize));
    }
  }
  return clone;
}

function fieldFromFact(fact) {
  const path = clean(fact?.canonical_path).replace(/\[\]$/, "").split(".")[0];
  if (path) return path;
  const match = /^canonical\.([a-z_]+)$/i.exec(clean(fact?.concept));
  return match?.[1] || "";
}

function fieldEvidence(state, urls) {
  const returned = new Set(urls);
  const byField = new Map();
  const bucket = (field) => {
    if (!byField.has(field)) {
      byField.set(field, { field, support_urls: [], conflict_urls: [], unresolved_urls: [] });
    }
    return byField.get(field);
  };
  const factById = new Map(state.facts.map((fact) => [fact.fact_id, fact]));
  for (const fact of state.facts) {
    const field = fieldFromFact(fact);
    const cited = fact.source_ids.filter((sourceId) => returned.has(sourceId));
    if (!field || !cited.length) continue;
    const key = fact.status === "CONFLICTED" ? "conflict_urls" : "support_urls";
    bucket(field)[key].push(...cited);
  }
  for (const uncertainty of state.uncertainties) {
    const cited = unique([
      ...uncertainty.source_ids,
      ...uncertainty.alternative_fact_ids.flatMap((factId) => (
        factById.get(factId)?.source_ids || []
      ))
    ]).filter((sourceId) => returned.has(sourceId));
    if (!cited.length) continue;
    const fields = unique(uncertainty.alternative_fact_ids
      .map((factId) => fieldFromFact(factById.get(factId)))
      .filter(Boolean));
    for (const field of fields.length ? fields : [clean(uncertainty.concept)]) {
      bucket(field).unresolved_urls.push(...cited);
    }
  }
  return [...byField.values()]
    .map((row) => Object.freeze({
      field: row.field,
      support_urls: Object.freeze(unique(row.support_urls).sort()),
      conflict_urls: Object.freeze(unique(row.conflict_urls).sort()),
      unresolved_urls: Object.freeze(unique(row.unresolved_urls).sort())
    }))
    .sort((left, right) => left.field.localeCompare(right.field));
}

function enforceCurrentCardAuthority(state, { originalImageSourceIds, webUrls }) {
  const originals = new Set(originalImageSourceIds);
  const web = new Set(webUrls);
  for (const fact of state.facts) {
    const field = fieldFromFact(fact);
    if (fact.status === "SUPPORTED" && CURRENT_COPY_FIELDS.has(field)
        && !fact.source_ids.some((sourceId) => originals.has(sourceId))) {
      throw new TypeError(`founder_beta_current_copy_source_required:${field}`);
    }
  }
  const imageConflicts = new Set(state.facts.filter((fact) => (
    fact.status === "CONFLICTED"
    && fact.source_ids.some((sourceId) => originals.has(sourceId))
  )).map(fieldFromFact).filter(Boolean));
  if (state.facts.some((fact) => (
    fact.status === "SUPPORTED" && fact.canonical_path
    && imageConflicts.has(fieldFromFact(fact))
    && fact.source_ids.some((sourceId) => web.has(sourceId))
  ))) {
    throw new TypeError("founder_beta_current_card_conflict_cannot_project");
  }
}

/** Build one dormant/shadow Responses request. It performs no dispatch. */
export function buildFounderBetaJointRequest(envelope) {
  validateFrontierModelCsmEnvelope(envelope);
  if (envelope.execution_mode !== FRONTIER_MODEL_CSM_EXECUTION_MODE_FOUNDER_BETA) {
    throw new TypeError("founder_beta_execution_mode_required");
  }
  const images = envelope.source_inventory.filter((source) => (
    source.source_kind === "ORIGINAL_IMAGE"
  ));
  if (!images.length) throw new TypeError("founder_beta_original_image_required");
  const inventory = canonicalSemanticStateJson({
    source_inventory: envelope.source_inventory,
    source_inventory_sha256: envelope.source_inventory_sha256
  });
  const prompt = [
    "Jointly recognize and resolve the collectible from the approved current-card evidence.",
    "You may autonomously use the built-in Web Search only when identity remains unresolved.",
    "Current-card image evidence is absolute for copy-specific facts; Web evidence may support identity but must never overwrite a visible conflict.",
    `Set means: ${SET_CARD_NAME_DEFINITIONS.set}`,
    `Card Name means: ${SET_CARD_NAME_DEFINITIONS.card_name}`,
    `Always emit one fact concept=${CURRENT_CARD_CONCEPT}, value=${CURRENT_CARD_VALUE}, canonical_path empty.`,
    `A projected Set requires ${SET_MEMBERSHIP_PREDICATE} from the current-card fact to the Set fact.`,
    `A projected Card Name requires ${CARD_NAME_PREDICATE} from the current-card fact to the Card Name fact.`,
    "For every Web-backed fact or relation, put the exact cited HTTPS URL in source_ids. Keep conflicts and unresolved alternatives; never invent a URL.",
    "Return no marketplace title, private reasoning, or chain-of-thought.",
    `APPROVED_EVIDENCE_INVENTORY_JSON=${inventory}`
  ].join("\n");
  return deepFreeze({
    model: FRONTIER_MODEL_CSM_EVALUATION_PROFILE.model,
    max_output_tokens: FRONTIER_MODEL_CSM_EVALUATION_PROFILE.max_output_tokens,
    reasoning: { effort: FRONTIER_MODEL_CSM_EVALUATION_PROFILE.reasoning_effort },
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    max_tool_calls: MAX_WEB_TOOL_CALLS,
    include: [...WEB_SEARCH_INCLUDE],
    text: {
      format: {
        type: "json_schema",
        name: "collectible_semantic_state_v1_founder_beta",
        strict: true,
        schema: COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1
      }
    },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...images.map((source) => ({
          type: "input_image",
          image_url: source.payload.image_ref,
          detail: FRONTIER_MODEL_CSM_EVALUATION_PROFILE.image_detail
        }))
      ]
    }]
  });
}

/** Validate one provider response and derive the smallest public tool receipt. */
export function auditFounderBetaProviderResponse(envelope, body) {
  const inputSourceIds = validateFrontierModelCsmEnvelope(envelope);
  if (envelope.execution_mode !== FRONTIER_MODEL_CSM_EXECUTION_MODE_FOUNDER_BETA) {
    throw new TypeError("founder_beta_execution_mode_required");
  }
  if (body?.status !== undefined && body.status !== "completed") {
    throw new TypeError("founder_beta_provider_response_incomplete");
  }
  validateProviderExecutionProfile(body);
  const trace = providerWebTrace(body);
  const output = providerOutputText(body);
  if (!output) throw new TypeError("founder_beta_provider_output_missing");
  let parsed;
  try { parsed = JSON.parse(output); }
  catch { throw new TypeError("founder_beta_provider_output_invalid_json"); }
  const normalized = normalizeSourceRefs(parsed, {
    inputSourceIds,
    returnedUrlIdentities: trace.urlIdentities
  });
  const state = validateCollectibleSemanticStateV1(normalized, {
    sourceIds: [...inputSourceIds, ...trace.urls],
    sourceInventorySha256: envelope.source_inventory_sha256
  });
  const originalImageSourceIds = envelope.source_inventory
    .filter((source) => source.source_kind === "ORIGINAL_IMAGE")
    .map((source) => source.source_id);
  enforceCurrentCardAuthority(state, {
    originalImageSourceIds,
    webUrls: trace.urls
  });
  const setCardName = validateSetCardNameRelationsV1(state, {
    currentCardSourceIds: originalImageSourceIds
  });
  const evidence = fieldEvidence(state, trace.urls);
  if (trace.calls.length && !trace.queries.length && !evidence.length) {
    throw new TypeError("founder_beta_web_receipt_invalid");
  }
  const receipt = deepFreeze({
    schema_version: FOUNDER_BETA_WEB_RECEIPT_VERSION,
    provider_request_count: 1,
    isolated_model_call_count: 0,
    provider_model: body.model,
    reasoning_effort: body.reasoning.effort,
    web_search_used: trace.calls.length > 0,
    web_search_call_count: trace.calls.length,
    queries: trace.queries,
    urls: trace.urls,
    field_evidence: evidence,
    semantic_state_sha256: sha256SemanticState(state)
  });
  return deepFreeze({
    schema_version: "founder-beta-joint-audit-v1",
    request_version: FOUNDER_BETA_JOINT_REQUEST_VERSION,
    semantic_state: state,
    set_card_name_contract: setCardName,
    web_receipt: receipt
  });
}
