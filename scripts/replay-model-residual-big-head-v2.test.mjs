import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCapturedModelResidualV2 } from "../experiments/accuracy/model-residual-big-head-v2.mjs";
import { buildReport } from "./replay-model-residual-big-head-v2.mjs";

const base = { year: "2025", manufacturer: "Topps", product: "Topps Chrome", set: "",
  subjects: ["Test Player"], serial: "5/50", grammar: "standard" };
const printed = (text, role = "identity_phrase", region = "slab_label") => ({ text, role, region, basis: "printed_text" });

const sapphire = resolveCapturedModelResidualV2(base, [printed("2025 TOPPS SAPPHIRE VARIATION-GOLD"), printed("05/50", "exact_code", "card_front")]);
assert.equal(sapphire.fields.product, "Topps Chrome Sapphire");
assert.equal(sapphire.fields.serial, "05/50");

const conflict = resolveCapturedModelResidualV2({ ...base, serial: "6/50" }, [printed("05/50", "exact_code", "card_front")]);
assert.equal(conflict.fields.serial, "6/50");

const abbreviation = resolveCapturedModelResidualV2({ ...base, product: "Finest", surface_color: "Green", parallel_exact: "" },
  [printed("RKE FINEST AU-GREEN GEO", "finish_phrase")]);
assert.equal(abbreviation.fields.parallel_exact, "");

const source = readFileSync(new URL("../experiments/accuracy/model-residual-big-head-v2.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /\breference\b/i);
assert.doesNotMatch(source, /reviewed_blind_/i);

const rows = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").trim().split(/\n+/).map(JSON.parse);
const report = buildReport({
  canonicalRows: rows("artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl"),
  exhaustiveRows: rows("artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl"),
  captureRows: rows("artifacts/accuracy-field-observation-v2-105-2026-08-02/thin-path-gpt-5.6-luna.jsonl"),
  current150: JSON.parse(readFileSync(new URL("../docs/evaluation/post-luna-current-main-150-2026-08-08.json", import.meta.url)))
});
assert.equal(report.historical_150_utility_gate.wins, 11);
assert.equal(report.historical_150_utility_gate.losses, 0);
assert.ok(Math.abs(report.historical_150_utility_gate.delta_macro_f1 - 0.0060804744890394) < 1e-12);
assert.equal(report.current_candidate_lane_capture_gate.wins, 4);
assert.equal(report.current_candidate_lane_capture_gate.reference_loss_cards, 2);
assert.equal(report.current_candidate_lane_capture_gate.gate_passed, false);
assert.equal(report.decision, "STOP_CAPTURE_GATE");
console.log("model-residual-big-head-v2 tests passed");
