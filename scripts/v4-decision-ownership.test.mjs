import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

const [
  routePlannerSource,
  productionStrategySource,
  titleApiSource,
  nativeCoreSource,
  legacyAdapterSource,
  enqueueApiSource,
  trustedIdentitySource,
  pipelineContractSource,
  observerSource
] = await Promise.all([
  source("lib/listing/v4/route-planner/route-planner.mjs"),
  source("lib/listing/v4/policy/production-strategy.mjs"),
  source("api/v4/listing-copilot-title.js"),
  source("lib/listing/v4/pipeline/native-recognition-core.mjs"),
  source("api/listing-copilot-title.js"),
  source("api/v4/listing-job-enqueue.js"),
  source("lib/listing/v4/session/trusted-session-identity.mjs"),
  source("lib/listing/v4/pipeline/pipeline-contract.mjs"),
  source("lib/listing/v4/policy/recognition-policy-observer.mjs")
]);

const exactAnchorBody = routePlannerSource.match(
  /function hasExactAnchor\(payload = \{\}\) \{([\s\S]*?)\n\}/
)?.[1] || "";
assert.ok(exactAnchorBody, "the route planner must expose one auditable exact-anchor gate");
assert.match(exactAnchorBody, /TCG_EXACT_LOOKUP/);
assert.match(exactAnchorBody, /SPORTS_COMPOSITE_LOOKUP/);
assert.doesNotMatch(
  exactAnchorBody,
  /serial|print_run|numerical_rarity|collector_number|checklist_code|RegExp|\.test\s*\(/i,
  "commercial numbers and raw regexes must never re-create an identity-anchor decision"
);

assert.match(productionStrategySource, /recognition_route:\s*Object\.freeze\(\{[\s\S]*?plan:\s*planV4RecognitionRoute/);
assert.match(productionStrategySource, /candidate_control:\s*Object\.freeze\(\{[\s\S]*?select:[\s\S]*?build_retrieval_application:[\s\S]*?apply_decision:/);
assert.match(titleApiSource, /v4ProductionStrategy\.recognition_route\.plan\(payload, process\.env\)/);
assert.match(titleApiSource, /pipeline\/native-recognition-core\.mjs/);
assert.doesNotMatch(titleApiSource, /\.\.\/listing-copilot-title\.js/);
assert.match(nativeCoreSource, /export async function runNativeV4Recognition/);
assert.doesNotMatch(nativeCoreSource, /export default async function handler/);
assert.doesNotMatch(legacyAdapterSource, /native-recognition-core|runNativeV4Recognition|runListingRecognitionCore/);
assert.doesNotMatch(pipelineContractSource, /TRANSITIONAL_CORE_BRIDGE/);
assert.doesNotMatch(titleApiSource + nativeCoreSource, /legacy_v2_result|adaptV2ResultToV4/);
assert.doesNotMatch(
  titleApiSource,
  /import\s+\{[^}]*planV4RecognitionRoute[^}]*\}/,
  "the HTTP pipeline must consume the strategy facade instead of importing a second route owner"
);

assert.match(enqueueApiSource, /"v4_hard_invariant_snapshot"/);
assert.match(trustedIdentitySource, /"v4_hard_invariant_snapshot"/);
assert.match(
  pipelineContractSource,
  /CANDIDATE_FIELDS_APPLIED_OUTSIDE_ATOMIC_STAGE/,
  "candidate selection and application must remain one audited decision stage"
);
assert.match(observerSource, /can_execute:\s*false/);
assert.doesNotMatch(observerSource, /can_execute:\s*true/);

console.log("v4 decision ownership tests passed");
