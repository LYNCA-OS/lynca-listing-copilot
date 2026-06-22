import { getSessionFromRequest } from "../lib/listing-session.mjs";

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

  const session = getSessionFromRequest(req);
  const user = String(session?.user || "").trim();

  sendJson(res, 200, {
    authenticated: Boolean(user),
    visual_review_session_user: user || null
  });
}
