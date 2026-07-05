import { fileURLToPath } from "node:url";
import {
  argValue,
  blindEvalRunPaths,
  defaultBlindEvalDir,
  envValue,
  hasFlag,
  integerArg,
  normalizeBaseUrl,
  runBlindRecognition
} from "../lib/listing/evaluation/blind-eval.mjs";

export async function main(argv = process.argv, env = process.env) {
  const baseUrl = normalizeBaseUrl(argValue(argv, "--base-url", env.API_BASE_URL || ""));
  const username = argValue(argv, "--username", envValue(env, "API_USERNAME", "METAVERSE_USERNAME"));
  const password = argValue(argv, "--password", envValue(env, "API_PASSWORD", "METAVERSE_PASSWORD"));
  const outDir = argValue(argv, "--out-dir", env.BLIND_EVAL_DIR || defaultBlindEvalDir);
  const runId = argValue(argv, "--run-id", env.BLIND_EVAL_RUN_ID || "");
  const paths = blindEvalRunPaths({ outDir, runId });
  const inputPath = argValue(argv, "--input", paths.inference_bundle_dir);
  const outputPath = argValue(argv, "--output", paths.predictions_path);
  const provider = argValue(argv, "--provider", env.BLIND_EVAL_PROVIDER || "openai_legacy");
  const providerMode = argValue(argv, "--provider-mode", argValue(argv, "--mode", env.BLIND_EVAL_PROVIDER_MODE || "openai_vector"));
  const limit = integerArg(argv, "--limit", Number(env.BLIND_EVAL_LIMIT || 0));
  const concurrency = integerArg(argv, "--concurrency", Number(env.BLIND_EVAL_CONCURRENCY || 1));
  const resume = !hasFlag(argv, "--fresh");
  const summary = await runBlindRecognition({
    inputPath,
    outputPath,
    predictionsSha256Path: paths.predictions_sha256_path,
    baseUrl,
    username,
    password,
    provider,
    providerMode,
    env,
    limit,
    concurrency,
    resume,
    onProgress: (event) => {
      const state = event.skipped ? "skipped" : "completed";
      const details = event.skipped
        ? ""
        : ` attempts=${event.attempts || 1} status=${event.recognition_status || "n/a"} error=${event.error_type || "none"}`;
      console.log(`blind recognition ${state} ${event.index}/${event.total} case_id=${event.case_id}${details}`);
    }
  });
  console.log("blind recognition completed");
  console.log(`prediction_count=${summary.prediction_count}`);
  console.log(`configured_limit=${summary.configured_limit ?? "all"}`);
  console.log(`configured_concurrency=${summary.configured_concurrency}`);
  console.log(`provider=${provider}`);
  console.log(`provider_mode=${providerMode}`);
  console.log(`blind_inputs=${summary.blind_inputs_path}`);
  console.log(`predictions=${summary.predictions_path}`);
  console.log(`predictions_sha256=${summary.predictions_sha256}`);
  console.log(`predictions_sha256_path=${summary.predictions_sha256_path}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`blind recognition failed: ${error.message}`);
    process.exitCode = 1;
  });
}
