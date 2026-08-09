#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildPilotPacket,
  buildPhysicalOnlyProjection,
  evaluatePilotGold,
  pilotSelectionPolicy,
  stableSha256,
  validatePilotPacket
} from "../lib/listing/evaluation/typed-gold-annotation-pilot.mjs";

const items = Array.from({ length: 25 }, (_, index) => ({
  asset_id: `asset-${index}`,
  physical_card_id: `physical-${index}`,
  images: index === 0
    ? [{ bucket: "b", object_path: `${index}/front.jpg`, role: "front_original" }]
    : [
      { bucket: "b", object_path: `${index}/front.jpg`, role: "front_original" },
      { bucket: "b", object_path: `${index}/back.jpg`, role: "back_original" }
    ]
}));
const physical = buildPhysicalOnlyProjection({
  dataset: { items }, cohortAssetIds: items.map((item) => item.asset_id),
  datasetSha256: "a".repeat(64), sourceCohortSha256: "b".repeat(64)
});
const built = buildPilotPacket({ physicalProjection: physical.projection, projectionManifest: physical.manifest });
assert.equal(validatePilotPacket(built.packet, built.receipt), true);
assert.deepEqual(built.packet.cards.reduce((counts, card) => {
  const key = card.source_regions.join("+"); counts[key] = (counts[key] || 0) + 1; return counts;
}, {}), { CARD_FRONT: 1, "CARD_BACK+CARD_FRONT": 19 });
assert.deepEqual(evaluatePilotGold({ packet: built.packet, receipt: built.receipt }).metrics, {
  critical_factual_error_rate: null, typed_precision: null, typed_recall: null,
  required_missing_rate: null, wrong_role_rate: null
});

const tampered = structuredClone(built.packet);
tampered.cards[0].images[0].image_ref = "tampered";
assert.throws(() => validatePilotPacket(tampered, built.receipt), /typed_gold_packet_tampered/);

const policyTampered = structuredClone(built.packet);
policyTampered.material_snapshots.critical_policy.fields.push("print_finish");
const policyReceipt = structuredClone(built.receipt);
policyReceipt.packet_sha256 = stableSha256(policyTampered);
assert.throws(() => validatePilotPacket(policyTampered, policyReceipt), /policy_or_registry_binding_mismatch/);

const duplicate = structuredClone(built.packet);
duplicate.cards[1].physical_card_id = duplicate.cards[0].physical_card_id;
const duplicateReceipt = structuredClone(built.receipt);
duplicateReceipt.packet_sha256 = stableSha256(duplicate);
duplicateReceipt.ordered_physical_card_ids_sha256 = stableSha256(duplicate.cards.map((card) => card.physical_card_id));
assert.throws(() => validatePilotPacket(duplicate, duplicateReceipt), /duplicate_physical_card_id/);

const extraKey = structuredClone(physical.projection);
extraKey.items[0].source_record = { reviewed_title: "must never enter selector" };
assert.throws(() => buildPilotPacket({ physicalProjection: extraKey, projectionManifest: physical.manifest }), /physical_projection_exact_keys_required/);
const titleInjection = structuredClone(physical.projection);
titleInjection.items[0].images[0].reviewed_title = "must never enter selector";
assert.throws(() => buildPilotPacket({ physicalProjection: titleInjection, projectionManifest: physical.manifest }), /physical_projection_exact_keys_required/);

const review = (role, reviewerId) => ({
  schema_version: "typed-gold-independent-review-v1", role, reviewer_id: reviewerId,
  cards: built.packet.cards.map((card) => ({
    asset_id: card.asset_id, physical_card_id: card.physical_card_id, typed_claims: [],
    required_fact_scan: { status: "COMPLETE", reviewed_source_regions: card.source_regions, missing_required_claims: [] },
    wrong_role_axis: { status: "CLEAR", findings: [] }
  }))
});
const reviewerA = review("REVIEWER_A", "human-a");
const reviewerB = review("REVIEWER_B", "human-b");
const adjudication = { ...review("ADJUDICATOR", "human-c"), schema_version: "typed-gold-adjudication-v1", status: "COMPLETE" };
const oneReviewer = evaluatePilotGold({ packet: built.packet, receipt: built.receipt, reviewerA });
assert.equal(oneReviewer.gold_eligible, false);
assert.equal(oneReviewer.metrics.typed_recall, null);

const missing = structuredClone(reviewerB);
missing.cards[0].required_fact_scan.status = null;
assert.throws(() => evaluatePilotGold({ packet: built.packet, receipt: built.receipt, reviewerA, reviewerB: missing, adjudication }), /required_scan_incomplete/);

assert.throws(() => evaluatePilotGold({
  packet: built.packet, receipt: built.receipt, reviewerA,
  reviewerB: { ...reviewerB, reviewer_id: "human-a" }, adjudication
}), /independent_reviewer_ids_must_differ/);
const completePilot = evaluatePilotGold({ packet: built.packet, receipt: built.receipt, reviewerA, reviewerB, adjudication });
assert.equal(completePilot.status, "ADJUDICATED_PILOT_ONLY");
assert.equal(completePilot.gold_eligible, false);
assert.equal(completePilot.metrics.critical_factual_error_rate, null);
const trackedPolicy = JSON.parse(await readFile("docs/evaluation/typed-gold-pilot20-selection-policy-2026-08-09.json"));
assert.equal(stableSha256(trackedPolicy), stableSha256(pilotSelectionPolicy()));
const trackedPrivacyFiles = await Promise.all([
  "docs/evaluation/typed-gold-pilot20-selection-policy-2026-08-09.json",
  "docs/evaluation/typed-gold-pilot20-receipt-2026-08-09.json",
  "docs/evaluation/typed-gold-pilot20-runbook-2026-08-09.md"
].map((path) => readFile(path, "utf8")));
assert.equal(trackedPrivacyFiles.some((body) => /listing-feedback-images|feedback\/\d{4}-\d{2}|reviewed_blind_[0-9a-f]+/.test(body)), false);
console.log("typed-gold annotation pilot tests passed");
