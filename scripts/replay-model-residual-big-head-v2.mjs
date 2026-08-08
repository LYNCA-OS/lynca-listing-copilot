#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { resolveCapturedModelResidualV2 } from "../experiments/accuracy/model-residual-big-head-v2.mjs";
import { titleTokens } from "../experiments/accuracy/composer-downstream-recovery-v1.mjs";
import { ACCURACY_MECHANISM_NAMES_V3, applyAccuracyMechanismBundleV3 } from "../lib/listing/thin/accuracy-mechanism-bundle-v3.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const FROZEN_COMPOSER_FEATURES = Object.freeze({ exact_parallel_color_compaction: false });
const composeFrozen = (fields) => composeFromCanonicalFields(fields,
  { features: FROZEN_COMPOSER_FEATURES });

const CANONICAL = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const EXHAUSTIVE = "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl";
const CAPTURE = "artifacts/accuracy-field-observation-v2-105-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const CURRENT_150 = "docs/evaluation/post-luna-current-main-150-2026-08-08.json";
const OUT_JSON = "docs/evaluation/model-residual-big-head-v2-replay-2026-08-08.json";
const OUT_MD = "docs/evaluation/model-residual-big-head-v2-replay-2026-08-08.md";
const EXPECTED = Object.freeze({
  canonical: "2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5",
  exhaustive: "96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9",
  capture: "b844dc7edcdbefdee41ca84dc2786772dd3b487b00fbe88444b905b58029b560",
  current_150: "ab1413e3e8ec11e511201c71ab86a941f5dd3419d9d2abf0b57fc65dcdc6aedb"
});
const EVIDENCE_FIELDS = Object.freeze(["year", "manufacturer", "product", "language", "set", "card_name",
  "release_variant", "surface_color", "parallel_family", "parallel_exact", "descriptive_rarity", "subjects",
  "team", "card_number", "serial", "attributes", "grade", "lot_count"]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const tokens = (value) => new Set(clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

function score(reference, title) {
  const wanted = titleTokens(reference); const got = titleTokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function numbers(value) {
  return new Set((clean(value).match(/\d+(?:[./-]\d+)*/g) || []).map((part) => part.replace(/^0+(?=\d)/, "")));
}

function scalarText(value) {
  if (Array.isArray(value)) return value.flatMap(scalarText);
  if (value && typeof value === "object") return Object.values(value).flatMap(scalarText);
  return [clean(value)];
}

function sourceText(fields, candidates) {
  return [...EVIDENCE_FIELDS.flatMap((field) => scalarText(fields?.[field])),
    ...(candidates || []).map((candidate) => clean(candidate?.evidence ?? candidate?.text))].join(" ");
}

function summarize(cards) {
  return {
    cards: cards.length,
    baseline_macro_f1: mean(cards.map((card) => card.before_f1)),
    candidate_macro_f1: mean(cards.map((card) => card.after_f1)),
    delta_macro_f1: mean(cards.map((card) => card.delta_f1)),
    wins: cards.filter((card) => card.outcome === "WIN").length,
    losses: cards.filter((card) => card.outcome === "LOSS").length,
    ties: cards.filter((card) => card.outcome === "TIE").length,
    changed_cards: cards.filter((card) => card.baseline_title !== card.candidate_title).length,
    baseline_token_loss_cards: cards.filter((card) => card.lost_baseline_tokens.length).length,
    reference_loss_cards: cards.filter((card) => card.lost_reference_tokens.length).length,
    unbacked_new_token_cards: cards.filter((card) => card.unbacked_new_tokens.length).length,
    unsupported_numeric_change_cards: cards.filter((card) => card.unsupported_numeric_changes.length).length,
    over_80_cards: cards.filter((card) => card.over_80).length
  };
}

function cardMetrics(row, baseline, replayTitle, evidence) {
  const before = score(row.reference, baseline).f1; const after = score(row.reference, replayTitle).f1;
  const baseTokens = titleTokens(baseline); const nextTokens = titleTokens(replayTitle);
  const wanted = titleTokens(row.reference); const sourceTokens = titleTokens(evidence);
  const lost = difference(baseTokens, nextTokens); const added = difference(nextTokens, baseTokens);
  const sourceNumbers = numbers(evidence); const addedNumbers = difference(numbers(replayTitle), numbers(baseline));
  return { asset_id: row.asset_id, baseline_title: baseline, candidate_title: replayTitle,
    before_f1: before, after_f1: after, delta_f1: after - before,
    outcome: after > before + 1e-12 ? "WIN" : after < before - 1e-12 ? "LOSS" : "TIE",
    lost_baseline_tokens: lost, lost_reference_tokens: lost.filter((token) => wanted.has(token)),
    added_tokens: added, unbacked_new_tokens: added.filter((token) => !sourceTokens.has(token)),
    unsupported_numeric_changes: addedNumbers.filter((value) => !sourceNumbers.has(value)),
    over_80: replayTitle.length > 80 };
}

export function buildReport({ canonicalRows, exhaustiveRows, captureRows, current150 }) {
  const canonical = canonicalRows.filter((row) => row.arm === "thin_canonical_high");
  const free = new Map(canonicalRows.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
  const exhaustive = new Map(exhaustiveRows.filter((row) => row.arm === "exhaustive_observation_high")
    .map((row) => [row.asset_id, row]));
  if (canonical.length !== 150 || exhaustive.size !== 150) throw new Error("model_residual_150_pair_count_mismatch");
  const utilityCards = canonical.map((row) => {
    const paired = exhaustive.get(row.asset_id);
    const expression = free.get(row.asset_id);
    if (!paired || !expression || paired.reference !== row.reference || paired.image_set_sha256 !== row.image_set_sha256) {
      throw new Error(`model_residual_150_pair_mismatch:${row.asset_id}`);
    }
    const freeFields = projectFreeTitleThroughCsm(expression.title).fields;
    const resolved = applyAccuracyMechanismBundleV3(row.fields, { freeFields,
      freeTitle: expression.title, observations: paired.observations });
    return cardMetrics(row, composeFrozen(row.fields).title,
      composeFrozen(resolved.fields).title,
      `${sourceText(row.fields, paired.observations)} ${sourceText(freeFields, [])} ${expression.title}`);
  });
  const utility = summarize(utilityCards);
  const treatment = captureRows.filter((row) => row.arm === "thin_canonical_field_observation_v2_high");
  const cards = treatment.map((row) => {
    const baseline = composeFrozen(row.fields).title;
    const replay = resolveCapturedModelResidualV2(row.fields, row.observations || [],
      { composerFeatures: FROZEN_COMPOSER_FEATURES });
    return { ...cardMetrics(row, baseline, replay.title, sourceText(row.fields, row.observations)),
      admitted: replay.decisions.filter((item) => item.disposition === "admitted"),
      downstream: replay.downstream.applied
    };
  });
  const capture = { ...summarize(cards),
    candidate_rows: treatment.reduce((sum, row) => sum + (row.observations?.length || 0), 0),
  };
  const gate = (row) => row.delta_macro_f1 >= 0.003 && row.wins >= 8 && row.losses === 0
    && row.reference_loss_cards === 0 && row.unbacked_new_token_cards === 0
    && row.unsupported_numeric_change_cards === 0 && row.over_80_cards === 0;
  return {
    schema_version: "model-residual-big-head-v2-replay",
    authority: "evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    decision: gate(capture) ? "KEEP_CANDIDATE" : "STOP_CAPTURE_GATE",
    gate_definition: ">=+0.003, >=8 wins, 0 losses, 0 critical/unbacked/>80",
    current_150_context: { baseline_macro_f1: current150.current_vs_historical.current_macro_f1,
      boundaries: { pre_schema: 254, schema: 109, downstream: 63 },
      generalizable_downstream_delta: current150.composer_recovery.generalizable.delta_macro_f1 },
    historical_150_utility_gate: { ...utility, gate_passed: gate(utility), mechanisms: ACCURACY_MECHANISM_NAMES_V3,
      interpretation: "label-blind safe-bundle utility; not candidate-lane capture proof" },
    current_candidate_lane_capture_gate: { ...capture, gate_passed: gate(capture) },
    changed_cards: cards.filter((card) => card.baseline_title !== card.candidate_title)
  };
}

function markdown(report) {
  const u = report.historical_150_utility_gate; const c = report.current_candidate_lane_capture_gate;
  return `# Model residual big-head v2 — zero-call replay (2026-08-08)\n\n## Decision\n\nThe opposing result comes first: **do not promote the residual candidate lane**. The existing label-blind safe bundle clears utility Gate 0, but the current typed candidate lane does not capture enough safely resolvable evidence. Rewriting the old resolver would add duplication, not recall.\n\nProvider calls: **0**. Runtime changes: **none**. Decision: **${report.decision}**.\n\n## Separate utility from capture\n\n| Gate | Cards | Delta | W/L/T | Ref-loss | Unbacked | >80 | Result |\n|---|---:|---:|---:|---:|---:|---:|---|\n| Source-only safe-bundle utility | 150 | ${u.delta_macro_f1.toFixed(10)} | ${u.wins}/${u.losses}/${u.ties} | ${u.reference_loss_cards} | ${u.unbacked_new_token_cards} | ${u.over_80_cards} | ${u.gate_passed ? "PASS" : "FAIL"} |\n| Current candidate capture + resolver | ${c.cards} | ${c.delta_macro_f1.toFixed(10)} | ${c.wins}/${c.losses}/${c.ties} | ${c.reference_loss_cards} | ${c.unbacked_new_token_cards} | ${c.over_80_cards} | **${c.gate_passed ? "PASS" : "FAIL"}** |\n\nCurrent post-Luna context is baseline ${report.current_150_context.baseline_macro_f1.toFixed(10)} with 254/109/63 pre-schema/schema/downstream occurrences. The existing generalizable Composer lane is ${report.current_150_context.generalizable_downstream_delta.toFixed(10)}; these quantities are not additive.\n\nThe 150 utility row directly replays the existing v3 safe bundle from canonical, free-expression, and exhaustive source outputs. Scoring labels are read only after resolution. This proves utility, not that the Production-low residual schema captures its required inputs.\n\nThe 105 candidate lane emitted ${c.candidate_rows} rows. Its fixed phrase-aware Product routing, same-value serial formatting, and typed Composer recovery yield only ${c.wins} wins and displace reviewed-title tokens on ${c.reference_loss_cards} cards. The remaining rows are checklist codes, compressed slab shorthand, boilerplate, or facts already represented in canonical fields. Getting to 8 wins would require new candidate capture or unsafe abbreviation/role inference; the present 25 rows cannot support it under the source-only rules. No 35x3 paid preregistration and no runtime admission are justified.\n\n## Boundary\n\nThe v2 resolver consumes canonical fields plus candidate text/role/region/basis only. It has no scoring-label parameter, asset-id rule, provider call, persistence path, or Production import. Metadata is excluded from source backing. Abbreviations such as GEO/REF are not expanded into facts.\n\n## Reproduce\n\n\`\`\`bash\nnode scripts/replay-model-residual-big-head-v2.mjs\nnode scripts/replay-model-residual-big-head-v2.test.mjs\n\`\`\`\n`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const canonicalBody = readFileSync(CANONICAL);
  const exhaustiveBody = readFileSync(EXHAUSTIVE);
  const captureBody = readFileSync(CAPTURE);
  const currentBody = readFileSync(CURRENT_150);
  if (sha256(canonicalBody) !== EXPECTED.canonical || sha256(exhaustiveBody) !== EXPECTED.exhaustive
    || sha256(captureBody) !== EXPECTED.capture || sha256(currentBody) !== EXPECTED.current_150) {
    throw new Error("model_residual_big_head_v2_input_hash_mismatch");
  }
  const rows = (body) => body.toString("utf8").trim().split(/\n+/).map(JSON.parse);
  const report = buildReport({ canonicalRows: rows(canonicalBody), exhaustiveRows: rows(exhaustiveBody),
    captureRows: rows(captureBody), current150: JSON.parse(currentBody) });
  report.sources = { canonical: { path: CANONICAL, sha256: EXPECTED.canonical },
    exhaustive: { path: EXHAUSTIVE, sha256: EXPECTED.exhaustive },
    capture: { path: CAPTURE, sha256: EXPECTED.capture },
    current_150: { path: CURRENT_150, sha256: EXPECTED.current_150 } };
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, markdown(report));
  process.stdout.write(`${JSON.stringify({ decision: report.decision,
    utility: report.historical_150_utility_gate, capture: report.current_candidate_lane_capture_gate }, null, 2)}\n`);
}
