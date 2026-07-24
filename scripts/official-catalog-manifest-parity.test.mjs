import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildOfficialCatalogManifestParity,
  loadOfficialCatalogManifestEntries
} from "./audit-official-catalog-manifest-parity.mjs";
import { validateOfficialCatalogManifestSet } from "../lib/listing/catalog/official-manifest-contract.mjs";
import { officialCatalogSourceProfiles } from "../lib/listing/catalog/official-catalog-source-adapter.mjs";

const repositoryEntries = await loadOfficialCatalogManifestEntries();
const repository = validateOfficialCatalogManifestSet(repositoryEntries, {
  providerProfiles: officialCatalogSourceProfiles
});
assert.equal(repository.valid, true, JSON.stringify(repository.errors));
assert.equal(repository.manifest_count, 9);
assert.equal(repository.source_count, 24);
assert.ok(repositoryEntries.some(({ manifest }) => manifest.provider === "battle_spirits"));

const source = {
  source_name: "Official Set One",
  source_url: "https://official.example/cards?set=one",
  source_type: "TOPPS_OFFICIAL_CHECKLIST",
  category: "baseball",
  minimum_card_count: 2,
  minimum_promotion_candidate_count: 2,
  maximum_review_required_count: 0,
  required_records: [
    { card_number: "ONE-001" },
    { card_number: "ONE-002" }
  ]
};
const entries = [{ file: "topps-production-sources.json", manifest: { provider: "topps", sources: [source] } }];
const productionSource = {
  id: "source-one",
  source_name: source.source_name,
  source_url: source.source_url,
  source_type: source.source_type
};
const cleanParity = buildOfficialCatalogManifestParity({
  manifestEntries: entries,
  productionSources: [productionSource],
  catalogCards: [{ id: "card-1", source_id: "source-one" }, { id: "card-2", source_id: "source-one" }]
});
assert.equal(cleanParity.valid, true);
assert.equal(cleanParity.summary.manifest_source_count, 1);
assert.equal(cleanParity.summary.production_official_source_count, 1);

const invalidRepository = validateOfficialCatalogManifestSet([
  ...entries,
  { file: "duplicate-production-sources.json", manifest: { provider: "topps", sources: [{ ...source }] } }
], { providerProfiles: officialCatalogSourceProfiles });
assert.equal(invalidRepository.valid, false);
assert.ok(invalidRepository.errors.some(({ code }) => code === "official_manifest_provider_duplicate"));
assert.ok(invalidRepository.errors.some(({ code }) => code === "official_manifest_source_url_duplicate"));

const mismatchedProfile = validateOfficialCatalogManifestSet([{
  file: "bad-production-sources.json",
  manifest: {
    provider: "topps",
    sources: [{ ...source, source_type: "PANINI_OFFICIAL_CHECKLIST" }]
  }
}], { providerProfiles: officialCatalogSourceProfiles });
assert.ok(mismatchedProfile.errors.some(({ code }) => code === "official_manifest_provider_source_type_mismatch"));

const driftedParity = buildOfficialCatalogManifestParity({
  manifestEntries: entries,
  productionSources: [{ ...productionSource, source_name: "Wrong Name", source_type: "PANINI_OFFICIAL_CHECKLIST" }, {
    id: "source-extra",
    source_name: "Untracked Official Source",
    source_url: "https://official.example/cards?set=extra",
    source_type: "TOPPS_OFFICIAL_CHECKLIST"
  }],
  catalogCards: [{ id: "card-1", source_id: "source-one" }]
});
assert.equal(driftedParity.valid, false);
assert.equal(driftedParity.summary.production_missing_manifest_count, 1);
assert.equal(driftedParity.summary.metadata_mismatch_count, 1);
assert.equal(driftedParity.summary.underfilled_source_count, 1);

const importWorkflow = await readFile(".github/workflows/import-official-catalog.yml", "utf8");
assert.match(importWorkflow, /- battle_spirits/);
assert.match(importWorkflow, /environment: production/);
assert.match(importWorkflow, /Fail closed for production writes outside current main/);
assert.match(importWorkflow, /test "\$DISPATCH_REF" = "refs\/heads\/main"/);
assert.match(importWorkflow, /test "\$\(git rev-parse origin\/main\)" = "\$DISPATCH_SHA"/);
assert.match(importWorkflow, /Prove post-apply idempotence/);
assert.match(importWorkflow, /verified_existing_source_count !== 1/);
assert.match(importWorkflow, /Prove repository and production catalog parity/);
assert.match(importWorkflow, /audit-official-catalog-manifest-parity\.mjs/);
assert.match(importWorkflow, /catalog-operational-coverage\.mjs/);
assert.match(importWorkflow, /Prove every official source remains retrievable/);
assert.match(importWorkflow, /audit-official-catalog-retrieval-sentinels\.mjs/);

console.log("official catalog manifest parity tests passed");
