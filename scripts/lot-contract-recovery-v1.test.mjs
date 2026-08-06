#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  LOT_CONTRACT_RECOVERY_MECHANISMS_V1,
  composeWithLotContractRecoveryV1
} from "../experiments/accuracy/lot-contract-recovery-v1.mjs";

const base = {
  grammar: "lot",
  lot_count: "3",
  year: "2026",
  manufacturer: "Topps",
  product: "Bowman Chrome",
  set: "Bowman Briefing",
  subjects: ["A Player", "B Player", "C Player"],
  card_name: "",
  print_finish: "Refractor",
  parallel_family: "Refractor",
  serial: "",
  team: "",
  grade: "PSA 10",
  components: ["RC"]
};

const compact = composeWithLotContractRecoveryV1(base, { enabledMechanisms: ["compact_lot_quantity"] });
assert.match(compact.candidate.title, /\blotx3\b/);
assert.doesNotMatch(compact.candidate.title, /Card Lot/);
assert.ok(compact.candidate.length <= 80);

const defaultOff = composeWithLotContractRecoveryV1(base);
assert.equal(defaultOff.candidate.title, defaultOff.baseline.title,
  "known-loss Lot experiments must be explicit opt-ins");
assert.deepEqual(defaultOff.applied, []);

const set = composeWithLotContractRecoveryV1(base, { enabledMechanisms: ["manufacturer_product_set"] });
assert.match(set.candidate.title, /Bowman Chrome Briefing/);
assert.equal(set.applied.some((entry) => entry.kind === "manufacturer_product_set"), true);

const extended = composeWithLotContractRecoveryV1(base, {
  enabledMechanisms: ["compact_lot_quantity", "shared_observable_components", "shared_grading_info"]
});
assert.match(extended.candidate.title, /\bRC\b/);
assert.match(extended.candidate.title, /PSA 10$/);
assert.ok(extended.candidate.length <= 80);

const nonLot = composeWithLotContractRecoveryV1({ ...base, grammar: "standard" });
assert.equal(nonLot.candidate.title, nonLot.baseline.title);
assert.deepEqual(nonLot.applied, []);

const guardedCardName = composeWithLotContractRecoveryV1({
  ...base,
  card_name: "Card Shop Promo",
  subjects: ["A Very Long Player Name", "Another Very Long Player Name", "Third Long Player Name"]
}, { enabledMechanisms: ["compact_lot_quantity"] });
if (guardedCardName.baseline.dropped.includes("card_name")) {
  assert.equal(guardedCardName.candidate.title, guardedCardName.baseline.title);
  assert.equal(guardedCardName.rejected.some((entry) =>
    entry.reason === "card_token_collision_with_dropped_card_name"), true);
}

assert.deepEqual(LOT_CONTRACT_RECOVERY_MECHANISMS_V1, [
  "compact_lot_quantity",
  "manufacturer_product_set",
  "shared_observable_components",
  "shared_grading_info"
]);

console.log("lot contract recovery v1 tests passed");
