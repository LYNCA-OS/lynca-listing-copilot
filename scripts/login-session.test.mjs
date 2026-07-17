import assert from "node:assert/strict";
import { Readable } from "node:stream";
import loginHandler from "../api/login.js";
import logoutHandler from "../api/logout.js";
import sessionHandler from "../api/session.js";
import {
  listingSessionCookieIsSecure,
  readSignedSession
} from "../lib/listing-session.mjs";

const membership = Object.freeze({
  tenant_id: "tenant_legacy",
  user_id: "user_legacy",
  role: "OWNER",
  status: "ACTIVE",
  disabled_at: null,
  user: Object.freeze({
    id: "user_legacy",
    email: "admin@example.test",
    status: "ACTIVE",
    session_version: 1,
    disabled_at: null,
    auth_user_id: null
  }),
  tenant: Object.freeze({
    id: "tenant_legacy",
    name: "Legacy production tenant",
    plan: "production",
    status: "ACTIVE",
    disabled_at: null
  })
});

function makeRequest({ method = "GET", path = method === "POST" ? "/api/login" : "/api/session", body, headers = {} } = {}) {
  const req = body === undefined ? Readable.from([]) : Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = path;
  req.headers = {
    host: "example.test",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...headers
  };
  return req;
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value) {
      this.body = value || "";
    }
  };
}

async function login() {
  const res = makeResponse();
  await loginHandler(makeRequest({
    method: "POST",
    body: { username: "metaverse", password: "mtv" }
  }), res);
  assert.equal(res.statusCode, 200);
  const cookie = String(res.headers["set-cookie"] || "");
  assert.match(cookie, /lynca_metaverse_session=/);
  assert.doesNotMatch(cookie, /; Secure(?:;|$)/, "vercel dev HTTP must receive a browser-storable cookie");
  const token = cookie.match(/lynca_metaverse_session=([^;]+)/)?.[1] || "";
  const [payload] = token.split(".");
  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(session.user, "metaverse");
  assert.equal(session.user_id, "user_legacy");
  assert.equal(session.tenant_id, "tenant_legacy");
  assert.equal(session.email, "admin@example.test");
  assert.equal(session.session_version, 1);
  assert.match(session.sid, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof session.iat, "number");
  assert.equal(typeof session.exp, "number");
  return { cookie, session };
}

async function loginWith(body) {
  const res = makeResponse();
  await loginHandler(makeRequest({ method: "POST", body }), res);
  return res;
}

async function readSession(cookie = "") {
  const res = makeResponse();
  const cookieHeader = String(cookie).split(";")[0];
  await sessionHandler(makeRequest({
    method: "GET",
    headers: cookieHeader ? { cookie: cookieHeader } : {}
  }), res);
  return {
    res,
    payload: res.body ? JSON.parse(res.body) : {}
  };
}

async function logout(cookie) {
  const res = makeResponse();
  const cookieHeader = String(cookie).split(";")[0];
  await logoutHandler(makeRequest({
    method: "POST",
    path: "/api/logout",
    body: {},
    headers: {
      cookie: cookieHeader,
      origin: "http://example.test",
      "sec-fetch-site": "same-origin"
    }
  }), res);
  return res;
}

const previousEnv = Object.fromEntries([
  "METAVERSE_USERNAME",
  "METAVERSE_PASSWORD",
  "METAVERSE_EMAIL",
  "METAVERSE_AUTH_SECRET",
  "API_RATE_LIMIT_DISABLED",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VERCEL",
  "VERCEL_ENV"
].map((key) => [key, process.env[key]]));
const previousFetch = globalThis.fetch;
const membershipRequests = [];
let membershipAvailable = true;

process.env.METAVERSE_USERNAME = "metaverse";
process.env.METAVERSE_PASSWORD = "mtv";
process.env.METAVERSE_EMAIL = "admin@example.test";
process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.API_RATE_LIMIT_DISABLED = "1";
process.env.SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test_only";
process.env.VERCEL = "1";
process.env.VERCEL_ENV = "development";
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === "/rest/v1/tenant_members") {
    membershipRequests.push(url);
    if (!membershipAvailable) throw new Error("simulated_supabase_outage");
    return new Response(JSON.stringify([membership]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (["/rest/v1/request_logs", "/rest/v1/error_logs"].includes(url.pathname)) {
    return new Response("", { status: 201 });
  }
  throw new Error(`unexpected auth test fetch: ${url}`);
};

try {
  assert.equal(listingSessionCookieIsSecure({ headers: {}, socket: {} }, {
    VERCEL: "1",
    VERCEL_ENV: "development"
  }), false, "vercel dev over HTTP must not emit a Secure cookie");
  assert.equal(listingSessionCookieIsSecure({ headers: {}, socket: {} }, {
    VERCEL: "1",
    VERCEL_ENV: "production"
  }), true, "Vercel production cookies must remain Secure");
  assert.equal(listingSessionCookieIsSecure({ headers: {}, socket: {} }, {
    VERCEL: "1",
    VERCEL_ENV: "preview"
  }), true, "Vercel preview cookies must remain Secure");
  assert.equal(listingSessionCookieIsSecure({
    headers: { "x-forwarded-proto": "https" },
    socket: {}
  }, {
    LYNCA_TRUST_PROXY_PROTO: "1"
  }), true, "an explicitly trusted TLS proxy may emit a Secure cookie");

  const first = await login();
  const second = await login();
  assert.notEqual(first.cookie, second.cookie);
  assert.notEqual(first.session.sid, second.session.sid);
  const token = first.cookie.match(/lynca_metaverse_session=([^;]+)/)?.[1] || "";
  assert.equal(readSignedSession(token, process.env.METAVERSE_AUTH_SECRET)?.user, "metaverse");
  const tamperedToken = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
  assert.equal(readSignedSession(tamperedToken, process.env.METAVERSE_AUTH_SECRET), null, "tampered signatures must fail closed");

  const activeSession = await readSession(first.cookie);
  assert.equal(activeSession.res.statusCode, 200);
  assert.equal(activeSession.payload.authenticated, true, "the cookie issued by login must survive the next session read");
  assert.equal(activeSession.payload.user_id, "user_legacy");
  assert.equal(activeSession.payload.tenant_id, "tenant_legacy");
  assert.equal(activeSession.payload.user, "admin@example.test");
  assert.equal(activeSession.payload.role, "OWNER");
  assert.equal(activeSession.payload.tenant_name, "Legacy production tenant");
  assert.ok(activeSession.payload.permission_scopes.CREATE_JOB, "the session must project persisted tenant permissions");

  const logoutResponse = await logout(first.cookie);
  assert.equal(logoutResponse.statusCode, 200);
  assert.match(String(logoutResponse.headers["set-cookie"] || ""), /Max-Age=0/);
  assert.doesNotMatch(String(logoutResponse.headers["set-cookie"] || ""), /; Secure(?:;|$)/, "vercel dev must be able to clear the same non-Secure cookie it issued");

  const unauthenticated = await readSession();
  assert.equal(unauthenticated.res.statusCode, 200);
  assert.deepEqual(unauthenticated.payload, { authenticated: false });

  membershipAvailable = false;
  const unavailable = await readSession(first.cookie);
  assert.equal(unavailable.res.statusCode, 503, "a membership-store outage must not masquerade as a signed-out session");
  assert.equal(unavailable.payload.authenticated, false);
  assert.equal(unavailable.payload.code, "AUTH_UNAVAILABLE");
  membershipAvailable = true;

  const wrongPasswordCase = await loginWith({ username: "METAVERSE", password: "MTV" });
  assert.equal(wrongPasswordCase.statusCode, 401, "username may be case-insensitive but passwords must remain case-sensitive");

  assert.ok(membershipRequests.length >= 3, "login and session reads must both revalidate persisted membership");
  for (const url of membershipRequests) {
    assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_legacy");
    assert.equal(url.searchParams.get("user_id"), "eq.user_legacy");
  }
  console.log("login session tests passed");
} finally {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
