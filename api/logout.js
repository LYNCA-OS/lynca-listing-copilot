const cookieName = "lynca_metaverse_session";

function isHttps(req) {
  const host = String(req.headers.host || "");
  return req.headers["x-forwarded-proto"] === "https" ||
    (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
}

export default function handler(req, res) {
  const secure = isHttps(req) ? "; Secure" : "";

  res.statusCode = 200;
  res.setHeader("set-cookie", `${cookieName}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true }));
}
