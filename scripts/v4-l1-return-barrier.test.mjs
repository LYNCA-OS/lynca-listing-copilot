#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiSource = await fs.readFile(path.join(root, "api/v4/listing-copilot-title.js"), "utf8");
const fastScoutSource = await fs.readFile(path.join(root, "lib/listing/v4/fast-scout/fast-scout-observation.mjs"), "utf8");

const fastScoutBranch = apiSource.slice(
  apiSource.indexOf("if (canReturnFastScoutL1"),
  apiSource.indexOf("const progressiveProviderOptions")
);

assert.ok(fastScoutBranch.includes("addL1ReturnBarrierMetadata(adaptV2ResultToV4"), "fast scout L1 must build response directly from adapter");
assert.ok(fastScoutBranch.includes("sendJson(res, 200, v4Response);"), "fast scout L1 must send response in the branch");
assert.ok(!fastScoutBranch.includes("await persistPipelineResult"), "fast scout L1 must not await pipeline persistence before response");
assert.ok(fastScoutBranch.includes("scheduleV4Background(l1PersistencePromise"), "L1 persistence must be scheduled after response construction");
assert.ok(apiSource.includes("l1_deferred_modules"), "V4 response must expose deferred modules");
assert.ok(apiSource.includes("fast_scout_blocking_call_used"), "V4 response must expose fast scout blocking-call diagnostic");
assert.ok(fastScoutSource.includes("readV4FastScoutCache"), "fast scout must read persistent cache");
assert.ok(fastScoutSource.includes("persistV4FastScoutCache"), "fast scout must persist cache");
assert.ok(fastScoutSource.includes("cacheWriteMode = \"background\""), "fast scout API path must default cache writes to background");
assert.ok(fastScoutSource.includes("signed_url_ms"), "fast scout timing must expose signed_url_ms");
assert.ok(fastScoutSource.includes("image_verify_ms"), "fast scout timing must expose image_verify_ms");

console.log("v4-l1-return-barrier tests passed");
