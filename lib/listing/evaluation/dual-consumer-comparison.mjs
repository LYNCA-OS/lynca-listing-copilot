import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LYNCA_RUNTIME_IDENTIFY_CLI,
  LYNCA_RUNTIME_PACKAGE_NAME,
  LYNCA_RUNTIME_PINNED_SHA,
  LYNCA_RUNTIME_REPO,
  listingIndependentRuntimeShadowEnabled
} from "./independent-runtime-shadow.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const LISTING_COPILOT_REPO_ROOT = resolve(here, "../../..");

export const DUAL_CONSUMER_COMPARISON_SCHEMA = "dual-consumer-comparison-v1";
export const LISTING_COPILOT_REPO = "LYNCA-OS/lynca-listing-copilot";
export const LISTING_COPILOT_PACKAGE_NAME = "lynca-listing-copilot";
export const LISTING_COPILOT_FETCHED_ORIGIN_MAIN_SHA =
  "2fe6c2db6f4570ec4db552bf23d8a88544cd12de";
export const GAMMA_53_COHORT_DIR = "experiments/luna-parity/shadow-53-gamma";
export const GAMMA_53_ASSET_IDS_PATH = `${GAMMA_53_COHORT_DIR}/input/asset-ids.json`;
export const GAMMA_53_DATASET_PATH = `${GAMMA_53_COHORT_DIR}/input/dataset.json`;
export const GAMMA_53_SEALED_LABELS_PATH = `${GAMMA_53_COHORT_DIR}/golden/sealed-labels.jsonl`;
export const LISTING_PRODUCTION_ENTRY = "api/csm-listing-title.js";
export const LISTING_THIN_PATH = "lib/listing/thin/thin-listing-path.mjs";
export const LUNA_PARITY_CORE_PATH = "experiments/luna-parity/luna-parity-core.mjs";

export const REJECTED_LISTING_INTERNAL_ARMS = Object.freeze([
  "runtime_active_high_low",
  "runtime_active_high_low_repeat",
  "runtime_active_detail_original_low",
  "lynca_csm_direct_title_high_low"
]);

export const COS62_EVALUATION_AXES = Object.freeze([
  "no_unsupported_or_fabricated_claims",
  "collectible_identity_grounded_understanding",
  "card_number_serial_grade",
  "marketplace_title",
  "founder_blind_preference",
  "writer_edit_burden",
  "latency_cost",
  "production_infra_preservation_or_migration_cost"
]);

export const GOLDEN_SEAL_FORBIDDEN_KEYS = Object.freeze([
  "canonical_title", "source_titles", "reviewed_title", "reference_title",
  "ground_truth", "corrected_title", "source_feedback_id",
  "sealed_eval_label_ref", "label_key", "labels", "reference",
  "score", "f1", "recall", "precision"
]);

const staticModulePattern =
  /(?:^|\n)\s*(?:import|export)\s+(?:[\w*$,\s{}]*?\s+from\s+)?(["'])([^"']+)\1/g;
const moduleCallPattern = /\b(import|require)\s*\(\s*([^)]*?)\s*\)/g;

export function emptyScoreSlot() {
  return Object.freeze({
    listing_copilot: null,
    lynca_runtime: null,
    delta: null,
    n: null,
    note: "Unscored. Live cohort execution has not completed. Do not invent a number."
  });
}

export function emptyEvaluationScores() {
  return Object.freeze(Object.fromEntries(
    COS62_EVALUATION_AXES.map((axis) => [axis, emptyScoreSlot()])
  ));
}

export function gitSha(cwd, ref) {
  return String(execFileSync("git", ["rev-parse", ref], {
    cwd,
    encoding: "utf8"
  })).trim().toLowerCase();
}

export function packageNameOf(repoRoot) {
  const parsed = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  return String(parsed?.name || "");
}

export function collectModuleSpecifiers(source) {
  const specifiers = [];
  for (const match of String(source).matchAll(staticModulePattern)) specifiers.push(match[2]);
  for (const match of String(source).matchAll(moduleCallPattern)) {
    const argument = match[2].trim();
    const literal = /^(["'])([^"'\\]+)\1$/.exec(argument);
    if (!literal) continue;
    specifiers.push(literal[2]);
  }
  return [...new Set(specifiers)];
}

export function relativeImportGraph(entryRelative, repoRoot = LISTING_COPILOT_REPO_ROOT) {
  const seen = new Set();
  const files = [];
  const queue = [resolve(repoRoot, entryRelative)];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    if (!existsSync(path)) continue;
    files.push(relative(repoRoot, path) || path);
    let source;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const specifier of collectModuleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const next = resolve(dirname(path), specifier);
      for (const candidate of [next, `${next}.js`, `${next}.mjs`]) {
        if (existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return files.sort();
}

export function importGraphContains(files, needle) {
  const normalized = String(needle).replace(/\\/g, "/");
  return files.some((file) => file.replace(/\\/g, "/").includes(normalized));
}

export function lunaParityFalseRuntimeArmEvidence(repoRoot = LISTING_COPILOT_REPO_ROOT) {
  const source = readFileSync(resolve(repoRoot, LUNA_PARITY_CORE_PATH), "utf8");
  const specifiers = collectModuleSpecifiers(source);
  const listingThinImports = specifiers.filter((specifier) => specifier.includes("lib/listing/thin/"));
  return Object.freeze({
    path: LUNA_PARITY_CORE_PATH,
    rejected_arm_keys: REJECTED_LISTING_INTERNAL_ARMS,
    listing_thin_imports: listingThinImports,
    is_independent_runtime: false,
    reason: "gamma-53 runtime_active_high_low imports Listing Copilot lib/listing/thin/* and is not LYNCA-OS/lynca-runtime."
  });
}

export function rejectListingInternalArm(armKey) {
  if (REJECTED_LISTING_INTERNAL_ARMS.includes(armKey)) {
    throw new Error(`dual_consumer_rejected_listing_internal_arm:${armKey}`);
  }
  return armKey;
}

export function listingCopilotArmIdentity({
  repoRoot = LISTING_COPILOT_REPO_ROOT,
  originMainSha = LISTING_COPILOT_FETCHED_ORIGIN_MAIN_SHA
} = {}) {
  const graph = relativeImportGraph(LISTING_PRODUCTION_ENTRY, repoRoot);
  return Object.freeze({
    arm_id: "listing_copilot_origin_main",
    repo: LISTING_COPILOT_REPO,
    package_name: packageNameOf(repoRoot),
    fetched_origin_main_sha: originMainSha,
    checkout_head_sha: gitSha(repoRoot, "HEAD"),
    entry: LISTING_PRODUCTION_ENTRY,
    identify_cli: null,
    import_graph_includes_listing_thin: importGraphContains(graph, "lib/listing/thin/"),
    import_graph_sample: graph.filter((file) => file.startsWith("lib/listing/thin/")).slice(0, 12)
  });
}

export function independentRuntimeArmIdentity({
  pinnedSha = LYNCA_RUNTIME_PINNED_SHA,
  checkoutSha = null,
  checkoutPath = null
} = {}) {
  return Object.freeze({
    arm_id: "lynca_runtime_origin_main",
    repo: LYNCA_RUNTIME_REPO,
    package_name: LYNCA_RUNTIME_PACKAGE_NAME,
    fetched_origin_main_sha: pinnedSha,
    checkout_head_sha: checkoutSha,
    checkout_path: checkoutPath,
    entry: LYNCA_RUNTIME_IDENTIFY_CLI,
    identify_command: "identify",
    import_graph_includes_listing_thin: false,
    invocation: "independent_process"
  });
}

export function assertDistinctImplementations(listingArm, runtimeArm) {
  rejectListingInternalArm(runtimeArm?.arm_id);
  if (REJECTED_LISTING_INTERNAL_ARMS.includes(listingArm?.arm_id)) {
    throw new Error(`dual_consumer_listing_arm_is_false_internal:${listingArm.arm_id}`);
  }
  if (listingArm?.package_name !== LISTING_COPILOT_PACKAGE_NAME) {
    throw new Error("dual_consumer_listing_arm_package_mismatch");
  }
  if (runtimeArm?.package_name !== LYNCA_RUNTIME_PACKAGE_NAME) {
    throw new Error("dual_consumer_runtime_arm_package_mismatch");
  }
  if (listingArm.package_name === runtimeArm.package_name) {
    throw new Error("dual_consumer_same_package_name");
  }
  if (listingArm.repo === runtimeArm.repo) {
    throw new Error("dual_consumer_same_repo");
  }
  if (!listingArm.import_graph_includes_listing_thin) {
    throw new Error("dual_consumer_listing_arm_missing_thin_path");
  }
  if (runtimeArm.import_graph_includes_listing_thin) {
    throw new Error("dual_consumer_runtime_arm_imports_listing_thin");
  }
  if (runtimeArm.entry === LISTING_THIN_PATH || String(runtimeArm.entry || "").includes("lib/listing/thin/")) {
    throw new Error("dual_consumer_runtime_arm_is_listing_thin");
  }
  if (runtimeArm.invocation !== "independent_process") {
    throw new Error("dual_consumer_runtime_arm_not_independent_process");
  }
  const listingSha = listingArm.fetched_origin_main_sha || listingArm.checkout_head_sha;
  const runtimeSha = runtimeArm.fetched_origin_main_sha || runtimeArm.checkout_head_sha;
  if (!listingSha || !runtimeSha) {
    throw new Error("dual_consumer_missing_sha");
  }
  if (listingSha === runtimeSha) {
    throw new Error("dual_consumer_same_sha");
  }
  return true;
}

export function assertGoldensRemainSealed({
  argv = process.argv,
  payload = {},
  openedSealedLabels = false
} = {}) {
  for (const argument of argv) {
    if (["--labels", "--sealed-labels", "--scorer", "--score-contract", "--label-map", "--reference"].includes(argument)) {
      throw new Error(`dual_consumer_forbidden_execution_argument:${argument}`);
    }
  }
  if (openedSealedLabels) {
    throw new Error("dual_consumer_sealed_labels_opened_before_execution_complete");
  }
  const visit = (value, path) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (GOLDEN_SEAL_FORBIDDEN_KEYS.includes(String(key).toLowerCase())) {
        throw new Error(`dual_consumer_forbidden_execution_key:${path}.${key}`);
      }
      visit(nested, `${path}.${key}`);
    }
  };
  visit(payload, "comparison");
}

export function loadFrozenCohortMetadata(repoRoot = LISTING_COPILOT_REPO_ROOT) {
  const assetIds = JSON.parse(readFileSync(resolve(repoRoot, GAMMA_53_ASSET_IDS_PATH), "utf8"));
  const dataset = JSON.parse(readFileSync(resolve(repoRoot, GAMMA_53_DATASET_PATH), "utf8"));
  if (!Array.isArray(assetIds) || assetIds.length !== 53) {
    throw new Error(`dual_consumer_cohort_count:${Array.isArray(assetIds) ? assetIds.length : "missing"}`);
  }
  const items = Array.isArray(dataset.items) ? dataset.items : [];
  const imagesPresent = items.filter((item) => {
    const images = Array.isArray(item.images) ? item.images : [];
    return images.every((image) => image.local_path && existsSync(image.local_path));
  }).length;
  const sealedPath = resolve(repoRoot, GAMMA_53_SEALED_LABELS_PATH);
  return Object.freeze({
    cohort_id: dataset.cohort_id || "founder-gamma-training-2026-08-13",
    schema_version: dataset.schema_version || null,
    case_count: assetIds.length,
    asset_ids: Object.freeze([...assetIds]),
    images_present: imagesPresent,
    images_absent: assetIds.length - imagesPresent,
    sealed_labels_path: GAMMA_53_SEALED_LABELS_PATH,
    sealed_labels_exist: existsSync(sealedPath),
    sealed_labels_opened: false
  });
}

export function productionHandlersReachShadow(repoRoot = LISTING_COPILOT_REPO_ROOT) {
  const entries = [
    "api/csm-listing-title.js",
    "api/csm-listing-title-ingest.js",
    "app/listing-copilot.js"
  ];
  const hits = [];
  for (const entry of entries) {
    const graph = relativeImportGraph(entry, repoRoot);
    if (importGraphContains(graph, "lib/listing/evaluation/independent-runtime-shadow.mjs")
        || importGraphContains(graph, "lib/listing/evaluation/dual-consumer-comparison.mjs")) {
      hits.push(entry);
    }
  }
  return hits;
}

export function buildComparisonSkeleton({
  listingArm,
  runtimeArm,
  cohort,
  stopCondition,
  shadowDefaultOff,
  runtimeCheckoutPresent
}) {
  assertDistinctImplementations(listingArm, runtimeArm);
  assertGoldensRemainSealed({ payload: { stop_condition: stopCondition } });
  return Object.freeze({
    schema_version: DUAL_CONSUMER_COMPARISON_SCHEMA,
    authority: "evaluation_only",
    production_authorized: false,
    surviving_listing_application: null,
    founder_decision: null,
    pai_recommendation_only: true,
    goldens_sealed: true,
    scores_invented: false,
    stop_condition: stopCondition,
    shadow_default_off: shadowDefaultOff,
    runtime_checkout_present: runtimeCheckoutPresent,
    rejected_false_runtime_arms: lunaParityFalseRuntimeArmEvidence(),
    arms: Object.freeze({
      listing_copilot_origin_main: listingArm,
      lynca_runtime_origin_main: runtimeArm
    }),
    cohort: Object.freeze({
      cohort_id: cohort.cohort_id,
      case_count: cohort.case_count,
      images_present: cohort.images_present,
      images_absent: cohort.images_absent,
      sealed_labels_opened: false
    }),
    scores: emptyEvaluationScores(),
    notes: Object.freeze([
      "gamma-53 scored/ numbers compare two Listing Copilot-internal arms and are not dual-consumer evidence.",
      "Do not copy experiments/luna-parity/shadow-53-gamma/scored/ into these slots.",
      "Live execution is blocked until independent Runtime checkout+SHA, approved front/back bytes, and an explicit non-CI provider allowance exist.",
      "This document does not authorize deletion, Production cutover, or schema migration."
    ])
  });
}

export function runDualConsumerDryRun({
  repoRoot = LISTING_COPILOT_REPO_ROOT,
  env = process.env
} = {}) {
  const listingArm = listingCopilotArmIdentity({ repoRoot });
  const runtimeArm = independentRuntimeArmIdentity({
    pinnedSha: LYNCA_RUNTIME_PINNED_SHA,
    checkoutPath: env.LYNCA_RUNTIME_CHECKOUT || null,
    checkoutSha: null
  });
  const cohort = loadFrozenCohortMetadata(repoRoot);
  const runtimeCheckoutPresent = Boolean(String(env.LYNCA_RUNTIME_CHECKOUT || "").trim());
  const stopCondition = cohort.images_present === 53 && runtimeCheckoutPresent
    ? "dry_run_no_provider"
    : "offline_dry_run_missing_runtime_checkout_or_images";
  const comparison = buildComparisonSkeleton({
    listingArm,
    runtimeArm,
    cohort,
    stopCondition,
    shadowDefaultOff: listingIndependentRuntimeShadowEnabled(env) === false,
    runtimeCheckoutPresent
  });
  if (productionHandlersReachShadow(repoRoot).length) {
    throw new Error("dual_consumer_shadow_imported_by_production_handler");
  }
  return comparison;
}
