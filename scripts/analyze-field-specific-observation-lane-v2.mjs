#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCanonicalFieldsRequest } from "../lib/listing/thin/canonical-fields.mjs";
import { withFieldSpecificObservationLaneV1 } from "../lib/listing/thin/field-specific-observation-lane-v1.mjs";
import {
  FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2,
  FIELD_SPECIFIC_OBSERVATION_PROMPT_V2,
  withFieldSpecificObservationLaneV2
} from "../experiments/accuracy/field-specific-observation-lane-v2.mjs";
import {
  PRODUCT_SET_PARALLEL_HYPOTHESIS_PROMPT_V1,
  withProductSetParallelHypothesisLaneV1
} from "../experiments/accuracy/product-set-parallel-hypothesis-lane-v1.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LEDGER = "docs/evaluation/bare-canonical-complementarity-150-2026-08-02.json";
const DEFAULT_HYPOTHESES = "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl";
const DEFAULT_JSON = "docs/evaluation/field-specific-observation-lane-v2-analysis-2026-08-02.json";
const DEFAULT_MD = "docs/evaluation/field-specific-observation-lane-v2-analysis-2026-08-02.md";
const CERT_ORACLE_SOURCE = "scripts/analyze-accuracy-big-head-oracles.mjs";

const DOWNSTREAM_CAUSE = "CANONICAL_VALUE_PRESENT_TITLE_MISSING";
const ROLES = Object.freeze(["identity_phrase", "finish_phrase", "commercial_marker", "exact_code"]);
const MARKERS = new Set(["rc", "rookie", "1st", "sp", "ssp", "redemption", "vmax"]);
const FINISH_FIELDS = new Set(["print_finish", "descriptive_rarity", "release_variant"]);
const EXACT_FIELDS = new Set(["card_number", "numerical_rarity", "grading_info"]);
const V1_IDENTITY_FIELDS = new Set(["manufacturer", "product", "set", "ip_sport", "card_name"]);

const UNASSIGNED = Object.freeze({
  "1ab36981fdce86771040:disney": { role: "identity_phrase", field: "ip_sport", v1_prompt: true },
  "4c8131eeda536c66d385:redemption": { role: "commercial_marker", field: "commercial_marker", v1_prompt: false },
  "522dae554f642f6810eb:rookie": { role: "commercial_marker", field: "commercial_marker", v1_prompt: true },
  "a4051a222e9be2cf8149:two": { role: "identity_phrase", field: "subject", v1_prompt: false },
  "a4051a222e9be2cf8149:tubes": { role: "identity_phrase", field: "subject", v1_prompt: false },
  "dbf99f2a5e722e98b87a:rookie": { role: "commercial_marker", field: "commercial_marker", v1_prompt: true },
  "e25ba92ef5f8fb4207a0:vmax": { role: "commercial_marker", field: "commercial_marker", v1_prompt: false },
  "e25ba92ef5f8fb4207a0:trainer": { role: "identity_phrase", field: "set", v1_prompt: true },
  "e25ba92ef5f8fb4207a0:gallery": { role: "identity_phrase", field: "set", v1_prompt: true },
  "f371844dc1d0c6e49f92:star": { role: "identity_phrase", field: "ip_sport", v1_prompt: true },
  "f371844dc1d0c6e49f92:wars": { role: "identity_phrase", field: "ip_sport", v1_prompt: true }
});

const clean = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[‘’ʼ]/g, "'").toLowerCase();
const tokens = (value) => clean(value).split(/[^a-z0-9/']+/).filter(Boolean);
const tokenSet = (value) => new Set(tokens(value));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const suffix = (assetId) => String(assetId).replace(/^reviewed_blind_/, "");
const sha256 = (path) => createHash("sha256").update(readFileSync(resolve(ROOT, path))).digest("hex");
const byteLength = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function assertInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

function scoreSets(reference, candidate) {
  const hits = [...reference].filter((token) => candidate.has(token)).length;
  const recall = reference.size ? hits / reference.size : 0;
  const precision = candidate.size ? hits / candidate.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function countBy(values) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1))];
}

function targetClass(assetId, detail) {
  if (detail.cause === DOWNSTREAM_CAUSE) {
    return { role: "downstream_existing", field: detail.fields?.[0] || "unknown", v1_schema: false, v1_prompt: false };
  }
  const manual = UNASSIGNED[`${suffix(assetId)}:${detail.token}`];
  if (manual) return { ...manual, v1_schema: true };
  const fields = detail.fields || [];
  const field = fields[0] || "unassigned";
  if (field === "special_stamp" || (MARKERS.has(detail.token) && ["search_optimization", "unassigned"].includes(field))) {
    return { role: "commercial_marker", field, v1_schema: true, v1_prompt: MARKERS.has(detail.token) && detail.token !== "redemption" && detail.token !== "vmax" };
  }
  if (FINISH_FIELDS.has(field)) {
    return { role: "finish_phrase", field, v1_schema: true, v1_prompt: true };
  }
  if (EXACT_FIELDS.has(field)) {
    return { role: "exact_code", field, v1_schema: field === "numerical_rarity", v1_prompt: field === "numerical_rarity" };
  }
  return { role: "identity_phrase", field, v1_schema: true, v1_prompt: V1_IDENTITY_FIELDS.has(field) };
}

function phraseForDetail(row, detail) {
  return row.bare_win_diagnosis.reference_supported_complete_phrases
    .find((phrase) => tokens(phrase).includes(detail.token)) || detail.token;
}

function targetRowsForCard(row) {
  const grouped = new Map();
  for (const detail of row.bare_win_diagnosis.helpful_bare_only_tokens) {
    const classification = targetClass(row.asset_id, detail);
    if (classification.role === "downstream_existing") continue;
    const phrase = phraseForDetail(row, detail);
    const key = `${classification.role}:${clean(phrase)}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        phrase,
        role: classification.role,
        fields: new Set(),
        target_tokens: new Set(),
        exhaustive_supported_tokens: new Set(),
        v1_schema: true,
        v1_prompt: true
      });
    }
    const target = grouped.get(key);
    target.fields.add(classification.field);
    target.target_tokens.add(detail.token);
    if (detail.exhaustive_separate_call_support) target.exhaustive_supported_tokens.add(detail.token);
    target.v1_schema &&= classification.v1_schema;
    target.v1_prompt &&= classification.v1_prompt;
  }
  return [...grouped.values()].map((rowTarget) => ({
    ...rowTarget,
    fields: [...rowTarget.fields],
    target_tokens: [...rowTarget.target_tokens],
    exhaustive_supported_tokens: [...rowTarget.exhaustive_supported_tokens]
  }));
}

function titleWithPhrases(base, phrases) {
  return [base, ...phrases].filter(Boolean).join(" ");
}

function under80Oracle(row, targets) {
  const reference = tokenSet(row.reference);
  const canonical = tokenSet(row.canonical_title);
  let best = { score: scoreSets(reference, canonical), selected: [] };
  const combinations = 1 << targets.length;
  for (let mask = 0; mask < combinations; mask += 1) {
    const selected = targets.filter((_, index) => mask & (1 << index));
    if (titleWithPhrases(row.canonical_title, selected.map((target) => target.phrase)).length > 80) continue;
    const additions = selected.flatMap((target) => target.target_tokens);
    const candidate = new Set([...canonical, ...additions]);
    const candidateScore = scoreSets(reference, candidate);
    if (candidateScore.f1 > best.score.f1 + 1e-12) best = { score: candidateScore, selected };
  }
  return best;
}

function classifyCandidate(candidate) {
  const candidateTokens = new Set(candidate.tokens || tokens(candidate.phrase));
  if ([...candidateTokens].some((token) => MARKERS.has(token))) return "commercial_marker";
  if (FINISH_FIELDS.has(candidate.field)) return "finish_phrase";
  if (EXACT_FIELDS.has(candidate.field) || [...candidateTokens].some((token) => /^\d+\/\d+$/.test(token))) return "exact_code";
  return "identity_phrase";
}

function riskByRole(ledgerRows) {
  const buckets = Object.fromEntries(ROLES.map((role) => [role, []]));
  for (const row of ledgerRows) {
    for (const candidate of row.unions.phrase_candidate_lane.candidates) {
      buckets[classifyCandidate(candidate)].push({ asset_id: row.asset_id, ...candidate });
    }
  }
  return Object.fromEntries(ROLES.map((role) => {
    const candidates = buckets[role];
    const supported = candidates.reduce((sum, candidate) => sum + candidate.supported_tokens.length, 0);
    const unsupported = candidates.reduce((sum, candidate) => sum + candidate.unsupported_tokens.length, 0);
    return [role, {
      candidates: candidates.length,
      cards: new Set(candidates.map((candidate) => candidate.asset_id)).size,
      support_labels: countBy(candidates.map((candidate) => candidate.support)),
      supported_tokens: supported,
      unsupported_tokens: unsupported,
      token_support_rate: supported + unsupported ? round(supported / (supported + unsupported)) : null,
      identity_conflicts: candidates.filter((candidate) => candidate.identity_conflict).length,
      numeric_risk_candidates: candidates.filter((candidate) => candidate.unsupported_tokens.some((token) => /\d/.test(token))).length
    }];
  }));
}

function requestSize(request) {
  const prompt = request.input[0].content.find((part) => part.type === "input_text").text;
  return {
    request_bytes: byteLength(request),
    prompt_bytes: byteLength(prompt),
    schema_bytes: byteLength(request.text.format.schema)
  };
}

function deltaSize(control, treatment) {
  const left = requestSize(control);
  const right = requestSize(treatment);
  return {
    control: left,
    treatment: right,
    delta: Object.fromEntries(Object.keys(left).map((key) => [key, right[key] - left[key]]))
  };
}

function maxSerializedOutput(property, rows) {
  const text = "X".repeat(64);
  const literalRows = Array.from({ length: rows }, () => ({
    text, role: "identity_phrase", region: "card_back", basis: "printed_text"
  }));
  const hypothesisRows = Array.from({ length: rows }, (_, index) => ({
    product: text,
    set: index ? text : "",
    parallel: index ? "" : text,
    region: "card_back",
    basis: "visible_combination"
  }));
  const payload = property === "observation_candidates" ? literalRows : hypothesisRows;
  const bytes = byteLength({ [property]: payload });
  return { bytes, approximate_tokens_at_4_bytes: Math.ceil(bytes / 4) };
}

function hypothesisProxy(rows, assetIds) {
  const selectedRows = rows.filter((row) => assetIds.has(row.asset_id));
  assertInvariant(selectedRows.length === 150, `hypothesis proxy cohort mismatch: ${selectedRows.length}`);
  let candidates = 0;
  let full = 0;
  let partial = 0;
  let unsupportedCandidate = 0;
  let supportedTokens = 0;
  let unsupportedTokens = 0;
  let visibleCombination = 0;
  let modelKnowledge = 0;
  const counts = [];
  for (const row of selectedRows) {
    const reference = tokenSet(row.reference);
    const hypotheses = (row.candidate_hypotheses || []).slice(0, 2);
    counts.push(hypotheses.length);
    for (const hypothesis of hypotheses) {
      candidates += 1;
      if (hypothesis.basis === "model_knowledge") modelKnowledge += 1;
      else visibleCombination += 1;
      const hypothesisTokens = tokenSet(hypothesis.value);
      const hits = [...hypothesisTokens].filter((token) => reference.has(token)).length;
      supportedTokens += hits;
      unsupportedTokens += hypothesisTokens.size - hits;
      if (hits === hypothesisTokens.size) full += 1;
      else if (hits) partial += 1;
      else unsupportedCandidate += 1;
    }
  }
  return {
    source_is_separate_paid_candidate_v4_call: true,
    source_is_risk_proxy_not_same_call_proof: true,
    cards: selectedRows.length,
    rows_per_card: countBy(counts),
    candidates,
    full_reference_supported: full,
    partially_supported: partial,
    fully_unsupported: unsupportedCandidate,
    supported_tokens: supportedTokens,
    unsupported_tokens: unsupportedTokens,
    token_support_rate: round(supportedTokens / (supportedTokens + unsupportedTokens)),
    visible_combination: visibleCombination,
    model_knowledge: modelKnowledge,
    output_tokens: {
      p50_full_v4_including_visible_facts: quantile(selectedRows.map((row) => row.output_tokens), 0.5),
      p95_full_v4_including_visible_facts: quantile(selectedRows.map((row) => row.output_tokens), 0.95),
      isolated_hypothesis_cost_available: false
    }
  };
}

export function analyzeObservationLaneV2(ledger, hypothesisRows) {
  assertInvariant(ledger?.schema_version === "bare-canonical-complementarity-audit-v1", "unexpected complementarity ledger");
  assertInvariant(ledger?.deployment_boundary?.provider_calls === 0, "ledger provider boundary missing");
  assertInvariant(ledger?.ledger?.length === 150, "expected 150-card ledger");
  assertInvariant(ledger.headline?.pair_signs?.bare_wins === 44, "expected 44 bare wins");

  const rows = ledger.ledger;
  const bareWins = rows.filter((row) => row.verdict === "BARE_WIN");
  const allDetails = bareWins.flatMap((row) => row.bare_win_diagnosis.helpful_bare_only_tokens
    .map((detail) => ({ asset_id: row.asset_id, ...detail, ...targetClass(row.asset_id, detail) })));
  assertInvariant(allDetails.length === 85, `expected 85 helpful details, got ${allDetails.length}`);
  const targetDetails = allDetails.filter((detail) => detail.role !== "downstream_existing");
  const cardTargets = new Map(rows.map((row) => [row.asset_id,
    row.verdict === "BARE_WIN" ? targetRowsForCard(row) : []]));
  const targetRows = [...cardTargets.values()].flat();
  assertInvariant(targetDetails.length === 47, `expected 47 capture details, got ${targetDetails.length}`);
  assertInvariant(targetRows.length === 39, `expected 39 target phrases, got ${targetRows.length}`);
  assertInvariant(Math.max(...[...cardTargets.values()].map((targets) => targets.length)) === 2,
    "two-row cap no longer covers the measured target phrases");

  const baselineScores = [];
  const combinedScores = [];
  const combinedExhaustiveScores = [];
  const under80Scores = [];
  const byRoleScores = Object.fromEntries(ROLES.map((role) => [role, []]));
  const byRoleExhaustiveScores = Object.fromEntries(ROLES.map((role) => [role, []]));
  const rolePressure = Object.fromEntries(ROLES.map((role) => [role, 0]));
  let combinedPressure = 0;
  for (const row of rows) {
    const reference = tokenSet(row.reference);
    const canonical = tokenSet(row.canonical_title);
    const targets = cardTargets.get(row.asset_id);
    baselineScores.push(scoreSets(reference, canonical).f1);
    for (const role of ROLES) {
      const roleTargets = targets.filter((target) => target.role === role);
      const additions = roleTargets.flatMap((target) => target.target_tokens);
      const exhaustiveAdditions = roleTargets.flatMap((target) => target.exhaustive_supported_tokens);
      byRoleScores[role].push(scoreSets(reference, new Set([...canonical, ...additions])).f1);
      byRoleExhaustiveScores[role].push(scoreSets(reference, new Set([...canonical, ...exhaustiveAdditions])).f1);
      if (titleWithPhrases(row.canonical_title, roleTargets.map((target) => target.phrase)).length > 80) rolePressure[role] += 1;
    }
    const additions = targets.flatMap((target) => target.target_tokens);
    const exhaustiveAdditions = targets.flatMap((target) => target.exhaustive_supported_tokens);
    combinedScores.push(scoreSets(reference, new Set([...canonical, ...additions])).f1);
    combinedExhaustiveScores.push(scoreSets(reference, new Set([...canonical, ...exhaustiveAdditions])).f1);
    if (titleWithPhrases(row.canonical_title, targets.map((target) => target.phrase)).length > 80) combinedPressure += 1;
    under80Scores.push(under80Oracle(row, targets).score.f1);
  }

  const baseline = mean(baselineScores);
  const roleSummary = Object.fromEntries(ROLES.map((role) => {
    const roleDetails = targetDetails.filter((detail) => detail.role === role);
    const roleRows = targetRows.filter((target) => target.role === role);
    return [role, {
      token_occurrences: roleDetails.length,
      cards: new Set(roleDetails.map((detail) => detail.asset_id)).size,
      complete_phrases: roleRows.length,
      exhaustive_reproduced_tokens: roleDetails.filter((detail) => detail.exhaustive_separate_call_support).length,
      exhaustive_reproduction_rate: roleDetails.length
        ? round(roleDetails.filter((detail) => detail.exhaustive_separate_call_support).length / roleDetails.length)
        : null,
      label_oracle_macro_f1: round(mean(byRoleScores[role])),
      label_oracle_delta: round(mean(byRoleScores[role]) - baseline),
      exhaustive_reproduced_oracle_delta: round(mean(byRoleExhaustiveScores[role]) - baseline),
      cards_over_80_if_all_phrases_appended: rolePressure[role]
    }];
  }));

  const v1PromptCovered = targetDetails.filter((detail) => detail.v1_prompt).length;
  const v1SchemaCovered = targetDetails.filter((detail) => detail.v1_schema).length;
  const control = buildCanonicalFieldsRequest({
    imageUrls: ["https://example.invalid/front.jpg", "https://example.invalid/back.jpg"],
    model: "gpt-5.6-luna", effort: "none", imageDetail: "high"
  });
  const v1Request = withFieldSpecificObservationLaneV1(control, { enabled: true });
  const v2Request = withFieldSpecificObservationLaneV2(control, { enabled: true });
  const hypothesisRequest = withProductSetParallelHypothesisLaneV1(control, { enabled: true });

  const hypothesisTargetDetails = targetDetails.filter((detail) =>
    detail.field === "product" || detail.field === "set" || detail.role === "finish_phrase");
  const hypothesisTargetByAsset = new Map(rows.map((row) => [row.asset_id,
    hypothesisTargetDetails.filter((detail) => detail.asset_id === row.asset_id)]));
  const hypothesisOracleScores = rows.map((row) => {
    const additions = hypothesisTargetByAsset.get(row.asset_id).map((detail) => detail.token);
    return scoreSets(tokenSet(row.reference), new Set([...tokenSet(row.canonical_title), ...additions])).f1;
  });

  const candidateProxy = hypothesisProxy(hypothesisRows, new Set(rows.map((row) => row.asset_id)));

  // The boundary is "this experimental lane must not reach what ships", and it
  // used to be checked against `scripts/run-thin-path-eval.mjs`. That is the
  // EVALUATION HARNESS, not the shipped path, and it imports the lane on
  // purpose -- `thin_canonical_field_observation_v2_high` is a declared arm
  // whose whole job is to measure it. So the assertion forbade the one place
  // the import belongs and said nothing about the places it would matter.
  //
  // It now walks the shipped surface: `api/`, `app/`, `lib/` and `csm/`. All
  // four are clean, so the boundary holds -- it just needed pointing at the
  // boundary.
  const shippedRoots = ["api", "app", "lib", "csm"];
  const leaked = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(resolve(ROOT, dir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(child); continue; }
      if (!/\.(mjs|js)$/.test(entry.name)) continue;
      const text = readFileSync(resolve(ROOT, child), "utf8");
      if (text.includes("experiments/accuracy/field-specific-observation-lane-v2")
        || text.includes("experiments/accuracy/product-set-parallel-hypothesis-lane-v1")) {
        leaked.push(child);
      }
    }
  };
  for (const root of shippedRoots) walk(root);
  assertInvariant(!leaked.length,
    `evaluation-only v2/hypothesis module leaked into the shipped path: ${leaked.join(", ")}`);

  return {
    schema_version: "field-specific-observation-lane-v2-analysis-v1",
    generated_at: new Date().toISOString(),
    boundaries: {
      provider_calls: 0,
      runtime_changes: 0,
      production_changes: 0,
      automatic_csm_admission: false,
      automatic_renderer_admission: false,
      reference_used_only_for_offline_oracles: true,
      // Renamed with the invariant above: the question is whether the SHIPPED
      // path imports the experimental lane, not whether the evaluation harness
      // does. The harness does, deliberately.
      shipped_path_imports_v2_or_hypothesis: leaked.length > 0,
      shipped_path_leaks: leaked
    },
    source: {
      complementarity_ledger_sha256: null,
      hypothesis_proxy_is_separate_prompt: true
    },
    decomposition_85: {
      token_occurrences: allDetails.length,
      mutually_exclusive_role_occurrences: countBy(allDetails.map((detail) => detail.role)),
      capture_target: {
        token_occurrences: targetDetails.length,
        cards: new Set(targetDetails.map((detail) => detail.asset_id)).size,
        complete_phrases: targetRows.length,
        max_phrases_on_one_card: Math.max(...[...cardTargets.values()].map((targets) => targets.length)),
        phrase_rows_per_card: countBy([...cardTargets.values()].map((targets) => targets.length)),
        cap_coverage: Object.fromEntries([1, 2].map((cap) => [cap, {
          covered_phrases: [...cardTargets.values()].reduce((sum, targets) => sum + Math.min(cap, targets.length), 0),
          total_phrases: targetRows.length
        }]))
      },
      roles: roleSummary
    },
    theoretical_value: {
      canonical_macro_f1: round(baseline),
      all_capture_targets_label_oracle: {
        macro_f1: round(mean(combinedScores)),
        delta: round(mean(combinedScores) - baseline),
        cards_over_80_if_all_phrases_appended: combinedPressure,
        under_80_phrase_subset_macro_f1: round(mean(under80Scores)),
        under_80_phrase_subset_delta: round(mean(under80Scores) - baseline),
        nondeployable: true
      },
      exhaustive_reproduced_subset_oracle: {
        macro_f1: round(mean(combinedExhaustiveScores)),
        delta: round(mean(combinedExhaustiveScores) - baseline),
        separate_call_proxy: true,
        nondeployable: true
      }
    },
    pollution_proxy: {
      source: "all bare-derived phrase candidates from the 150-card complementarity ledger",
      direct_admission_forbidden: true,
      by_role: riskByRole(rows)
    },
    v1_audit: {
      v1_total_reserved_rows: 7,
      measured_max_needed_rows: FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2,
      excess_reserved_rows_per_card: 7 - FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2,
      capture_target_tokens: targetDetails.length,
      schema_addressable_tokens: v1SchemaCovered,
      prompt_addressable_tokens: v1PromptCovered,
      prompt_addressable_share: round(v1PromptCovered / targetDetails.length),
      missed_by_prompt_or_role: countBy(targetDetails.filter((detail) => !detail.v1_prompt).map((detail) => detail.field)),
      minimal_v2_delta: [
        "replace four reserved arrays with one max-2 array and an explicit mutually-exclusive role enum",
        "allow complete subject, team/city, character, and season phrases in identity_phrase",
        "add literal Redemption and VMAX to commercial_marker",
        "generalize stamped_serials to candidate-only exact_code for checklist/serial/grade",
        "drop candidates whose token set is already represented anywhere in canonical fields",
        "forbid world knowledge; visual_pattern is legal only for finish_phrase"
      ]
    },
    request_cost: {
      v1_vs_control: deltaSize(control, v1Request),
      literal_v2_vs_control: deltaSize(control, v2Request),
      hypothesis_v1_vs_control: deltaSize(control, hypothesisRequest),
      literal_v2_max_output: maxSerializedOutput("observation_candidates", 2),
      hypothesis_v1_max_output: maxSerializedOutput("product_set_parallel_hypotheses", 2),
      literal_prompt_bytes: byteLength(FIELD_SPECIFIC_OBSERVATION_PROMPT_V2),
      hypothesis_prompt_bytes: byteLength(PRODUCT_SET_PARALLEL_HYPOTHESIS_PROMPT_V1)
    },
    product_set_parallel_hypothesis: {
      status: "HOLD_SEPARATE_ARM_NOT_DEFAULT",
      strict_85_ledger_target: {
        token_occurrences: hypothesisTargetDetails.length,
        cards: new Set(hypothesisTargetDetails.map((detail) => detail.asset_id)).size,
        label_oracle_macro_f1: round(mean(hypothesisOracleScores)),
        label_oracle_delta: round(mean(hypothesisOracleScores) - baseline),
        unique_tokens_beyond_literal_v2: 0,
        note: "Strict target includes product, set, and parallel only. It excludes IP, subject, team, year, card-name, marker, and exact-code targets."
      },
      existing_v4_hypothesis_risk_proxy: candidateProxy,
      interpretation: "The 85-token ledger gives hypotheses no unique measured target over literal v2, while the separate v4 proxy is mostly partially supported rather than exact. Model-knowledge completion outside the ledger is not falsified, so this remains a separate arm gated by a world support-only ranker."
    },
    slab_anchor: {
      status: "DEFER_NO_VERIFIED_REGISTRY_COVERAGE",
      decision: "Do not add slab_anchor to the literal v2 schema or to the first paid arm. Pre-register it only as a future independent optional candidate lane after exact Registry coverage is measured.",
      independent_from_literal_v2: true,
      literal_v2_rows_consumed: 0,
      literal_v2_max_rows_unchanged: FIELD_SPECIFIC_OBSERVATION_MAX_ROWS_V2,
      default_schema_enabled: false,
      paid_arm_enabled: false,
      runtime_enabled: false,
      observed_opportunity: {
        exact_single_cert_cards: 37,
        conflicting_cert_cards: 0,
        current_cert_card_f1: 0.865142,
        audited_missing_occurrences: 71,
        restore_all_missing_label_oracle_delta: 0.018012,
        perfect_cert_cards_label_oracle_delta: 0.033265,
        note: "The oracle restores title tokens that are not the certificate number itself; it is not a forecast of Registry lookup gain."
      },
      registry_evidence: {
        schema_migration_present: true,
        local_seed_or_insert_evidence_present: false,
        live_row_coverage_verified: false,
        old_v4_exact_lookup_seam_present: true,
        old_v4_lookup_is_current_thin_path_authority: false
      },
      future_contract_shape_if_unblocked: {
        property: "slab_anchor",
        fields: ["grader", "certification_number", "region", "basis"],
        region: "slab_label",
        basis: "printed_text",
        registry_key: ["grader", "cert_number"],
        lookup: "exact_only",
        authority: "candidate_only",
        required_conflict_policy: "current-image contradiction => REVIEW_REQUIRED; never overwrite visible text"
      },
      unblock_gate: "Measure reviewed, unique exact Registry hits for the 37 readable certificate cards before adding any schema or paid treatment; zero/few hits remain STOP.",
      source: CERT_ORACLE_SOURCE
    },
    decision: {
      literal_v2: "GO_TO_PAIRED_FRESH150_EXPERIMENT_ONLY",
      literal_v2_production: "STOP",
      hypothesis_default_schema: "STOP",
      hypothesis_independent_arm: "HOLD",
      reasons: [
        "two rows cover all 39 measured target phrases across 30 cards",
        `the all-target under-80 label oracle is +${round(mean(under80Scores) - baseline)} macro F1`,
        "the contract keeps capture and admission separate and has no runtime import",
        "same-call capture and canonical non-interference remain unmeasured"
      ]
    },
    minimum_fresh150_experiment: {
      shared_control: "thin_canonical_high with identical model/effort/detail/images",
      required_treatment: "thin_canonical_high + literal field-specific observation lane v2 in the same response",
      optional_independent_treatment: "thin_canonical_high + product/set/parallel hypothesis lane v1; never combine with literal v2 in the first test",
      calls_if_literal_only: 300,
      calls_if_shared_control_plus_both_separate_treatments: 450,
      gates: {
        request_bytes_differ_before_scoring: true,
        canonical_projection_noninterference: "no critical numeric/subject/product mutation and no aggregate regression",
        capture: "at least 8 target cards and >= +0.003 resolver-oracle macro F1 on frozen labels",
        authority: "zero automatic CSM/Composer/persistence admission",
        cost: "report input/output token delta and latency p50/p95; no second call",
        hypothesis_extra: "world ranker must preserve candidate values, hard-reject zero, and beat source-order before paid arm"
      }
    },
    target_rows: rows.flatMap((row) => (cardTargets.get(row.asset_id) || []).map((target) => ({
      asset_id: row.asset_id,
      reference: row.reference,
      canonical_title: row.canonical_title,
      ...target
    })))
  };
}

function pct(value) {
  return `${(100 * value).toFixed(1)}%`;
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function tableRows(object) {
  return Object.entries(object || {}).map(([key, value]) => `| ${key} | ${value} |`).join("\n");
}

function renderMarkdown(result, sources) {
  const d = result.decomposition_85;
  const v = result.theoretical_value;
  const h = result.product_set_parallel_hypothesis;
  const slab = result.slab_anchor;
  const roleRows = Object.entries(d.roles).map(([role, value]) =>
    `| ${role} | ${value.token_occurrences} | ${value.cards} | ${value.complete_phrases} | ${value.exhaustive_reproduced_tokens}/${value.token_occurrences} (${pct(value.exhaustive_reproduction_rate)}) | ${signed(value.label_oracle_delta)} | ${signed(value.exhaustive_reproduced_oracle_delta)} | ${value.cards_over_80_if_all_phrases_appended} |`).join("\n");
  const riskRows = Object.entries(result.pollution_proxy.by_role).map(([role, value]) =>
    `| ${role} | ${value.candidates} | ${value.support_labels.FULL_EXACT || 0} | ${value.support_labels.FULL_TOKEN || 0} | ${value.support_labels.PARTIAL || 0} | ${value.support_labels.UNSUPPORTED || 0} | ${pct(value.token_support_rate)} | ${value.identity_conflicts} | ${value.numeric_risk_candidates} |`).join("\n");
  const targetRows = result.target_rows.map((row) =>
    `| ${suffix(row.asset_id)} | ${row.role} | ${String(row.phrase).replace(/\|/g, "\\|")} | ${row.target_tokens.join(" ")} | ${row.exhaustive_supported_tokens.join(" ") || "—"} | ${row.fields.join("+")} | ${row.v1_prompt ? "yes" : "no"} |`).join("\n");
  const costs = result.request_cost;
  return `# Field-specific observation lane v2：fresh150 信息增益与最小合约

## 决策

先接受反方观点：v1 的四数组和 7 行容量不是最大信息增益，而是给尚未出现的噪声预留输出。85 个 bare 正确增量中，38 个已经在 canonical fields，应该由 Composer/SEM 取回；真正需要同次 observation 捕获的只有 **47 个词次、39 个完整短语、30 张卡**。每张最多 **2** 个目标短语，所以 v2 的理论最优硬上限是一个统一数组、最多两行。

结论是 **GO_TO_PAIRED_FRESH150_EXPERIMENT_ONLY / STOP_PRODUCTION**。v2 只有捕获权限，没有 canonical、Composer 或持久化权限；同次调用是否真的捕获这些短语、以及 schema 是否干扰 canonical，仍必须用 fresh150 配对实验验证。

## 85 个增量的互斥分解

| 互斥角色 | 词次 |
|---|---:|
${tableRows(d.mutually_exclusive_role_occurrences)}

这五类严格合计 85。\`downstream_existing\` 不进入 observation lane；其余四类合计 47。

| v2 角色 | 词次 | 卡数 | 完整短语 | exhaustive 另一次调用再现 | label oracle ΔF1 | 再现子集 oracle ΔF1 | 全追加时 >80 卡数 |
|---|---:|---:|---:|---:|---:|---:|---:|
${roleRows}

四类合并的 label oracle 是 **${v.all_capture_targets_label_oracle.macro_f1}**，相对 canonical **${signed(v.all_capture_targets_label_oracle.delta)}**；全部短语直接追加会让 ${v.all_capture_targets_label_oracle.cards_over_80_if_all_phrases_appended} 张超过 80 字符，80 字符内逐卡选取的不可部署 oracle 仍为 **${v.all_capture_targets_label_oracle.under_80_phrase_subset_macro_f1}**，增量 **${signed(v.all_capture_targets_label_oracle.under_80_phrase_subset_delta)}**。

只取 exhaustive 在另一提示中重新表达的词，oracle 增量是 **${signed(v.exhaustive_reproduced_subset_oracle.delta)}**。它比全 47 词上限更保守，但仍不是 same-call 捕获率。

## 为什么硬上限是两行

| 每卡允许行数 | 覆盖完整短语 | 总短语 |
|---:|---:|---:|
| 1 | ${d.capture_target.cap_coverage[1].covered_phrases} | ${d.capture_target.cap_coverage[1].total_phrases} |
| 2 | ${d.capture_target.cap_coverage[2].covered_phrases} | ${d.capture_target.cap_coverage[2].total_phrases} |

v1 最多 7 行，其中 identity 2、marker 2、serial 1、parallel 2。实证目标没有任何卡需要第三行；v1 每卡多预留 5 行，而且 stamped-serial 专槽没有覆盖本批唯一的 exact-code 目标。

## v1 覆盖缺口与 v2 最小变化

v1 schema 理论可容纳 ${result.v1_audit.schema_addressable_tokens}/${result.v1_audit.capture_target_tokens} 个目标词，但 prompt 明确覆盖只有 **${result.v1_audit.prompt_addressable_tokens}/${result.v1_audit.capture_target_tokens}（${pct(result.v1_audit.prompt_addressable_share)}）**。主要缺口来自它主动排除 subject/team、没有 season/year、只给 serial 数字槽，以及未明确 Redemption/VMAX。

| v1 未覆盖字段/角色 | 词次 |
|---|---:|
${tableRows(result.v1_audit.missed_by_prompt_or_role)}

v2 只做六个变化：统一 max-2 数组；显式互斥 role；允许完整 subject/team/city/character/season phrase；marker 补 Redemption/VMAX；serial 专槽改为零权限 exact-code；任何词已被 canonical fields 全覆盖的候选直接丢弃。世界知识仍被禁止，visual_pattern 只允许 finish。

## 污染风险：候选可以留，不能直接发

下面用全 150 张 bare-derived phrase candidates 做压力代理。它故意比 v2 目标宽，作用是估算“如果捕获后误 admission”会发生什么。

| 角色 | 候选数 | fully exact | full-token非连续 | partial | unsupported | token 支持率 | identity 冲突 | 数字风险候选 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${riskRows}

因此理论 F1 上限不是准入预期。v2 parser 永远返回空 \`field_updates\` 和空 \`admission_proposals\`；候选只能进入离线 resolver。

## 请求与输出成本

| 合约 | prompt Δbytes | schema Δbytes | request Δbytes | 两行最大 JSON bytes | 约算输出 tokens |
|---|---:|---:|---:|---:|---:|
| v1 四数组/7行 | ${costs.v1_vs_control.delta.prompt_bytes} | ${costs.v1_vs_control.delta.schema_bytes} | ${costs.v1_vs_control.delta.request_bytes} | — | — |
| literal v2/max2 | ${costs.literal_v2_vs_control.delta.prompt_bytes} | ${costs.literal_v2_vs_control.delta.schema_bytes} | ${costs.literal_v2_vs_control.delta.request_bytes} | ${costs.literal_v2_max_output.bytes} | ${costs.literal_v2_max_output.approximate_tokens_at_4_bytes} |
| PSP hypothesis/max2 | ${costs.hypothesis_v1_vs_control.delta.prompt_bytes} | ${costs.hypothesis_v1_vs_control.delta.schema_bytes} | ${costs.hypothesis_v1_vs_control.delta.request_bytes} | ${costs.hypothesis_v1_max_output.bytes} | ${costs.hypothesis_v1_max_output.approximate_tokens_at_4_bytes} |

字节只是静态合约成本；真实 input/output tokens 与 latency 必须由配对云端实验测量。

## Product / Set / Parallel 两项 hypothesis 候选

状态：**${h.status}**，不进入 literal v2 默认 schema。

严格按 85 词账本，它能瞄准 ${h.strict_85_ledger_target.token_occurrences} 个词、${h.strict_85_ledger_target.cards} 张卡，label oracle 增量 **${signed(h.strict_85_ledger_target.label_oracle_delta)}**；相对 literal v2 的独有已测目标是 **0**。也就是说，在当前账本内 literal observation 严格覆盖它的全部已知收益。

但它可能靠 model knowledge 补出 bare/exhaustive 都没表达的 product/set/parallel，这个主张现有账本无法证伪。已有 candidate-v4 的前两项 hypothesis 只能作为风险代理：${h.existing_v4_hypothesis_risk_proxy.candidates} 个候选中，完整命中 reference 只有 ${h.existing_v4_hypothesis_risk_proxy.full_reference_supported} 个，部分命中 ${h.existing_v4_hypothesis_risk_proxy.partially_supported} 个；token 支持率 ${pct(h.existing_v4_hypothesis_risk_proxy.token_support_rate)}。因此它只能是**独立 treatment arm**，且必须先由 world support-only ranker 通过零调用门；不能和 literal v2 混在一个 schema 中，否则无法归因。

## Slab certificate anchor：明确 DEFER

状态：**${slab.status}**。它不占 literal v2 的两行、不进入默认 schema，也不增加本轮 paid arm。

exhaustive fresh150 在 ${slab.observed_opportunity.exact_single_cert_cards}/150 张卡上读到唯一 7–12 位 \`certification_number\`，冲突 ${slab.observed_opportunity.conflicting_cert_cards}；这些卡当前 F1 已是 ${slab.observed_opportunity.current_cert_card_f1}。把这些卡其余 ${slab.observed_opportunity.audited_missing_occurrences} 个缺失标题词全部恢复的标签 oracle 是 **+${slab.observed_opportunity.restore_all_missing_label_oracle_delta}**，把 37 张全部变成满分的上限是 **+${slab.observed_opportunity.perfect_cert_cards_label_oracle_delta}**。这两项恢复的不是证书号本身，因此不能当作 Registry 命中预测。

本地只证明了 \`cert_registry\` schema 与旧 V4 exact lookup seam 存在；没有 seed/insert，也没有 live row coverage 证据。现在把字段塞进 same-call schema 只会增加请求成本并与更有实证的 literal phrase 竞争，长期期望值为负。

若覆盖门以后通过，唯一允许的独立可选形状是 \`slab_anchor={grader, certification_number, region=slab_label, basis=printed_text}\`；只做 \`(grader, cert_number)\` exact lookup，结果仍是 candidate-only，当前图像冲突必须转 \`REVIEW_REQUIRED\`。在此之前不实现合同、不调用 Registry、不扩 fresh150。

## fresh150 最小实验

最低成本、能回答 literal v2 是否正资产的设计是 300 次调用：

1. shared control：同一批 150 的 canonical high；
2. treatment L：同一响应 canonical high + literal v2；
3. 两臂必须同 model、none effort、high detail、图像、顺序和并发配置；运行前断言 request bytes 不同。

若要同时保留未证伪的 hypothesis 问题，则增加独立 treatment H，总计 450 次调用；H 不能与 L 合并。它先通过 world ranker 的 candidate-value 不变、hard reject=0、source-order 排序增益门。

literal v2 的通过门：至少 8 张目标卡被捕获；冻结 label 上 resolver-oracle 至少 +0.003；canonical projection 无任何 critical numeric/subject/product mutation 且 aggregate 不退化；报告 token、latency p50/p95；全程单次模型调用和零自动 admission。

## Contract 与逐短语账本

- literal v2 contract：\`experiments/accuracy/field-specific-observation-lane-v2.mjs\`
- 独立 hypothesis contract：\`experiments/accuracy/product-set-parallel-hypothesis-lane-v1.mjs\`
- contract test：\`scripts/field-specific-observation-lane-v2.test.mjs\`
- 本分析：\`${sources.script}\`
- 输入账本：\`${sources.ledger}\`，SHA-256 \`${sources.ledger_sha256}\`

| asset 后缀 | 角色 | 完整短语 | 目标词 | exhaustive 再现词 | 候选字段 | v1 prompt覆盖 |
|---|---|---|---|---|---|---|
${targetRows}

## 硬边界

- 本次 provider 调用 0，runtime/Production 改动 0。
- reference 只参与离线 oracle 和污染标注，不进入任何 parser、ranker 或选择器。
- literal 与 hypothesis schema 相互独立；没有组合 treatment。
- 任何 candidate 自动进入 CSM、Composer、持久化或生产标题都属于 contract violation。
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const ledgerPath = argValue(argv, "--ledger", DEFAULT_LEDGER);
  const hypothesisPath = argValue(argv, "--hypotheses", DEFAULT_HYPOTHESES);
  const outputJson = argValue(argv, "--out-json", DEFAULT_JSON);
  const outputMd = argValue(argv, "--out-md", DEFAULT_MD);
  const ledger = JSON.parse(readFileSync(resolve(ROOT, ledgerPath), "utf8"));
  const hypotheses = readFileSync(resolve(ROOT, hypothesisPath), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const result = analyzeObservationLaneV2(ledger, hypotheses);
  result.source.complementarity_ledger_sha256 = sha256(ledgerPath);
  result.source.hypothesis_proxy_sha256 = sha256(hypothesisPath);
  writeFileSync(resolve(ROOT, outputJson), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(resolve(ROOT, outputMd), renderMarkdown(result, {
    script: "scripts/analyze-field-specific-observation-lane-v2.mjs",
    ledger: ledgerPath,
    ledger_sha256: result.source.complementarity_ledger_sha256
  }));
  process.stdout.write(`${JSON.stringify({
    outputs: { json: outputJson, markdown: outputMd },
    decomposition_85: result.decomposition_85,
    theoretical_value: result.theoretical_value,
    v1_audit: result.v1_audit,
    request_cost: result.request_cost,
    product_set_parallel_hypothesis: result.product_set_parallel_hypothesis,
    decision: result.decision,
    minimum_fresh150_experiment: result.minimum_fresh150_experiment
  }, null, 2)}\n`);
}
