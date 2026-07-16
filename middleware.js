import { next } from "@vercel/functions";
import { isProtectedAppPath } from "./lib/listing-route-access.mjs";
import { validLegacySessionClaims } from "./lib/listing-session-claims.mjs";

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

function fromHex(value) {
  const hex = String(value || "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

async function verifySignature(value, signature, secret) {
  const signatureBytes = fromHex(signature);
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(value));
}

function decodePayload(payload) {
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function isValidSession(cookie) {
  const secret = process.env.METAVERSE_AUTH_SECRET;
  if (!cookie || !secret) return false;

  const parts = String(cookie).split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature) return false;

  if (!(await verifySignature(payload, signature, secret))) return false;

  try {
    const session = decodePayload(payload);
    return validLegacySessionClaims(session);
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);

  if (!isProtectedAppPath(url.pathname)) {
    return next();
  }

  const cookies = parseCookies(request.headers.get("cookie"));
  const authenticated = await isValidSession(cookies[cookieName]);

  if (authenticated) {
    return next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${url.pathname}${url.search}`);
  return Response.redirect(loginUrl, 302);
}

export const config = {
  matcher: ["/", "/index", "/index.html", "/app", "/app/", "/app/index", "/app/index.html"],
  runtime: "edge"
};
