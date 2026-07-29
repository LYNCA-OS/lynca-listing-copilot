#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  TARGETED_ASSIST_FIXED20_READY_DECISION,
  TARGETED_ASSIST_PAIRED_COHORT_SIZE
} from "./run-targeted-assist-paired-eval.mjs";

const PAIRED_WORKFLOW_PATH = ".github/workflows/targeted-assist-paired20.yml";

function cleanText(value) {
  return String(value ?? "").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function normalizedSha(value) {
  return cleanText(value).toLowerCase();
}

export function verifyTargetedAssistFixed20Gate({
  gate = {},
  workflowRun = {},
  expectedGitSha,
  pairedGateRunId
} = {}) {
  const expectedSha = normalizedSha(expectedGitSha);
  const expectedRunId = cleanText(pairedGateRunId);
  const failures = [];
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) failures.push("EXPECTED_GIT_SHA_INVALID");
  if (!/^\d+$/.test(expectedRunId)) failures.push("PAIRED_GATE_RUN_ID_INVALID");
  if (gate.schema_version !== "targeted-assist-two-scoreboard-gate-v1") failures.push("GATE_SCHEMA_MISMATCH");
  if (gate.decision !== TARGETED_ASSIST_FIXED20_READY_DECISION) failures.push("GATE_NOT_READY");
  if (gate.familiar?.schema_version !== "targeted-assist-paired20-report-v1" || gate.familiar?.cohort !== "FAMILIAR") {
    failures.push("FAMILIAR_REPORT_IDENTITY_MISMATCH");
  }
  if (gate.unseen?.schema_version !== "targeted-assist-paired20-report-v1" || gate.unseen?.cohort !== "UNSEEN") {
    failures.push("UNSEEN_REPORT_IDENTITY_MISMATCH");
  }
  if (gate.familiar?.gate?.decision !== "PASS_COHORT_ONLY") failures.push("FAMILIAR_COHORT_NOT_PASS");
  if (gate.unseen?.gate?.decision !== "PASS_COHORT_ONLY") failures.push("UNSEEN_COHORT_NOT_PASS");
  if (!Array.isArray(gate.familiar?.gate?.reasons) || gate.familiar.gate.reasons.length) {
    failures.push("FAMILIAR_GATE_REASONS_NOT_EMPTY");
  }
  if (!Array.isArray(gate.unseen?.gate?.reasons) || gate.unseen.gate.reasons.length) {
    failures.push("UNSEEN_GATE_REASONS_NOT_EMPTY");
  }
  if (Number(gate.familiar?.pair_count) !== TARGETED_ASSIST_PAIRED_COHORT_SIZE) {
    failures.push("FAMILIAR_PAIR_COUNT_MISMATCH");
  }
  if (Number(gate.unseen?.pair_count) !== TARGETED_ASSIST_PAIRED_COHORT_SIZE) {
    failures.push("UNSEEN_PAIR_COUNT_MISMATCH");
  }
  if (normalizedSha(gate.provenance?.expected_git_sha) !== expectedSha) failures.push("GATE_GIT_SHA_MISMATCH");
  if (cleanText(gate.provenance?.workflow_run_id) !== expectedRunId) failures.push("GATE_RUN_ID_MISMATCH");
  if (cleanText(workflowRun.id) !== expectedRunId) failures.push("ACTIONS_RUN_ID_MISMATCH");
  if (normalizedSha(workflowRun.head_sha) !== expectedSha) failures.push("ACTIONS_HEAD_SHA_MISMATCH");
  if (cleanText(workflowRun.path).split("@")[0] !== PAIRED_WORKFLOW_PATH) failures.push("ACTIONS_WORKFLOW_PATH_MISMATCH");
  if (workflowRun.event !== "workflow_dispatch") failures.push("ACTIONS_EVENT_MISMATCH");
  if (workflowRun.status !== "completed") failures.push("ACTIONS_RUN_NOT_COMPLETED");
  if (workflowRun.conclusion !== "success") failures.push("ACTIONS_RUN_NOT_SUCCESS");
  if (failures.length) {
    throw new Error(`targeted_assist_fixed20_gate_rejected:${failures.join(",")}`);
  }
  return {
    schema_version: "targeted-assist-fixed20-admission-v1",
    admitted: true,
    paired_gate_run_id: expectedRunId,
    expected_git_sha: expectedSha,
    paired_workflow_path: PAIRED_WORKFLOW_PATH,
    familiar_pair_count: Number(gate.familiar.pair_count),
    unseen_pair_count: Number(gate.unseen.pair_count),
    decision: TARGETED_ASSIST_FIXED20_READY_DECISION
  };
}

export async function main(argv = process.argv.slice(2)) {
  const gatePath = argValue(argv, "--gate");
  const workflowRunPath = argValue(argv, "--workflow-run");
  const expectedGitSha = argValue(argv, "--expected-git-sha");
  const pairedGateRunId = argValue(argv, "--paired-gate-run-id");
  const outPath = argValue(argv, "--out");
  if (!gatePath || !workflowRunPath) throw new Error("--gate and --workflow-run are required");
  const [gate, workflowRun] = await Promise.all([
    readFile(resolve(gatePath), "utf8").then(JSON.parse),
    readFile(resolve(workflowRunPath), "utf8").then(JSON.parse)
  ]);
  const admission = verifyTargetedAssistFixed20Gate({
    gate,
    workflowRun,
    expectedGitSha,
    pairedGateRunId
  });
  if (outPath) await writeFile(resolve(outPath), `${JSON.stringify(admission, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(admission, null, 2)}\n`);
  return admission;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
