import { runRecognitionDatasetCli } from "./recognition-dataset-cli.mjs";

await runRecognitionDatasetCli(["eval", ...process.argv.slice(2)]);
