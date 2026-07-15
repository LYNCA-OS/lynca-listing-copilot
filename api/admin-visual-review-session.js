import { getSessionFromRequest } from "../lib/listing-session.mjs";
import { isPlatformAdminRequest } from "../lib/platform-admin-auth.mjs";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  const authenticated = isPlatformAdminRequest(req);

  sendJson(res, 200, {
    authenticated,
    visual_review_session_user: authenticated ? "platform_admin" : null
  });
}
