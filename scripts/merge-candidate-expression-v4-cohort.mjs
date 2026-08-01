#!/usr/bin/env node

// Merge independently checkpointed candidate-expression-v4 rows into one
// unique cohort.  Repeated paid attempts for an asset are not averaged or
// silently treated as extra cards: the first input wins, and the receipt
// records how many later rows were discarded.

import { readFileSync, writeFileSync } from "node:fs";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const inputs = arg("--inputs").split(",").map((value) => value.trim()).filter(Boolean);
const out = arg("--out");
const limit = Number(arg("--limit", "150"));
if (!inputs.length || !out || !Number.isInteger(limit) || limit < 1) {
  throw new Error("usage: --inputs path[,path...] --out path --limit positive_integer");
}

const selected = new Map();
const duplicates = [];
for (const path of inputs) {
  const lines = readFileSync(path, "utf8").split(/\n+/).filter(Boolean);
  for (const line of lines) {
    const row = JSON.parse(line);
    if (!row.asset_id) throw new Error(`missing_asset_id:${path}`);
    if (selected.has(row.asset_id)) {
      duplicates.push({ asset_id: row.asset_id, ignored_source: path });
      continue;
    }
    selected.set(row.asset_id, row);
  }
}
if (selected.size !== limit) throw new Error(`merged_asset_count_mismatch:${selected.size}/${limit}`);
const rows = [...selected.values()];
writeFileSync(out, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
const receipt = {
  schema_version: "candidate-expression-v4-cohort-merge-v1",
  authority: "evaluation_only",
  inputs,
  output: out,
  requested_limit: limit,
  unique_rows: rows.length,
  duplicate_rows_ignored: duplicates.length,
  duplicate_assets: [...new Set(duplicates.map(({ asset_id }) => asset_id))],
  precedence: "first_input_wins"
};
writeFileSync(`${out}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
