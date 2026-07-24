import fs from "node:fs/promises";
import { buildEvidenceFailureTaxonomy } from "../lib/listing/evaluation/evidence-failure-taxonomy.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function argumentsFor(name) {
  return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []);
}

const paths = Object.fromEntries(["dataset", "audit", "trace", "output"].map((name) => [name, argument(`--${name}`)]));
paths.smoke = argumentsFor("--smoke");
for (const name of ["dataset", "audit", "trace", "output"]) {
  if (!paths[name]) throw new Error(`missing --${name}`);
}
if (!paths.smoke.length) throw new Error("at least one --smoke is required");

const read = async (path) => JSON.parse(await fs.readFile(path, "utf8"));
const report = buildEvidenceFailureTaxonomy({
  dataset: await read(paths.dataset),
  audit: await read(paths.audit),
  trace: await read(paths.trace),
  smoke: { results: (await Promise.all(paths.smoke.map(read))).flatMap((report) => report.results || []) }
});
await fs.writeFile(paths.output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary, null, 2));
