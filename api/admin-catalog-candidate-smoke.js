import { catalogProvider } from "../lib/listing/retrieval/catalog-provider.mjs";
import { retrievalProviderIds } from "../lib/listing/retrieval/retrieval-contract.mjs";
import { planRetrievalQueries } from "../lib/listing/retrieval/query-planner.mjs";
import {
  buildVectorCandidateAssistPacket,
  buildVectorCandidatePacket,
  vectorCandidatePacketAssistEligibility
} from "../lib/listing/retrieval/vector-candidate-packet.mjs";
import { cookieName, parseCookies, readSignedSession } from "../lib/listing-session.mjs";

export const config = {
  maxDuration: 60
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function internalBearerToken(req) {
  const header = cleanText(req.headers?.authorization || req.headers?.Authorization);
  return header.replace(/^Bearer\s+/i, "").trim();
}

function isInternalTokenAuthorized(req, env = process.env) {
  const expected = cleanText(env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const token = internalBearerToken(req);
  return Boolean(expected && token && token === expected);
}

function isSessionAuthorized(req, env = process.env) {
  const cookies = parseCookies(req.headers.cookie);
  return Boolean(readSignedSession(cookies[cookieName], env.METAVERSE_AUTH_SECRET));
}

function smokeAuth(req, env = process.env) {
  if (isInternalTokenAuthorized(req, env)) return { ok: true, mode: "internal_token" };
  if (isSessionAuthorized(req, env)) return { ok: true, mode: "session" };
  return { ok: false };
}

function compactCandidate(candidate = {}) {
  const metadata = candidate.reference_metadata || {};
  return {
    candidate_id: candidate.candidate_id || "",
    candidate_identity_id: candidate.candidate_identity_id || "",
    source_trust: candidate.source_trust || "",
    source_type: candidate.source_type || "",
    trust_tier: candidate.trust_tier ?? null,
    title: candidate.title || candidate.reference_title || "",
    normalized_score: candidate.normalized_score ?? null,
    matched_fields: Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [],
    supporting_fields: Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : [],
    fields: candidate.fields || {},
    reference_metadata: {
      retrieval_status: metadata.retrieval_status || "",
      source_type: metadata.source_type || "",
      source_status: metadata.source_status || "",
      prompt_safe_internal_writer_title: metadata.prompt_safe_internal_writer_title === true,
      official_catalog_prompt_safe: metadata.official_catalog_prompt_safe === true,
      corrected_title_as_temporary_gt: metadata.corrected_title_as_temporary_gt === true,
      expected_serial_denominator: metadata.expected_serial_denominator || ""
    }
  };
}

function dedupeCandidates(candidates = []) {
  const seen = new Set();
  const deduped = [];
  for (const candidate of candidates) {
    const key = candidate.candidate_identity_id || `${candidate.title}:${JSON.stringify(candidate.fields || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function isPromptSafe(candidate = {}) {
  return cleanText(candidate.source_trust).toUpperCase() === "APPROVED_REFERENCE";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const auth = smokeAuth(req);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_json_body" });
    return;
  }

  const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
  const planned = planRetrievalQueries({
    resolved: fields,
    includeExternal: false,
    includeHybrid: false,
    excludeSourceFeedbackIds: Array.isArray(body.exclude_source_feedback_ids)
      ? body.exclude_source_feedback_ids
      : []
  }).filter((query) => query.provider_id === retrievalProviderIds.CATALOG);
  if (!planned.length) {
    sendJson(res, 200, {
      ok: true,
      auth_mode: auth.mode,
      query_count: 0,
      raw_candidate_count: 0,
      approved_candidate_count: 0,
      prompt_candidate_count: 0,
      prompt_candidate_ids: [],
      candidates: [],
      unavailable: "catalog_query_missing"
    });
    return;
  }

  const provider = catalogProvider({ env: process.env, fetchImpl: globalThis.fetch });
  const results = [];
  for (const query of planned) {
    const result = await provider.search({ query, resolved: fields });
    results.push({
      query_id: query.query_id,
      family: query.family,
      query: query.query,
      unavailable: result.unavailable ? result.reason || "unavailable" : "",
      candidates: Array.isArray(result.candidates) ? result.candidates : []
    });
  }

  const candidates = dedupeCandidates(results.flatMap((result) => result.candidates));
  const packet = buildVectorCandidatePacket({
    sources: candidates,
    retrieval_metrics: {
      catalog_raw_candidate_count: candidates.length
    }
  }, {
    limit: 5,
    queryFields: fields
  });
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  const eligibility = vectorCandidatePacketAssistEligibility(packet);
  const promptCandidates = Array.isArray(assistPacket.vector_retrieval?.candidates)
    ? assistPacket.vector_retrieval.candidates
    : [];
  const fieldSupport = Array.isArray(assistPacket.vector_retrieval?.field_support)
    ? assistPacket.vector_retrieval.field_support
    : [];
  sendJson(res, 200, {
    ok: true,
    auth_mode: auth.mode,
    query_count: planned.length,
    raw_candidate_count: candidates.length,
    approved_candidate_count: eligibility.approved_candidate_count || 0,
    conflict_blocked_count: eligibility.conflict_blocked_count || 0,
    prompt_candidate_count: eligibility.prompt_candidate_count || 0,
    prompt_candidate_ids: Array.isArray(eligibility.prompt_candidate_ids) ? eligibility.prompt_candidate_ids : [],
    field_support_count: fieldSupport.length,
    field_support_fields: [...new Set(fieldSupport.map((row) => cleanText(row.field)).filter(Boolean))],
    field_support: fieldSupport.slice(0, 20).map((row) => ({
      field: row.field || "",
      value: row.value ?? null,
      source_trust: row.source_trust || "",
      support_type: row.support_type || "",
      usage_policy: row.usage_policy || "",
      candidate_id: row.candidate_id || "",
      candidate_identity_id: row.candidate_identity_id || "",
      source_type: row.source_type || "",
      soft_conflicting_fields: Array.isArray(row.soft_conflicting_fields) ? row.soft_conflicting_fields : []
    })),
    assist_reason: eligibility.reason || "",
    queries: results.map((result) => ({
      query_id: result.query_id,
      family: result.family,
      query: result.query,
      unavailable: result.unavailable,
      candidate_count: result.candidates.length,
      top_candidates: result.candidates.slice(0, 8).map(compactCandidate)
    })),
    candidates: promptCandidates.slice(0, 10).map(compactCandidate),
    raw_candidates: candidates.slice(0, 10).map(compactCandidate)
  });
}
