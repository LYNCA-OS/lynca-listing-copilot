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
  "/prototypes",
  "/infrastructure",
  "/e2e",
  "/maintenance",
  "/AGENTS.md",
  "/playwright.config.mjs"
]);

export const PRIVATE_DEPLOYMENT_MATCHERS = Object.freeze(
  PRIVATE_DEPLOYMENT_PATH_PREFIXES.flatMap((prefix) => [prefix, `${prefix}/:path*`])
);

// These entrypoints remain in the repository only so an old immutable Vercel
// deployment can still be rolled back.  The active deployment must never send
// new work into the retired V4 queue, Cloud Run/OCR workers, vector sidecars,
// or the legacy title endpoint.  Returning 410 at the edge is cheaper and less
// ambiguous than letting a manually crafted request discover a stale worker.
export const RETIRED_LISTING_EXECUTION_PATHS = Object.freeze([
  "/api/listing-copilot-title",
  "/api/listing-preingest",
  "/api/listing-provider-status",
  "/api/admin-index-visual-vector-seed",
  "/api/v4/fast-scout-prewarm",
  "/api/v4/health",
  "/api/v4/listing-copilot-title",
  "/api/v4/listing-job-assign",
  "/api/v4/listing-job-enqueue",
  "/api/v4/listing-job-prewarm",
  "/api/v4/listing-job-pump",
  "/api/v4/listing-job-retry",
  "/api/v4/listing-job-status",
  "/api/v4/listing-job-worker",
  "/api/v4/listing-preingest",
  "/api/v4/listing-preingest-worker",
  "/api/v4/prewarm",
  "/api/workflow-sidecar-cleanlab",
  "/api/workflow-sidecar-fiftyone",
  "/api/workflow-sidecar-lightgbm",
  "/api/workflow-sidecar-phoenix",
  "/api/workflow-sidecar-splink"
]);

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

export function isRetiredListingExecutionPath(pathname) {
  const value = String(pathname || "").replace(/\/+$/, "") || "/";
  return RETIRED_LISTING_EXECUTION_PATHS.includes(value);
}
