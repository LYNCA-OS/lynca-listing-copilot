// Canonical ownership for every field accepted from the vision provider.
//
// READ: the current image/slab can establish the value.
// DERIVED: downstream knowledge/retrieval may propose it; the provider must not
//          emit it in the read-only transport.
// DROP: compatibility aliases or duplicated aggregates reconstructed by
//       normalization/resolution, never requested from the provider.
//
// This contract classifies transport ownership only. It does not change CSM
// field ownership: Identity Resolver remains the only canonical field owner.

export const providerOutputFieldClass = Object.freeze({
  READ: "READ",
  DERIVED: "DERIVED",
  DROP: "DROP"
});

const fields = Object.freeze({
  multi_card: { classification: "READ", value_type: "boolean", reason: "visible count of separate physical cards" },
  card_count: { classification: "READ", value_type: "number", reason: "visible count of separate physical cards" },
  lot_type: { classification: "READ", value_type: "string", reason: "visible lot grouping only" },
  year: { classification: "READ", value_type: "string", reason: "printed card or slab year/season" },
  manufacturer: { classification: "READ", value_type: "string", reason: "printed publisher/manufacturer identity" },
  brand: { classification: "DERIVED", value_type: "string", reason: "manufacturer compatibility alias reconstructed downstream" },
  product: { classification: "DERIVED", value_type: "string", reason: "product-line identity may be emblematic or externally constrained" },
  set: { classification: "READ", value_type: "string", reason: "literal printed set or insert text" },
  subset: { classification: "READ", value_type: "string", reason: "literal printed subset text" },
  language: { classification: "READ", value_type: "string", reason: "language visible on the current card" },
  players: { classification: "READ", value_type: "list", reason: "current-card subject names" },
  card_name: { classification: "READ", value_type: "string", reason: "literal named card segment" },
  team: { classification: "DERIVED", value_type: "string", reason: "world fact, not a required printed card fact" },
  card_type: { classification: "DERIVED", value_type: "string", reason: "aggregate reconstructed from literal components" },
  official_card_type: { classification: "READ", value_type: "string", reason: "only literal official wording is accepted" },
  observable_components: { classification: "READ", value_type: "list", reason: "visible auto patch relic and related components" },
  insert: { classification: "READ", value_type: "string", reason: "literal named insert text" },
  surface_color: { classification: "READ", value_type: "string", reason: "basic visible colour" },
  parallel_family: { classification: "DERIVED", value_type: "string", reason: "normalized finish family" },
  parallel_exact: { classification: "DERIVED", value_type: "string", reason: "proper parallel identity requires vocabulary or trusted support" },
  parallel: { classification: "DERIVED", value_type: "string", reason: "legacy alias reconstructed from canonical finish fields" },
  variation: { classification: "READ", value_type: "string", reason: "literal slab or card variation wording/layout" },
  print_run_number: { classification: "READ", value_type: "string", reason: "literal current-card limited numbering" },
  print_run_numerator: { classification: "READ", value_type: "string", reason: "literal current-card numerator" },
  print_run_denominator: { classification: "READ", value_type: "string", reason: "literal current-card denominator" },
  numbered_to: { classification: "DERIVED", value_type: "string", reason: "compatibility alias reconstructed from print_run_denominator" },
  serial_number: { classification: "DERIVED", value_type: "string", reason: "legacy alias reconstructed from print_run_number" },
  numerical_rarity: { classification: "DERIVED", value_type: "string", reason: "CSM projection reconstructed from canonical print-run fields" },
  card_number: { classification: "READ", value_type: "string", reason: "literal current-card identity code" },
  tcg_card_number: { classification: "READ", value_type: "string", reason: "literal current-card TCG identity code" },
  collector_number: { classification: "READ", value_type: "string", reason: "literal current-card collector number" },
  checklist_code: { classification: "READ", value_type: "string", reason: "literal current-card checklist code" },
  attributes: { classification: "DROP", value_type: "list", reason: "aggregate reconstructed from observed boolean components" },
  grade_company: { classification: "READ", value_type: "string", reason: "literal current-slab label" },
  card_grade: { classification: "READ", value_type: "string", reason: "literal current-slab grade" },
  auto_grade: { classification: "READ", value_type: "string", reason: "literal separate autograph grade" },
  grade_type: { classification: "READ", value_type: "string", reason: "current-slab grade layout" },
  cert_number: { classification: "READ", value_type: "string", reason: "literal current-slab certification number" },
  rc: { classification: "READ", value_type: "boolean", reason: "visible rookie marker only" },
  first_bowman: { classification: "READ", value_type: "boolean", reason: "visible 1st Bowman marker only" },
  ssp: { classification: "READ", value_type: "boolean", reason: "visible SSP wording only" },
  case_hit: { classification: "READ", value_type: "boolean", reason: "visible case-hit wording only" },
  auto: { classification: "READ", value_type: "boolean", reason: "visible ink sticker or autograph wording" },
  patch: { classification: "READ", value_type: "boolean", reason: "visible patch material or wording" },
  relic: { classification: "READ", value_type: "boolean", reason: "visible relic material or wording" },
  jersey: { classification: "READ", value_type: "boolean", reason: "visible jersey material or wording" },
  sketch: { classification: "READ", value_type: "boolean", reason: "visible sketch evidence" },
  redemption: { classification: "READ", value_type: "boolean", reason: "visible redemption evidence" },
  one_of_one: { classification: "READ", value_type: "boolean", reason: "literal 1/1 evidence" }
});

export const providerOutputFieldContract = fields;
export const providerOutputFieldNames = Object.freeze(Object.keys(fields));

export function providerFieldsByClass(classification) {
  return Object.entries(fields)
    .filter(([, spec]) => spec.classification === classification)
    .map(([field]) => field);
}

export function providerReadFieldNamesByType(valueType) {
  return Object.entries(fields)
    .filter(([, spec]) => spec.classification === providerOutputFieldClass.READ && spec.value_type === valueType)
    .map(([field]) => field);
}

export function assertProviderOutputFieldContract(expectedFields = []) {
  const expected = [...new Set(expectedFields)].sort();
  const classified = Object.keys(fields).sort();
  const missing = expected.filter((field) => !classified.includes(field));
  const extra = classified.filter((field) => !expected.includes(field));
  if (missing.length || extra.length) {
    throw new Error(`provider output field contract drift: missing=${missing.join(",")} extra=${extra.join(",")}`);
  }
  for (const [field, spec] of Object.entries(fields)) {
    if (!Object.values(providerOutputFieldClass).includes(spec.classification)) {
      throw new Error(`provider output field ${field} has invalid classification`);
    }
  }
  return true;
}
