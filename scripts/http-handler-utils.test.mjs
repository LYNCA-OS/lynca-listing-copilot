#!/usr/bin/env node

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
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

console.log("http handler utils tests passed");
