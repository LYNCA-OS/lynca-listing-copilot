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

const evidenceField = createEvidenceField({
  value: "31/50",
  confidence: 0.82,
  sources: [
    createVisionSource({
      imageId: "image-front",
      side: "front",
      region: "serial_number",
      observedText: "31/50",
      glareOcclusion: 0.06,
      blurScore: 0.04,
      trustTier: 1
    })
  ]
});
assert.equal(validateEvidenceField(evidenceField).length, 0);

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
  grade: "10",
  auto: true
});
assert.equal(resolved.year, "2024");
assert.deepEqual(resolved.players, ["Shohei Ohtani"]);
assert.equal(resolved.checklist_code, "UV-16");
assert.equal(resolved.serial_number, "31/50");
assert.equal(resolved.card_grade, "10");
assert.equal(resolved.auto, true);
assert.equal(validateResolvedFields(resolved).length, 0);

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
