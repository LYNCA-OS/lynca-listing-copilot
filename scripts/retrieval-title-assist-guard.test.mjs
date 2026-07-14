import assert from "node:assert/strict";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_LISTING_MODEL = "gpt-4.1-mini-2025-04-14";

const { __listingCopilotTitleTestHooks } = await import("../api/listing-copilot-title.js");
const {
  applySafeRetrievalTitleAssist,
  scaffoldTitleConflictsWithDirectEvidence
} = __listingCopilotTitleTestHooks;

// --- scaffoldTitleConflictsWithDirectEvidence unit behavior ---

// eBay C50 card #11: provider read Pelé / 2015-16 Flawless at 0.99 CONFIRMED,
// yet a postgres_hybrid title-only candidate (Saka Noir 2025-26) matched on
// trigram+brand+serial-denominator and replaced the correct title.
assert.ok(
  ["scaffold_player_conflict", "scaffold_year_conflict"].includes(
    scaffoldTitleConflictsWithDirectEvidence(
      "2025-26 Panini Noir Road to FIFA World Cup Bukayo Saka Base /25",
      { players: ["Pelé"], year: "2015-16" }
    )
  )
);

// Year conflict alone is also blocking (player unknown).
assert.equal(
  scaffoldTitleConflictsWithDirectEvidence(
    "2025-26 Panini Noir Road to FIFA World Cup Bukayo Saka Base /25",
    { year: "2015-16" }
  ),
  "scaffold_year_conflict"
);

// Matching player passes (diacritics folded, last-name match allowed).
assert.equal(
  scaffoldTitleConflictsWithDirectEvidence(
    "2015-16 Panini Flawless Pele Legendary Signatures Auto /25",
    { players: ["Pelé"], year: "2015-16" }
  ),
  ""
);
assert.equal(
  scaffoldTitleConflictsWithDirectEvidence(
    "2018-19 Panini Hoops Trae Young RC Rookie",
    { players: ["Trae Young"], year: "2018-19" }
  ),
  ""
);

// Adjacent-season years are compatible (2018 vs 2018-19 style references).
assert.equal(
  scaffoldTitleConflictsWithDirectEvidence(
    "2019 Panini Hoops Trae Young RC",
    { players: ["Trae Young"], year: "2018-19" }
  ),
  ""
);

// No direct evidence -> nothing to conflict with.
assert.equal(
  scaffoldTitleConflictsWithDirectEvidence(
    "2025-26 Panini Noir Bukayo Saka Base /25",
    {}
  ),
  ""
);

// --- applySafeRetrievalTitleAssist end-to-end guard ---

const draft = {
  title: "2015-16 Panini Flawless Soccer Pelé #/25 Auto (Brazil)",
  final_title: "2015-16 Panini Flawless Soccer Pelé #/25 Auto (Brazil)",
  fields: {
    player: "Pelé",
    year: "2015-16",
    product: "Flawless Soccer",
    serial_number: "20/25"
  },
  resolved: {
    players: ["Pelé"],
    year: "2015-16",
    product: "Flawless Soccer",
    serial_number: "20/25"
  }
};

const conflictingCompletion = {
  retrieval: {
    sources: [{
      title: "2025-26 Panini Noir Road to FIFA World Cup Bukayo Saka Base /25",
      provider_id: "postgres_hybrid",
      source_type: "STRUCTURED_DATABASE",
      source_trust: "approved",
      match_score: 0.62,
      matched_fields: ["trigram", "brand", "manufacturer", "serial_number"],
      selected: true
    }]
  }
};

const guarded = applySafeRetrievalTitleAssist(draft, draft, conflictingCompletion, {});
assert.equal(guarded.final_title, draft.final_title);
assert.notEqual(guarded.retrieval_title_assist?.used, true);
if (guarded.retrieval_title_assist) {
  assert.equal(guarded.retrieval_title_assist.blocked_by_direct_evidence_conflict, true);
  assert.ok(guarded.retrieval_title_assist.rejected_candidate_count >= 1);
  assert.ok(guarded.retrieval_title_assist.rejected_reasons.length >= 1);
}

const softConflictCompletion = {
  retrieval: {
    sources: [{
      title: "2015-16 Panini Flawless Pele Legendary Signatures Auto /25",
      fields: {
        players: ["Pelé"],
        year: "2015-16",
        product: "Flawless Soccer"
      },
      provider_id: "postgres_hybrid",
      source_type: "STRUCTURED_DATABASE",
      source_trust: "approved",
      match_score: 0.91,
      matched_fields: ["players", "year", "product", "serial_number"],
      soft_conflicting_fields: ["product"],
      selected: true
    }]
  }
};
const softConflictGuarded = applySafeRetrievalTitleAssist(draft, draft, softConflictCompletion, {});
assert.equal(softConflictGuarded.final_title, draft.final_title);
assert.notEqual(softConflictGuarded.retrieval_title_assist?.used, true);

const anchorContradictionCompletion = {
  retrieval: {
    sources: [{
      title: "2015-16 Panini Flawless Pele Legendary Signatures Auto /25",
      fields: {
        players: ["Pelé"],
        year: "2015-16",
        product: "Flawless Soccer"
      },
      provider_id: "postgres_hybrid",
      source_type: "STRUCTURED_DATABASE",
      source_trust: "approved",
      match_score: 0.91,
      matched_fields: ["players", "year", "product", "serial_number"],
      anchor_agreement: {
        agreed: ["players", "year"],
        contradicted: ["serial_denominator"],
        prompt_hard_filter_pass: false
      },
      selected: true
    }]
  }
};
const anchorGuarded = applySafeRetrievalTitleAssist(draft, draft, anchorContradictionCompletion, {});
assert.equal(anchorGuarded.final_title, draft.final_title);
assert.notEqual(anchorGuarded.retrieval_title_assist?.used, true);

// A same-identity scaffold is still allowed through the lane.
const compatibleCompletion = {
  retrieval: {
    sources: [{
      title: "2015-16 Panini Flawless Pele Legendary Signatures Auto /25",
      fields: {
        players: ["Pelé"],
        year: "2015-16",
        product: "Flawless Soccer"
      },
      provider_id: "postgres_hybrid",
      source_type: "STRUCTURED_DATABASE",
      source_trust: "approved",
      match_score: 0.71,
      matched_fields: ["players", "year", "product", "serial_number"],
      selected: true
    }]
  }
};

const assisted = applySafeRetrievalTitleAssist(draft, draft, compatibleCompletion, {});
assert.equal(assisted.retrieval_title_assist?.blocked_by_direct_evidence_conflict, undefined);
if (assisted.retrieval_title_assist?.used === true) {
  assert.match(assisted.final_title, /Pele|Pelé/i);
  assert.doesNotMatch(assisted.final_title, /Saka/i);
}

console.log("retrieval title assist guard tests passed");
