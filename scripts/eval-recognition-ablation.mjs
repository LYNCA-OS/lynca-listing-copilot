import { runRecognitionDatasetCli } from "./recognition-dataset-cli.mjs";

await runRecognitionDatasetCli(["ablation", ...process.argv.slice(2)]);
