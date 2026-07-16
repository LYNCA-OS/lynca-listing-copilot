import { instrumentProductionRequest } from "../lib/observability/production-events.mjs";
import {
  cookieName,
  listingSessionCookieIsSecure,
  sameOriginBrowserRequest
} from "../lib/listing-session.mjs";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/logout" });
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  if (!sameOriginBrowserRequest(req)) {
    sendJson(res, 403, { ok: false, message: "Forbidden" });
    return;
  }

  const secure = listingSessionCookieIsSecure(req) ? "; Secure" : "";

  res.setHeader("set-cookie", `${cookieName}=; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secure}`);
  sendJson(res, 200, { ok: true });
}
