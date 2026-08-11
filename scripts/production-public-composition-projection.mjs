import { createHash } from "node:crypto";

import {
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  CANONICAL_NAMING_RELEASE_CONTRACT_V1,
  CANONICAL_NAMING_RELEASE_CONTRACT_V2
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V1,
  THIN_COMPOSER_VERSION_V2
} from "../lib/listing/thin/csm-persistence.mjs";

const PUBLIC_PROFILE_KEYS = Object.freeze([
  "composer_version", "contract_version", "marketplace_profile_version"
]);
const PRIVATE_PROFILE_KEYS = Object.freeze([
  "composer_version", "contract_version"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function projection({ id, composerVersion, marketplaceProfileVersion, profilePublic }) {
  return {
    id,
    composer_version: composerVersion,
    marketplace_profile_version: marketplaceProfileVersion,
    marketplace_profile_public: profilePublic,
    public_output_keys: profilePublic ? PUBLIC_PROFILE_KEYS : PRIVATE_PROFILE_KEYS
  };
}

const externalProjections = Object.entries(
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
).map(([releaseId, release]) => projection({
  id: `external_identity:${releaseId}`,
  composerVersion: release.output.composer_version,
  marketplaceProfileVersion: release.output.marketplace_profile_version,
  profilePublic: false
}));

export const PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX = deepFreeze([
  projection({
    id: "canonical_naming:v1",
    composerVersion: CANONICAL_NAMING_RELEASE_CONTRACT_V1.composer_version,
    marketplaceProfileVersion:
      CANONICAL_NAMING_RELEASE_CONTRACT_V1.marketplace_profile_version,
    profilePublic: true
  }),
  projection({
    id: "canonical_naming:v2",
    composerVersion: CANONICAL_NAMING_RELEASE_CONTRACT_V2.composer_version,
    marketplaceProfileVersion:
      CANONICAL_NAMING_RELEASE_CONTRACT_V2.marketplace_profile_version,
    profilePublic: true
  }),
  projection({
    id: "legacy_ebay:v1",
    composerVersion: THIN_COMPOSER_VERSION_V1,
    marketplaceProfileVersion: EBAY_PROFILE_VERSION,
    profilePublic: false
  }),
  projection({
    id: "legacy_ebay:v2",
    composerVersion: THIN_COMPOSER_VERSION_V2,
    marketplaceProfileVersion: EBAY_PROFILE_VERSION,
    profilePublic: false
  }),
  ...externalProjections
]);

const tupleKeys = PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX.map((entry) => (
  `${entry.composer_version}\0${entry.marketplace_profile_version}`
));
if (new Set(tupleKeys).size !== tupleKeys.length) {
  throw new Error("production_public_composition_projection_tuple_duplicate");
}

const contractPayload = {
  schema_version: "production-public-composition-projection-contract-v1",
  projections: PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX
};

export const PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_CONTRACT = deepFreeze({
  ...contractPayload,
  contract_sha256: createHash("sha256")
    .update(JSON.stringify(contractPayload))
    .digest("hex")
});

export function productionPublicCompositionProjectionForOwner(owner) {
  const ownerComposer = String(owner?.composer || "").trim();
  const storedComposer = String(owner?.composer_version || "").trim();
  const ownerProfile = String(owner?.marketplace_profile || "").trim();
  const storedProfile = String(owner?.marketplace_profile_version || "").trim();
  if (Boolean(ownerComposer) !== Boolean(ownerProfile)
      || Boolean(storedComposer) !== Boolean(storedProfile)) return null;
  if ((ownerComposer && storedComposer && ownerComposer !== storedComposer)
      || (ownerProfile && storedProfile && ownerProfile !== storedProfile)) return null;
  const composerVersion = ownerComposer || storedComposer;
  const marketplaceProfileVersion = ownerProfile || storedProfile;
  if (!composerVersion || !marketplaceProfileVersion) return null;
  return PRODUCTION_PUBLIC_COMPOSITION_PROJECTION_MATRIX.find((entry) => (
    entry.composer_version === composerVersion
      && entry.marketplace_profile_version === marketplaceProfileVersion
  )) || null;
}
