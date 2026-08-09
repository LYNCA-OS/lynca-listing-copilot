#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildTypedAccuracyEvidenceReport,
  typedAccuracyInputFromResidualV3Analysis
} from "../lib/listing/evaluation/typed-accuracy-evidence-ruler.mjs";
import {
  cardMaterialSha256,
  conceptRegistrySha256,
  criticalPolicySha256,
  RULER_BUNDLE_SHA256,
  rulerApprovalManifestSha256,
  scoreSemanticPublicationCard
} from "../lib/listing/evaluation/semantic-publication-ruler.mjs";

const pairedCards = [
  {
    asset_id: "asset-1",
    reference_title: "2024 Topps Ohtani Gold 10/10",
    baseline_title: "2024 Topps Ohtani Gold 10/10",
    candidate_title: "2024 Topps Ohtani Gold 10/10",
    baseline_fields: { year: "2024", subject: "Ohtani", print_finish: "Gold" },
    candidate_fields: { year: "2024", subject: "Ohtani", print_finish: "Gold" },
    baseline_drop_ledger: { dropped_for_budget: [], truncated: false },
    candidate_drop_ledger: { dropped_for_budget: [], truncated: false },
    safety: {
      critical: false,
      reference_losses: [],
      unbacked_new_tokens: [],
      unsupported_numeric_changes: [],
      over_80: false
    }
  },
  {
    asset_id: "asset-2",
    reference_title: "2025 Bowman Player Gold 5/5",
    baseline_title: "2025 Bowman Player Gold 5/5",
    candidate_title: "2025 Bowman Player Blue 4/5",
    baseline_fields: { year: "2025", subject: "Player", print_finish: "Gold", serial: "5/5" },
    candidate_fields: { year: "2025", subject: "Player", print_finish: "Blue", serial: "4/5" },
    baseline_drop_ledger: { dropped_for_budget: [], truncated: false },
    candidate_drop_ledger: { dropped_for_budget: ["print_finish"], truncated: true },
    safety: {
      critical: true,
      reference_losses: ["gold", "5/5"],
      unbacked_new_tokens: ["blue", "4/5"],
      unsupported_numeric_changes: ["5/5", "4/5"],
      over_80: false
    }
  }
];

const concepts = [
  { id: "year:2024", field: "year", label: "2024" },
  { id: "year:2025", field: "year", label: "2025" },
  { id: "finish:gold", field: "print_finish", label: "Gold" },
  { id: "finish:blue", field: "print_finish", label: "Blue" },
  { id: "finish:red", field: "print_finish", label: "Red" }
];
const criticalPolicy = {
  policy_id: "typed-ruler-test-policy-v1",
  status: "FROZEN_APPROVED",
  fields: ["year", "print_finish"]
};
criticalPolicy.sha256 = criticalPolicySha256(criticalPolicy);
const conceptRegistry = {
  registry_id: "typed-ruler-test-registry-v1",
  status: "FROZEN_APPROVED",
  concepts
};
conceptRegistry.sha256 = conceptRegistrySha256(conceptRegistry);
const grammarCheckerId = "typed-ruler-test-grammar-v1";
const grammarCheckerSha256 = "a".repeat(64);
const approvalBase = {
  manifest_id: "typed-ruler-test-manifest-v1",
  status: "SEALED_APPROVED",
  ruler_version: "semantic-publication-ruler-v1",
  scorer_bundle_sha256: RULER_BUNDLE_SHA256,
  critical_policy_sha256: criticalPolicy.sha256,
  concept_registry_sha256: conceptRegistry.sha256,
  grammar_checker_id: grammarCheckerId,
  grammar_checker_sha256: grammarCheckerSha256,
  cohort_selection_sha256: "b".repeat(64),
  gold_coverage_report_sha256: "c".repeat(64),
  annotation_packet_sha256: "d".repeat(64),
  arm_outputs_sha256: "e".repeat(64)
};
const approvalFor = (materialByAsset) => {
  const manifest = { ...approvalBase, card_material_sha256_by_asset: materialByAsset };
  manifest.sha256 = rulerApprovalManifestSha256(manifest);
  return manifest;
};
const traceTitleClaims = (claims) => {
  let title = "";
  const traced = claims.map((claim) => {
    if (title) title += " ";
    const start = title.length;
    const renderedText = claim.value;
    title += renderedText;
    return { ...claim, rendered_text: renderedText, title_spans: [{ start, end: title.length }],
      source_fields: [claim.field], transform_codes: ["EXACT_OR_ALIAS"], emission_status: "FULL" };
  });
  return { title, claims: traced };
};
const scoreInput = ({ asset_id, annotations, canonical_claims, title_claims }) => {
  const traced = traceTitleClaims(title_claims);
  return {
    asset_id,
    physical_card_id: `physical-${asset_id}`,
    annotations: annotations.map((annotation, index) => ({
      truth_source: "CARD_IMAGE",
      evidence_refs: [`asset:${asset_id}#claim-${index}`],
      adjudicated: true,
      ...annotation
    })),
    canonical_claims,
    title_claims: traced.claims,
    title_text: traced.title,
    annotation_complete: true,
    title_constraints: {
      grammar_checker_id: grammarCheckerId,
      grammar_checker_sha256: grammarCheckerSha256,
      checked_title_sha256: createHash("sha256").update(traced.title).digest("hex"),
      grammar_violation_codes: []
    }
  };
};
const semanticInputs = [
  scoreInput({
    asset_id: "asset-1",
    annotations: [
      { field: "year", concept_id: "year:2024", value: "2024", truth_status: "SUPPORTED",
        title_policy: "REQUIRED" },
      { field: "print_finish", concept_id: "finish:gold", value: "Gold",
        truth_status: "SUPPORTED", title_policy: "REQUIRED" }
    ],
    canonical_claims: [
      { field: "year", concept_id: "year:2024", value: "2024" },
      { field: "print_finish", concept_id: "finish:gold", value: "Gold" }
    ],
    title_claims: [
      { field: "year", concept_id: "year:2024", value: "2024" },
      { field: "print_finish", concept_id: "finish:gold", value: "Gold" }
    ]
  }),
  scoreInput({
    asset_id: "asset-2",
    annotations: [
      { field: "year", concept_id: "year:2025", value: "2025", truth_status: "SUPPORTED",
        title_policy: "REQUIRED" },
      { field: "print_finish", concept_id: "finish:gold", value: "Gold",
        truth_status: "SUPPORTED", title_policy: "REQUIRED" },
      { field: "print_finish", concept_id: "finish:blue", value: "Blue",
        truth_status: "CONTRADICTED", title_policy: "NOT_APPLICABLE" },
      { field: "print_finish", concept_id: "finish:red", value: "Red", truth_status: "UNKNOWN",
        title_policy: "NOT_APPLICABLE" }
    ],
    canonical_claims: [
      { field: "year", concept_id: "year:2025", value: "2025" },
      { field: "print_finish", concept_id: "finish:blue", value: "Blue" },
      { field: "print_finish", concept_id: "finish:red", value: "Red" }
    ],
    title_claims: [{ field: "year", concept_id: "year:2025", value: "2025" }]
  })
];
const materialByAsset = Object.fromEntries(semanticInputs.map((input) => [
  input.asset_id, cardMaterialSha256(input)
]));
const approvalManifest = approvalFor(materialByAsset);
const semanticCards = semanticInputs.map((input) => scoreSemanticPublicationCard({
  ...input,
  concept_registry: conceptRegistry,
  critical_policy: criticalPolicy,
  approval_manifest: approvalManifest,
  expected_approval_manifest_sha256: approvalManifest.sha256
}));

const report = buildTypedAccuracyEvidenceReport({
  cohort_id: "synthetic-2",
  paired_cards: pairedCards,
  semantic_publication_cards: semanticCards,
  wrong_role_reviews: [
    { asset_id: "asset-1", audit_complete: true, adjudicated: true,
      confirmed_wrong_role_count: 0 },
    { asset_id: "asset-2", audit_complete: true, adjudicated: true,
      confirmed_wrong_role_count: 1 }
  ]
});

assert.equal(report.production_promotion_allowed, false);
assert.equal(report.absolute_accuracy_over_90_claim, null);
assert.equal(report.independent_gold_metrics.availability, "COMPLETE");
assert.equal(report.independent_gold_metrics.critical_factual_error_cards.value, 1);
assert.equal(report.independent_gold_metrics.typed_field_verified_precision.value, 0.75);
assert.equal(report.independent_gold_metrics.typed_field_exact_recall.value, 0.75);
assert.equal(report.independent_gold_metrics.required_missing_claims.value, 1);
assert.equal(report.independent_gold_metrics.wrong_role_claims.value, 1);
assert.equal(report.independent_gold_metrics.by_field.print_finish.verified_claim_precision, 0.5);
assert.equal(report.independent_gold_metrics.by_field.print_finish.exact_fact_recall, 0.5);
assert.equal(report.diagnostic_proxies.critical_error_proxy_cards.value, 1);
assert.equal(report.diagnostic_proxies.reference_loss_cards.value, 1);
assert.equal(report.diagnostic_proxies.unbacked_new_token_cards.value, 1);
assert.equal(report.diagnostic_proxies.numeric_mutation_cards.value, 1);
assert.equal(report.diagnostic_proxies.titles_over_80.value, 0);
assert.equal(report.diagnostic_proxies.composer_drop_ledger.cards_with_new_budget_drops, 1);
assert.equal(report.diagnostic_proxies.composer_drop_ledger.truncated_cards, 1);
assert.equal(report.diagnostic_proxies.exact_field_fidelity_cards.value, 1);
assert.equal(report.legacy_f1_trend.wins, 0);
assert.equal(report.legacy_f1_trend.losses, 1);

const proxyOnly = buildTypedAccuracyEvidenceReport({ paired_cards: pairedCards });
assert.equal(proxyOnly.independent_gold_metrics.availability, "UNAVAILABLE");
assert.equal(proxyOnly.independent_gold_metrics.critical_factual_error_cards.value, null,
  "missing gold is unknown, never zero");
assert.equal(proxyOnly.independent_gold_metrics.typed_field_verified_precision.value, null);
assert.equal(proxyOnly.independent_gold_metrics.typed_field_exact_recall.value, null);
assert.equal(proxyOnly.independent_gold_metrics.required_missing_claims.value, null);
assert.equal(proxyOnly.independent_gold_metrics.required_claims, null);
assert.equal(proxyOnly.independent_gold_metrics.unresolved_prediction_claims, null);
assert.equal(proxyOnly.independent_gold_metrics.wrong_role_claims.value, null);
assert.ok(proxyOnly.promotion_blockers.includes("independent_typed_gold_incomplete"));

const staleSemanticCards = structuredClone(semanticCards);
delete staleSemanticCards[0].recognition.exact_fact_satisfied_count;
assert.throws(() => buildTypedAccuracyEvidenceReport({
  paired_cards: pairedCards,
  semantic_publication_cards: staleSemanticCards
}), /typed_ruler_spg_receipt_invalid:recognition_exact_fact_satisfied_count/,
"incomplete scorer counters must not be accepted as typed gold");

const fakeSchema = structuredClone(semanticCards);
fakeSchema[0].schema_version = "not-spg";
assert.throws(() => buildTypedAccuracyEvidenceReport({
  paired_cards: pairedCards,
  semantic_publication_cards: fakeSchema
}), /typed_ruler_spg_receipt_invalid:schema_version/,
"an eligible-shaped object is not an SPG receipt");

const forgedMaterial = structuredClone(semanticCards);
forgedMaterial[0].approval_manifest.materials_match = false;
assert.throws(() => buildTypedAccuracyEvidenceReport({
  paired_cards: pairedCards,
  semantic_publication_cards: forgedMaterial
}), /typed_ruler_spg_receipt_invalid:card_material/);

const duplicatePhysicalCard = structuredClone(semanticCards);
duplicatePhysicalCard[1].physical_card_id = duplicatePhysicalCard[0].physical_card_id;
assert.throws(() => buildTypedAccuracyEvidenceReport({
  paired_cards: pairedCards,
  semantic_publication_cards: duplicatePhysicalCard
}), /typed_ruler_spg_receipt_invalid:duplicate_physical_card_id/);

assert.throws(() => buildTypedAccuracyEvidenceReport({
  paired_cards: [{
    asset_id: "over-80",
    baseline_title: "short",
    candidate_title: "X".repeat(81),
    safety: { over_80: false }
  }]
}), /typed_ruler_over_80_mismatch:over-80/,
"a caller cannot override literal title length");
const derivedOver80 = buildTypedAccuracyEvidenceReport({
  paired_cards: [{ asset_id: "over-80", baseline_title: "short", candidate_title: "X".repeat(81) }]
});
assert.equal(derivedOver80.diagnostic_proxies.titles_over_80.value, 1);

const residualAnalysis = {
  schema_version: "model-residual-candidate-v3-35x3-analysis-v1",
  validated_run: { run_fingerprint: "run-1" },
  cards: [{
    asset_id: "asset-r",
    reference: "2025 Topps Player 1st",
    titles: {
      residual_c_canonical: "2025 Topps Player",
      residual_c_resolved: "2025 Topps Player 1st"
    },
    safety: {
      critical: false,
      reference_losses: [],
      unbacked_new_tokens: [],
      unsupported_numeric_changes: [],
      over_80: false
    }
  }]
};
const adapted = typedAccuracyInputFromResidualV3Analysis(residualAnalysis, "analysis.json");
const adaptedReport = buildTypedAccuracyEvidenceReport(adapted);
assert.equal(adaptedReport.independent_gold_metrics.availability, "UNAVAILABLE");
assert.equal(adaptedReport.legacy_f1_trend.wins, 1);
assert.equal(adaptedReport.diagnostic_proxies.exact_field_fidelity_cards.value, null);
assert.equal(adaptedReport.diagnostic_proxies.composer_drop_ledger.cards_with_budget_drops, null);

const temp = await mkdtemp(join(tmpdir(), "typed-accuracy-ruler-"));
const inputPath = join(temp, "analysis.json");
const outPath = join(temp, "report.json");
await writeFile(inputPath, `${JSON.stringify(residualAnalysis)}\n`);
const cli = spawnSync(process.execPath, [
  "scripts/analyze-typed-accuracy-evidence.mjs",
  "--input", inputPath,
  "--out", outPath
], { encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /"production_promotion_allowed": false/);
const written = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(written.independent_gold_metrics.typed_field_exact_recall.value, null);
assert.equal(written.legacy_f1_trend.wins, 1);

const forgedInputPath = join(temp, "forged-semantic.json");
await writeFile(forgedInputPath, `${JSON.stringify({
  paired_cards: pairedCards,
  semantic_publication_cards: fakeSchema
})}\n`);
const forgedCli = spawnSync(process.execPath, [
  "scripts/analyze-typed-accuracy-evidence.mjs",
  "--input", forgedInputPath
], { encoding: "utf8" });
assert.notEqual(forgedCli.status, 0, "the generic CLI must reject a forged SPG schema");
assert.match(forgedCli.stderr, /typed_ruler_spg_receipt_invalid:schema_version/);

console.log("typed accuracy evidence ruler: ok");
