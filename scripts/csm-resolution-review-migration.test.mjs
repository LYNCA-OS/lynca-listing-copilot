#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = "infrastructure/supabase-production/supabase/migrations/"
  + "20260812055051_csm_resolution_review_measurement_v2.sql";
const sql = await readFile(path, "utf8");

assert.match(sql, /set lock_timeout = '5s';/);
assert.match(sql, /set statement_timeout = '60s';/);
for (const column of [
  "measurement_basis", "measurement_snapshot", "measurement_snapshot_sha256"
]) {
  assert.match(sql, new RegExp(`add column if not exists ${column}\\b`));
}
assert.match(sql, /schema_version <> 'csm-resolution-review-v2'/);
for (const column of [
  "measurement_basis", "measurement_snapshot", "measurement_snapshot_sha256"
]) assert.match(sql, new RegExp(`${column} is not null`));
assert.match(sql, /measurement_basis = 'FIELD_REVIEWED'/);
assert.match(sql, /create or replace function private\.validate_csm_review_measurement_snapshot_v1\(/);
assert.match(sql, /language plpgsql[\s\S]*immutable[\s\S]*strict/);
assert.doesNotMatch(sql, /security definer/i);
assert.match(sql, /key_count <> 8[\s\S]*key_count <> 6[\s\S]*key_count <> 8/);
assert.match(sql, /'VALUE', 'ABSENT', 'INSUFFICIENT_EVIDENCE'/);
assert.match(sql, /'INCLUDED', 'SUPPRESSED_BY_PROFILE', 'DROPPED_FOR_BUDGET',[\s\S]*'RESTORED', 'NORMALIZED', 'DEDUPED_COVERED',[\s\S]*'WITHHELD_BY_CONTRACT', 'NOT_APPLICABLE'/);
assert.match(sql, /seen_brackets[\s\S]*seen_fields/);
assert.match(sql, /expected_brackets[\s\S]*seen_brackets is distinct from expected_brackets/);
assert.match(sql, /csm-publication-coverage-summary-v1/);
assert.match(sql, /private\.validate_csm_review_measurement_snapshot_v1\([\s\S]*measurement_snapshot,[\s\S]*asset_id,[\s\S]*recognition_session_id,[\s\S]*view_version,[\s\S]*composer_version/);
assert.match(sql, /measurement_snapshot_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(sql, /where excluded_from_metrics = false[\s\S]*schema_version = 'csm-resolution-review-v2'/);
assert.doesNotMatch(sql, /\b(update|delete)\s+public\.csm_resolution_reviews\b/i,
  "the forward bridge must not rewrite append-only review history");

process.stdout.write("csm resolution review measurement migration: ok\n");
