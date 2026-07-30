import assert from "node:assert/strict";

import {
  planSecondLookCardCode,
  secondLookIdentityCriticalReasons,
  secondLookPlanInputHash
} from "../lib/listing/catalog/second-look-planner.mjs";

const images = [
  { id: "front-1", storageRole: "front_original", content_sha256: "a".repeat(64) },
  { id: "back-1", storageRole: "back_original", contentSha256: "b".repeat(64) },
  {
    id: "code-1",
    storageRole: "card_code_crop",
    derived: true,
    crop_metadata: { source_content_sha256: "c".repeat(64) }
  }
];

const tcg = planSecondLookCardCode({
  resolved: { category: "TCG", players: ["Monkey D. Luffy"], product: "One Piece" },
  unresolved: ["tcg_card_number"],
  images,
  evaluationEnabled: true
});
assert.equal(tcg.should_run, true);
assert.equal(tcg.eligibility_class, "TCG_CODE");
assert.deepEqual(tcg.target_fields, ["card_number_or_code"]);
assert.equal(tcg.image_policy, "RELEVANT_CROPS_ONLY");
assert.equal(tcg.input_hash, secondLookPlanInputHash(tcg));
assert.match(tcg.replay_input.image_manifest[0].identity_sha256, /^[0-9a-f]{64}$/);
assert.equal(tcg.replay_input.image_manifest[0].identity_source, "CONTENT_SHA256");

const pathOnlyIdentity = planSecondLookCardCode({
  resolved: { category: "TCG" },
  unresolved: ["tcg_card_number"],
  images: [{ id: "code-unsafe", object_path: "tenant/asset/code.jpg", storageRole: "card_code_crop" }],
  evaluationEnabled: true
});
assert.equal(pathOnlyIdentity.should_run, false);
assert.equal(pathOnlyIdentity.reason_code, "IMMUTABLE_IMAGE_IDENTITY_REQUIRED");
assert.equal(pathOnlyIdentity.replay_input.image_manifest[0].identity_sha256, null);

const disabled = planSecondLookCardCode({
  resolved: { category: "TCG" },
  unresolved: ["tcg_card_number"],
  images,
  evaluationEnabled: false
});
assert.equal(disabled.should_run, false);
assert.equal(disabled.reason_code, "EVALUATION_PROFILE_REQUIRED");

const lowValueStandard = planSecondLookCardCode({
  resolved: { category: "baseball" },
  unresolved: ["collector_number"],
  images,
  evaluationEnabled: true
});
assert.equal(lowValueStandard.should_run, false);
assert.equal(lowValueStandard.reason_code, "LOW_VALUE_STANDARD_CARD_NUMBER");

const identityCritical = planSecondLookCardCode({
  resolved: { category: "baseball" },
  unresolved: ["collector_number"],
  images,
  evaluationEnabled: true,
  identityCriticalReason: secondLookIdentityCriticalReasons.EXACT_IDENTITY_CARD_CODE_GAP
});
assert.equal(identityCritical.should_run, true);
assert.equal(identityCritical.eligibility_class, "IDENTITY_CRITICAL_CARD_CODE");

const noRegion = planSecondLookCardCode({
  resolved: { category: "TCG" },
  unresolved: ["tcg_card_number"],
  images: [{ id: "front-1", storageRole: "front_original", content_sha256: "d".repeat(64) }],
  evaluationEnabled: true
});
assert.equal(noRegion.reason_code, "CARD_CODE_IMAGE_REGION_UNAVAILABLE");

const alreadyObserved = planSecondLookCardCode({
  resolved: { category: "TCG", tcg_card_number: "OP01-120" },
  unresolved: [],
  images,
  evaluationEnabled: true
});
assert.equal(alreadyObserved.reason_code, "CARD_CODE_ALREADY_OBSERVED");

const serialIsNotCardCode = planSecondLookCardCode({
  resolved: { category: "TCG" },
  unresolved: ["print_run_denominator"],
  images,
  evaluationEnabled: true
});
assert.equal(serialIsNotCardCode.should_run, false);
assert.equal(serialIsNotCardCode.reason_code, "CARD_CODE_UNKNOWN_STATE_NOT_PROVEN");

console.log("second look planner tests passed");
