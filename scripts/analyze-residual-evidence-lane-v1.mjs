#!/usr/bin/env node

// Evaluation-only design analysis for a same-call canonical + residual lane.
// It consumes stored paid artifacts and the read-only production schema. It
// never calls a provider, composes a production title, or mutates CSM fields.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS = Object.freeze({
  ledger: "docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.json",
  canonical: "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl",
  candidates: "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl",
  exhaustive: "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl",
  fixture: "scripts/fixtures/residual-evidence-lane-v1-design.json",
  // The baseline schema and prompt this study measures against.
  //
  // It used to be an absolute path into a SIBLING clone. That made the study
  // unreproducible by construction: the file is imported for its
  // CANONICAL_FIELDS_SCHEMA and CANONICAL_FIELDS_PROMPT, so its content decides
  // the baseline, and anyone could move that checkout. It moved. The pinned
  // input hash then failed, and the content it named exists in no commit of
  // either repository -- it was an uncommitted working tree.
  //
  // Production and this repository's main are the same commit, so the
  // in-repo file IS the production baseline, and it moves only through review.
  productionCanonical: "lib/listing/thin/canonical-fields.mjs"
});

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const absolute = (path) => path.startsWith("/") ? path : resolve(ROOT, path);
const readJson = (path) => JSON.parse(readFileSync(absolute(path), "utf8"));
const readJsonl = (path) => readFileSync(absolute(path), "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const sha256 = (path) => createHash("sha256").update(readFileSync(absolute(path))).digest("hex");
const bytes = (value) => Buffer.byteLength(String(value));

const clean = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[\u2018\u2019\u02bc]/g, "'").toLowerCase();
const tokenList = (value) => clean(value).split(/[^a-z0-9/']+/).filter(Boolean);
const tokenSet = (value) => new Set(tokenList(value));
const officialTokenSet = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

function score(reference, title) {
  const wanted = officialTokenSet(reference);
  const got = officialTokenSet(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const quantile = (values, fraction) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : null;
};
const countBy = (values, selector) => Object.fromEntries([...values.reduce((map, value) => {
  const key = selector(value);
  map.set(key, (map.get(key) || 0) + 1);
  return map;
}, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));

export function routeStageOneItem(item) {
  if (item.shadow_downstream_class) return "already_canonical_downstream";
  if (["lot_notation", "token_boundary_or_spelling"].includes(item.structural_family)) {
    return "surface_form_or_grammar_review";
  }
  if (["product_set_or_ip", "subject_or_name", "attribute_or_component", "serial_or_numbered_print"]
    .includes(item.structural_family)) return "direct_text_symbol_or_stamp_attention";
  if (["parallel_or_finish", "color", "rarity_or_marker"].includes(item.structural_family)) {
    return "visual_or_catalog_semantics";
  }
  if (["other_identity_or_descriptor", "year_or_season", "team_or_league"]
    .includes(item.structural_family)) return "identity_or_world_resolution";
  if (item.structural_family === "bare_number_or_ordinal") return "ambiguous_numeric_context";
  throw new Error(`unrouted_structural_family:${item.structural_family}`);
}

const EXCLUDED_FROM_MINIMAL_LANE = new Set([
  "lot_notation", "token_boundary_or_spelling", "team_or_league"
]);

function fieldText(fields = {}) {
  return Object.entries(fields)
    .filter(([name]) => !["grammar", "unreadable", "low_confidence"].includes(name))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter(Boolean).join(" ");
}

function targetForFact(fact) {
  if (fact.kind === "number") return /^\d{1,4}\/\d{1,4}$/.test(String(fact.value).trim()) ? "serial" : "card_number";
  return {
    identity: "identity",
    subject: "subject",
    year: "year",
    finish: "finish",
    attribute: "marker",
    other: "card_name"
  }[fact.kind] || null;
}

function anchorForFact(fact) {
  if (fact.basis === "visual_interpretation") return "visual";
  if (fact.basis === "logo_or_symbol") return "front_symbol";
  if (fact.basis === "stamped_text" && fact.kind === "number") return "stamped_number";
  if (fact.region === "slab_label") return "slab_text";
  if (fact.region === "card_back") return "back_text";
  return "front_text";
}

function projectedRows(canonical, candidate) {
  const represented = tokenSet(fieldText(canonical.fields));
  const rows = [];
  for (const fact of candidate.candidate_facts || []) {
    const target = targetForFact(fact);
    if (!target) continue;
    const factTokens = tokenList(fact.value);
    if (factTokens.length && factTokens.every((token) => represented.has(token))) continue;
    rows.push({ text: fact.value, target, anchor: anchorForFact(fact), source: "visible_fact" });
  }
  for (const hypothesis of candidate.candidate_hypotheses || []) {
    const hypothesisTokens = tokenList(hypothesis.value);
    if (hypothesisTokens.length && hypothesisTokens.every((token) => represented.has(token))) continue;
    rows.push({
      text: hypothesis.value,
      target: "identity",
      anchor: hypothesis.basis === "model_knowledge" ? "model_knowledge" : "visible_combination",
      source: "identity_hypothesis"
    });
  }
  return rows;
}

function summarizeRoute(items, route) {
  const selected = items.filter((item) => routeStageOneItem(item) === route);
  return {
    occurrences: selected.length,
    affected_cards: new Set(selected.map((item) => item.asset_id)).size,
    structural_families: countBy(selected, (item) => item.structural_family)
  };
}

export async function analyzeResidualEvidenceLaneV1(options = {}) {
  const paths = { ...DEFAULTS, ...options };
  const ledger = readJson(paths.ledger);
  const fixture = readJson(paths.fixture);
  const stageOne = ledger.items.filter((item) => item.stage === "exhaustive_not_expressed");
  if (stageOne.length !== 255) throw new Error(`stage_one_count_mismatch:${stageOne.length}/255`);

  const canonicalRows = readJsonl(paths.canonical).filter((row) => row.arm === "thin_canonical_high");
  const candidateRows = readJsonl(paths.candidates);
  const exhaustiveRows = readJsonl(paths.exhaustive);
  if (canonicalRows.length !== 150 || candidateRows.length !== 150 || exhaustiveRows.length !== 150) {
    throw new Error(`cohort_count_mismatch:${canonicalRows.length}/${candidateRows.length}/${exhaustiveRows.length}`);
  }
  const candidatesByAsset = new Map(candidateRows.map((row) => [row.asset_id, row]));
  if (candidatesByAsset.size !== 150) throw new Error("candidate_asset_ids_not_unique");

  const productionPath = absolute(paths.productionCanonical);
  const production = await import(`${pathToFileURL(productionPath).href}?sha=${sha256(productionPath)}`);
  const baselineSchema = production.CANONICAL_FIELDS_SCHEMA;
  const baselinePrompt = production.CANONICAL_FIELDS_PROMPT;
  const treatmentSchema = {
    ...baselineSchema,
    required: [...baselineSchema.required, "residual_evidence"],
    properties: { ...baselineSchema.properties, residual_evidence: fixture.property }
  };
  const treatmentPrompt = `${baselinePrompt} ${fixture.prompt_suffix}`;

  const routeNames = [
    "already_canonical_downstream",
    "surface_form_or_grammar_review",
    "direct_text_symbol_or_stamp_attention",
    "visual_or_catalog_semantics",
    "identity_or_world_resolution",
    "ambiguous_numeric_context"
  ];
  const routes = Object.fromEntries(routeNames.map((route) => [route, summarizeRoute(stageOne, route)]));

  const laneEligible = stageOne.filter((item) => !item.shadow_downstream_class
    && !EXCLUDED_FROM_MINIMAL_LANE.has(item.structural_family));
  const perCard = new Map();
  for (const item of laneEligible) perCard.set(item.asset_id, (perCard.get(item.asset_id) || 0) + 1);
  const perCardCounts = [...perCard.values()];
  const capCoverage = Object.fromEntries([1, 2, 3, 4, 5].map((cap) => {
    const covered = perCardCounts.reduce((sum, count) => sum + Math.min(count, cap), 0);
    return [String(cap), {
      token_occurrences: covered,
      share: covered / laneEligible.length,
      uncovered: laneEligible.length - covered
    }];
  }));

  const alternativePromptMatches = [];
  for (const item of stageOne) {
    const candidate = candidatesByAsset.get(item.asset_id);
    const token = tokenList(item.token)[0] || "";
    const factMatches = (candidate?.candidate_facts || []).filter((fact) => tokenSet(fact.value).has(token));
    const hypothesisMatches = (candidate?.candidate_hypotheses || []).filter((hypothesis) => tokenSet(hypothesis.value).has(token));
    if (factMatches.length || hypothesisMatches.length) {
      alternativePromptMatches.push({
        item_id: item.id,
        asset_id: item.asset_id,
        token: item.token,
        route: routeStageOneItem(item),
        source: factMatches.length ? "visible_fact" : "identity_hypothesis"
      });
    }
  }

  const proxyCards = canonicalRows.map((canonical) => {
    const candidate = candidatesByAsset.get(canonical.asset_id);
    if (!candidate) throw new Error(`candidate_missing:${canonical.asset_id}`);
    const allRows = projectedRows(canonical, candidate);
    const rows = allRows.slice(0, fixture.max_items);
    const proxyTitle = [canonical.title, ...rows.map((row) => row.text)].join(" ");
    const before = score(canonical.reference, canonical.title);
    const after = score(canonical.reference, proxyTitle);
    const reference = officialTokenSet(canonical.reference);
    const baseline = officialTokenSet(canonical.title);
    const helpful = [];
    const unhelpful = [];
    for (const row of rows) {
      const additions = [...officialTokenSet(row.text)].filter((token) => !baseline.has(token));
      for (const token of additions) {
        (reference.has(token) ? helpful : unhelpful).push({ token, target: row.target });
      }
    }
    return {
      asset_id: canonical.asset_id,
      delta_f1: after.f1 - before.f1,
      before_f1: before.f1,
      after_f1: after.f1,
      row_count: rows.length,
      overflow_rows: Math.max(0, allRows.length - fixture.max_items),
      helpful,
      unhelpful,
      numeric_unhelpful: unhelpful.filter(({ token }) => /^\d+(?:\/\d+)?$/.test(token)),
      proxy_over_80: proxyTitle.length > 80
    };
  });
  const deltas = proxyCards.map((card) => card.delta_f1);
  const byTarget = (name) => countBy(proxyCards.flatMap((card) => card[name]), (item) => item.target);

  const baselineCanonical = canonicalRows.map((row) => ({
    output_tokens: row.output_tokens,
    input_tokens: row.input_tokens,
    latency_ms: row.latency_ms
  }));
  const maxPayload = JSON.stringify({ residual_evidence: Array.from({ length: fixture.max_items }, () => ({
    text: "x".repeat(fixture.max_text_length),
    target: "card_number",
    anchor: "visible_combination"
  })) });
  const emptyPayload = JSON.stringify({ residual_evidence: [] });

  return {
    schema_version: "residual-evidence-lane-v1-analysis",
    authority: "evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    inputs: Object.fromEntries(Object.entries({
      ledger: paths.ledger,
      canonical: paths.canonical,
      candidates: paths.candidates,
      exhaustive: paths.exhaustive,
      fixture: paths.fixture,
      production_canonical: paths.productionCanonical
    }).map(([name, path]) => [name, { path, sha256: sha256(path) }])),
    cohort: { cards: 150, stage_one_occurrences: stageOne.length },
    route_decomposition: routes,
    minimal_lane_coverage: {
      structurally_eligible_occurrences: laneEligible.length,
      affected_cards: perCard.size,
      excluded_occurrences: stageOne.length - laneEligible.length,
      per_card_max: Math.max(...perCardCounts),
      cap_coverage: capCoverage
    },
    alternative_prompt_capture_proxy: {
      matched_occurrences: alternativePromptMatches.length,
      affected_cards: new Set(alternativePromptMatches.map((match) => match.asset_id)).size,
      visible_fact_occurrences: alternativePromptMatches.filter((match) => match.source === "visible_fact").length,
      hypothesis_only_occurrences: alternativePromptMatches.filter((match) => match.source === "identity_hypothesis").length,
      already_canonical_shadow_occurrences: alternativePromptMatches.filter((match) => match.route === "already_canonical_downstream").length,
      true_absent_occurrences: alternativePromptMatches.filter((match) => match.route !== "already_canonical_downstream").length,
      by_route: countBy(alternativePromptMatches, (match) => match.route),
      warning: "This is cross-call prompt sensitivity, not same-call lane recall and not an admission replay."
    },
    unsafe_direct_concat_proxy: {
      warning: "Intentionally unsafe diagnostic: appending projected v4 rows directly to titles proves why candidate authority must stay zero.",
      baseline_macro_f1: mean(proxyCards.map((card) => card.before_f1)),
      candidate_macro_f1: mean(proxyCards.map((card) => card.after_f1)),
      delta_macro_f1: mean(deltas),
      wins: deltas.filter((delta) => delta > 1e-12).length,
      losses: deltas.filter((delta) => delta < -1e-12).length,
      ties: deltas.filter((delta) => Math.abs(delta) <= 1e-12).length,
      selected_rows: proxyCards.reduce((sum, card) => sum + card.row_count, 0),
      overflow_cards: proxyCards.filter((card) => card.overflow_rows > 0).length,
      helpful_new_tokens: proxyCards.reduce((sum, card) => sum + card.helpful.length, 0),
      unhelpful_new_tokens: proxyCards.reduce((sum, card) => sum + card.unhelpful.length, 0),
      numeric_unhelpful_tokens: proxyCards.reduce((sum, card) => sum + card.numeric_unhelpful.length, 0),
      helpful_by_target: byTarget("helpful"),
      unhelpful_by_target: byTarget("unhelpful"),
      proxy_over_80_cards: proxyCards.filter((card) => card.proxy_over_80).length,
      reference_loss_cards: 0
    },
    request_budget: {
      baseline_prompt_bytes: bytes(baselinePrompt),
      treatment_prompt_bytes: bytes(treatmentPrompt),
      prompt_delta_bytes: bytes(treatmentPrompt) - bytes(baselinePrompt),
      baseline_schema_bytes: bytes(JSON.stringify(baselineSchema)),
      treatment_schema_bytes: bytes(JSON.stringify(treatmentSchema)),
      schema_delta_bytes: bytes(JSON.stringify(treatmentSchema)) - bytes(JSON.stringify(baselineSchema)),
      prompt_plus_schema_delta_bytes: bytes(treatmentPrompt) + bytes(JSON.stringify(treatmentSchema))
        - bytes(baselinePrompt) - bytes(JSON.stringify(baselineSchema)),
      empty_lane_output_bytes: bytes(emptyPayload),
      four_max_rows_output_bytes: bytes(maxPayload),
      four_max_rows_rough_tokens_at_four_bytes_each: Math.ceil(bytes(maxPayload) / 4),
      max_output_tokens_unchanged: 4096
    },
    stored_runtime_context: {
      canonical_high: {
        output_tokens_p50: quantile(baselineCanonical.map((row) => row.output_tokens), 0.5),
        output_tokens_p95: quantile(baselineCanonical.map((row) => row.output_tokens), 0.95),
        input_tokens_p50: quantile(baselineCanonical.map((row) => row.input_tokens), 0.5),
        latency_ms_p50: quantile(baselineCanonical.map((row) => row.latency_ms), 0.5),
        latency_ms_p95: quantile(baselineCanonical.map((row) => row.latency_ms), 0.95)
      },
      candidate_v4: {
        output_tokens_p50: quantile(candidateRows.map((row) => row.output_tokens), 0.5),
        output_tokens_p95: quantile(candidateRows.map((row) => row.output_tokens), 0.95),
        latency_ms_p50: quantile(candidateRows.map((row) => row.latency_ms), 0.5),
        latency_ms_p95: quantile(candidateRows.map((row) => row.latency_ms), 0.95),
        latency_warning: "Merged v4 rows include interrupted/concurrency-contaminated wall time; use only as a negative envelope, not a latency forecast."
      },
      exhaustive_high: {
        output_tokens_p50: quantile(exhaustiveRows.map((row) => row.output_tokens), 0.5),
        output_tokens_p95: quantile(exhaustiveRows.map((row) => row.output_tokens), 0.95),
        latency_ms_p50: quantile(exhaustiveRows.map((row) => row.latency_ms), 0.5),
        latency_ms_p95: quantile(exhaustiveRows.map((row) => row.latency_ms), 0.95)
      }
    },
    tail_probability_math: {
      zero_events_in_150_one_sided_95_upper_probability: 1 - Math.pow(0.05, 1 / 150),
      zero_events_required_for_0_1_percent_at_95_confidence: Math.ceil(Math.log(0.05) / Math.log(0.999)),
      zero_events_required_for_0_1_percent_at_99_confidence: Math.ceil(Math.log(0.01) / Math.log(0.999))
    }
  };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const report = await analyzeResidualEvidenceLaneV1({
    ledger: arg("--ledger", DEFAULTS.ledger),
    canonical: arg("--canonical", DEFAULTS.canonical),
    candidates: arg("--candidates", DEFAULTS.candidates),
    exhaustive: arg("--exhaustive", DEFAULTS.exhaustive),
    fixture: arg("--fixture", DEFAULTS.fixture),
    productionCanonical: arg("--production-canonical", DEFAULTS.productionCanonical)
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
