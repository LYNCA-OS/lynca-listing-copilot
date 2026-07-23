import assert from "node:assert/strict";
import { __listingCopilotTitleTestHooks, runNativeV4Recognition } from "../lib/listing/v4/pipeline/native-recognition-core.mjs";
import { resolveKnowledgeEntry } from "../lib/listing-knowledge-registry.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.DEFAULT_VISION_PROVIDER = "openai_legacy";
process.env.ENABLE_OPENAI_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_OPENAI_RETRY = "true";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_LISTING_MODEL = "gpt-4.1-mini-2025-04-14";
process.env.ENABLE_OPENAI_WEB_SEARCH_FALLBACK = "false";

const catalogCacheKeyWithSingleSubject = __listingCopilotTitleTestHooks.catalogCandidateContextCacheKey({
  resolvedForRetrieval: {
    year: "2025-26",
    product: "Topps Finest",
    subject: "  Josh   Hart  "
  },
  excludeSourceFeedbackIds: [" feedback-current-card "]
});
const catalogCacheKeyWithNormalizedSubject = __listingCopilotTitleTestHooks.catalogCandidateContextCacheKey({
  resolvedForRetrieval: {
    year: "2025-26",
    product: "Topps Finest",
    subject: "Josh Hart"
  },
  excludeSourceFeedbackIds: ["feedback-current-card"]
});
assert.match(catalogCacheKeyWithSingleSubject, /^[a-f0-9]{64}$/);
assert.equal(catalogCacheKeyWithSingleSubject, catalogCacheKeyWithNormalizedSubject);
assert.notEqual(
  catalogCacheKeyWithSingleSubject,
  __listingCopilotTitleTestHooks.catalogCandidateContextCacheKey({
    resolvedForRetrieval: {
      year: "2025-26",
      product: "Topps Finest",
      subject: "Josh Hart"
    },
    excludeSourceFeedbackIds: ["another-seen-card"]
  }),
  "formal evaluation must not reuse a catalog cache entry created under another current-source exclusion scope"
);
assert.notEqual(
  catalogCacheKeyWithSingleSubject,
  __listingCopilotTitleTestHooks.catalogCandidateContextCacheKey({
    resolvedForRetrieval: {
      year: "2025-26",
      product: "Topps Finest",
      subject: "Josh Hart"
    }
  }),
  "formal evaluation must not reuse an unexcluded catalog cache entry"
);

assert.equal(resolveKnowledgeEntry("SE-28")?.label, "Shadow Etch");
assert.equal(resolveKnowledgeEntry("2010/11 Season"), null);
assert.equal(resolveKnowledgeEntry("Kaboom!")?.label, "Kaboom");
assert.equal(resolveKnowledgeEntry("Helix")?.label, "Helix");
assert.equal(resolveKnowledgeEntry("Explosive")?.label, "Explosive");
assert.equal(resolveKnowledgeEntry("Green Geometric Refractor")?.label, "Green Geometric Refractor");
assert.equal(resolveKnowledgeEntry("Keepsake Premiere Edition")?.label, "Keapsake Premiere Edition");
assert.equal(resolveKnowledgeEntry("Super Short Print")?.label, "SSP");

function directPrintedCodeEvidence(value, sourceType = "CARD_BACK_PRINTED_TEXT") {
  return {
    value,
    source_type: sourceType,
    visible_text: value,
    directly_observed: true,
    confidence: 0.96,
    review_required: false
  };
}

function withDirectAutoEvidenceForPresentationTest(providerResult = {}) {
  if (providerResult.fields?.auto !== true) return providerResult;
  const directAutoEvidence = {
    value: true,
    source_type: "CARD_FRONT_PRINTED_TEXT",
    source_image_id: "image-1",
    source_region: "card_text",
    visible_text: "AUTOGRAPH",
    directly_observed: true,
    direct_observation: true,
    review_required: false
  };
  if (providerResult.field_evidence && !Array.isArray(providerResult.field_evidence)) {
    if (providerResult.field_evidence.auto) return providerResult;
    return {
      ...providerResult,
      field_evidence: {
        ...providerResult.field_evidence,
        auto: directAutoEvidence
      }
    };
  }
  const entries = Array.isArray(providerResult.field_evidence) ? providerResult.field_evidence : [];
  if (entries.some((entry) => entry?.field === "auto")) return providerResult;
  return {
    ...providerResult,
    field_evidence: [
      ...entries,
      {
        field: "auto",
        ...directAutoEvidence
      }
    ]
  };
}

async function callApi(providerResult, options = {}) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "resp_listing_confidence_test",
      model: "gpt-4.1-mini-2025-04-14",
      output_text: JSON.stringify(withDirectAutoEvidenceForPresentationTest(providerResult)),
      usage: {
        input_tokens: 10,
        output_tokens: 8,
        total_tokens: 18
      }
    }),
    text: async () => ""
  });

  const response = await runNativeV4Recognition({
    payload: {
      tenant_id: "tenant_legacy",
      assetId: "asset-test",
      mode: "single",
      provider: "openai_legacy",
      explicitEmergency: true,
      images: [{ name: "card.webp", url: "https://example.test/card.webp" }],
      resolutionMap: {},
      maxTitleLength: options.maxTitleLength || 80
    }
  });
  return response.body;
}

const serialVisibleUncertainParallel = await callApi({
  title: "2025 Topps Chrome Quinshon Judkins RC Purple 130/175",
  confidence: "HIGH",
  reason: "Serial visible and preserved; exact parallel requires operator review from visual foil.",
    fields: {
      year: "2025",
      brand: "Topps",
      product: "Topps Chrome",
      player: "Quinshon Judkins",
    subset: "RC",
    parallel: "Purple Wave Refractor",
    serial_number: "130/175",
    numerical_rarity: "130/175"
  },
  unresolved: ["exact parallel requires operator review"]
});

assert.equal(serialVisibleUncertainParallel.confidence, "MEDIUM");
assert.match(serialVisibleUncertainParallel.title, /\/175/);
assert.doesNotMatch(serialVisibleUncertainParallel.title, /\bWave\b/i);
assert.ok(!serialVisibleUncertainParallel.fields.parallel);
assert.equal(
  serialVisibleUncertainParallel.resolved?.surface_color
    || serialVisibleUncertainParallel.resolved_fields?.surface_color
    || serialVisibleUncertainParallel.fields?.surface_color,
  "Purple"
);
assert.ok(serialVisibleUncertainParallel.unresolved.includes("parallel_exact"));

const explicitCurrentImageNumericalRarityPreserved = await callApi({
  title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto",
  confidence: "HIGH",
  reason: "The current card image directly shows serial 2/3 on the front and BGS 8.5/10 on the label.",
  fields: {
    year: "2024-25",
    manufacturer: "Panini",
    product: "Immaculate Collection",
    player: "Anthony Edwards",
    card_type: "Patch Auto",
    serial_number: "2/3",
    numerical_rarity: "2/3",
    grade_company: "BGS",
    card_grade: "8.5",
    auto_grade: "10",
    grade_type: "CARD_AND_AUTO"
  },
  unresolved: []
});

assert.equal(explicitCurrentImageNumericalRarityPreserved.resolved.serial_number, "2/3");
assert.equal(explicitCurrentImageNumericalRarityPreserved.resolved.numerical_rarity, "2/3");
assert.match(explicitCurrentImageNumericalRarityPreserved.title, /2\/3/);
assert.match(explicitCurrentImageNumericalRarityPreserved.title, /BGS 8\.5\/10/);

const providerFieldEvidenceArrayPreservesInstanceFields = await callApi({
  recognition_status: "CONFIRMED",
  fields: {
    year: "2018",
    manufacturer: "Topps",
    brand: "Bowman",
    product: "Bowman Chrome",
    players: ["Yordan Alvarez"],
    card_name: "Prospect Autographs Gold Shimmer Refractor",
    surface_color: "Gold",
    collector_number: "CPA",
    auto: true,
    grade_company: "BGS",
    card_grade: "10",
    auto_grade: "9.5",
    grade_type: "CARD_AND_AUTO"
  },
  field_evidence: [
    {
      field: "print_run_number",
      value: "09/50",
      source_type: "CARD_FRONT_PRINTED_TEXT",
      source_image_id: "front",
      source_region: "serial",
      raw_text: "09/50",
      visible_text: "09/50",
      evidence_kind: "PRINTED_SERIAL",
      confidence: 0.96,
      review_required: false,
      directly_observed: true,
      direct_observation: true
    },
    {
      field: "grade",
      value: "BGS 9.5 AUTO 10",
      source_type: "SLAB_LABEL",
      source_image_id: "front",
      source_region: "slab_label",
      raw_text: "BGS 9.5 AUTO 10",
      visible_text: "BGS 9.5 AUTO 10",
      evidence_kind: "SLAB_LABEL_TEXT",
      confidence: 0.95,
      review_required: false,
      directly_observed: true,
      direct_observation: true
    }
  ],
  unresolved: [],
  vector_candidate_decision: {
    selected_candidate_id: null,
    decision: "NOT_AVAILABLE",
    supported_fields: [],
    rejected_fields: [],
    conflicts: []
  }
});

assert.equal(providerFieldEvidenceArrayPreservesInstanceFields.resolved.numerical_rarity, "09/50");
assert.equal(providerFieldEvidenceArrayPreservesInstanceFields.resolved.card_grade, "9.5");
assert.equal(providerFieldEvidenceArrayPreservesInstanceFields.resolved.auto_grade, "10");
assert.match(providerFieldEvidenceArrayPreservesInstanceFields.title, /09\/50/);
assert.match(providerFieldEvidenceArrayPreservesInstanceFields.title, /BGS 9\.5\/10/);
assert.doesNotMatch(providerFieldEvidenceArrayPreservesInstanceFields.title, /#CPA|BGS 10\/9\.5/);

const serialNumberOnlyDoesNotBackfillNumericalRarity = await callApi({
  title: "2024-25 Panini Immaculate Anthony Edwards Patch Auto",
  confidence: "HIGH",
  reason: "The current card image shows a physical serial read, but the provider did not classify it as the title print-limit module.",
  fields: {
    year: "2024-25",
    manufacturer: "Panini",
    product: "Immaculate Collection",
    player: "Anthony Edwards",
    card_type: "Patch Auto",
    serial_number: "2/3",
    grade_company: "BGS",
    card_grade: "8.5",
    auto_grade: "10",
    grade_type: "CARD_AND_AUTO"
  },
  unresolved: ["numerical_rarity"]
});

assert.equal(serialNumberOnlyDoesNotBackfillNumericalRarity.resolved.serial_number, "2/3");
assert.equal(serialNumberOnlyDoesNotBackfillNumericalRarity.resolved.numerical_rarity, null);
// Directly read current-image serial backfills the print run in the TITLE
// (presentation only; resolved.numerical_rarity stays null). Catalog/reference
// candidates still cannot contribute the numerator.
assert.match(serialNumberOnlyDoesNotBackfillNumericalRarity.title, /2\/3/);
assert.doesNotMatch(serialNumberOnlyDoesNotBackfillNumericalRarity.title, /#\/3/);
assert.match(serialNumberOnlyDoesNotBackfillNumericalRarity.title, /BGS 8\.5\/10/);

const structuredEvidenceArrayBackfillsCriticalFields = await callApi({
  title: "",
  confidence: "HIGH",
  reason: "Provider kept critical direct reads in structured evidence only.",
  fields: {
    year: "2017",
    manufacturer: "Panini",
    product: "Origins",
    players: ["Patrick Mahomes II"],
    card_name: "Rookie Auto",
    auto: true
  },
  field_evidence: [
    {
      field: "print_run_number",
      value: "",
      source_type: "CARD_FRONT_PRINTED_TEXT",
      source_image_id: "front",
      source_region: "serial_number",
      raw_text: "02/10",
      visible_text: "02/10",
      evidence_kind: "PRINTED_LIMITED_NUMBERING",
      confidence: 0.94,
      review_required: false,
      directly_observed: true,
      direct_observation: true
    },
    {
      field: "grade",
      value: "",
      source_type: "SLAB_LABEL",
      source_image_id: "front",
      source_region: "grade_label",
      raw_text: "PSA MINT 9 AUTO 10",
      visible_text: "PSA MINT 9 AUTO 10",
      evidence_kind: "GRADE_LABEL",
      confidence: 0.94,
      review_required: false,
      directly_observed: true,
      direct_observation: true
    }
  ],
  unresolved: []
});

assert.match(structuredEvidenceArrayBackfillsCriticalFields.title, /02\/10/);
assert.match(structuredEvidenceArrayBackfillsCriticalFields.title, /PSA 9\/10/);
assert.equal(structuredEvidenceArrayBackfillsCriticalFields.resolved.print_run_number, "02/10");
assert.equal(structuredEvidenceArrayBackfillsCriticalFields.resolved.card_grade, "9");
assert.equal(structuredEvidenceArrayBackfillsCriticalFields.resolved.auto_grade, "10");

const booleanGradeCompanyRejected = await callApi({
  title: "2018-19 Panini Court Kings Trae Young Heir Apparent Autographs Sapphire TRUE 10",
  confidence: "HIGH",
  reason: "Provider confused a non-company token with a grading company.",
  fields: {
    year: "2018-19",
    manufacturer: "Panini",
    product: "Court Kings",
    player: "Trae Young",
    card_name: "Heir Apparent Autographs",
    parallel_exact: "Sapphire",
    grade_company: "true",
    card_grade: "10",
    grade_type: "CARD_ONLY",
    auto: true
  },
  unresolved: []
});
assert.equal(booleanGradeCompanyRejected.resolved.grade_company, null);
assert.doesNotMatch(booleanGradeCompanyRejected.title, /\bTRUE\s+10\b/i);
assert.doesNotMatch(booleanGradeCompanyRejected.rendered_fields?.modules?.grading?.text || "", /\bTRUE\b/i);

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
    brand: "Topps",
    product: "Topps Chrome",
    player: "Shohei Ohtani",
    grade_company: "PSA",
    grade: "Gem Mint 10"
  },
  unresolved: []
});

assert.equal(clearPsaLabel.confidence, "HIGH");
assert.equal(clearPsaLabel.title, "2024 Topps Chrome Shohei Ohtani PSA 10");
assert.equal(clearPsaLabel.resolved.year, "2024");
assert.deepEqual(clearPsaLabel.resolved.players, ["Shohei Ohtani"]);
assert.equal(clearPsaLabel.evidence.year.status, "CONFIRMED");
assert.equal(clearPsaLabel.evidence_schema_version, "evidence-fields-v1");
assert.ok(clearPsaLabel.route);
assert.ok(clearPsaLabel.retrieval);
assert.ok(Array.isArray(clearPsaLabel.completion_trace));
assert.ok(Array.isArray(clearPsaLabel.resolution_trace));

const visuallyGuessedParallel = await callApi({
  title: "2025 Bowman Chrome Test Player Fuchsia Wave Auto 137/199",
  confidence: "HIGH",
  reason: "Player and serial are visible; Fuchsia Wave is visually guessed from foil alone.",
    fields: {
      year: "2025",
      brand: "Bowman",
      product: "Bowman Chrome",
      player: "Test Player",
    parallel: "Fuchsia Wave",
    auto: true,
    serial_number: "137/199",
    numerical_rarity: "137/199"
  },
  field_evidence: [{
    field: "auto",
    value: true,
    source_type: "CARD_FRONT_PRINTED_TEXT",
    source_image_id: "image-1",
    source_region: "card_text",
    visible_text: "AUTOGRAPH",
    directly_observed: true,
    direct_observation: true,
    review_required: false
  }],
  unresolved: []
});

assert.equal(visuallyGuessedParallel.confidence, "MEDIUM");
assert.match(visuallyGuessedParallel.title, /137\/199/);
assert.doesNotMatch(visuallyGuessedParallel.title, /Fuchsia|Wave/i);

const numericalRarityRecovered = await callApi({
  title: "2025 Bowman Chrome Test Player Fuchsia Wave Auto",
  confidence: "HIGH",
  reason: "Card text explicitly supports player and auto; serial is visible.",
    fields: {
      year: "2025",
      brand: "Bowman",
      product: "Bowman Chrome",
      player: "Test Player",
    parallel: "Fuchsia Wave",
    auto: true,
    serial_number: "137/199",
    numerical_rarity: "137/199"
  },
  field_evidence: [{
    field: "auto",
    value: true,
    source_type: "CARD_FRONT_PRINTED_TEXT",
    source_image_id: "image-1",
    source_region: "card_text",
    visible_text: "AUTOGRAPH",
    directly_observed: true,
    direct_observation: true,
    review_required: false
  }],
  unresolved: []
});

assert.equal(numericalRarityRecovered.confidence, "HIGH");
assert.match(numericalRarityRecovered.title, /137\/199/);
assert.doesNotMatch(numericalRarityRecovered.unresolved.join(" "), /title missing serial/);

const localizedTrainerIllustrator = await callApi({
  title: "2026 Pokemon Scarlet Violet 257/208 SAR En Morikura Trainer Card",
  confidence: "HIGH",
  reason: "Chinese Pokemon Trainer card; Illus. En Morikura is visible.",
  fields: {
    year: "2026",
    brand: "Pokemon TCG",
    product: "Pokemon Scarlet Violet",
    character: "Lisia's Appeal",
    set: "SV9C",
    subset: "SAR",
    card_number: "257/208",
    artist: "En Morikura"
  },
  field_evidence: {
    card_number: {
      value: "257/208",
      source_type: "CARD_FRONT_PRINTED_TEXT",
      visible_text: "257/208",
      directly_observed: true,
      confidence: 0.96,
      review_required: false
    }
  },
  unresolved: ["localized trainer identity requires operator review"]
});

assert.doesNotMatch(localizedTrainerIllustrator.title, /En Morikura/i);
assert.match(localizedTrainerIllustrator.title, /Lisia's Appeal/);
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
    brand: "Panini",
    product: "Prizm",
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
    brand: "Panini",
    product: "Select",
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
    brand: "Panini",
    product: "Donruss",
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
    brand: "Panini",
    product: "Prizm",
    player: "Lionel Messi",
    parallel: "Kaboom"
  },
  unresolved: []
});

assert.equal(insertNotParallel.fields.insert, "Kaboom");
assert.equal(insertNotParallel.fields.parallel ?? null, null);

const ultravioletCodeResolved = await callApi({
  title: "2024 Panini Select Anthony Edwards",
  confidence: "HIGH",
  reason: "Card number UV-16 is visible on the back.",
  fields: {
    year: "2024",
    brand: "Panini",
    product: "Select",
    player: "Anthony Edwards",
    card_number: "UV-16"
  },
  field_evidence: {
    card_number: directPrintedCodeEvidence("UV-16")
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
    brand: "Topps",
    product: "Topps Chrome",
    player: "Shohei Ohtani",
    card_number: "IMP-OTI",
    auto: true
  },
  field_evidence: {
    card_number: directPrintedCodeEvidence("IMP-OTI")
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
    brand: "Bowman",
    product: "Bowman Chrome",
    player: "Cooper Flagg",
    subset: "RC",
    card_number: "BRR-1"
  },
  field_evidence: {
    card_number: directPrintedCodeEvidence("BRR-1")
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
    year: "2024",
    brand: "Pokemon",
    product: "Pokemon",
    character: "Darkrai",
    parallel: "Holo",
    grade_company: "PSA",
    grade: "Gem Mint 10"
  },
  unresolved: []
});

assert.equal(clearDarkraiPsaLabel.confidence, "HIGH");
assert.equal(clearDarkraiPsaLabel.title, "2024 Pokemon Darkrai Holo PSA 10");

const oneOfOneWithUncertainParallel = await callApi({
  title: "2024 Topps Chrome Michael Jackson Green Refractor 01/01",
  confidence: "HIGH",
  reason: "Card text supports subject and serial; exact geometric parallel requires review.",
  fields: {
    year: "2024",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Michael Jackson",
    parallel: "Green Geometric",
    serial_number: "01/01",
    numerical_rarity: "01/01",
    one_of_one: true
  },
  unresolved: ["exact parallel requires operator review"]
});

assert.equal(oneOfOneWithUncertainParallel.confidence, "MEDIUM");
assert.match(oneOfOneWithUncertainParallel.title, /1\/1/);
assert.doesNotMatch(oneOfOneWithUncertainParallel.title, /01\/01/);
assert.doesNotMatch(oneOfOneWithUncertainParallel.title, /\bGeometric\b/i);
assert.equal(
  oneOfOneWithUncertainParallel.resolved?.surface_color
    || oneOfOneWithUncertainParallel.resolved_fields?.surface_color
    || oneOfOneWithUncertainParallel.fields?.surface_color,
  "Green"
);

const dualPairingPreserved = await callApi({
  title: "2024 Topps Chrome Charles Leclerc Lewis Hamilton Power Partnership",
  confidence: "HIGH",
  reason: "Card text explicitly supports both subjects and Power Partnership insert.",
  fields: {
    year: "2024",
    brand: "Topps",
    product: "Topps Chrome",
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
    brand: "Bowman",
    product: "Bowman Chrome",
    player: "Test Player",
    subset: "1st Bowman",
    auto: true,
    serial_number: "137/199",
    numerical_rarity: "137/199"
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
    brand: "Bowman",
    product: "Bowman Chrome",
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
    brand: "Donruss",
    product: "Donruss Football",
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
    brand: "Donruss",
    product: "Donruss Football",
    player: "Test Player",
    subset: "Rated Rookie"
  },
  unresolved: []
});

assert.equal(missingVisibleRc.confidence, "HIGH");
assert.match(missingVisibleRc.title, /Test Player RC/);

const autographNormalized = await callApi({
  title: "2025 Topps Chrome Mike Trout Autograph",
  confidence: "HIGH",
  reason: "Card text explicitly supports Mike Trout autograph.",
  fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
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
    brand: "Topps",
    product: "Topps Chrome",
    player: "Mike Trout / Shohei Ohtani",
    auto: true
  },
  unresolved: []
});

assert.match(dualAutographNormalized.title, /Mike Trout \/ Shohei Ohtani Auto/);
assert.equal((dualAutographNormalized.title.match(/\bAuto\b/gi) || []).length, 1);
assert.doesNotMatch(dualAutographNormalized.title, /Autograph/i);

const tripleAutographNormalized = await callApi({
  title: "2025 Topps Chrome Test Player Triple Autograph",
  confidence: "HIGH",
  reason: "Card text explicitly supports triple autograph.",
  fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Test Player",
    auto: true
  },
  unresolved: []
});

assert.match(tripleAutographNormalized.title, /Test Player Auto/);
assert.equal((tripleAutographNormalized.title.match(/\bAuto\b/gi) || []).length, 1);
assert.doesNotMatch(tripleAutographNormalized.title, /Autograph/i);

const certifiedAutographNormalized = await callApi({
  title: "2025 Bowman Chrome Test Player 1st Bowman Certified Autograph",
  confidence: "HIGH",
  reason: "Card text explicitly supports certified autograph.",
  fields: {
    year: "2025",
    brand: "Bowman",
    product: "Bowman Chrome",
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
  reason: "Card text supports player and autograph; reasoning may mention on-card autograph detail.",
  fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
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
  reason: "Card text supports player and autograph; reasoning may mention sticker autograph detail.",
  fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
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
  field_evidence: {
    card_number: directPrintedCodeEvidence("TCAR-CF", "SLAB_LABEL")
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(cooperFlaggChromeRookieAuto.title, /Chrome Rookie Auto/i);
assert.doesNotMatch(cooperFlaggChromeRookieAuto.title, /\bBase\b/i);
assert.match(cooperFlaggChromeRookieAuto.title, /PSA 9\/10/i);
assert.match(cooperFlaggChromeRookieAuto.title, /PSA 9\/10$/i);
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

assert.doesNotMatch(cooperFlaggSeasonPsaStandard.title, /^2025\s/);
assert.ok(cooperFlaggSeasonPsaStandard.writer_required_fields.includes("year"));
assert.match(cooperFlaggSeasonPsaStandard.title, /Chrome Rookie Auto/i);
assert.match(cooperFlaggSeasonPsaStandard.title, /PSA 10\/9/i);
assert.doesNotMatch(cooperFlaggSeasonPsaStandard.title, /\b2025 Topps/i);
assert.doesNotMatch(cooperFlaggSeasonPsaStandard.title, /PSA 10 MINT 9|PSA 10 Auto 9/i);

const cooperFlaggV124 = await callApi({
  title: "2025 Topps Chrome Cooper Flagg Chrome Rookie Auto PSA 9 Auto 10",
  confidence: "HIGH",
  reason: "Back product text supports 2025-26 Topps Chrome Basketball; PSA label shows card grade 9 and autograph grade 10.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Cooper Flagg",
    insert: "Chrome Rookie Auto",
    card_number: "TCAR-CF",
    grade_company: "PSA",
    grade: "9",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(cooperFlaggV124.title, "2025-26 Topps Chrome Cooper Flagg Chrome Rookie Auto RC PSA 9/10");
assert.ok(cooperFlaggV124.writer_required_fields.includes("year"));

const cooperFlaggPsaMintAutoGradeFolded = await callApi({
  title: "2025 Topps Chrome Cooper Flagg Chrome Rookie Auto RC PSA 10 PSA MINT 9 PSA/DNA Cert Autograph 10",
  confidence: "HIGH",
  reason: "Back product text supports 2025-26 Topps Chrome Basketball; PSA label shows card grade MINT 9 and PSA/DNA autograph grade 10.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Cooper Flagg",
    insert: "Chrome Rookie Auto",
    card_number: "TCAR-CF",
    grade_company: "PSA",
    grade: "9",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 140 });

assert.equal(cooperFlaggPsaMintAutoGradeFolded.title, "2025-26 Topps Chrome Cooper Flagg Chrome Rookie Auto RC PSA 9/10");
assert.ok(cooperFlaggPsaMintAutoGradeFolded.writer_required_fields.includes("year"));
assert.doesNotMatch(cooperFlaggPsaMintAutoGradeFolded.title, /PSA 10$|Autograph 10|Auto 10|PSA MINT 9/i);

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
    numerical_rarity: "31/150",
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
    numerical_rarity: "31/50",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(aceBaileyChromeAutoOnce.title, /^2025-26\b/);
assert.ok(aceBaileyChromeAutoOnce.writer_required_fields.includes("year"));
assert.match(aceBaileyChromeAutoOnce.title, /Topps Chrome/i);
assert.match(aceBaileyChromeAutoOnce.title, /Chrome Auto/i);
assert.match(aceBaileyChromeAutoOnce.title, /\bGold\b/i);
assert.doesNotMatch(aceBaileyChromeAutoOnce.title, /Gold\s+Refractor/i);
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

const manufacturerDedupeGradeEnd = await callApi({
  title: "2024 Topps Topps Dynasty Shohei Ohtani Auto Patch 3/5 PSA 9 Auto 10",
  confidence: "HIGH",
  reason: "Card text supports Topps Dynasty Shohei Ohtani autograph patch serial 3/5; PSA label shows 9 with auto 10.",
  fields: {
    year: "2024",
    brand: "Topps",
    product: "Topps Dynasty",
    player: "Shohei Ohtani",
    serial_number: "3/5",
    numerical_rarity: "3/5",
    grade_company: "PSA",
    grade: "9",
    auto: true,
    patch: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(manufacturerDedupeGradeEnd.title, /^2024 Topps Dynasty Shohei Ohtani/i);
assert.ok(manufacturerDedupeGradeEnd.writer_required_fields.includes("year"));
assert.doesNotMatch(manufacturerDedupeGradeEnd.title, /Topps Topps Dynasty/i);
assert.match(manufacturerDedupeGradeEnd.title, /3\/5/);
assert.match(manufacturerDedupeGradeEnd.title, /PSA 9\/10$/);

const cosmicChromeProductProtected = await callApi({
  title: "2026 Topps Chrome Stephen Curry Red Propulsion 2/5 PSA 10",
  confidence: "HIGH",
  reason: "Back text supports 2025-26 Topps Cosmic Chrome Red Propulsion serial 2/5; PSA label supports grade 10.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Cosmic Chrome",
    player: "Stephen Curry",
    insert: "Red Propulsion",
    serial_number: "2/5",
    numerical_rarity: "2/5",
    grade_company: "PSA",
    grade: "10"
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(cosmicChromeProductProtected.title, /^2025-26 Topps Cosmic Chrome Stephen Curry/i);
assert.match(cosmicChromeProductProtected.title, /2\/5/);
assert.match(cosmicChromeProductProtected.title, /PSA 10$/);
assert.doesNotMatch(cosmicChromeProductProtected.title, /^2026 Topps Chrome\b/i);

const autoDedupeCanonicalOrder = await callApi({
  title: "2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Auto Gold Refractor 31/150",
  confidence: "HIGH",
  reason: "Card text supports 2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto Gold Refractor serial 31/150.",
  fields: {
    year: "2025-26",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Ace Bailey",
    subset: "RC",
    insert: "Chrome Rookie Auto",
    parallel: "Gold Refractor",
    serial_number: "31/150",
    numerical_rarity: "31/150",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(autoDedupeCanonicalOrder.title, /^2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto Gold 31\/150 RC$/i);
assert.ok(autoDedupeCanonicalOrder.writer_required_fields.includes("year"));
assert.equal((autoDedupeCanonicalOrder.title.match(/\bAuto\b/gi) || []).length, 1);
assert.doesNotMatch(autoDedupeCanonicalOrder.title, /RC Auto/i);

const starSwatchCodeSuppressedSerialPreserved = await callApi({
  title: "2015-16 Panini Panini Flawless Kevin Durant Star Swatch Signatures Platinum #04/10 #SR-KD PSA 10",
  confidence: "HIGH",
  reason: "Registry supports SR-KD as Star Swatch Signatures and Platinum parallel; serial 04/10 and PSA 10 are visible.",
  fields: {
    year: "2015-16",
    brand: "Panini",
    product: "Panini Flawless",
    player: "Kevin Durant",
    insert: "Star Swatch Signatures",
    parallel: "Platinum",
    card_number: "SR-KD",
    serial_number: "04/10",
    numerical_rarity: "04/10",
    grade_company: "PSA",
    grade: "10",
    auto: true,
    patch: true
  },
  field_evidence: {
    card_number: directPrintedCodeEvidence("SR-KD")
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(starSwatchCodeSuppressedSerialPreserved.title, /^2015-16 Panini Flawless Kevin Durant Star Swatch Signatures 04\/10 Auto PSA 10$/i);
assert.ok(starSwatchCodeSuppressedSerialPreserved.writer_required_fields.includes("year"));
assert.ok(starSwatchCodeSuppressedSerialPreserved.writer_required_fields.includes("parallel"));
assert.doesNotMatch(starSwatchCodeSuppressedSerialPreserved.title, /Panini Panini Flawless/i);
assert.doesNotMatch(starSwatchCodeSuppressedSerialPreserved.title, /Platinum/i);
assert.doesNotMatch(starSwatchCodeSuppressedSerialPreserved.title, /#04\/10|#?SR-KD|Serial 04\/10|Numbered 04\/10/i);

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
    serial_number: "2/5",
    numerical_rarity: "2/5"
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
    serial_number: "2/5",
    numerical_rarity: "2/5"
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
    serial_number: "2/5",
    numerical_rarity: "2/5"
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
    serial_number: "01/25",
    numerical_rarity: "01/25"
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

const shaqPennyV124 = await callApi({
  title: "2015-16 Immaculate Shaquille O'Neal Anfernee Hardaway Dual Signatures",
  confidence: "HIGH",
  reason: "Front card text supports Dual Signatures and visible serial 01/25.",
  fields: {
    year: "2015-16",
    brand: "Panini",
    product: "Immaculate Collection",
    player: "Shaquille O'Neal / Anfernee Hardaway",
    insert: "Dual Signatures",
    serial_number: "01/25",
    numerical_rarity: "01/25"
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(shaqPennyV124.title, "2015-16 Panini Immaculate Shaquille O'Neal / Anfernee Hardaway Dual Signatures Auto 01/25");
assert.ok(shaqPennyV124.writer_required_fields.includes("year"));

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
    serial_number: "01/25",
    numerical_rarity: "01/25"
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
    brand: "Topps",
    product: "Topps Chrome",
    player: "Test Player",
    grade_company: "PSA",
    grade: "AUTH",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(psaAuthAutoStandard.title, /PSA Auth\/10/);
assert.doesNotMatch(psaAuthAutoStandard.title, /PSA AUTH Auto 10|PSA Auth Auto 10/i);

const jaysonTatumBgsV124 = await callApi({
  title: "2017-18 Prizm Jayson Tatum Rookie Auto /10 Gem Mint Beckett 9.5 BGS 9.5 Auto 10",
  confidence: "HIGH",
  reason: "Card text supports Panini Prizm Jayson Tatum Rookie Auto serial /10; BGS label shows card grade 9.5 and auto grade 10.",
  fields: {
    year: "2017-18",
    brand: "Panini",
    product: "Panini Prizm",
    player: "Jayson Tatum",
    subset: "Rookie Auto",
    serial_number: "/10",
    numerical_rarity: "/10",
    grade_company: "BGS",
    grade: "9.5",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(jaysonTatumBgsV124.title, "2017-18 Panini Prizm Jayson Tatum Rookie Auto #/10 BGS 9.5/10");
assert.ok(jaysonTatumBgsV124.writer_required_fields.includes("year"));

const jaysonTatumBgsLooseAutoGradeFolded = await callApi({
  title: "2017-18 Prizm Jayson Tatum Fast Break Auto /10 Auto 10 BGS 9.5",
  confidence: "HIGH",
  reason: "Card text supports Panini Prizm Jayson Tatum Fast Break Auto serial /10; BGS label shows card condition grade 9.5 and autograph grade 10.",
  fields: {
    year: "2017-18",
    brand: "Panini",
    product: "Panini Prizm",
    player: "Jayson Tatum",
    insert: "Fast Break Auto",
    serial_number: "/10",
    numerical_rarity: "/10",
    grade_company: "BGS",
    grade: "9.5",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 140 });

assert.equal(jaysonTatumBgsLooseAutoGradeFolded.title, "2017-18 Panini Prizm Jayson Tatum Auto #/10 Fast Break BGS 9.5/10");
assert.ok(jaysonTatumBgsLooseAutoGradeFolded.writer_required_fields.includes("year"));
assert.match(jaysonTatumBgsLooseAutoGradeFolded.title, /Auto #\/10 Fast Break BGS 9\.5\/10$/);
assert.doesNotMatch(jaysonTatumBgsLooseAutoGradeFolded.title, /\bAuto 10\b/i);

const genericPsaCardAndAutoGrade = await callApi({
  title: "2024 Topps Chrome Placeholder Player Blue Auto PSA MINT 8 Autograph 10",
  confidence: "HIGH",
  reason: "PSA label supports card condition grade 8 and autograph grade 10.",
  fields: {
    year: "2024",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Placeholder Player",
    parallel: "Blue",
    grade_company: "PSA",
    grade: "8",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(genericPsaCardAndAutoGrade.title, "2024 Topps Chrome Placeholder Player Blue Auto PSA 8/10");
assert.doesNotMatch(genericPsaCardAndAutoGrade.title, /\bAutograph 10\b|\bAuto 10\b/i);

const genericPsaAuthAndAutoGrade = await callApi({
  title: "2024 Bowman Chrome Sample Prospect Auto PSA Auth Auto 10",
  confidence: "HIGH",
  reason: "PSA label supports authentic card and autograph grade 10.",
  fields: {
    year: "2024",
    brand: "Bowman",
    product: "Bowman Chrome",
    player: "Sample Prospect",
    grade_company: "PSA",
    grade: "AUTH",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(genericPsaAuthAndAutoGrade.title, "2024 Bowman Chrome Sample Prospect Auto PSA Auth/10");

const genericPsaAutoGradeOnly = await callApi({
  title: "2024 Topps Chrome Placeholder Player Auto PSA Auto 9",
  confidence: "HIGH",
  reason: "PSA label supports autograph grade 9 only.",
  fields: {
    year: "2024",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Placeholder Player",
    grade_company: "PSA",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(genericPsaAutoGradeOnly.title, "2024 Topps Chrome Placeholder Player Auto PSA AUTO 9");
assert.doesNotMatch(genericPsaAutoGradeOnly.title, /PSA 9$/);

const genericPsaCardGradeOnly = await callApi({
  title: "2024 Topps Chrome Placeholder Player Refractor PSA 9",
  confidence: "HIGH",
  reason: "PSA label supports card condition grade 9 only.",
  fields: {
    year: "2024",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Placeholder Player",
    parallel: "Refractor",
    grade_company: "PSA",
    grade: "9"
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(genericPsaCardGradeOnly.title, "2024 Topps Chrome Placeholder Player PSA 9");
assert.doesNotMatch(genericPsaCardGradeOnly.title, /PSA 9\//);

const genericBgsCardAndAutoGrade = await callApi({
  title: "2024 Panini Prizm Placeholder Guard Silver Auto /10 BGS 9 Auto 9",
  confidence: "HIGH",
  reason: "BGS label supports card condition grade 9 and autograph grade 9; serial /10 is visible.",
  fields: {
    year: "2024",
    brand: "Panini",
    product: "Panini Prizm",
    player: "Placeholder Guard",
    parallel: "Silver",
    serial_number: "/10",
    numerical_rarity: "/10",
    grade_company: "BGS",
    grade: "9",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(genericBgsCardAndAutoGrade.title, "2024 Panini Prizm Placeholder Guard Silver #/10 Auto BGS 9/9");
assert.match(genericBgsCardAndAutoGrade.title, /#\/10 Auto BGS 9\/9$/);
assert.doesNotMatch(genericBgsCardAndAutoGrade.title, /\bAuto 9\b/i);

const genericBgsAuthAndAutoGrade = await callApi({
  title: "2024 Panini Prizm Placeholder Guard Auto BGS Auth Auto 10",
  confidence: "HIGH",
  reason: "BGS label supports authentic card and autograph grade 10.",
  fields: {
    year: "2024",
    brand: "Panini",
    product: "Panini Prizm",
    player: "Placeholder Guard",
    grade_company: "BGS",
    grade: "AUTH",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(genericBgsAuthAndAutoGrade.title, "2024 Panini Prizm Placeholder Guard Auto BGS Auth/10");

const genericBgsAutoGradeOnly = await callApi({
  title: "2024 Panini Prizm Placeholder Guard Auto BGS Auto 10",
  confidence: "HIGH",
  reason: "BGS label supports autograph grade 10 only.",
  fields: {
    year: "2024",
    brand: "Panini",
    product: "Panini Prizm",
    player: "Placeholder Guard",
    grade_company: "BGS",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(genericBgsAutoGradeOnly.title, "2024 Panini Prizm Placeholder Guard Auto BGS AUTO 10");
assert.doesNotMatch(genericBgsAutoGradeOnly.title, /BGS 10$/);

const genericBgsCardGradeOnly = await callApi({
  title: "2024 Panini Prizm Placeholder Guard Silver BGS 10",
  confidence: "HIGH",
  reason: "BGS label supports card condition grade 10 only.",
  fields: {
    year: "2024",
    brand: "Panini",
    product: "Panini Prizm",
    player: "Placeholder Guard",
    parallel: "Silver",
    grade_company: "BGS",
    grade: "10"
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(genericBgsCardGradeOnly.title, "2024 Panini Prizm Placeholder Guard Silver BGS 10");
assert.doesNotMatch(genericBgsCardGradeOnly.title, /BGS 10\//);

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
  reason: "Card back visibly shows SR-KD; registry supports it as Star Swatch Signatures and checklist supports Platinum parallel.",
  fields: {
    year: "2015-16",
    brand: "Panini",
    product: "Flawless",
    player: "Kevin Durant",
    card_number: "SR-KD",
    parallel: "Platinum",
    serial_number: "04/10",
    numerical_rarity: "04/10",
    auto: true,
    patch: true
  },
  field_evidence: {
    card_number: directPrintedCodeEvidence("SR-KD")
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.match(durantStarSwatch.title, /Star Swatch Signatures/i);
assert.doesNotMatch(durantStarSwatch.title, /Platinum/i);
assert.match(durantStarSwatch.title, /04\/10/);
assert.ok(durantStarSwatch.writer_required_fields.includes("parallel"));
assert.doesNotMatch(durantStarSwatch.title, /Patch Auto/i);
assert.doesNotMatch(durantStarSwatch.title, /#?SR-KD/i);

const sspRegistryPreserved = await callApi({
  title: "2024 Topps Chrome Test Player Super Short Print",
  confidence: "HIGH",
  reason: "Card back explicitly states Super Short Print.",
  fields: {
    year: "2024",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Test Player",
    insert: "Super Short Print"
  },
  unresolved: []
});

assert.equal(sspRegistryPreserved.fields.insert, "SSP");
assert.match(sspRegistryPreserved.title, /SSP/);

const structuredProviderFieldsPreserved = await callApi({
  title: "2024 Topps Chrome Test Player Autograph Purple Refractor 31/50",
  confidence: "HIGH",
  reason: "Front printed text explicitly supports Autograph and printed parallel Purple Refractor.",
  fields: {
    year: "2024",
    manufacturer: "Topps",
    product: "Topps Chrome",
    player: "Test Player",
    card_type: "Autograph",
    surface_color: "Purple",
    parallel_family: "Refractor",
    parallel_exact: "Purple Refractor",
    serial_number: "31/50",
    numerical_rarity: "31/50",
    auto: true
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(structuredProviderFieldsPreserved.normalized_evidence.card_type.value, "Autograph");
assert.equal(structuredProviderFieldsPreserved.normalized_evidence.surface_color.value, "Purple");
assert.equal(structuredProviderFieldsPreserved.normalized_evidence.parallel_exact.value, "Purple Refractor");
assert.match(structuredProviderFieldsPreserved.title, /Autograph|Auto/i);

const gradeLikeChecklistNotPublished = await callApi({
  title: "2024 Topps Chrome Test Player PSA 10",
  confidence: "HIGH",
  reason: "Slab label states PSA 10.",
  fields: {
    year: "2024",
    product: "Topps Chrome",
    player: "Test Player",
    checklist_code: "PSA-10",
    grade_company: "PSA",
    grade: "PSA 10"
  },
  field_evidence: {
    grade: {
      value: "PSA 10",
      grade_company: "PSA",
      card_grade: "10",
      source_type: "SLAB_LABEL",
      visible_text: "PSA 10",
      directly_observed: true,
      confidence: 0.98,
      review_required: false
    }
  },
  unresolved: []
}, { maxTitleLength: 120 });

assert.equal(gradeLikeChecklistNotPublished.normalized_evidence.checklist_code, undefined);
assert.equal(gradeLikeChecklistNotPublished.normalized_evidence.grade_company.value, "PSA");
assert.equal(gradeLikeChecklistNotPublished.normalized_evidence.card_grade.value, "10");
assert.doesNotMatch(gradeLikeChecklistNotPublished.title, /PSA-10/);

const finalizerPreservesCurrentImageSpecificity = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  title: "2023 Panini Stephen Curry FOTL Green 20/99 #119 (Warriors) PSA 10",
  confidence: "HIGH",
  raw_provider_fields: {
    year: "2023",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Stephen Curry"],
    team: "Warriors",
    insert: "Green Shimmer FOTL",
    surface_color: "Green",
    serial_number: "20/99",
    numerical_rarity: "20/99",
    collector_number: "119",
    grade_company: "PSA",
    card_grade: "10",
    parallel_exact: "Green Shimmer Prizm"
  },
  resolved_fields: {
    year: "2023",
    manufacturer: "Panini",
    brand: "Panini",
    players: ["Stephen Curry"],
    team: "Warriors",
    insert: "FOTL",
    surface_color: "Green",
    collector_number: "119",
    grade_company: "PSA",
    card_grade: "10"
  },
  rendered_fields: {
    fields: {
      year: "2023",
      brand: "Panini",
      players: ["Stephen Curry"],
      team: "Warriors",
      insert: "FOTL",
      surface_color: "Green",
      collector_number: "119",
      grade_company: "PSA",
      card_grade: "10"
    }
  },
  catalog_assist_eligibility: {
    field_support_fields: ["year", "manufacturer", "brand", "product", "surface_color", "collector_number"]
  }
}, { maxTitleLength: 85 });

assert.match(finalizerPreservesCurrentImageSpecificity.title, /Panini Prizm/);
assert.match(finalizerPreservesCurrentImageSpecificity.title, /Green Shimmer/);
assert.match(finalizerPreservesCurrentImageSpecificity.title, /20\/99/);
// standard_card_number (#119) is no longer a title field under SEM STANDARD
// grammar; the serial number 20/99 and FOTL below still assert that the
// finalizer preserves current-image specificity.
assert.doesNotMatch(finalizerPreservesCurrentImageSpecificity.title, /#119/);
assert.match(finalizerPreservesCurrentImageSpecificity.title, /\bFOTL\b/);
assert.doesNotMatch(finalizerPreservesCurrentImageSpecificity.title, /Green Shimmer Prizm/);

const finalizerBackfillsCurrentImageCommercialFields = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  title: "2024-25 Anthony Edwards",
  confidence: "HIGH",
  raw_provider_fields: {
    year: "2024-25",
    manufacturer: "Panini",
    product: "Immaculate",
    players: ["Anthony Edwards"],
    card_type: "Patch Auto",
    serial_number: "2/3",
    numerical_rarity: "2/3",
    grade_company: "BGS",
    card_grade: "8.5",
    auto_grade: "10",
    grade_type: "CARD_AND_AUTO"
  },
  resolved_fields: {
    year: "2024-25",
    players: ["Anthony Edwards"]
  },
  normalized_evidence: {
    serial_number: {
      value: "2/3",
      status: "CONFIRMED",
      confidence: 0.95,
      sources: [{ source_type: "CARD_FRONT", observed_text: "2/3" }]
    }
  }
}, { maxTitleLength: 80 });

assert.match(finalizerBackfillsCurrentImageCommercialFields.title, /Panini Immaculate/);
assert.match(finalizerBackfillsCurrentImageCommercialFields.title, /Patch Auto/);
assert.match(finalizerBackfillsCurrentImageCommercialFields.title, /2\/3/);
assert.match(finalizerBackfillsCurrentImageCommercialFields.title, /BGS 8\.5\/10/);

const finalizerEvidenceBeatsStaleProviderScaffold = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  title: "2018 Bowman Chrome Yordan Alvarez Auto Gold Shimmer Refractor #CPA BGS 10/9.5",
  confidence: "HIGH",
  raw_provider_fields: {
    year: "2018",
    manufacturer: "Topps",
    brand: "Bowman",
    product: "Bowman Chrome",
    players: ["Yordan Alvarez"],
    card_name: "Prospect Autographs Gold Shimmer Refractor",
    surface_color: "Gold",
    collector_number: "CPA",
    auto: true,
    grade_company: "BGS",
    card_grade: "10",
    auto_grade: "9.5",
    grade_type: "CARD_AND_AUTO"
  },
  resolved_fields: {
    year: "2018",
    brand: "Bowman",
    product: "Bowman Chrome",
    players: ["Yordan Alvarez"],
    card_name: "Prospect Autographs Gold Shimmer Refractor",
    surface_color: "Gold",
    collector_number: "CPA",
    auto: true,
    grade_company: "BGS",
    card_grade: "10",
    auto_grade: "9.5",
    grade_type: "CARD_AND_AUTO"
  },
  normalized_evidence: {
    print_run_number: {
      value: "09/50",
      status: "CONFIRMED",
      confidence: 0.96,
      sources: [{ source_type: "CARD_FRONT", observed_text: "09/50" }]
    },
    grade: {
      value: "BGS 9.5 AUTO 10",
      status: "CONFIRMED",
      confidence: 0.95,
      sources: [{ source_type: "SLAB_LABEL", observed_text: "BGS 9.5 AUTO 10" }]
    }
  }
}, { maxTitleLength: 80 });

assert.match(finalizerEvidenceBeatsStaleProviderScaffold.title, /09\/50/);
assert.match(finalizerEvidenceBeatsStaleProviderScaffold.title, /BGS 9\.5\/10/);
assert.doesNotMatch(finalizerEvidenceBeatsStaleProviderScaffold.title, /#CPA|BGS 10\/9\.5/);

const incompleteGradeIsGuardedBeforeRendering = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  confidence: "LOW",
  fields: {
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  resolved_fields: {
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  field_states: [{
    field_name: "grade",
    field_value: "10",
    display_status: "NORMAL",
    confidence: 0.8
  }]
}, { maxTitleLength: 80 });

assert.equal(incompleteGradeIsGuardedBeforeRendering.title, undefined);
assert.equal(incompleteGradeIsGuardedBeforeRendering.fields.card_grade, null);
assert.equal(incompleteGradeIsGuardedBeforeRendering.resolved_fields.card_grade, null);
assert.equal(incompleteGradeIsGuardedBeforeRendering.field_states[0].display_status, "REVIEW");
assert.equal(incompleteGradeIsGuardedBeforeRendering.grade_atomic_guard.applied, true);
assert.ok(incompleteGradeIsGuardedBeforeRendering.unresolved.includes("grade requires grading company from current-image direct evidence"));

const finalizerMergesMoreCompletePublicFields = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  title: "1994 Upper Deck Ken Griffey Jr. Auto BGS",
  confidence: "HIGH",
  fields: {
    year: "1994",
    manufacturer: "Upper Deck",
    product: "Upper Deck",
    players: ["Ken Griffey Jr.", "Mickey Mantle"],
    auto: true,
    grade_company: "BGS",
    card_grade: "Authentic"
  },
  rendered_fields: {
    fields: {
      year: "1994",
      manufacturer: "Upper Deck",
      product: "Upper Deck",
      players: ["Ken Griffey Jr."],
      auto: true,
      grade_company: "BGS"
    }
  }
}, { maxTitleLength: 120 });

assert.match(finalizerMergesMoreCompletePublicFields.title, /Ken Griffey Jr\.?/);
assert.match(finalizerMergesMoreCompletePublicFields.title, /Mickey Mantle/);
assert.match(finalizerMergesMoreCompletePublicFields.title, /Auto/);
assert.match(finalizerMergesMoreCompletePublicFields.title, /BGS Auth/);

const lowMarginSafeOverlayResult = {
  title: "2025 Bowman Chrome Jesus Made Red",
  confidence: "HIGH",
  resolved_fields: {
    year: "2025",
    manufacturer: "Bowman",
    product: "Bowman Chrome",
    players: ["Jesus Made"],
    surface_color: "Red"
  },
  low_margin_safe_field_application: {
    status: "evidence_support_only",
    candidate_id: "catalog-low-margin-safe",
    supported_fields: ["card_name", "variation", "print_run_denominator", "serial_number", "grade_company", "card_grade", "cert_number"],
    verifier_required_fields: ["collector_number"],
    blocked_fields: []
  },
  candidate_field_evidence: [
    {
      candidate_id: "catalog-low-margin-safe",
      field_name: "card_name",
      value: "Spotlights",
      permission: "can_apply"
    },
    {
      candidate_id: "catalog-low-margin-safe",
      field_name: "variation",
      value: "Variation",
      permission: "can_apply"
    },
    {
      candidate_id: "catalog-low-margin-safe",
      field_name: "print_run_denominator",
      value: "5",
      permission: "support_only"
    },
    {
      candidate_id: "catalog-low-margin-safe",
      field_name: "serial_number",
      value: "3/5",
      permission: "can_apply"
    },
    {
      candidate_id: "catalog-low-margin-safe",
      field_name: "grade_company",
      value: "PSA",
      permission: "can_apply"
    },
    {
      candidate_id: "catalog-low-margin-safe",
      field_name: "card_grade",
      value: "10",
      permission: "can_apply"
    },
    {
      candidate_id: "catalog-low-margin-safe",
      field_name: "cert_number",
      value: "12345678",
      permission: "can_apply"
    }
  ]
};
const lowMarginSafeOverlay = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation(lowMarginSafeOverlayResult, { maxTitleLength: 80 });
assert.match(lowMarginSafeOverlay.title, /Spotlights/);
assert.match(lowMarginSafeOverlay.title, /Variation/);
assert.match(lowMarginSafeOverlay.title, /#\/5/);
assert.doesNotMatch(lowMarginSafeOverlay.title, /3\/5/);
assert.doesNotMatch(lowMarginSafeOverlay.title, /PSA|12345678/);
assert.ok(lowMarginSafeOverlay.candidate_safe_overlay_applied_fields.includes("card_name"));
assert.ok(lowMarginSafeOverlay.candidate_safe_overlay_applied_fields.includes("variation"));
assert.ok(lowMarginSafeOverlay.candidate_safe_overlay_applied_fields.includes("print_run_denominator"));
assert.ok(lowMarginSafeOverlay.candidate_safe_overlay_applied_fields.includes("serial_denominator"));
assert.equal(lowMarginSafeOverlay.candidate_safe_overlay_applied_fields.includes("serial_number"), false);
assert.equal(lowMarginSafeOverlay.candidate_safe_overlay_applied_fields.includes("grade_company"), false);
assert.equal(lowMarginSafeOverlay.candidate_safe_overlay_applied_fields.includes("cert_number"), false);

const selectedCandidateSafeOverlayResult = {
  title: "2024 Bowman Chrome Jesus Made",
  final_title: "2024 Bowman Chrome Jesus Made",
  confidence: "HIGH",
  resolved_fields: {
    players: ["Jesus Made"]
  },
  selected_candidate_safe_field_application: {
    status: "ready_fill_missing",
    candidate_id: "catalog-exact-safe",
    eligible_fields: ["year", "manufacturer", "product", "card_name", "parallel_exact", "serial_number", "grade_company", "cert_number"],
    field_reasons: {
      year: "trusted_exact_code_identity_fill",
      manufacturer: "trusted_exact_code_identity_fill",
      product: "trusted_exact_code_identity_fill",
      card_name: "trusted_exact_code_identity_fill"
    },
    renderer_application_allowed: true
  },
  candidate_field_evidence: [
    { candidate_id: "catalog-exact-safe", field_name: "year", value: "2024", permission: "can_apply" },
    { candidate_id: "catalog-exact-safe", field_name: "manufacturer", value: "Bowman", permission: "can_apply" },
    { candidate_id: "catalog-exact-safe", field_name: "product", value: "Bowman Chrome", permission: "can_apply" },
    { candidate_id: "catalog-exact-safe", field_name: "card_name", value: "Spotlights", permission: "can_apply" },
    { candidate_id: "catalog-exact-safe", field_name: "parallel_exact", value: "Red Refractor", permission: "can_apply" },
    { candidate_id: "catalog-exact-safe", field_name: "serial_number", value: "12/50", permission: "can_apply" },
    { candidate_id: "catalog-exact-safe", field_name: "grade_company", value: "PSA", permission: "can_apply" },
    { candidate_id: "catalog-exact-safe", field_name: "cert_number", value: "12345678", permission: "can_apply" }
  ],
  candidate_application_trace: [{
    candidate_id: "catalog-exact-safe",
    participation_level: "LEVEL_2_EVIDENCE_SUPPORT",
    applied_fields: [],
    reason_per_field: {}
  }],
  candidate_activation_funnel: { selected_candidate_id: "catalog-exact-safe", applied_field_count: 0, applied_fields: [] },
  catalog_activation_funnel: { selected_candidate_id: "catalog-exact-safe", applied_field_count: 0, applied_fields: [] }
};
const selectedCandidateSafeOverlay = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation(
  selectedCandidateSafeOverlayResult,
  { maxTitleLength: 80 }
);
assert.match(selectedCandidateSafeOverlay.title, /2024/);
assert.match(selectedCandidateSafeOverlay.title, /Bowman Chrome/);
assert.match(selectedCandidateSafeOverlay.title, /Spotlights/);
assert.doesNotMatch(selectedCandidateSafeOverlay.title, /Red Refractor|12\/50|PSA|12345678/);
assert.deepEqual(
  selectedCandidateSafeOverlay.selected_candidate_safe_field_application.renderer_applied_fields.sort(),
  ["card_name", "manufacturer", "product", "year"]
);
assert.equal(selectedCandidateSafeOverlay.candidate_activation_funnel.applied_field_count, 4);
assert.equal(selectedCandidateSafeOverlay.catalog_activation_funnel.participation_level, "LEVEL_3_FIELD_APPLICATION");
assert.equal(selectedCandidateSafeOverlay.candidate_application_trace[0].participation_level, "LEVEL_3_FIELD_APPLICATION");

const retrievalResolvedFieldsRemainCanonical = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  title: "2024 Panini Prizm Test Player",
  final_title: "2024 Panini Prizm Test Player",
  resolved_fields: {
    year: "2024",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Test Player"],
    card_name: "Autograph"
  },
  rendered_fields: {
    title: "2024 Panini Prizm Test Player",
    fields: {
      year: "2024",
      manufacturer: "Panini",
      product: "Panini Prizm",
      players: ["Test Player"]
    }
  },
  retrieval_application: {
    owns_candidate_application: true,
    resolver_consumed: true
  }
}, { maxTitleLength: 80 });
assert.equal(retrievalResolvedFieldsRemainCanonical.resolved_fields.product, "Topps Chrome");
assert.match(retrievalResolvedFieldsRemainCanonical.title, /Topps Chrome/);
assert.doesNotMatch(retrievalResolvedFieldsRemainCanonical.title, /Panini Prizm/);

console.log("listing confidence audit mock tests passed");
