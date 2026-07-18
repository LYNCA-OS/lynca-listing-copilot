export const PROTECTED_APP_PATHS = Object.freeze([
  "/",
  "/index",
  "/index.html",
  "/app",
  "/app/",
  "/app/index",
  "/app/index.html"
]);

export const PRIVATE_DEPLOYMENT_PATH_PREFIXES = Object.freeze([
  "/.secrets",
  "/.github",
  "/.vercel",
  "/docs",
  "/scripts",
  "/lib",
  "/prompts",
  "/services",
  "/supabase",
  "/data",
  "/learning",
  "/animation-plans",
  "/artifacts",
  "/prototypes"
]);

export const PRIVATE_DEPLOYMENT_MATCHERS = Object.freeze(
  PRIVATE_DEPLOYMENT_PATH_PREFIXES.flatMap((prefix) => [prefix, `${prefix}/:path*`])
);

const protectedAppPaths = new Set(PROTECTED_APP_PATHS);

export function isProtectedAppPath(pathname) {
  return protectedAppPaths.has(String(pathname || ""));
}

export function isPrivateDeploymentPath(pathname) {
  const value = String(pathname || "");
  return PRIVATE_DEPLOYMENT_PATH_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`)
  );
}
