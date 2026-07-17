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
assert.deepEqual(
  middlewareConfig.matcher,
  [...PROTECTED_APP_PATHS, "/api/:path*"],
  "the static Vercel matcher must cover protected aliases and the maintenance API gate"
);

const middlewareSource = fs.readFileSync(new URL("../middleware.js", import.meta.url), "utf8");
for (const path of PROTECTED_APP_PATHS) {
  assert.match(middlewareSource, new RegExp(`"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${path} must remain in the static Vercel matcher`);
}

const previousAuthSecret = process.env.METAVERSE_AUTH_SECRET;
const previousMaintenanceMode = process.env.LISTING_MAINTENANCE_MODE;
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

  const malformed = await middleware(new Request(`${origin}/app`, {
    headers: { cookie: `${cookieName}=${token}.extra` }
  }));
  assert.equal(malformed.status, 302);

  process.env.LISTING_MAINTENANCE_MODE = "true";
  const blockedMutation = await middleware(new Request(`${origin}/api/v4/listing-job-enqueue`, {
    method: "POST"
  }));
  assert.equal(blockedMutation.status, 503);
  assert.equal((await blockedMutation.json()).error_code, "LISTING_MAINTENANCE_MODE");
  assert.equal(blockedMutation.headers.get("retry-after"), "60");
  const readableStatus = await middleware(new Request(`${origin}/api/v4/health`));
  assert.equal(readableStatus.status, 200, "maintenance mode should preserve read-only health and status probes");
} finally {
  if (previousAuthSecret === undefined) delete process.env.METAVERSE_AUTH_SECRET;
  else process.env.METAVERSE_AUTH_SECRET = previousAuthSecret;
  if (previousMaintenanceMode === undefined) delete process.env.LISTING_MAINTENANCE_MODE;
  else process.env.LISTING_MAINTENANCE_MODE = previousMaintenanceMode;
}

const loginHtml = fs.readFileSync(new URL("../app/login.html", import.meta.url), "utf8");
const loginJs = fs.readFileSync(new URL("../app/login.js", import.meta.url), "utf8");
const appHtml = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const sessionControls = fs.readFileSync(new URL("../app/session-controls.js", import.meta.url), "utf8");
const devServer = fs.readFileSync(new URL("../scripts/dev-server.mjs", import.meta.url), "utf8");
const vercelIgnore = fs.readFileSync(new URL("../.vercelignore", import.meta.url), "utf8");
const vercelConfig = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

assert.match(loginHtml, /正式环境入口/);
assert.match(loginHtml, /请输入你的账号与密码进行登录/);
assert.doesNotMatch(loginHtml, /MTV 管理员预览|Track C 租户与会话权限接入后开放/, "the production entrypoint must not describe itself as a prototype");
assert.match(loginJs, /const password = form\.password\.value;/, "passwords must preserve case and surrounding characters");
assert.doesNotMatch(loginJs, /normalizeLegacyUsername\(form\.password\.value\)/);
assert.match(loginJs, /submitButton\.disabled = true/);
assert.match(appHtml, /id="sessionUserLabel"/);
assert.match(appHtml, /id="sessionControlStatus"/);
assert.match(appHtml, /id="logoutButton"/);
assert.match(appHtml, /src="\/app\/session-controls\.js"/);
assert.match(sessionControls, /method: "POST"/);
assert.match(sessionControls, /presentation only/);
assert.match(sessionControls, /response\.status === 401 \|\| \(response\.ok && session\.authenticated === false\)/, "only confirmed authentication failures may redirect");
assert.match(sessionControls, /if \(!response\.ok\)/, "transient session service failures must remain on the current page");
assert.match(devServer, /import loginHandler from "\.\.\/api\/login\.js"/);
assert.match(devServer, /import logoutHandler from "\.\.\/api\/logout\.js"/);
assert.match(devServer, /import sessionHandler from "\.\.\/api\/session\.js"/);
assert.match(devServer, /getSessionFromRequest\(request\)/);
assert.match(devServer, /const protectedPaths = new Set\(PROTECTED_APP_PATHS\)/);
for (const path of ["/app", "/app/", "/app/index", "/app/index.html"]) {
  assert.match(devServer, new RegExp(`\\["${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}", "app/index\\.html"\\]`), `${path} must resolve to the protected app shell locally`);
}
assert.doesNotMatch(devServer, /normalizeValue\(credentials\.password\)/, "local verification must use the production password contract");
assert.doesNotMatch(devServer, /createHmac|createSession\(|isValidSession\(/, "the local server must not carry a second authentication implementation");
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
