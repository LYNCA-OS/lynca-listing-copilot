import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { analyzeCanonicalComposerRecovery } from "./analyze-canonical-composer-recovery.mjs";

const rows = readFileSync(
  "artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl",
  "utf8"
).split("\n").filter(Boolean).map(JSON.parse);
const diagnosis = JSON.parse(readFileSync(
  "artifacts/extreme-observation-2026-08-01/diagnosis-high-100.json",
  "utf8"
));

const result = analyzeCanonicalComposerRecovery(rows, diagnosis);

assert.equal(result.population, 100);
assert.ok(Math.abs(result.baseline.macro_f1 - 0.7698022907754876) < 1e-12,
  "the stored control must reproduce before candidate scoring is trusted");
assert.ok(Math.abs(result.paired.delta_macro_f1 - 0.006060524338785123) < 1e-12);
assert.deepEqual(
  [result.paired.wins, result.paired.losses, result.paired.ties],
  [10, 0, 90]
);
assert.equal(result.paired.p_two_sided, 0.001953125);
assert.deepEqual(result.downstream_53, {
  recovered_occurrences: 12,
  total_occurrences: 53,
  recovered_share: 12 / 53,
  recovered_cards: 10
});
assert.deepEqual(result.safety, {
  over_80_characters: 0,
  cards_with_lost_reference_tokens: 0,
  cards_with_unbacked_new_tokens: 0,
  critical_wrong_proxy: 0
});
assert.equal(result.promotion_gate.default_eligible, true);

const baselineCommit = "d8bc6590bc542ab7be0a0395e41d9a1bac344240";
const replay = (path) => JSON.parse(execFileSync(process.execPath, [
  "scripts/analyze-canonical-composer-recovery.mjs",
  "--rows", path,
  "--diagnosis", "none",
  "--arm", "thin_canonical",
  "--baseline-commit", baselineCommit
], { encoding: "utf8" }));

// These are not independent holdouts (the card identities overlap), but they
// make schema/version regressions visible instead of treating the diagnostic
// 100 as the only surface on which the rule must work.
const currentSchema = replay("artifacts/canonical-v4/thin-path-gpt-5.6-luna.jsonl");
assert.equal(currentSchema.population, 148);
assert.ok(Math.abs(currentSchema.paired.delta_macro_f1 - 0.0026979749805836617) < 1e-12);
assert.deepEqual(
  [currentSchema.paired.wins, currentSchema.paired.losses, currentSchema.paired.ties],
  [6, 0, 142]
);
assert.equal(currentSchema.safety.critical_wrong_proxy, 0);

const priorSchema = replay("artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl");
assert.equal(priorSchema.population, 150);
assert.ok(Math.abs(priorSchema.paired.delta_macro_f1 - 0.0027281267592480507) < 1e-12);
assert.deepEqual(
  [priorSchema.paired.wins, priorSchema.paired.losses, priorSchema.paired.ties],
  [6, 0, 144]
);
assert.equal(priorSchema.safety.critical_wrong_proxy, 0);

process.stdout.write("canonical composer recovery analysis: ok\n");
