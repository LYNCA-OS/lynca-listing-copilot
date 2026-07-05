import crypto from "node:crypto";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null && item !== "") : [];
}

function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function sidecarToken(env = process.env) {
  return cleanText(env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN || env.VERCEL_AUTOMATION_BYPASS_SECRET);
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function requireInternalSidecarAuth(req, env = process.env) {
  const expected = sidecarToken(env);
  if (!expected) {
    return {
      ok: false,
      status: 503,
      payload: {
        ok: false,
        error: "internal_sidecar_token_missing"
      }
    };
  }
  const header = cleanText(req.headers?.authorization || req.headers?.Authorization);
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== expected) {
    return {
      ok: false,
      status: 401,
      payload: {
        ok: false,
        error: "unauthorized"
      }
    };
  }
  return { ok: true };
}

function candidateId(candidate = {}) {
  return cleanText(
    candidate.candidate_id
    || candidate.candidate_identity_id
    || candidate.identity_id
    || candidate.id
  );
}

function conflictingFields(candidate = {}) {
  return [
    ...compactArray(candidate.conflicting_fields),
    ...compactArray(candidate.direct_evidence_conflicts),
    ...compactArray(candidate.conflicts)
  ]
    .map((item) => typeof item === "string" ? item : cleanText(item?.field || item?.name || item?.type))
    .filter(Boolean)
    .filter((field, index, fields) => fields.indexOf(field) === index);
}

function candidateRows(body = {}) {
  const event = body.event || {};
  return [
    ...compactArray(body.candidates),
    ...compactArray(event.catalog_candidates),
    ...compactArray(event.vector_candidates)
  ]
    .map((candidate, index) => ({
      ...candidate,
      candidate_id: candidateId(candidate) || `candidate_${index + 1}`,
      conflicting_fields: conflictingFields(candidate)
    }))
    .filter((candidate, index, rows) => rows.findIndex((row) => row.candidate_id === candidate.candidate_id) === index)
    .slice(0, 50);
}

export function heuristicCandidateScore(candidate = {}) {
  const normalized = finiteNumber(candidate.normalized_score ?? candidate.combined_score ?? candidate.match_score, 0);
  const support = compactArray(candidate.supporting_fields || candidate.matched_fields).length;
  const conflicts = conflictingFields(candidate).length;
  const trust = /APPROVED|REVIEWED|OFFICIAL/i.test(cleanText(candidate.source_trust || candidate.retrieval_status || candidate.review_status)) ? 0.35 : 0;
  const score = (normalized * 0.45) + (support * 0.08) + trust - (conflicts * 0.28);
  return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}

export function buildInternalSplinkPayload(body = {}) {
  const rows = candidateRows(body);
  const ids = rows.map(candidateId).filter(Boolean);
  const conflicted = rows.filter((candidate) => conflictingFields(candidate).length);
  const approved = rows.filter((candidate) => /APPROVED|REVIEWED|OFFICIAL/i.test(cleanText(candidate.source_trust || candidate.retrieval_status || candidate.review_status)));
  const matchProbability = rows.length
    ? Number(Math.max(...rows.map(heuristicCandidateScore)).toFixed(6))
    : null;
  return {
    ok: true,
    mode: "internal_splink_like_cluster_shadow",
    cluster_id: ids.length ? `internal-cluster-${stableDigest(ids.sort())}` : null,
    match_probability: matchProbability,
    duplicate_warning: rows.length > 1,
    candidate_count: rows.length,
    approved_candidate_count: approved.length,
    direct_conflict_count: conflicted.length,
    output_contract: "candidate_cluster_shadow_only"
  };
}

export function buildInternalCleanlabPayload(body = {}) {
  const event = body.event || {};
  const candidates = candidateRows(body);
  const conflictCount = candidates.reduce((count, candidate) => count + conflictingFields(candidate).length, 0);
  const reviewFields = compactArray(event.review_required_fields);
  const riskFlags = compactArray(event.risk_flags);
  const penalty = Math.min(0.75, (conflictCount * 0.08) + (reviewFields.length * 0.06) + (riskFlags.length * 0.08));
  const score = Number(Math.max(0.05, 0.95 - penalty).toFixed(6));
  return {
    ok: true,
    mode: "internal_cleanlab_like_quality_shadow",
    label_quality_score: score,
    conflict_count: conflictCount,
    review_required_field_count: reviewFields.length,
    risk_flag_count: riskFlags.length,
    reason: score < 0.65 ? "needs_priority_review" : "quality_shadow_recorded"
  };
}

export function buildInternalFiftyOnePayload(body = {}, env = process.env) {
  const event = body.event || body || {};
  const sampleId = cleanText(body.sample_id || body.sampleId)
    || `${event.analysis_run_id || "analysis"}_${event.event_id || stableDigest(body)}`.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 120);
  return {
    ok: true,
    mode: "internal_fiftyone_like_failure_gallery_shadow",
    synced: true,
    sample_id: sampleId,
    dataset_name: cleanText(body.dataset_name || env.DATA_LOOP_FIFTYONE_DATASET_NAME) || "lynca_listing_workflow_sidecar",
    hard_negative_candidate_count: candidateRows(body).filter((candidate) => conflictingFields(candidate).length).length
  };
}

export function buildInternalLightGbmPayload(body = {}) {
  const rows = candidateRows(body);
  const scored = rows
    .map((candidate) => ({
      candidate_id: candidateId(candidate),
      score: heuristicCandidateScore(candidate),
      conflicting_fields: conflictingFields(candidate)
    }))
    .sort((left, right) => right.score - left.score);
  const top = scored[0] || null;
  return {
    ok: true,
    mode: "internal_lightgbm_like_shadow_reranker",
    shadow_only: true,
    selected_candidate_id: top?.candidate_id || null,
    score: top?.score ?? null,
    candidate_count: rows.length,
    scored_candidates: scored.slice(0, 10),
    output_contract: "shadow_candidate_score_only"
  };
}

export function buildInternalPhoenixPayload(body = {}) {
  const spans = Array.isArray(body.spans) ? body.spans : Array.isArray(body.resourceSpans) ? body.resourceSpans : [];
  return {
    ok: true,
    mode: "internal_phoenix_like_trace_sink",
    accepted: true,
    span_count: spans.length || 1,
    trace_id: cleanText(body.trace_id || spans[0]?.trace_id || spans[0]?.span_id) || null
  };
}

export async function handleInternalSidecar(req, res, {
  env = process.env,
  buildPayload
} = {}) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  const auth = requireInternalSidecarAuth(req, env);
  if (!auth.ok) {
    sendJson(res, auth.status, auth.payload);
    return;
  }
  try {
    const body = await readJsonBody(req);
    sendJson(res, 200, buildPayload(body, env));
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      error: "invalid_request",
      message: cleanText(error?.message || error).slice(0, 180)
    });
  }
}
