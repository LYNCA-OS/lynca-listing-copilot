import { runRecognitionDatasetCli } from "./recognition-dataset-cli.mjs";

await runRecognitionDatasetCli(["leakage", ...process.argv.slice(2)]);
