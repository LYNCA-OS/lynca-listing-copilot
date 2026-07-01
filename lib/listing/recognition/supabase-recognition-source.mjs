const defaultFeedbackTable = "listing_title_feedback";

function cleanText(value) {
  return String(value || "").trim();
}

function configured(env = process.env) {
  return Boolean(cleanText(env.SUPABASE_URL) && cleanText(env.SUPABASE_SERVICE_ROLE_KEY));
}

function supabaseHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

export function parseSupabaseStorageUrl(value = "") {
  const raw = cleanText(value);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const marker = "/storage/v1/object/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const suffix = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    const parts = suffix.split("/").filter(Boolean);
    if (parts.length < 3) return null;

    const access = parts[0];
    const bucket = parts[1];
    const objectPath = parts.slice(2).join("/");
    if (!bucket || !objectPath) return null;

    return {
      bucket,
      object_path: objectPath,
      access,
      source_url: raw
    };
  } catch {
    return null;
  }
}

export function storageImageFromFeedbackUrl({
  url,
  role,
  imageId,
  fallbackBucket = "",
  fallbackObjectPath = ""
} = {}) {
  const parsed = parseSupabaseStorageUrl(url);
  const objectPath = parsed?.object_path || cleanText(fallbackObjectPath) || cleanText(url);
  if (!objectPath) return null;

  return {
    image_id: imageId || role,
    object_path: objectPath,
    bucket: parsed?.bucket || cleanText(fallbackBucket) || null,
    role,
    capture_angle: "primary",
    has_glare: false,
    source_url: parsed?.source_url || cleanText(url) || null
  };
}

export function recognitionCandidateFromSupabaseFeedbackRow(row = {}, index = 0) {
  const id = cleanText(row.id || row.feedback_id || `feedback_${index + 1}`);
  const front = storageImageFromFeedbackUrl({
    url: row.front_image_url,
    role: "front_original",
    imageId: `${id}_front`,
    fallbackBucket: row.front_bucket,
    fallbackObjectPath: row.front_object_path
  });
  const back = storageImageFromFeedbackUrl({
    url: row.back_image_url,
    role: "back_original",
    imageId: `${id}_back`,
    fallbackBucket: row.back_bucket,
    fallbackObjectPath: row.back_object_path
  });
  const images = [front, back].filter(Boolean);

  return {
    asset_id: `supabase_feedback_${id}`,
    physical_card_id: `needs_review_${id}`,
    capture_session_id: images[0]?.object_path
      ? images[0].object_path.split("/").slice(0, -1).join("/") || `needs_review_${id}`
      : `needs_review_${id}`,
    source_feedback_id: id,
    split: null,
    images,
    category: "sports_card",
    ground_truth: {
      year: null,
      manufacturer: null,
      product: null,
      set: null,
      players: [],
      card_type: null,
      insert: null,
      parallel: null,
      variation: null,
      serial_number: null,
      collector_number: null,
      checklist_code: null,
      attributes: [],
      rc: false,
      first_bowman: false,
      auto: false,
      patch: false,
      relic: false,
      ssp: false,
      case_hit: false,
      one_of_one: false,
      grade_company: null,
      card_grade: null,
      auto_grade: null,
      grade_type: "UNKNOWN"
    },
    critical_fields: [],
    difficulty_tags: images.length >= 2 ? ["front_back", "needs_owner_review"] : ["front_only", "needs_owner_review"],
    ground_truth_sources: [],
    reviewed_by: ["needs_owner_review"],
    review_status: "NEEDS_REVIEW",
    notes: "Supabase feedback candidate. Corrected title is writer-reviewed title ground truth; field-level ground truth still requires image/card/official evidence.",
    source_titles: {
      generated_title: row.generated_title || null,
      corrected_title: row.corrected_title || null,
      corrected_title_is_reviewed_title_ground_truth: Boolean(row.corrected_title)
    },
    created_at: row.created_at || null,
    updated_at: row.created_at || null
  };
}

export function recognitionCandidatesFromSupabaseFeedbackRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(recognitionCandidateFromSupabaseFeedbackRow)
    .filter((item) => item.images.length > 0);
}

export async function fetchSupabaseFeedbackRows({
  env = process.env,
  fetchImpl = globalThis.fetch,
  table = defaultFeedbackTable,
  limit = 1000,
  offset = 0
} = {}) {
  if (!configured(env)) {
    return {
      ok: false,
      rows: [],
      reason: "supabase_not_configured"
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      rows: [],
      reason: "fetch_unavailable"
    };
  }

  const baseUrl = cleanText(env.SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = cleanText(env.SUPABASE_SERVICE_ROLE_KEY);
  const endpoint = new URL(`${baseUrl}/rest/v1/${table}`);
  endpoint.searchParams.set("select", "id,generated_title,corrected_title,front_image_url,back_image_url,operator_id,created_at");
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("offset", String(offset));

  const response = await fetchImpl(endpoint, {
    headers: supabaseHeaders(serviceRoleKey)
  });

  if (!response.ok) {
    return {
      ok: false,
      rows: [],
      reason: `supabase_rest_${response.status}`,
      message: (await response.text()).slice(0, 240)
    };
  }

  return {
    ok: true,
    rows: await response.json()
  };
}
