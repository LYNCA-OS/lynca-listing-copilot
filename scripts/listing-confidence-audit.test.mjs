import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-copilot-title.js";
import { resolveKnowledgeEntry } from "../lib/listing-knowledge-registry.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.OPENAI_API_KEY = "test-key";
process.env.OPENAI_LISTING_MODEL = "test-model";

assert.equal(resolveKnowledgeEntry("SE-28")?.label, "Shadow Etch");
assert.equal(resolveKnowledgeEntry("2010/11 Season"), null);
assert.equal(resolveKnowledgeEntry("Kaboom!")?.label, "Kaboom");
assert.equal(resolveKnowledgeEntry("Helix")?.label, "Helix");
assert.equal(resolveKnowledgeEntry("Explosive")?.label, "Explosive");
assert.equal(resolveKnowledgeEntry("Green Geometric Refractor")?.label, "Green Geometric Refractor");
assert.equal(resolveKnowledgeEntry("Keepsake Premiere Edition")?.label, "Keapsake Premiere Edition");
assert.equal(resolveKnowledgeEntry("Super Short Print")?.label, "SSP");

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
}

async function callApi(openAiResult, options = {}) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify(openAiResult) })
  });

  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionCookie() };

  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };

  const promise = handler(req, res);
  req.emit("data", JSON.stringify({
    assetId: "asset-test",
    mode: "single",
    images: [{ name: "card.webp", dataUrl: "data:image/webp;base64,AAAA" }],
    resolutionMap: {},
    maxTitleLength: options.maxTitleLength || 80
  }));
  req.emit("end");
  await promise;

  return JSON.parse(res.body);
}

const serialVisibleUncertainParallel = await callApi({
  title: "2025 Topps Chrome Quinshon Judkins RC Purple 130/175",
  confidence: "HIGH",
  reason: "Serial visible and preserved; exact parallel requires operator review from visual foil.",
  fields: {
    year: "2025",
    brand: "Topps Chrome",
    player: "Quinshon Judkins",
    subset: "RC",
    parallel: "Purple Wave Refractor",
    serial_number: "130/175"
  },
  unresolved: ["exact parallel requires operator review"]
});

assert.equal(serialVisibleUncertainParallel.confidence, "MEDIUM");
assert.match(serialVisibleUncertainParallel.title, /130\/175/);

const backgroundIgnored = await callApi({
  title: "Metaverse Cards 2024 Topps Chrome Shohei Ohtani",
  confidence: "HIGH",
  reason: "Metaverse Cards surface text appears above the card; card text supports player.",
  fields: {
    year: "2024",
    brand: "Metaverse Cards",
    player: "Shohei Ohtani",
    product: "Topps Chrome"
  },
  unresolved: []
});

assert.doesNotMatch(backgroundIgnored.title, /Metaverse Cards/i);
assert.notEqual(backgroundIgnored.fields.brand, "Metaverse Cards");
assert.doesNotMatch(backgroundIgnored.reason, /Metaverse Cards/i);
assert.match(backgroundIgnored.reason, /Background branding ignored/i);

const clearPsaLabel = await callApi({
  title: "PSA 10 2024 Topps Chrome Shohei Ohtani",
  confidence: "HIGH",
  reason: "PSA label explicitly supports player, year, product, and grade.",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Shohei Ohtani",
    grade_company: "PSA",
    grade: "Gem Mint 10"
  },
  unresolved: []
});

assert.equal(clearPsaLabel.confidence, "HIGH");
assert.equal(clearPsaLabel.title, "2024 Topps Chrome Shohei Ohtani PSA 10");

const visuallyGuessedParallel = await callApi({
  title: "2025 Bowman Chrome Test Player Fuchsia Wave Auto 137/199",
  confidence: "HIGH",
  reason: "Player and serial are visible; Fuchsia Wave is visually guessed from foil alone.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    parallel: "Fuchsia Wave",
    auto: true,
    serial_number: "137/199"
  },
  unresolved: []
});

assert.equal(visuallyGuessedParallel.confidence, "MEDIUM");

const missingVisibleSerial = await callApi({
  title: "2025 Bowman Chrome Test Player Fuchsia Wave Auto",
  confidence: "HIGH",
  reason: "Card text explicitly supports player and auto; serial is visible.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    parallel: "Fuchsia Wave",
    auto: true,
    serial_number: "137/199"
  },
  unresolved: []
});

assert.equal(missingVisibleSerial.confidence, "LOW");
assert.match(missingVisibleSerial.unresolved.join(" "), /title missing serial/);

const localizedTrainerIllustrator = await callApi({
  title: "2026 Pokemon Scarlet Violet 257/208 SAR En Morikura Trainer Card",
  confidence: "HIGH",
  reason: "Chinese Pokemon Trainer card; Illus. En Morikura is visible.",
  fields: {
    brand: "Pokemon TCG",
    product: "Pokemon Scarlet Violet",
    character: "琉琪亚的展现",
    set: "SV9C",
    subset: "SAR",
    card_number: "257/208",
    artist: "En Morikura"
  },
  unresolved: ["localized trainer identity requires operator review"]
});

assert.doesNotMatch(localizedTrainerIllustrator.title, /En Morikura/i);
assert.match(localizedTrainerIllustrator.title, /琉琪亚的展现/);
assert.match(localizedTrainerIllustrator.title, /257\/208/);
assert.match(localizedTrainerIllustrator.title, /SAR/);
assert.match(localizedTrainerIllustrator.title, /SV9C/);
assert.equal(localizedTrainerIllustrator.confidence, "MEDIUM");
assert.match(localizedTrainerIllustrator.reason, /Illustrator is metadata only/i);

const visibleKaboomPreserved = await callApi({
  title: "2023 Panini Prizm Victor Wembanyama Kaboom RC",
  confidence: "MEDIUM",
  reason: "Card text explicitly shows Kaboom insert; title preserves the high-value insert name.",
  fields: {
    year: "2023",
    brand: "Panini Prizm",
    player: "Victor Wembanyama",
    subset: "RC",
    insert: "Kaboom"
  },
  unresolved: ["exact checklist taxonomy requires operator review"]
});

assert.match(visibleKaboomPreserved.title, /Kaboom/i);
assert.equal(visibleKaboomPreserved.fields.insert, "Kaboom");

const visibleUltravioletPreserved = await callApi({
  title: "2024 Panini Select Caitlin Clark Ultraviolet RC",
  confidence: "MEDIUM",
  reason: "Back text explicitly supports Ultraviolet insert; title preserves the insert.",
  fields: {
    year: "2024",
    brand: "Panini Select",
    player: "Caitlin Clark",
    subset: "RC",
    insert: "Ultraviolet"
  },
  unresolved: []
});

assert.match(visibleUltravioletPreserved.title, /Ultraviolet/i);
assert.equal(visibleUltravioletPreserved.fields.insert, "Ultraviolet");

const missingHighValueInsert = await callApi({
  title: "2024 Panini Donruss Anthony Edwards",
  confidence: "HIGH",
  reason: "Card text explicitly shows Downtown insert.",
  fields: {
    year: "2024",
    brand: "Panini Donruss",
    player: "Anthony Edwards",
    insert: "Downtown"
  },
  unresolved: []
});

assert.equal(missingHighValueInsert.confidence, "HIGH");
assert.match(missingHighValueInsert.title, /Downtown/i);

const insertNotParallel = await callApi({
  title: "2023 Panini Prizm Lionel Messi Kaboom",
  confidence: "HIGH",
  reason: "Card text explicitly supports Kaboom insert.",
  fields: {
    year: "2023",
    brand: "Panini Prizm",
    player: "Lionel Messi",
    parallel: "Kaboom"
  },
  unresolved: []
});

assert.equal(insertNotParallel.fields.insert, "Kaboom");
assert.equal(insertNotParallel.fields.parallel, null);

const ultravioletCodeResolved = await callApi({
  title: "2024 Panini Select Anthony Edwards",
  confidence: "HIGH",
  reason: "Card number UV-16 is visible on the back.",
  fields: {
    year: "2024",
    brand: "Panini Select",
    player: "Anthony Edwards",
    card_number: "UV-16"
  },
  unresolved: []
});

assert.equal(ultravioletCodeResolved.fields.insert, "Ultraviolet");
assert.match(ultravioletCodeResolved.title, /Ultraviolet/i);
assert.notEqual(ultravioletCodeResolved.confidence, "LOW");

const imperialInkCodeResolved = await callApi({
  title: "2024 Topps Chrome Ohtani Auto",
  confidence: "HIGH",
  reason: "Back text and card code IMP-OTI are visible.",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Shohei Ohtani",
    card_number: "IMP-OTI",
    auto: true
  },
  unresolved: []
});

assert.equal(imperialInkCodeResolved.fields.insert, "Imperial Ink");
assert.match(imperialInkCodeResolved.title, /Imperial Ink/i);
assert.doesNotMatch(imperialInkCodeResolved.fields.parallel || "", /Imperial Ink/i);

const rookieRefreshCodeResolved = await callApi({
  title: "2025 Bowman Chrome Cooper Flagg RC",
  confidence: "HIGH",
  reason: "Card code BRR-1 is printed on the back.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Cooper Flagg",
    subset: "RC",
    card_number: "BRR-1"
  },
  unresolved: []
});

assert.equal(rookieRefreshCodeResolved.fields.insert, "Bowman Rookie Refresh");
assert.match(rookieRefreshCodeResolved.title, /Bowman Rookie Refresh/i);
assert.notEqual(rookieRefreshCodeResolved.confidence, "LOW");

const clearDarkraiPsaLabel = await callApi({
  title: "PSA 10 Pokemon Darkrai Holo",
  confidence: "HIGH",
  reason: "PSA label explicitly supports Pokemon subject and grade.",
  fields: {
    brand: "Pokemon",
    character: "Darkrai",
    parallel: "Holo",
    grade_company: "PSA",
    grade: "Gem Mint 10"
  },
  unresolved: []
});

assert.equal(clearDarkraiPsaLabel.confidence, "HIGH");
assert.equal(clearDarkraiPsaLabel.title, "Pokemon Darkrai Holo PSA 10");

const oneOfOneWithUncertainParallel = await callApi({
  title: "2024 Topps Chrome Michael Jackson Green Refractor 01/01",
  confidence: "HIGH",
  reason: "Card text supports subject and serial; exact geometric parallel requires review.",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Michael Jackson",
    parallel: "Green Geometric",
    serial_number: "01/01",
    one_of_one: true
  },
  unresolved: ["exact parallel requires operator review"]
});

assert.equal(oneOfOneWithUncertainParallel.confidence, "MEDIUM");
assert.notEqual(oneOfOneWithUncertainParallel.confidence, "LOW");
assert.match(oneOfOneWithUncertainParallel.title, /01\/01/);

const dualPairingPreserved = await callApi({
  title: "2024 Topps Chrome Charles Leclerc Lewis Hamilton Power Partnership",
  confidence: "HIGH",
  reason: "Card text explicitly supports both subjects and Power Partnership insert.",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Charles Leclerc / Lewis Hamilton",
    insert: "Power Partnership"
  },
  unresolved: []
});

assert.match(dualPairingPreserved.title, /Charles Leclerc/i);
assert.match(dualPairingPreserved.title, /Lewis Hamilton/i);
assert.match(dualPairingPreserved.title, /Power Partnership/i);
assert.notEqual(dualPairingPreserved.confidence, "LOW");

const clearBowmanFirstAutoSerial = await callApi({
  title: "2025 Bowman Chrome Test Player 1st Bowman Auto 137/199",
  confidence: "HIGH",
  reason: "Card text explicitly supports player, year, product, 1st Bowman auto, and serial.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    subset: "1st Bowman",
    auto: true,
    serial_number: "137/199"
  },
  unresolved: []
});

assert.equal(clearBowmanFirstAutoSerial.confidence, "HIGH");
assert.match(clearBowmanFirstAutoSerial.title, /137\/199/);

const redundantTitleCleaned = await callApi({
  title: "2025 Bowman Chrome Test Player Rookie RC Card Autograph Auto Refractor Parallel",
  confidence: "MEDIUM",
  reason: "Card text supports player and auto; generic wording needs cleanup.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    subset: "RC",
    auto: true,
    parallel: "Refractor"
  },
  unresolved: []
});

assert.doesNotMatch(redundantTitleCleaned.title, /Rookie RC/i);
assert.doesNotMatch(redundantTitleCleaned.title, /Autograph Auto/i);
assert.doesNotMatch(redundantTitleCleaned.title, /Refractor Parallel/i);

const ratedRookieNormalized = await callApi({
  title: "2024 Donruss Football Test Player Rated Rookie Card",
  confidence: "HIGH",
  reason: "Card text explicitly supports Rated Rookie player and product.",
  fields: {
    year: "2024",
    brand: "Donruss Football",
    player: "Test Player",
    subset: "Rated Rookie"
  },
  unresolved: []
});

assert.match(ratedRookieNormalized.title, /Test Player RC/);
assert.doesNotMatch(ratedRookieNormalized.title, /Rated Rookie|Rookie Card|Rookie\b/i);
assert.equal(ratedRookieNormalized.fields.subset, "RC");

const missingVisibleRc = await callApi({
  title: "2024 Donruss Football Test Player",
  confidence: "HIGH",
  reason: "Card text explicitly supports Rated Rookie player and product.",
  fields: {
    year: "2024",
    brand: "Donruss Football",
    player: "Test Player",
    subset: "Rated Rookie"
  },
  unresolved: []
});

assert.equal(missingVisibleRc.confidence, "LOW");
assert.match(missingVisibleRc.unresolved.join(" "), /title missing rookie\/1st/);

const autographNormalized = await callApi({
  title: "2025 Topps Chrome Mike Trout Autograph",
  confidence: "HIGH",
  reason: "Card text explicitly supports Mike Trout autograph.",
  fields: {
    year: "2025",
    brand: "Topps Chrome",
    player: "Mike Trout",
    auto: true
  },
  unresolved: []
});

assert.match(autographNormalized.title, /Mike Trout Auto/);
assert.doesNotMatch(autographNormalized.title, /Autograph/i);

const dualAutographNormalized = await callApi({
  title: "2025 Topps Chrome Mike Trout Shohei Ohtani Dual Autograph",
  confidence: "HIGH",
  reason: "Card text explicitly supports dual autograph.",
  fields: {
    year: "2025",
    brand: "Topps Chrome",
    player: "Mike Trout / Shohei Ohtani",
    auto: true
  },
  unresolved: []
});

assert.match(dualAutographNormalized.title, /Dual Auto/);
assert.doesNotMatch(dualAutographNormalized.title, /Autograph/i);

const tripleAutographNormalized = await callApi({
  title: "2025 Topps Chrome Test Player Triple Autograph",
  confidence: "HIGH",
  reason: "Card text explicitly supports triple autograph.",
  fields: {
    year: "2025",
    brand: "Topps Chrome",
    player: "Test Player",
    auto: true
  },
  unresolved: []
});

assert.match(tripleAutographNormalized.title, /Triple Auto/);
assert.doesNotMatch(tripleAutographNormalized.title, /Autograph/i);

const certifiedAutographNormalized = await callApi({
  title: "2025 Bowman Chrome Test Player 1st Bowman Certified Autograph",
  confidence: "HIGH",
  reason: "Card text explicitly supports certified autograph.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    subset: "1st Bowman",
    auto: true
  },
  unresolved: []
});

assert.match(certifiedAutographNormalized.title, /1st Bowman Auto/);
assert.doesNotMatch(certifiedAutographNormalized.title, /Certified Autograph|Autograph/i);

const onCardAutographNormalized = await callApi({
  title: "2025 Topps Chrome Test Player On-card Autograph",
  confidence: "HIGH",
  reason: "Reasoning may mention on-card autograph detail.",
  fields: {
    year: "2025",
    brand: "Topps Chrome",
    player: "Test Player",
    auto: true
  },
  unresolved: []
});

assert.match(onCardAutographNormalized.title, /Test Player Auto/);
assert.doesNotMatch(onCardAutographNormalized.title, /On-card Autograph|Autograph/i);

const stickerAutographNormalized = await callApi({
  title: "2025 Topps Chrome Test Player Sticker Autograph",
  confidence: "HIGH",
  reason: "Reasoning may mention sticker autograph detail.",
  fields: {
    year: "2025",
    brand: "Topps Chrome",
    player: "Test Player",
    auto: true
  },
  unresolved: []
});

assert.match(stickerAutographNormalized.title, /Test Player Auto/);
assert.doesNotMatch(stickerAutographNormalized.title, /Sticker Autograph|Autograph/i);

const cooperFlaggChromeRookieAuto = await callApi({
  title: "2025 Topps Chrome Cooper Flagg RC Auto PSA 9 Auto 10 #TCAR-CF",
  confidence: "HIGH",
  reason: "PSA label supports 2025 Topps Chrome Cooper Flagg Chrome Rookie Auto #TCAR-CF PSA 9 Auto 10.",
  fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Cooper Flagg",
    subset: "RC",
    card_number: "TCAR-CF",
    grade_company: "PSA",
    grade: "9",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(cooperFlaggChromeRookieAuto.title, /Chrome Rookie Auto/i);
assert.doesNotMatch(cooperFlaggChromeRookieAuto.title, /\bBase\b/i);
assert.match(cooperFlaggChromeRookieAuto.title, /PSA 9\/10/i);
assert.doesNotMatch(cooperFlaggChromeRookieAuto.title, /#?TCAR-CF/i);

const cooperFlaggSeasonPsaStandard = await callApi({
  title: "2025 Topps Chrome Cooper Flagg Chrome Rookie Auto PSA 10 MINT 9",
  confidence: "HIGH",
  reason: "Season product text supports 2025-26 Topps Chrome Basketball; PSA label shows card grade 10 and auto grade 9.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Cooper Flagg",
    insert: "Chrome Rookie Auto",
    card_number: "TCAR-CF",
    grade_company: "PSA",
    grade: "10",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(cooperFlaggSeasonPsaStandard.title, /^2025-26\b/);
assert.match(cooperFlaggSeasonPsaStandard.title, /Chrome Rookie Auto/i);
assert.match(cooperFlaggSeasonPsaStandard.title, /PSA 10\/9/i);
assert.doesNotMatch(cooperFlaggSeasonPsaStandard.title, /\b2025 Topps/i);
assert.doesNotMatch(cooperFlaggSeasonPsaStandard.title, /PSA 10 MINT 9|PSA 10 Auto 9/i);

const aceBaileyChecklistSuppressed = await callApi({
  title: "2025-26 Ace Bailey RC Auto Orange Refractor 31/150 Chrome Rookie Auto #TCAR-AB",
  confidence: "HIGH",
  reason: "Card text supports Chrome Rookie Auto, RC, orange refractor, autograph, and serial 31/150.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Ace Bailey",
    subset: "RC",
    insert: "Chrome Rookie Auto",
    parallel: "Orange Refractor",
    card_number: "TCAR-AB",
    serial_number: "31/150",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(aceBaileyChecklistSuppressed.title, /Topps Chrome/i);
assert.match(aceBaileyChecklistSuppressed.title, /Ace Bailey/i);
assert.match(aceBaileyChecklistSuppressed.title, /Chrome Rookie Auto/i);
assert.match(aceBaileyChecklistSuppressed.title, /31\/150/);
assert.doesNotMatch(aceBaileyChecklistSuppressed.title, /#?TCAR-AB/i);
assert.doesNotMatch(aceBaileyChecklistSuppressed.title, /#31\/150|Serial 31\/150|Numbered 31\/150/i);
assert.equal((aceBaileyChecklistSuppressed.title.match(/\bAuto\b/gi) || []).length, 1);

const aceBaileyChromeAutoOnce = await callApi({
  title: "2025-26 Chrome Ace Bailey RC Auto Gold Refractor 31/50 Chrome Auto",
  confidence: "HIGH",
  reason: "Card text supports 2025-26 Topps Chrome Basketball, Ace Bailey, Chrome Auto, Gold Refractor, and serial 31/50.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Ace Bailey",
    subset: "RC",
    insert: "Chrome Auto",
    parallel: "Gold Refractor",
    serial_number: "31/50",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(aceBaileyChromeAutoOnce.title, /^2025-26\b/);
assert.match(aceBaileyChromeAutoOnce.title, /Topps Chrome/i);
assert.match(aceBaileyChromeAutoOnce.title, /Chrome Auto/i);
assert.match(aceBaileyChromeAutoOnce.title, /Gold Refractor/i);
assert.match(aceBaileyChromeAutoOnce.title, /31\/50/);
assert.match(aceBaileyChromeAutoOnce.title, /\bRC\b/);
assert.equal((aceBaileyChromeAutoOnce.title.match(/\bAuto\b/gi) || []).length, 1);

const chromeAutographCardNormalized = await callApi({
  title: "2025 Topps Chrome Mike Trout Chrome Autograph Card",
  confidence: "HIGH",
  reason: "Card text explicitly supports Chrome Autograph Card.",
  fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Mike Trout",
    insert: "Chrome Auto",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(chromeAutographCardNormalized.title, /Chrome Auto/i);
assert.doesNotMatch(chromeAutographCardNormalized.title, /Autograph Card|Autograph/i);
assert.doesNotMatch(chromeAutographCardNormalized.title, /Topps Chrome Chrome Auto/i);

const curryRedPropulsion = await callApi({
  title: "2026 Topps Chrome Stephen Curry Golden State Warriors Propulsion 2/5",
  confidence: "HIGH",
  reason: "Back text supports 2025-26 Topps Cosmic Chrome Red Propulsion SSP serial 2/5.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Cosmic Chrome",
    player: "Stephen Curry",
    insert: "Red Propulsion",
    serial_number: "2/5"
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(curryRedPropulsion.title, /Cosmic Chrome/i);
assert.match(curryRedPropulsion.title, /Red Propulsion/i);
assert.match(curryRedPropulsion.title, /2\/5/);
assert.doesNotMatch(curryRedPropulsion.title, /^2026 Topps Chrome Stephen Curry/i);

const propulsionChecklistSuppressed = await callApi({
  title: "2026 Topps Chrome Propulsion Stephen Curry Golden State Warriors #2/5 #PRP-3",
  confidence: "HIGH",
  reason: "Card text supports Propulsion insert, Stephen Curry, and serial 2/5.",
  fields: {
    year: "2026",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Stephen Curry",
    team: "Golden State Warriors",
    insert: "Propulsion",
    card_number: "PRP-3",
    serial_number: "2/5"
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(propulsionChecklistSuppressed.title, /Propulsion/i);
assert.match(propulsionChecklistSuppressed.title, /Stephen Curry/i);
assert.match(propulsionChecklistSuppressed.title, /2\/5/);
assert.doesNotMatch(propulsionChecklistSuppressed.title, /#2\/5|Serial 2\/5|Numbered 2\/5/i);
assert.doesNotMatch(propulsionChecklistSuppressed.title, /#?PRP-3/i);

const seasonYearPreserved = await callApi({
  title: "2026 Topps Chrome Stephen Curry Red Propulsion SSP 2/5",
  confidence: "HIGH",
  reason: "Back text supports card-issued season 2025-26; grading label shorthand shows 2026.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Cosmic Chrome",
    player: "Stephen Curry",
    insert: "Red Propulsion",
    serial_number: "2/5"
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(seasonYearPreserved.title, /^2025-26/i);
assert.doesNotMatch(seasonYearPreserved.title, /^2026\b/i);

const immaculateDualSignatures = await callApi({
  title: "2015-16 Panini Immaculate Collection Shaquille O'Neal Anfernee Hardaway Dual 01/25",
  confidence: "HIGH",
  reason: "Slab text supports Dual Signatures Jersey No. #35 S. O'Neal / A. Hardaway 01/25.",
  fields: {
    year: "2015-16",
    brand: "Panini",
    product: "Immaculate Collection",
    player: "Shaquille O'Neal / Anfernee Hardaway",
    insert: "Dual Signatures Jersey No.",
    card_number: "35",
    serial_number: "01/25"
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(immaculateDualSignatures.title, /Dual Signatures/i);
assert.match(immaculateDualSignatures.title, /Dual Signatures Auto/i);
assert.match(immaculateDualSignatures.title, /Shaquille O'Neal/i);
assert.match(immaculateDualSignatures.title, /Anfernee Hardaway/i);
assert.match(immaculateDualSignatures.title, /01\/25/);
assert.doesNotMatch(immaculateDualSignatures.title, /#35/);
assert.doesNotMatch(immaculateDualSignatures.title, /Dual Auto/i);
assert.equal((immaculateDualSignatures.title.match(/\bAuto\b/gi) || []).length, 1);

const compressedSerialPreserved = await callApi({
  title: "2015-16 Panini Immaculate Collection Shaquille O'Neal Anfernee Hardaway Dual 01/25 #35",
  confidence: "HIGH",
  reason: "Slab text supports Dual Signatures Jersey No. #35 S. O'Neal / A. Hardaway 01/25.",
  fields: {
    year: "2015-16",
    brand: "Panini",
    product: "Immaculate Collection",
    player: "Shaquille O'Neal / Anfernee Hardaway",
    insert: "Dual Signatures Jersey No.",
    card_number: "35",
    serial_number: "01/25"
  },
  unresolved: []
}, { maxTitleLength: 80 });

assert.match(compressedSerialPreserved.title, /Dual Signatures/i);
assert.match(compressedSerialPreserved.title, /01\/25/);

const psaAuthAutoStandard = await callApi({
  title: "2024 Topps Chrome Test Player Auto PSA AUTH Auto 10",
  confidence: "HIGH",
  reason: "PSA label supports authentic card with auto grade 10.",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Test Player",
    grade_company: "PSA",
    grade: "AUTH",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(psaAuthAutoStandard.title, /PSA Auth\/10/);
assert.doesNotMatch(psaAuthAutoStandard.title, /PSA AUTH Auto 10|PSA Auth Auto 10/i);

const duoLogomanAutographs = await callApi({
  title: "2019-20 Panini Immaculate Collection PJ Washington Jr Tyler Herro Dual Auto One",
  confidence: "HIGH",
  reason: "Card text supports Duo Logoman Autographs with both players and One of One.",
  fields: {
    year: "2019-20",
    brand: "Panini",
    product: "Immaculate Collection",
    player: "PJ Washington Jr / Tyler Herro",
    insert: "Duo Logoman Autographs",
    auto: true,
    relic: true,
    one_of_one: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(duoLogomanAutographs.title, /Duo Logoman Autographs/i);
assert.match(duoLogomanAutographs.title, /PJ Washington Jr/i);
assert.match(duoLogomanAutographs.title, /Tyler Herro/i);
assert.match(duoLogomanAutographs.title, /1\/1/);
assert.doesNotMatch(duoLogomanAutographs.title, /\bOne\b/i);

const durantStarSwatch = await callApi({
  title: "2015-16 Panini Flawless Kevin Durant Thunder Patch Auto 04/10",
  confidence: "HIGH",
  reason: "Registry supports SR-KD as Star Swatch Signatures and checklist supports Platinum parallel.",
  fields: {
    year: "2015-16",
    brand: "Panini",
    product: "Flawless",
    player: "Kevin Durant",
    card_number: "SR-KD",
    parallel: "Platinum",
    serial_number: "04/10",
    auto: true,
    patch: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(durantStarSwatch.title, /Star Swatch Signatures/i);
assert.match(durantStarSwatch.title, /Platinum/i);
assert.match(durantStarSwatch.title, /04\/10/);
assert.doesNotMatch(durantStarSwatch.title, /Patch Auto/i);
assert.doesNotMatch(durantStarSwatch.title, /#?SR-KD/i);

const sspRegistryPreserved = await callApi({
  title: "2024 Topps Chrome Test Player Super Short Print",
  confidence: "HIGH",
  reason: "Card back explicitly states Super Short Print.",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Test Player",
    insert: "Super Short Print"
  },
  unresolved: []
});

assert.equal(sspRegistryPreserved.fields.insert, "SSP");
assert.match(sspRegistryPreserved.title, /SSP/);

console.log("listing confidence audit mock tests passed");
