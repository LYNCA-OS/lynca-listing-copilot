import { getSessionFromRequest } from "../lib/listing-session.mjs";

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ authenticated: false, message: "Method not allowed" }));
    return;
  }

  const session = getSessionFromRequest(req);
  const authenticated = Boolean(session);

  res.statusCode = 200;
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(JSON.stringify({
    authenticated,
    user: session?.user || null,
    expires_at: session?.exp || null
  }));
}
