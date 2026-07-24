#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CATEGORY = Object.freeze({
  RUNNABLE: "RUNNABLE_BACKLOG_WAKE_GAP",
  UPSTREAM: "UPSTREAM_PRE_PROVIDER",
  RETRY: "RETRY_OR_PRIOR_ATTEMPT",
  RELEASE: "CAPACITY_RELEASE_LATENCY",
  STALE: "CAPACITY_LEASE_RELEASE_UNCONFIRMED",
  NONE: "NO_ENQUEUED_BACKLOG_OBSERVED"
});

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function intervalUnionDuration(intervals, startMs, endMs) {
  const clipped = intervals
    .map(([start, end]) => [Math.max(startMs, start), Math.min(endMs, end)])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let cursorStart = null;
  let cursorEnd = null;
  for (const [start, end] of clipped) {
    if (cursorStart === null) {
      cursorStart = start;
      cursorEnd = end;
      continue;
    }
    if (start <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, end);
      continue;
    }
    total += cursorEnd - cursorStart;
    cursorStart = start;
    cursorEnd = end;
  }
  if (cursorStart !== null) total += cursorEnd - cursorStart;
  return total;
}

function normalizedResult(result) {
  const providerStartMs = timestamp(result?.provider_slot_timing?.started_at);
  const providerCompletedMs = timestamp(result?.provider_slot_timing?.completed_at);
  const jobCreatedMs = timestamp(result?.job_created_at);
  const jobStartedMs = timestamp(result?.job_started_at);
  const release = result?.provider_capacity_stage_handoff || {};
  return {
    job_id: result?.job_id || null,
    slot: Number(result?.provider_capacity_slot),
    attempt_count: Math.max(1, Number(result?.attempt_count) || 1),
    job_created_ms: jobCreatedMs,
    job_started_ms: jobStartedMs,
    provider_started_ms: providerStartMs,
    provider_completed_ms: providerCompletedMs,
    release_confirmed: release.released === true && Number(release.released_count || 0) > 0,
    release_latency_ms: nonNegative(release.latency_ms)
  };
}

export function analyzeProviderIdleGapCauses(report = {}) {
  const rows = (Array.isArray(report.results) ? report.results : [])
    .map(normalizedResult)
    .filter((row) => (
      Number.isInteger(row.slot)
      && row.slot > 0
      && row.provider_started_ms !== null
      && row.provider_completed_ms !== null
      && row.job_started_ms !== null
    ));
  const queuedIntervals = rows
    .filter((row) => row.job_created_ms !== null && row.job_started_ms > row.job_created_ms)
    .map((row) => [row.job_created_ms, row.job_started_ms]);
  const slots = new Map();
  for (const row of rows) {
    if (!slots.has(row.slot)) slots.set(row.slot, []);
    slots.get(row.slot).push(row);
  }

  const totals = Object.fromEntries(Object.values(CATEGORY).map((key) => [key, 0]));
  const gaps = [];
  for (const [slot, slotRows] of [...slots.entries()].sort((a, b) => a[0] - b[0])) {
    slotRows.sort((left, right) => left.provider_started_ms - right.provider_started_ms);
    for (let index = 1; index < slotRows.length; index += 1) {
      const previous = slotRows[index - 1];
      const next = slotRows[index];
      const rawStart = previous.provider_completed_ms;
      const rawEnd = next.provider_started_ms;
      if (rawEnd <= rawStart) continue;

      const rawGapMs = rawEnd - rawStart;
      const claimBoundaryMs = Math.min(rawEnd, Math.max(rawStart, next.job_started_ms));
      const releaseLatencyMs = previous.release_confirmed
        ? Math.min(previous.release_latency_ms, Math.max(0, claimBoundaryMs - rawStart))
        : 0;
      const capacityAvailableMs = previous.release_confirmed
        ? rawStart + releaseLatencyMs
        : null;
      let runnableMs = 0;
      let noBacklogMs = 0;
      let upstreamMs = 0;
      let retryMs = 0;
      let staleMs = 0;

      if (!previous.release_confirmed) {
        staleMs = Math.max(0, claimBoundaryMs - rawStart);
      } else {
        const claimWindowMs = Math.max(0, claimBoundaryMs - capacityAvailableMs);
        runnableMs = intervalUnionDuration(queuedIntervals, capacityAvailableMs, claimBoundaryMs);
        noBacklogMs = Math.max(0, claimWindowMs - runnableMs);
      }
      const postClaimMs = Math.max(0, rawEnd - claimBoundaryMs);
      if (next.attempt_count > 1) retryMs = postClaimMs;
      else upstreamMs = postClaimMs;

      totals[CATEGORY.RELEASE] += releaseLatencyMs;
      totals[CATEGORY.RUNNABLE] += runnableMs;
      totals[CATEGORY.NONE] += noBacklogMs;
      totals[CATEGORY.UPSTREAM] += upstreamMs;
      totals[CATEGORY.RETRY] += retryMs;
      totals[CATEGORY.STALE] += staleMs;
      gaps.push({
        slot,
        previous_job_id: previous.job_id,
        next_job_id: next.job_id,
        gap_start: new Date(rawStart).toISOString(),
        gap_end: new Date(rawEnd).toISOString(),
        raw_gap_ms: rawGapMs,
        categories_ms: {
          [CATEGORY.RELEASE]: releaseLatencyMs,
          [CATEGORY.RUNNABLE]: runnableMs,
          [CATEGORY.NONE]: noBacklogMs,
          [CATEGORY.UPSTREAM]: upstreamMs,
          [CATEGORY.RETRY]: retryMs,
          [CATEGORY.STALE]: staleMs
        },
        evidence: {
          previous_capacity_release_confirmed: previous.release_confirmed,
          previous_capacity_release_latency_ms: previous.release_latency_ms,
          next_job_created_at: next.job_created_ms === null ? null : new Date(next.job_created_ms).toISOString(),
          next_job_started_at: new Date(next.job_started_ms).toISOString(),
          next_attempt_count: next.attempt_count
        }
      });
    }
  }

  const rawGapTotalMs = gaps.reduce((sum, gap) => sum + gap.raw_gap_ms, 0);
  const requiredRecoveryMs = Math.max(0, Number(report?.summary?.run_wall_ms || report.run_wall_ms || 0) - (20 / 6 * 60_000));
  const runnableMs = totals[CATEGORY.RUNNABLE];
  return {
    schema_version: "provider-idle-gap-cause-audit-v1",
    source: {
      generated_at: report.generated_at || null,
      deployment_id: report.deployment_id || null,
      shared_batch_id: report.shared_batch_id || null,
      result_count: rows.length,
      measured_slot_count: slots.size,
      reported_idle_gap_total_ms: Number(report?.summary?.provider_slot_idle_gaps?.idle_gap_total_ms || 0) || null
    },
    decision: {
      target_cards_per_minute: 6,
      required_recovery_ms: Math.round(requiredRecoveryMs),
      runnable_backlog_wake_gap_ms: Math.round(runnableMs),
      persistent_consumer_threshold_met: runnableMs >= requiredRecoveryMs,
      headroom_ms: Math.round(runnableMs - requiredRecoveryMs),
      caveat: "Historical lease and retry transition snapshots were not persisted. Only capacity releases and queue/worker/provider timestamps present in the sealed report are classified as confirmed."
    },
    totals_ms: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value)])),
    reconciliation: {
      raw_gap_total_ms: Math.round(rawGapTotalMs),
      classified_total_ms: Math.round(Object.values(totals).reduce((sum, value) => sum + value, 0)),
      matches_reported_idle_gap: Number(report?.summary?.provider_slot_idle_gaps?.idle_gap_total_ms || 0) === Math.round(rawGapTotalMs)
    },
    gaps
  };
}

async function main(argv = process.argv.slice(2)) {
  const inputPath = argv[0];
  if (!inputPath) throw new Error("Usage: analyze-provider-idle-gap-causes.mjs <report.json> [output.json]");
  const outputPath = argv[1] || null;
  const report = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const analysis = analyzeProviderIdleGapCauses(report);
  const serialized = `${JSON.stringify(analysis, null, 2)}\n`;
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, serialized);
  } else {
    process.stdout.write(serialized);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
