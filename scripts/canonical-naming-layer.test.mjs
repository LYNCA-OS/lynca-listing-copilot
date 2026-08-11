import assert from "node:assert/strict";

import {
  LYNCA_STANDARD_NAMING_PROFILE_V01,
  composeCanonicalName,
  renderCanonicalNameTokens,
  selectCanonicalNameTokens
} from "../lib/listing/thin/canonical-naming-layer.mjs";

const powerChords = {
  year: "2026",
  product: "Bowman Chrome",
  subjects: ["Nick Kurtz"],
  card_name: "Power Chords",
  print_finish: "Aqua Refractor",
  search_optimization: [],
  card_number: "#PC-6",
  serial: "010/125"
};

const selectPairings = {
  year: "2025-26",
  product: "Select EuroLeague",
  subjects: ["Tamir Blatt", "Elijah Bryant"],
  card_name: "Select Pairings",
  print_finish: "",
  search_optimization: ["Dual Auto"],
  card_number: "SP-DGN",
  serial: "38/49"
};

const bowmanSpotlights = {
  year: "2026",
  product: "Bowman Chrome",
  subjects: ["Jac Caglianone"],
  card_name: "Bowman Spotlights",
  print_finish: "Red Refractor",
  components: ["RC"],
  card_number: "BS-4",
  serial: "5/5"
};

{
  const frozen = JSON.stringify(powerChords);
  const result = composeCanonicalName(powerChords);
  assert.equal(result.title,
    "2026 Bowman Chrome Nick Kurtz Power Chords Aqua Refractor #PC-6 010/125");
  assert.equal(result.length, 71);
  assert.equal(result.overBudget, false);
  assert.equal(result.canonical.card_number, "PC-6", "canonical Card Number has no display hash");
  assert.equal(result.trace.selected.find((row) => row.field === "card_number").display_value, "#PC-6");
  assert.equal(result.trace.selected.find((row) => row.field === "card_number").priority, "P0");
  assert.equal(result.trace.selected.find((row) => row.field === "serial").canonical_value, "010/125");
  assert.equal(result.trace.selected.find((row) => row.field === "serial").priority, "P0");
  assert.equal(JSON.stringify(powerChords), frozen, "the pure Composer must not mutate semantic input");
}

{
  const lossless = composeCanonicalName(selectPairings, { limit: 120 });
  assert.equal(lossless.title,
    "2025-26 Select EuroLeague Tamir Blatt Elijah Bryant Select Pairings Dual Auto #SP-DGN 38/49");
  assert.equal(lossless.length, 91);

  const constrained = composeCanonicalName(selectPairings);
  assert.equal(constrained.title,
    "2025 Select EuroLeague Tamir Blatt Elijah Bryant Select Pairings #SP-DGN 38/49");
  assert.equal(constrained.length, 78);
  assert.deepEqual(constrained.canonical.subjects, ["Tamir Blatt", "Elijah Bryant"]);
  assert.deepEqual(constrained.trace.omitted.map((row) => row.canonical_value), ["Dual Auto"]);
  assert.deepEqual(
    constrained.trace.transformed.filter((row) => row.field === "year")
      .map(({ operation, rule, before, after }) => ({ operation, rule, before, after })),
    [{
      operation: "profile_year_alias",
      rule: "season_start_year",
      before: "2025-26",
      after: "2025"
    }]
  );
  assert.deepEqual(constrained.trace.abbreviated, []);
}

{
  const result = composeCanonicalName(bowmanSpotlights);
  assert.equal(result.title,
    "2026 Bowman Chrome Jac Caglianone Bowman Spotlights Red Refractor RC #BS-4 5/5");
  assert.equal(result.length, 78);
  assert.equal(result.overBudget, false);
  assert.equal(result.trace.selected.find((row) => row.canonical_value === "RC").source_field,
    "components");
}

// Selection importance is explicitly independent from render position.
assert.ok(
  LYNCA_STANDARD_NAMING_PROFILE_V01.renderOrder.indexOf("card_number")
    > LYNCA_STANDARD_NAMING_PROFILE_V01.renderOrder.indexOf("search_optimization")
);
assert.ok(
  LYNCA_STANDARD_NAMING_PROFILE_V01.selectionPriority.card_number.rank
    < LYNCA_STANDARD_NAMING_PROFILE_V01.selectionPriority.search_optimization.rank
);
{
  const selection = selectCanonicalNameTokens({
    year: "2026",
    product: "Bowman Chrome",
    subjects: ["Nick Kurtz"],
    search_optimization: ["A very long derived marketplace phrase"],
    card_number: "PC-6",
    serial: "010/125"
  }, { limit: 52 });
  assert.ok(selection.trace.omitted.some((row) => row.field === "search_optimization"));
  assert.ok(selection.trace.selected.some((row) => row.field === "card_number"));
  assert.ok(selection.trace.selected.some((row) => row.field === "serial"));

  const independentlyRendered = renderCanonicalNameTokens([...selection.tokens].reverse());
  assert.match(independentlyRendered, /#PC-6 010\/125$/,
    "rendering follows profile order, not selector/input order");
}

// Subject compaction is disabled without an evidence-bearing alias profile.
{
  const input = {
    product: "Upper Deck Exquisite Collection",
    subjects: ["Alexandria Verylongsurname"],
    card_name: "Rookie Autograph",
    card_number: "R-ALEX",
    serial: "01/25"
  };
  const result = composeCanonicalName(input, { limit: 120 });
  assert.match(result.title, /Alexandria Verylongsurname/);
  assert.deepEqual(result.trace.abbreviated, []);
  const nonWestern = composeCanonicalName({
    subjects: ["Yao Ming"],
    card_name: "Patch",
    card_number: "X",
    serial: "1/1"
  }, { limit: 20 });
  assert.equal(nonWestern.title, "Yao Ming #X 1/1");
  assert.doesNotMatch(nonWestern.diagnosticTitle, /^Ming\b/);
}

// Profile-owned commercial aliases are deterministic display transforms and
// never mutate canonical state.
{
  const result = composeCanonicalName({
    card_name: "Gold Refractor Autograph",
    release_variant: "Variation",
    print_finish: "Gold",
    subjects: ["Player Name"],
    card_number: "1"
  });
  assert.equal(result.title, "Player Name Gold Refractor Auto Variation #1");
  assert.equal(result.canonical.card_name, "Gold Refractor Autograph");
  assert.deepEqual(
    result.trace.transformed.filter((row) => row.operation === "profile_display_alias")
      .map(({ rule, before, after, reason }) => ({ rule, before, after, reason })),
    [{
      rule: "autograph_to_auto",
      before: "Gold Refractor Autograph",
      after: "Gold Refractor Auto",
      reason: "profile_owned_semantic_alias"
    }]
  );
}

// An unambiguous configuration-only Set remainder is omitted only while the
// Product proving the repeated hierarchy remains visible.
{
  const result = composeCanonicalName({
    manufacturer: "Panini",
    product: "Panini Prizm Black",
    set: "Panini Prizm Black FOTL",
    subjects: ["Player Name"],
    card_number: "1"
  });
  assert.equal(result.title, "Panini Prizm Black Player Name #1");
  const configuration = result.trace.omitted.find((row) => (
    row.reason === "profile_distribution_configuration_omitted"
  ));
  assert.equal(configuration.canonical_value, "Panini Prizm Black FOTL");
  assert.equal(configuration.configuration_value, "FOTL");
  assert.ok(result.trace.selected.some((row) => row.key === configuration.redundant_with));
}

// Product/Set overlap may remove only a source-identical Set prefix, and only
// while the Product that proves that prefix remains selected.
{
  const result = composeCanonicalName({
    year: "2025-26",
    product: "Bowman Chrome Basketball",
    set: "Chrome Prospect Autograph",
    subjects: ["Caleb Wilson"],
    card_number: "CPA-CL",
    serial: "1/1"
  });
  assert.equal(result.title,
    "2025-26 Bowman Chrome Basketball Prospect Auto Caleb Wilson #CPA-CL 1/1");
  const overlap = result.trace.transformed.find((row) => (
    row.operation === "source_derived_overlap_trim"
  ));
  assert.deepEqual({
    before: overlap.before,
    after: overlap.after,
    removed_prefix: overlap.removed_prefix
  }, {
    before: "Chrome Prospect Autograph",
    after: "Prospect Autograph",
    removed_prefix: "Chrome"
  });
  assert.ok(result.trace.selected.some((row) => row.key === overlap.redundant_with));

  const alreadyShort = composeCanonicalName({
    year: "2025",
    product: "Bowman Chrome",
    set: "Chrome Prospect Autograph",
    subjects: ["Caleb Wilson"],
    card_number: "CPA-CL"
  });
  assert.equal(alreadyShort.title,
    "2025 Bowman Chrome Prospect Auto Caleb Wilson #CPA-CL");
  assert.equal((alreadyShort.title.match(/\bChrome\b/g) || []).length, 1);
  assert.equal(
    alreadyShort.trace.transformed.find((row) => (
      row.operation === "source_derived_overlap_trim"
    ))?.reason,
    "source_derived_smart_composition"
  );

  const noOwner = composeCanonicalName({
    product: `Bowman Chrome ${"X".repeat(40)}`,
    set: "Chrome Prospect Autograph",
    subjects: ["Caleb Wilson"],
    card_number: "CPA-CL",
    serial: "1/1"
  }, { limit: 48 });
  assert.match(noOwner.title, /^Chrome Prospect Auto Caleb Wilson\b/);
  assert.ok(!noOwner.trace.transformed.some((row) => (
    row.operation === "source_derived_overlap_trim"
  )), "a trimmed Set cannot survive without its Product proof");
}

// An impossible budget is explicit; P0 values are never truncated or dropped.
{
  const result = composeCanonicalName({
    year: "2026",
    product: "Product",
    subjects: ["Subject Name"],
    card_number: "EXTREMELY-LONG-CARD-NUMBER",
    serial: "000001/999999"
  }, { limit: 20 });
  assert.equal(result.overBudget, true);
  assert.equal(result.publishable, false);
  assert.equal(result.title, "", "an infeasible title must not cross the publication boundary");
  assert.match(result.diagnosticTitle, /^#EXTREMELY-LONG-CARD-NUMBER 000001\/999999$/);
  assert.ok(result.trace.selected.every((row) => row.priority === "P0"));
  assert.ok(result.trace.rejected.some((row) => row.reason === "p0_identity_exceeds_budget"));
}

// Standard tokenization keeps supported facts in their own trace brackets.
{
  const result = composeCanonicalName({
    year: "2023",
    manufacturer: "Upper Deck",
    product: "SP Authentic",
    set: "Future Watch",
    subjects: ["Connor Bedard"],
    card_name: "Rookie Autograph",
    release_variant: "Gold",
    print_finish: "Acetate",
    descriptive_rarity: "SSP",
    components: ["RC", "Auto"],
    search_optimization: ["Young Guns Search Alias"],
    team: "Blackhawks",
    card_number: "FW-CB",
    serial: "01/10",
    grading_info: {
      company: "PSA",
      card_grade: "10",
      auto_grade: "10",
      grade_type: "CARD_AND_AUTO"
    }
  }, { limit: 200 });
  assert.equal(result.title,
    "2023 Upper Deck SP Authentic Future Watch Connor Bedard Rookie Auto Gold Acetate SSP RC Young Guns Search Alias Blackhawks #FW-CB 01/10 PSA 10/10");
  assert.deepEqual(result.trace.selected.map((row) => row.field), [
    "year", "manufacturer", "product", "set", "subjects", "card_name",
    "release_variant", "print_finish", "descriptive_rarity", "components",
    "search_optimization", "team", "card_number", "serial", "grading_info"
  ]);
  assert.equal(result.trace.selected.at(-1).source_field, "grading_info");
  assert.ok(result.trace.transformed.some((row) => row.operation === "structured_grade_display"));
}

// Generational suffixes stay attached to the complete mandatory identity; the
// profile never emits a guessed surname fragment or trades the person for a
// longer product phrase.
{
  const input = {
    product: "Panini Impeccable Elegance",
    subjects: ["Patrick Mahomes II"],
    card_number: "107",
    serial: "60/75"
  };
  const full = composeCanonicalName(input, { limit: 120 });
  assert.match(full.title, /\bPatrick Mahomes II\b/);
  const result = composeCanonicalName(input, { limit: 52 });
  assert.equal(result.title, "Patrick Mahomes II #107 60/75");
  assert.doesNotMatch(result.title, /Elegance II\b/);
  assert.deepEqual(result.trace.abbreviated, []);
}

// Exact optimization can keep two P1 facts instead of one longer P1 fact.
{
  const result = composeCanonicalName({
    product: "TwentyCharacterValue",
    subjects: ["Alpha"],
    card_name: "Beta",
    card_number: "X",
    serial: "1/1"
  }, { limit: 18 });
  assert.equal(result.title, "Alpha Beta #X 1/1");
  assert.ok(result.trace.omitted.some((row) => row.field === "product"));
}

// A recognized card subject is mandatory identity, not a same-tier character
// bonus that a longer Product/Set/Card Name may silently displace.
{
  const result = composeCanonicalName({
    product: "Impeccable Collection",
    set: "Elegance Helmet Patch",
    subjects: ["Al Lee"],
    card_name: "Super Bowl Signature",
    card_number: "107",
    serial: "60/75"
  });
  assert.ok(result.trace.selected.some((row) => (
    row.field === "subjects" && row.canonical_value === "Al Lee"
  )));
  assert.match(result.title, /\bAl Lee\b/);
  assert.ok(result.length <= 80);
  assert.equal(result.publishable, true);
}

// Every recognized subject is mandatory identity on multi-subject cards. The
// optimizer may remove descriptive phrases, never one side of a dual identity.
{
  const result = composeCanonicalName({
    product: "Product Identity AAA",
    set: "Insert Identity BBB",
    subjects: ["Al Lee", "Bo Ray"],
    card_name: "Card Identity CCCC",
    card_number: "107",
    serial: "60/75"
  });
  assert.equal(result.publishable, true);
  assert.match(result.title, /\bAl Lee Bo Ray\b/);
  assert.deepEqual(
    result.trace.selected
      .filter((row) => row.field === "subjects")
      .map((row) => row.canonical_value),
    ["Al Lee", "Bo Ray"]
  );
  assert.ok(result.length <= 80);
}

// Exact duplicate subject entries are one semantic identity. The projection
// removes only the byte-identical duplicate and records its visible owner.
{
  const result = composeCanonicalName({
    subjects: ["Michael Jordan", "Michael Jordan"],
    card_number: "57"
  });
  assert.equal(result.title, "Michael Jordan #57");
  const duplicate = result.trace.omitted.find((row) => (
    row.field === "subjects" && row.source_index === 1
  ));
  assert.equal(duplicate.reason, "source_derived_redundancy");
  assert.ok(result.trace.selected.some((row) => row.key === duplicate.redundant_with));
}

// The same exact dedupe contract applies to a fail-closed diagnostic; review
// traces must not claim duplicate identities were selected optimally.
{
  const subject = `Player ${"X".repeat(70)}`;
  const result = composeCanonicalName({
    subjects: [subject, subject],
    card_number: "107",
    serial: "60/75"
  });
  assert.equal(result.publishable, false);
  assert.equal(result.diagnosticTitle, `${subject} #107 60/75`);
  assert.equal(result.trace.selected.filter((row) => row.field === "subjects").length, 1);
  assert.ok(result.trace.omitted.some((row) => (
    row.field === "subjects" && row.reason === "source_derived_redundancy"
  )));
}

// If one complete Subject plus the P0 anchors cannot fit, the layer routes to
// review instead of publishing a syntactically valid but person-less title.
{
  const result = composeCanonicalName({
    subjects: [`Subject ${"X".repeat(70)}`],
    card_number: "107",
    serial: "60/75"
  });
  assert.equal(result.publishable, false);
  assert.equal(result.title, "");
  assert.equal(result.failureReason, "mandatory_subject_identity_exceeds_budget");
  assert.ok(result.trace.rejected.some((row) => (
    row.reason === "mandatory_subject_identity_exceeds_budget"
  )));
}

// Standard single-card identity cannot be admitted without a Subject. A model
// omission or unreadable person must not become a plausible product-only title.
{
  for (const unreadable of [[], ["subjects"]]) {
    const result = composeCanonicalName({
      product: "Bowman Chrome",
      subjects: [],
      card_number: "251",
      serial: "50/50",
      unreadable
    });
    assert.equal(result.publishable, false);
    assert.equal(result.title, "");
    assert.equal(result.failureReason, "mandatory_subject_identity_missing");
    assert.ok(result.trace.rejected.some((row) => (
      row.field === "subjects"
        && row.reason === "mandatory_subject_identity_missing"
    )));
  }
}

// Exact source phrases render once; no domain implication is invented.
{
  const result = composeCanonicalName({
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome Prizm",
    set: "Autograph Variation",
    subjects: ["Player Name"],
    release_variant: "Variation",
    print_finish: "Prizm",
    components: ["Auto", "RC"],
    card_number: "1",
    serial: "1/1"
  }, { limit: 120 });
  assert.equal(result.title,
    "2025 Topps Chrome Prizm Auto Variation Player Name RC #1 1/1");
  assert.deepEqual(
    result.trace.omitted.filter((row) => row.reason === "source_derived_redundancy")
      .map((row) => row.field),
    ["manufacturer", "release_variant", "print_finish", "components"]
  );
  assert.equal((result.title.match(/\bTopps\b/g) || []).length, 1);
  assert.equal((result.title.match(/\bVariation\b/g) || []).length, 1);
  assert.equal((result.title.match(/\bPrizm\b/g) || []).length, 1);
  assert.equal((result.title.match(/\bAuto(?:graph)?\b/g) || []).length, 1);
}

// Lexical overlap across different semantic fields is not enough to discard a
// supported fact. A product name can contain the same short token as an
// independent finish or rarity without expressing that fact.
{
  const shortPrint = composeCanonicalName({
    year: "2023",
    product: "SP Authentic",
    subjects: ["Player Name"],
    descriptive_rarity: "SP",
    card_number: "1"
  });
  assert.equal(shortPrint.title, "2023 SP Authentic Player Name SP #1");
  assert.ok(shortPrint.trace.selected.some((row) => row.field === "descriptive_rarity"));

  const goldFinish = composeCanonicalName({
    year: "2023",
    product: "Gold Standard",
    subjects: ["Player Name"],
    print_finish: "Gold",
    card_number: "1"
  });
  assert.equal(goldFinish.title, "2023 Gold Standard Player Name Gold #1");
  assert.ok(goldFinish.trace.selected.some((row) => row.field === "print_finish"));

  const cardNameCollision = composeCanonicalName({
    year: "2023",
    product: "Product",
    card_name: "Black Gold Signatures",
    subjects: ["Player Name"],
    print_finish: "Gold",
    card_number: "1"
  });
  assert.equal(cardNameCollision.title,
    "2023 Product Player Name Black Gold Signatures Gold #1");
  assert.ok(cardNameCollision.trace.selected.some((row) => row.field === "print_finish"));

  const variantCollision = composeCanonicalName({
    year: "2023",
    product: "Product",
    card_name: "International Stars",
    subjects: ["Player Name"],
    release_variant: "International",
    card_number: "1"
  });
  assert.equal(variantCollision.title,
    "2023 Product Player Name International Stars International #1");
  assert.ok(variantCollision.trace.selected.some((row) => row.field === "release_variant"));

  const approvedBrandSurface = composeCanonicalName({
    year: "2012",
    product: "Panini Prizm",
    subjects: ["Kobe Bryant"],
    print_finish: "Prizm",
    card_number: "1"
  });
  assert.equal(approvedBrandSurface.title, "2012 Panini Prizm Kobe Bryant #1");
  assert.ok(approvedBrandSurface.trace.omitted.some((row) => (
    row.field === "print_finish" && row.reason === "source_derived_redundancy"
  )));
}

// Redundancy is conditional: if the owning Product cannot be selected, its
// Manufacturer dependency must remain visible rather than point to an omitted
// owner (the real Cosmic Chrome Variation boundary).
{
  const result = composeCanonicalName({
    manufacturer: "Topps",
    product: `Topps Cosmic Chrome ${"X".repeat(30)}`,
    subjects: ["X"],
    card_number: "CCA-CF",
    serial: "1/1"
  }, { limit: 26 });
  assert.equal(result.title, "Topps X #CCA-CF 1/1");
  assert.ok(result.trace.selected.some((row) => row.field === "manufacturer"));
  assert.ok(result.trace.omitted.some((row) => (
    row.field === "product" && row.reason === "budget_lexicographic_selection"
  )));
  assert.ok(!result.trace.omitted.some((row) => (
    row.field === "manufacturer" && row.reason === "source_derived_redundancy"
  )));
}

// Transitive source coverage is allowed internally, but every public trace
// edge resolves to the ultimately displayed owner rather than another omitted
// token.
{
  const result = composeCanonicalName({
    product: "Topps Chrome Gold Auto",
    set: "Chrome Gold Auto",
    subjects: ["Player Name"],
    release_variant: "Gold",
    components: ["Auto"],
    card_number: "1"
  }, { limit: 120 });
  const selectedKeys = new Set(result.trace.selected.map((row) => row.key));
  assert.ok(result.trace.omitted.some((row) => row.field === "set"));
  for (const row of result.trace.omitted.filter((item) => item.redundant_with)) {
    assert.ok(selectedKeys.has(row.redundant_with),
      `${row.key} must resolve to a displayed redundancy owner`);
  }
  assert.equal(result.publishable, true);
  assert.ok(!result.trace.rejected.some((row) => row.reason === "redundancy_owner_not_selected"));
}

// A malformed asserted P0 value is rejected rather than repaired or published.
{
  const result = composeCanonicalName({
    product: "Bowman Chrome",
    subjects: ["Player Name"],
    card_number: "PC#6",
    serial: "1/1"
  });
  assert.equal(result.publishable, false);
  assert.equal(result.title, "");
  assert.ok(result.trace.rejected.some((row) => row.reason === "card_number_cannot_contain_hash"));
}

// Profiles may own aliases, but cannot invent an unrelated year token.
{
  const invalidAliasProfile = {
    ...LYNCA_STANDARD_NAMING_PROFILE_V01,
    yearAliases: [{ id: "invalid_future_year", pattern: /^(\d{4})-\d{2}$/, replacement: "2030" }],
    abbreviateSubjectFirstNames: false
  };
  const result = composeCanonicalName({
    year: "2025-26",
    subjects: ["X"],
    card_number: "X",
    serial: "1/1"
  }, { profile: invalidAliasProfile, limit: 10 });
  assert.doesNotMatch(result.title, /2030/);
  assert.ok(result.trace.rejected.some((row) => row.reason === "year_alias_not_source_derived"));
}

for (const result of [
  composeCanonicalName(powerChords),
  composeCanonicalName(selectPairings),
  composeCanonicalName(bowmanSpotlights)
]) {
  assert.ok(result.length <= 80);
  assert.deepEqual(Object.keys(result.trace), [
    "selected", "omitted", "abbreviated", "transformed", "rejected"
  ]);
  assert.match(result.title, new RegExp(`#${result.canonical.card_number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
  assert.ok(result.title.endsWith(result.canonical.serial), "full serial must survive byte-for-byte");
}

process.stdout.write("Canonical Naming Layer v0.1 tests passed\n");
