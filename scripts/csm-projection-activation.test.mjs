#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CANONICAL_NAMING_RELEASE_CONTRACT,
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  CAPTURED_PRODUCTION_E1AE_WRITER_CONTRACT_ID,
  CSM_PROJECTION_ACTIVATION,
  CSM_FUTURE_PENDING_CHECKPOINT_READER,
  CSM_PROJECTION_STATE_ACTIVE,
  CSM_PROJECTION_STATE_DORMANT,
  CSM_WRITER_PROJECTION_CONTRACTS,
  activeStandardWriterProjection,
  activeVerifiedOriginalObservationReleaseId,
  validateCsmProjectionActivation
} from "../lib/listing/thin/csm-projection-activation.mjs";
import { EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3 } from
  "../lib/listing/knowledge/csm-external-identity-support.mjs";
import { LYNCA_STANDARD_PROFILE_VERSION } from "../lib/listing/thin/csm-persistence.mjs";
import {
  VERIFIED_ORIGINAL_OBSERVATION_LEGACY_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT
} from "../lib/listing/thin/verified-original-observation-support.mjs";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableSha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

assert.equal(CSM_PROJECTION_ACTIVATION.schema_version, "csm-projection-activation.v2");
assert.match(CSM_PROJECTION_ACTIVATION.activation_sha256, /^[0-9a-f]{64}$/);
const activeWriter = CSM_PROJECTION_ACTIVATION.active_writer;
const activationBody = structuredClone(CSM_PROJECTION_ACTIVATION);
delete activationBody.activation_sha256;
assert.equal(CSM_PROJECTION_ACTIVATION.activation_sha256, stableSha256(activationBody),
  "the live activation digest must follow the selected writer tuple");
assert.deepEqual(activeStandardWriterProjection(), activeWriter.standard);
assert.equal(activeVerifiedOriginalObservationReleaseId(),
  activeWriter.verified_original_observation_overlay);
assert.equal(validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION).state,
  activeWriter.contract_id === CAPTURED_PRODUCTION_E1AE_WRITER_CONTRACT_ID
    ? CSM_PROJECTION_STATE_DORMANT : CSM_PROJECTION_STATE_ACTIVE);
const b159ActivationBody = {
  ...activationBody,
  active_writer: structuredClone(CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible)
};
assert.equal(stableSha256(b159ActivationBody),
  "fb3f4339af5044e3148a3b65e733fe5fd790ddbb02a371e7bb6f782a041d6dbe");
assert.equal(stableSha256(CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible),
  "8645b8ba3820992f0d18a29a0a3be5cc268cd698f9925814b5d501dc1471fdfb");
assert.equal(stableSha256(CSM_WRITER_PROJECTION_CONTRACTS.future_v3),
  "c46cfb61583f7c01dcddcce6cdec2e3bf47832f2067635ffee4a0df0686ee5ff");
assert.equal(stableSha256(CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3),
  "3a262b60bf08b12598b1ba1529f44f073ef0bb01aab794651beb008876e7f6ce");
assert.equal(
  CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible
    .verified_original_observation_overlay,
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
assert.equal(CSM_FUTURE_PENDING_CHECKPOINT_READER.descriptor_sha256,
  "f0afeed9f603386e1eb743f678c920256ab6f862383a264dd31607c246ba37da");
assert.equal(CSM_FUTURE_PENDING_CHECKPOINT_READER.writer.contract_id,
  "stage-v3-web-v2-external-identity-v3-writer-v1");
assert.equal(CSM_FUTURE_PENDING_CHECKPOINT_READER.writer.writer_contract_sha256,
  "3a262b60bf08b12598b1ba1529f44f073ef0bb01aab794651beb008876e7f6ce");
assert.equal(CSM_FUTURE_PENDING_CHECKPOINT_READER.external_identity
  .resolution_contract_sha256, EXTERNAL_IDENTITY_RESOLUTION_CONTRACT_V3.contract_sha256);
assert.equal(CSM_FUTURE_PENDING_CHECKPOINT_READER
  .combined_post_observation_resolution_contract.contract_sha256,
"6c59b33636b1ba4fd920793992d89517ded3b754076c019164a7acf95e78f2ed");

const future = {
  ...structuredClone(CSM_PROJECTION_ACTIVATION),
  active_writer: structuredClone(CSM_WRITER_PROJECTION_CONTRACTS.future_v3)
};
assert.equal(validateCsmProjectionActivation(future).state, CSM_PROJECTION_STATE_ACTIVE);
const futureExternalIdentityV3 = {
  ...structuredClone(CSM_PROJECTION_ACTIVATION),
  active_writer: structuredClone(
    CSM_WRITER_PROJECTION_CONTRACTS.future_external_identity_v3
  )
};
assert.equal(validateCsmProjectionActivation(futureExternalIdentityV3).state,
  CSM_PROJECTION_STATE_ACTIVE);
for (const forwardReaders of [
  {},
  {
    ...structuredClone(CSM_PROJECTION_ACTIVATION.forward_readers),
    future_pending_checkpoint: undefined
  },
  {
    ...structuredClone(CSM_PROJECTION_ACTIVATION.forward_readers),
    unexpected: true
  },
  {
    ...structuredClone(CSM_PROJECTION_ACTIVATION.forward_readers),
    future_pending_checkpoint: {
      ...structuredClone(CSM_FUTURE_PENDING_CHECKPOINT_READER),
      descriptor_sha256: "0".repeat(64)
    }
  }
]) {
  assert.throws(() => validateCsmProjectionActivation({
    ...CSM_PROJECTION_ACTIVATION,
    forward_readers: forwardReaders
  }), /csm_projection_activation_atomicity_invalid/);
}
for (const mixed of [
  {
    ...CSM_PROJECTION_ACTIVATION,
    active_writer: {
      ...CSM_PROJECTION_ACTIVATION.active_writer,
      verified_original_observation_overlay:
        CSM_PROJECTION_ACTIVATION.active_writer.verified_original_observation_overlay
          === VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
          ? VERIFIED_ORIGINAL_OBSERVATION_LEGACY_RELEASE_ID
          : VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
    }
  },
  {
    ...future,
    active_writer: {
      ...future.active_writer,
      durable_projection_contract_version:
        CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible
          .durable_projection_contract_version
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
