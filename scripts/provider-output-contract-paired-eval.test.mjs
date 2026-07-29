import assert from "node:assert/strict";

import { expectedProviderContractArm } from "./run-provider-output-contract-paired-eval.mjs";

assert.deepEqual(expectedProviderContractArm("baseline"), {
  response_profile: "compact_sparse_v1",
  prompt_mode: "v4_ultra_fast_l2"
});
assert.deepEqual(expectedProviderContractArm("candidate"), {
  response_profile: "read_only_sparse_v4",
  prompt_mode: "v4_read_only_surface"
});
assert.throws(
  () => expectedProviderContractArm("standard"),
  /unknown_provider_contract_arm:standard/
);

console.log("provider-output-contract paired evaluator tests passed");
