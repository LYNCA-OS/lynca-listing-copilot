import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COS62_EVALUATION_AXES,
  GAMMA_53_SEALED_LABELS_PATH,
  LISTING_COPILOT_FETCHED_ORIGIN_MAIN_SHA,
  LISTING_COPILOT_PACKAGE_NAME,
  LISTING_COPILOT_REPO,
  REJECTED_LISTING_INTERNAL_ARMS,
  assertDistinctImplementations,
  assertGoldensRemainSealed,
  collectModuleSpecifiers,
  emptyEvaluationScores,
  independentRuntimeArmIdentity,
  listingCopilotArmIdentity,
  loadFrozenCohortMetadata,
  lunaParityFalseRuntimeArmEvidence,
  productionHandlersReachShadow,
  rejectListingInternalArm,
  relativeImportGraph,
  runDualConsumerDryRun
} from "../lib/listing/evaluation/dual-consumer-comparison.mjs";
import { LYNCA_RUNTIME_PINNED_SHA } from "../lib/listing/evaluation/independent-runtime-shadow.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stubSource = readFileSync(
  resolve(repoRoot, "scripts/fixtures/independent-runtime-identify-stub.mjs"),
  "utf8"
);
const lunaSource = readFileSync(
  resolve(repoRoot, "experiments/luna-parity/luna-parity-core.mjs"),
  "utf8"
);

const falseRuntime = lunaParityFalseRuntimeArmEvidence(repoRoot);
assert.equal(falseRuntime.is_independent_runtime, false);
assert.ok(falseRuntime.listing_thin_imports.length >= 5, "gamma-53 runtime arm must import listing thin modules");
assert.match(lunaSource, /lib\/listing\/thin\/thin-listing-path\.mjs/);
assert.match(lunaSource, /runtime_active_high_low/);
for (const arm of REJECTED_LISTING_INTERNAL_ARMS) {
  assert.throws(() => rejectListingInternalArm(arm), /dual_consumer_rejected_listing_internal_arm/);
}

const listingArm = listingCopilotArmIdentity({ repoRoot });
assert.equal(listingArm.package_name, LISTING_COPILOT_PACKAGE_NAME);
assert.equal(listingArm.repo, LISTING_COPILOT_REPO);
assert.equal(listingArm.fetched_origin_main_sha, LISTING_COPILOT_FETCHED_ORIGIN_MAIN_SHA);
assert.equal(listingArm.import_graph_includes_listing_thin, true);

const runtimeArm = independentRuntimeArmIdentity();
assert.equal(runtimeArm.package_name, "lynca-runtime");
assert.equal(runtimeArm.fetched_origin_main_sha, LYNCA_RUNTIME_PINNED_SHA);
assert.equal(runtimeArm.import_graph_includes_listing_thin, false);
assert.notEqual(listingArm.fetched_origin_main_sha, runtimeArm.fetched_origin_main_sha);
assertDistinctImplementations(listingArm, runtimeArm);

assert.throws(
  () => assertDistinctImplementations(listingArm, {
    ...runtimeArm,
    arm_id: "runtime_active_high_low",
    package_name: LISTING_COPILOT_PACKAGE_NAME,
    repo: LISTING_COPILOT_REPO,
    import_graph_includes_listing_thin: true,
    entry: "lib/listing/thin/thin-listing-path.mjs",
    invocation: "in_process_import"
  }),
  /dual_consumer_rejected_listing_internal_arm/
);

assert.throws(
  () => assertDistinctImplementations(listingArm, {
    ...runtimeArm,
    package_name: LISTING_COPILOT_PACKAGE_NAME
  }),
  /dual_consumer_runtime_arm_package_mismatch/
);

assert.throws(
  () => assertDistinctImplementations(listingArm, {
    ...runtimeArm,
    import_graph_includes_listing_thin: true
  }),
  /dual_consumer_runtime_arm_imports_listing_thin/
);

assert.equal(
  collectModuleSpecifiers(stubSource).some((specifier) => specifier.includes("lib/listing")),
  false
);
assert.doesNotMatch(stubSource, /lynca-listing-copilot/);
assert.match(stubSource, /not_lynca_runtime/);

const productionGraph = relativeImportGraph("api/csm-listing-title.js", repoRoot);
assert.ok(productionGraph.some((file) => file.includes("lib/listing/thin/")));
assert.equal(
  productionGraph.some((file) => file.includes("independent-runtime-shadow.mjs")),
  false,
  "direct production handler must not import the shadow adapter"
);
assert.deepEqual(productionHandlersReachShadow(repoRoot), []);

const ingestGraph = relativeImportGraph("api/csm-listing-title-ingest.js", repoRoot);
assert.equal(ingestGraph.some((file) => file.includes("independent-runtime-shadow.mjs")), false);

const cohort = loadFrozenCohortMetadata(repoRoot);
assert.equal(cohort.case_count, 53);
assert.equal(cohort.sealed_labels_opened, false);
assert.equal(cohort.sealed_labels_exist, true);
assert.equal(cohort.images_present, 0, "the 53-case image bytes are not in this checkout");
assert.equal(GAMMA_53_SEALED_LABELS_PATH, "experiments/luna-parity/shadow-53-gamma/golden/sealed-labels.jsonl");

assert.throws(
  () => assertGoldensRemainSealed({ argv: ["--sealed-labels", "nope"] }),
  /dual_consumer_forbidden_execution_argument/
);
assert.throws(
  () => assertGoldensRemainSealed({ payload: { reviewed_title: "secret" } }),
  /dual_consumer_forbidden_execution_key/
);
assert.throws(
  () => assertGoldensRemainSealed({ openedSealedLabels: true }),
  /dual_consumer_sealed_labels_opened_before_execution_complete/
);

const comparison = runDualConsumerDryRun({ repoRoot, env: {} });
assert.equal(comparison.schema_version, "dual-consumer-comparison-v1");
assert.equal(comparison.production_authorized, false);
assert.equal(comparison.surviving_listing_application, null);
assert.equal(comparison.goldens_sealed, true);
assert.equal(comparison.scores_invented, false);
assert.equal(comparison.shadow_default_off, true);
assert.equal(comparison.cohort.case_count, 53);
assert.equal(comparison.cohort.sealed_labels_opened, false);
assert.equal(comparison.rejected_false_runtime_arms.is_independent_runtime, false);
assert.equal(
  comparison.arms.listing_copilot_origin_main.fetched_origin_main_sha,
  LISTING_COPILOT_FETCHED_ORIGIN_MAIN_SHA
);
assert.equal(
  comparison.arms.lynca_runtime_origin_main.fetched_origin_main_sha,
  LYNCA_RUNTIME_PINNED_SHA
);

const scores = comparison.scores;
assert.deepEqual(Object.keys(scores), [...COS62_EVALUATION_AXES]);
for (const axis of COS62_EVALUATION_AXES) {
  assert.equal(scores[axis].listing_copilot, null);
  assert.equal(scores[axis].lynca_runtime, null);
  assert.equal(scores[axis].delta, null);
  assert.match(scores[axis].note, /Do not invent/);
}
assert.deepEqual(emptyEvaluationScores()[COS62_EVALUATION_AXES[0]].listing_copilot, null);

const scoredLie = JSON.parse(readFileSync(
  resolve(repoRoot, "experiments/luna-parity/shadow-53-gamma/scored/scored-summary.json"),
  "utf8"
));
assert.equal(scoredLie.control_arm, "runtime_active_high_low");
assert.equal(
  comparison.notes.some((note) => note.includes("are not dual-consumer evidence")),
  true
);
assert.equal(Object.values(scores).some((slot) => slot.listing_copilot === scoredLie.control_mean_f1), false,
  "do not copy the gamma-53 internal-arm F1 into the dual-consumer skeleton");

console.log("dual-consumer-comparison.test.mjs passed");
