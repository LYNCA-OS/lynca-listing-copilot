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

assert.equal(wemby.final_title, "2023-24 Panini Prizm Victor Wembanyama Gold Prizm RC 31/50 PSA 10");
assert.ok(wemby.final_title.length <= 80);
assert.match(wemby.final_title, /31\/50/);
assert.match(wemby.final_title, /PSA 10$/);
assert.equal((wemby.final_title.match(/\bRC\b/g) || []).length, 1);
assert.equal(wemby.modules.variant_parallel_rarity.text, "Gold Prizm RC");
assert.equal(wemby.modules.number_serial_grade.text, "31/50 · PSA 10");

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
assert.doesNotMatch(ohtaniChrome.final_title, /2018\s+2018/i);
assert.doesNotMatch(ohtaniChrome.final_title, /Chrome\s+Chrome/i);
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

const ronaldoCompact = renderResolvedTitle({
  year: "2021-22",
  brand: "Panini",
  product: "Impeccable",
  set: "Canvas Creations",
  players: ["Cristiano Ronaldo"],
  card_type: "auto",
  serial_number: "91/99",
  grade_company: "BGS",
  card_grade: "8.5",
  auto_grade: "8",
  grade_type: "CARD_AND_AUTO"
}, {
  maxLength: 80
});
assert.ok(ronaldoCompact.rendered_title.length <= 80);
assert.match(ronaldoCompact.rendered_title, /Cristiano Ronaldo/i);
assert.match(ronaldoCompact.rendered_title, /91\/99/);
assert.match(ronaldoCompact.rendered_title, /BGS 8\.5\/8$/);

const duplicateAutoGrade = renderResolvedTitle({
  year: "2010-11",
  brand: "Panini",
  product: "Absolute Memorabilia",
  set: "Hoopla",
  players: ["Kobe Bryant"],
  card_type: "relic/auto",
  serial_number: "08/25",
  grade_company: "PSA/DNA",
  card_grade: "10",
  auto_grade: "10",
  grade_type: "CARD_AND_AUTO"
}, {
  maxLength: 80
});
assert.match(duplicateAutoGrade.rendered_title, /PSA\/DNA 10$/);
assert.doesNotMatch(duplicateAutoGrade.rendered_title, /10\/10$/);
assert.match(duplicateAutoGrade.rendered_title, /Absolute/i);
assert.doesNotMatch(duplicateAutoGrade.rendered_title, /relic\/auto/i);
assert.match(duplicateAutoGrade.rendered_title, /Auto Relic/i);

const psaDnaCardOnlyAutoRelic = renderResolvedTitle({
  year: "2010-11",
  brand: "Panini",
  product: "Absolute Memorabilia",
  set: "Hoopla",
  players: ["Kobe Bryant"],
  card_type: "relic/auto",
  serial_number: "08/25",
  grade_company: "PSA/DNA",
  card_grade: "10",
  grade_type: "CARD_ONLY",
  auto: true,
  relic: true
}, {
  maxLength: 80
});
assert.ok(psaDnaCardOnlyAutoRelic.rendered_title.length <= 80);
assert.match(psaDnaCardOnlyAutoRelic.rendered_title, /Kobe Bryant/i);
assert.match(psaDnaCardOnlyAutoRelic.rendered_title, /\bAuto\b/i);
assert.match(psaDnaCardOnlyAutoRelic.rendered_title, /\bRelic\b/i);
assert.match(psaDnaCardOnlyAutoRelic.rendered_title, /08\/25/);
assert.match(psaDnaCardOnlyAutoRelic.rendered_title, /PSA 10$/);
assert.doesNotMatch(psaDnaCardOnlyAutoRelic.rendered_title, /PSA\/DNA 10$/);

const baseCard = renderResolvedTitle({
  year: "2023",
  brand: "Panini",
  product: "Prizm",
  set: "2023 Panini Prizm Football",
  players: ["Rashee Rice"],
  card_type: "base",
  rc: true
}, {
  maxLength: 80
});
assert.equal(baseCard.rendered_title, "2023 Panini Prizm Football Rashee Rice RC");

const prizmFifaNoDuplicateBrand = renderResolvedTitle({
  year: "2025-26",
  manufacturer: "Panini",
  brand: "Prizm",
  product: "Prizm FIFA Soccer",
  insert: "Club Legends",
  players: ["Lionel Messi"],
  serial_number: "029/199",
  collector_number: "CL-LM",
  auto: true
}, {
  maxLength: 80
});
assert.equal(prizmFifaNoDuplicateBrand.rendered_title, "2025-26 Panini Prizm FIFA Soccer Lionel Messi Club Legends 029/199 Auto #CL-LM");
assert.doesNotMatch(prizmFifaNoDuplicateBrand.rendered_title, /Prizm\s+Prizm/i);

const insertCardType = renderResolvedTitle({
  year: "2025",
  brand: "Topps",
  product: "Finest",
  set: "Finest",
  players: ["Shohei Ohtani"],
  card_type: "insert",
  insert: "Gusto",
  serial_number: "5/5"
}, {
  maxLength: 80
});
assert.equal(insertCardType.rendered_title, "2025 Topps Finest Shohei Ohtani Gusto 5/5");

const tripleThreadsMultiPlayer = renderResolvedTitle({
  year: "2020",
  brand: "Topps",
  product: "Triple Threads",
  set: "Historic Ties",
  players: ["Hank Aaron", "Ken Griffey Jr.", "Mike Trout"],
  card_type: "Auto Relic",
  serial_number: "6/9",
  grade_company: "BGS",
  card_grade: "9",
  auto_grade: "10",
  grade_type: "CARD_AND_AUTO",
  auto: true,
  relic: true
}, {
  maxLength: 80
});
assert.ok(tripleThreadsMultiPlayer.rendered_title.length <= 80);
assert.match(tripleThreadsMultiPlayer.rendered_title, /^2020\b/);
assert.match(tripleThreadsMultiPlayer.rendered_title, /Triple Threads/i);
assert.match(tripleThreadsMultiPlayer.rendered_title, /Aaron/i);
assert.match(tripleThreadsMultiPlayer.rendered_title, /Griffey/i);
assert.match(tripleThreadsMultiPlayer.rendered_title, /Trout/i);
assert.match(tripleThreadsMultiPlayer.rendered_title, /6\/9/);
assert.match(tripleThreadsMultiPlayer.rendered_title, /BGS 9\/10$/);

const flangLongParallel = renderResolvedTitle({
  year: "2025-26",
  brand: "Topps",
  product: "Topps Chrome",
  players: ["Cooper Flagg"],
  card_type: "auto",
  insert: "Next Stop Signatures",
  parallel: "Purple Refractor",
  serial_number: "72/75",
  rc: true,
  auto: true
}, {
  maxLength: 80
});
assert.ok(flangLongParallel.rendered_title.length <= 80);
assert.match(flangLongParallel.rendered_title, /Purple/i);
assert.doesNotMatch(flangLongParallel.title_length_policy.removed_terms.join(" "), /Purple/i);

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
assert.equal(reviewedModules.modules.number_serial_grade.status, "REVIEW");
assert.equal(reviewedModules.modules.number_serial_grade.requires_review, true);
assert.deepEqual(reviewedModules.module_order, [
  "year",
  "franchise_brand",
  "product_set",
  "subject",
  "card_type",
  "variant_parallel_rarity",
  "number_serial_grade"
]);

console.log("renderer tests passed");
