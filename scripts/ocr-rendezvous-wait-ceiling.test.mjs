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

test("a listener is not held for workers that provably cannot answer", () => {
  const dead = decide({
    configuredWaitMs: 22_000,
    latestOcrState: {
      configured: true,
      active_count: 0,
      job_count: 1,
      job_observability: [{
        crop_role: "serial_crop",
        status: "FAILED",
        error_code: "OCR_WORKER_UNAVAILABLE"
      }]
    }
  });
  assert.equal(dead.wait_budget_ms, 0);
  assert.equal(dead.should_wait, false);
  assert.equal(dead.wait_budget_uncapped_ms, 22_000);
  assert.equal(dead.workers_unavailable, true);
});

test("only terminal task-level worker unavailability disables the wait", () => {
  const decodeFailure = decide({
    configuredWaitMs: 1_000,
    latestOcrState: {
      configured: true,
      active_count: 0,
      job_count: 1,
      job_observability: [{
        crop_role: "serial_crop",
        status: "FAILED",
        error_code: "OCR_FIELD_JOB_FAILED"
      }]
    }
  });
  assert.equal(decodeFailure.wait_budget_ms, 1_000);

  const mixedFailedAndRunning = decide({
    configuredWaitMs: 1_000,
    latestOcrState: {
      configured: true,
      active_count: 1,
      job_count: 2,
      job_observability: [
        { crop_role: "serial_crop", status: "FAILED", error_code: "OCR_WORKER_UNAVAILABLE" },
        { crop_role: "grade_label_crop", status: "RUNNING", error_code: null }
      ]
    }
  });
  assert.equal(mixedFailedAndRunning.wait_budget_ms, 1_000,
    "one unavailable job cannot zero the wait while any related OCR task remains active");
  assert.equal(mixedFailedAndRunning.workers_unavailable, false);

  const incompleteAggregateOnly = decide({
    configuredWaitMs: 1_000,
    latestOcrState: {
      configured: true,
      active_count: 0,
      failed_reasons: ["ocr_worker_unavailable"]
    }
  });
  assert.equal(incompleteAggregateOnly.wait_budget_ms, 1_000,
    "aggregate failure strings are insufficient without complete task-level observability");

  const truncatedTaskEvidence = decide({
    configuredWaitMs: 1_000,
    latestOcrState: {
      configured: true,
      active_count: 0,
      job_count: 2,
      job_observability: [
        { crop_role: "serial_crop", status: "FAILED", error_code: "OCR_WORKER_UNAVAILABLE" }
      ]
    }
  });
  assert.equal(truncatedTaskEvidence.wait_budget_ms, 1_000,
    "a partial job ledger cannot prove that all related work is terminal-unavailable");

  const relevantSerialUnavailable = decide({
    configuredWaitMs: 1_000,
    unresolved: ["serial_number"],
    latestOcrState: {
      configured: true,
      active_count: 0,
      job_count: 2,
      serial_active_count: 0,
      grade_label_active_count: 0,
      job_observability: [
        { crop_role: "serial_crop", status: "FAILED", error_code: "OCR_WORKER_UNAVAILABLE" },
        { crop_role: "grade_label_crop", status: "SUCCEEDED", error_code: null }
      ]
    }
  });
  assert.equal(relevantSerialUnavailable.wait_budget_ms, 0,
    "a successful unrelated crop must not hide terminal unavailability of the requested serial crop");
  assert.deepEqual(relevantSerialUnavailable.unavailable_target_fields, ["serial_number"]);
});

console.log("ocr rendezvous wait ceiling tests passed");
