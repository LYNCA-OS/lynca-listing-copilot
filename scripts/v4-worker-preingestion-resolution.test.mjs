import assert from "node:assert/strict";
import { resolveCanonicalWorkerPreingestion } from "../api/v4/listing-copilot-title.js";
import { persistV4PreingestionBundle } from "../lib/listing/v4/session/session-store.mjs";

const tenantId = "tenant_worker_bundle";
const assetId = "asset_11111111-2222-4333-8444-555555555555";
const sessionId = "v4sess_worker_bundle";
const bundleId = "bundle_server_worker";
const bundle = {
  tenant_id: tenantId,
  bundle_id: bundleId,
  asset_id: assetId,
  source: "listing_copilot_background_prepare",
  status: "READY",
  images: [],
  derived_images: [],
  quality_summary: { image_count: 2 },
  initial_evidence: {},
  evidence_patches: [],
  crop_plan: [],
  bundle_version: "preingestion-bundle-v1",
  created_at: "2026-07-17T01:00:00.000Z",
  updated_at: "2026-07-17T01:01:00.000Z"
};

const calls = [];
const resolved = await resolveCanonicalWorkerPreingestion({
  payload: {
    tenant_id: tenantId,
    asset_id: assetId,
    images: [{ id: "canonical-image" }],
    preingestion_bundle_id: "bundle_browser_attacker",
    preingestionBundleId: "bundle_browser_attacker_alias",
    preingestion_bundle: { tenant_id: "tenant_victim" },
    preingestionBundle: { tenant_id: "tenant_victim_camel" },
    preingestion_bundle_used: true,
    preingestionBundleUsed: true,
    preingestion_summary: { forged: true },
    preingestionSummary: { forged: true },
    preingestionInitialEvidence: { forged: true },
    preingestionEvidencePatches: [{ forged: true }]
  },
  tenantId,
  assetId,
  sessionId,
  sessionRequestSummary: { image_count: 2, has_preingestion_bundle: false },
  readLatest: async (input) => {
    calls.push({ type: "read", input });
    return bundle;
  },
  persistMirror: async (input) => {
    calls.push({ type: "mirror", input });
    return { saved: true };
  },
  updateSession: async (input) => {
    calls.push({ type: "session", input });
    return { saved: true };
  }
});

assert.equal(resolved.found, true);
assert.equal(resolved.payload.preingestion_bundle_id, bundleId);
assert.equal(resolved.payload.preingestionBundleId, bundleId);
assert.equal(resolved.payload.preingestion_bundle_status, "READY");
assert.equal(resolved.payload.tenant_id, tenantId);
assert.equal(resolved.payload.preingestion_summary.bundle_id, bundleId);
assert.equal("preingestion_bundle" in resolved.payload, false);
assert.equal("preingestionBundle" in resolved.payload, false);
assert.equal("preingestionBundleUsed" in resolved.payload, false);
assert.equal("preingestionSummary" in resolved.payload, false);
assert.equal("preingestionInitialEvidence" in resolved.payload, false);
assert.equal("preingestionEvidencePatches" in resolved.payload, false);
assert.deepEqual(resolved.payload.images, [{ id: "canonical-image" }]);
assert.equal(calls[0].input.tenantId, tenantId);
assert.equal(calls[0].input.assetId, assetId);
assert.equal(calls[1].input.tenantId, tenantId);
assert.equal(calls[1].input.bundleId, bundleId);
assert.equal(calls[2].input.sessionId, sessionId);
assert.equal(calls[2].input.patch.preingestion_bundle_id, bundleId);
assert.deepEqual(calls[2].input.patch.request_summary, {
  image_count: 2,
  has_preingestion_bundle: true
});

const mismatched = await resolveCanonicalWorkerPreingestion({
  payload: { preingestion_bundle_id: "bundle_browser_attacker" },
  tenantId,
  assetId,
  sessionId,
  readLatest: async () => ({ ...bundle, tenant_id: "tenant_other" }),
  persistMirror: async () => assert.fail("cross-tenant bundle must not be mirrored"),
  updateSession: async () => assert.fail("cross-tenant bundle must not bind a session")
});
assert.equal(mismatched.found, false);
assert.equal(mismatched.mirror.reason, "bundle_scope_mismatch");
assert.equal("preingestion_bundle_id" in mismatched.payload, false);

let persistedRow = null;
const persistence = await persistV4PreingestionBundle({
  bundleId,
  tenantId,
  assetId,
  bundle,
  summary: { image_count: 2 },
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test"
  },
  fetchImpl: async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/v4_preingestion_bundles");
    assert.equal(init.method, "POST");
    persistedRow = JSON.parse(init.body);
    return new Response(JSON.stringify([persistedRow]), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  }
});
assert.equal(persistence.saved, true);
assert.equal(persistedRow.tenant_id, tenantId);
assert.equal(persistedRow.asset_id, assetId);
assert.equal(persistedRow.id, bundleId);

const rejectedPersistence = await persistV4PreingestionBundle({
  bundleId,
  tenantId,
  assetId,
  bundle: { ...bundle, tenant_id: "tenant_other" },
  fetchImpl: async () => assert.fail("tenant mismatch must fail before persistence")
});
assert.equal(rejectedPersistence.saved, false);
assert.equal(rejectedPersistence.error, "preingestion_bundle_tenant_mismatch");

console.log("V4 worker pre-ingestion resolution tests passed");
