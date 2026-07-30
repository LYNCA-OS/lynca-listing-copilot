import assert from "node:assert/strict";
import { activeRecognitionContract } from "../api/v4/health.js";

const available = await activeRecognitionContract({
  env: {
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    OPENAI_LISTING_MODEL: "gpt-5-mini"
  },
  fetchImpl: async (url) => {
    assert.equal(url.hostname, "supabase.example.test");
    assert.equal(url.pathname, "/rest/v1/listing_active_catalog_snapshot");
    return {
      ok: true,
      async json() {
        return [{ revision: "catalog-snapshot-1", content_revision: "catalog-content-1" }];
      }
    };
  }
});
assert.equal(available.available, true);
assert.equal(available.active_catalog_snapshot_revision, "catalog-content-1");
assert.match(available.recognition_pipeline_fingerprint, /^[0-9a-f]{64}$/);
assert.equal(available.reason, null);

const unavailable = await activeRecognitionContract({ env: {}, fetchImpl: null });
assert.deepEqual(unavailable, {
  available: false,
  recognition_pipeline_fingerprint: null,
  active_catalog_snapshot_revision: null,
  reason: "catalog_revision_store_unavailable"
});

const failedRead = await activeRecognitionContract({
  env: {
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  fetchImpl: async () => { throw new Error("offline"); }
});
assert.equal(failedRead.available, false);
assert.equal(failedRead.recognition_pipeline_fingerprint, null);
assert.equal(failedRead.active_catalog_snapshot_revision, null);
assert.match(failedRead.reason, /^catalog_revision_read_failed:/);

console.log("health active recognition contract tests passed");
