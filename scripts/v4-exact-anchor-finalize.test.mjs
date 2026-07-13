import assert from "node:assert/strict";
import {
  exactAnchorQueryFieldsFromScout,
  maybeFinalizeL1FromExactAnchor,
  scoutHasFinalizeAnchors
} from "../lib/listing/v4/fast-scout/exact-anchor-finalize.mjs";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
};

const scoutResult = {
  resolved_fields: {
    players: ["Jesus Made"],
    year: "2025",
    manufacturer: "Topps",
    product_family: "Bowman Chrome",
    collector_number: "BS-4",
    print_run_denominator: "5",
    serial_number: "3/5",
    surface_color: "Red"
  }
};

function catalogRow(overrides = {}) {
  return {
    identity_id: "11111111-1111-1111-1111-111111111111",
    canonical_title: "2025 Bowman Chrome Jesus Made Spotlights BS-4",
    retrieval_status: "reviewed",
    source_type: "STRUCTURED_DATABASE",
    supporting_fields: ["subject", "year", "product", "collector_number"],
    raw_score: 0.8,
    normalized_score: 0.8,
    fields: {
      year: "2025",
      manufacturer: "Topps",
      brand: "Bowman",
      product: "Bowman Chrome",
      set: "Spotlights",
      players: ["Jesus Made"],
      collector_number: "BS-4"
    },
    ...overrides
  };
}

function fetchReturning(rows) {
  return async () => ({ ok: true, json: async () => rows });
}

// Query-field mapping and anchor precondition.
const queryFields = exactAnchorQueryFieldsFromScout(scoutResult.resolved_fields);
assert.deepEqual(queryFields.subjects, ["Jesus Made"]);
assert.equal(queryFields.collector_number, "BS-4");
assert.equal(queryFields.expected_serial_denominator, "5");
assert.equal(scoutHasFinalizeAnchors(queryFields), true);
assert.equal(scoutHasFinalizeAnchors(exactAnchorQueryFieldsFromScout({ players: ["X"], year: "2024" })), false);
const sportsProductKey = exactAnchorQueryFieldsFromScout({
  year: "2024",
  product: "Topps Chrome",
  collector_number: "54"
});
assert.equal(scoutHasFinalizeAnchors(sportsProductKey), false, "legacy scout path still requires a subject");
assert.equal(
  scoutHasFinalizeAnchors(sportsProductKey, { allowSportsProductKey: true }),
  true,
  "formal anchor router may use year + product + printed card number"
);

// Unique strict-tier hit -> finalized, catalog identity merged, instance
// fields (serial from the current image) preserved and never overwritten.
const finalized = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env,
  fetchImpl: fetchReturning([catalogRow()])
});
assert.equal(finalized.finalized, true);
assert.equal(finalized.reason, "exact_anchor_catalog_finalized");
assert.match(finalized.title, /Bowman Chrome/i);
assert.match(finalized.title, /Jesus Made/i);
assert.equal(finalized.resolved_fields.set, "Spotlights");
assert.equal(finalized.resolved_fields.serial_number, "3/5");
assert.equal(finalized.candidate.candidate_identity_id, "11111111-1111-1111-1111-111111111111");
assert.equal(finalized.catalog_lookup_attempted, true);
assert.equal(finalized.catalog_candidate_count, 1);
assert.equal(finalized.trusted_candidate_count, 1);
assert.equal(finalized.eligible_candidate_count, 1);

// Candidate/review-required rows can support shadow analysis but can never
// finalize a writer-visible title.
const untrusted = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env,
  fetchImpl: fetchReturning([catalogRow({ retrieval_status: "candidate" })])
});
assert.equal(untrusted.finalized, false);
assert.equal(untrusted.reason, "no_exact_anchor_agreement");
assert.equal(untrusted.catalog_candidate_count, 1);
assert.equal(untrusted.trusted_candidate_count, 0);
assert.equal(untrusted.eligible_candidate_count, 0);

// A direct TCG natural key can identify one official/reviewed catalog row
// without requiring subject/year to be read first.
const tcgFinalized = await maybeFinalizeL1FromExactAnchor({
  scoutResult: { resolved_fields: { tcg_card_number: "OP01-120" } },
  env,
  fetchImpl: fetchReturning([catalogRow({
    canonical_title: "2022 One Piece Romance Dawn Shanks OP01-120 SEC",
    retrieval_status: "registry",
    source_type: "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST",
    fields: {
      year: "2022",
      ip: "One Piece",
      product: "Romance Dawn",
      players: ["Shanks"],
      collector_number: "OP01-120",
      rarity: "SEC"
    }
  })]),
  policy: { allow_tcg_code_only: true, allow_catalog_finalize: true, allow_cert_lane: false }
});
assert.equal(tcgFinalized.finalized, true, JSON.stringify(tcgFinalized));
assert.equal(tcgFinalized.resolved_fields.players[0], "Shanks");
assert.equal(tcgFinalized.resolved_fields.serial_number, undefined, "instance fields must never be copied from catalog");

// Sports checklist natural key: year + product hierarchy + printed card
// number can identify a unique approved row before the subject OCR settles.
const sportsProductFinalized = await maybeFinalizeL1FromExactAnchor({
  scoutResult: {
    resolved_fields: {
      year: "2024",
      product: "Panini Contenders",
      collector_number: "54"
    }
  },
  env,
  fetchImpl: fetchReturning([catalogRow({
    canonical_title: "2024 Panini Contenders Jaren Jackson Rookie Ticket Auto #54",
    fields: {
      year: "2024",
      manufacturer: "Panini",
      product: "Panini Contenders",
      players: ["Jaren Jackson"],
      card_name: "Rookie Ticket Autograph",
      collector_number: "54"
    }
  })]),
  policy: {
    allow_sports_product_key: true,
    allow_catalog_finalize: true,
    allow_cert_lane: false
  }
});
assert.equal(sportsProductFinalized.finalized, true, JSON.stringify(sportsProductFinalized));
assert.equal(sportsProductFinalized.resolved_fields.players[0], "Jaren Jackson");
assert.equal(sportsProductFinalized.catalog_lookup_attempted, true);

// Two strict-tier candidates -> ambiguous, no finalize.
const ambiguous = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env,
  fetchImpl: fetchReturning([
    catalogRow(),
    catalogRow({ identity_id: "22222222-2222-2222-2222-222222222222", canonical_title: "2025 Bowman Chrome Jesus Made Alt BS-4" })
  ])
});
assert.equal(ambiguous.finalized, false);
assert.equal(ambiguous.reason, "ambiguous_exact_anchor_candidates");
assert.equal(ambiguous.catalog_candidate_count, 2);
assert.equal(ambiguous.eligible_candidate_count, 2);

// Code mismatch -> hard conflict -> no finalize.
const mismatch = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env,
  fetchImpl: fetchReturning([catalogRow({ fields: { ...catalogRow().fields, collector_number: "BCP-50" } })])
});
assert.equal(mismatch.finalized, false);

// Scout without a printed exact code never attempts the fast lane.
const noAnchor = await maybeFinalizeL1FromExactAnchor({
  scoutResult: { resolved_fields: { players: ["Jesus Made"], year: "2025", product_family: "Bowman Chrome" } },
  env,
  fetchImpl: fetchReturning([catalogRow()])
});
assert.equal(noAnchor.finalized, false);
assert.equal(noAnchor.reason, "scout_missing_exact_anchors");

// Kill switch.
const disabled = await maybeFinalizeL1FromExactAnchor({
  scoutResult,
  env: { ...env, ENABLE_V4_EXACT_ANCHOR_FINALIZE: "false" },
  fetchImpl: fetchReturning([catalogRow()])
});
assert.equal(disabled.finalized, false);
assert.equal(disabled.reason, "disabled_by_env");

console.log("v4 exact anchor finalize tests passed");
