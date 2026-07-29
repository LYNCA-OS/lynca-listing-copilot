import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { verifyTargetedAssistFixed20Gate } from "./verify-targeted-assist-fixed20-gate.mjs";

const expectedGitSha = "0123456789abcdef0123456789abcdef01234567";
const pairedGateRunId = "123456789";

const fixed20Workflow = await readFile(
  new URL("../.github/workflows/fixed20-cold-algorithm.yml", import.meta.url),
  "utf8"
);
const pairedWorkflow = await readFile(
  new URL("../.github/workflows/targeted-assist-paired20.yml", import.meta.url),
  "utf8"
);
assert.match(fixed20Workflow, /contents:\s+write/);
assert.match(fixed20Workflow, /refs\/tags\/eval-fixed20-targeted-assist-\$\{EXPECTED_GIT_SHA\}/);
assert.match(fixed20Workflow, /group: fixed20-cold-algorithm-\$\{\{ inputs\.expected_git_sha \}\}/);
assert.match(fixed20Workflow, /git\/refs/);
assert.ok(
  fixed20Workflow.indexOf("Consume this deployment gate exactly once")
    < fixed20Workflow.indexOf("Run the one allowed cold 20"),
  "the atomic gate-consumption ref must be created before any fixed20 Provider calls"
);
assert.match(fixed20Workflow, /--expected-git-sha "\$EXPECTED_GIT_SHA"/);
assert.match(pairedWorkflow, /contents:\s+write/);
assert.match(pairedWorkflow, /refs\/tags\/eval-targeted-assist-paired-\$\{EXPECTED_GIT_SHA\}/);
assert.ok(
  pairedWorkflow.indexOf("Consume this deployment SHA for one paired evaluation")
    < pairedWorkflow.indexOf("Run familiar and unseen paired scoreboards"),
  "the exact SHA must be consumed before paired Provider calls"
);

function passingGate() {
  return {
    schema_version: "targeted-assist-two-scoreboard-gate-v1",
    provenance: {
      expected_git_sha: expectedGitSha,
      workflow_run_id: pairedGateRunId
    },
    familiar: {
      schema_version: "targeted-assist-paired20-report-v1",
      cohort: "FAMILIAR",
      pair_count: 10,
      gate: { decision: "PASS_COHORT_ONLY", reasons: [] }
    },
    unseen: {
      schema_version: "targeted-assist-paired20-report-v1",
      cohort: "UNSEEN",
      pair_count: 10,
      gate: { decision: "PASS_COHORT_ONLY", reasons: [] }
    },
    decision: "READY_FOR_ONE_FIXED20"
  };
}

function passingWorkflowRun() {
  return {
    id: Number(pairedGateRunId),
    head_sha: expectedGitSha,
    path: ".github/workflows/targeted-assist-paired20.yml@refs/heads/main",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success"
  };
}

const admission = verifyTargetedAssistFixed20Gate({
  gate: passingGate(),
  workflowRun: passingWorkflowRun(),
  expectedGitSha,
  pairedGateRunId
});
assert.equal(admission.admitted, true);
assert.equal(admission.expected_git_sha, expectedGitSha);
assert.equal(admission.paired_gate_run_id, pairedGateRunId);

for (const [name, mutate, expectedReason] of [
  ["no-go", (gate) => { gate.decision = "NO_GO"; }, "GATE_NOT_READY"],
  ["familiar failed", (gate) => { gate.familiar.gate.decision = "NO_GO"; }, "FAMILIAR_COHORT_NOT_PASS"],
  ["unseen failed", (gate) => { gate.unseen.gate.decision = "NO_GO"; }, "UNSEEN_COHORT_NOT_PASS"],
  ["unseen reasons", (gate) => { gate.unseen.gate.reasons = ["REGRESSION"]; }, "UNSEEN_GATE_REASONS_NOT_EMPTY"],
  ["swapped cohort", (gate) => { gate.familiar.cohort = "UNSEEN"; }, "FAMILIAR_REPORT_IDENTITY_MISMATCH"],
  ["short cohort", (gate) => { gate.unseen.pair_count = 9; }, "UNSEEN_PAIR_COUNT_MISMATCH"],
  ["wrong gate sha", (gate) => { gate.provenance.expected_git_sha = "f".repeat(40); }, "GATE_GIT_SHA_MISMATCH"],
  ["wrong gate run", (gate) => { gate.provenance.workflow_run_id = "8"; }, "GATE_RUN_ID_MISMATCH"]
]) {
  const gate = passingGate();
  mutate(gate);
  assert.throws(
    () => verifyTargetedAssistFixed20Gate({ gate, workflowRun: passingWorkflowRun(), expectedGitSha, pairedGateRunId }),
    new RegExp(expectedReason),
    name
  );
}

for (const [name, mutate, expectedReason] of [
  ["wrong actions sha", (run) => { run.head_sha = "f".repeat(40); }, "ACTIONS_HEAD_SHA_MISMATCH"],
  ["wrong actions run", (run) => { run.id = 8; }, "ACTIONS_RUN_ID_MISMATCH"],
  ["wrong workflow", (run) => { run.path = ".github/workflows/fixed20-cold-algorithm.yml"; }, "ACTIONS_WORKFLOW_PATH_MISMATCH"],
  ["wrong event", (run) => { run.event = "push"; }, "ACTIONS_EVENT_MISMATCH"],
  ["not completed", (run) => { run.status = "in_progress"; }, "ACTIONS_RUN_NOT_COMPLETED"],
  ["failed run", (run) => { run.conclusion = "failure"; }, "ACTIONS_RUN_NOT_SUCCESS"]
]) {
  const workflowRun = passingWorkflowRun();
  mutate(workflowRun);
  assert.throws(
    () => verifyTargetedAssistFixed20Gate({ gate: passingGate(), workflowRun, expectedGitSha, pairedGateRunId }),
    new RegExp(expectedReason),
    name
  );
}

console.log("targeted assist fixed20 gate verifier tests passed");
