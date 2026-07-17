const allowedAppPaths = new Set([
  "/",
  "/index",
  "/index.html",
  "/app",
  "/app/",
  "/app/index",
  "/app/index.html",
  "/register",
  "/register.html",
  "/app/register",
  "/app/register.html"
]);

export function normalizeLegacyUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function safeAppRedirectPath(value, origin = "https://listing.invalid") {
  const raw = String(value ?? "").trim();
  if (!raw || !raw.startsWith("/") || raw.includes("\\")) return "/";

  try {
    const base = new URL(origin);
    const target = new URL(raw, base);
    if (target.origin !== base.origin || !allowedAppPaths.has(target.pathname)) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
