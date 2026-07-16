import { buildListingReviewRecords } from "./listing/feedback/review-records.mjs";
import { reviewedTitleRecordToMemoryRecord } from "./listing/memory/title-field-parser.mjs";
import { LEGACY_TENANT_ID } from "./tenant/constants.mjs";

const feedbackTable = "listing_title_feedback";
const assetsTable = "listing_assets";
const analysisRunsTable = "listing_analysis_runs";
const reviewsTable = "listing_reviews";
const optionalSupabaseWriteColumns = Object.freeze({
  [analysisRunsTable]: Object.freeze([
    "open_set_readiness",
    "workflow_summary",
    "workflow_sidecars",
    "workflow_action_plan",
    "field_graph"
  ]),
  [reviewsTable]: Object.freeze([
    "workflow_summary",
    "field_graph",
    "feedback_training_event",
    "candidate_reranker_dataset",
    "field_level_ground_truth",
    "hard_negative_samples"
  ])
});
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

function optionalSchemaColumnError({ table, message = "" } = {}) {
  const optionalColumns = optionalSupabaseWriteColumns[table] || [];
  if (!optionalColumns.length) return "";

  const normalized = String(message || "");
  const schemaCacheMatch = normalized.match(/Could not find the '([a-z0-9_]+)' column/i)
    || normalized.match(/schema cache.*'([a-z0-9_]+)'/i)
    || normalized.match(/column ['"]?([a-z0-9_]+)['"]? (?:of relation )?does not exist/i);
  const column = schemaCacheMatch?.[1] || "";
  return optionalColumns.includes(column) ? column : "";
}

function stripOptionalSupabaseColumns(table, row = {}) {
  const optionalColumns = optionalSupabaseWriteColumns[table] || [];
  if (!optionalColumns.length) return row;

  const nextRow = { ...row };
  optionalColumns.forEach((column) => {
    delete nextRow[column];
  });
  return nextRow;
}

function hasFieldValue(value, fieldName = "") {
  if (fieldName === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function compactFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields || {}).filter(([fieldName, value]) => hasFieldValue(value, fieldName))
  );
}

function mergeReviewedTitleFields(record = {}, explicitFields = {}) {
  const parsed = reviewedTitleRecordToMemoryRecord(record).fields || {};
  return {
    ...compactFields(parsed),
    ...compactFields(explicitFields)
  };
}

function isMissingRelationError(error) {
  return /read failed:\s*404\b|relation .* does not exist|could not find the table/i.test(String(error?.message || ""));
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
  fetchImpl = globalThis.fetch,
  allowOptionalColumnRetry = true
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
    if (allowOptionalColumnRetry && optionalSchemaColumnError({ table, message })) {
      const strippedRow = stripOptionalSupabaseColumns(table, row);
      if (Object.keys(strippedRow).length < Object.keys(row || {}).length) {
        return writeSupabaseRow({
          table,
          row: strippedRow,
          method,
          upsert,
          env,
          fetchImpl,
          allowOptionalColumnRetry: false
        });
      }
    }
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
  assetFingerprint = "",
  tenantId = ""
} = {}) {
  if (!isSupabaseFeedbackConfigured(env)) return [];
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedTenantId) return [];

  const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  let rows = [];

  try {
    rows = await readSupabaseRows({
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
        tenant_id: `eq.${normalizedTenantId}`,
        review_outcome: `in.(${approvedHistoryOutcomes.join(",")})`,
        ...(assetFingerprint ? { asset_fingerprint: `eq.${String(assetFingerprint).trim().toLowerCase()}` } : {}),
        approved_at: "not.is.null",
        order: "created_at.desc",
        limit: String(boundedLimit)
      },
      env,
      fetchImpl
    });
  } catch (error) {
    if (!isMissingRelationError(error) || assetFingerprint) throw error;
    rows = [];
  }

  if (!rows.length && !assetFingerprint) {
    return listLegacyApprovedTitleFeedbackRecords({
      env,
      fetchImpl,
      limit: boundedLimit,
      tenantId: normalizedTenantId
    });
  }

  return rows.map((row) => ({
    id: row.id,
    asset_id: row.asset_id || "",
    analysis_run_id: row.analysis_run_id || "",
    asset_fingerprint: row.asset_fingerprint || "",
    final_title: row.corrected_title || "",
    title: row.corrected_title || "",
    fields: mergeReviewedTitleFields({
      id: row.id,
      corrected_title: row.corrected_title || "",
      final_title: row.corrected_title || ""
    }, row.corrected_resolved_fields && typeof row.corrected_resolved_fields === "object"
      ? row.corrected_resolved_fields
      : {}),
    review_outcome: row.review_outcome || "",
    stable_training_sample: row.stable_training_sample === true,
    training_status: row.training_status || "",
    reusable_approved_title: row.reusable_approved_title === true,
    approved_at: row.approved_at || null,
    created_at: row.created_at || null
  }));
}

export async function listLegacyApprovedTitleFeedbackRecords({
  env = process.env,
  fetchImpl = globalThis.fetch,
  limit = 100,
  tenantId = ""
} = {}) {
  if (!isSupabaseFeedbackConfigured(env)) return [];
  if (String(tenantId || "").trim() !== LEGACY_TENANT_ID) return [];

  const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = await readSupabaseRows({
    table: feedbackTable,
    select: [
      "id",
      "generated_title",
      "corrected_title",
      "front_image_url",
      "back_image_url",
      "created_at"
    ].join(","),
    search: {
      corrected_title: "not.is.null",
      order: "created_at.desc",
      limit: String(boundedLimit)
    },
    env,
    fetchImpl
  });

  return rows
    .map((row) => {
      const record = reviewedTitleRecordToMemoryRecord({
        id: row.id,
        source_feedback_id: row.id,
        corrected_title: row.corrected_title || "",
        final_title: row.corrected_title || "",
        review_outcome: "TITLE_ONLY_OVERRIDE",
        training_status: "legacy_feedback_title_parsed_local",
        stable_training_sample: false
      });

      return {
        ...record,
        asset_id: "",
        analysis_run_id: "",
        asset_fingerprint: "",
        generated_title: row.generated_title || "",
        final_title: row.corrected_title || "",
        title: row.corrected_title || "",
        fields: compactFields(record.fields || {}),
        review_outcome: "TITLE_ONLY_OVERRIDE",
        stable_training_sample: false,
        training_status: "legacy_feedback_title_parsed_local",
        reusable_approved_title: false,
        approved_at: row.created_at || null,
        created_at: row.created_at || null,
        legacy_feedback: true,
        image_urls_available: Boolean(row.front_image_url || row.back_image_url)
      };
    })
    .filter((record) => record.title && Object.keys(record.fields || {}).length > 0);
}
