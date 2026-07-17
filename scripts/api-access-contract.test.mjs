import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function relativeApiFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? relativeApiFiles(absolute) : [absolute];
    })
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
    .sort();
}

function source(file) {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

// Public means intentionally callable without a user or internal credential.
// Keep this list small because it is the externally reachable attack surface.
const publicRoutes = Object.freeze([
  "api/health.js",
  "api/login.js",
  "api/logout.js",
  "api/v4/health.js"
]);

// Internal routes must authenticate a worker, cron, migration, or sidecar
// credential. They do not inherit a customer's role or tenant selection.
const internalSecretRoutes = Object.freeze([
  "api/admin-apply-catalog-self-exclusion-migration.js",
  "api/admin-apply-sem-definition-migration.js",
  "api/admin-apply-v4-noncritical-persistence-migration.js",
  "api/admin-apply-v4-production-job-queue-migration.js",
  "api/admin-apply-v4-writer-export-migration.js",
  "api/admin-apply-v4-writer-ready-capacity-migration.js",
  "api/admin-catalog-candidate-smoke.js",
  "api/admin-import-corrected-title-catalog.js",
  "api/admin-import-writer-title-catalog-seed.js",
  "api/admin-index-visual-vector-seed.js",
  "api/listing-storage-retention-cleanup.js",
  "api/v4/listing-job-pump.js",
  "api/v4/listing-job-worker.js",
  "api/v4/prewarm.js",
  "api/workflow-sidecar-cleanlab.js",
  "api/workflow-sidecar-fiftyone.js",
  "api/workflow-sidecar-lightgbm.js",
  "api/workflow-sidecar-phoenix.js",
  "api/workflow-sidecar-splink.js"
]);

// Commercial customer routes must reconstruct membership from the server and
// never authorize from a payload tenant id or a signed role claim.
const tenantAuthRoutes = Object.freeze([
  "api/ebay-card-listings.js",
  "api/ebay-dcsports87-listings.js",
  "api/ebay-seller-listings.js",
  "api/listing-asset-create.js",
  "api/listing-copilot-title.js",
  "api/listing-image-upload-url.js",
  "api/listing-image-verify-existing.js",
  "api/listing-image-verify-upload.js",
  "api/listing-preingest.js",
  "api/listing-provider-status.js",
  "api/listing-publish-draft.js",
  "api/listing-render-title.js",
  "api/listing-title-feedback.js",
  "api/session.js",
  "api/v4/fast-scout-prewarm.js",
  "api/v4/launch-gate-source-images.js",
  "api/v4/listing-copilot-title.js",
  "api/v4/listing-export-workbook.js",
  "api/v4/listing-feedback.js",
  "api/v4/listing-job-assign.js",
  "api/v4/listing-job-enqueue.js",
  "api/v4/listing-job-prewarm.js",
  "api/v4/listing-job-retry.js",
  "api/v4/listing-job-status.js",
  "api/v4/listing-preingest-worker.js",
  "api/v4/listing-preingest.js",
  "api/v4/listing-session-status.js",
  "api/v4/ops-snapshot.js",
  "api/v4/tenant-members.js",
  "api/v4/tenant-invitations.js",
  "api/v4/tenant-settings.js"
]);

const groups = {
  public: publicRoutes,
  internal_secret: internalSecretRoutes,
  tenant_auth: tenantAuthRoutes
};

const classified = Object.values(groups).flat();
assert.equal(new Set(classified).size, classified.length, "an API route must have exactly one access classification");

const actualApiFiles = relativeApiFiles(path.join(repoRoot, "api"));
assert.deepEqual(
  [...classified].sort(),
  actualApiFiles,
  "every api/**/*.js entrypoint must be explicitly classified before it ships"
);

const delegatedAccessSource = Object.freeze({
  "api/ebay-card-listings.js": "api/ebay-dcsports87-listings.js",
  "api/ebay-seller-listings.js": "api/ebay-dcsports87-listings.js"
});
for (const file of tenantAuthRoutes) {
  assert.match(source(delegatedAccessSource[file] || file), /\brequireTenantAccess\s*\(/, `${file} must call requireTenantAccess()`);
}

const internalGuardPatterns = Object.freeze({
  "api/listing-storage-retention-cleanup.js": /\bauthorizedCronRequest\s*\(/,
  "api/v4/listing-job-pump.js": /\b(?:isV4WorkerRequest|isV4CronRequest)\s*\(/,
  "api/v4/listing-job-worker.js": /\bisV4WorkerRequest\s*\(/,
  "api/v4/prewarm.js": /\b(?:isV4WorkerRequest|isV4CronRequest)\s*\(/
});
for (const file of internalSecretRoutes) {
  const routeSource = source(delegatedAccessSource[file] || file);
  const expected = internalGuardPatterns[file]
    || (/\bisV4WorkerRequest\s*\(/.test(routeSource)
      ? /\bisV4WorkerRequest\s*\(/
      : file.startsWith("api/workflow-sidecar-")
        ? /\bhandleInternalSidecar\s*\(/
        : file.startsWith("api/admin-apply-")
          ? /\bruntimeMigrationAuth\s*\(/
          : file.startsWith("api/admin-")
            ? /\b(?:platformAdminAuth|isPlatformAdminRequest)\s*\(/
            : /\bisV4WorkerRequest\s*\(/);
  assert.match(routeSource, expected, `${file} must retain its internal credential guard`);
}

for (const file of internalSecretRoutes.filter((route) => route.startsWith("api/admin-apply-"))) {
  const routeSource = source(file);
  assert.doesNotMatch(
    routeSource,
    /rejectUnauthorized\s*:\s*false|searchParams\.delete\(["']ssl(?:mode)?["']\)/,
    `${file} must preserve operator-managed PostgreSQL TLS verification`
  );
}

const sidecarSource = source("lib/data-loop/internal-sidecar-endpoints.mjs");
assert.match(sidecarSource, /\brequireInternalSidecarAuth\s*\(/, "sidecar delegate must authenticate its bearer token");
assert.match(
  sidecarSource,
  /const auth = requireInternalSidecarAuth\(req, env\);[\s\S]*if \(!auth\.ok\)/,
  "sidecar handler must fail closed before reading work"
);

for (const file of publicRoutes) {
  assert.doesNotMatch(source(file), /\brequireTenantAccess\s*\(/, `${file} is no longer public; reclassify it`);
}

assert.equal(actualApiFiles.length, 54);
assert.equal(publicRoutes.length, 4);
assert.equal(internalSecretRoutes.length, 19);
assert.equal(tenantAuthRoutes.length, 31);

console.log(JSON.stringify({
  ok: true,
  api_routes: actualApiFiles.length,
  classified: {
    public: publicRoutes.length,
    internal_secret: internalSecretRoutes.length,
    tenant_auth: tenantAuthRoutes.length
  },
  known_access_gaps: []
}, null, 2));
