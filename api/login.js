import crypto from "node:crypto";
import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import {
  cookieName,
  createSignedSessionToken,
  timingSafeStringEqual
} from "../lib/listing-session.mjs";

const maxAgeSeconds = 60 * 60 * 24 * 7;
const maxLoginBodyBytes = 16 * 1024;

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function isHttps(req) {
  const host = String(req.headers.host || "");
  return req.headers["x-forwarded-proto"] === "https" ||
    (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
}

function serializeCookie(name, value, req) {
  const secure = isHttps(req) ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxLoginBodyBytes) {
        const error = new Error("login_request_too_large");
        error.code = "REQUEST_BODY_TOO_LARGE";
        reject(error);
        req.destroy?.();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "login",
    limit: 20,
    windowMs: 5 * 60_000,
    message: "Too many login attempts. Please wait before trying again."
  })) return;

  const expectedUser = process.env.METAVERSE_USERNAME;
  const expectedPassword = process.env.METAVERSE_PASSWORD;
  const authSecret = process.env.METAVERSE_AUTH_SECRET;

  if (!expectedUser || !expectedPassword || !authSecret) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Listing auth is not configured." }));
    return;
  }

  let credentials;
  try {
    credentials = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Invalid request." }));
    return;
  }

  const username = normalizeUsername(credentials.username);
  const password = String(credentials.password ?? "");

  if (username !== normalizeUsername(expectedUser) || !timingSafeStringEqual(password, expectedPassword)) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "账号或密码不正确。" }));
    return;
  }

  const token = createSignedSessionToken({
    user: normalizeUsername(expectedUser),
    tenant_id: String(process.env.METAVERSE_TENANT_ID || expectedUser).trim().toLowerCase(),
    sid: crypto.randomUUID(),
    iat: Date.now(),
    exp: Date.now() + maxAgeSeconds * 1000
  }, authSecret);

  res.statusCode = 200;
  res.setHeader("set-cookie", serializeCookie(cookieName, token, req));
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true }));
}
