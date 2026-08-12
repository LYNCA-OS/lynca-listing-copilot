#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  CANONICAL_NAMING_RELEASE_CONTRACT,
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3,
  LYNCA_STANDARD_PROFILE_VERSION_V1,
  LYNCA_STANDARD_PROFILE_VERSION_V2,
  LYNCA_STANDARD_PROFILE_VERSION_V3,
  composeLyncaStandardNameForProfile
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  LYNCA_STANDARD_NAMING_PROFILE_V01,
  LYNCA_STANDARD_NAMING_PROFILE_V02,
  LYNCA_STANDARD_NAMING_PROFILE_V03,
  composeCanonicalName
} from "../lib/listing/thin/canonical-naming-layer.mjs";
import {
  CARD_NAME_PREDICATE,
  CURRENT_CARD_CONCEPT,
  CURRENT_CARD_VALUE,
  SET_MEMBERSHIP_PREDICATE,
  evaluateSetCardNameConfusionV1,
  validateSetCardNameRelationsV1
} from "../experiments/csm-frontier/set-card-name-contract-v1.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));

function semanticState() {
  return {
    facts: [{
      fact_id: "fact_current",
      concept: CURRENT_CARD_CONCEPT,
      canonical_path: "",
      value: CURRENT_CARD_VALUE,
      status: "SUPPORTED",
      confidence: "HIGH",
      source_ids: ["src_image"]
    }, {
      fact_id: "fact_set",
      concept: "canonical.set",
      canonical_path: "set",
      value: "Rookie Signatures",
      status: "SUPPORTED",
      confidence: "HIGH",
      source_ids: ["src_image", "https://cards.example/checklist"]
    }, {
      fact_id: "fact_card_name",
      concept: "canonical.card_name",
      canonical_path: "card_name",
      value: "Debut Designs",
      status: "SUPPORTED",
      confidence: "HIGH",
      source_ids: ["src_image"]
    }],
    relationships: [{
      relationship_id: "rel_set",
      predicate: SET_MEMBERSHIP_PREDICATE,
      subject_fact_id: "fact_current",
      object_fact_id: "fact_set",
      source_ids: ["https://cards.example/checklist"]
    }, {
      relationship_id: "rel_card_name",
      predicate: CARD_NAME_PREDICATE,
      subject_fact_id: "fact_current",
      object_fact_id: "fact_card_name",
      source_ids: ["src_image"]
    }]
  };
}

const valid = validateSetCardNameRelationsV1(semanticState(), {
  currentCardSourceIds: ["src_image"]
});
assert.equal(valid.set.value, "Rookie Signatures");
assert.equal(valid.card_name.value, "Debut Designs");

const missingMembership = semanticState();
missingMembership.relationships.shift();
assert.throws(() => validateSetCardNameRelationsV1(missingMembership),
  /set_card_name_relation_required:set/,
  "a Set string without a current-card membership relation is not a Set decision");

const wrongRole = semanticState();
wrongRole.relationships.push({
  relationship_id: "rel_wrong_role",
  predicate: CARD_NAME_PREDICATE,
  subject_fact_id: "fact_current",
  object_fact_id: "fact_set",
  source_ids: ["src_image"]
});
assert.throws(() => validateSetCardNameRelationsV1(wrongRole),
  /set_card_name_wrong_relation:set/);

const duplicate = semanticState();
duplicate.facts.find((fact) => fact.fact_id === "fact_card_name").value =
  "Rookie Signatures";
assert.throws(() => validateSetCardNameRelationsV1(duplicate),
  /set_card_name_duplicate_role_value/);

const report = evaluateSetCardNameConfusionV1([{
  case_id: "exact",
  expected: { set: "Rookie Signatures", card_name: "Debut Designs" },
  actual: { set: "Rookie Signatures", card_name: "Debut Designs" }
}, {
  case_id: "card-name-put-in-set",
  expected: { set: "", card_name: "Downtown!" },
  actual: { set: "Downtown", card_name: "" }
}, {
  case_id: "set-put-in-card-name",
  expected: { set: "Rookie Ticket", card_name: "" },
  actual: { set: "", card_name: "Rookie Ticket" }
}, {
  case_id: "duplicated",
  expected: { set: "Rookie Signatures", card_name: "Debut Designs" },
  actual: { set: "Debut Designs", card_name: "Debut Designs" }
}]);
assert.equal(report.title_strings_read, false);
assert.equal(report.exact_role_match, 1);
assert.equal(report.card_name_to_set, 1);
assert.equal(report.set_to_card_name, 1);
assert.equal(report.duplicate_role, 1);
assert.equal(report.confusion_error_count, 3);
assert.throws(() => evaluateSetCardNameConfusionV1([{
  case_id: "title-is-not-a-label",
  expected: { set: "", card_name: "Downtown" },
  actual: { set: "", card_name: "Downtown" },
  title: "Downtown Player"
}]), /set_card_name_confusion_case_shape/);

const fields = {
  year: "2024",
  product: "Prizm",
  set: "Rookie Signatures",
  card_name: "Debut Designs",
  subjects: ["Jane Doe"],
  card_number: "RS-JD"
};
const historicalV1 = composeLyncaStandardNameForProfile(fields, {
  marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V1
});
const historicalV2 = composeLyncaStandardNameForProfile(fields, {
  marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V2
});
const founderBetaV3 = composeLyncaStandardNameForProfile(fields, {
  marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V3
});
assert.equal(historicalV1.title,
  "2024 Prizm Rookie Signatures Jane Doe Debut Designs #RS-JD");
assert.equal(historicalV2.title, historicalV1.title,
  "v0.2 historical bytes remain unchanged");
assert.equal(founderBetaV3.title,
  "2024 Prizm Rookie Signatures Debut Designs Jane Doe #RS-JD");
assert.ok(founderBetaV3.title.indexOf("Rookie Signatures")
  < founderBetaV3.title.indexOf("Debut Designs"));
assert.ok(founderBetaV3.title.indexOf("Debut Designs")
  < founderBetaV3.title.indexOf("Jane Doe"));

assert.equal(CANONICAL_NAMING_RELEASE_CONTRACT_V1.profile_version, "0.1");
assert.equal(CANONICAL_NAMING_RELEASE_CONTRACT_V2.profile_version, "0.2");
assert.equal(CANONICAL_NAMING_RELEASE_CONTRACT_V3.profile_version, "0.3");
assert.strictEqual(CANONICAL_NAMING_RELEASE_CONTRACT,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  "adding v0.3 must not activate it");
assert.deepEqual(LYNCA_STANDARD_NAMING_PROFILE_V01.renderOrder.slice(3, 6),
  ["set", "subjects", "card_name"]);
assert.deepEqual(LYNCA_STANDARD_NAMING_PROFILE_V02.renderOrder.slice(3, 6),
  ["set", "subjects", "card_name"]);
assert.deepEqual(LYNCA_STANDARD_NAMING_PROFILE_V03.renderOrder.slice(3, 6),
  ["set", "card_name", "subjects"]);
assert.deepEqual(LYNCA_STANDARD_NAMING_PROFILE_V03.mandatoryIdentityFields, ["subjects"]);

const tight = composeCanonicalName({
  set: "A Very Long Set Name",
  card_name: "A Very Long Card Design",
  subjects: ["Jane Doe"],
  card_number: "1",
  serial: "1/1"
}, { profile: LYNCA_STANDARD_NAMING_PROFILE_V03, limit: 20 });
assert.equal(tight.title, "Jane Doe #1 1/1");
assert.ok(tight.trace.selected.some((row) => row.field === "subjects"));
assert.ok(tight.trace.omitted.some((row) => row.field === "card_name"));

// Ensure callers cannot mutate a frozen historical profile through v0.3.
const historicalOrder = clone(LYNCA_STANDARD_NAMING_PROFILE_V02.renderOrder);
assert.deepEqual(historicalOrder, [
  "year", "manufacturer", "product", "set", "subjects", "card_name",
  "release_variant", "print_finish", "descriptive_rarity", "components",
  "search_optimization", "team", "card_number", "serial", "grading_info"
]);

process.stdout.write("COS-59 Set/Card Name relations, confusion, and v0.3 order: ok\n");
