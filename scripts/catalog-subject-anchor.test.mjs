import assert from "node:assert/strict";

import { planRetrievalQueries } from "../lib/listing/retrieval/query-planner.mjs";
import { catalogRetrievalFamiliesForFields } from "../lib/listing/v4/pipeline/native-recognition-core.mjs";
import { retrievalProviderIds, retrievalQueryFamilies } from "../lib/listing/retrieval/retrieval-contract.mjs";

// Layer A: a product-independent subject anchor lane must keep catalog recall
// alive when the model mis-identifies the product. Without it, every
// product-scoped lane queries the wrong product and returns nothing
// (catalog_raw_candidate_count=0).

const ANCHOR = retrievalQueryFamilies.CATALOG_SUBJECT_ANCHOR;

function anchorQuery(resolved) {
  return planRetrievalQueries({ resolved, includeExternal: false })
    .find((query) => query.family === ANCHOR);
}

// 1. Mis-identified product + subject + serial denominator: anchor is planned,
//    routed to the catalog provider, ignores the observed product, and carries
//    the subject/serial anchors without an exact_product filter.
const wrongProductSerial = anchorQuery({
  year: "2024",
  product: "Chrome Black",
  players: ["Paul Kasey"],
  serial_number: "12/25"
});
assert.ok(wrongProductSerial, "subject anchor lane should be planned for a mis-identified product with a serial denominator");
assert.equal(wrongProductSerial.provider_id, retrievalProviderIds.CATALOG, "subject anchor must route to the catalog provider, not an external search");
assert.equal(wrongProductSerial.ignore_observed_product, true, "subject anchor must ignore the observed (mis-identified) product");
assert.equal(wrongProductSerial.exact_product, undefined, "subject anchor must not carry an exact_product filter");
assert.equal(wrongProductSerial.exact_subject, "Paul Kasey");
assert.equal(wrongProductSerial.exact_serial_denominator, "25");

// 2. Subject + year (no serial) still plans the anchor.
assert.ok(
  anchorQuery({ year: "2024", product: "Chrome", players: ["Shohei Ohtani"] }),
  "subject anchor lane should be planned for a mis-identified product anchored on year"
);

// 3. Subject with no secondary anchor (no serial/year/set) does NOT plan the
//    anchor, to avoid pure-subject noise on common names.
assert.equal(
  anchorQuery({ product: "Chrome", players: ["Paul Kasey"] }),
  undefined,
  "subject anchor lane must not fire on subject alone without a secondary anchor"
);

// 4. Post-provider family selection includes the anchor exactly when a subject
//    plus a secondary anchor is present and there is no exact printed code.
function postFamilies(fields) {
  return catalogRetrievalFamiliesForFields(fields, { stagePhase: "post_provider" });
}

assert.ok(
  postFamilies({ product: "Chrome Black", players: ["Paul Kasey"], serial_number: "12/25" }).includes(ANCHOR),
  "post-provider selection should include the anchor for a mis-identified product with a serial denominator"
);
assert.ok(
  postFamilies({ product: "Chrome", players: ["Shohei Ohtani"], year: "2024" }).includes(ANCHOR),
  "post-provider selection should include the anchor for a mis-identified product anchored on year"
);
// An exact printed code is already a product-independent identity anchor, so the
// subject anchor lane is redundant and must be skipped.
assert.ok(
  !postFamilies({ product: "Chrome Black", players: ["Paul Kasey"], collector_number: "12", serial_number: "12/25" }).includes(ANCHOR),
  "post-provider selection must not add the anchor when an exact printed code exists"
);
// The anchor is additive for correct-product cards: existing product lanes stay.
const correctProduct = postFamilies({ product: "Topps Chrome", players: ["Cooper Flagg"], year: "2025", serial_number: "31/50" });
assert.ok(correctProduct.includes(ANCHOR), "anchor should be additive alongside product lanes");
assert.ok(correctProduct.includes(retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR), "existing product serial lane must be preserved");

// Pre-provider (catalog_lookup) selection must also permit the anchor family so
// the planned lane is not filtered out before the provider observation.
assert.ok(
  catalogRetrievalFamiliesForFields(
    { product: "Chrome", players: ["Shohei Ohtani"], year: "2024" },
    { stagePhase: "catalog_lookup" }
  ).includes(ANCHOR),
  "pre-provider selection should permit the subject anchor family"
);

console.log("catalog subject anchor tests passed");
