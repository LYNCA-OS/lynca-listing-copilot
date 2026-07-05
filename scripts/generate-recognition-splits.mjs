import { runRecognitionDatasetCli } from "./recognition-dataset-cli.mjs";

await runRecognitionDatasetCli(["split", ...process.argv.slice(2)]);
