import assert from "node:assert/strict";
import {
  checkApiRateLimit,
  clientRateLimitIdentifier,
  enforceApiRateLimit,
  resetApiRateLimitBuckets
} from "../lib/api-rate-limit.mjs";
import { callJsonHandler } from "../lib/listing/v4/session/http-handler-utils.mjs";
import csmResolutionViewHandler from "../api/csm-resolution-view.js";
import manualRecoveryHandler from "../api/listing-manual-recovery.js";

function makeRequest(headers = {}) {
  return {
    headers,
    socket: {
      remoteAddress: "127.0.0.1"
    }
  };
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };
}

const env = {
  METAVERSE_AUTH_SECRET: "test-secret"
};

resetApiRateLimitBuckets();
let result = checkApiRateLimit({
  req: makeRequest(),
  scope: "listing_title",
  limit: 2,
  windowMs: 60_000,
  env,
  now: 1_000,
  identifier: "client-a"
});
assert.equal(result.allowed, true);
assert.equal(result.remaining, 1);
assert.equal(result.identifier_source, "custom");

result = checkApiRateLimit({
  req: makeRequest(),
  scope: "listing_title",
  limit: 2,
  windowMs: 60_000,
  env,
  now: 2_000,
  identifier: "client-a"
});
assert.equal(result.allowed, true);
assert.equal(result.remaining, 0);

result = checkApiRateLimit({
  req: makeRequest(),
  scope: "listing_title",
  limit: 2,
  windowMs: 60_000,
  env,
  now: 3_000,
  identifier: "client-a"
});
assert.equal(result.allowed, false);
assert.equal(result.retryAfterSeconds, 58);

result = checkApiRateLimit({
  req: makeRequest(),
  scope: "listing_title",
  limit: 2,
  windowMs: 60_000,
  env,
  now: 62_000,
  identifier: "client-a"
});
assert.equal(result.allowed, true);
assert.equal(result.remaining, 1);

resetApiRateLimitBuckets();
const overrideEnv = {
  ...env,
  LISTING_TITLE_RATE_LIMIT: "1"
};
assert.equal(checkApiRateLimit({
  req: makeRequest(),
  scope: "listing_title",
  limit: 10,
  windowMs: 60_000,
  env: overrideEnv,
  now: 1_000,
  identifier: "client-b"
}).allowed, true);
assert.equal(checkApiRateLimit({
  req: makeRequest(),
  scope: "listing_title",
  limit: 10,
  windowMs: 60_000,
  env: overrideEnv,
  now: 2_000,
  identifier: "client-b"
}).allowed, false);

const networkClient = clientRateLimitIdentifier(makeRequest({
  "x-forwarded-for": "203.0.113.10, 10.0.0.1",
  "user-agent": "RateLimitTest"
}), env);
assert.equal(networkClient.source, "network");
assert.equal(networkClient.hash.length, 64);
assert.doesNotMatch(networkClient.hash, /203\.0\.113\.10/);

const sessionClient = clientRateLimitIdentifier(makeRequest({
  cookie: "lynca_metaverse_session=session-value.signature"
}), env);
assert.equal(sessionClient.source, "session");
assert.equal(sessionClient.hash.length, 64);
assert.doesNotMatch(sessionClient.hash, /session-value/);

resetApiRateLimitBuckets();
const req = makeRequest({
  "x-forwarded-for": "203.0.113.20",
  "user-agent": "RateLimitTest"
});
let res = makeResponse();
assert.equal(enforceApiRateLimit(req, res, {
  scope: "listing_feedback",
  limit: 1,
  windowMs: 60_000,
  env,
  now: 10_000
}), true);
assert.equal(res.headers["X-RateLimit-Limit"], "1");
assert.equal(res.headers["X-RateLimit-Remaining"], "0");

res = makeResponse();
assert.equal(enforceApiRateLimit(req, res, {
  scope: "listing_feedback",
  limit: 1,
  windowMs: 60_000,
  env,
  now: 11_000,
  message: "Custom throttle message."
}), false);
assert.equal(res.statusCode, 429);
assert.equal(res.headers["Retry-After"], "59");
assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
const body = JSON.parse(res.body);
assert.equal(body.ok, false);
assert.equal(body.code, "rate_limited");
assert.equal(body.message, "Custom throttle message.");
assert.equal(body.rate_limit.scope, "listing_feedback");
assert.equal(body.rate_limit.limit, 1);
assert.doesNotMatch(res.body, /test-secret|203\.0\.113\.20|session-value/);

// A limiter's boolean means "allowed". These endpoint-level cases lock the
// termination contract: an allowed request reaches the auth boundary and ends
// there, while a denied request ends at 429 before auth/body/database work.
const isolatedEnvKeys = [
  "API_RATE_LIMIT_CSM_RESOLUTION_VIEW_MAX",
  "API_RATE_LIMIT_LISTING_MANUAL_RECOVERY_MAX",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY"
];
const savedEnv = Object.fromEntries(isolatedEnvKeys.map((key) => [key, process.env[key]]));
try {
  process.env.API_RATE_LIMIT_CSM_RESOLUTION_VIEW_MAX = "1";
  process.env.API_RATE_LIMIT_LISTING_MANUAL_RECOVERY_MAX = "1";
  // Handler completion invokes best-effort telemetry. Keep this unit test
  // local even if a developer shell has production credentials configured.
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.SUPABASE_SECRET_KEY = "";

  for (const { handler, method, route } of [
    { handler: csmResolutionViewHandler, method: "GET", route: "/api/csm-resolution-view?asset_id=asset-1" },
    { handler: manualRecoveryHandler, method: "POST", route: "/api/listing-manual-recovery" }
  ]) {
    resetApiRateLimitBuckets();
    const headers = {
      "x-forwarded-for": "203.0.113.99",
      "user-agent": "rate-limit-handler-test"
    };
    const allowed = await callJsonHandler(handler, { method, headers });
    assert.equal(allowed.statusCode, 401,
      `${route}: allowed request must continue through auth and send a response`);
    assert.equal(allowed.body?.code, "AUTH_REQUIRED");

    const denied = await callJsonHandler(handler, { method, headers });
    assert.equal(denied.statusCode, 429,
      `${route}: denied request must terminate before auth/body/dependency work`);
    assert.equal(denied.body?.code, "rate_limited");
  }
} finally {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetApiRateLimitBuckets();
}

console.log("api rate limit tests passed");
