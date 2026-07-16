import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import {
  normalizeLegacyUsername,
  safeAppRedirectPath
} from "../app/login-flow.mjs";
import {
  isProtectedAppPath,
  PROTECTED_APP_PATHS
} from "../lib/listing-route-access.mjs";
import {
  cookieName,
  createListingSessionToken,
  createSignedSessionToken
} from "../lib/listing-session.mjs";
import middleware, { config as middlewareConfig } from "../middleware.js";

const origin = "https://listing.example.test";

assert.equal(normalizeLegacyUsername(" Writer.Admin "), "writer.admin");
assert.equal(safeAppRedirectPath("/app?mode=writer#card-2", origin), "/app?mode=writer#card-2");
assert.equal(safeAppRedirectPath("//evil.example", origin), "/");
assert.equal(safeAppRedirectPath("/\\evil.example", origin), "/");
assert.equal(safeAppRedirectPath("/login", origin), "/", "authenticated login loops must not be accepted as return paths");
assert.equal(safeAppRedirectPath("/api/logout", origin), "/", "return paths are limited to the application surface");
assert.equal(safeAppRedirectPath("javascript:alert(1)", origin), "/");

for (const path of ["/", "/index", "/index.html", "/app", "/app/", "/app/index", "/app/index.html"]) {
  assert.equal(isProtectedAppPath(path), true, `${path} must be protected`);
}
assert.equal(isProtectedAppPath("/login"), false);
assert.equal(isProtectedAppPath("/app/login"), false);
assert.deepEqual(middlewareConfig.matcher, PROTECTED_APP_PATHS, "the static Vercel matcher must cover every protected alias");

const middlewareSource = fs.readFileSync(new URL("../middleware.js", import.meta.url), "utf8");
for (const path of PROTECTED_APP_PATHS) {
  assert.match(middlewareSource, new RegExp(`"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${path} must remain in the static Vercel matcher`);
}

const previousAuthSecret = process.env.METAVERSE_AUTH_SECRET;
process.env.METAVERSE_AUTH_SECRET = "auth-entrypoint-contract-secret";
try {
  const unauthenticated = await middleware(new Request(`${origin}/app?mode=writer`));
  assert.equal(unauthenticated.status, 302);
  assert.equal(unauthenticated.headers.get("location"), `${origin}/login?next=%2Fapp%3Fmode%3Dwriter`);

  const now = Date.now();
  const token = createSignedSessionToken({
    user: "preview-owner",
    sid: crypto.randomUUID(),
    iat: now,
    exp: now + 60_000
  }, process.env.METAVERSE_AUTH_SECRET);
  const authenticated = await middleware(new Request(`${origin}/app`, {
    headers: { cookie: `${cookieName}=${token}` }
  }));
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.headers.get("x-middleware-next"), "1");

  const tenantToken = createListingSessionToken({
    userId: "user_writer_1",
    tenantId: "tenant_customer_1",
    email: "writer@example.test",
    sessionVersion: 1
  }, process.env.METAVERSE_AUTH_SECRET, { now });
  const tenantAuthenticated = await middleware(new Request(`${origin}/app`, {
    headers: { cookie: `${cookieName}=${tenantToken}` }
  }));
  assert.equal(tenantAuthenticated.status, 200, "tenant sessions accepted by the API must also pass Edge middleware");
  assert.equal(tenantAuthenticated.headers.get("x-middleware-next"), "1");

  const malformed = await middleware(new Request(`${origin}/app`, {
    headers: { cookie: `${cookieName}=${token}.extra` }
  }));
  assert.equal(malformed.status, 302);
} finally {
  if (previousAuthSecret === undefined) delete process.env.METAVERSE_AUTH_SECRET;
  else process.env.METAVERSE_AUTH_SECRET = previousAuthSecret;
}

const loginHtml = fs.readFileSync(new URL("../app/login.html", import.meta.url), "utf8");
const loginJs = fs.readFileSync(new URL("../app/login.js", import.meta.url), "utf8");
const appHtml = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const sessionControls = fs.readFileSync(new URL("../app/session-controls.js", import.meta.url), "utf8");
const devServer = fs.readFileSync(new URL("../scripts/dev-server.mjs", import.meta.url), "utf8");
const vercelIgnore = fs.readFileSync(new URL("../.vercelignore", import.meta.url), "utf8");
const vercelConfig = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

assert.match(loginHtml, /MTV 管理员预览/);
assert.match(loginHtml, /不代表平台管理员权限/);
assert.match(loginHtml, /Track C 租户与会话权限接入后开放/);
assert.match(loginJs, /const password = form\.password\.value;/, "passwords must preserve case and surrounding characters");
assert.doesNotMatch(loginJs, /normalizeLegacyUsername\(form\.password\.value\)/);
assert.match(loginJs, /submitButton\.disabled = true/);
assert.match(appHtml, /id="sessionUserLabel"/);
assert.match(appHtml, /id="logoutButton"/);
assert.match(sessionControls, /method: "POST"/);
assert.match(sessionControls, /presentation only/);
assert.match(devServer, /import loginHandler from "\.\.\/api\/login\.js"/);
assert.match(devServer, /const protectedPaths = new Set\(PROTECTED_APP_PATHS\)/);
assert.doesNotMatch(devServer, /normalizeValue\(credentials\.password\)/, "local verification must use the production password contract");
assert.match(vercelIgnore, /^prototypes\/\*\*$/m, "prototype assets must stay out of every Vercel deployment");

const globalHeaders = vercelConfig.headers?.find((entry) => entry.source === "/(.*)")?.headers || [];
const headerMap = new Map(globalHeaders.map((header) => [header.key.toLowerCase(), header.value]));
const csp = headerMap.get("content-security-policy") || "";
const connectSources = csp
  .split(";")
  .map((directive) => directive.trim().split(/\s+/))
  .find(([name]) => name === "connect-src")
  ?.slice(1) || [];
assert.match(csp, /frame-ancestors 'none'/);
assert.deepEqual(connectSources, ["'self'", "https://*.supabase.co"]);
assert.equal(connectSources.includes("https:"), false, "CSP must not allow every HTTPS origin");
assert.equal(headerMap.get("x-content-type-options"), "nosniff");
assert.equal(headerMap.get("x-frame-options"), "DENY");
assert.equal(headerMap.get("strict-transport-security"), "max-age=31536000");

console.log("auth production entrypoint tests passed");
