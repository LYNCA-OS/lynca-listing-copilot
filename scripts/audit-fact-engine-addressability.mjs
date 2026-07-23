#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { buildFactEngineAddressabilityAudit } from "../lib/listing/evaluation/fact-engine-addressability.mjs";

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}
const required = ["dataset", "evidence", "retrieval", "smoke", "catalog", "output"];
for (const name of required) if (!value(`--${name}`)) throw new Error(`missing --${name}`);
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const report = buildFactEngineAddressabilityAudit({
  dataset: await read(value("--dataset")),
  evidenceTaxonomy: await read(value("--evidence")),
  retrievalDiagnostic: await read(value("--retrieval")),
  smoke: await read(value("--smoke")),
  catalog: await read(value("--catalog"))
});
await writeFile(value("--output"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ summary: report.summary, theoretical_ceiling: report.theoretical_ceiling }, null, 2));
