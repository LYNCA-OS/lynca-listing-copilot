import assert from "node:assert/strict";
import {
  buildCatalogDecisionFingerprint,
  catalogSourceFingerprintContract
} from "../lib/listing/catalog/catalog-source-fingerprint.mjs";

const baseRows = [{
  source_row_key: "official:set:001",
  import_status: "OFFICIAL_CHECKLIST_CANDIDATE",
  parse_confidence: 0.98,
  canonical_title: "Starter Set Subject #001 C",
  identity_fields: {
    product: "Starter Set",
    card_name: "Subject",
    card_number: "001",
    rarity: "C"
  },
  physical_instance_fields: {},
  field_statuses: {
    product: "AUTO_PARSED_FROM_OFFICIAL_CHECKLIST",
    card_name: "AUTO_PARSED_FROM_OFFICIAL_CHECKLIST"
  }
}];

const reorderedRows = [{
  ...baseRows[0],
  identity_fields: {
    rarity: "C",
    card_number: "001",
    card_name: "Subject",
    product: "Starter Set"
  }
}];

const original = buildCatalogDecisionFingerprint(baseRows);
const reordered = buildCatalogDecisionFingerprint(reorderedRows);
const changedFact = buildCatalogDecisionFingerprint([{
  ...baseRows[0],
  identity_fields: { ...baseRows[0].identity_fields, rarity: "SR" }
}]);
const changedDecision = buildCatalogDecisionFingerprint([{
  ...baseRows[0],
  import_status: "OFFICIAL_PARSE_REVIEW_REQUIRED",
  review_notes: "Official product is missing"
}]);

assert.equal(catalogSourceFingerprintContract.owner, "catalog_source_fingerprint");
assert.match(original.checksum, /^[a-f0-9]{64}$/);
assert.equal(original.row_count, 1);
assert.equal(original.checksum, reordered.checksum);
assert.notEqual(original.checksum, changedFact.checksum);
assert.notEqual(original.checksum, changedDecision.checksum);
assert.equal(buildCatalogDecisionFingerprint(null).row_count, 0);

console.log("catalog source fingerprint tests passed");
