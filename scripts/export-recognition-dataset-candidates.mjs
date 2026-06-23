import { runRecognitionDatasetCli } from "./recognition-dataset-cli.mjs";

await runRecognitionDatasetCli(["export-candidates", ...process.argv.slice(2)]);
