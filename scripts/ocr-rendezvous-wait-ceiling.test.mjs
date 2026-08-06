#!/usr/bin/env node
// The rendezvous holds the listener while background OCR settles. Measured over
// 1,451 production sessions that reached it: the wait averaged 657ms, p90 was
// 1,741ms, the worst case was 24,539ms -- and the whole rendezvous changed a
// field on 4.6% of them, at 0.14 patches per session.
//
// 4.6% is not nothing, so this is a ceiling and not a switch. The ceiling keeps
// everything up to the observed p90 and removes a tail that reached
// twenty-four seconds for the same 4.6% chance.

import assert from "node:assert/strict";
import test from "node:test";

import { criticalOcrRendezvousDecision } from "../lib/listing/pipeline/ocr-rendezvous-policy.mjs";

const decide = (options) => criticalOcrRendezvousDecision({ latestOcrState: { configured: true }, ...options });

test("a long budget is capped, and the original is kept for observation", () => {
  const capped = decide({ configuredWaitMs: 22_000 });
  assert.equal(capped.wait_budget_ms, 2_000);
  assert.equal(capped.wait_budget_uncapped_ms, 22_000,
    "what was asked for has to stay visible, or the cap becomes invisible in traces");
  assert.equal(capped.should_wait, true, "capping is not disabling");
});

test("a budget already under the ceiling is untouched", () => {
  // p90 of observed waits is 1,741ms, so the common case must not move.
  assert.equal(decide({ configuredWaitMs: 800 }).wait_budget_ms, 800);
  assert.equal(decide({ configuredWaitMs: 1_741 }).wait_budget_ms, 1_741);
});

test("the ceiling is raisable when the workers earn it", () => {
  assert.equal(decide({ configuredWaitMs: 22_000, maxWaitMs: 8_000 }).wait_budget_ms, 8_000);
});

test("no budget still means no wait", () => {
  const none = decide({ configuredWaitMs: 0 });
  assert.equal(none.wait_budget_ms, 0);
  assert.equal(none.should_wait, false, "the cap must never manufacture a wait that was not asked for");
});

console.log("ocr rendezvous wait ceiling tests passed");

test("a listener is not held for workers that provably cannot answer", () => {
  // Five consecutive days on production -- 1,128 sessions -- applied zero
  // patches while still waiting hundreds of milliseconds each, because the OCR
  // workers sit on a Cloud Run project with a closed billing account.
  const dead = decide({
    configuredWaitMs: 22_000,
    latestOcrState: { configured: true, failed_reasons: ["ocr_worker_unavailable"] }
  });
  assert.equal(dead.wait_budget_ms, 0);
  assert.equal(dead.should_wait, false);
  assert.equal(dead.wait_budget_uncapped_ms, 22_000, "what was asked for stays visible");
});

test("the refusal is narrow: only unavailability counts", () => {
  // A job that failed on the image says nothing about whether waiting pays --
  // the next crop might still succeed. Widening this would turn a targeted
  // refusal into a general opt-out.
  const decodeFailure = decide({
    configuredWaitMs: 1_000,
    latestOcrState: { configured: true, failed_reasons: ["image_decode_failed"] }
  });
  assert.equal(decodeFailure.wait_budget_ms, 1_000);

  const mixed = decide({
    configuredWaitMs: 1_000,
    latestOcrState: { configured: true, failed_reasons: ["ocr_worker_unavailable", "image_decode_failed"] }
  });
  assert.equal(mixed.wait_budget_ms, 1_000, "some jobs are reaching a worker, so a wait can still pay");
});
