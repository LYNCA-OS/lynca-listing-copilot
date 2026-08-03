import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { runDirectCsmAsset } from "../api/csm-listing-title.js";

const source = await readFile(new URL("../api/csm-listing-title.js", import.meta.url), "utf8");

assert.doesNotMatch(source, /from\s+["'][^"']*(?:listing-job|recognition-worker|vector)[^"']*["']/i,
  "the direct CSM endpoint must not import or invoke queue, Cloud Run worker, or vector paths");
assert.match(source, /cloud_run_calls:\s*0/, "the endpoint must make its zero Cloud Run boundary observable");
assert.match(source, /vector_calls:\s*0/, "the endpoint must make its zero vector boundary observable");

let paidCalls = 0;
await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    callProvider: async () => { paidCalls += 1; },
    dependencies: {
      checkReadiness: async () => ({ ready: false, reason: "registry_missing" }),
      readImages: async () => { throw new Error("must_not_read_images"); }
    }
  }),
  /csm_persistence_not_ready:registry_missing/,
  "an unavailable CSM trace store must fail before image reads and model spend"
);
assert.equal(paidCalls, 0, "readiness failure must incur zero paid provider calls");

const events = [];
const result = await runDirectCsmAsset({
  tenantId: "tenant-1",
  userId: "user-1",
  assetId: "asset-1",
  imageDetail: "original",
  callProvider: async () => { paidCalls += 1; return { ok: true }; },
  dependencies: {
    checkReadiness: async () => { events.push("readiness"); return { ready: true }; },
    readImages: async () => {
      events.push("images");
      return {
        asset_id: "asset-1",
        image_references: [{ objectPath: "tenant-1/a.jpg" }],
        images: [{ objectPath: "tenant-1/a.jpg", bucket: "cards", derived: false }]
      };
    },
    signImage: async () => { events.push("sign"); return "https://signed.invalid/a.jpg"; },
    createSessionId: () => "csmsess-test",
    createSession: async ({ routePlan }) => {
      events.push("session");
      assert.deepEqual(routePlan, { route: "CSM_THIN_DIRECT", route_reason: "cloud_run_retired" });
      return { persistence: { recognition_session: { saved: true } } };
    },
    runPath: async (input) => {
      events.push("model_and_csm");
      assert.equal(input.imageDetail, "original");
      assert.equal(input.model, "gpt-5.6-luna");
      assert.equal(input.effort, "low");
      assert.deepEqual(input.imageUrls, ["https://signed.invalid/a.jpg"]);
      return {
        title: "Test title",
        csm_persistence: { ok: true, atomic: true, session: { saved: true } }
      };
    }
  }
});

assert.equal(result.title, "Test title");
assert.deepEqual(events, ["readiness", "images", "sign", "session", "model_and_csm"],
  "the direct path must remain readiness -> originals -> durable session -> one model/CSM boundary");
assert.equal(paidCalls, 0, "the test seam must not accidentally call the real provider");

await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    callProvider: async () => ({ ok: true }),
    dependencies: {
      checkReadiness: async () => ({ ready: true }),
      readImages: async () => ({
        asset_id: "asset-1",
        image_references: [{ objectPath: "tenant-1/a.jpg" }],
        images: [{ objectPath: "tenant-1/a.jpg", bucket: "cards", derived: false }]
      }),
      signImage: async () => "https://signed.invalid/a.jpg",
      createSessionId: () => "csmsess-conflict",
      createSession: async () => ({ persistence: { recognition_session: { saved: true } } }),
      runPath: async () => ({
        title: "Must not escape",
        csm_persistence: { ok: false, code: "immutable_session_conflict", statusCode: 409 }
      })
    }
  }),
  (error) => error.message === "immutable_session_conflict" && error.statusCode === 409,
  "even an injected path cannot turn persistence failure into a usable response"
);

await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    callProvider: async () => ({ ok: true }),
    dependencies: {
      checkReadiness: async () => ({ ready: true }),
      readImages: async () => ({
        asset_id: "asset-1",
        image_references: [{ objectPath: "tenant-1/a.jpg" }],
        images: [{ objectPath: "tenant-1/a.jpg", bucket: "cards", derived: false }]
      }),
      signImage: async () => "https://signed.invalid/a.jpg",
      createSessionId: () => "csmsess-nonatomic",
      createSession: async () => ({ persistence: { recognition_session: { saved: true } } }),
      runPath: async () => ({
        title: "Non-atomic title",
        csm_persistence: { ok: true, atomic: false, statusCode: 200, session: { saved: true } }
      })
    }
  }),
  (error) => error.message === "csm_persistence_incomplete" && error.statusCode === 503,
  "the API must reject a successful-looking non-atomic transport"
);

console.log("CSM direct API tests passed");
