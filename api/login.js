import crypto from "node:crypto";

const cookieName = "lynca_metaverse_session";
const maxAgeSeconds = 60 * 60 * 24 * 7;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function isHttps(req) {
  const host = String(req.headers.host || "");
  return req.headers["x-forwarded-proto"] === "https" ||
    (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
}

function serializeCookie(name, value, req) {
  const secure = isHttps(req) ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  const expectedUser = process.env.METAVERSE_USERNAME;
  const expectedPassword = process.env.METAVERSE_PASSWORD;
  const authSecret = process.env.METAVERSE_AUTH_SECRET;

  if (!expectedUser || !expectedPassword || !authSecret) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Listing auth is not configured." }));
    return;
  }

  let credentials;
  try {
    credentials = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Invalid request." }));
    return;
  }

  const username = normalize(credentials.username);
  const password = normalize(credentials.password);

  if (username !== normalize(expectedUser) || password !== normalize(expectedPassword)) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "账号或密码不正确。" }));
    return;
  }

  const payload = base64url(JSON.stringify({
    user: normalize(expectedUser),
    exp: Date.now() + maxAgeSeconds * 1000
  }));
  const token = `${payload}.${sign(payload, authSecret)}`;

  res.statusCode = 200;
  res.setHeader("set-cookie", serializeCookie(cookieName, token, req));
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true }));
}
