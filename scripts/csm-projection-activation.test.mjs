#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CANONICAL_NAMING_RELEASE_CONTRACT,
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  CSM_PROJECTION_ACTIVATION,
  CSM_PROJECTION_STATE_ACTIVE,
  CSM_PROJECTION_STATE_DORMANT,
  activeStandardWriterProjection,
  activeVerifiedOriginalObservationReleaseId,
  validateCsmProjectionActivation
} from "../lib/listing/thin/csm-projection-activation.mjs";
import {
  EBAY_PROFILE_VERSION,
  LYNCA_STANDARD_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V2
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT
} from "../lib/listing/thin/verified-original-observation-support.mjs";

assert.equal(CSM_PROJECTION_ACTIVATION.schema_version, "csm-projection-activation.v2");
assert.match(CSM_PROJECTION_ACTIVATION.activation_sha256, /^[0-9a-f]{64}$/);
assert.deepEqual(activeStandardWriterProjection(), {
  composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V3.composer_version,
  marketplace_profile_version:
    CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version
});
assert.equal(activeVerifiedOriginalObservationReleaseId(),
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID);
assert.equal(validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION).state,
  CSM_PROJECTION_STATE_ACTIVE);
assert.equal(
  CSM_PROJECTION_ACTIVATION.active_writer.verified_original_observation_overlay,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
);
assert.equal(CANONICAL_NAMING_RELEASE_CONTRACT, CANONICAL_NAMING_RELEASE_CONTRACT_V3);
assert.equal(LYNCA_STANDARD_PROFILE_VERSION,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version);
assert.deepEqual(CSM_PROJECTION_ACTIVATION.forward_readers.standard, [
  {
    composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V1.composer_version,
    marketplace_profile_version:
      CANONICAL_NAMING_RELEASE_CONTRACT_V1.marketplace_profile_version,
    release_contract_schema_version: CANONICAL_NAMING_RELEASE_CONTRACT_V1.schema_version,
    profile_id: CANONICAL_NAMING_RELEASE_CONTRACT_V1.profile_id,
    profile_version: CANONICAL_NAMING_RELEASE_CONTRACT_V1.profile_version
  },
  {
    composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version,
    marketplace_profile_version:
      CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version,
    release_contract_schema_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.schema_version,
    profile_id: CANONICAL_NAMING_RELEASE_CONTRACT_V2.profile_id,
    profile_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.profile_version
  },
  {
    composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V3.composer_version,
    marketplace_profile_version:
      CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version,
    release_contract_schema_version: CANONICAL_NAMING_RELEASE_CONTRACT_V3.schema_version,
    profile_id: CANONICAL_NAMING_RELEASE_CONTRACT_V3.profile_id,
    profile_version: CANONICAL_NAMING_RELEASE_CONTRACT_V3.profile_version
  }
]);
assert.equal(
  CSM_PROJECTION_ACTIVATION.forward_readers.verified_original_observation_overlay
    .resolution_contract_sha256,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256
);
assert.deepEqual(
  CSM_PROJECTION_ACTIVATION.forward_readers.verified_original_observation_overlay.release_ids,
  Object.keys(VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.releases).sort()
);
assert.ok(Object.isFrozen(CSM_PROJECTION_ACTIVATION));
assert.ok(Object.isFrozen(CSM_PROJECTION_ACTIVATION.active_writer));
assert.ok(Object.isFrozen(CSM_PROJECTION_ACTIVATION.forward_readers));

const dormant = structuredClone(CSM_PROJECTION_ACTIVATION);
dormant.active_writer.standard = {
  composer_version: THIN_COMPOSER_VERSION_V2,
  marketplace_profile_version: EBAY_PROFILE_VERSION
};
dormant.active_writer.verified_original_observation_overlay = null;
assert.equal(validateCsmProjectionActivation(dormant).state, CSM_PROJECTION_STATE_DORMANT);
for (const mixed of [
  {
    ...CSM_PROJECTION_ACTIVATION,
    active_writer: {
      ...CSM_PROJECTION_ACTIVATION.active_writer,
      verified_original_observation_overlay: null
    }
  },
  {
    ...dormant,
    active_writer: {
      ...dormant.active_writer,
      verified_original_observation_overlay: VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
    }
  }
]) {
  assert.throws(() => validateCsmProjectionActivation(mixed),
    /csm_projection_activation_atomicity_invalid/);
}

const replaySource = readFileSync("lib/listing/thin/csm-replay.mjs", "utf8");
assert.doesNotMatch(replaySource, /csm-projection-activation/,
  "historical replay must dispatch only from stored version references");

console.log("csm projection activation: ok");
