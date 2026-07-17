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

const delayedNestedResponse = await callJsonHandler(async (req, res) => {
  // Authentication and tenant lookup happen before body consumption in the
  // production pre-ingestion handler. The adapter must retain the body across
  // that asynchronous boundary.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const payload = await readJsonPayload(req);
  res.statusCode = 201;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, asset_id: payload.asset_id }));
}, {
  payload: { asset_id: "asset_delayed_body" }
});
assert.equal(delayedNestedResponse.statusCode, 201);
assert.deepEqual(delayedNestedResponse.body, {
  ok: true,
  asset_id: "asset_delayed_body"
});

console.log("http handler utils tests passed");
