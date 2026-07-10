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
assert.ok(!apiSource.includes("writerVisibleL1Response"), "V4 must not expose an L1 writer-visible response path");
assert.ok(!apiSource.includes("v4_return_l1_writer_safe_draft === true"), "V4 must ignore legacy L1 writer-safe draft flags");
assert.ok(!apiSource.includes("L1_WRITER_SAFE_DRAFT"), "V4 title stages must not include a writer-visible L1 draft stage");
assert.ok(fastScoutBranch.includes("sendJson(res, 200, writerResponse);"), "fast scout L1 must send a writer-pending response in the branch");
assert.ok(fastScoutBranch.includes("if (queueL1Only(payload))"), "queue-backed L1 must take the explicit L1-only path");
assert.ok(fastScoutBranch.includes("await l1PersistencePromise"), "queue-backed L1 must persist before job completion/status polling");
assert.ok(fastScoutBranch.includes("scheduleV4Background(l1PersistencePromise"), "L1 persistence must be scheduled after response construction");
assert.ok(fastScoutBranch.includes("scheduleV4Background(createResultPromise.then((createResult) => runBackgroundAssistedDraft"), "L2 must be scheduled from session creation, not chained after L1 persistence");
assert.ok(!fastScoutBranch.includes("l1PersistencePromise.catch(() => null).then(() => runBackgroundAssistedDraft"), "L2 must not wait for L1 persistence before starting");
assert.ok(apiSource.includes("DISABLE_GPT5_FAST_SCOUT_L1"), "GPT-5 main-path requests must follow the same internal L1 path by default and only skip when explicitly disabled");
assert.ok(apiSource.includes("isGpt5ResponsesModel(requestedListingModel)"), "GPT-5 model detection must guard the fast scout L1 branch");
assert.ok(apiSource.includes("modelRequiresFullL2Options") && apiSource.includes("providerOptionsForV4BackgroundL2({ payload: l2Payload, routePlan })"), "GPT-5 model detection must also select full L2 provider options after skipping the L1 branch");
assert.ok(apiSource.includes("fast_scout_blocking_call_used: false") && apiSource.includes("fast_scout_skip_reason: \"model_requires_full_l2\""), "GPT-5 full-L2 responses must expose that fast scout was skipped");
assert.ok(apiSource.includes("shouldRetryGpt5EmptyResult"), "GPT-5 full-L2 empty-title failures must have a dedicated retry guard");
assert.ok(apiSource.includes("v4_gpt5_empty_result_retry_attempted: true"), "GPT-5 empty-title retry must be marked on the retry payload");
assert.ok(apiSource.includes("prepareV4PresentationResult({ result: retryResponse.body"), "GPT-5 retry must only replace the first response when the retry can render a title");
assert.ok(apiSource.includes("callV2WithGpt5EmptyRetry") && apiSource.includes("const v2Response = await callV2WithGpt5EmptyRetry"), "GPT-5 empty-title retry must be shared by direct and background L2 calls");
assert.ok(apiSource.includes("gpt5_empty_result_retry_success"), "GPT-5 retry outcome must be exposed in provider diagnostics");
assert.ok(apiSource.includes("l1_status"), "L1 persistence must update dedicated l1 status fields instead of relying on final-only state");
assert.ok(apiSource.includes("l2_status"), "L2 persistence must update dedicated l2 status fields");
assert.ok(apiSource.includes("internal_scout_not_catalog_gap"), "L1 internal scout must not create catalog gap rows");
assert.ok(apiSource.includes("l1_deferred_modules"), "V4 response must expose deferred modules");
assert.ok(apiSource.includes("fast_scout_blocking_call_used"), "V4 response must expose fast scout blocking-call diagnostic");
assert.ok(apiSource.includes("ENABLE_V4_L2_EXACT_ANCHOR_BLOCKING_SCOUT"), "L2 exact-anchor scout must default to cache-only unless explicitly enabled.");
assert.ok(apiSource.includes("allowProviderCall: allowBlockingScout"), "L2 exact-anchor scout must not make a blocking provider call by default.");
assert.ok(apiSource.includes("CACHE_MISS_PROVIDER_DISABLED"), "L2 exact-anchor cache miss must fall through to full L2 without waiting on a scout model call.");
assert.ok(apiSource.includes("v4_l2_timing"), "V4 L2 must expose stage timings for worker latency diagnosis.");
assert.ok(apiSource.includes("l2ScoutResult = scoutResult"), "L2-direct must retain the cached same-image scout observation.");
assert.ok(apiSource.includes("backgroundPayloadWithL1ResolvedHint(payload, l2ScoutResult)"), "L2-direct must use the internal scout to focus full L2 without exposing L1 to writers.");
assert.ok(apiSource.includes("providerOptionsForV4BackgroundL2({ payload: l2Payload, routePlan })"), "L2 provider options must receive the scout-enriched payload.");
assert.ok(fastScoutSource.includes("readV4FastScoutCache"), "fast scout must read persistent cache");
assert.ok(fastScoutSource.includes("persistV4FastScoutCache"), "fast scout must persist cache");
assert.ok(fastScoutSource.includes("cacheWriteMode = \"background\""), "fast scout API path must default cache writes to background");
assert.ok(fastScoutSource.includes("allowProviderCall = true"), "fast scout must keep normal provider behavior for L1/prewarm paths.");
assert.ok(fastScoutSource.includes("FAST_SCOUT_CACHE_MISS_PROVIDER_DISABLED"), "fast scout cache-only mode must fail closed before provider call.");
assert.ok(fastScoutSource.includes("signed_url_ms"), "fast scout timing must expose signed_url_ms");
assert.ok(fastScoutSource.includes("image_verify_ms"), "fast scout timing must expose image_verify_ms");
assert.ok(fastScoutSource.includes("OPENAI_FAST_SCOUT_TIMEOUT_MS"), "fast scout provider calls must have a bounded timeout");
assert.ok(!fastScoutSource.includes("gpt5FastScoutSafeOutputTokenCap * 10"), "fast scout must not advertise an output cap above the GPT-5 model limit");
assert.ok(apiSource.includes("exact_anchor_finalize_reason"), "L2 timing must preserve the exact-anchor fallthrough reason");

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
