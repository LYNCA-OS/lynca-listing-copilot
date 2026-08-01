#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import middleware from "../middleware.js";
import { isRetiredListingExecutionPath } from "../lib/listing-route-access.mjs";

const retiredPath = "/api/v4/listing-job-status";
const handlerSource = readFileSync("api/v4/listing-job-status.js", "utf8");

assert.equal(isRetiredListingExecutionPath(retiredPath), true);
assert.equal(isRetiredListingExecutionPath(`${retiredPath}/`), true);
assert.doesNotMatch(handlerSource, /status-poll-queue-self-heal/);
assert.doesNotMatch(handlerSource, /triggerStatusPollQueueSelfHeal/);
assert.doesNotMatch(handlerSource, /scheduleTrustedV4QueuePump/);
assert.doesNotMatch(handlerSource, /tryAcquireV4QueueKick/);

const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = async () => {
  networkRequests += 1;
  throw new Error("retired status GET must not perform network I/O");
};

let response;
try {
  response = await middleware(new Request(
    `https://listing.lyncafei.team${retiredPath}?batch_id=legacy`,
    { method: "GET" }
  ));
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(response.status, 410);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.deepEqual(await response.json(), {
  ok: false,
  retryable: false,
  error_code: "RETIRED_LISTING_EXECUTION_PATH",
  active_path: "/api/csm-listing-title"
});
assert.equal(networkRequests, 0, "retired GET must not write queue-kick state or POST a pump");

console.log("retired listing job status: ok");
