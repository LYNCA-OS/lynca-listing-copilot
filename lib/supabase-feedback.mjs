import { buildListingReviewRecords } from "./listing/feedback/review-records.mjs";

const feedbackTable = "listing_title_feedback";
const assetsTable = "listing_assets";
const analysisRunsTable = "listing_analysis_runs";
const reviewsTable = "listing_reviews";
const approvedHistoryOutcomes = [
  "ACCEPTED_UNCHANGED",
  "CORRECTED_FIELDS",
  "TITLE_ONLY_OVERRIDE",
  "TARGETED_RESCAN_RECOVERED"
];

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function isSupabaseFeedbackConfigured(env = process.env) {
  return Boolean(String(env.SUPABASE_URL || "").trim() && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function listingFeedbackRetentionEnabled(env = process.env) {
  return truthy(env.LISTING_FEEDBACK_RETENTION_ENABLED || env.ENABLE_LISTING_FEEDBACK_RETENTION);
}

export function listingApprovedMemoryEnabled(env = process.env) {
  return truthy(env.LISTING_APPROVED_MEMORY_ENABLED || env.ENABLE_LISTING_APPROVED_MEMORY);
}

function requiredSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase feedback storage is not configured.");
  }

  return { url, serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json"
  };
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeSupabaseRow({
  table,
  row,
  method = "POST",
  upsert = false,
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const { url, serviceRoleKey } = requiredSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  if (upsert) endpoint.searchParams.set("on_conflict", "id");

  const response = await fetchImpl(endpoint, {
    method,
    headers: {
      ...supabaseHeaders(serviceRoleKey),
      prefer: upsert
        ? "resolution=merge-duplicates,return=representation"
        : "return=representation"
    },
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${table} write failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const rows = await readResponseJson(response);
  return Array.isArray(rows) ? rows[0] : rows;
}

async function readSupabaseRows({
  table,
  select,
  search = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const { url, serviceRoleKey } = requiredSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  if (select) endpoint.searchParams.set("select", select);
  Object.entries(search).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") endpoint.searchParams.set(key, value);
  });

  const response = await fetchImpl(endpoint, {
    headers: {
      ...supabaseHeaders(serviceRoleKey),
      prefer: "return=representation"
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${table} read failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const rows = await readResponseJson(response);
  return Array.isArray(rows) ? rows : [];
}

export async function createTitleFeedbackRecord({
  generatedTitle,
  correctedTitle,
  operatorId,
  frontImageUrl = null,
  backImageUrl = null,
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  if (!listingFeedbackRetentionEnabled(env)) {
    return {
      saved: false,
      durable: false,
      reason: "feedback_retention_disabled"
    };
  }

  const row = {
    generated_title: generatedTitle,
    corrected_title: correctedTitle,
    front_image_url: frontImageUrl,
    back_image_url: backImageUrl,
    operator_id: operatorId,
    created_at: new Date().toISOString()
  };

  return writeSupabaseRow({ table: feedbackTable, row, env, fetchImpl });
}

export async function createListingReviewRecord({
  payload,
  operatorId,
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const records = buildListingReviewRecords({ payload, operatorId });

  if (!listingFeedbackRetentionEnabled(env)) {
    return {
      asset: records.asset,
      analysis_run: records.analysisRun,
      review: records.review,
      legacy_feedback: null,
      retained: false,
      durable: false,
      reason: "feedback_retention_disabled"
    };
  }

  const asset = await writeSupabaseRow({
    table: assetsTable,
    row: records.asset,
    upsert: true,
    env,
    fetchImpl
  });
  const analysisRun = await writeSupabaseRow({
    table: analysisRunsTable,
    row: records.analysisRun,
    upsert: true,
    env,
    fetchImpl
  });
  const review = await writeSupabaseRow({
    table: reviewsTable,
    row: records.review,
    env,
    fetchImpl
  });
  const legacyFeedback = records.legacyFeedback
    ? await createTitleFeedbackRecord({ ...records.legacyFeedback, env, fetchImpl })
    : null;

  return {
    asset,
    analysis_run: analysisRun,
    review,
    legacy_feedback: legacyFeedback,
    retained: true,
    durable: true,
    reason: null
  };
}

export async function listApprovedHistoryRecords({
  env = process.env,
  fetchImpl = globalThis.fetch,
  limit = 100,
  assetFingerprint = ""
} = {}) {
  if (!isSupabaseFeedbackConfigured(env)) return [];

  const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = await readSupabaseRows({
    table: reviewsTable,
    select: [
      "id",
      "asset_id",
      "analysis_run_id",
      "asset_fingerprint",
      "corrected_title",
      "corrected_resolved_fields",
      "review_outcome",
      "stable_training_sample",
      "training_status",
      "reusable_approved_title",
      "approved_at",
      "created_at"
    ].join(","),
    search: {
      review_outcome: `in.(${approvedHistoryOutcomes.join(",")})`,
      ...(assetFingerprint ? { asset_fingerprint: `eq.${String(assetFingerprint).trim().toLowerCase()}` } : {}),
      approved_at: "not.is.null",
      order: "created_at.desc",
      limit: String(boundedLimit)
    },
    env,
    fetchImpl
  });

  return rows.map((row) => ({
    id: row.id,
    asset_id: row.asset_id || "",
    analysis_run_id: row.analysis_run_id || "",
    asset_fingerprint: row.asset_fingerprint || "",
    final_title: row.corrected_title || "",
    title: row.corrected_title || "",
    fields: row.corrected_resolved_fields && typeof row.corrected_resolved_fields === "object"
      ? row.corrected_resolved_fields
      : {},
    review_outcome: row.review_outcome || "",
    stable_training_sample: row.stable_training_sample === true,
    training_status: row.training_status || "",
    reusable_approved_title: row.reusable_approved_title === true,
    approved_at: row.approved_at || null,
    created_at: row.created_at || null
  }));
}
