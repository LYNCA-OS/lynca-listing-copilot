import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  compileReleasePackMemoryIndex,
  releasePackIndexContractVersion
} from "../lib/listing/catalog/release-pack-memory-index.mjs";

const rows = [
  {
    season_year: "2024",
    sport: "basketball",
    manufacturer: "Panini",
    product: "Prizm",
    set_or_insert: "Base",
    program_id: 1,
    card_set_id: 10,
    cards: [{ card_number: "#12" }]
  },
  {
    season_year: "2024",
    sport: "basketball",
    manufacturer: "Panini",
    product: "Prizm",
    set_or_insert: "Color Blast",
    source_set_name: "Colour Blast Insert",
    program_id: 1,
    card_set_id: 11,
    cards: [{ checklist_code: "CB-1" }]
  },
  {
    season_year: "2024",
    sport: "football",
    manufacturer: "Panini",
    product: "Prizm",
    set_or_insert: "Base",
    program_id: 2,
    card_set_id: 12,
    cards: []
  }
];

const provenance = Object.freeze({
  source_id: "fixture-panini",
  source_type: "OFFICIAL_CATALOG",
  source_version: "fixture-v1",
  source_sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  source_uri: "fixture://panini"
});

test("requires versioned, hashed source provenance", () => {
  assert.throws(() => compileReleasePackMemoryIndex({ rows, pack_version: "v1", provenance: {} }), /source_id/);
  assert.throws(() => compileReleasePackMemoryIndex({ rows, pack_version: "v1", provenance: { ...provenance, source_sha256: "bad" } }), /sha256/);
  assert.throws(() => compileReleasePackMemoryIndex({ rows, provenance }), /pack_version/);
});

test("build is deterministic across source row ordering", () => {
  const first = compileReleasePackMemoryIndex({ rows, pack_version: "v1", provenance });
  const second = compileReleasePackMemoryIndex({ rows: [...rows].reverse(), pack_version: "v1", provenance });
  assert.equal(first.schema_version, releasePackIndexContractVersion);
  assert.equal(first.index_fingerprint, second.index_fingerprint);
  assert.deepEqual(
    first.query({ year: "2024", sport: "basketball", product: "Prizm", set: "Base" }).candidates,
    second.query({ year: "2024", sport: "basketball", product: "Prizm", set: "Base" }).candidates
  );
});

test("progressively narrows year, sport, product and set without deciding a title", () => {
  const index = compileReleasePackMemoryIndex({ rows, pack_version: "v1", provenance });
  const result = index.query({ season: "2024-25", sport: "basketball", product: "PRIZM", set_or_insert: "Base" });
  assert.equal(result.match_status, "UNIQUE");
  assert.deepEqual(result.narrowing_trace.map((entry) => entry.candidate_count), [3, 2, 2, 1]);
  assert.equal(result.candidates[0].card_set_id, "10");
  assert.equal(Object.hasOwn(result, "sem"), false);
  assert.equal(Object.hasOwn(result, "title"), false);
  assert.equal(Object.hasOwn(result.candidates[0], "title"), false);
});

test("reports ambiguity explicitly and bounds returned candidates", () => {
  const index = compileReleasePackMemoryIndex({ rows, pack_version: "v1", provenance });
  const result = index.query({ year: "2024", sport: "basketball", product: "Prizm" }, { limit: 1 });
  assert.equal(result.match_status, "AMBIGUOUS");
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidate_count, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.candidates.length, 1);
});

test("card-code normalization can narrow a release candidate", () => {
  const index = compileReleasePackMemoryIndex({ rows, pack_version: "v1", provenance });
  const result = index.query({ year: "2024", sport: "basketball", product: "Prizm", card_code: "CB 1" });
  assert.equal(result.match_status, "UNIQUE");
  assert.equal(result.candidates[0].card_set_id, "11");
  assert.deepEqual(result.candidates[0].matched_card_codes, ["cb-1"]);
});

test("source set name is a query alias without becoming a generated fact", () => {
  const index = compileReleasePackMemoryIndex({ rows, pack_version: "v1", provenance });
  const result = index.query({ year: "2024", sport: "basketball", product: "Prizm", set: "Colour Blast Insert" });
  assert.equal(result.match_status, "UNIQUE");
  assert.equal(result.candidates[0].set_or_insert, "Color Blast");
  assert.equal(result.candidates[0].source_set_name, "Colour Blast Insert");
});

test("missing lookup values fail closed instead of broadening the query", () => {
  const index = compileReleasePackMemoryIndex({ rows, pack_version: "v1", provenance });
  const result = index.query({ year: "2024", sport: "baseball", product: "Prizm" });
  assert.equal(result.match_status, "NOT_FOUND");
  assert.equal(result.candidate_count, 0);
  assert.equal(result.narrowing_trace.at(-1).dimension, "sport");
});
