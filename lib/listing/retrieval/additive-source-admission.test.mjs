import test from "node:test";
import assert from "node:assert/strict";

import { rankRetrievalCandidates } from "./candidate-matcher.mjs";
import {
  additiveCohorts,
  candidateCohort,
  rankWithAdditiveAdmission,
  splitByCohort
} from "./additive-source-admission.mjs";

const PANINI = "panini_2023_2025";
const cohorts = new Set([PANINI]);

function candidate(id, fields, extra = {}) {
  return {
    candidate_id: id,
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "OFFICIAL_CHECKLIST",
    fields,
    ...extra
  };
}

const resolved = {
  year: "2023",
  product: "Donruss Optic",
  players: "Bijan Robinson",
  card_number: "301"
};

const incumbentA = candidate("inc-a", {
  year: "2023", product: "Donruss Optic", players: "Bijan Robinson", card_number: "301"
});
const incumbentB = candidate("inc-b", {
  year: "2023", product: "Donruss Optic", players: "Bijan Robinson"
});

test("cohort membership is read from any of the metadata carriers", () => {
  assert.equal(candidateCohort({ ingest_cohort: PANINI }), PANINI);
  assert.equal(candidateCohort({ reference_metadata: { ingest_cohort: PANINI } }), PANINI);
  assert.equal(candidateCohort({ source_metadata: { ingest_cohort: PANINI } }), PANINI);
  assert.equal(candidateCohort(incumbentA), "");
});

test("cohorts are parsed from a comma separated env var", () => {
  assert.deepEqual([...additiveCohorts({ RETRIEVAL_ADDITIVE_ONLY_COHORTS: " a , b ,, c " })], ["a", "b", "c"]);
  assert.equal(additiveCohorts({}).size, 0);
});

test("splitByCohort keeps non-cohort rows as incumbents", () => {
  const cohortRow = candidate("pan-1", incumbentA.fields, { ingest_cohort: PANINI });
  const { incumbents, additive } = splitByCohort([incumbentA, cohortRow, incumbentB], cohorts);
  assert.deepEqual(incumbents.map((c) => c.candidate_id), ["inc-a", "inc-b"]);
  assert.deepEqual(additive.map((c) => c.candidate_id), ["pan-1"]);
});

test("with no cohort configured the result is the untouched ranking", () => {
  const plain = rankRetrievalCandidates([incumbentA, incumbentB], resolved);
  const admitted = rankWithAdditiveAdmission([incumbentA, incumbentB], resolved, {
    rank: rankRetrievalCandidates,
    cohorts: new Set()
  });
  assert.deepEqual(admitted, plain);
});

test("with no cohort rows retrieved the result is the untouched ranking", () => {
  const plain = rankRetrievalCandidates([incumbentA, incumbentB], resolved);
  const admitted = rankWithAdditiveAdmission([incumbentA, incumbentB], resolved, {
    rank: rankRetrievalCandidates,
    cohorts
  });
  assert.deepEqual(admitted, plain);
});

// The failure this whole module exists to prevent: a near-duplicate new row
// lands second, collapses top-minus-second, and rejects a selection that was
// fine before the catalog grew.
test("a cohort near-duplicate cannot collapse the selection margin", () => {
  const before = rankRetrievalCandidates([incumbentA, incumbentB], resolved);
  assert.ok(before.selected_candidate, "precondition: the card selects cleanly before ingestion");

  const nearDuplicate = candidate("pan-dupe", incumbentA.fields, { ingest_cohort: PANINI });

  const naive = rankRetrievalCandidates([incumbentA, incumbentB, nearDuplicate], resolved);
  assert.equal(naive.candidate_margin, 0, "precondition: naive ranking does collapse the margin");
  assert.equal(naive.selected_candidate, null, "precondition: and that costs us the selection");

  const admitted = rankWithAdditiveAdmission([incumbentA, incumbentB, nearDuplicate], resolved, {
    rank: rankRetrievalCandidates,
    cohorts
  });
  assert.equal(admitted.candidate_margin, before.candidate_margin);
  assert.equal(admitted.selected_candidate?.candidate_id, before.selected_candidate.candidate_id);
  assert.equal(admitted.low_margin_conflict, before.low_margin_conflict);
});

test("a cohort row is never selected even when it outscores every incumbent", () => {
  const strong = candidate("pan-strong", {
    year: "2023", product: "Donruss Optic", players: "Bijan Robinson", card_number: "301"
  }, { ingest_cohort: PANINI });
  const weakIncumbent = candidate("inc-weak", { year: "2023", product: "Donruss" });

  const admitted = rankWithAdditiveAdmission([weakIncumbent, strong], resolved, {
    rank: rankRetrievalCandidates,
    cohorts
  });
  assert.equal(admitted.selected_candidate?.candidate_id, "inc-weak");
  const row = admitted.candidates.find((c) => c.candidate_id === "pan-strong");
  assert.equal(row.selected, false);
  assert.equal(row.admission, "additive_only");
});

// The incumbent prefix is the actual invariant: everything the pipeline saw
// before ingestion, in the same order, with the same flags.
test("the incumbent prefix is byte-identical with and without the cohort", () => {
  const cohortRows = [
    candidate("pan-1", incumbentA.fields, { ingest_cohort: PANINI }),
    candidate("pan-2", incumbentB.fields, { ingest_cohort: PANINI })
  ];
  const before = rankRetrievalCandidates([incumbentA, incumbentB], resolved);
  const admitted = rankWithAdditiveAdmission([incumbentA, ...cohortRows, incumbentB], resolved, {
    rank: rankRetrievalCandidates,
    cohorts
  });

  const prefix = admitted.candidates.slice(0, before.candidates.length);
  assert.deepEqual(prefix, before.candidates);
  assert.equal(admitted.additive_admission.additive_count, 2);
  assert.equal(admitted.additive_admission.incumbent_count, before.candidates.length);
});

test("cohort rows stay available to downstream field fill", () => {
  const filler = candidate("pan-fill", {
    year: "2023", product: "Donruss Optic", players: "Bijan Robinson", set_or_insert: "Rated Rookies Gold"
  }, { ingest_cohort: PANINI });
  const admitted = rankWithAdditiveAdmission([incumbentA, filler], resolved, {
    rank: rankRetrievalCandidates,
    cohorts
  });
  const row = admitted.candidates.find((c) => c.candidate_id === "pan-fill");
  assert.ok(row, "the cohort row is still in the candidate list");
  assert.equal(row.fields.set_or_insert, "Rated Rookies Gold");
});
