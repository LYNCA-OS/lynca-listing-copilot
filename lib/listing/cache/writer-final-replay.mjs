import { resolvedFieldsToLegacyFields } from "../evidence/provider-evidence-normalizer.mjs";

export const writerFinalReplayTable = "listing_writer_final_replay";
export const writerFinalReplaySource = "writer_final_replay";
export const writerFinalReplayRoute = "WRITER_FINAL_REPLAY";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function config(env = process.env) {
  const url = clean(env.SUPABASE_URL).replace(/\/+$/, "");
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  return { url, key };
}

export async function readWriterFinalReplayRecord({
  tenantId,
  imageGenerationHash,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = clean(tenantId);
  const normalizedHash = clean(imageGenerationHash).toLowerCase();
  if (!normalizedTenantId) return { hit: false, reason: "writer_final_tenant_missing" };
  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) return { hit: false, reason: "writer_final_image_hash_invalid" };
  const { url, key } = config(env);
  if (!url || !key || typeof fetchImpl !== "function") return { hit: false, reason: "writer_final_store_unavailable" };

  const endpoint = new URL(`${url}/rest/v1/${writerFinalReplayTable}`);
  endpoint.searchParams.set("select", "tenant_id,image_generation_hash,writer_final_title,resolved_fields,field_states,identity_status,ambiguity_status,source_session_id,source_feedback_event_id,updated_at");
  endpoint.searchParams.set("tenant_id", `eq.${normalizedTenantId}`);
  endpoint.searchParams.set("image_generation_hash", `eq.${normalizedHash}`);
  endpoint.searchParams.set("replay_status", "eq.active");
  endpoint.searchParams.set("limit", "1");
  const response = await fetchImpl(endpoint, {
    headers: { apikey: key, authorization: `Bearer ${key}` }
  });
  if (!response.ok) return { hit: false, reason: `writer_final_read_failed_${response.status}` };
  const rows = await response.json().catch(() => []);
  const record = Array.isArray(rows) ? rows[0] : null;
  return record
    ? { hit: true, reason: "writer_final_replay_hit", record }
    : { hit: false, reason: "writer_final_replay_miss" };
}

export function writerFinalReplayRecordToListingResult({ record = {}, payload = {}, latencyMs = 0 } = {}) {
  const resolved = record.resolved_fields && typeof record.resolved_fields === "object" ? record.resolved_fields : {};
  const title = clean(record.writer_final_title);
  return {
    title,
    final_title: title,
    rendered_title: title,
    title_render_source: writerFinalReplaySource,
    confidence: "WRITER_FINAL",
    reason: "This tenant previously accepted or edited the final title for the exact verified image generation.",
    fields: resolvedFieldsToLegacyFields(resolved),
    resolved,
    evidence: {},
    identity_resolution_status: record.identity_status || "RESOLVED",
    ambiguity_status: record.ambiguity_status || "RESOLVED",
    identity_resolution: null,
    field_states: record.field_states || {},
    conflict_map: [],
    confidence_report: null,
    unresolved: [],
    source: writerFinalReplaySource,
    provider: writerFinalReplaySource,
    route: writerFinalReplayRoute,
    route_reason: "Writer-final authority matched tenant and exact verified image content; providers were skipped.",
    asset_id: payload.assetId || payload.asset_id || null,
    analysis_run_id: payload.analysisRunId || payload.analysis_run_id || `analysis_writer_final_${record.image_generation_hash || "hit"}`,
    replay_class: "WRITER_FINAL_REPLAY",
    training_eligible: false,
    catalog_promotion_eligible: false,
    identity_truth: false,
    replay: {
      replay_class: "WRITER_FINAL_REPLAY",
      training_eligible: false,
      catalog_promotion_eligible: false,
      identity_truth: false
    },
    identity_cache: {
      cache_hit: false,
      miss_reason: "writer_final_precedence",
      provider_call_skipped: true,
      cached_result_version_match: null,
      image_generation_hash: record.image_generation_hash || null,
      replay_class: "WRITER_FINAL_REPLAY",
      training_eligible: false,
      catalog_promotion_eligible: false,
      identity_truth: false
    },
    usage: {
      provider_calls: 0,
      recognition_worker_calls: 0,
      retrieval_calls: 0,
      latency_ms: Math.max(0, Math.round(Number(latencyMs) || 0)),
      estimated_cost_usd: 0,
      resolution_rounds: 0
    },
    resolution_trace: [{
      phase: "writer_final_replay",
      step: "tenant_exact_image_writer_final_hit",
      decision: "reuse_writer_final_snapshot",
      output: {
        provider_call_skipped: true,
        replay_class: "WRITER_FINAL_REPLAY",
        identity_truth: false
      },
      created_at: new Date().toISOString()
    }]
  };
}
