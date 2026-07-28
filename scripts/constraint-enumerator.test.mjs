#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildForwardEnumerationCandidatePacket,
  enumerateProduct,
  enumerateTeam,
  outcomes
} from "../lib/listing/catalog/constraint-enumerator.mjs";
import { attachForwardEnumerationCandidates } from "../lib/listing/catalog/forward-enumeration-adapter.mjs";
import { constraintModelSnapshot, loadConstraintModelSnapshot } from "../lib/listing/catalog/constraint-model-store.mjs";

const model = {
  schema_version: "constraint-model-v1",
  source_card_count: 100,
  team_value_contract: {
    schema_version: "team-identity-semantics-v1",
    semantic_values_validated: true,
    subject_coverage_exhaustive: true
  },
  player_teams: {
    "victor wembanyama": ["san antonio spurs"],
    "tom brady": ["new england patriots", "tampa bay buccaneers"]
  },
  player_team_years: {
    "tom brady": { 2005: ["new england patriots"], 2026: ["new england patriots", "tampa bay buccaneers"] }
  },
  set_product_years: {
    "fade to black": ["2025|panini phoenix"],
    "refractor": ["2024|topps chrome", "2025|bowman chrome"]
  }
};

test("VALUE carries versioned provenance", () => {
  const value = enumerateTeam({ subject: "Victor Wembanyama", sport: "basketball" }, model);
  assert.equal(value.status, outcomes.VALUE);
  assert.equal(value.value, "san antonio spurs");
  assert.equal(value.provenance.source, "CATALOG_CONSTRAINT_SNAPSHOT");
  assert.equal(value.provenance.version, "constraint-model-v1");
});

test("EMPTY and UNKNOWN never collapse", () => {
  assert.equal(enumerateTeam({ subject: "Mickey Mouse", sport: "entertainment" }, model).status, outcomes.EMPTY);
  const unknown = enumerateTeam({ subject: "Unknown Rookie", sport: "basketball" }, model);
  assert.equal(unknown.status, outcomes.UNKNOWN);
  assert.equal(unknown.value, null);
});

test("year can narrow product while same-year ambiguity remains UNKNOWN", () => {
  assert.equal(enumerateProduct({ set: "Refractor", year: "2024", manufacturer: "Topps" }, model).value, "topps chrome");
  assert.equal(enumerateProduct({ set: "Tomorrow Set", year: "2027", manufacturer: "Topps" }, model).status, outcomes.UNKNOWN);
  assert.equal(enumerateProduct({ set: "Fade To Black", year: "2024", manufacturer: "Panini" }, model).status, outcomes.UNKNOWN);
  assert.equal(enumerateProduct({ set: "2023", year: "2025", manufacturer: "Panini" }, model).status, outcomes.UNKNOWN);
});

test("only VALUE or EMPTY crosses into CSM candidates; UNKNOWN remains trace", () => {
  const packet = buildForwardEnumerationCandidatePacket({
    subject: "Unknown Rookie",
    manufacturer: "Panini",
    set: "Fade To Black",
    year: "2025",
    sport: "basketball"
  }, model);
  assert.equal(packet.trace.find((row) => row.field === "team").status, outcomes.UNKNOWN);
  assert.equal(packet.candidates.some((row) => row.derived_field === "team"), false);
  assert.equal(packet.candidates.find((row) => row.derived_field === "product").value.canonical, "panini phoenix");
});

test("shadow adapter never mutates resolver input; active adapter only adds evidence", () => {
  const input = {
    raw_observed_fields: { subject: "Victor Wembanyama", manufacturer: "Panini", set: "Fade To Black", year: "2025", sport: "basketball" },
    resolved_fields: { subject: "Victor Wembanyama", set: "Fade To Black", year: "2025" },
    final_title: "2025 Fade To Black Victor Wembanyama"
  };
  const shadow = attachForwardEnumerationCandidates(input, model);
  assert.equal(shadow.final_title, input.final_title);
  assert.equal(shadow.retrieval_application, undefined);
  assert.equal(shadow.forward_enumeration_shadow.identity_evidence_count, 2);

  const active = attachForwardEnumerationCandidates(input, model, { shadow: false });
  assert.equal(active.final_title, input.final_title);
  assert.equal(active.retrieval_application.owns_candidate_application, true);
  assert.deepEqual(active.retrieval_application.identity_evidence_items.map((row) => row.field).sort(), ["product", "team"]);
  assert.ok(active.retrieval_application.identity_evidence_items.every((row) => row.metadata.candidate_is_evidence_not_truth === true));
});

test("bundled constraint model is content-addressed and cached", async () => {
  const loaded = await loadConstraintModelSnapshot();
  assert.equal(loaded.snapshot_source_sha256, constraintModelSnapshot.source_sha256);
  assert.ok(Object.keys(loaded.player_teams || {}).length >= 4_000);
  assert.ok(Object.keys(loaded.set_product_years || {}).length >= 30_000);
  assert.equal(await loadConstraintModelSnapshot(), loaded);
  assert.notEqual(
    enumerateTeam({ player: "Ben Shelton", sport: "tennis", year: "2023" }, loaded).status,
    outcomes.VALUE,
    "the unverified snapshot must never promote catalog labels such as rookie into a team fact"
  );
  assert.equal(enumerateProduct({ set: "2023", year: "2025", manufacturer: "Topps" }, loaded).status, outcomes.UNKNOWN);
  assert.equal(enumerateProduct({ set: "Base Black Spider", year: "2025", manufacturer: "Topps" }, loaded).status, outcomes.UNKNOWN);
  assert.equal(enumerateProduct({ set: "Base Black Spider", year: "2023", manufacturer: "Topps" }, loaded).status, outcomes.UNKNOWN);
});

console.log("constraint enumerator tests passed");
