#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildForwardEnumerationCandidatePacket,
  enumerateProduct,
  enumerateTeam,
  outcomes
} from "../lib/listing/catalog/constraint-enumerator.mjs";
import {
  attachForwardEnumerationCandidates,
  forwardEnumerationExperimentArm,
  forwardEnumerationExperimentArms
} from "../lib/listing/catalog/forward-enumeration-adapter.mjs";
import { constraintModelSnapshot, loadConstraintModelSnapshot } from "../lib/listing/catalog/constraint-model-store.mjs";
import { sourceIdentityForVerifiedImage } from "../lib/listing/evidence/current-image-manifest.mjs";

const model = {
  schema_version: "constraint-model-v1",
  snapshot_version: "constraint-model-v1",
  snapshot_source_sha256: "b".repeat(64),
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

const observationContext = Object.freeze({
  tenant_id: "tenant_a",
  asset_id: "asset-test",
  image_generation_id: "asset-test",
  images: Object.freeze([
    Object.freeze({
      id: "front",
      image_id: "front",
      objectPath: "tenants/tenant_a/listing-assets/2026-07-30/asset-test/front.jpg",
      contentSha256: "a".repeat(64),
      storageVerified: true,
      tenantId: "tenant_a",
      assetId: "asset-test",
      imageGenerationId: "asset-test"
    }),
    Object.freeze({
      id: "back",
      image_id: "back",
      objectPath: "tenants/tenant_a/listing-assets/2026-07-30/asset-test/back.jpg",
      contentSha256: "b".repeat(64),
      storageVerified: true,
      tenantId: "tenant_a",
      assetId: "asset-test",
      imageGenerationId: "asset-test"
    })
  ])
});

function observedEvidence(value, {
  sourceType = "CARD_FRONT",
  imageId = "front"
} = {}) {
  const identity = sourceIdentityForVerifiedImage(
    observationContext.images,
    observationContext.images.find((image) => image.id === imageId)
  );
  return {
    value,
    normalized_value: value,
    status: "CONFIRMED",
    confidence: 0.95,
    candidates: [{ value, confidence: 0.95 }],
    sources: [{
      source_type: sourceType,
      ...identity,
      observed_text: Array.isArray(value) ? value.join(" / ") : value,
      raw_text: Array.isArray(value) ? value.join(" / ") : value,
      trust_tier: 1
    }],
    conflicts: [],
    unresolved_reason: null
  };
}

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
  assert.equal(packet.constraint_snapshot_version, "constraint-model-v1");
  assert.equal(packet.constraint_snapshot_source_sha256, "b".repeat(64));
  assert.equal(packet.candidates.some((row) => row.derived_field === "team"), false);
  assert.equal(packet.candidates.find((row) => row.derived_field === "product").value.canonical, "panini phoenix");
});

test("shadow adapter never mutates resolver input; active adapter only adds evidence", () => {
  const input = {
    raw_observed_fields: { subject: "Victor Wembanyama", manufacturer: "Panini", set: "Fade To Black", year: "2025", sport: "basketball" },
    normalized_evidence: {
      players: observedEvidence(["Victor Wembanyama"]),
      manufacturer: observedEvidence("Panini"),
      set: observedEvidence("Fade To Black"),
      year: observedEvidence("2025", { sourceType: "CARD_BACK", imageId: "back" }),
      sport: observedEvidence("basketball")
    },
    resolved_fields: { subject: "Victor Wembanyama", set: "Fade To Black", year: "2025" },
    final_title: "2025 Fade To Black Victor Wembanyama"
  };
  const shadow = attachForwardEnumerationCandidates(input, model, { observationContext });
  assert.equal(shadow.final_title, input.final_title);
  assert.equal(shadow.retrieval_application, undefined);
  assert.equal(shadow.retrieval_query_expansion_fields, undefined,
    "shadow derivation must not enter the formal retrieval input");
  assert.equal(shadow.forward_enumeration_shadow.identity_evidence_count, 2);
  assert.equal(shadow.forward_enumeration_shadow.observation_provenance_count, 5);
  assert.ok(shadow.forward_enumeration_observation_provenance.every((row) => row.input_layer === "RAW_OBSERVED_FIELDS"));
  assert.equal(shadow.forward_enumeration_shadow.production_retrieval_affected, false);
  assert.equal(shadow.derived_fields_packet.field_application_owner, "IDENTITY_RESOLVER");
  assert.equal(shadow.derived_fields_packet.title_changed, false);
  assert.equal(shadow.derived_fields_summary.VALUE >= 2, true);

  const active = attachForwardEnumerationCandidates(input, model, {
    shadow: false,
    observationContext
  });
  assert.equal(active.final_title, input.final_title);
  assert.equal(active.forward_enumeration_shadow.production_retrieval_affected, true);
  assert.equal(active.retrieval_application.owns_candidate_application, true);
  assert.deepEqual(active.retrieval_application.identity_evidence_items.map((row) => row.field).sort(), ["product", "team"]);
  assert.ok(active.retrieval_application.identity_evidence_items.every((row) => row.metadata.candidate_is_evidence_not_truth === true));
});

test("derive-fields query expansion is wired without becoming resolved truth", () => {
  const input = {
    raw_provider_fields: {
      players: ["Luka Donči", "Luka Dončić"],
      manufacturer: "Panini"
    },
    raw_provider_field_evidence: [{
      field: "players",
      value: ["Luka Donči", "Luka Dončić"],
      source_type: "VISION_ONLY",
      ...sourceIdentityForVerifiedImage(observationContext.images, observationContext.images[0]),
      source_region: "subject_name",
      visible_text: "Luka Donči / Luka Dončić",
      direct_observation: true
    }],
    resolved_fields: { players: ["Luka Donči", "Luka Dončić"] },
    final_title: "Luka Donči"
  };
  const attached = attachForwardEnumerationCandidates(input, model, { observationContext });
  assert.deepEqual(attached.derived_fields_packet.query_expansion_fields.players, ["Luka Dončić"]);
  assert.equal(attached.retrieval_query_expansion_fields, undefined);
  assert.deepEqual(attached.resolved_fields, input.resolved_fields);
  assert.equal(attached.final_title, input.final_title);
});

test("resolved output and candidate snapshots can never become observations", () => {
  const generatedOnly = attachForwardEnumerationCandidates({
    candidate_observation_snapshot: {
      subject: "Victor Wembanyama",
      manufacturer: "Panini",
      set: "Fade To Black",
      year: "2025",
      sport: "basketball"
    },
    resolved_fields: {
      subject: "Victor Wembanyama",
      manufacturer: "Panini",
      set: "Fade To Black",
      year: "2025",
      sport: "basketball"
    },
    resolved: {
      subject: "Victor Wembanyama",
      manufacturer: "Panini",
      set: "Fade To Black",
      year: "2025",
      sport: "basketball"
    }
  }, model, { shadow: false, observationContext });

  assert.equal(generatedOnly.forward_enumeration_shadow.observation_field_count, 0);
  assert.equal(generatedOnly.forward_enumeration_shadow.observation_provenance_count, 0);
  assert.equal(generatedOnly.forward_enumeration_candidate_packet.candidates.length, 0);
  assert.deepEqual(generatedOnly.derived_fields_packet.query_expansion_fields, {});
  assert.deepEqual(generatedOnly.retrieval_application.identity_evidence_items, []);
});

test("raw observation without same-image provenance fails closed", () => {
  const unproven = attachForwardEnumerationCandidates({
    raw_observed_fields: {
      subject: "Victor Wembanyama",
      manufacturer: "Panini",
      set: "Fade To Black",
      year: "2025",
      sport: "basketball"
    },
    normalized_evidence: {
      players: {
        ...observedEvidence(["Victor Wembanyama"]),
        sources: [{ source_type: "CARD_FRONT", observed_text: "Victor Wembanyama" }]
      },
      manufacturer: observedEvidence("Topps"),
      set: { ...observedEvidence("Fade To Black"), status: "CONFLICT" },
      year: observedEvidence("2024"),
      sport: { ...observedEvidence("basketball"), sources: [] }
    },
    raw_provider_fields: { set: "Fade To Black" },
    raw_provider_field_evidence: [{
      field: "set",
      value: "Fade To Black",
      source_type: "CARD_FRONT_PRINTED_TEXT",
      visible_text: "Fade To Black"
    }]
  }, model, { shadow: false, observationContext });

  assert.equal(unproven.forward_enumeration_shadow.observation_field_count, 0);
  assert.equal(unproven.forward_enumeration_candidate_packet.candidates.length, 0);
  assert.deepEqual(
    unproven.forward_enumeration_unproven_observation_fields,
    ["manufacturer", "player", "set", "sport", "year"]
  );
});

test("stale generation and indirect vision provenance cannot forge observations", () => {
  const forged = attachForwardEnumerationCandidates({
    raw_provider_fields: {
      players: ["Victor Wembanyama"],
      manufacturer: "Panini",
      set: "Fade To Black",
      year: "2025",
      sport: "basketball"
    },
    raw_provider_field_evidence: [{
      field: "players",
      value: ["Victor Wembanyama"],
      source_type: "VISION_MODEL",
      source_image_id: "front",
      source_object_path: "tenants/other/listing-assets/2026-07-30/other/front.jpg",
      image_generation_id: "stale-generation",
      visible_text: "Victor Wembanyama",
      direct_observation: false
    }]
  }, model, { shadow: false, observationContext });

  assert.equal(forged.forward_enumeration_shadow.observation_context_status, "VERIFIED");
  assert.equal(forged.forward_enumeration_shadow.observation_field_count, 0);
  assert.equal(forged.forward_enumeration_candidate_packet.candidates.length, 0);
  assert.deepEqual(forged.retrieval_application.identity_evidence_items, []);
});

test("only the explicit CONSUME arm can request decision-path use", () => {
  assert.equal(forwardEnumerationExperimentArm({}), forwardEnumerationExperimentArms.SHADOW);
  assert.equal(
    forwardEnumerationExperimentArm({ forward_enumeration_experiment_arm: "shadow" }),
    forwardEnumerationExperimentArms.SHADOW
  );
  assert.equal(
    forwardEnumerationExperimentArm({ forward_enumeration_experiment_arm: "consume" }),
    forwardEnumerationExperimentArms.CONSUME
  );
  assert.equal(
    forwardEnumerationExperimentArm({ forward_enumeration_experiment_arm: "on" }),
    forwardEnumerationExperimentArms.SHADOW,
    "loose booleans and legacy ON values must fail closed"
  );
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
