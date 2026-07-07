#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backgroundPayloadWithL1ResolvedHint } from "../api/v4/listing-copilot-title.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiSource = await fs.readFile(path.join(root, "api/v4/listing-copilot-title.js"), "utf8");
const fastScoutSource = await fs.readFile(path.join(root, "lib/listing/v4/fast-scout/fast-scout-observation.mjs"), "utf8");

const fastScoutBranch = apiSource.slice(
  apiSource.indexOf("if (canReturnFastScoutL1"),
  apiSource.indexOf("const progressiveProviderOptions")
);

assert.ok(fastScoutBranch.includes("addL1ReturnBarrierMetadata(adaptV2ResultToV4"), "fast scout L1 must build response directly from adapter");
assert.ok(fastScoutBranch.includes("writerPendingL1Response(v4Response, l1Result)"), "fast scout L1 must hide internal scout titles from the writer response");
assert.ok(fastScoutBranch.includes("sendJson(res, 200, writerResponse);"), "fast scout L1 must send a writer-pending response in the branch");
assert.ok(!fastScoutBranch.includes("await persistPipelineResult"), "fast scout L1 must not await pipeline persistence before response");
assert.ok(fastScoutBranch.includes("scheduleV4Background(l1PersistencePromise"), "L1 persistence must be scheduled after response construction");
assert.ok(fastScoutBranch.includes("scheduleV4Background(createResultPromise.then((createResult) => runBackgroundAssistedDraft"), "L2 must be scheduled from session creation, not chained after L1 persistence");
assert.ok(!fastScoutBranch.includes("l1PersistencePromise.catch(() => null).then(() => runBackgroundAssistedDraft"), "L2 must not wait for L1 persistence before starting");
assert.ok(apiSource.includes("internal_scout_does_not_update_session"), "L1 internal scout persistence must not overwrite the L2 session state");
assert.ok(apiSource.includes("internal_scout_not_catalog_gap"), "L1 internal scout must not create catalog gap rows");
assert.ok(apiSource.includes("l1_deferred_modules"), "V4 response must expose deferred modules");
assert.ok(apiSource.includes("fast_scout_blocking_call_used"), "V4 response must expose fast scout blocking-call diagnostic");
assert.ok(fastScoutSource.includes("readV4FastScoutCache"), "fast scout must read persistent cache");
assert.ok(fastScoutSource.includes("persistV4FastScoutCache"), "fast scout must persist cache");
assert.ok(fastScoutSource.includes("cacheWriteMode = \"background\""), "fast scout API path must default cache writes to background");
assert.ok(fastScoutSource.includes("signed_url_ms"), "fast scout timing must expose signed_url_ms");
assert.ok(fastScoutSource.includes("image_verify_ms"), "fast scout timing must expose image_verify_ms");

const originalPayload = {
  asset_id: "asset-l1-hint",
  resolved_hint: {
    product: "Panini Status"
  }
};
const enrichedPayload = backgroundPayloadWithL1ResolvedHint(originalPayload, {
  fields: {
    year: "2018-19",
    players: ["Trae Young"],
    collector_number: "NB-TYG"
  }
});
assert.equal(originalPayload.resolved_hint.year, undefined, "L1 hint merge must not mutate the original payload");
assert.equal(enrichedPayload.resolved_hint.product, "Panini Status");
assert.equal(enrichedPayload.resolved_hint.year, "2018-19");
assert.deepEqual(enrichedPayload.resolved_hint.players, ["Trae Young"]);
assert.equal(enrichedPayload.resolved_hint.collector_number, "NB-TYG");
assert.deepEqual(enrichedPayload.resolvedHint, enrichedPayload.resolved_hint);
assert.equal(enrichedPayload.l1_fast_scout_resolved_hint_source, "v4_fast_scout_l1");

const unchangedPayload = { asset_id: "asset-empty-l1" };
assert.equal(backgroundPayloadWithL1ResolvedHint(unchangedPayload, { fields: {} }), unchangedPayload);

console.log("v4-l1-return-barrier tests passed");
