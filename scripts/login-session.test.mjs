import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import loginHandler from "../api/login.js";
import logoutHandler from "../api/logout.js";
import sessionHandler from "../api/session.js";
import {
  createSignedSessionToken,
  readSignedSession,
  timingSafeStringEqual
} from "../lib/listing-session.mjs";

function makeRequest(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = "POST";
  req.headers = {
    host: "example.test",
    "x-forwarded-proto": "https",
    "content-type": "application/json"
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
    username: "metaverse",
    password: "mtv"
  }), res);
  assert.equal(res.statusCode, 200);
  const cookie = String(res.headers["set-cookie"] || "");
  assert.match(cookie, /lynca_metaverse_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.equal(res.headers["cache-control"], "no-store");
  const token = cookie.match(/lynca_metaverse_session=([^;]+)/)?.[1] || "";
  const [payload] = token.split(".");
  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(session.user, "metaverse");
  assert.match(session.sid, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof session.iat, "number");
  assert.equal(typeof session.exp, "number");
  return { cookie, session };
}

async function loginWith(body) {
  const res = makeResponse();
  await loginHandler(makeRequest(body), res);
  return res;
}

const previousEnv = {
  METAVERSE_USERNAME: process.env.METAVERSE_USERNAME,
  METAVERSE_EMAIL: process.env.METAVERSE_EMAIL,
  METAVERSE_PASSWORD: process.env.METAVERSE_PASSWORD,
  METAVERSE_AUTH_SECRET: process.env.METAVERSE_AUTH_SECRET,
  API_RATE_LIMIT_DISABLED: process.env.API_RATE_LIMIT_DISABLED,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
};
const previousFetch = globalThis.fetch;

process.env.METAVERSE_USERNAME = "metaverse";
process.env.METAVERSE_EMAIL = "metaverse@example.test";
process.env.METAVERSE_PASSWORD = "mtv";
process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.API_RATE_LIMIT_DISABLED = "1";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/tenant_members")) {
    assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_legacy");
    assert.equal(url.searchParams.get("user_id"), "eq.user_legacy");
    return new Response(JSON.stringify([{
      tenant_id: "tenant_legacy",
      user_id: "user_legacy",
      role: "OWNER",
      status: "ACTIVE",
      disabled_at: null,
      user: {
        id: "user_legacy",
        email: "metaverse@example.test",
        status: "ACTIVE",
        session_version: 1,
        disabled_at: null,
        auth_user_id: null
      },
      tenant: {
        id: "tenant_legacy",
        name: "Legacy shared workspace",
        plan: "pilot",
        status: "ACTIVE",
        disabled_at: null
      }
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
};

try {
  const first = await login();
  const second = await login();
  assert.notEqual(first.cookie, second.cookie);
  assert.notEqual(first.session.sid, second.session.sid);
  const token = first.cookie.match(/lynca_metaverse_session=([^;]+)/)?.[1] || "";
  assert.equal(readSignedSession(token, process.env.METAVERSE_AUTH_SECRET)?.user, "metaverse");
  assert.equal(readSignedSession(`${token}.extra`, process.env.METAVERSE_AUTH_SECRET), null, "tokens with extra segments must fail closed");
  const tamperedToken = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
  assert.equal(readSignedSession(tamperedToken, process.env.METAVERSE_AUTH_SECRET), null, "tampered signatures must fail closed");
  const now = Date.now();
  const incompleteClaims = createSignedSessionToken({ user: "metaverse", exp: now + 60_000 }, process.env.METAVERSE_AUTH_SECRET);
  assert.equal(readSignedSession(incompleteClaims, process.env.METAVERSE_AUTH_SECRET), null, "signed but incomplete claims must fail closed");
  const futureClaims = createSignedSessionToken({
    user: "metaverse",
    sid: crypto.randomUUID(),
    iat: now + 10 * 60_000,
    exp: now + 20 * 60_000
  }, process.env.METAVERSE_AUTH_SECRET);
  assert.equal(readSignedSession(futureClaims, process.env.METAVERSE_AUTH_SECRET), null, "far-future sessions must fail closed");
  const overlongClaims = createSignedSessionToken({
    user: "metaverse",
    sid: crypto.randomUUID(),
    iat: now,
    exp: now + 8 * 24 * 60 * 60_000
  }, process.env.METAVERSE_AUTH_SECRET);
  assert.equal(readSignedSession(overlongClaims, process.env.METAVERSE_AUTH_SECRET), null, "legacy sessions must remain bounded to one week");
  assert.equal(timingSafeStringEqual("same", "same"), true);
  assert.equal(timingSafeStringEqual("short", "different-length"), false);
  const wrongPasswordCase = await loginWith({ username: "METAVERSE", password: "MTV" });
  assert.equal(wrongPasswordCase.statusCode, 401, "username may be case-insensitive but passwords must remain case-sensitive");

  const requestCookie = first.cookie.split(";")[0];
  const sessionResponse = makeResponse();
  await sessionHandler({ method: "GET", headers: { cookie: requestCookie } }, sessionResponse);
  assert.equal(sessionResponse.statusCode, 200);
  assert.equal(sessionResponse.headers["cache-control"], "no-store");
  const sessionBody = JSON.parse(sessionResponse.body);
  assert.equal(sessionBody.authenticated, true);
  assert.equal(sessionBody.user, "metaverse@example.test");
  assert.equal(sessionBody.user_id, "user_legacy");
  assert.equal(sessionBody.tenant_id, "tenant_legacy");
  assert.equal(sessionBody.role, "OWNER");
  assert.equal(sessionBody.expires_at, first.session.exp);

  const invalidSessionMethod = makeResponse();
  await sessionHandler({ method: "POST", headers: { cookie: requestCookie } }, invalidSessionMethod);
  assert.equal(invalidSessionMethod.statusCode, 405);
  assert.equal(invalidSessionMethod.headers.allow, "GET, HEAD");

  const crossSiteLogout = makeResponse();
  logoutHandler({
    method: "POST",
    headers: {
      host: "example.test",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
      "x-forwarded-proto": "https"
    }
  }, crossSiteLogout);
  assert.equal(crossSiteLogout.statusCode, 403);

  const missingBrowserContext = makeResponse();
  logoutHandler({ method: "POST", headers: { host: "example.test" } }, missingBrowserContext);
  assert.equal(missingBrowserContext.statusCode, 403);

  const logoutResponse = makeResponse();
  logoutHandler({
    method: "POST",
    headers: {
      host: "example.test",
      origin: "https://example.test",
      "sec-fetch-site": "same-origin",
      "x-forwarded-proto": "https"
    }
  }, logoutResponse);
  assert.equal(logoutResponse.statusCode, 200);
  assert.equal(logoutResponse.headers["cache-control"], "no-store");
  assert.match(logoutResponse.headers["set-cookie"], /Max-Age=0/);
  assert.match(logoutResponse.headers["set-cookie"], /Secure/);

  const invalidLogoutMethod = makeResponse();
  logoutHandler({ method: "GET", headers: { host: "example.test" } }, invalidLogoutMethod);
  assert.equal(invalidLogoutMethod.statusCode, 405);
  assert.equal(invalidLogoutMethod.headers.allow, "POST");
  console.log("login session tests passed");
} finally {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
