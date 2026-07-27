// Check a claimed identity against what manufacturers have actually published.
//
// The pipeline currently emits a title whatever it believes. On the
// unseen-product benchmark that produced
// "2021 Panini Contours JALYN DANIELS Silver RC" for a card that is
// "2025 Panini Phoenix Contours Jaxson Dart #24" -- an invented year, an
// invented product line, and an invented player, stated without hesitation.
//
// Measured over those seventeen cards, the product line the model named:
//
//   read correctly                                     4
//   a different but real product line                  4
//   a product line that does not exist anywhere        9
//
// The largest class is not a wrong guess, it is a fabrication. That reframes
// two failed attempts from the same day: grounding the parallel family on a
// vision read (-5.4 points) and consulting the catalog before observation
// (-11.75 points) both assumed what the model read was real and merely
// distrusted. On unseen products it is not real about half the time.
//
// Existence is cheap to check and needs no model, no retrieval and no database:
// the harvest already enumerates every product line and set name a manufacturer
// published, so anything outside those sets is fabricated by construction. One
// hash lookup.
//
// This deliberately does not decide what to do about a fabricated field. It
// reports. Suppressing a field lowers token recall by definition, and whether
// that trade is worth making is a measurement, not an assumption -- especially
// for a product whose ambition is to define the naming standard, where naming a
// card that does not exist is the worst failure available.

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Manufacturers append a season to product names; a lister does not write it.
export const normalizeProduct = (value) => cleanText(value)
  .toLowerCase()
  .replace(/\(\s*\d{2}\s*-\s*\d{2}\s*\)/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const normalizeSet = (value) => cleanText(value).toLowerCase();

export function createExistenceIndex(schemaDocument = {}) {
  const products = new Set();
  const productYears = new Set();
  for (const schema of schemaDocument.schemas || []) {
    const product = normalizeProduct(schema.product);
    if (!product) continue;
    products.add(product);
    productYears.add(`${cleanText(schema.season_year)}|${product}`);
  }
  const sets = schemaDocument.set_to_products || {};
  return {
    productCount: products.size,
    setCount: Object.keys(sets).length,

    productExists: (value) => products.has(normalizeProduct(value)),

    productYearExists: (year, value) => productYears.has(`${cleanText(year)}|${normalizeProduct(value)}`),

    setExists: (value) => Boolean(sets[normalizeSet(value)]),

    // Which product-years contain this set name. A set found in exactly one is
    // an identity statement stronger than anything the model can infer.
    productsForSet: (value) => (sets[normalizeSet(value)] || []).map((key) => {
      const [season_year, product] = key.split("|");
      return { season_year, product };
    })
  };
}

export const existenceVerdicts = Object.freeze({
  CONFIRMED: "CONFIRMED",
  FABRICATED: "FABRICATED",
  UNCHECKED: "UNCHECKED"
});

// A field is FABRICATED only when the index is authoritative for its kind and
// the value is absent. A manufacturer we have not harvested must come back
// UNCHECKED -- claiming fabrication for a gap in our own coverage would be the
// same mistake as treating absent evidence as evidence against, which has now
// cost this project two reverted changes.
export function checkIdentity(identity = {}, index = null, { coveredManufacturers = ["panini"] } = {}) {
  if (!index) return { verdict: existenceVerdicts.UNCHECKED, fields: {} };
  const manufacturer = cleanText(identity.manufacturer || identity.product).toLowerCase();
  const covered = coveredManufacturers.some((name) => manufacturer.includes(name));
  if (!covered) {
    return { verdict: existenceVerdicts.UNCHECKED, reason: "manufacturer_not_in_index", fields: {} };
  }

  const fields = {};
  if (cleanText(identity.product)) {
    fields.product = index.productExists(identity.product)
      ? existenceVerdicts.CONFIRMED
      : existenceVerdicts.FABRICATED;
  }
  if (cleanText(identity.product) && cleanText(identity.year)) {
    fields.product_year = index.productYearExists(identity.year, identity.product)
      ? existenceVerdicts.CONFIRMED
      : existenceVerdicts.FABRICATED;
  }
  const setValue = identity.set_or_insert || identity.set || identity.card_name;
  if (cleanText(setValue)) {
    fields.set_or_insert = index.setExists(setValue)
      ? existenceVerdicts.CONFIRMED
      : existenceVerdicts.FABRICATED;
  }

  const fabricated = Object.entries(fields).filter(([, v]) => v === existenceVerdicts.FABRICATED).map(([k]) => k);
  return {
    verdict: fabricated.length ? existenceVerdicts.FABRICATED : existenceVerdicts.CONFIRMED,
    fabricated_fields: fabricated,
    fields
  };
}

// When the set name is published by exactly one product-year, that is the
// product -- regardless of what the model inferred. Roughly 60% of the 30,006
// harvested set names are unique in this sense.
export function productFromSet(setValue, index = null) {
  if (!index) return null;
  const matches = index.productsForSet(setValue);
  return matches.length === 1 ? matches[0] : null;
}
