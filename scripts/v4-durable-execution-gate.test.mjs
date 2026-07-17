import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler from "../api/v4/listing-copilot-title.js";
import { workerSecretHeader } from "../lib/listing/v4/jobs/worker-auth.mjs";

const trackedEnv = [
  "V4_JOB_WORKER_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "API_RATE_LIMIT_DISABLED",
  "OPENAI_API_KEY"
];
const originalEnv = Object.fromEntries(trackedEnv.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = String(value);
    },
    end(value = "") {
      this.body = String(value || "");
    }
  };
}

async function callWorker(payload) {
  const req = new EventEmitter();
  req.method = "POST";
  req.url = "/api/v4/listing-copilot-title";
  req.headers = {
    [workerSecretHeader]: process.env.V4_JOB_WORKER_SECRET,
    "x-request-id": `req-${payload.job_id}`
  };
  const res = responseRecorder();
  const running = handler(req, res);
  queueMicrotask(() => {
    req.emit("data", JSON.stringify(payload));
    req.emit("end");
  });
  await running;
  return { statusCode: res.statusCode, body: JSON.parse(res.body || "null") };
}

const persistedJob = {
  id: "job_durable_gate",
  tenant_id: "tenant_a",
  operator_id: "operator_a",
  recognition_session_id: "session_durable_gate",
  asset_id: "asset_12345678-1234-4123-8123-123456789abc",
  status: "RUNNING",
  lane: "BACKGROUND",
  job_type: "FINAL_ASSISTED_TITLE",
  lease_owner: "worker_gate",
  lease_expires_at: "2099-01-01T00:00:00.000Z",
  created_by_user_id: "user_manager",
  assigned_to_user_id: "user_writer",
  payload: {
    tenant_id: "tenant_a",
    asset_id: "asset_12345678-1234-4123-8123-123456789abc",
    client_asset_ref: "client-card-1",
    images: [{ id: "image-1", url: "https://images.example/card.jpg" }]
  }
};

const persistedSession = {
  id: persistedJob.recognition_session_id,
  tenant_id: persistedJob.tenant_id,
  operator_id: persistedJob.operator_id,
  asset_id: persistedJob.asset_id,
  user_id: "user_writer"
};

try {
  process.env.V4_JOB_WORKER_SECRET = "track-c-durable-worker-secret";
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "track-c-service-role";
  process.env.API_RATE_LIMIT_DISABLED = "true";
  process.env.OPENAI_API_KEY = "provider-must-not-be-called";

  const scenarios = [
    {
      name: "fence_transport_unavailable",
      fenceStatus: 503,
      fenceBody: { message: "database unavailable" },
      expectedStatus: 503,
      expectedCode: "V4_WORKER_JOB_LEASE_FENCE_FAILED",
      expectedRetryable: true,
      expectedSessionReads: 0
    },
    {
      name: "lease_not_live",
      fenceBody: null,
      expectedStatus: 409,
      expectedCode: "V4_WORKER_JOB_LEASE_FENCE_FAILED",
      expectedRetryable: false,
      expectedSessionReads: 0
    },
    {
      name: "fenced_job_identity_invalid",
      fenceBody: [{ ...persistedJob, asset_id: "legacy-asset-id" }],
      expectedStatus: 409,
      expectedCode: "V4_CANONICAL_ASSET_IDENTITY_REQUIRED",
      expectedRetryable: false,
      expectedSessionReads: 0
    },
    {
      name: "session_identity_unavailable",
      fenceBody: [persistedJob],
      sessionStatus: 503,
      sessionBody: { message: "session read unavailable" },
      expectedStatus: 503,
      expectedCode: "V4_WORKER_SESSION_IDENTITY_UNAVAILABLE",
      expectedRetryable: true,
      expectedSessionReads: 2
    },
    {
      name: "session_identity_mismatch",
      fenceBody: [persistedJob],
      sessionBody: [],
      expectedStatus: 409,
      expectedCode: "V4_WORKER_SESSION_IDENTITY_MISMATCH",
      expectedRetryable: false,
      expectedSessionReads: 1
    },
    {
      name: "session_asset_identity_mismatch",
      fenceBody: [persistedJob],
      sessionBody: [{
        ...persistedSession,
        asset_id: "asset_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      }],
      expectedStatus: 409,
      expectedCode: "V4_WORKER_SESSION_IDENTITY_MISMATCH",
      expectedRetryable: false,
      expectedSessionReads: 1
    },
    {
      name: "preingestion_bundle_bind_failed",
      fenceBody: [persistedJob],
      preingestionBundle: {
        tenant_id: persistedJob.tenant_id,
        bundle_id: "bundle_durable_gate",
        asset_id: persistedJob.asset_id,
        source: "listing_copilot_background_prepare",
        status: "READY",
        images: [],
        derived_images: [],
        quality_summary: {},
        initial_evidence: {},
        evidence_patches: [],
        crop_plan: [],
        bundle_version: "preingestion-bundle-v1"
      },
      expectedStatus: 503,
      expectedCode: "V4_PREINGESTION_SESSION_BIND_FAILED",
      expectedRetryable: true,
      expectedSessionReads: 1,
      expectedMirrorWrites: 1
    },
    {
      name: "observing_update_unavailable",
      fenceBody: [persistedJob],
      expectedStatus: 503,
      expectedCode: "V4_SESSION_STATE_PERSISTENCE_FAILED",
      expectedRetryable: true,
      expectedSessionReads: 1,
      expectedSessionWrites: 3
    }
  ];

  for (const scenario of scenarios) {
    const providerCalls = [];
    let sessionReads = 0;
    let sessionWrites = 0;
    let mirrorWrites = 0;
    let fenceCalls = 0;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.origin !== "https://supabase.test") {
        providerCalls.push(url.href);
        throw new Error(`provider called before durable gate for ${scenario.name}: ${url.href}`);
      }
      if (url.pathname === "/rest/v1/rpc/fence_v4_recognition_job_execution" && init.method === "POST") {
        fenceCalls += 1;
        assert.deepEqual(JSON.parse(init.body), {
          p_job_id: persistedJob.id,
          p_worker_id: persistedJob.lease_owner,
          p_lease_seconds: 300
        });
        return jsonResponse(scenario.fenceBody, scenario.fenceStatus || 200);
      }
      if (url.pathname === "/rest/v1/v4_recognition_sessions" && (!init.method || init.method === "GET")) {
        sessionReads += 1;
        return jsonResponse(
          scenario.sessionBody === undefined ? [persistedSession] : scenario.sessionBody,
          scenario.sessionStatus || 200
        );
      }
      if (url.pathname === "/rest/v1/v4_recognition_sessions") {
        sessionWrites += 1;
        return jsonResponse({ message: "unexpected session write" }, 500);
      }
      if (url.pathname === "/rest/v1/preingestion_bundles" && (!init.method || init.method === "GET")) {
        return jsonResponse(scenario.preingestionBundle ? [scenario.preingestionBundle] : []);
      }
      if (url.pathname === "/rest/v1/v4_preingestion_bundles" && init.method === "POST") {
        mirrorWrites += 1;
        return jsonResponse({ message: "bundle mirror unavailable" }, 500);
      }
      if (["/rest/v1/request_logs", "/rest/v1/error_logs", "/rest/v1/production_events"].includes(url.pathname)) {
        return jsonResponse([], 201);
      }
      throw new Error(`unexpected durable gate fetch for ${scenario.name}: ${url.pathname}`);
    };

    const response = await callWorker({
      job_id: persistedJob.id,
      v4_queue_job_id: persistedJob.id,
      v4_queue_worker_id: persistedJob.lease_owner
    });
    assert.equal(response.statusCode, scenario.expectedStatus, scenario.name);
    assert.equal(response.body.error_code, scenario.expectedCode, scenario.name);
    assert.equal(response.body.retryable, scenario.expectedRetryable, scenario.name);
    assert.equal(fenceCalls, 1, `${scenario.name} must use the atomic execution fence exactly once`);
    assert.equal(sessionReads, scenario.expectedSessionReads, `${scenario.name} session read count`);
    assert.equal(sessionWrites, scenario.expectedSessionWrites || 0, `${scenario.name} session write count`);
    assert.equal(mirrorWrites, scenario.expectedMirrorWrites || 0, `${scenario.name} bundle mirror write count`);
    assert.deepEqual(providerCalls, [], `${scenario.name} must not call a paid provider`);
  }
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("V4 durable execution gate tests passed");
