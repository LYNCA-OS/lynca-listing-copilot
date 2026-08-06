import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  composeWithDiagnosticOracleDownstreamRecoveryV1,
  titleTokens
} from "../experiments/accuracy/composer-downstream-recovery-v1.mjs";
import { composeWithGeneralizableDownstreamRecoveryV1 } from "../experiments/accuracy/composer-downstream-generalizable-v1.mjs";

const rows = readFileSync("artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl", "utf8")
  .split(/\n+/).filter(Boolean).map(JSON.parse)
  .filter((row) => row.arm === "thin_canonical_high");
const bySuffix = (suffix) => rows.find((row) => row.asset_id.endsWith(suffix));

// Unknown cards are byte-for-byte equivalent to the current Composer.
{
  const row = rows[0];
  const replay = composeWithDiagnosticOracleDownstreamRecoveryV1("reviewed_blind_not_attested", row.fields);
  assert.equal(replay.candidate.title, replay.baseline.title);
  assert.deepEqual(replay.applied, []);
}

// An attested exception only serializes source-backed tokens and never exceeds
// the marketplace budget.
{
  const row = bySuffix("5edfef737b8f58f5253b");
  const replay = composeWithDiagnosticOracleDownstreamRecoveryV1(row.asset_id, row.fields);
  assert.match(replay.candidate.title, /Orange/);
  assert.match(replay.candidate.title, /Dodgers/);
  assert.ok(replay.candidate.length <= 80);
  assert.deepEqual(replay.applied.map((action) => action.kind).sort(), [
    "attested_finish_exception",
    "attested_team_exception"
  ]);
}

// Sampling drift fails closed: an old Orange attestation cannot promote a new
// Blue canonical observation.
{
  const row = bySuffix("e90ca474692fe8f57b44");
  const replay = composeWithDiagnosticOracleDownstreamRecoveryV1(row.asset_id, {
    ...row.fields,
    surface_color: "Blue",
    print_finish: "Blue Sapphire"
  });
  assert.equal(replay.candidate.title, replay.baseline.title);
  assert.ok(replay.rejected.some((action) => action.reason === "finish_source_mismatch"));
}

// The subject compaction adds only tokens already present in typed Subjects.
{
  const row = bySuffix("bcc4e7ac4ac23e1e69d3");
  const replay = composeWithDiagnosticOracleDownstreamRecoveryV1(row.asset_id, row.fields);
  const source = titleTokens(row.fields.subjects.join(" "));
  for (const token of ["polanco", "ryan"]) {
    assert.ok(source.has(token));
    assert.ok(titleTokens(replay.candidate.title).has(token));
  }
  assert.ok(replay.candidate.length <= 80);
}

// Typed component compaction spends the recovered space on Manufacturer but
// does not alter the exact serial or grade.
{
  const row = bySuffix("2cada69235bf401f2a16");
  const replay = composeWithDiagnosticOracleDownstreamRecoveryV1(row.asset_id, row.fields);
  assert.match(replay.candidate.title, /Panini Impeccable/);
  assert.match(replay.candidate.title, /60\/75/);
  assert.match(replay.candidate.title, /BGS 9\.5/);
  assert.ok(!replay.candidate.title.includes("Relic"));
}

// Promotable candidates are asset-agnostic: the function receives no asset id
// or reference title and only accepts a candidate that restores a dropped
// bracket without creating a new drop.
{
  const row = bySuffix("410c0c9aa76e944a0cbc");
  const replay = composeWithGeneralizableDownstreamRecoveryV1(row.fields);
  assert.match(replay.candidate.title, /Donruss Elite/);
  assert.deepEqual(replay.applied, [{
    kind: "typed_grade_compaction",
    restored_bracket: "manufacturer"
  }]);
}

process.stdout.write("composer downstream recovery v1: ok\n");
