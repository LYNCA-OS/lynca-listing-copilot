#!/usr/bin/env node

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  callJsonHandler,
  readJsonPayload,
  requestPayloadErrorStatus,
  RequestBodyTooLargeError
} from "../lib/listing/v4/session/http-handler-utils.mjs";

const parsed = await readJsonPayload(Readable.from(["{\"ok\":true}"]), { maxBytes: 64 });
assert.deepEqual(parsed, { ok: true });

let oversized = null;
try {
  await readJsonPayload(Readable.from(["{\"value\":\"", "x".repeat(80), "\"}"]), { maxBytes: 32 });
} catch (error) {
  oversized = error;
}
assert.ok(oversized instanceof RequestBodyTooLargeError);
assert.equal(oversized.code, "REQUEST_BODY_TOO_LARGE");
assert.equal(requestPayloadErrorStatus(oversized), 413);
assert.equal(requestPayloadErrorStatus(new SyntaxError("bad json")), 400);

const controller = new AbortController();
let observedSignal = null;
const abortableHandlerCall = callJsonHandler(async (req, res) => {
  observedSignal = req.signal;
  await new Promise((resolve) => {
    if (req.signal.aborted) {
      resolve();
      return;
    }
    req.signal.addEventListener("abort", resolve, { once: true });
  });
  res.statusCode = 499;
  res.end(JSON.stringify({ aborted: req.signal.aborted }));
}, {
  payload: { ok: true },
  signal: controller.signal
});
setTimeout(() => controller.abort(new Error("lease_lost")), 5);
const abortableResponse = await abortableHandlerCall;
assert.equal(observedSignal, controller.signal);
assert.equal(abortableResponse.statusCode, 499);
assert.deepEqual(abortableResponse.body, { aborted: true });

console.log("http handler utils tests passed");
