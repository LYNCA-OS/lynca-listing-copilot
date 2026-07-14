import { fileURLToPath } from "node:url";
import {
  argValue,
  blindEvalRunPaths,
  defaultBlindEvalDir,
  envValue,
  hasFlag,
  integerArg,
  normalizeBaseUrl,
  prepareBlindDataset
} from "../lib/listing/evaluation/blind-eval.mjs";

function listArg(value = "") {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const defaultSportsQueries = [
  "card",
  "basketball card",
  "baseball card",
  "football card",
  "soccer card",
  "hockey card",
  "Panini rookie",
  "Topps rookie",
  "PSA card",
  "autograph card",
  "refractor card",
  "Prizm card"
].join("|");

export async function main(argv = process.argv, env = process.env) {
  const baseUrl = normalizeBaseUrl(argValue(argv, "--base-url", env.API_BASE_URL || ""));
  const username = argValue(argv, "--username", envValue(env, "API_USERNAME", "METAVERSE_USERNAME"));
  const password = argValue(argv, "--password", envValue(env, "API_PASSWORD", "METAVERSE_PASSWORD"));
  const outDir = argValue(argv, "--out-dir", env.BLIND_EVAL_DIR || defaultBlindEvalDir);
  const runId = argValue(argv, "--run-id", env.BLIND_EVAL_RUN_ID || "");
  const expectedSeller = hasFlag(argv, "--all-sellers")
    ? ""
    : argValue(argv, "--seller", env.BLIND_EVAL_EBAY_SELLER || env.EBAY_SELLER_USERNAME || "dcsports87");
  const limit = integerArg(argv, "--limit", Number(env.BLIND_EVAL_LIMIT || 2));
  const imageLimit = integerArg(argv, "--image-limit", Number(env.BLIND_EVAL_IMAGE_LIMIT || 2));
  const excludeAnswerKeyPaths = listArg(argValue(argv, "--exclude-answer-keys", env.BLIND_EVAL_EXCLUDE_ANSWER_KEYS || ""));
  const sportsOnly = hasFlag(argv, "--sports-only")
    ? true
    : hasFlag(argv, "--include-non-sports")
      ? false
      : !/^(?:0|false|no)$/i.test(String(env.BLIND_EVAL_SPORTS_ONLY || "true"));
  const query = argValue(argv, "--query", env.BLIND_EVAL_EBAY_QUERY || (sportsOnly ? defaultSportsQueries : "card"));
  const categoryIds = argValue(argv, "--category-ids", env.BLIND_EVAL_EBAY_CATEGORY_IDS || env.EBAY_BROWSE_CATEGORY_IDS || "");
  const allowPartial = hasFlag(argv, "--allow-partial");
  const excludeSealedProducts = hasFlag(argv, "--exclude-sealed-products");
  const evaluationSampleMode = argValue(argv, "--sample-mode", env.EVALUATION_SAMPLE_MODE || "UNSPECIFIED");
  const sampleSeed = argValue(argv, "--sample-seed", env.EVALUATION_SAMPLE_SEED || runId);
  const summary = await prepareBlindDataset({
    baseUrl,
    username,
    password,
    outDir,
    runId,
    expectedSeller,
    limit,
    imageLimit,
    excludeAnswerKeyPaths,
    query,
    sportsOnly,
    excludeSealedProducts,
    allowPartial,
    categoryIds,
    evaluationSampleMode,
    sampleSeed,
    env
  });
  const paths = blindEvalRunPaths({ outDir, runId });
  console.log("eBay seller blind dataset prepared");
  console.log(`run_id=${summary.run_id}`);
  console.log(`seller=${summary.seller || "ANY_VERIFIED_SELLER"}`);
  console.log(`listings_endpoint=${summary.listings_endpoint}`);
  console.log(`listing_count=${summary.listing_count}`);
  console.log(`requested_listing_count=${summary.requested_listing_count}`);
  console.log(`partial_dataset=${summary.partial_dataset}`);
  console.log(`excluded_item_count=${summary.excluded_item_count}`);
  console.log(`evaluation_sample_mode=${summary.evaluation_sample_policy?.mode || "UNSPECIFIED"}`);
  console.log(`sample_randomized=${summary.sample_selection?.randomized === true}`);
  console.log(`sample_candidate_pool=${summary.sample_selection?.eligible_candidate_count || 0}`);
  console.log(`sample_seed=${summary.sample_selection?.seed || "n/a"}`);
  console.log(`novelty_verified=${summary.evaluation_sample_policy?.novelty_verified === true}`);
  console.log(`sports_only=${summary.sports_only}`);
  console.log(`sports_filtered_count=${summary.sports_filtered_count}`);
  console.log(`sealed_product_discarded_count=${summary.sealed_product_discarded_count || 0}`);
  console.log(`specific_card_listing_required=${summary.specific_card_listing_required === true}`);
  console.log(`unsuitable_listing_discarded_count=${summary.unsuitable_listing_discarded_count || 0}`);
  console.log(`unsuitable_listing_discard_reasons=${JSON.stringify(summary.unsuitable_listing_discard_reasons || {})}`);
  console.log(`ebay_query=${summary.ebay_query}`);
  console.log(`ebay_queries=${(summary.ebay_queries || []).join("|")}`);
  console.log(`ebay_category_ids=${summary.ebay_category_ids}`);
  console.log(`listing_page_count=${summary.listing_page_count}`);
  console.log(`listing_fetch_offsets=${(summary.listing_fetch_offsets || []).join(",")}`);
  console.log(`image_download_skipped_count=${summary.image_download_skipped_count || 0}`);
  console.log(`downloaded_image_quality=${JSON.stringify(summary.downloaded_image_quality_summary || {})}`);
  console.log(`inference_bundle=${summary.inference_bundle_dir || paths.inference_bundle_dir}`);
  console.log(`blind_inputs=${summary.blind_inputs_path}`);
  console.log(`answer_key=${summary.answer_key_path}`);
  console.log("recognition_input_keys=case_id,image_paths");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`prepare eBay seller blind eval failed: ${error.message}`);
    process.exitCode = 1;
  });
}
