import fs from "node:fs/promises";
import { buildRetrievalSelectionDiagnostic } from "../lib/listing/evaluation/retrieval-selection-diagnostic.mjs";

function one(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function many(name) {
  return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []);
}
const paths = { dataset: one("--dataset"), audit: one("--audit"), trace: one("--trace"), output: one("--output"), smoke: many("--smoke") };
for (const key of ["dataset", "audit", "trace", "output"]) if (!paths[key]) throw new Error(`missing --${key}`);
if (!paths.smoke.length) throw new Error("at least one --smoke is required");
const read = async (path) => JSON.parse(await fs.readFile(path, "utf8"));
const report = buildRetrievalSelectionDiagnostic({
  dataset: await read(paths.dataset),
  audit: await read(paths.audit),
  trace: await read(paths.trace),
  smoke: { results: (await Promise.all(paths.smoke.map(read))).flatMap((report) => report.results || []) }
});
await fs.writeFile(paths.output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ retrieval: report.retrieval, cohorts: report.cohorts, selection: { numerator: report.selection.numerator, denominator: report.selection.denominator, rate: report.selection.rate, failure_counts: report.selection.failure_counts }, safe_application: { numerator: report.safe_application.numerator, denominator: report.safe_application.denominator, rate: report.safe_application.rate, reason_counts: report.safe_application.reason_counts } }, null, 2));
