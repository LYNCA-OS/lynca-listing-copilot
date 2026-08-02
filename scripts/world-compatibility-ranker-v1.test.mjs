#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  edgeAuthorityVerified,
  rankProductCandidates,
  rankTeamCandidates,
  rankYearCandidates,
  visibleCandidate
} from "../experiments/accuracy/world-compatibility-ranker-v1.mjs";

const model = {
  player_years: { "victor wembanyama": [2024, 2025] },
  player_teams: { "victor wembanyama": ["san antonio spurs"] },
  player_team_years: { "victor wembanyama": { 2025: ["san antonio spurs"] } },
  product_years: { "Topps Chrome": [2025], "Panini Prizm": [2024] }
};

test("support reorders existing year candidates without changing values", () => {
  const candidates = [
    { id: "copyright", value: "2023", basis: "exact_text" },
    { id: "season", value: "2025", basis: "stamped_text" }
  ];
  const facts = [{ kind: "subject", value: "Victor Wembanyama" }];
  const ranked = rankYearCandidates(candidates, facts, model);
  assert.deepEqual(ranked.candidates.map((row) => row.id), ["season", "copyright"]);
  assert.deepEqual(ranked.candidates.map((row) => row.value).sort(), candidates.map((row) => row.value).sort());
  assert.equal(ranked.candidate_count_before, ranked.candidate_count_after);
  assert.equal(ranked.values_mutated, false);
  assert.deepEqual(ranked.rejected_candidate_ids, []);
});

test("team and product support are rank hints, never generated truth", () => {
  const facts = [
    { kind: "subject", value: "Victor Wembanyama" },
    { kind: "year", value: "2025" }
  ];
  const teams = rankTeamCandidates([
    { id: "league", value: "NBA", basis: "logo_or_symbol" },
    { id: "team", value: "Spurs", basis: "exact_text" }
  ], facts, model);
  assert.equal(teams.candidates[0].id, "team");
  assert.equal(teams.hard_rejection_enabled, false);

  const products = rankProductCandidates([
    { id: "short", value: "Chrome", basis: "logo_or_symbol" },
    { id: "full", value: "2025 Topps Chrome Basketball", basis: "stamped_text" }
  ], facts, model);
  assert.equal(products.candidates[0].id, "full");
  assert.deepEqual(products.rejected_candidate_ids, []);
});

test("visible text remains protected even under a hypothetical complete contract", () => {
  const authoritative = {
    ...model,
    edge_contracts: {
      subject_year: {
        schema_version: "world-edge-authority-v1",
        semantic_values_validated: true,
        coverage_exhaustive: true,
        edge_provenance_complete: true,
        valid_intervals_complete: true
      }
    }
  };
  assert.equal(edgeAuthorityVerified(authoritative, "subject_year"), true);
  assert.equal(visibleCandidate({ value: "2025", basis: "exact_text" }), true);
  const ranked = rankYearCandidates(
    [{ id: "visible", value: "2026", basis: "exact_text" }],
    [{ kind: "subject", value: "Victor Wembanyama" }],
    authoritative
  );
  assert.equal(ranked.decisions[0].hard_reject_allowed, false);
  assert.equal(ranked.decisions[0].rejected, false);
  assert.deepEqual(ranked.rejected_candidate_ids, []);
});

