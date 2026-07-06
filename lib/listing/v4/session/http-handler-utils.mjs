import { EventEmitter } from "node:events";

export function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function readJsonPayload(req) {
  const raw = await readRequestBody(req);
  return raw ? JSON.parse(raw) : {};
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function callJsonHandler(handler, {
  method = "POST",
  headers = {},
  payload = {}
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { ...headers };

  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    end(value = "") {
      this.body = String(value || "");
    }
  };

  const run = handler(req, res);
  queueMicrotask(() => {
    req.emit("data", JSON.stringify(payload));
    req.emit("end");
  });
  await run;

  let json = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = null;
  }

  return {
    statusCode: res.statusCode || 200,
    headers: res.headers,
    body: json,
    rawBody: res.body
  };
}
