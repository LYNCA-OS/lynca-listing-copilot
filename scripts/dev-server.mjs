import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";

const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const cookieName = "lynca_metaverse_session";
const maxAgeSeconds = 60 * 60 * 24 * 7;

loadLocalEnv();

const aliases = new Map([
  ["/", "app/index.html"],
  ["/index.html", "app/index.html"],
  ["/login", "app/login.html"],
  ["/login.html", "app/login.html"]
]);

const protectedPaths = new Set(["/", "/index.html"]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
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

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return ["", ""];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key, value]) => key && value)
  );
}

function sign(value) {
  return createHmac("sha256", process.env.METAVERSE_AUTH_SECRET || "")
    .update(value)
    .digest("hex");
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({
    user: normalizeValue(process.env.METAVERSE_USERNAME),
    exp: Date.now() + maxAgeSeconds * 1000
  })).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

function isValidSession(cookie) {
  if (!cookie || !process.env.METAVERSE_AUTH_SECRET) return false;

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || signature !== sign(payload)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/listing-copilot-title") {
    const moduleUrl = pathToFileURL(join(root, "api/listing-copilot-title.js")).href;
    const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`);
    await handler(request, response);
    return true;
  }

  if (pathname === "/api/session") {
    const cookies = parseCookies(request.headers.cookie);
    sendJson(response, 200, { authenticated: isValidSession(cookies[cookieName]) });
    return true;
  }

  if (pathname === "/api/logout") {
    response.writeHead(200, {
      "set-cookie": `${cookieName}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
      "content-type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (pathname === "/api/login") {
    if (request.method !== "POST") {
      sendJson(response, 405, { ok: false, message: "Method not allowed" });
      return true;
    }

    if (!process.env.METAVERSE_USERNAME || !process.env.METAVERSE_PASSWORD || !process.env.METAVERSE_AUTH_SECRET) {
      sendJson(response, 500, { ok: false, message: "Listing auth is not configured." });
      return true;
    }

    let credentials;
    try {
      credentials = JSON.parse(await readBody(request));
    } catch {
      sendJson(response, 400, { ok: false, message: "Invalid request." });
      return true;
    }

    const username = normalizeValue(credentials.username);
    const password = normalizeValue(credentials.password);

    if (
      username !== normalizeValue(process.env.METAVERSE_USERNAME) ||
      password !== normalizeValue(process.env.METAVERSE_PASSWORD)
    ) {
      sendJson(response, 401, { ok: false, message: "账号或密码不正确。" });
      return true;
    }

    sendJson(response, 200, { ok: true }, {
      "set-cookie": `${cookieName}=${createSession()}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`
    });
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
    const cookies = parseCookies(request.headers.cookie);
    if (!isValidSession(cookies[cookieName])) {
      response.writeHead(302, { location: `/login?next=${encodeURIComponent(`${pathname}${requestUrl.search}`)}` });
      response.end();
      return;
    }
  }

  const filePath = resolvePath(request.url || "/");
  if (!filePath || !existsSync(filePath)) {
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
