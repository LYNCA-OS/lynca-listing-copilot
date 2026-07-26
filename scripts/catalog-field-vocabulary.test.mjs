import assert from "node:assert/strict";
import {
  attestTerm,
  extractFinishTerms,
  finishTermQuality,
  isFinishTerm,
  mergeVocabularyEntries,
  normalizeTerm,
  trimAttributePrefix,
  vocabularySourceTiers
} from "../lib/listing/catalog/field-vocabulary.mjs";

// Attribute words sit next to finishes in real titles; the finish must not
// swallow them or the vocabulary fills with "auto blue refractor" variants.
assert.equal(trimAttributePrefix("Auto Blue Refractor"), "blue refractor");
assert.equal(trimAttributePrefix("RC Auto Gold Refractor"), "gold refractor");
assert.equal(trimAttributePrefix("Refractor"), "refractor");

assert.ok(isFinishTerm("gold shimmer refractor"));
assert.ok(isFinishTerm("cracked ice"));
assert.ok(!isFinishTerm("superior signatures"));

// Real verified titles from the catalog.
assert.deepEqual(
  extractFinishTerms("2025-26 Bowman Chrome Johni Broome RC Auto Gold Shimmer Refractor /50"),
  ["gold shimmer refractor"]
);
assert.deepEqual(
  extractFinishTerms("2025 Bowman Chrome Draft 1st Aidan West Teal Wave Refractor /125"),
  ["teal wave refractor"]
);
assert.deepEqual(
  extractFinishTerms("2024 Topps Chrome Star Wars #DF-3 Gold Sapphire"),
  ["gold sapphire"]
);
assert.deepEqual(extractFinishTerms("2025 Panini Donruss Travis Hunter Rated Throwback RC"), []);

assert.equal(finishTermQuality("gold refractor"), "color_qualified");
assert.equal(finishTermQuality("geometric refractor"), "qualified");
assert.equal(finishTermQuality("refractor"), "head_only");

assert.equal(normalizeTerm("  Gold   Refractor!! "), "gold refractor");

// Merging keeps official provenance and sums marketplace frequency.
const merged = mergeVocabularyEntries([
  { field: "print_finish", term: "Gold Refractor", count: 3, tier: vocabularySourceTiers.VERIFIED_TITLE, years: ["2025"] },
  { field: "print_finish", term: "gold refractor", count: 1, tier: vocabularySourceTiers.OFFICIAL, years: ["2026"] },
  { field: "print_finish", term: "Lava Refractor", count: 1, tier: vocabularySourceTiers.VERIFIED_TITLE, years: ["2026"] }
]);
const gold = merged.find((row) => row.term === "gold refractor");
assert.equal(gold.count, 4);
assert.equal(gold.official, true);
assert.deepEqual(gold.years, ["2025", "2026"]);

// Attestation: official always passes; marketplace needs corroboration so one
// typo cannot mint vocabulary; unknown wording stays unattested.
assert.equal(attestTerm(merged, "print_finish", "Auto Gold Refractor").strength, "official");
assert.equal(attestTerm(merged, "print_finish", "Lava Refractor").attested, false);
assert.equal(
  attestTerm(merged, "print_finish", "Lava Refractor", { minVerifiedCount: 1 }).strength,
  "verified_title"
);
assert.equal(attestTerm(merged, "print_finish", "Unicorn Refractor").attested, false);

console.log("catalog field vocabulary tests passed");

// Player names and article fragments are alphabetic too, so an "alphabetic
// word" rule swept them into the vocabulary ("peyton manning lava", "of the
// ice") and would have attested them as real parallels. Qualifiers must be a
// colour, a pattern word, or another finish head.
assert.deepEqual(extractFinishTerms("2025 Topps Chrome Peyton Manning Lava /75"), ["lava"]);
assert.deepEqual(extractFinishTerms("2026 Topps Finest Of The Ice Bo Jackson"), ["ice"]);
assert.deepEqual(
  extractFinishTerms("2026 Bowman Chrome Handelfry Encarnacion Auto Green Lava Refractor /99"),
  ["green lava refractor"]
);
assert.deepEqual(
  extractFinishTerms("2025 Topps Chrome Tennis Flavio Cobolli Gold Geometric Refractor"),
  ["gold geometric refractor"]
);

console.log("catalog field vocabulary qualifier tests passed");
