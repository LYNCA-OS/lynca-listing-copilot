import assert from "node:assert/strict";
import { createEvidenceField } from "../lib/listing/evidence/evidence-schema.mjs";
import { renderListingPresentation, renderResolvedTitle } from "../lib/listing/renderer/listing-renderer.mjs";

const wemby = renderListingPresentation({
  resolved: {
    year: "2023-24",
    brand: "Panini",
    product: "Prizm",
    players: ["Victor Wembanyama"],
    parallel: "Gold Prizm",
    serial_number: "31/50",
    rc: true,
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  maxLength: 80
});

assert.equal(wemby.final_title, "2023-24 Panini Prizm Victor Wembanyama Gold Prizm 31/50 RC PSA 10");
assert.ok(wemby.final_title.length <= 80);
assert.match(wemby.final_title, /31\/50/);
assert.match(wemby.final_title, /PSA 10$/);
assert.equal((wemby.final_title.match(/\bRC\b/g) || []).length, 1);
assert.equal(wemby.modules.numbering.text, "31/50");
assert.equal(wemby.modules.grading.text, "PSA 10");

const ohtaniChrome = renderListingPresentation({
  resolved: {
    year: "2018",
    manufacturer: "Topps",
    brand: "Topps",
    product: "Topps Chrome",
    set: "2018 Topps Chrome",
    players: ["Shohei Ohtani"],
    collector_number: "83T-6",
    rc: true,
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  maxLength: 80
});
assert.match(ohtaniChrome.final_title, /^2018\b/);
assert.match(ohtaniChrome.final_title, /Topps Chrome/);
assert.match(ohtaniChrome.final_title, /Shohei Ohtani/);
assert.match(ohtaniChrome.final_title, /RC/);
assert.match(ohtaniChrome.final_title, /PSA 10$/);

const dualAuto = renderResolvedTitle({
  year: "2025-26",
  brand: "Topps",
  product: "Topps Chrome",
  players: ["Ace Bailey"],
  insert: "Dual Signatures",
  auto: true,
  serial_number: "31/150"
}, {
  maxLength: 80
});
assert.match(dualAuto.rendered_title, /Dual Signatures/i);
assert.equal((dualAuto.rendered_title.match(/\bAuto\b/gi) || []).length, 1);

const multiplayer = renderResolvedTitle({
  year: "2024",
  brand: "Topps",
  product: "Chrome",
  players: ["Charles Leclerc", "Lewis Hamilton"],
  insert: "Power Partnership"
});
assert.match(multiplayer.rendered_title, /Charles Leclerc/i);
assert.match(multiplayer.rendered_title, /Lewis Hamilton/i);
assert.match(multiplayer.rendered_title, /Power Partnership/i);

const longTitle = renderResolvedTitle({
  year: "2015-16",
  brand: "Panini",
  product: "Immaculate Collection Basketball",
  players: ["Shaquille O'Neal", "Anfernee Hardaway"],
  insert: "Dual Signatures Jersey No.",
  parallel: "Gold Holo Foil Refractor Wave Shimmer",
  serial_number: "01/25",
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 80
});
assert.ok(longTitle.rendered_title.length <= 80);
assert.match(longTitle.rendered_title, /01\/25/);
assert.match(longTitle.rendered_title, /PSA 10$/);

const pokemon = renderListingPresentation({
  resolved: {
    brand: "Pokemon TCG",
    product: "Pokemon Scarlet Violet",
    set: "SV9C",
    character: "Lisia's Appeal",
    subset: "SAR",
    collector_number: "257/208",
    artist: "En Morikura"
  },
  maxLength: 80
});
assert.equal(pokemon.renderer, "pokemon");
assert.match(pokemon.final_title, /Lisia's Appeal/);
assert.match(pokemon.final_title, /#257\/208/);
assert.match(pokemon.final_title, /SAR/);
assert.doesNotMatch(pokemon.final_title, /En Morikura/i);
assert.doesNotMatch(pokemon.final_title, /[\u4e00-\u9fff]/);

const localizedOnlyPokemon = renderListingPresentation({
  resolved: {
    brand: "Pokémon TCG",
    product: "Pokemon Scarlet Violet",
    set: "SV9C",
    character: "琉琪亚的展现",
    subset: "SAR",
    collector_number: "257/208"
  },
  maxLength: 80
});
assert.equal(localizedOnlyPokemon.renderer, "pokemon");
assert.doesNotMatch(localizedOnlyPokemon.final_title, /[\u4e00-\u9fff]/);
assert.equal(localizedOnlyPokemon.title_length_policy.blocked_required_terms.length, 1);
assert.equal(localizedOnlyPokemon.title_length_policy.blocked_required_terms[0].key, "subject");

const reviewedModules = renderListingPresentation({
  resolved: {
    year: "2024",
    brand: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "31/50"
  },
  evidence: {
    serial_number: createEvidenceField({
      value: "31/50",
      status: "REVIEW",
      confidence: 0.68
    })
  }
});
assert.equal(reviewedModules.modules.numbering.status, "REVIEW");
assert.equal(reviewedModules.modules.numbering.requires_review, true);
assert.deepEqual(reviewedModules.module_order, [
  "product_identity",
  "subject",
  "card_variant",
  "numbering",
  "attributes",
  "grading"
]);

console.log("renderer tests passed");
