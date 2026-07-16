import { callV4Rpc } from "../listing/v4/session/supabase-rest.mjs";

const defaultWindowHours = 24;

function boundedWindowHours(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultWindowHours;
  return Math.max(1, Math.min(parsed, 24 * 31));
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ratio(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  return bottom > 0 ? top / bottom : null;
}

export function normalizeTenantOpsSnapshot(value = {}) {
  const snapshot = objectOrEmpty(value);
  const queueInput = objectOrEmpty(snapshot.queue || snapshot.system);
  const aiInput = objectOrEmpty(snapshot.ai);
  const feedbackInput = objectOrEmpty(snapshot.feedback);
  const costInput = objectOrEmpty(snapshot.cost);
  const recognitionCount = Number(aiInput.recognition_count ?? aiInput.recognition_volume ?? 0);
  const recognitionSuccessCount = Number(aiInput.success_count ?? 0);
  const acceptCount = Number(feedbackInput.accept_count ?? aiInput.accept_count ?? 0);
  const editCount = Number(feedbackInput.edit_count ?? aiInput.edit_count ?? 0);
  const rejectCount = Number(feedbackInput.reject_count ?? aiInput.reject_count ?? 0);
  const feedbackCount = acceptCount + editCount + rejectCount;
  const providerCallEvents = Number(costInput.provider_call_events ?? 0);
  const pricedCallEvents = Number(costInput.priced_call_events ?? 0);
  return {
    generated_at: snapshot.generated_at || new Date().toISOString(),
    tenant_id: snapshot.tenant_id || null,
    window: Object.keys(objectOrEmpty(snapshot.window)).length
      ? objectOrEmpty(snapshot.window)
      : { since: snapshot.since || null },
    queue: {
      ...queueInput,
      p50_writer_visible_latency_ms: queueInput.p50_writer_visible_latency_ms ?? null,
      p95_writer_visible_latency_ms: queueInput.p95_writer_visible_latency_ms ?? queueInput.p95_latency_ms ?? null
    },
    ai: {
      ...aiInput,
      recognition_count: recognitionCount,
      failed_count: Number(aiInput.failed_count ?? aiInput.recognition_failed ?? 0)
    },
    feedback: {
      ...feedbackInput,
      feedback_count: Number(feedbackInput.feedback_count ?? feedbackCount),
      accept_count: acceptCount,
      edit_count: editCount,
      reject_count: rejectCount,
      accept_rate: feedbackInput.accept_rate ?? ratio(acceptCount, feedbackCount),
      edit_rate: feedbackInput.edit_rate ?? ratio(editCount, feedbackCount),
      reject_rate: feedbackInput.reject_rate ?? ratio(rejectCount, feedbackCount)
    },
    cost: {
      ...costInput,
      total_tokens: Number(costInput.total_tokens ?? 0) || (Number(costInput.input_tokens || 0) + Number(costInput.output_tokens || 0)),
      average_cost_per_successful_card_usd: costInput.average_cost_per_successful_card_usd ?? costInput.average_cost_per_card_usd ?? null,
      cost_configured: costInput.cost_configured === true
    },
    coverage: {
      ...objectOrEmpty(snapshot.coverage),
      feedback_rate: snapshot.coverage?.feedback_rate ?? ratio(
        feedbackCount,
        recognitionSuccessCount > 0 ? recognitionSuccessCount : recognitionCount
      ),
      pricing_rate: snapshot.coverage?.pricing_rate ?? ratio(pricedCallEvents, providerCallEvents)
    }
  };
}

export function redactTenantOpsCost(snapshot = {}, { canViewCost = false } = {}) {
  const normalized = normalizeTenantOpsSnapshot(snapshot);
  if (canViewCost) return normalized;
  return {
    ...normalized,
    cost: {
      visible: false,
      reason: "VIEW_COST_PERMISSION_REQUIRED"
    }
  };
}

export async function readTenantOpsSnapshot({
  tenantId,
  windowHours = defaultWindowHours,
  canViewCost = false,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedTenantId) {
    return { ok: false, snapshot: null, error: "tenant_id_required" };
  }

  const result = await callV4Rpc({
    fn: "track_c_ops_snapshot",
    payload: {
      p_tenant_id: normalizedTenantId,
      p_since: new Date(Date.now() - boundedWindowHours(windowHours) * 60 * 60 * 1_000).toISOString()
    },
    env,
    fetchImpl
  });

  if (!result.ok) {
    return { ok: false, snapshot: null, error: result.error || "ops_snapshot_unavailable" };
  }

  return {
    ok: true,
    snapshot: redactTenantOpsCost(result.rows[0] || {}, { canViewCost }),
    error: null
  };
}
