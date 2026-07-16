import { cookieName } from "../lib/listing-session.mjs";

function isHttps(req) {
  const host = String(req.headers.host || "");
  return req.headers["x-forwarded-proto"] === "https" ||
    (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
}

function sameOriginRequest(req) {
  const origin = String(req.headers.origin || "").trim();
  const fetchSite = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
  const host = String(req.headers.host || "").split(",")[0].trim();
  if (!origin || fetchSite !== "same-origin") return false;
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  if (!sameOriginRequest(req)) {
    sendJson(res, 403, { ok: false, message: "Forbidden" });
    return;
  }

  const secure = isHttps(req) ? "; Secure" : "";

  res.setHeader("set-cookie", `${cookieName}=; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secure}`);
  sendJson(res, 200, { ok: true });
}
