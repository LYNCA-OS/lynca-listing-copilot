#!/usr/bin/env node
import assert from "node:assert";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { buildTitleClaims, canonicalClaimCoverage } from "../lib/listing/thin/title-claim-lineage.mjs";
import { stripCategoryFiller } from "../lib/listing/thin/marketplace-composer-rules.mjs";

const base = { grammar: "standard", subjects: [], components: [], attributes: [], unreadable: [], low_confidence: [] };

// Spans are arithmetic, not a search. This is the case indexOf gets wrong: the
// word "Prizm" appears as the product AND inside the finish, and a search would
// attribute both occurrences to whichever bracket it scanned for first.
{
  const fields = { ...base, year: "2023-24", manufacturer: "Panini", product: "Prizm",
    subjects: ["LeBron James"], parallel_exact: "Red Prizm", print_finish: "Red Prizm", serial: "18/49" };
  const composed = composeFromCanonicalFields(fields);
  const { claims, verified, problems } = buildTitleClaims(fields, composed);
  assert.ok(verified, `expected clean lineage, got ${JSON.stringify(problems)}`);
  for (const claim of claims) {
    assert.equal(composed.title.slice(claim.span[0], claim.span[1]), claim.text,
      `span must literally be the text for ${claim.bracket}`);
  }
  const finish = claims.find((c) => c.bracket === "print_finish");
  assert.ok(finish, "finish bracket present");
  assert.ok(finish.span[0] > claims.find((c) => c.bracket === "product").span[0],
    "the finish occurrence must be the LATER one, not the product's");
  assert.deepEqual(finish.sources, [{ field: "parallel_exact", value: "Red Prizm" }]);
}

// A composer-applied rewrite is evidence, and it is reported as such rather
// than passed off as a verbatim match.
{
  const fields = { ...base, year: "2025-26", manufacturer: "Topps", product: "Chrome",
    subjects: ["Cooper Flagg"], card_name: "Autograph", components: ["RC", "Auto"] };
  const composed = composeFromCanonicalFields(fields);
  const { claims, verified } = buildTitleClaims(fields, composed);
  assert.ok(verified, "a recorded normalization makes the claim derivable");
  const name = claims.find((c) => c.bracket === "card_name");
  assert.equal(name.text, "Auto");
  assert.equal(name.derived_via, "composer_normalization");
  assert.ok(name.normalizations.includes("autograph_to_auto"));
  assert.deepEqual(name.sources, [{ field: "card_name", value: "Autograph" }]);
}

// A category word carrying a possessive is part of a proper name. Stripping it
// produced "1993 Topps Finest 's Finest Bo Jackson" on a real card.
{
  assert.equal(stripCategoryFiller("Baseball's Finest", { semanticRole: "description" }).title,
    "Baseball's Finest");
  // The ordinary case must still yield -- the guard is about the clitic, not
  // about sport words in general.
  assert.equal(stripCategoryFiller("Prizm Basketball", { semanticRole: "description" }).title.trim(),
    "Prizm");
}

// One claim per subject: three players are three facts, each separately
// REQUIRED or FORBIDDEN, so they cannot share a single joined claim.
{
  const fields = { ...base, year: "2026", manufacturer: "Bowman", product: "Chrome",
    subjects: ["Kendry Chourio", "Marek Houston", "Aiva Arquette"] };
  const { claims } = buildTitleClaims(fields, composeFromCanonicalFields(fields));
  assert.equal(claims.find((c) => c.bracket === "subject").sources.length, 3);
}

// Coverage runs the other direction: what did canonical know that never
// reached the title? That is what separates a Composer loss from a
// recognition loss.
{
  const fields = { ...base, year: "2024", manufacturer: "Topps", product: "Chrome",
    subjects: ["Player One"], team: "Dodgers", card_number: "12" };
  const composed = composeFromCanonicalFields(fields);
  const coverage = canonicalClaimCoverage(fields, composed);
  const cardNumber = coverage.find((c) => c.field === "card_number");
  assert.ok(cardNumber && cardNumber.in_title === false,
    "eBay suppresses [Card Number] for a Standard card, so canonical knew it and the title did not carry it");
  assert.ok(coverage.find((c) => c.field === "subjects")?.in_title, "the subject did reach the title");
}
console.log("title-claim-lineage: ok");
