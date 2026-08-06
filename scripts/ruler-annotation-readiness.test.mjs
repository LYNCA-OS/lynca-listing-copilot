#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  auditRulerAnnotationReadiness,
  upgradeLegacyDisputePacket
} from "../lib/listing/evaluation/ruler-annotation-readiness.mjs";

const packetPath = resolve("artifacts/second-writer-calibration-285-2026-08-02/blind-packet.json");
const packet = JSON.parse(readFileSync(packetPath, "utf8"));
const audit = auditRulerAnnotationReadiness(packet);

assert.equal(audit.cards, 117);
assert.equal(audit.disputes, 285);
assert.equal(audit.disputes_with_model_evidence, 108);
assert.equal(audit.axis_conflated_disputes, 285);
assert.equal(audit.canonical_field_mappable_disputes, 267);
assert.equal(audit.requires_role_resolution_disputes, 18);
assert.deepEqual(audit.requires_role_resolution_fields, ["components"]);
assert.equal(audit.labels_present, 0);
assert.equal(audit.can_score_recognition_precision_after_review, true);
assert.equal(audit.can_score_recognition_recall, false);
assert.equal(audit.can_score_publishable_card_rate, false);

const upgraded = upgradeLegacyDisputePacket(packet);
assert.equal(upgraded.schema_version, "semantic-publication-review-packet-v2");
assert.equal(upgraded.blind, true);
assert.equal(upgraded.claim_scope, "REFERENCE_ABSENT_PREDICTION_DISPUTES_ONLY");
assert.equal(upgraded.cards[0].disputes[0].review_axes.truth.status, null);
assert.equal(upgraded.cards[0].disputes[0].review_axes.title.policy, null);
assert.ok(!JSON.stringify(upgraded).includes("expected_reference_token"));

process.stdout.write(`${JSON.stringify({ ok: true, ...audit }, null, 2)}\n`);
