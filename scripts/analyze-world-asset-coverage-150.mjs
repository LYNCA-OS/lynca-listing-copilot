#!/usr/bin/env node

// Zero-call audit of whether the local world/catalog assets can materially
// improve the retained fresh150 final titles. All edges remain advisory:
// positive support may rank an existing candidate, while absence is UNKNOWN.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { runOfficialReleaseGraphScreen } from "../experiments/accuracy/official-release-graph-v1-screen.mjs";
import { analyzeCombinedPrecisionLoss } from "./analyze-combined-precision-loss-150.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = Object.freeze({
  constraints: path.join(repoRoot, "data/catalog/constraints/constraints-94b08531ca0f9fa3.json.gz"),
  officialDir: path.join(repoRoot, "data/catalog/official"),
  expression: path.join(repoRoot, "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl"),
  worldReplay: path.join(repoRoot, "docs/evaluation/world-compatibility-ranker-v1-replay-150-2026-08-02.json"),
  outputJson: path.join(repoRoot, "docs/evaluation/world-asset-coverage-audit-150-2026-08-02.json"),
  outputReport: path.join(repoRoot, "docs/evaluation/world-asset-coverage-audit-150-2026-08-02.md")
});

const expected = Object.freeze({
  constraints_sha256: "3c63700e0506fc187e43deb3bec73fb8b7c1fd5f83269e51380f195592a5fa10",
  expression_sha256: "39fbbaeef1c9bd2d01d74aaf36c3a1380e9901d26b76dac502756a91811d5819",
  world_replay_sha256: "e5c0565e2d202ea08095ca023eb30eed8c9cbf09befcb06e90ba98a54d7397dd",
  cards: 150,
  target_delta_f1: 0.02
});

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJsonl = (value) => String(value).split(/\n+/).filter(Boolean).map(JSON.parse);
const tokenSet = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .split(/[^a-z0-9/']+/)
  .filter(Boolean));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

function f1(reference, candidateTokens) {
  const wanted = tokenSet(reference);
  const got = candidateTokens instanceof Set ? candidateTokens : tokenSet(candidateTokens);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
}

function fieldRemovalOracle(precision, fields) {
  const wantedFields = new Set(fields);
  const scores = [];
  const perCard = [];
  let occurrences = 0;
  for (const card of precision.cards) {
    const selected = card.reference_absent_tokens.filter((entry) => wantedFields.has(entry.field));
    occurrences += selected.length;
    const next = tokenSet(card.candidate_title);
    for (const entry of selected) next.delete(entry.token);
    const baseline = f1(card.reference, card.candidate_title);
    const after = f1(card.reference, next);
    scores.push(after);
    if (selected.length) perCard.push({
      asset_id: card.asset_id,
      card_ordinal: card.card_ordinal,
      occurrences: selected.length,
      individual_macro_contribution: (after - baseline) / precision.cards.length
    });
  }
  const oracle = mean(scores);
  return {
    fields,
    token_occurrences: occurrences,
    cards: perCard.length,
    oracle_macro_f1: oracle,
    oracle_delta: oracle - precision.summary.baseline_macro_f1,
    per_card: perCard.sort((left, right) => right.individual_macro_contribution - left.individual_macro_contribution)
  };
}

function greedyTarget(oracle, targetDelta) {
  let delta = 0;
  let occurrences = 0;
  const selected = [];
  for (const card of oracle.per_card) {
    if (card.individual_macro_contribution <= 0) continue;
    selected.push(card.card_ordinal);
    occurrences += card.occurrences;
    delta += card.individual_macro_contribution;
    if (delta + 1e-12 >= targetDelta) return {
      reachable: true,
      cards: selected.length,
      token_occurrences: occurrences,
      oracle_delta: delta,
      card_ordinals: selected
    };
  }
  return {
    reachable: false,
    cards: selected.length,
    token_occurrences: occurrences,
    oracle_delta: delta,
    card_ordinals: selected
  };
}

function officialRecordAudit() {
  const counts = {
    manifests: 0,
    sources: 0,
    required_records: 0,
    usable_records: 0,
    product: 0,
    set_or_insert: 0,
    parallel_exact: 0,
    rarity: 0,
    product_set_pairs: 0,
    product_parallel_pairs: 0,
    set_parallel_pairs: 0,
    product_set_parallel_tuples: 0
  };
  const versions = [];
  for (const file of fs.readdirSync(paths.officialDir).filter((name) => name.endsWith(".json")).sort()) {
    const absolute = path.join(paths.officialDir, file);
    const raw = fs.readFileSync(absolute);
    const manifest = JSON.parse(raw);
    counts.manifests += 1;
    counts.sources += (manifest.sources || []).length;
    versions.push({
      path: path.relative(repoRoot, absolute),
      schema_version: manifest.schema_version,
      sha256: sha256(raw),
      sources: (manifest.sources || []).length
    });
    for (const source of manifest.sources || []) {
      for (const record of source.required_records || []) {
        counts.required_records += 1;
        if (record.expected_import_status === "OFFICIAL_PARSE_REVIEW_REQUIRED") continue;
        counts.usable_records += 1;
        const product = record.product != null;
        const set = record.set_or_insert != null;
        const parallel = record.parallel_exact != null;
        const rarity = record.rarity != null;
        counts.product += Number(product);
        counts.set_or_insert += Number(set);
        counts.parallel_exact += Number(parallel);
        counts.rarity += Number(rarity);
        counts.product_set_pairs += Number(product && set);
        counts.product_parallel_pairs += Number(product && parallel);
        counts.set_parallel_pairs += Number(set && parallel);
        counts.product_set_parallel_tuples += Number(product && set && parallel);
      }
    }
  }
  return { counts, versions };
}

function candidateFactCoverage(rows) {
  const byKind = {};
  const cardsByKind = {};
  for (const row of rows) {
    const seen = new Set();
    for (const fact of row.candidate_facts || []) {
      byKind[fact.kind] = (byKind[fact.kind] || 0) + 1;
      seen.add(fact.kind);
    }
    for (const kind of seen) cardsByKind[kind] = (cardsByKind[kind] || 0) + 1;
  }
  return { occurrences_by_kind: byKind, cards_by_kind: cardsByKind };
}

export function analyzeWorldAssetCoverage() {
  const raw = Object.fromEntries(Object.entries(paths).filter(([name]) => !name.startsWith("output") && name !== "officialDir")
    .map(([name, file]) => [name, fs.readFileSync(file)]));
  if (sha256(raw.constraints) !== expected.constraints_sha256
    || sha256(raw.expression) !== expected.expression_sha256
    || sha256(raw.worldReplay) !== expected.world_replay_sha256) {
    throw new Error("world_asset_audit_source_fingerprint_mismatch");
  }
  const constraints = JSON.parse(zlib.gunzipSync(raw.constraints));
  const world = JSON.parse(raw.worldReplay);
  const expression = readJsonl(raw.expression);
  const precision = analyzeCombinedPrecisionLoss();
  const release = runOfficialReleaseGraphScreen();
  const official = officialRecordAudit();
  if (expression.length !== expected.cards || precision.summary.cards !== expected.cards
    || world.validation.provider_calls !== 0 || release.cohorts[0].screened_card_count !== expected.cards) {
    throw new Error("world_asset_audit_cohort_or_authority_mismatch");
  }

  const rank = world.candidate_rank_replay;
  const hard = world.hard_rejection_falsification;
  const officialFresh = release.cohorts.find((cohort) => cohort.name === "fresh150_candidate_expression_v4");
  const fieldOracles = {
    subject_year: fieldRemovalOracle(precision, ["year"]),
    release_identity: fieldRemovalOracle(precision, ["manufacturer", "product", "set", "release_variant", "card_name"]),
    subject_ip_team: fieldRemovalOracle(precision, ["subjects", "ip", "team"]),
    finish_parallel: fieldRemovalOracle(precision, ["print_finish", "descriptive_rarity"]),
    combined_world_scope: fieldRemovalOracle(precision, [
      "year", "manufacturer", "product", "set", "release_variant", "card_name",
      "subjects", "ip", "team", "print_finish", "descriptive_rarity"
    ])
  };
  const target = Object.fromEntries(Object.entries(fieldOracles).map(([name, oracle]) => [
    name, greedyTarget(oracle, expected.target_delta_f1)
  ]));
  const currentDelta = precision.correctors.world_typed_year.replacement_token_oracle_delta;
  const clearErrorDelta = precision.oracles.by_primary_classification.obvious_factual_error.oracle_delta;
  const factCoverage = candidateFactCoverage(expression);

  const relations = {
    subject_year: {
      local_asset: "player_years",
      source_keys: Object.keys(constraints.player_years || {}).length,
      subject_occurrences: world.fresh150_coverage.subject_occurrences.occurrences,
      exact_subject_occurrences_supported: world.fresh150_coverage.subject_occurrences.player_years,
      eligible_multi_candidate_cards: rank.subject_year.eligible_multi_candidate_cards,
      positive_support_cards: rank.subject_year.cards_with_positive_world_support,
      changed_candidate_rank_cards: rank.subject_year.changed_top_candidate_cards,
      candidate_rank_wins: rank.subject_year.wins,
      candidate_rank_losses: rank.subject_year.losses,
      current_final_title_correction_cards: precision.correctors.world_typed_year.cards,
      current_final_title_oracle_delta: currentDelta,
      correct_value_false_reject_rate: hard.subject_year.false_positive_rate,
      decision: "HOLD_SUPPORT_ONLY_NO_HARD_REJECT"
    },
    subject_team_year: {
      local_asset: "player_team_years",
      source_keys: Object.keys(constraints.player_team_years || {}).length,
      exact_subject_occurrences_supported: world.fresh150_coverage.subject_occurrences.player_team_years,
      eligible_multi_candidate_cards: rank.subject_team_year.eligible_multi_candidate_cards,
      positive_support_cards: rank.subject_team_year.cards_with_positive_world_support,
      changed_candidate_rank_cards: rank.subject_team_year.changed_top_candidate_cards,
      candidate_rank_wins: rank.subject_team_year.wins,
      candidate_rank_losses: rank.subject_team_year.losses,
      known_polluted_edges_lower_bound: world.snapshot_quality.known_ambiguous_or_non_team_edge_count,
      current_final_title_correction_cards: 0,
      decision: "STOP_NEGATIVE_AND_SEMANTICALLY_POLLUTED"
    },
    subject_character_ip: {
      local_asset: null,
      source_edges: 0,
      typed_candidate_counterfactual_cards: world.fresh150_coverage.typed_ip_candidate_counterfactual_cards,
      canonical_ip_field_cards: world.fresh150_coverage.ip_field_cards,
      current_final_title_correction_cards: 0,
      decision: "STOP_MISSING_RELATION"
    },
    product_year: {
      local_asset: "product_years",
      source_keys: Object.keys(constraints.product_years || {}).length,
      eligible_multi_candidate_cards: rank.product_year.eligible_multi_candidate_cards,
      positive_support_cards: rank.product_year.cards_with_positive_world_support,
      changed_candidate_rank_cards: rank.product_year.changed_top_candidate_cards,
      candidate_rank_wins: rank.product_year.wins,
      candidate_rank_losses: rank.product_year.losses,
      current_final_title_correction_cards: precision.correctors.world_untyped_identity.current_combined_precision_correction_cards,
      correct_value_false_reject_rate: hard.product_year.false_positive_rate,
      decision: "HOLD_CANDIDATE_SIGNAL_BUT_RESOLVER_DOES_NOT_CONSUME_IT"
    },
    set_product_year: {
      local_asset: "set_product_years",
      source_keys: Object.keys(constraints.set_product_years || {}).length,
      typed_candidate_counterfactual_cards: world.fresh150_coverage.typed_set_candidate_counterfactual_cards,
      enumerated_value_cards: world.fresh150_coverage.product_enumerator_value_cards,
      known_wrong_enumerations: world.fresh150_coverage.product_enumerator_values.filter((row) => row.visible_set_or_card_name === "Throwback").length,
      current_final_title_correction_cards: 0,
      decision: "STOP_NO_TYPED_SCREEN_AND_KNOWN_FALSE_ENUMERATION"
    },
    release_product_set_parallel: {
      local_asset: "official_manifests_plus_field_vocabulary",
      graph_terms: release.graph.normalized_term_count,
      graph_edges: release.graph.edge_count,
      record_product_set_pairs: official.counts.product_set_pairs,
      record_product_parallel_pairs: official.counts.product_parallel_pairs,
      record_set_parallel_pairs: official.counts.set_parallel_pairs,
      record_product_set_parallel_tuples: official.counts.product_set_parallel_tuples,
      exact_supported_candidate_cards: officialFresh.supported_card_count,
      exact_supported_finish_candidate_cards: officialFresh.match_role_hints.finish || 0,
      current_final_title_correction_cards: precision.correctors.release_graph.precision_correction_token_occurrences,
      competing_finish_tokens: precision.precision_heads.finish_competes_with_specific_reference_value.token_occurrences,
      competing_finish_cards: precision.precision_heads.finish_competes_with_specific_reference_value.cards,
      decision: "GO_BUILD_SOURCE_VERSIONED_RELATION_ASSET_STOP_CURRENT_GRAPH"
    }
  };

  const report = {
    schema_version: "world-asset-coverage-audit-v1",
    authority: "offline_advisory_evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    runtime_changes: 0,
    decision: {
      current_world_assets: "STOP_INSUFFICIENT_FINAL_TITLE_CORRECTION",
      local_official_data_only: "STOP_NO_PRODUCT_PARALLEL_COOCCURRENCE",
      next_asset: "GO_BUILD_MINIMAL_SOURCE_VERSIONED_RELEASE_IDENTITY_PARALLEL_GRAPH",
      production: "STOP_UNTIL_FULL_150_RESOLVER_COMPOSER_REPLAY_PASSES"
    },
    contrary_hypothesis: "A larger generic player-team world model is not the highest-leverage accuracy investment. Current title losses concentrate in release identity and finish relations, while team ranking is negative.",
    invariants: {
      visible_text_can_be_overwritten: false,
      candidate_generation_allowed: false,
      candidate_value_mutation_allowed: false,
      asset_absence_means_contradiction: false,
      hard_rejection_allowed: false,
      advisory_rank_and_abstain_only: true
    },
    source_versions: {
      constraints: {
        path: path.relative(repoRoot, paths.constraints),
        sha256: sha256(raw.constraints),
        schema_version: constraints.schema_version,
        generated_at: constraints.generated_at,
        source_card_count: constraints.source_card_count,
        edge_level_provenance_present: world.snapshot_quality.edge_level_provenance_present
      },
      expression: { path: path.relative(repoRoot, paths.expression), sha256: sha256(raw.expression) },
      world_replay: { path: path.relative(repoRoot, paths.worldReplay), sha256: sha256(raw.worldReplay) },
      official_manifests: official.versions,
      official_graph_sources: release.source_versions
    },
    asset_quality: {
      constraint_relation_cardinalities: world.snapshot_quality.relation_cardinalities,
      player_team_subject_share_of_player_year_subjects: world.snapshot_quality.player_team_subject_share_of_player_year_subjects,
      known_polluted_team_edges_lower_bound: world.snapshot_quality.known_ambiguous_or_non_team_edge_count,
      official_records: official.counts,
      official_graph: release.graph,
      candidate_facts: factCoverage
    },
    relation_coverage: relations,
    accuracy_mass: {
      fresh150_recall_loss_families: world.fresh150_exhaustive_loss_scope.structural_families,
      recall_identity_world_addressability_ceiling: {
        occurrences: world.fresh150_exhaustive_loss_scope.identity_world_family_upper_bound_occurrences,
        share: world.fresh150_exhaustive_loss_scope.identity_world_family_upper_bound_share,
        warning: "rankers cannot recover a candidate Luna never expressed"
      },
      current_precision_field_oracles: Object.fromEntries(Object.entries(fieldOracles).map(([name, oracle]) => [name, {
        fields: oracle.fields,
        token_occurrences: oracle.token_occurrences,
        cards: oracle.cards,
        oracle_delta: oracle.oracle_delta
      }]))
    },
    target_delta_analysis: {
      target_delta_f1: expected.target_delta_f1,
      current_verified_final_title_world_delta: currentDelta,
      target_fraction_currently_demonstrated: currentDelta / expected.target_delta_f1,
      remaining_delta: expected.target_delta_f1 - currentDelta,
      all_clear_precision_errors_oracle_delta: clearErrorDelta,
      all_clear_precision_errors_can_reach_target: clearErrorDelta >= expected.target_delta_f1,
      precision_only_greedy_oracles: target,
      interpretation: "Current assets demonstrate 1 final-title correction. Under a label-reading precision-only oracle, reaching +0.02 requires concentrated corrections across at least the listed high-impact cards; these are workload bounds, not forecasts."
    },
    minimum_asset_extension: {
      priority: [
        "release_year_product_set_parallel_finish",
        "subject_or_character_ip_release_identity",
        "source_versioned_product_year_and_set_product_edges",
        "player_team_year_only_after_semantic_cleanup"
      ],
      edge_schema: [
        "edge_id", "subject_type", "subject_normalized", "predicate", "object_type", "object_normalized",
        "release_id", "valid_from", "valid_to", "category_or_ip", "source_url", "source_sha256",
        "source_version", "evidence_type", "coverage_contract", "confidence", "adjudication_status"
      ],
      first_ingestion_gate: {
        required_relation: "release_year_product_set_parallel_finish",
        reason: "the local official records contain zero product-parallel and zero set-parallel pairs while finish is the largest relation-addressable precision head",
        must_be_disjoint_from_review_labels: true,
        absence_contract: "UNKNOWN"
      }
    },
    offline_counterfactual_ranker_screen: {
      input: "frozen Luna candidate multiset plus phrase-role resolver",
      action: "stable positive-edge rank only; no create, mutate, delete, or hard reject",
      protected: "exact/stamped/logo visible evidence",
      evaluation: "full CSM/SEM resolver plus same deterministic Composer on all 150 cards",
      negative_controls: ["shuffled_edges", "longest_candidate", "edge_source_removed", "reference_not_available_to_ranker"],
      go_gates: {
        macro_f1_delta_at_least: expected.target_delta_f1,
        wins_greater_than_losses: true,
        numeric_or_subject_critical_regressions: 0,
        candidate_count_delta: 0,
        candidate_value_mutations: 0,
        protected_visible_rejections: 0,
        provider_calls: 0
      }
    },
    label_boundary: precision.label_observability
  };

  const classified = Object.values(precision.breakdown.by_primary_classification)
    .reduce((sum, row) => sum + row.occurrences, 0);
  if (classified !== precision.summary.reference_absent_token_occurrences
    || relations.release_product_set_parallel.record_product_parallel_pairs !== 0
    || report.target_delta_analysis.current_verified_final_title_world_delta <= 0) {
    throw new Error("world_asset_audit_internal_invariant_failed");
  }
  return report;
}

function markdown(report) {
  const n = (value) => Number(value).toFixed(6);
  const relationRows = Object.entries(report.relation_coverage).map(([name, row]) => {
    const supported = row.positive_support_cards ?? row.exact_supported_candidate_cards ?? row.enumerated_value_cards ?? row.typed_candidate_counterfactual_cards ?? 0;
    const changed = row.changed_candidate_rank_cards ?? 0;
    const final = row.current_final_title_correction_cards ?? 0;
    const risk = row.correct_value_false_reject_rate == null ? "—" : `${(100 * row.correct_value_false_reject_rate).toFixed(1)}%`;
    return `| ${name} | ${supported} | ${changed} | ${final} | ${risk} | ${row.decision} |`;
  }).join("\n");
  const oracleRows = Object.entries(report.accuracy_mass.current_precision_field_oracles).map(([name, row]) => (
    `| ${name} | ${row.token_occurrences} | ${row.cards} | ${n(row.oracle_delta)} |`
  )).join("\n");
  const targetRows = Object.entries(report.target_delta_analysis.precision_only_greedy_oracles).map(([name, row]) => (
    `| ${name} | ${row.reachable ? "yes" : "no"} | ${row.cards} | ${row.token_occurrences} | ${n(row.oracle_delta)} |`
  )).join("\n");
  return `# Source-versioned world asset coverage audit — fresh150\n\n## Decision\n\nThe opposing hypothesis wins: a larger generic player/team knowledge base is not the current accuracy optimum. Existing world assets produce only **1 final-title correction** and a +${n(report.target_delta_analysis.current_verified_final_title_world_delta)} replacement oracle, just ${(100 * report.target_delta_analysis.target_fraction_currently_demonstrated).toFixed(1)}% of the requested +0.02 contribution. Team ranking is already negative.\n\n- **STOP current assets for accuracy promotion.** Product-year has a useful candidate-level signal, but the resolver/Composer consumes none of its 15 wins in the current final titles.\n- **STOP local official data alone.** Its 143 required records contain ${report.asset_quality.official_records.product_set_pairs} product-set pairs, but **0 product-parallel, 0 set-parallel, and 0 product-set-parallel tuples**. It physically cannot validate the largest finish ambiguity head.\n- **GO build one minimal source-versioned release identity graph**, centered on release/year/product/set/parallel/finish, then run a full 150-card resolver+Composer counterfactual. This is an asset-build decision, not production approval.\n\nProvider calls: 0. Runtime/Production changes: 0.\n\n## Relation coverage and risk\n\n| relation | supported cards | candidate-rank changes | final-title corrections | correct-value false-reject risk | decision |\n|---|---:|---:|---:|---:|---|\n${relationRows}\n\nTwo existing relations prove why advisory-only is a hard boundary: treating missing edges as contradictions falsely rejects ${(100 * report.relation_coverage.subject_year.correct_value_false_reject_rate).toFixed(1)}% of covered correct subject-years and ${(100 * report.relation_coverage.product_year.correct_value_false_reject_rate).toFixed(1)}% of covered correct product-years. The team relation contains at least ${report.asset_quality.known_polluted_team_edges_lower_bound} visibly non-team or ambiguous edges and scored ${report.relation_coverage.subject_team_year.candidate_rank_wins} win / ${report.relation_coverage.subject_team_year.candidate_rank_losses} losses.\n\n## Where +0.02 could physically come from\n\n| relation-addressable precision scope | extra tokens | cards | delete-label oracle delta |\n|---|---:|---:|---:|\n${oracleRows}\n\nThese are deliberately impossible label-reading oracles: they delete every candidate token that the one writer omitted, including potentially valid facts. They measure mass, not expected gain. Even deleting all 33 independently clear factual-error tokens adds only ${n(report.target_delta_analysis.all_clear_precision_errors_oracle_delta)}, so clear precision corrections alone cannot deliver +0.02.\n\n| greedy precision-only scope | +0.02 reachable | high-impact cards needed | tokens removed | achieved delta |\n|---|---:|---:|---:|---:|\n${targetRows}\n\nThe combined relation oracle needs at least ${report.target_delta_analysis.precision_only_greedy_oracles.combined_world_scope.cards} concentrated high-impact cards; current verified coverage is 1. Finish-only would need ${report.target_delta_analysis.precision_only_greedy_oracles.finish_parallel.cards} of its affected cards, and release identity alone ${report.target_delta_analysis.precision_only_greedy_oracles.release_identity.cards}. This is why raw edge counts are the wrong KPI: the asset must change a typed final field on high-impact cards.\n\nOn recall, world-family losses cover at most ${report.accuracy_mass.recall_identity_world_addressability_ceiling.occurrences}/255 (${(100 * report.accuracy_mass.recall_identity_world_addressability_ceiling.share).toFixed(1)}%) of exhaustive-not-expressed occurrences. A ranker cannot recover facts Luna never emitted.\n\n## Minimal asset, not a generic world model\n\nThe first asset is an append-only edge table with: ${report.minimum_asset_extension.edge_schema.map((field) => `\`${field}\``).join(", ")}. Every edge carries source version and provenance. Coverage remains positive-only; absence is UNKNOWN.\n\nPriority is release/year/product/set/parallel/finish, then character/IP/release identity, then versioned product-year/set-product. Player-team-year comes last, after semantic cleanup, because it has low marketplace value and current negative evidence. Serial numbers stay outside the world model: they require visible transcription, not background knowledge.\n\n## Offline counterfactual gate\n\n1. Freeze the Luna candidate multiset and type phrases before ranking.\n2. Stable-rank only candidates with positive source-backed edges; never create, mutate, delete, or reject visible evidence.\n3. Replay the full CSM/SEM resolver and the same 80-character Composer on all 150 cards.\n4. Require final macro F1 Δ ≥ +0.02, wins > losses, zero numeric/subject critical regression, zero candidate mutation, and zero protected-visible rejection.\n5. Run shuffled-edge, longest-candidate, and source-removed controls; the reference title never enters the ranker.\n\nUntil that gate passes, the result remains **STOP for runtime and Production**.\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = analyzeWorldAssetCoverage();
  fs.writeFileSync(paths.outputJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(paths.outputReport, markdown(report));
  process.stdout.write(`${JSON.stringify({
    output: path.relative(repoRoot, paths.outputJson),
    decision: report.decision,
    target_delta_analysis: report.target_delta_analysis,
    release_relation: report.relation_coverage.release_product_set_parallel
  }, null, 2)}\n`);
}
