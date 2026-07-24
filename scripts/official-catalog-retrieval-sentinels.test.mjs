import assert from "node:assert/strict";
import { loadOfficialCatalogManifestEntries } from "./audit-official-catalog-manifest-parity.mjs";
import {
  auditOfficialCatalogRetrievalSentinels,
  buildOfficialCatalogRetrievalSentinelPlan,
  officialCatalogCandidateMatchesSentinel
} from "./audit-official-catalog-retrieval-sentinels.mjs";

const repositoryPlan = buildOfficialCatalogRetrievalSentinelPlan(await loadOfficialCatalogManifestEntries());
assert.equal(repositoryPlan.length, 69);
assert.equal(repositoryPlan.filter((sentinel) => sentinel.plan_error).length, 0);
assert.equal(repositoryPlan.filter((sentinel) => sentinel.provider === "dragon_ball_masters").length, 25);

const sentinel = {
  source_type: "TOPPS_OFFICIAL_CHECKLIST",
  record: {
    checklist_code: "CB-PK",
    subject: "Paul Kasey",
    product: "Topps Star Wars Smugglers Outpost",
    set_or_insert: "Chrome Black Autograph"
  }
};
const matchingCandidate = {
  candidate_id: "catalog-one",
  title: "2025 Topps Star Wars Smugglers Outpost Paul Kasey #CB-PK",
  normalized_score: 0.86,
  fields: {
    checklist_code: "CB-PK",
    collector_number: "CB-PK",
    players: ["Paul Kasey"],
    card_name: "Smugglers Outpost",
    product: "Topps Star Wars Smugglers Outpost",
    set: "Chrome Black Autograph"
  },
  reference_metadata: { source_type: "TOPPS_OFFICIAL_CHECKLIST" }
};
assert.equal(officialCatalogCandidateMatchesSentinel(matchingCandidate, sentinel), true);
assert.equal(officialCatalogCandidateMatchesSentinel({
  ...matchingCandidate,
  reference_metadata: { source_type: "PANINI_OFFICIAL_CHECKLIST" }
}, sentinel), false);
assert.equal(officialCatalogCandidateMatchesSentinel({
  ...matchingCandidate,
  fields: { ...matchingCandidate.fields, checklist_code: "WRONG", collector_number: "WRONG" }
}, sentinel), false);

const entries = [{
  file: "topps-production-sources.json",
  manifest: {
    provider: "topps",
    sources: [{
      source_name: "Official Set One",
      source_url: "https://official.example/set-one",
      source_type: "TOPPS_OFFICIAL_CHECKLIST",
      category: "entertainment",
      required_records: [{ ...sentinel.record, expected_import_status: "OFFICIAL_CHECKLIST_CANDIDATE" }]
    }]
  }
}];
const passingAudit = await auditOfficialCatalogRetrievalSentinels({
  manifestEntries: entries,
  provider: { search: async () => ({ candidates: [matchingCandidate] }) }
});
assert.equal(passingAudit.valid, true);
assert.equal(passingAudit.passed_source_count, 1);

const failingAudit = await auditOfficialCatalogRetrievalSentinels({
  manifestEntries: entries,
  provider: { search: async () => ({ candidates: [] }) }
});
assert.equal(failingAudit.valid, false);
assert.equal(failingAudit.failed_source_count, 1);
assert.equal(failingAudit.results[0].reason, "official_retrieval_sentinel_not_found");

console.log("official catalog retrieval sentinel tests passed");
