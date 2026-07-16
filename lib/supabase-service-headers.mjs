export function isLegacySupabaseServiceJwt(value) {
  const parts = String(value || "").trim().split(".");
  return parts.length === 3 && parts.every(Boolean);
}

export function supabaseServiceHeaders(serviceRoleKey, extra = {}) {
  const key = String(serviceRoleKey || "").trim();
  if (!key) throw new Error("Supabase service key is required.");

  const headers = {
    ...extra,
    apikey: key
  };
  delete headers.authorization;
  if (isLegacySupabaseServiceJwt(key)) {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}
