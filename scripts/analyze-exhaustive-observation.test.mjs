import assert from "node:assert/strict";

import { analyzeExhaustiveRows } from "./analyze-exhaustive-observation.mjs";

const rows = [
  {
    asset_id: "a",
    arm: "thin_canonical_high",
    reference: "2024 Blue Refractor 027/150 Lakers",
    title: "2024 Lakers",
    fields: { year: "2024", team: "Lakers", print_finish: "Blue Refractor" }
  },
  {
    asset_id: "a",
    arm: "exhaustive_observation_high",
    observations: [
      { evidence: "Blue Refractor" },
      { evidence: "027/150" }
    ]
  }
];

const report = analyzeExhaustiveRows(rows);
assert.equal(report.paired_cards, 1);
assert.deepEqual(report.rows[0].causes.downstream_composition, ["blue", "refractor"]);
assert.deepEqual(report.rows[0].causes.canonical_schema_compression, ["027/150"]);
assert.deepEqual(report.rows[0].causes.exhaustive_not_expressed, []);

console.log("exhaustive observation analysis tests passed");
