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
  CSM_WRITER_PROJECTION_CONTRACTS,
  activeStandardWriterProjection,
  activeVerifiedOriginalObservationReleaseId,
  validateCsmProjectionActivation
} from "../lib/listing/thin/csm-projection-activation.mjs";
import { LYNCA_STANDARD_PROFILE_VERSION } from "../lib/listing/thin/csm-persistence.mjs";
import {
  VERIFIED_ORIGINAL_OBSERVATION_LEGACY_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT
} from "../lib/listing/thin/verified-original-observation-support.mjs";

assert.equal(CSM_PROJECTION_ACTIVATION.schema_version, "csm-projection-activation.v2");
assert.match(CSM_PROJECTION_ACTIVATION.activation_sha256, /^[0-9a-f]{64}$/);
assert.deepEqual(activeStandardWriterProjection(), {
  composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version,
  marketplace_profile_version:
    CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version
});
assert.equal(activeVerifiedOriginalObservationReleaseId(),
  VERIFIED_ORIGINAL_OBSERVATION_LEGACY_RELEASE_ID);
assert.equal(validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION).state,
  CSM_PROJECTION_STATE_DORMANT);
assert.equal(
  CSM_PROJECTION_ACTIVATION.active_writer.verified_original_observation_overlay,
  VERIFIED_ORIGINAL_OBSERVATION_LEGACY_RELEASE_ID
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

const future = {
  ...structuredClone(CSM_PROJECTION_ACTIVATION),
  active_writer: structuredClone(CSM_WRITER_PROJECTION_CONTRACTS.future_v3)
};
assert.equal(validateCsmProjectionActivation(future).state, CSM_PROJECTION_STATE_ACTIVE);
for (const mixed of [
  {
    ...CSM_PROJECTION_ACTIVATION,
    active_writer: {
      ...CSM_PROJECTION_ACTIVATION.active_writer,
      verified_original_observation_overlay: VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
    }
  },
  {
    ...future,
    active_writer: {
      ...future.active_writer,
      durable_projection_contract_version:
        CSM_PROJECTION_ACTIVATION.active_writer.durable_projection_contract_version
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
