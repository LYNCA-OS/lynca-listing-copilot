import crypto from "node:crypto";
import { validLegacySessionClaims } from "./listing-session-claims.mjs";

export const cookieName = "lynca_metaverse_session";
export const internalOperatorPlaceholder = "internal-operator";

export function parseCookies(header) {
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

export function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");
  const leftDigest = crypto.createHash("sha256").update(leftBuffer).digest();
  const rightDigest = crypto.createHash("sha256").update(rightBuffer).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest) && leftBuffer.length === rightBuffer.length;
}

export function createSignedSessionToken(session, secret) {
  if (!secret) throw new Error("missing_session_secret");
  const payload = Buffer.from(JSON.stringify(session || {})).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSignedSession(cookie, secret) {
  if (!cookie || !secret) return null;
  const parts = String(cookie).split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature || !timingSafeStringEqual(signature, sign(payload, secret))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return validLegacySessionClaims(session) ? session : null;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return readSignedSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET);
}

export function operatorIdFromRequest(req) {
  const session = getSessionFromRequest(req);
  return String(session?.user || "").trim() || internalOperatorPlaceholder;
}
