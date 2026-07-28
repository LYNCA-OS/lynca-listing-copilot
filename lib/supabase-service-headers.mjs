export function isLegacySupabaseServiceJwt(value) {
  const parts = String(value || "").trim().split(".");
  return parts.length === 3 && parts.every(Boolean);
}

export function isModernSupabaseSecretKey(value) {
  return String(value || "").trim().startsWith("sb_secret_");
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

export function supabaseRestAdminHeaders(serviceKey, extra = {}) {
  const key = String(serviceKey || "").trim();
  if (!key) throw new Error("Supabase service key is required.");

  const headers = {
    ...extra,
    apikey: key
  };
  delete headers.authorization;
  if (!isModernSupabaseSecretKey(key)) {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}
