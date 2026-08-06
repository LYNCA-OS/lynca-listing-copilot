#!/usr/bin/env node

// Zero-call, evaluation-only coverage screen for official release support.
// It can only support/rank candidate literals that already exist. It never
// creates values, rejects candidates, or changes CSM/SEM/runtime behavior.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const officialReleaseGraphVersion = "official-release-graph-v1";
export const minimumSupportedCards = 8;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const officialDir = path.join(repoRoot, "data/catalog/official");
const vocabularyPath = path.join(repoRoot, "data/catalog/vocabulary/field-vocabulary.json");
const defaultCohorts = Object.freeze([
  {
    name: "fresh150_candidate_expression_v4",
    path: path.join(repoRoot, "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl"),
    mode: "candidate_expression_v4"
  },
  {
    name: "paid105_residual_v1_completed_treatment",
    path: path.join(repoRoot, "artifacts/paid105-residual-v1-2026-08-02/thin-path-gpt-5.6-luna.jsonl"),
    mode: "residual_v1",
    arm: "thin_canonical_residual_v1_high"
  }
]);

const sentinelTerms = new Set(["", "null", "none", "unknown", "n a", "na", "undefined", "not applicable", "other"]);
export const exactNorm = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[®™©]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const phraseContains = (text, phrase) => {
  const needle = exactNorm(phrase);
  return needle.length > 1 && ` ${exactNorm(text)} `.includes(` ${needle} `);
};
const tally = (rows, keyFor) => Object.fromEntries([...rows.reduce((counts, row) => {
  const key = String(keyFor(row) ?? "<missing>");
  counts.set(key, (counts.get(key) || 0) + 1);
  return counts;
}, new Map())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));

function addEdge(index, value, edge, quality) {
  const normalized = exactNorm(value);
  if (normalized.length < 2 || sentinelTerms.has(normalized)) {
    quality.excluded_sentinel_or_short_edges += 1;
    return;
  }
  const edges = index.get(normalized) || [];
  edges.push(Object.freeze({ ...edge, literal: String(value) }));
  index.set(normalized, edges);
}

export function buildOfficialReleaseGraph() {
  const index = new Map();
  const quality = { excluded_sentinel_or_short_edges: 0, excluded_review_required_records: 0 };
  const sources = [];
  const manifestFiles = fs.readdirSync(officialDir).filter((file) => file.endsWith(".json")).sort();

  for (const file of manifestFiles) {
    const absolutePath = path.join(officialDir, file);
    const raw = fs.readFileSync(absolutePath);
    const manifest = JSON.parse(raw);
    sources.push({
      file: path.relative(repoRoot, absolutePath),
      schema_version: manifest.schema_version,
      sha256: sha256(raw),
      source_count: (manifest.sources || []).length
    });
    for (const source of manifest.sources || []) {
      const provenance = Object.freeze({
        manifest: file,
        provider: manifest.provider,
        source_name: source.source_name,
        source_type: source.source_type,
        category: source.category,
        source_url: source.official_page_url || source.source_url
      });
      addEdge(index, source.source_name, { ...provenance, role: "release", origin: "manifest_source" }, quality);
      for (const record of source.required_records || []) {
        if (record.expected_import_status === "OFFICIAL_PARSE_REVIEW_REQUIRED") {
          quality.excluded_review_required_records += 1;
          continue;
        }
        for (const [recordField, role] of Object.entries({
          product: "product",
          set_or_insert: "insert",
          parallel_exact: "print_finish",
          rarity: "rarity"
        })) {
          if (record[recordField] != null) addEdge(index, record[recordField], {
            ...provenance, role, origin: "manifest_record", record_field: recordField
          }, quality);
        }
      }
    }
  }

  const vocabularyRaw = fs.readFileSync(vocabularyPath);
  const vocabulary = JSON.parse(vocabularyRaw);
  sources.push({
    file: path.relative(repoRoot, vocabularyPath),
    schema_version: vocabulary.schema_version,
    generated_at: vocabulary.generated_at,
    source_row_count: vocabulary.source_row_count,
    sha256: sha256(vocabularyRaw)
  });
  const officialVocabulary = Object.values(vocabulary.fields || {}).flat().filter((row) => row.official === true);
  for (const row of officialVocabulary) addEdge(index, row.term, {
    manifest: path.basename(vocabularyPath),
    role: row.field,
    origin: "official_vocabulary",
    years: row.years || [],
    tiers: row.tiers || []
  }, quality);

  const crossRoleTerms = [...index].filter(([, edges]) => new Set(edges.map((edge) => edge.role)).size > 1);
  return Object.freeze({
    index,
    sources: Object.freeze(sources),
    quality: Object.freeze({
      ...quality,
      official_vocabulary_rows: officialVocabulary.length,
      cross_role_term_count: crossRoleTerms.length
    })
  });
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function candidatesFor(row, mode) {
  if (mode === "candidate_expression_v4") return [
    ...(row.candidate_facts || []).map((candidate, index) => ({
      source: "fact", index, value: candidate.value, role_hint: candidate.kind
    })),
    ...(row.candidate_hypotheses || []).map((candidate, index) => ({
      source: "hypothesis", index, value: candidate.value, role_hint: "identity_hypothesis"
    }))
  ];
  if (mode === "residual_v1") return (row.residual_candidates || []).map((candidate, index) => ({
    source: "residual", index, value: candidate.text, role_hint: candidate.target
  }));
  throw new Error(`unsupported_cohort_mode:${mode}`);
}

function roleCompatible(candidate, edge) {
  if (["identity", "identity_hypothesis"].includes(candidate.role_hint)) {
    return ["release", "product", "insert"].includes(edge.role);
  }
  if (candidate.role_hint === "finish") return ["print_finish", "rarity"].includes(edge.role);
  return false;
}

export function screenCohort(cohort, graph) {
  const inputRows = readJsonl(cohort.path);
  const rows = cohort.arm ? inputRows.filter((row) => row.arm === cohort.arm) : inputRows;
  const cards = rows.map((row, rowIndex) => {
    const matches = [];
    const seen = new Set();
    for (const candidate of candidatesFor(row, cohort.mode)) {
      const normalized = exactNorm(candidate.value);
      const dedupeKey = `${candidate.source}|${normalized}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const edges = (graph.index.get(normalized) || []).filter((edge) => roleCompatible(candidate, edge));
      if (!edges.length) continue;
      const roles = [...new Set(edges.map((edge) => edge.role))].sort();
      const inReference = phraseContains(row.reference, candidate.value);
      const inCanonical = phraseContains(row.canonical_control_title, candidate.value);
      matches.push({
        normalized,
        candidate_source: candidate.source,
        role_hint: candidate.role_hint,
        roles,
        origins: [...new Set(edges.map((edge) => edge.origin))].sort(),
        role_conflict: roles.length > 1,
        incremental_win_proxy: inReference && !inCanonical,
        absent_reference_risk_proxy: !inReference && !inCanonical,
        already_in_canonical: inCanonical
      });
    }
    const supportedValues = [...new Set(matches.map((match) => match.normalized))];
    return {
      row_ordinal: rowIndex + 1,
      asset_id: row.asset_id,
      matches,
      supported_value_count: supportedValues.length,
      disposition: supportedValues.length === 0 ? "UNKNOWN" : supportedValues.length === 1 ? "UNIQUE" : "CONFLICT"
    };
  });
  const matches = cards.flatMap((card) => card.matches);
  return Object.freeze({
    name: cohort.name,
    input_path: path.relative(repoRoot, cohort.path),
    input_sha256: sha256(fs.readFileSync(cohort.path)),
    input_row_count: inputRows.length,
    screened_card_count: cards.length,
    disposition: tally(cards, (card) => card.disposition),
    supported_card_count: cards.filter((card) => card.disposition !== "UNKNOWN").length,
    role_conflict_card_count: cards.filter((card) => card.matches.some((match) => match.role_conflict)).length,
    potential_incremental_win_card_count: cards.filter((card) => card.matches.some((match) => match.incremental_win_proxy)).length,
    absent_reference_risk_card_count: cards.filter((card) => card.matches.some((match) => match.absent_reference_risk_proxy)).length,
    candidate_match_count: matches.length,
    match_role_hints: tally(matches, (match) => match.role_hint),
    match_roles: tally(matches, (match) => match.roles.join("|")),
    match_origins: tally(matches, (match) => match.origins.join("|")),
    supported_card_ordinals: cards.filter((card) => card.disposition !== "UNKNOWN").map((card) => card.row_ordinal)
  });
}

export function runOfficialReleaseGraphScreen(cohorts = defaultCohorts) {
  const graph = buildOfficialReleaseGraph();
  const results = cohorts.map((cohort) => screenCohort(cohort, graph));
  const supportedAssetIds = new Set();
  for (let cohortIndex = 0; cohortIndex < results.length; cohortIndex += 1) {
    const inputRows = readJsonl(cohorts[cohortIndex].path);
    const rows = cohorts[cohortIndex].arm ? inputRows.filter((row) => row.arm === cohorts[cohortIndex].arm) : inputRows;
    for (const ordinal of results[cohortIndex].supported_card_ordinals) {
      supportedAssetIds.add(String(rows[ordinal - 1]?.asset_id || `${results[cohortIndex].name}:${ordinal}`));
    }
  }
  const indexEdges = [...graph.index.values()].flat();
  const exactSupportedCardCount = supportedAssetIds.size;
  return Object.freeze({
    schema_version: "official-release-graph-v1-screen-v1",
    mechanism: officialReleaseGraphVersion,
    authority: "support_and_rank_only",
    prohibited_actions: ["generate_fact", "mutate_candidate", "hard_reject", "runtime_write"],
    source_versions: graph.sources,
    graph: {
      normalized_term_count: graph.index.size,
      edge_count: indexEdges.length,
      edges_by_role: tally(indexEdges, (edge) => edge.role),
      edges_by_origin: tally(indexEdges, (edge) => edge.origin),
      quality: graph.quality
    },
    cohorts: results,
    gate: {
      minimum_supported_cards: minimumSupportedCards,
      exact_supported_unique_asset_count: exactSupportedCardCount,
      decision: exactSupportedCardCount >= minimumSupportedCards ? "CONTINUE_ZERO_CALL_REPLAY" : "STOP_INSUFFICIENT_EXACT_OFFICIAL_COVERAGE"
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(runOfficialReleaseGraphScreen(), null, 2)}\n`);
}
