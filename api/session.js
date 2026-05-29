import crypto from "node:crypto";

const cookieName = "lynca_metaverse_session";

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

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function isValidSession(cookie, secret) {
  if (!cookie || !secret) return false;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || signature !== sign(payload, secret)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

export default function handler(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const authenticated = isValidSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET);

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ authenticated }));
}
