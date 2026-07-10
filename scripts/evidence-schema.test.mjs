import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertValidEvidenceDocument,
  createEvidenceField,
  createVisionSource,
  normalizeResolvedFields,
  validateEvidenceField,
  validateResolvedFields
} from "../lib/listing/evidence/evidence-schema.mjs";
import {
  legacyFieldsToResolvedFields,
  providerPayloadToEvidenceDocument,
  resolvedFieldsToLegacyFields,
  splitLegacyCardNumber
} from "../lib/listing/evidence/provider-evidence-normalizer.mjs";

const evidenceSchema = JSON.parse(await readFile("lib/listing/schemas/evidence-field.schema.json", "utf8"));
const resolvedSchema = JSON.parse(await readFile("lib/listing/schemas/resolved-fields.schema.json", "utf8"));
assert.equal(evidenceSchema.title, "Listing EvidenceField");
assert.equal(resolvedSchema.title, "Listing ResolvedFields");
assert.ok(evidenceSchema.properties.status.enum.includes("CONFIRMED"));
assert.ok(evidenceSchema.properties.sources.items.properties.source_type.enum.includes("MARKETPLACE"));
assert.ok(resolvedSchema.properties.grade_type.enum.includes("CARD_AND_AUTO"));
assert.equal(resolvedSchema.properties.multi_card.type, "boolean");
assert.equal(resolvedSchema.properties.card_count.minimum, 1);
assert.deepEqual(resolvedSchema.properties.cert_number.type, ["string", "null"]);

const evidenceField = createEvidenceField({
  value: "31/50",
  confidence: 0.82,
  sources: [
    createVisionSource({
      imageId: "image-front",
      sourceCropId: "asset-1__image-front__serial_number__field-crop-v1",
      side: "front",
      region: "serial_number",
      observedText: "31/50",
      rawText: "31/50",
      sourceInferenceMethod: "field_crop_vision",
      sourceObjectPath: "listing-assets/source.jpg",
      derivedObjectPath: "listing-assets/serial-crop.jpg",
      glareOcclusion: 0.06,
      blurScore: 0.04,
      trustTier: 1
    })
  ]
});
assert.equal(validateEvidenceField(evidenceField).length, 0);
assert.equal(evidenceField.sources[0].source_crop_id, "asset-1__image-front__serial_number__field-crop-v1");
assert.equal(evidenceField.sources[0].source_inference_method, "field_crop_vision");

const invalidEvidence = {
  ...evidenceField,
  status: "SURE",
  confidence: 1.2,
  sources: [{ source_type: "SELLER_TITLE", trust_tier: 11 }]
};
const invalidErrors = validateEvidenceField(invalidEvidence);
assert.ok(invalidErrors.some((error) => error.path.endsWith(".status")));
assert.ok(invalidErrors.some((error) => error.path.endsWith(".confidence")));
assert.ok(invalidErrors.some((error) => error.path.endsWith(".source_type")));

assert.deepEqual(splitLegacyCardNumber("31/50"), {
  serial_number: "31/50",
  collector_number: null,
  checklist_code: null
});
assert.deepEqual(splitLegacyCardNumber("257/208"), {
  serial_number: null,
  collector_number: "257/208",
  checklist_code: null
});
assert.deepEqual(splitLegacyCardNumber("UV-16"), {
  serial_number: null,
  collector_number: null,
  checklist_code: "UV-16"
});
assert.deepEqual(splitLegacyCardNumber("#136"), {
  serial_number: null,
  collector_number: "136",
  checklist_code: null
});

const resolved = legacyFieldsToResolvedFields({
  year: "2024",
  brand: "Topps Chrome",
  player: "Shohei Ohtani",
  card_number: "UV-16",
  serial_number: "31/50",
  grade_company: "PSA",
  cert_number: "0018492845",
  grade: "10",
  auto: true
});
assert.equal(resolved.year, "2024");
assert.deepEqual(resolved.players, ["Shohei Ohtani"]);
assert.equal(resolved.checklist_code, "UV-16");
assert.equal(resolved.serial_number, "31/50");
assert.equal(resolved.card_grade, "10");
assert.equal(resolved.cert_number, "0018492845");
assert.equal(resolved.auto, true);
assert.equal(validateResolvedFields(resolved).length, 0);

const descriptorResolved = legacyFieldsToResolvedFields({
  year: "2025",
  manufacturer: "Topps",
  product: "Topps Finest",
  card_type: "Insert",
  variation: "Red Refractor"
});
assert.equal(descriptorResolved.manufacturer, "Topps");
assert.equal(descriptorResolved.brand, "Topps");
assert.equal(descriptorResolved.card_type, "Insert");
assert.equal(descriptorResolved.variation, "Red Refractor");

const gradeLikeCardNumberResolved = legacyFieldsToResolvedFields({
  year: "2024",
  product: "Topps Chrome",
  players: ["Test Player"],
  card_number: "PSA-10"
});
assert.equal(gradeLikeCardNumberResolved.checklist_code, null);
assert.equal(gradeLikeCardNumberResolved.grade_company, "PSA");
assert.equal(gradeLikeCardNumberResolved.card_grade, "10");

const normalized = normalizeResolvedFields({
  players: "A / B",
  grade_type: "CARD_AND_AUTO",
  one_of_one: true,
  card_count: "3"
});
assert.deepEqual(normalized.players, ["A / B"]);
assert.equal(normalized.grade_type, "CARD_AND_AUTO");
assert.equal(normalized.one_of_one, true);
assert.equal(normalized.multi_card, true);
assert.equal(normalized.card_count, 3);

const multiCardResolved = legacyFieldsToResolvedFields({
  multi_card: true,
  card_count: 3,
  lot_type: "mixed player lot"
});
assert.equal(multiCardResolved.multi_card, true);
assert.equal(multiCardResolved.card_count, 3);
assert.equal(multiCardResolved.lot_type, "mixed player lot");

const legacy = resolvedFieldsToLegacyFields(resolved);
assert.equal(legacy.player, "Shohei Ohtani");
assert.equal(legacy.card_number, "UV-16");
assert.equal(legacy.serial_number, "31/50");

const evidenceDocument = providerPayloadToEvidenceDocument({
  title: "2024 Topps Chrome Shohei Ohtani UV-16 31/50 PSA 10 Auto",
  confidence: "HIGH",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Shohei Ohtani",
    card_number: "UV-16",
    serial_number: "31/50",
    grade_company: "PSA",
    grade: "10",
    auto: true
  },
  unresolved: []
}, {
  images: [
    {
      id: "image-front",
      imageQuality: {
        glare_score: 0.05,
        blur_score: 0.04
      }
    }
  ]
});
assert.equal(evidenceDocument.schema_version, "evidence-fields-v1");
assert.equal(evidenceDocument.resolved.checklist_code, "UV-16");
assert.equal(evidenceDocument.evidence.serial_number.status, "CONFIRMED");
assert.equal(evidenceDocument.evidence.serial_number.sources[0].source_type, "VISION_MODEL");
assert.doesNotThrow(() => assertValidEvidenceDocument(evidenceDocument));

const cropBoundEvidenceDocument = providerPayloadToEvidenceDocument({
  title: "2024 Topps Chrome Test Player 31/50",
  confidence: "HIGH",
  fields: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Test Player"],
    serial_number: "31/50"
  },
  field_evidence: {
    serial_number: {
      value: "31/50",
      support_type: "CARD_FRONT_PRINTED_TEXT",
      region: "serial_number",
      visible_text: "31/50",
      confidence: 0.94
    }
  },
  unresolved: []
}, {
  images: [
    { id: "front-original", side: "front" },
    {
      id: "serial-crop",
      derived: true,
      sourceRegion: "serial_number",
      storageRole: "serial_crop",
      objectPath: "listing-assets/serial-crop.jpg",
      cropMetadata: {
        crop_id: "asset-1__front-original__serial_number__field-crop-v1",
        source_image_id: "front-original",
        source_object_path: "listing-assets/front.jpg",
        source_side: "front",
        source_region: "serial_number",
        crop_role: "serial_crop",
        derived_object_path: "listing-assets/serial-crop.jpg"
      }
    }
  ]
});
assert.equal(cropBoundEvidenceDocument.evidence.serial_number.sources[0].image_id, "serial-crop");
assert.equal(cropBoundEvidenceDocument.evidence.serial_number.sources[0].source_crop_id, "asset-1__front-original__serial_number__field-crop-v1");
assert.equal(cropBoundEvidenceDocument.evidence.serial_number.sources[0].source_inference_method, "field_crop_vision");
assert.equal(cropBoundEvidenceDocument.evidence.serial_number.sources[0].source_object_path, "listing-assets/front.jpg");
assert.equal(cropBoundEvidenceDocument.evidence.serial_number.sources[0].derived_object_path, "listing-assets/serial-crop.jpg");
assert.doesNotThrow(() => assertValidEvidenceDocument(cropBoundEvidenceDocument));

const structuredHighRiskFieldDocument = providerPayloadToEvidenceDocument({
  title: "",
  confidence: "HIGH",
  fields: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Test Player"],
    grade_company: "PSA",
    card_grade: "10",
    cert_number: "0018492845",
    grade_type: "CARD_ONLY",
    rc: true,
    auto: true
  },
  field_evidence: {
    year: {
      value: "2024",
      support_type: "VISION_ONLY",
      visible_text: "2024",
      confidence: 0.82,
      review_required: true
    },
    grade: {
      grade_company: "PSA",
      card_grade: "10",
      grade_type: "CARD_ONLY",
      support_type: "SLAB_LABEL",
      evidence_kind: "GRADE_LABEL",
      visible_text: "PSA GEM MT 10",
      confidence: 0.96,
      review_required: false
    },
    cert_number: {
      value: "0018492845",
      support_type: "SLAB_LABEL",
      evidence_kind: "CERT_NUMBER",
      visible_text: "0018492845",
      confidence: 0.96,
      review_required: false
    },
    rc: {
      value: true,
      support_type: "CARD_FRONT_PRINTED_TEXT",
      evidence_kind: "RC_LOGO",
      visible_text: "RC",
      visible_marker: true,
      confidence: 0.9,
      review_required: false
    },
    auto: {
      value: true,
      support_type: "VISIBLE_SIGNATURE",
      evidence_kind: "SIGNATURE",
      signature_visible: true,
      confidence: 0.86,
      review_required: false
    }
  },
  unresolved: []
}, {
  images: [
    { id: "image-front", side: "front" }
  ]
});
assert.equal(structuredHighRiskFieldDocument.evidence.year.status, "REVIEW");
assert.equal(structuredHighRiskFieldDocument.evidence.year.sources[0].source_type, "VISION_MODEL");
assert.equal(structuredHighRiskFieldDocument.evidence.grade_company.sources[0].source_type, "SLAB_LABEL");
assert.equal(structuredHighRiskFieldDocument.evidence.card_grade.sources[0].source_type, "SLAB_LABEL");
assert.equal(structuredHighRiskFieldDocument.resolved.cert_number, "0018492845");
assert.equal(structuredHighRiskFieldDocument.evidence.cert_number.sources[0].source_type, "SLAB_LABEL");
assert.equal(structuredHighRiskFieldDocument.evidence.rc.sources[0].source_type, "CARD_FRONT");
assert.equal(structuredHighRiskFieldDocument.evidence.rc.sources[0].evidence_kind, "RC_LOGO");
assert.equal(structuredHighRiskFieldDocument.evidence.auto.sources[0].source_type, "VISION_MODEL");
assert.equal(structuredHighRiskFieldDocument.evidence.auto.sources[0].signature_visible, true);
assert.doesNotThrow(() => assertValidEvidenceDocument(structuredHighRiskFieldDocument));

const contextualBackYearDocument = providerPayloadToEvidenceDocument({
  title: "",
  confidence: "HIGH",
  fields: {
    year: "2024",
    product: "Topps Finest",
    players: ["Shohei Ohtani"]
  },
  field_evidence: {
    year: {
      value: "2024",
      support_type: "CARD_BACK_PRINTED_TEXT",
      visible_text: "Of Ohtani's 57 home runs, including the Postseason, in 2024",
      confidence: 0.95,
      review_required: false
    }
  },
  unresolved: []
}, {
  images: [
    { id: "image-back", side: "back" }
  ]
});
assert.equal(contextualBackYearDocument.evidence.year.value, "2024");
assert.equal(contextualBackYearDocument.evidence.year.status, "REVIEW");
assert.equal(contextualBackYearDocument.evidence.year.confidence, 0.42);
assert.equal(contextualBackYearDocument.evidence.year.sources[0].source_type, "VISUAL_GUESS");
assert.equal(contextualBackYearDocument.evidence.year.sources[0].evidence_kind, "YEAR_CONTEXT_TEXT");
assert.equal(contextualBackYearDocument.evidence.year.unresolved_reason, "year_text_is_context_or_stat_not_product_year");

const insertNameYearDocument = providerPayloadToEvidenceDocument({
  title: "",
  confidence: "HIGH",
  fields: {
    year: "2018",
    product: "Topps Chrome",
    set: "1983 Topps",
    players: ["Shohei Ohtani"]
  },
  field_evidence: {
    year: {
      value: "2018",
      support_type: "SLAB_LABEL",
      visible_text: "1983 TOPPS",
      confidence: 0.99,
      review_required: false
    }
  },
  unresolved: []
}, {
  images: [
    { id: "image-front", side: "front" }
  ]
});
assert.equal(insertNameYearDocument.evidence.year.value, "2018");
assert.equal(insertNameYearDocument.evidence.year.status, "REVIEW");
assert.equal(insertNameYearDocument.evidence.year.confidence, 0.42);
assert.equal(insertNameYearDocument.evidence.year.sources[0].source_type, "VISUAL_GUESS");
assert.equal(insertNameYearDocument.evidence.year.sources[0].evidence_kind, "YEAR_CONTEXT_TEXT");

const leagueContextSetDocument = providerPayloadToEvidenceDocument({
  title: "",
  confidence: "HIGH",
  fields: {
    year: "2021-22",
    manufacturer: "Panini",
    product: "Impeccable",
    set: "Premier League Soccer",
    players: ["Cristiano Ronaldo"]
  },
  field_evidence: {
    set: {
      value: "Premier League Soccer",
      support_type: "CARD_BACK_PRINTED_TEXT",
      visible_text: "2021-22 PANINI - IMPECCABLE PREMIER LEAGUE SOCCER",
      confidence: 0.95,
      review_required: false
    }
  },
  unresolved: []
}, {
  images: [
    { id: "image-back", side: "back" }
  ]
});
assert.equal(leagueContextSetDocument.evidence.set.value, "Premier League Soccer");
assert.equal(leagueContextSetDocument.evidence.set.status, "REVIEW");
assert.equal(leagueContextSetDocument.evidence.set.confidence, 0.42);
assert.equal(leagueContextSetDocument.evidence.set.sources[0].source_type, "VISUAL_GUESS");
assert.equal(leagueContextSetDocument.evidence.set.sources[0].evidence_kind, "PRODUCT_CONTEXT_TEXT");
assert.equal(leagueContextSetDocument.evidence.set.unresolved_reason, "set_text_is_product_or_sport_context_not_exact_set");

const groundedIdentityMarkersDocument = providerPayloadToEvidenceDocument({
  title: "2024 Bowman Chrome Shohei Ohtani 1st Bowman RC",
  confidence: "HIGH",
  reason: "front card text explicitly states player; printed RC logo and printed 1st Bowman marker are visible",
  fields: {
    year: "2024",
    product: "Bowman Chrome",
    players: ["Shohei Ohtani"],
    rc: true,
    first_bowman: "1st Bowman"
  },
  unresolved: []
}, {
  images: [
    {
      id: "image-front"
    }
  ]
});
assert.deepEqual(groundedIdentityMarkersDocument.resolved.players, ["Shohei Ohtani"]);
assert.equal(groundedIdentityMarkersDocument.resolved.rc, true);
assert.equal(groundedIdentityMarkersDocument.resolved.first_bowman, true);
assert.equal(groundedIdentityMarkersDocument.evidence.rc.sources[0].source_type, "CARD_FRONT");
assert.equal(groundedIdentityMarkersDocument.evidence.first_bowman.sources[0].source_type, "CARD_FRONT");
assert.doesNotThrow(() => assertValidEvidenceDocument(groundedIdentityMarkersDocument));

const providerLegacyCardNameDocument = providerPayloadToEvidenceDocument({
  confidence: "HIGH",
  reason: "front and back printed text explicitly identify the card name and slab label states PSA 10",
  fields: {
    year: "2018-19",
    manufacturer: "Panini",
    product: "Status Basketball",
    players: ["Trae Young"],
    card_name: "New Breed",
    grade: "PSA 10"
  },
  unresolved: []
});
assert.equal(providerLegacyCardNameDocument.resolved.product, "Panini Status");
assert.equal(providerLegacyCardNameDocument.resolved.card_name, "New Breed");
assert.equal(providerLegacyCardNameDocument.resolved.grade_company, "PSA");
assert.equal(providerLegacyCardNameDocument.resolved.card_grade, "10");
assert.equal(providerLegacyCardNameDocument.evidence.card_name.value, "New Breed");
assert.doesNotThrow(() => assertValidEvidenceDocument(providerLegacyCardNameDocument));

const beckettGradeDocument = providerPayloadToEvidenceDocument({
  title: "2021 Panini Test Player Beckett 8.5",
  confidence: "HIGH",
  reason: "slab label states Beckett 8.5",
  fields: {
    year: "2021",
    product: "Panini",
    players: ["Test Player"],
    grade_company: "Beckett",
    card_grade: "8.5"
  },
  unresolved: []
});
assert.equal(beckettGradeDocument.resolved.grade_company, "BGS");
assert.equal(beckettGradeDocument.evidence.grade_company.value, "BGS");
assert.doesNotThrow(() => assertValidEvidenceDocument(beckettGradeDocument));

const gradePhraseCompanyDocument = providerPayloadToEvidenceDocument({
  title: "2010 Panini Test Player GEM MT 10",
  confidence: "HIGH",
  reason: "slab label states GEM MT 10",
  fields: {
    year: "2010",
    product: "Panini",
    players: ["Test Player"],
    grade_company: "GEM MT 10",
    card_grade: "10"
  },
  unresolved: []
});
assert.equal(gradePhraseCompanyDocument.resolved.grade_company, null);
assert.equal(gradePhraseCompanyDocument.resolved.card_grade, "10");
assert.doesNotThrow(() => assertValidEvidenceDocument(gradePhraseCompanyDocument));

const slabParallelDocument = providerPayloadToEvidenceDocument({
  title: "2025 Shohei Ohtani 05/50 PSA 9",
  confidence: "HIGH",
  reason: "Slab label clearly states card as 2025 Topps Sapphire Shohei Ohtani Variation-Gold #1.",
  fields: {
    year: "2025",
    product: "Topps Chrome",
    set: "Sapphire",
    players: ["Shohei Ohtani"],
    serial_number: "05/50",
    grade_company: "PSA",
    card_grade: "9"
  },
  unresolved: []
});
assert.equal(slabParallelDocument.resolved.parallel, "Variation-Gold");
assert.equal(slabParallelDocument.evidence.parallel.value, "Variation-Gold");
assert.equal(slabParallelDocument.evidence.parallel.sources[0].source_type, "SLAB_LABEL");
assert.doesNotThrow(() => assertValidEvidenceDocument(slabParallelDocument));

const slabLabelTextDocument = providerPayloadToEvidenceDocument({
  title: "2025 Shohei Ohtani 05/50 PSA 9",
  confidence: "HIGH",
  reason: "Visible PSA label text '2025 TOPPS SAPPHIRE', 'VARIATION-GOLD', and card face serial '05/50'.",
  fields: {
    year: "2025",
    product: "Topps Chrome",
    set: "Sapphire",
    players: ["Shohei Ohtani"],
    parallel: "Variation-Gold",
    serial_number: "05/50",
    grade_company: "PSA",
    card_grade: "9"
  },
  unresolved: []
});
assert.equal(slabLabelTextDocument.evidence.players.sources[0].source_type, "SLAB_LABEL");
assert.equal(slabLabelTextDocument.evidence.parallel.sources[0].source_type, "SLAB_LABEL");
assert.doesNotThrow(() => assertValidEvidenceDocument(slabLabelTextDocument));

const structuredDescriptorDocument = providerPayloadToEvidenceDocument({
  title: "2025 Topps Finest Shohei Ohtani Gusto Red Refractor",
  confidence: "HIGH",
  reason: "front card text explicitly states Topps Finest and printed parallel Red Refractor",
  fields: {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Finest",
    players: ["Shohei Ohtani"],
    card_type: "Insert",
    variation: "Red Refractor"
  },
  unresolved: []
});
assert.equal(structuredDescriptorDocument.resolved.manufacturer, "Topps");
assert.equal(structuredDescriptorDocument.resolved.brand, "Topps");
assert.equal(structuredDescriptorDocument.resolved.card_type, "Insert");
assert.equal(structuredDescriptorDocument.resolved.variation, "Red Refractor");
assert.equal(structuredDescriptorDocument.evidence.variation.value, "Red Refractor");
assert.equal(structuredDescriptorDocument.evidence.variation.sources[0].source_type, "CARD_FRONT");
assert.doesNotThrow(() => assertValidEvidenceDocument(structuredDescriptorDocument));

const structuredProviderFieldsDocument = providerPayloadToEvidenceDocument({
  title: "2024 Topps Chrome Test Player Auto Purple Refractor 31/50 PSA 10",
  confidence: "HIGH",
  reason: "front printed text supports Autograph and printed parallel Purple Refractor; slab label states PSA 10",
  fields: {
    year: "2024",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Test Player"],
    card_type: "Autograph",
    surface_color: "Purple",
    parallel_family: "Refractor",
    parallel_exact: "Purple Refractor",
    serial_number: "31/50",
    grade_company: "PSA",
    card_grade: "10",
    auto: true
  },
  unresolved: []
});
assert.equal(structuredProviderFieldsDocument.resolved.manufacturer, "Topps");
assert.equal(structuredProviderFieldsDocument.resolved.card_type, "Autograph");
assert.equal(structuredProviderFieldsDocument.resolved.surface_color, "Purple");
assert.equal(structuredProviderFieldsDocument.resolved.parallel_family, "Refractor");
assert.equal(structuredProviderFieldsDocument.resolved.parallel_exact, "Purple Refractor");
assert.equal(structuredProviderFieldsDocument.evidence.card_type.value, "Autograph");
assert.equal(structuredProviderFieldsDocument.evidence.parallel_exact.value, "Purple Refractor");
assert.doesNotThrow(() => assertValidEvidenceDocument(structuredProviderFieldsDocument));

const gradeMisroutedAsChecklistDocument = providerPayloadToEvidenceDocument({
  title: "2024 Topps Chrome Test Player PSA 10",
  confidence: "HIGH",
  reason: "slab label states PSA 10",
  fields: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Test Player"],
    checklist_code: "PSA-10",
    grade_company: "PSA"
  },
  unresolved: []
});
assert.equal(gradeMisroutedAsChecklistDocument.resolved.checklist_code, null);
assert.equal(gradeMisroutedAsChecklistDocument.resolved.grade_company, "PSA");
assert.equal(gradeMisroutedAsChecklistDocument.resolved.card_grade, "10");
assert.equal(gradeMisroutedAsChecklistDocument.evidence.checklist_code, undefined);
assert.equal(gradeMisroutedAsChecklistDocument.evidence.card_grade.value, "10");
assert.doesNotThrow(() => assertValidEvidenceDocument(gradeMisroutedAsChecklistDocument));

const visualColorDescriptorDocument = providerPayloadToEvidenceDocument({
  title: "2025 Panini Prizm Lionel Messi Blue Refractor 029/199",
  confidence: "HIGH",
  reason: "Visible text confirms 2025-26 Panini Prizm FIFA Club Legends set and Lionel Messi. Front image shows blue refractor parallel.",
  fields: {
    year: "2025-26",
    product: "Prizm FIFA Soccer",
    players: ["Lionel Messi"],
    parallel: "Blue Refractor",
    serial_number: "029/199"
  },
  unresolved: []
});
assert.equal(visualColorDescriptorDocument.evidence.parallel.sources[0].source_type, "VISION_MODEL");
assert.doesNotThrow(() => assertValidEvidenceDocument(visualColorDescriptorDocument));

const frontBackConfirmSubjectDocument = providerPayloadToEvidenceDocument({
  title: "2025 Topps Chrome Victor Wembanyama 17/50",
  confidence: "HIGH",
  reason: "Front and back images confirm player name, team, and product details.",
  fields: {
    year: "2025",
    product: "Topps Chrome",
    players: ["Victor Wembanyama"],
    serial_number: "17/50"
  },
  unresolved: []
});
assert.equal(frontBackConfirmSubjectDocument.evidence.players.sources[0].source_type, "CARD_FRONT");
assert.equal(frontBackConfirmSubjectDocument.evidence.product.sources[0].source_type, "CARD_FRONT");
assert.doesNotThrow(() => assertValidEvidenceDocument(frontBackConfirmSubjectDocument));

const multiCardDocument = providerPayloadToEvidenceDocument({
  title: "Card lot requires review",
  confidence: "HIGH",
  fields: {
    multi_card: true,
    card_count: 3,
    lot_type: "mixed player lot"
  },
  unresolved: ["multiple cards visible"]
});
assert.equal(multiCardDocument.resolved.multi_card, true);
assert.equal(multiCardDocument.resolved.card_count, 3);
assert.equal(multiCardDocument.evidence.multi_card.status, "CONFIRMED");
assert.equal(multiCardDocument.evidence.card_count.value, "3");
assert.doesNotThrow(() => assertValidEvidenceDocument(multiCardDocument));

assert.throws(
  () => assertValidEvidenceDocument({
    evidence: {
      year: {
        ...evidenceField,
        confidence: 2
      }
    },
    resolved: {
      ...resolved,
      grade_type: "MINT"
    }
  }),
  /Evidence document validation failed/
);

console.log("evidence schema tests passed");
