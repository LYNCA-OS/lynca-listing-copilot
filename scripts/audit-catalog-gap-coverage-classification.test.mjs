import assert from "node:assert/strict";
import {
  classifyCoveragePredicates,
  coverageDisposition,
  summarizeCoveragePredicates
} from "./audit-catalog-gap-coverage-classification.mjs";

const cells = [
  { count: 816, row: { product_year_present: true, set_matches_catalog_product: false, product_seen_any_year: true } },
  { count: 169, row: { product_year_present: true, set_matches_catalog_product: true, product_seen_any_year: true } },
  { count: 27, row: { product_year_present: false, set_matches_catalog_product: true, product_seen_any_year: true } },
  { count: 46, row: { product_year_present: false, set_matches_catalog_product: true, product_seen_any_year: false } },
  { count: 762, row: { product_year_present: false, set_matches_catalog_product: false, product_seen_any_year: false } },
  { count: 273, row: { product_year_present: false, set_matches_catalog_product: false, product_seen_any_year: true } }
];
const rows = cells.flatMap(({ count, row }) => Array.from({ length: count }, () => row));
const summary = summarizeCoveragePredicates(rows, { expectedTotal: 2093 });

assert.deepEqual(summary.overlapping_predicates, {
  product_year_present: 985,
  set_matches_catalog_product: 242,
  product_name_absent_from_catalog: 808
});
assert.deepEqual(summary.mutually_exclusive, {
  NO_BACKFILL_PRODUCT_YEAR_PRESENT: 985,
  SET_AS_PRODUCT_CANDIDATE: 73,
  PRODUCT_NAME_ABSENT_FROM_CATALOG: 762,
  UNCLASSIFIED: 273
});
assert.equal(Object.keys(summary.mutually_exclusive).includes("GENUINE_MISSING"), false);
assert.equal(summary.catalog_write_allowed, false);

const absent = classifyCoveragePredicates({
  product_year_present: false,
  set_matches_catalog_product: false,
  product_seen_any_year: false
});
assert.equal(absent.disposition, coverageDisposition.PRODUCT_NAME_ABSENT_FROM_CATALOG);
assert.equal(absent.catalog_write_allowed, false);
assert.equal(absent.required_next_action, "REVIEWED_INTERNAL_CONFIRMATION");
assert.equal(
  classifyCoveragePredicates({ product_absent: true }).disposition,
  coverageDisposition.PRODUCT_NAME_ABSENT_FROM_CATALOG
);

assert.throws(
  () => summarizeCoveragePredicates([{ product_year_present: true, product_seen_any_year: false }]),
  /cannot both be true/
);
assert.throws(() => summarizeCoveragePredicates([], { expectedTotal: 2093 }), /expected 2093 rows/);

console.log("catalog gap coverage classification tests passed");
