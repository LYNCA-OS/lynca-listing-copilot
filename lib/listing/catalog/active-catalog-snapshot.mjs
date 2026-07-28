export const activeCatalogSnapshotTable = "listing_active_catalog_snapshot";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function config(env = process.env) {
  const url = clean(env.SUPABASE_URL).replace(/\/+$/, "");
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  return { url, key };
}

export async function readActiveCatalogSnapshotRevision({
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal = null,
  timeoutMs = 3_000
} = {}) {
  const { url, key } = config(env);
  if (!url || !key || typeof fetchImpl !== "function") {
    return { ok: false, revision: "", reason: "catalog_revision_store_unavailable" };
  }
  try {
    const endpoint = new URL(`${url}/rest/v1/${activeCatalogSnapshotTable}`);
    endpoint.searchParams.set("select", "revision,content_revision,updated_at");
    endpoint.searchParams.set("singleton", "eq.true");
    endpoint.searchParams.set("limit", "1");
    const boundedSignal = signal || (typeof AbortSignal?.timeout === "function"
      ? AbortSignal.timeout(Math.max(250, Math.min(10_000, Number(timeoutMs) || 3_000)))
      : undefined);
    const response = await fetchImpl(endpoint, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      ...(boundedSignal ? { signal: boundedSignal } : {})
    });
    if (!response?.ok) {
      return { ok: false, revision: "", reason: `catalog_revision_read_failed_${Number(response?.status) || 0}` };
    }
    let rows = [];
    try {
      rows = typeof response.json === "function"
        ? await response.json()
        : JSON.parse(await response.text() || "[]");
    } catch {
      return { ok: false, revision: "", reason: "catalog_revision_response_invalid" };
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    const revision = clean(row?.content_revision || row?.revision);
    return revision
      ? { ok: true, revision, updated_at: row.updated_at || null, reason: null }
      : { ok: false, revision: "", reason: "catalog_revision_missing" };
  } catch (error) {
    return {
      ok: false,
      revision: "",
      reason: error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "catalog_revision_read_timeout"
        : "catalog_revision_read_exception"
    };
  }
}

export async function attachActiveCatalogSnapshotRevision(payload = {}, options = {}) {
  const existing = clean(payload.active_catalog_snapshot_revision || payload.activeCatalogSnapshotRevision);
  if (existing && options.forceRefresh !== true) {
    return { payload, resolution: { ok: true, revision: existing, reason: "catalog_revision_already_attached" } };
  }
  const resolved = await readActiveCatalogSnapshotRevision(options);
  if (!resolved.ok) {
    delete payload.active_catalog_snapshot_revision;
    delete payload.activeCatalogSnapshotRevision;
    return { payload, resolution: resolved };
  }
  payload.active_catalog_snapshot_revision = resolved.revision;
  return { payload, resolution: resolved };
}
