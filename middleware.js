import { next } from "@vercel/functions";

const cookieName = "lynca_metaverse_session";
const protectedPaths = new Set(["/", "/index.html"]);

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

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function decodePayload(payload) {
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return JSON.parse(atob(padded));
}

async function isValidSession(cookie) {
  const secret = process.env.METAVERSE_AUTH_SECRET;
  if (!cookie || !secret) return false;

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return false;

  const expected = await sign(payload, secret);
  if (signature !== expected) return false;

  try {
    const session = decodePayload(payload);
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);

  if (!protectedPaths.has(url.pathname)) {
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
  matcher: ["/", "/index.html"],
  runtime: "edge"
};
