import { fileURLToPath } from "node:url";
import {
  argValue,
  blindEvalRunPaths,
  defaultBlindEvalDir,
  scoreBlindEval
} from "../lib/listing/evaluation/blind-eval.mjs";

export async function main(argv = process.argv, env = process.env) {
  const outDir = argValue(argv, "--out-dir", env.BLIND_EVAL_DIR || defaultBlindEvalDir);
  const runId = argValue(argv, "--run-id", env.BLIND_EVAL_RUN_ID || "");
  const paths = blindEvalRunPaths({ outDir, runId });
  const predictionsPath = argValue(argv, "--predictions", paths.predictions_path);
  const answerKeyPath = argValue(argv, "--answer-key", paths.answer_key_path);
  const outputPath = argValue(argv, "--output", paths.scored_results_path);
  const summaryPath = argValue(argv, "--summary", paths.summary_path);
  const summary = await scoreBlindEval({
    predictionsPath,
    answerKeyPath,
    outputPath,
    summaryPath,
    predictionsSha256Path: paths.predictions_sha256_path
  });
  console.log("blind eval scored against sealed seller titles");
  console.log(`total=${summary.total}`);
  console.log(`overall_counts=${JSON.stringify(summary.overall_counts)}`);
  console.log(`scored_results=${summary.scored_results_path}`);
  console.log(`summary=${summary.summary_path}`);
  console.log(`predictions_sha256=${summary.predictions_sha256}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`score blind eval failed: ${error.message}`);
    process.exitCode = 1;
  });
}
