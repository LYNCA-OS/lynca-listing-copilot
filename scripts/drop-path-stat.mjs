#!/usr/bin/env node
// How often does the budget drop path actually fire?
//
// A change to DROP_ORDER that leaves the headline metric flat is either
// harmless or inert, and those are different things. This says which: if no
// card reaches the drop branch, the table was never consulted and "no metric
// change" is not evidence about the table at all.
import { readFileSync } from "node:fs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
const rows = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean)
  .map((line) => JSON.parse(line)).filter((row) => row.arm === "thin_canonical");
let dropped = 0; const byGrammar = {}; const what = {};
for (const row of rows) {
  const { fields } = parseCanonicalFields(row.raw_title);
  const composed = composeFromCanonicalFields(fields);
  byGrammar[composed.grammar] = (byGrammar[composed.grammar] || 0) + 1;
  if (composed.dropped?.length) {
    dropped++;
    for (const name of composed.dropped) what[name] = (what[name] || 0) + 1;
  }
}
console.log(`走丢弃分支 ${dropped}/${rows.length}`, byGrammar, what);
