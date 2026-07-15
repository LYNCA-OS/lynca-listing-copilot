import { getSessionFromRequest } from "../lib/listing-session.mjs";

export default function handler(req, res) {
  const session = getSessionFromRequest(req);
  const authenticated = Boolean(session);

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    authenticated,
    user: session?.user || null,
    tenant_id: session?.tenant_id || session?.tenant || session?.user || null
  }));
}
