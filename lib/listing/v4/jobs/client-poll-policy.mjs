const terminalStatuses = new Set([
  "L2_READY",
  "FAILED",
  "CANCELLED"
]);

const queueWaitStatuses = new Set([
  "PENDING",
  "QUEUED",
  "RETRYING"
]);

function normalizedStatus(value) {
  return String(value || "PENDING").trim().toUpperCase() || "PENDING";
}

function nonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function observeClientJobPoll({
  status,
  elapsedMs = 0,
  warningAfterMs = 120_000
} = {}) {
  const normalized = normalizedStatus(status);
  const elapsed = nonNegativeNumber(elapsedMs);
  const warningBoundary = Math.max(1_000, nonNegativeNumber(warningAfterMs) || 120_000);
  const terminal = terminalStatuses.has(normalized);
  const delayed = !terminal && elapsed >= warningBoundary;
  const phase = queueWaitStatuses.has(normalized)
    ? "QUEUE_WAIT"
    : normalized === "RUNNING"
      ? "ACTIVE_EXECUTION"
      : terminal
        ? "TERMINAL"
        : "SERVER_PENDING";

  return {
    status: normalized,
    phase,
    terminal,
    delayed,
    elapsed_ms: elapsed,
    warning_code: delayed
      ? phase === "QUEUE_WAIT"
        ? "QUEUE_WAIT_LONG"
        : phase === "ACTIVE_EXECUTION"
          ? "ACTIVE_EXECUTION_LONG"
          : "SERVER_PENDING_LONG"
      : null,
    // Durable queue/session state is authoritative. A browser wall clock may
    // warn the writer, but it must never manufacture a failed recognition.
    should_continue_polling: !terminal,
    should_mark_failed: false
  };
}

export function isClientPollTerminalStatus(status) {
  return terminalStatuses.has(normalizedStatus(status));
}

export function groupClientResultsByJobId(results = []) {
  const grouped = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const jobId = String(result?.v4_job_id || "").trim();
    if (!jobId) continue;
    const linked = grouped.get(jobId) || [];
    linked.push(result);
    grouped.set(jobId, linked);
  }
  return grouped;
}

export function queuedStatusPollDelay(elapsedMs = 0, pendingCount = 0) {
  const elapsed = nonNegativeNumber(elapsedMs);
  const pending = Math.floor(nonNegativeNumber(pendingCount));
  const scaleFloor = pending > 1000
    ? 3000
    : pending > 300
      ? 2000
      : pending > 100
        ? 1200
        : 0;
  const elapsedDelay = elapsed < 30_000 ? 800 : elapsed < 90_000 ? 1200 : 1800;
  return Math.max(scaleFloor, elapsedDelay);
}
