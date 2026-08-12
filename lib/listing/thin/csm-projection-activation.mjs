import { createHash } from "node:crypto";

import {
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2,
  CANONICAL_NAMING_RELEASE_CONTRACT_V3
} from "./canonical-naming-adapter.mjs";
import {
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V2
} from "./csm-persistence.mjs";
import {
  VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT
} from "./verified-original-observation-support.mjs";

export const CSM_PROJECTION_STATE_DORMANT = "DORMANT_FORWARD_READER_BRIDGE";
export const CSM_PROJECTION_STATE_ACTIVE = "ACTIVE_V3_VERIFIED_OVERLAY";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function standardReaderDescriptor(contract) {
  return {
    composer_version: contract.composer_version,
    marketplace_profile_version: contract.marketplace_profile_version,
    release_contract_schema_version: contract.schema_version,
    profile_id: contract.profile_id,
    profile_version: contract.profile_version
  };
}

const ACTIVATION_BODY = {
  schema_version: "csm-projection-activation.v2",
  activation_id: "standard-v3-v03-verified-overlay-active-v1",
  active_writer: {
    standard: {
      composer_version: CANONICAL_NAMING_RELEASE_CONTRACT_V3.composer_version,
      marketplace_profile_version:
        CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version
    },
    verified_original_observation_overlay: VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
  },
  forward_readers: {
    standard: [
      standardReaderDescriptor(CANONICAL_NAMING_RELEASE_CONTRACT_V1),
      standardReaderDescriptor(CANONICAL_NAMING_RELEASE_CONTRACT_V2),
      standardReaderDescriptor(CANONICAL_NAMING_RELEASE_CONTRACT_V3)
    ],
    verified_original_observation_overlay: {
      replay_registry_schema_version:
        VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.schema_version,
      release_ids: Object.keys(
        VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.releases
      ).sort(),
      resolution_contract_schema_version:
        VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.schema_version,
      resolution_contract_sha256:
        VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
      resolver_version: VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.resolver_version,
      conflict_policy_version:
        VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.conflict_policy_version
    }
  }
};

export function validateCsmProjectionActivation(value) {
  const standard = value?.active_writer?.standard;
  const overlay = value?.active_writer?.verified_original_observation_overlay;
  const dormant = standard?.composer_version === THIN_COMPOSER_VERSION_V2
    && standard?.marketplace_profile_version === EBAY_PROFILE_VERSION
    && overlay === null;
  const active = standard?.composer_version
      === CANONICAL_NAMING_RELEASE_CONTRACT_V3.composer_version
    && standard?.marketplace_profile_version
      === CANONICAL_NAMING_RELEASE_CONTRACT_V3.marketplace_profile_version
    && overlay === VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID;
  if (dormant === active) {
    throw Object.assign(new TypeError("csm_projection_activation_atomicity_invalid"), {
      code: "csm_projection_activation_atomicity_invalid"
    });
  }
  return Object.freeze({
    state: dormant ? CSM_PROJECTION_STATE_DORMANT : CSM_PROJECTION_STATE_ACTIVE,
    standard: Object.freeze({
      composer_version: standard.composer_version,
      marketplace_profile_version: standard.marketplace_profile_version
    }),
    verified_original_observation_overlay: overlay
  });
}

validateCsmProjectionActivation(ACTIVATION_BODY);

export const CSM_PROJECTION_ACTIVATION = deepFreeze({
  ...ACTIVATION_BODY,
  activation_sha256: createHash("sha256").update(stableJson(ACTIVATION_BODY)).digest("hex")
});

export function activeStandardWriterProjection() {
  return validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION).standard;
}

export function activeVerifiedOriginalObservationReleaseId() {
  return validateCsmProjectionActivation(CSM_PROJECTION_ACTIVATION)
    .verified_original_observation_overlay;
}
