export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    ok: true,
    service: "lynca-listing-copilot",
    timestamp: new Date().toISOString()
  }));
}
