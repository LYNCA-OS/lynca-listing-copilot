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
  fetchImpl = globalThis.fetch
} = {}) {
  const { url, key } = config(env);
  if (!url || !key || typeof fetchImpl !== "function") {
    return { ok: false, revision: "", reason: "catalog_revision_store_unavailable" };
  }
  const endpoint = new URL(`${url}/rest/v1/${activeCatalogSnapshotTable}`);
  endpoint.searchParams.set("select", "revision,content_revision,updated_at");
  endpoint.searchParams.set("singleton", "eq.true");
  endpoint.searchParams.set("limit", "1");
  const response = await fetchImpl(endpoint, {
    headers: { apikey: key, authorization: `Bearer ${key}` }
  });
  if (!response.ok) {
    return { ok: false, revision: "", reason: `catalog_revision_read_failed_${response.status}` };
  }
  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  const revision = clean(row?.content_revision || row?.revision);
  return revision
    ? { ok: true, revision, updated_at: row.updated_at || null, reason: null }
    : { ok: false, revision: "", reason: "catalog_revision_missing" };
}

export async function attachActiveCatalogSnapshotRevision(payload = {}, options = {}) {
  const existing = clean(payload.active_catalog_snapshot_revision || payload.activeCatalogSnapshotRevision);
  if (existing) {
    return { payload, resolution: { ok: true, revision: existing, reason: "catalog_revision_already_attached" } };
  }
  const resolved = await readActiveCatalogSnapshotRevision(options);
  if (!resolved.ok) return { payload, resolution: resolved };
  payload.active_catalog_snapshot_revision = resolved.revision;
  return { payload, resolution: resolved };
}
