import { readFile, writeFile } from "node:fs/promises";
import {
  classifyCoveragePredicates,
  summarizeCoveragePredicates
} from "./audit-catalog-gap-coverage-classification.mjs";

export const catalogGapDispositionVersion = "catalog-gap-disposition-v1";

const actionForCoverageDisposition = Object.freeze({
  NO_BACKFILL_PRODUCT_YEAR_PRESENT: "RUN_RETRIEVAL_DIAGNOSTIC",
  SET_AS_PRODUCT_CANDIDATE: "REVIEW_SET_AS_PRODUCT_WITH_YEAR_AND_MANUFACTURER",
  PRODUCT_NAME_ABSENT_FROM_CATALOG: "REVIEWED_INTERNAL_CONFIRMATION",
  UNCLASSIFIED: "MANUAL_TAXONOMY_REVIEW"
});

function rowId(row, cohort) {
  const id = String(row?.id || row?.gap_id || "").trim();
  if (!id) throw new Error(`${cohort}_row_id_required`);
  return id;
}

function safeDispositionRow({ id, cohort, disposition, nextAction }) {
  return Object.freeze({
    id,
    cohort,
    disposition,
    next_action: nextAction,
    queue_status: "KEEP_OPEN",
    automatic_close_allowed: false,
    catalog_write_allowed: false,
    production_title_change_allowed: false,
    identity_truth: false,
    training_eligible: false,
    holdout_consumed: false
  });
}

function conflictTraceRows(row = {}) {
  const snapshot = row.candidate_snapshot && typeof row.candidate_snapshot === "object"
    ? row.candidate_snapshot
    : {};
  const rows = Array.isArray(snapshot.conflict_rows) ? snapshot.conflict_rows : [];
  return rows.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const reason = String(entry.reason || "").trim();
    const field = String(entry.field || "").trim();
    const candidateId = String(entry.candidate_id || "").trim();
    return Boolean(reason && (field || candidateId));
  });
}

export function classifyConflictDisposition(row = {}) {
  const traceRows = conflictTraceRows(row);
  return traceRows.length > 0
    ? {
        disposition: "CONFLICT_TRACE_REVIEWABLE",
        next_action: "REVIEW_FIELD_LEVEL_CONFLICT_TRACE",
        structured_conflict_count: traceRows.length
      }
    : {
        disposition: "CONFLICT_RETRACE_REQUIRED",
        next_action: "DETERMINISTIC_REPLAY_TO_CAPTURE_CONFLICT_TRACE",
        structured_conflict_count: 0
      };
}

function assertUniqueIds(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`duplicate_catalog_gap_id:${row.id}`);
    seen.add(row.id);
  }
}

export function buildCatalogGapDispositionPacket({
  coverageRows,
  conflictRows,
  expectedCoverageRows = 2093,
  expectedConflictRows = 929,
  expectedOpenRows = 3090,
  sourceSnapshot = ""
} = {}) {
  if (!Array.isArray(coverageRows)) throw new TypeError("coverageRows must be an array");
  if (!Array.isArray(conflictRows)) throw new TypeError("conflictRows must be an array");

  const coverageSummary = summarizeCoveragePredicates(coverageRows, {
    expectedTotal: expectedCoverageRows
  });
  const frozenCoverageCounts = {
    NO_BACKFILL_PRODUCT_YEAR_PRESENT: 985,
    SET_AS_PRODUCT_CANDIDATE: 73,
    PRODUCT_NAME_ABSENT_FROM_CATALOG: 762,
    UNCLASSIFIED: 273
  };
  for (const [disposition, expected] of Object.entries(frozenCoverageCounts)) {
    const actual = Number(coverageSummary.mutually_exclusive[disposition] || 0);
    if (actual !== expected) {
      throw new Error(`frozen_coverage_breakdown_mismatch:${disposition}:expected_${expected}:received_${actual}`);
    }
  }
  if (conflictRows.length !== Number(expectedConflictRows)) {
    throw new Error(`expected ${expectedConflictRows} conflict rows, received ${conflictRows.length}`);
  }

  const coverageDispositions = coverageRows.map((row) => {
    const classification = classifyCoveragePredicates(row);
    return safeDispositionRow({
      id: rowId(row, "coverage"),
      cohort: "CATALOG_COVERAGE_GAP",
      disposition: classification.disposition,
      nextAction: actionForCoverageDisposition[classification.disposition]
    });
  });
  const conflictDispositions = conflictRows.map((row) => {
    const classification = classifyConflictDisposition(row);
    return {
      ...safeDispositionRow({
        id: rowId(row, "conflict"),
        cohort: "CANDIDATE_CONFLICT_BLOCKED",
        disposition: classification.disposition,
        nextAction: classification.next_action
      }),
      structured_conflict_count: classification.structured_conflict_count
    };
  });
  const dispositions = [...coverageDispositions, ...conflictDispositions];
  assertUniqueIds(dispositions);

  const knownRows = dispositions.length;
  const unaccountedOpenRows = Number(expectedOpenRows) - knownRows;
  if (!Number.isInteger(unaccountedOpenRows) || unaccountedOpenRows < 0) {
    throw new Error(`invalid_open_gap_total:${expectedOpenRows}`);
  }

  const countsByDisposition = {};
  for (const row of dispositions) {
    countsByDisposition[row.disposition] = (countsByDisposition[row.disposition] || 0) + 1;
  }
  const retraceRequired = countsByDisposition.CONFLICT_RETRACE_REQUIRED || 0;
  const unsafeMutationCount = dispositions.filter((row) => (
    row.automatic_close_allowed
    || row.catalog_write_allowed
    || row.production_title_change_allowed
    || row.identity_truth
    || row.training_eligible
    || row.holdout_consumed
  )).length;
  if (unsafeMutationCount !== 0) throw new Error("unsafe_catalog_gap_disposition_generated");

  return Object.freeze({
    schema_version: catalogGapDispositionVersion,
    source_snapshot: String(sourceSnapshot || "").trim() || null,
    mode: "DETERMINISTIC_OFFLINE_ONLY",
    expected_open_rows: Number(expectedOpenRows),
    known_disposition_rows: knownRows,
    unaccounted_open_rows: unaccountedOpenRows,
    coverage_summary: coverageSummary,
    counts_by_disposition: Object.freeze(countsByDisposition),
    conflict_retrace_required: retraceRequired,
    disposition_packet_ready: true,
    catalog_gap_closed: false,
    gate: "FAIL_CLOSED",
    gate_reasons: Object.freeze([
      ...(unaccountedOpenRows > 0 ? ["UNACCOUNTED_OPEN_ROWS"] : []),
      ...(retraceRequired > 0 ? ["HISTORICAL_CONFLICT_TRACE_MISSING"] : []),
      "INDEPENDENT_REVIEW_REQUIRED_BEFORE_ANY_CATALOG_WRITE"
    ]),
    automatic_close_count: 0,
    catalog_write_count: 0,
    production_title_change_count: 0,
    identity_truth_count: 0,
    training_eligible_count: 0,
    holdout_consumed_count: 0,
    dispositions: Object.freeze(dispositions)
  });
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function readRows(path, label) {
  if (!path) throw new Error(`--${label} is required`);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.row_predicates)) return parsed.row_predicates;
  throw new Error(`${label}_rows_not_found`);
}

export async function main(argv = process.argv) {
  const coveragePath = argValue(argv, "--coverage");
  const conflictPath = argValue(argv, "--conflicts");
  const outputPath = argValue(argv, "--out");
  const packet = buildCatalogGapDispositionPacket({
    coverageRows: await readRows(coveragePath, "coverage"),
    conflictRows: await readRows(conflictPath, "conflicts"),
    expectedCoverageRows: Number(argValue(argv, "--expected-coverage", "2093")),
    expectedConflictRows: Number(argValue(argv, "--expected-conflicts", "929")),
    expectedOpenRows: Number(argValue(argv, "--expected-open", "3090")),
    sourceSnapshot: argValue(argv, "--source-snapshot")
  });
  const output = `${JSON.stringify(packet, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, output, "utf8");
  else process.stdout.write(output);
  return packet;
}

if (process.argv[1]?.endsWith("build-catalog-gap-disposition.mjs")) {
  main().catch((error) => {
    console.error(`catalog gap disposition failed: ${error.message}`);
    process.exitCode = 1;
  });
}
