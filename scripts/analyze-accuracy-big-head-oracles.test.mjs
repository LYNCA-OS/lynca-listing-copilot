#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const report = JSON.parse(execFileSync(process.execPath, [
  new URL("./analyze-accuracy-big-head-oracles.mjs", import.meta.url).pathname
], { encoding: "utf8" }));

assert.equal(report.provider_calls, 0);
assert.equal(report.production_promoted, false);
assert.equal(report.all_audited_missing_tokens.occurrences, 427);
assert.equal(report.all_audited_missing_tokens.affected_cards, 137);
assert.ok(Math.abs(report.all_audited_missing_tokens.baseline_f1 - 0.7850509044216141) < 1e-12);
assert.equal(report.by_stage.exhaustive_not_expressed.occurrences, 255);
assert.equal(report.by_stage.canonical_schema_compression.occurrences, 109);
assert.equal(report.by_stage.downstream_composition.occurrences, 63);
assert.ok(report.by_stage.exhaustive_not_expressed.oracle_delta
  > report.by_stage.canonical_schema_compression.oracle_delta
    + report.by_stage.downstream_composition.oracle_delta);
assert.ok(report.all_audited_missing_tokens.oracle_f1 > 0.90);
assert.ok(report.remove_all_incorrect_candidate_tokens.oracle_f1 < 0.90);
assert.ok(report.audited_recall_oracle_fraction_required_for_target > 0.80);
assert.equal(report.exact_slab_certificate_anchor_opportunity.exact_single_cert_cards, 37);
assert.equal(report.exact_slab_certificate_anchor_opportunity.conflicting_cert_cards, 0);
assert.equal(report.exact_slab_certificate_anchor_opportunity.audited_missing_occurrences, 71);
assert.ok(Math.abs(report.exact_slab_certificate_anchor_opportunity.current_cert_card_f1
  - 0.8651423337245442) < 1e-12);
assert.ok(Math.abs(report.exact_slab_certificate_anchor_opportunity.restore_all_cert_missing_tokens_delta
  - 0.01801185954614337) < 1e-12);
assert.ok(Math.abs(report.exact_slab_certificate_anchor_opportunity.perfect_cert_cards_delta
  - 0.033264891014612274) < 1e-12);
assert.equal(report.exact_slab_certificate_anchor_opportunity.live_registry_coverage_verified, false);

console.log("accuracy big-head oracle tests passed");
