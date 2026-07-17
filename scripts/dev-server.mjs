import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import loginHandler from "../api/login.js";
import logoutHandler from "../api/logout.js";
import sessionHandler from "../api/session.js";
import { PROTECTED_APP_PATHS } from "../lib/listing-route-access.mjs";
import { getSessionFromRequest } from "../lib/listing-session.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 3000);

loadLocalEnv();

const aliases = new Map([
  ["/", "app/index.html"],
  ["/index.html", "app/index.html"],
  ["/app", "app/index.html"],
  ["/app/", "app/index.html"],
  ["/app/index", "app/index.html"],
  ["/app/index.html", "app/index.html"],
  ["/login", "app/login.html"],
  ["/login.html", "app/login.html"],
  ["/register", "app/register.html"],
  ["/register.html", "app/register.html"],
  ["/register.js", "app/register.js"]
]);

const protectedPaths = new Set(PROTECTED_APP_PATHS);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function loadLocalEnv() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/listing-copilot-title") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-copilot-title.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/listing-title-feedback") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-title-feedback.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/listing-provider-status") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-provider-status.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/listing-image-upload-url") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-image-upload-url.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/listing-image-verify-upload") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-image-verify-upload.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/listing-image-verify-existing") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-image-verify-existing.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/listing-render-title") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-render-title.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/v4/tenant-invitations") {
    const moduleUrl = pathToFileURL(join(root, "api/v4/tenant-invitations.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/listing-publish-draft") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-publish-draft.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/listing-storage-retention-cleanup") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-storage-retention-cleanup.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/session") {
    await sessionHandler(request, response);
    return true;
  }

  if (pathname === "/api/logout") {
    await logoutHandler(request, response);
    return true;
  }

  if (pathname === "/api/login") {
    await loginHandler(request, response);
    return true;
  }

  return false;
}

function resolvePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const target = aliases.get(pathname) || pathname.replace(/^\/+/, "");
  const normalized = normalize(target);
  if (normalized.startsWith("..")) return null;
  return join(root, normalized);
}

createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://localhost:${port}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (await handleApi(request, response, pathname)) return;

  if (protectedPaths.has(pathname)) {
    if (!getSessionFromRequest(request)) {
      response.writeHead(302, { location: `/login?next=${encodeURIComponent(`${pathname}${requestUrl.search}`)}` });
      response.end();
      return;
    }
  }

  const filePath = resolvePath(request.url || "/");
  if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Metaverse Listing Copilot running at http://localhost:${port}`);
});
