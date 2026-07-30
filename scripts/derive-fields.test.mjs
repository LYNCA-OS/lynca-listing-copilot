#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCardType,
  deriveFields,
  summariseDerivation
} from "../lib/listing/catalog/derive-fields.mjs";
import { outcomes } from "../lib/listing/catalog/constraint-enumerator.mjs";

const model = {
  schema_version: "constraint-model-v1",
  snapshot_version: "constraints-test-v1",
  snapshot_source_sha256: "b".repeat(64),
  set_product_years: {
    "fade to black": ["2025|panini phoenix"]
  }
};

test("card type requires an explicit product-family signal", () => {
  assert.equal(deriveCardType({ product: "Topps Chrome UEFA" }).value, "soccer");
  assert.equal(deriveCardType({ product: "Disney Lorcana" }).value, "tcg");
  assert.equal(deriveCardType({ product: "Bowman Chrome" }).status, outcomes.UNKNOWN);
  assert.equal(deriveCardType({ product: "Panini Prizm" }).status, outcomes.UNKNOWN);
});

test("derivation emits query candidates and never mutates Resolver fields", () => {
  const fields = Object.freeze({
    year: "2025",
    manufacturer: "Panini",
    set: "Fade To Black",
    players: Object.freeze(["Pelé", "Pel"]),
    product: "Panini Basketball"
  });
  const packet = deriveFields(fields, model);

  assert.deepEqual(fields.players, ["Pelé", "Pel"]);
  assert.deepEqual(packet.query_expansion_fields.players, ["Pelé"]);
  assert.equal(packet.query_expansion_fields.sport, "basketball");
  assert.equal(packet.field_application_owner, "IDENTITY_RESOLVER");
  assert.equal(packet.title_application_allowed, false);
  assert.equal(packet.title_changed, false);
  assert.equal(packet.forward_enumeration_candidate_packet.trace.find((row) => row.field === "team").status, outcomes.UNKNOWN);
  assert.equal(
    packet.forward_enumeration_candidate_packet.candidates.find((candidate) => candidate.derived_field === "product").value.canonical,
    "panini phoenix"
  );
  assert.ok(packet.query_expansion_candidates.every((candidate) => (
    candidate.provenance.permissions.length === 1
      && candidate.provenance.permissions[0] === "QUERY_EXPANSION"
  )));
});

test("VALUE, EMPTY, and UNKNOWN remain distinct in the summary", () => {
  const packet = deriveFields({ player: "Mickey Mouse", sport: "entertainment" }, model);
  const summary = summariseDerivation([packet]);
  assert.ok(summary.VALUE >= 1);
  assert.ok(summary.EMPTY >= 1);
  assert.ok(summary.UNKNOWN >= 1);
});

console.log("derive fields tests passed");
