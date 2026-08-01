export const defaultMaxJsonBodyBytes = 4_000_000;

export class RequestBodyTooLargeError extends Error {
  constructor(limitBytes) {
    super(`request_body_exceeds_${limitBytes}_bytes`);
    this.name = "RequestBodyTooLargeError";
    this.code = "REQUEST_BODY_TOO_LARGE";
    this.statusCode = 413;
    this.limitBytes = limitBytes;
  }
}

export function readRequestBody(req, { maxBytes = defaultMaxJsonBodyBytes } = {}) {
  return new Promise((resolve, reject) => {
    let body = "";
    let byteLength = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      byteLength += Buffer.byteLength(chunk);
      if (byteLength > maxBytes) {
        rejected = true;
        reject(new RequestBodyTooLargeError(maxBytes));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!rejected) resolve(body);
    });
    req.on("error", (error) => {
      if (!rejected) reject(error);
    });
  });
}

export async function readJsonPayload(req, options = {}) {
  const raw = await readRequestBody(req, options);
  return raw ? JSON.parse(raw) : {};
}

export function requestPayloadErrorStatus(error) {
  return error?.code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400;
}

export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
