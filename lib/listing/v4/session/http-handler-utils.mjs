import { Readable } from "node:stream";

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

export async function callJsonHandler(handler, {
  method = "POST",
  headers = {},
  payload = {},
  signal = null
} = {}) {
  // A nested handler may authenticate or perform another asynchronous step
  // before it starts reading the request body. EventEmitter-based mocks lose
  // data/end events in that gap and leave the handler waiting forever. A real
  // Readable buffers the body until the handler attaches its consumer, just
  // like the incoming HTTP stream that this adapter is standing in for.
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = method;
  req.headers = { ...headers };
  req.signal = signal || undefined;

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

  if (signal?.aborted) throw signal.reason || new DOMException("The operation was aborted", "AbortError");

  const run = Promise.resolve().then(() => handler(req, res));
  let abortListener = null;
  try {
    if (signal) {
      const aborted = new Promise((_, reject) => {
        abortListener = () => {
          const error = signal.reason || new DOMException("The operation was aborted", "AbortError");
          req.destroy();
          reject(error);
        };
        signal.addEventListener("abort", abortListener, { once: true });
      });
      await Promise.race([run, aborted]);
    } else {
      await run;
    }
  } finally {
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }

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
