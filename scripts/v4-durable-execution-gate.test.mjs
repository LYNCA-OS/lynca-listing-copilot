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
  operator_id: "user_manager",
  recognition_session_id: "session_durable_gate",
  asset_id: "asset_33333333-3333-4333-8333-333333333333",
  status: "RUNNING",
  lane: "BACKGROUND",
  job_type: "FINAL_ASSISTED_TITLE",
  lease_owner: "worker_gate",
  lease_expires_at: "2099-01-01T00:00:00.000Z",
  created_by_user_id: "user_manager",
  assigned_to_user_id: "user_writer",
  payload: {
    tenant_id: "tenant_a",
    operator_id: "user_manager",
    asset_id: "asset_33333333-3333-4333-8333-333333333333",
    client_asset_ref: "durable-gate-card",
    images: [{ id: "front", url: "https://images.example/card.jpg" }]
  }
};

const persistedSession = {
  id: persistedJob.recognition_session_id,
  tenant_id: persistedJob.tenant_id,
  user_id: persistedJob.operator_id,
  operator_id: persistedJob.operator_id,
  asset_id: persistedJob.asset_id,
  client_asset_ref: persistedJob.payload.client_asset_ref,
  status: "CREATED"
};

try {
  process.env.V4_JOB_WORKER_SECRET = "track-c-durable-worker-secret";
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "track-c-service-role";
  process.env.API_RATE_LIMIT_DISABLED = "true";
  process.env.OPENAI_API_KEY = "provider-must-not-be-called";

  {
    const providerCalls = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.origin !== "https://supabase.test") {
        providerCalls.push(url.href);
        throw new Error(`provider called before durable session: ${url.href}`);
      }
      if (url.pathname === "/rest/v1/rpc/fence_v4_recognition_job_execution" && init.method === "POST") {
        assert.deepEqual(JSON.parse(init.body), {
          p_job_id: persistedJob.id,
          p_worker_id: persistedJob.lease_owner,
          p_lease_seconds: 300
        });
        return jsonResponse(persistedJob);
      }
      if (["/rest/v1/request_logs", "/rest/v1/error_logs", "/rest/v1/production_events"].includes(url.pathname)) {
        return jsonResponse([], 201);
      }
      if (url.pathname === "/rest/v1/v4_recognition_sessions" && (!init.method || init.method === "GET")) {
        assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
        assert.equal(url.searchParams.get("operator_id"), "eq.user_manager");
        return jsonResponse([persistedSession]);
      }
      if (url.pathname === "/rest/v1/v4_recognition_sessions" && init.method === "PATCH") {
        return jsonResponse({ message: "session state update unavailable" }, 500);
      }
      throw new Error(`unexpected durable gate fetch: ${url.pathname}`);
    };

    const response = await callWorker({
      job_id: persistedJob.id,
      v4_queue_job_id: persistedJob.id,
      v4_queue_worker_id: persistedJob.lease_owner
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.retryable, true);
    assert.equal(response.body.error_code, "V4_SESSION_STATE_PERSISTENCE_FAILED");
    assert.deepEqual(providerCalls, [], "no provider call may start before critical session state is durable");
  }

  for (const scenario of [
    {
      name: "stale_owner",
      job: { ...persistedJob, lease_owner: "worker_new" },
      requestWorkerId: "worker_stale"
    },
    {
      name: "expired_lease",
      job: { ...persistedJob, lease_expires_at: "2000-01-01T00:00:00.000Z" },
      requestWorkerId: persistedJob.lease_owner
    },
    {
      name: "completed_job",
      job: { ...persistedJob, status: "L2_READY", lease_owner: null, lease_expires_at: null },
      requestWorkerId: persistedJob.lease_owner
    }
  ]) {
    let sessionWrites = 0;
    const providerCalls = [];
    let fenceChecks = 0;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.origin !== "https://supabase.test") {
        providerCalls.push(url.href);
        throw new Error(`provider called for ${scenario.name}: ${url.href}`);
      }
      if (url.pathname === "/rest/v1/rpc/fence_v4_recognition_job_execution" && init.method === "POST") {
        fenceChecks += 1;
        const rpc = JSON.parse(init.body);
        assert.equal(rpc.p_job_id, persistedJob.id);
        assert.equal(rpc.p_worker_id, scenario.requestWorkerId);
        return jsonResponse([]);
      }
      if (["/rest/v1/request_logs", "/rest/v1/error_logs", "/rest/v1/production_events"].includes(url.pathname)) {
        return jsonResponse([], 201);
      }
      if (url.pathname === "/rest/v1/v4_recognition_sessions") {
        sessionWrites += 1;
        return jsonResponse([], 500);
      }
      throw new Error(`unexpected lease gate fetch for ${scenario.name}: ${url.pathname}`);
    };

    const response = await callWorker({
      job_id: persistedJob.id,
      v4_queue_job_id: persistedJob.id,
      v4_queue_worker_id: scenario.requestWorkerId
    });
    assert.equal(response.statusCode, 409, `${scenario.name} must fail before execution`);
    assert.equal(response.body.error_code, "V4_WORKER_JOB_LEASE_FENCE_FAILED");
    assert.equal(response.body.retryable, false);
    assert.equal(fenceChecks, 1, `${scenario.name} must use the atomic execution-fence RPC`);
    assert.equal(sessionWrites, 0, `${scenario.name} must not write a recognition session`);
    assert.deepEqual(providerCalls, [], `${scenario.name} must not call a provider`);
  }
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("V4 durable execution gate tests passed");
