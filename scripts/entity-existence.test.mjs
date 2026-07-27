import test from "node:test";
import assert from "node:assert/strict";

import {
  checkIdentity,
  createExistenceIndex,
  existenceVerdicts,
  normalizeProduct,
  productFromSet
} from "../lib/listing/catalog/entity-existence.mjs";

const document = {
  schemas: [
    { season_year: "2025", product: "Panini Phoenix", sets: ["Contours", "Thunderbirds", "Base"] },
    { season_year: "2024", product: "Panini Phoenix", sets: ["Rookies", "Color Blast"] },
    { season_year: "2023", product: "Panini Phoenix (23-24)", sets: ["Fade To Black", "Fire Fabrics"] },
    { season_year: "2025", product: "Panini Prizm", sets: ["Base"] }
  ],
  set_to_products: {
    "contours": ["2025|Panini Phoenix"],
    "thunderbirds": ["2025|Panini Phoenix"],
    "fade to black": ["2023|Panini Phoenix (23-24)"],
    "fire fabrics": ["2023|Panini Phoenix (23-24)"],
    "rookies": ["2024|Panini Phoenix"],
    "color blast": ["2024|Panini Phoenix"],
    "base": ["2025|Panini Phoenix", "2025|Panini Prizm"]
  }
};
const index = createExistenceIndex(document);

test("the season suffix a manufacturer appends does not fragment a product", () => {
  assert.equal(normalizeProduct("Panini Phoenix (23-24)"), "panini phoenix");
  assert.equal(index.productExists("Panini Phoenix (23-24)"), true);
  assert.equal(index.productExists("panini  phoenix"), true);
});

test("a product line nobody published is fabricated", () => {
  assert.equal(index.productExists("Panini Phoenix"), true);
  assert.equal(index.productExists("Prizm Mosaic"), false);
  assert.equal(index.productExists("Emerald Prism"), false);
});

// The exact title the pipeline produced on the unseen benchmark.
test("2021 Panini Contours is caught as fabricated", () => {
  const result = checkIdentity({ manufacturer: "Panini", product: "Contours", year: "2021" }, index);
  assert.equal(result.verdict, existenceVerdicts.FABRICATED);
  assert.ok(result.fabricated_fields.includes("product"));
});

test("a real product in a year it did not ship is caught on the pair", () => {
  const result = checkIdentity({ manufacturer: "Panini", product: "Panini Phoenix", year: "2019" }, index);
  assert.equal(result.fields.product, existenceVerdicts.CONFIRMED);
  assert.equal(result.fields.product_year, existenceVerdicts.FABRICATED);
  assert.equal(result.verdict, existenceVerdicts.FABRICATED);
});

test("a correctly read identity is confirmed", () => {
  const result = checkIdentity(
    { manufacturer: "Panini", product: "Panini Phoenix", year: "2025", set_or_insert: "Contours" },
    index
  );
  assert.equal(result.verdict, existenceVerdicts.CONFIRMED);
  assert.deepEqual(result.fabricated_fields, []);
});

// The mistake that has already cost two reverted changes: absence of coverage
// is not evidence of fabrication.
test("a manufacturer outside the index is unchecked, never fabricated", () => {
  const result = checkIdentity({ manufacturer: "Topps", product: "Topps Chrome", year: "2025" }, index);
  assert.equal(result.verdict, existenceVerdicts.UNCHECKED);
  assert.equal(result.reason, "manufacturer_not_in_index");
  assert.deepEqual(result.fields, {});
});

test("a set published by one product-year names that product outright", () => {
  assert.deepEqual(productFromSet("Fade To Black", index), { season_year: "2023", product: "Panini Phoenix (23-24)" });
  assert.deepEqual(productFromSet("Fire Fabrics", index), { season_year: "2023", product: "Panini Phoenix (23-24)" });
});

test("a set shared across products names none of them", () => {
  assert.equal(productFromSet("Base", index), null);
  assert.equal(productFromSet("Nonexistent Insert", index), null);
});

test("an empty index reports unchecked rather than guessing", () => {
  const result = checkIdentity({ manufacturer: "Panini", product: "Anything" }, null);
  assert.equal(result.verdict, existenceVerdicts.UNCHECKED);
  assert.equal(productFromSet("Contours", null), null);
});
