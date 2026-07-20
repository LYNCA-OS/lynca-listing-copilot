import assert from "node:assert/strict";
import {
  catalogSourceAuthorityProfile,
  compareCatalogSourceAuthority
} from "../lib/listing/v4/policy/catalog-source-authority-policy.mjs";

const writer = {
  sourceType: "INTERNAL_CORRECTED_TITLE",
  sourceTrust: "APPROVED_REFERENCE"
};
const official = {
  sourceType: "TOPPS_OFFICIAL_CHECKLIST",
  sourceTrust: "APPROVED_REFERENCE"
};

const writerProfile = catalogSourceAuthorityProfile(writer);
const officialProfile = catalogSourceAuthorityProfile(official);

assert.equal(writerProfile.catalog_admission, "PRIMARY");
assert.equal(officialProfile.catalog_admission, "PRIMARY");
assert.equal(writerProfile.runtime_chain_effect, "NONE");
assert.equal(officialProfile.runtime_chain_effect, "NONE");
assert.equal(compareCatalogSourceAuthority(writer, official, "commercial_expression").preferred, "LEFT");
assert.equal(compareCatalogSourceAuthority(writer, official, "identity_structure").preferred, "RIGHT");
assert.equal(writerProfile.physical_instance_rank, 0);
assert.equal(officialProfile.physical_instance_rank, 0);

console.log("catalog source authority policy tests passed");
