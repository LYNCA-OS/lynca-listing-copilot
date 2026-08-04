import assert from "node:assert/strict";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const card = (overrides = {}) => ({
  year: "",
  ip: "",
  language: "",
  manufacturer: "",
  product: "",
  set: "",
  subjects: [],
  team: "",
  card_name: "",
  release_variant: "",
  surface_color: "",
  parallel_family: "",
  parallel_exact: "",
  print_finish: "",
  descriptive_rarity: "",
  card_number: "",
  serial: "",
  components: [],
  grade: "",
  grammar: "standard",
  lot_count: "",
  unreadable: [],
  low_confidence: [],
  ...overrides
});

// A long leaf may yield to a shorter parent only when the alternative was
// deleting Product as a whole. The complete canonical value remains upstream.
{
  const result = composeFromCanonicalFields(card({
    year: "2022",
    product: "Game of Thrones The Complete Series Volume 2",
    subjects: ["Kit Harington"],
    card_name: "Autographed Costume",
    serial: "12/50",
    components: ["Auto", "Relic"],
    grade: "BGS 9.5"
  }));
  assert.ok(result.length <= 80);
  assert.match(result.title, /Game of Thrones/);
  assert.ok(!result.title.includes("Complete Series Volume 2"));
  assert.ok(!result.dropped.includes("product"));
  assert.ok(result.normalization_reasons.includes("product:hierarchy_suffix_removed"));
  const withoutHierarchy = composeFromCanonicalFields(card({
    year: "2022",
    product: "Game of Thrones The Complete Series Volume 2",
    subjects: ["Kit Harington"],
    card_name: "Autographed Costume",
    serial: "12/50",
    components: ["Auto", "Relic"],
    grade: "BGS 9.5"
  }), { features: { product_hierarchy: false } });
  assert.ok(!withoutHierarchy.title.includes("Game of Thrones"));
}

// If Product merely repeats the separately rendered manufacturer plus one
// leaf, preserve that leaf instead of deleting the whole Product bracket.
// This is bounded to the exact two-part shape; it is not a generic product
// abbreviation rule.
{
  const result = composeFromCanonicalFields(card({
    year: "2001",
    manufacturer: "Donruss",
    product: "Donruss Elite",
    subjects: ["Barry Bonds", "Willie Mays"],
    card_name: "Passing the Torch",
    serial: "22/50",
    grade: "PSA Authentic, Auto 9",
    components: ["Auto"]
  }));
  assert.match(result.title, /\bElite\b/);
  assert.ok(!result.dropped.includes("product"));
  assert.ok(result.normalization_reasons.includes("product:manufacturer_prefix_removed"));
  assert.ok(result.length <= 80);
}

// Category words are prose by default, but not when the typed identity would
// be changed (`Wild Card`) or a named-product construction binds the word.
{
  const manufacturer = composeFromCanonicalFields(card({
    year: "2023", manufacturer: "Wild Card", product: "Wild Chrome",
    subjects: ["Chris Rodriguez Jr."], components: ["Auto"]
  }));
  assert.match(manufacturer.title, /Wild Card Chrome/);
  assert.ok(manufacturer.normalization_reasons.includes("manufacturer:identity_category_preserved"));

  const mirroredProduct = composeFromCanonicalFields(card({
    manufacturer: "Panini", product: "One and One Basketball", subjects: ["LeBron James"]
  }));
  assert.match(mirroredProduct.title, /One and One Basketball/);
  assert.ok(mirroredProduct.normalization_reasons.includes("product:identity_category_preserved"));

  const leadingProduct = composeFromCanonicalFields(card({
    manufacturer: "Topps", product: "Baseball Stars Autograph Card", subjects: ["Brice Matthews"]
  }));
  assert.match(leadingProduct.title, /Baseball Stars Auto/);
  assert.ok(!/Auto Card/.test(leadingProduct.title));
}

// Only an exact component already carried by another typed bracket disappears.
// Patch, Jersey and Relic remain separately expressible.
{
  const result = composeFromCanonicalFields(card({
    manufacturer: "Topps",
    subjects: ["Nolan Ryan"],
    card_name: "Autographed Patch",
    components: ["Auto", "Patch", "Relic"]
  }));
  assert.equal(result.title, "Topps Nolan Ryan Auto Patch Relic");
  assert.ok(result.normalization_reasons.includes("card_name:autograph_to_auto"));
  assert.ok(result.normalization_reasons.includes("observable_components:auto_duplicate"));
  assert.ok(result.normalization_reasons.includes("observable_components:patch_duplicate"));
  assert.ok(!result.normalization_reasons.some((reason) => reason.includes("relic_subsumed")));
}

// The feature switches are evaluation-only ablation controls. Defaults stay
// identical to the current serialization, while each recovery can be disabled
// without mutating the canonical object.
{
  const fields = card({
    manufacturer: "Wild Card",
    product: "One and One Basketball",
    subjects: ["LeBron James"],
    card_name: "Autographed Patch",
    components: ["Auto", "Patch"],
    serial: "05 / 20"
  });
  const defaultOutput = composeFromCanonicalFields(fields);
  const allExplicit = composeFromCanonicalFields(fields, { features: {
    component_dedupe: true,
    product_hierarchy: true,
    typed_identity: true,
    slash_spacing: true
  } });
  assert.equal(allExplicit.title, defaultOutput.title);
  assert.match(composeFromCanonicalFields(fields, { features: { slash_spacing: false } }).title, /05 \/ 20/);
  assert.match(composeFromCanonicalFields(fields, { features: { typed_identity: false } }).title, /One and One/);
}

// Typed number formatting may remove separator whitespace, never digit
// spelling. This pins the TCG leading-zero case that a numeric coercion breaks.
{
  const result = composeFromCanonicalFields(card({
    year: "2025",
    ip: "Pokemon",
    subjects: ["Charizard ex"],
    card_number: "086 / 070",
    serial: "027 / 150",
    grammar: "tcg"
  }));
  assert.match(result.title, /#086\/070/);
  assert.match(result.title, /027\/150/);
  assert.ok(result.normalization_reasons.includes("card_number:separator_spacing_normalized"));
  assert.ok(result.normalization_reasons.includes("numerical_rarity:separator_spacing_normalized"));
}

// One of the two policy boundaries this guard protected has now been decided
// rather than silently changed. COS-41 (founder, 2026-08-04) places Auto, RC,
// Patch and Relic in [Search Optimization] and says a profile that drops them
// too early has a Composer priority problem, not a missing CSM bracket. The lot
// grammar's own order carries search_optimization, so RC belongs in a lot title
// -- and a reviewed lot title in the evaluation set does carry it.
//
// The grade boundary is untouched and still asserted: semLotTitleOrder has no
// grading_info, so PSA 10 stays out.
{
  const lot = composeFromCanonicalFields(card({
    year: "2025", manufacturer: "Topps", product: "Chrome",
    subjects: ["A", "B"], components: ["RC"], grade: "PSA 10",
    grammar: "lot", lot_count: "2"
  }));
  assert.match(lot.title, /\bRC\b/, "COS-41: a retained search term survives profile suppression");
  assert.ok(!/PSA 10/.test(lot.title), "the lot grammar still has no grading bracket");

  const standard = composeFromCanonicalFields(card({
    year: "2025", manufacturer: "Topps", subjects: ["Nolan Ryan"],
    team: "Mets", card_number: "221"
  }));
  assert.equal(standard.title, "2025 Topps Nolan Ryan");
  assert.deepEqual(standard.suppressed.sort(), ["card_number", "search_optimization"]);
}

process.stdout.write("canonical composer recovery: ok\n");
