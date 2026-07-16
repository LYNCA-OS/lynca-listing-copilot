function clean(value) {
  return String(value ?? "").trim();
}
function isLoopback(hostname = "") {
  const value = clean(hostname).toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function validatedOrigin(value, { allowLoopbackHttp = true } = {}) {
  const raw = clean(value);
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const secure = parsed.protocol === "https:";
  const localHttp = allowLoopbackHttp && parsed.protocol === "http:" && isLoopback(parsed.hostname);
  if (!secure && !localHttp) return "";
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
  return parsed.origin;
}

// Internal requests carry the global worker secret, so their destination must
// come only from trusted deployment configuration. Never derive this origin
// from Host/X-Forwarded-Host on a customer request.
export function trustedInternalServiceOrigin(env = process.env) {
  const explicit = validatedOrigin(env.V4_INTERNAL_BASE_URL || env.LYNCA_INTERNAL_BASE_URL);
  if (explicit) return explicit;

  const deployment = validatedOrigin(env.VERCEL_URL);
  if (deployment) return deployment;

  const production = validatedOrigin(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (production) return production;

  const port = Number.parseInt(clean(env.PORT), 10);
  if (Number.isFinite(port) && port > 0 && port <= 65_535) {
    return `http://127.0.0.1:${port}`;
  }
  return "";
}
