import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCatalogGapDispositionPacket,
  classifyConflictDisposition,
  main
} from "./build-catalog-gap-disposition.mjs";

const cells = [
  { count: 816, row: { product_year_present: true, set_matches_catalog_product: false, product_seen_any_year: true } },
  { count: 169, row: { product_year_present: true, set_matches_catalog_product: true, product_seen_any_year: true } },
  { count: 27, row: { product_year_present: false, set_matches_catalog_product: true, product_seen_any_year: true } },
  { count: 46, row: { product_year_present: false, set_matches_catalog_product: true, product_seen_any_year: false } },
  { count: 762, row: { product_year_present: false, set_matches_catalog_product: false, product_seen_any_year: false } },
  { count: 273, row: { product_year_present: false, set_matches_catalog_product: false, product_seen_any_year: true } }
];
let coverageIndex = 0;
const coverageRows = cells.flatMap(({ count, row }) => Array.from({ length: count }, () => ({
  id: `coverage_${String(++coverageIndex).padStart(4, "0")}`,
  ...row
})));
const conflictRows = Array.from({ length: 929 }, (_, index) => ({
  id: `conflict_${String(index + 1).padStart(4, "0")}`,
  candidate_snapshot: {
    catalog_activation_funnel: { conflict_blocked_count: 1 }
  }
}));

const packet = buildCatalogGapDispositionPacket({
  coverageRows,
  conflictRows,
  sourceSnapshot: "frozen-production-audit-2026-07-30"
});

assert.equal(packet.known_disposition_rows, 3022);
assert.equal(packet.unaccounted_open_rows, 68);
assert.deepEqual(packet.counts_by_disposition, {
  NO_BACKFILL_PRODUCT_YEAR_PRESENT: 985,
  SET_AS_PRODUCT_CANDIDATE: 73,
  PRODUCT_NAME_ABSENT_FROM_CATALOG: 762,
  UNCLASSIFIED: 273,
  CONFLICT_RETRACE_REQUIRED: 929
});
assert.equal(packet.conflict_retrace_required, 929);
assert.equal(packet.disposition_packet_ready, true);
assert.equal(packet.catalog_gap_closed, false);
assert.equal(packet.gate, "FAIL_CLOSED");
assert.deepEqual(packet.gate_reasons, [
  "UNACCOUNTED_OPEN_ROWS",
  "HISTORICAL_CONFLICT_TRACE_MISSING",
  "INDEPENDENT_REVIEW_REQUIRED_BEFORE_ANY_CATALOG_WRITE"
]);
assert.equal(packet.automatic_close_count, 0);
assert.equal(packet.catalog_write_count, 0);
assert.equal(packet.production_title_change_count, 0);
assert.equal(packet.identity_truth_count, 0);
assert.equal(packet.training_eligible_count, 0);
assert.equal(packet.holdout_consumed_count, 0);
assert.ok(packet.dispositions.every((row) => (
  row.queue_status === "KEEP_OPEN"
  && row.automatic_close_allowed === false
  && row.catalog_write_allowed === false
  && row.production_title_change_allowed === false
  && row.identity_truth === false
  && row.training_eligible === false
  && row.holdout_consumed === false
)));

assert.deepEqual(classifyConflictDisposition({
  candidate_snapshot: {
    conflict_rows: [{ candidate_id: "catalog_1", field: "year", reason: "DIRECT_CONFLICT" }]
  }
}), {
  disposition: "CONFLICT_TRACE_REVIEWABLE",
  next_action: "REVIEW_FIELD_LEVEL_CONFLICT_TRACE",
  structured_conflict_count: 1
});

assert.throws(
  () => buildCatalogGapDispositionPacket({ coverageRows: coverageRows.slice(1), conflictRows }),
  /expected 2093 rows/
);
assert.throws(
  () => buildCatalogGapDispositionPacket({
    coverageRows: coverageRows.map((row, index) => index === 0
      ? { ...row, product_year_present: false, product_seen_any_year: true }
      : row),
    conflictRows
  }),
  /frozen_coverage_breakdown_mismatch/
);
assert.throws(
  () => buildCatalogGapDispositionPacket({ coverageRows, conflictRows: conflictRows.slice(1) }),
  /expected 929 conflict rows/
);
assert.throws(
  () => buildCatalogGapDispositionPacket({
    coverageRows,
    conflictRows: [{ ...conflictRows[0], id: coverageRows[0].id }, ...conflictRows.slice(1)]
  }),
  /duplicate_catalog_gap_id/
);

const directory = await mkdtemp(join(tmpdir(), "catalog-gap-disposition-"));
try {
  const coveragePath = join(directory, "coverage.json");
  const conflictPath = join(directory, "conflicts.json");
  const outputPath = join(directory, "packet.json");
  await writeFile(coveragePath, JSON.stringify({ row_predicates: coverageRows }), "utf8");
  await writeFile(conflictPath, JSON.stringify({ rows: conflictRows }), "utf8");
  await main([
    "node",
    "build-catalog-gap-disposition.mjs",
    "--coverage", coveragePath,
    "--conflicts", conflictPath,
    "--out", outputPath,
    "--source-snapshot", "frozen-production-audit-2026-07-30"
  ]);
  const written = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(written.gate, "FAIL_CLOSED");
  assert.equal(written.dispositions.length, 3022);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("catalog gap disposition tests passed");
