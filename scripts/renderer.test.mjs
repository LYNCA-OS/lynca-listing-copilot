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
    numerical_rarity: "31/50",
    rc: true,
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  maxLength: 80
});

assert.equal(wemby.final_title, "2023-24 Panini Prizm Victor Wembanyama Gold 31/50 RC PSA 10");
assert.ok(wemby.final_title.length <= 80);
assert.match(wemby.final_title, /31\/50/);
assert.match(wemby.final_title, /PSA 10$/);
assert.equal((wemby.final_title.match(/\bRC\b/g) || []).length, 1);
assert.equal(wemby.modules.release_variant.text, "");
assert.equal(wemby.modules.print_finish.text, "Gold Prizm");
assert.equal(wemby.modules.numerical_rarity.text, "31/50");
assert.equal(wemby.modules.search_optimization.text, "RC");
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
assert.doesNotMatch(ohtaniChrome.final_title, /2018\s+2018/i);
assert.doesNotMatch(ohtaniChrome.final_title, /Chrome\s+Chrome/i);
assert.match(ohtaniChrome.final_title, /Shohei Ohtani/);
assert.match(ohtaniChrome.final_title, /RC/);
assert.match(ohtaniChrome.final_title, /PSA 10$/);

const ohtani1983ToppsInsert = renderResolvedTitle({
  year: "2018",
  manufacturer: "Topps",
  brand: "Topps",
  product: "Topps Chrome",
  set: "1983 Topps",
  players: ["Shohei Ohtani"],
  collector_number: "83T-6",
  rc: true,
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 80
});
assert.match(ohtani1983ToppsInsert.rendered_title, /^2018 Topps Chrome 1983 Topps Shohei Ohtani/i);
assert.doesNotMatch(ohtani1983ToppsInsert.rendered_title, /Topps\s+Topps/i);

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

const jsonStringSubject = renderResolvedTitle({
  year: "2025",
  product: "Bowman Draft",
  players: "[\"Seth Hernandez\"]",
  card_name: "Auto",
  serial_number: "02/10",
  numerical_rarity: "02/10"
}, {
  maxLength: 80
});
assert.match(jsonStringSubject.rendered_title, /Seth Hernandez/);
assert.doesNotMatch(jsonStringSubject.rendered_title, /\["Seth Hernandez"\]/);

const ronaldoCompact = renderResolvedTitle({
  year: "2021-22",
  brand: "Panini",
  product: "Impeccable",
  set: "Canvas Creations",
  players: ["Cristiano Ronaldo"],
  card_type: "auto",
  serial_number: "91/99",
    numerical_rarity: "91/99",
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
    numerical_rarity: "08/25",
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

const dirtyAutoGradeRejected = renderResolvedTitle({
  year: "2018",
  manufacturer: "Panini",
  product: "Encased",
  players: ["Kobe Bryant"],
  card_name: "Auto",
  numerical_rarity: "20/99",
  grade_company: "BGS",
  card_grade: "9.5",
  auto_grade: "9.5 GEM MINT",
  grade_type: "CARD_AND_AUTO",
  auto: true
}, {
  maxLength: 80
});
assert.match(dirtyAutoGradeRejected.rendered_title, /BGS 9\.5$/);
assert.doesNotMatch(dirtyAutoGradeRejected.rendered_title, /9\.5\/9\.5/);
assert.doesNotMatch(dirtyAutoGradeRejected.rendered_title, /GEM MINT/);

const absoluteProductBrandOverlap = renderResolvedTitle({
  year: "2010-11",
  manufacturer: "Panini",
  brand: "Absolute Memorabilia",
  product: "Absolute Hoopla",
  insert: "Hoopla",
  players: ["Kobe Bryant"],
  card_type: "Memorabilia",
  serial_number: "08/25",
    numerical_rarity: "08/25",
  auto: true,
  patch: true,
  collector_number: "13",
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 90
});
assert.doesNotMatch(absoluteProductBrandOverlap.rendered_title, /Absolute\s+Absolute/i);
assert.match(absoluteProductBrandOverlap.rendered_title, /Hoopla Kobe Bryant/i);

const psaDnaCardOnlyAutoRelic = renderResolvedTitle({
  year: "2010-11",
  brand: "Panini",
  product: "Absolute Memorabilia",
  set: "Hoopla",
  players: ["Kobe Bryant"],
  card_type: "relic/auto",
  serial_number: "08/25",
    numerical_rarity: "08/25",
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
    numerical_rarity: "029/199",
  collector_number: "CL-LM",
  auto: true
}, {
  maxLength: 80
});
assert.equal(prizmFifaNoDuplicateBrand.rendered_title, "2025-26 Panini Prizm FIFA Soccer Lionel Messi Club Legends 029/199 #CL Auto");
assert.doesNotMatch(prizmFifaNoDuplicateBrand.rendered_title, /Prizm\s+Prizm/i);

const tripleThreadsLongMultiplayer = renderResolvedTitle({
  year: "2020",
  manufacturer: "Topps",
  brand: "Topps Triple Threads",
  product: "Topps Triple Threads Baseball",
  players: ["Mike Trout", "Hank Aaron", "Ken Griffey Jr."],
  insert: "Historic Ties",
  card_type: "Autograph Relic Card",
  auto: true,
  relic: true,
  grade_company: "BGS",
  card_grade: "9",
  auto_grade: "10",
  grade_type: "CARD_AND_AUTO"
}, {
  maxLength: 80
});
assert.ok(tripleThreadsLongMultiplayer.rendered_title.length <= 80);
assert.match(tripleThreadsLongMultiplayer.rendered_title, /Triple Threads/i);
assert.match(tripleThreadsLongMultiplayer.rendered_title, /Historic Ties/i);
assert.doesNotMatch(tripleThreadsLongMultiplayer.rendered_title, /Triple Threads\s+Triple Threads/i);
assert.match(tripleThreadsLongMultiplayer.rendered_title, /BGS 9\/10$/);

const tripleThreadsNamedCardType = renderResolvedTitle({
  year: "2020",
  manufacturer: "Topps",
  brand: "Topps Triple Threads",
  product: "Topps Triple Threads Baseball",
  players: ["Mike Trout", "Hank Aaron", "Ken Griffey Jr."],
  card_type: "Historic Ties Triple Autograph Relic Card",
  auto: true,
  relic: true,
  grade_company: "BGS",
  card_grade: "9",
  auto_grade: "10",
  grade_type: "CARD_AND_AUTO"
}, {
  maxLength: 80
});
assert.ok(tripleThreadsNamedCardType.rendered_title.length <= 80);
assert.match(tripleThreadsNamedCardType.rendered_title, /Triple Threads/i);
assert.match(tripleThreadsNamedCardType.rendered_title, /Historic Ties/i);
assert.doesNotMatch(tripleThreadsNamedCardType.rendered_title, /Autograph Relic Card/i);

const insertCardType = renderResolvedTitle({
  year: "2025",
  brand: "Topps",
  product: "Finest",
  set: "Finest",
  players: ["Shohei Ohtani"],
  card_type: "insert",
  insert: "Gusto",
  serial_number: "5/5",
  numerical_rarity: "5/5"
}, {
  maxLength: 80
});
assert.equal(insertCardType.rendered_title, "2025 Topps Finest Shohei Ohtani Gusto 5/5");

const setAlreadyCarriesInsert = renderResolvedTitle({
  year: "2025",
  brand: "Topps",
  product: "Topps Finest",
  set: "Finest Gusto",
  players: ["Shohei Ohtani"],
  card_type: "Base",
  insert: "Gusto",
  serial_number: "5/5",
    numerical_rarity: "5/5",
  collector_number: "G-11"
}, {
  maxLength: 80
});
assert.doesNotMatch(setAlreadyCarriesInsert.rendered_title, /Gusto.*Gusto/i);
assert.equal(setAlreadyCarriesInsert.rendered_title, "2025 Topps Finest Gusto Shohei Ohtani 5/5 #G-11");

const bowmansBestJordan = renderListingPresentation({
  resolved: {
    year: "1997-98",
    product: "Bowman's Best",
    players: ["Michael Jordan"],
    card_name: "Best Performance",
    team: "Chicago Bulls"
  },
  maxLength: 85
});
assert.equal(bowmansBestJordan.final_title, "1997-98 Bowman's Best Michael Jordan Best Performance (Chicago Bulls)");
assert.equal(bowmansBestJordan.modules.card_name.text, "Best Performance");
assert.equal(bowmansBestJordan.modules.search_optimization.text, "Chicago Bulls");

const toppsCosmicHierarchy = renderResolvedTitle({
  year: "2025",
  manufacturer: "Topps",
  product: "Topps Chrome",
  set: "Topps Cosmic Chrome",
  players: ["Test Player"],
  collector_number: "22"
}, {
  maxLength: 85
});
assert.equal(toppsCosmicHierarchy.rendered_title, "2025 Topps Cosmic Chrome Test Player #22");
assert.doesNotMatch(toppsCosmicHierarchy.rendered_title, /Topps\s+Topps/i);

const paniniPrizmBlackHierarchy = renderResolvedTitle({
  year: "2025",
  manufacturer: "Panini",
  product: "Prizm",
  set: "Prizm Black",
  players: ["Test Player"],
  collector_number: "22"
}, {
  maxLength: 85
});
assert.equal(paniniPrizmBlackHierarchy.rendered_title, "2025 Panini Prizm Black Test Player #22");

const cardNumberRemovedBeforeSecondaryFields = renderResolvedTitle({
  year: "2025-26",
  brand: "Topps",
  product: "Topps Chrome Basketball",
  players: ["Victor Wembanyama"],
  card_name: "Showcase Performance",
  surface_color: "Gold",
  parallel_family: "Sparkle",
  serial_number: "17/50",
    numerical_rarity: "17/50",
  collector_number: "TCAR-AB",
  ssp: true,
  auto: true,
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 85
});
assert.ok(cardNumberRemovedBeforeSecondaryFields.rendered_title.length <= 85);
assert.doesNotMatch(cardNumberRemovedBeforeSecondaryFields.rendered_title, /#TCAR-AB/);
assert.match(cardNumberRemovedBeforeSecondaryFields.title_length_policy.removed_terms.join(" "), /#TCAR-AB/);

const bowmansBestJordanInsertFallback = renderResolvedTitle({
  year: "1997-98",
  product: "Bowman's Best",
  players: ["Michael Jordan"],
  insert: "Best Performance",
  team: "Chicago Bulls"
}, {
  maxLength: 85
});
assert.equal(bowmansBestJordanInsertFallback.rendered_title, "1997-98 Bowman's Best Michael Jordan Best Performance (Chicago Bulls)");

const brandProductOverlapKeepsSet = renderResolvedTitle({
  year: "2025",
  brand: "Topps Finest",
  product: "Topps Finest",
  set: "Gusto",
  players: ["Shohei Ohtani"],
  serial_number: "5/5",
    numerical_rarity: "5/5",
  team: "Los Angeles Dodgers"
}, {
  maxLength: 80
});
assert.match(brandProductOverlapKeepsSet.rendered_title, /\bGusto\b/);
assert.match(brandProductOverlapKeepsSet.rendered_title, /\(Los Angeles Dodgers\)$/);
assert.doesNotMatch(brandProductOverlapKeepsSet.rendered_title, /Topps Finest Topps Finest/i);

const sportSuffixProductKeepsSet = renderResolvedTitle({
  year: "2025",
  manufacturer: "Panini",
  brand: "Donruss",
  product: "Donruss Football",
  set: "Throwback",
  players: ["Travis Hunter"],
  team: "Jacksonville Jaguars",
  rc: true,
  collector_number: "3"
}, {
  maxLength: 80
});
assert.match(sportSuffixProductKeepsSet.rendered_title, /\bDonruss Throwback\b/);
assert.doesNotMatch(sportSuffixProductKeepsSet.rendered_title, /Football/i);
assert.doesNotMatch(sportSuffixProductKeepsSet.rendered_title, /Donruss Donruss/i);

const teamIncludedOnlyWhenRoom = renderResolvedTitle({
  year: "2025",
  brand: "Topps",
  product: "Finest",
  set: "Gusto",
  players: ["Shohei Ohtani"],
  serial_number: "5/5",
    numerical_rarity: "5/5",
  team: "Los Angeles Dodgers"
}, {
  maxLength: 85
});
assert.match(teamIncludedOnlyWhenRoom.rendered_title, /\(Los Angeles Dodgers\)$/);
assert.ok(teamIncludedOnlyWhenRoom.rendered_title.length <= 85);

const teamOmittedWhenTitleWouldOverflow = renderResolvedTitle({
  year: "2025-26",
  brand: "Topps",
  product: "Topps Chrome Basketball",
  players: ["Victor Wembanyama"],
  insert: "Next Stop Signatures",
  parallel_exact: "Purple Wave Refractor",
  serial_number: "12/50",
    numerical_rarity: "12/50",
  rc: true,
  auto: true,
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY",
  team: "San Antonio Spurs"
}, {
  maxLength: 85
});
assert.ok(teamOmittedWhenTitleWouldOverflow.rendered_title.length <= 85);
assert.doesNotMatch(teamOmittedWhenTitleWouldOverflow.rendered_title, /San Antonio|Spurs/i);

const productAlreadyCarriesInsert = renderResolvedTitle({
  year: "2010-11",
  brand: "Panini",
  product: "Panini Absolute",
  set: "Absolute Hoopla",
  players: ["Kobe Bryant"],
  card_type: "Patch Auto",
  insert: "Hoopla",
  serial_number: "08/25",
    numerical_rarity: "08/25",
  auto: true,
  patch: true,
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 80
});
assert.doesNotMatch(productAlreadyCarriesInsert.rendered_title, /Hoopla.*Hoopla/i);
assert.equal(productAlreadyCarriesInsert.rendered_title, "2010-11 Panini Absolute Hoopla Kobe Bryant Patch Auto 08/25 PSA 10");

const duplicatePsaCardAndAutoGrade = renderResolvedTitle({
  year: "2020",
  brand: "Panini",
  product: "Contenders",
  players: ["Anthony Edwards"],
  auto: true,
  grade_company: "PSA",
  card_grade: "10",
  auto_grade: "10",
  grade_type: "CARD_AND_AUTO"
}, {
  maxLength: 80
});
assert.match(duplicatePsaCardAndAutoGrade.rendered_title, /PSA 10$/);
assert.doesNotMatch(duplicatePsaCardAndAutoGrade.rendered_title, /10\/10$/);

const tripleThreadsMultiPlayer = renderResolvedTitle({
  year: "2020",
  brand: "Topps",
  product: "Triple Threads",
  set: "Historic Ties",
  players: ["Hank Aaron", "Ken Griffey Jr.", "Mike Trout"],
  card_type: "Auto Relic",
  serial_number: "6/9",
    numerical_rarity: "6/9",
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
    numerical_rarity: "72/75",
  rc: true,
  auto: true
}, {
  maxLength: 80
});
assert.ok(flangLongParallel.rendered_title.length <= 80);
assert.match(flangLongParallel.rendered_title, /Purple/i);
assert.match(flangLongParallel.rendered_title, /\bAuto\b/i);
assert.doesNotMatch(flangLongParallel.rendered_title, /Purple Refractor/i);
assert.doesNotMatch(flangLongParallel.title_length_policy.removed_terms.join(" "), /Purple/i);

const complexSurfaceColorDoesNotPolluteKnownParallel = renderResolvedTitle({
  year: "2025",
  brand: "Topps",
  product: "Topps Finest",
  set: "Gusto",
  players: ["Shohei Ohtani"],
  surface_color: "Red/Orange/Blue",
  parallel: "Red Refractor",
  serial_number: "5/5"
}, {
  maxLength: 80
});
assert.match(complexSurfaceColorDoesNotPolluteKnownParallel.rendered_title, /\bRed\b/);
assert.doesNotMatch(complexSurfaceColorDoesNotPolluteKnownParallel.rendered_title, /Red Refractor/);
assert.doesNotMatch(complexSurfaceColorDoesNotPolluteKnownParallel.rendered_title, new RegExp("Red/Orange/Blue"));

const oneOfOneSerialLimitPreserved = renderResolvedTitle({
  year: "2024",
  brand: "Topps",
  product: "Chrome",
  players: ["Michael Jackson"],
  serial_number: "01/01",
    numerical_rarity: "01/01",
  one_of_one: true
}, {
  maxLength: 85
});
assert.match(oneOfOneSerialLimitPreserved.rendered_title, /1\/1/);
assert.doesNotMatch(oneOfOneSerialLimitPreserved.rendered_title, /01\/01/);

const simpleSurfaceColorDoesNotAutoCompleteParallelFamily = renderResolvedTitle({
  year: "2025",
  brand: "Topps",
  product: "Topps Chrome",
  players: ["Cooper Flagg"],
  surface_color: "Purple",
  parallel: "Wave",
  serial_number: "72/75"
}, {
  maxLength: 80
});
assert.match(simpleSurfaceColorDoesNotAutoCompleteParallelFamily.rendered_title, /\bPurple\b/);
assert.doesNotMatch(simpleSurfaceColorDoesNotAutoCompleteParallelFamily.rendered_title, /Purple Wave/);

const confirmedParallelExactIsPreserved = renderResolvedTitle({
  year: "2025",
  brand: "Topps",
  product: "Topps Chrome",
  players: ["Cooper Flagg"],
  surface_color: "Purple",
  parallel_family: "Wave Refractor",
  parallel_exact: "Purple Wave Refractor",
  serial_number: "72/75"
}, {
  maxLength: 80
});
assert.match(confirmedParallelExactIsPreserved.rendered_title, /Purple Wave Refractor/);

const productSportSuffixKeepsBrandIdentity = renderResolvedTitle({
  year: "2025-26",
  manufacturer: "Topps",
  brand: "Topps Chrome",
  product: "Topps Chrome Basketball",
  players: ["Cooper Flagg"],
  insert: "Next Stop Signatures",
  parallel: "Purple",
  serial_number: "72/75",
    numerical_rarity: "72/75",
  rc: true,
  auto: true
}, {
  maxLength: 80
});
assert.match(productSportSuffixKeepsBrandIdentity.rendered_title, /Topps Chrome Cooper Flagg/i);
assert.doesNotMatch(productSportSuffixKeepsBrandIdentity.rendered_title, /^2025-26 Chrome\b/i);

const rookieTicketPriority = renderResolvedTitle({
  year: "2020-21",
  brand: "Panini",
  product: "Contenders",
  players: ["Anthony Edwards"],
  card_type: "Rookie Ticket",
  insert: "Variation-Autograph",
  collector_number: "105",
  rc: true,
  auto: true,
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 80
});
assert.ok(rookieTicketPriority.rendered_title.length <= 80);
assert.match(rookieTicketPriority.rendered_title, /Rookie Ticket/i);
assert.match(rookieTicketPriority.rendered_title, /Anthony Edwards/i);
assert.match(rookieTicketPriority.rendered_title, /PSA 10$/);

const statusNewBreedFieldFidelity = renderResolvedTitle({
  year: "2018-19",
  manufacturer: "Panini",
  brand: "Panini",
  product: "Status Basketball",
  players: ["Trae Young"],
  card_name: "New Breed",
  parallel_family: "Gold Holo Foil Refractor Wave Shimmer",
  serial_number: "20/99",
    numerical_rarity: "20/99",
  collector_number: "NB-TY",
  rc: true,
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY",
  team: "Atlanta Hawks"
}, {
  maxLength: 85
});
assert.ok(statusNewBreedFieldFidelity.rendered_title.length <= 85);
assert.match(statusNewBreedFieldFidelity.rendered_title, /\bStatus\b/i);
assert.match(statusNewBreedFieldFidelity.rendered_title, /\bNew Breed\b/i);
assert.match(statusNewBreedFieldFidelity.rendered_title, /20\/99/);
assert.match(statusNewBreedFieldFidelity.rendered_title, /PSA 10$/);

const statusNewBreedKeepsCardNumberBeforePureSportSuffix = renderResolvedTitle({
  year: "2018-19",
  manufacturer: "Panini",
  brand: "Panini",
  product: "Panini Status",
  set: "Status Basketball",
  players: ["Trae Young"],
  card_name: "New Breed",
  collector_number: "NB-TYG",
  auto: true,
  team: "Atlanta Hawks"
}, {
  maxLength: 80
});
assert.ok(statusNewBreedKeepsCardNumberBeforePureSportSuffix.rendered_title.length <= 80);
assert.match(statusNewBreedKeepsCardNumberBeforePureSportSuffix.rendered_title, /Panini Status Trae Young New Breed #NB-TYG RC Auto/i);
assert.doesNotMatch(statusNewBreedKeepsCardNumberBeforePureSportSuffix.rendered_title, /Status Basketball/i);

const encasedGradeCompanyMissingDoesNotInventGenericGrade = renderResolvedTitle({
  year: "2020-21",
  manufacturer: "Panini",
  product: "Encased Basketball",
  players: ["Anthony Edwards"],
  card_name: "SIG-GOLD BREAKAWAY",
  surface_color: "Gold",
  serial_number: "9/10",
    numerical_rarity: "9/10",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 85
});
assert.ok(encasedGradeCompanyMissingDoesNotInventGenericGrade.rendered_title.length <= 85);
assert.match(encasedGradeCompanyMissingDoesNotInventGenericGrade.rendered_title, /\bEncased\b/i);
assert.match(encasedGradeCompanyMissingDoesNotInventGenericGrade.rendered_title, /Signatures Breakaway Gold/i);
assert.doesNotMatch(encasedGradeCompanyMissingDoesNotInventGenericGrade.rendered_title, /Grade 10$/);

const rookieMaterialSignaturesPreserveKnownComponents = renderResolvedTitle({
  year: "2018",
  manufacturer: "Panini America, Inc.",
  product: "National Treasures",
  players: ["Shohei Ohtani"],
  card_name: "Rookie Material Signatures",
  numerical_rarity: "20/25"
}, {
  maxLength: 80
});
assert.match(rookieMaterialSignaturesPreserveKnownComponents.rendered_title, /^2018 Panini National Treasures/i);
assert.match(rookieMaterialSignaturesPreserveKnownComponents.rendered_title, /Rookie Patch Auto/i);
assert.match(rookieMaterialSignaturesPreserveKnownComponents.rendered_title, /RC\b/i);
assert.doesNotMatch(rookieMaterialSignaturesPreserveKnownComponents.rendered_title, /Panini America/i);

const prizmWorldCupSetSurvivesCompression = renderResolvedTitle({
  year: "2022",
  manufacturer: "Panini",
  product: "Panini Prizm",
  set: "Prizm FIFA World Cup Qatar 2022",
  players: ["Pele"],
  card_name: "SIG-GOLD BREAKAWAY",
  surface_color: "Gold",
  numerical_rarity: "2/2",
  collector_number: "S-P",
  auto: true,
  grade_company: "PSA",
  card_grade: "9",
  grade_type: "CARD_ONLY",
  team: "Brazil"
}, {
  maxLength: 80
});
assert.ok(prizmWorldCupSetSurvivesCompression.rendered_title.length <= 80);
assert.match(prizmWorldCupSetSurvivesCompression.rendered_title, /Panini Prizm World Cup/i);
assert.match(prizmWorldCupSetSurvivesCompression.rendered_title, /Signatures Breakaway Gold/i);
assert.doesNotMatch(prizmWorldCupSetSurvivesCompression.rendered_title, /Qatar 2022/i);

const shieldCardNamePreservesPatchMeaning = renderResolvedTitle({
  year: "2023",
  manufacturer: "Panini",
  product: "Flawless Football",
  players: ["Rashee Rice"],
  card_name: "Shield",
  numerical_rarity: "1/1",
  collector_number: "LTS",
  rc: true,
  auto: true,
  team: "Chiefs"
}, {
  maxLength: 80
});
assert.ok(shieldCardNamePreservesPatchMeaning.rendered_title.length <= 80);
assert.match(shieldCardNamePreservesPatchMeaning.rendered_title, /NFL Shield Patch/i);
assert.match(shieldCardNamePreservesPatchMeaning.rendered_title, /RC Auto/i);
assert.doesNotMatch(shieldCardNamePreservesPatchMeaning.rendered_title, /Patch\s+Patch\s+Auto/i);

const longTitle = renderResolvedTitle({
  year: "2015-16",
  brand: "Panini",
  product: "Immaculate Collection Basketball",
  players: ["Shaquille O'Neal", "Anfernee Hardaway"],
  insert: "Dual Signatures Jersey No.",
  parallel: "Gold Holo Foil Refractor Wave Shimmer",
  serial_number: "01/25",
    numerical_rarity: "01/25",
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 80
});
assert.ok(longTitle.rendered_title.length <= 80);
assert.match(longTitle.rendered_title, /01\/25/);
assert.match(longTitle.rendered_title, /PSA 10$/, "SCG grading is highest priority and must survive 80-character compression");

const longTitleEbayLimit = renderResolvedTitle({
  year: "2015-16",
  brand: "Panini",
  product: "Immaculate Collection Basketball",
  players: ["Shaquille O'Neal", "Anfernee Hardaway"],
  insert: "Dual Signatures Jersey No.",
  parallel: "Gold Holo Foil Refractor Wave Shimmer",
  serial_number: "01/25",
    numerical_rarity: "01/25",
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 85
});
assert.ok(longTitleEbayLimit.rendered_title.length <= 85);
assert.match(longTitleEbayLimit.rendered_title, /PSA 10$/);

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
assert.match(pokemon.final_title, /257\/208/);
assert.match(pokemon.final_title, /SAR/);
assert.doesNotMatch(pokemon.final_title, /En Morikura/i);
assert.doesNotMatch(pokemon.final_title, /[\u4e00-\u9fff]/);

const onePieceTcg = renderListingPresentation({
  resolved: {
    category: "TCG",
    brand: "Bandai",
    product: "One Piece Card Game",
    set: "OP-09",
    language: "jp",
    character: "Monkey D. Luffy",
    card_name: "Gear 5",
    surface_color: "Gold",
    serial_number: "12/100",
    numerical_rarity: "12/100",
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  maxLength: 85
});
assert.equal(onePieceTcg.renderer, "pokemon");
assert.match(onePieceTcg.final_title, /One Piece/i);
assert.match(onePieceTcg.final_title, /\bJapanese\b/);
assert.match(onePieceTcg.final_title, /Monkey D\. Luffy/i);
assert.match(onePieceTcg.final_title, /Gear 5/i);
assert.match(onePieceTcg.final_title, /12\/100/);
assert.match(onePieceTcg.final_title, /PSA 10$/);

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
assert.equal(reviewedModules.modules.numerical_rarity.status, "NOT_APPLICABLE");
assert.equal(reviewedModules.modules.numerical_rarity.requires_review, false);
assert.equal(reviewedModules.modules.numerical_rarity.text, "");
assert.doesNotMatch(reviewedModules.final_title, /31\/50|#\/50/);
assert.deepEqual(reviewedModules.module_order, [
  "year",
  "product_identity",
  "subject",
  "card_name",
  "release_variant",
  "print_finish",
  "numerical_rarity",
  "descriptive_rarity",
  "card_number",
  "search_optimization",
  "grading"
]);

const directCurrentSerialBackfill = renderListingPresentation({
  resolved: {
    year: "2024-25",
    brand: "Panini",
    product: "Immaculate",
    players: ["Anthony Edwards"],
    card_type: "Patch Auto",
    serial_number: "2/3",
    grade_company: "BGS",
    card_grade: "8.5",
    auto_grade: "10",
    grade_type: "CARD_AND_AUTO"
  },
  evidence: {
    serial_number: createEvidenceField({
      value: "2/3",
      status: "CONFIRMED",
      confidence: 0.95,
      sources: [{ source_type: "CARD_FRONT", observed_text: "2/3" }]
    })
  }
});
assert.match(directCurrentSerialBackfill.final_title, /2\/3/);
assert.doesNotMatch(directCurrentSerialBackfill.final_title, /#\/3/);
assert.equal(directCurrentSerialBackfill.modules.numerical_rarity.text, "2/3");

const booleanGradeCompanySuppressed = renderListingPresentation({
  resolved: {
    year: "2018-19",
    brand: "Panini",
    product: "Court Kings",
    players: ["Trae Young"],
    card_name: "Heir Apparent Autographs",
    parallel_exact: "Sapphire",
    grade_company: "true",
    card_grade: "10",
    grade_type: "CARD_ONLY",
    auto: true
  }
});
assert.doesNotMatch(booleanGradeCompanySuppressed.final_title, /\bTRUE\s+10\b/i);
assert.doesNotMatch(booleanGradeCompanySuppressed.modules.grading.text, /\bTRUE\b/i);

const booleanCardGradeSuppressed = renderListingPresentation({
  resolved: {
    year: "2022",
    brand: "Panini",
    product: "Prizm World Cup",
    players: ["Pele"],
    grade_company: "PSA",
    card_grade: true,
    grade_type: "CARD_ONLY"
  }
});
assert.doesNotMatch(booleanCardGradeSuppressed.final_title, /\bPSA\s+true\b/i);
assert.doesNotMatch(booleanCardGradeSuppressed.final_title, /\bPSA\b/i);
assert.equal(booleanCardGradeSuppressed.modules.grading.text, "");

const colorWithReviewDescriptor = renderListingPresentation({
  resolved: {
    year: "2024",
    brand: "Topps",
    product: "Chrome",
    players: ["Victor Wembanyama"],
    surface_color: "Gold",
    parallel_family: "Sparkle",
    serial_number: "17/50"
  },
  evidence: {
    surface_color: createEvidenceField({
      value: "Gold",
      status: "CONFIRMED",
      confidence: 0.9
    }),
    parallel_family: createEvidenceField({
      value: "Sparkle",
      status: "REVIEW",
      confidence: 0.8
    }),
    serial_number: createEvidenceField({
      value: "17/50",
      status: "CONFIRMED",
      confidence: 0.92
    })
  }
});
const releaseVariantTokens = colorWithReviewDescriptor.modules.release_variant.tokens;
const printFinishTokens = colorWithReviewDescriptor.modules.print_finish.tokens;
assert.equal(colorWithReviewDescriptor.modules.release_variant.text, "");
assert.equal(colorWithReviewDescriptor.modules.print_finish.text, "Gold Sparkle");
assert.match(colorWithReviewDescriptor.final_title, /Gold Sparkle/);
assert.deepEqual(releaseVariantTokens.map((token) => token.text), []);
assert.deepEqual(printFinishTokens.map((token) => token.text), ["Gold", "Sparkle"]);
assert.equal(printFinishTokens.find((token) => token.text === "Gold").requires_review, false);
assert.equal(printFinishTokens.find((token) => token.text === "Sparkle").requires_review, true);
assert.doesNotMatch(colorWithReviewDescriptor.final_title, /17\/50|#\/50/);

const explicitNumericalRarity = renderListingPresentation({
  resolved: {
    year: "2024-25",
    brand: "Panini",
    product: "Immaculate Collection",
    players: ["Anthony Edwards"],
    card_type: "Patch Auto",
    numerical_rarity: "2/3",
    grade_company: "BGS",
    card_grade: "8.5",
    auto_grade: "10",
    grade_type: "CARD_AND_AUTO"
  }
});
assert.match(explicitNumericalRarity.final_title, /2\/3/);
assert.match(explicitNumericalRarity.final_title, /BGS 8\.5\/10/);

const smartCollapsedProductHierarchy = renderListingPresentation({
  resolved: {
    manufacturer: "Panini",
    product: "Panini Prizm Black",
    set: "Panini Prizm Black FOTL",
    players: ["Test Player"]
  }
});
assert.match(smartCollapsedProductHierarchy.final_title, /Panini Prizm Black Test Player/);
assert.doesNotMatch(smartCollapsedProductHierarchy.final_title, /Panini Panini|FOTL/);

const manufacturerAlreadyInProductIsNotRepeated = renderListingPresentation({
  resolved: {
    year: "2020",
    manufacturer: "Panini",
    brand: "Panini P & P",
    product: "2020 Panini Plates & Patches Football",
    set: "Plates & Patches",
    players: ["Justin Herbert"],
    card_name: "Rookie Patch Autographs",
    numerical_rarity: "30/99",
    rc: true,
    auto: true,
    patch: true
  }
});
assert.match(manufacturerAlreadyInProductIsNotRepeated.final_title, /Panini Plates & Patches/);
assert.doesNotMatch(manufacturerAlreadyInProductIsNotRepeated.final_title, /Panini Panini/);

const uncertainObservationDoesNotBecomePublishedIdentity = renderListingPresentation({
  resolved: {
    year: "2015-16",
    manufacturer: "Panini",
    product: "Panini Flawless Soccer",
    set: "Flawless Soccer",
    subset: "Perfect? (visible partial wording)",
    players: ["Cristiano Ronaldo"],
    card_name: "Patch Perfect? Signature",
    numerical_rarity: "04/25",
    auto: true,
    patch: true
  }
});
assert.match(uncertainObservationDoesNotBecomePublishedIdentity.final_title, /Patch Auto/);
assert.doesNotMatch(uncertainObservationDoesNotBecomePublishedIdentity.final_title, /Perfect|\?/);

const sapphireConfigurationIsComposedWithProduct = renderListingPresentation({
  resolved: {
    year: "2020-21",
    manufacturer: "Topps",
    brand: "Topps Chrome",
    product: "2020-21 Topps Chrome UCL",
    players: ["Jude Bellingham"],
    parallel_exact: "Sapphire Ed - Green",
    surface_color: "Green",
    numerical_rarity: "27/75",
    rc: true
  }
});
assert.match(sapphireConfigurationIsComposedWithProduct.final_title, /Topps Chrome UCL Sapphire/);
assert.match(sapphireConfigurationIsComposedWithProduct.final_title, /\bGreen\b/);
assert.doesNotMatch(sapphireConfigurationIsComposedWithProduct.final_title, /Ed\s*-/);

const bowmanOwnedByToppsButOutputAsBowman = renderListingPresentation({
  resolved: {
    year: "2024",
    manufacturer: "Topps",
    brand: "Bowman",
    product: "Bowman Chrome",
    players: ["Yoshinobu Yamamoto"],
    card_name: "Rookie Auto-Gold Refractor",
    surface_color: "Gold",
    serial_number: "22/50",
    numerical_rarity: "22/50",
    rc: true,
    auto: true,
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  }
});
assert.equal(bowmanOwnedByToppsButOutputAsBowman.final_title, "2024 Bowman Chrome Yoshinobu Yamamoto Rookie Auto Gold Refractor 22/50 RC PSA 10");
assert.equal(bowmanOwnedByToppsButOutputAsBowman.final_title.length, 80);
assert.doesNotMatch(bowmanOwnedByToppsButOutputAsBowman.final_title, /Topps Bowman/);

const bowmanOwnedByToppsWithoutBrandStillOutputsAsBowman = renderListingPresentation({
  resolved: {
    year: "2024",
    manufacturer: "Topps",
    product: "Bowman Chrome",
    players: ["Yoshinobu Yamamoto"],
    card_name: "Rookie Auto-Gold Refractor",
    surface_color: "Gold",
    serial_number: "22/50",
    numerical_rarity: "22/50",
    rc: true,
    auto: true,
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  }
});
assert.equal(bowmanOwnedByToppsWithoutBrandStillOutputsAsBowman.final_title, "2024 Bowman Chrome Yoshinobu Yamamoto Rookie Auto Gold Refractor 22/50 RC PSA 10");
assert.equal(bowmanOwnedByToppsWithoutBrandStillOutputsAsBowman.final_title.length, 80);
assert.doesNotMatch(bowmanOwnedByToppsWithoutBrandStillOutputsAsBowman.final_title, /Topps Bowman/);

const smartComposedCardVariantFinish = renderListingPresentation({
  resolved: {
    year: "2024",
    manufacturer: "Topps",
    product: "Chrome",
    players: ["Test Player"],
    card_name: "Gold Refractor Autograph",
    variation: "Variation",
    surface_color: "Gold",
    auto: true
  }
});
assert.match(smartComposedCardVariantFinish.final_title, /Gold Refractor Auto Variation/);
assert.equal((smartComposedCardVariantFinish.final_title.match(/\bGold\b/g) || []).length, 1);

const tcgMasterBallStress = renderListingPresentation({
  resolved: {
    year: "2023",
    category: "Pokemon TCG",
    language: "JP",
    product: "Scarlet & Violet",
    set: "Pokemon 151",
    players: ["Charizard ex"],
    card_name: "Charizard ex",
    collector_number: "201/165",
    rarity: "SAR",
    parallel_exact: "Master Ball Reverse Holo",
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  maxLength: 80
});
assert.equal(
  tcgMasterBallStress.final_title,
  "2023 Japanese Pokemon 151 Charizard ex SAR Master Ball Reverse Holo PSA 10"
);
assert.doesNotMatch(tcgMasterBallStress.final_title, /201\/165/);
assert.equal(tcgMasterBallStress.final_title.length <= 80, true);

const tcgPikachuIllustratorStress = renderListingPresentation({
  resolved: {
    year: "1998",
    category: "Pokemon TCG",
    language: "JP",
    product: "Promo",
    set: "CoroCoro Comic Illustration Contest",
    players: ["Pikachu"],
    card_name: "Illustrator",
    rarity: "Promo / Prize Card",
    insert: "Illustrator / CoroCoro",
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  maxLength: 80
});
assert.equal(
  tcgPikachuIllustratorStress.final_title,
  "1998 Japanese Pokemon CoroCoro Promo Pikachu Illustrator PSA 10"
);
assert.doesNotMatch(tcgPikachuIllustratorStress.final_title, /Pikachu Illustrator Pikachu|Promo Promo/);

const tcgGhostRareStress = renderListingPresentation({
  resolved: {
    year: "2007",
    category: "Yu-Gi-Oh! TCG",
    language: "EN",
    manufacturer: "Konami",
    product: "Tactical Evolution",
    set: "Tactical Evolution",
    players: ["Rainbow Dragon"],
    card_name: "Rainbow Dragon",
    collector_number: "TAEV-EN006",
    rarity: "Ghost Rare",
    parallel_exact: "Ghost Rare",
    first_bowman: true,
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  maxLength: 80
});
assert.equal(
  tcgGhostRareStress.final_title,
  "2007 Yu-Gi-Oh! Tactical Evolution Rainbow Dragon Ghost Rare 1st Edition PSA 10"
);
assert.doesNotMatch(tcgGhostRareStress.final_title, /TAEV-EN006|English/);

const bowmanLongDescriptorKeepsGrade = renderListingPresentation({
  resolved: {
    year: "2018",
    manufacturer: "Topps",
    brand: "Bowman",
    product: "Bowman Chrome",
    players: ["Yordan Alvarez"],
    insert: "Prospect Autographs Gold Shimmer Refractors",
    surface_color: "Gold",
    collector_number: "CPAYA",
    rc: true,
    auto: true,
    grade_company: "BGS",
    card_grade: "9.5",
    auto_grade: "10",
    grade_type: "CARD_AND_AUTO"
  },
  maxLength: 80
});
assert.ok(bowmanLongDescriptorKeepsGrade.final_title.length <= 80);
assert.match(bowmanLongDescriptorKeepsGrade.final_title, /BGS 9\.5\/10/);
assert.match(bowmanLongDescriptorKeepsGrade.final_title, /\bAuto\b/);
assert.match(bowmanLongDescriptorKeepsGrade.final_title, /Gold/i);
assert.doesNotMatch(bowmanLongDescriptorKeepsGrade.final_title, /Autographs/i);

const firstBowmanEvidenceBeatsGenericRc = renderListingPresentation({
  resolved: {
    year: "2018",
    manufacturer: "Topps",
    brand: "Bowman",
    product: "Bowman Chrome",
    players: ["Yordan Alvarez"],
    rc: true,
    auto: true
  },
  evidence: {
    rc: createEvidenceField({
      value: true,
      status: "CONFIRMED",
      confidence: 0.95,
      sources: [{ source_type: "CARD_FRONT", observed_text: "1ST BOWMAN" }]
    })
  },
  maxLength: 80
});
assert.match(firstBowmanEvidenceBeatsGenericRc.final_title, /1st Bowman/i);
assert.doesNotMatch(firstBowmanEvidenceBeatsGenericRc.final_title, /\bRC\b/);

const patchAutoAbbreviationCompose = renderListingPresentation({
  resolved: {
    year: "2023",
    manufacturer: "Panini",
    product: "Panini Flawless Basketball",
    players: ["Amen Thompson"],
    card_name: "HOR PAT AUTO GOLD",
    surface_color: "Gold",
    serial_number: "05/10",
    numerical_rarity: "05/10",
    collector_number: "HPA-ATH",
    rc: true,
    auto: true,
    patch: true,
    grade_company: "PSA",
    card_grade: "9",
    auto_grade: "10",
    grade_type: "CARD_AND_AUTO"
  },
  maxLength: 80
});
assert.ok(patchAutoAbbreviationCompose.final_title.length <= 80);
assert.match(patchAutoAbbreviationCompose.final_title, /Patch Auto Gold/);
assert.match(patchAutoAbbreviationCompose.final_title, /PSA 9\/10/);
assert.doesNotMatch(patchAutoAbbreviationCompose.final_title, /\b(?:HOR|PAT)\b|Patch Auto .*Patch Auto/i);

const bowmanChromeProspectsKeepsDifferentiatingCardName = renderListingPresentation({
  resolved: {
    year: "2025",
    manufacturer: "Topps",
    brand: "Bowman",
    product: "Bowman Chrome",
    set: "Bowman Chrome Prospects",
    players: ["Jhonkensy Noel"],
    card_name: "Chrome Prospects Auto Orange Refractor",
    surface_color: "Orange",
    numerical_rarity: "24/25",
    grade_company: "PSA",
    card_grade: "9",
    grade_type: "CARD_ONLY"
  },
  maxLength: 80
});
assert.ok(bowmanChromeProspectsKeepsDifferentiatingCardName.final_title.length <= 80);
assert.match(bowmanChromeProspectsKeepsDifferentiatingCardName.final_title, /Bowman Chrome Prospects/);
assert.match(bowmanChromeProspectsKeepsDifferentiatingCardName.final_title, /Auto Orange Refractor/);
assert.match(bowmanChromeProspectsKeepsDifferentiatingCardName.final_title, /PSA 9$/);
assert.doesNotMatch(bowmanChromeProspectsKeepsDifferentiatingCardName.final_title, /Chrome Prospects.*Chrome Prospects/i);

const bowmanRefAbbreviationKeepsCardName = renderListingPresentation({
  resolved: {
    year: "2025",
    manufacturer: "Topps",
    brand: "Bowman",
    product: "Bowman Chrome",
    set: "Bowman Chrome Prospects",
    players: ["Aeverson Arteaga"],
    card_name: "Chrome Prospects Auto - Orange Ref.",
    surface_color: "Orange",
    numerical_rarity: "24/25",
    grade_company: "PSA",
    card_grade: "9",
    grade_type: "CARD_ONLY"
  },
  maxLength: 80
});
assert.ok(bowmanRefAbbreviationKeepsCardName.final_title.length <= 80);
assert.match(bowmanRefAbbreviationKeepsCardName.final_title, /Auto Orange Refractor/);
assert.match(bowmanRefAbbreviationKeepsCardName.final_title, /PSA 9$/);

const bowmanAtomicAutoCanonicalComposition = renderListingPresentation({
  resolved: {
    year: "2020",
    manufacturer: "Topps",
    brand: "Bowman",
    product: "2020 Bowman Chrome",
    players: ["Bobby Witt Jr."],
    card_name: "Prospects Autograph - Atomic Ref.",
    insert: "Prospects Autograph",
    surface_color: "Silver",
    print_run_number: "43/100",
    print_run_numerator: "43",
    print_run_denominator: "100",
    collector_number: "164",
    auto: true,
    grade_company: "PSA",
    card_grade: "9",
    auto_grade: "9",
    grade_type: "CARD_AND_AUTO",
    team: "Kansas City Royals"
  },
  maxLength: 80
});
assert.equal(
  bowmanAtomicAutoCanonicalComposition.final_title,
  "2020 Bowman Chrome Bobby Witt Jr. Auto Atomic Refractor 43/100 PSA 9"
);
assert.doesNotMatch(bowmanAtomicAutoCanonicalComposition.final_title, /Prospects Auto.*Prospects Auto|[-–—]|\.$/);
assert.deepEqual(
  bowmanAtomicAutoCanonicalComposition.title_length_policy.retained_required_terms,
  ["2020", "Bowman Chrome", "Bobby Witt Jr.", "Auto Atomic Refractor", "43/100", "PSA 9"]
);

const rookieSignaturesSurvivesCardNumberCompression = renderListingPresentation({
  resolved: {
    year: "2018-19",
    manufacturer: "Panini",
    product: "Panini Prizm",
    set: "Rookie Signatures Prizms Silver",
    players: ["Jaren Jackson Jr"],
    card_name: "Rookie Signatures Prizms Silver",
    collector_number: "4",
    auto: true,
    grade_company: "BGS",
    card_grade: "9",
    auto_grade: "10",
    grade_type: "CARD_AND_AUTO"
  },
  maxLength: 80
});
assert.ok(rookieSignaturesSurvivesCardNumberCompression.final_title.length <= 80);
assert.match(rookieSignaturesSurvivesCardNumberCompression.final_title, /Rookie Signatures/);
assert.match(rookieSignaturesSurvivesCardNumberCompression.final_title, /Silver/);
assert.match(rookieSignaturesSurvivesCardNumberCompression.final_title, /BGS 9\/10$/);

const standardLotGrammar = renderResolvedTitle({
  multi_card: true,
  card_count: 12,
  year: "2024",
  manufacturer: "Panini",
  product: "Prizm",
  players: ["Anthony Edwards", "Victor Wembanyama", "Stephen Curry", "LeBron James"],
  lot_type: "rookie insert lot",
  rc: true
}, {
  maxLength: 80
});
assert.equal(
  standardLotGrammar.rendered_title,
  "Lot x12 2024 Panini Prizm Anthony Edwards / Victor Wembanyama / Stephen Curry RC"
);
assert.ok(standardLotGrammar.rendered_title.length <= 80);
assert.doesNotMatch(standardLotGrammar.rendered_title, /LeBron James/);

const subjectPrefixRemovedFromCardName = renderResolvedTitle({
  year: "2024",
  manufacturer: "Topps",
  product: "Topps Dynasty",
  players: ["Yoshinobu Yamamoto"],
  card_name: "Yamamoto Patch Auto",
  auto: true,
  patch: true,
  print_run_number: "05/10",
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 80
});
assert.match(subjectPrefixRemovedFromCardName.rendered_title, /Yoshinobu Yamamoto Patch Auto/);
assert.doesNotMatch(subjectPrefixRemovedFromCardName.rendered_title, /Yamamoto Yamamoto/i);
assert.match(subjectPrefixRemovedFromCardName.rendered_title, /05\/10/);

const englishMarketplaceSpelling = renderResolvedTitle({
  year: "2015-16",
  manufacturer: "Panini",
  product: "Flawless",
  players: ["Pele"],
  card_name: "Legendary Signatures",
  team: "Brasil",
  auto: true,
  print_run_number: "20/25"
}, {
  maxLength: 80
});
assert.match(englishMarketplaceSpelling.rendered_title, /Brazil/);
assert.doesNotMatch(englishMarketplaceSpelling.rendered_title, /Brasil/);

const gpt5CodeLeakageCleaned = renderResolvedTitle({
  year: "2025",
  manufacturer: "Bowman",
  product: "Bowman Draft",
  players: ["Seth Hernandez"],
  card_name: "BWM PROS MEGA AU-BLACK Refractor",
  surface_color: "Black",
  auto: true,
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 80
});
assert.match(gpt5CodeLeakageCleaned.rendered_title, /Auto Black Refractor/);
assert.doesNotMatch(gpt5CodeLeakageCleaned.rendered_title, /\bBWM\b|\bPROS\b|\bMEGA\b|\bAU-BLACK\b/i);

const chromeAbbreviationExpanded = renderResolvedTitle({
  year: "2018",
  manufacturer: "Topps",
  product: "Topps Chrome",
  players: ["Shohei Ohtani"],
  card_name: "Chr. Promo",
  surface_color: "Gold",
  rc: true,
  grade_company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
}, {
  maxLength: 80
});
assert.match(chromeAbbreviationExpanded.rendered_title, /Chrome Promo/);
assert.doesNotMatch(chromeAbbreviationExpanded.rendered_title, /\bChr\./);

console.log("renderer tests passed");
