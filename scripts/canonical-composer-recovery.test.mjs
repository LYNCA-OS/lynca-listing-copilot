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

// This pass does not silently change the two unresolved policy boundaries.
// Lot still has no components/grade bracket, and eBay still suppresses Standard
// team/card number until a separately paired exception policy wins.
{
  const lot = composeFromCanonicalFields(card({
    year: "2025", manufacturer: "Topps", product: "Chrome",
    subjects: ["A", "B"], components: ["RC"], grade: "PSA 10",
    grammar: "lot", lot_count: "2"
  }));
  assert.ok(!/\bRC\b|PSA 10/.test(lot.title));

  const standard = composeFromCanonicalFields(card({
    year: "2025", manufacturer: "Topps", subjects: ["Nolan Ryan"],
    team: "Mets", card_number: "221"
  }));
  assert.equal(standard.title, "2025 Topps Nolan Ryan");
  assert.deepEqual(standard.suppressed.sort(), ["card_number", "search_optimization"]);
}

process.stdout.write("canonical composer recovery: ok\n");
