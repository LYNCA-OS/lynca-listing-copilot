import assert from "node:assert/strict";
import { evaluateTitleAcceptance } from "../lib/listing/evaluation/title-acceptance-policy.mjs";

const commercialTitleFields = {
  year: "2023-24",
  brand: "Panini",
  product: "Prizm",
  players: ["Victor Wembanyama"],
  parallel: "Silver Prizm",
  card_grade: "10",
  grade_company: "PSA",
  final_title_required_fields: true,
  final_title_unsubstantiated_fields: false
};
const criticalFields = [
  "year",
  "brand",
  "product",
  "players",
  "parallel",
  "grade_company",
  "card_grade",
  "final_title_required_fields",
  "final_title_unsubstantiated_fields"
];

const nearTitle = evaluateTitleAcceptance({
  title: "23-24 Prizm Wembanyama Silver PSA 10",
  groundTruthFields: commercialTitleFields,
  predictedFields: commercialTitleFields,
  criticalFields
});
assert.equal(nearTitle.accepted, true);
assert.equal(nearTitle.required_fields_present, true);
assert.equal(nearTitle.unsubstantiated_critical_errors, false);

const marketplaceShorthandTitle = evaluateTitleAcceptance({
  title: "2023 Panini Prizm Victor Wembanyama #136 Silver Rookie PSA 9 MINT",
  groundTruthFields: {
    ...commercialTitleFields,
    collector_number: "136",
    rc: true
  },
  predictedFields: {
    ...commercialTitleFields,
    year: "2023",
    parallel: "Silver",
    collector_number: "136",
    rc: true
  },
  criticalFields: [
    "year",
    "brand",
    "product",
    "players",
    "parallel",
    "collector_number",
    "rc"
  ]
});
assert.equal(marketplaceShorthandTitle.accepted, true);
assert.equal(marketplaceShorthandTitle.required_fields_present, true);
assert.equal(marketplaceShorthandTitle.unsubstantiated_critical_errors, false);

const wrongColor = evaluateTitleAcceptance({
  title: "2023-24 Panini Prizm Victor Wembanyama Gold Wave PSA 10",
  groundTruthFields: commercialTitleFields,
  predictedFields: {
    ...commercialTitleFields,
    parallel: "Gold Wave"
  },
  criticalFields
});
assert.equal(wrongColor.accepted, false);
assert.equal(wrongColor.required_fields_present, false);
assert.equal(wrongColor.unsubstantiated_critical_errors, true);
assert.ok(wrongColor.critical_errors.some((error) => error.type === "unexpected_color" && error.value === "gold"));
assert.ok(wrongColor.critical_errors.some((error) => error.field === "parallel" && error.type === "predicted_field_conflicts_with_ground_truth"));

const wrongName = evaluateTitleAcceptance({
  title: "2023-24 Panini Prizm Victor Wenbanyama Silver PSA 10",
  groundTruthFields: commercialTitleFields,
  predictedFields: {
    ...commercialTitleFields,
    players: ["Victor Wenbanyama"]
  },
  criticalFields
});
assert.equal(wrongName.accepted, false);
assert.equal(wrongName.required_fields_present, false);
assert.equal(wrongName.unsubstantiated_critical_errors, true);
assert.ok(wrongName.missing_required_fields.some((item) => item.field === "players"));
assert.ok(wrongName.critical_errors.some((error) => error.field === "players"));

const wrongBrandField = evaluateTitleAcceptance({
  title: "23-24 Prizm Wembanyama Silver PSA 10",
  groundTruthFields: commercialTitleFields,
  predictedFields: {
    ...commercialTitleFields,
    brand: "Topps"
  },
  criticalFields
});
assert.equal(wrongBrandField.accepted, false);
assert.equal(wrongBrandField.required_fields_present, true);
assert.equal(wrongBrandField.unsubstantiated_critical_errors, true);
assert.ok(wrongBrandField.critical_errors.some((error) => error.field === "brand"));

const wrongYearField = evaluateTitleAcceptance({
  title: "2013 Topps Chrome Shohei Ohtani Rookie Card",
  groundTruthFields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Refractor",
    collector_number: "1",
    rc: false
  },
  predictedFields: {
    year: "2013",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    rc: true
  },
  criticalFields: ["year", "brand", "product", "players", "parallel", "collector_number", "rc"]
});
assert.equal(wrongYearField.accepted, false);
assert.equal(wrongYearField.unsubstantiated_critical_errors, true);
assert.ok(wrongYearField.critical_errors.some((error) => error.field === "year"));
assert.ok(wrongYearField.critical_errors.some((error) => error.field === "rc"));

const colorInSetName = evaluateTitleAcceptance({
  title: "2023 Topps Black Gold Shohei Ohtani",
  groundTruthFields: {
    year: "2023",
    product: "Topps",
    set: "Black Gold",
    players: ["Shohei Ohtani"]
  },
  predictedFields: {
    year: "2023",
    product: "Topps",
    set: "Black Gold",
    players: ["Shohei Ohtani"]
  },
  criticalFields: ["year", "product", "set", "players"]
});
assert.equal(colorInSetName.accepted, true);
assert.equal(colorInSetName.unsubstantiated_critical_errors, false);

const productShorthand = evaluateTitleAcceptance({
  title: "2025 Topps Chrome Shohei Ohtani #1 Refractor PSA 10 Gem Mint",
  groundTruthFields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Refractor",
    collector_number: "1"
  },
  predictedFields: {
    year: "2025",
    brand: "Topps",
    product: "Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Refractor",
    collector_number: "1",
    grade_company: "PSA",
    card_grade: "10"
  },
  criticalFields: ["year", "brand", "product", "players", "parallel", "collector_number"]
});
assert.equal(productShorthand.accepted, true);
assert.equal(productShorthand.unsubstantiated_critical_errors, false);

const missingCollectorNumber = evaluateTitleAcceptance({
  title: "2025 Topps Chrome Shohei Ohtani Refractor PSA 10 Gem Mint",
  groundTruthFields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Refractor",
    collector_number: "1"
  },
  predictedFields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Refractor",
    collector_number: ""
  },
  criticalFields: ["year", "brand", "product", "players", "parallel", "collector_number"]
});
assert.equal(missingCollectorNumber.accepted, false);
assert.ok(missingCollectorNumber.missing_required_fields.some((item) => item.field === "collector_number"));

const missingSerial = evaluateTitleAcceptance({
  title: "2025 Topps Chrome Cooper Flagg Rookie Auto",
  groundTruthFields: {
    year: "2025",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    card_type: "Rookie Auto",
    serial_number: "31/50"
  },
  predictedFields: {
    year: "2025",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    card_type: "Rookie Auto",
    serial_number: "31/50"
  },
  criticalFields: ["year", "product", "players", "card_type", "serial_number", "final_title_required_fields"]
});
assert.equal(missingSerial.accepted, false);
assert.equal(missingSerial.required_fields_present, false);
assert.ok(missingSerial.missing_required_fields.some((item) => item.field === "serial_number"));

console.log("title acceptance policy tests passed");
