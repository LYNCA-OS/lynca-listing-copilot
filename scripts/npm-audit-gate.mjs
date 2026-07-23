import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const blockingSeverities = Object.freeze(["moderate", "high", "critical"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseJson(value) {
  try {
    return JSON.parse(cleanText(value));
  } catch {
    return null;
  }
}

function vulnerabilityCounts(payload = {}) {
  const counts = payload?.metadata?.vulnerabilities;
  return counts && typeof counts === "object" ? counts : null;
}

function blockingCount(counts = {}) {
  return blockingSeverities.reduce((sum, severity) => sum + Math.max(0, Number(counts?.[severity] || 0)), 0);
}

function transportFailure({ stdout = "", stderr = "", payload = null } = {}) {
  const combined = `${cleanText(stdout)}\n${cleanText(stderr)}\n${cleanText(payload?.error)}\n${cleanText(payload?.message)}`.toLowerCase();
  return /audit endpoint returned an error|service unavailable|bad request|econnreset|etimedout|enotfound|network|socket hang up|http (?:400|408|429|5\d\d)/.test(combined);
}

export async function runNpmAuditGate({
  attempts = 3,
  runAudit = async () => {
    try {
      const result = await execFileAsync("npm", ["audit", "--omit=dev", "--audit-level=moderate", "--json"], {
        maxBuffer: 16 * 1024 * 1024
      });
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      return {
        code: Number.isInteger(error?.code) ? error.code : 1,
        stdout: error?.stdout || "",
        stderr: error?.stderr || error?.message || ""
      };
    }
  },
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
} = {}) {
  const maximumAttempts = Math.max(1, Math.min(5, Math.trunc(Number(attempts) || 1)));
  const diagnostics = [];
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const result = await runAudit(attempt);
    const payload = parseJson(result.stdout);
    const counts = vulnerabilityCounts(payload);
    const blocked = counts ? blockingCount(counts) : null;
    diagnostics.push({
      attempt,
      exit_code: Number(result.code || 0),
      parsed_report: Boolean(payload),
      vulnerability_counts: counts,
      transport_failure: transportFailure({ ...result, payload })
    });

    if (Number(result.code || 0) === 0) {
      return { ok: true, degraded: false, vulnerability_counts: counts || {}, diagnostics };
    }
    if (counts && blocked > 0) {
      const error = new Error(`npm_audit_blocking_vulnerabilities:${blocked}`);
      error.code = "NPM_AUDIT_VULNERABILITIES";
      error.diagnostics = diagnostics;
      throw error;
    }
    if (counts && blocked === 0) {
      return { ok: true, degraded: false, vulnerability_counts: counts, diagnostics };
    }
    if (!diagnostics.at(-1).transport_failure) {
      const error = new Error("npm_audit_unclassified_failure");
      error.code = "NPM_AUDIT_UNCLASSIFIED_FAILURE";
      error.diagnostics = diagnostics;
      throw error;
    }
    if (attempt < maximumAttempts) await sleep(Math.min(10_000, attempt * 2_000));
  }
  return {
    ok: true,
    degraded: true,
    reason: "npm_audit_transport_unavailable",
    vulnerability_counts: null,
    diagnostics
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNpmAuditGate().then((result) => {
    const writer = result.degraded ? console.warn : console.log;
    writer(JSON.stringify({ event: "npm_audit_gate", ...result }));
  }).catch((error) => {
    console.error(JSON.stringify({
      event: "npm_audit_gate",
      ok: false,
      error_code: error.code || "NPM_AUDIT_FAILED",
      message: error.message,
      diagnostics: error.diagnostics || []
    }));
    process.exit(1);
  });
}
